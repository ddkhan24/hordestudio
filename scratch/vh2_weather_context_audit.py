"""Chat cannot describe an old place's weather as current lived conditions."""
import copy,pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import vh2_ecosystem_audit as fixtures
import vh2_weather

class WeatherContext(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 def test_chat_uses_only_current_local_weather(self):
  state=self.s.projection(self.w)['state'];c=state['truth']['companion'];now=state['simAt']
  c['lifeProfile']['places'][0]['mapCoordinates']=[-111.93,33.43]
  state['truth']['present'].update(placeId='home',position={'coordinates':[-111.93,33.43]})
  c['lifeRuntime']['environment']={'temperature':40,'coordinates':[-111.93,33.43],'observedAt':now,'scope':'weather_model_observation'}
  self.assertEqual(self.s.expression_context(self.w,0,state)['environment']['temperature'],40)
  for scenario in ('expired','future','remote','stale','undated'):
   case=copy.deepcopy(state);environment=case['truth']['companion']['lifeRuntime']['environment']
   if scenario=='expired':case['simAt']+=3600001
   if scenario=='future':environment['observedAt']+=1
   if scenario=='remote':environment['coordinates']=[-80.19,25.76]
   if scenario=='stale':environment['stale']=True
   if scenario=='undated':environment.pop('observedAt')
   self.assertIsNone(self.s.expression_context(self.w,0,case)['environment'],scenario)
  self.assertEqual(c['lifeRuntime']['environment']['temperature'],40,'read-only filtering retains the original recorded observation')
 def test_another_home_does_not_inherit_profile_coordinates(self):
  state=self.s.projection(self.w)['state'];c=state['truth']['companion']
  c.update(locationLongitude=-111.93,locationLatitude=33.43)
  c.setdefault('vh2Travel',{})['residenceId']='home';c['lifeProfile']['places'].append({'id':'friend-home','kind':'home'})
  state['truth']['present'].update(placeId='friend-home',position=None)
  self.assertIsNone(vh2_weather.location(state))

if __name__=='__main__':unittest.main(verbosity=2)
