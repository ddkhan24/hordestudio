"""Supporting-person movement affects co-presence through the real service."""
from test_runtime import node_executable
import sys,tempfile,unittest,uuid,datetime
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService
ROOT=Path(__file__).resolve().parents[1];NOW=1788764400000
class Npcs(unittest.TestCase):
 def test_routine_change_starts_travel_and_restart_preserves_it(self):
  with tempfile.TemporaryDirectory() as directory:
   def open_service():return WorldService(Path(directory)/'db',node_executable(ROOT),ROOT,clock=lambda:NOW)
   s=open_service()
   try:
    dt=datetime.datetime.utcfromtimestamp(NOW/1000);boundary=dt.hour*60+dt.minute+10
    profile={'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'},{'id':'work','label':'Work','kind':'work'}],
     'socialCircle':[{'id':'jo','name':'Jo'}], 'travelLegs':[{'from':'home','to':'work','minutes':12,'mode':'WALK'}],
     'world':{'people':[{'personId':'jo','placeId':'home','days':list(range(7)),'start':0,'end':boundary},
       {'personId':'jo','placeId':'work','days':list(range(7)),'start':boundary,'end':1440}]}}}
    w=s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
    def advance(steps):return s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type='advance',worldId=w,expectedRevision=s.projection(w)['revision'],steps=steps))
    # The participant finishes/reconsiders its own activity; a routine is not teleportation.
    for _ in range(18):
     advance(1);state=s.projection(w)['state'];actor=state['truth']['companion']['vh2People']['actors']['jo']
     if actor.get('journey'):break
     self.assertEqual(actor['placeId'],'home')
    self.assertIsNotNone(actor.get('journey'));self.assertEqual(actor['journey']['to'],'work');self.assertEqual(actor['placeId'],'')
    self.assertEqual(s.context(w)['current']['observedPeople'],[]);self.assertEqual(state,s.replay(w));s.close();s=open_service();advance(1)
    actor=s.projection(w)['state']['truth']['companion']['vh2People']['actors']['jo'];self.assertEqual(actor['placeId'],'');self.assertIsNotNone(actor['journey'])
    advance(2);state=s.projection(w)['state'];self.assertEqual(state['truth']['companion']['vh2People']['actors']['jo']['placeId'],'work');self.assertEqual(state,s.replay(w))
   finally:s.close()
if __name__=='__main__':unittest.main(verbosity=2)
