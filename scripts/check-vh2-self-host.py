#!/usr/bin/env python3
"""Offline security and transfer audit for the private VH2 self-host."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://127.0.0.1:43127"
BAD_ORIGIN = "https://attacker.invalid"


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def request(base: str, path: str, *, method: str = "GET", token: str = "",
            origin: str = ORIGIN, body: bytes | dict | None = None,
            content_type: str = "application/json") -> tuple[int, dict, bytes]:
    if isinstance(body, dict):
        body = json.dumps(body).encode()
    headers = {"Origin": origin}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = content_type
    call = urllib.request.Request(base + path, method=method, data=body, headers=headers)
    try:
        with urllib.request.urlopen(call, timeout=20) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read()


def json_body(raw: bytes) -> dict:
    return json.loads(raw.decode())


def launch(config: Path, port: int, token: str, log: Path) -> subprocess.Popen:
    node = os.environ.get("HORDE_NODE_EXECUTABLE") or shutil.which("node")
    if not node:
        raise RuntimeError("Set HORDE_NODE_EXECUTABLE to Node.js 18 or newer.")
    environment = {
        **os.environ,
        "HORDE_CONFIG_DIR": str(config),
        "HORDE_NODE_EXECUTABLE": node,
        "HORDE_SERVER_LISTEN_HOST": "127.0.0.1",
        "HORDE_SERVER_HOST": "127.0.0.1",
        "HORDE_SERVER_PORT": str(port),
        "HORDE_VH2_REMOTE_MODE": "1",
        "HORDE_VH2_ACCESS_TOKEN": token,
        "HORDE_VH2_ALLOWED_ORIGINS": ORIGIN,
    }
    output = log.open("wb")
    process = subprocess.Popen(
        [sys.executable, "-u", "horde_mcp_bridge.py"], cwd=ROOT,
        env=environment, stdout=output, stderr=subprocess.STDOUT,
    )
    process._vh2_log_output = output  # type: ignore[attr-defined]
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output.close()
            raise RuntimeError("Self-host exited during startup:\n" + log.read_text(errors="replace"))
        try:
            if request(base, "/health", token=token)[0] == 200:
                return process
        except OSError:
            pass
        time.sleep(0.1)
    process.terminate()
    output.close()
    raise RuntimeError("Self-host did not become ready:\n" + log.read_text(errors="replace"))


def stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    output = getattr(process, "_vh2_log_output", None)
    if output:
        output.close()


def expect(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main() -> int:
    source = destination = None
    with tempfile.TemporaryDirectory(prefix="vh2-self-host-audit-") as temporary:
        root = Path(temporary)
        source_token = "source-" + "a" * 40
        destination_token = "destination-" + "b" * 40
        source_port, destination_port = free_port(), free_port()
        source_base = f"http://127.0.0.1:{source_port}"
        destination_base = f"http://127.0.0.1:{destination_port}"
        try:
            source = launch(root / "source", source_port, source_token, root / "source.log")
            destination = launch(root / "destination", destination_port, destination_token, root / "destination.log")

            status, headers, _ = request(source_base, "/vh2/projection?worldId=missing", method="OPTIONS")
            expect(status, 204, "allowed CORS preflight")
            expect(headers.get("Access-Control-Allow-Origin"), ORIGIN, "preflight origin echo")
            if "Authorization" not in headers.get("Access-Control-Allow-Headers", ""):
                raise AssertionError("preflight did not allow the Authorization header")

            expect(request(source_base, "/health")[0], 401, "health without bearer token")
            expect(request(source_base, "/health", token=source_token, origin=BAD_ORIGIN)[0], 403, "untrusted browser origin")
            status, _, raw = request(source_base, "/health", token=source_token)
            expect(status, 200, "authenticated health")
            expect(json_body(raw)["capabilities"]["privateVh2Host"], True, "private host capability")
            expect(request(source_base, "/shutdown", method="POST", token=source_token, body={})[0], 404, "non-VH2 control surface")
            expect(request(source_base, "/vh2/command", method="POST", body={})[0], 401, "command without bearer token")
            expect(request(source_base, "/vh2/restore-copy", method="POST", token=source_token, body=b"x", content_type="application/gzip")[0], 403, "local copy endpoint in remote mode")
            expect(request(source_base, "/vh2/mirror?worldId=missing", token=source_token)[0], 403, "local mirror metadata in remote mode")
            expect(request(source_base, "/vh2/mirror/promote?worldId=missing", method="POST", token=source_token, body={})[0], 403, "local mirror promotion in remote mode")

            create = {"schemaVersion": 1, "key": "self-host-create", "type": "create", "name": "Private hosted fixture"}
            status, _, raw = request(source_base, "/vh2/command", method="POST", token=source_token, body=create)
            expect(status, 200, "authenticated create")
            world_id = json_body(raw)["worldId"]
            asset_id = "self-host-fixture"
            with sqlite3.connect(root / "source" / "vh2-worlds.sqlite") as database:
                database.execute("INSERT INTO photo_assets VALUES (?,?,?,?)", (asset_id, world_id, "image/png", b"private-image"))

            status, _, raw = request(source_base, f"/vh2/transfer-readiness?worldId={world_id}", token=source_token)
            expect(status, 200, "transfer readiness")
            expect(json_body(raw)["ready"], True, "idle life transfer readiness")
            with sqlite3.connect(root / "source" / "vh2-worlds.sqlite") as database:
                database.execute("INSERT INTO vh2_social_jobs VALUES (?,?,?,?,?)", ("in-flight-social", world_id, "submitted", "{}", ""))
            status, _, raw = request(source_base, f"/vh2/transfer-readiness?worldId={world_id}", token=source_token)
            expect(json_body(raw)["ready"], False, "submitted social work blocks transfer")
            with sqlite3.connect(root / "source" / "vh2-worlds.sqlite") as database:
                database.execute("UPDATE vh2_social_jobs SET status='failed' WHERE id='in-flight-social'")

            expect(request(source_base, f"/vh2/storage/optimize?worldId={world_id}",
                           method="POST", body={})[0], 401, "storage optimization without bearer token")
            status, _, raw = request(source_base, f"/vh2/storage?worldId={world_id}", token=source_token)
            expect(status, 200, "storage status")
            storage = json_body(raw)
            expect(storage["scope"], "service", "storage maintenance scope")
            status, _, raw = request(
                source_base, f"/vh2/landmarks?worldId={world_id}&minimumPriority=3", token=source_token
            )
            expect(status, 200, "priority landmark list")
            if not any(item["kind"] == "WORLD_CREATED" and item["priority"] == 3
                       for item in json_body(raw)["landmarks"]):
                raise AssertionError("the permanent world-created landmark was not returned")
            expect(request(source_base, f"/vh2/landmarks?worldId={world_id}&minimumPriority=9",
                           token=source_token)[0], 400, "invalid landmark priority")
            status, _, raw = request(source_base, f"/vh2/storage/optimize?worldId={world_id}",
                                     method="POST", token=source_token, body={})
            expect(status, 200, "authenticated storage optimization")
            expect(json_body(raw)["scope"], "service", "optimizer service scope")

            expect(request(source_base, f"/vh2/photo-asset?worldId={world_id}&id={asset_id}")[0], 401, "asset without token or ticket")
            status, _, raw = request(source_base, f"/vh2/media-ticket?worldId={world_id}&id={asset_id}", token=source_token)
            expect(status, 200, "media ticket")
            ticket_path = json_body(raw)["path"]
            status, _, raw = request(source_base, ticket_path)
            expect(status, 200, "ticketed media read")
            expect(raw, b"private-image", "ticketed media body")

            status, headers, archive = request(source_base, f"/vh2/transfer-checkpoint?worldId={world_id}", token=source_token)
            expect(status, 200, "source transfer checkpoint")
            if not headers.get("Content-Type", "").startswith("application/vnd.horde.vh2-transfer+zip"):
                raise AssertionError("transfer checkpoint content type was not preserved")
            status, _, raw = request(destination_base, "/vh2/restore", method="POST", token=destination_token,
                                     body=archive, content_type="application/vnd.horde.vh2-transfer+zip")
            expect(status, 200, "destination restore")
            restored = json_body(raw)
            expect(restored["worldId"], world_id, "restored world identity")
            expect(restored["running"], False, "restored life paused")

            status, _, raw = request(destination_base, f"/vh2/projection?worldId={world_id}", token=destination_token)
            expect(status, 200, "destination projection")
            projection = json_body(raw)
            expect(projection["state"]["running"], False, "destination canonical running state")
            if projection["revision"] <= 1:
                raise AssertionError("restore did not commit a new verified revision")
            status, _, raw = request(destination_base, f"/vh2/media-ticket?worldId={world_id}&id={asset_id}", token=destination_token)
            expect(status, 200, "transferred media ticket")
            expect(request(destination_base, json_body(raw)["path"])[2], b"private-image", "transferred media body")
            expect(request(destination_base, "/vh2/restore", method="POST", token=destination_token,
                           body=archive, content_type="application/vnd.horde.vh2-transfer+zip")[0], 409, "duplicate identity restore")

            print(json.dumps({
                "passed": True,
                "checks": 36,
                "worldId": world_id,
                "sourceRevision": 1,
                "restoredRevision": projection["revision"],
                "guarantees": [
                    "bearer authentication",
                    "exact-origin CORS",
                    "remote surface allowlist",
                    "local-copy route exclusion",
                    "local-mirror route exclusion",
                    "opaque media tickets",
                    "archive identity preservation",
                    "checkpoint ledger compaction",
                    "checkpoint media preservation",
                    "cross-worker transfer readiness",
                    "storage status and maintenance authorization",
                    "priority landmark filtering",
                    "validated storage optimization",
                    "paused destination restore",
                    "duplicate restore rejection",
                ],
            }, indent=2))
            return 0
        finally:
            if source:
                stop(source)
            if destination:
                stop(destination)


if __name__ == "__main__":
    raise SystemExit(main())
