"""Selected historical context is isolated, inert, replayable and portable."""
from test_runtime import node_executable
import sys,json,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
from vh2_migration import inspect_archive
import vh2_backup
ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'scratch/fixtures/vh2/portable-v3.json').read_text()
class History(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open('a');self.w=self.s.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
 def open(self,name):return WorldService(Path(self.tmp.name)/(name+'.sqlite'),node_executable(ROOT),ROOT,clock=lambda:1789030800000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def body(self,source=SOURCE):
  r=inspect_archive(source);return dict(schemaVersion=1,key=str(uuid.uuid4()),type='import_vh1_history',worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],sourceText=source,expectedDigest=r['archiveDigest'],sessionId=r['timelines'][0]['id'],targetPersonaId=self.state()['communication']['personaId'],reviewed=True)
 def test_only_selected_history_reaches_dialogue_and_preserves_reality(self):
  before=self.state();body=self.body();self.s.command(body);self.s.command(body);after=self.state();self.assertEqual(before['truth'],after['truth']);self.assertEqual(before['communication'],after['communication']);self.assertEqual(after,self.s.replay(self.w));context=self.s.context(self.w)['priorConversation'];self.assertIn('London',str(context));self.assertNotIn('Tokyo',str(context));self.assertNotIn('sourceText',context);self.assertEqual(after['legacyHistory']['sourceText'],SOURCE)
  archive=vh2_backup.export(self.s,self.w);other=self.open('restore')
  try:vh2_backup.restore(other,archive);self.assertEqual(other.projection(self.w)['state']['legacyHistory'],after['legacyHistory'])
  finally:other.close()
 def test_review_digest_and_owner_are_required(self):
  for changes in ({'reviewed':False},{'expectedDigest':'wrong'},{'targetPersonaId':'wrong'},{'sessionId':'wrong'}):
   with self.assertRaises(ValueError):self.s.command({**self.body(),**changes})
  self.assertNotIn('legacyHistory',self.state())
 def test_pending_unread_and_invalidated_messages_are_not_shared_history(self):
  a=json.loads(SOURCE);messages=a['timelines']['sessions'][0]['messages'];messages.extend([{**messages[0],'id':'unread','text':'UNREAD','readAt':0},{**messages[0],'id':'pending','text':'PENDING','pending':True},{**messages[0],'id':'invalid','text':'INVALID','invalidated':True},{**messages[0],'id':'reply','role':'companion','text':'Remembered reply','deliveryState':'delivered'}]);self.s.command(self.body(json.dumps(a)));text=str(self.s.context(self.w)['priorConversation']);self.assertNotIn('UNREAD',text);self.assertNotIn('PENDING',text);self.assertNotIn('INVALID',text);self.assertIn('Remembered reply',text)
 def test_legacy_memories_remain_claims_and_stay_persona_scoped(self):
  a=json.loads(SOURCE);a['timelines']['sessions'][0]['runtime']['memory']['longTerm']=[{'text':'Likes gardening','kind':'preference','subject':'player','status':'active'},{'text':'Superseded detail','status':'superseded'}];a['timelines']['sessions'][1]['runtime']['memory']['longTerm']=[{'text':'Other persona private memory'}]
  self.s.command(self.body(json.dumps(a)));context=self.s.context(self.w)['priorConversation'];self.assertEqual(context['memoryClaims'][0]['scope'],'imported_memory_claim');self.assertNotIn('Superseded detail',str(context));self.assertNotIn('Other persona',str(context));self.assertEqual(self.state()['beliefs'],[])
 def test_running_and_second_import_are_rejected(self):
  self.s.command(self.body())
  with self.assertRaises(Conflict):self.s.command(self.body())
  other=self.s.command(dict(schemaVersion=1,key='other',type='create',name='Other'))['worldId'];self.w=other;p=self.s.projection(other);self.s.command(dict(schemaVersion=1,key='run',type='set_running',worldId=other,expectedRevision=p['revision'],running=True))
  with self.assertRaises(Conflict):self.s.command(self.body())
if __name__=='__main__':unittest.main(verbosity=2)
