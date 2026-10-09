"""Offline Ticketmaster contract, credential, replay and polling acceptance."""
import gzip,json,sys,time,unittest,uuid
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from virtual_humans.backend import vh2_ticketmaster as tm; from virtual_humans.backend import vh2_feeds as feeds; from virtual_humans.backend import vh2_backup
import vh2_ecosystem_audit as fixtures
DATA={'page':{'number':0,'totalElements':1},'_embedded':{'events':[{'id':'ev1','name':'Jazz at the Park','url':'https://www.ticketmaster.com/event/ev1','dates':{'start':{'dateTime':'2026-09-07T09:00:00Z'},'status':{'code':'onsale'}},'_embedded':{'venues':[{'id':'venue1','name':'Park Stage','city':{'name':'Los Angeles'},'country':{'countryCode':'US'}}]},'classifications':[{'segment':{'name':'Music'}}]}]}}
class Ticketmaster(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 c=fixtures.Ecosystem.c
 def cmd(self,command_type,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=command_type,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw))
 def configure(self,**kwargs):
  self.cmd('configure_world_feed',kind='ticketmaster',purpose='events',city='Los Angeles',countryCode='US',**kwargs)
  return self.c()['vh2Signals']['sources'][-1]
 def test_config_and_credentials(self):
  a=self.configure();b=self.configure(keyword='jazz');self.assertNotEqual(a['id'],b['id'])
  self.assertEqual(a['url'],tm.URL)
  before=self.state()
  for kw in ({'placeId':'park'},{'venueMappings':{'v':'missing'}},{'lookaheadDays':100}):
   with self.assertRaises(ValueError):self.configure(**kw)
  self.assertEqual(before,self.state())
  scope='horde:alex'
  with self.assertRaises(ValueError):tm.settings(self.s,dict(scope=scope,enabled=True))
  status=tm.settings(self.s,dict(scope=scope,enabled=True,apiKey='FAKE_SECRET',dailyLimit=1));self.assertNotIn('FAKE_SECRET',json.dumps(status))
  token=tm.reserve(self.s,scope)
  with self.assertRaises(ValueError):tm.reserve(self.s,scope)
  self.assertNotIn(b'FAKE_SECRET',gzip.decompress(vh2_backup.export(self.s,self.w)))
  tm.settings(self.s,dict(scope=scope,enabled=False,clearKey=True));self.assertFalse(tm.current(self.s,scope,token['version']))
 def test_event_contract_and_updates(self):
  source=self.configure(venueMappings={'venue1':'park'});now=self.state()['simAt']
  a=tm.parse(json.dumps(DATA),source,now)[0];self.assertEqual(a['placeId'],'park');self.assertIsNone(a['endsAt']);self.assertEqual(a['tags'],['music']);self.assertEqual(a['scope'],'publisher_claim')
  self.cmd('import_world_feed',sourceId=source['id'],xml=json.dumps(DATA));self.cmd('import_world_feed',sourceId=source['id'],xml=json.dumps(DATA));self.assertEqual(len(self.c()['vh2Signals']['signals']),1)
  updated=json.loads(json.dumps(DATA));updated['_embedded']['events'][0]['dates']['status']['code']='cancelled'
  self.cmd('import_world_feed',sourceId=source['id'],xml=json.dumps(updated));b=self.c()['vh2Signals']['signals'][0];self.assertEqual(b['id'],a['id']);self.assertNotEqual(b['versionKey'],a['versionKey']);self.assertEqual(b['eventStatus'],'cancelled');self.assertEqual(self.c()['vh2Signals']['known'],[])
  self.assertEqual(self.state(),self.s.replay(self.w))
  empty={'page':{'totalElements':0,'number':0}};self.cmd('import_world_feed',sourceId=source['id'],xml=json.dumps(empty));self.assertEqual(self.c()['vh2Signals']['signals'],[])
 def test_missing_time_truncation_and_invalid_payload(self):
  source=self.configure();data=json.loads(json.dumps(DATA));data['page']['totalElements']=300;data['_embedded']['events'][0]['dates']['start']['timeTBA']=True
  self.assertEqual(tm.parse(json.dumps(data),source,self.state()['simAt']),[]);self.assertIn('first 200',source['warning'])
  for raw in ('{}','{"fault":{ "message":"bad"}}','[]'):
   with self.assertRaises(ValueError):tm.parse(raw,source,self.state()['simAt'])
 def test_fixed_host_query_and_secret_redaction(self):
  source=self.configure();config={'api_key':'FAKE_SECRET','version':'v'}
  with patch('virtual_humans.backend.vh2_feeds.PublicConnection') as cls:
   conn=cls.return_value;conn.getresponse.return_value.status=200;conn.getresponse.return_value.read.return_value=json.dumps(DATA).encode()
   raw,v=tm.fetch(config,source,self.state()['simAt']);self.assertEqual(v,'v');self.assertEqual(cls.call_args.args[0],'app.ticketmaster.com');query=conn.request.call_args.args[1];self.assertIn('city=Los+Angeles',query);self.assertIn('countryCode=US',query);self.assertIn('startDateTime=',query)
   conn.request.side_effect=Exception('leaked FAKE_SECRET')
   with self.assertRaises(ValueError) as caught:tm.fetch(config,source,self.state()['simAt'])
   self.assertNotIn('FAKE_SECRET',str(caught.exception))
 def test_background_poll_refresh_and_replay(self):
  source=self.configure();tm.settings(self.s,dict(scope='horde:alex',enabled=True,apiKey='FAKE_SECRET',dailyLimit=10));self.cmd('set_running',running=True)
  with patch.object(tm,'fetch',side_effect=lambda config,source,now:(json.dumps(DATA),config['version'])) as fetch:
   feeds.poll(self.s)
   for _ in range(50):
    if self.s._feed_pending and all(v[0].done() for v in self.s._feed_pending.values()):break
    time.sleep(.01)
   feeds.poll(self.s);self.assertEqual(fetch.call_count,1)
  self.assertEqual(self.c()['vh2Signals']['sources'][0]['itemCount'],1);self.assertEqual(self.state(),self.s.replay(self.w))
  self.cmd('refresh_world_feed',sourceId=source['id']);self.assertIsNone(self.c()['vh2Signals']['sources'][0]['lastAttemptAt'])
 def test_missing_key_is_visible_without_request(self):
  self.configure();self.cmd('set_running',running=True)
  with patch.object(tm,'fetch') as fetch:feeds.poll(self.s);fetch.assert_not_called()
  self.assertIn('Ticketmaster',self.c()['vh2Signals']['sources'][0]['error'])
if __name__=='__main__':unittest.main()
