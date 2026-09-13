import sys,pathlib,unittest,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import vh2_ecosystem_audit as fixtures
import vh2_controls,vh2_social,vh2_attachments
class Compatibility(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 c=fixtures.Ecosystem.c
 cmd=fixtures.Ecosystem.cmd
 def test_pause_persists_without_stopping_direct_messages(self):
  vh2_controls.settings(self.s,True);self.assertTrue(self.c()['vh2AutonomyPaused'])
  self.cmd('receive_message',text='Hello');self.assertEqual(self.state()['communication']['messages'][-1]['text'],'Hello')
  self.assertEqual(self.state(),self.s.replay(self.w));vh2_controls.settings(self.s,False);self.assertFalse(self.c()['vh2AutonomyPaused'])
 def test_photo_attachment_is_durable_and_scoped(self):
  self.cmd('receive_message',text='Look at this',messageType='photo',attachment=fixtures.PNG)
  m=self.state()['communication']['messages'][-1];self.assertEqual(m['type'],'photo')
  request={'messages':[],'context':{'incomingAttachments':[{'messageId':m['id'],'assetId':m['assetId'],'type':'photo'}]}}
  parts=vh2_attachments.inputs(self.s,self.w,request)[0]['content'];self.assertEqual(parts[-1]['image_url']['url'],fixtures.PNG)
  with self.assertRaises(ValueError):vh2_attachments.inputs(self.s,'wrong-world',request)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_invalid_attachment_rolls_back(self):
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('receive_message',text='x',messageType='photo',attachment='https://invalid')
  self.assertEqual(before,self.state())
 def test_clip_request_survives_replay(self):
  self.cmd('configure_expression_profile',fields={'allowVideoClips':True,'videoStyleRules':'Everyday moments'})
  before=self.state()['communication']['messages']
  self.cmd('request_clip',clip={'id':'clip1','requestText':'Say hello','provider':'hotapi','model':'minimax-h3-spicy','duration':5,'resolution':'480p','clipType':'selfie','cameraRig':'front'})
  self.assertEqual(self.state()['clips'][0]['status'],'draft');self.assertEqual(before,self.state()['communication']['messages']);self.assertEqual(self.state(),self.s.replay(self.w))
  self.cmd('update_clip_job',clipId='clip1',update={'status':'submitting'})
  self.assertEqual(self.state()['clips'][0]['status'],'submitting')
 def test_old_clip_messages_are_archived_without_deleting_chat(self):
  self.cmd('configure_expression_profile',fields={'allowVideoClips':True})
  self.cmd('request_clip',clip={'id':'one','requestText':'Wave','provider':'hotapi','model':'seedance-2.0-spicy','duration':5,'resolution':'480p','clipType':'selfie','cameraRig':'selfie'})
  self.cmd('receive_message',text='Real conversation')
  self.cmd('receive_message',text='[CLIP REQUEST one] Wave',messageType='clip_request')
  self.cmd('separate_clip_creation')
  self.assertEqual([m['text'] for m in self.state()['communication']['messages']],['Real conversation'])
  self.assertEqual(len(self.state()['clipCreationArchive']),1)
  self.cmd('separate_clip_creation');self.assertEqual(len(self.state()['clipCreationArchive']),1)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_delete_clip_persists_and_next_clip_is_independent(self):
  self.cmd('configure_expression_profile',fields={'allowVideoClips':True})
  clip={'id':'first','requestText':'Wave','provider':'hotapi','model':'seedance-2.0-mini-spicy','duration':5,'resolution':'480p','clipType':'selfie','cameraRig':'selfie'}
  self.cmd('request_clip',clip=clip)
  self.cmd('update_clip_job',clipId='first',update={'status':'submitting'})
  with self.assertRaises(Exception):self.cmd('delete_clip',clipId='first')
  self.cmd('update_clip_job',clipId='first',update={'status':'generating'})
  self.cmd('update_clip_job',clipId='first',update={'status':'ready','assetId':'fixture'})
  self.cmd('request_clip',clip={**clip,'id':'second'})
  self.cmd('delete_clip',clipId='first')
  self.assertTrue(self.state()['clips'][0]['deletedAt']);self.assertEqual(self.state()['clips'][1]['status'],'draft')
  self.assertEqual(self.state()['communication']['messages'],[])
  import vh2_runtime
  path,node,root,clock=self.s.path,self.s.node,self.s.app_dir,self.s.clock;self.s.close();self.s=vh2_runtime.WorldService(path,node,root,clock=clock)
  self.assertTrue(self.state()['clips'][0]['deletedAt']);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_social_reactions_wait_for_awareness(self):
  r=self.cmd('import_starter_post',sourceId='old',caption='Yesterday');self.cmd('like_post',postId=r['postId'],liked=True);self.cmd('comment_post',postId=r['postId'],text='Nice photo')
  state=self.state();state['truth']['present']['availability']='asleep';vh2_social.observe(state);self.assertEqual(vh2_social.context(state)[0]['comments'],[])
  state['truth']['present']['availability']='available';vh2_social.observe(state);context=vh2_social.context(state)[0];self.assertTrue(context['likedByPlayer']);self.assertEqual(context['comments'][0]['text'],'Nice photo')
 def test_activity_preferences_survive_service_restart(self):
  import vh2_runtime
  state=self.state();c=state['truth']['companion']
  self.cmd('configure_life_expression',policy={**c['vh2Agency']['policy'],'enabled':True})
  self.cmd('configure_exploration',policy={**c['vh2Exploration']['policy'],'enabled':True})
  self.cmd('configure_expression_profile',fields={'socialFeedEnabled':True,'socialPostFrequency':'daily'})
  path,node,root,clock=self.s.path,self.s.node,self.s.app_dir,self.s.clock;self.s.close();self.s=vh2_runtime.WorldService(path,node,root,clock=clock)
  self.assertTrue(self.c()['vh2Agency']['policy']['enabled']);self.assertTrue(self.c()['vh2Exploration']['policy']['enabled']);self.assertTrue(self.c()['socialFeedEnabled']);self.assertEqual(self.c()['socialPostFrequency'],'daily');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_active_settings_types_and_projection(self):
  self.cmd('configure_expression_profile',fields={'socialFeedEnabled':True,'socialWritingStyle':'Brief','lifeWeatherEnabled':True,'libidoEnabled':True})
  self.assertTrue(self.c()['socialFeedEnabled']);self.assertTrue(self.c()['lifeWeatherEnabled']);self.assertTrue(self.c()['libidoEnabled'])
  with self.assertRaises(ValueError):self.cmd('configure_expression_profile',fields={'allowVideoClips':'true'})
if __name__=='__main__':unittest.main()
