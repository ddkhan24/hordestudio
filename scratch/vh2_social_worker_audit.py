"""Offline checks for grounded social captions, pause, audience and billing receipts."""
import sys,pathlib,json,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import vh2_ecosystem_audit as fixtures
import vh2_social_worker as worker
class SocialWorker(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 cmd=fixtures.Ecosystem.cmd
 def seed(self,**fields):
  self.cmd('configure_expression_profile',fields={'socialFeedEnabled':True,'socialPostFrequency':'daily','socialWritingStyle':'Short lowercase captions','socialAudience':'private',**fields})
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);state=json.loads(json.dumps(before));state['running']=True;state['truth']['present']['availability']='available';state['truth']['events']=[{'id':'walk1','kind':'arrival','at':state['simAt'],'summary':'Arrived at the park.'}];worker.draft(state);self.s.commit_event(db,self.w,rev,before,state,'FIXTURE_SOCIAL_DRAFT')
 def test_caption_uses_evidence_and_publishes_only_after_completion(self):
  self.seed();self.s.dialogue_provider.save(dict(scope='horde:alex',baseUrl='https://example.invalid/v1',model='fixture',apiKey='test',enabled=True,maxTokens=512,dailyLimit=4,temperature=.7))
  calls=[]
  def execute(config,key,messages):calls.append(messages);return {'decision':'post','caption':'made it to the park'}
  self.s.social_executor=execute;worker.poll(self.s)
  self.assertEqual(len(self.s._social_pending),1)
  for future,world in self.s._social_pending.values():future.result(timeout=3)
  worker.poll(self.s);state=self.state();post=state['social']['posts'][0];self.assertEqual(post['status'],'draft');self.assertTrue(post['captionReady'])
  worker.draft(state);self.assertEqual(post['status'],'published');self.assertEqual(post['visibility'],'private')
  evidence=json.loads(calls[0][1]['content']);self.assertEqual(evidence['writingStyle'],'Short lowercase captions');self.assertEqual(evidence['sourceEvent']['id'],'walk1')
  worker.poll(self.s);self.assertEqual(len(calls),1);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_manual_and_pause_do_not_draft(self):
  self.seed(socialPostFrequency='manual');self.assertEqual(self.state()['social']['posts'],[])
  state=self.state();state['truth']['companion'].update(socialPostFrequency='active',vh2AutonomyPaused=True);worker.draft(state);self.assertEqual(state['social']['posts'],[])
 def test_frequency_and_completed_draft_preserve_actual_audience(self):
  self.seed();state=self.state();post=state['social']['posts'][0];post.update(captionReady=True,caption='park');worker.draft(state)
  state['simAt']+=6*3600000;state['truth']['events']=[{'id':'walk2','kind':'arrival','at':state['simAt'],'summary':'Arrived elsewhere.'}];worker.draft(state);self.assertEqual(len(state['social']['posts']),1)
if __name__=='__main__':unittest.main()
