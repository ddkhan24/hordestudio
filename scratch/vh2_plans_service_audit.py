"""Offline shared-plan lifecycle, validation, replay and restart acceptance."""
from test_runtime import node_executable
import sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
class Plans(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open()
  profile={'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'}],
   'socialCircle':[{'id':'jo','name':'Jo','closeness':100,'contactWindows':[{'days':list(range(7)),'startMinute':0,'endMinute':1440}]}],
   'world':{'people':[{'personId':'jo','placeId':'home','days':list(range(7)),'start':0,'end':1440,'activity':'relaxing'}]}}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kwargs):
  return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kwargs))
 def proposal(self):
  now=self.state()['simAt']
  return dict(personId='jo',placeId='home',label='Have coffee',startsAt=now+600000,endsAt=now+3600000,durationMinutes=5)
 def plans(self):return self.state()['truth']['companion']['vh2Plans']['plans']
 def test_completion_replay_context_and_restart(self):
  body=dict(schemaVersion=1,key='plan',type='propose_plan',worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**self.proposal())
  self.s.command(body);self.s.command(body)
  self.assertEqual(len(self.plans()),1)
  for _ in range(4):self.cmd('advance',steps=1)
  plan=self.plans()[0];self.assertEqual(plan['status'],'completed');self.assertTrue(plan['response']['accepted'])
  self.assertEqual(self.state(),self.s.replay(self.w))
  self.assertEqual(self.s.context(self.w)['sharedPlans'][0]['status'],'completed')
  self.assertNotIn('response',self.s.context(self.w)['sharedPlans'][0],'private decision weights are not dialogue knowledge')
  bonds=self.s.context(self.w)['socialRelationships']
  self.assertEqual(bonds[0]['sharedMeetings'],1)
  self.assertNotIn('other',bonds[0])
  self.s.close();self.s=self.open();self.cmd('advance',steps=1)
  self.assertEqual(self.s.context(self.w)['socialRelationships'],bonds)
  self.assertEqual(self.plans()[0],plan)
  events=self.state()['truth']['companion']['vh2Plans']['events']
  self.assertEqual(sum(e['id'].endswith(':completed') for e in events),1)
 def test_invalid_and_overlapping_plans_are_atomic(self):
  before=self.state();bad=self.proposal();bad['personId']='invented'
  with self.assertRaises(ValueError):self.cmd('propose_plan',**bad)
  self.assertEqual(self.state(),before)
  self.cmd('propose_plan',**self.proposal());before=self.state()
  with self.assertRaises(Conflict):self.cmd('propose_plan',**self.proposal())
  self.assertEqual(self.state(),before)
 def test_cancelled_plan_never_becomes_meeting(self):
  self.cmd('propose_plan',**self.proposal());ident=self.plans()[0]['id']
  self.cmd('cancel_plan',planId=ident)
  for _ in range(4):self.cmd('advance',steps=1)
  self.assertEqual(self.plans()[0]['status'],'cancelled')
  self.assertEqual(self.state(),self.s.replay(self.w))
  with self.assertRaises(Conflict):self.cmd('cancel_plan',planId=ident)

if __name__=='__main__':unittest.main(verbosity=2)
