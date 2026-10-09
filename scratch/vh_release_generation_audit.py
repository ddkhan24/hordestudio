"""Old offline input cannot repopulate a cleared or reopened conversation."""
import unittest,uuid
import vh2_conversations_audit as fixtures
from virtual_humans.backend.vh2_runtime import Conflict

class Generations(unittest.TestCase):
 setUp=fixtures.Conversations.setUp
 tearDown=fixtures.Conversations.tearDown
 cmd=fixtures.Conversations.cmd
 open=fixtures.Conversations.open
 state=fixtures.Conversations.state
 def pending(self,persona=None,generation=0):
  return {'schemaVersion':1,'key':str(uuid.uuid4()),'type':'receive_message','worldId':self.w,
   'expectedRevision':self.s.projection(self.w)['revision'],'text':'Queued before the reset.',
   'conversationGeneration':generation,**({'conversationPersonaId':persona} if persona else {})}
 def test_clear_and_reset_reject_old_offline_input_atomically(self):
  for action in ('clear','reset'):
   with self.subTest(action=action):
    generation=self.state()['communication'].get('generation',0);queued=self.pending(generation=generation)
    self.cmd('manage_conversation',action=action);before=self.s.projection(self.w)
    with self.assertRaises(Conflict):self.s.command(queued)
    self.assertEqual(before,self.s.projection(self.w));self.assertEqual(self.state()['communication']['messages'],[])
    with self.s.connect() as db:self.assertIsNone(db.execute('SELECT key FROM commands WHERE key=?',(queued['key'],)).fetchone())
 def test_other_persona_inputs_and_live_clock_stale_revision_remain_valid(self):
  self.open();queued=self.pending('persona_b');self.cmd('manage_conversation',action='clear')
  self.s.command(queued);self.assertEqual(self.state()['communication']['messages'],[])
  self.assertEqual(self.state('persona_b')['communication']['messages'][0]['text'],queued['text'])
  current=self.pending(generation=1);self.cmd('advance',steps=1);self.s.command(current)
  self.assertEqual(self.state()['communication']['messages'][0]['text'],current['text'])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_deleted_and_reopened_contact_does_not_accept_pre_delete_input(self):
  self.open();queued=self.pending('persona_b');self.cmd('manage_conversation','persona_b',action='delete');self.open()
  with self.assertRaises(Conflict):self.s.command(queued)
  self.assertEqual(self.state('persona_b')['communication']['messages'],[])
  fresh=self.pending('persona_b',generation=1);self.s.command(fresh)
  self.assertEqual(self.state('persona_b')['communication']['messages'][0]['text'],fresh['text'])
 def test_committed_message_retry_after_clear_returns_receipt_without_recreation(self):
  body=self.pending();receipt=self.s.command(body);self.cmd('manage_conversation',action='clear')
  before=self.s.projection(self.w);self.assertEqual(self.s.command(body),receipt);self.assertEqual(self.s.projection(self.w),before)
 def test_generation_must_be_a_nonnegative_integer(self):
  for invalid in (True,-1,'0',1.5,None):
   with self.subTest(value=invalid),self.assertRaises(ValueError):self.s.command(self.pending(generation=invalid))

if __name__=='__main__':unittest.main(verbosity=2)
