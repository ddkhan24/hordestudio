"""Offline scheduled departure and autonomous episode configuration integration."""
from test_runtime import node_executable
import sys,tempfile,uuid,unittest
import copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scratch.vh2_realtime_audit import feed,f,SOURCE
import vh2_realtime
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
class ExtendedTravel(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1789030800000)
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile={'photoDirection':'Playful imperfect framing','age':28,'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'},{'id':'away','label':'Away','kind':'home'}],'weeklySchedule':[],'sleepPolicy':{'enabled':False},'world':{'transport':{'enabled':True,'transit':True,'budget':100}}}},providerScope='horde:alex',personaId='p'))['worldId'];self.now=self.state()['simAt']
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw))
 def save(self,**kw):self.cmd('save_transport_service',service=dict(id='train',label='Train',kind='train',**{'from':'home','to':'away'},departsAt=self.now+10*60000,arrivesAt=self.now+20*60000,boardingMinutes=5,cost=10,source='offline fixture',**kw))
 def test_scheduled_wait_depart_arrive_and_replay(self):
  self.save();self.cmd('plan_trip',label='Trip',stops=[{'placeId':'away','stayMinutes':0}]);self.cmd('advance',steps=1);c=self.state()['truth']['companion'];self.assertEqual(c['vh2Travel']['trips'][0]['status'],'waiting');self.assertIsNone(c['lifeRuntime']['world']['journey']);before=c['lifeRuntime']['world']['balance'];self.cmd('advance',steps=1);c=self.state()['truth']['companion'];self.assertEqual(c['lifeRuntime']['world']['journey']['serviceId'],'train');self.assertEqual(c['lifeRuntime']['world']['balance'],before-10);self.cmd('advance',steps=3);self.assertEqual(self.state()['truth']['companion']['lifeRuntime']['world']['placeId'],'away');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_cancelled_service_never_teleports(self):
  self.save();self.cmd('plan_trip',label='Trip',stops=[{'placeId':'away','stayMinutes':0}]);self.cmd('advance',steps=1);self.cmd('cancel_transport_service',serviceId='train');self.cmd('advance',steps=1);c=self.state()['truth']['companion'];self.assertEqual(c['vh2Travel']['trips'][0]['status'],'blocked');self.assertEqual(c['lifeRuntime']['world']['placeId'],'home')
  with self.assertRaises(ValueError):self.cmd('retry_trip')
 def test_realtime_delay_wait_notice_onboard_arrival_and_replay(self):
  self.save();self.cmd('plan_trip',label='Delayed trip',stops=[{'placeId':'away','stayMinutes':0}]);self.cmd('advance',steps=1)
  def ingest(stops=b'',delay=600):
   p=self.s.projection(self.w);after=copy.deepcopy(p['state']);c=after['truth']['companion'];row=c['vh2Transport']['services'][0]
   row.update(sourceId='schedule',sourceTripId='trip',serviceDate='20260910',departureStopSequence=1,arrivalStopSequence=2)
   vh2_realtime.ingest(c,dict(SOURCE),feed(stamp=after['simAt'],stops=stops,delay=delay),after['simAt'],after['simAt'])
   with self.s.connect() as db:self.s.commit_event(db,self.w,p['revision'],p['state'],after,'WORLD_FEED_REFRESHED',{'sourceId':'rt'})
  ingest();before=self.state()['truth']['companion']['lifeRuntime']['world']['balance'];self.cmd('advance',steps=1)
  self.assertEqual(self.state()['truth']['companion']['vh2Travel']['trips'][0]['status'],'waiting');self.assertTrue(self.s.context(self.w)['noticedTransportUpdates'])
  self.cmd('advance',steps=2);j=self.state()['truth']['companion']['lifeRuntime']['world']['journey'];self.assertEqual(j['departedAt'],self.now+20*60000)
  ingest(f(2,f(1,2)+f(2,f(2,(self.now+40*60000)//1000))),0);self.cmd('advance',steps=3);self.assertIsNotNone(self.state()['truth']['companion']['lifeRuntime']['world']['journey']);self.cmd('advance',steps=1)
  c=self.state()['truth']['companion'];self.assertEqual(c['lifeRuntime']['world']['placeId'],'away');self.assertEqual(c['lifeRuntime']['world']['balance'],before-10);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_episode_config_and_photo_direction_preserved(self):
  self.assertEqual(self.state()['truth']['companion']['photoDirection'],'Playful imperfect framing');self.cmd('save_trip_opportunity',opportunity={'label':'Visit','placeId':'away','availableFrom':self.now,'availableUntil':self.now+7*86400000,'minNights':1,'maxNights':2,'nightlyCost':10,'interest':50,'enabled':True,'stayAllowed':True});self.assertEqual(len(self.state()['truth']['companion']['vh2Episodes']['opportunities']),1);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_automatic_recovery_after_cancellation_is_persisted(self):
  policy={'enabled':True,'reconsiderMinutes':5,'maxAttempts':3,'maxSpend':20,'maxWaitMinutes':60}
  self.cmd('configure_travel_recovery',policy=policy)
  with self.assertRaises(ValueError):self.cmd('configure_travel_recovery',policy={**policy,'maxAttempts':0})
  self.save();self.cmd('save_transport_service',service={'id':'later','label':'Later train','kind':'train','from':'home','to':'away','departsAt':self.now+30*60000,'arrivesAt':self.now+40*60000,'boardingMinutes':2,'cost':12,'source':'fixture'})
  self.cmd('plan_trip',label='Recoverable trip',stops=[{'placeId':'away','stayMinutes':0}]);self.cmd('advance',steps=1);self.cmd('cancel_transport_service',serviceId='train');self.cmd('advance',steps=2)
  c=self.state()['truth']['companion'];self.assertEqual(c['vh2Travel']['trips'][0]['status'],'waiting');self.assertEqual(c['vh2Travel']['trips'][0]['legs'][0]['serviceId'],'later');before=c['lifeRuntime']['world']['balance']
  self.cmd('advance',steps=3);self.assertEqual(self.state()['truth']['companion']['lifeRuntime']['world']['balance'],before-12);self.cmd('advance',steps=3);self.assertEqual(self.state()['truth']['companion']['lifeRuntime']['world']['placeId'],'away');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_malformed_person_link_is_validation_error(self):
  before=self.state()
  with self.assertRaisesRegex(ValueError,'Person ID'):self.cmd('save_trip_opportunity',opportunity={'placeId':'away','personId':['invalid']})
  self.assertEqual(before,self.state())
if __name__=='__main__':unittest.main(verbosity=2)
