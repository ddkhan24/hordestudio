"""Live-location weather with an offline provider fixture."""
import sys,pathlib,json,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import vh2_ecosystem_audit as fixtures
import vh2_weather
class Weather(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 cmd=fixtures.Ecosystem.cmd
 state=fixtures.Ecosystem.state
 def test_current_weather_is_scoped_cached_and_replayed(self):
  self.cmd('configure_expression_profile',fields={'lifeWeatherEnabled':True,'locationLatitude':51.5,'locationLongitude':-.1})
  self.cmd('set_running',running=True);calls=[]
  def read(point):calls.append(point);return {'observedAt':self.s.clock(),'temperature':18,'description':'Rain','source':'fixture','coordinates':point,'stale':False}
  self.s.weather_executor=read;vh2_weather.poll(self.s)
  for future,point in self.s._weather_pending.values():future.result(timeout=3)
  vh2_weather.poll(self.s);self.assertEqual(len(calls),1);self.assertEqual(self.s.context(self.w)['environment']['temperature'],18)
  self.assertEqual(self.state(),self.s.replay(self.w));vh2_weather.poll(self.s);self.assertEqual(len(calls),1)
 def test_missing_coordinates_do_not_default_to_zero(self):
  self.cmd('configure_expression_profile',fields={'locationLatitude':None,'locationLongitude':None})
  self.assertIsNone(vh2_weather.location(self.state()))
 def test_rain_showers_are_not_snow(self):
  current={'temperature_2m':18,'apparent_temperature':17,'precipitation':1,'weather_code':80,'cloud_cover':90,'wind_speed_10m':10,'is_day':1,'time':self.s.clock()/1000}
  with patch('vh2_weather.fetch',return_value=json.dumps({'current':current}).encode()):self.assertEqual(vh2_weather.read([-.1,51.5])['description'],'Rain')
 def test_pending_old_location_result_cannot_import_after_pin_correction(self):
  from concurrent.futures import Future,ThreadPoolExecutor
  self.cmd('configure_expression_profile',fields={'lifeWeatherEnabled':True})
  self.cmd('upsert_place',place={'id':'home','label':'Home','kind':'home','longitude':0,'latitude':0})
  self.cmd('set_running',running=True)
  old=Future();old.set_result({'observedAt':self.s.clock(),'temperature':44,'coordinates':[0,0]})
  self.s._weather_pending={self.w:(old,[0,0])};self.s._weather_pool=ThreadPoolExecutor(max_workers=1);calls=[]
  self.s.weather_executor=lambda point:(calls.append(point) or {'observedAt':self.s.clock(),'temperature':20,'coordinates':point,'source':'fixture'})
  self.cmd('upsert_place',place={'id':'home','label':'Home','kind':'home','longitude':1,'latitude':1})
  vh2_weather.poll(self.s)
  for future,point in self.s._weather_pending.values():future.result(timeout=3)
  vh2_weather.poll(self.s)
  self.assertEqual(calls,[[1,1]]);environment=self.state()['truth']['companion']['lifeRuntime']['environment'];self.assertEqual(environment['temperature'],20);self.assertEqual(environment['coordinates'],[1,1]);self.assertEqual(self.state(),self.s.replay(self.w))
if __name__=='__main__':unittest.main()
