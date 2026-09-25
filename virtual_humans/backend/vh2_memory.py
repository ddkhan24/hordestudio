"""Deterministic long-horizon retention for source-backed VH2 memories.

The canonical world state owns the active psychology window and
``transcript_messages`` owns exact conversation.  ``memory_episodes`` is a
searchable long-horizon projection, so it must not grow forever by preserving
every ordinary meal, commute, or completed chore as an individual row.

Retention is deliberately mechanical: no model rewrites a person's past and
no synthetic summary replaces deleted evidence.  Recent routine/notable rows
remain searchable, important/tentpole/pinned rows remain exact forever, and
only stale lower-priority projection rows are removed.
"""
from __future__ import annotations

import json

DAY = 86_400_000
CLASSIFICATION_VERSION = 1

# A routine episode is useful recent texture, not permanent biography.
ROUTINE_MAX_AGE_MS = 30 * DAY
ROUTINE_MAX_ROWS = 512

# Notable episodes get a much longer working-history horizon.  Events that
# must never age out are priority 2/3 or explicitly pinned instead.
NOTABLE_MAX_AGE_MS = 365 * DAY
NOTABLE_MAX_ROWS = 2048

PRIORITY_LABELS = {0: 'routine', 1: 'notable', 2: 'important', 3: 'tentpole'}

SCHEMA = '''
CREATE TABLE IF NOT EXISTS memory_episode_retention (
 world_id TEXT NOT NULL, id TEXT NOT NULL,
 priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 3),
 pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
 basis TEXT NOT NULL, classification_version INTEGER NOT NULL,
 PRIMARY KEY(world_id,id),
 FOREIGN KEY(world_id,id) REFERENCES memory_episodes(world_id,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS memory_episode_retention_priority
 ON memory_episode_retention(world_id,priority,pinned);
'''

TENTPOLE_WORDS = (
    'birth', 'death', 'marriage', 'wedding', 'engagement', 'breakup',
    'graduat', 'milestone', 'moved_home', 'life_transition',
)
IMPORTANT_KINDS = {
    'relationship_transition', 'gift', 'major_discovery', 'major_decision',
    'check_in_outcome', 'promise_outcome', 'world_discovery',
}
NOTABLE_KINDS = {
    'missed', 'outing', 'outing_return', 'arrival', 'encounter',
    'introduction', 'shared_plan', 'health_started', 'health_recovered',
    'social_observation', 'conversation_appraisal', 'heard_statement',
    'publication', 'trip', 'travel',
}
ROUTINE_KINDS = {
    'completed', 'interrupted', 'person_action_completed',
    'person_action_interrupted', 'routine', 'meal', 'sleep', 'commute',
}


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _explicit_priority(value):
    if type(value) is int and 0 <= value <= 3:
        return value
    if isinstance(value, str):
        normalized = value.strip().casefold()
        for priority, label in PRIORITY_LABELS.items():
            if normalized == label:
                return priority
    return None


def classify_episode(episode):
    """Return ``(priority, pinned, basis)`` from saved, auditable evidence.

    A creator pin is the strongest retention instruction. Otherwise an
    explicit 0..3 ``memoryPriority``/``priority`` (or
    ``retention.priority``) wins before deterministic kind/appraisal rules.
    Unknown kinds default to notable so a future feature cannot silently
    discard an unfamiliar meaningful event.
    """
    if not isinstance(episode, dict):
        raise ValueError('Memory episode must be an object.')
    retention = episode.get('retention') if isinstance(episode.get('retention'), dict) else {}
    pinned = any(episode.get(field) is True for field in
                 ('pinned', 'memoryPinned', 'creatorPinned')) or retention.get('pinned') is True
    if pinned:
        return 3, True, 'creator_pinned'

    explicit = _explicit_priority(episode.get('memoryPriority'))
    if explicit is None:
        explicit = _explicit_priority(episode.get('priority'))
    if explicit is None:
        explicit = _explicit_priority(retention.get('priority'))
    if explicit is not None:
        return explicit, False, 'explicit_priority'

    kind = str(episode.get('kind') or '').strip().casefold()
    appraisal = episode.get('appraisal') if isinstance(episode.get('appraisal'), dict) else {}
    scope = str(episode.get('truthScope') or appraisal.get('truthScope') or '').casefold()
    origin = str(episode.get('origin') or '').casefold()
    if ('author' in scope or origin in ('authored', 'authored_starter', 'creator')):
        return 3, False, 'creator_authored'
    if any(word in kind for word in TENTPOLE_WORDS):
        return 3, False, 'tentpole_kind'
    if kind in IMPORTANT_KINDS or kind == 'heard_statement' or 'relationship' in kind or scope == 'player_claim':
        return 2, False, 'important_kind'

    changes = appraisal.get('relationshipChanges')
    if isinstance(changes, dict) and any(isinstance(value, (int, float)) and value != 0
                                         for value in changes.values()):
        return 2, False, 'relationship_change'
    importance = episode.get('importance')
    if isinstance(importance, (int, float)) and not isinstance(importance, bool):
        if importance >= 90:
            return 3, False, 'importance_90'
        if importance >= 65:
            return 2, False, 'importance_65'
        if importance >= 30:
            return 1, False, 'importance_30'
    value = appraisal.get('value')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if abs(value) >= .75:
            return 2, False, 'strong_appraisal'
        if abs(value) >= .4:
            return 1, False, 'notable_appraisal'
    if kind in NOTABLE_KINDS or episode.get('sourceMessageId'):
        return 1, False, 'notable_kind'
    if kind in ROUTINE_KINDS:
        return 0, False, 'routine_kind'
    return 1, False, 'unknown_kind_safe_default'


def _upsert_metadata(db, world_id, episode_id, episode):
    priority, pinned, basis = classify_episode(episode)
    db.execute('''INSERT INTO memory_episode_retention
        (world_id,id,priority,pinned,basis,classification_version)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(world_id,id) DO UPDATE SET
          priority=excluded.priority,pinned=excluded.pinned,basis=excluded.basis,
          classification_version=excluded.classification_version
        WHERE memory_episode_retention.classification_version<excluded.classification_version''',
        (world_id, episode_id, priority, int(pinned), basis, CLASSIFICATION_VERSION))
    return priority, pinned, basis


def store_episode(db, world_id, episode, revision):
    """Insert one immutable memory projection and its indexed retention flag."""
    ident = episode['id']
    db.execute('''INSERT OR IGNORE INTO memory_episodes
        (world_id,id,sequence,at,summary,data) VALUES (?,?,?,?,?,?)''',
        (world_id, ident, revision, episode['at'], episode['summary'], encode(episode)))
    row = db.execute('SELECT data FROM memory_episodes WHERE world_id=? AND id=?',
                     (world_id, ident)).fetchone()
    if row is None:
        raise RuntimeError('Memory episode was not stored.')
    return _upsert_metadata(db, world_id, ident, json.loads(row['data']))


def ensure_metadata(db, world_id=None, limit=None):
    """Backfill/reclassify legacy rows without changing their saved payload."""
    if limit is not None and (type(limit) is not int or limit < 1):
        raise ValueError('Memory metadata batch size must be a positive integer.')
    where = ('WHERE m.world_id=? AND ' if world_id is not None else 'WHERE ')
    query = f'''SELECT m.world_id,m.id,m.data FROM memory_episodes m
        LEFT JOIN memory_episode_retention r
          ON r.world_id=m.world_id AND r.id=m.id
        {where}(r.id IS NULL OR r.classification_version<?)
        ORDER BY m.world_id,m.id''' + ('' if limit is None else ' LIMIT ?')
    params = list((world_id, CLASSIFICATION_VERSION) if world_id is not None
                  else (CLASSIFICATION_VERSION,))
    if limit is not None:
        params.append(limit)
    count = 0
    for row in db.execute(query, params):
        _upsert_metadata(db, row['world_id'], row['id'], json.loads(row['data']))
        count += 1
    return count


def retention_counts(db, world_id, ensure=True):
    if ensure:
        ensure_metadata(db, world_id)
    counts = {label: 0 for label in PRIORITY_LABELS.values()}
    pinned = 0
    for row in db.execute('''SELECT priority,pinned,COUNT(*) AS rows
        FROM memory_episode_retention WHERE world_id=?
        GROUP BY priority,pinned''', (world_id,)):
        counts[PRIORITY_LABELS[row['priority']]] += row['rows']
        if row['pinned']:
            pinned += row['rows']
    total = db.execute('SELECT COUNT(*) FROM memory_episodes WHERE world_id=?', (world_id,)).fetchone()[0]
    classified = sum(counts.values())
    return {**counts, 'pinned': pinned, 'classified': classified,
            'unclassified': max(0, total - classified), 'total': total}


def resolve_history(db, world_id, state, max_delete=None):
    """Remove stale low-priority memory projections transactionally.

    ``state`` is read only and supplies simulation time. The caller owns the
    transaction, which lets explicit service optimization combine this with
    event/media maintenance atomically. ``max_delete`` bounds background work;
    ``None`` resolves the complete eligible set during explicit optimization.
    """
    if not isinstance(state, dict) or type(state.get('simAt')) is not int:
        raise ValueError('A canonical VH2 state with simulation time is required.')
    if max_delete is not None and (type(max_delete) is not int or max_delete < 1):
        raise ValueError('Memory resolution batch size must be a positive integer.')

    classified = ensure_metadata(db, world_id, limit=max_delete)
    before = retention_counts(db, world_id, ensure=False)
    now = state['simAt']
    if max_delete is not None:
        # Background maintenance performs only indexed age expiry. It never
        # computes a window function over an unbounded history; row-count
        # resolution belongs to the explicit optimizer's maintenance window.
        candidates = db.execute('''SELECT m.id,r.priority
            FROM memory_episodes m JOIN memory_episode_retention r
              ON r.world_id=m.world_id AND r.id=m.id
            WHERE m.world_id=? AND m.at<=? AND r.pinned=0 AND (
              (r.priority=0 AND m.at<?) OR (r.priority=1 AND m.at<?)
            )
            ORDER BY m.at ASC,m.sequence ASC,m.id ASC LIMIT ?''',
            (world_id, now, now - ROUTINE_MAX_AGE_MS,
             now - NOTABLE_MAX_AGE_MS, max_delete)).fetchall()
    else:
        # Rank only episodes that have actually happened. Future-dated
        # imported evidence is never discarded as stale or allowed to crowd
        # the windows.
        candidates = db.execute('''WITH experienced AS (
              SELECT m.id,m.at,m.sequence,r.priority,r.pinned,
                ROW_NUMBER() OVER (
                  PARTITION BY r.priority ORDER BY m.at DESC,m.sequence DESC,m.id DESC
                ) AS priority_rank
              FROM memory_episodes m JOIN memory_episode_retention r
                ON r.world_id=m.world_id AND r.id=m.id
              WHERE m.world_id=? AND m.at<=?
            )
            SELECT id,priority FROM experienced
            WHERE pinned=0 AND (
              (priority=0 AND (at<? OR priority_rank>?)) OR
              (priority=1 AND (at<? OR priority_rank>?))
            )
            ORDER BY priority ASC,at ASC,sequence ASC,id ASC''',
            (world_id, now, now - ROUTINE_MAX_AGE_MS, ROUTINE_MAX_ROWS,
             now - NOTABLE_MAX_AGE_MS, NOTABLE_MAX_ROWS)).fetchall()

    deleted = {'routine': 0, 'notable': 0}
    if candidates:
        ids = [row['id'] for row in candidates]
        # Parameter-bound chunks stay below SQLite's common 999-variable cap.
        for offset in range(0, len(ids), 500):
            chunk = ids[offset:offset + 500]
            marks = ','.join('?' for _ in chunk)
            db.execute(f'DELETE FROM memory_episodes WHERE world_id=? AND id IN ({marks})',
                       (world_id, *chunk))
        for row in candidates:
            deleted[PRIORITY_LABELS[row['priority']]] += 1

    after = retention_counts(db, world_id, ensure=False)
    # Deletion is allowed only from low-priority, unpinned rows. These explicit
    # checks turn a future query/classifier regression into a rolled-back
    # maintenance failure instead of silent autobiographical loss.
    if after['important'] != before['important'] or after['tentpole'] != before['tentpole'] or after['pinned'] != before['pinned']:
        raise RuntimeError('Memory resolution attempted to alter durable memories.')
    return {
        'classifiedRows': classified,
        'before': before,
        'after': after,
        'deleted': {**{label: 0 for label in PRIORITY_LABELS.values()}, **deleted},
        'deletedRoutine': deleted['routine'],
        'deletedNotable': deleted['notable'],
        'policy': {
            'routineDays': ROUTINE_MAX_AGE_MS // DAY,
            'routineRows': ROUTINE_MAX_ROWS,
            'notableDays': NOTABLE_MAX_AGE_MS // DAY,
            'notableRows': NOTABLE_MAX_ROWS,
            'important': 'permanent',
            'tentpole': 'permanent',
            'pinned': 'permanent',
        },
    }
