import json,sys,unittest,time,uuid
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_ecosystem_audit as fixtures
from virtual_humans.backend import vh2_feeds as feeds; from virtual_humans.backend import vh2_ticketmaster as tm
class Clock(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 c=fixtures.Ecosystem.c
 cmd=fixtures.Ecosystem.cmd
 def test_resume_targets_current_time_without_jumping_history(self):
  self.cmd('receive_message',text='Preserve this while paused.')
  before=self.state();now=before['simAt']+3600000;self.s.clock=lambda:now
  self.cmd('set_running',running=True);after=self.state()
  self.assertEqual(after['simAt'],before['simAt']);self.assertEqual(after['simAnchor'],now)
  self.assertEqual(after['communication'],before['communication'])
  for _ in range(30):
   self.s.tick()
   if now-self.state()['simAt']<300000:break
  self.assertLess(now-self.state()['simAt'],300000)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_restart_repairs_legacy_running_offset_once_in_background(self):
  self.cmd('set_running',running=True);initial=self.state()['simAt'];now=initial+7200000
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));after.update(wallAnchor=now,simAnchor=initial)
   self.s.commit_event(db,self.w,rev,before,after,'FIXTURE_LEGACY_RUNNING_OFFSET')
  path,node,root=self.s.path,self.s.node,self.s.app_dir;self.s.close()
  self.s=fixtures.WorldService(path,node,root,clock=lambda:now)
  before=self.state();self.s.reconcile_live_clocks();after=self.state()
  self.assertEqual(after['simAt'],initial);self.assertEqual(after['communication'],before['communication'])
  self.assertTrue(after['liveClockSync']['automatic'])
  with self.s.connect() as db:self.assertIsNotNone(db.execute('select id from kernel_checkpoints where id=?',(after['liveClockSync']['checkpointId'],)).fetchone())
  revision=self.s.projection(self.w)['revision'];self.s.reconcile_live_clocks()
  self.assertEqual(self.s.projection(self.w)['revision'],revision)
  for _ in range(30):
   self.s.tick()
   if now-self.state()['simAt']<300000:break
  self.assertLess(now-self.state()['simAt'],300000);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_background_recovery_leaves_paused_and_future_lives_unchanged(self):
  initial=self.state()['simAt'];self.s.clock=lambda:initial+7200000;before=self.state()
  self.s.tick();self.assertEqual(before,self.state())
  self.s.clock=lambda:initial-7200000;self.cmd('set_running',running=True);before=self.state()
  self.s.tick();self.assertEqual(before,self.state())
 def test_running_upgrade_and_reboot_preserve_background_catchup(self):
  self.cmd('set_running',running=True);initial=self.state()['simAt'];now=initial+7200000;self.s.clock=lambda:now
  self.s.kernel_version+='-test-upgrade';self.cmd('upgrade_kernel');after=self.state()
  self.assertTrue(after['running']);self.assertEqual(after['simAt'],initial);self.assertEqual(after['simAnchor'],now)
  self.cmd('reboot_life');after=self.state()
  self.assertTrue(after['running']);self.assertEqual(after['simAt'],initial);self.assertEqual(after['simAnchor'],now)
 def test_background_thread_catches_up_without_a_browser_or_command(self):
  self.cmd('set_running',running=True);initial=self.state()['simAt'];now=initial+3600000
  self.s.clock=lambda:now
  self.s.start();deadline=time.monotonic()+20
  while time.monotonic()<deadline and now-self.state()['simAt']>=300000:time.sleep(.1)
  self.assertLess(now-self.state()['simAt'],300000)
  self.assertEqual(self.s.last_error,'')
 def test_catchup_advances_instead_of_jumping(self):
  self.cmd('receive_message',text='Keep this history.');before=self.state();now=before['simAt']+2*3600000;self.s.clock=lambda:now
  result=self.cmd('catch_up_life');queued=self.state();self.assertEqual(queued['simAt'],before['simAt']);self.assertTrue(queued['running']);self.assertEqual(queued['simAnchor'],now);self.assertEqual(queued['communication'],before['communication'])
  for _ in range(30):
   self.s.tick()
   if now-self.state()['simAt']<300000:break
  self.assertLess(now-self.state()['simAt'],300000);self.assertEqual(self.state(),self.s.replay(self.w))
  with self.s.connect() as db:self.assertIsNotNone(db.execute('select id from kernel_checkpoints where id=?',(result['checkpointId'],)).fetchone())
 def test_eight_day_paused_catchup_checkpoints_then_replays_while_live_events_wait(self):
  self.cmd('receive_message',text='Preserve this over eight days.')
  self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type='configure_world_feed',worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],kind='ticketmaster',city='Los Angeles',countryCode='US',intervalMinutes=360))
  tm.settings(self.s,dict(scope='horde:alex',enabled=True,apiKey='FIXTURE',dailyLimit=5))
  before=self.state();now=before['simAt']+12090*60000;self.s.clock=lambda:now
  result=self.cmd('catch_up_life');queued=self.state()
  self.assertEqual(queued['simAt'],before['simAt'],'catch-up must not silently skip eight days of life')
  self.assertEqual(queued['communication'],before['communication'])
  self.assertTrue(queued['running'],'catch-up must resume a paused life')
  self.assertEqual(queued['simAnchor'],now)
  with self.s.connect() as db:self.assertIsNotNone(db.execute('select id from kernel_checkpoints where id=?',(result['checkpointId'],)).fetchone())
  with patch.object(tm,'fetch') as fetch:
   feeds.poll(self.s)
   fetch.assert_not_called()
  self.assertEqual(self.c()['vh2Signals']['sources'][0]['errorCode'],'timeline_not_live')
  errors=self.s.tick();advanced=self.state()
  self.assertEqual(errors,[])
  self.assertGreater(advanced['simAt'],before['simAt'])
  self.assertLessEqual(advanced['simAt']-before['simAt'],60*60000,'one tick must replay a bounded batch')
  self.assertGreater(now-advanced['simAt'],300000)
  self.assertEqual(advanced,self.s.replay(self.w))
  # Model the end of many subsequent batches without making CI replay 201 hours.
  with self.s.connect() as db:
   db.execute('BEGIN IMMEDIATE');rev,current=self.s.read(db,self.w);near=json.loads(json.dumps(current));near['simAt']=now-4*60000
   self.s.commit_event(db,self.w,rev,current,near,'FIXTURE_CLOCK_NEAR_REAL_TIME')
  with patch.object(tm,'fetch',side_effect=lambda config,source,at:(json.dumps({'page':{'number':0,'totalElements':0}}),config['version'])) as fetch:
   feeds.poll(self.s)
   for _ in range(50):
    if all(f.done() for f,u in self.s._feed_pending.values()):break
    time.sleep(.01)
   feeds.poll(self.s)
   self.assertEqual(fetch.call_count,1,'the feed should retry promptly once the clock is live')
  self.assertEqual(self.c()['vh2Signals']['sources'][0]['errorCode'],'')
 def test_explicit_catchup_on_running_life_keeps_history_and_retargets_wall_clock(self):
  self.cmd('set_running',running=True)
  before=self.state();now=before['simAt']+12090*60000;self.s.clock=lambda:now
  result=self.cmd('catch_up_life');after=self.state()
  self.assertTrue(after['running'])
  self.assertEqual(after['simAt'],before['simAt'])
  self.assertEqual(after['simAnchor'],now)
  self.assertEqual(after['communication'],before['communication'])
  self.assertFalse(after['liveClockSync']['automatic'])
  with self.s.connect() as db:self.assertIsNotNone(db.execute('select id from kernel_checkpoints where id=?',(result['checkpointId'],)).fetchone())
  self.assertEqual(after,self.s.replay(self.w))
 def test_future_timeline_is_not_rewound(self):
  with self.s.connect() as db:checkpoints=db.execute('select count(*) from kernel_checkpoints').fetchone()[0]
  self.s.clock=lambda:self.state()['simAt']-3600000
  with self.assertRaises(ValueError):self.cmd('catch_up_life')
  with self.s.connect() as db:self.assertEqual(db.execute('select count(*) from kernel_checkpoints').fetchone()[0],checkpoints)
 def test_feed_retries_after_catching_up_without_six_hour_delay(self):
  self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type='configure_world_feed',worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],kind='ticketmaster',city='Los Angeles',countryCode='US',intervalMinutes=360))
  tm.settings(self.s,dict(scope='horde:alex',enabled=True,apiKey='FIXTURE',dailyLimit=5));self.cmd('set_running',running=True);initial=self.state()['simAt'];self.s.clock=lambda:initial+3600000
  with patch.object(tm,'fetch') as fetch:feeds.poll(self.s);fetch.assert_not_called()
  self.assertEqual(self.c()['vh2Signals']['sources'][0]['errorCode'],'timeline_not_live')
  # Simulate completed catchup; the wall-clock attempt timestamp stays recent.
  with self.s.connect() as db:
   db.execute('BEGIN IMMEDIATE');rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));after['simAt']=self.s.clock();self.s.commit_event(db,self.w,rev,before,after,'FIXTURE_CLOCK_ADVANCED')
  with patch.object(tm,'fetch',side_effect=lambda config,source,now:(json.dumps({'page':{'number':0,'totalElements':0}}),config['version'])) as fetch:
   feeds.poll(self.s)
   for _ in range(50):
    if all(f.done() for f,u in self.s._feed_pending.values()):break
    time.sleep(.01)
   feeds.poll(self.s);self.assertEqual(fetch.call_count,1)
  self.assertEqual(self.c()['vh2Signals']['sources'][0]['error'],'');self.assertEqual(self.c()['vh2Signals']['sources'][0]['errorCode'],'')
if __name__=='__main__':unittest.main()
