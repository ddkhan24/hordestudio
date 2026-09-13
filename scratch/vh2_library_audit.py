"""Large media history stays readable after projection compaction and restart."""
from test_runtime import node_executable
import sys,json,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
import vh2_library
ROOT=Path(__file__).resolve().parents[1]
class Library(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open();self.w=self.s.command(dict(schemaVersion=1,key='world',type='create',name='Alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'db',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def seed(self):
  with self.s.connect() as db:
   revision,before=self.s.read(db,self.w);s=json.loads(json.dumps(before));now=s['simAt']
   s['photos']=[{'id':str(i),'at':now+i,'status':'stored','assetId':'asset'+str(i),'scene':'Photo','destination':'gallery','photoContext':{}} for i in range(251)]
   s['social']={'posts':[{'id':'post'+str(i),'photoId':str(i),'assetId':'asset'+str(i),'capturedAt':now+i,'publishedAt':now+i,'caption':'','captureContext':{},'status':'published','likedByPlayer':False,'comments':[]} for i in range(250)]}
   for p in s['photos']:db.execute('INSERT INTO photo_assets VALUES (?,?,?,?)',(p['assetId'],self.w,'image/png',b'fixture'))
   self.s.commit_event(db,self.w,revision,before,s,'FIXTURE_LIBRARY')
 def cmd(self,kind,**extra):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**extra))
 def test_complete_pagination_and_archived_interaction(self):
  self.seed();s=self.s.projection(self.w)['state'];self.assertEqual(len(s['photos']),50);self.assertEqual(len(s['social']['posts']),200)
  before=0;ids=[]
  while before is not None:
   result=vh2_library.page(self.s,self.w,'photo',before);ids += [p['id'] for p in result['items']];before=result['before']
  self.assertEqual(len(ids),251);self.assertEqual(len(set(ids)),251)
  self.cmd('comment_post',postId='post0',text='Remember this?')
  with self.s.connect() as db:self.assertEqual(vh2_library.get(db,self.w,'post','post0')['comments'][0]['text'],'Remember this?')
  with self.assertRaises(Conflict):self.cmd('publish_photo',photoId='0')
  self.cmd('withdraw_post',postId='post0')
  self.assertEqual(self.s.projection(self.w)['state'],self.s.replay(self.w));self.s.close();self.s=self.open()
  with self.s.connect() as db:self.assertEqual(vh2_library.get(db,self.w,'post','post0')['status'],'withdrawn')
 def test_pending_captures_never_evicted(self):
  self.seed()
  with self.s.connect() as db:
   revision,before=self.s.read(db,self.w);s=json.loads(json.dumps(before));s['photos'].insert(0,{'id':'pending','at':1,'status':'submitted'})
   self.s.commit_event(db,self.w,revision,before,s,'FIXTURE_PENDING')
  self.assertTrue(any(p['id']=='pending' for p in self.s.projection(self.w)['state']['photos']))
 def test_upgrade_backfills_without_changing_state(self):
  self.seed();before=self.s.projection(self.w)['state'];self.s.close()
  with self.s.connect() as db:db.execute('DROP TABLE media_records');db.execute('PRAGMA user_version=8')
  self.s=self.open();self.assertEqual(before,self.s.projection(self.w)['state'])
  self.assertEqual(len(vh2_library.page(self.s,self.w,'photo')['items']),50)

if __name__=='__main__':unittest.main(verbosity=2)
