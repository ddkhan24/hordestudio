"""Fixture-only, adversarial 100-day audit for VH2 storage retention.

This intentionally does not open the user's database.  It creates a temporary
life with a high volume of distinct conversation text, bounded engine ledgers,
durable memories, media, and explicitly flagged landmarks.  The audit measures
logical and physical growth before/after background history resolution and the
explicit service-wide optimizer, then proves all user-visible projections and
the canonical/replayed life survive.

The workload is intentionally harsher than a typical life: twelve durable
turns per simulated day, each with a long, low-compressibility reply.  That
makes duplicated current-state fields visible in a short deterministic test.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_runtime import node_executable
from virtual_humans.backend import vh2_media
from virtual_humans.backend.vh2_runtime import WorldService, encode


ROOT = Path(__file__).resolve().parents[1]
START = 1_788_764_400_000
DAY = 86_400_000
TOTAL_DAYS = 100
TOTAL_EVENTS = 1_200
BACKGROUND_AT = 1_050
MEDIA_EVERY = 75
JOB_SNAPSHOT_CHARS = 12_000


def unique_text(index: int, length: int = 768) -> str:
    """Deterministic, distinct text that cannot disappear into zlib repetition."""
    chunks = []
    nonce = 0
    while sum(map(len, chunks)) < length:
        chunks.append(hashlib.sha256(f"vh2-retention:{index}:{nonce}".encode()).hexdigest())
        nonce += 1
    return (f"Day-turn {index:04d}: " + "".join(chunks))[:length]


def fixture_image(index: int, size: int = 64 * 1024) -> bytes:
    """A unique WebP-shaped binary fixture; the asset store itself is format agnostic."""
    body = bytearray()
    nonce = 0
    while len(body) < size - 12:
        body.extend(hashlib.sha256(f"vh2-media:{index}:{nonce}".encode()).digest())
        nonce += 1
    body = bytes(body[: size - 12])
    return b"RIFF" + (size - 8).to_bytes(4, "little") + b"WEBP" + body


def database_rows(service: WorldService, world_id: str) -> dict:
    """Return table counts and logical payload bytes without reading another DB."""
    with service.connect() as database:
        scalar = lambda query, parameters=(): database.execute(query, parameters).fetchone()[0]
        return {
            "events": scalar("SELECT COUNT(*) FROM events WHERE world_id=?", (world_id,)),
            "eventPayloadBytes": scalar(
                "SELECT COALESCE(SUM(LENGTH(payload)),0) FROM events WHERE world_id=?", (world_id,)
            ),
            "landmarks": scalar("SELECT COUNT(*) FROM event_landmarks WHERE world_id=?", (world_id,)),
            "landmarkBytes": scalar(
                "SELECT COALESCE(SUM(LENGTH(summary)+LENGTH(details)),0) FROM event_landmarks WHERE world_id=?",
                (world_id,),
            ),
            "transcriptRows": scalar(
                "SELECT COUNT(*) FROM transcript_messages WHERE world_id=?", (world_id,)
            ),
            "transcriptBytes": scalar(
                "SELECT COALESCE(SUM(LENGTH(data)),0) FROM transcript_messages WHERE world_id=?", (world_id,)
            ),
            "memoryRows": scalar("SELECT COUNT(*) FROM memory_episodes WHERE world_id=?", (world_id,)),
            "memoryBytes": scalar(
                "SELECT COALESCE(SUM(LENGTH(data)),0) FROM memory_episodes WHERE world_id=?", (world_id,)
            ),
            "mediaRows": scalar("SELECT COUNT(*) FROM media_records WHERE world_id=?", (world_id,)),
            "mediaBytes": scalar(
                "SELECT COALESCE(SUM(LENGTH(data)),0) FROM media_records WHERE world_id=?", (world_id,)
            ),
            "assetRows": scalar("SELECT COUNT(*) FROM photo_assets WHERE world_id=?", (world_id,)),
            "assetBytes": scalar(
                "SELECT COALESCE(SUM(LENGTH(bytes)),0) FROM photo_assets WHERE world_id=?", (world_id,)
            ),
            "photoSnapshotRows": scalar("SELECT COUNT(*) FROM photo_jobs WHERE world_id=?", (world_id,)),
            "photoSnapshotBytes": scalar(
                "SELECT COALESCE(SUM(LENGTH(snapshot)),0) FROM photo_jobs WHERE world_id=?", (world_id,)
            ),
            "legacyPhotoSnapshots": scalar(
                """SELECT COALESCE(SUM(CASE WHEN json_extract(snapshot,'$.captureSnapshotVersion') IS NULL
                   THEN 1 ELSE 0 END),0) FROM photo_jobs WHERE world_id=?""",
                (world_id,),
            ),
            "commandRows": scalar("SELECT COUNT(*) FROM commands"),
            "checkpointRows": scalar("SELECT COUNT(*) FROM kernel_checkpoints WHERE world_id=?", (world_id,)),
            "dialogueJobRows": scalar("SELECT COUNT(*) FROM dialogue_jobs WHERE world_id=?", (world_id,)),
            "dialogueJobBytes": scalar(
                "SELECT COALESCE(SUM(LENGTH(snapshot)+LENGTH(COALESCE(result,''))),0) "
                "FROM dialogue_jobs WHERE world_id=?", (world_id,)
            ),
            "dialogueReceiptRows": scalar(
                "SELECT COUNT(*) FROM dialogue_receipts WHERE job_id IN "
                "(SELECT id FROM dialogue_jobs WHERE world_id=?)", (world_id,)
            ),
        }


def table_digest(service: WorldService, world_id: str, table: str, columns: tuple[str, ...]) -> str:
    digest = hashlib.sha256()
    with service.connect() as database:
        fields = ",".join(columns)
        for row in database.execute(
            f"SELECT {fields} FROM {table} WHERE world_id=? ORDER BY 1,2", (world_id,)
        ):
            for value in row:
                if isinstance(value, bytes):
                    digest.update(value)
                else:
                    digest.update(str(value).encode())
                digest.update(b"\0")
    return digest.hexdigest()


def durable_signature(service: WorldService, world_id: str) -> dict:
    projection = service.projection(world_id)
    state = projection["state"]
    return {
        "revision": projection["revision"],
        "stateSha256": hashlib.sha256(encode(state).encode()).hexdigest(),
        "transcriptSha256": table_digest(
            service, world_id, "transcript_messages", ("position", "id", "data")
        ),
        "durableMemorySha256": durable_memory_digest(service, world_id),
        "mediaSha256": table_digest(service, world_id, "media_records", ("kind", "id", "data")),
        "assetSha256": table_digest(service, world_id, "photo_assets", ("id", "mime", "bytes")),
    }


def durable_memory_digest(service: WorldService, world_id: str) -> str:
    """Hash only memories whose priority contract says they never resolve."""
    digest=hashlib.sha256()
    with service.connect() as database:
        for row in database.execute('''SELECT m.sequence,m.id,m.data
            FROM memory_episodes m JOIN memory_episode_retention r
              ON r.world_id=m.world_id AND r.id=m.id
            WHERE m.world_id=? AND (r.priority>=2 OR r.pinned=1)
            ORDER BY m.sequence,m.id''',(world_id,)):
            for value in row:
                digest.update(str(value).encode());digest.update(b"\0")
    return digest.hexdigest()


def append_fixture_event(service: WorldService, world_id: str, index: int) -> None:
    simulated_at = START + (index + 1) * TOTAL_DAYS * DAY // TOTAL_EVENTS
    with service.connect() as database:
        revision, before = service.read(database, world_id)
        after = json.loads(encode(before))
        after["simAt"] = simulated_at
        after["simAnchor"] = simulated_at
        after["wallAnchor"] = simulated_at
        companion = after["truth"]["companion"]

        # Exercise the same bounded collections that dominated the original
        # multi-gigabyte cumulative event deltas.
        finance = companion["vh2Finance"]
        finance["sequence"] += 1
        finance["ledger"].append({
            "id": f"finance:{index}", "at": simulated_at, "kind": "audit_cashflow",
            "amountMinor": (index % 41) - 20, "currency": "USD",
            "balanceMinor": 50_000 + index, "detail": f"100-day fixture transaction {index}",
        })
        finance["ledger"] = finance["ledger"][-400:]

        runtime = companion["lifeRuntime"]
        runtime["simulationLedger"].append({
            "id": f"sim:{index}", "at": simulated_at, "kind": "audit",
            "summary": f"Routine life transition {index}",
        })
        runtime["simulationLedger"] = runtime["simulationLedger"][-500:]
        runtime["world"]["events"].append({
            "id": f"world:{index}", "at": simulated_at, "kind": "routine",
            "summary": f"Ordinary event {index}",
        })
        runtime["world"]["events"] = runtime["world"]["events"][-300:]

        decision = companion["vh2Decision"]
        decision["sequence"] = index + 1
        decision["history"].append({
            "sequence": index + 1, "at": simulated_at, "kind": "routine",
            "sourceId": f"goal:{index % 31}", "score": index % 100,
            "accepted": bool(index % 2),
        })
        decision["history"] = decision["history"][-50:]

        people = companion["vh2People"]
        people["sequence"] = index + 1
        people["events"].append({
            "id": f"person:{index}", "at": simulated_at, "kind": "routine",
            "personId": f"support:{index % 4}", "summary": f"Supporting-person transition {index}",
        })
        people["events"] = people["events"][-200:]

        if index % 10 == 0:
            story = companion["vh2Story"]
            story["threads"].append({
                "id": f"thread:{index}", "at": simulated_at, "kind": "ordinary_arc",
                "summary": f"Story circumstance {index}", "status": "resolved",
            })
            story["threads"] = story["threads"][-20:]

        # A deliberately busy long conversation. The durable transcript is the
        # correct permanent home; active messages are independently capped at 200.
        text = unique_text(index)
        message_id = f"reply:{index:04d}"
        after["communication"]["messages"].append({
            "id": message_id, "role": "assistant", "type": "text", "text": text,
            "playerPersonaId": after["communication"]["personaId"],
            "timestamp": simulated_at, "deliveredAt": simulated_at,
            "deliveryState": "delivered",
        })
        after["playerKnowledge"].append({
            "kind": "message_delivered", "messageId": message_id,
            "sourceSequence": revision + 1, "at": simulated_at, "text": text,
        })

        # Terminal generation records are operational audit data, not the chat
        # transcript. A real turn stores a frozen model context here. Keeping all
        # full snapshots forever is measured separately from user-visible chat.
        job_id = f"dialogue:audit:{index:04d}"
        job_snapshot = {
            "version": 1,
            "context": {
                "personaId": after["communication"]["personaId"],
                "readyMessageIds": [f"prompt:{index:04d}"],
                "auditContext": unique_text(100_000 + index, JOB_SNAPSHOT_CHARS),
            },
            "messages": [
                {"role": "system", "content": "Fixture generation policy."},
                {"role": "user", "content": f"Fixture pending message {index}."},
            ],
        }
        job_digest = hashlib.sha256(encode(job_snapshot).encode()).hexdigest()
        database.execute(
            """INSERT INTO dialogue_jobs
               (id,world_id,snapshot,context_digest,adapter,fixture,status,attempt,created_at,reason,result)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (job_id, world_id, encode(job_snapshot), job_digest, "chat_completions", "",
             "delivered", 1, simulated_at, "", text),
        )
        database.execute(
            "INSERT INTO dialogue_receipts VALUES (?,?)",
            (job_id, encode({"prompt_tokens": 3000, "completion_tokens": 240, "total_tokens": 3240})),
        )
        database.execute("INSERT INTO dialogue_usage VALUES (?,?)", (job_id, simulated_at))

        # Active memory is bounded. The searchable archive resolves stale
        # routine texture while priority memories remain exact permanently.
        if index % 3 == 0:
            if index % 300 == 0:
                memory_kind="wedding_milestone";memory_summary=f"Tentpole commitment {index}"
            elif index % 120 == 0:
                memory_kind="relationship_transition";memory_summary=f"Important relationship change {index}"
            else:
                memory_kind="completed";memory_summary=f"Had an ordinary dinner {index}"
            episode = {
                "id": f"memory:{index:04d}", "at": simulated_at,
                "summary": memory_summary,
                "kind": memory_kind, "sourceSequence": revision + 1,
                "placeId": "home",
            }
            psychology = companion["vh2Psychology"]
            psychology["episodes"].append(episode)
            psychology["episodes"] = psychology["episodes"][-psychology["policy"]["memoryLimit"]:]
            after["memories"].append(episode)
            after["memories"] = after["memories"][-100:]

        # Add small binary assets and metadata on a realistic cadence. One old
        # capture intentionally contains a legacy full-companion snapshot so the
        # explicit optimizer's photo-snapshot migration is exercised as well.
        if index % MEDIA_EVERY == 0:
            raw = fixture_image(index)
            asset_id = vh2_media.store_asset(database, world_id, "image/webp", raw)
            photo_id = f"photo:{index:04d}"
            photo = {
                "id": photo_id, "status": "stored", "origin": "audit_fixture",
                "at": simulated_at, "deliveredAt": simulated_at,
                "scene": f"Recorded photograph {index}", "captureType": "front_camera_selfie",
                "destination": "gallery", "assetId": asset_id,
                "photoContext": {"placeId": "home", "atMs": simulated_at},
            }
            after.setdefault("photos", []).append(photo)
            base_snapshot = {
                "companion": companion if index == 750 else {
                    "id": companion["id"], "age": companion.get("age"),
                    "personality": companion.get("personality", ""),
                    "lifeProfile": {"socialCircle": []},
                },
                "photoContext": photo["photoContext"], "scene": photo["scene"],
                "captureType": photo["captureType"], "destination": "gallery",
                "kernelVersion": after["kernelVersion"],
            }
            snapshot = base_snapshot if index == 750 else vh2_media.compact_capture_snapshot(base_snapshot)
            database.execute(
                "INSERT INTO photo_jobs VALUES (?,?,?)", (photo_id, world_id, encode(snapshot))
            )

        if (index + 1) % 300 == 0:
            kind = "LIFE_MILESTONE"
            details = {
                "landmarkPriority": 3,
                "landmarkSummary": f"Tentpole at day {(index + 1) // 12}",
                "reason": "100-day storage fixture",
                "snapshot": {"must": "not be duplicated"},
            }
        elif (index + 1) % 120 == 0:
            kind = "RELATIONSHIP_CHANGED"
            details = {"landmarkSummary": f"Important relationship change {index + 1}"}
        else:
            kind = "SIMULATION_ADVANCED"
            details = {"routine": True}
        service.commit_event(database, world_id, revision, before, after, kind, details)


def capture(service: WorldService, world_id: str) -> dict:
    status = service.storage_status(world_id)
    rows = database_rows(service, world_id)
    return {"storage": status, "rows": rows}


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: {actual!r} != {expected!r}")


def main() -> None:
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="vh2-100-day-retention-") as directory:
        database_path = Path(directory) / "world.sqlite"
        service = WorldService(database_path, node_executable(ROOT), ROOT, clock=lambda: START)
        try:
            world_id = service.command({
                "schemaVersion": 1, "key": "retention-create", "type": "create",
                "name": "Mara Retention Fixture",
            })["worldId"]

            for index in range(BACKGROUND_AT):
                append_fixture_event(service, world_id, index)
            before_resolution = capture(service, world_id)
            assert before_resolution["rows"]["events"] == BACKGROUND_AT + 1

            resolution_started = time.perf_counter()
            service.compact_due_event_history()
            resolution_seconds = time.perf_counter() - resolution_started
            after_resolution = capture(service, world_id)
            assert_equal(after_resolution["rows"]["events"], 2, "background retained event rows")
            assert_equal(service.replay(world_id), service.projection(world_id)["state"], "replay after resolution")

            for index in range(BACKGROUND_AT, TOTAL_EVENTS):
                append_fixture_event(service, world_id, index)
            before_optimize = capture(service, world_id)
            signature_before = durable_signature(service, world_id)
            canonical_before = service.projection(world_id)["state"]

            # Engine-owned working projections remain bounded. playerKnowledge
            # is measured separately so this audit also passes after that
            # redundant full-reply copy is fixed or replaced with compact refs.
            companion = canonical_before["truth"]["companion"]
            bounds = {
                "activeMessages": len(canonical_before["communication"]["messages"]),
                "activeMemories": len(canonical_before["memories"]),
                "psychologyEpisodes": len(companion["vh2Psychology"]["episodes"]),
                "financeLedger": len(companion["vh2Finance"]["ledger"]),
                "simulationLedger": len(companion["lifeRuntime"]["simulationLedger"]),
                "worldEvents": len(companion["lifeRuntime"]["world"]["events"]),
                "decisionHistory": len(companion["vh2Decision"]["history"]),
                "peopleEvents": len(companion["vh2People"]["events"]),
                "storyThreads": len(companion["vh2Story"]["threads"]),
                "playerKnowledge": len(canonical_before["playerKnowledge"]),
            }
            expected_bounds = {
                "activeMessages": 200, "activeMemories": 100,
                "psychologyEpisodes": companion["vh2Psychology"]["policy"]["memoryLimit"],
                "financeLedger": 400, "simulationLedger": 500, "worldEvents": 300,
                "decisionHistory": 50, "peopleEvents": 200, "storyThreads": 20,
            }
            for key, expected in expected_bounds.items():
                assert_equal(bounds[key], expected, key)
            if bounds["playerKnowledge"] > 32:
                raise AssertionError("delivery-reference window exceeded 32 entries")
            if any("text" in item for item in canonical_before["playerKnowledge"]):
                raise AssertionError("playerKnowledge retained reply text already owned by transcript")
            assert_equal(before_resolution["storage"]["autoVacuum"], "incremental", "fresh database reclamation mode")
            if before_resolution["rows"]["eventPayloadBytes"] > 200 * 1024 * 1024:
                raise AssertionError("bounded event history exceeded the 200 MiB stress ceiling")

            optimize_started = time.perf_counter()
            optimize_report = service.optimize_storage(world_id)
            optimize_seconds = time.perf_counter() - optimize_started
            after_optimize = capture(service, world_id)
            signature_after = durable_signature(service, world_id)

            assert_equal(service.projection(world_id)["state"], canonical_before, "canonical state")
            assert_equal(service.replay(world_id), canonical_before, "replayed state")
            assert_equal(signature_after, signature_before, "durable projection signature")
            assert_equal(after_optimize["rows"]["events"], 2, "optimized event rows")
            assert_equal(after_optimize["rows"]["transcriptRows"], TOTAL_EVENTS, "durable transcript rows")
            if after_optimize["rows"]["memoryRows"] >= TOTAL_EVENTS // 3:
                raise AssertionError("stale routine memory rows were not resolved")
            if not any(item["deletedRoutine"] for item in optimize_report["memoryHistory"]):
                raise AssertionError("explicit optimization did not report routine-memory resolution")
            assert_equal(after_optimize["rows"]["assetRows"], TOTAL_EVENTS // MEDIA_EVERY, "asset rows")
            assert_equal(after_optimize["rows"]["mediaRows"], TOTAL_EVENTS // MEDIA_EVERY, "media rows")
            assert_equal(after_optimize["rows"]["photoSnapshotRows"], TOTAL_EVENTS // MEDIA_EVERY, "photo snapshots")
            assert_equal(after_optimize["rows"]["legacyPhotoSnapshots"], 0, "legacy photo snapshots")

            landmarks = service.landmarks(world_id, minimum_priority=2)
            tentpoles = [item for item in landmarks if item["priority"] == 3]
            important = [item for item in landmarks if item["priority"] == 2]
            # Four authored 25-day tentpoles plus the permanent WORLD_CREATED
            # origin; relationship changes occur every ten days except where a
            # 25-day tentpole occupies the same event.
            assert_equal(len(tentpoles), 5, "tentpole landmarks")
            assert_equal(len(important), 8, "important landmarks")
            if any("snapshot" in item["details"] for item in tentpoles):
                raise AssertionError("Landmark details retained a prohibited state snapshot")

            # Cold reopen is part of the contract: optimization cannot merely
            # leave valid state in one process's memory or WAL connection.
            service.close()
            service = WorldService(database_path, node_executable(ROOT), ROOT, clock=lambda: START)
            assert_equal(durable_signature(service, world_id), signature_before, "cold-reopen projections")
            assert_equal(service.projection(world_id)["state"], canonical_before, "cold-reopen canonical state")
            assert_equal(service.replay(world_id), canonical_before, "cold-reopen replay")

            remaining_risks = []
            if bounds["playerKnowledge"] > 200:
                remaining_risks.append({
                    "path": "worlds.state.playerKnowledge",
                    "evidence": f"{bounds['playerKnowledge']} full reply copies after {TOTAL_EVENTS} turns",
                    "impact": "The canonical state grows with every reply even though transcript_messages already owns durable chat. The retained event window can repeatedly compress copies of this growing array.",
                })
            if after_optimize["rows"]["dialogueJobBytes"] > 1_000_000:
                remaining_risks.append({
                    "path": "dialogue_jobs.snapshot",
                    "evidence": (
                        f"{after_optimize['rows']['dialogueJobRows']} terminal jobs retain "
                        f"{after_optimize['rows']['dialogueJobBytes']} prompt/result bytes after optimization"
                    ),
                    "impact": "Every generated reply retains a full frozen prompt indefinitely even though the UI only exposes the newest 30 and the transcript owns visible history.",
                })
            remaining_risks.extend([
                {
                    "path": "kernel_checkpoints.state",
                    "evidence": "Full-state immutable rows have no count/age retention policy.",
                    "impact": "Repeated reboot/catch-up/upgrade operations can retain multiple large state snapshots.",
                },
                {
                    "path": "commands",
                    "evidence": "One global idempotency receipt is retained per command with no pruning.",
                    "impact": "Linear metadata growth; responses are small, so this is lower risk than state/checkpoints.",
                },
                {
                    "path": "transcript_messages, priority memories, media_records, photo_assets, event_landmarks",
                    "evidence": "Exact chat and priority 2/3 or pinned human history are intentionally durable.",
                    "impact": "Intentional linear user-authored/important history remains; routine and notable memory projections are now age/count bounded and never multiply through event deltas.",
                },
            ])

            result = {
                "fixture": {
                    "simulatedDays": TOTAL_DAYS,
                    "durableEvents": TOTAL_EVENTS,
                    "turnsPerDay": TOTAL_EVENTS / TOTAL_DAYS,
                    "longReplyCharacters": 768,
                    "realUserDatabaseTouched": False,
                },
                "timingSeconds": {
                    "total": round(time.perf_counter() - started, 3),
                    "backgroundResolution": round(resolution_seconds, 3),
                    "explicitOptimize": round(optimize_seconds, 3),
                },
                "beforeBackgroundResolution": before_resolution,
                "afterBackgroundResolution": after_resolution,
                "beforeExplicitOptimize": before_optimize,
                "afterExplicitOptimize": after_optimize,
                "optimizer": {
                    "bytesReclaimed": optimize_report["bytesReclaimed"],
                    "compactedWorlds": optimize_report["compacted"],
                    "photoSnapshots": optimize_report["photoSnapshots"],
                    "memoryHistory": optimize_report["memoryHistory"],
                    "jobHistory": optimize_report["jobHistory"],
                },
                "workingCollectionBounds": bounds,
                "durablePreservation": {
                    "canonicalState": True, "replay": True, "coldReopen": True, "transcript": True,
                    "priorityMemory": True, "mediaMetadata": True, "mediaBytes": True,
                    "tentpoleLandmarks": len(tentpoles), "importantLandmarks": len(important),
                },
                "remainingGrowthRisks": remaining_risks,
            }
            print(json.dumps(result, indent=2, sort_keys=True))
            print("100-DAY STORAGE RETENTION AUDIT PASSED")
        finally:
            service.close()


if __name__ == "__main__":
    main()
