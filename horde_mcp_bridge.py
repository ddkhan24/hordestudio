#!/usr/bin/env python3
"""Local MCP client bridge for Horde Studio.

The browser app never receives provider OAuth tokens. This process binds to a
configurable interface, performs MCP/OAuth on the user's behalf, discovers tool
schemas, and converts returned image URLs/content into stable data URLs.

Environment variables (also loaded from .env if present):
  HORDE_SERVER_LISTEN_HOST — interface to bind (default: 127.0.0.1)
  HORDE_SERVER_HOST        — URL used by Horde Studio / OAuth (default: 127.0.0.1)
  HORDE_SERVER_PORT        — listening port (default: 43127)
"""

from __future__ import annotations

import base64
import errno
import hashlib
import ipaddress
import json
import math
import mimetypes
import os
import re
import secrets
import socket
import stat
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

# ── Load .env if present ────────────────────────────────────
APP_DIR = Path(__file__).resolve().parent
ENV_FILE = APP_DIR / ".env"


def _load_env(path: Path) -> None:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            os.environ.setdefault(key, value)


_load_env(ENV_FILE)

# ── Network configuration ───────────────────────────────────
LISTEN_HOST = os.environ.get("HORDE_SERVER_LISTEN_HOST", "127.0.0.1")
HOST = os.environ.get("HORDE_SERVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("HORDE_SERVER_PORT", "43127"))
CALLBACK_URL = f"http://{HOST}:{PORT}/oauth/callback"
CLIENT_NAME = "Horde Studio Local MCP Bridge"
BRIDGE_BUILD = "20260905-v173"
APP_INSTANCE_ID = hashlib.sha256(str(APP_DIR).encode("utf-8")).hexdigest()[:16]
MAX_RESPONSE_BYTES = 40 * 1024 * 1024
MAX_VIDEO_BYTES = 160 * 1024 * 1024
FAL_VIDEO_JOBS: dict[str, dict[str, Any]] = {}
FAL_VIDEO_JOBS_LOCK = threading.Lock()
HOTAPI_VIDEO_JOBS: dict[str, dict[str, Any]] = {}
HOTAPI_VIDEO_JOBS_LOCK = threading.Lock()

def allowed_origins(port: int) -> set[str]:
    origins = {
        "http://localhost:4173", "http://127.0.0.1:4173",
        "http://localhost:8000", "http://127.0.0.1:8000",
        f"http://{HOST}:{port}",
    }
    for net in ("10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.",
                "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.",
                "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
                "192.168."):
        origins.add(f"http://{net}0.1:{port}")
    origins.add(f"http://10.0.0.1:{port}")
    return origins


ALLOWED_ORIGINS = allowed_origins(PORT)


def select_runtime_port(port: int) -> None:
    """Keep URLs and origin checks aligned when a stale release owns 43127."""
    global PORT, CALLBACK_URL, ALLOWED_ORIGINS
    PORT = port
    CALLBACK_URL = f"http://{HOST}:{PORT}/oauth/callback"
    ALLOWED_ORIGINS = allowed_origins(PORT)
PROVIDERS = {
    "higgsfield": {
        "label": "Higgsfield",
        "endpoint": "https://mcp.higgsfield.ai/mcp",
        "docs": "https://higgsfield.ai/mcp",
    },
    "magnific": {
        "label": "Magnific",
        "endpoint": "https://mcp.magnific.com",
        "docs": "https://www.magnific.com/ai/docs/magnific-mcp",
    },
}
STATIC_FILES = {
    "/": ("index.html", "text/html"),
    "/index.html": ("index.html", "text/html"),
    "/style.css": ("style.css", "text/css"),
    "/app.js": ("app.js", "text/javascript"),
    "/video-worlds.js": ("video-worlds.js", "text/javascript"),
    "/presets.js": ("presets.js", "text/javascript"),
    "/boot-diagnostics.js": ("boot-diagnostics.js", "text/javascript"),
    "/policy-panic-world.js": ("policy-panic-world.js", "text/javascript"),
    # Advertised built-in Virtual Humans. Source/development launches load
    # these as sidecars; portable releases additionally inline them so the
    # public archive cannot accidentally omit either definition.
    "/ashlyn-reynolds-human.js": ("ashlyn-reynolds-human.js", "text/javascript"),
    "/jane-harlow-human.js": ("jane-harlow-human.js", "text/javascript"),
    "/labs-embedded.js": ("labs-embedded.js", "text/javascript"),
    "/labs-embedded-worker.js": ("labs-embedded-worker.js", "text/javascript"),
    "/labs-needle.js": ("labs-needle.js", "text/javascript"),
    "/labs-needle-worker.js": ("labs-needle-worker.js", "text/javascript"),
    "/labs-core.js": ("labs-core.js", "text/javascript"),
    "/labs-tasks.js": ("labs-tasks.js", "text/javascript"),
    "/labs-ui.js": ("labs-ui.js", "text/javascript"),
    "/labs-guide.js": ("labs-guide.js", "text/javascript"),
    "/help-system.js": ("help-system.js", "text/javascript"),
    "/multiplayer.js": ("multiplayer.js", "text/javascript"),
    "/multiplayer-engine.js": ("multiplayer-engine.js", "text/javascript"),
    "/rpg-mechanics.js": ("rpg-mechanics.js", "text/javascript"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
    "/worlds/policy-panic.horde_world": ("Policy Panic at Bramble and Pike.horde_world", "application/json"),
    "/Start%20Horde%20Studio.command": ("Start Horde Studio.command", "application/octet-stream"),
    "/Start%20Horde%20Studio.bat": ("Start Horde Studio.bat", "application/octet-stream"),
    "/start-horde-studio.sh": ("start-horde-studio.sh", "application/octet-stream"),
}

# Portable builds keep authored showcase media outside the single-file app.
# Serve only these explicit public trees; never expose arbitrary files from the
# application directory through the localhost bridge.
STATIC_MEDIA_ROOTS = (
    ("/assets/bundled/", APP_DIR / "assets" / "bundled"),
    ("/assets/worlds/", APP_DIR / "assets" / "worlds"),
)

if os.name == "nt":
    CONFIG_DIR = Path(os.environ.get("APPDATA", Path.home())) / "Horde Studio"
elif os.uname().sysname == "Darwin":
    CONFIG_DIR = Path.home() / "Library" / "Application Support" / "Horde Studio"
else:
    CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "horde-studio"
AUTH_FILE = CONFIG_DIR / "mcp-auth.json"
ALWAYS_ON_QUEUE_FILE = CONFIG_DIR / "always-on-queue.json"
VIDEO_WORLD_MEDIA_DIR = CONFIG_DIR / "video-world-media"

store_lock = threading.RLock()
pending_auth: dict[str, dict[str, Any]] = {}
mcp_sessions: dict[str, dict[str, str]] = {}


class AlwaysOnRuntime:
    """Opt-in Virtual Human handoff for when the browser is closed.

    IndexedDB remains canonical. The browser sends a deliberately small
    snapshot and a lease heartbeat; this worker only acts after that lease has
    expired. Generated events use a crash-safe queue until the browser imports
    and acknowledges them. Provider credentials and request headers are never
    written to that queue.
    """

    def __init__(self, queue_file: Path | None = None, start_thread: bool = True) -> None:
        self.lock = threading.RLock()
        self.queue_file = queue_file or ALWAYS_ON_QUEUE_FILE
        self.enabled = False
        self.paused = False
        self.pause_reason = ""
        self.client_id = ""
        self.last_heartbeat = 0.0
        self.handoff_seconds = 90
        self.daily_limit = 6
        self.minimum_minutes = 120
        self.humans: dict[str, dict[str, Any]] = {}
        self.events: dict[str, dict[str, Any]] = {}
        self.usage_day = ""
        self.usage_count = 0
        self.in_flight: set[str] = set()
        self.last_error = ""
        self.consecutive_failures = 0
        self._restore_queue()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="horde-always-on", daemon=True)
        if start_thread:
            self._thread.start()

    def _restore_queue(self) -> None:
        try:
            value = json.loads(self.queue_file.read_text("utf-8"))
            if not isinstance(value, dict):
                return
            events = value.get("events") if isinstance(value.get("events"), list) else []
            self.events = {str(item.get("id")): item for item in events if isinstance(item, dict) and item.get("id")}
            self.usage_day = str(value.get("usageDay") or "")[:20]
            self.usage_count = max(0, int(value.get("usageCount") or 0))
            self.paused = value.get("paused") is True
            self.pause_reason = str(value.get("pauseReason") or "")[:300]
            self.consecutive_failures = max(0, int(value.get("consecutiveFailures") or 0))
        except (OSError, ValueError, TypeError):
            pass

    def _persist_queue(self) -> None:
        # Only generated event payloads and circuit-breaker counters are
        # durable. `humans`, provider headers and credentials remain RAM-only.
        try:
            self.queue_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.queue_file.with_suffix(".tmp")
            temporary.write_text(json.dumps({
                "version": 1, "events": list(self.events.values()),
                "usageDay": self.usage_day, "usageCount": self.usage_count,
                "paused": self.paused, "pauseReason": self.pause_reason,
                "consecutiveFailures": self.consecutive_failures
            }, indent=2), "utf-8")
            try:
                os.chmod(temporary, stat.S_IRUSR | stat.S_IWUSR)
            except OSError:
                pass
            temporary.replace(self.queue_file)
        except OSError as error:
            self.last_error = f"Could not persist background queue: {error}"[:500]

    def _today(self) -> str:
        return time.strftime("%Y-%m-%d", time.localtime())

    def _roll_day(self) -> None:
        today = self._today()
        if self.usage_day != today:
            self.usage_day, self.usage_count = today, 0
            self.consecutive_failures = 0
            if self.pause_reason == "provider circuit breaker":
                self.paused, self.pause_reason = False, ""
            self._persist_queue()

    def sync(self, body: dict[str, Any]) -> dict[str, Any]:
        humans = body.get("humans") if isinstance(body.get("humans"), list) else []
        cleaned: dict[str, dict[str, Any]] = {}
        for raw in humans[:100]:
            if not isinstance(raw, dict):
                continue
            human_id = str(raw.get("id") or "")[:100]
            provider = raw.get("provider") if isinstance(raw.get("provider"), dict) else {}
            base_url = str(provider.get("baseUrl") or "").rstrip("/")[:1000]
            parsed = urllib.parse.urlparse(base_url)
            if not human_id or parsed.scheme not in {"http", "https"} or not parsed.hostname:
                continue
            headers = provider.get("headers") if isinstance(provider.get("headers"), dict) else {}
            safe_headers = {str(k)[:100]: str(v)[:4000] for k, v in list(headers.items())[:30]}
            cleaned[human_id] = {
                "id": human_id,
                "name": str(raw.get("name") or "Virtual Human")[:160],
                "timelineId": str(raw.get("timelineId") or "")[:100],
                "messagesEnabled": raw.get("messagesEnabled") is True,
                "socialEnabled": raw.get("socialEnabled") is True,
                "messageDueAt": max(0, int(raw.get("messageDueAt") or 0)),
                "socialDueAt": max(0, int(raw.get("socialDueAt") or 0)),
                "hasSpoken": raw.get("hasSpoken") is True,
                "stateRevision": max(0, int(raw.get("stateRevision") or 0)),
                "initiativeReason": str(raw.get("initiativeReason") or "")[:1000],
                "context": str(raw.get("context") or "")[:18000],
                "recentMessages": raw.get("recentMessages") if isinstance(raw.get("recentMessages"), list) else [],
                "provider": {
                    "baseUrl": base_url,
                    "headers": safe_headers,
                    "model": str(provider.get("model") or "")[:500],
                    "temperature": max(0.0, min(2.0, float(provider.get("temperature") or 0.75))),
                    "maxTokens": max(64, min(2000, int(provider.get("maxTokens") or 500))),
                },
                "nextAllowedAt": max(0, int(raw.get("nextAllowedAt") or 0)),
            }
        with self.lock:
            self.enabled = body.get("enabled") is True
            self.paused = body.get("paused") is True
            self.pause_reason = "paused by user" if self.paused else ""
            self.client_id = str(body.get("clientId") or self.client_id)[:120]
            self.last_heartbeat = time.time()
            self.handoff_seconds = max(45, min(900, int(body.get("handoffSeconds") or 90)))
            self.daily_limit = max(1, min(100, int(body.get("dailyLimit") or 6)))
            self.minimum_minutes = max(15, min(1440, int(body.get("minimumMinutes") or 120)))
            self.humans = cleaned if self.enabled else {}
            self._roll_day()
            self._persist_queue()
        return self.status()

    def status(self) -> dict[str, Any]:
        with self.lock:
            self._roll_day()
            return {
                "enabled": self.enabled,
                "paused": self.paused,
                "pauseReason": self.pause_reason,
                "armed": self.enabled and not self.paused and bool(self.humans),
                "humanCount": len(self.humans),
                "queuedEvents": len(self.events),
                "browserLeaseActive": (time.time() - self.last_heartbeat) < self.handoff_seconds,
                "dailyLimit": self.daily_limit,
                "usedToday": self.usage_count,
                "lastError": self.last_error,
                "consecutiveFailures": self.consecutive_failures,
                "queuePersistent": True,
                "credentialsPersistent": False,
            }

    def pending_events(self, client_id: str) -> list[dict[str, Any]]:
        with self.lock:
            if self.client_id and client_id and client_id != self.client_id:
                return []
            return list(self.events.values())

    def acknowledge(self, event_ids: list[Any]) -> dict[str, Any]:
        with self.lock:
            for event_id in event_ids[:500]:
                self.events.pop(str(event_id), None)
            self._persist_queue()
        return self.status()

    def pause(self, reason: str = "paused by user") -> dict[str, Any]:
        with self.lock:
            self.paused = True
            self.pause_reason = str(reason or "paused by user")[:300]
            self.in_flight.clear()
            self._persist_queue()
        return self.status()

    def stop(self) -> dict[str, Any]:
        with self.lock:
            self.enabled = False
            self.humans = {}
            self.in_flight.clear()
            self.last_error = ""
            self.paused = False
            self.pause_reason = ""
            self._persist_queue()
        return self.status()

    def _run(self) -> None:
        while not self._stop.wait(10):
            try:
                self._tick()
            except Exception as error:
                with self.lock:
                    self.last_error = str(error)[:500]

    def _tick(self) -> None:
        now_ms = int(time.time() * 1000)
        candidate: tuple[str, str, dict[str, Any]] | None = None
        with self.lock:
            self._roll_day()
            if (not self.enabled or self.paused or time.time() - self.last_heartbeat < self.handoff_seconds
                    or self.usage_count >= self.daily_limit):
                return
            for human_id, human in self.humans.items():
                if human_id in self.in_flight or now_ms < int(human.get("nextAllowedAt") or 0):
                    continue
                if human.get("messagesEnabled") and human.get("hasSpoken") and 0 < human.get("messageDueAt", 0) <= now_ms:
                    candidate = (human_id, "message", dict(human)); break
                if human.get("socialEnabled") and 0 < human.get("socialDueAt", 0) <= now_ms:
                    candidate = (human_id, "social_status", dict(human)); break
            if not candidate:
                return
            self.in_flight.add(candidate[0])
        human_id, kind, human = candidate
        try:
            result = self._generate(human, kind)
            next_minutes = max(self.minimum_minutes, min(1440, int(result.get("next_check_minutes") or self.minimum_minutes)))
            with self.lock:
                lease_reclaimed = (time.time() - self.last_heartbeat) < self.handoff_seconds
                agency_paused = self.paused
                live = self.humans.get(human_id)
                if live:
                    live["nextAllowedAt"] = now_ms + next_minutes * 60000
                    live["messageDueAt" if kind == "message" else "socialDueAt"] = now_ms + next_minutes * 60000
                self.usage_count += 1
                self.consecutive_failures = 0
                self.last_error = ""
                decision = str(result.get("decision") or "none")
                text = str(result.get("text") or "").strip()[:4000]
                # The user may reopen Horde Studio while a provider request is
                # already in flight. The browser immediately regains authority;
                # discarding this late result prevents a duplicated reply.
                if not lease_reclaimed and not agency_paused and decision == kind and text:
                    event_id = f"always_{secrets.token_hex(12)}"
                    self.events[event_id] = {
                        "id": event_id, "kind": kind, "humanId": human_id,
                        "timelineId": human.get("timelineId", ""), "text": text,
                        "createdAt": now_ms, "reason": str(result.get("reason") or "")[:500],
                        "stateRevision": human.get("stateRevision", 0)
                    }
                self._persist_queue()
        except Exception as error:
            with self.lock:
                self.last_error = f"{human.get('name', 'Virtual Human')}: {error}"[:500]
                self.consecutive_failures += 1
                live = self.humans.get(human_id)
                if live:
                    delay_minutes = min(12 * 60, 15 * (2 ** min(6, self.consecutive_failures - 1)))
                    live["nextAllowedAt"] = now_ms + delay_minutes * 60000
                if self.consecutive_failures >= 5:
                    self.paused = True
                    self.pause_reason = "provider circuit breaker"
                self._persist_queue()
        finally:
            with self.lock:
                self.in_flight.discard(human_id)

    def _generate(self, human: dict[str, Any], kind: str) -> dict[str, Any]:
        provider = human["provider"]
        if not provider.get("model"):
            raise RuntimeError("No text model was selected.")
        purpose = ("Decide whether to send one natural autonomous text message now."
                   if kind == "message" else
                   "Decide whether to publish one short text-only social status now.")
        system = (
            "You are Horde Studio's bounded background agency worker. " + purpose +
            " Stay fully in character and grounded in the supplied facts. Do not invent a major event. "
            " The only valid reason for acting now is: " + str(human.get("initiativeReason") or "none supplied") + ". "
            "Return JSON only: {\"decision\":\"" + kind + "|none\",\"text\":\"...\","
            "\"reason\":\"brief private reason\",\"next_check_minutes\":120}. "
            "Choosing none is correct when contact would feel forced.\n\n" + human.get("context", "")
        )
        recent = []
        for item in human.get("recentMessages", [])[-24:]:
            if not isinstance(item, dict):
                continue
            role = "assistant" if item.get("role") == "companion" else "user"
            text = str(item.get("text") or "")[:1000]
            if text:
                recent.append({"role": role, "content": text})
        if not recent:
            recent.append({"role": "user", "content": "Evaluate whether any background action is natural now."})
        payload = {
            "model": provider["model"], "messages": [{"role": "system", "content": system}, *recent],
            "temperature": provider["temperature"], "max_tokens": provider["maxTokens"]
        }
        status, _, data = json_request(provider["baseUrl"] + "/chat/completions", method="POST",
                                       headers={"Content-Type": "application/json", **provider["headers"]},
                                       payload=payload, timeout=120)
        if status < 200 or status >= 300:
            message = data.get("error", {}).get("message") if isinstance(data, dict) else ""
            raise RuntimeError(message or f"Provider returned HTTP {status}.")
        content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")
                   if isinstance(data, dict) else "")
        if isinstance(content, list):
            content = "".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
        match = re.search(r"\{[\s\S]*\}", str(content or ""))
        if not match:
            raise RuntimeError("Background model did not return JSON.")
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {"decision": "none"}


always_on_runtime = AlwaysOnRuntime()


class MultiplayerRuntime:
    """Ephemeral LAN rooms for host-authoritative, turn-based shared play.

    This deliberately does not proxy provider requests. Guests submit intent to
    the host; the host browser performs the one model call using its existing
    settings and publishes a sanitized transcript snapshot back to the room.
    API keys, hidden world state and provider responses never enter this store.
    """

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.rooms: dict[str, dict[str, Any]] = {}
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        self.port = 0

    @staticmethod
    def _now() -> int:
        return int(time.time() * 1000)

    @staticmethod
    def _room_code() -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return "".join(secrets.choice(alphabet) for _ in range(6))

    @staticmethod
    def _clean_name(value: Any, fallback: str = "Player") -> str:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        return text[:48] or fallback

    @staticmethod
    def _clean_public_value(value: Any, depth: int = 0) -> Any:
        """Bound JSON sent through a room without flattening authored RPG state."""
        if depth > 7:
            return None
        if value is None or isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value if math.isfinite(float(value)) else 0
        if isinstance(value, str):
            return value[:12000]
        if isinstance(value, list):
            return [MultiplayerRuntime._clean_public_value(item, depth + 1) for item in value[:500]]
        if isinstance(value, dict):
            blocked = {"apikey", "api_key", "token", "playertoken", "invitetoken", "authorization", "password", "secret"}
            return {str(key)[:100]: MultiplayerRuntime._clean_public_value(item, depth + 1)
                    for key, item in list(value.items())[:500]
                    if str(key).lower().replace("-", "_") not in blocked}
        return str(value)[:1000]

    @staticmethod
    def _clean_sheet(value: Any) -> dict[str, Any]:
        source = value if isinstance(value, dict) else {}
        allowed = {"schemaVersion", "characterId", "name", "pronouns", "archetype", "ancestry", "background", "portrait", "publicIdentity",
                   "reputation", "appearance", "level", "xp", "advancement", "attributes", "skills",
                   "resources", "defenses", "conditions", "effects", "inventory", "equipment", "abilities",
                   "perks", "currencies", "notes", "location", "status", "revision"}
        cleaned = {key: MultiplayerRuntime._clean_public_value(source.get(key)) for key in allowed if key in source}
        cleaned["name"] = MultiplayerRuntime._clean_name(source.get("name"), "Adventurer")
        # Portraits are public party media, but cap them so a room cannot become a media archive.
        cleaned["portrait"] = str(source.get("portrait") or "")[:750000]
        return cleaned

    @staticmethod
    def _clean_game_state(value: Any) -> dict[str, Any]:
        source = value if isinstance(value, dict) else {}
        allowed = {"schemaVersion", "revision", "phase", "scene", "rules", "npcs", "encounters", "quests",
                   "clocks", "sharedInventory", "journal", "rolls", "transactions", "lastReceiptId", "updatedAt"}
        cleaned = {key: MultiplayerRuntime._clean_public_value(source.get(key)) for key in allowed if key in source}
        raw_characters = source.get("characters") if isinstance(source.get("characters"), dict) else {}
        cleaned["characters"] = {str(player_id)[:100]: MultiplayerRuntime._clean_sheet(sheet)
                                 for player_id, sheet in list(raw_characters.items())[:40]}
        cleaned["rolls"] = (cleaned.get("rolls") or [])[-200:]
        cleaned["transactions"] = (cleaned.get("transactions") or [])[-500:]
        return cleaned

    @staticmethod
    def _clean_snapshot(value: Any) -> dict[str, Any]:
        """Allow only the visible transcript fields guests are meant to see."""
        if not isinstance(value, dict):
            return {}
        history: list[dict[str, str]] = []
        rows = value.get("history") if isinstance(value.get("history"), list) else []
        for item in rows[-120:]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "system")
            if role not in {"dm", "user", "system"}:
                role = "system"
            text = str(item.get("text") or "").strip()[:12000]
            if text:
                history.append({"role": role, "text": text,
                                "name": MultiplayerRuntime._clean_name(item.get("name"), "") if item.get("name") else "",
                                **({"rollId": str(item.get("rollId"))[:100]} if item.get("rollId") else {})})
        experience_type = str(value.get("experienceType") or "world").strip().lower()
        if experience_type not in {"world", "chat"}:
            experience_type = "world"
        experience_name = str(value.get("experienceName") or value.get("worldName") or "Shared Session")[:120]
        source_hud = value.get("hud") if isinstance(value.get("hud"), dict) else {}
        source_location = source_hud.get("location") if isinstance(source_hud.get("location"), dict) else {}
        def clean_number(raw: Any) -> float:
            try:
                number = float(raw or 0)
                return number if math.isfinite(number) else 0.0
            except (TypeError, ValueError):
                return 0.0
        stats = []
        for stat in (source_hud.get("stats") if isinstance(source_hud.get("stats"), list) else [])[:30]:
            if not isinstance(stat, dict):
                continue
            stats.append({
                "id": str(stat.get("id") or stat.get("name") or "")[:80],
                "name": str(stat.get("name") or stat.get("id") or "Stat")[:80],
                "value": clean_number(stat.get("value")),
                "min": clean_number(stat.get("min")),
                "max": clean_number(stat.get("max")),
                "color": str(stat.get("color") or "#E63946")[:24],
            })
        quests = []
        for quest in (source_hud.get("quests") if isinstance(source_hud.get("quests"), list) else [])[:20]:
            if isinstance(quest, dict):
                quests.append({"title": str(quest.get("title") or "Quest")[:160],
                               "status": str(quest.get("status") or "active")[:40]})
        hud = {
            "location": {"name": str(source_location.get("name") or value.get("location") or "Unknown")[:160],
                         "description": str(source_location.get("description") or "")[:1200]},
            "clock": str(source_hud.get("clock") or "")[:160],
            "period": str(source_hud.get("period") or "")[:80],
            "weather": str(source_hud.get("weather") or "")[:160],
            "stats": stats,
            "outfit": str(source_hud.get("outfit") or "")[:1200],
            "inventory": [str(item)[:160] for item in
                          (source_hud.get("inventory") if isinstance(source_hud.get("inventory"), list) else [])[:80]],
            "ledger": str(source_hud.get("ledger") or "")[:6000],
            "quests": quests,
            "present": [str(item)[:160] for item in
                        (source_hud.get("present") if isinstance(source_hud.get("present"), list) else [])[:40]],
        }
        source_meta = value.get("campaignMeta") if isinstance(value.get("campaignMeta"), dict) else {}
        source_system = source_meta.get("system") if isinstance(source_meta.get("system"), dict) else {}
        campaign_meta = {
            "id": str(source_meta.get("id") or "")[:100],
            "name": str(source_meta.get("name") or experience_name)[:120],
            "system": {
                "id": str(source_system.get("id") or "custom")[:60],
                "name": str(source_system.get("name") or "Custom / system agnostic")[:120],
                "resolution": str(source_system.get("resolution") or "Host adjudication")[:500],
                "initiative": str(source_system.get("initiative") or "Round robin")[:120],
                "die": str(source_system.get("die") or source_system.get("dice") or "")[:120],
                "mode": str(source_system.get("mode") or "roll-over")[:40],
                "target": float(source_system.get("target") or 10),
                "explode": bool(source_system.get("explode")),
                "progression": ({
                    "kind": str(source_system.get("progression", {}).get("kind") or "xp")[:40],
                    "maxLevel": max(1, min(1000, int(source_system.get("progression", {}).get("maxLevel") or 20))),
                    "base": max(1, float(source_system.get("progression", {}).get("base") or 100)),
                    "curve": max(.1, min(10, float(source_system.get("progression", {}).get("curve") or 1.4))),
                } if isinstance(source_system.get("progression"), dict) else {
                    "kind": str(source_system.get("progression") or "xp")[:40], "maxLevel": 20, "base": 100, "curve": 1.4
                }),
                "attributes": [(str(row)[:80] if isinstance(row, str) else {"id": str(row.get("id") or row.get("name") or "")[:60], "name": str(row.get("name") or row.get("id") or "")[:80], "base": float(row.get("base") or 0)}) for row in (source_system.get("attributes") if isinstance(source_system.get("attributes"), list) else [])[:40] if isinstance(row, (str, dict))],
                "skills": [(str(row)[:80] if isinstance(row, str) else {"id": str(row.get("id") or row.get("name") or "")[:60], "name": str(row.get("name") or row.get("id") or "")[:80], "attribute": str(row.get("attribute") or "")[:60], "base": float(row.get("base") or 0)}) for row in (source_system.get("skills") if isinstance(source_system.get("skills"), list) else [])[:100] if isinstance(row, (str, dict))],
                "resources": [{"id": str(row.get("id") or "")[:60], "name": str(row.get("name") or row.get("id") or "")[:80], "min": float(row.get("min") or 0), "max": float(row.get("max") or 0)} for row in (source_system.get("resources") if isinstance(source_system.get("resources"), list) else [])[:40] if isinstance(row, dict)],
                "slots": [str(value)[:60] for value in (source_system.get("slots") if isinstance(source_system.get("slots"), list) else [])[:30]],
                "rulesText": str(source_system.get("rulesText") or "")[:4000],
            },
        }
        return {
            "experienceType": experience_type,
            "experienceName": experience_name,
            "worldName": experience_name,
            "sessionName": str(value.get("sessionName") or "Shared Timeline")[:120],
            "location": str(value.get("location") or "Unknown")[:160],
            "turn": max(0, min(int(value.get("turn") or 0), 1_000_000_000)),
            "hud": hud,
            "campaignMeta": campaign_meta,
            "gameState": MultiplayerRuntime._clean_game_state(value.get("gameState")),
            "history": history,
        }

    @staticmethod
    def _clean_persona(value: Any) -> dict[str, str]:
        """Keep only the public player identity shared with other participants."""
        source = value if isinstance(value, dict) else {}
        limits = {"name": 48, "pronouns": 60, "appearance": 500,
                  "publicIdentity": 500, "reputation": 500, "color": 24}
        return {key: re.sub(r"\s+", " ", str(source.get(key) or "")).strip()[:limit]
                for key, limit in limits.items()}

    def _lan_ip(self) -> str:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.connect(("8.8.8.8", 80))
                return probe.getsockname()[0]
        except OSError:
            try:
                return socket.gethostbyname(socket.gethostname())
            except OSError:
                return "127.0.0.1"

    def ensure_server(self) -> None:
        with self.lock:
            if self.server and self.thread and self.thread.is_alive():
                return
            start = int(os.environ.get("HORDE_MULTIPLAYER_PORT", str(PORT + 1)))
            server = None
            for candidate in range(start, start + 20):
                try:
                    server = ThreadingHTTPServer(("0.0.0.0", candidate), MultiplayerHandler)
                    self.port = candidate
                    break
                except OSError as error:
                    if error.errno not in {errno.EADDRINUSE, 48, 98, 10048}:
                        raise
            if server is None:
                raise RuntimeError("No free LAN multiplayer port was available.")
            self.server = server
            self.thread = threading.Thread(target=server.serve_forever,
                                           name="horde-multiplayer", daemon=True)
            self.thread.start()

    def shutdown(self) -> None:
        with self.lock:
            server, self.server, self.thread = self.server, None, None
            self.rooms.clear()
            self.port = 0
        if server:
            threading.Thread(target=server.shutdown, daemon=True).start()

    def create_room(self, body: dict[str, Any]) -> dict[str, Any]:
        self.ensure_server()
        now = self._now()
        with self.lock:
            room_code = self._room_code()
            while room_code in self.rooms:
                room_code = self._room_code()
            invite_token = secrets.token_urlsafe(24)
            host_id = "player_" + secrets.token_hex(8)
            host_token = secrets.token_urlsafe(24)
            experience_type = str(body.get("experienceType") or "world").strip().lower()
            if experience_type not in {"world", "chat"}:
                experience_type = "world"
            experience_name = self._clean_name(body.get("experienceName") or body.get("worldName"),
                                               "Shared Chat" if experience_type == "chat" else "Shared World")
            session_name = self._clean_name(body.get("sessionName"), "Shared Timeline")
            host_name = self._clean_name(body.get("displayName"), "Host")
            self.rooms[room_code] = {
                "code": room_code, "inviteToken": invite_token,
                "experienceType": experience_type, "experienceName": experience_name,
                "worldName": experience_name, "sessionName": session_name,
                "createdAt": now, "updatedAt": now, "revision": 1,
                "hostPlayerId": host_id,
                "players": {host_id: {"id": host_id, "name": host_name,
                                        "token": host_token, "joinedAt": now,
                                        "lastSeen": now, "isHost": True,
                                        "persona": self._clean_persona(body.get("persona")),
                                        "sheet": self._clean_sheet(body.get("sheet"))}},
                "round": {"number": 1, "status": "collecting", "submissions": {},
                           "activePlayerId": host_id},
                "proposal": None,
                "snapshot": self._clean_snapshot(body.get("snapshot")),
            }
            self.rooms[room_code]["snapshot"].setdefault("gameState", {}).setdefault("characters", {})[host_id] = \
                self.rooms[room_code]["players"][host_id]["sheet"]
            lan_url = f"http://{self._lan_ip()}:{self.port}/"
            invite_url = (f"{lan_url}?multiplayer={room_code}"
                          f"#invite={urllib.parse.quote(invite_token)}")
            return {"ok": True, "roomCode": room_code, "inviteToken": invite_token,
                    "inviteUrl": invite_url, "hostPlayerId": host_id,
                    "playerToken": host_token, "serverPort": self.port}

    def _room(self, body: dict[str, Any]) -> dict[str, Any]:
        code = str(body.get("roomCode") or "").strip().upper()
        room = self.rooms.get(code)
        if not room or not secrets.compare_digest(str(body.get("inviteToken") or ""), room["inviteToken"]):
            raise PermissionError("That multiplayer room or invite has expired.")
        return room

    def _player(self, room: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
        player = room["players"].get(str(body.get("playerId") or ""))
        if not player or not secrets.compare_digest(str(body.get("playerToken") or ""), player["token"]):
            raise PermissionError("Player authentication failed. Rejoin the room.")
        player["lastSeen"] = self._now()
        return player

    def _active_players(self, room: dict[str, Any]) -> list[dict[str, Any]]:
        # A short disconnect does not invalidate a round. Players remain in the
        # order they joined until the host closes the room.
        return sorted(room["players"].values(), key=lambda player: player["joinedAt"])

    def _advance_turn(self, room: dict[str, Any]) -> None:
        round_state = room["round"]
        players = self._active_players(room)
        submitted = round_state["submissions"]
        next_player = next((player for player in players if player["id"] not in submitted), None)
        round_state["activePlayerId"] = next_player["id"] if next_player else ""
        round_state["status"] = "collecting" if next_player else "ready"

    def join(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            if len(room["players"]) >= 12:
                raise ValueError("This room already has the 12-player maximum.")
            now = self._now()
            player_id = "player_" + secrets.token_hex(8)
            player_token = secrets.token_urlsafe(24)
            room["players"][player_id] = {
                "id": player_id, "name": self._clean_name(body.get("displayName")),
                "token": player_token, "joinedAt": now, "lastSeen": now, "isHost": False,
                "persona": self._clean_persona(body.get("persona")),
                "sheet": self._clean_sheet(body.get("sheet"))
            }
            room.setdefault("snapshot", {}).setdefault("gameState", {}).setdefault("characters", {})[player_id] = \
                room["players"][player_id]["sheet"]
            room["updatedAt"] = now
            room["revision"] += 1
            return {"ok": True, "roomCode": room["code"], "playerId": player_id,
                    "playerToken": player_token}

    def state(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            viewer = self._player(room, body)
            players = self._active_players(room)
            round_state = room["round"]
            submissions = round_state["submissions"]
            public_submissions = []
            for player in players:
                submitted = submissions.get(player["id"])
                row = {"playerId": player["id"], "name": player["name"],
                       "submitted": submitted is not None}
                if viewer["isHost"] and submitted is not None:
                    row["text"] = submitted["text"]
                public_submissions.append(row)
            proposal = room.get("proposal")
            if proposal:
                proposal = {"id": proposal["id"], "type": proposal["type"],
                            "label": proposal["label"], "status": proposal["status"],
                            "yes": sum(1 for vote in proposal["votes"].values() if vote),
                            "no": sum(1 for vote in proposal["votes"].values() if not vote),
                            "myVote": proposal["votes"].get(viewer["id"])}
            return {"ok": True, "roomCode": room["code"],
                    "experienceType": room.get("experienceType", "world"),
                    "experienceName": room.get("experienceName", room["worldName"]),
                    "worldName": room["worldName"],
                    "sessionName": room["sessionName"], "revision": room["revision"],
                    "isHost": viewer["isHost"], "hostPlayerId": room["hostPlayerId"],
                    "permissions": (["submit", "vote", "commit", "resolve", "close", "sheet", "roll", "gm"]
                                    if viewer["isHost"] else ["submit", "vote", "sheet", "roll"]),
                    "players": [{"id": p["id"], "name": p["name"],
                                 "persona": p.get("persona", {}), "isHost": p["isHost"],
                                 "sheet": p.get("sheet", {}),
                                 "online": self._now() - p["lastSeen"] < 45000} for p in players],
                    "round": {"number": round_state["number"], "status": round_state["status"],
                              "activePlayerId": round_state["activePlayerId"],
                              "submissions": public_submissions},
                    "proposal": proposal, "snapshot": room.get("snapshot") or {}}

    def submit(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            player = self._player(room, body)
            round_state = room["round"]
            if round_state["status"] != "collecting":
                raise ValueError("This round is already ready for the host to commit.")
            if round_state["activePlayerId"] != player["id"]:
                raise ValueError("Wait for your turn before submitting.")
            text = re.sub(r"\s+", " ", str(body.get("text") or "")).strip()[:2000]
            if not text:
                raise ValueError("Enter an action for this turn.")
            round_state["submissions"][player["id"]] = {"text": text, "at": self._now()}
            self._advance_turn(room)
            room["updatedAt"] = self._now()
            room["revision"] += 1
            return {"ok": True, "roundStatus": round_state["status"],
                    "activePlayerId": round_state["activePlayerId"]}

    def update_sheet(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            actor = self._player(room, body)
            target_id = str(body.get("targetPlayerId") or actor["id"])
            if target_id != actor["id"] and not actor["isHost"]:
                raise PermissionError("Only the host can edit another party member's sheet.")
            target = room["players"].get(target_id)
            if not target:
                raise ValueError("That party member is no longer in the room.")
            target["sheet"] = self._clean_sheet(body.get("sheet"))
            snapshot = room.setdefault("snapshot", {})
            game = snapshot.setdefault("gameState", {})
            game.setdefault("characters", {})[target_id] = target["sheet"]
            game["revision"] = max(1, int(game.get("revision") or 0) + 1)
            room["updatedAt"] = self._now(); room["revision"] += 1
            return {"ok": True, "playerId": target_id, "revision": room["revision"]}

    @staticmethod
    def _roll_dice(expression: str) -> tuple[str, list[int], int, int]:
        match = re.fullmatch(r"\s*(\d{0,2})d(\d{1,4})(?:\s*([+-])\s*(\d+))?\s*", expression.lower())
        if not match:
            raise ValueError("Use dice notation such as d20, 2d6+3, or 4d10-1.")
        count = max(1, min(int(match.group(1) or 1), 40)); sides = max(2, min(int(match.group(2)), 1000))
        modifier = (-1 if match.group(3) == "-" else 1) * int(match.group(4) or 0)
        dice = [1 + secrets.randbelow(sides) for _ in range(count)]
        normalized = f"{count}d{sides}{'+' if modifier > 0 else ''}{modifier if modifier else ''}"
        return normalized, dice, modifier, sum(dice) + modifier

    def roll(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body); player = self._player(room, body)
            snapshot = room.setdefault("snapshot", {}); game = snapshot.setdefault("gameState", {})
            rules = game.get("rules") if isinstance(game.get("rules"), dict) else {}
            sheet = player.get("sheet") if isinstance(player.get("sheet"), dict) else {}
            attribute = str(body.get("attribute") or ""); skill = str(body.get("skill") or "")
            bonus = float(body.get("bonus") or 0)
            bonus += float((sheet.get("attributes") or {}).get(attribute) or 0)
            bonus += float((sheet.get("skills") or {}).get(skill) or 0)
            active = list(sheet.get("effects") or []) + [entry for entry in (sheet.get("conditions") or []) if isinstance(entry, dict)]
            for entry in active:
                modifiers = entry.get("modifiers") if isinstance(entry.get("modifiers"), dict) else {}
                bonus += float(modifiers.get("checks") or 0)
                bonus += float((modifiers.get("attributes") or {}).get(attribute) or 0)
                bonus += float((modifiers.get("skills") or {}).get(skill) or 0)
            inventory = sheet.get("inventory") if isinstance(sheet.get("inventory"), list) else []
            for item_id in (sheet.get("equipment") or {}).values():
                item = next((entry for entry in inventory if isinstance(entry, dict) and entry.get("id") == item_id), None)
                if not item:
                    continue
                modifiers = item.get("modifiers") if isinstance(item.get("modifiers"), dict) else {}
                bonus += float(modifiers.get("checks") or 0)
                bonus += float((modifiers.get("attributes") or {}).get(attribute) or 0)
                bonus += float((modifiers.get("skills") or {}).get(skill) or 0)
            requested_dice = body.get("dice")
            dice_expression = str(requested_dice or rules.get("die") or "d20")
            if rules.get("mode") == "success-pool" and not requested_dice:
                die_match = re.fullmatch(r"\s*(?:1)?d(\d{1,4})\s*", str(rules.get("die") or "d6").lower())
                sides = max(2, min(int(die_match.group(1)) if die_match else 6, 1000))
                dice_expression = f"{max(1, min(int(bonus), 40))}d{sides}"
            expression, dice, modifier, total = self._roll_dice(dice_expression)
            explosions = 0
            parsed = re.fullmatch(r"(\d+)d(\d+)(?:[+-]\d+)?", expression)
            if rules.get("explode") and parsed and int(parsed.group(1)) == 1:
                sides = int(parsed.group(2)); last = dice[-1]
                while last == sides and explosions < 10:
                    last = 1 + secrets.randbelow(sides); dice.append(last); total += last; explosions += 1
            total += bonus; difficulty = float(body.get("difficulty") or rules.get("target") or 10)
            result = {"id": "roll_" + secrets.token_hex(8), "at": self._now(), "expression": expression,
                      "dice": dice, "modifier": modifier, "bonus": bonus, "total": total,
                      "difficulty": difficulty,
                      "label": str(body.get("label") or "Check")[:120], "playerId": player["id"],
                      "attribute": attribute[:80], "skill": skill[:80], "visibility": "public"}
            if explosions:
                result["explosions"] = explosions
            if rules.get("mode") == "success-pool":
                result["poolSize"] = len(dice); result["total"] = sum(dice)
                result["successes"] = len([value for value in dice if value >= difficulty])
                result["success"] = result["successes"] >= max(1, int(body.get("required") or 1))
            elif rules.get("mode") == "bands":
                result["outcome"] = "strong" if total >= 10 else "mixed" if total >= 7 else "complication"
            else:
                result["success"] = total >= difficulty
                if parsed and int(parsed.group(1)) == 1 and int(parsed.group(2)) == 20:
                    result["critical"] = dice[0] == 20; result["fumble"] = dice[0] == 1
                    if result["critical"]: result["success"] = True
                    if result["fumble"]: result["success"] = False
            game.setdefault("rolls", []).append(result); game["rolls"] = game["rolls"][-200:]
            if rules.get("mode") == "success-pool":
                roll_text = f"{player['name']} — {result['label']}: {result['poolSize']} dice {dice} · {result['successes']} successes · {'SUCCESS' if result.get('success') else 'FAILURE'}"
            else:
                roll_text = f"{player['name']} — {result['label']}: {expression} {dice} + {bonus:g} = {total:g} · {result.get('outcome') or ('SUCCESS' if result.get('success') else 'FAILURE')}"
            snapshot.setdefault("history", []).append({"role": "system", "name": "DICE", "rollId": result["id"], "text": roll_text})
            snapshot["history"] = snapshot["history"][-120:]
            room["updatedAt"] = self._now(); room["revision"] += 1
            return {"ok": True, "roll": result, "revision": room["revision"]}

    def gm_update(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body); player = self._player(room, body)
            if not player["isHost"]:
                raise PermissionError("Only the host can publish authoritative campaign state.")
            snapshot = body.get("snapshot")
            if not isinstance(snapshot, dict):
                raise ValueError("A complete campaign snapshot is required.")
            room["snapshot"] = self._clean_snapshot(snapshot)
            game_characters = room["snapshot"].get("gameState", {}).get("characters", {})
            for player_id, sheet in game_characters.items():
                if player_id in room["players"]:
                    room["players"][player_id]["sheet"] = self._clean_sheet(sheet)
            room["updatedAt"] = self._now(); room["revision"] += 1
            return {"ok": True, "revision": room["revision"]}

    def commit(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            player = self._player(room, body)
            if not player["isHost"]:
                raise PermissionError("Only the host can commit the party turn.")
            if room["round"]["status"] != "ready":
                raise ValueError("Every player must submit before the host can commit.")
            snapshot = body.get("snapshot")
            if isinstance(snapshot, dict):
                room["snapshot"] = self._clean_snapshot(snapshot)
            room["round"] = {"number": room["round"]["number"] + 1,
                             "status": "collecting", "submissions": {},
                             "activePlayerId": self._active_players(room)[0]["id"]}
            room["proposal"] = None
            room["updatedAt"] = self._now()
            room["revision"] += 1
            return {"ok": True, "roundNumber": room["round"]["number"]}

    def propose(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            player = self._player(room, body)
            kind = str(body.get("type") or "").strip().lower()
            if kind not in {"reroll", "reset"}:
                raise ValueError("Only reroll and timeline reset votes are supported in this first release.")
            if room.get("proposal") and room["proposal"]["status"] == "open":
                raise ValueError("Finish the current vote first.")
            proposal = {"id": "vote_" + secrets.token_hex(8), "type": kind,
                        "label": str(body.get("label") or kind.title())[:120],
                        "status": "open", "votes": {player["id"]: True}}
            room["proposal"] = proposal
            self._tally(room)
            room["revision"] += 1
            return {"ok": True, "proposalId": proposal["id"]}

    def _tally(self, room: dict[str, Any]) -> None:
        proposal = room.get("proposal")
        if not proposal or proposal["status"] != "open":
            return
        total = len(self._active_players(room))
        yes = sum(1 for vote in proposal["votes"].values() if vote)
        no = sum(1 for vote in proposal["votes"].values() if not vote)
        majority = total // 2 + 1
        if yes >= majority:
            proposal["status"] = "approved"
        elif no >= majority or len(proposal["votes"]) >= total:
            proposal["status"] = "rejected"

    def vote(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            player = self._player(room, body)
            proposal = room.get("proposal")
            if not proposal or proposal["id"] != str(body.get("proposalId") or ""):
                raise ValueError("That vote is no longer active.")
            if proposal["status"] != "open":
                raise ValueError("Voting has already closed.")
            proposal["votes"][player["id"]] = body.get("approve") is True
            self._tally(room)
            room["revision"] += 1
            return {"ok": True, "status": proposal["status"]}

    def resolve_proposal(self, body: dict[str, Any], snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            player = self._player(room, body)
            if not player["isHost"]:
                raise PermissionError("Only the host can apply an approved decision.")
            proposal = room.get("proposal")
            if not proposal or proposal["status"] != "approved":
                raise ValueError("The decision has not been approved.")
            if isinstance(snapshot, dict):
                room["snapshot"] = self._clean_snapshot(snapshot)
            proposal["status"] = "applied"
            room["revision"] += 1
            return {"ok": True}

    def close_room(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            room = self._room(body)
            player = self._player(room, body)
            if not player["isHost"]:
                raise PermissionError("Only the host can close the room.")
            self.rooms.pop(room["code"], None)
            return {"ok": True}


multiplayer_runtime = MultiplayerRuntime()


def load_store() -> dict[str, Any]:
    with store_lock:
        try:
            value = json.loads(AUTH_FILE.read_text("utf-8"))
            return value if isinstance(value, dict) else {"providers": {}}
        except (OSError, ValueError):
            return {"providers": {}}


def save_store(value: dict[str, Any]) -> None:
    with store_lock:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        temporary = AUTH_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2), "utf-8")
        try:
            os.chmod(temporary, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        temporary.replace(AUTH_FILE)


def provider_record(provider_id: str) -> dict[str, Any]:
    return load_store().get("providers", {}).get(provider_id, {})


def update_provider_record(provider_id: str, patch: dict[str, Any] | None) -> None:
    value = load_store()
    providers = value.setdefault("providers", {})
    if patch is None:
        providers.pop(provider_id, None)
    else:
        providers[provider_id] = {**providers.get(provider_id, {}), **patch}
    save_store(value)


def read_limited(response: Any) -> bytes:
    length = response.headers.get("Content-Length")
    if length and int(length) > MAX_RESPONSE_BYTES:
        raise RuntimeError("Provider response exceeded the 40 MB safety limit.")
    data = response.read(MAX_RESPONSE_BYTES + 1)
    if len(data) > MAX_RESPONSE_BYTES:
        raise RuntimeError("Provider response exceeded the 40 MB safety limit.")
    return data


def http_request(
    url: str, method: str = "GET", headers: dict[str, str] | None = None,
    body: bytes | None = None, timeout: int = 120
) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), read_limited(response)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), read_limited(error)


def json_request(
    url: str, method: str = "GET", headers: dict[str, str] | None = None,
    payload: Any = None, timeout: int = 120
) -> tuple[int, dict[str, str], Any]:
    request_headers = {"Accept": "application/json", **(headers or {})}
    body = None
    if payload is not None:
        body = json.dumps(payload).encode()
        request_headers["Content-Type"] = "application/json"
    status, response_headers, raw = http_request(url, method, request_headers, body, timeout)
    try:
        return status, response_headers, json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, ValueError):
        return status, response_headers, {"raw": raw.decode("utf-8", "replace")}


def parse_www_authenticate(value: str) -> str:
    match = re.search(r'(?:resource_metadata|resource_metadata_url)="([^"]+)"', value or "", re.I)
    return match.group(1) if match else ""


def well_known_candidates(base: str, kind: str) -> list[str]:
    parsed = urllib.parse.urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.rstrip("/")
    return list(dict.fromkeys([
        f"{origin}/.well-known/{kind}{path}",
        f"{origin}/.well-known/{kind}",
        f"{base.rstrip('/')}/.well-known/{kind}",
    ]))


def fetch_first_json(urls: list[str]) -> tuple[str, dict[str, Any]]:
    for url in urls:
        status, _, data = json_request(url)
        if 200 <= status < 300 and isinstance(data, dict):
            return url, data
    raise RuntimeError(f"Could not discover OAuth metadata from {urls[0]}.")


def discover_oauth(provider_id: str) -> dict[str, Any]:
    endpoint = PROVIDERS[provider_id]["endpoint"]
    probe_payload = {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25", "capabilities": {},
            "clientInfo": {"name": CLIENT_NAME, "version": "1.0"},
        },
    }
    status, headers, _ = json_request(endpoint, "POST", {
        "Accept": "application/json, text/event-stream",
    }, probe_payload)
    auth_header = next((value for key, value in headers.items() if key.lower() == "www-authenticate"), "")
    resource_url = parse_www_authenticate(auth_header)
    if resource_url:
        _, resource = fetch_first_json([resource_url])
    else:
        _, resource = fetch_first_json(well_known_candidates(endpoint, "oauth-protected-resource"))
    servers = resource.get("authorization_servers") or resource.get("authorizationServers") or []
    if not servers:
        raise RuntimeError("The MCP server did not advertise an OAuth authorization server.")
    authorization_server = str(servers[0]).rstrip("/")
    _, metadata = fetch_first_json(well_known_candidates(authorization_server, "oauth-authorization-server"))
    if not metadata.get("authorization_endpoint") or not metadata.get("token_endpoint"):
        raise RuntimeError("OAuth metadata is missing its authorization or token endpoint.")
    return {
        "resource": resource.get("resource", endpoint),
        "authorizationServer": authorization_server,
        "metadata": metadata,
    }


def register_client(metadata: dict[str, Any]) -> dict[str, Any]:
    endpoint = metadata.get("registration_endpoint")
    if not endpoint:
        raise RuntimeError("This provider does not support automatic MCP client registration.")
    status, _, result = json_request(endpoint, "POST", payload={
        "client_name": CLIENT_NAME,
        "client_uri": f"http://{LISTEN_HOST}:{PORT}",
        "redirect_uris": [CALLBACK_URL],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    })
    if not 200 <= status < 300 or not result.get("client_id"):
        message = result.get("error_description") or result.get("error") or f"registration failed ({status})"
        raise RuntimeError(f"OAuth client registration failed: {message}")
    return result


def begin_oauth(provider_id: str) -> str:
    discovery = discover_oauth(provider_id)
    existing = provider_record(provider_id)
    client = existing.get("client") if isinstance(existing.get("client"), dict) else {}
    if not client.get("client_id"):
        client = register_client(discovery["metadata"])
    state_token = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(72)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    pending_auth[state_token] = {
        "provider": provider_id, "verifier": verifier, "created": time.time(),
        "discovery": discovery, "client": client,
    }
    update_provider_record(provider_id, {
        "client": client,
        "authorizationServer": discovery["authorizationServer"],
        "resource": discovery["resource"],
        "oauthMetadata": discovery["metadata"],
    })
    scope = discovery["metadata"].get("scopes_supported") or []
    params = {
        "response_type": "code",
        "client_id": client["client_id"],
        "redirect_uri": CALLBACK_URL,
        "state": state_token,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "resource": discovery["resource"],
    }
    if scope:
        params["scope"] = " ".join(scope)
    return discovery["metadata"]["authorization_endpoint"] + "?" + urllib.parse.urlencode(params)


def exchange_code(state_token: str, code: str) -> str:
    pending = pending_auth.pop(state_token, None)
    if not pending or time.time() - pending["created"] > 900:
        raise RuntimeError("This authorization attempt expired. Return to Horde Studio and connect again.")
    client = pending["client"]
    metadata = pending["discovery"]["metadata"]
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": CALLBACK_URL,
        "client_id": client["client_id"],
        "code_verifier": pending["verifier"],
        "resource": pending["discovery"]["resource"],
    }
    if client.get("client_secret"):
        form["client_secret"] = client["client_secret"]
    status, _, raw = http_request(
        metadata["token_endpoint"], "POST",
        {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        urllib.parse.urlencode(form).encode(), 60,
    )
    try:
        tokens = json.loads(raw.decode())
    except (UnicodeDecodeError, ValueError):
        tokens = {}
    if not 200 <= status < 300 or not tokens.get("access_token"):
        message = tokens.get("error_description") or tokens.get("error") or f"token exchange failed ({status})"
        raise RuntimeError(f"Provider authorization failed: {message}")
    expires_in = int(tokens.get("expires_in") or 3600)
    update_provider_record(pending["provider"], {
        "tokens": {**tokens, "expires_at": int(time.time()) + expires_in - 30},
        "connectedAt": int(time.time()),
    })
    mcp_sessions.pop(pending["provider"], None)
    return pending["provider"]


def refresh_access_token(provider_id: str) -> str:
    record = provider_record(provider_id)
    tokens = record.get("tokens") or {}
    if tokens.get("access_token") and int(tokens.get("expires_at") or 0) > time.time():
        return tokens["access_token"]
    refresh_token = tokens.get("refresh_token")
    metadata = record.get("oauthMetadata") or {}
    client = record.get("client") or {}
    if not tokens.get("access_token") and not refresh_token:
        raise PermissionError("Provider is not connected. Connect it in Settings.")
    if not refresh_token or not metadata.get("token_endpoint"):
        raise PermissionError("Provider connection expired. Connect it again in Settings.")
    form = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client.get("client_id", ""),
        "resource": record.get("resource", PROVIDERS[provider_id]["endpoint"]),
    }
    if client.get("client_secret"):
        form["client_secret"] = client["client_secret"]
    status, _, raw = http_request(
        metadata["token_endpoint"], "POST",
        {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        urllib.parse.urlencode(form).encode(), 60,
    )
    try:
        fresh = json.loads(raw.decode())
    except (UnicodeDecodeError, ValueError):
        fresh = {}
    if not 200 <= status < 300 or not fresh.get("access_token"):
        raise PermissionError("Provider connection expired. Connect it again in Settings.")
    merged = {**tokens, **fresh, "expires_at": int(time.time()) + int(fresh.get("expires_in") or 3600) - 30}
    update_provider_record(provider_id, {"tokens": merged})
    return merged["access_token"]


def parse_mcp_body(headers: dict[str, str], raw: bytes, request_id: int | str | None) -> dict[str, Any]:
    content_type = next((value for key, value in headers.items() if key.lower() == "content-type"), "")
    text = raw.decode("utf-8", "replace")
    candidates: list[dict[str, Any]] = []
    if "text/event-stream" in content_type:
        for line in text.splitlines():
            if not line.startswith("data:"):
                continue
            try:
                value = json.loads(line[5:].strip())
                if isinstance(value, dict):
                    candidates.append(value)
            except ValueError:
                continue
    else:
        try:
            value = json.loads(text) if text else {}
            if isinstance(value, dict):
                candidates.append(value)
        except ValueError:
            pass
    result = next((item for item in candidates if request_id is None or item.get("id") == request_id), None)
    if not result:
        raise RuntimeError("The MCP provider returned no usable JSON-RPC response.")
    if result.get("error"):
        error = result["error"]
        raise RuntimeError(error.get("message") if isinstance(error, dict) else str(error))
    return result.get("result") or {}


def mcp_post(provider_id: str, payload: dict[str, Any], timeout: int = 180) -> tuple[dict[str, Any], dict[str, str]]:
    token = refresh_access_token(provider_id)
    endpoint = PROVIDERS[provider_id]["endpoint"]
    session = mcp_sessions.get(provider_id, {})
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if session.get("id"):
        headers["Mcp-Session-Id"] = session["id"]
    status, response_headers, raw = http_request(
        endpoint, "POST", headers, json.dumps(payload).encode(), timeout
    )
    if status == 401:
        record = provider_record(provider_id)
        tokens = record.get("tokens") or {}
        tokens["expires_at"] = 0
        update_provider_record(provider_id, {"tokens": tokens})
        token = refresh_access_token(provider_id)
        headers["Authorization"] = f"Bearer {token}"
        status, response_headers, raw = http_request(
            endpoint, "POST", headers, json.dumps(payload).encode(), timeout
        )
    if not 200 <= status < 300:
        detail = raw.decode("utf-8", "replace")[:2000]
        raise RuntimeError(f"MCP request failed ({status}): {detail}")
    session_id = next((value for key, value in response_headers.items() if key.lower() == "mcp-session-id"), "")
    if session_id:
        mcp_sessions.setdefault(provider_id, {})["id"] = session_id
    if payload.get("id") is None:
        return {}, response_headers
    return parse_mcp_body(response_headers, raw, payload.get("id")), response_headers


def ensure_mcp(provider_id: str) -> None:
    if mcp_sessions.get(provider_id, {}).get("initialized"):
        return
    result, _ = mcp_post(provider_id, {
        "jsonrpc": "2.0", "id": secrets.randbelow(1_000_000), "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": CLIENT_NAME, "version": "1.0"},
        },
    }, 60)
    if not result.get("serverInfo"):
        raise RuntimeError("The remote endpoint did not complete the MCP handshake.")
    mcp_post(provider_id, {
        "jsonrpc": "2.0", "method": "notifications/initialized", "params": {}
    }, 30)
    mcp_sessions.setdefault(provider_id, {})["initialized"] = "yes"


def list_tools(provider_id: str) -> list[dict[str, Any]]:
    ensure_mcp(provider_id)
    result, _ = mcp_post(provider_id, {
        "jsonrpc": "2.0", "id": secrets.randbelow(1_000_000),
        "method": "tools/list", "params": {},
    }, 60)
    tools = result.get("tools") or []
    return tools if isinstance(tools, list) else []


def call_tool(provider_id: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    ensure_mcp(provider_id)
    result, _ = mcp_post(provider_id, {
        "jsonrpc": "2.0", "id": secrets.randbelow(1_000_000),
        "method": "tools/call", "params": {"name": name, "arguments": arguments},
    }, 300)
    if result.get("isError"):
        text = " ".join(str(item.get("text", "")) for item in result.get("content", []) if isinstance(item, dict))
        raise RuntimeError(text or "The MCP image tool reported a failure.")
    return result


def walk_values(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_values(child)


def result_image(result: dict[str, Any]) -> tuple[str, str]:
    download_candidates: list[str] = []
    for item in walk_values(result):
        item_type = str(item.get("type", "")).lower()
        data = item.get("data")
        mime = str(item.get("mimeType") or item.get("mime_type") or "")
        if item_type == "image" and isinstance(data, str) and data:
            return f"data:{mime or 'image/png'};base64,{data}", "embedded"
        for key in ("url", "uri", "image_url", "imageUrl", "download_url", "downloadUrl"):
            candidate = item.get(key)
            if isinstance(candidate, str) and re.match(r"^https?://", candidate):
                download_candidates.append(candidate)
        text = item.get("text")
        if isinstance(text, str):
            data_match = re.search(r"data:image/[^;\s]+;base64,[A-Za-z0-9+/=\s]+", text)
            if data_match:
                return re.sub(r"\s+", "", data_match.group(0)), "embedded-text"
            download_candidates.extend(
                match.rstrip(".,]") for match in re.findall(r"https?://[^\s<>()\"']+", text)
            )
    errors: list[str] = []
    for candidate in dict.fromkeys(download_candidates):
        try:
            return download_image(candidate), candidate
        except RuntimeError as error:
            errors.append(str(error))
    if errors:
        raise RuntimeError(
            "The MCP tool returned links, but none were downloadable images. "
            + errors[-1]
        )
    raise RuntimeError("The MCP tool completed without returning an image or downloadable image URL.")


def download_image(url: str) -> str:
    status, headers, data = http_request(url, headers={
        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.2",
        "User-Agent": "Mozilla/5.0 HordeStudio/12.0",
    }, timeout=120)
    if not 200 <= status < 300:
        raise RuntimeError(f"Could not download the generated image ({status}).")
    content_type = next((value for key, value in headers.items() if key.lower() == "content-type"), "")
    mime = content_type.split(";")[0].strip()
    if not mime.startswith("image/"):
        guessed = mimetypes.guess_type(urllib.parse.urlparse(url).path)[0]
        if not guessed or not guessed.startswith("image/"):
            raise RuntimeError(f"The returned URL was not an image (content type: {mime or 'unknown'}).")
        mime = guessed
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def safe_remote_image_url(value: Any) -> str:
    """Validate browser-inaccessible provider media before proxying it.

    This endpoint is deliberately narrower than a general URL fetcher. It only
    accepts HTTPS assets from providers Horde Studio already talks to and
    refuses credentials, fragments, localhost and private/reserved addresses.
    """
    url = str(value or "").strip()
    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    trusted_suffixes = ("gptproto.com", "openrouter.ai")
    if parsed.scheme != "https" or not hostname or parsed.username or parsed.password:
        raise ValueError("Generated image URLs must be credential-free HTTPS URLs.")
    if not any(hostname == suffix or hostname.endswith("." + suffix) for suffix in trusted_suffixes):
        raise ValueError("That generated image host is not on Horde Studio's provider allowlist.")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)}
    except OSError as error:
        raise ValueError("The generated image host could not be resolved.") from error
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Generated image URLs may not resolve to a private or reserved address.")
    return url


def safe_fal_url(value: Any, *, media: bool = False) -> str:
    """Allow only credential-free HTTPS URLs owned by fal.

    Queue URLs and generated-media URLs come back in provider responses, so
    every redirect target is validated before the bridge follows it. This keeps
    the Video Adventures endpoint from becoming a general-purpose URL fetcher.
    """
    url = str(value or "").strip()
    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    allowed = ("fal.media",) if media else ("fal.run", "fal.ai")
    if parsed.scheme != "https" or not hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Fal URLs must be credential-free HTTPS URLs.")
    if not any(hostname == suffix or hostname.endswith("." + suffix) for suffix in allowed):
        raise ValueError("The Fal response referenced an unexpected host.")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)}
    except OSError as error:
        raise ValueError("The Fal host could not be resolved.") from error
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Fal URLs may not resolve to a private or reserved address.")
    return url


def fal_key(value: Any) -> str:
    key = str(value or os.environ.get("FAL_KEY") or "").strip()
    if not key:
        raise ValueError("Add a Fal API key in Horde Studio Settings first.")
    if len(key) > 1000 or any(char in key for char in "\r\n"):
        raise ValueError("The Fal API key is invalid.")
    return key


class FalRequestError(RuntimeError):
    def __init__(self, message: str, *, status: int = 0, error_type: str = "", fields: Any = None):
        super().__init__(message)
        self.status = status
        self.error_type = error_type
        self.fields = fields or []


def fal_json_request(url: str, key: str, *, method: str = "GET", payload: Any = None,
                     timeout: int = 120) -> dict[str, Any]:
    safe_fal_url(url)
    status, _, data = json_request(url, method=method, headers={
        "Authorization": f"Key {key}",
        "User-Agent": "HordeStudio/17.0 VideoAdventures/1",
    }, payload=payload, timeout=timeout)
    if not 200 <= status < 300:
        if isinstance(data, dict):
            detail = data.get("detail") or data.get("error") or data.get("message") or data.get("raw")
        else:
            detail = data
        typed = detail if isinstance(detail, list) else []
        error_types = [str(item.get("type") or "") for item in typed if isinstance(item, dict)]
        fields = sorted({str(item.get("loc", [])[-1]) for item in typed
                         if isinstance(item, dict) and isinstance(item.get("loc"), list) and item.get("loc")})
        if "content_policy_violation" in error_types:
            labels = ", ".join(fields) if fields else "submitted content"
            raise FalRequestError(
                f"Fal's content checker rejected: {labels}. Horde can restage the scene safely, but cannot bypass the provider's filter.",
                status=status, error_type="content_policy_violation", fields=fields)
        safe_detail = str(detail or "unknown provider error")
        if len(safe_detail) > 1200:
            safe_detail = safe_detail[:1200] + "…"
        raise FalRequestError(f"Fal request failed ({status}): {safe_detail}", status=status,
                              error_type=error_types[0] if error_types else "", fields=fields)
    if not isinstance(data, dict):
        raise RuntimeError("Fal returned an invalid JSON response.")
    return data


FAL_IMAGE_MODELS = {
    "fal-ai/flux/schnell",
    "fal-ai/flux/dev",
    "fal-ai/flux/dev/image-to-image",
    "fal-ai/wan-25-preview/image-to-image",
    "fal-ai/nano-banana-2/edit",
}


def generate_fal_image(body: dict[str, Any]) -> dict[str, Any]:
    """Generate a portable image through a small curated Fal model surface."""
    key = fal_key(body.get("apiKey"))
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("An image prompt is required.")
    if len(prompt) > 12000:
        raise ValueError("The image prompt exceeds the 12,000 character limit.")
    requested_model = str(body.get("model") or "fal-ai/flux/schnell").strip()
    if requested_model not in FAL_IMAGE_MODELS:
        raise ValueError("That Fal image model is not supported by this Horde Studio build.")
    image_url = str(body.get("imageDataUrl") or "").strip()
    image_urls = body.get("imageDataUrls") if isinstance(body.get("imageDataUrls"), list) else []
    image_urls = [str(value or "").strip() for value in image_urls[:14] if str(value or "").strip()]
    if image_url and not image_urls:
        image_urls = [image_url]
    if sum(len(value) for value in image_urls) > 24 * 1024 * 1024:
        raise ValueError("The combined image references exceed the 24 MB request limit.")
    for value in image_urls:
        if not re.match(r"^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", value, re.I):
            raise ValueError("Each image reference must be a JPEG, PNG or WebP data URL.")
    if image_url:
        if not re.match(r"^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", image_url, re.I):
            raise ValueError("The image reference must be a JPEG, PNG or WebP data URL.")
        if len(image_url) > 12 * 1024 * 1024:
            raise ValueError("The image reference exceeds the 12 MB safety limit.")
    model = requested_model
    if image_url and model in {"fal-ai/flux/schnell", "fal-ai/flux/dev"}:
        model = "fal-ai/flux/dev/image-to-image"
    if not image_url and model.endswith("/image-to-image"):
        model = "fal-ai/flux/schnell"
    aspect = str(body.get("aspectRatio") or "1:1")
    image_size = {
        "16:9": "landscape_16_9", "4:3": "landscape_4_3", "9:16": "portrait_16_9",
        "3:4": "portrait_4_3", "1:1": "square_hd",
    }.get(aspect, "square_hd")
    payload: dict[str, Any] = {
        "prompt": prompt, "num_images": 1, "output_format": "jpeg",
        "enable_safety_checker": body.get("enableSafetyChecker") is not False,
    }
    if model == "fal-ai/nano-banana-2/edit":
        if not image_urls:
            raise ValueError("Nano Banana reference composition requires at least one image.")
        payload = {
            "prompt": prompt, "image_urls": image_urls, "aspect_ratio": aspect,
            "resolution": "1K", "num_images": 1, "output_format": "jpeg",
            "safety_tolerance": "4" if body.get("enableSafetyChecker") is not False else "6",
        }
    elif model == "fal-ai/wan-25-preview/image-to-image":
        payload["image_urls"] = [image_url]
        payload["aspect_ratio"] = aspect if aspect in {"16:9", "9:16", "1:1"} else "auto"
    else:
        payload["image_size"] = image_size
        if image_url:
            payload["image_url"] = image_url
            payload["strength"] = float(body.get("strength") or 0.35)
    result = fal_json_request(f"https://fal.run/{model}", key, method="POST", payload=payload, timeout=180)
    images = result.get("images") if isinstance(result.get("images"), list) else []
    first = images[0] if images and isinstance(images[0], dict) else {}
    single_image = result.get("image") if isinstance(result.get("image"), dict) else {}
    output_url = str(first.get("url") or single_image.get("url") or "")
    if not output_url:
        raise RuntimeError("Fal completed the request without an image URL.")
    safe_fal_url(output_url, media=True)
    return {"ok": True, "provider": "fal", "model": model, "image": download_image(output_url)}


def download_fal_video(url: str, media_id: str) -> tuple[Path, int]:
    safe_fal_url(url, media=True)
    VIDEO_WORLD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    target = VIDEO_WORLD_MEDIA_DIR / f"{media_id}.mp4"
    temporary = VIDEO_WORLD_MEDIA_DIR / f"{media_id}.partial"
    request = urllib.request.Request(url, headers={
        "Accept": "video/mp4,video/*;q=0.9,*/*;q=0.1",
        "User-Agent": "Mozilla/5.0 HordeStudio/17.0",
    })
    total = 0
    try:
        with urllib.request.urlopen(request, timeout=180) as response, temporary.open("wb") as output:
            safe_fal_url(response.geturl(), media=True)
            content_type = str(response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if content_type and not content_type.startswith("video/") and content_type != "application/octet-stream":
                raise RuntimeError(f"Fal returned a non-video asset ({content_type}).")
            declared = int(response.headers.get("Content-Length") or 0)
            if declared > MAX_VIDEO_BYTES:
                raise RuntimeError("Generated video exceeds Horde Studio's 160 MB safety limit.")
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_VIDEO_BYTES:
                    raise RuntimeError("Generated video exceeds Horde Studio's 160 MB safety limit.")
                output.write(chunk)
        if total < 1024:
            raise RuntimeError("Fal returned an empty or incomplete video.")
        temporary.replace(target)
        return target, total
    finally:
        if temporary.exists():
            try:
                temporary.unlink()
            except OSError:
                pass


FAL_VIDEO_RENDERERS = {
    "minimax/h3-max",
    "alibaba/wan-3.0",
    "alibaba/wan-3.0-prime",
    "fal-ai/ltx-2.3/fast",
}


def _fal_video_request(model: str, body: dict[str, Any], prompt: str, image_url: str,
                       reference_image_urls: list[str],
                       duration: int, resolution: str, aspect_ratio: str,
                       seed: int) -> tuple[str, dict[str, Any], int, str]:
    """Translate Horde's stable video contract to one documented Fal model schema."""
    if model == "minimax/h3-max":
        if reference_image_urls:
            endpoint = f"{model}/reference-to-video"
            h3_resolution = "768P" if resolution in {"768P", "1080P"} else "480P"
            payload = {
                "prompt": prompt, "reference_image_urls": reference_image_urls,
                "duration": duration, "resolution": h3_resolution,
                "aspect_ratio": aspect_ratio, "seed": seed,
                "enable_safety_checker": body.get("enableSafetyChecker") is not False,
                "prompt_expansion_mode": "disabled",
            }
            return endpoint, payload, duration, h3_resolution
        endpoint = f"{model}/{'image-to-video' if image_url else 'text-to-video'}"
        h3_resolution = "768P" if resolution in {"768P", "1080P"} else "480P"
        payload: dict[str, Any] = {
            "prompt": prompt, "duration": duration, "resolution": h3_resolution, "seed": seed,
            "enable_safety_checker": body.get("enableSafetyChecker") is not False,
            "prompt_expansion_mode": "disabled" if image_url else "balanced",
        }
        if image_url:
            payload["image_url"] = image_url
        else:
            payload["aspect_ratio"] = aspect_ratio
        return endpoint, payload, duration, h3_resolution

    if model == "alibaba/wan-3.0" and reference_image_urls:
        endpoint = f"{model}/reference-to-video"
        wan_resolution = "1080p" if resolution == "1080P" else "720p" if resolution == "768P" else "480p"
        payload = {
            "prompt": prompt, "reference_image_urls": reference_image_urls,
            "duration": duration, "resolution": wan_resolution, "aspect_ratio": aspect_ratio,
            "audio": True, "enable_thinking": False, "enable_prompt_expansion": False,
            "enable_safety_checker": body.get("enableSafetyChecker") is not False, "seed": seed,
        }
        return endpoint, payload, duration, wan_resolution

    if model.startswith("alibaba/wan-3.0"):
        endpoint = f"{model}/{'image-to-video' if image_url else 'text-to-video'}"
        wan_resolution = "1080p" if resolution == "1080P" else "720p" if resolution == "768P" else "480p"
        wan_aspect = aspect_ratio if aspect_ratio in {"16:9", "9:16"} else "adaptive"
        payload = {
            "prompt": prompt, "duration": duration, "resolution": wan_resolution,
            "aspect_ratio": "adaptive" if image_url else wan_aspect,
            "audio": True, "enable_thinking": False, "enable_prompt_expansion": False,
            "enable_safety_checker": body.get("enableSafetyChecker") is not False,
            "seed": seed,
        }
        if image_url:
            payload["start_image_url"] = image_url
        return endpoint, payload, duration, wan_resolution

    if model == "fal-ai/ltx-2.3/fast":
        endpoint = f"fal-ai/ltx-2.3/{'image-to-video' if image_url else 'text-to-video'}/fast"
        supported_durations = (6, 8, 10, 12, 14, 16, 18, 20)
        ltx_duration = min(supported_durations, key=lambda value: abs(value - duration))
        payload = {
            "prompt": prompt, "duration": str(ltx_duration), "resolution": "1080p",
            "aspect_ratio": "auto" if image_url else (aspect_ratio if aspect_ratio in {"16:9", "9:16"} else "16:9"),
            "fps": "25", "generate_audio": True,
        }
        if image_url:
            payload["image_url"] = image_url
        return endpoint, payload, ltx_duration, "1080p"
    raise ValueError("That Fal video renderer is not supported by this Horde Studio build.")


def generate_fal_video(body: dict[str, Any], on_model: Any = None) -> dict[str, Any]:
    """Generate one shot with an ordered, model-aware Fal fallback chain."""
    key = fal_key(body.get("apiKey"))
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("A shot prompt is required.")
    if len(prompt) > 12000:
        raise ValueError("The shot prompt exceeds the 12,000 character limit.")
    duration = int(body.get("duration") or 5)
    if duration < 5 or duration > 15:
        raise ValueError("Video duration must be between 5 and 15 seconds.")
    resolution = str(body.get("resolution") or "480P").upper()
    if resolution not in {"480P", "768P", "1080P"}:
        raise ValueError("Video resolution must be 480P, 768P or 1080P.")
    aspect_ratio = str(body.get("aspectRatio") or "16:9")
    if aspect_ratio not in {"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}:
        raise ValueError("Unsupported Video Adventure aspect ratio.")
    seed = int(body.get("seed") or secrets.randbelow(2_000_000_000))
    image_url = str(body.get("imageDataUrl") or "").strip()
    if image_url:
        if not re.match(r"^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", image_url, re.I):
            raise ValueError("The continuity frame must be a JPEG, PNG or WebP data URL.")
        if len(image_url) > 12 * 1024 * 1024:
            raise ValueError("The continuity frame exceeds the 12 MB safety limit.")
    reference_image_urls = body.get("referenceImageDataUrls") if isinstance(body.get("referenceImageDataUrls"), list) else []
    reference_image_urls = [str(value or "").strip() for value in reference_image_urls[:4] if str(value or "").strip()]
    if sum(len(value) for value in reference_image_urls) > 24 * 1024 * 1024:
        raise ValueError("The combined video references exceed the 24 MB request limit.")
    for value in reference_image_urls:
        if not re.match(r"^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", value, re.I):
            raise ValueError("Each video reference must be a JPEG, PNG or WebP data URL.")

    requested_models = body.get("models") if isinstance(body.get("models"), list) else []
    models = []
    for raw in requested_models[:4] or [body.get("model") or "minimax/h3-max"]:
        model = str(raw or "").strip()
        if model in FAL_VIDEO_RENDERERS and model not in models:
            models.append(model)
    if not models:
        raise ValueError("Choose at least one supported Fal video renderer.")
    latency_mode = str(body.get("latencyMode") or "queue").lower()
    attempts: list[dict[str, str]] = []
    last_error: Any = None
    result: dict[str, Any] = {}
    request_id = ""
    endpoint = ""
    actual_duration = duration
    actual_resolution = resolution
    for model in models:
        if callable(on_model):
            on_model(model)
        try:
            endpoint, payload, actual_duration, actual_resolution = _fal_video_request(
                model, body, prompt, image_url, reference_image_urls, duration, resolution, aspect_ratio, seed)
            if latency_mode != "queue":
                result = fal_json_request(f"https://fal.run/{endpoint}", key,
                                          method="POST", payload=payload, timeout=240)
                request_id = str(result.get("request_id") or result.get("requestId") or "")
            else:
                submitted = fal_json_request(f"https://queue.fal.run/{endpoint}", key,
                                             method="POST", payload=payload, timeout=60)
                request_id = str(submitted.get("request_id") or submitted.get("requestId") or "")
                status_url = submitted.get("status_url") or submitted.get("statusUrl")
                response_url = submitted.get("response_url") or submitted.get("responseUrl")
                if not request_id or not status_url:
                    raise RuntimeError("Fal did not return a queue request ID and status URL.")
                deadline = time.monotonic() + 360
                while time.monotonic() < deadline:
                    status_data = fal_json_request(str(status_url), key, timeout=45)
                    status_name = str(status_data.get("status") or "").upper()
                    if status_name == "COMPLETED":
                        response_url = status_data.get("response_url") or status_data.get("responseUrl") or response_url
                        break
                    if status_name in {"FAILED", "CANCELLED", "CANCELED"}:
                        detail = status_data.get("error") or status_data.get("detail") or status_name.lower()
                        raise RuntimeError(f"Fal video generation {status_name.lower()}: {detail}")
                    time.sleep(0.5)
                else:
                    raise RuntimeError("Fal video generation timed out after six minutes.")
                if not response_url:
                    raise RuntimeError("Fal completed the shot without a result URL.")
                result = fal_json_request(str(response_url), key, timeout=60)
            video = result.get("video") if isinstance(result.get("video"), dict) else {}
            if not str(video.get("url") or ""):
                raise RuntimeError("Fal completed the request without a video URL.")
            attempts.append({"model": model, "status": "completed"})
            break
        except Exception as error:
            last_error = error
            attempts.append({"model": model, "status": "failed", "error": str(error)[:300]})
            continue
    else:
        if isinstance(last_error, FalRequestError):
            raise FalRequestError(
                "All configured Fal renderers failed. " + " | ".join(
                    f"{attempt['model']}: {attempt.get('error', 'failed')}" for attempt in attempts),
                status=last_error.status, error_type=last_error.error_type, fields=last_error.fields)
        raise RuntimeError("All configured Fal renderers failed. " + " | ".join(
            f"{attempt['model']}: {attempt.get('error', 'failed')}" for attempt in attempts)) from last_error
    video = result.get("video") if isinstance(result.get("video"), dict) else {}
    video_url = str(video.get("url") or "")
    if not video_url:
        raise RuntimeError("Fal completed the request without a video URL.")
    media_id = secrets.token_hex(16)
    _, size = download_fal_video(video_url, media_id)
    timings = result.get("timings") if isinstance(result.get("timings"), dict) else {}
    return {
        "ok": True,
        "provider": "fal",
        "model": endpoint,
        "requestId": request_id,
        "mediaId": media_id,
        "mediaUrl": f"/video-world-media/{media_id}.mp4",
        "bytes": size,
        "duration": actual_duration,
        "resolution": actual_resolution,
        "seed": seed,
        "attempts": attempts,
        "expandedPrompt": str(result.get("expanded_prompt") or "")[:30000],
        "inferenceSeconds": float(timings.get("inference") or 0),
    }


def _fal_video_job_public(job: dict[str, Any]) -> dict[str, Any]:
    return {key: job.get(key) for key in ("jobId", "status", "createdAt", "updatedAt", "result", "error",
                                           "errorCode", "errorFields", "currentModel")}


def submit_fal_video_job(body: dict[str, Any]) -> dict[str, Any]:
    """Run Fal independently of the browser request so refreshes cannot orphan UI state."""
    fal_key(body.get("apiKey"))
    job_id = secrets.token_hex(16)
    now = int(time.time() * 1000)
    job = {"jobId": job_id, "status": "queued", "createdAt": now, "updatedAt": now,
           "result": None, "error": "", "errorCode": "", "errorFields": [], "currentModel": ""}
    with FAL_VIDEO_JOBS_LOCK:
        cutoff = now - (24 * 60 * 60 * 1000)
        for stale_id in [key for key, value in FAL_VIDEO_JOBS.items() if int(value.get("updatedAt") or 0) < cutoff]:
            FAL_VIDEO_JOBS.pop(stale_id, None)
        FAL_VIDEO_JOBS[job_id] = job

    def run() -> None:
        with FAL_VIDEO_JOBS_LOCK:
            if job["status"] == "cancelled":
                return
            job.update(status="running", updatedAt=int(time.time() * 1000))
        try:
            durable_body = dict(body)
            durable_body["latencyMode"] = "queue"
            def update_model(model: str) -> None:
                with FAL_VIDEO_JOBS_LOCK:
                    job.update(currentModel=model, updatedAt=int(time.time() * 1000))

            result = generate_fal_video(durable_body, on_model=update_model)
            with FAL_VIDEO_JOBS_LOCK:
                if job["status"] == "cancelled":
                    media_id = str(result.get("mediaId") or "")
                    if re.fullmatch(r"[a-f0-9]{32}", media_id):
                        try:
                            (VIDEO_WORLD_MEDIA_DIR / f"{media_id}.mp4").unlink(missing_ok=True)
                        except OSError:
                            pass
                    return
                job.update(status="completed", result=result, updatedAt=int(time.time() * 1000))
        except Exception as error:
            with FAL_VIDEO_JOBS_LOCK:
                if job["status"] != "cancelled":
                    job.update(status="failed", error=str(error),
                               errorCode=str(getattr(error, "error_type", "") or ""),
                               errorFields=list(getattr(error, "fields", []) or []),
                               updatedAt=int(time.time() * 1000))

    threading.Thread(target=run, name=f"fal-video-{job_id[:8]}", daemon=True).start()
    return _fal_video_job_public(job)


def get_fal_video_job(job_id: str) -> dict[str, Any]:
    with FAL_VIDEO_JOBS_LOCK:
        job = FAL_VIDEO_JOBS.get(job_id)
        if not job:
            raise KeyError("Video generation job was not found. The local bridge may have restarted.")
        return _fal_video_job_public(job)


def cancel_fal_video_job(job_id: str) -> dict[str, Any]:
    with FAL_VIDEO_JOBS_LOCK:
        job = FAL_VIDEO_JOBS.get(job_id)
        if not job:
            raise KeyError("Video generation job was not found.")
        if job["status"] in {"queued", "running"}:
            job.update(status="cancelled", updatedAt=int(time.time() * 1000),
                       error="Cancelled locally; upstream work already accepted by Fal may still finish and bill.")
        return _fal_video_job_public(job)


def test_fal_connection(body: dict[str, Any]) -> dict[str, Any]:
    """Verify a Fal API-scope key without starting a billable generation."""
    key = fal_key(body.get("apiKey"))
    data = fal_json_request("https://api.fal.ai/v1/models?limit=1", key, timeout=25)
    models = data.get("models") if isinstance(data.get("models"), list) else data.get("data")
    return {
        "ok": True,
        "provider": "fal",
        "modelsVisible": len(models) if isinstance(models, list) else 0,
    }


def delete_fal_videos(body: dict[str, Any]) -> dict[str, Any]:
    values = body.get("mediaIds") if isinstance(body.get("mediaIds"), list) else []
    removed = 0
    for raw in values[:5000]:
        media_id = str(raw or "")
        if not re.fullmatch(r"[a-f0-9]{32}", media_id):
            continue
        target = VIDEO_WORLD_MEDIA_DIR / f"{media_id}.mp4"
        try:
            target.unlink()
            removed += 1
        except FileNotFoundError:
            pass
    return {"ok": True, "removed": removed}


HOTAPI_VIDEO_RENDERERS = {
    "minimax-h3-spicy",
    "seedance-2.0-fast-spicy",
    "seedance-2.0-spicy",
    "seedance-2.5-spicy",
}


def safe_hotapi_url(value: Any, *, api: bool = False) -> str:
    """Validate HotAPI control URLs and provider-returned public media URLs."""
    url = str(value or "").strip()
    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or not hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("HotAPI URLs must be credential-free HTTPS URLs.")
    if api and hostname != "api.hotapi.ai":
        raise ValueError("HotAPI requests must use api.hotapi.ai.")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)}
    except OSError as error:
        raise ValueError("The HotAPI host could not be resolved.") from error
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("HotAPI URLs may not resolve to a private or reserved address.")
    return url


def hotapi_key(value: Any) -> str:
    key = str(value or os.environ.get("HOTAPI_KEY") or "").strip()
    if not key:
        raise ValueError("Add a HotAPI key in Horde Studio Settings first.")
    if len(key) > 1000 or any(char in key for char in "\r\n"):
        raise ValueError("The HotAPI key is invalid.")
    return key


def hotapi_json_request(url: str, key: str, *, method: str = "GET", payload: Any = None,
                        timeout: int = 120) -> dict[str, Any]:
    safe_hotapi_url(url, api=True)
    status, _, data = json_request(url, method=method, headers={
        "Authorization": f"Bearer {key}",
        "User-Agent": "HordeStudio/17.0 VideoAdventures/2",
    }, payload=payload, timeout=timeout)
    if not 200 <= status < 300:
        detail = data.get("error") or data.get("message") or data.get("raw") if isinstance(data, dict) else data
        if isinstance(detail, dict):
            detail = detail.get("message") or detail.get("code") or detail
        safe_detail = str(detail or "unknown provider error")[:1200]
        raise RuntimeError(f"HotAPI request failed ({status}): {safe_detail}")
    if not isinstance(data, dict):
        raise RuntimeError("HotAPI returned an invalid JSON response.")
    return data


def hotapi_upload_image(data_url: str, key: str) -> str:
    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", data_url, re.I)
    if not match:
        raise ValueError("The HotAPI continuity frame must be a JPEG, PNG or WebP data URL.")
    raw = base64.b64decode(match.group(2), validate=True)
    if len(raw) > 10 * 1024 * 1024:
        raise ValueError("The HotAPI continuity frame exceeds the 10 MB upload limit.")
    subtype = match.group(1).lower()
    extension = "jpg" if subtype == "jpeg" else subtype
    boundary = "----HordeStudio" + secrets.token_hex(16)
    prefix = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"continuity.{extension}\"\r\n"
              f"Content-Type: image/{subtype}\r\n\r\n").encode()
    body = prefix + raw + f"\r\n--{boundary}--\r\n".encode()
    status, _, response = http_request("https://api.hotapi.ai/v1/uploads", method="POST", headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
        "User-Agent": "HordeStudio/17.0 VideoAdventures/2",
    }, body=body, timeout=90)
    try:
        data = json.loads(response.decode("utf-8")) if response else {}
    except (UnicodeDecodeError, ValueError):
        data = {}
    if not 200 <= status < 300:
        raise RuntimeError(f"HotAPI image upload failed ({status}): {str(data.get('error') or data.get('message') or 'unknown error')[:800]}")
    url = str(data.get("url") or "")
    safe_hotapi_url(url)
    return url


def hotapi_output_video_url(output: Any) -> str:
    """Accept documented and model-specific HotAPI output envelopes."""
    preferred = ("video_url", "videoUrl", "url", "mp4_url", "mp4Url")
    if isinstance(output, dict):
        for key in preferred:
            value = output.get(key)
            if isinstance(value, str) and value.startswith("https://"):
                return value
            if isinstance(value, dict):
                nested = hotapi_output_video_url(value)
                if nested:
                    return nested
        for value in output.values():
            nested = hotapi_output_video_url(value)
            if nested:
                return nested
    elif isinstance(output, list):
        for value in output:
            nested = hotapi_output_video_url(value)
            if nested:
                return nested
    return ""


def download_hotapi_video(url: str, media_id: str) -> tuple[Path, int]:
    safe_hotapi_url(url)
    VIDEO_WORLD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    target = VIDEO_WORLD_MEDIA_DIR / f"{media_id}.mp4"
    temporary = VIDEO_WORLD_MEDIA_DIR / f"{media_id}.partial"
    request = urllib.request.Request(url, headers={
        "Accept": "video/mp4,video/*;q=0.9,*/*;q=0.1",
        "User-Agent": "Mozilla/5.0 HordeStudio/17.0",
    })
    total = 0
    try:
        with urllib.request.urlopen(request, timeout=240) as response, temporary.open("wb") as output:
            safe_hotapi_url(response.geturl())
            content_type = str(response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if content_type and not content_type.startswith("video/") and content_type != "application/octet-stream":
                raise RuntimeError(f"HotAPI returned a non-video asset ({content_type}).")
            declared = int(response.headers.get("Content-Length") or 0)
            if declared > MAX_VIDEO_BYTES:
                raise RuntimeError("Generated video exceeds Horde Studio's 160 MB safety limit.")
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_VIDEO_BYTES:
                    raise RuntimeError("Generated video exceeds Horde Studio's 160 MB safety limit.")
                output.write(chunk)
        if total < 1024:
            raise RuntimeError("HotAPI returned an empty or incomplete video.")
        temporary.replace(target)
        return target, total
    finally:
        if temporary.exists():
            try:
                temporary.unlink()
            except OSError:
                pass


def _hotapi_video_request(model: str, prompt: str, image_url: str, duration: int,
                          resolution: str, aspect_ratio: str, seed: int,
                          uploaded_image_url: str = "") -> tuple[str, dict[str, Any], int, str]:
    if model == "minimax-h3-spicy":
        compact_prompt = prompt if len(prompt) <= 2000 else prompt[:1400] + "\n\n" + prompt[-580:]
        actual_resolution = "768p" if resolution in {"768P", "1080P"} else "480p"
        payload: dict[str, Any] = {
            "prompt": compact_prompt, "duration_seconds": max(5, min(15, duration)),
            "resolution": actual_resolution,
            "ratio": aspect_ratio if aspect_ratio in {"16:9", "9:16", "1:1"} else "16:9",
            "seed": seed,
        }
        if image_url:
            payload["image_url"] = image_url
        return f"https://api.hotapi.ai/v1/{model}", payload, payload["duration_seconds"], actual_resolution

    if model in {"seedance-2.0-fast-spicy", "seedance-2.0-spicy", "seedance-2.5-spicy"}:
        maximum = 30 if model == "seedance-2.5-spicy" else 15
        actual_duration = max(4, min(maximum, duration))
        actual_resolution = "720p" if resolution in {"768P", "1080P"} else "480p"
        mode = "image-to-video" if image_url else "text-to-video"
        payload = {
            "prompt": prompt[:12000], "duration_seconds": actual_duration,
            "resolution": actual_resolution, "generate_audio": True, "seed": seed,
        }
        if image_url:
            payload["image_url"] = uploaded_image_url
        elif model == "seedance-2.5-spicy":
            payload["ratio"] = aspect_ratio
        return f"https://api.hotapi.ai/v1/{model}/{mode}", payload, actual_duration, actual_resolution
    raise ValueError("That HotAPI spicy renderer is not supported by this Horde Studio build.")


def generate_hotapi_video(body: dict[str, Any], on_model: Any = None, on_task: Any = None,
                          is_cancelled: Any = None) -> dict[str, Any]:
    key = hotapi_key(body.get("apiKey"))
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("A spicy shot prompt is required.")
    duration = max(5, min(15, int(body.get("duration") or 5)))
    resolution = str(body.get("resolution") or "480P").upper()
    if resolution not in {"480P", "768P", "1080P"}:
        raise ValueError("Video resolution must be 480P, 768P or 1080P.")
    aspect_ratio = str(body.get("aspectRatio") or "16:9")
    if aspect_ratio not in {"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}:
        raise ValueError("Unsupported Video Adventure aspect ratio.")
    seed = int(body.get("seed") or secrets.randbelow(2_000_000_000))
    image_data_url = str(body.get("imageDataUrl") or "").strip()
    if image_data_url and (len(image_data_url) > 12 * 1024 * 1024 or not re.match(
            r"^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", image_data_url, re.I)):
        raise ValueError("The HotAPI continuity frame is invalid or exceeds 12 MB.")
    models: list[str] = []
    requested = body.get("models") if isinstance(body.get("models"), list) else []
    for raw in requested[:4] or ["minimax-h3-spicy"]:
        model = str(raw or "").strip()
        if model in HOTAPI_VIDEO_RENDERERS and model not in models:
            models.append(model)
    if not models:
        raise ValueError("Choose at least one supported HotAPI spicy renderer.")
    uploaded_image_url = ""
    attempts: list[dict[str, str]] = []
    last_error: Any = None
    for model in models:
        if callable(is_cancelled) and is_cancelled():
            raise RuntimeError("HotAPI generation was cancelled.")
        if callable(on_model):
            on_model(model)
        try:
            if image_data_url and model != "minimax-h3-spicy" and not uploaded_image_url:
                uploaded_image_url = hotapi_upload_image(image_data_url, key)
            endpoint, payload, actual_duration, actual_resolution = _hotapi_video_request(
                model, prompt, image_data_url, duration, resolution, aspect_ratio, seed, uploaded_image_url)
            task = hotapi_json_request(endpoint, key, method="POST", payload=payload, timeout=90)
            task_id = str(task.get("id") or "")
            if not task_id:
                raise RuntimeError("HotAPI did not return a task ID.")
            if callable(on_task):
                on_task(task_id)
            deadline = time.monotonic() + 15 * 60
            while time.monotonic() < deadline:
                if callable(is_cancelled) and is_cancelled():
                    try:
                        hotapi_json_request(f"https://api.hotapi.ai/v1/tasks/{urllib.parse.quote(task_id)}", key,
                                            method="DELETE", timeout=30)
                    except Exception:
                        pass
                    raise RuntimeError("HotAPI generation was cancelled.")
                task = hotapi_json_request(f"https://api.hotapi.ai/v1/tasks/{urllib.parse.quote(task_id)}",
                                           key, timeout=45)
                status = str(task.get("status") or "").lower()
                if status == "succeeded":
                    break
                if status in {"failed", "cancelled"}:
                    error = task.get("error") if isinstance(task.get("error"), dict) else {}
                    raise RuntimeError(str(error.get("message") or error.get("code") or f"task {status}"))
                time.sleep(1.2)
            else:
                raise RuntimeError("HotAPI video generation timed out after fifteen minutes.")
            video_url = hotapi_output_video_url(task.get("output"))
            if not video_url:
                raise RuntimeError("HotAPI completed the request without a video URL.")
            media_id = secrets.token_hex(16)
            _, size = download_hotapi_video(video_url, media_id)
            attempts.append({"model": model, "status": "completed"})
            credits = int(task.get("actual_credits_cost") or task.get("estimated_credits_cost") or 0)
            return {
                "ok": True, "provider": "hotapi", "model": model, "requestId": task_id,
                "mediaId": media_id, "mediaUrl": f"/video-world-media/{media_id}.mp4",
                "bytes": size, "duration": actual_duration, "resolution": actual_resolution,
                "seed": seed, "attempts": attempts, "actualCost": credits / 1000,
                "inferenceSeconds": max(0, int(task.get("completed_at") or 0) - int(task.get("started_at") or 0)),
            }
        except Exception as error:
            last_error = error
            attempts.append({"model": model, "status": "failed", "error": str(error)[:300]})
    raise RuntimeError("All configured HotAPI spicy renderers failed. " + " | ".join(
        f"{attempt['model']}: {attempt.get('error', 'failed')}" for attempt in attempts)) from last_error


def _hotapi_video_job_public(job: dict[str, Any]) -> dict[str, Any]:
    return {key: job.get(key) for key in ("jobId", "status", "createdAt", "updatedAt", "result", "error",
                                           "currentModel", "remoteTaskId")}


def submit_hotapi_video_job(body: dict[str, Any]) -> dict[str, Any]:
    key = hotapi_key(body.get("apiKey"))
    job_id = secrets.token_hex(16)
    now = int(time.time() * 1000)
    job = {"jobId": job_id, "status": "queued", "createdAt": now, "updatedAt": now,
           "result": None, "error": "", "currentModel": "", "remoteTaskId": "", "_apiKey": key}
    with HOTAPI_VIDEO_JOBS_LOCK:
        cutoff = now - (24 * 60 * 60 * 1000)
        for stale_id in [key_id for key_id, value in HOTAPI_VIDEO_JOBS.items()
                         if int(value.get("updatedAt") or 0) < cutoff]:
            HOTAPI_VIDEO_JOBS.pop(stale_id, None)
        HOTAPI_VIDEO_JOBS[job_id] = job

    def cancelled() -> bool:
        with HOTAPI_VIDEO_JOBS_LOCK:
            return job["status"] == "cancelled"

    def run() -> None:
        with HOTAPI_VIDEO_JOBS_LOCK:
            if job["status"] == "cancelled":
                return
            job.update(status="running", updatedAt=int(time.time() * 1000))
        try:
            result = generate_hotapi_video(
                body,
                on_model=lambda model: _update_hotapi_job(job, currentModel=model),
                on_task=lambda task_id: _update_hotapi_job(job, remoteTaskId=task_id),
                is_cancelled=cancelled,
            )
            with HOTAPI_VIDEO_JOBS_LOCK:
                if job["status"] == "cancelled":
                    media_id = str(result.get("mediaId") or "")
                    if re.fullmatch(r"[a-f0-9]{32}", media_id):
                        (VIDEO_WORLD_MEDIA_DIR / f"{media_id}.mp4").unlink(missing_ok=True)
                    return
                job.update(status="completed", result=result, updatedAt=int(time.time() * 1000))
        except Exception as error:
            with HOTAPI_VIDEO_JOBS_LOCK:
                if job["status"] != "cancelled":
                    job.update(status="failed", error=str(error), updatedAt=int(time.time() * 1000))

    threading.Thread(target=run, name=f"hotapi-video-{job_id[:8]}", daemon=True).start()
    return _hotapi_video_job_public(job)


def _update_hotapi_job(job: dict[str, Any], **values: Any) -> None:
    with HOTAPI_VIDEO_JOBS_LOCK:
        job.update(**values, updatedAt=int(time.time() * 1000))


def get_hotapi_video_job(job_id: str) -> dict[str, Any]:
    with HOTAPI_VIDEO_JOBS_LOCK:
        job = HOTAPI_VIDEO_JOBS.get(job_id)
        if not job:
            raise KeyError("Spicy video job was not found. The local bridge may have restarted.")
        return _hotapi_video_job_public(job)


def cancel_hotapi_video_job(job_id: str) -> dict[str, Any]:
    remote_task_id = ""
    key = ""
    with HOTAPI_VIDEO_JOBS_LOCK:
        job = HOTAPI_VIDEO_JOBS.get(job_id)
        if not job:
            raise KeyError("Spicy video job was not found.")
        if job["status"] in {"queued", "running"}:
            remote_task_id = str(job.get("remoteTaskId") or "")
            key = str(job.get("_apiKey") or "")
            job.update(status="cancelled", updatedAt=int(time.time() * 1000),
                       error="Cancelled locally. HotAPI refunds only if upstream work has not started.")
        result = _hotapi_video_job_public(job)
    if remote_task_id and key:
        try:
            hotapi_json_request(f"https://api.hotapi.ai/v1/tasks/{urllib.parse.quote(remote_task_id)}",
                                key, method="DELETE", timeout=30)
        except Exception:
            pass
    return result


def test_hotapi_connection(body: dict[str, Any]) -> dict[str, Any]:
    key = hotapi_key(body.get("apiKey"))
    data = hotapi_json_request("https://api.hotapi.ai/v1/models?limit=100", key, timeout=25)
    models = data.get("data") if isinstance(data.get("data"), list) else data.get("models")
    return {"ok": True, "provider": "hotapi", "modelsVisible": len(models) if isinstance(models, list) else 0}


def loopback_base_url(value: Any, default_port: int) -> str:
    """Validate a user-configured image server on this device or its private LAN.

    The bridge deliberately refuses public hosts so these endpoints cannot turn it
    into a general-purpose server-side request proxy.  Private address literals
    are allowed because ComfyUI is commonly hosted on a second machine on the
    user's home network.
    """
    candidate = str(value or f"http://127.0.0.1:{default_port}").strip().rstrip("/")
    parsed = urllib.parse.urlparse(candidate)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if (
        parsed.scheme not in {"http", "https"}
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Local image endpoints must be credential-free HTTP(S) URLs without a query or fragment.")
    if hostname != "localhost":
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError as error:
            raise ValueError(
                "Local image endpoints must use localhost or a literal private LAN IP address."
            ) from error
        local_networks = (
            ipaddress.ip_network("10.0.0.0/8"),
            ipaddress.ip_network("172.16.0.0/12"),
            ipaddress.ip_network("192.168.0.0/16"),
            ipaddress.ip_network("127.0.0.0/8"),
            ipaddress.ip_network("fc00::/7"),
            ipaddress.ip_network("::1/128"),
        )
        if not any(address.version == network.version and address in network for network in local_networks):
            raise ValueError(
                "Local image endpoints must use localhost or a private LAN IP such as 192.168.x.x."
            )
        if address.is_unspecified or address.is_multicast:
            raise ValueError("Local image endpoints cannot use an unspecified or multicast address.")
    return candidate


def multipart_image(data_url: str, filename: str = "horde-reference.png") -> tuple[bytes, str]:
    match = re.match(r"^data:([^;,]+);base64,([\s\S]+)$", str(data_url or ""), re.I)
    if not match:
        raise ValueError("ComfyUI references must be base64 data images.")
    image = base64.b64decode(match.group(2), validate=False)
    boundary = "----HordeStudio" + secrets.token_hex(12)
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {match.group(1)}\r\n\r\n".encode() + image,
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue".encode(),
        f"--{boundary}--".encode(),
    ]
    return b"\r\n".join(parts) + b"\r\n", boundary


def set_workflow_input(workflow: dict[str, Any], node_id: str, input_name: str, value: Any) -> bool:
    node = workflow.get(str(node_id))
    if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
        return False
    node["inputs"][input_name] = value
    return True


def detect_workflow_input(workflow: dict[str, Any], class_names: set[str], input_names: list[str]) -> tuple[str, str]:
    for allow_negative in (False, True):
        for node_id, node in workflow.items():
            if not isinstance(node, dict) or str(node.get("class_type", "")) not in class_names:
                continue
            title = str((node.get("_meta") or {}).get("title", "")).lower()
            if not allow_negative and "negative" in title:
                continue
            inputs = node.get("inputs")
            if not isinstance(inputs, dict):
                continue
            for name in input_names:
                if name in inputs:
                    return str(node_id), name
    return "", ""


def comfy_generate(body: dict[str, Any]) -> str:
    base = loopback_base_url(body.get("baseUrl"), 8188)
    workflow = body.get("workflow")
    if not isinstance(workflow, dict) or not workflow:
        raise ValueError("Paste a ComfyUI workflow saved in API format.")
    workflow = json.loads(json.dumps(workflow))
    prompt = str(body.get("prompt") or "").strip()
    mapping = body.get("mapping") if isinstance(body.get("mapping"), dict) else {}
    prompt_node = str(mapping.get("promptNode") or "")
    prompt_input = str(mapping.get("promptInput") or "text")
    if not prompt_node:
        prompt_node, prompt_input = detect_workflow_input(
            workflow, {"CLIPTextEncode", "CLIPTextEncodeSDXL", "PrimitiveString"}, ["text", "value"]
        )
    if not prompt_node or not set_workflow_input(workflow, prompt_node, prompt_input, prompt):
        raise ValueError("Could not find the positive-prompt input. Configure its node ID and input name.")

    seed_node = str(mapping.get("seedNode") or "")
    seed_input = str(mapping.get("seedInput") or "seed")
    if not seed_node:
        seed_node, seed_input = detect_workflow_input(
            workflow, {"KSampler", "KSamplerAdvanced", "RandomNoise"}, ["seed", "noise_seed"]
        )
    if seed_node:
        set_workflow_input(workflow, seed_node, seed_input, int(body.get("seed") or secrets.randbelow(2**31)))

    reference = str(body.get("reference") or "")
    reference_node = str(mapping.get("referenceNode") or "")
    reference_input = str(mapping.get("referenceInput") or "image")
    if reference and reference_node:
        upload, boundary = multipart_image(reference)
        status, _, raw = http_request(
            base + "/upload/image", "POST",
            {"Accept": "application/json", "Content-Type": f"multipart/form-data; boundary={boundary}"},
            upload, 120,
        )
        uploaded = json.loads(raw.decode("utf-8")) if raw else {}
        if not 200 <= status < 300 or not uploaded.get("name"):
            raise RuntimeError(f"ComfyUI reference upload failed ({status}).")
        if not set_workflow_input(workflow, reference_node, reference_input, uploaded["name"]):
            raise ValueError("The configured ComfyUI reference node/input does not exist.")

    status, _, result = json_request(base + "/prompt", "POST", payload={"prompt": workflow}, timeout=60)
    if not 200 <= status < 300 or not result.get("prompt_id"):
        detail = result.get("error") or result.get("node_errors") or result
        raise RuntimeError(f"ComfyUI rejected the workflow: {detail}")
    prompt_id = str(result["prompt_id"])
    deadline = time.time() + 330
    while time.time() < deadline:
        time.sleep(0.75)
        history_status, _, history = json_request(
            base + "/history/" + urllib.parse.quote(prompt_id), timeout=30
        )
        if not 200 <= history_status < 300:
            continue
        job = history.get(prompt_id) if isinstance(history, dict) else None
        outputs = job.get("outputs") if isinstance(job, dict) else None
        if not isinstance(outputs, dict):
            continue
        for output in outputs.values():
            for image in (output.get("images") if isinstance(output, dict) else []) or []:
                if not isinstance(image, dict) or not image.get("filename"):
                    continue
                query = urllib.parse.urlencode({
                    "filename": image["filename"],
                    "subfolder": image.get("subfolder", ""),
                    "type": image.get("type", "output"),
                })
                return download_image(base + "/view?" + query)
        status_info = job.get("status") if isinstance(job, dict) else {}
        if isinstance(status_info, dict) and status_info.get("status_str") == "error":
            raise RuntimeError("ComfyUI workflow execution failed. Check its terminal for the failing node.")
    raise TimeoutError("ComfyUI generation timed out after 330 seconds.")


def openai_local_generate(body: dict[str, Any]) -> str:
    base = loopback_base_url(body.get("baseUrl"), 7860)
    path = "/" + str(body.get("path") or "images/generations").strip().lstrip("/")
    payload = body.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Local image request payload is missing.")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    key = str(body.get("apiKey") or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    status, _, result = json_request(base + path, "POST", headers, payload, 330)
    if not 200 <= status < 300:
        message = result.get("error") or result.get("message") or result
        raise RuntimeError(f"Local image server rejected the request ({status}): {message}")
    item = (result.get("data") or [{}])[0] if isinstance(result.get("data"), list) else {}
    url = item.get("url") if isinstance(item, dict) else ""
    encoded = item.get("b64_json") if isinstance(item, dict) else ""
    if encoded:
        return f"data:image/png;base64,{encoded}"
    if isinstance(url, str) and url.startswith("data:image/"):
        return url
    if isinstance(url, str) and re.match(r"^https?://", url):
        return download_image(url)
    raise RuntimeError("The local image server returned no image.")


def provider_status(provider_id: str, verify: bool = False) -> dict[str, Any]:
    record = provider_record(provider_id)
    connected = bool((record.get("tokens") or {}).get("access_token"))
    status = {
        "id": provider_id,
        "label": PROVIDERS[provider_id]["label"],
        "endpoint": PROVIDERS[provider_id]["endpoint"],
        "docs": PROVIDERS[provider_id]["docs"],
        "connected": connected,
        "connectedAt": record.get("connectedAt", 0),
    }
    if verify and connected:
        tools = list_tools(provider_id)
        status["toolCount"] = len(tools)
    return status


class MultiplayerHandler(BaseHTTPRequestHandler):
    """Restricted LAN surface: app assets plus authenticated room messages."""

    server_version = "HordeMultiplayer/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[party] {self.address_string()} {fmt % args}")

    def respond(self, status: int, payload: Any, content_type: str = "application/json") -> None:
        raw = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self) -> dict[str, Any]:
        declared = int(self.headers.get("Content-Length", "0") or 0)
        if declared > 2 * 1024 * 1024:
            raise ValueError("Multiplayer request exceeds the 2 MB safety limit.")
        raw = self.rfile.read(declared)
        value = json.loads(raw.decode()) if raw else {}
        if not isinstance(value, dict):
            raise ValueError("Request body must be a JSON object.")
        return value

    def serve_app_file(self, path: str) -> bool:
        entry = STATIC_FILES.get(path) or STATIC_FILES.get(
            urllib.parse.quote(urllib.parse.unquote(path), safe="/"))
        if entry:
            filename, content_type = entry
            target = APP_DIR / filename
        else:
            decoded = urllib.parse.unquote(path)
            target, content_type = None, "application/octet-stream"
            for url_prefix, root in STATIC_MEDIA_ROOTS:
                if not decoded.startswith(url_prefix):
                    continue
                candidate = (root / decoded[len(url_prefix):].lstrip("/")).resolve()
                try:
                    candidate.relative_to(root.resolve())
                except ValueError:
                    self.respond(403, {"error": "Invalid public asset path."})
                    return True
                target = candidate
                content_type = mimetypes.guess_type(candidate.name)[0] or content_type
                break
            if target is None:
                return False
        try:
            raw = target.read_bytes()
        except OSError:
            self.respond(404, {"error": "Application asset not found."})
            return True
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)
        return True

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/multiplayer/health":
                return self.respond(200, {"ok": True, "service": "Horde Studio Multiplayer",
                                          "rooms": len(multiplayer_runtime.rooms)})
            if parsed.path == "/multiplayer/state":
                query = urllib.parse.parse_qs(parsed.query)
                body = {key: values[0] for key, values in query.items() if values}
                return self.respond(200, multiplayer_runtime.state(body))
            if self.serve_app_file(parsed.path):
                return
            return self.respond(404, {"error": "Unknown multiplayer endpoint."})
        except PermissionError as error:
            self.respond(401, {"error": str(error)})
        except (KeyError, ValueError) as error:
            self.respond(400, {"error": str(error)})
        except Exception as error:
            self.respond(500, {"error": str(error)})

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            body = self.read_json()
            routes = {
                "/multiplayer/join": multiplayer_runtime.join,
                "/multiplayer/state": multiplayer_runtime.state,
                "/multiplayer/submit": multiplayer_runtime.submit,
                "/multiplayer/propose": multiplayer_runtime.propose,
                "/multiplayer/vote": multiplayer_runtime.vote,
                "/multiplayer/sheet": multiplayer_runtime.update_sheet,
                "/multiplayer/roll": multiplayer_runtime.roll,
            }
            if parsed.path in routes:
                return self.respond(200, routes[parsed.path](body))
            return self.respond(404, {"error": "This LAN endpoint is not available to guests."})
        except PermissionError as error:
            self.respond(401, {"error": str(error)})
        except (KeyError, ValueError) as error:
            self.respond(400, {"error": str(error)})
        except Exception as error:
            self.respond(500, {"error": str(error)})


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "HordeMCPBridge/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[bridge] {self.address_string()} {fmt % args}")

    def origin_allowed(self) -> bool:
        origin = self.headers.get("Origin", "")
        if not origin:
            return True
        try:
            parsed = urllib.parse.urlparse(origin)
            hostname = parsed.hostname or ""
            if hostname in {"localhost", "127.0.0.1", "::1"}:
                return True
            if hostname.startswith("10.") or hostname.startswith("172.16.") or hostname.startswith("192.168."):
                return True
            return False
        except ValueError:
            return False

    def client_is_loopback(self) -> bool:
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    def cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin and self.origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def respond(self, status: int, payload: Any, content_type: str = "application/json") -> None:
        raw = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
        self.respond_bytes(status, raw, content_type)

    def respond_bytes(self, status: int, raw: bytes, content_type: str) -> None:
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def serve_video_file(self, target: Path) -> None:
        try:
            size = target.stat().st_size
        except OSError:
            self.respond(404, {"error": "Video Adventure clip not found."})
            return
        start, end, status = 0, max(0, size - 1), 200
        requested = str(self.headers.get("Range") or "")
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested.strip()) if requested else None
        if match:
            if match.group(1):
                start = int(match.group(1))
                end = min(end, int(match.group(2))) if match.group(2) else end
            elif match.group(2):
                suffix = min(size, int(match.group(2)))
                start = size - suffix
            if start >= size or end < start:
                self.send_response(416)
                self.cors()
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            status = 206
        length = max(0, end - start + 1)
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "private, max-age=3600")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with target.open("rb") as source:
                source.seek(start)
                remaining = length
                while remaining:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def serve_app_file(self, path: str) -> bool:
        entry = STATIC_FILES.get(path) or STATIC_FILES.get(urllib.parse.quote(urllib.parse.unquote(path), safe="/"))
        if entry:
            filename, content_type = entry
            target = APP_DIR / filename
        else:
            decoded = urllib.parse.unquote(path)
            target = None
            content_type = "application/octet-stream"
            if decoded.startswith("/video-world-media/"):
                filename = decoded[len("/video-world-media/"):]
                if not re.fullmatch(r"[a-f0-9]{32}\.mp4", filename):
                    self.respond(403, {"error": "Invalid Video Adventure media path."})
                    return True
                target = VIDEO_WORLD_MEDIA_DIR / filename
                content_type = "video/mp4"
            for url_prefix, root in STATIC_MEDIA_ROOTS:
                if target is not None:
                    break
                if not decoded.startswith(url_prefix):
                    continue
                relative = decoded[len(url_prefix):].lstrip("/")
                candidate = (root / relative).resolve()
                try:
                    candidate.relative_to(root.resolve())
                except ValueError:
                    self.respond(403, {"error": "Static media path is outside the public asset tree."})
                    return True
                target = candidate
                content_type = mimetypes.guess_type(candidate.name)[0] or content_type
                break
            if target is None:
                return False
        try:
            if content_type == "video/mp4" and target.parent == VIDEO_WORLD_MEDIA_DIR:
                self.serve_video_file(target)
                return True
            raw = target.read_bytes()
        except OSError:
            self.respond(404, {"error": "Application asset not found."})
            return True
        self.respond_bytes(200, raw, content_type)
        return True

    def read_json(self) -> dict[str, Any]:
        declared = int(self.headers.get("Content-Length", "0") or 0)
        if declared > 30 * 1024 * 1024:
            raise ValueError("Request body exceeds the 30 MB safety limit.")
        length = min(declared, 30 * 1024 * 1024)
        raw = self.rfile.read(length)
        value = json.loads(raw.decode()) if raw else {}
        if not isinstance(value, dict):
            raise ValueError("Request body must be a JSON object.")
        return value

    def provider_from_path(self) -> tuple[str, str]:
        match = re.match(r"^/providers/([^/]+)(?:/(.*))?$", urllib.parse.urlparse(self.path).path)
        if not match or match.group(1) not in PROVIDERS:
            raise KeyError("Unknown MCP provider.")
        return match.group(1), match.group(2) or ""

    def do_OPTIONS(self) -> None:
        if not self.origin_allowed():
            return self.respond(403, {"error": "Origin not allowed."})
        self.respond(204, {})

    def do_GET(self) -> None:
        if not self.origin_allowed():
            return self.respond(403, {"error": "Origin not allowed."})
        parsed = urllib.parse.urlparse(self.path)
        try:
            if self.serve_app_file(parsed.path):
                return
            if parsed.path == "/health":
                return self.respond(200, {"ok": True, "service": "Horde Studio MCP Bridge", "version": 2,
                                          "build": BRIDGE_BUILD, "appInstance": APP_INSTANCE_ID,
                                          "alwaysOn": always_on_runtime.status(),
                                          "multiplayer": {"running": bool(multiplayer_runtime.server),
                                                          "port": multiplayer_runtime.port,
                                                          "rooms": len(multiplayer_runtime.rooms)}})
            if parsed.path == "/multiplayer/state":
                query = urllib.parse.parse_qs(parsed.query)
                body = {key: values[0] for key, values in query.items() if values}
                return self.respond(200, multiplayer_runtime.state(body))
            if parsed.path == "/always-on/status":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Always-on control is loopback-only."})
                return self.respond(200, always_on_runtime.status())
            job_match = re.fullmatch(r"/fal/video/jobs/([a-f0-9]{32})", parsed.path)
            if job_match:
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Video Adventure generation is loopback-only."})
                return self.respond(200, get_fal_video_job(job_match.group(1)))
            hotapi_job_match = re.fullmatch(r"/hotapi/video/jobs/([a-f0-9]{32})", parsed.path)
            if hotapi_job_match:
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Spicy Video Adventure generation is loopback-only."})
                return self.respond(200, get_hotapi_video_job(hotapi_job_match.group(1)))
            if parsed.path == "/providers":
                return self.respond(200, {"providers": [provider_status(key) for key in PROVIDERS]})
            if parsed.path == "/oauth/callback":
                params = urllib.parse.parse_qs(parsed.query)
                if params.get("error"):
                    raise RuntimeError(params.get("error_description", params["error"])[0])
                provider_id = exchange_code(params.get("state", [""])[0], params.get("code", [""])[0])
                html = f"""<!doctype html><meta charset="utf-8"><title>Connected</title>
                <style>body{{font:16px system-ui;background:#0d0d14;color:#eee;display:grid;place-items:center;height:100vh;margin:0}}
                div{{max-width:520px;padding:32px;border:1px solid #343445;border-radius:16px;background:#171722}}b{{color:#49d17d}}</style>
                <div><b>{PROVIDERS[provider_id]['label']} connected.</b><p>You can close this window and return to Horde Studio.</p></div>"""
                return self.respond(200, html, "text/html")
            provider_id, action = self.provider_from_path()
            if action == "status":
                return self.respond(200, provider_status(provider_id, verify=False))
            if action == "tools":
                tools = list_tools(provider_id)
                return self.respond(200, {"provider": provider_id, "tools": tools})
            return self.respond(404, {"error": "Unknown bridge endpoint."})
        except PermissionError as error:
            self.respond(401, {"error": str(error), "needsAuth": True})
        except Exception as error:
            self.respond(500, {"error": str(error)})

    def do_POST(self) -> None:
        if not self.origin_allowed():
            return self.respond(403, {"error": "Origin not allowed."})
        try:
            parsed_path = urllib.parse.urlparse(self.path).path
            if parsed_path == "/shutdown":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Server shutdown is loopback-only."})
                always_on_runtime.stop()
                multiplayer_runtime.shutdown()
                self.respond(200, {"ok": True, "stopping": True})
                # Finish the HTTP response before ending serve_forever so the
                # browser can show an intentional stopped state, not a network
                # failure. This does not delete settings, saves or model caches.
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if parsed_path == "/multiplayer/rooms":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Only the host device can create a room."})
                return self.respond(200, multiplayer_runtime.create_room(self.read_json()))
            if parsed_path in {"/multiplayer/join", "/multiplayer/state", "/multiplayer/submit", "/multiplayer/propose",
                               "/multiplayer/vote", "/multiplayer/commit", "/multiplayer/resolve",
                               "/multiplayer/close", "/multiplayer/sheet", "/multiplayer/roll", "/multiplayer/gm"}:
                body = self.read_json()
                host_only = parsed_path in {"/multiplayer/commit", "/multiplayer/resolve", "/multiplayer/close", "/multiplayer/gm"}
                if host_only and not self.client_is_loopback():
                    return self.respond(403, {"error": "Host control is loopback-only."})
                if parsed_path == "/multiplayer/join":
                    result = multiplayer_runtime.join(body)
                elif parsed_path == "/multiplayer/state":
                    result = multiplayer_runtime.state(body)
                elif parsed_path == "/multiplayer/submit":
                    result = multiplayer_runtime.submit(body)
                elif parsed_path == "/multiplayer/propose":
                    result = multiplayer_runtime.propose(body)
                elif parsed_path == "/multiplayer/vote":
                    result = multiplayer_runtime.vote(body)
                elif parsed_path == "/multiplayer/sheet":
                    result = multiplayer_runtime.update_sheet(body)
                elif parsed_path == "/multiplayer/roll":
                    result = multiplayer_runtime.roll(body)
                elif parsed_path == "/multiplayer/gm":
                    result = multiplayer_runtime.gm_update(body)
                elif parsed_path == "/multiplayer/commit":
                    result = multiplayer_runtime.commit(body)
                elif parsed_path == "/multiplayer/resolve":
                    result = multiplayer_runtime.resolve_proposal(body, body.get("snapshot"))
                else:
                    result = multiplayer_runtime.close_room(body)
                return self.respond(200, result)
            if parsed_path.startswith("/always-on/") and not self.client_is_loopback():
                return self.respond(403, {"error": "Always-on control is loopback-only."})
            if parsed_path == "/always-on/sync":
                return self.respond(200, always_on_runtime.sync(self.read_json()))
            if parsed_path == "/always-on/events":
                body = self.read_json()
                return self.respond(200, {"events": always_on_runtime.pending_events(str(body.get("clientId") or ""))})
            if parsed_path == "/always-on/ack":
                body = self.read_json()
                ids = body.get("eventIds") if isinstance(body.get("eventIds"), list) else []
                return self.respond(200, always_on_runtime.acknowledge(ids))
            if parsed_path == "/always-on/pause":
                body = self.read_json()
                return self.respond(200, always_on_runtime.pause(str(body.get("reason") or "paused by user")))
            if parsed_path == "/always-on/stop":
                return self.respond(200, always_on_runtime.stop())
            if parsed_path == "/local-image/comfy/generate":
                body = self.read_json()
                return self.respond(200, {"image": comfy_generate(body)})
            if parsed_path == "/local-image/openai/generate":
                body = self.read_json()
                return self.respond(200, {"image": openai_local_generate(body)})
            if parsed_path == "/fal/video/generate":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Video Adventure generation is loopback-only."})
                return self.respond(200, generate_fal_video(self.read_json()))
            if parsed_path == "/fal/image/generate":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Fal image generation is loopback-only."})
                return self.respond(200, generate_fal_image(self.read_json()))
            if parsed_path == "/fal/video/jobs":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Video Adventure generation is loopback-only."})
                return self.respond(202, submit_fal_video_job(self.read_json()))
            cancel_match = re.fullmatch(r"/fal/video/jobs/([a-f0-9]{32})/cancel", parsed_path)
            if cancel_match:
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Video Adventure generation is loopback-only."})
                return self.respond(200, cancel_fal_video_job(cancel_match.group(1)))
            if parsed_path == "/fal/video/test":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Fal connection testing is loopback-only."})
                return self.respond(200, test_fal_connection(self.read_json()))
            if parsed_path == "/fal/video/delete":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Video Adventure media deletion is loopback-only."})
                return self.respond(200, delete_fal_videos(self.read_json()))
            if parsed_path == "/hotapi/video/jobs":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Spicy Video Adventure generation is loopback-only."})
                return self.respond(202, submit_hotapi_video_job(self.read_json()))
            hotapi_cancel_match = re.fullmatch(r"/hotapi/video/jobs/([a-f0-9]{32})/cancel", parsed_path)
            if hotapi_cancel_match:
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "Spicy Video Adventure generation is loopback-only."})
                return self.respond(200, cancel_hotapi_video_job(hotapi_cancel_match.group(1)))
            if parsed_path == "/hotapi/video/test":
                if not self.client_is_loopback():
                    return self.respond(403, {"error": "HotAPI connection testing is loopback-only."})
                return self.respond(200, test_hotapi_connection(self.read_json()))
            if parsed_path == "/media/fetch":
                body = self.read_json()
                return self.respond(200, {"image": download_image(safe_remote_image_url(body.get("url")))})
            if parsed_path == "/local-image/status":
                body = self.read_json()
                comfy_base = loopback_base_url(body.get("comfyBaseUrl"), 8188)
                image_base = loopback_base_url(body.get("imageBaseUrl"), 7860)
                try:
                    comfy_status, _, _ = http_request(comfy_base + "/system_stats", timeout=8)
                    comfy_error = ""
                except Exception as error:
                    comfy_status, comfy_error = 0, str(error)
                image_headers = {"Accept": "application/json"}
                if str(body.get("imageApiKey") or "").strip():
                    image_headers["Authorization"] = f"Bearer {str(body['imageApiKey']).strip()}"
                try:
                    image_status, _, _ = http_request(image_base + "/models", headers=image_headers, timeout=8)
                    image_error = ""
                except Exception as error:
                    image_status, image_error = 0, str(error)
                return self.respond(200, {
                    "comfy": 200 <= comfy_status < 300,
                    "comfyStatus": comfy_status,
                    "comfyError": comfy_error,
                    "openaiImage": 200 <= image_status < 300,
                    "openaiImageStatus": image_status,
                    "openaiImageError": image_error,
                })
            provider_id, action = self.provider_from_path()
            body = self.read_json()
            if action == "connect":
                if provider_status(provider_id)["connected"]:
                    try:
                        tools = list_tools(provider_id)
                        return self.respond(200, {"connected": True, "toolCount": len(tools)})
                    except Exception:
                        update_provider_record(provider_id, {"tokens": {}})
                        mcp_sessions.pop(provider_id, None)
                return self.respond(200, {"connected": False, "authUrl": begin_oauth(provider_id)})
            if action == "disconnect":
                update_provider_record(provider_id, None)
                mcp_sessions.pop(provider_id, None)
                return self.respond(200, {"connected": False})
            if action in {"call", "generate"}:
                tool = str(body.get("tool") or "").strip()
                arguments = body.get("arguments")
                if not tool or not isinstance(arguments, dict):
                    return self.respond(400, {"error": "tool and arguments are required."})
                result = call_tool(provider_id, tool, arguments)
                if action == "generate":
                    image, source = result_image(result)
                    return self.respond(200, {"image": image, "source": source})
                return self.respond(200, {"result": result})
            return self.respond(404, {"error": "Unknown bridge endpoint."})
        except PermissionError as error:
            self.respond(401, {"error": str(error), "needsAuth": True})
        except (KeyError, ValueError) as error:
            self.respond(400, {"error": str(error)})
        except Exception as error:
            self.respond(500, {"error": str(error)})


def main() -> None:
    configured_port = PORT
    select_runtime_port(configured_port)
    app_url = f"http://{HOST}:{PORT}/"
    try:
        server = ThreadingHTTPServer((LISTEN_HOST, PORT), BridgeHandler)
    except OSError as error:
        if error.errno not in {errno.EADDRINUSE, 48, 98, 10048}:
            raise
        try:
            status, _, raw = http_request(app_url + "health", timeout=3)
            health = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            health, status = {}, 0
        is_horde_bridge = status == 200 and health.get("service") == "Horde Studio MCP Bridge"
        same_release = is_horde_bridge \
            and health.get("appInstance") == APP_INSTANCE_ID \
            and health.get("build") == BRIDGE_BUILD
        if same_release:
            print(f"This Horde Studio release is already running on {app_url}")
            if "--open" in sys.argv:
                import webbrowser
                webbrowser.open(app_url)
            return
        if not is_horde_bridge:
            raise RuntimeError(
                f"Horde Studio must use its stable storage address {app_url}, but another application owns that port. "
                "Close that application or set HORDE_SERVER_PORT to one fixed alternative port."
            ) from error
        # Portable releases used to move to the next free port when an older
        # copy was running. Browser databases are origin-scoped, so that looked
        # exactly like every World had reset. Replace the old local bridge and
        # keep the stable origin instead.
        status, _, _ = http_request(app_url + "shutdown", method="POST", body=b"{}", timeout=3)
        if status != 200:
            raise RuntimeError(f"Could not stop the older Horde Studio process on {app_url}.") from error
        deadline = time.time() + 5
        while True:
            try:
                server = ThreadingHTTPServer((LISTEN_HOST, PORT), BridgeHandler)
                break
            except OSError as retry_error:
                if time.time() >= deadline:
                    raise RuntimeError(
                        f"The older Horde Studio process did not release {app_url}. Close it and launch again."
                    ) from retry_error
                time.sleep(0.1)
    app_url = f"http://{HOST}:{PORT}/"
    listen_info = f"{LISTEN_HOST}:{PORT}" if LISTEN_HOST != HOST else str(PORT)
    print(f"Horde Studio bridge listening on {listen_info}")
    print(f"Open in browser: {app_url}")
    print(f"OAuth callback: {CALLBACK_URL}")
    print(f"Credentials: {AUTH_FILE} (owner-only)")
    if "--open" in sys.argv:
        import webbrowser
        threading.Timer(0.45, lambda: webbrowser.open(app_url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Horde Studio…")
    finally:
        always_on_runtime.stop()
        multiplayer_runtime.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
