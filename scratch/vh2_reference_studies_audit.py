"""Role-specific production studies cannot contaminate identity or lived media."""
from test_runtime import node_executable
import sys,tempfile,unittest,uuid,json,base64,struct,zlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from virtual_humans.backend.vh2_runtime import WorldService
from virtual_humans.backend import vh2_workers
ROOT=Path(__file__).resolve().parents[1]
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
_png=base64.b64decode(PNG.split(',')[1]);_note=b'variant';_tag=b'tEXt'+_note;_chunk=struct.pack('>I',len(_note))+_tag+struct.pack('>I',zlib.crc32(_tag)&0xffffffff)
PNG2='data:image/png;base64,'+base64.b64encode(_png[:-12]+_chunk+_png[-12:]).decode()
class Studies(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=WorldService(Path(self.tmp.name)/'x.sqlite',node_executable(ROOT),ROOT,clock=lambda:1789030800000);self.w=self.s.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw))
 def test_room_study_uses_only_room_refs_and_cannot_post(self):
  c=self.state()['truth']['companion'];place=c['lifeProfile']['places'][0]['id']
  self.cmd('add_bible_asset',role='identity',entityId=c['id'],label='Face',tags=['face'],image=PNG);entry=self.state()['truth']['companion']['vh2Assets']['entries'][0];self.cmd('review_bible_asset',entryId=entry['id'],status='approved')
  pid=self.cmd('capture_reference',role='place',entityId=place,view='establishing',description='Blue walls, a wooden table and a window to the left.')['photoId']
  with self.s.connect() as db:
   snap=json.loads(db.execute('SELECT snapshot FROM photo_jobs WHERE id=?',(pid,)).fetchone()[0]);self.assertEqual(snap['referenceAssets'],[]);req,_,_=vh2_workers.compile_image(db,self.w,self.state(),snap,{'model':'fixture','maxReferences':10});self.assertEqual(req['input_references'],[]);self.assertIn('Blue walls',req['prompt']);self.assertNotIn('Personal photograph of',req['prompt'])
  self.cmd('submit_photo',photoId=pid);self.cmd('import_photo',photoId=pid,image=PNG)
  with self.assertRaises(ValueError):self.cmd('publish_photo',photoId=pid)
  self.cmd('add_bible_asset',role='place',entityId=place,label='Room study',tags=['establishing'],photoId=pid)
  entries=self.state()['truth']['companion']['vh2Assets']['entries'];self.assertEqual(entries[-1]['status'],'pending');self.assertEqual(entries[-1]['entityId'],place);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_wrong_link_and_unsupported_view_rejected(self):
  with self.assertRaises(ValueError):self.cmd('capture_reference',role='place',entityId='missing',view='establishing')
  with self.assertRaises(ValueError):self.cmd('capture_reference',role='pose',entityId='pose',view='portrait')
 def test_pose_requires_no_character_reference(self):
  pid=self.cmd('capture_reference',role='pose',entityId='pose',view='mirror_selfie',description='Relaxed standing pose with phone in right hand.')['photoId']
  with self.s.connect() as db:
   snap=json.loads(db.execute('SELECT snapshot FROM photo_jobs WHERE id=?',(pid,)).fetchone()[0]);req,_,_=vh2_workers.compile_image(db,self.w,self.state(),snap,{'model':'fixture','maxReferences':10});self.assertIn('mannequin',req['prompt']);self.assertEqual(req['input_references'],[])
 def test_browser_render_records_only_references_actually_attached(self):
  person=self.state()['truth']['companion'];owner=person['id']
  for label,image in (('Face front',PNG),('Face profile',PNG2)):
   self.cmd('add_bible_asset',role='identity',entityId=owner,label=label,tags=['face'],image=image)
   entry=self.state()['truth']['companion']['vh2Assets']['entries'][-1]
   self.cmd('review_bible_asset',entryId=entry['id'],status='approved')
  pid=self.cmd('capture_reference',role='identity',entityId=owner,view='full_body')['photoId']
  selected=self.state()['photos'][-1]['photoContext']['referenceAssetIds']
  self.assertEqual(len(selected),2)
  with self.assertRaises(ValueError):self.cmd('submit_photo',photoId=pid,manifest={'usedReferenceAssetIds':['not-selected']})
  self.cmd('submit_photo',photoId=pid,manifest={'usedReferenceAssetIds':selected[:1]})
  recorded=self.state()['photos'][-1]['photoContext']['referenceAssetIds']
  self.assertEqual(recorded,selected[:1]);self.assertEqual(self.state(),self.s.replay(self.w))
if __name__=='__main__':unittest.main(verbosity=2)
