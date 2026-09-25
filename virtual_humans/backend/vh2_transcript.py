"""Durable display history, separate from the bounded active conversation.

Rows are projections of canonical message events, not another simulation owner.
Indexing and active-window compaction share the event writer's transaction.
"""
from importlib import import_module as _vh_import_module
import json

SCHEMA = '''CREATE TABLE IF NOT EXISTS transcript_messages (
 world_id TEXT NOT NULL REFERENCES worlds(id), id TEXT NOT NULL,
 position INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(world_id,id), UNIQUE(world_id,position));'''
WINDOW = 200
# playerKnowledge used to hold another complete copy of every assistant reply.
# The transcript table above is the durable, pageable owner of exact words; the
# state only needs small delivery markers for opening/continuity checks.
KNOWLEDGE_WINDOW = 32

def resolve_player_knowledge(db, world_id, state):
    """Remove redundant reply bodies and bound per-contact delivery markers.

    This runs inside the ordinary event transaction after every inbox has been
    indexed, so legacy text is never discarded before its exact transcript copy
    exists.  Secondary persona roots are resolved independently.
    """
    roots=[state];removed_bodies=0;trimmed_markers=0;changed=False
    roots.extend(record.get('roots',{}) for record in state.get('conversations',{}).values()
                 if isinstance(record,dict))
    for root in roots:
        history=root.get('playerKnowledge')
        if not isinstance(history,list):continue
        before=json.dumps(history,sort_keys=True,separators=(',',':'),allow_nan=False)
        compact=[];unresolved=set()
        for item in history:
            if not isinstance(item,dict):continue
            position=len(compact)
            if item.get('kind')=='message_delivered':
                marker={key:item[key] for key in ('kind','messageId','sourceSequence','at') if key in item}
                # Legacy versions may predate the transcript projection.  Only
                # remove an old body after proving that exact text is already
                # present in its durable row; otherwise preserve the orphan for
                # a recovery migration instead of silently losing history.
                if isinstance(item.get('text'),str):
                    row=db.execute('SELECT data FROM transcript_messages WHERE world_id=? AND id=?',
                                   (world_id,item.get('messageId'))).fetchone()
                    if row is None or json.loads(row['data']).get('text')!=item['text']:
                        marker=item;unresolved.add(position)
                    else:
                        removed_bodies+=1
                compact.append(marker)
            else:
                compact.append(item)
        keep=set(range(max(0,len(compact)-KNOWLEDGE_WINDOW),len(compact)))|unresolved
        delivered=[position for position,item in enumerate(compact) if item.get('kind')=='message_delivered']
        if delivered:keep.add(delivered[-1])
        resolved=[item for position,item in enumerate(compact) if position in keep]
        trimmed_markers+=max(0,len(compact)-len(resolved))
        root['playerKnowledge']=resolved
        changed=changed or before!=json.dumps(resolved,sort_keys=True,separators=(',',':'),allow_nan=False)
    return {'changed':changed,'replyBodiesRemoved':removed_bodies,'markersTrimmed':trimmed_markers}

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
    resolve_player_knowledge(db,world_id,state)

def page(service, world_id, before=0, limit=200, persona_id=None):
    if type(before) is not int or before < 0 or type(limit) is not int or not 1 <= limit <= 500:
        raise ValueError('Invalid transcript page.')
    with service.connect() as db:
        db.execute('BEGIN')
        revision,state = service.read(db,world_id)
        primary=state['communication']['personaId'];persona_id=persona_id or primary
        _vh_import_module('.vh2_conversations',__package__).view(state,persona_id)
        rows = db.execute("SELECT position,data FROM transcript_messages WHERE world_id=? AND (?=0 OR position<?) AND COALESCE(json_extract(data,'$.playerPersonaId'),?)=? ORDER BY position DESC LIMIT ?", (world_id,before,before,primary,persona_id,limit+1)).fetchall()
        more = len(rows)>limit
        rows = rows[:limit]
        return {'worldId':world_id,'revision':revision,
                'messages':[json.loads(row['data']) for row in reversed(rows)],
                'before':rows[-1]['position'] if more else None}
