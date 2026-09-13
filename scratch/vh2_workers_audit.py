"""Offline durable provider jobs: references, once-only import, restart and routes."""
from test_runtime import node_executable
import json,sys,tempfile,time,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
from vh2_provider import UnknownOutcome
import vh2_workers,vh2_backup
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
ROOT=Path(__file__).resolve().parents[1]
class Workers(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open();p={'age':28,'lifeProfile':{'places':[{'id':'home','kind':'home','label':'Home','mapCoordinates':[-1,51]},{'id':'park','kind':'social','label':'Park','mapCoordinates':[-1.1,51.1]}],'weeklySchedule':[],'sleepPolicy':{'enabled':False},'world':{'transport':{'enabled':True,'liveRouting':True}},'travelLegs':[{'from':'home','to':'park','mode':'WALK','minutes':30,'cost':0}]}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=p,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw))
 def prepare(self):
  self.cmd('add_bible_asset',role='identity',entityId=self.state()['truth']['companion']['id'],label='Seed',tags=['face'],image=PNG)
  entry=self.state()['truth']['companion']['vh2Assets']['entries'][0];self.cmd('review_bible_asset',entryId=entry['id'],status='approved')
  self.cmd('capture_photo',scene='At home',destination='gallery');photo=self.state()['photos'][-1]['id'];vh2_workers.settings(self.s,dict(scope='horde:alex',enabled=True,model='fixture/image',apiKey='PRIVATE_FIXTURE_KEY',dailyLimit=2,maxReferences=10));return photo
 def finish(self):
  for _ in range(100):
   vh2_workers.poll(self.s)
   if vh2_workers.status(self.s,self.w)[0]['status'] in ('succeeded','failed','unknown'):return
   time.sleep(.005)
  self.fail('Job did not settle')
 def test_image_once_refs_import_and_secret_free_backup(self):
  photo=self.prepare();calls=[]
  def render(config,key,body):calls.append(body);self.assertEqual(key,'PRIVATE_FIXTURE_KEY');self.assertEqual(body['input_references'][0]['image_url']['url'],PNG);return PNG
  self.s.image_executor=render;self.cmd('queue_photo_render',photoId=photo);self.finish();self.assertEqual(len(calls),1);self.assertEqual(self.state()['photos'][-1]['status'],'stored');self.assertEqual(vh2_workers.status(self.s,self.w)[0]['status'],'succeeded')
  with self.assertRaises(Conflict):self.cmd('queue_photo_render',photoId=photo)
  self.assertEqual(self.state(),self.s.replay(self.w));import gzip;self.assertNotIn(b'PRIVATE_FIXTURE_KEY',gzip.decompress(vh2_backup.export(self.s,self.w)))
 def test_unknown_is_never_resubmitted_after_restart(self):
  photo=self.prepare();self.s.image_executor=lambda *args:(_ for _ in ()).throw(UnknownOutcome('Unknown'));self.cmd('queue_photo_render',photoId=photo);self.finish();self.assertEqual(vh2_workers.status(self.s,self.w)[0]['status'],'unknown');self.s.close();self.s=self.open();self.s.image_executor=lambda *args:self.fail('Must not resubmit');vh2_workers.poll(self.s);self.assertEqual(self.state()['photos'][-1]['status'],'submitted')
 def test_paused_manual_job_runs_in_background_loop(self):
  photo=self.prepare();self.s.image_executor=lambda *args:PNG;self.cmd('queue_photo_render',photoId=photo);self.s.start()
  deadline=time.monotonic()+13
  while time.monotonic()<deadline:
   if vh2_workers.status(self.s,self.w)[0]['status']=='succeeded':break
   time.sleep(.1)
  self.assertEqual(vh2_workers.status(self.s,self.w)[0]['status'],'succeeded',self.s.last_error)
 def test_backup_does_not_resubmit_pending_image(self):
  photo=self.prepare();self.cmd('queue_photo_render',photoId=photo)
  dest=WorldService(Path(self.tmp.name)/'restored.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
  try:
   vh2_backup.restore(dest,vh2_backup.export(self.s,self.w));dest.image_executor=lambda *args:self.fail('Restored work must not submit');vh2_workers.poll(dest)
   self.assertEqual(vh2_workers.status(dest,self.w)[0]['status'],'unknown');self.assertFalse(vh2_workers.settings(dest,scope='horde:alex')['hasKey'])
  finally:dest.close()
 def test_native_image_contract_without_network(self):
  from unittest.mock import patch,MagicMock
  response=MagicMock();response.__enter__.return_value.read.return_value=json.dumps({'data':[{'b64_json':PNG.split(',')[1],'media_type':'image/png'}]}).encode()
  opener=MagicMock();opener.open.return_value=response
  with patch('vh2_workers.urllib.request.build_opener',return_value=opener):
   self.assertEqual(vh2_workers.image_transport({'baseUrl':'https://openrouter.ai/api/v1'},'FIXTURE',{'model':'fixture/image','prompt':'Test','n':1}),PNG)
  self.assertEqual(opener.open.call_args[0][0].full_url,'https://openrouter.ai/api/v1/images')
 def test_route_resolves_existing_journey(self):
  self.cmd('plan_trip',label='Walk',stops=[{'placeId':'park','stayMinutes':30}]);self.cmd('advance',steps=1);self.cmd('set_running',running=True)
  self.s.route_executor=lambda body:{'provider':'fixture','routes':[{'duration':'2400s','geometry':{'type':'LineString','coordinates':[[-1,51],[-1.1,51.1]]}}]}
  self.finish();j=self.state()['truth']['companion']['lifeRuntime']['world']['journey'];self.assertEqual(j['routeStatus'],'live');self.assertEqual(j['arrivesAt']-j['departedAt'],2400000);self.assertEqual(self.state(),self.s.replay(self.w))
if __name__=='__main__':unittest.main(verbosity=2)
