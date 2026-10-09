"""Focused regression gate for safe, recoverable VH2 reply-worker diagnostics."""

import json
import sqlite3
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from test_runtime import node_executable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from virtual_humans.backend.vh2_runtime import WorldService


class DialogueWorkerDiagnostic(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.now = 1788764400000
        self.service = WorldService(
            Path(self.directory.name) / 'life.sqlite',
            node_executable(ROOT),
            ROOT,
            clock=lambda: self.now,
        )
        self.world_id = self.service.command({
            'schemaVersion': 1,
            'key': str(uuid.uuid4()),
            'type': 'create',
            'name': 'Worker diagnostic fixture',
        })['worldId']
        self.command('receive_message', text='Please reply once.')
        self.command('advance', steps=1)
        self.job_id = self.command('queue_dialogue', text='A single saved reply.')['jobId']

    def tearDown(self):
        self.service.close()
        self.directory.cleanup()

    def command(self, kind, **kwargs):
        return self.service.command({
            'schemaVersion': 1,
            'key': str(uuid.uuid4()),
            'type': kind,
            'worldId': self.world_id,
            'expectedRevision': self.service.projection(self.world_id)['revision'],
            **kwargs,
        })

    def assert_saved_once(self):
        state = self.service.projection(self.world_id)['state']
        self.assertEqual(
            1,
            len([message for message in state['communication']['messages']
                 if message['role'] == 'user']),
        )
        self.assertEqual(self.job_id, self.service.dialogue.list(self.world_id)[0]['id'])

    def test_storage_failure_before_worker_job_is_safe_and_saved(self):
        with patch.object(self.service, 'connect', side_effect=sqlite3.OperationalError('private-database-secret')):
            self.assertFalse(self.service.poll_dialogue_once())
        status = self.service.status()
        self.assertEqual('recovering', status['dialogueDiagnostic']['state'])
        self.assertEqual('storage', status['dialogueDiagnostic']['lastFailure']['category'])
        self.assertEqual('list_lives', status['dialogueDiagnostic']['lastFailure']['stage'])
        self.assertEqual(1, status['dialogueDiagnostic']['consecutiveFailures'])
        self.assertNotIn('private-database-secret', json.dumps(status))
        self.assert_saved_once()

    def test_repeated_local_faults_recover_without_replaying_saved_message(self):
        with patch.object(self.service.dialogue, 'run_once', side_effect=RuntimeError('Bearer private-worker-token')):
            self.assertFalse(self.service.poll_dialogue_once())
            self.assertFalse(self.service.poll_dialogue_once())
        failed = self.service.status()
        self.assertEqual('local_worker', failed['dialogueDiagnostic']['lastFailure']['category'])
        self.assertEqual('run_reply_job', failed['dialogueDiagnostic']['lastFailure']['stage'])
        self.assertEqual(2, failed['dialogueDiagnostic']['consecutiveFailures'])
        self.assertNotIn('Bearer private-worker-token', json.dumps(failed))
        self.assert_saved_once()

        self.assertTrue(self.service.poll_dialogue_once())
        recovered = self.service.status()
        self.assertEqual('healthy', recovered['dialogueDiagnostic']['state'])
        self.assertEqual(0, recovered['dialogueDiagnostic']['consecutiveFailures'])
        self.assertEqual(self.now, recovered['dialogueDiagnostic']['lastRecoveredAt'])
        self.assertEqual(failed['dialogueDiagnostic']['lastFailure'],
                         recovered['dialogueDiagnostic']['lastFailure'])
        self.assertEqual('', recovered['dialogueError'])
        self.assert_saved_once()


if __name__ == '__main__':
    unittest.main(verbosity=2)
