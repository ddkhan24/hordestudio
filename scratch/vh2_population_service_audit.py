"""Population transactions, privacy and service persistence, using no providers."""
from test_runtime import node_executable
import json,sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
class Population(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open()
  profile={'lifeProfile':{'places':[{'id':'resident-home','label':'Resident home','kind':'home'},{'id':'cafe','label':'Cafe','kind':'social','encounterScope':'nearby'}],'travelLegs':[{'from':'resident-home','to':'cafe','mode':'WALK','minutes':5},{'from':'cafe','to':'resident-home','mode':'WALK','minutes':5}]}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kwargs):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kwargs))
 def add(self):return self.cmd('add_resident',name='Sam',placeId='cafe',days=list(range(7)),start=0,end=1440,openness=100,sharedDescription='Enjoys sketching.')
 def test_private_authoring_and_removal(self):
  self.add();r=self.state()['truth']['companion']['vh2Population'];self.assertEqual(len(r['residents']),1)
  self.assertNotIn('Sam',json.dumps(self.s.context(self.w)))
  before=self.state();self.s.context(self.w);self.assertEqual(before,self.state())
  self.cmd('remove_resident',residentId=r['residents'][0]['id']);self.assertEqual(self.state()['truth']['companion']['vh2Population']['residents'],[])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_validation_and_restart(self):
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('add_resident',name='Bad',placeId='invented')
  self.assertEqual(before,self.state());self.add();self.cmd('configure_population',enabled=True,openness=100)
  before=self.state();self.s.close();self.s=self.open();self.assertEqual(before,self.state());self.assertEqual(before,self.s.replay(self.w))
 def test_actual_introduction_in_service_then_persistent_context(self):
  self.cmd('add_resident',name='Sam',placeId='cafe',homePlaceId='resident-home',days=list(range(7)),start=0,end=1440,openness=100,age=26);self.cmd('configure_population',enabled=True,openness=100)
  # Explicit test-only initial position. No production command teleports the character.
  with self.s.connect() as db:
   revision,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));c=after['truth']['companion']
   c['lifeRuntime']['world']['placeId']='cafe'
   c['lifeProfile']['weeklySchedule']=[];c['lifeProfile']['world']['transport']['enabled']=True
   c['humanDynamics']['stress']=0;c['humanDynamics']['energy']=90
   actor=next(iter(c['vh2People']['actors'].values()));actor['action']={'kind':'leisure','placeId':'cafe','startedAt':after['simAt'],'endsAt':after['simAt']+1800000};actor['started']=True
   c['lifeProfile']['sleepPolicy']['enabled']=False
   c['vh2Population']['contacts'][c['vh2Population']['residents'][0]['id']]={'since':after['simAt']-900000,'attempted':False}
   self.s.commit_event(db,self.w,revision,before,after,'TEST_INITIAL_POSITION')
  for _ in range(3):self.cmd('advance',steps=1)
  c=self.state()['truth']['companion'];self.assertEqual(c['lifeProfile']['socialCircle'][-1]['name'],'Sam')
  self.assertEqual(len(c['vh2Population']['events']),1)
  self.assertEqual(c['lifeProfile']['socialCircle'][-1]['contactWindows'],[])
  self.assertIn(c['lifeProfile']['socialCircle'][-1]['id'],c['vh2People']['actors'])
  context=self.s.context(self.w);self.assertEqual(context['introductions'][0]['name'],'Sam')
  self.assertNotIn('lastDecision',json.dumps(context))
  self.assertEqual(self.state(),self.s.replay(self.w));before=self.state();self.s.close();self.s=self.open();self.assertEqual(before,self.state())
  self.cmd('advance',steps=1);self.assertEqual(len(self.state()['truth']['companion']['vh2Population']['events']),1)
  with self.assertRaises(Conflict):self.cmd('remove_resident',residentId=c['vh2Population']['residents'][0]['id'])
if __name__=='__main__':unittest.main(verbosity=2)
