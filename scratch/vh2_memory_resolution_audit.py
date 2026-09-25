"""Long-horizon VH2 memory retention audit using a temporary database only."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from test_runtime import node_executable
from virtual_humans.backend import vh2_memory
from virtual_humans.backend.vh2_runtime import WorldService


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


class MemoryResolution(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'life.sqlite'
        self.now = 1_788_764_400_000
        self.service = WorldService(self.path, node_executable(ROOT), ROOT, clock=lambda: self.now)
        created = self.service.command({
            'schemaVersion': 1, 'key': str(uuid.uuid4()), 'type': 'create', 'name': 'Resolution Audit'
        })
        self.world = created['worldId']
        with self.service.connect() as db:
            db.executescript(vh2_memory.SCHEMA)

    def tearDown(self):
        self.service.close()
        self.temp.cleanup()

    def episode(self, ident, kind, at, summary, **extra):
        return {'id': ident, 'kind': kind, 'at': at, 'summary': summary, **extra}

    @staticmethod
    def transcript_digest(db, world):
        digest = hashlib.sha256()
        for row in db.execute('SELECT position,data FROM transcript_messages WHERE world_id=? ORDER BY position',
                              (world,)):
            digest.update(str(row['position']).encode())
            digest.update(row['data'].encode())
        return digest.hexdigest()

    def query(self, text):
        projection = self.service.projection(self.world)
        state = json.loads(canonical(projection['state']))
        state['communication']['messages'] = [{
            'id': 'retention-query', 'role': 'user', 'text': text,
            'readAt': self.now, 'awaitingReply': True,
        }]
        return self.service.recall(self.world, projection['revision'], state)

    def test_priority_contract(self):
        classify = vh2_memory.classify_episode
        self.assertEqual(classify({'kind': 'completed', 'priority': 3})[:2], (3, False))
        self.assertEqual(classify({'kind': 'completed', 'memoryPriority': 0, 'pinned': True})[:2], (3, True))
        self.assertEqual(classify({'kind': 'heard_statement', 'appraisal': {'truthScope': 'player_claim'}})[0], 2)
        self.assertEqual(classify({'kind': 'relationship_transition'})[0], 2)
        self.assertEqual(classify({'kind': 'wedding_anniversary'})[0], 3)
        self.assertEqual(classify({'kind': 'completed'})[0], 0)
        self.assertEqual(classify({'kind': 'future_feature_event'})[0], 1)

    def test_new_episode_is_indexed_with_priority_immediately(self):
        episode = self.episode('new-pinned-memory', 'completed', self.now,
                               'Creator-pinned ordinary-looking moment.', pinned=True)
        with self.service.connect() as db:
            vh2_memory.store_episode(db, self.world, episode, 2)
            row = db.execute('''SELECT priority,pinned,basis FROM memory_episode_retention
                WHERE world_id=? AND id=?''', (self.world, episode['id'])).fetchone()
        self.assertEqual(dict(row), {'priority': 3, 'pinned': 1, 'basis': 'creator_pinned'})

    def test_background_batch_bounds_backfill_and_deletion(self):
        state = self.service.projection(self.world)['state']
        old = self.now - 100 * vh2_memory.DAY
        rows = []
        for index in range(600):
            episode = self.episode(f'background-dinner-{index}', 'completed', old - index,
                                   f'Had routine dinner {index}.')
            rows.append((self.world, episode['id'], 1, episode['at'], episode['summary'], canonical(episode)))
        with self.service.connect() as db:
            db.executemany('INSERT INTO memory_episodes VALUES (?,?,?,?,?,?)', rows)
            report = vh2_memory.resolve_history(db, self.world, state, max_delete=64)
            remaining = db.execute('SELECT COUNT(*) FROM memory_episodes WHERE world_id=?',
                                   (self.world,)).fetchone()[0]
        self.assertEqual(report['classifiedRows'], 64)
        self.assertEqual(report['deletedRoutine'], 64)
        self.assertEqual(report['deletedNotable'], 0)
        self.assertEqual(remaining, 536)
        self.assertEqual(self.service.projection(self.world)['state'], self.service.replay(self.world))

    def test_hundred_day_resolution_preserves_exact_history_and_recall(self):
        old = self.now - 100 * vh2_memory.DAY
        very_old = self.now - 500 * vh2_memory.DAY
        before_state = self.service.projection(self.world)['state']
        self.assertEqual(before_state, self.service.replay(self.world))

        rows = []
        # More recent routine texture than the count budget permits, plus old
        # meal detail that should not survive as individual archive rows.
        for index in range(700):
            episode = self.episode(f'recent-routine-{index}', 'completed', self.now - index,
                                   f'Finished ordinary routine {index}.')
            rows.append((self.world, episode['id'], 1, episode['at'], episode['summary'], canonical(episode)))
        for index in range(1000):
            episode = self.episode(f'old-dinner-{index}', 'completed', old - index,
                                   f'Had an ordinary dinner {index}.')
            rows.append((self.world, episode['id'], 1, episode['at'], episode['summary'], canonical(episode)))

        # Notable texture is long-lived but still bounded.
        for index in range(2200):
            episode = self.episode(f'notable-{index}', 'social_observation', self.now - index,
                                   f'Noticed ordinary social update {index}.')
            rows.append((self.world, episode['id'], 1, episode['at'], episode['summary'], canonical(episode)))
        for index in range(300):
            episode = self.episode(f'old-notable-{index}', 'social_observation', very_old - index,
                                   f'Old minor social update {index}.')
            rows.append((self.world, episode['id'], 1, episode['at'], episode['summary'], canonical(episode)))

        durable = [
            self.episode('important-lighthouse', 'major_decision', very_old,
                         'Made the Onyx lighthouse promise.', memoryPriority=2),
            self.episode('tentpole-wedding', 'wedding_milestone', very_old,
                         'Married beneath the winter stars.'),
            self.episode('creator-pinned-locket', 'completed', very_old,
                         'Found the cerulean locket.', pinned=True),
            self.episode('player-claim-orchids', 'heard_statement', very_old,
                         'Player said they cultivate silver orchids.', sourceMessageId='chat-42',
                         appraisal={'truthScope': 'player_claim', 'value': 0}),
            self.episode('relationship-bond', 'relationship_transition', very_old,
                         'The relationship became a friendship.'),
        ]
        for episode in durable:
            rows.append((self.world, episode['id'], 1, episode['at'], episode['summary'], canonical(episode)))

        with self.service.connect() as db:
            db.executemany('INSERT INTO memory_episodes VALUES (?,?,?,?,?,?)', rows)
            for position in range(1, 101):
                message = {'id': f'chat-{position}', 'role': 'user' if position % 2 else 'assistant',
                           'text': f'Exact durable chat text {position}', 'timestamp': self.now - position,
                           'playerPersonaId': before_state['communication']['personaId']}
                db.execute('INSERT INTO transcript_messages VALUES (?,?,?,?)',
                           (self.world, message['id'], position, canonical(message)))
            transcript_before = self.transcript_digest(db, self.world)
            logical_before = db.execute('''SELECT COALESCE(SUM(LENGTH(summary)+LENGTH(data)),0)
                FROM memory_episodes WHERE world_id=?''', (self.world,)).fetchone()[0]
            report = vh2_memory.resolve_history(db, self.world, before_state)
            transcript_after = self.transcript_digest(db, self.world)
            logical_after = db.execute('''SELECT COALESCE(SUM(LENGTH(summary)+LENGTH(data)),0)
                FROM memory_episodes WHERE world_id=?''', (self.world,)).fetchone()[0]

        self.assertEqual(transcript_before, transcript_after)
        self.assertEqual(report['deletedRoutine'], 1188)
        self.assertEqual(report['deletedNotable'], 452)
        self.assertEqual(report['after']['routine'], vh2_memory.ROUTINE_MAX_ROWS)
        self.assertEqual(report['after']['notable'], vh2_memory.NOTABLE_MAX_ROWS)
        self.assertEqual(report['after']['important'], 3)
        self.assertEqual(report['after']['tentpole'], 2)
        self.assertEqual(report['after']['pinned'], 1)
        self.assertGreater(logical_before, logical_after * 1.5)

        # Projection-only resolution cannot mutate the person or replay chain.
        self.assertEqual(before_state, self.service.projection(self.world)['state'])
        self.assertEqual(before_state, self.service.replay(self.world))
        self.assertFalse(any(row['id'].startswith('old-dinner-') for row in self.query('dinner')))
        self.assertIn('important-lighthouse', [row['id'] for row in self.query('Onyx lighthouse promise?')])
        self.assertIn('creator-pinned-locket', [row['id'] for row in self.query('cerulean locket?')])
        self.assertIn('player-claim-orchids', [row['id'] for row in self.query('silver orchids?')])

        # A second pass is a no-op, including metadata migration.
        with self.service.connect() as db:
            again = vh2_memory.resolve_history(db, self.world, before_state)
        self.assertEqual(again['classifiedRows'], 0)
        self.assertEqual(again['deletedRoutine'], 0)
        self.assertEqual(again['deletedNotable'], 0)
        self.assertEqual(again['before'], again['after'])

        # VACUUM demonstrates the physical reclaim that the service optimizer
        # performs after the transactional semantic resolution.
        raw = sqlite3.connect(self.path)
        try:
            raw.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            physical_before = self.path.stat().st_size
            raw.execute('VACUUM')
            physical_after = self.path.stat().st_size
        finally:
            raw.close()
        # Fresh temp stores use incremental auto-vacuum and may already return
        # every tail page on commit; the explicit rebuild must never grow it.
        self.assertLessEqual(physical_after, physical_before)
        print(json.dumps({
            'memoryRowsBefore': report['before']['total'],
            'memoryRowsAfter': report['after']['total'],
            'logicalBytesBefore': logical_before,
            'logicalBytesAfter': logical_after,
            'physicalBytesBeforeVacuum': physical_before,
            'physicalBytesAfterVacuum': physical_after,
            'durableImportantTentpolePinned': report['after']['important'] + report['after']['tentpole'],
        }, sort_keys=True))


if __name__ == '__main__':
    unittest.main(verbosity=2)
