"""Daily review delivery, limits, typed proposals and diverse adult life authoring."""
import copy,json,sys,time,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_story as story
import vh2_lifestyle_audit as fixtures
from vh2_runtime import Conflict
class Adviser(unittest.TestCase):
 setUp=fixtures.Lifestyle.setUp
 tearDown=fixtures.Lifestyle.tearDown
 cmd=fixtures.Lifestyle.cmd
 state=fixtures.Lifestyle.state
 def setup_adviser(self):
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'storyPolicy':{'intensity':40,'adviserEnabled':True}})
  self.cmd('set_running',running=True)
  self.s.dialogue_provider.save({'baseUrl':'http://127.0.0.1:1','model':'fixture','scope':'horde:alex','enabled':True,'maxTokens':800,'temperature':.5,'dailyLimit':20})
 def result(self):return {'direction':'Consider quiet progress on the current project.','unresolved':['Leave space for rest.'],'basisIds':['current_life'],'suggestion':{'kind':'none','targetId':'','reason':''},'agenda':[{'kind':'new_activity','activity':'study','subject':'the current reading assignment','placeId':'home','durationMinutes':25,'reason':'A modest step without assuming success','afterHours':0,'windowHours':6}]}
 def finish(self):
  for i in range(50):
   story.poll(self.s)
   if not self.s._story_pending:return
   time.sleep(.01)
  self.fail('Fixture review did not finish')
 def test_daily_review_is_persistent_grounded_and_not_a_chat_message(self):
  self.setup_adviser();seen=[];self.s.story_executor=lambda *args:seen.append(args) or self.result()
  before=self.state();story.poll(self.s);self.finish();after=self.state();a=after['truth']['companion']['vh2Story']['adviser']
  self.assertEqual(a['status'],'reviewed');self.assertEqual(len(seen),1)
  for k in ('memories','communication','photos'):self.assertEqual(before.get(k),after.get(k))
  self.assertEqual(before['truth']['companion']['lifeRuntime'],after['truth']['companion']['lifeRuntime'])
  self.assertEqual(a['lastResult']['scope'],'tentative_life_direction');self.assertEqual(a['nextWallAt']-a['lastAttemptAt'],story.DAY)
  for i in range(5):story.poll(self.s)
  self.assertEqual(len(seen),1);self.assertEqual(after,self.s.replay(self.w))
  self.assertIn('tentativeLifeDirection',self.s.context(self.w))
 def test_missing_provider_waits_without_billing_and_recovers(self):
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'storyPolicy':{'adviserEnabled':True}});self.cmd('set_running',running=True)
  story.poll(self.s);self.assertEqual(self.state()['truth']['companion']['vh2Story']['adviser']['status'],'waiting')
  with self.s.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM dialogue_usage').fetchone()[0],0)
 def test_unknown_outcome_does_not_retry_or_stop_life(self):
  self.setup_adviser();calls=[]
  def failed(*args):calls.append(1);raise story.UnknownOutcome()
  self.s.story_executor=failed;story.poll(self.s);self.finish();story.poll(self.s)
  self.assertEqual(len(calls),1);self.assertEqual(self.state()['truth']['companion']['vh2Story']['adviser']['status'],'unknown');self.assertTrue(self.state()['running'])
 def test_schema_rejects_overrides_fake_places_and_invented_evidence(self):
  frozen=story.snapshot(self.s,self.w,1,self.state());good=self.result();story.validate(good,frozen)
  bad=[{**good,'position':'miami'},{**good,'basisIds':['invented-news']},{**good,'suggestion':{'kind':'teleport','targetId':'home','reason':''}},{**good,'suggestion':{'kind':'place','targetId':'miami','reason':''}}]
  for fields in [{'activity':'hook_up'},{'durationMinutes':1000},{'placeId':'secret-house'},{'afterHours':23,'windowHours':8},{'activity':'unknown_action'}]:
   b=copy.deepcopy(good);b['agenda'][0].update(fields);bad.append(b)
  for b in bad:
   with self.assertRaises(ValueError):story.validate(b,frozen)
 def test_settings_pause_and_stale_results_are_fenced(self):
  self.setup_adviser();state=self.state();frozen=story.snapshot(self.s,self.w,1,state)
  for mutate in [lambda s:s.update(running=False),lambda s:s['truth']['companion'].update(vh2AutonomyPaused=True),lambda s:s['truth']['companion'].update(vh2SetupVersion=99),lambda s:s.update(simAt=s['simAt']+story.DAY),lambda s:s['truth']['companion']['vh2Story']['policy'].update(adviserEnabled=False)]:
   altered=copy.deepcopy(state);mutate(altered);self.assertTrue(story.stale(self.s,altered,frozen))
 def test_restart_marks_submission_unknown_without_rebilling(self):
  self.setup_adviser();state=self.state();frozen=story.snapshot(self.s,self.w,1,state)
  p=self.s.projection(self.w);after=copy.deepcopy(state);story.ensure(after['truth']['companion']).update(status='reviewing',nextWallAt=self.s.clock()+story.DAY,nextSimAt=state['simAt']+story.DAY)
  with self.s.connect() as db:
   db.execute('BEGIN IMMEDIATE');db.execute('INSERT INTO vh2_story_jobs(id,world_id,status,snapshot,created_at) VALUES (?,?,?,?,?)',('interrupted',self.w,'submitted',json.dumps(frozen),self.s.clock()));self.s.commit_event(db,self.w,p['revision'],state,after,'FIXTURE_SUBMISSION')
  story.poll(self.s)
  self.assertEqual(self.state()['truth']['companion']['vh2Story']['adviser']['status'],'unknown');self.assertFalse(self.s._story_pending)
 def test_catchup_does_not_hide_failure_or_trigger_an_early_review(self):
  self.setup_adviser();self.s.story_executor=lambda *args:{**self.result(),'extra':'invalid'};story.poll(self.s);self.finish()
  with self.s.connect() as db:
   db.execute('BEGIN IMMEDIATE');rev,state=self.s.read(db,self.w);after=copy.deepcopy(state);story.ensure(after['truth']['companion']).update(status='waiting',error='Waiting for the life to catch up.');self.s.commit_event(db,self.w,rev,state,after,'FIXTURE_STALE_LABEL')
  story.poll(self.s);self.assertEqual(self.state()['truth']['companion']['vh2Story']['adviser']['status'],'failed');self.assertFalse(self.s._story_pending)
 def test_daily_budget_includes_life_advice(self):
  self.setup_adviser()
  with self.s.connect() as db:
   db.executemany('INSERT INTO dialogue_usage VALUES (?,?)',[(str(i),self.s.clock()) for i in range(20)])
  story.poll(self.s);self.assertIn('allowance',self.state()['truth']['companion']['vh2Story']['adviser']['error']);self.assertFalse(self.s._story_pending)
 def test_rejected_candidate_retains_diagnostic_reason_without_becoming_advice(self):
  self.setup_adviser();candidate=self.result();candidate['suggestion']['kind']='teleport';self.s.story_executor=lambda *args:candidate
  before=self.state();story.poll(self.s);self.finish();after=self.state();a=after['truth']['companion']['vh2Story']['adviser']
  self.assertEqual(a['status'],'failed');self.assertIn('Unsupported life suggestion',a['error']);self.assertNotIn('lastResult',a)
  self.assertEqual(before.get('memories'),after.get('memories'));self.assertEqual(before['communication'],after['communication'])
  with self.s.connect() as db:
   job=db.execute('SELECT status,result FROM vh2_story_jobs WHERE world_id=?',(self.w,)).fetchone();self.assertEqual(job['status'],'failed');self.assertEqual(json.loads(job['result']),candidate)
  story.poll(self.s);self.assertFalse(self.s._story_pending)
 def test_diverse_settings_keep_currency_boundaries_and_identity_separate(self):
  cases=[('friend','GBP',20),('partner','USD',50),('adult creator','USD',95),('travelling vlogger','EUR',65),('Indian low-income household','INR',80),('Dubai influencer','AED',90),('Colorado farm','USD',35),('London university','GBP',75),('Ukrainian displaced adult creator','UAH',95),('Moscow student family conflict','RUB',85),('fictional South American deceptive persona','BRL',90)]
  for name,currency,privacy in cases:
   with self.subTest(name=name):
    profile={'interests':'A personally chosen project','aversions':'Unwanted pressure','boundaries':'Keeps personal contact separate from public work','affectionStyle':'Specific to authored relationships','contextNotes':name,'openness':40,'privacyPreference':privacy,'initiative':55,'restraint':70}
    self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.state()['truth']['companion'].get('vh2SetupVersion',0),proposal={'finance':{'currency':currency,'enabled':True,'incomePerHour':0,'dailyIncome':0,'dailyExpense':0,'workPlaceIds':[]},'personalPreferences':profile})
    context=self.s.context(self.w);self.assertEqual(context['ownFinances']['currency'],currency);self.assertEqual(context['personalPreferences']['profile']['privacyPreference'],privacy)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_currency_changes_cannot_relabel_money_after_transactions(self):
  fixtures.Lifestyle.seed_debt(self);before=self.state()
  with self.assertRaises(Conflict):self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'finance':{'currency':'GBP','enabled':True,'incomePerHour':0,'dailyIncome':0,'dailyExpense':0,'workPlaceIds':[]}})
  self.assertEqual(before,self.state())
 def test_calendar_dates_save_and_ended_terms_are_visible_to_chat(self):
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'weeklySchedule':[{'id':'class','days':[1,2,3,4,5],'startMinute':600,'endMinute':660,'activity':'Seminar','placeId':'home','flexibility':'fixed','startsOn':'2026-01-01','endsOn':'2026-05-31','breaks':[{'label':'Spring break','startsOn':'2026-03-09','endsOn':'2026-03-15'}]}]})
  self.assertEqual(self.s.context(self.w)['calendar']['commitments'][0]['phase'],'ended');self.assertEqual(self.state(),self.s.replay(self.w))
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('apply_life_proposal',version=2,baseSetupVersion=1,proposal={'weeklySchedule':[{'id':'class','endsOn':'2026-02-30'}]})
  self.assertEqual(before,self.state())
 def test_current_intentions_exclude_completed_future_and_other_people(self):
  state=self.state();c=state['truth']['companion'];now=state['simAt'];c['lifeRuntime']['activities']['goals']=[{'id':'ours','label':'Finish a portfolio','status':'active','createdAt':now-1,'reason':'A long-term ambition'},{'id':'done','label':'Finished work','status':'completed'},{'id':'future','label':'Unknown future goal','status':'planned','createdAt':now+1}]
  out=self.s.expression_context(self.w,1,state)['currentIntentions'];self.assertEqual([g['id'] for g in out['goals']],['ours'])
if __name__=='__main__':unittest.main(verbosity=2)
