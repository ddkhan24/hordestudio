import sys,pathlib,unittest,json,uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import vh2_ecosystem_audit as fixtures
class Starter(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 cmd=fixtures.Ecosystem.cmd
 def test_import_replay_dedup_preserves_interactions(self):
  before=self.state();r=self.cmd('import_starter_post',sourceId='seed1',caption='A previous day',ageDays=2);post=self.state()['social']['posts'][0]
  self.assertEqual(post['origin'],'authored_starter');self.assertIsNone(post['assetId']);self.assertEqual(self.state()['communication'],before['communication'])
  self.cmd('like_post',postId=r['postId'],liked=True);self.cmd('import_starter_post',sourceId='seed1',caption='Changed draft',ageDays=3)
  self.assertEqual(len(self.state()['social']['posts']),1);self.assertTrue(self.state()['social']['posts'][0]['likedByPlayer']);self.assertEqual(self.state()['social']['posts'][0]['caption'],'Changed draft');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_merged_world_source_identity_updates_in_place(self):
  r=self.cmd('import_starter_post',sourceId='seed1',caption='Original',ageDays=2);old=self.state()['social']['posts'][0]
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));after['social']['posts'][0]['id']='retained-from-original-world';after['social']['posts'][0]['sourceId']='moved-seed';self.s.commit_event(db,self.w,rev,before,after,'FIXTURE_MERGED_LIFE')
  result=self.cmd('import_starter_post',sourceId='moved-seed',caption='Updated caption',ageDays=2)
  self.assertEqual(result['postId'],'retained-from-original-world');self.assertEqual(len([p for p in self.state()['social']['posts'] if p.get('sourceId')=='moved-seed']),1)
 def test_existing_duplicates_merge_comments_likes_and_redirect_old_links(self):
  r=self.cmd('import_starter_post',sourceId='same-seed',caption='A day out',ageDays=2)
  self.cmd('comment_post',postId=r['postId'],text='Original comment')
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));duplicate=json.loads(json.dumps(after['social']['posts'][0]));duplicate.update(id='old-world-duplicate',likedByPlayer=True,likedAt=after['simAt'])
   duplicate['comments'].append({'id':'second-comment','authorId':'player:alex','createdAt':after['simAt']+1,'text':'Another comment'})
   after['social']['posts'].append(duplicate);self.s.commit_event(db,self.w,rev,before,after,'FIXTURE_DUPLICATED_IMPORT')
  self.cmd('import_starter_post',sourceId='same-seed',caption='Updated day out',ageDays=2)
  visible=[p for p in self.state()['social']['posts'] if p['status']=='published'];self.assertEqual(len(visible),1);self.assertTrue(visible[0]['likedByPlayer']);self.assertEqual(len(visible[0]['comments']),2)
  self.cmd('comment_post',postId='old-world-duplicate',text='Old link still works')
  visible=[p for p in self.state()['social']['posts'] if p['status']=='published'];self.assertEqual(len(visible[0]['comments']),3);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_withdrawn_starter_is_not_republished_on_update(self):
  r=self.cmd('import_starter_post',sourceId='withdrawn',caption='Original',ageDays=1);self.cmd('withdraw_post',postId=r['postId'])
  self.cmd('import_starter_post',sourceId='withdrawn',caption='Revised',ageDays=1);self.assertEqual(self.state()['social']['posts'][0]['status'],'withdrawn')
 def test_identical_image_import_reuses_asset_and_date(self):
  from vh2_workers_audit import PNG
  self.cmd('import_starter_post',sourceId='image',caption='Original',ageDays=1,image=PNG);before=self.state()['social']['posts'][0]
  self.cmd('import_starter_post',sourceId='image',caption='Revised',ageDays=1,image=PNG);after=self.state()['social']['posts'][0]
  self.assertEqual(before['assetId'],after['assetId']);self.assertEqual(before['publishedAt'],after['publishedAt'])
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM photo_assets').fetchone()[0],1)
 def test_bad_image_rolls_back(self):
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('import_starter_post',sourceId='bad',caption='Photo',image='not an image')
  self.assertEqual(self.state(),before)
 def test_gallery_import_is_private_idempotent_and_publishable(self):
  from vh2_workers_audit import PNG
  before=self.state()['communication']
  self.cmd('import_starter_gallery',sourceId='saved-photo',caption='A previous afternoon',ageDays=3,image=PNG)
  photo=self.state()['photos'][-1]
  self.assertEqual(self.state()['social']['posts'],[]);self.assertEqual(self.state()['communication'],before)
  self.cmd('import_starter_gallery',sourceId='saved-photo',caption='Updated caption',ageDays=3,image=PNG)
  self.assertEqual(len(self.state()['photos']),1);self.assertEqual(self.state()['photos'][0]['assetId'],photo['assetId'])
  self.assertEqual(self.state()['photos'][0]['at'],photo['at'])
  self.cmd('publish_photo',photoId=photo['id'],caption='Sharing this memory')
  post=self.state()['social']['posts'][0]
  self.assertEqual(post['assetId'],photo['assetId']);self.assertEqual(post['capturedAt'],photo['at'])
  self.assertEqual(post['captureContext'],{'origin':'authored_starter'});self.assertEqual(self.state(),self.s.replay(self.w))
 def test_gallery_bad_image_rolls_back(self):
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('import_starter_gallery',sourceId='bad-gallery',caption='A photo',image='not an image')
  self.assertEqual(self.state(),before)
if __name__=='__main__':unittest.main()
