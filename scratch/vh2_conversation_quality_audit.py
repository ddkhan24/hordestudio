"""Offline multi-turn contract tests; fixtures do not establish human quality."""
import copy,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_conversation as conversation
import vh2_dialogue_audit as fixtures

class Conversation(unittest.TestCase):
 setUp=fixtures.Dialogue.setUp
 tearDown=fixtures.Dialogue.tearDown
 open=fixtures.Dialogue.open
 cmd=fixtures.Dialogue.cmd
 state=fixtures.Dialogue.state
 queue=fixtures.Dialogue.queue
 def context(self):
  state=self.state();return self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],state)[0]['context']
 def test_multi_turn_short_answers_and_move_receipts(self):
  for user,reply,move in [('Are you busy?','Yep.','answer'),('Okay, talk later.','Later!','close'),('Actually, I meant tomorrow.','Tomorrow, got it.','acknowledge')]:
   self.cmd('receive_message',text=user);self.cmd('advance',steps=1)
   self.queue();job=self.s.dialogue.claim();self.assertIsNotNone(job)
   body=json.dumps({'reply':reply,'appraisals':[],'conversationMove':move})
   self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],body))
   self.assertEqual(self.state()['communication']['messages'][-1]['text'],reply)
  deliveries=[e for e in self.s.events(self.w) if e['kind']=='REPLY_DELIVERED']
  self.assertEqual(len(deliveries),3)
  self.assertEqual(deliveries[-1]['payload']['details']['conversationMove'],'acknowledge')
  self.assertEqual(deliveries[-1]['payload']['details']['conversationQuality']['wordCount'],3)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_brief_stable_and_does_not_write_world(self):
  before=copy.deepcopy(self.state());a=self.context();b=self.context()
  self.assertEqual(a['conversationBrief'],b['conversationBrief']);self.assertEqual(before,self.state())
  self.assertTrue(a['conversationBrief']['respondTo'])
 def test_unread_and_undelivered_never_shape_brief(self):
  state=copy.deepcopy(self.state());state['communication']['messages'] += [{'id':'secret','role':'user','text':'secret volcano','readAt':0,'awaitingReply':True,'attention':{'stage':'unread'}},{'id':'draft','role':'assistant','text':'secret unpublished draft','deliveryState':'pending'}]
  request,_=self.s.dialogue.snapshot(self.w,1,state)
  self.assertNotIn('secret volcano',json.dumps(request));self.assertNotIn('secret unpublished draft',json.dumps(request))
 def test_ready_batch_is_not_lost_at_recent_window_boundary(self):
  state=copy.deepcopy(self.state());state['communication']['messages']=[{'id':'pending'+str(i),'role':'user','text':'Message '+str(i),'readAt':1,'awaitingReply':True,'attention':{'stage':'ready'}} for i in range(45)]
  request,_=self.s.dialogue.snapshot(self.w,1,state)
  self.assertEqual(len(request['context']['conversationBrief']['respondTo']),45)
 def test_repetition_tracks_phrases_and_moves_not_single_words(self):
  c=self.context();c['conversation']=[{'id':str(i),'role':'assistant','text':"Don't let it go to your head. You wish?"} for i in range(4)]+[{'id':'u','role':'user','text':'thanks'}];c['readyMessageIds']=['u']
  c['conversationBrief']=conversation.brief(c)
  bad=conversation.quality_flags(c,"Don't let it go to your head. You wish?")
  self.assertTrue(any(x['kind']=='repeated_phrase' for x in bad['flags']))
  self.assertTrue(any(x['kind']=='repeated_move' for x in bad['flags']))
  self.assertEqual(conversation.quality_flags(c,'Anytime')['flags'],[])
  self.assertEqual(conversation.repeated_phrases([{'text':'yes'}]*5),[])
 def test_context_selects_relevant_source_without_upgrading_claim(self):
  c=self.context();c['conversation']=[{'id':'u','role':'user','text':'Did I tell you about London?'}];c['readyMessageIds']=['u']
  c['knownPlayerFacts']=[{'id':'london','text':'I am from London','truthScope':'player_claim'}]+[{'id':str(i),'text':'Unrelated topic'} for i in range(20)]
  b=conversation.brief(c);self.assertEqual(b['memoryEvidence']['playerClaims'][0]['id'],'london');self.assertEqual(b['memoryEvidence']['playerClaims'][0]['truthScope'],'player_claim')
 def test_style_length_and_ambiguous_cues_are_advisory(self):
  c=self.context();c['conversation']=[{'id':'u','role':'user','text':'Actually, this is the first time.'}];c['readyMessageIds']=['u'];c['identity']['chatLength']='expansive'
  b=conversation.brief(c);self.assertEqual(b['lengthPreference'],'expansive');self.assertTrue(b['cueHints']);self.assertIn('not facts',b['selectionRule'])
 def test_malformed_move_is_not_delivered(self):
  self.queue();job=self.s.dialogue.claim();self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':'Hi','appraisals':[],'conversationMove':'teleport'})))
 def test_valid_reply_without_optional_appraisals_is_delivered(self):
  self.queue();job=self.s.dialogue.claim()
  raw='```json\n'+json.dumps({'reply':'You grew up in York, and your sister’s name is Maya.','conversationMove':'answer'})+'\n```'
  self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],raw))
  self.assertEqual(self.state()['communication']['messages'][-1]['text'],'You grew up in York, and your sister’s name is Maya.')
  self.assertFalse(any(e['kind']=='conversation_appraisal' for e in self.state()['truth']['companion']['vh2Psychology']['episodes']))

if __name__=='__main__':unittest.main(verbosity=2)
