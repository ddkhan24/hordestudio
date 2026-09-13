"""Portable service timeline archives. No provider credentials, no live jobs resumed."""
import base64,gzip,hashlib,json,io
TABLES=('events','photo_jobs','photo_assets','transcript_messages','media_records','memory_episodes','kernel_checkpoints','dialogue_jobs','vh2_provider_jobs','vh2_social_jobs','vh2_provider_outputs','vh2_story_jobs')
MAX_RAW=2*1024*1024*1024
MAX_COMPRESSED=256*1024*1024
MAX_CHARACTER_UPLOAD=MAX_COMPRESSED+64*1024
MAX_CHARACTER_METADATA=32*1024

def payload_chunks(payload):
 encoder=json.JSONEncoder(ensure_ascii=True,separators=(',',':'),sort_keys=True,allow_nan=False)
 for part in encoder.iterencode(payload):yield part.encode()

def payload_digest(payload):
 digest=hashlib.sha256()
 for part in payload_chunks(payload):digest.update(part)
 return digest.hexdigest()

def compress_payload(payload):
 output=io.BytesIO();digest=hashlib.sha256();size=0
 with gzip.GzipFile(fileobj=output,mode='wb',compresslevel=3,mtime=0) as stream:
  stream.write(b'{"payload":')
  for part in payload_chunks(payload):
   size+=len(part)
   if size>MAX_RAW:raise ValueError('This life exceeds the 2 GB uncompressed backup limit.')
   digest.update(part);stream.write(part)
  stream.write(b',"sha256":"'+digest.hexdigest().encode()+b'"}')
 if output.tell()>MAX_COMPRESSED:raise ValueError('This life exceeds the 256 MB compressed backup limit.')
 return output.getvalue()

def export(service,world_id):
 from vh2_runtime import encode,DATABASE_VERSION
 with service.connect() as db:
  db.execute('BEGIN');revision,state=service.read(db,world_id)
  tables={}
  for table in TABLES:
   rows=[dict(r) for r in db.execute(('SELECT * FROM vh2_provider_outputs WHERE job_id IN (SELECT id FROM vh2_provider_jobs WHERE world_id=?)' if table=='vh2_provider_outputs' else 'SELECT * FROM '+table+' WHERE world_id=?'),(world_id,))]
   if table=='photo_assets':
    for r in rows:r['bytes']=base64.b64encode(r['bytes']).decode()
   tables[table]=rows
  # Receipts are necessary for lost acknowledgements after recovery, scoped to this world.
  tables['commands']=[dict(r) for r in db.execute("SELECT * FROM commands WHERE json_extract(response,'$.worldId')=?",(world_id,))]
  payload={'format':'horde-vh2-world','version':1,'databaseVersion':DATABASE_VERSION,'worldId':world_id,'revision':revision,'state':state,'tables':tables}
  return compress_payload(payload)

def restore(service,data):
 from vh2_runtime import encode,apply_delta,Conflict,DATABASE_VERSION
 import io
 try:
  with gzip.GzipFile(fileobj=io.BytesIO(data)) as f:raw=f.read(MAX_RAW+129)
  if len(raw)>MAX_RAW+128:raise ValueError()
  envelope=json.loads(raw);payload=envelope['payload']
  if envelope['sha256']!=payload_digest(payload):raise ValueError()
  if payload['format']!='horde-vh2-world' or payload['version']!=1 or payload['databaseVersion']!=DATABASE_VERSION:raise ValueError()
  world_id=payload['worldId'];revision=payload['revision'];state=payload['state'];tables=payload['tables']
  tables.setdefault('vh2_provider_jobs',[])
  tables.setdefault('vh2_social_jobs',[])
  tables.setdefault('vh2_provider_outputs',[])
  tables.setdefault('vh2_story_jobs',[])
  if not isinstance(world_id,str) or type(revision) is not int or revision<1 or set(tables)!=set(TABLES)|{'commands'}:raise ValueError()
  events=sorted(tables['events'],key=lambda r:r['seq']);replayed={}
  if len(events)!=revision:raise ValueError()
  for sequence,row in enumerate(events,1):
   if row['seq']!=sequence or row['world_id']!=world_id:raise ValueError()
   replayed=apply_delta(replayed,json.loads(row['payload'])['changes'])
  if replayed!=state:raise ValueError()
  for table in TABLES:
   if not isinstance(tables[table],list):raise ValueError()
   if table=='vh2_provider_outputs':
    if any(r['job_id'] not in {j['id'] for j in tables['vh2_provider_jobs']} for r in tables[table]):raise ValueError()
   elif any(r['world_id']!=world_id for r in tables[table]):raise ValueError()
  for r in tables['photo_assets']:
   r['bytes']=base64.b64decode(r['bytes'],validate=True)
   if r['mime'] not in ('image/png','image/jpeg','image/webp','audio/wav','audio/x-wav','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/webm','audio/ogg','audio/webm;codecs=opus'):raise ValueError()
  for r in tables['commands']:
   if json.loads(r['response'])['worldId']!=world_id:raise ValueError()
 except (ValueError,TypeError,KeyError,EOFError,OSError):raise ValueError('Invalid, damaged or unsupported VH2 world archive.') from None
 with service.connect() as db:
  if not db.in_transaction:db.execute('BEGIN IMMEDIATE')
  if db.execute('SELECT 1 FROM worlds WHERE id=?',(world_id,)).fetchone():raise Conflict('This timeline already exists. Restore into a different local service database; existing timelines are never overwritten.')
  db.execute('INSERT INTO worlds VALUES (?,?,?)',(world_id,revision,encode(state)))
  for table in (*TABLES,'commands'):
   columns=[r[1] for r in db.execute('PRAGMA table_info('+table+')')]
   for row in tables[table]:
    if set(row)!=set(columns):raise ValueError('Archive table fields do not match this version.')
    if table in ('vh2_provider_jobs','vh2_social_jobs','vh2_story_jobs') and row['status'] in ('queued','submitted'):row.update(status='unknown',error='Restored job requires review; no automatic resubmission.')
    if table=='dialogue_jobs' and row['status'] in ('queued','leased','submitted'):
     row.update(status='unknown',token=None,lease_until=None,reason='Recovered from backup; previous submission outcome requires review.')
    db.execute('INSERT INTO '+table+' ('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')',[row[k] for k in columns])
  # Derived indexes and runnable jobs are rebuilt from the restored canonical state.
  after=json.loads(encode(state));after.update(running=False,simAnchor=state['simAt'],wallAnchor=service.clock())
  if after.get('integration'):after['integration']['autoReplies']=False
  after.get('communication',{}).pop('draft',None)
  job=after.get('communication',{}).get('replyJob')
  if job and job.get('status') in ('queued','leased','submitted'):
   job.update(status='unknown',reason='Restored timeline is paused. Review the previous submission before continuing.')
  for record in after.get('conversations',{}).values():
   inbox=record['roots']['communication'];inbox.pop('draft',None)
   job=inbox.get('replyJob')
   if job and job.get('status') in ('queued','leased','submitted'):job.update(status='unknown',reason='Restored conversation is paused; no automatic resubmission.')
  revision=service.commit_event(db,world_id,revision,state,after,'WORLD_RESTORED',{'sourceRevision':revision,'providersIncluded':False})
  return {'worldId':world_id,'revision':revision,'running':False,'requiresMigration':state['kernelVersion']!=service.kernel_version,'name':state['truth']['companion']['name']}


def restore_workspace(service,archives):
 """All service timelines in a Studio backup restore together or not at all."""
 from contextlib import contextmanager
 if not isinstance(archives,list) or len(archives)>100 or any(not isinstance(a,str) for a in archives):raise ValueError('Invalid workspace timeline archives.')
 if sum(map(len,archives))>256*1024*1024:raise ValueError('Workspace service archives exceed 256 MB.')
 try:decoded=[base64.b64decode(a,validate=True) for a in archives]
 except (ValueError,TypeError):raise ValueError('Invalid workspace archive encoding.') from None
 with service.connect() as db:
  db.execute('BEGIN IMMEDIATE')
  class TransactionService:
   def __getattr__(self,name):return getattr(service,name)
   @contextmanager
   def connect(self):yield db
  proxy=TransactionService()
  return {'worlds':[restore(proxy,data) for data in decoded]}

def read_character_package(source):
 """Read a bounded binary ZIP upload; never extract paths or inflate ZIP media."""
 import zipfile
 try:
  with zipfile.ZipFile(source) as package:
   infos=package.infolist();names=[i.filename for i in infos]
   if not 2<=len(infos)<=21 or len(set(names))!=len(names):raise ValueError()
   if any(i.compress_type!=zipfile.ZIP_STORED or i.flag_bits&1 or i.file_size!=i.compress_size for i in infos):raise ValueError()
   metadata=package.getinfo('restore.json')
   if metadata.file_size>MAX_CHARACTER_METADATA or sum(i.file_size for i in infos)-metadata.file_size>MAX_COMPRESSED:raise ValueError()
   body=json.loads(package.read(metadata))
   if not isinstance(body,dict) or body.pop('format',None)!='horde-character-lives' or body.pop('version',None)!=1 or set(body)!={'companionId','importId','archives'}:raise ValueError()
   if not isinstance(body['archives'],list) or not 1<=len(body['archives'])<=20:raise ValueError()
   expected={'restore.json'}
   for index,entry in enumerate(body['archives']):
    if not isinstance(entry,dict) or set(entry)!={'worldId','path'} or entry['path']!='lives/'+str(index)+'.gz':raise ValueError()
    expected.add(entry['path']);entry['data']=package.read(entry.pop('path'))
   if expected!=set(names):raise ValueError()
   return body
 except (ValueError,KeyError,TypeError,OSError,EOFError,zipfile.BadZipFile,RuntimeError):raise ValueError('Invalid or oversized binary character life package.') from None

def character_archives(body):
 """Normalize old base64 and new binary transport to the same bounded bytes."""
 if not isinstance(body,dict) or set(body)!={'archives','companionId','importId'}:raise ValueError('Invalid character restore fields.')
 archives=body['archives'];decoded=[];seen=set();total=0
 if not isinstance(archives,list) or not 1<=len(archives)<=20:raise ValueError('Invalid character life archives.')
 for entry in archives:
  if not isinstance(entry,dict) or set(entry)!={'worldId','data'} or not isinstance(entry['worldId'],str) or not 1<=len(entry['worldId'])<=100 or entry['worldId'] in seen:raise ValueError('Invalid or duplicate character life archive.')
  seen.add(entry['worldId']);data=entry['data']
  if isinstance(data,str):
   if len(data)>((MAX_COMPRESSED+2)//3)*4:raise ValueError('Character life archives exceed 256 MB.')
   try:data=base64.b64decode(data,validate=True)
   except (ValueError,TypeError):raise ValueError('Invalid character life archive encoding.') from None
  if not isinstance(data,bytes) or not data:raise ValueError('Invalid character life archive encoding.')
  total+=len(data)
  if total>MAX_COMPRESSED:raise ValueError('Character life archives exceed 256 MB combined.')
  decoded.append({'worldId':entry['worldId'],'data':data})
 return decoded

def legacy_character_fingerprint(body,archives):
 """Honor old durable receipts without rebuilding their giant base64 JSON body."""
 from vh2_runtime import encode
 digest=hashlib.sha256();digest.update(b'{"archives":[')
 for index,entry in enumerate(archives):
  if index:digest.update(b',')
  digest.update(b'{"data":"');raw=entry['data']
  for at in range(0,len(raw),3*1024*1024):digest.update(base64.b64encode(raw[at:at+3*1024*1024]))
  digest.update(b'","worldId":'+encode(entry['worldId']).encode()+b'}')
 digest.update(b'],"companionId":'+encode(body['companionId']).encode()+b',"importId":'+encode(body['importId']).encode()+b'}')
 return digest.hexdigest()

def character_merge_graph(archives):
 """Resolve package-local aliases before importing anything; never link a copy to a source life."""
 links={}
 for archive in archives:
  try:
   with gzip.GzipFile(fileobj=io.BytesIO(archive['data'])) as stream:raw=stream.read(MAX_RAW+129)
   if len(raw)>MAX_RAW+128:raise ValueError()
   payload=json.loads(raw)['payload']
   if payload['worldId']!=archive['worldId']:raise ValueError()
   target=payload['state'].get('mergedInto')
   if target is not None and (not isinstance(target,str) or not target):raise ValueError()
   links[archive['worldId']]=target
  except (KeyError,TypeError,ValueError,OSError,EOFError):raise ValueError('Invalid character life archive.') from None
 canonical={}
 for ident in links:
  seen=set();target=ident
  while links.get(target):
   if target in seen:raise ValueError('Character archives contain a circular merged-life link.')
   seen.add(target);target=links[target]
   if target not in links:raise ValueError('This package is missing the canonical life for a merged archive. Export the complete portable character again.')
  canonical[ident]=target
 return links,canonical

def restore_character(service,body):
 """Restore one portable character as an isolated copy, atomically and idempotently."""
 import uuid,io
 from contextlib import contextmanager
 from vh2_runtime import encode,apply_delta,delta,Conflict
 archives=character_archives(body);companion=body.get('companionId');key=body.get('importId')
 if not isinstance(companion,str) or not 1<=len(companion)<=100 or not isinstance(key,str) or not 1<=len(key)<=100:raise ValueError('A character and import identity are required.')
 fingerprint='binary-v1:'+hashlib.sha256(encode({'companionId':companion,'importId':key,'archives':[{'worldId':a['worldId'],'sha256':hashlib.sha256(a['data']).hexdigest()} for a in archives]}).encode()).hexdigest();receipt_key='character-import:'+key
 with service.connect() as db:
  db.execute('BEGIN IMMEDIATE')
  previous=db.execute('SELECT fingerprint,response FROM commands WHERE key=?',(receipt_key,)).fetchone()
  if previous:
   if previous['fingerprint']!=fingerprint and previous['fingerprint']!=legacy_character_fingerprint(body,archives):raise Conflict('Import identity was reused for a different package.')
  links,canonical=character_merge_graph(archives)
  world_mapping={a['worldId']:str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-character-import:'+key+':'+a['worldId'])) for a in archives}
  def remap_merge_record(value):
   if isinstance(value,dict):return {k:remap_merge_record(v) for k,v in value.items()}
   if isinstance(value,list):return [remap_merge_record(v) for v in value]
   return world_mapping.get(value,value) if isinstance(value,str) else value
  if previous:
   result=json.loads(previous['response'])
   # Recover imports produced before package-wide alias mapping. The receipt
   # owns these copied rows; never retarget an original/user-edited life.
   for row in result['worlds']:
    source=row['sourceWorldId'];target=world_mapping[canonical[source]]
    if row['worldId']!=world_mapping[source]:raise Conflict('The saved import receipt has an unexpected life identity.')
    revision,state=service.read(db,row['worldId'])
    after=json.loads(encode(state))
    if links[source] and state.get('mergedInto')!=target:
     if state.get('mergedInto') not in (links[source],world_mapping[links[source]]):raise Conflict('This imported life was merged elsewhere after import; its link needs review.')
     after['mergedInto']=target
    if 'mergeRecord' in after:after['mergeRecord']=remap_merge_record(after['mergeRecord'])
    if after!=state:
     revision=service.commit_event(db,row['worldId'],revision,state,after,'CHARACTER_IMPORT_LINK_REPAIRED',{'sourceWorldId':source,'canonicalWorldId':target})
     row['revision']=revision
    row['canonicalWorldId']=target
   db.execute('UPDATE commands SET response=? WHERE key=?',(encode(result),receipt_key))
   return result
  class TransactionService:
   def __getattr__(self,name):return getattr(service,name)
   @contextmanager
   def connect(self):yield db
  proxy=TransactionService();results=[]
  for archive in archives:
   try:
    raw=archive['data']
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as f:decoded=f.read(MAX_RAW+129)
    if len(decoded)>MAX_RAW+128:raise ValueError()
    envelope=json.loads(decoded);payload=envelope['payload'];old=payload['worldId']
    if old!=archive['worldId'] or envelope['sha256']!=payload_digest(payload):raise ValueError()
    # Verify original event replay before rewriting identifiers or checksums.
    original={}
    for seq,event in enumerate(payload['tables']['events'],1):
     if event['seq']!=seq or event['world_id']!=old:raise ValueError()
     original=apply_delta(original,json.loads(event['payload'])['changes'])
    if original!=payload['state'] or len(payload['tables']['events'])!=payload['revision']:raise ValueError()
   except (KeyError,TypeError,ValueError,OSError,EOFError):raise ValueError('Invalid character life archive.') from None
   original_personas=__import__('vh2_conversations').ids(payload['state'])
   new=world_mapping[old]
   mapping={**world_mapping,**{ident+':human':mapped+':human' for ident,mapped in world_mapping.items()}}
   for table in ('photo_jobs','photo_assets','transcript_messages','memory_episodes','kernel_checkpoints','dialogue_jobs','vh2_provider_jobs','vh2_social_jobs','vh2_story_jobs'):
    for row in payload['tables'].get(table,[]):
     ident=row['id'];mapping.setdefault(ident,hashlib.sha256((new+':'+ident).encode()).hexdigest() if table=='photo_assets' else str(uuid.uuid5(uuid.NAMESPACE_URL,new+':'+ident)))
   for row in payload['tables'].get('vh2_provider_jobs',[]):
    if row['id'].startswith('image:'):mapping[row['id']]='image:'+mapping.get(row['id'][6:],row['id'][6:])
   for row in payload['tables'].get('commands',[]):mapping[row['key']]=str(uuid.uuid5(uuid.NAMESPACE_URL,new+':command:'+row['key']))
   def remap(value):
    if isinstance(value,dict):return {mapping.get(k,k):remap(v) for k,v in value.items()}
    if isinstance(value,list):return [remap(v) for v in value]
    if isinstance(value,str):return mapping.get(value,value.replace(old+':',new+':'))
    return value
   def remap_state(value):
    result=remap(value)
    if value.get('mergedInto'):
     if value['mergedInto'] not in canonical:raise ValueError('A historical merged-life target is missing from this package.')
     result['mergedInto']=world_mapping[canonical[value['mergedInto']]]
    if result.get('integration'):result['integration'].update(sourceCompanionId=companion,providerScope='horde:'+companion)
    return result
   original={};last={}
   for event in payload['tables']['events']:
    detail=json.loads(event['payload']);original=apply_delta(original,detail['changes']);next_state=remap_state(original)
    event.update(world_id=new,payload=encode({**detail,'changes':delta(last,next_state),'details':remap(detail.get('details',{}))}));last=next_state
   for table,rows in payload['tables'].items():
    if table=='events':continue
    for row in rows:
     for field,value in list(row.items()):
      if field in ('snapshot','result','data','response','state') and isinstance(value,str):
       try:parsed=json.loads(value)
       except (ValueError,TypeError):row[field]=remap(value)
       else:row[field]=encode(remap_state(parsed) if field=='state' else remap(parsed))
      else:row[field]=remap(value)
   payload.update(worldId=new,state=last)
   envelope={'payload':payload,'sha256':payload_digest(payload)}
   result=restore(proxy,compress_payload(payload));result['sourceWorldId']=old;result['canonicalWorldId']=world_mapping[canonical[old]];result['personaMap']={p:remap(p) for p in original_personas};results.append(result)
  result={'worlds':results};db.execute('INSERT INTO commands VALUES (?,?,?)',(receipt_key,fingerprint,encode(result)));return result
