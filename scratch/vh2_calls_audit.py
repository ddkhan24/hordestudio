import sys,pathlib,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import vh2_ecosystem_audit as fixtures
class Calls(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 cmd=fixtures.Ecosystem.cmd
 def test_call_transcript_is_service_owned_and_replays(self):
  self.cmd('set_running',running=True)
  self.cmd('start_call',callId='call1')
  self.assertEqual(self.state()['communication']['messages'][-1]['callId'],'call1')
  self.cmd('call_turn',callId='call1',text='How are you?')
  self.cmd('end_call',callId='call1')
  self.assertEqual(self.state()['communication']['call']['status'],'ended')
  self.assertEqual(self.state(),self.s.replay(self.w))
  with self.assertRaises(Exception):self.cmd('call_turn',callId='call1',text='Still there?')
 def test_call_cannot_bypass_live_state(self):
  with self.assertRaises(Exception):self.cmd('start_call',callId='call1')
  with self.assertRaises(Exception):self.cmd('receive_message',messageType='call',callId='missing',text='x')
if __name__=='__main__':unittest.main()
