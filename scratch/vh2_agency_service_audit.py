"""Offline life episode → immutable capture → asset → autonomous post → context."""
from test_runtime import node_executable
import sys,json,uuid,unittest,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService
ROOT=Path(__file__).resolve().parents[1]
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
class Agency(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open()
  profile={'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'}],
   'socialCircle':[{'id':'jo','name':'Jo','closeness':100,'contactWindows':[{'days':list(range(7)),'startMinute':0,'endMinute':1440}]}],
   'world':{'people':[{'personId':'jo','placeId':'home','days':list(range(7)),'start':0,'end':1440,'activity':'relaxing'}]}}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kw):
  body=dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw)
  result=self.s.command(body);self.assertEqual(result,self.s.command(body));return result
 def enable(self):
  policy=self.state()['truth']['companion']['vh2Agency']['policy'];policy.update(enabled=True,captureThreshold=0,shareThreshold=0,invitationThreshold=0)
  self.cmd('configure_life_expression',policy=policy)
 def test_episode_capture_publish_and_restart(self):
  self.enable();self.cmd('advance',steps=1);s=self.state()
  self.assertEqual(len(s['photos']),1);photo=s['photos'][0];self.assertEqual(photo['origin'],'autonomous')
  self.assertEqual(photo['photoContext']['placeId'],'home');self.assertEqual(photo['photoContext']['withNames'],[],'noticing does not include a bystander in the selfie')
  self.assertEqual(len(s['truth']['companion']['vh2Plans']['plans']),1);self.assertEqual(s.get('social',{}).get('posts',[]),[])
  pid=photo['id'];self.cmd('submit_photo',photoId=pid);self.cmd('advance',steps=2);self.cmd('import_photo',photoId=pid,image=PNG)
  self.assertEqual(self.state()['communication']['messages'],[])
  # The shared outing may still hold attention when the render finishes.
  for _ in range(12):
   self.cmd('advance',steps=1)
   if self.state().get('social',{}).get('posts'):break
  s=self.state();post=s['social']['posts'][0]
  self.assertEqual(post['origin'],'autonomous');self.assertEqual(post['captureContext'],photo['photoContext']);self.assertGreater(post['publishedAt'],photo['at'])
  self.assertEqual(len(self.s.context(self.w)['ownSocialPosts']),1);self.assertEqual(s,self.s.replay(self.w))
  self.s.close();self.s=self.open();self.cmd('advance',steps=1);self.assertEqual(len(self.state()['social']['posts']),1)
  self.assertEqual(len(self.state()['photos']),1)
 def test_rollback_includes_intention_and_frozen_job(self):
  self.enable();before=self.state();original=self.s.index_entities
  def fail(*args):raise RuntimeError('commit failed')
  self.s.index_entities=fail
  with self.assertRaises(RuntimeError):self.cmd('advance',steps=1)
  self.s.index_entities=original;self.assertEqual(before,self.state())
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM photo_jobs').fetchone()[0],0)
  self.cmd('advance',steps=1);self.assertEqual(len(self.state()['photos']),1)
 def test_disabled_and_read_only(self):
  before=self.state()
  for _ in range(3):self.s.context(self.w);self.s.projection(self.w)
  self.assertEqual(before,self.state());self.cmd('advance',steps=1);self.assertEqual(self.state().get('photos',[]),[])
  policy=before['truth']['companion']['vh2Agency']['policy'];policy['captureThreshold']='always'
  with self.assertRaises(ValueError):self.cmd('configure_life_expression',policy=policy)

if __name__=='__main__':unittest.main(verbosity=2)
