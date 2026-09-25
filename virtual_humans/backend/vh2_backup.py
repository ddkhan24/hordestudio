"""Portable service timeline archives. No provider credentials, no live jobs resumed."""
from importlib import import_module as _vh_import_module
import base64,gzip,hashlib,json,io,zipfile
TABLES=('events','event_landmarks','photo_jobs','photo_assets','transcript_messages','media_records','memory_episodes','kernel_checkpoints','dialogue_jobs','dialogue_receipts','vh2_provider_jobs','vh2_social_jobs','vh2_provider_outputs','vh2_story_jobs')
MAX_RAW=2*1024*1024*1024
MAX_COMPRESSED=256*1024*1024
MAX_TRANSFER_ARCHIVE=2*1024*1024*1024
MAX_TRANSFER_MANIFEST=256*1024*1024
MAX_TRANSFER_ASSETS=10000
MAX_CHARACTER_UPLOAD=MAX_COMPRESSED+64*1024
MAX_CHARACTER_METADATA=32*1024
TRANSFER_FORMAT='horde-vh2-transfer-checkpoint'
TRANSFER_TABLES=tuple(table for table in TABLES if table not in ('events','photo_assets'))
MEDIA_MIME_TYPES=('image/png','image/jpeg','image/webp','audio/wav','audio/x-wav','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/webm','audio/ogg','audio/webm;codecs=opus')

def portable_dialogue_rows(rows):
 """Keep runnable/uncertain jobs and a bounded, no-content activity audit."""
 from . import vh2_dialogue
 active=[dict(row) for row in rows if row['status'] not in vh2_dialogue.TERMINAL_STATUSES]
 terminal=sorted((dict(row) for row in rows if row['status'] in vh2_dialogue.TERMINAL_STATUSES),
                 key=lambda row:(row.get('created_at',0),row.get('id','')),reverse=True)[:vh2_dialogue.MAX_TERMINAL_JOBS]
 return active+[vh2_dialogue.compact_row(row) for row in terminal]

def portable_provider_rows(rows,now):
 """Bound terminal image/route audits while preserving today's image allowance."""
 from . import vh2_workers
 day=int(now)//86400000*86400000
 active=[];terminal=[]
 for source in rows:
  row=dict(source)
  if row['status'] not in vh2_workers.TERMINAL_STATUSES:active.append(row);continue
  snapshot=json.loads(row['snapshot'])
  protected=(row['kind']=='image' and day<=row['created_at']<day+86400000
             and snapshot.get('automatic') in (True,1))
  terminal.append((protected,row))
 terminal.sort(key=lambda item:(item[1].get('created_at',0),item[1].get('id','')),reverse=True)
 keep=[row for index,(protected,row) in enumerate(terminal)
       if protected or index<vh2_workers.MAX_TERMINAL_JOBS]
 return active+[vh2_workers.compact_job_row(row) for row in keep]

def portable_background_rows(table,rows):
 """Bound completed LLM working documents; uncertain submissions stay intact."""
 module=_vh_import_module('.vh2_social_worker' if table=='vh2_social_jobs' else '.vh2_story',__package__)
 active=[];terminal=[]
 for index,source in enumerate(rows):
  row=dict(source)
  if row['status'] in module.TERMINAL_STATUSES:terminal.append((row.get('created_at',index),index,row))
  else:active.append(row)
 terminal.sort(reverse=True,key=lambda item:(item[0],item[1]))
 return active+[module.compact_job_row(row) for _,_,row in terminal[:module.MAX_TERMINAL_JOBS]]

def replay_archive_events(events,world_id,revision):
 """Replay complete or checkpoint-compacted event histories.

 A compacted history starts at a later sequence with one root-state change.
 The original revision is retained so stale clients and handoff fencing still
 reject writes made against the pre-transfer life.
 """
 from .vh2_runtime import apply_delta,decode_event_payload
 events=sorted(events,key=lambda row:row['seq'])
 if not events or events[-1]['seq']!=revision:raise ValueError()
 prior=0;state={}
 for index,row in enumerate(events):
  sequence=row['seq']
  if type(sequence) is not int or sequence<=prior or row['world_id']!=world_id:raise ValueError()
  detail=decode_event_payload(row['payload']);changes=detail['changes']
  if index==0 and sequence!=1:
   if not changes or changes[0].get('path')!=[] or not detail.get('details',{}).get('transferCheckpoint'):raise ValueError()
  state=apply_delta(state,changes);prior=sequence
 return state

def _archive_source(source):
 if isinstance(source,(bytes,bytearray,memoryview)):return io.BytesIO(bytes(source))
 if hasattr(source,'seek'):source.seek(0)
 return source

def is_transfer_archive(source):
 try:
  opened=_archive_source(source)
  if hasattr(opened,'read'):
   marker=opened.read(4);opened.seek(0)
  else:
   with open(opened,'rb') as stream:marker=stream.read(4)
  return marker==b'PK\x03\x04'
 except (OSError,ValueError):return False

def _read_transfer_payload(source,verify_assets=True):
 """Read a bounded checkpoint manifest and optionally verify every media blob."""
 try:
  with zipfile.ZipFile(_archive_source(source)) as package:
   infos=package.infolist();names=[item.filename for item in infos]
   if not 1<=len(infos)<=MAX_TRANSFER_ASSETS+1 or len(names)!=len(set(names)):raise ValueError()
   manifest=package.getinfo('manifest.json')
   if manifest.file_size>MAX_TRANSFER_MANIFEST or manifest.compress_type!=zipfile.ZIP_DEFLATED or manifest.flag_bits&1:raise ValueError()
   envelope=json.loads(package.read(manifest));payload=envelope['payload']
   if envelope['sha256']!=payload_digest(payload):raise ValueError()
   if payload['format']!=TRANSFER_FORMAT or payload['version']!=1:raise ValueError()
   assets=payload['assets'];expected={'manifest.json'}
   if not isinstance(assets,list) or len(assets)>MAX_TRANSFER_ASSETS:raise ValueError()
   total=manifest.file_size
   for index,asset in enumerate(assets):
    if not isinstance(asset,dict) or set(asset)!={'id','world_id','mime','path','size','sha256'}:raise ValueError()
    path='assets/'+str(index)+'.bin'
    if asset['path']!=path or asset['mime'] not in MEDIA_MIME_TYPES or type(asset['size']) is not int or asset['size']<0:raise ValueError()
    info=package.getinfo(path)
    if info.compress_type!=zipfile.ZIP_STORED or info.flag_bits&1 or info.file_size!=asset['size'] or info.compress_size!=info.file_size:raise ValueError()
    total+=info.file_size;expected.add(path)
    if total>MAX_TRANSFER_ARCHIVE:raise ValueError()
    if verify_assets:
     digest=hashlib.sha256()
     with package.open(info) as stream:
      while True:
       chunk=stream.read(1024*1024)
       if not chunk:break
       digest.update(chunk)
     if digest.hexdigest()!=asset['sha256']:raise ValueError()
   if expected!=set(names):raise ValueError()
   return payload
 except (ValueError,TypeError,KeyError,EOFError,OSError,json.JSONDecodeError,zipfile.BadZipFile,RuntimeError):
  raise ValueError('Invalid, damaged or unsupported VH2 transfer checkpoint.') from None

def export_checkpoint(service,world_id,target=None):
 """Write a compact, media-complete handoff without reading the event ledger.

 The destination receives a cryptographically verified current-state anchor at
 the same revision. Raw replay deltas remain in the untouched source database.
 Assets are stored as separate ZIP members so they are never base64-expanded.
 """
 from .vh2_runtime import DATABASE_VERSION,encode
 from . import vh2_media
 output=target if target is not None else io.BytesIO()
 with service.connect() as db:
  db.execute('BEGIN');revision,state=service.read(db,world_id)
  tables={}
  # Frozen capture snapshots contain a complete point-in-time person model and
  # can dwarf the actual media library when retained after a photo is already
  # delivered. Only unfinished/retryable captures need that working document;
  # completed media keep their canonical photo record, manifest and binary.
  active_photo_ids={item.get('id') for item in state.get('photos',[]) if item.get('status') in ('captured','submitted')}
  for table in TRANSFER_TABLES:
   query=('SELECT * FROM dialogue_receipts WHERE job_id IN (SELECT id FROM dialogue_jobs WHERE world_id=?)' if table=='dialogue_receipts' else 'SELECT * FROM vh2_provider_outputs WHERE job_id IN (SELECT id FROM vh2_provider_jobs WHERE world_id=?)' if table=='vh2_provider_outputs' else 'SELECT * FROM '+table+' WHERE world_id=?')
   rows=[dict(row) for row in db.execute(query,(world_id,))]
   if table=='dialogue_jobs':
    rows=portable_dialogue_rows(rows);portable_dialogue_ids={row['id'] for row in rows}
   elif table=='dialogue_receipts':rows=[row for row in rows if row['job_id'] in portable_dialogue_ids]
   elif table=='vh2_provider_jobs':
    rows=portable_provider_rows(rows,service.clock());portable_provider_ids={row['id'] for row in rows}
   elif table=='vh2_provider_outputs':rows=[row for row in rows if row['job_id'] in portable_provider_ids]
   elif table in ('vh2_social_jobs','vh2_story_jobs'):rows=portable_background_rows(table,rows)
   rows=[row for row in rows if table!='photo_jobs' or row['id'] in active_photo_ids]
   if table=='photo_jobs':
    for row in rows:
     row['snapshot']=encode(vh2_media.compact_capture_snapshot(json.loads(row['snapshot'])))
   tables[table]=rows
  tables['commands']=[dict(row) for row in db.execute("SELECT * FROM commands WHERE json_extract(response,'$.worldId')=?",(world_id,))]
  history=db.execute('SELECT COUNT(*),MIN(seq),MAX(seq) FROM events WHERE world_id=?',(world_id,)).fetchone()
  with zipfile.ZipFile(output,'w',allowZip64=True) as package:
   assets=[]
   rows=db.execute('SELECT rowid,id,world_id,mime,length(bytes) AS size FROM photo_assets WHERE world_id=? ORDER BY id',(world_id,)).fetchall()
   if len(rows)>MAX_TRANSFER_ASSETS:raise ValueError('This life contains too many media assets for one transfer.')
   total=0
   for index,row in enumerate(rows):
    size=int(row['size'] or 0);total+=size
    if total>MAX_TRANSFER_ARCHIVE:raise ValueError('This life contains more than 2 GB of media. Remove unused media or use a server-side migration.')
    path='assets/'+str(index)+'.bin';digest=hashlib.sha256()
    info=zipfile.ZipInfo(path);info.compress_type=zipfile.ZIP_STORED
    with package.open(info,'w',force_zip64=True) as sink:
     offset=1
     while offset<=size:
      chunk=db.execute('SELECT substr(bytes,?,?) FROM photo_assets WHERE rowid=?',(offset,min(1024*1024,size-offset+1),row['rowid'])).fetchone()[0]
      if not chunk:raise ValueError('A media asset changed while the transfer checkpoint was being written.')
      digest.update(chunk);sink.write(chunk);offset+=len(chunk)
    assets.append({'id':row['id'],'world_id':row['world_id'],'mime':row['mime'],'path':path,'size':size,'sha256':digest.hexdigest()})
   payload={'format':TRANSFER_FORMAT,'version':1,'databaseVersion':DATABASE_VERSION,'worldId':world_id,'revision':revision,'state':state,'tables':tables,'assets':assets,
            'history':{'mode':'checkpoint','eventCount':history[0],'firstSequence':history[1],'lastSequence':history[2]}}
   manifest=zipfile.ZipInfo('manifest.json');manifest.compress_type=zipfile.ZIP_DEFLATED
   digest=hashlib.sha256()
   with package.open(manifest,'w',force_zip64=True) as sink:
    sink.write(b'{"payload":')
    for part in payload_chunks(payload):digest.update(part);sink.write(part)
    sink.write(b',"sha256":"'+digest.hexdigest().encode()+b'"}')
 if target is None:return output.getvalue()
 return {'worldId':world_id,'revision':revision,'assets':len(assets),'eventCount':history[0]}

def inspect_world_archive(data):
 """Validate a world archive without importing it and return safe metadata."""
 from .vh2_runtime import DATABASE_VERSION
 if is_transfer_archive(data):
  payload=_read_transfer_payload(data)
  world_id=payload['worldId'];revision=payload['revision'];state=payload['state'];tables=payload['tables']
  if payload['databaseVersion']!=DATABASE_VERSION or not isinstance(world_id,str) or not 1<=len(world_id)<=100 or type(revision) is not int or revision<1:raise ValueError('Invalid, damaged or unsupported VH2 transfer checkpoint.')
  if set(tables)!=set(TRANSFER_TABLES)|{'commands'} or any(not isinstance(rows,list) for rows in tables.values()):raise ValueError('Invalid, damaged or unsupported VH2 transfer checkpoint.')
  if any(asset['world_id']!=world_id for asset in payload['assets']):raise ValueError('Invalid, damaged or unsupported VH2 transfer checkpoint.')
  name=state.get('truth',{}).get('companion',{}).get('name','')
  return {'worldId':world_id,'revision':revision,'running':state.get('running') is True,'name':name,'archiveMode':'checkpoint','eventCount':payload['history']['eventCount']}
 if not isinstance(data,bytes) or not 0<len(data)<=MAX_COMPRESSED:raise ValueError('Invalid or oversized VH2 world archive.')
 try:
  with gzip.GzipFile(fileobj=io.BytesIO(data)) as f:raw=f.read(MAX_RAW+129)
  if len(raw)>MAX_RAW+128:raise ValueError()
  envelope=json.loads(raw);payload=envelope['payload']
  if envelope['sha256']!=payload_digest(payload):raise ValueError()
  if payload['format']!='horde-vh2-world' or payload['version']!=1 or payload['databaseVersion'] not in (9,DATABASE_VERSION):raise ValueError()
  world_id=payload['worldId'];revision=payload['revision'];state=payload['state'];tables=payload['tables']
  if not isinstance(world_id,str) or not 1<=len(world_id)<=100 or type(revision) is not int or revision<1:raise ValueError()
  replayed=replay_archive_events(tables['events'],world_id,revision)
  if replayed!=state:raise ValueError()
  name=state.get('truth',{}).get('companion',{}).get('name','')
  return {'worldId':world_id,'revision':revision,'running':state.get('running') is True,'name':name}
 except (ValueError,TypeError,KeyError,EOFError,OSError,json.JSONDecodeError):raise ValueError('Invalid, damaged or unsupported VH2 world archive.') from None

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
 from .vh2_runtime import encode, DATABASE_VERSION
 with service.connect() as db:
  db.execute('BEGIN');revision,state=service.read(db,world_id)
  tables={}
  for table in TABLES:
   rows=[dict(r) for r in db.execute(('SELECT * FROM dialogue_receipts WHERE job_id IN (SELECT id FROM dialogue_jobs WHERE world_id=?)' if table=='dialogue_receipts' else 'SELECT * FROM vh2_provider_outputs WHERE job_id IN (SELECT id FROM vh2_provider_jobs WHERE world_id=?)' if table=='vh2_provider_outputs' else 'SELECT * FROM '+table+' WHERE world_id=?'),(world_id,))]
   if table=='dialogue_jobs':
    rows=portable_dialogue_rows(rows);portable_dialogue_ids={row['id'] for row in rows}
   elif table=='dialogue_receipts':rows=[row for row in rows if row['job_id'] in portable_dialogue_ids]
   elif table=='vh2_provider_jobs':
    rows=portable_provider_rows(rows,service.clock());portable_provider_ids={row['id'] for row in rows}
   elif table=='vh2_provider_outputs':rows=[row for row in rows if row['job_id'] in portable_provider_ids]
   elif table in ('vh2_social_jobs','vh2_story_jobs'):rows=portable_background_rows(table,rows)
   if table=='photo_assets':
    for r in rows:r['bytes']=base64.b64encode(r['bytes']).decode()
   tables[table]=rows
  # Receipts are necessary for lost acknowledgements after recovery, scoped to this world.
  tables['commands']=[dict(r) for r in db.execute("SELECT * FROM commands WHERE json_extract(response,'$.worldId')=?",(world_id,))]
  payload={'format':'horde-vh2-world','version':1,'databaseVersion':DATABASE_VERSION,'worldId':world_id,'revision':revision,'state':state,'tables':tables}
  return compress_payload(payload)

def _validate_transfer_tables(payload):
 world_id=payload['worldId'];tables=payload['tables']
 if set(tables)!=set(TRANSFER_TABLES)|{'commands'}:raise ValueError()
 for table in TRANSFER_TABLES:
  if not isinstance(tables[table],list):raise ValueError()
  if table=='dialogue_receipts':
   jobs={row['id'] for row in tables['dialogue_jobs']}
   if any(row['job_id'] not in jobs for row in tables[table]):raise ValueError()
   for receipt in tables[table]:
    usage=json.loads(receipt['usage'])
    if not isinstance(usage,dict) or set(usage)-{'prompt_tokens','completion_tokens','total_tokens','cached_tokens','reasoning_tokens'} or any(type(value) is not int or value<0 for value in usage.values()):raise ValueError()
  elif table=='vh2_provider_outputs':
   jobs={row['id'] for row in tables['vh2_provider_jobs']}
   if any(row['job_id'] not in jobs for row in tables[table]):raise ValueError()
  elif any(row['world_id']!=world_id for row in tables[table]):raise ValueError()
 for row in tables['commands']:
  if json.loads(row['response'])['worldId']!=world_id:raise ValueError()

def restore_checkpoint(service,source):
 """Restore a transfer checkpoint as a paused single-primary life."""
 from .vh2_runtime import encode,encode_event_payload,Conflict,DATABASE_VERSION
 payload=_read_transfer_payload(source,verify_assets=False);world_id=payload['worldId'];revision=payload['revision'];state=payload['state']
 try:
  if payload['databaseVersion']!=DATABASE_VERSION or not isinstance(world_id,str) or not 1<=len(world_id)<=100 or type(revision) is not int or revision<1:raise ValueError()
  _validate_transfer_tables(payload)
 except (ValueError,TypeError,KeyError,json.JSONDecodeError):raise ValueError('Invalid, damaged or unsupported VH2 transfer checkpoint.') from None
 with service.connect() as db:
  if not db.in_transaction:db.execute('BEGIN IMMEDIATE')
  if db.execute('SELECT 1 FROM worlds WHERE id=?',(world_id,)).fetchone():raise Conflict('This timeline already exists. Restore into a different service database; existing timelines are never overwritten.')
  db.execute('INSERT INTO worlds VALUES (?,?,?)',(world_id,revision,encode(state)))
  checkpoint={'schemaVersion':1,'kernelVersion':state['kernelVersion'],'changes':[{'path':[],'value':state}],
              'details':{'transferCheckpoint':True,'sourceRevision':revision,'sourceEventCount':payload['history']['eventCount']}}
  db.execute('INSERT INTO events VALUES (?,?,?,?,?)',(world_id,revision,state['simAt'],'WORLD_TRANSFER_CHECKPOINT',encode_event_payload(checkpoint)))
  for table in (*TRANSFER_TABLES,'commands'):
   columns=[row[1] for row in db.execute('PRAGMA table_info('+table+')')]
   for row in payload['tables'][table]:
    row=dict(row)
    if set(row)!=set(columns):raise ValueError('Transfer checkpoint fields do not match this version.')
    if table=='vh2_provider_outputs':
     parent=db.execute('SELECT status FROM vh2_provider_jobs WHERE id=?',(row['job_id'],)).fetchone()
     if not parent or parent['status']!='rendered':continue
    if table in ('vh2_provider_jobs','vh2_social_jobs','vh2_story_jobs') and row['status'] in ('queued','submitted'):row.update(status='unknown',error='Transferred job requires review; no automatic resubmission.')
    if table=='dialogue_jobs' and row['status'] in ('queued','leased','submitted'):row.update(status='unknown',token=None,lease_until=None,reason='Transferred job requires review; no automatic resubmission.')
    db.execute('INSERT INTO '+table+' ('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')',[row[key] for key in columns])
  with zipfile.ZipFile(_archive_source(source)) as package:
   for asset in payload['assets']:
    data=package.read(asset['path'])
    if len(data)!=asset['size'] or hashlib.sha256(data).hexdigest()!=asset['sha256']:raise ValueError('A media asset failed transfer verification.')
    db.execute('INSERT INTO photo_assets VALUES (?,?,?,?)',(asset['id'],world_id,asset['mime'],data))
  after=json.loads(encode(state));after.update(running=False,simAnchor=state['simAt'],wallAnchor=service.clock())
  if after.get('integration'):after['integration']['autoReplies']=False
  after.get('communication',{}).pop('draft',None)
  job=after.get('communication',{}).get('replyJob')
  if job and job.get('status') in ('queued','leased','submitted'):job.update(status='unknown',reason='Transferred timeline is paused. Review the previous submission before continuing.')
  for record in after.get('conversations',{}).values():
   inbox=record['roots']['communication'];inbox.pop('draft',None)
   job=inbox.get('replyJob')
   if job and job.get('status') in ('queued','leased','submitted'):job.update(status='unknown',reason='Transferred conversation is paused; no automatic resubmission.')
  revision=service.commit_event(db,world_id,revision,state,after,'WORLD_RESTORED',{'sourceRevision':revision,'providersIncluded':False,'transferCheckpoint':True})
  return {'worldId':world_id,'revision':revision,'running':False,'requiresMigration':state['kernelVersion']!=service.kernel_version,'name':state['truth']['companion']['name'],'archiveMode':'checkpoint'}

def restore(service,data):
 from .vh2_runtime import encode, apply_delta, decode_event_payload, Conflict, DATABASE_VERSION
 import io
 if is_transfer_archive(data):return restore_checkpoint(service,data)
 try:
  with gzip.GzipFile(fileobj=io.BytesIO(data)) as f:raw=f.read(MAX_RAW+129)
  if len(raw)>MAX_RAW+128:raise ValueError()
  envelope=json.loads(raw);payload=envelope['payload']
  if envelope['sha256']!=payload_digest(payload):raise ValueError()
  if payload['format']!='horde-vh2-world' or payload['version']!=1 or payload['databaseVersion'] not in (9,DATABASE_VERSION):raise ValueError()
  world_id=payload['worldId'];revision=payload['revision'];state=payload['state'];tables=payload['tables']
  # Version 9 archives predate the compact human-readable landmark index. The
  # event stream remains authoritative, so importing an empty index is safe;
  # new events populate it normally after restore.
  if payload['databaseVersion']==9:tables.setdefault('event_landmarks',[])
  tables.setdefault('vh2_provider_jobs',[])
  tables.setdefault('vh2_social_jobs',[])
  tables.setdefault('vh2_provider_outputs',[])
  tables.setdefault('vh2_story_jobs',[])
  tables.setdefault('dialogue_receipts',[])
  if not isinstance(world_id,str) or type(revision) is not int or revision<1 or set(tables)!=set(TABLES)|{'commands'}:raise ValueError()
  replayed=replay_archive_events(tables['events'],world_id,revision)
  if replayed!=state:raise ValueError()
  for table in TABLES:
   if not isinstance(tables[table],list):raise ValueError()
   if table=='dialogue_receipts':
    if any(r['job_id'] not in {j['id'] for j in tables['dialogue_jobs']} for r in tables[table]):raise ValueError()
    for receipt in tables[table]:
     usage=json.loads(receipt['usage'])
     if not isinstance(usage,dict) or set(usage)-{'prompt_tokens','completion_tokens','total_tokens','cached_tokens','reasoning_tokens'} or any(type(v) is not int or v<0 for v in usage.values()):raise ValueError()
   elif table=='vh2_provider_outputs':
    if any(r['job_id'] not in {j['id'] for j in tables['vh2_provider_jobs']} for r in tables[table]):raise ValueError()
   elif any(r['world_id']!=world_id for r in tables[table]):raise ValueError()
  for r in tables['photo_assets']:
   r['bytes']=base64.b64decode(r['bytes'],validate=True)
   if r['mime'] not in MEDIA_MIME_TYPES:raise ValueError()
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
    if table=='vh2_provider_outputs':
     parent=db.execute('SELECT status FROM vh2_provider_jobs WHERE id=?',(row['job_id'],)).fetchone()
     if not parent or parent['status']!='rendered':continue
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
 from .vh2_runtime import encode
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
 from .vh2_runtime import encode, encode_event_payload, decode_event_payload, apply_delta, delta, Conflict
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
    # Verify complete and checkpoint-compacted histories before rewriting
    # identifiers or checksums.
    original=replay_archive_events(payload['tables']['events'],old,payload['revision'])
    if original!=payload['state']:raise ValueError()
   except (KeyError,TypeError,ValueError,OSError,EOFError):raise ValueError('Invalid character life archive.') from None
   original_personas=_vh_import_module('.vh2_conversations',__package__).ids(payload['state'])
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
   for event_index,event in enumerate(payload['tables']['events']):
    detail=decode_event_payload(event['payload']);original=apply_delta(original,detail['changes']);next_state=remap_state(original)
    # A transferred/compacted life can intentionally begin at a sequence
    # greater than one. Preserve that first row as a root checkpoint after
    # identifier remapping; delta({}, state) would otherwise expand it into
    # top-level paths and make the sparse history impossible to authenticate.
    changes=([{'path':[],'value':next_state}] if event_index==0 and event['seq']!=1 else delta(last,next_state))
    event.update(world_id=new,payload=encode_event_payload({**detail,'changes':changes,'details':remap(detail.get('details',{}))}));last=next_state
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
