"""Independent people: service ownership, private state, validation, restart and replay."""
from test_runtime import node_executable
import json,sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
POLICY={'homePlaceId':'home','foodPlaceIds':[],'leisurePlaceIds':['park'],'modes':['WALK','TRANSIT'],'ownsCar':False,'ownsBicycle':False,'curiosity':90,'conscientiousness':70,'temperature':8,'sleepStart':23,'sleepEnd':7,'mealCost':2,'incomePerHour':0,'paidPlaceIds':[],'dailyExpense':0}
class People(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open()
  # Being at home is passive availability, not a 24-hour work obligation.
  profile={'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'},{'id':'park','label':'Park','kind':'outdoor','encounterScope':'nearby'}],'socialCircle':[{'id':'sam','name':'Sam','closeness':100}], 'world':{'people':[{'personId':'sam','placeId':'home','days':list(range(7)),'start':0,'end':1440,'activity':'home','flexibility':'soft'}]},'travelLegs':[{'from':'home','to':'park','mode':'WALK','minutes':5},{'from':'park','to':'home','mode':'WALK','minutes':5}]}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kwargs):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kwargs))
 def enable(self):return self.cmd('configure_person_life',personId='sam',policy=POLICY,startingBalance=100)
 def test_explicit_vehicle_setup_correction_preserves_money_and_presence(self):
  self.enable();before=self.state()['truth']['companion']['vh2People']['actors']['sam']
  self.cmd('correct_person_vehicle_ownership',personId='sam',ownsCar=True,ownsBicycle=False,reason='Existing authored biography establishes their car.')
  a=self.state()['truth']['companion']['vh2People']['actors']['sam']
  self.assertEqual(a['balance'],before['balance']);self.assertEqual(a['placeId'],before['placeId']);self.assertTrue(a['policy']['ownsCar']);self.assertIn('DRIVE',a['policy']['modes']);self.assertEqual(a['carPlaceId'],a['placeId'])
  self.assertEqual(self.state(),self.s.replay(self.w))
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('correct_person_vehicle_ownership',personId='sam',ownsCar=False,ownsBicycle=False,reason='')
  self.assertEqual(self.state(),before)
 def test_needs_restart_replay_and_context_privacy(self):
  self.enable();self.cmd('advance',steps=12)
  a=self.state()['truth']['companion']['vh2People']['actors']['sam'];self.assertGreater(a['hunger'],30);self.assertLess(a['energy'],75);self.assertGreater(a['sequence'],0)
  self.assertEqual(self.state(),self.s.replay(self.w));before=self.state();self.s.context(self.w);self.assertEqual(before,self.state())
  self.assertNotIn('startingBalance',json.dumps(self.s.context(self.w)));self.assertNotIn('lastDecision',json.dumps(self.s.context(self.w)))
  self.s.close();self.s=self.open();self.assertEqual(before,self.state());self.cmd('advance',steps=1);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_independent_person_actually_attends_shared_plan(self):
  self.enable()
  for _ in range(20):
   now=self.state()['simAt'];self.cmd('propose_plan',personId='sam',placeId='home',label='Catch up',startsAt=now+30*60000,endsAt=now+70*60000,durationMinutes=5)
   plan_id=self.state()['truth']['companion']['vh2Plans']['plans'][-1]['id']
   # A participant may defer until attention is free. Do not submit another
   # overlapping invitation while the first is still under consideration.
   for _ in range(14):
    self.cmd('advance',steps=1)
    plan=next(p for p in self.state()['truth']['companion']['vh2Plans']['plans'] if p['id']==plan_id)
    if plan['status']!='proposed':break
   if plan['status']=='accepted':break
  self.assertEqual(plan['status'],'accepted')
  for _ in range(24):
   self.cmd('advance',steps=1)
   plan=next(p for p in self.state()['truth']['companion']['vh2Plans']['plans'] if p['id']==plan_id)
   if plan['status'] in ('completed','missed','cancelled'):break
  self.assertEqual(plan['status'],'completed')
  self.assertEqual(self.s.context(self.w)['socialRelationships'][0]['sharedMeetings'],1)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_validation_and_no_money_reset(self):
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('configure_person_life',personId='missing',policy=POLICY,startingBalance=100)
  self.assertEqual(before,self.state());self.enable();self.cmd('configure_person_life',personId='sam',policy={**POLICY,'curiosity':20},startingBalance=999)
  self.assertEqual(self.state()['truth']['companion']['vh2People']['actors']['sam']['balance'],100)
  before=self.state()
  with self.assertRaises(Conflict):self.cmd('configure_person_life',personId='sam',policy={**POLICY,'ownsCar':True})
  self.assertEqual(before,self.state())
 def test_resident_life_before_introduction(self):
  self.cmd('add_resident',name='Taylor',placeId='park',days=list(range(7)),start=0,end=1440,openness=50)
  ident=self.state()['truth']['companion']['vh2Population']['residents'][0]['id']
  self.cmd('configure_person_life',personId=ident,policy=POLICY,startingBalance=20);self.cmd('advance',steps=6)
  a=self.state()['truth']['companion']['vh2People']['actors'][ident];self.assertGreater(a['sequence'],0)
  self.assertNotIn('Taylor',json.dumps(self.s.context(self.w)))
  with self.assertRaises(Conflict):self.cmd('remove_resident',residentId=ident)
if __name__=='__main__':unittest.main(verbosity=2)
