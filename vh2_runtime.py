"""Opt-in VH2 foundation. SQLite owns synthetic timelines; no provider calls.

All changes pass through transactions. VH1 databases/queues are never imported
or written here. The JS adapter is deliberately pinned to a kernel version.
"""
from __future__ import annotations
import vh2_geography
import vh2_weather
import vh2_commerce
import vh2_visual
import vh2_player
import vh2_history
import vh2_episodes
import vh2_transport
import vh2_lifestyle
import vh2_workers
import vh2_media
import vh2_clips
import vh2_calls
import vh2_social
import vh2_plans
import vh2_agency
import vh2_population
import vh2_people
import vh2_relationships
import vh2_assets
import vh2_flights
import vh2_ticketmaster
import vh2_life_controls
import vh2_feeds
import vh2_exploration
import vh2_travel
import vh2_gifts
import vh2_transcript
import vh2_library
import vh2_conversations
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import threading
import time
import uuid
from vh2_migration import inspect_archive
from vh2_dialogue import DialogueQueue, SCHEMA as DIALOGUE_SCHEMA
from vh2_provider import ProviderStore, SCHEMA as PROVIDER_SCHEMA
from vh2_entities import entities, transitions, PROJECTION_VERSION

SCHEMA_VERSION = 1
DATABASE_VERSION = 9
KERNEL_VERSION = 'vh2-foundation-1'
QUANTUM = 300_000
MAX_BATCH = 12

class Conflict(ValueError):
    pass


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


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


class WorldService:
    def __init__(self, path, node, app_dir, clock=None):
        self.path, self.node, self.app_dir = Path(path), node, Path(app_dir)
        sources = ['vh2-geography-engine.js','vh2-kernel-worker.js','vh-simulation-core.js','vh-activity-engine.js',
                   'vh2-story-engine.js','vh2-story-policy.json','vh2-profile-fields.json','vh-world-engine.js','vh-conversation-engine.js','vh2-decision-engine.js','vh2-communication-engine.js','vh2-psychology-engine.js','vh2-health-engine.js','vh2-followthrough-engine.js','vh2-presence-engine.js','vh2-plans-engine.js','vh2-agency-engine.js','vh2-npc-travel.js','vh2-social-bonds.js','vh2-population-engine.js','vh2-people-engine.js','vh2-network-engine.js','vh2-institutions-engine.js','vh2-relationship-lifecycle.js','vh2-travel-engine.js','vh2-exploration-engine.js','vh2-lifestyle-engine.js','vh2-transport-engine.js','vh2-episodes-engine.js']
        self.kernel_sources=sources
        self.source_fingerprint=self.kernel_fingerprint()
        self.kernel_version = KERNEL_VERSION + ':' + self.source_fingerprint
        self.clock = clock or (lambda: int(time.time()*1000))
        self._stop = threading.Event()
        self._worker_lock=threading.Lock();self._worker_pending={};self._worker_pool=None
        self.route_executor=None;self.image_executor=vh2_workers.image_transport
        self._feed_lock = threading.Lock()
        self._thread = None
        self._dialogue_thread = None
        self.dialogue_error = ''
        self.dialogue = DialogueQueue(self, Conflict)
        self.dialogue_provider = ProviderStore(self)
        self.last_error = ''
        self.maintenance_health = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1, 2, 3, 4, 5, 6, 7, 8, DATABASE_VERSION):
                raise ValueError('Unsupported VH2 database version; preserve it and upgrade the application.')
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
            db.executescript(vh2_library.SCHEMA)
            for row in db.execute('SELECT id,state FROM worlds').fetchall():
                old=json.loads(row['state']);vh2_library.index(db,row['id'],'photo',old.get('photos',[]));vh2_library.index(db,row['id'],'post',old.get('social',{}).get('posts',[]))
            for row in db.execute('SELECT id,state FROM worlds').fetchall():
                vh2_transcript.index(db,row['id'],json.loads(row['state']).get('communication',{}).get('messages',[]))
            db.executescript(__import__('vh2_social_worker').SCHEMA)
            db.executescript(__import__('vh2_story').SCHEMA)
            db.executescript(vh2_workers.SCHEMA)
            db.executescript(vh2_flights.SCHEMA)
            db.executescript(vh2_ticketmaster.SCHEMA)
            db.execute("UPDATE vh2_provider_jobs SET status='unknown',error='Host restarted after submission; do not automatically retry.' WHERE status='submitted'")
            db.execute('PRAGMA user_version=9')
            db.execute('DROP INDEX IF EXISTS one_active_dialogue_v2')
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_active_dialogue_v3 ON dialogue_jobs(world_id) WHERE status IN ('queued','leased','submitted')")
            for row in db.execute('SELECT id,revision,state FROM worlds').fetchall():
                saved=json.loads(row['state'])
                if not saved.get('mergedInto') and saved['kernelVersion']==self.kernel_version:
                    vh2_social.repair_starter_duplicates(self,db,row['id'],row['revision'],saved)
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
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
        proc = subprocess.run([self.node, str(self.app_dir/'vh2-kernel-worker.js')],
            input=encode(payload), capture_output=True, text=True, timeout=30, cwd=self.app_dir)
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
        __import__('vh2_calendar').prepare(after)
        vh2_visual.synchronize(after)
        vh2_transcript.persist(db,world_id,after)
        vh2_library.persist(db,world_id,after)
        for episode in after.get('truth',{}).get('companion',{}).get('vh2Psychology',{}).get('episodes',[]):
            episode.setdefault('sourceSequence',revision)
        payload = {'schemaVersion': SCHEMA_VERSION, 'kernelVersion': self.kernel_version,
                   'changes': delta(before, after), 'details': {**(details or {}), 'entityChanges':transitions(before,after)}}
        db.execute('INSERT INTO events VALUES (?,?,?,?,?)',
                   (world_id, revision, after['simAt'], kind, encode(payload)))
        db.execute('UPDATE worlds SET revision=?,state=? WHERE id=?', (revision,encode(after),world_id))
        self.index_entities(db,world_id,revision,after)
        prior_ids={e['id'] for e in before.get('truth',{}).get('companion',{}).get('vh2Psychology',{}).get('episodes',[])}
        for episode in after['truth']['companion'].get('vh2Psychology',{}).get('episodes',[]):
            if episode['id'] not in prior_ids:
                db.execute('INSERT OR IGNORE INTO memory_episodes VALUES (?,?,?,?,?,?)',
                           (world_id,episode['id'],revision,episode['at'],episode['summary'],encode(episode)))
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
                    if not isinstance(profile,dict) or len(encode(profile).encode())>2_000_000:raise ValueError('A bounded character profile is required.')
                    # The same authored-field bounds apply at creation and edit.
                    # No private/runtime conversation data is imported here.
                    import vh2_profile
                    for field in vh2_profile.AUTHORED_TEXT_LIMITS:
                        if field in profile:vh2_profile.validate(field,profile[field])
                    if not isinstance(scope,str) or not scope.startswith('horde:') or len(scope)>120:raise ValueError('A Horde provider binding is required.')
                    if not isinstance(persona,str) or not 1<=len(persona)<=100:raise ValueError('A timeline persona identity is required.')
                    if not isinstance(profile.get('lifeProfile'),dict):raise ValueError('An active life profile is required.')
                    candidate={'simAt':now,'truth':{'companion':{**profile,'id':world_id+':human','name':name.strip()}}}
                    __import__('vh2_calendar').prepare_ages(candidate)
                    initial=self.kernel({'profile':profile,'calendarAges':candidate['truth']['companion'].get('vh2Calendar'),'create':True,'entityId':world_id+':human','name':name.strip(),'now':now})

                state = {'schemaVersion':SCHEMA_VERSION,'kernelVersion':self.kernel_version,
                         'simAt':now,'simAnchor':now,'wallAnchor':now,'running':False,
                         'truth':initial,'beliefs':[],'memories':[],'playerKnowledge':[],
                         'communication':{'personaId':world_id+':player','messages':[],'nextAt':None}}
                if kind=='create_profile':
                    state['integration']={'providerScope':scope,'autoReplies':False,'source':'horde_profile','sourceCompanionId':str(body.get('companionId',''))[:100]}
                    state['communication']['personaId']=persona
                calendar=state['truth']['companion']['lifeProfile'].get('personalCalendar')
                if calendar is not None:
                    state['truth']['companion']['lifeProfile']['personalCalendar']=__import__('vh2_calendar').validate_personal(calendar,state['truth']['companion'],__import__('vh2_calendar').local_datetime(state).date())
                db.execute('CREATE TABLE IF NOT EXISTS vh2_controls (id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL)')
                pause=db.execute('SELECT paused FROM vh2_controls WHERE id=1').fetchone()
                if pause and pause[0]:state['truth']['companion']['vh2AutonomyPaused']=True
                db.execute('INSERT INTO worlds VALUES (?,?,?)',(world_id,0,'{}'))
                revision = self.commit_event(db,world_id,0,{},state,'WORLD_CREATED',{'synthetic':kind=='create','profileCopy':kind=='create_profile'})
            elif kind in ('set_running','advance','configure_decisions','configure_life_expression','upgrade_kernel','receive_message','stage_reply','deliver_reply','queue_dialogue','dismiss_unknown_dialogue','configure_auto_replies','configure_psychology','configure_conversation_appraisal','configure_relationship_learning','dismiss_check_in','capture_photo','capture_reference','submit_photo','abandon_photo','import_photo',*vh2_conversations.COMMANDS,*vh2_clips.COMMANDS,*vh2_calls.COMMANDS,*vh2_social.COMMANDS,*vh2_plans.COMMANDS,*vh2_population.COMMANDS,*vh2_people.COMMANDS,*vh2_relationships.COMMANDS,*vh2_gifts.COMMANDS,*vh2_travel.COMMANDS,*vh2_assets.COMMANDS,*vh2_feeds.COMMANDS,*vh2_exploration.COMMANDS,*vh2_workers.COMMANDS,*vh2_lifestyle.COMMANDS,*vh2_transport.COMMANDS,*vh2_episodes.COMMANDS,*vh2_player.COMMANDS,*vh2_life_controls.COMMANDS,*vh2_history.COMMANDS,*vh2_geography.COMMANDS,*vh2_visual.COMMANDS,*vh2_commerce.COMMANDS):
                world_id = body.get('worldId')
                revision,state = self.read(db,world_id)
                if state.get('mergedInto'):raise Conflict('This life was merged into '+state['mergedInto']+'. Open the merged life to continue.')
                if type(body.get('expectedRevision')) is not int or body['expectedRevision'] != revision:
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
                    origin=db.execute('SELECT payload FROM events WHERE world_id=? AND seq=1',(world_id,)).fetchone()
                    if not origin or not any(json.loads(origin[0])['details'].get(k) for k in ('synthetic','profileCopy')):
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
        birthday=__import__('vh2_calendar').next_age_boundary(state)
        return min([life]+[at for at in attention+[birthday] if at and at>state['simAt']])

    def evaluate(self,state,sequence,life=False,inspect=False,contacts=True):
        if life and '_conversationBinding' in state:
            persona=state['communication']['personaId'];base=vh2_conversations.canonical(state)
            self.evaluate(base,sequence,life=True,inspect=inspect)
            scoped=vh2_conversations.view(base,persona);state.clear();state.update(scoped);return
        vh2_people.prepare(state)
        __import__('vh2_calendar').prepare(state)
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
        state['playerKnowledge'].append({'kind':'message_delivered','messageId':message_id,
            'sourceSequence':sequence,'at':now,'text':text})
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
            import vh2_attachments
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
            import vh2_social_worker
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

    def tick(self):
        import vh2_weather
        import vh2_social_worker
        for name,callback in [('clock',self.reconcile_live_clocks),('scheduler',self.reconcile_job_schedule),
                              ('media',lambda:vh2_workers.poll(self)),('feeds',lambda:vh2_feeds.poll(self)),
                              ('weather',lambda:vh2_weather.poll(self)),('social',lambda:vh2_social_worker.poll(self)),('life_adviser',lambda:__import__('vh2_story').poll(self))]:
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
        import vh2_conversation
        query=vh2_conversation.terms(' '.join(m['text'] for m in visible if m.get('awaitingReply') and m.get('attention',{}).get('stage')=='ready'))
        return {'worldId':world_id,'revision':revision,'simAt':state['simAt'],
                'otherContacts':vh2_conversations.awareness(state),
                'recalledConversation':vh2_conversation.recall_conversation(visible,query),
                'calendar':__import__('vh2_calendar').context(state),
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
            return [dict(row)|{'payload':json.loads(row['payload'])} for row in db.execute(
                'SELECT * FROM events WHERE world_id=? AND seq>? ORDER BY seq LIMIT 100',(world_id,after))]

    def replay(self, world_id):
        with self.connect() as db:
            self.read(db,world_id)
            state={}
            for row in db.execute('SELECT payload FROM events WHERE world_id=? ORDER BY seq',(world_id,)):
                state=apply_delta(state,json.loads(row[0])['changes'])
            return state

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
