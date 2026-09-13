"""Offline adapter and service integration regression tests."""
import sys,json,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_live_data as live
import vh2_ecosystem_audit as fixtures
NOW=1788764400000
class Adapters(unittest.TestCase):
 def source(self):return dict(id='feed',url='https://example.org/feed',freshHours=48,tags=['football'],stopMappings={'AAA':'home','BBB':'park'},fare=120)
 def test_flights_offsets_cancellation_and_staleness(self):
  d=dict(schemaVersion=1,observedAt='2026-09-07T07:00:00Z',flights=[dict(id='A:20260907',label='A 1',**{'from':'AAA','to':'BBB'},departsAt='2026-09-07T10:00:00+01:00',arrivesAt='2026-09-07T14:00:00+03:00',status='cancelled')])
  now=live.stamp(d['observedAt']);r=live.flights(json.dumps(d),self.source(),now)[0]
  self.assertEqual(r['arrivesAt']-r['departsAt'],7200000);self.assertEqual(r['status'],'cancelled');self.assertEqual(r['cost'],120)
  with self.assertRaises(ValueError):live.flights(json.dumps(d),self.source(),now+7200000)
  d['flights']*=2
  with self.assertRaises(ValueError):live.flights(json.dumps(d),self.source(),now)
 def test_sports_result_version_and_future_spoilers(self):
  d=[dict(matchID=1,matchDateTimeUTC='2026-09-07T07:00:00Z',team1={'teamName':'A'},team2={'teamName':'B'},matchIsFinished=True,matchResults=[dict(resultTypeID=2,pointsTeam1=2,pointsTeam2=1),dict(resultTypeID=1,pointsTeam1=0,pointsTeam2=0)])]
  now=live.stamp(d[0]['matchDateTimeUTC']);a=live.sports(json.dumps(d),self.source(),now)[0]
  self.assertEqual(a['score'],[2,1]);self.assertIsNone(a['placeId']);self.assertNotIn('endsAt',a)
  b=live.sports(json.dumps(d),self.source(),now-1000)[0];self.assertIsNone(b['score']);self.assertFalse(b['finished'])
  d[0]['matchResults'][0]['pointsTeam1']=3
  self.assertNotEqual(a['versionKey'],live.sports(json.dumps(d),self.source(),now)[0]['versionKey'])
 def test_invalid_payloads(self):
  for raw in ('{}','null','NaN'):
   with self.assertRaises(ValueError):live.sports(raw,self.source(),NOW)
class Services(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 c=fixtures.Ecosystem.c
 cmd=fixtures.Ecosystem.cmd
 def test_institution_and_network_commands(self):
  import copy
  p=self.s.projection(self.w);after=copy.deepcopy(p['state']);after['truth']['companion']['lifeProfile']['weeklySchedule']=[dict(id='class',days=[1],startMinute=600,endMinute=660,placeId='park',activity='Class')]
  with self.s.connect() as db:self.s.commit_event(db,self.w,p['revision'],p['state'],after,'FIXTURE_COMMITMENT')
  self.cmd('configure_institution',rule=dict(label='Local college',scheduleId='class',minimumAttendance=.8,fee=5,missedStress=2))
  self.cmd('configure_person_network',enabled=True)
  self.assertTrue(self.c()['vh2People']['network']['enabled'])
  self.assertEqual(self.c()['vh2Institutions']['rules'][0]['label'],'Local college')
  with self.assertRaises(ValueError):self.cmd('configure_person_network',enabled='yes')
  self.assertEqual(self.state(),self.s.replay(self.w))
  self.cmd('remove_institution',id=self.c()['vh2Institutions']['rules'][0]['id'])
  self.assertEqual(self.c()['vh2Institutions']['rules'],[])
 def test_sports_import_replay(self):
  self.s.command(dict(schemaVersion=1,key='sports',type='configure_world_feed',worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],kind='openliga',url='https://example.org/sports',tags=['football']))
  ident=self.c()['vh2Signals']['sources'][0]['id']
  d=[dict(matchID=1,matchDateTimeUTC='2026-09-07T07:00:00Z',team1={'teamName':'A'},team2={'teamName':'B'},matchIsFinished=False,matchResults=[])]
  self.cmd('import_world_feed',sourceId=ident,xml=json.dumps(d))
  self.assertEqual(self.c()['vh2Signals']['signals'][0]['type'],'sports_update');self.assertEqual(self.c()['vh2Signals']['known'],[]);self.assertEqual(self.state(),self.s.replay(self.w))
if __name__=='__main__':unittest.main()
