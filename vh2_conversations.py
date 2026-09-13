"""Persona conversations in one canonical world, never another life simulation.

Existing single-person saves remain the primary conversation. A scoped view
lets existing communication commands operate on another contact; the event
writer folds only contact-owned fields back into that world's conversation map.
Physical state, clock, needs, public media and lived experiences stay shared.
"""
from copy import deepcopy

COMMANDS = ('open_conversation','configure_contact_relationship','manage_conversation')
PATHS = tuple(tuple(p.split('.')) for p in (
    'relationshipDynamics', 'mood.relationship', 'emotionState.towardPlayer',
    'continuityRuntime', 'memory', 'personaVisualMemory', 'socialRelationship',
    'vh2Psychology.relationshipEvidence', 'vh2Psychology.checkIns',
    'lifeRuntime.world.playerBalance', 'lifeRuntime.world.cashConsent', 'lifeRuntime.world.mailConsent',
    'connectionType', 'connectionRole', 'relationshipContext', 'priorContact',
    'knownBeforeDays', 'startingRelationship', 'playerKnowledge',
    'initialMotive', 'connectionAuthenticity', 'startingScenario'))
ROOT_FIELDS = ('communication', 'playerKnowledge', 'legacyHistory')

def path_get(obj, path):
    for key in path:
        if not isinstance(obj, dict) or key not in obj: return None
        obj = obj[key]
    return deepcopy(obj)

def path_has(obj, path):
    for key in path:
        if not isinstance(obj, dict) or key not in obj:return False
        obj=obj[key]
    return True

def path_set(obj, path, value, remove=False):
    for key in path[:-1]: obj = obj.setdefault(key, {})
    if remove: obj.pop(path[-1], None)
    else: obj[path[-1]] = deepcopy(value)

def capture(state):
    c = state['truth']['companion']
    return {'roots': {k: deepcopy(state[k]) for k in ROOT_FIELDS if k in state},
            'fields': {'.'.join(p): path_get(c, p) for p in PATHS if path_has(c,p)}}

def apply(state, record):
    for key in ROOT_FIELDS:
        value = record['roots'].get(key)
        if key not in record['roots']: state.pop(key, None)
        else: state[key] = deepcopy(value)
    for path in PATHS: path_set(state['truth']['companion'], path, record['fields'].get('.'.join(path)),'.'.join(path) not in record['fields'])

def canonical(state):
    if '_conversationBinding' not in state: return state
    result = deepcopy(state)
    binding = result.pop('_conversationBinding')
    result.setdefault('conversations', {})[binding['personaId']] = capture(result)
    apply(result, binding['primary'])
    return result

def view(state, persona_id=None):
    state = canonical(state)
    if not persona_id or persona_id == state['communication']['personaId']: return state
    record = state.get('conversations', {}).get(persona_id)
    if record is None: raise ValueError('No conversation exists for this persona. Start a chat first.')
    result = deepcopy(state)
    result['_conversationBinding'] = {'personaId': persona_id, 'primary': capture(state)}
    apply(result, record)
    return result

def ids(state):
    state = canonical(state)
    return [state['communication']['personaId'], *state.get('conversations', {})]

def summaries(state):
    result = []
    for ident in ids(state):
        inbox = view(state, ident)['communication']
        if inbox.get('deletedAt'):continue
        result.append({'personaId': ident, 'profile': deepcopy(inbox.get('playerProfile', {})),
                       'name':inbox.get('name'), 'createdAt': inbox.get('createdAt'), 'messageCount': len(inbox.get('messages', []))})
    return result

def open_conversation(service, db, world, revision, state, body):
    persona = body.get('personaId')
    profile = body.get('profile')
    if not isinstance(persona, str) or not 1 <= len(persona) <= 100: raise ValueError('Choose a saved persona.')
    if not isinstance(profile, dict) or set(profile) != {'templateId', 'name', 'text'}: raise ValueError('Provide the selected persona profile.')
    if profile['templateId'] != persona: raise ValueError('The selected persona and profile must match.')
    for key, limit in (('templateId', 100), ('name', 160), ('text', 6000)):
        if not isinstance(profile[key], str) or len(profile[key]) > limit: raise ValueError('Persona profile exceeds its field limits.')
    state = canonical(state)
    # Old saves may use a generated player ID but still know the template ID.
    existing = next((ident for ident in ids(state) if ident==persona or view(state,ident)['communication'].get('playerProfile',{}).get('templateId')==persona),None)
    if existing:
        scoped=view(state,existing)
        if scoped['communication'].get('deletedAt'):
            after=deepcopy(scoped);after['communication'].pop('deletedAt',None)
            after['communication'].update(createdAt=state['simAt'],playerProfile={**profile,'scope':'player_claim','updatedAt':state['simAt']})
            revision=service.commit_event(db,world,revision,scoped,after,'CONVERSATION_REOPENED',{'personaId':existing})
            return revision,canonical(after),existing,True
        return revision, state, existing, False
    if len(ids(state)) >= 50: raise ValueError('This life already has 50 persona conversations.')
    after = deepcopy(state)
    record = capture(after)
    record['roots'] = {'communication': {'personaId': persona, 'messages': [], 'nextAt': None,
        'createdAt': state['simAt'], 'playerProfile': {**profile, 'scope': 'player_claim', 'updatedAt': state['simAt']}}, 'playerKnowledge': []}
    record['fields'] = {}
    record['fields'].update({'relationshipDynamics': {k: 0 for k in state['truth']['companion'].get('relationshipDynamics', {})},
        'mood.relationship': 0, 'emotionState.towardPlayer': {}, 'continuityRuntime': {},
        'memory': {'longTerm': [], 'consolidatedThroughIndex': 0}, 'knownBeforeDays': 0,
        'startingRelationship': 0, 'priorContact': 'never_met', 'connectionType': 'stranger',
        'connectionRole': '', 'relationshipContext': '', 'vh2Psychology.checkIns': []})
    after.setdefault('conversations', {})[persona] = record
    revision = service.commit_event(db, world, revision, state, after, 'CONVERSATION_OPENED', {'personaId': persona})
    return revision, after, persona, True

def job_view(state, job):
    import json
    snapshot = job.get('snapshot', {})
    if isinstance(snapshot, str): snapshot = json.loads(snapshot)
    return view(state, snapshot.get('context', {}).get('personaId'))

def configure_relationship(service,db,world,revision,state,body):
    role=body.get('role');context=body.get('context','');days=body.get('knownBeforeDays',0)
    if role not in ('stranger','friend','best_friend','partner','family','colleague','ex_partner','custom'):raise ValueError('Choose a supported connection.')
    if not isinstance(context,str) or len(context)>2000 or type(days) is not int or not 0<=days<=36500:raise ValueError('Use a short connection description and valid number of days.')
    after=deepcopy(state);c=after['truth']['companion']
    c.update(connectionType=role,connectionRole=role.replace('_',' '),relationshipContext=context,knownBeforeDays=days,priorContact='never_met' if role=='stranger' else 'spoken_before')
    revision=service.commit_event(db,world,revision,state,after,'CONTACT_RELATIONSHIP_AUTHORED',{'personaId':state['communication']['personaId'],'role':role})
    return revision,after

def manage(service,db,world,revision,state,body):
    action=body.get('action');persona=state['communication']['personaId']
    if action not in ('rename','clear','reset','delete'):raise ValueError('Choose a supported chat action.')
    after=deepcopy(state);inbox=after['communication']
    if action=='rename':
        name=body.get('name','')
        if not isinstance(name,str) or not 1<=len(name.strip())<=100:raise ValueError('Enter a chat name up to 100 characters.')
        inbox['name']=name.strip()
    else:
        # Fence late workers before clearing the selected contact's inbox.
        db.execute("""UPDATE dialogue_jobs SET status='abandoned',token=NULL,lease_until=NULL,
            reason='Chat was cleared, reset or deleted; late delivery is disabled.'
            WHERE world_id=? AND json_extract(snapshot,'$.context.personaId')=?
            AND status IN ('queued','leased','submitted','unknown')""",(world,persona))
        primary=canonical(state)['communication']['personaId']
        db.execute("DELETE FROM transcript_messages WHERE world_id=? AND COALESCE(json_extract(data,'$.playerPersonaId'),?)=?",(world,primary,persona))
        generation=int(inbox.get('generation',0))+1
        keep={k:deepcopy(inbox[k]) for k in ('personaId','playerProfile','name','createdAt') if k in inbox}
        inbox.clear();inbox.update(**keep,messages=[],nextAt=None,generation=generation)
        if action=='delete':inbox['deletedAt']=state['simAt']
        if action=='reset':
            c=after['truth']['companion']
            for key in ('relationshipDynamics','continuityRuntime','memory','personaVisualMemory','socialRelationship'):c.pop(key,None)
            c.setdefault('mood',{})['relationship']=c.get('startingRelationship',0)
            c.setdefault('emotionState',{})['towardPlayer']={}
            c.setdefault('vh2Psychology',{}).pop('relationshipEvidence',None)
            c['vh2Psychology']['checkIns']=[]
            c['vh2Psychology']['episodes']=[e for e in c['vh2Psychology'].get('episodes',[]) if e.get('personaId')!=persona]
            after['beliefs']=[b for b in after.get('beliefs',[]) if b.get('personaId')!=persona]
            after['playerKnowledge']=[];after.pop('legacyHistory',None)
            db.execute("DELETE FROM memory_episodes WHERE world_id=? AND json_extract(data,'$.personaId')=?",(world,persona))
            normalized=service.kernel({'companion':deepcopy(c),'now':state['simAt'],'inspect':True})['companion']
            # Normalize contact fields only: physical state never rewinds.
            for path in PATHS:
                if path[0] not in ('lifeRuntime',):path_set(c,path,path_get(normalized,path),not path_has(normalized,path))
    revision=service.commit_event(db,world,revision,state,after,'CONVERSATION_'+action.upper(),{'personaId':persona})
    return revision,after

def awareness(state):
    """Her own recollections, explicitly not history shared with the recipient."""
    current=state['communication']['personaId'];c=state['truth']['companion']
    role=c.get('connectionType','stranger');dimensions=c.get('relationshipDynamics',{})
    close=role in ('best_friend','partner') or dimensions.get('trust',0)>=45 and dimensions.get('warmth',0)>=20
    records=[]
    for persona in ids(state):
        if persona==current:continue
        other=view(state,persona);inbox=other['communication'];person=other['truth']['companion']
        if inbox.get('deletedAt'):continue
        visible=[m for m in inbox.get('messages',[]) if (m.get('role')=='user' and m.get('readAt',0)>0 or m.get('role')=='assistant' and m.get('deliveryState')=='delivered') and m.get('timestamp',0)<=state['simAt']]
        if not visible:continue
        record={'personaId':persona,'name':inbox.get('playerProfile',{}).get('name') or 'Another contact',
            'connection':person.get('connectionRole') or person.get('connectionType','stranger'),
            'relationship':deepcopy(person.get('relationshipDynamics',{})),
            'lastExchangeAt':visible[-1]['timestamp'],'awaitingReply':any(m.get('awaitingReply') for m in visible)}
        if close:
            record['privateRecollection']=[{'speaker':'self' if m['role']=='assistant' else 'other contact','text':m.get('text','')[:400]} for m in visible[-3:]]
        records.append(record)
    return {'contacts':sorted(records,key=lambda r:r['lastExchangeAt'],reverse=True)[:8],
        'scope':'Her own interactions with other people. The current recipient did not witness them and does not automatically know them.',
        'disclosure':'She may choose whether to mention or confide about another contact based on the current relationship, personality, context and boundaries. Private recollections are background for her own perspective, not permission to quote or forward a conversation. Do not attribute another contact’s words, promises or experiences to the current person. Do not invent romance, meetings or events from chatting.'}
