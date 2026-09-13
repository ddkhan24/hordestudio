"""Read-only VH1 archive inspection. Never normalizes or executes uploaded data."""
import hashlib
import json
from pathlib import Path

REPORT_VERSION = 1
MAX_ARCHIVE_BYTES = 12 * 1024 * 1024
FIELDS = json.loads(Path(__file__).with_name('vh2-vh1-fields.json').read_text())
SECRET_FIELDS = {'apikey','accesstoken','refreshtoken','authorization','password','clientsecret','privatekey','credentials','authtoken','bearertoken','secret'}


def parse_archive(text):
    if not isinstance(text,str) or len(text.encode('utf-8')) > MAX_ARCHIVE_BYTES:
        raise ValueError('Migration preview accepts UTF-8 archives up to 12 MB. Larger media archives need the future streaming importer.')
    def pairs(items):
        value={}
        for key,item in items:
            if key in value:
                raise ValueError('Archive has duplicate JSON object keys; export a clean copy.')
            value[key]=item
        return value
    try:
        value=json.loads(text.lstrip('\ufeff'),object_pairs_hook=pairs,
                         parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Archive contains a non-finite number.')))
    except (json.JSONDecodeError,RecursionError) as error:
        raise ValueError('Archive is not valid supported JSON.') from error
    if not isinstance(value,dict) or value.get('_format')!='horde-studio-virtual-human':
        raise ValueError('Choose a .horde_human archive, not a full application backup.')
    if type(value.get('_version')) is not int or value['_version'] not in (1,2,3):
        raise ValueError('Unsupported Virtual Human archive version.')
    if not isinstance(value.get('companion'),dict) or not isinstance(value['companion'].get('name'),str):
        raise ValueError('Archive is missing its character profile.')
    if value['_version']==3 and value.get('_kind') not in ('portable-human','character-template'):
        raise ValueError('Version 3 archive must declare portable-human or character-template.')
    return value


def inspect_archive(text):
    archive=parse_archive(text)
    c=archive['companion']; issues=[]
    def issue(code,path,message,severity='warning'):
        issues.append({'code':code,'path':path,'message':message,'severity':severity})
    count=0
    def scan(value,path='',depth=0):
        nonlocal count
        count+=1
        if depth>60 or count>250_000:raise ValueError('Archive is too deeply nested or complex for migration preview.')
        if isinstance(value,dict):
            for key,item in value.items():
                child=path+'/'+key
                normalized=''.join(ch for ch in key.lower() if ch.isalnum())
                if normalized in SECRET_FIELDS and item:
                    issue('credential',child,'Credential-bearing field: checkpoint storage is blocked. Export without credentials.','error')
                scan(item,child,depth+1)
        elif isinstance(value,list):
            for i,item in enumerate(value):scan(item,path+'/'+str(i),depth+1)
    scan(archive)
    def unknown(value,known,path):
        for key in sorted(set(value)-set(known)):
            issue('unmapped_field',path+'/'+key,'Preserved in the original checkpoint; no VH2 mapping is defined yet.')
    unknown(archive,['_format','_version','_kind','_exportedAt','companion','timelines','media','_mediaWarnings'],'')
    unknown(c,FIELDS['companionFields'],'/companion')
    def obj(value,path):
        if not isinstance(value,dict):
            issue('invalid_object',path,'Expected an object; it will not be repaired silently.','error');return {}
        return value
    def rows(value,path):
        if not isinstance(value,list):
            issue('invalid_list',path,'Expected a list; it will not be truncated or repaired.','error');return []
        return value
    def ids(values,path):
        result=set()
        for i,value in enumerate(values):
            value=obj(value,path+'/'+str(i)); key=value.get('id')
            if not isinstance(key,str) or not key:
                issue('missing_id',path+'/'+str(i),'Stable ID is missing.','error')
            elif key in result:issue('duplicate_id',path+'/'+str(i),'Duplicate stable ID within this collection.','error')
            else:result.add(key)
        return result
    life=obj(c.get('lifeProfile',{}),'/companion/lifeProfile')
    unknown(life,FIELDS['lifeProfileFields'],'/companion/lifeProfile')
    world=obj(life.get('world',{}),'/companion/lifeProfile/world')
    unknown(world,FIELDS['worldConfigFields'],'/companion/lifeProfile/world')
    places=rows(life.get('places',[]),'/companion/lifeProfile/places');place_ids=ids(places,'/companion/lifeProfile/places')
    items=rows(world.get('items',[]),'/companion/lifeProfile/world/items');item_ids=ids(items,'/companion/lifeProfile/world/items')
    for i,block in enumerate(rows(life.get('weeklySchedule',[]),'/companion/lifeProfile/weeklySchedule')):
        if isinstance(block,dict) and block.get('placeId') and (not isinstance(block['placeId'],str) or block['placeId'] not in place_ids):
            issue('missing_place',f'/companion/lifeProfile/weeklySchedule/{i}/placeId','Scheduled place does not exist.','error')
    for i,ref in enumerate(rows(c.get('photoLocations',[]),'/companion/photoLocations')):
        if isinstance(ref,dict) and ref.get('photo') and (not isinstance(ref.get('id'),str) or ref['id'] not in place_ids):
            issue('unlinked_reference',f'/companion/photoLocations/{i}','Legacy room reference has no exact place ID; label matching will not assign it automatically.')
    kind='portable-human' if archive['_version']==3 and archive['_kind']=='portable-human' else 'legacy-personal-archive' if archive['_version']==1 else 'character-template'
    timelines=obj(archive.get('timelines',{}),'/timelines')
    sessions=rows(timelines.get('sessions',[]),'/timelines/sessions');session_ids=ids(sessions,'/timelines/sessions')
    if kind=='character-template' and sessions:
        issue('template_history','/timelines','A template contains timelines. They are preserved for review, never treated as lived history.','error')
    if kind!='character-template' and sessions and (not isinstance(timelines.get('activeSessionId'),str) or timelines['activeSessionId'] not in session_ids):
        issue('missing_active_timeline','/timelines/activeSessionId','Active timeline does not exist.','error')
    result=[]
    for i,session in enumerate(sessions):
        if not isinstance(session,dict):continue
        path=f'/timelines/sessions/{i}';unknown(session,FIELDS['timelineFields'],path)
        runtime=obj(session.get('runtime',{}),path+'/runtime');unknown(runtime,FIELDS['runtimeFields'],path+'/runtime')
        messages=rows(session.get('messages',[]),path+'/messages');ids(messages,path+'/messages')
        continuity=obj(runtime.get('continuityRuntime',{}),path+'/runtime/continuityRuntime')
        persona=session.get('personaId','')
        if persona:
            issue('persona_profile_missing',path+'/personaId','Persona ID is preserved, but this archive does not include its profile. Link it explicitly before conversion.')
        if continuity.get('playerPersonaId') and continuity['playerPersonaId']!=persona:
            issue('persona_mismatch',path+'/runtime/continuityRuntime/playerPersonaId','Timeline and memory owner disagree; do not merge these player facts.','error')
        lr=obj(runtime.get('lifeRuntime',{}),path+'/runtime/lifeRuntime')
        wr=obj(lr.get('world',{}),path+'/runtime/lifeRuntime/world')
        for j,item_id in enumerate(rows(wr.get('inventory',[]),path+'/runtime/lifeRuntime/world/inventory')):
            if not isinstance(item_id,str) or item_id not in item_ids:
                issue('missing_item',path+f'/runtime/lifeRuntime/world/inventory/{j}','Owned item has no matching catalog entry.','error')
        if any(wr.get(k) not in (None,0) for k in ('balance','playerBalance')) and not wr.get('currency'):
            issue('unknown_balance_currency',path+'/runtime/lifeRuntime/world','Account balances have no currency. Preserve their values pending an explicit currency decision.')
        gifts=rows(wr.get('gifts',[]),path+'/runtime/lifeRuntime/world/gifts')
        for j,gift in enumerate(gifts):
            if not isinstance(gift,dict):continue
            if gift.get('kind')=='cash' and not gift.get('currency'):
                issue('unknown_currency',path+f'/runtime/lifeRuntime/world/gifts/{j}','Cash amount is preserved; historical currency must be supplied, not guessed.')
            if gift.get('kind')=='digital':
                issue('legacy_digital',path+f'/runtime/lifeRuntime/world/gifts/{j}','Retain as historical digital gift; do not convert into a mailed item.')
        result.append({'id':session.get('id'),'name':session.get('name',''),'personaId':persona,
                       'messages':len(messages),'memories':len(rows(runtime.get('memory',{}).get('longTerm',[]),path+'/runtime/memory/longTerm')) if isinstance(runtime.get('memory'),dict) else 0,
                       'gifts':len(gifts),'lastSimulatedAt':lr.get('lastSimulatedAt')})
    if archive.get('_mediaWarnings'):issue('external_media','/_mediaWarnings','The original exporter reported media that remained linked. Those links may expire; preview does not fetch them.')
    if not isinstance(c.get('id'),str) or not c['id']:issue('missing_character_id','/companion/id','Character ID is missing.','error')
    return {'reportVersion':REPORT_VERSION,'archiveDigest':hashlib.sha256(text.encode('utf-8')).hexdigest(),
            'byteLength':len(text.encode('utf-8')),'name':c['name'],'archiveVersion':archive['_version'],'kind':kind,
            'timelines':result,'counts':{'timelines':len(sessions),'places':len(places),'items':len(items)},
            'issues':issues,'canCheckpoint':not any(x['code']=='credential' for x in issues),
            'canActivate':False,'activationReason':'VH1-to-VH2 live conversion is not enabled. This step only inspects and preserves the source archive.'}
