"""One physical life, isolated persona histories and durable worker delivery."""
from test_runtime import node_executable
import sys, tempfile, unittest, uuid, json, base64
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService, Conflict
import vh2_transcript, vh2_backup
ROOT=Path(__file__).resolve().parents[1]

class Conversations(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'life.sqlite';self.now=1788764400000
  self.s=WorldService(self.path,node_executable(ROOT),ROOT,clock=lambda:self.now)
  self.w=self.s.command({'schemaVersion':1,'key':'life','type':'create','name':'Alex'})['worldId']
  self.primary=self.s.projection(self.w)['state']['communication']['personaId']
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def cmd(self,kind,persona=None,**kwargs):
  return self.s.command({'schemaVersion':1,'key':str(uuid.uuid4()),'worldId':self.w,'expectedRevision':self.s.projection(self.w)['revision'],'type':kind,**({'conversationPersonaId':persona} if persona else {}),**kwargs})
 def open(self,persona='persona_b'):
  return self.cmd('open_conversation',personaId=persona,profile={'templateId':persona,'name':persona,'text':'An unrelated person'})
 def state(self,persona=None):return self.s.projection(self.w,persona)['state']
 def test_new_contact_preserves_world_and_duplicate_reopens(self):
  before=self.state();result=self.open();after=self.state()
  self.assertTrue(result['created']);self.assertEqual(after['truth'],before['truth']);self.assertEqual(after['simAt'],before['simAt'])
  self.assertEqual(self.state('persona_b')['communication']['messages'],[])
  self.assertFalse(self.open()['created'])
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM worlds').fetchone()[0],1)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_workers_and_transcript_stay_with_recipient(self):
  self.open();self.cmd('receive_message',text='My secret code is cobalt.')
  self.cmd('receive_message','persona_b',text='My secret code is amber.')
  self.cmd('advance',steps=1)
  for persona,own,other in [(self.primary,'cobalt','amber'),('persona_b','amber','cobalt')]:
   context=self.s.context(self.w,persona)
   self.assertIn(own,json.dumps(context['conversation']));self.assertNotIn(other,json.dumps(context['conversation']))
   self.assertTrue(context['readyMessageIds'])
   self.cmd('queue_dialogue',persona,text='Reply for '+own)
   job=self.s.dialogue.claim();self.assertIsNotNone(job)
   self.assertEqual(job['snapshot']['context']['personaId'],persona)
   self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],'Reply for '+own))
   messages=vh2_transcript.page(self.s,self.w,persona_id=persona)['messages']
   self.assertIn('Reply for '+own,json.dumps(messages));self.assertNotIn(other,json.dumps(messages))
  self.assertEqual(self.state(),self.s.replay(self.w))
  self.s.close();self.s=WorldService(self.path,node_executable(ROOT),ROOT,clock=lambda:self.now)
  self.assertIn('amber',json.dumps(self.state('persona_b')['communication']['messages']))
  self.assertNotIn('amber',json.dumps(self.state()['communication']['messages']))
 def test_relationship_changes_are_personal_but_feelings_are_shared(self):
  self.open();self.cmd('receive_message','persona_b',text='You are useless and I hate talking to you.')
  self.cmd('advance',steps=1);before=self.state()
  self.cmd('queue_dialogue','persona_b',text='That hurt.')
  job=self.s.dialogue.claim();source=job['snapshot']['context']['readyMessageIds'][0]
  output=json.dumps({'reply':'That hurt.','appraisals':[{'sourceMessageId':source,'evidence':'You are useless and I hate talking to you.','interpretation':'hostility','confidence':1}]})
  self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
  self.assertEqual(self.state()['truth']['companion']['relationshipDynamics'],before['truth']['companion']['relationshipDynamics'])
  self.assertLess(self.state('persona_b')['truth']['companion']['relationshipDynamics']['trust'],0)
  self.assertGreater(self.state()['truth']['companion']['emotionState']['felt']['anger'],before['truth']['companion']['emotionState']['felt']['anger'])
  self.assertNotIn('useless',json.dumps(self.s.context(self.w)['recalledExperiences']))
 def test_backup_retains_all_contacts_without_restarting_life(self):
  self.open();self.cmd('receive_message','persona_b',text='Remember this conversation.')
  dest=WorldService(Path(self.tmp.name)/'other.sqlite',node_executable(ROOT),ROOT,clock=lambda:self.now)
  try:
   vh2_backup.restore(dest,vh2_backup.export(self.s,self.w))
   self.assertEqual(dest.projection(self.w,'persona_b')['state']['communication']['messages'][0]['text'],'Remember this conversation.')
   self.assertEqual(dest.projection(self.w)['state'],dest.replay(self.w))
  finally:dest.close()
 def test_portable_copy_remaps_world_media_and_all_conversations(self):
  from scratch.vh2_backup_audit import PNG
  self.open();self.cmd('receive_message','persona_b',text='Copy my conversation too.')
  self.cmd('advance',steps=1);self.cmd('queue_dialogue','persona_b',text='A saved response.')
  job=self.s.dialogue.claim();self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],'A saved response.'))
  self.cmd('import_starter_post',sourceId='starter',caption='A starting picture',image=PNG,ageDays=3)
  before=self.state();data=base64.b64encode(vh2_backup.export(self.s,self.w)).decode()
  body={'companionId':'copied-character','importId':'copy-1','archives':[{'worldId':self.w,'data':data}]}
  result=vh2_backup.restore_character(self.s,body);new=result['worlds'][0]['worldId']
  self.assertNotEqual(new,self.w);self.assertEqual(self.state(),before)
  self.assertEqual(result,vh2_backup.restore_character(self.s,body))
  saved=self.s.projection(new)['state'];self.assertEqual(saved,self.s.replay(new))
  self.assertEqual(self.s.projection(new,'persona_b')['state']['communication']['messages'][-1]['text'],'A saved response.')
  self.assertNotEqual(saved['social']['posts'][0]['assetId'],before['social']['posts'][0]['assetId'])
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM photo_assets WHERE world_id=?',(new,)).fetchone()[0],1)
 def test_best_friend_can_recall_other_contact_without_inheriting_history(self):
  self.open();self.cmd('receive_message',text='I started learning the guitar.')
  self.cmd('advance',steps=1)
  stranger=self.s.context(self.w,'persona_b')['otherContacts'];self.assertEqual(len(stranger['contacts']),1)
  self.assertNotIn('privateRecollection',stranger['contacts'][0])
  self.cmd('configure_contact_relationship','persona_b',role='best_friend',context='Friends since school.',knownBeforeDays=2000)
  context=self.s.context(self.w,'persona_b')
  self.assertIn('guitar',json.dumps(context['otherContacts']['contacts'][0]['privateRecollection']))
  self.assertEqual(context['conversation'],[]);self.assertEqual(context['sharedHistory'],[])
 def test_social_likes_belong_to_each_persona(self):
  self.open();post=self.cmd('import_starter_post',sourceId='one',caption='Starting post',ageDays=1)['postId']
  self.cmd('like_post','persona_b',postId=post,liked=True)
  self.assertFalse(self.state()['social']['posts'][0]['likedByPlayer'])
  self.assertTrue(self.state('persona_b')['social']['posts'][0]['likedByPlayer'])
  self.cmd('like_post',postId=post,liked=True);self.cmd('like_post','persona_b',postId=post,liked=False)
  self.assertTrue(self.state()['social']['posts'][0]['likedByPlayer'])
  self.assertFalse(self.state('persona_b')['social']['posts'][0]['likedByPlayer'])
  self.assertEqual(self.state(),self.s.replay(self.w))

 def test_unknown_reply_does_not_block_other_contact_or_retry_original(self):
  self.open();self.cmd('receive_message',text='An interrupted conversation.')
  self.cmd('receive_message','persona_b',text='An independent conversation.')
  self.cmd('advance',steps=1);self.cmd('queue_dialogue',text='Uncertain reply')
  job=self.s.dialogue.claim();self.assertIsNotNone(job)
  with self.s.connect() as db:self.s.dialogue.transition(db,job,'unknown','Simulated interrupted provider submission.')
  with self.assertRaises(Conflict):self.cmd('queue_dialogue',text='Do not retry this.')
  self.cmd('queue_dialogue','persona_b',text='Reply for the other contact.')
  other=self.s.dialogue.claim();self.assertIsNotNone(other)
  self.assertTrue(self.s.dialogue.finish(other['id'],other['token'],'Reply for the other contact.'))
  self.assertEqual(self.state()['communication']['replyJob']['status'],'unknown')
  self.assertEqual(self.state('persona_b')['communication']['messages'][-1]['text'],'Reply for the other contact.')
  self.assertEqual(self.state(),self.s.replay(self.w))

 def test_delayed_private_photo_returns_to_original_contact(self):
  from scratch.vh2_media_audit import PNG
  self.open();photo=self.cmd('capture_photo','persona_b',scene='A casual portrait',captureType='front_camera_selfie')['photoId']
  self.cmd('submit_photo',photoId=photo)
  self.cmd('advance',steps=2)
  # A worker has no active browser persona. The frozen recipient must win.
  self.cmd('import_photo',photoId=photo,image=PNG)
  self.assertEqual(self.state()['communication']['messages'],[])
  message=self.state('persona_b')['communication']['messages'][-1]
  self.assertEqual(message['id'],photo);self.assertEqual(message['playerPersonaId'],'persona_b')
  self.assertEqual(len(self.s.context(self.w,'persona_b')['sharedPhotos']),1)
  self.assertEqual(self.s.context(self.w)['sharedPhotos'],[])
  self.assertEqual(self.state(),self.s.replay(self.w))

 def test_chat_actions_clear_reset_delete_and_reopen_one_contact(self):
  self.open();self.cmd('receive_message',text='Keep this primary conversation.')
  self.cmd('receive_message','persona_b',text='I live in Bristol.');self.cmd('advance',steps=1)
  self.cmd('configure_contact_relationship','persona_b',role='best_friend',context='Friends since school.',knownBeforeDays=2000)
  before=self.state();relationship=self.state('persona_b')['truth']['companion']['relationshipDynamics']
  self.cmd('manage_conversation','persona_b',action='rename',name='My best friend')
  self.assertEqual(self.state('persona_b')['communication']['name'],'My best friend')
  self.cmd('manage_conversation','persona_b',action='clear')
  self.assertEqual(vh2_transcript.page(self.s,self.w,persona_id='persona_b')['messages'],[])
  self.assertEqual(self.state('persona_b')['truth']['companion']['relationshipDynamics'],relationship)
  self.assertEqual(self.state()['communication']['messages'],before['communication']['messages'])
  self.cmd('manage_conversation','persona_b',action='reset')
  self.assertEqual(self.s.context(self.w,'persona_b')['knownPlayerFacts'],[])
  self.assertEqual(self.state('persona_b')['truth']['companion']['connectionType'],'best_friend')
  self.assertEqual(self.state()['truth']['companion']['lifeRuntime']['world'],before['truth']['companion']['lifeRuntime']['world'])
  self.cmd('manage_conversation','persona_b',action='delete')
  self.assertEqual(len(self.s.projection(self.w)['conversations']),1)
  with self.assertRaises(Conflict):self.cmd('receive_message','persona_b',text='Deleted chat must stay closed.')
  self.open();self.assertFalse(self.state('persona_b')['communication'].get('deletedAt'))
  self.assertEqual(self.state('persona_b')['communication']['messages'],[])
  self.cmd('manage_conversation',action='delete')
  self.cmd('manage_conversation','persona_b',action='delete')
  self.assertEqual(self.s.projection(self.w)['conversations'],[])
  self.assertEqual(self.state(),self.s.replay(self.w))

 def test_clear_fences_late_reply_and_photo_without_losing_media(self):
  from scratch.vh2_media_audit import PNG
  self.cmd('receive_message',text='Hi there.');self.cmd('advance',steps=1)
  self.cmd('queue_dialogue',text='A late reply.');job=self.s.dialogue.claim()
  photo=self.cmd('capture_photo',scene='A casual portrait',captureType='front_camera_selfie')['photoId'];self.cmd('submit_photo',photoId=photo)
  self.cmd('manage_conversation',action='clear')
  self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'A late reply.'))
  self.cmd('import_photo',photoId=photo,image=PNG)
  self.assertEqual(self.state()['communication']['messages'],[])
  self.assertEqual(self.state()['photos'][0]['status'],'stored')
  self.assertEqual(self.state(),self.s.replay(self.w))

if __name__=='__main__':unittest.main(verbosity=2)
