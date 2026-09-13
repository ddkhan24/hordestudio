"""Durable display history, separate from the bounded active conversation.

Rows are projections of canonical message events, not another simulation owner.
Indexing and active-window compaction share the event writer's transaction.
"""
import json

SCHEMA = '''CREATE TABLE IF NOT EXISTS transcript_messages (
 world_id TEXT NOT NULL REFERENCES worlds(id), id TEXT NOT NULL,
 position INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(world_id,id), UNIQUE(world_id,position));'''
WINDOW = 200

def index(db, world_id, messages):
    position = db.execute('SELECT COALESCE(MAX(position),0) FROM transcript_messages WHERE world_id=?', (world_id,)).fetchone()[0]
    for message in messages:
        data = json.dumps(message, sort_keys=True, separators=(',', ':'), allow_nan=False)
        row = db.execute('SELECT data FROM transcript_messages WHERE world_id=? AND id=?', (world_id,message['id'])).fetchone()
        if row is None:
            position += 1
            db.execute('INSERT INTO transcript_messages VALUES (?,?,?,?)', (world_id,message['id'],position,data))
        elif row['data'] != data:
            db.execute('UPDATE transcript_messages SET data=? WHERE world_id=? AND id=?', (data,world_id,message['id']))

def persist(db, world_id, state):
    inboxes=[state.get('communication')]+[r['roots']['communication'] for r in state.get('conversations',{}).values()]
    for inbox in inboxes:
        if not inbox:continue
        messages = inbox.get('messages', [])
        for message in messages:message.setdefault('playerPersonaId',inbox['personaId'])
        index(db,world_id,messages)
        # Never discard a pending message, including its attention/evidence state.
        recent = {m['id'] for m in messages[-WINDOW:]}
        inbox['messages'] = [m for m in messages if m['id'] in recent or m.get('awaitingReply')]

def page(service, world_id, before=0, limit=200, persona_id=None):
    if type(before) is not int or before < 0 or type(limit) is not int or not 1 <= limit <= 500:
        raise ValueError('Invalid transcript page.')
    with service.connect() as db:
        db.execute('BEGIN')
        revision,state = service.read(db,world_id)
        primary=state['communication']['personaId'];persona_id=persona_id or primary
        __import__('vh2_conversations').view(state,persona_id)
        rows = db.execute("SELECT position,data FROM transcript_messages WHERE world_id=? AND (?=0 OR position<?) AND COALESCE(json_extract(data,'$.playerPersonaId'),?)=? ORDER BY position DESC LIMIT ?", (world_id,before,before,primary,persona_id,limit+1)).fetchall()
        more = len(rows)>limit
        rows = rows[:limit]
        return {'worldId':world_id,'revision':revision,
                'messages':[json.loads(row['data']) for row in reversed(rows)],
                'before':rows[-1]['position'] if more else None}
