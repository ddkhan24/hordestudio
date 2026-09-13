"""Offline cost boundary: saved moments, selected posts, immutable delayed rendering."""
import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import vh2_workers_audit as fixtures
import vh2_workers as images
import vh2_social_worker as social
from vh2_provider import UnknownOutcome
class Gallery(unittest.TestCase):
 setUp=fixtures.Workers.setUp
 tearDown=fixtures.Workers.tearDown
 state=fixtures.Workers.state
 cmd=fixtures.Workers.cmd
 open=fixtures.Workers.open
 prepare=fixtures.Workers.prepare
 finish=fixtures.Workers.finish
 def save_idea(self):
  photo=self.prepare()
  with self.s.connect() as db:
   revision,before=self.s.read(db,self.w);state=json.loads(json.dumps(before));p=state['photos'][-1]
   p.update(origin='autonomous',deferred=True,sourceEventId='picnic',captureReason='Finished a picnic at home.')
   state['truth']['companion'].update(socialFeedEnabled=True,socialPostFrequency='daily');state['running']=True
   state['truth']['present']['availability']='available';state['truth']['events']=[{'id':'picnic','kind':'completed','at':state['simAt'],'summary':'Finished a picnic at home.'}]
   social.draft(state);self.s.commit_event(db,self.w,revision,before,state,'FIXTURE_SAVED_IDEA')
  return photo
 def select(self,decision='render'):
  self.s.dialogue_provider.save(dict(scope='horde:alex',baseUrl='https://example.invalid/v1',model='fixture',apiKey='test',enabled=True,maxTokens=512,dailyLimit=4,temperature=.7))
  calls=[]
  def execute(config,key,messages):
   calls.append(messages);return {'decision':'post','caption':'a quiet afternoon at home','image':{'decision':decision,'scene':'A candid selfie at the recorded picnic in the same saved outfit.','reason':'The picnic is a distinct personal moment this character wants to share.'}}
  self.s.social_executor=execute;social.poll(self.s)
  for f,w in self.s._social_pending.values():f.result(timeout=3)
  social.poll(self.s);return calls
 def test_saved_ideas_never_spend_with_any_provider_and_do_not_block_manual_capture(self):
  photo=self.save_idea();calls=[];self.s.image_executor=lambda *args:(calls.append(1) or fixtures.PNG)
  for provider in ('openrouter','gemini','magnific','higgsfield'):
   images.settings(self.s,dict(scope='horde:alex',provider=provider,enabled=True,model='fixture/image',tool='fixture.generate' if provider in ('magnific','higgsfield') else '',apiKey='test',dailyLimit=4,maxReferences=10))
   images.poll(self.s)
   with self.s.connect() as db:
    rev,state=self.s.read(db,self.w)
    with self.assertRaisesRegex(ValueError,'saved gallery idea'):images.queue_image(self.s,db,self.w,rev,state,photo,automatic=True)
  self.assertEqual(calls,[]);self.assertEqual(images.status(self.s,self.w),[])
  self.cmd('capture_photo',scene='Explicitly requested new photograph',destination='gallery')
  self.assertEqual(len(self.state()['photos']),2)
 def test_image_selected_before_spend_and_published_only_after_import(self):
  photo=self.save_idea();calls=self.select();evidence=json.loads(calls[0][1]['content']);self.assertEqual(evidence['savedPhotoMoment']['id'],photo)
  state=self.state();post=state['social']['posts'][0];social.draft(state);self.assertEqual(post['status'],'draft');self.assertTrue(post['imagePending'])
  requests=[];self.s.image_executor=lambda config,key,body:(requests.append(body) or fixtures.PNG)
  images.poll(self.s);self.finish();state=self.state();post=state['social']['posts'][0]
  self.assertEqual(len(requests),1);self.assertIn('recorded picnic',requests[0]['prompt']);self.assertTrue(requests[0]['input_references'])
  self.assertEqual(post['assetId'],state['photos'][0]['assetId']);self.assertFalse(post['imagePending']);self.assertEqual(post['status'],'draft')
  social.draft(state);self.assertEqual(post['status'],'published');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_text_only_decision_keeps_gallery_idea_free(self):
  self.save_idea();self.select('skip');self.s.image_executor=lambda *args:self.fail('Unselected photo reached provider')
  images.poll(self.s);state=self.state();social.draft(state)
  self.assertEqual(state['social']['posts'][0]['status'],'published');self.assertFalse(state['social']['posts'][0].get('assetId'));self.assertEqual(images.status(self.s,self.w),[])
 def test_cancelled_post_withdraws_unsubmitted_job_without_spend(self):
  photo=self.save_idea();self.select()
  with self.s.connect() as db:
   rev,state=self.s.read(db,self.w);images.queue_image(self.s,db,self.w,rev,state,photo,automatic=True)
  self.cmd('dismiss_social_draft',postId=self.state()['social']['posts'][0]['id']);self.s.image_executor=lambda *args:self.fail('Cancelled post reached provider')
  images.poll(self.s);self.assertEqual(images.status(self.s,self.w),[]);self.assertEqual(self.state()['photos'][0]['status'],'captured')
  self.cmd('queue_photo_render',photoId=photo);self.s.image_executor=lambda *args:fixtures.PNG;self.finish()
  self.assertEqual(self.state()['photos'][0]['status'],'stored');self.assertEqual(self.state()['social']['posts'][0]['status'],'abandoned')
 def test_selected_image_failure_manual_retry_delivers_to_original_post(self):
  photo=self.save_idea();self.select();self.s.image_executor=lambda *args:(_ for _ in ()).throw(UnknownOutcome('Unconfirmed fixture result'))
  images.poll(self.s);self.finish();post=self.state()['social']['posts'][0];self.assertTrue(post['imageError']);self.assertTrue(post['imagePending'])
  self.cmd('retry_photo_render',photoId=photo);self.s.image_executor=lambda *args:fixtures.PNG;self.finish();state=self.state();post=state['social']['posts'][0]
  self.assertNotEqual(post['photoId'],photo);self.assertEqual(post['status'],'draft');self.assertTrue(post['assetId']);self.assertFalse(post['imagePending']);self.assertNotIn('imageError',post)
 def test_archived_saved_idea_renders_original_references_later(self):
  photo=self.save_idea()
  with self.s.connect() as db:
   frozen=db.execute('SELECT snapshot FROM photo_jobs WHERE id=?',(photo,)).fetchone()[0]
   rev,before=self.s.read(db,self.w);state=json.loads(json.dumps(before));state['photos']=[]
   state['truth']['companion']['currentOutfit']='a different outfit';self.s.commit_event(db,self.w,rev,before,state,'FIXTURE_OLDER_GALLERY_PAGE')
  self.cmd('queue_photo_render',photoId=photo);calls=[];self.s.image_executor=lambda c,k,body:(calls.append(body) or fixtures.PNG);self.finish()
  self.assertEqual(calls[0]['input_references'][0]['image_url']['url'],fixtures.PNG);self.assertNotIn('a different outfit',calls[0]['prompt'])
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT snapshot FROM photo_jobs WHERE id=?',(photo,)).fetchone()[0],frozen)
  self.assertEqual(self.state()['photos'][0]['status'],'stored');self.assertEqual(self.state(),self.s.replay(self.w))
if __name__=='__main__':unittest.main()
