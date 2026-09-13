"""Offline long-lived conversations: bounded working state, durable history."""
from test_runtime import node_executable
import sys, json, unittest, tempfile, uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService
from vh2_transcript import page
ROOT=Path(__file__).resolve().parents[1]

class Transcript(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open()
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def seed(self,count=650,pending=False):
  with self.s.connect() as db:
   revision,before=self.s.read(db,self.w);after=json.loads(json.dumps(before))
   after['communication']['messages']=[dict(id=str(i),role='user',text='Historical message '+str(i),timestamp=after['simAt']-count+i,readAt=after['simAt']-count+i,awaitingReply=pending and i==0) for i in range(count)]
   self.s.commit_event(db,self.w,revision,before,after,'FIXTURE_HISTORY')
 def test_continues_past_old_limit_and_replays(self):
  self.seed();state=self.s.projection(self.w)['state'];self.assertEqual(len(state['communication']['messages']),200)
  self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type='receive_message',text='Still here',worldId=self.w,expectedRevision=self.s.projection(self.w)['revision']))
  self.assertEqual(self.s.projection(self.w)['state'],self.s.replay(self.w))
  messages=[];cursor=0
  while True:
   result=page(self.s,self.w,cursor);messages=result['messages']+messages
   if result['before'] is None:break
   cursor=result['before']
  self.assertEqual(len(messages),651);self.assertEqual(messages[0]['id'],'0');self.assertEqual(messages[-1]['text'],'Still here')
  self.assertEqual(len({m['id'] for m in messages}),651)
  self.s.close();self.s=self.open();self.assertEqual(page(self.s,self.w)['messages'][-1]['text'],'Still here')
 def test_pending_preserved_and_status_updates_without_duplicate(self):
  self.seed(pending=True)
  state=self.s.projection(self.w)['state'];self.assertEqual(len(state['communication']['messages']),201)
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));after['communication']['messages'][0]['awaitingReply']=False
   self.s.commit_event(db,self.w,rev,before,after,'FIXTURE_REPLY')
  self.assertEqual(len(self.s.projection(self.w)['state']['communication']['messages']),200)
  oldest=page(self.s,self.w,201)['messages'];self.assertEqual(oldest[0]['id'],'0');self.assertFalse(oldest[0]['awaitingReply'])
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM transcript_messages').fetchone()[0],650)
 def test_failed_commit_does_not_archive(self):
  original=self.s.index_entities
  def fail(*args):raise RuntimeError('failed writer')
  self.s.index_entities=fail
  with self.assertRaises(RuntimeError):self.seed()
  self.s.index_entities=original
  self.assertEqual(page(self.s,self.w)['messages'],[])
  self.assertEqual(self.s.projection(self.w)['state'],self.s.replay(self.w))
 def test_version_seven_backfill_is_idempotent(self):
  self.seed(20)
  with self.s.connect() as db:db.execute('DROP TABLE transcript_messages');db.execute('PRAGMA user_version=7')
  self.s.close();self.s=self.open();self.assertEqual(len(page(self.s,self.w)['messages']),20)
  self.s.close();self.s=self.open();self.assertEqual(len(page(self.s,self.w)['messages']),20)
 def test_world_scoping_and_page_validation(self):
  self.seed()
  other=self.s.command(dict(schemaVersion=1,key='other',type='create',name='Other'))['worldId']
  self.assertEqual(page(self.s,other)['messages'],[])
  with self.assertRaises(ValueError):page(self.s,self.w,-1)
  with self.assertRaises(ValueError):page(self.s,self.w,limit=501)

if __name__=='__main__':unittest.main(verbosity=2)
