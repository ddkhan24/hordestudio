"""Trip command persistence and actual movement; no external providers."""
from test_runtime import node_executable
import sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService
ROOT=Path(__file__).resolve().parents[1]
class Trips(unittest.TestCase):
 def test_trip_replay_and_arrival(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=WorldService(Path(tmp)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
   profile={'age':28,'lifeProfile':{'places':[{'id':'home','kind':'home','label':'Home'},{'id':'town','kind':'other','label':'Town'}],'weeklySchedule':[],'travelLegs':[{'from':'home','to':'town','mode':'WALK','minutes':10,'cost':0},{'from':'town','to':'home','mode':'WALK','minutes':10,'cost':0}],'world':{'transport':{'enabled':True}}}}
   w=s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
   def command(kind,**kw):return s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=w,expectedRevision=s.projection(w)['revision'],**kw))
   with self.assertRaises(ValueError):command('plan_trip',label='Bad',stops=[{'placeId':'missing','stayMinutes':5}])
   command('plan_trip',label='Town visit',stops=[{'placeId':'town','stayMinutes':120}])
   for _ in range(8):command('advance',steps=1)
   state=s.projection(w)['state'];c=state['truth']['companion'];self.assertEqual(c['vh2Travel']['trips'][0]['status'],'staying');self.assertEqual(c['lifeRuntime']['world']['placeId'],'town');self.assertEqual(state,s.replay(w));self.assertIn('Town',c.get('currentLocationDetail','')+state['truth']['present']['activity'])
   command('cancel_trip');self.assertIsNone(s.projection(w)['state']['truth']['companion']['vh2Travel']['activeId']);s.close()
if __name__=='__main__':unittest.main(verbosity=2)
