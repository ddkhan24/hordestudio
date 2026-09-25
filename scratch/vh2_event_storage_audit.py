"""Regression coverage for bounded VH2 event-ledger storage."""
from pathlib import Path
import base64
from contextlib import contextmanager
import json
import sys
import tempfile
import threading
import unittest
import zlib
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_runtime import node_executable
from virtual_humans.backend.vh2_runtime import (
    EVENT_COMPRESSION_PREFIX,
    WorldService,
    compact_event_history,
    decode_event_payload,
    encode,
    encode_event_payload,
)
from virtual_humans.backend import vh2_runtime


ROOT = Path(__file__).resolve().parents[1]


class EventStorage(unittest.TestCase):
    def test_version_nine_upgrade_only_adds_storage_schema(self):
        """The v10 storage migration must not rescan multi-megabyte v9 states."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "world.sqlite"
            service = WorldService(path, node_executable(ROOT), ROOT, clock=lambda: 1788764400000)
            try:
                service.command({"schemaVersion": 1, "key": "create", "type": "create", "name": "Alex"})
                with service.connect() as database:
                    database.execute("DROP TABLE event_landmarks")
                    database.execute("PRAGMA user_version=9")
            finally:
                service.close()

            with mock.patch.object(vh2_runtime.vh2_library, "index") as library_index, \
                 mock.patch.object(vh2_runtime.vh2_transcript, "index") as transcript_index, \
                 mock.patch.object(vh2_runtime.vh2_social, "repair_starter_duplicates") as repair:
                upgraded = WorldService(path, node_executable(ROOT), ROOT, clock=lambda: 1788764400000)
                try:
                    library_index.assert_not_called()
                    transcript_index.assert_not_called()
                    repair.assert_not_called()
                    with upgraded.connect() as database:
                        self.assertEqual(database.execute("PRAGMA user_version").fetchone()[0], 10)
                        self.assertIsNotNone(database.execute(
                            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='event_landmarks'"
                        ).fetchone())
                finally:
                    upgraded.close()

    def test_storage_status_does_not_parse_the_full_world_state(self):
        with tempfile.TemporaryDirectory() as directory:
            service = WorldService(Path(directory) / "world.sqlite", node_executable(ROOT), ROOT,
                                   clock=lambda: 1788764400000)
            try:
                world = service.command(
                    {"schemaVersion": 1, "key": "create", "type": "create", "name": "Alex"}
                )["worldId"]
                with service.connect() as database:
                    expected = database.execute(
                        "SELECT LENGTH(state) FROM worlds WHERE id=?", (world,)
                    ).fetchone()[0]
                with mock.patch.object(vh2_runtime.json, "loads", side_effect=AssertionError("state parsed")):
                    status = service.storage_status(world)
                self.assertEqual(status["stateBytes"], expected)
            finally:
                service.close()

    def test_large_delta_is_compact_and_lossless(self):
        payload = {
            "schemaVersion": 1,
            "changes": [{
                "path": ["truth", "companion", "decision", "history"],
                "value": [{"at": index, "summary": "repeated deterministic trace"} for index in range(2000)],
            }],
            "details": {},
        }
        stored = encode_event_payload(payload)
        self.assertTrue(stored.startswith(EVENT_COMPRESSION_PREFIX))
        self.assertLess(len(stored), len(encode(payload)) // 4)
        self.assertEqual(decode_event_payload(stored), payload)

    def test_new_and_legacy_rows_replay_together(self):
        with tempfile.TemporaryDirectory() as directory:
            service = WorldService(Path(directory) / "world.sqlite", node_executable(ROOT), ROOT,
                                   clock=lambda: 1788764400000)
            try:
                world = service.command({"schemaVersion": 1, "key": "create", "type": "create", "name": "Alex"})["worldId"]
                before = service.projection(world)["state"]
                with service.connect() as database:
                    revision, state = service.read(database, world)
                    after = json.loads(encode(state))
                    after["storageAudit"] = [{"value": "same value" * 100} for _ in range(500)]
                    service.commit_event(database, world, revision, state, after, "STORAGE_AUDIT")
                    raw = database.execute("SELECT payload FROM events WHERE world_id=? ORDER BY seq DESC LIMIT 1", (world,)).fetchone()[0]
                self.assertTrue(raw.startswith(EVENT_COMPRESSION_PREFIX))
                self.assertEqual(service.replay(world), service.projection(world)["state"])
                self.assertNotEqual(before, service.projection(world)["state"])
                self.assertEqual(decode_event_payload('{"changes":[],"details":{}}')["changes"], [])
            finally:
                service.close()

    def test_checkpoint_compaction_preserves_current_life_and_append_only_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            service = WorldService(Path(directory) / "world.sqlite", node_executable(ROOT), ROOT,
                                   clock=lambda: 1788764400000)
            try:
                world = service.command({"schemaVersion": 1, "key": "create", "type": "create", "name": "Alex"})["worldId"]
                for index in range(4):
                    with service.connect() as database:
                        revision, state = service.read(database, world)
                        after = json.loads(encode(state))
                        after["storageAudit"] = [*after.get("storageAudit", []), {"index": index}]
                        details = ({"landmarkPriority": 3, "landmarkSummary": "A lasting turning point",
                                    "reason": "important", "snapshot": {"must": "not be copied"}}
                                   if index == 2 else {})
                        service.commit_event(database, world, revision, state, after,
                                             "STORAGE_AUDIT" if index != 3 else "SIMULATION_ADVANCED", details)
                expected = service.projection(world)["state"]
                with service.connect() as database:
                    revision, state = service.read(database, world)
                    report = compact_event_history(database, world, revision, state,
                                                   service.kernel_version, max_rows=2)
                self.assertEqual(report["before"], 5)
                with service.connect() as database:
                    rows = database.execute(
                        "SELECT seq,kind,payload FROM events WHERE world_id=? ORDER BY seq", (world,)
                    ).fetchall()
                    self.assertEqual([row["seq"] for row in rows], [1, 5])
                    self.assertEqual(rows[-1]["kind"], "HISTORY_CHECKPOINT")
                    self.assertTrue(decode_event_payload(rows[-1]["payload"])["details"]["historyCheckpoint"])
                    with self.assertRaises(Exception):
                        database.execute("DELETE FROM events WHERE world_id=?", (world,))
                self.assertEqual(service.replay(world), expected)
                self.assertEqual(service.projection(world)["state"], expected)
                landmarks = service.landmarks(world)
                tentpole = next(item for item in landmarks if item["summary"] == "A lasting turning point")
                self.assertEqual(tentpole["priority"], 3)
                self.assertEqual(tentpole["details"], {"reason": "important"})
                self.assertFalse(any(item["kind"] == "SIMULATION_ADVANCED" for item in landmarks))
            finally:
                service.close()

    def test_verified_optimizer_returns_free_pages_to_disk(self):
        with tempfile.TemporaryDirectory() as directory:
            service = WorldService(Path(directory) / "world.sqlite", node_executable(ROOT), ROOT,
                                   clock=lambda: 1788764400000)
            try:
                world = service.command({"schemaVersion": 1, "key": "create", "type": "create", "name": "Alex"})["worldId"]
                for index in range(5):
                    with service.connect() as database:
                        revision, state = service.read(database, world)
                        after = json.loads(encode(state))
                        after["storageAudit"] = [{"index": index, "padding": "x" * 2000} for _ in range(index + 1)]
                        service.commit_event(database, world, revision, state, after, "STORAGE_AUDIT")
                report = service.optimize_storage(world)
                self.assertEqual(report["after"]["autoVacuum"], "incremental")
                self.assertEqual(report["after"]["eventCount"], 2)
                self.assertEqual(
                    report["bytesReclaimed"],
                    max(0, report["before"]["serviceDiskBytes"] - report["after"]["serviceDiskBytes"]),
                )
                self.assertLessEqual(report["after"]["databaseFileBytes"], report["before"]["databaseFileBytes"])
                with service.connect() as database:
                    self.assertEqual(database.execute("PRAGMA user_version").fetchone()[0], 10)
                self.assertEqual(service.replay(world), service.projection(world)["state"])
            finally:
                service.close()

    def test_fresh_store_reclaims_incrementally_and_optimizer_resolves_duplicate_reply_text(self):
        with tempfile.TemporaryDirectory() as directory:
            service = WorldService(Path(directory) / "world.sqlite", node_executable(ROOT), ROOT,
                                   clock=lambda: 1788764400000)
            try:
                world = service.command(
                    {"schemaVersion": 1, "key": "create", "type": "create", "name": "Alex"}
                )["worldId"]
                self.assertEqual(service.storage_status(world)["autoVacuum"], "incremental")
                message={"id":"legacy-reply","role":"assistant","type":"text","text":"Exact old reply.",
                         "playerPersonaId":service.projection(world)["state"]["communication"]["personaId"],
                         "timestamp":1788764400000,"deliveredAt":1788764400000,"deliveryState":"delivered"}
                with service.connect() as database:
                    revision,state=service.read(database,world)
                    state["playerKnowledge"]=[{"kind":"message_delivered","messageId":"legacy-reply",
                                               "sourceSequence":revision,"at":1788764400000,
                                               "text":"Exact old reply."}]
                    database.execute("UPDATE worlds SET state=? WHERE id=?",(encode(state),world))
                    database.execute("INSERT INTO transcript_messages VALUES (?,?,?,?)",
                                     (world,"legacy-reply",1,encode(message)))
                report=service.optimize_storage(world)
                resolved=service.projection(world)["state"]["playerKnowledge"]
                self.assertEqual(len(resolved),1)
                self.assertNotIn("text",resolved[0])
                self.assertEqual(report["conversationHistory"][0]["replyBodiesRemoved"],1)
                self.assertEqual(service.replay(world),service.projection(world)["state"])
            finally:
                service.close()

    def test_optimizer_is_service_wide_and_requires_every_life_paused(self):
        with tempfile.TemporaryDirectory() as directory:
            service = WorldService(Path(directory) / "world.sqlite", node_executable(ROOT), ROOT,
                                   clock=lambda: 1788764400000)
            try:
                first = service.command(
                    {"schemaVersion": 1, "key": "create-a", "type": "create", "name": "Alex"}
                )["worldId"]
                second = service.command(
                    {"schemaVersion": 1, "key": "create-b", "type": "create", "name": "Blair"}
                )["worldId"]
                second_revision = service.projection(second)["revision"]
                service.command({"schemaVersion": 1, "key": "run-b", "type": "set_running",
                                 "worldId": second, "expectedRevision": second_revision, "running": True})
                with self.assertRaisesRegex(vh2_runtime.Conflict, "Pause every life"):
                    service.optimize_storage(first)
                second_revision = service.projection(second)["revision"]
                service.command({"schemaVersion": 1, "key": "pause-b", "type": "set_running",
                                 "worldId": second, "expectedRevision": second_revision, "running": False})

                for world in (first, second):
                    for index in range(3):
                        with service.connect() as database:
                            revision, state = service.read(database, world)
                            after = json.loads(encode(state))
                            after["serviceWideStorageAudit"] = index
                            service.commit_event(database, world, revision, state, after, "STORAGE_AUDIT")
                expected = {world: service.projection(world)["state"] for world in (first, second)}
                report = service.optimize_storage(first)
                self.assertEqual({item["worldId"] for item in report["compacted"]}, {first, second})
                with service.connect() as database:
                    counts = dict(database.execute(
                        "SELECT world_id,COUNT(*) FROM events GROUP BY world_id"
                    ).fetchall())
                self.assertEqual(counts, {first: 2, second: 2})
                for world in (first, second):
                    self.assertEqual(service.replay(world), expected[world])
            finally:
                service.close()

    def test_background_resolution_bounds_an_oversized_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            service = WorldService(Path(directory) / "world.sqlite", node_executable(ROOT), ROOT,
                                   clock=lambda: 1788764400000)
            try:
                world = service.command({"schemaVersion": 1, "key": "create", "type": "create", "name": "Alex"})["worldId"]
                payload = encode_event_payload({"schemaVersion": 1, "kernelVersion": service.kernel_version,
                                                "changes": [], "details": {}})
                with service.connect() as database:
                    revision, state = service.read(database, world)
                    recorded_kernel = state["kernelVersion"]
                    database.executemany("INSERT INTO events VALUES (?,?,?,?,?)",
                                         [(world, seq, state["simAt"], "SIMULATION_ADVANCED", payload)
                                          for seq in range(revision + 1, 1026)])
                    database.execute("UPDATE worlds SET revision=? WHERE id=?", (1025, world))
                service.kernel_version += ":new-host-engine"
                service.compact_due_event_history()
                with service.connect() as database:
                    rows = database.execute("SELECT seq,kind,payload FROM events WHERE world_id=? ORDER BY seq", (world,)).fetchall()
                self.assertEqual([(row["seq"], row["kind"]) for row in rows],
                                 [(1, "WORLD_CREATED"), (1025, "HISTORY_CHECKPOINT")])
                self.assertEqual(decode_event_payload(rows[-1]["payload"])["kernelVersion"], recorded_kernel)
                self.assertEqual(service.replay(world), service.projection(world)["state"])
            finally:
                service.close()

    def test_background_reclamation_continues_after_ledgers_are_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"world.sqlite"
            service=WorldService(path,node_executable(ROOT),ROOT,clock=lambda:1788764400000)
            try:
                service.command({"schemaVersion":1,"key":"create","type":"create","name":"Alex"})
                with service.connect() as database:
                    database.execute("CREATE TABLE storage_padding(value BLOB)")
                    database.execute("INSERT INTO storage_padding VALUES (zeroblob(4194304))")
                    database.execute("DELETE FROM storage_padding")
                    free_before=database.execute("PRAGMA freelist_count").fetchone()[0]
                size_before=path.stat().st_size
                service.compact_due_event_history()
                with service.connect() as database:
                    free_after=database.execute("PRAGMA freelist_count").fetchone()[0]
                self.assertLess(free_after,free_before)
                self.assertLess(path.stat().st_size,size_before)
            finally:
                service.close()

    def test_background_maintenance_never_rejects_foreground_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            service=WorldService(Path(directory)/"world.sqlite",node_executable(ROOT),ROOT,
                                 clock=lambda:1788764400000)
            entered=threading.Event();release=threading.Event()

            @contextmanager
            def stalled_background_lock(_path):
                entered.set()
                self.assertTrue(release.wait(5),"background maintenance fixture was not released")
                yield

            try:
                with mock.patch.object(vh2_runtime,"exclusive_storage_file_lock",stalled_background_lock):
                    worker=threading.Thread(target=service.compact_due_event_history)
                    worker.start();self.assertTrue(entered.wait(5),"background maintenance did not start")
                    receipt=service.command({"schemaVersion":1,"key":"create-during-maintenance",
                                             "type":"create","name":"Blair"})
                    self.assertTrue(receipt["worldId"])
                    release.set();worker.join(5)
                    self.assertFalse(worker.is_alive())
            finally:
                release.set();service.close()

    def test_low_disk_preflight_does_not_compact(self):
        with tempfile.TemporaryDirectory() as directory:
            service = WorldService(Path(directory) / "world.sqlite", node_executable(ROOT), ROOT,
                                   clock=lambda: 1788764400000)
            try:
                world = service.command({"schemaVersion": 1, "key": "create", "type": "create", "name": "Alex"})["worldId"]
                for index in range(3):
                    with service.connect() as database:
                        revision, state = service.read(database, world)
                        after = json.loads(encode(state));after["storageAudit"] = index
                        service.commit_event(database, world, revision, state, after, "STORAGE_AUDIT")
                with service.connect() as database:
                    before = database.execute("SELECT COUNT(*) FROM events WHERE world_id=?", (world,)).fetchone()[0]
                with mock.patch.object(vh2_runtime.shutil, "disk_usage", return_value=mock.Mock(free=0)):
                    with self.assertRaisesRegex(ValueError, "Not enough free disk space"):
                        service.optimize_storage(world)
                with service.connect() as database:
                    after = database.execute("SELECT COUNT(*) FROM events WHERE world_id=?", (world,)).fetchone()[0]
                self.assertEqual(after, before)
                self.assertEqual(service.replay(world), service.projection(world)["state"])
            finally:
                service.close()

    def test_event_payload_size_limit_is_symmetric(self):
        prior = vh2_runtime.MAX_EVENT_PAYLOAD_BYTES
        try:
            vh2_runtime.MAX_EVENT_PAYLOAD_BYTES = 100
            with self.assertRaisesRegex(ValueError, "128 MB safety limit"):
                encode_event_payload({"value": "x" * 200})
            with self.assertRaisesRegex(ValueError, "128 MB safety limit"):
                decode_event_payload(json.dumps({"value": "x" * 200}))
            with self.assertRaisesRegex(ValueError, "128 MB safety limit"):
                decode_event_payload(EVENT_COMPRESSION_PREFIX + "A" * 200)
            packed = zlib.compress(b'{"changes":[],"details":{}}') + b"trailing-data"
            with self.assertRaisesRegex(ValueError, "Damaged compressed"):
                decode_event_payload(EVENT_COMPRESSION_PREFIX + base64.b64encode(packed).decode())
        finally:
            vh2_runtime.MAX_EVENT_PAYLOAD_BYTES = prior


if __name__ == "__main__":
    unittest.main(verbosity=2)
