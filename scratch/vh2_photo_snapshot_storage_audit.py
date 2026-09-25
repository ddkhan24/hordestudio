#!/usr/bin/env python3
"""Photo capture snapshots retain image semantics without full-life duplication."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
import uuid
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_runtime import node_executable
from virtual_humans.backend import vh2_backup, vh2_media, vh2_runtime, vh2_workers
from virtual_humans.backend.vh2_runtime import WorldService, encode


ROOT = Path(__file__).resolve().parents[1]
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="


class PhotoSnapshotStorage(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.service = WorldService(
            Path(self.temporary.name) / "world.sqlite", node_executable(ROOT), ROOT,
            clock=lambda: 1788764400000,
        )
        self.world = self.service.command({
            "schemaVersion": 1, "key": "create", "type": "create", "name": "Alex",
        })["worldId"]
        companion = self.state()["truth"]["companion"]
        self.command("add_bible_asset", role="identity", entityId=companion["id"],
                     label="Face", tags=["front_face"], image=PNG)
        entry = self.state()["truth"]["companion"]["vh2Assets"]["entries"][0]
        self.command("review_bible_asset", entryId=entry["id"], status="approved")
        self.photo_id = self.command(
            "capture_photo", scene="At home in a green sweater", destination="gallery"
        )["photoId"]
        self.config = {
            "model": "fixture/image", "maxReferences": 10, "provider": "openrouter",
            "imageParameters": {"size": "1024x1024"},
        }

    def tearDown(self):
        self.service.close()
        self.temporary.cleanup()

    def state(self):
        return self.service.projection(self.world)["state"]

    def command(self, kind, **values):
        return self.service.command({
            "schemaVersion": 1, "key": str(uuid.uuid4()), "type": kind,
            "worldId": self.world, "expectedRevision": self.service.projection(self.world)["revision"],
            **values,
        })

    def snapshot(self):
        with self.service.connect() as database:
            return json.loads(database.execute(
                "SELECT snapshot FROM photo_jobs WHERE world_id=? AND id=?",
                (self.world, self.photo_id),
            ).fetchone()[0])

    def compile(self, snapshot):
        state = self.state()
        photo = next(item for item in state["photos"] if item["id"] == self.photo_id)
        with self.service.connect() as database:
            return vh2_workers.compile_image(
                database, self.world, state, snapshot, self.config, photo
            )

    def legacy_snapshot(self):
        compact = self.snapshot()
        legacy = deepcopy(compact)
        legacy["companion"] = deepcopy(self.state()["truth"]["companion"])
        legacy["companion"]["storageAuditNoise"] = [
            {"sequence": index, "trace": "x" * 2000} for index in range(300)
        ]
        legacy.pop("captureSnapshotVersion", None)
        return legacy

    def install_legacy_snapshot(self, legacy):
        raw = encode(legacy)
        with self.service.connect() as database:
            database.execute("DROP TRIGGER photo_snapshot_immutable")
            database.execute(
                "UPDATE photo_jobs SET snapshot=? WHERE world_id=? AND id=?",
                (raw, self.world, self.photo_id),
            )
            database.execute('''CREATE TRIGGER photo_snapshot_immutable BEFORE UPDATE ON photo_jobs
                BEGIN SELECT RAISE(ABORT,'Photo captures are immutable'); END''')
        return raw

    def test_helper_preserves_prompt_references_and_full_provider_request(self):
        legacy = self.legacy_snapshot()
        legacy["companion"]["lifeProfile"]["socialCircle"] = [{
            "id": "person-1", "name": "Morgan", "appearance": "short silver hair",
            "privateHistory": "not part of an image request" * 1000,
        }]
        legacy["photoContext"]["personIds"] = ["person-1"]
        compact = vh2_media.compact_capture_snapshot(legacy)
        self.assertEqual(self.compile(legacy), self.compile(compact))
        self.assertLess(len(encode(compact)), len(encode(legacy)) // 20)
        self.assertEqual(compact["captureSnapshotVersion"], 1)
        self.assertNotIn("storageAuditNoise", compact["companion"])

    def test_new_capture_and_transfer_checkpoint_use_canonical_snapshot(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot["captureSnapshotVersion"], 1)
        self.assertNotIn("lifeRuntime", snapshot["companion"])
        checkpoint = vh2_backup.export_checkpoint(self.service, self.world)
        payload = vh2_backup._read_transfer_payload(checkpoint)
        rows = payload["tables"]["photo_jobs"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(json.loads(rows[0]["snapshot"])["captureSnapshotVersion"], 1)

    def test_optimizer_compacts_legacy_snapshot_and_verifies_active_request(self):
        legacy = self.legacy_snapshot()
        before_request = self.compile(legacy)
        legacy_raw = self.install_legacy_snapshot(legacy)
        before = self.service.storage_status(self.world)
        self.assertEqual(before["legacyPhotoSnapshotCount"], 1)
        self.assertEqual(before["photoSnapshotBytes"], len(legacy_raw.encode()))

        report = self.service.optimize_storage(self.world)
        snapshot = self.snapshot()
        after = self.service.storage_status(self.world)
        self.assertEqual(self.compile(snapshot), before_request)
        self.assertEqual(report["photoSnapshots"]["rowsCompacted"], 1)
        self.assertEqual(report["photoSnapshots"]["activeRowsVerified"], 1)
        self.assertGreater(report["photoSnapshots"]["bytesReduced"], 500_000)
        self.assertEqual(after["legacyPhotoSnapshotCount"], 0)
        self.assertEqual(after["photoSnapshotCount"], 1)
        self.assertLess(after["photoSnapshotBytes"], before["photoSnapshotBytes"] // 20)
        self.assertEqual(self.service.replay(self.world), self.service.projection(self.world)["state"])
        with self.service.connect() as database:
            with self.assertRaises(sqlite3.IntegrityError):
                database.execute("UPDATE photo_jobs SET snapshot='{}' WHERE id=?", (self.photo_id,))

    def test_optimizer_verifies_active_capture_archived_outside_state_window(self):
        legacy = self.legacy_snapshot()
        before_request = self.compile(legacy)
        self.install_legacy_snapshot(legacy)
        with self.service.connect() as database:
            revision, state = self.service.read(database, self.world)
            photo = next(item for item in state["photos"] if item["id"] == self.photo_id)
            database.execute(
                "INSERT OR REPLACE INTO media_records VALUES (?,?,?,?,?)",
                (self.world, "photo", self.photo_id, 1, encode(photo)),
            )
            before = json.loads(encode(state))
            state["photos"] = [item for item in state["photos"] if item["id"] != self.photo_id]
            self.service.commit_event(
                database, self.world, revision, before, state,
                "STORAGE_TEST_ARCHIVE", {"photoId": self.photo_id},
            )

        report = self.service.optimize_storage(self.world)
        snapshot = self.snapshot()
        with self.service.connect() as database:
            archived = json.loads(database.execute(
                "SELECT data FROM media_records WHERE world_id=? AND kind='photo' AND id=?",
                (self.world, self.photo_id),
            ).fetchone()[0])
            compiled = vh2_workers.compile_image(
                database, self.world, self.state(), snapshot, self.config, archived,
            )
        self.assertEqual(compiled, before_request)
        self.assertEqual(report["photoSnapshots"]["activeRowsVerified"], 1)

    def test_semantic_mismatch_rolls_back_snapshot_and_restores_guard(self):
        original_raw = self.install_legacy_snapshot(self.legacy_snapshot())
        canonical = vh2_media.compact_capture_snapshot

        def broken(snapshot):
            result = canonical(snapshot)
            result["companion"]["personality"] = "A materially different expression"
            return result

        with mock.patch.object(vh2_runtime.vh2_media, "compact_capture_snapshot", side_effect=broken):
            with self.assertRaisesRegex(RuntimeError, "changed an active image request"):
                self.service.optimize_storage(self.world)
        with self.service.connect() as database:
            saved = database.execute(
                "SELECT snapshot FROM photo_jobs WHERE id=?", (self.photo_id,)
            ).fetchone()[0]
            self.assertEqual(saved, original_raw)
            with self.assertRaises(sqlite3.IntegrityError):
                database.execute("UPDATE photo_jobs SET snapshot='{}' WHERE id=?", (self.photo_id,))


if __name__ == "__main__":
    unittest.main(verbosity=2)
