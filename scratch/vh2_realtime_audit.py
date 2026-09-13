"""Offline wire, provenance, cancellation and in-flight update acceptance."""
from test_runtime import node_executable
import sys,pathlib,unittest,copy
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import vh2_realtime as rt
import vh2_feeds,tempfile,uuid
from vh2_runtime import WorldService
NOW=1789030800000
def vi(n):
 n=n if n>=0 else (1<<64)+n;out=bytearray()
 while n>127:out.append((n&127)|128);n>>=7
 out.append(n);return bytes(out)
def f(k,v):
 if isinstance(v,str):v=v.encode()
 return vi(k*8+2)+vi(len(v))+v if isinstance(v,bytes) else vi(k*8)+vi(v)
def feed(delay=600,cancel=False,stamp=NOW,date='20260910',stops=b'',incremental=0,observed=None):
 trip=f(1,'trip')+f(3,date)+f(4,3 if cancel else 0)
 update=f(1,trip)+f(4,(observed if observed is not None else stamp)//1000)+f(5,delay)+stops
 return f(1,f(1,'2.0')+f(2,incremental)+f(3,stamp//1000))+f(2,f(1,'entity')+f(3,update))
def fixture():
 row={'id':'service','sourceId':'schedule','sourceTripId':'trip','serviceDate':'20260910','departureStopSequence':1,'arrivalStopSequence':2,'departsAt':NOW+600000,'arrivesAt':NOW+1800000,'status':'scheduled','cost':4}
 return {'vh2Transport':{'services':[row,dict(row,id='other',sourceId='unrelated')]},'lifeRuntime':{'world':{'balance':100,'journey':None}}}
SOURCE={'id':'rt','scheduleSourceId':'schedule','url':'https://example.org/rt'}
class Realtime(unittest.TestCase):
 def ingest(self,c,raw):return rt.ingest(c,dict(SOURCE),raw,NOW,NOW)
 def test_delay_does_not_accumulate_or_touch_other_sources(self):
  c=fixture();self.ingest(c,feed());self.ingest(c,feed());a,b=c['vh2Transport']['services'];self.assertEqual(a['departsAt'],NOW+1200000);self.assertEqual(b['departsAt'],NOW+600000)
 def test_signed_early_running_and_absolute_time_precedence(self):
  c=fixture();self.ingest(c,feed(-60));self.assertEqual(c['vh2Transport']['services'][0]['departsAt'],NOW+540000)
  stop=f(2,f(1,1)+f(3,f(1,120)+f(2,NOW//1000+900)));self.ingest(c,feed(stops=stop));self.assertEqual(c['vh2Transport']['services'][0]['departsAt'],NOW+900000)
 def test_cancellation_keeps_money_and_onboard_destination(self):
  c=fixture();c['lifeRuntime']['world']['journey']={'serviceId':'service','to':'away','departedAt':NOW-60000,'arrivesAt':NOW+1800000}
  self.ingest(c,feed(cancel=True));w=c['lifeRuntime']['world'];self.assertEqual(w['balance'],100);self.assertEqual(w['journey']['to'],'away');self.assertEqual(w['journey']['serviceUpdate']['status'],'cancelled')
 def test_onboard_delay_changes_arrival_without_reboarding(self):
  c=fixture();c['lifeRuntime']['world']['journey']={'serviceId':'service','to':'away','departedAt':NOW-60000,'arrivesAt':NOW+1800000}
  self.ingest(c,feed());j=c['lifeRuntime']['world']['journey'];self.assertEqual(j['arrivesAt'],NOW+2400000);self.assertEqual(j['departedAt'],NOW-60000)
 def test_wrong_date_never_applies_to_same_trip_name(self):
  c=fixture();self.ingest(c,feed(date='20260911'));self.assertEqual(c['vh2Transport']['services'][0]['departsAt'],NOW+600000)
 def test_new_header_cannot_replace_a_newer_trip_observation(self):
  c=fixture();self.ingest(c,feed(stamp=NOW+10000));self.ingest(c,feed(delay=1200,stamp=NOW+20000,observed=NOW));self.assertEqual(c['vh2Transport']['services'][0]['departsAt'],NOW+1200000)
 def test_stop_delay_propagates_and_no_data_stops_propagation(self):
  c=fixture();c['vh2Transport']['services'][0]['arrivalStopSequence']=3
  mid=f(2,f(1,2)+f(2,f(1,120)));self.ingest(c,feed(stops=mid));self.assertEqual(c['vh2Transport']['services'][0]['arrivesAt'],NOW+1920000)
  self.ingest(c,feed(stops=f(2,f(1,2)+f(5,2))));self.assertEqual(c['vh2Transport']['services'][0]['arrivesAt'],NOW+1800000)
 def test_stale_truncated_and_differential_rejected_atomically(self):
  for raw in [feed(stamp=NOW-600000),feed()[:-1],feed(incremental=1),b'\xff'*12]:
   c=fixture();before=copy.deepcopy(c)
   with self.assertRaises(ValueError):self.ingest(c,raw)
   self.assertEqual(c,before)
 def test_skipped_endpoint_prevents_boarding(self):
  c=fixture();stop=f(2,f(1,1)+f(5,1));self.ingest(c,feed(stops=stop));self.assertEqual(c['vh2Transport']['services'][0]['status'],'cancelled')
 def test_full_dataset_absence_means_no_prediction_not_on_time(self):
  c=fixture();self.ingest(c,feed());empty=f(1,f(1,'2.0')+f(3,NOW//1000));self.ingest(c,empty);s=c['vh2Transport']['services'][0];self.assertEqual(s['realtime']['status'],'no_prediction');self.assertEqual(s['departsAt'],s['scheduledTimes']['departure'])
 def test_feed_configuration_link_and_replay(self):
  root=pathlib.Path(__file__).resolve().parents[1]
  with tempfile.TemporaryDirectory() as td:
   s=WorldService(pathlib.Path(td)/'test',node_executable(root),root,clock=lambda:NOW)
   try:
    w=s.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
    def cmd(command_type,**args):return s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=command_type,worldId=w,expectedRevision=s.projection(w)['revision'],**args))
    with self.assertRaises(ValueError):cmd('configure_world_feed',kind='gtfs_rt',url='https://example.org/rt',scheduleSourceId='missing',intervalMinutes=1)
    cmd('upsert_place',place={'id':'station','label':'Station','kind':'social'})
    cmd('configure_world_feed',kind='gtfs',url='https://example.org/schedule.zip',stopMappings={'a':'home','b':'station'})
    source=s.projection(w)['state']['truth']['companion']['vh2Signals']['sources'][0]['id']
    cmd('configure_world_feed',kind='gtfs_rt',url='https://example.org/rt',scheduleSourceId=source,intervalMinutes=1)
    with self.assertRaises(ValueError):cmd('remove_world_feed',sourceId=source)
    self.assertEqual(s.projection(w)['state'],s.replay(w))
   finally:s.close()
if __name__=='__main__':unittest.main(verbosity=2)
