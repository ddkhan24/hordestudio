"""Opt-in VH2 foundation. SQLite owns synthetic timelines; no provider calls.

All changes pass through transactions. VH1 databases/queues are never imported
or written here. The JS adapter is deliberately pinned to a kernel version.
"""
from __future__ import annotations
from importlib import import_module as _vh_import_module
from . import vh2_geography
from . import vh2_weather
from . import vh2_commerce
from . import vh2_visual
from . import vh2_player
from . import vh2_history
from . import vh2_episodes
from . import vh2_transport
from . import vh2_lifestyle
from . import vh2_workers
from . import vh2_media
from . import vh2_clips
from . import vh2_calls
from . import vh2_social
from . import vh2_plans
from . import vh2_agency
from . import vh2_population
from . import vh2_people
from . import vh2_relationships
from . import vh2_assets
from . import vh2_flights
from . import vh2_ticketmaster
from . import vh2_life_controls
from . import vh2_feeds
from . import vh2_exploration
from . import vh2_travel
from . import vh2_gifts
from . import vh2_transcript
from . import vh2_library
from . import vh2_conversations
from . import vh2_memory
from contextlib import contextmanager
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
import zlib
from .vh2_migration import inspect_archive
from .vh2_dialogue import DialogueQueue, SCHEMA as DIALOGUE_SCHEMA
from .vh2_provider import ProviderStore, SCHEMA as PROVIDER_SCHEMA
from .vh2_entities import entities, transitions, PROJECTION_VERSION

SCHEMA_VERSION = 1
DATABASE_VERSION = 10
KERNEL_VERSION = 'vh2-foundation-1'
QUANTUM = 300_000
MAX_BATCH = 12
EVENT_COMPRESSION_PREFIX = 'zlib-json-v1:'
MAX_EVENT_PAYLOAD_BYTES = 128 * 1024 * 1024
# The event table is a replay aid, not the canonical home for conversations,
# memories or media.  Keep a useful recent window, then replace older deltas
# with one verified state checkpoint.  This prevents cumulative arrays in a
# complex life from turning an O(days) simulation into O(days^2) disk growth.
MAX_DETAILED_EVENT_ROWS = 1024
LANDMARK_DETAILS_MAX_BYTES = 8192

ROUTINE_EVENT_KINDS = {
    'SIMULATION_ADVANCED', 'COMMUNICATION_TIME_SYNCHRONIZED',
    'WEATHER_REFRESH_REQUESTED', 'WEATHER_OBSERVED', 'WEATHER_REFRESH_FAILED',
    'WORLD_FEED_REFRESHED', 'LIFE_ADVISER_STATUS', 'ROUTE_RESOLVED',
    'DIALOGUE_QUEUED', 'DIALOGUE_LEASED', 'DIALOGUE_SUBMITTED',
    'DIALOGUE_SUPERSEDED', 'DIALOGUE_FAILED', 'HISTORY_RESOLVED',
}
MILESTONE_EVENT_KINDS = {
    'WORLD_CREATED', 'LIVES_MERGED', 'LIFE_MERGED_INTO', 'LIFE_REBOOTED',
    'KERNEL_UPGRADED', 'LIFE_SETUP_APPLIED',
}
MILESTONE_EVENT_WORDS = ('MILESTONE','MARRIAGE','ENGAGEMENT','BREAKUP','BIRTH','DEATH','GRADUAT','MOVED_HOME')
IMPORTANT_EVENT_WORDS = ('RELATIONSHIP','MEMORY','GIFT','MESSAGE','REPLY_DELIVERED','PHOTO_STORED','PHOTO_DELIVERED',
                         'SOCIAL_EXPRESSION_COMPLETED','PERSON_LIFE','PLAYER_PROFILE','CONVERSATION_OPENED')

class Conflict(ValueError):
    pass


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def encode_event_payload(value):
    """Store large immutable deltas compactly without changing their meaning."""
    raw = encode(value).encode('utf-8')
    if len(raw) > MAX_EVENT_PAYLOAD_BYTES:
        raise ValueError('VH2 event payload exceeds the 128 MB safety limit.')
    if len(raw) < 4096:
        return raw.decode('utf-8')
    packed = zlib.compress(raw, level=6)
    encoded = base64.b64encode(packed).decode('ascii')
    return EVENT_COMPRESSION_PREFIX + encoded if len(encoded) + len(EVENT_COMPRESSION_PREFIX) < len(raw) else raw.decode('utf-8')


def decode_event_payload(value):
    """Read both legacy JSON event rows and compact v1 rows."""
    if isinstance(value, bytes):
        value = value.decode('utf-8')
    if not isinstance(value, str):
        raise ValueError('Invalid VH2 event payload.')
    if not value.startswith(EVENT_COMPRESSION_PREFIX):
        if len(value.encode('utf-8')) > MAX_EVENT_PAYLOAD_BYTES:
            raise ValueError('VH2 event payload exceeds the 128 MB safety limit.')
        return json.loads(value)
    encoded=value[len(EVENT_COMPRESSION_PREFIX):]
    # A payload produced by encode_event_payload() can never need more than
    # base64's 4/3 expansion of the raw safety limit. Reject oversized input
    # before base64 decoding so a damaged/imported row cannot force a second,
    # much larger allocation ahead of the decompression bound below.
    if len(encoded)>((MAX_EVENT_PAYLOAD_BYTES+2)//3)*4+16:
        raise ValueError('VH2 event payload exceeds the 128 MB safety limit.')
    try:
        packed = base64.b64decode(encoded, validate=True)
        inflater = zlib.decompressobj()
        raw = inflater.decompress(packed, MAX_EVENT_PAYLOAD_BYTES + 1)
        if (len(raw) > MAX_EVENT_PAYLOAD_BYTES or inflater.unconsumed_tail or
                inflater.unused_data or not inflater.eof):
            raise ValueError()
        raw += inflater.flush()
        if len(raw) > MAX_EVENT_PAYLOAD_BYTES:
            raise ValueError()
        return json.loads(raw.decode('utf-8'))
    except (binascii.Error, UnicodeDecodeError, ValueError, zlib.error, json.JSONDecodeError):
        raise ValueError('Damaged compressed VH2 event payload.') from None


def delta(before, after, path=()):
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(before.keys() | after.keys()):
            if key not in after:
                result.append({'path': [*path, key], 'remove': True})
            elif key not in before:
                result.append({'path': [*path, key], 'value': after[key]})
            else:
                result.extend(delta(before[key], after[key], (*path, key)))
        return result
    return [] if before == after else [{'path': list(path), 'value': after}]


def apply_delta(state, changes):
    for change in changes:
        if not change['path']:
            state = change['value']
            continue
        parent = state
        for key in change['path'][:-1]:
            parent = parent[key]
        key = change['path'][-1]
        if change.get('remove'):
            parent.pop(key, None)
        else:
            parent[key] = change['value']
    return state


def event_priority(kind, details=None):
    """Return 0=routine, 1=notable, 2=important, 3=tentpole.

    Producers may explicitly flag a durable landmark. Unknown event kinds are
    retained as small notable metadata so a new meaningful feature is never
    silently classified as disposable simulation noise.
    """
    details=details if isinstance(details,dict) else {}
    explicit=details.get('landmarkPriority')
    if type(explicit) is int and 0<=explicit<=3:return explicit
    if kind in ROUTINE_EVENT_KINDS:return 0
    if kind in MILESTONE_EVENT_KINDS or any(word in kind for word in MILESTONE_EVENT_WORDS):return 3
    if any(word in kind for word in IMPORTANT_EVENT_WORDS):return 2
    return 1


def compact_landmark_details(value, depth=0):
    """Keep descriptive metadata, never another embedded state snapshot."""
    if value is None or type(value) in (bool,int,float):return value
    if isinstance(value,str):return value[:600]
    if depth>=3:return None
    if isinstance(value,list):
        result=[]
        for item in value[:20]:
            compact=compact_landmark_details(item,depth+1)
            if compact is not None:result.append(compact)
        return result
    if isinstance(value,dict):
        omitted={'snapshot','state','changes','entityChanges','request','response','prompt','promptPreview'}
        result={}
        for key in sorted(value):
            if key in omitted or not isinstance(key,str):continue
            compact=compact_landmark_details(value[key],depth+1)
            if compact is not None:result[key[:100]]=compact
            if len(encode(result).encode())>LANDMARK_DETAILS_MAX_BYTES:
                result.pop(key[:100],None);break
        return result
    return None


def event_landmark(kind, at, details=None):
    details=details if isinstance(details,dict) else {}
    priority=event_priority(kind,details)
    if not priority:return None
    explicit=details.get('landmarkSummary')
    summary=(explicit.strip()[:240] if isinstance(explicit,str) and explicit.strip()
             else kind.replace('_',' ').strip().title()[:240])
    compact=compact_landmark_details(details)
    if isinstance(compact,dict):
        compact.pop('landmarkPriority',None);compact.pop('landmarkSummary',None)
    return {'at':at,'kind':kind,'priority':priority,'summary':summary,'details':compact or {}}


def store_event_landmark(db, world_id, seq, kind, at, details=None):
    landmark=event_landmark(kind,at,details)
    if landmark:
        db.execute('INSERT OR IGNORE INTO event_landmarks VALUES (?,?,?,?,?,?,?)',
                   (world_id,seq,landmark['at'],landmark['kind'],landmark['priority'],
                    landmark['summary'],encode(landmark['details'])))
    return landmark


@contextmanager
def exclusive_storage_file_lock(database_path):
    """Best-effort cross-process gate for destructive SQLite maintenance."""
    lock_path=Path(str(database_path)+'.maintenance.lock')
    descriptor=os.open(lock_path,os.O_CREAT|os.O_RDWR,0o600)
    try:
        try:
            import fcntl
            fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except ImportError:
            # SQLite's own exclusive lock remains the fallback on platforms
            # without POSIX flock support.
            pass
        except BlockingIOError:
            raise Conflict('Another process is maintaining this life database.') from None
        yield
    finally:
        try:
            if 'fcntl' in locals():fcntl.flock(descriptor,fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def compact_event_history(db, world_id, revision, state, kernel_version, max_rows=MAX_DETAILED_EVENT_ROWS):
    """Bound internal replay history without deleting user-visible history.

    The first event is retained for migration/repair evidence.  The current
    canonical state becomes a root checkpoint at the current sequence.  New
    detailed events continue from there, so replay remains exact while
    transcript, memories, media and all other durable projection tables are
    untouched.
    """
    row_count = db.execute('SELECT COUNT(*) FROM events WHERE world_id=?', (world_id,)).fetchone()[0]
    if row_count <= max_rows:
        return None
    first = db.execute(
        'SELECT world_id,seq,at,kind,payload FROM events WHERE world_id=? ORDER BY seq LIMIT 1',
        (world_id,),
    ).fetchone()
    if first is None or first['seq'] == revision:
        return None
    # Preserve the shape of the old life at human resolution before removing
    # low-level deltas. This reads only indexed event metadata, not payloads.
    for row in db.execute('SELECT seq,at,kind FROM events WHERE world_id=? ORDER BY seq',(world_id,)):
        store_event_landmark(db,world_id,row['seq'],row['kind'],row['at'])
    checkpoint = {
        'schemaVersion': SCHEMA_VERSION,
        'kernelVersion': kernel_version,
        'changes': [{'path': [], 'value': state}],
        'details': {
            'synthetic': True,
            'historyCheckpoint': True,
            'compactedEventCount': row_count,
            'firstSequence': first['seq'],
            'sourceRevision': revision,
        },
    }
    # SQLite schema changes are transactional.  The delete guard is restored
    # before this transaction can commit, and a rollback restores it too.
    db.execute('DROP TRIGGER IF EXISTS events_no_delete')
    try:
        db.execute('DELETE FROM events WHERE world_id=?', (world_id,))
        db.execute('INSERT INTO events VALUES (?,?,?,?,?)', tuple(first))
        db.execute(
            'INSERT INTO events VALUES (?,?,?,?,?)',
            (world_id, revision, state['simAt'], 'HISTORY_CHECKPOINT', encode_event_payload(checkpoint)),
        )
    finally:
        db.execute('''CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
            BEGIN SELECT RAISE(ABORT, 'World events are append-only'); END''')
    replayed={}
    for row in db.execute('SELECT payload FROM events WHERE world_id=? ORDER BY seq',(world_id,)):
        replayed=apply_delta(replayed,decode_event_payload(row[0])['changes'])
    if replayed!=state:
        raise RuntimeError('Event checkpoint verification failed; original ledger was not changed.')
    return {'before': row_count, 'after': 2, 'revision': revision}


def compact_photo_capture_history(db, world_states):
    """Rewrite legacy capture documents to the minimal immutable image input.

    The photo snapshot trigger protects ordinary application writes. Explicit
    storage maintenance may replace only the representation, and active
    captures are compiled before and after to prove prompt/reference/request
    equivalence before the transaction can commit.
    """
    before_bytes=db.execute('SELECT COALESCE(SUM(LENGTH(snapshot)),0) FROM photo_jobs').fetchone()[0]
    prepared=[];verified=0
    verification_config={'model':'vh2-storage-equivalence','maxReferences':20,'provider':'openrouter'}
    photos={world_id:{item.get('id'):item for item in state.get('photos',[]) if isinstance(item,dict)}
            for world_id,state in world_states.items()}

    def compiled(world_id,state,snapshot,photo):
        try:
            request,hashes,reference_ids=vh2_workers.compile_image(
                db,world_id,state,snapshot,verification_config,photo
            )
            return ('compiled',request,hashes,reference_ids)
        except ValueError as error:
            # An unfinished capture may intentionally be waiting for a missing
            # approved reference. Its exact pre-existing failure is semantic too.
            return ('rejected',type(error).__name__,str(error))

    # Stream legacy documents one at a time; a real long-running life can have
    # hundreds of megabytes here and maintenance must not duplicate all of it
    # in process memory before doing useful work.
    for row in db.execute('SELECT id,world_id,snapshot FROM photo_jobs ORDER BY world_id,id'):
        old=json.loads(row['snapshot'])
        compact=vh2_media.compact_capture_snapshot(old)
        encoded=encode(compact)
        if encoded==row['snapshot']:continue
        state=world_states.get(row['world_id'])
        photo=photos.get(row['world_id'],{}).get(row['id'])
        if state is None:raise RuntimeError('A photo capture refers to a missing life.')
        if photo is None:
            archived=db.execute("SELECT data FROM media_records WHERE world_id=? AND kind='photo' AND id=?",
                                (row['world_id'],row['id'])).fetchone()
            if archived:photo=json.loads(archived['data'])
        if photo and photo.get('status') in ('captured','submitted'):
            if compiled(row['world_id'],state,old,photo)!=compiled(row['world_id'],state,compact,photo):
                raise RuntimeError('Photo snapshot compaction changed an active image request; no storage changes were committed.')
            verified+=1
        prepared.append((encoded,row['id'],row['world_id']))

    if prepared:
        db.execute('DROP TRIGGER IF EXISTS photo_snapshot_immutable')
        try:
            db.executemany('UPDATE photo_jobs SET snapshot=? WHERE id=? AND world_id=?',prepared)
        finally:
            db.execute('''CREATE TRIGGER IF NOT EXISTS photo_snapshot_immutable BEFORE UPDATE ON photo_jobs
                BEGIN SELECT RAISE(ABORT,'Photo captures are immutable'); END''')
    after_bytes=db.execute('SELECT COALESCE(SUM(LENGTH(snapshot)),0) FROM photo_jobs').fetchone()[0]
    return {'beforeBytes':before_bytes,'afterBytes':after_bytes,
            'bytesReduced':max(0,before_bytes-after_bytes),'rowsCompacted':len(prepared),
            'activeRowsVerified':verified}


class WorldService:
    def __init__(self, path, node, app_dir, clock=None):
        self.path, self.node, self.app_dir = Path(path), node, Path(app_dir)
        sources = ['vh2-geography-engine.js','vh2-kernel-worker.js','vh-simulation-core.js','vh-activity-engine.js',
                   'vh2-story-engine.js','vh2-story-policy.json','vh2-profile-fields.json','vh-world-engine.js','vh-conversation-engine.js','vh-embodiment-library.js','vh-embodiment-engine.js','vh-cognition-engine.js','vh-mind-library.js','vh-mind-engine.js','vh2-decision-engine.js','vh2-communication-engine.js','vh2-psychology-engine.js','vh2-health-engine.js','vh2-followthrough-engine.js','vh2-presence-engine.js','vh2-plans-engine.js','vh2-agency-engine.js','vh2-npc-travel.js','vh2-social-bonds.js','vh2-population-engine.js','vh2-people-engine.js','vh2-network-engine.js','vh2-institutions-engine.js','vh2-relationship-lifecycle.js','vh2-travel-engine.js','vh2-exploration-engine.js','vh2-lifestyle-engine.js','vh2-transport-engine.js','vh2-episodes-engine.js']
        self.kernel_sources=['virtual_humans/engine/'+name for name in sources]
        self.source_fingerprint=self.kernel_fingerprint()
        self.kernel_version = KERNEL_VERSION + ':' + self.source_fingerprint
        self.clock = clock or (lambda: int(time.time()*1000))
        self._stop = threading.Event()
        self._worker_lock=threading.Lock();self._worker_pending={};self._worker_pool=None
        self._storage_lock=threading.Lock()
        self._storage_optimizing=False;self._storage_owner=None
        self.route_executor=None;self.image_executor=vh2_workers.image_transport
        self._feed_lock = threading.Lock()
        self._thread = None
        self._dialogue_thread = None
        self.dialogue_error = ''
        self.dialogue = DialogueQueue(self, Conflict)
        self.dialogue_provider = ProviderStore(self)
        self.last_error = ''
        self.maintenance_health = {}
        self.storage_last_compaction = None
        self.storage_last_memory_resolution = None
        self._last_memory_maintenance_at = 0
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, DATABASE_VERSION):
                raise ValueError('Unsupported VH2 database version; preserve it and upgrade the application.')
            # Fresh databases support incremental page reclamation. Freed pages
            # are immediately reusable; the explicit verified optimiser returns
            # them to the filesystem. Existing stores switch mode there too.
            if version == 0 and not db.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").fetchone():
                db.execute('PRAGMA auto_vacuum=INCREMENTAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS worlds (
                    id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    world_id TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL,
                    kind TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(world_id,seq), FOREIGN KEY(world_id) REFERENCES worlds(id));
                CREATE TABLE IF NOT EXISTS commands (
                    key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs (
                    world_id TEXT PRIMARY KEY, due_at INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY(world_id) REFERENCES worlds(id));
                CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
                BEGIN SELECT RAISE(ABORT, 'World events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
                BEGIN SELECT RAISE(ABORT, 'World events are append-only'); END;
                CREATE TABLE IF NOT EXISTS event_landmarks (
                    world_id TEXT NOT NULL REFERENCES worlds(id), seq INTEGER NOT NULL,
                    at INTEGER NOT NULL, kind TEXT NOT NULL, priority INTEGER NOT NULL,
                    summary TEXT NOT NULL, details TEXT NOT NULL,
                    PRIMARY KEY(world_id,seq));
                CREATE INDEX IF NOT EXISTS event_landmarks_time
                    ON event_landmarks(world_id,priority,at);
                CREATE TRIGGER IF NOT EXISTS event_landmarks_no_update BEFORE UPDATE ON event_landmarks
                BEGIN SELECT RAISE(ABORT, 'Life landmarks are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS event_landmarks_no_delete BEFORE DELETE ON event_landmarks
                BEGIN SELECT RAISE(ABORT, 'Life landmarks are immutable'); END;
                CREATE TABLE IF NOT EXISTS checkpoints (
                    id TEXT PRIMARY KEY, source_text TEXT NOT NULL, report TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TRIGGER IF NOT EXISTS checkpoints_no_update BEFORE UPDATE ON checkpoints
                BEGIN SELECT RAISE(ABORT, 'Source checkpoints are immutable'); END;
                CREATE TABLE IF NOT EXISTS entity_views (
                    world_id TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL,
                    revision INTEGER NOT NULL, projection_version INTEGER NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY(world_id,kind,entity_id), FOREIGN KEY(world_id) REFERENCES worlds(id));
                CREATE TABLE IF NOT EXISTS kernel_checkpoints (
                    id TEXT PRIMARY KEY, world_id TEXT NOT NULL, revision INTEGER NOT NULL,
                    state TEXT NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id));
                CREATE TRIGGER IF NOT EXISTS kernel_checkpoints_no_update BEFORE UPDATE ON kernel_checkpoints
                BEGIN SELECT RAISE(ABORT, 'Kernel checkpoints are immutable'); END;
                CREATE TABLE IF NOT EXISTS memory_episodes (
                    world_id TEXT NOT NULL REFERENCES worlds(id), id TEXT NOT NULL,
                    sequence INTEGER NOT NULL, at INTEGER NOT NULL, summary TEXT NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY(world_id,id));
                CREATE INDEX IF NOT EXISTS memory_episodes_time ON memory_episodes(world_id,at);
            ''')
            db.executescript(vh2_media.SCHEMA)
            db.executescript(DIALOGUE_SCHEMA)
            db.executescript(PROVIDER_SCHEMA)
            db.executescript(vh2_transcript.SCHEMA)
            db.executescript(vh2_memory.SCHEMA)
            db.executescript(vh2_library.SCHEMA)
            # Versions before 9 kept media/transcript history only inside each
            # world JSON document. Backfill those projection tables once during
            # migration. Version 9 and later are maintained transactionally by
            # commit_event(); reparsing every multi-megabyte active state on
            # every launcher start added pure startup cost and no new data.
            if version < 9:
                for row in db.execute('SELECT id,state FROM worlds').fetchall():
                    old=json.loads(row['state']);vh2_library.index(db,row['id'],'photo',old.get('photos',[]));vh2_library.index(db,row['id'],'post',old.get('social',{}).get('posts',[]))
                for row in db.execute('SELECT id,state FROM worlds').fetchall():
                    vh2_transcript.index(db,row['id'],json.loads(row['state']).get('communication',{}).get('messages',[]))
            db.executescript(_vh_import_module('.vh2_social_worker',__package__).SCHEMA)
            db.executescript(_vh_import_module('.vh2_story',__package__).SCHEMA)
            db.executescript(vh2_workers.SCHEMA)
            db.executescript(vh2_flights.SCHEMA)
            db.executescript(vh2_ticketmaster.SCHEMA)
            db.execute("UPDATE vh2_provider_jobs SET status='unknown',error='Host restarted after submission; do not automatically retry.' WHERE status='submitted'")
            db.execute(f'PRAGMA user_version={DATABASE_VERSION}')
            db.execute('DROP INDEX IF EXISTS one_active_dialogue_v2')
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_active_dialogue_v3 ON dialogue_jobs(world_id) WHERE status IN ('queued','leased','submitted')")
            if version < 9:
                for row in db.execute('SELECT id,revision,state FROM worlds').fetchall():
                    saved=json.loads(row['state'])
                    if not saved.get('mergedInto') and saved['kernelVersion']==self.kernel_version:
                        vh2_social.repair_starter_duplicates(self,db,row['id'],row['revision'],saved)
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self):
        if self._storage_optimizing and threading.get_ident()!=self._storage_owner:
            raise Conflict('Life storage maintenance is in progress. Try again when it finishes.')
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        # auto_vacuum must be selected before WAL creates the first database
        # pages.  Setting it later is silently ignored by SQLite, which left
        # fresh installations able to reuse freed pages but unable to return
        # them to disk during background resolution.
        if not db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").fetchone():
            db.execute('PRAGMA auto_vacuum=INCREMENTAL')
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA synchronous=FULL')
        try:
            with db:
                yield db
        finally:
            db.close()

    def kernel_fingerprint(self):
        return hashlib.sha256(b''.join((self.app_dir/name).read_bytes() for name in self.kernel_sources)).hexdigest()[:16]

    def kernel(self, payload):
        if not self.node:
            raise ValueError('Node.js is required for the VH2 simulation.')
        if self.kernel_fingerprint()!=self.source_fingerprint:
            raise Conflict('Engine files changed; restart the local service before upgrading this test world.')
        proc = subprocess.run([self.node, str(self.app_dir/'virtual_humans/engine/vh2-kernel-worker.js')],
            input=encode(payload), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, cwd=self.app_dir)
        if proc.returncode:
            raise RuntimeError('VH2 kernel failed: '+proc.stderr[:500])
        if self.kernel_fingerprint()!=self.source_fingerprint:
            raise Conflict('Engine files changed during this step; no state was committed.')
        result = json.loads(proc.stdout)
        if result['kernelVersion'] != KERNEL_VERSION:
            raise Conflict('VH2 kernel version mismatch; migration required.')
        return result

    @staticmethod
    def read(db, world_id):
        row = db.execute('SELECT * FROM worlds WHERE id=?', (world_id,)).fetchone()
        if not row:
            raise ValueError('Unknown VH2 world')
        return row['revision'], json.loads(row['state'])

    def commit_event(self, db, world_id, revision, before, after, kind, details=None):
        scoped_after=after
        scoped_persona=after.get('_conversationBinding',{}).get('personaId')
        before = vh2_conversations.canonical(before)
        after = vh2_conversations.canonical(after)
        revision += 1
        vh2_people.prepare(after)
        _vh_import_module('.vh2_calendar',__package__).prepare(after)
        vh2_visual.synchronize(after)
        vh2_transcript.persist(db,world_id,after)
        vh2_library.persist(db,world_id,after)
        for episode in after.get('truth',{}).get('companion',{}).get('vh2Psychology',{}).get('episodes',[]):
            episode.setdefault('sourceSequence',revision)
        payload = {'schemaVersion': SCHEMA_VERSION, 'kernelVersion': self.kernel_version,
                   'changes': delta(before, after), 'details': {**(details or {}), 'entityChanges':transitions(before,after)}}
        db.execute('INSERT INTO events VALUES (?,?,?,?,?)',
                   (world_id, revision, after['simAt'], kind, encode_event_payload(payload)))
        store_event_landmark(db,world_id,revision,kind,after['simAt'],details)
        db.execute('UPDATE worlds SET revision=?,state=? WHERE id=?', (revision,encode(after),world_id))
        self.index_entities(db,world_id,revision,after)
        prior_ids={e['id'] for e in before.get('truth',{}).get('companion',{}).get('vh2Psychology',{}).get('episodes',[])}
        for episode in after['truth']['companion'].get('vh2Psychology',{}).get('episodes',[]):
            if episode['id'] not in prior_ids:
                vh2_memory.store_episode(db,world_id,episode,revision)
        # The next wakeup is committed with the state, not held only in memory.
        if after['running']:
            due = after['wallAnchor'] + self.next_boundary(after) - after['simAnchor']
            db.execute('INSERT OR REPLACE INTO jobs VALUES (?,?,?)', (world_id,due,''))
        else:
            db.execute('DELETE FROM jobs WHERE world_id=?', (world_id,))
        if scoped_persona:
            saved=vh2_conversations.view(after,scoped_persona)
            scoped_after.clear();scoped_after.update(saved)
        return revision

    @staticmethod
    def index_entities(db,world_id,revision,state):
        records=entities(state)
        db.execute('DELETE FROM entity_views WHERE world_id=?',(world_id,))
        db.executemany('INSERT INTO entity_views VALUES (?,?,?,?,?,?)',
            [(world_id,r['kind'],r['id'],revision,PROJECTION_VERSION,encode(r['data'])) for r in records])

    def entity_projection(self,world_id):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            revision,state=self.read(db,world_id)
            rows=db.execute('SELECT * FROM entity_views WHERE world_id=? ORDER BY kind,entity_id',(world_id,)).fetchall()
            if not rows or any(r['revision']!=revision or r['projection_version']!=PROJECTION_VERSION for r in rows):
                self.index_entities(db,world_id,revision,state)
                rows=db.execute('SELECT * FROM entity_views WHERE world_id=? ORDER BY kind,entity_id',(world_id,)).fetchall()
            return {'worldId':world_id,'revision':revision,'projectionVersion':PROJECTION_VERSION,
                    'entities':[{'kind':r['kind'],'id':r['entity_id'],'data':json.loads(r['data'])} for r in rows]}

    def kernel_checkpoint(self,checkpoint_id):
        with self.connect() as db:
            row=db.execute('SELECT world_id,revision,state FROM kernel_checkpoints WHERE id=?',(checkpoint_id,)).fetchone()
            if row is None:raise ValueError('Unknown kernel checkpoint')
            return {'worldId':row['world_id'],'revision':row['revision'],'state':json.loads(row['state'])}

    def checkpoint(self,text,expected_digest):
        report=inspect_archive(text)
        if report['archiveDigest']!=expected_digest:
            raise Conflict('Archive changed since preview; inspect it again.')
        if not report['canCheckpoint']:
            raise ValueError('Remove credential-bearing fields before saving a checkpoint.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR IGNORE INTO checkpoints VALUES (?,?,?,?)',
                (report['archiveDigest'],text,encode(report),self.clock()))
            return {'checkpointId':report['archiveDigest'],'report':report,'activated':False}

    def checkpoints(self):
        with self.connect() as db:
            return [{'checkpointId':r['id'],'createdAt':r['created_at'],'report':json.loads(r['report'])}
                    for r in db.execute('SELECT id,created_at,report FROM checkpoints ORDER BY created_at DESC')]

    def checkpoint_source(self,checkpoint_id):
        with self.connect() as db:
            row=db.execute('SELECT source_text FROM checkpoints WHERE id=?',(checkpoint_id,)).fetchone()
            if row is None:raise ValueError('Unknown source checkpoint')
            return row[0]

    def command(self, body):
        if not isinstance(body, dict) or body.get('schemaVersion') != SCHEMA_VERSION:
            raise ValueError('schemaVersion: 1 is required')
        key = body.get('key')
        if not isinstance(key,str) or not 1 <= len(key) <= 128:
            raise ValueError('A command idempotency key is required')
        fingerprint = hashlib.sha256(encode(body).encode()).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM commands WHERE key=?',(key,)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint:
                    raise Conflict('Idempotency key reused for different command')
                return json.loads(previous['response'])
            kind = body.get('type')
            if kind in ('create','create_profile'):
                name = body.get('name', '')
                if not isinstance(name,str) or not name.strip() or len(name)>80:
                    raise ValueError('Name must contain 1–80 characters')
                # Creation is synthetic, not a lossy import of arbitrary VH1 fields.
                companion_id=body.get('companionId')
                if kind=='create_profile' and isinstance(companion_id,str) and companion_id:
                    existing=db.execute("SELECT id,revision FROM worlds WHERE json_extract(state,'$.integration.sourceCompanionId')=? AND json_extract(state,'$.mergedInto') IS NULL ORDER BY rowid LIMIT 1",(companion_id,)).fetchone()
                    if existing:
                        response={'worldId':existing['id'],'revision':existing['revision'],'reused':True}
                        db.execute('INSERT INTO commands VALUES (?,?,?)',(key,fingerprint,encode(response)));return response
                world_id = str(uuid.uuid5(uuid.NAMESPACE_URL, 'horde-vh2:'+key))
                now = self.clock()
                initial = self.kernel({'create':True,'entityId':world_id+':human','name':name.strip(),'now':now})
                if kind=='create_profile':
                    profile=body.get('profile');scope=body.get('providerScope');persona=body.get('personaId')
                    defer_advance=body.get('deferAdvance',False)
                    if type(defer_advance) is not bool:raise ValueError('deferAdvance must be boolean')
                    if not isinstance(profile,dict) or len(encode(profile).encode())>2_000_000:raise ValueError('A bounded character profile is required.')
                    # The same authored-field bounds apply at creation and edit.
                    # No private/runtime conversation data is imported here.
                    from . import vh2_profile
                    for field in vh2_profile.FIELDS:
                        if field in profile:vh2_profile.validate(field,profile[field])
                    if not isinstance(scope,str) or not scope.startswith('horde:') or len(scope)>120:raise ValueError('A Horde provider binding is required.')
                    if not isinstance(persona,str) or not 1<=len(persona)<=100:raise ValueError('A timeline persona identity is required.')
                    if not isinstance(profile.get('lifeProfile'),dict):raise ValueError('An active life profile is required.')
                    candidate={'simAt':now,'truth':{'companion':{**profile,'id':world_id+':human','name':name.strip()}}}
                    _vh_import_module('.vh2_calendar',__package__).prepare_ages(candidate)
                    initial=self.kernel({'profile':profile,'calendarAges':candidate['truth']['companion'].get('vh2Calendar'),'create':True,'deferAdvance':defer_advance,'entityId':world_id+':human','name':name.strip(),'now':now})

                state = {'schemaVersion':SCHEMA_VERSION,'kernelVersion':self.kernel_version,
                         'simAt':now,'simAnchor':now,'wallAnchor':now,'running':False,
                         'truth':initial,'beliefs':[],'memories':[],'playerKnowledge':[],
                         'communication':{'personaId':world_id+':player','messages':[],'nextAt':None}}
                if kind=='create_profile':
                    state['integration']={'providerScope':scope,'autoReplies':False,'source':'horde_profile','sourceCompanionId':str(body.get('companionId',''))[:100]}
                    state['communication']['personaId']=persona
                    companion=state['truth']['companion']
                    opening=str(companion.get('openingMessage','')).strip()
                    defer_opening=body.get('deferOpening',False)
                    if type(defer_opening) is not bool:raise ValueError('deferOpening must be boolean')
                    if not defer_opening and companion.get('openingMode')=='vh_first' and opening:
                        companion.setdefault('continuityRuntime',{})['originScenarioConsumedAt']=now
                        opener_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-authored-opening:'+world_id+':'+persona))
                        self.apply_reply(state,opener_id,opening,[],'authored_opening',1)
                calendar=state['truth']['companion']['lifeProfile'].get('personalCalendar')
                if calendar is not None:
                    state['truth']['companion']['lifeProfile']['personalCalendar']=_vh_import_module('.vh2_calendar',__package__).validate_personal(calendar,state['truth']['companion'],_vh_import_module('.vh2_calendar',__package__).local_datetime(state).date())
                db.execute('CREATE TABLE IF NOT EXISTS vh2_controls (id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL)')
                pause=db.execute('SELECT paused FROM vh2_controls WHERE id=1').fetchone()
                if pause and pause[0]:state['truth']['companion']['vh2AutonomyPaused']=True
                db.execute('INSERT INTO worlds VALUES (?,?,?)',(world_id,0,'{}'))
                revision = self.commit_event(db,world_id,0,{},state,'WORLD_CREATED',{'synthetic':kind=='create','profileCopy':kind=='create_profile'})
            elif kind in ('set_running','advance','configure_decisions','configure_life_expression','upgrade_kernel','receive_message','stage_reply','deliver_reply','queue_dialogue','dismiss_unknown_dialogue','configure_auto_replies','configure_psychology','configure_conversation_appraisal','configure_relationship_learning','dismiss_check_in','capture_photo','capture_reference','submit_photo','abandon_photo','import_photo',*vh2_conversations.COMMANDS,*vh2_clips.COMMANDS,*vh2_calls.COMMANDS,*vh2_social.COMMANDS,*vh2_plans.COMMANDS,*vh2_population.COMMANDS,*vh2_people.COMMANDS,*vh2_relationships.COMMANDS,*vh2_gifts.COMMANDS,*vh2_travel.COMMANDS,*vh2_assets.COMMANDS,*vh2_feeds.COMMANDS,*vh2_exploration.COMMANDS,*vh2_workers.COMMANDS,*vh2_lifestyle.COMMANDS,*vh2_transport.COMMANDS,*vh2_episodes.COMMANDS,*vh2_player.COMMANDS,*vh2_life_controls.COMMANDS,*vh2_history.COMMANDS,*vh2_geography.COMMANDS,*vh2_visual.COMMANDS,*vh2_commerce.COMMANDS):
                world_id = body.get('worldId')
                revision,state = self.read(db,world_id)
                if state.get('mergedInto'):raise Conflict('This life was merged into '+state['mergedInto']+'. Open the merged life to continue.')
                expected = body.get('expectedRevision')
                # These are new inputs, not replacements of a previously read state.
                # Apply them to the current state under this transaction; live clock
                # ticks must not starve chat or social input. Target/persona checks
                # below still apply, and the original key/body remain idempotent.
                current_input = kind in ('receive_message', 'like_post', 'comment_post')
                if type(expected) is not int or expected < 0 or expected > revision or (expected != revision and not current_input):
                    raise Conflict('World changed; refresh its projection before sending a new command')
                if kind!='upgrade_kernel' and state['kernelVersion'] != self.kernel_version:
                    raise Conflict('World requires a kernel migration')
                if body.get('conversationPersonaId'):
                    state = vh2_conversations.view(state, body['conversationPersonaId'])
                if state['communication'].get('deletedAt') and kind in ('receive_message','stage_reply','deliver_reply','queue_dialogue','start_call'):
                    raise Conflict('This chat was deleted. Choose a persona in New chat to start again.')
                if kind == 'open_conversation':
                    revision,state,conversation_persona_id,conversation_created=vh2_conversations.open_conversation(self,db,world_id,revision,state,body)
                elif kind == 'configure_contact_relationship':
                    revision,state=vh2_conversations.configure_relationship(self,db,world_id,revision,state,body)
                elif kind == 'manage_conversation':
                    revision,state=vh2_conversations.manage(self,db,world_id,revision,state,body)
                elif kind in vh2_calls.COMMANDS:
                    revision,state=vh2_calls.command(self,db,world_id,revision,state,body)
                elif kind in vh2_clips.COMMANDS:
                    revision,state=vh2_clips.command(self,db,world_id,revision,state,body)
                elif kind in vh2_life_controls.COMMANDS:
                    revision,state,checkpoint_id=vh2_life_controls.command(self,db,world_id,revision,state,body)
                elif kind=='configure_life_expression':
                    revision,state=vh2_agency.configure(self,db,world_id,revision,state,body)
                elif kind in vh2_player.COMMANDS:
                    revision,state=vh2_player.command(self,db,world_id,revision,state,body)
                elif kind in vh2_commerce.COMMANDS:
                    revision,state=vh2_commerce.command(self,db,world_id,revision,state,body)
                elif kind in vh2_geography.COMMANDS:
                    revision,state=vh2_geography.command(self,db,world_id,revision,state,body)
                elif kind in vh2_visual.COMMANDS:
                    revision,state=vh2_visual.command(self,db,world_id,revision,state,body)
                elif kind in vh2_history.COMMANDS:
                    revision,state=vh2_history.command(self,db,world_id,revision,state,body)
                elif kind in vh2_episodes.COMMANDS:
                    revision,state=vh2_episodes.command(self,db,world_id,revision,state,body)
                elif kind in vh2_transport.COMMANDS:
                    revision,state=vh2_transport.command(self,db,world_id,revision,state,body)
                elif kind in vh2_lifestyle.COMMANDS:
                    revision,state=vh2_lifestyle.command(self,db,world_id,revision,state,body)
                elif kind in vh2_workers.COMMANDS:
                    revision,state=vh2_workers.command(self,db,world_id,revision,state,body)
                elif kind in vh2_assets.COMMANDS:
                    revision,state=vh2_assets.command(self,db,world_id,revision,state,body)
                elif kind in vh2_feeds.COMMANDS:
                    revision,state=vh2_feeds.command(self,db,world_id,revision,state,body)
                elif kind in vh2_exploration.COMMANDS:
                    revision,state=vh2_exploration.command(self,db,world_id,revision,state,body)
                elif kind in vh2_travel.COMMANDS:
                    revision,state=vh2_travel.command(self,db,world_id,revision,state,body)
                elif kind in vh2_gifts.COMMANDS:
                    revision,state=vh2_gifts.command(self,db,world_id,revision,state,body)
                elif kind in vh2_relationships.COMMANDS:
                    revision,state=vh2_relationships.command(self,db,world_id,revision,state,body)
                elif kind in vh2_people.COMMANDS:
                    revision,state=vh2_people.command(self,db,world_id,revision,state,body)
                elif kind in vh2_population.COMMANDS:
                    revision,state=vh2_population.command(self,db,world_id,revision,state,body)
                elif kind in vh2_plans.COMMANDS:
                    revision,state,plan_id=vh2_plans.command(self,db,world_id,revision,state,body)
                elif kind in vh2_social.COMMANDS:
                    revision,state,post_id=vh2_social.command(self,db,world_id,revision,state,body)
                elif kind in ('capture_photo','capture_reference','submit_photo','abandon_photo','import_photo'):
                    revision,state,photo_id=vh2_media.command(self,db,world_id,revision,state,body)
                elif kind == 'dismiss_check_in':
                    after=json.loads(encode(state))
                    item=next((x for x in after['truth']['companion'].get('vh2Psychology',{}).get('checkIns',[]) if x['id']==body.get('checkInId')),None)
                    if not item or item['status'] not in ('pending','overdue'):raise Conflict('No unresolved check-in with that ID.')
                    item['status']='dismissed';item['dismissedAt']=state['simAt']
                    revision=self.commit_event(db,world_id,revision,state,after,'CHECK_IN_DISMISSED',{'checkInId':item['id']});state=after
                elif kind == 'configure_relationship_learning':
                    values=body.get('policy');bounds={'positiveStep':(0,1),'negativeStep':(0,2),'dailyLimit':(0,5),'minPositiveExchanges':(1,20),'minPositiveSpanHours':(0,168),'cooldownMinutes':(1,1440),'friendliness':(0,100),'guardedness':(0,100),'trustOpenness':(0,100),'rejectionSensitivity':(0,100)}
                    if not isinstance(values,dict) or set(values)!=set(bounds)|{'enabled'} or type(values['enabled']) is not bool:raise ValueError('Provide the complete relationship learning policy.')
                    if any(type(values[k]) not in (int,float) or not low<=values[k]<=high for k,(low,high) in bounds.items()) or type(values['minPositiveExchanges']) is not int:raise ValueError('Invalid relationship learning policy value.')
                    after=json.loads(encode(state));after['truth']['companion']['vh2Psychology']['relationshipPolicy']=values
                    revision=self.commit_event(db,world_id,revision,state,after,'RELATIONSHIP_LEARNING_POLICY_CHANGED');state=after
                elif kind == 'configure_conversation_appraisal':
                    values=body.get('policy');bounds={'emotionalImpact':(0,3),'minConfidence':(.5,1),'maxEmotionChange':(0,10)}
                    if not isinstance(values,dict) or set(values)!=set(bounds)|{'enabled'} or type(values['enabled']) is not bool:raise ValueError('Provide the complete conversation appraisal policy.')
                    if any(type(values[k]) not in (int,float) or not low<=values[k]<=high for k,(low,high) in bounds.items()):raise ValueError('Invalid conversation appraisal policy value.')
                    after=json.loads(encode(state))
                    after['truth']['companion']['vh2Psychology']['conversationPolicy']=values
                    revision=self.commit_event(db,world_id,revision,state,after,'CONVERSATION_APPRAISAL_POLICY_CHANGED');state=after
                elif kind == 'configure_psychology':
                    values=body.get('policy');bounds={'learningRate':(0,1),'experienceWeight':(0,20),'emotionalImpact':(0,3),'affectHalfLifeHours':(.25,48),'memoryLimit':(20,500)}
                    if not isinstance(values,dict) or set(values)!=set(bounds)|{'enabled'} or type(values['enabled']) is not bool:raise ValueError('Provide the complete experience policy.')
                    if any(type(values[k]) not in (int,float) or not low<=values[k]<=high for k,(low,high) in bounds.items()) or type(values['memoryLimit']) is not int:raise ValueError('Invalid experience policy value.')
                    after=json.loads(encode(state))
                    after['truth']['companion'].setdefault('vh2Psychology',{'version':1,'episodes':[],'preferences':{},'processed':[]})['policy']=values
                    revision=self.commit_event(db,world_id,revision,state,after,'EXPERIENCE_POLICY_CHANGED');state=after
                elif kind == 'configure_auto_replies':
                    if not state.get('integration'):raise ValueError('This timeline is not linked to Horde.')
                    if type(body.get('enabled')) is not bool:raise ValueError('enabled must be boolean')
                    after=json.loads(encode(state));after['integration']['autoReplies']=body['enabled']
                    revision=self.commit_event(db,world_id,revision,state,after,'AUTO_REPLIES_CHANGED');state=after
                elif kind == 'dismiss_unknown_dialogue':
                    revision,state=self.dialogue.dismiss_unknown(db,world_id,body.get('jobId'))
                elif kind == 'queue_dialogue':
                    revision,state,job_id=self.dialogue.queue(db,world_id,revision,state,body)
                elif kind in ('receive_message','stage_reply','deliver_reply'):
                    revision,state=self.communication_command(db,world_id,revision,state,body)
                elif kind == 'upgrade_kernel':
                    origin=db.execute('SELECT payload FROM events WHERE world_id=? ORDER BY seq LIMIT 1',(world_id,)).fetchone()
                    if not origin or not any(decode_event_payload(origin[0])['details'].get(k) for k in ('synthetic','profileCopy','transferCheckpoint')):
                        raise Conflict('This world has no supported kernel upgrade path.')
                    checkpoint_id=hashlib.sha256((world_id+':'+str(revision)+':'+encode(state)).encode()).hexdigest()
                    db.execute('INSERT OR IGNORE INTO kernel_checkpoints VALUES (?,?,?,?)',
                               (checkpoint_id,world_id,revision,encode(state)))
                    after=json.loads(encode(state))
                    after.update(kernelVersion=self.kernel_version,running=state['running'],wallAnchor=self.clock(),
                                 simAnchor=max(state['simAt'],self.clock()) if state['running'] else state['simAt'])
                    after.setdefault('communication',{'personaId':world_id+':player','messages':[],'nextAt':None})
                    self.evaluate(after,revision+1,life=True,inspect=True)
                    revision=self.commit_event(db,world_id,revision,state,after,'KERNEL_UPGRADED',{'checkpointId':checkpoint_id})
                    state=after
                elif kind == 'configure_decisions':
                    if state['running']:raise Conflict('Pause before changing the decision policy.')
                    policy=body.get('policy')
                    bounds={'temperature':(0,50),'exploration':(0,.25),'minHoldMinutes':(0,30),
                            'reconsiderMinutes':(1,60),'urgentHunger':(60,100),'urgentEnergy':(0,40)}
                    if not isinstance(policy,dict) or set(policy)!=set(bounds):raise ValueError('Provide all six decision policy fields.')
                    if any(type(policy[k]) not in (int,float) or not low<=policy[k]<=high for k,(low,high) in bounds.items()):
                        raise ValueError('Decision policy value outside its supported range.')
                    after=json.loads(encode(state))
                    after['truth']=self.kernel({'companion':after['truth']['companion'],'now':after['simAt'],'inspect':True,'policy':policy})
                    revision=self.commit_event(db,world_id,revision,state,after,'DECISION_POLICY_CHANGED')
                    state=after
                elif kind == 'set_running':
                    if not isinstance(body.get('running'),bool):
                        raise ValueError('running must be a boolean')
                    after = json.loads(encode(state))
                    after.update(running=body['running'],wallAnchor=self.clock(),
                                 simAnchor=max(state['simAt'],self.clock()) if body['running'] else state['simAt'])
                    revision = self.commit_event(db,world_id,revision,state,after,'WORLD_RESUMED' if body['running'] else 'WORLD_PAUSED')
                    state = after
                else:
                    if state['running']:
                        raise Conflict('Pause the experimental world before advancing it manually')
                    steps = body.get('steps')
                    if type(steps) is not int or not 1<=steps<=MAX_BATCH:
                        raise ValueError('steps must be 1–12 (five minutes each)')
                    revision,state = self.advance(db,world_id,revision,state,steps)
            else:
                raise ValueError('Unsupported VH2 command')
            if kind in ('receive_message','advance','set_running','configure_auto_replies','start_call','call_turn'):
                revision,state=self.dialogue.maybe_queue(db,world_id,revision,state)
            response = {'worldId':world_id,'revision':revision,'simAt':state['simAt']}
            if kind in vh2_plans.COMMANDS:response['planId']=plan_id
            if kind in ('upgrade_kernel','reboot_life','catch_up_life'):response['checkpointId']=checkpoint_id
            if kind=='queue_dialogue':response['jobId']=job_id
            if kind in vh2_social.COMMANDS:response['postId']=post_id
            if kind == 'open_conversation':response.update(conversationPersonaId=conversation_persona_id,created=conversation_created)
            if kind in ('capture_photo','capture_reference','submit_photo','abandon_photo','import_photo'):response['photoId']=photo_id
            if kind in ('queue_photo_render','retry_photo_render'):
                render_id=body['photoId'] if kind=='queue_photo_render' else vh2_workers.retry_photo_id(key)
                response.update(photoId=render_id,jobId='image:'+render_id,jobStatus='queued')
            db.execute('INSERT INTO commands VALUES (?,?,?)',(key,fingerprint,encode(response)))
            return response

    @staticmethod
    def next_boundary(state):
        life=state['truth'].get('nextWake',{}).get('at',state['simAt']+QUANTUM)
        base=vh2_conversations.canonical(state)
        attention=[base.get('communication',{}).get('nextAt')]+[r['roots']['communication'].get('nextAt') for r in base.get('conversations',{}).values()]
        birthday=_vh_import_module('.vh2_calendar',__package__).next_age_boundary(state)
        return min([life]+[at for at in attention+[birthday] if at and at>state['simAt']])

    def evaluate(self,state,sequence,life=False,inspect=False,contacts=True):
        if life and '_conversationBinding' in state:
            persona=state['communication']['personaId'];base=vh2_conversations.canonical(state)
            self.evaluate(base,sequence,life=True,inspect=inspect)
            scoped=vh2_conversations.view(base,persona);state.clear();state.update(scoped);return
        vh2_people.prepare(state)
        _vh_import_module('.vh2_calendar',__package__).prepare(state)
        old_wake=state['truth'].get('nextWake')
        result=self.kernel({'companion':state['truth']['companion'],'now':state['simAt'],
                            'inspect':inspect or not life,'communication':state.get('communication')})
        inbox=result.pop('communication',None)
        if not life and old_wake:result['nextWake']=old_wake
        state['truth']=result
        if inbox is not None:
            state['communication']=inbox
            psyche=result['companion'].get('vh2Psychology')
            if psyche is not None:
                for message in inbox.get('messages',[]):
                    if message.get('role')=='user' and 0<message.get('readAt',0)<=state['simAt'] and not message.get('experienceRecorded'):
                        psyche['episodes'].append({'id':'heard:'+message['id'],'at':message['readAt'],
                            'summary':'Player said (excerpt): '+message['text'][:1000],
                            'kind':'heard_statement','personaId':inbox['personaId'],'sourceMessageId':message['id'],'sourceSequence':sequence,
                            'placeId':result['present'].get('placeId'),
                            'appraisal':{'value':0,'basis':'Remembered speech, not verified world truth or inferred intent.','truthScope':'player_claim'}})
                        message['experienceRecorded']=True
                psyche['episodes']=psyche['episodes'][-psyche['policy']['memoryLimit']:]

            prior={b['messageId']:b for b in state['beliefs'] if b.get('truthScope')=='player_claim'}
            state['beliefs']=[b for b in state['beliefs'] if b.get('truthScope')!='player_claim' or b.get('personaId')!=inbox['personaId']]+[{**claim,'truthScope':'player_claim','ownerId':result['companion']['id'],
                'sourceSequence':prior.get(claim['messageId'],{}).get('sourceSequence',sequence)} for claim in inbox.get('claims',[])]
        if contacts and not state.get('_conversationBinding'):
            for persona in list(state.get('conversations',{})):
                scoped=vh2_conversations.view(state,persona)
                if not any(m.get('awaitingReply') for m in scoped['communication']['messages']) and not scoped['truth']['companion'].get('vh2Psychology',{}).get('checkIns'):continue
                self.evaluate(scoped,sequence,contacts=False)
                merged=vh2_conversations.canonical(scoped);state.clear();state.update(merged)

    def synchronize_communication(self,db,world_id,revision,state):
        if not state['running']:return revision,state
        now=state['simAnchor']+max(0,self.clock()-state['wallAnchor'])
        if now-state['simAt']>MAX_BATCH*QUANTUM:
            raise Conflict('World is catching up. Retry after the local service catches up.')
        revision,state=self.advance_until(db,world_id,revision,state,now)
        if self.next_boundary(state)<=now:raise Conflict('World still has pending boundaries.')
        if now>state['simAt']:
            after=json.loads(encode(state));after['simAt']=now
            self.evaluate(after,revision+1)
            revision=self.commit_event(db,world_id,revision,state,after,'COMMUNICATION_TIME_SYNCHRONIZED',
                                       {'communication':after['communication'].get('changes',[])})
            state=after
        return revision,state

    def apply_reply(self,state,message_id,text,ready,origin,sequence):
        inbox=state['communication'];now=state['simAt']
        call_ids={m.get('callId') for m in inbox['messages'] if m['id'] in ready and m.get('callId')}
        channel={'channel':'call','callId':next(iter(call_ids))} if len(call_ids)==1 else {}
        inbox['messages'].append({'id':message_id,'role':'assistant','text':text,
            'playerPersonaId':inbox['personaId'],
            'timestamp':now,'deliveredAt':now,'deliveryState':'delivered',
            'sourceMessageIds':ready,'origin':origin,**channel})
        for message in inbox['messages']:
            if message['id'] in ready:
                message.update(awaitingReply=False,attention={**message['attention'],'stage':'answered',
                    'nextCheckAt':0,'reason':'Reply delivered to this message.'})
        # Exact words already live in communication.messages and are indexed
        # into the durable transcript by commit_event().  Keep only the small
        # delivery marker here; duplicating reply bodies made event deltas grow
        # quadratically across long conversations.
        state['playerKnowledge'].append({'kind':'message_delivered','messageId':message_id,
            'sourceSequence':sequence,'at':now})
        state['truth']['companion']['continuityRuntime']['lastExchangeAt']=now
        inbox.pop('draft',None);inbox['nextAt']=None
        self.evaluate(state,sequence)

    def communication_command(self,db,world_id,revision,state,body):
        kind=body['type']
        if 'communication' not in state:raise Conflict('Upgrade this test world to enable communication.')
        # Never backdate incoming messages into a world still catching up after downtime.
        now=state['simAt']
        if kind!='receive_message' and state['running']:
            raise Conflict('Pause the lab world to test an offline reply. Live language delivery is not enabled yet.')
        if state['running']:
            now=state['simAnchor']+max(0,self.clock()-state['wallAnchor'])
            if now-state['simAt']>MAX_BATCH*QUANTUM:
                raise Conflict('World is catching up. Retry after the local service catches up.')
            revision,state=self.advance_until(db,world_id,revision,state,now)
            if self.next_boundary(state)<=now:
                raise Conflict('World still has pending boundaries. Retry after the local service catches up.')
        before=state
        after=json.loads(encode(state));after['simAt']=now
        inbox=after['communication'];messages=inbox['messages']
        if kind=='receive_message':
            text=body.get('text')
            if not isinstance(text,str) or not 1<=len(text.strip())<=8000:raise ValueError('Message must contain 1–8000 characters.')
            if sum(bool(m.get('awaitingReply')) for m in messages)>=100:raise Conflict('There are 100 unanswered messages. Wait for attention to catch up before sending more.')
            message_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-message:'+body['key']))
            from . import vh2_attachments
            if body.get('messageType') in ('photo','voice') and sum(bool(m.get('awaitingReply') and m.get('assetId')) for m in messages)>=4:raise Conflict('Four attachments are awaiting a reply. Wait before sending another file.')
            attachment=vh2_attachments.store(db,world_id,message_id,body)
            if attachment['type']=='call':
                call=inbox.get('call',{})
                if call.get('status')!='active' or call.get('id')!=body.get('callId') or call.get('expiresAt',0)<=now:raise Conflict('The call is not active.')
                attachment.update(channel='call',callId=call['id'])
            messages.append({'id':message_id,'role':'user',**attachment,'text':text.strip(),
                'timestamp':now,'deliveredAt':now,'readAt':0,'awaitingReply':True,'playerPersonaId':inbox['personaId']})
            self.evaluate(after,revision+1)
            event='MESSAGE_RECEIVED';details={'messageId':message_id,'receivedWallAt':self.clock(),
                                              'communication':after['communication'].get('changes',[])}
        else:
            self.evaluate(after,revision+1)
            inbox=after['communication'];messages=inbox['messages']
            ready=[m['id'] for m in messages if m.get('awaitingReply') and m.get('attention',{}).get('stage')=='ready']
            if not ready:raise Conflict('Attention is not ready to reply.')
            if kind=='stage_reply':
                text=body.get('text');sources=body.get('sourceMessageIds')
                if not isinstance(text,str) or not 1<=len(text.strip())<=8000:raise ValueError('Draft must contain 1–8000 characters.')
                if sources!=ready:raise Conflict('Draft must address the current ready message batch.')
                inbox['draft']={'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-draft:'+body['key'])),
                    'text':text.strip(),'sourceMessageIds':ready,'contextRevision':revision+1,'origin':'offline_operator'}
                event='REPLY_STAGED';details={'draftId':inbox['draft']['id']}
            else:
                draft=inbox.get('draft')
                if not draft or body.get('draftId')!=draft['id'] or draft['contextRevision']!=revision or draft['sourceMessageIds']!=ready or now!=before['simAt']:
                    raise Conflict('Reply context changed; stage a fresh draft before delivery.')
                self.apply_reply(after,draft['id'],draft['text'],ready,draft['origin'],revision+1)
                event='REPLY_DELIVERED';details={'messageId':draft['id'],'sourceMessageIds':ready}
        revision=self.commit_event(db,world_id,revision,before,after,event,details)
        return revision,after

    def advance(self, db, world_id, revision, state, steps):
        return self.advance_until(db,world_id,revision,state,state['simAt']+steps*QUANTUM)

    def advance_until(self, db, world_id, revision, state, target):
        if state['kernelVersion'] != self.kernel_version:
            raise Conflict('World requires a kernel migration')
        transitions=0
        while transitions < 60:
            now=self.next_boundary(state)
            if type(now) is not int or now<=state['simAt']:
                raise ValueError('Kernel returned an invalid next boundary')
            if now>target:break
            transitions+=1
            before = state
            state = json.loads(encode(before))
            life_due=now>=state['truth'].get('nextWake',{}).get('at',state['simAt']+QUANTUM)
            state['simAt'] = now
            self.evaluate(state,revision+1,life=life_due)
            from . import vh2_social_worker
            vh2_social_worker.draft(state)
            vh2_social.observe(state)
            agency_outcomes=vh2_agency.advance(self,db,world_id,state)
            prior_ids = {event.get('id') for event in before['truth'].get('events',[])}
            observed = [event for event in state['truth']['events'] if event.get('id') not in prior_ids]+agency_outcomes
            for outcome in observed:
                if outcome.get('kind')=='shared_plan' and state['truth']['companion']['id'] not in outcome.get('observerIds',outcome.get('participantIds',[])) and outcome.get('departedPersonId')!=state['truth']['companion']['id']:
                    continue
                if outcome.get('kind') in ('completed','project_completed','outing','outing_return','travel','arrival','encounter','introduction','relationship_transition','gift','shared_plan','capture_intent','publication','trip','world_discovery','health_started','health_recovered'):
                    state['memories'].append({'id':outcome['id'],'ownerId':world_id+':human',
                        'sourceSequence':revision+1,'experiencedAt':outcome['at'],
                        'summary':outcome['summary'],'kind':'experienced_action'})
            state['memories']=state['memories'][-100:]
            # Inspecting these records is not delivery to the player in a conversation.
            prior_sequence=before['truth']['companion'].get('vh2Decision',{}).get('sequence',0)
            decisions=[d for d in state['truth']['companion'].get('vh2Decision',{}).get('history',[]) if d['sequence']>prior_sequence]
            revision = self.commit_event(db,world_id,revision,before,state,'SIMULATION_ADVANCED',
                {'communication':state.get('communication',{}).get('changes',[]),'outcomes':observed,'decisions':decisions,'wakeReasons':before['truth'].get('nextWake',{}).get('reasons',[])})
        return revision,state

    def reconcile_live_clocks(self):
        """Repair legacy running offsets once; elapsed life still executes in bounded batches."""
        now=self.clock()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            ids=[r[0] for r in db.execute('''SELECT id FROM worlds
                WHERE json_extract(state,'$.running')=1
                AND json_extract(state,'$.mergedInto') IS NULL
                AND json_extract(state,'$.kernelVersion')=?
                AND json_extract(state,'$.simAt')<=?
                AND json_extract(state,'$.wallAnchor')-json_extract(state,'$.simAnchor')>1000''',
                (self.kernel_version,now))]
            for world_id in ids:
                revision,state=self.read(db,world_id)
                vh2_life_controls.command(self,db,world_id,revision,state,
                                          {'type':'catch_up_life','automatic':True})

    def reconcile_job_schedule(self):
        """Rebuild missing derived wakeups without editing the recorded life."""
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('''DELETE FROM jobs WHERE world_id IN (SELECT id FROM worlds
                WHERE json_extract(state,'$.running')!=1 OR json_extract(state,'$.mergedInto') IS NOT NULL)''')
            rows=db.execute('''SELECT w.id,w.state FROM worlds w LEFT JOIN jobs j ON j.world_id=w.id
                WHERE j.world_id IS NULL AND json_extract(w.state,'$.running')=1
                AND json_extract(w.state,'$.mergedInto') IS NULL
                AND json_extract(w.state,'$.kernelVersion')=?''',(self.kernel_version,)).fetchall()
            for row in rows:
                state=json.loads(row['state'])
                due=state['wallAnchor']+self.next_boundary(state)-state['simAnchor']
                db.execute('INSERT INTO jobs VALUES (?,?,?)',(row['id'],due,''))

    def run_maintenance(self,name,callback):
        """Isolate optional worker faults; retry polling, never invent provider receipts."""
        now=self.clock();prior=self.maintenance_health.get(name,{})
        if prior.get('nextAttemptAt',0)>now:return
        try:
            callback()
        except Exception as error:
            failures=prior.get('failures',0)+1
            self.maintenance_health[name]={'state':'recovering','failures':failures,
                'error':str(error)[:300],'lastFailureAt':now,
                'nextAttemptAt':now+min(300_000,5_000*2**min(failures-1,6)),
                'lastSuccessAt':prior.get('lastSuccessAt')}
        else:
            self.maintenance_health[name]={'state':'healthy','failures':0,'error':'',
                'lastSuccessAt':now,'nextAttemptAt':0,
                'lastRecoveredAt':now if prior.get('state')=='recovering' else prior.get('lastRecoveredAt')}

    def compact_due_event_history(self):
        """Checkpoint one oversized ledger and gradually return resolved pages."""
        if not self._storage_lock.acquire(blocking=False):return
        try:
            # This is bounded background housekeeping, not the destructive
            # service-wide optimiser.  Do not raise the global maintenance
            # gate: doing so rejected unrelated commands every five seconds,
            # even when no ledger or free page needed work. SQLite's write
            # transaction and busy timeout safely serialize the short update.
            with exclusive_storage_file_lock(self.path):
                report=None
                with self.connect() as db:
                    writing=False
                    row=db.execute('''SELECT world_id,COUNT(*) AS rows FROM events
                        GROUP BY world_id HAVING COUNT(*)>? ORDER BY rows DESC LIMIT 1''',
                        (MAX_DETAILED_EVENT_ROWS,)).fetchone()
                    if row:
                        db.execute('BEGIN IMMEDIATE')
                        writing=True
                        revision,state=self.read(db,row['world_id'])
                        report=compact_event_history(db,row['world_id'],revision,state,state['kernelVersion'])
                        if report:self.storage_last_compaction={'worldId':row['world_id'],**report,'at':self.clock()}
                    memory_row=None;maintenance_at=self.clock()
                    if maintenance_at-self._last_memory_maintenance_at>=300_000:
                        self._last_memory_maintenance_at=maintenance_at
                        memory_row=db.execute('''SELECT w.id,w.state FROM worlds w WHERE
                            EXISTS (SELECT 1 FROM memory_episodes m LEFT JOIN memory_episode_retention r
                                ON r.world_id=m.world_id AND r.id=m.id
                                WHERE m.world_id=w.id AND r.id IS NULL)
                            OR EXISTS (SELECT 1 FROM memory_episodes m JOIN memory_episode_retention r
                                ON r.world_id=m.world_id AND r.id=m.id WHERE m.world_id=w.id
                                AND r.pinned=0 AND ((r.priority=0 AND m.at<json_extract(w.state,'$.simAt')-?)
                                  OR (r.priority=1 AND m.at<json_extract(w.state,'$.simAt')-?)))
                            ORDER BY w.id LIMIT 1''',(vh2_memory.ROUTINE_MAX_AGE_MS,
                                                      vh2_memory.NOTABLE_MAX_AGE_MS)).fetchone()
                    if memory_row:
                        if not writing:db.execute('BEGIN IMMEDIATE')
                        memory_report=vh2_memory.resolve_history(
                            db,memory_row['id'],json.loads(memory_row['state']),max_delete=256)
                        self.storage_last_memory_resolution={'worldId':memory_row['id'],
                            **memory_report,'at':self.clock()}
                maintenance=sqlite3.connect(self.path,timeout=30)
                try:
                    if maintenance.execute('PRAGMA auto_vacuum').fetchone()[0]==2:
                        free=maintenance.execute('PRAGMA freelist_count').fetchone()[0]
                        # SQLite commonly releases one tail page per invocation
                        # even when N is supplied. A short bounded loop avoids a
                        # long maintenance stall while continuing on later ticks.
                        for _ in range(min(256,free)):
                            maintenance.execute('PRAGMA incremental_vacuum(1)')
                        if free:maintenance.execute('PRAGMA wal_checkpoint(PASSIVE)')
                finally:
                    maintenance.close()
        finally:
            self._storage_lock.release()

    def tick(self):
        from . import vh2_weather
        from . import vh2_social_worker
        for name,callback in [('storage',self.compact_due_event_history),('clock',self.reconcile_live_clocks),('scheduler',self.reconcile_job_schedule),
                              ('media',lambda:vh2_workers.poll(self)),('feeds',lambda:vh2_feeds.poll(self)),
                              ('weather',lambda:vh2_weather.poll(self)),('social',lambda:vh2_social_worker.poll(self)),('life_adviser',lambda:_vh_import_module('.vh2_story',__package__).poll(self))]:
            self.run_maintenance(name,callback)
        with self.connect() as db:
            ids = [row[0] for row in db.execute('SELECT world_id FROM jobs WHERE due_at<=? ORDER BY due_at LIMIT 8',(self.clock(),))]
        errors=[]
        for world_id in ids:
            try:
                with self.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    revision,state = self.read(db,world_id)
                    if not state['running']:
                        continue
                    target = state['simAnchor']+max(0,self.clock()-state['wallAnchor'])
                    revision,state=self.advance_until(db,world_id,revision,state,min(target,state['simAt']+MAX_BATCH*QUANTUM))
                    self.dialogue.maybe_queue(db,world_id,revision,state)
            except Exception as error:
                errors.append(world_id+': '+str(error)[:300])
                # Back off this world without blocking others. State/events remain atomic.
                with self.connect() as db:
                    db.execute('UPDATE jobs SET due_at=?,error=? WHERE world_id=?',(self.clock()+60_000,str(error)[:300],world_id))
        errors.extend(name+': '+record['error'] for name,record in list(self.maintenance_health.items())
                      if record.get('state')=='recovering')
        self.last_error='; '.join(errors)
        return errors

    def projection(self, world_id, persona_id=None):
        with self.connect() as db:
            revision,state = self.read(db,world_id)
            if state.get('mergedInto'):
                world_id=state['mergedInto'];revision,state=self.read(db,world_id)
            contacts=vh2_conversations.summaries(state)
            primary=state['communication']['personaId']
            state=vh2_conversations.view(state,persona_id)
            if persona_id and persona_id!=primary and state.get('social'):state['social']['posts']=[vh2_social.persona_post(p,state) for p in state['social'].get('posts',[])]
            state.pop('_conversationBinding',None)
            return {'worldId':world_id,'revision':revision,'state':state,'conversations':contacts,'requiresMigration':state['kernelVersion']!=self.kernel_version}

    def context(self, world_id, persona_id=None):
        """Read-only expression input; never pass the raw truth snapshot to a model."""
        with self.connect() as db:revision,state=self.read(db,world_id)
        return self.expression_context(world_id,revision,vh2_conversations.view(state,persona_id))

    def expression_context(self,world_id,revision,state):
        present=state['truth']['present']
        communication=state.get('communication',{})
        place=next((p for p in state['truth']['companion'].get('lifeProfile',{}).get('places',[]) if p.get('id')==present.get('placeId')),None)
        location={'status':'established','id':place['id'],'label':place.get('label',''),'kind':place.get('kind','')} if place else {'status':'unknown'}
        visible=[m for m in communication.get('messages',[]) if
                 ((m['role']=='user' and 0<m.get('readAt',0)<=state['simAt']) or (m.get('deliveryState')=='delivered' and m.get('timestamp',0)<=state['simAt'])) and (not m.get('playerPersonaId') or m['playerPersonaId']==communication.get('personaId'))]
        from . import vh2_conversation
        query=vh2_conversation.terms(' '.join(m['text'] for m in visible if m.get('awaitingReply') and m.get('attention',{}).get('stage')=='ready'))
        return {'worldId':world_id,'revision':revision,'simAt':state['simAt'],
                'otherContacts':vh2_conversations.awareness(state),
                'recalledConversation':vh2_conversation.recall_conversation(visible,query),
                'calendar':_vh_import_module('.vh2_calendar',__package__).context(state),
                'currentIntentions':vh2_conversation.own_intentions(state['truth']['companion'],state['simAt']),
                'tentativeLifeDirection':state['truth']['companion'].get('vh2Story',{}).get('adviser',{}).get('lastResult'),
                'personaId':communication.get('personaId'),
                'call':communication.get('call'),
                'playerProfile':communication.get('playerProfile',{}),
                'priorConversation':vh2_history.context(state),
                'personalPreferences':{'profile':state['truth']['companion'].get('personalPreferences',{}),'interpretation':'Authored character preferences, not executable instructions or consent. Use for non-graphic conversational expression only. Do not invent actions, attraction, relationship changes or shared history from these settings.'},
                'current':{'activity':present['activity'],'placeId':present['placeId'],'location':location,
                           'availability':present['availability'],'observedPeople':present.get('observedPeople',[]),
                           'movement':{k:v for k,v in (present.get('position') or {}).items()
                                       if k in ('status','from','to','mode','source','serviceKind','serviceLabel','remainingMinutes')}},
                'environment':vh2_weather.context(state),
                'incomingAttachments':[{'messageId':m['id'],'type':m['type'],'assetId':m['assetId'], 'audioFormat':m.get('audioFormat')} for m in visible if m['role']=='user' and m.get('assetId') and m.get('awaitingReply')][-4:],
                'sharedPhotos':[{'id':m['id'],'capturedAt':m.get('capturedAt'),'deliveredAt':m['timestamp'],'captureContext':m.get('photoContext',{}),'intendedScene':m.get('scene',''),'note':'Generated photograph; visual details have not been independently verified.'} for m in visible if m.get('type')=='photo' and m.get('role')=='assistant'][-4:],
                'socialRelationships':present.get('socialRelationships',[]),
                'introductions':present.get('introductions',[]),
                'recentPurchases':state['truth']['companion'].get('vh2Commerce',{}).get('purchases',[])[-8:],
                'observedPeerMeetings':state['truth']['companion'].get('vh2People',{}).get('network',{}).get('observed',[])[-8:],
                'tentativeReflections':state['truth']['companion'].get('vh2Psychology',{}).get('reflections',[])[:8],
                'institutionOutcomes':state['truth']['companion'].get('vh2Institutions',{}).get('events',[])[-8:],
                'noticedTransportUpdates':[n for n in state['truth']['companion'].get('vh2Travel',{}).get('transportNotices',[]) if n['noticedAt']>=state['simAt']-86400000][-8:],
                'ownFinances':{'currency':state['truth']['companion'].get('vh2Gifts',{}).get('currency','USD'),'balance':state['truth']['companion'].get('lifeRuntime',{}).get('world',{}).get('balance'),'unpaidExpenses':state['truth']['companion'].get('vh2Finance',{}).get('unpaid',0),'recentTransactions':state['truth']['companion'].get('vh2Finance',{}).get('ledger',[])[-8:]},
                'possessions':[{'id':i['id'],'name':i['name'],'category':i['category'],'details':i.get('possession',{})} for i in state['truth']['companion']['lifeProfile']['world']['items'] if i.get('owned') or i['id'] in state['truth']['companion']['lifeRuntime']['world']['inventory']][-40:],
                'receivedGifts':[{k:g[k] for k in ('id','kind','itemId','label','value','currency','amountMinor','receivedAt') if k in g} for g in state['truth']['companion'].get('lifeRuntime',{}).get('world',{}).get('gifts',[]) if g.get('status')=='received'][-12:],
                'sharedPlans':vh2_plans.visible_shared_plans(state['truth']['companion']),
                'ownSocialPosts':vh2_social.context(state),
                'ownClips':[{'id':clip['id'],'caption':clip.get('caption') or clip.get('concept',''),'origin':clip.get('origin'),'createdAt':clip.get('createdAt'),'scope':'Video publication metadata; not proof of events depicted.'} for clip in state.get('clips',[]) if clip.get('status')=='ready' and not clip.get('deletedAt')][-12:],
                'noticedSocialActivity':vh2_social.notifications(state),
                'knownWorldClaims':[{k:s[k] for k in ('id','title','sourceUrl','publishedAt','noticedAt','expiresAt','scope','confidence','type','startsAt','endsAt','eventStatus','placeId','locationText','score','finished','versionKey') if k in s} for s in state['truth']['companion'].get('vh2Signals',{}).get('known',[]) if s['expiresAt']>state['simAt']][-12:],
                'recentExperiences':state['memories'][-12:],
                'recalledExperiences':self.recall(world_id,revision,state),
                'knownPlayerFacts':[b for b in state['beliefs'] if b.get('truthScope')=='player_claim' and b.get('personaId')==communication.get('personaId')], 'sharedHistory':state['playerKnowledge'],
                'conversation':[{'id':m['id'],'role':m['role'],'text':m['text']} for m in visible if m in visible[-40:] or m.get('awaitingReply')],
                'readyMessageIds':[m['id'] for m in visible if
                    m.get('awaitingReply') and m.get('attention',{}).get('stage')=='ready'],
                'limits':['Player facts are self-reported claims, not verified world truth.',
                          'Unread messages and undelivered drafts are excluded. This context preview does not call a model.',
                          'Social captions are authored expression, not verified world facts. Posts with origin authored_starter are setup history, not witnessed events or shared experiences with the player. Player social interactions are not presumed noticed.']}

    def recall(self,world_id,revision,state):
        """Deterministic lexical/place retrieval of experienced events, not invented memory.
        Only committed episodes at/before this snapshot plus its in-transaction
        state are eligible. Unread messages never become retrieval queries.
        """
        import re,math,unicodedata
        from collections import Counter
        c=state['truth']['companion'];inbox=state.get('communication',{})
        read_messages=[m for m in inbox.get('messages',[]) if m.get('role')=='user' and 0<m.get('readAt',0)<=state['simAt']]
        read=[m['text'] for m in read_messages if m.get('awaitingReply')] or [m['text'] for m in read_messages[-1:]]
        stop={'what','have','been','your','that','this','with','about','there','really','hello','the','and','you','was','how','did','can','are','for','to','is','at','my','of','in','on','an','as','be','it','or','do','we','he','me','so','if','up','by'}
        def words(text):
            folded=''.join(ch for ch in unicodedata.normalize('NFKD',str(text).casefold()) if not unicodedata.combining(ch))
            return re.findall(r'[^\W_]{2,}',folded)
        def tokens(text):return set(words(text))
        # Retain the substantive end of long questions and the latest read batch.
        terms=set(list(dict.fromkeys(w for w in words(' '.join(read)) if w not in stop))[-128:])
        place=state['truth']['present'].get('placeId');persona=inbox.get('personaId')
        candidates={};stored={};frequency=Counter()
        def eligible(e):
            return (not e.get('personaId') or e['personaId']==persona) and e.get('at',0)<=state['simAt'] and e.get('sourceSequence',revision)<=revision
        # Read compact summaries, not full archived appraisal payloads. Ranking
        # considers the eligible corpus so common noise cannot bury a rare subject.
        with self.connect() as db:
            rows=db.execute("SELECT id,summary,at,sequence,json_extract(data,'$.placeId') AS place FROM memory_episodes WHERE world_id=? AND sequence<=? AND at<=? AND (json_extract(data,'$.personaId') IS NULL OR json_extract(data,'$.personaId')='' OR json_extract(data,'$.personaId')=?)",(world_id,revision,state['simAt'],persona))
            for row in rows:
                candidates[row['id']]={'id':row['id'],'summary':row['summary'],'at':row['at'],'placeId':row['place'],'sourceSequence':row['sequence']}
                stored[row['id']]=True
            for e in c.get('vh2Psychology',{}).get('episodes',[]):
                if eligible(e):candidates[e['id']]=e
            matches={ident:tokens(e['summary'])&terms for ident,e in candidates.items()}
            for words in matches.values():frequency.update(words)
            count=len(candidates)
            weights={word:math.log1p(count/(1+frequency[word])) for word in terms}
            scores={ident:sum(weights[word] for word in sorted(words))*3+int(bool(place) and candidates[ident].get('placeId')==place)*.25 for ident,words in matches.items()}
            ranked=sorted((e for ident,e in candidates.items() if scores[ident]>0),key=lambda e:(-scores[e['id']],-e['at'],e['id']))[:8]
            result=[]
            for e in ranked:
                if e['id'] in stored:
                    row=db.execute('SELECT data,sequence FROM memory_episodes WHERE world_id=? AND id=?',(world_id,e['id'])).fetchone()
                    archived=json.loads(row['data']);archived.setdefault('sourceSequence',row['sequence']);e=archived
                if eligible(e):result.append({**e,'truthScope':e.get('truthScope') or e.get('appraisal',{}).get('truthScope') or 'experienced_event'})
        return result

    def events(self, world_id, after=0):
        with self.connect() as db:
            self.read(db,world_id)
            return [dict(row)|{'payload':decode_event_payload(row['payload'])} for row in db.execute(
                'SELECT * FROM events WHERE world_id=? AND seq>? ORDER BY seq LIMIT 100',(world_id,after))]

    def landmarks(self, world_id, before=0, minimum_priority=1):
        """Return the permanent human-resolution life outline, newest first."""
        if type(before) is not int or before<0 or type(minimum_priority) is not int or not 1<=minimum_priority<=3:
            raise ValueError('Choose a valid landmark cursor and priority from 1 to 3.')
        with self.connect() as db:
            self.read(db,world_id)
            upper=before or 9223372036854775807
            return [{'worldId':row['world_id'],'sequence':row['seq'],'at':row['at'],'kind':row['kind'],
                     'priority':row['priority'],'summary':row['summary'],'details':json.loads(row['details'])}
                    for row in db.execute('''SELECT * FROM event_landmarks
                        WHERE world_id=? AND seq<? AND priority>=? ORDER BY seq DESC LIMIT 100''',
                        (world_id,upper,minimum_priority))]

    def replay(self, world_id):
        with self.connect() as db:
            self.read(db,world_id)
            state={}
            for row in db.execute('SELECT payload FROM events WHERE world_id=? ORDER BY seq',(world_id,)):
                state=apply_delta(state,decode_event_payload(row[0])['changes'])
            return state

    def storage_status(self, world_id):
        """Fast, service-wide disk facts without scanning giant event values."""
        with self.connect() as db:
            world=db.execute('SELECT revision,LENGTH(state) AS state_bytes FROM worlds WHERE id=?',(world_id,)).fetchone()
            if world is None:raise ValueError('Unknown VH2 world')
            revision=world['revision'];state_bytes=world['state_bytes']
            page_size=db.execute('PRAGMA page_size').fetchone()[0]
            page_count=db.execute('PRAGMA page_count').fetchone()[0]
            free_pages=db.execute('PRAGMA freelist_count').fetchone()[0]
            event_count=db.execute('SELECT COUNT(*) FROM events WHERE world_id=?',(world_id,)).fetchone()[0]
            landmark_count=db.execute('SELECT COUNT(*) FROM event_landmarks WHERE world_id=?',(world_id,)).fetchone()[0]
            photo_count,photo_bytes=db.execute(
                'SELECT COUNT(*),COALESCE(SUM(LENGTH(bytes)),0) FROM photo_assets WHERE world_id=?',(world_id,)).fetchone()
            service_photo_bytes=db.execute('SELECT COALESCE(SUM(LENGTH(bytes)),0) FROM photo_assets').fetchone()[0]
            memory_count,memory_bytes=db.execute(
                'SELECT COUNT(*),COALESCE(SUM(LENGTH(data)),0) FROM memory_episodes WHERE world_id=?',
                (world_id,)).fetchone()
            service_memory_count,service_memory_bytes=db.execute(
                'SELECT COUNT(*),COALESCE(SUM(LENGTH(data)),0) FROM memory_episodes').fetchone()
            memory_priorities={vh2_memory.PRIORITY_LABELS[row['priority']]:row['rows']
                for row in db.execute('''SELECT priority,COUNT(*) AS rows
                    FROM memory_episode_retention WHERE world_id=? GROUP BY priority''',(world_id,))}
            snapshot_stats=db.execute('''SELECT COUNT(*) AS service_count,
                COALESCE(SUM(bytes),0) AS service_bytes,
                COALESCE(SUM(CASE WHEN compact=0 THEN 1 ELSE 0 END),0) AS service_legacy,
                COALESCE(SUM(CASE WHEN world_id=? THEN 1 ELSE 0 END),0) AS life_count,
                COALESCE(SUM(CASE WHEN world_id=? THEN bytes ELSE 0 END),0) AS life_bytes,
                COALESCE(SUM(CASE WHEN world_id=? AND compact=0 THEN 1 ELSE 0 END),0) AS life_legacy
                FROM (SELECT world_id,LENGTH(snapshot) AS bytes,
                    INSTR(snapshot,'"captureSnapshotVersion":1')>0 AS compact FROM photo_jobs)''',
                (world_id,world_id,world_id)).fetchone()
            mode=db.execute('PRAGMA auto_vacuum').fetchone()[0]
        database_bytes=self.path.stat().st_size if self.path.exists() else page_count*page_size
        wal_path=Path(str(self.path)+'-wal');shm_path=Path(str(self.path)+'-shm')
        wal_bytes=wal_path.stat().st_size if wal_path.exists() else 0
        shm_bytes=shm_path.stat().st_size if shm_path.exists() else 0
        reclaimable=free_pages*page_size
        return {'scope':'service','worldId':world_id,'lifetimeRevision':revision,
                'databaseFileBytes':database_bytes,'walBytes':wal_bytes,'sharedMemoryBytes':shm_bytes,
                'serviceDiskBytes':database_bytes+wal_bytes+shm_bytes,
                'estimatedDatabaseUsedBytes':max(0,database_bytes-reclaimable),'reclaimableBytes':reclaimable,
                'retainedEventRows':event_count,'eventCount':event_count,'eventWindowLimit':MAX_DETAILED_EVENT_ROWS,
                'landmarkCount':landmark_count,'stateBytes':state_bytes,
                'photoCount':photo_count,'photoBytes':photo_bytes,'servicePhotoBytes':service_photo_bytes,
                'memoryCount':memory_count,'memoryBytes':memory_bytes,
                'serviceMemoryCount':service_memory_count,'serviceMemoryBytes':service_memory_bytes,
                'memoryPriorities':{label:memory_priorities.get(label,0)
                    for label in vh2_memory.PRIORITY_LABELS.values()},
                'unclassifiedMemoryCount':max(0,memory_count-sum(memory_priorities.values())),
                'memoryRetentionPolicy':{'routineDays':vh2_memory.ROUTINE_MAX_AGE_MS//vh2_memory.DAY,
                    'routineRows':vh2_memory.ROUTINE_MAX_ROWS,
                    'notableDays':vh2_memory.NOTABLE_MAX_AGE_MS//vh2_memory.DAY,
                    'notableRows':vh2_memory.NOTABLE_MAX_ROWS,
                    'important':'permanent','tentpole':'permanent','pinned':'permanent'},
                'photoSnapshotCount':snapshot_stats['life_count'],'photoSnapshotBytes':snapshot_stats['life_bytes'],
                'legacyPhotoSnapshotCount':snapshot_stats['life_legacy'],
                'servicePhotoSnapshotCount':snapshot_stats['service_count'],
                'servicePhotoSnapshotBytes':snapshot_stats['service_bytes'],
                'serviceLegacyPhotoSnapshotCount':snapshot_stats['service_legacy'],
                'autoVacuum':{0:'off',1:'full',2:'incremental'}.get(mode,'unknown'),
                'lastCompaction':self.storage_last_compaction,
                'lastMemoryResolution':self.storage_last_memory_resolution}

    def optimize_storage(self, world_id):
        """Checkpoint all ledgers in this service and rebuild SQLite pages.

        VACUUM is SQLite's crash-safe path for returning freelist pages to the
        filesystem. It needs a short exclusive maintenance window, so every
        life and provider-owned job must be settled first.
        """
        if not self._storage_lock.acquire(blocking=False):
            raise Conflict('Storage optimization is already running.')
        self._storage_optimizing=True;self._storage_owner=threading.get_ident()
        try:
            with exclusive_storage_file_lock(self.path):
                before=self.storage_status(world_id)
                connection=sqlite3.connect(self.path,timeout=300)
                try:
                    connection.execute('PRAGMA busy_timeout=300000')
                    checkpoint=connection.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
                    if checkpoint and checkpoint[0]:
                        raise Conflict('Another database reader is active. Close other Horde Studio windows and try again.')
                    with self.connect() as db:
                        rows=db.execute('SELECT id,revision,state FROM worlds').fetchall()
                        running=[row['id'] for row in rows if json.loads(row['state']).get('running') is True]
                        if running:
                            raise Conflict('Pause every life on this service before optimizing storage.')
                        active=[]
                        for table,statuses in [('dialogue_jobs',('queued','leased','submitted')),
                                               ('vh2_provider_jobs',('queued','submitted','rendered')),
                                               ('vh2_social_jobs',('submitted',)),('vh2_story_jobs',('submitted',))]:
                            marks=','.join('?' for _ in statuses)
                            count=db.execute(f'SELECT COUNT(*) FROM {table} WHERE status IN ({marks})',statuses).fetchone()[0]
                            if count:active.append(f'{count} {table}')
                        if active:
                            raise Conflict('Wait for provider work to settle before optimizing storage: '+', '.join(active)+'.')
                        asset_bytes=db.execute('SELECT COALESCE(SUM(LENGTH(bytes)),0) FROM photo_assets').fetchone()[0]
                        state_bytes=sum(len(row['state'].encode()) for row in rows)
                    # Check space before the irreversible resolution change.
                    # Media dominates non-ledger storage; the additional state
                    # allowance covers projection tables and SQLite overhead.
                    required=max(512*1024*1024,asset_bytes+state_bytes*4+256*1024*1024)
                    if shutil.disk_usage(self.path.parent).free < required:
                        raise ValueError('Not enough free disk space to safely rebuild the compact database.')
                    with self.connect() as db:
                        db.execute('BEGIN IMMEDIATE')
                        # Re-read and re-check while holding the write lock.
                        rows=db.execute('SELECT id,revision,state FROM worlds').fetchall()
                        world_states={row['id']:json.loads(row['state']) for row in rows}
                        if any(state.get('running') is True for state in world_states.values()):
                            raise Conflict('A life resumed while storage preparation was starting. Pause every life and retry.')
                        photo_compaction=compact_photo_capture_history(db,world_states)
                        compacted=[];conversation_resolution=[];memory_resolution=[];job_resolution=[]
                        dialogue_module=_vh_import_module('.vh2_dialogue',__package__)
                        social_module=_vh_import_module('.vh2_social_worker',__package__)
                        story_module=_vh_import_module('.vh2_story',__package__)
                        maintenance_now=self.clock()
                        for row in rows:
                            state=world_states[row['id']]
                            memories=vh2_memory.resolve_history(db,row['id'],state)
                            memory_resolution.append({'worldId':row['id'],**memories})
                            job_resolution.append({'worldId':row['id'],
                                'dialogue':dialogue_module.prune_terminal_jobs(db,row['id'],maintenance_now),
                                'mediaAndRoutes':vh2_workers.prune_terminal_jobs(db,row['id'],maintenance_now),
                                'social':social_module.prune_terminal_jobs(db,row['id'],maintenance_now),
                                'lifeAdviser':story_module.prune_terminal_jobs(db,row['id'],maintenance_now)})
                            before_state=json.loads(row['state']);revision=row['revision']
                            resolved=vh2_transcript.resolve_player_knowledge(db,row['id'],state)
                            if resolved['changed']:
                                revision=self.commit_event(db,row['id'],revision,before_state,state,'HISTORY_RESOLVED',
                                    {'landmarkPriority':0,'replyBodiesRemoved':resolved['replyBodiesRemoved'],
                                     'markersTrimmed':resolved['markersTrimmed']})
                                conversation_resolution.append({'worldId':row['id'],**resolved})
                            report=compact_event_history(db,row['id'],revision,state,state['kernelVersion'],max_rows=2)
                            if report:compacted.append({'worldId':row['id'],**report})
                    # The checkpoint transaction is verified and durable before
                    # VACUUM. Interruption leaves a valid bounded ledger.
                    checkpoint=connection.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
                    if checkpoint and checkpoint[0]:
                        raise RuntimeError('Could not obtain the exclusive SQLite maintenance window.')
                    connection.execute('PRAGMA auto_vacuum=INCREMENTAL')
                    connection.execute('VACUUM')
                    if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                        raise RuntimeError('SQLite integrity verification failed after optimization.')
                    connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                finally:
                    connection.close()
                for row in rows:
                    if self.replay(row['id']) != self.projection(row['id'])['state']:
                        raise RuntimeError('Life replay verification failed after storage optimization.')
                after=self.storage_status(world_id)
                return {'scope':'service','worldId':world_id,'before':before,'after':after,'compacted':compacted,
                        'photoSnapshots':photo_compaction,
                        'conversationHistory':conversation_resolution,
                        'memoryHistory':memory_resolution,
                        'jobHistory':job_resolution,
                        'bytesReclaimed':max(0,before['serviceDiskBytes']-after['serviceDiskBytes'])}
        finally:
            self._storage_optimizing=False;self._storage_owner=None;self._storage_lock.release()

    def status(self):
        with self.connect() as db:
            worlds=[]
            for row in db.execute('SELECT * FROM worlds ORDER BY rowid DESC'):
                state=json.loads(row['state'])
                worlds.append({'worldId':row['id'],'revision':row['revision'],'name':state['truth']['companion']['name'],
                               'running':state['running'],'mergedInto':state.get('mergedInto'),'simAt':state['simAt'],
                               'error':next((r[0] for r in db.execute('SELECT error FROM jobs WHERE world_id=?',(row['id'],))), '')})
        return {'experimental':True,'schemaVersion':SCHEMA_VERSION,'kernelVersion':self.kernel_version,
                'quantumMs':QUANTUM,'lastError':self.last_error,'dialogueError':self.dialogue_error,'worlds':worlds,
                'maintenance':dict(self.maintenance_health)}

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        def run():
            while not self._stop.wait(5):
                try:
                    self.tick()
                except Exception as error:
                    self.last_error=str(error)[:500]
        self._thread=threading.Thread(target=run,name='horde-vh2',daemon=True)
        self._thread.start()
        def expression_loop():
            while not self._stop.wait(1):
                try:
                    with self.connect() as db:
                        ids=[r[0] for r in db.execute("SELECT id FROM worlds WHERE json_extract(state,'$.running')=1 AND json_extract(state,'$.integration.autoReplies')=1 LIMIT 32")]
                    for world_id in ids:
                        with self.connect() as db:
                            db.execute('BEGIN IMMEDIATE');revision,state=self.read(db,world_id)
                            self.dialogue.maybe_queue(db,world_id,revision,state)
                    self.dialogue.run_once()
                    self.dialogue_error=''
                except Exception:
                    self.dialogue_error='Dialogue worker unavailable; queued work remains saved.'
        self._dialogue_thread=threading.Thread(target=expression_loop,name='horde-vh2-dialogue',daemon=True)
        self._dialogue_thread.start()

    def close(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=35)
        if self._dialogue_thread:
            self._dialogue_thread.join(timeout=35)
        if hasattr(self,"_feed_pool"):self._feed_pool.shutdown(wait=False,cancel_futures=True)
        if self._worker_pool:self._worker_pool.shutdown(wait=False,cancel_futures=True)
        if hasattr(self,"_weather_pool"):self._weather_pool.shutdown(wait=False,cancel_futures=True)
        if hasattr(self,"_social_pool"):self._social_pool.shutdown(wait=False,cancel_futures=True)
        if hasattr(self,"_story_pool"):self._story_pool.shutdown(wait=False,cancel_futures=True)
