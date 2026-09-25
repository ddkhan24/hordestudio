"""Portable archive integrity, isolation, credential exclusion and paused recovery."""
from test_runtime import node_executable
import sys,tempfile,unittest,json,gzip,uuid,io,zipfile,base64,hashlib
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from virtual_humans.backend.vh2_runtime import WorldService, Conflict
from virtual_humans.backend import vh2_backup; from virtual_humans.backend import vh2_library
ROOT=Path(__file__).resolve().parents[1]
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
class Backup(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.source=self.open('source');self.dest=self.open('destination');self.w=self.source.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
 def open(self,name):return WorldService(Path(self.tmp.name)/name,node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.source.close();self.dest.close();self.tmp.cleanup()
 def cmd(self,kind,**values):return self.source.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.source.projection(self.w)['revision'],**values))
 def test_roundtrip_assets_events_receipts_and_no_credentials(self):
  self.source.dialogue_provider.save(dict(baseUrl='http://127.0.0.1:9999/v1',model='fixture',apiKey='NOT_FOR_EXPORT',enabled=False,maxTokens=100,dailyLimit=1,temperature=.5))
  pid=self.cmd('capture_photo',scene='A quiet moment',destination='gallery')['photoId'];self.cmd('submit_photo',photoId=pid);self.cmd('import_photo',photoId=pid,image=PNG);self.cmd('publish_photo',photoId=pid)
  self.cmd('set_running',running=True);archive=vh2_backup.export(self.source,self.w);self.assertNotIn(b'NOT_FOR_EXPORT',gzip.decompress(archive))
  result=vh2_backup.restore(self.dest,archive);state=self.dest.projection(self.w)['state'];self.assertFalse(state['running']);self.assertEqual(state,self.dest.replay(self.w))
  self.assertEqual(len(vh2_library.page(self.dest,self.w,'post')['items']),1)
  with self.dest.connect() as db:
   self.assertEqual(db.execute('SELECT COUNT(*) FROM photo_assets').fetchone()[0],1)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM dialogue_providers').fetchone()[0],0)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)
  self.assertGreater(result['revision'],self.source.projection(self.w)['revision'])
  before=self.dest.projection(self.w)
  with self.assertRaises(Conflict):vh2_backup.restore(self.dest,archive)
  self.assertEqual(before,self.dest.projection(self.w))
 def test_provider_token_receipts_survive_archive_and_character_copy(self):
  self.source.dialogue_provider.save(dict(baseUrl='http://127.0.0.1:9999/v1',model='fixture',apiKey='SECRET',enabled=True,maxTokens=100,dailyLimit=10,temperature=.5))
  self.cmd('receive_message',text='Hello');self.cmd('advance',steps=1);self.cmd('queue_dialogue',adapter='chat_completions')
  self.assertTrue(self.source.dialogue.run_once(provider_transport=lambda *args:{'choices':[{'finish_reason':'stop','message':{'content':'Hello'}}],'usage':{'prompt_tokens':30,'completion_tokens':4,'total_tokens':34}}))
  archive=vh2_backup.export(self.source,self.w);vh2_backup.restore(self.dest,archive)
  self.assertEqual(self.dest.dialogue.list(self.w)[0]['usage'],{'prompt_tokens':30,'completion_tokens':4,'total_tokens':34})
  copied=vh2_backup.restore_character(self.dest,{'companionId':'receipt-copy','importId':'receipt-copy','archives':[{'worldId':self.w,'data':archive}]})['worlds'][0]['worldId']
  self.assertEqual(self.dest.dialogue.list(copied)[0]['usage']['total_tokens'],34)
 def test_archives_before_token_receipts_remain_readable(self):
  envelope=json.loads(gzip.decompress(vh2_backup.export(self.source,self.w)));payload=envelope['payload'];payload['databaseVersion']=9;payload['tables'].pop('dialogue_receipts');payload['tables'].pop('event_landmarks')
  vh2_backup.restore(self.dest,vh2_backup.compress_payload(payload));self.assertEqual(self.dest.dialogue.list(self.w),[])
 def test_corruption_and_failed_commit_leave_no_partial_world(self):
  archive=vh2_backup.export(self.source,self.w);bad=json.loads(gzip.decompress(archive));bad['payload']['state']['simAt']+=1
  with self.assertRaises(ValueError):vh2_backup.restore(self.dest,gzip.compress(json.dumps(bad).encode()))
  original=self.dest.index_entities
  def fail(*args):raise RuntimeError('Failed restore commit')
  self.dest.index_entities=fail
  with self.assertRaises(RuntimeError):vh2_backup.restore(self.dest,archive)
  self.dest.index_entities=original
  with self.dest.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM worlds').fetchone()[0],0)
  vh2_backup.restore(self.dest,archive)
 def test_unfinished_reply_is_not_resubmitted_after_restore(self):
  self.cmd('receive_message',text='Hello');self.cmd('advance',steps=1);job=self.cmd('queue_dialogue',text='Offline fixture')['jobId'];leased=self.source.dialogue.claim();self.assertEqual(leased['id'],job)
  vh2_backup.restore(self.dest,vh2_backup.export(self.source,self.w))
  self.assertEqual(self.dest.dialogue.list(self.w)[0]['status'],'unknown');self.assertIsNone(self.dest.dialogue.claim())
  state=self.dest.projection(self.w)['state'];self.assertEqual(state['communication']['replyJob']['status'],'unknown');self.assertFalse(state['running'])
 def test_original_world_is_unchanged_by_export(self):
  before=self.source.projection(self.w);vh2_backup.export(self.source,self.w);self.assertEqual(before,self.source.projection(self.w))
 def test_transfer_checkpoint_compacts_ledger_and_preserves_playable_life(self):
  # Model a pathological replay ledger without making transfer cost depend on
  # every historical delta. The source database is never rewritten.
  self.cmd('receive_message',text='Remember the blue greenhouse and our long conversation.')
  photo=self.cmd('capture_photo',scene='Blue greenhouse',destination='gallery')['photoId'];self.cmd('submit_photo',photoId=photo);self.cmd('import_photo',photoId=photo,image=PNG)
  with self.source.connect() as db:
   revision,state=self.source.read(db,self.w)
   for index in range(18):
    before=json.loads(json.dumps(state));state=json.loads(json.dumps(state))
    # Incompressible-enough deterministic history; only the latest value is
    # needed to resume the life.
    state['transferAuditNoise']=''.join(hashlib.sha256(f'{index}:{part}'.encode()).hexdigest() for part in range(2048))
    details={'index':index}
    if index==0:details.update(landmarkPriority=3,landmarkSummary='Blue greenhouse promise')
    revision=self.source.commit_event(db,self.w,revision,before,state,'TRANSFER_AUDIT_HISTORY',details)
   ledger_bytes=db.execute('SELECT SUM(length(payload)) FROM events WHERE world_id=?',(self.w,)).fetchone()[0]
   db.execute('INSERT INTO memory_episodes VALUES (?,?,?,?,?,?)',(self.w,'transfer-memory',revision,state['simAt'],'Blue greenhouse memory',json.dumps({'id':'transfer-memory','summary':'Blue greenhouse memory','at':state['simAt'],'sourceSequence':revision})))
  before=self.source.projection(self.w);checkpoint=vh2_backup.export_checkpoint(self.source,self.w)
  info=vh2_backup.inspect_world_archive(checkpoint)
  self.assertEqual(info['archiveMode'],'checkpoint');self.assertEqual(info['revision'],before['revision'])
  self.assertLess(len(checkpoint),ledger_bytes)
  restored=vh2_backup.restore(self.dest,checkpoint);self.assertEqual(restored['archiveMode'],'checkpoint')
  after=self.dest.projection(self.w);self.assertEqual(after['state'],self.dest.replay(self.w));self.assertEqual(after['state']['transferAuditNoise'],before['state']['transferAuditNoise'])
  with self.dest.connect() as db:
   self.assertEqual(db.execute('SELECT COUNT(*) FROM photo_assets WHERE world_id=?',(self.w,)).fetchone()[0],1)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM transcript_messages WHERE world_id=?',(self.w,)).fetchone()[0],1)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM memory_episodes WHERE world_id=? AND id=?',(self.w,'transfer-memory')).fetchone()[0],1)
   landmark=db.execute('SELECT priority,summary FROM event_landmarks WHERE world_id=? AND summary=?',(self.w,'Blue greenhouse promise')).fetchone()
   self.assertEqual(dict(landmark),{'priority':3,'summary':'Blue greenhouse promise'})
   events=db.execute('SELECT seq,kind FROM events WHERE world_id=? ORDER BY seq',(self.w,)).fetchall()
   self.assertEqual([row['kind'] for row in events],['WORLD_TRANSFER_CHECKPOINT','WORLD_RESTORED'])
   self.assertEqual(events[0]['seq'],before['revision'])
  # A later ordinary backup of the hosted checkpoint remains portable even
  # though its event sequence intentionally begins at the retained revision.
  later=vh2_backup.export(self.dest,self.w);third=self.open('third')
  try:
   vh2_backup.restore(third,later);self.assertEqual(third.projection(self.w)['state'],third.replay(self.w))
  finally:third.close()
  copied=self.open('copied-checkpoint')
  try:
   result=vh2_backup.restore_character(copied,{'companionId':'checkpoint-copy','importId':'checkpoint-copy','archives':[{'worldId':self.w,'data':later}]})
   copied_id=result['worlds'][0]['worldId'];self.assertEqual(copied.projection(copied_id)['state'],copied.replay(copied_id))
  finally:copied.close()
 def package(self,body,extra=None):
  out=io.BytesIO();metadata={'format':'horde-character-lives','version':1,**body,'archives':[]}
  with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_STORED) as z:
   for index,entry in enumerate(body['archives']):
    name='lives/'+str(index)+'.gz';metadata['archives'].append({'worldId':entry['worldId'],'path':name});z.writestr(name,entry['data'])
   z.writestr('restore.json',json.dumps(metadata))
   if extra:z.writestr(*extra)
  out.seek(0);return out
 def test_binary_copy_and_legacy_transport_share_atomic_receipt(self):
  raw=vh2_backup.export(self.source,self.w)
  body={'companionId':'binary-copy','importId':'binary-receipt','archives':[{'worldId':self.w,'data':raw}]}
  unpacked=vh2_backup.read_character_package(self.package(body));self.assertEqual(unpacked,body)
  result=vh2_backup.restore_character(self.dest,unpacked);new=result['worlds'][0]['worldId']
  self.assertEqual(self.dest.projection(new)['state'],self.dest.replay(new))
  legacy={**body,'archives':[{'worldId':self.w,'data':base64.b64encode(raw).decode()}]}
  self.assertEqual(result,vh2_backup.restore_character(self.dest,legacy))
  # A receipt written before binary transport was introduced must also recover.
  from virtual_humans.backend.vh2_runtime import encode
  old_fingerprint=hashlib.sha256(encode(legacy).encode()).hexdigest()
  self.assertEqual(old_fingerprint,vh2_backup.legacy_character_fingerprint(body,body['archives']))
  with self.dest.connect() as db:db.execute('UPDATE commands SET fingerprint=? WHERE key=?',(old_fingerprint,'character-import:binary-receipt'))
  self.assertEqual(result,vh2_backup.restore_character(self.dest,body))
  with self.assertRaises(Conflict):vh2_backup.restore_character(self.dest,{**body,'companionId':'different-copy'})
 def test_binary_and_legacy_limits_count_decoded_bytes(self):
  body={'companionId':'copy','importId':'limit','archives':[{'worldId':'test','data':b'x'*900}]}
  with patch.object(vh2_backup,'MAX_COMPRESSED',1024):
   self.assertEqual(vh2_backup.character_archives(body)[0]['data'],b'x'*900)
   legacy={**body,'archives':[{'worldId':'test','data':base64.b64encode(b'x'*900).decode()}]}
   self.assertGreater(len(legacy['archives'][0]['data']),1024)
   self.assertEqual(vh2_backup.character_archives(legacy)[0]['data'],b'x'*900)
   self.assertEqual(vh2_backup.read_character_package(self.package(body)),body)
   excessive={**body,'archives':body['archives']+[{'worldId':'other','data':b'x'*125}]}
   with self.assertRaises(ValueError):vh2_backup.character_archives(excessive)
   with self.assertRaises(ValueError):vh2_backup.read_character_package(self.package(excessive))
 def test_binary_package_rejects_unexpected_files_and_rolls_back_partial_copy(self):
  body={'companionId':'copy','importId':'atomic','archives':[{'worldId':self.w,'data':vh2_backup.export(self.source,self.w)}]}
  with self.assertRaises(ValueError):vh2_backup.read_character_package(self.package(body,('../escape',b'bad')))
  broken={**body,'archives':body['archives']+[{'worldId':'bad-world','data':b'not-gzip'}]}
  with self.assertRaises(ValueError):vh2_backup.restore_character(self.dest,broken)
  with self.dest.connect() as db:
   self.assertEqual(db.execute('SELECT COUNT(*) FROM worlds').fetchone()[0],0)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM commands WHERE key=?',('character-import:atomic',)).fetchone()[0],0)
  vh2_backup.restore_character(self.dest,body)
 def test_backup_payload_limit_includes_room_for_integrity_envelope(self):
  raw=vh2_backup.export(self.source,self.w);payload=json.loads(gzip.decompress(raw))['payload']
  size=sum(len(part) for part in vh2_backup.payload_chunks(payload))
  with patch.object(vh2_backup,'MAX_RAW',size):
   bounded=vh2_backup.compress_payload(payload)
   self.assertGreater(len(gzip.decompress(bounded)),size)
   vh2_backup.restore(self.dest,bounded)

 def fixture_state(self,service,world,**updates):
  from copy import deepcopy
  with service.connect() as db:
   revision,state=service.read(db,world);after=deepcopy(state);after.update(updates)
   return service.commit_event(db,world,revision,state,after,'FIXTURE_STATE',{})
 def new_source(self,name):return self.source.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type='create',name=name))['worldId']
 def bundle(self,worlds,key='merged-copy'):
  return dict(companionId='copy',importId=key,archives=[dict(worldId=w,data=vh2_backup.export(self.source,w)) for w in worlds])
 def test_merged_archives_map_forward_links_keep_history_and_media(self):
  alias=self.new_source('Archived');self.cmd('receive_message',text='Keep canonical contact history.')
  pid=self.cmd('capture_photo',scene='A quiet moment',destination='gallery')['photoId'];self.cmd('submit_photo',photoId=pid);self.cmd('import_photo',photoId=pid,image=PNG)
  self.fixture_state(self.source,alias,mergedInto=self.w)
  self.fixture_state(self.source,self.w,mergeRecord={'sourceWorldId':alias,'at':1})
  original=self.source.replay(alias)
  result=vh2_backup.restore_character(self.dest,self.bundle([alias,self.w]));rows={r['sourceWorldId']:r for r in result['worlds']};new=rows[self.w]['worldId'];copied=rows[alias]['worldId']
  self.assertEqual(rows[alias]['canonicalWorldId'],new)
  self.assertEqual(self.dest.projection(copied)['worldId'],new)
  self.assertEqual(self.dest.projection(copied)['state']['communication']['messages'][0]['text'],'Keep canonical contact history.')
  self.assertEqual(self.dest.projection(new)['state']['mergeRecord']['sourceWorldId'],copied)
  self.assertEqual(original,self.source.replay(alias))
  with self.dest.connect() as db:
   for row in rows.values():self.assertEqual(self.dest.read(db,row['worldId'])[1],self.dest.replay(row['worldId']))
   photo=self.dest.projection(new)['state']['photos'][0]
   self.assertIsNotNone(db.execute('SELECT id FROM photo_assets WHERE world_id=? AND id=?',(new,photo['assetId'])).fetchone())
   self.assertEqual(db.execute('SELECT COUNT(*) FROM worlds').fetchone()[0],2)
 def test_merge_chain_flattens_to_terminal_and_retry_is_idempotent(self):
  b=self.new_source('Middle');a=self.new_source('Oldest')
  self.fixture_state(self.source,a,mergedInto=b);self.fixture_state(self.source,b,mergedInto=self.w)
  body=self.bundle([a,b,self.w]);first=vh2_backup.restore_character(self.dest,body);rows={r['sourceWorldId']:r for r in first['worlds']};target=rows[self.w]['worldId']
  for old in (a,b):self.assertEqual(self.dest.projection(rows[old]['worldId'])['worldId'],target)
  self.assertEqual(first,vh2_backup.restore_character(self.dest,body))
 def test_invalid_merge_graph_fails_atomically(self):
  b=self.new_source('Other');self.fixture_state(self.source,self.w,mergedInto=b)
  with self.assertRaisesRegex(ValueError,'missing the canonical'):vh2_backup.restore_character(self.dest,self.bundle([self.w]))
  self.fixture_state(self.source,b,mergedInto=self.w)
  with self.assertRaisesRegex(ValueError,'circular'):vh2_backup.restore_character(self.dest,self.bundle([self.w,b]))
  with self.dest.connect() as db:
   self.assertEqual(db.execute('SELECT COUNT(*) FROM worlds').fetchone()[0],0)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM commands').fetchone()[0],0)
 def test_old_receipt_alias_repair_is_evented_scoped_and_idempotent(self):
  from virtual_humans.backend.vh2_runtime import encode
  alias=self.new_source('Archived');self.fixture_state(self.source,alias,mergedInto=self.w)
  self.fixture_state(self.source,self.w,mergeRecord={'sourceWorldId':alias})
  body=self.bundle([alias,self.w]);first=vh2_backup.restore_character(self.dest,body);rows={r['sourceWorldId']:r for r in first['worlds']};copied=rows[alias]['worldId'];target=rows[self.w]['worldId']
  self.fixture_state(self.dest,copied,mergedInto=self.w);self.fixture_state(self.dest,target,mergeRecord={'sourceWorldId':alias})
  original=self.source.replay(alias)
  repaired=vh2_backup.restore_character(self.dest,body)
  self.assertEqual(self.dest.projection(copied)['worldId'],target)
  self.assertEqual(self.dest.projection(target)['state']['mergeRecord']['sourceWorldId'],copied)
  self.assertEqual(original,self.source.replay(alias))
  self.assertEqual(repaired,vh2_backup.restore_character(self.dest,body))
  with self.dest.connect() as db:
   for ident in (copied,target):self.assertEqual(self.dest.read(db,ident)[1],self.dest.replay(ident))
   self.assertEqual(db.execute('SELECT COUNT(*) FROM worlds').fetchone()[0],2)
   self.assertEqual(db.execute("SELECT COUNT(*) FROM events WHERE kind='CHARACTER_IMPORT_LINK_REPAIRED'").fetchone()[0],2)
  self.fixture_state(self.dest,copied,mergedInto='user-edited-target')
  with self.assertRaisesRegex(Conflict,'merged elsewhere'):vh2_backup.restore_character(self.dest,body)
  with self.dest.connect() as db:self.assertEqual(self.dest.read(db,copied)[1]['mergedInto'],'user-edited-target')

if __name__=='__main__':unittest.main(verbosity=2)
