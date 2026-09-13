"""Offline gallery → publication → interaction → recall, with durable ownership."""
from test_runtime import node_executable
import sys,json,uuid,unittest,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
class Social(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open();self.w=self.s.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kw):
  body=dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw)
  result=self.s.command(body);self.assertEqual(result,self.s.command(body));return result
 def photo(self,destination='gallery'):
  ident=self.cmd('capture_photo',scene='A relaxed close-up',destination=destination)['photoId']
  self.cmd('submit_photo',photoId=ident);self.cmd('import_photo',photoId=ident,image=PNG);return ident
 def test_gallery_is_not_chat_or_publication(self):
  pid=self.photo();self.assertEqual(self.state()['communication']['messages'],[])
  self.assertEqual(self.state()['photos'][0]['status'],'stored');self.assertEqual(self.s.context(self.w)['ownSocialPosts'],[])
  self.cmd('advance',steps=2);self.assertEqual(self.s.context(self.w)['ownSocialPosts'],[])
  self.cmd('publish_photo',photoId=pid,caption='A quiet moment')
  post=self.state()['social']['posts'][0];self.assertGreater(post['publishedAt'],post['capturedAt'])
  self.assertEqual(post['captureContext'],self.state()['photos'][0]['photoContext'])
  self.assertEqual(self.s.context(self.w)['ownSocialPosts'][0]['caption'],'A quiet moment')
  self.assertEqual(self.state()['communication']['messages'],[])
  self.assertEqual(self.state(),self.s.replay(self.w))
  self.s.close();self.s=self.open();self.assertEqual(self.state()['social']['posts'][0],post)
 def test_interactions_do_not_invent_attention_or_affection(self):
  pid=self.photo();post=self.cmd('publish_photo',photoId=pid)['postId'];before=self.state()['truth']['companion']['relationshipDynamics']
  self.cmd('like_post',postId=post,liked=True);self.cmd('comment_post',postId=post,text='Lovely picture')
  stored=self.state()['social']['posts'][0];self.assertTrue(stored['likedByPlayer']);self.assertEqual(len(stored['comments']),1)
  self.assertEqual(stored['comments'][0]['authorId'],self.state()['communication']['personaId'])
  self.assertEqual(before,self.state()['truth']['companion']['relationshipDynamics'])
  self.assertEqual(self.s.context(self.w)['ownSocialPosts'][0]['comments'],[])
  self.assertEqual(self.s.context(self.w)['noticedSocialActivity'],[])
  self.cmd('like_post',postId=post,liked=False);self.assertFalse(self.state()['social']['posts'][0]['likedByPlayer'])
 def test_withdrawal_and_duplicate_protection(self):
  pid=self.photo('private_chat');self.assertEqual(len(self.state()['communication']['messages']),1)
  self.assertEqual(self.s.context(self.w)['ownSocialPosts'],[])
  post=self.cmd('publish_photo',photoId=pid)['postId']
  with self.assertRaises(Conflict):self.cmd('publish_photo',photoId=pid)
  self.cmd('withdraw_post',postId=post)
  self.assertEqual(self.s.context(self.w)['ownSocialPosts'][0]['status'],'withdrawn')
  with self.assertRaises(Conflict):self.cmd('comment_post',postId=post,text='late')
  self.assertEqual(len(self.state()['communication']['messages']),1)
 def test_invalid_or_cross_world_sources(self):
  pid=self.photo();other=self.s.command(dict(schemaVersion=1,key='other',type='create',name='Other'))['worldId']
  with self.assertRaises(Conflict):self.s.command(dict(schemaVersion=1,key='cross',type='publish_photo',worldId=other,expectedRevision=1,photoId=pid))
  with self.assertRaises(ValueError):self.cmd('publish_photo',photoId=pid,caption='x'*1201)
  with self.assertRaises(ValueError):self.cmd('capture_photo',scene='test',destination='public')
 def test_atomic_publication(self):
  pid=self.photo();before=self.state();original=self.s.index_entities
  def fail(*args):raise RuntimeError('failed commit')
  self.s.index_entities=fail
  with self.assertRaises(RuntimeError):self.cmd('publish_photo',photoId=pid)
  self.s.index_entities=original;self.assertEqual(self.state(),before)

if __name__=='__main__':unittest.main(verbosity=2)
