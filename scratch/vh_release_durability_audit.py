"""Provider-free fault injection at the durable submission/result boundary."""
import json,sqlite3,unittest
from concurrent.futures import Future
from contextlib import contextmanager
from unittest.mock import patch
import vh2_workers_audit as image_fixtures
import vh2_social_worker_audit as social_fixtures
import vh2_life_adviser_audit as adviser_fixtures
from virtual_humans.backend import vh2_workers, vh2_social_worker, vh2_story

@contextmanager
def failed_commit(service):
 original=service.connect
 @contextmanager
 def connect():
  with original() as db:
   yield db
   raise sqlite3.OperationalError('Injected result commit failure')
 with patch.object(service,'connect',connect):yield

@contextmanager
def failed_statement(service,match):
 original=service.connect
 class Connection:
  def __init__(self,db):self.db=db
  def __getattr__(self,key):return getattr(self.db,key)
  def execute(self,sql,*args):
   if match in sql:raise sqlite3.OperationalError('Injected SQLite statement failure')
   return self.db.execute(sql,*args)
 @contextmanager
 def connect():
  with original() as db:yield Connection(db)
 with patch.object(service,'connect',connect):yield

class ImageDurability(unittest.TestCase):
 setUp=image_fixtures.Workers.setUp
 tearDown=image_fixtures.Workers.tearDown
 open=image_fixtures.Workers.open
 state=image_fixtures.Workers.state
 cmd=image_fixtures.Workers.cmd
 prepare=image_fixtures.Workers.prepare
 finish=image_fixtures.Workers.finish
 def test_completed_image_survives_result_commit_failure_without_resubmission(self):
  photo=self.prepare();calls=[]
  self.s.image_executor=lambda *args:(calls.append(1) or image_fixtures.PNG)
  self.cmd('queue_photo_render',photoId=photo);vh2_workers.poll(self.s)
  ident='image:'+photo;self.s._worker_pending[ident].result(timeout=3)
  with failed_commit(self.s),self.assertRaises(sqlite3.OperationalError):vh2_workers.poll(self.s)
  self.assertIn(ident,self.s._worker_pending,'completed paid output must remain recoverable until its result commits')
  self.assertEqual(vh2_workers.status(self.s,self.w)[0]['status'],'submitted')
  self.finish();self.assertEqual(calls,[1]);self.assertEqual(self.state()['photos'][-1]['status'],'stored')
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_completed_image_survives_storage_statement_failure(self):
  photo=self.prepare();calls=[];self.s.image_executor=lambda *args:(calls.append(1) or image_fixtures.PNG)
  self.cmd('queue_photo_render',photoId=photo);vh2_workers.poll(self.s)
  ident='image:'+photo;self.s._worker_pending[ident].result(timeout=3)
  with failed_statement(self.s,'INSERT OR REPLACE INTO vh2_provider_outputs'),self.assertRaises(sqlite3.OperationalError):vh2_workers.poll(self.s)
  self.assertIn(ident,self.s._worker_pending);self.assertEqual(vh2_workers.status(self.s,self.w)[0]['status'],'submitted')
  self.finish();self.assertEqual(calls,[1]);self.assertEqual(self.state()['photos'][-1]['status'],'stored')

class SocialDurability(unittest.TestCase):
 setUp=social_fixtures.SocialWorker.setUp
 tearDown=social_fixtures.SocialWorker.tearDown
 state=social_fixtures.SocialWorker.state
 cmd=social_fixtures.SocialWorker.cmd
 seed=social_fixtures.SocialWorker.seed
 def prepare(self):
  self.seed();self.s.dialogue_provider.save(dict(scope='horde:alex',baseUrl='https://example.invalid/v1',model='fixture',apiKey='fixture',enabled=True,maxTokens=512,temperature=.7))
 def test_no_provider_call_precedes_durable_submission_receipt(self):
  self.prepare();calls=[];owner=self;read=self.s.connect
  class Pool:
   def submit(pool,callback,*args):
    with read() as db:
     row=db.execute("SELECT status FROM vh2_social_jobs WHERE world_id=?",(owner.w,)).fetchone()
    calls.append(row['status'] if row else None)
    future=Future();future.set_result({'decision':'post','caption':'a grounded moment'});return future
   def shutdown(pool,**kwargs):pass
  self.s._social_pending={};self.s._social_pool=Pool()
  with failed_commit(self.s),self.assertRaises(sqlite3.OperationalError):vh2_social_worker.poll(self.s)
  self.assertEqual(calls,[],'a rolled-back receipt must never start a paid request')
  self.assertEqual(self.s._social_pending,{})
  vh2_social_worker.poll(self.s);self.assertEqual(calls,['submitted'])
  vh2_social_worker.poll(self.s);self.assertEqual(calls,['submitted'])
  self.assertTrue(self.state()['social']['posts'][0]['captionReady'])
 def test_completed_social_result_survives_commit_failure(self):
  self.prepare();calls=[]
  self.s.social_executor=lambda *args:(calls.append(1) or {'decision':'post','caption':'a grounded moment'})
  vh2_social_worker.poll(self.s)
  ident=next(iter(self.s._social_pending));self.s._social_pending[ident][0].result(timeout=3)
  with failed_commit(self.s),self.assertRaises(sqlite3.OperationalError):vh2_social_worker.poll(self.s)
  self.assertIn(ident,self.s._social_pending)
  vh2_social_worker.poll(self.s);self.assertEqual(calls,[1]);self.assertTrue(self.state()['social']['posts'][0]['captionReady'])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_social_storage_failure_is_retried_as_storage_without_rebilling(self):
  self.prepare();calls=[];self.s.social_executor=lambda *args:(calls.append(1) or {'decision':'post','caption':'a grounded moment'})
  vh2_social_worker.poll(self.s);ident=next(iter(self.s._social_pending));self.s._social_pending[ident][0].result(timeout=3)
  with failed_statement(self.s,'SELECT snapshot FROM vh2_social_jobs'),self.assertRaises(sqlite3.OperationalError):vh2_social_worker.poll(self.s)
  self.assertIn(ident,self.s._social_pending)
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT status FROM vh2_social_jobs WHERE id=?',(ident,)).fetchone()[0],'submitted')
  vh2_social_worker.poll(self.s);self.assertEqual(calls,[1]);self.assertTrue(self.state()['social']['posts'][0]['captionReady'])

class AdviserDurability(unittest.TestCase):
 setUp=adviser_fixtures.Adviser.setUp
 tearDown=adviser_fixtures.Adviser.tearDown
 state=adviser_fixtures.Adviser.state
 cmd=adviser_fixtures.Adviser.cmd
 setup_adviser=adviser_fixtures.Adviser.setup_adviser
 result=adviser_fixtures.Adviser.result
 def test_nonfinite_invalid_review_settles_once_without_blocking_future_reviews(self):
  self.setup_adviser();calls=[]
  self.s.story_executor=lambda *args:(calls.append(1) or {**self.result(),'unsupported':float('nan')})
  vh2_story.poll(self.s);ident=next(iter(self.s._story_pending));self.s._story_pending[ident][0].result(timeout=3)
  vh2_story.poll(self.s)
  self.assertEqual(self.s._story_pending,{});self.assertEqual(calls,[1]);self.assertEqual(self.state()['truth']['companion']['vh2Story']['adviser']['status'],'failed')
  with self.s.connect() as db:
   row=db.execute('SELECT status,result FROM vh2_story_jobs WHERE id=?',(ident,)).fetchone();self.assertEqual(row['status'],'failed');self.assertIsNone(row['result'])
 def test_completed_review_survives_commit_failure(self):
  self.setup_adviser();calls=[]
  self.s.story_executor=lambda *args:(calls.append(1) or self.result())
  vh2_story.poll(self.s);ident=next(iter(self.s._story_pending));self.s._story_pending[ident][0].result(timeout=3)
  with failed_commit(self.s),self.assertRaises(sqlite3.OperationalError):vh2_story.poll(self.s)
  self.assertIn(ident,self.s._story_pending)
  vh2_story.poll(self.s);self.assertEqual(calls,[1]);self.assertEqual(self.state()['truth']['companion']['vh2Story']['adviser']['status'],'reviewed')
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_review_storage_failure_never_becomes_a_provider_failure(self):
  self.setup_adviser();calls=[];self.s.story_executor=lambda *args:(calls.append(1) or self.result())
  vh2_story.poll(self.s);ident=next(iter(self.s._story_pending));self.s._story_pending[ident][0].result(timeout=3)
  with failed_statement(self.s,'INSERT INTO events'),self.assertRaises(sqlite3.OperationalError):vh2_story.poll(self.s)
  self.assertIn(ident,self.s._story_pending)
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT status FROM vh2_story_jobs WHERE id=?',(ident,)).fetchone()[0],'submitted')
  vh2_story.poll(self.s);self.assertEqual(calls,[1]);self.assertEqual(self.state()['truth']['companion']['vh2Story']['adviser']['status'],'reviewed')

if __name__=='__main__':unittest.main(verbosity=2)
