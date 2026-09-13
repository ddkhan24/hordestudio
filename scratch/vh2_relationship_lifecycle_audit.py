"""Social policy validation and persistence. No generated relationship dialogue."""
from test_runtime import node_executable
import json,sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService
ROOT=Path(__file__).resolve().parents[1]
class Relationships(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open();profile={'age':28,'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'}],'socialCircle':[{'id':'sam','name':'Sam','role':'friend'},{'id':'family','name':'Family','role':'family'}]}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kwargs):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kwargs))
 def test_policy_does_not_grant_a_relationship(self):
  self.cmd('configure_romantic_potential',personId='sam',policy={'enabled':True,'personAge':28,'selfPotential':90,'otherPotential':60})
  c=self.state()['truth']['companion'];self.assertEqual(c['vh2SocialBonds']['pairs']['sam']['lifecycle']['status'],'none')
  self.assertNotIn('otherPotential',json.dumps(self.s.context(self.w)));self.assertEqual(self.state(),self.s.replay(self.w));before=self.state();self.s.close();self.s=self.open();self.assertEqual(before,self.state())
 def test_invalid_eligibility_is_atomic(self):
  for ident,age in [('sam',17),('family',30)]:
   before=self.state()
   with self.assertRaises(ValueError):self.cmd('configure_romantic_potential',personId=ident,policy={'enabled':True,'personAge':age,'selfPotential':100,'otherPotential':100})
   self.assertEqual(before,self.state())
 def test_pace_validation(self):
  policy=self.state()['truth']['companion']['vh2SocialBonds']['policy'];self.cmd('configure_social_progression',policy={**policy,'friendDays':60})
  self.assertEqual(self.state()['truth']['companion']['vh2SocialBonds']['policy']['friendDays'],60)
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('configure_social_progression',policy={**policy,'datingDays':120,'partnerDays':30})
  self.assertEqual(before,self.state())
if __name__=='__main__':unittest.main(verbosity=2)
