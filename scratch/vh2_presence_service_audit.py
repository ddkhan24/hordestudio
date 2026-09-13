"""Persistent visit/notice records and expression boundaries, offline."""
from test_runtime import node_executable
import json,sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService
ROOT=Path(__file__).resolve().parents[1]
class Presence(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open()
  profile={'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'}],'socialCircle':[{'id':'jo','name':'Jo'}],
    'world':{'people':[{'personId':'jo','placeId':'home','days':list(range(7)),'start':0,'end':1440,'activity':'relaxing'}]}}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def advance(self):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type='advance',steps=1,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision']))
 def test_notice_enters_memory_and_survives_restart_without_duplicates(self):
  self.assertEqual(self.s.context(self.w)['current']['observedPeople'],[])
  self.advance();state=self.state()
  self.assertEqual(self.s.context(self.w)['current']['observedPeople'][0]['id'],'jo')
  self.assertEqual(len([m for m in state['memories'] if 'Noticed Jo' in m['summary']]),1)
  self.assertEqual(state,self.s.replay(self.w));self.s.close();self.s=self.open();self.advance()
  self.assertEqual(len([m for m in self.state()['memories'] if 'Noticed Jo' in m['summary']]),1)
 def test_reads_do_not_create_notices_or_place_people_in_photos(self):
  before=self.state()
  for _ in range(3):self.s.context(self.w);self.s.entity_projection(self.w)
  self.assertEqual(before,self.state())
  self.advance();state=self.state()
  captured=self.s.kernel({'companion':state['truth']['companion'],'now':state['simAt'],'inspect':True,'capture':True})
  self.assertEqual(captured['photoContext']['withNames'],[],'noticing a person does not place them in the photo')
  self.assertEqual(captured['present']['observedPeople'][0]['id'],'jo')
  self.assertEqual(state,self.state())

if __name__=='__main__':unittest.main(verbosity=2)
