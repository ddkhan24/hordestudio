"""Story authoring and companion memory boundaries; no live providers."""
import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_lifestyle_audit as fixtures
import vh2_conversation as conversation
class StoryService(unittest.TestCase):
 setUp=fixtures.Lifestyle.setUp
 tearDown=fixtures.Lifestyle.tearDown
 cmd=fixtures.Lifestyle.cmd
 state=fixtures.Lifestyle.state
 def policy(self,**values):
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.state()['truth']['companion'].get('vh2SetupVersion',0),proposal={'storyPolicy':values})
 def test_saved_policy_and_event_replay(self):
  self.policy(intensity=70,social=80,novelty=40,complications=15,recoveryHours=24)
  s=self.state();self.assertEqual(s['truth']['companion']['vh2Story']['policy']['intensity'],70);self.assertEqual(s,self.s.replay(self.w))
  self.policy(intensity=0);self.assertEqual(self.state()['truth']['companion']['vh2Story']['policy']['social'],80)
 def test_invalid_policy_rolls_back_entire_proposal(self):
  for value in [{'intensity':True},{'intensity':101},{'recoveryHours':0},{'forcedOutcome':'fight'},{'social':float('inf')}]:
   before=self.state()
   with self.assertRaises(ValueError):self.cmd('apply_life_proposal',version=2,baseSetupVersion=before['truth']['companion'].get('vh2SetupVersion',0),proposal={'expression':{'personality':'Must roll back'},'storyPolicy':value})
   self.assertEqual(before,self.state())
 def test_relationship_origin_reaches_chat_without_reset(self):
  before=self.state()['truth']['companion'].get('relationshipDynamics')
  self.cmd('configure_expression_profile',fields={'connectionType':'romantic','relationshipContext':'Established partners who enjoy cooking together.','knownBeforeDays':600})
  state=self.state();request,_=self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],state)
  self.assertEqual(request['context']['relationship']['authoredContext']['knownBeforeDays'],600)
  self.assertEqual(state['truth']['companion'].get('relationshipDynamics'),before)
  self.assertIn('Later recorded changes take precedence',request['messages'][0]['content'])
 def test_distant_chat_retrieves_qualification_and_never_asserts_facts(self):
  messages=[{'id':'0','role':'user','text':'I prefer green tea.','timestamp':1},{'id':'1','role':'assistant','text':'Green tea?','timestamp':2},{'id':'2','role':'user','text':'Actually, only iced green tea. Hot tea makes me nauseous.','timestamp':3}]
  messages += [{'id':str(i+3),'role':'user' if i%2 else 'assistant','text':'A different subject '+str(i),'timestamp':i+4} for i in range(90)]
  result=conversation.recall_conversation(messages,conversation.terms('What tea do I like?'))
  self.assertIn('2',[r['id'] for r in result]);self.assertTrue(all(r['truthScope']=='quoted_conversation' for r in result));self.assertLessEqual(sum(len(r['text']) for r in result),12000)
 def test_future_unread_and_other_persona_are_not_recalled(self):
  state=self.state();persona=state['communication']['personaId'];now=state['simAt']
  state['communication']['messages']=[{'id':'old','role':'user','text':'I prefer green tea','readAt':now-1,'timestamp':now-1,'playerPersonaId':persona}]+[{'id':str(i),'role':'user','text':'A different subject','readAt':now-1,'timestamp':now-1,'playerPersonaId':persona} for i in range(45)]
  for ident,values in [('future',{'readAt':now+1}),('unread',{'readAt':0}),('another',{'playerPersonaId':'someone-else'})]:state['communication']['messages'].append({'id':ident,'role':'user','text':'secret tea '+ident,'readAt':now-1,'timestamp':now-1,'playerPersonaId':persona,**values})
  state['communication']['messages'].append({'id':'question','role':'user','text':'Which tea?','readAt':now,'timestamp':now,'playerPersonaId':persona,'awaitingReply':True,'attention':{'stage':'ready'}})
  context=self.s.expression_context(self.w,1,state);encoded=json.dumps(context)
  self.assertIn('I prefer green tea',encoded)
  for ident in ['future','unread','another']:self.assertNotIn('secret tea '+ident,encoded)
if __name__=='__main__':unittest.main(verbosity=2)
