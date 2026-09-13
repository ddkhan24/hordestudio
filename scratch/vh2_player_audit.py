"""Player profiles are timeline-local claims and invalidate stale expression."""
from test_runtime import node_executable
import sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService
ROOT=Path(__file__).resolve().parents[1]
class PlayerProfile(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=WorldService(Path(self.tmp.name)/'x.sqlite',node_executable(ROOT),ROOT,clock=lambda:1789030800000);self.w=self.s.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw))
 def test_profile_is_a_claim_and_does_not_rewrite_identity_or_facts(self):
  identity=self.state()['communication']['personaId'];self.cmd('receive_message',text='I live in London.');self.cmd('advance',steps=1);beliefs=self.state()['beliefs']
  self.cmd('configure_player_profile',profile={'templateId':'work','name':'Sam','text':'I travel often.'});self.assertEqual(self.state()['communication']['personaId'],identity);self.assertEqual(self.state()['beliefs'],beliefs);self.assertEqual(self.s.context(self.w)['playerProfile']['name'],'Sam');self.assertEqual(self.state(),self.s.replay(self.w))
  other=self.s.command(dict(schemaVersion=1,key='second',type='create',name='Other'))['worldId'];self.assertEqual(self.s.context(other)['playerProfile'],{})
 def test_studio_expression_updates_preserve_life_and_invalidate_voice_snapshot(self):
  before=self.state();old=self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],before)[1]
  self.cmd('configure_expression_profile',fields={'personality':'Reserved, precise','photoDirection':'Natural awkward framing','voice':{'emojiDensity':0}});after=self.state()
  self.assertEqual(after['truth']['companion']['humanDynamics'],before['truth']['companion']['humanDynamics']);self.assertEqual(after['truth']['companion']['personality'],'Reserved, precise');self.assertNotEqual(old,self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],after)[1]);self.assertEqual(after,self.s.replay(self.w))
  with self.assertRaises(ValueError):self.cmd('configure_expression_profile',fields={'lifeRuntime':{}})
 def test_preferences_persist_without_changing_body_or_relationship(self):
  profile=dict(interests='Thoughtful questions',aversions='Pressure',boundaries='Respect a refusal',affectionStyle='Quiet warmth',contextNotes='Reserved when tired',openness=35,privacyPreference=80,initiative=30,restraint=70)
  before=self.state();digest=self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],before)[1]
  self.cmd('configure_personal_preferences',profile=profile);after=self.state()
  self.assertEqual(after['truth']['companion']['humanDynamics'],before['truth']['companion']['humanDynamics'])
  self.assertEqual(self.s.context(self.w)['personalPreferences']['profile']['boundaries'],'Respect a refusal')
  self.assertNotEqual(digest,self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],after)[1]);self.assertEqual(after,self.s.replay(self.w))
  for invalid in ({**profile,'openness':101},{**profile,'initiative':True},{**profile,'restraint':float('nan')},{**profile,'actions':[]},{**profile,'interests':'x'*2001}):
   with self.assertRaises(ValueError):self.cmd('configure_personal_preferences',profile=invalid)
  other=self.s.command(dict(schemaVersion=1,key='other-pref',type='create',name='Other'))['worldId'];self.assertEqual(self.s.context(other)['personalPreferences']['profile'],{})
 def test_profile_change_supersedes_unsubmitted_reply(self):
  self.cmd('receive_message',text='Hi');self.cmd('advance',steps=1);job=self.cmd('queue_dialogue',text='Fixture')['jobId'];self.cmd('configure_player_profile',profile={'templateId':'new','name':'Sam','text':'New description'});self.assertIsNone(self.s.dialogue.claim());self.assertEqual(self.s.dialogue.list(self.w)[0]['status'],'superseded')
if __name__=='__main__':unittest.main(verbosity=2)
