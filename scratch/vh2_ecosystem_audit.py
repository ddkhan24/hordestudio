"""Offline service acceptance for feeds, exploration and reviewed asset snapshots."""
from test_runtime import node_executable
import json,sys,tempfile,unittest,uuid,platform,shutil
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService
import vh2_feeds,vh2_assets
ROOT=Path(__file__).resolve().parents[1]
NODE=node_executable(ROOT)
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
XML='<rss><channel><item><guid>abc</guid><title>Local exhibition announced</title></item></channel></rss>'
class Ecosystem(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=WorldService(Path(self.tmp.name)/'test.sqlite',NODE,ROOT,clock=lambda:1788764400000)
  p={'age':28,'lifeProfile':{'places':[{'id':'home','kind':'home','label':'Home'},{'id':'park','kind':'social','label':'Park'}],'weeklySchedule':[],'sleepPolicy':{'enabled':False},'travelLegs':[{'from':'home','to':'park','mode':'WALK','minutes':10,'cost':0},{'from':'park','to':'home','mode':'WALK','minutes':10,'cost':0}],'world':{'transport':{'enabled':True}}}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=p,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def c(self):return self.state()['truth']['companion']
 def cmd(self,kind,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw))
 def feed(self):
  self.cmd('configure_world_feed',url='https://example.org/feed',placeId='park',tags=['art']);return self.c()['vh2Signals']['sources'][0]['id']
 def test_feed_dedup_provenance_and_xml_safety(self):
  ident=self.feed();self.cmd('import_world_feed',sourceId=ident,xml=XML);self.cmd('import_world_feed',sourceId=ident,xml=XML)
  r=self.c()['vh2Signals'];self.assertEqual(len(r['signals']),1);self.assertEqual(r['known'],[]);self.assertEqual(r['signals'][0]['scope'],'publisher_claim');self.assertNotIn('startsAt',r['signals'][0])
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('import_world_feed',sourceId=ident,xml='<!DOCTYPE x [<!ENTITY y "hi">]><rss/>')
  self.assertEqual(before,self.state());self.assertEqual(before,self.s.replay(self.w))
  with self.assertRaises(ValueError):vh2_feeds.url_parts('http://127.0.0.1/feed')
  with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
   with self.assertRaises(ValueError):vh2_feeds.PublicConnection('example.org').connect()
 def test_feed_freshness_and_atom(self):
  source={'id':'x','url':'https://example.org/rss','freshHours':24,'tags':[]}
  self.assertEqual(vh2_feeds.parse('<rss><channel><item><title>old</title><pubDate>Mon, 01 Jan 2000 00:00:00 GMT</pubDate></item></channel></rss>',source,1788764400000),[])
  atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>one</id><title>News</title></entry></feed>'
  self.assertEqual(vh2_feeds.parse(atom,source,1788764400000)[0]['title'],'News')
  dated='<rss><channel><item><title>Recent</title><pubDate>Mon, 07 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>'
  row=vh2_feeds.parse(dated,source,1788764400000)[0];self.assertEqual(row['expiresAt'],row['publishedAt']+86400000)
 def test_asset_approval_frozen_lineage_and_replay(self):
  self.cmd('add_bible_asset',role='identity',entityId=self.c()['id'],label='Front face',tags=['face'],image=PNG)
  entry=self.c()['vh2Assets']['entries'][0];self.assertEqual(entry['status'],'pending')
  shot={'companion':self.c(),'photoContext':{'placeId':'home','garmentIds':[],'withNames':[]},'captureType':'front_camera_selfie'}
  self.assertEqual(vh2_assets.freeze(shot),[])
  self.cmd('review_bible_asset',entryId=entry['id'],status='approved');self.cmd('capture_photo',scene='At home',captureType='front_camera_selfie',destination='gallery')
  pid=self.state()['photos'][-1]['id']
  with self.s.connect() as db:before=json.loads(db.execute('SELECT snapshot FROM photo_jobs WHERE id=?',(pid,)).fetchone()[0])
  self.assertEqual(before['referenceAssets'][0]['id'],entry['id']);self.cmd('archive_bible_asset',entryId=entry['id'])
  with self.s.connect() as db:self.assertEqual(before,json.loads(db.execute('SELECT snapshot FROM photo_jobs WHERE id=?',(pid,)).fetchone()[0]))
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_background_refresh_result_and_reference_generation(self):
  from concurrent.futures import Future
  ident=self.feed();self.cmd('set_running',running=True)
  future=Future();future.set_result(XML.encode());self.s._feed_pending={(self.w,ident):(future,'https://example.org/feed')}
  with patch.object(vh2_feeds,'fetch',side_effect=AssertionError('No live fetch in offline test')):vh2_feeds.poll(self.s)
  self.assertEqual(self.c()['vh2Signals']['sources'][0]['itemCount'],1);self.assertEqual(self.c()['vh2Signals']['known'],[])
  self.cmd('set_running',running=False)
  self.cmd('add_bible_asset',role='identity',entityId=self.c()['id'],label='Seed',tags=['face'],image=PNG)
  seed=self.c()['vh2Assets']['entries'][0];self.cmd('review_bible_asset',entryId=seed['id'],status='approved')
  self.cmd('capture_reference',view='profile');photo=self.state()['photos'][-1];self.assertEqual(photo['destination'],'reference');self.assertEqual(photo['photoContext']['referenceStudy'],'profile')
  self.cmd('submit_photo',photoId=photo['id'],manifest={});self.cmd('import_photo',photoId=photo['id'],image=PNG)
  self.cmd('add_bible_asset',role='identity',entityId=self.c()['id'],label='Generated profile',tags=['profile'],photoId=photo['id'])
  entry=self.c()['vh2Assets']['entries'][-1];self.assertEqual(entry['status'],'pending');self.assertEqual(entry['parents'],[seed['id']])
  from vh2_runtime import Conflict
  with self.assertRaises(Conflict):self.cmd('publish_photo',photoId=photo['id'],caption='wrong')
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_contextual_reference_selection(self):
  c=self.c();c['vh2Assets']={'entries':[dict(id=str(i),assetId='asset'+str(i),role='identity',entityId=c['id'],label='View',tags=tags,status='approved',version=1) for i,tags in enumerate([['face'],['face'],['full_body']])]}
  c['vh2Assets']['entries'].append(dict(id='other-place',assetId='room',role='place',entityId='park',label='Park',tags=[],status='approved',version=1))
  snapshot={'companion':c,'photoContext':{'placeId':'home','garmentIds':[],'personIds':[]},'captureType':'mirror_selfie'}
  selected=vh2_assets.freeze(snapshot);self.assertIn('2',[r['id'] for r in selected]);self.assertNotIn('other-place',[r['id'] for r in selected]);self.assertEqual(len(selected),2)
 def test_wrong_asset_owner_and_policy_validation(self):
  with self.assertRaises(ValueError):self.cmd('add_bible_asset',role='place',entityId='unknown',label='Room',tags=[],image=PNG)
  policy=self.c()['vh2Exploration']['policy'];self.cmd('configure_exploration',policy={**policy,'enabled':True,'threshold':-100,'minEnergy':0,'maxHunger':100,'maxStress':100})
  with self.assertRaises(ValueError):self.cmd('configure_exploration',policy={**policy,'curiosity':float('inf')})
  for _ in range(15):self.cmd('advance',steps=1)
  self.assertTrue(self.c()['vh2Geography']['enabled']);self.assertTrue(any(g['id'].startswith('geo:') for g in self.c()['lifeRuntime']['activities']['goals']));self.assertFalse(any(t.get('origin')=='autonomous' for t in self.c().get('vh2Travel',{}).get('trips',[])));self.assertEqual(self.state(),self.s.replay(self.w))
if __name__=='__main__':unittest.main(verbosity=2)
