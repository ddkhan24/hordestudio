"""No live requests: native provider secrets, quota, parsing and background import."""
import sys,json,unittest,gzip,time,uuid
from pathlib import Path
from unittest.mock import patch,MagicMock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_flights as flights,vh2_feeds as feeds,vh2_backup
import vh2_ecosystem_audit as fixtures
DATA={'pagination':{'total':1,'offset':0},'data':[{'flight_status':'scheduled','flight':{'iata':'AB123'},'departure':{'iata':'AAA','scheduled':'2026-09-07T09:00:00Z','estimated':None},'arrival':{'iata':'BBB','scheduled':'2026-09-07T11:00:00Z','estimated':None}}]}
class Flights(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 c=fixtures.Ecosystem.c
 cmd=fixtures.Ecosystem.cmd
 def configure(self):
  self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type='configure_world_feed',worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],kind='aviationstack',departureIata='AAA',arrivalIata='BBB',stopMappings={'AAA':'home','BBB':'park'},fare=50))
  return self.c()['vh2Signals']['sources'][0]
 def test_credentials_quota_and_backup(self):
  scope='horde:alex'
  with self.assertRaises(ValueError):flights.settings(self.s,dict(scope=scope,enabled=True))
  status=flights.settings(self.s,dict(scope=scope,enabled=True,apiKey='SYNTHETIC_FLIGHT_SECRET',dailyLimit=1))
  self.assertNotIn('SYNTHETIC_FLIGHT_SECRET',json.dumps(status));self.assertTrue(status['hasKey'])
  token=flights.reserve(self.s,scope);self.assertEqual(token['api_key'],'SYNTHETIC_FLIGHT_SECRET')
  with self.assertRaises(ValueError):flights.reserve(self.s,scope)
  self.assertNotIn(b'SYNTHETIC_FLIGHT_SECRET',gzip.decompress(vh2_backup.export(self.s,self.w)))
  flights.settings(self.s,dict(scope=scope,enabled=False,clearKey=True,dailyLimit=1));self.assertFalse(flights.current(self.s,scope,token['version']))
 def test_native_updates_keep_id_and_no_partial_pages(self):
  source=self.configure();now=self.state()['simAt'];a=flights.parse(json.dumps(DATA),source,now)[0]
  updated=json.loads(json.dumps(DATA));updated['data'][0]['departure']['estimated']='2026-09-07T09:20:00Z';updated['data'][0]['arrival']['estimated']='2026-09-07T11:20:00Z'
  b=flights.parse(json.dumps(updated),source,now)[0];self.assertEqual(a['id'],b['id']);self.assertEqual(b['departsAt']-a['departsAt'],1200000)
  updated['data'][0]['flight_status']='cancelled';self.assertEqual(flights.parse(json.dumps(updated),source,now)[0]['status'],'cancelled')
  updated['pagination']['total']=101
  with self.assertRaises(ValueError):flights.parse(json.dumps(updated),source,now)
  self.cmd('import_world_feed',sourceId=source['id'],xml=json.dumps(DATA));self.assertEqual(self.c()['vh2Transport']['services'][0]['kind'],'flight');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_background_fetch_import_and_private_settings(self):
  source=self.configure();flights.settings(self.s,dict(scope='horde:alex',enabled=True,apiKey='FIXTURE',dailyLimit=1));self.cmd('set_running',running=True)
  with patch.object(flights,'fetch',side_effect=lambda config,source:(json.dumps(DATA).encode(),config['version'])) as fetch:
   feeds.poll(self.s)
   for _ in range(50):
    if self.s._feed_pending and all(v[0].done() for v in self.s._feed_pending.values()):break
    time.sleep(.01)
   feeds.poll(self.s)
   self.assertEqual(fetch.call_count,1)
  self.assertEqual(self.c()['vh2Transport']['services'][0]['cost'],50);self.assertEqual(self.c()['vh2Signals']['sources'][0]['error'],'');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_transport_hides_key_on_errors_and_fixed_host(self):
  config={'api_key':'SYNTHETIC_SECRET','version':'v'};source={'departureIata':'AAA','arrivalIata':'BBB'}
  with patch('vh2_feeds.PublicConnection') as cls:
   conn=cls.return_value;conn.request.side_effect=ValueError('accidental SYNTHETIC_SECRET')
   with self.assertRaises(ValueError) as caught:flights.fetch(config,source)
   self.assertNotIn('SYNTHETIC_SECRET',str(caught.exception));self.assertEqual(cls.call_args.args[0],'api.aviationstack.com')
 def test_group_policy_validation(self):
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('configure_person_network',enabled=True,policy={'friendDays':0})
  self.assertEqual(before,self.state())
  self.cmd('configure_person_network',enabled=True,policy={'groupPlansEnabled':True,'friendDays':7})
  self.assertTrue(self.c()['vh2People']['network']['policy']['groupPlansEnabled'])
if __name__=='__main__':unittest.main()
