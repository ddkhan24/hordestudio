"""Source-backed recall, atomic archive retention and explicit profile upgrade."""
from test_runtime import node_executable
import sys,tempfile,unittest,json,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,encode
ROOT=Path(__file__).resolve().parents[1]
class Memory(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.now=1788764400000;self.s=self.open();self.w=self.s.command(dict(schemaVersion=1,key='new',type='create',name='Alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'a.sqlite',node_executable(ROOT),ROOT,clock=lambda:self.now)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def cmd(self,kind,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw))
 def test_read_messages_are_scoped_experiences_not_verified_facts(self):
  self.cmd('receive_message',text='I visited the botanical garden yesterday.')
  immediate=self.s.projection(self.w)['state'];message=immediate['communication']['messages'][0]
  if not message.get('readAt'):self.assertFalse(any(e['kind']=='heard_statement' for e in immediate['truth']['companion']['vh2Psychology']['episodes']))
  self.cmd('advance',steps=1);context=self.s.context(self.w)
  heard=[e for e in context['recalledExperiences'] if e['kind']=='heard_statement']
  self.assertEqual(len(heard),1);self.assertEqual(heard[0]['appraisal']['truthScope'],'player_claim');self.assertIn('sourceMessageId',heard[0])
  self.cmd('advance',steps=1)
  with self.s.connect() as db:self.assertEqual(db.execute("SELECT COUNT(*) FROM memory_episodes WHERE json_extract(data,'$.kind')='heard_statement'").fetchone()[0],1)
 def test_archive_survives_recent_window_eviction_and_restart(self):
  with self.s.connect() as db:
   revision,before=self.s.read(db,self.w);after=json.loads(encode(before))
   after['truth']['companion']['vh2Psychology']['episodes']=[dict(id='old-garden',at=self.now-86400000,summary='Walked in the botanical garden.',kind='completed',placeId='park',appraisal={'value':.2,'truthScope':'simulation_inference'})]
   self.s.commit_event(db,self.w,revision,before,after,'TEST_OLD_EXPERIENCE')
   revision,before=self.s.read(db,self.w);after=json.loads(encode(before));after['truth']['companion']['vh2Psychology']['episodes']=[]
   self.s.commit_event(db,self.w,revision,before,after,'TEST_RECENT_WINDOW_EVICTION')
  self.cmd('receive_message',text='How was the botanical garden?');self.cmd('advance',steps=1)
  self.assertTrue(any(e['id']=='old-garden' for e in self.s.context(self.w)['recalledExperiences']))
  expected=self.s.context(self.w);self.s.close();self.s=self.open();self.assertEqual(self.s.context(self.w),expected)
  self.assertEqual(self.s.projection(self.w)['state'],self.s.replay(self.w))
 def test_relevant_old_memory_beats_recent_same_place_noise(self):
  state=self.s.projection(self.w)['state'];place=state['truth']['present'].get('placeId')
  with self.s.connect() as db:
   for i in range(110):
    episode={'id':'noise'+str(i),'at':self.now+i,'summary':'An ordinary day here.','placeId':place,'kind':'completed'}
    db.execute('INSERT INTO memory_episodes VALUES (?,?,?,?,?,?)',(self.w,episode['id'],1,episode['at'],episode['summary'],json.dumps(episode)))
   old={'id':'old-orchid','at':self.now-86400000,'summary':'Visited the orchid exhibition.','placeId':place,'kind':'completed'}
   db.execute('INSERT INTO memory_episodes VALUES (?,?,?,?,?,?)',(self.w,old['id'],1,old['at'],old['summary'],json.dumps(old)))
  self.cmd('receive_message',text='How was the orchid exhibition?');self.cmd('advance',steps=1)
  self.assertIn('old-orchid',[e['id'] for e in self.s.context(self.w)['recalledExperiences']])
 def test_memory_cannot_cross_personas(self):
  self.cmd('receive_message',text='I collect botanical prints.');self.cmd('advance',steps=1)
  state=self.s.projection(self.w)['state'];state['communication']['personaId']='other-player'
  self.assertFalse(any(e.get('kind')=='heard_statement' for e in self.s.expression_context(self.w,999,state)['recalledExperiences']))
 def test_policy_is_explicit_and_bounded(self):
  policy=dict(enabled=True,learningRate=.3,experienceWeight=5,emotionalImpact=.5,affectHalfLifeHours=3,memoryLimit=50)
  self.cmd('configure_psychology',policy=policy)
  self.assertEqual(self.s.projection(self.w)['state']['truth']['companion']['vh2Psychology']['policy'],policy)
  with self.assertRaises(ValueError):self.cmd('configure_psychology',policy={**policy,'experienceWeight':100})
if __name__=='__main__':unittest.main(verbosity=2)
