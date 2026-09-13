"""Offline durable photo captures, asset imports and replay."""
from test_runtime import node_executable
import sys,tempfile,unittest,uuid,json,sqlite3
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
class Media(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.now=1788764400000;self.s=self.open();self.w=self.s.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:self.now)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def cmd(self,kind,**kw):
  body=dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw);return body,self.s.command(body)
 def state(self):return self.s.projection(self.w)['state']
 def capture(self):return self.cmd('capture_photo',scene='A relaxed close-up',captureType='front_camera_selfie')[1]['photoId']
 def test_snapshot_and_import_survive_time_restart_replay(self):
  pid=self.capture();snapshot=self.state()['photos'][0]['photoContext'];self.cmd('submit_photo',photoId=pid)
  self.cmd('advance',steps=3)
  body,result=self.cmd('import_photo',photoId=pid,image=PNG);self.assertEqual(result,self.s.command(body))
  state=self.state();self.assertEqual(state['photos'][0]['photoContext'],snapshot)
  self.assertEqual(state['communication']['messages'][-1]['capturedAt'],snapshot['atMs'])
  self.assertGreater(state['communication']['messages'][-1]['timestamp'],snapshot['atMs'])
  self.assertEqual(state,self.s.replay(self.w));self.assertEqual(len(self.s.context(self.w)['sharedPhotos']),1)
  self.s.close();self.s=self.open();self.assertEqual(state,self.state())
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM photo_assets').fetchone()[0],1)
 def test_no_double_submission_or_import(self):
  pid=self.capture();self.cmd('submit_photo',photoId=pid)
  with self.assertRaises(Conflict):self.cmd('submit_photo',photoId=pid)
  self.cmd('import_photo',photoId=pid,image=PNG)
  with self.assertRaises(Conflict):self.cmd('import_photo',photoId=pid,image=PNG)
  self.assertEqual(len(self.state()['communication']['messages']),1)
 def test_invalid_input_and_abandonment(self):
  with self.assertRaises(ValueError):self.cmd('capture_photo',scene='test',captureType='taken_by_someone')
  pid=self.capture();self.cmd('submit_photo',photoId=pid)
  with self.assertRaises(ValueError):self.cmd('import_photo',photoId=pid,image='https://example.com/image.png')
  self.assertEqual(self.state()['photos'][0]['status'],'submitted')
  self.cmd('abandon_photo',photoId=pid)
  with self.assertRaises(Conflict):self.cmd('import_photo',photoId=pid,image=PNG)
  self.assertEqual(self.state()['photos'][0]['status'],'abandoned')
 def test_snapshot_immutable_and_asset_commit_atomic(self):
  pid=self.capture();self.cmd('submit_photo',photoId=pid)
  with self.s.connect() as db:
   with self.assertRaises(sqlite3.IntegrityError):db.execute('UPDATE photo_jobs SET snapshot=? WHERE id=?',('{}',pid))
  original=self.s.commit_event
  def fail(*args,**kw):raise RuntimeError('transaction failed')
  self.s.commit_event=fail
  with self.assertRaises(RuntimeError):self.cmd('import_photo',photoId=pid,image=PNG)
  self.s.commit_event=original
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM photo_assets').fetchone()[0],0)
  self.assertEqual(self.state()['photos'][0]['status'],'submitted')
 def test_version_six_upgrade_preserves_world(self):
  before=self.state();self.s.close()
  with self.s.connect() as db:
   db.execute('DROP TABLE photo_jobs');db.execute('DROP TABLE photo_assets');db.execute('PRAGMA user_version=6')
  self.s=self.open();self.assertEqual(before,self.state())
  with self.s.connect() as db:self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],9)
  self.capture()
 def test_cannot_capture_while_asleep(self):
  with self.s.connect() as db:
   revision,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));c=after['truth']['companion'];c['humanDynamics']['sleep']={'stage':'asleep','lastAt':after['simAt'],'sleepStartedAt':after['simAt'],'wakeAt':after['simAt']+3600000}
   self.s.commit_event(db,self.w,revision,before,after,'FIXTURE_SLEEP')
  with self.assertRaises(Conflict):self.capture()
if __name__=='__main__':unittest.main(verbosity=2)
