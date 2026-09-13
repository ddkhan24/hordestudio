"""Calendar persistence, recurrence, authoring and shared awareness. No providers."""
import copy,datetime,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_calendar as calendar
import vh2_lifestyle_audit as fixtures
import vh2_story as story
from vh2_runtime import Conflict

class PersonalCalendar(unittest.TestCase):
 setUp=fixtures.Lifestyle.setUp
 tearDown=fixtures.Lifestyle.tearDown
 cmd=fixtures.Lifestyle.cmd
 state=fixtures.Lifestyle.state
 def rows(self):return self.state()['truth']['companion']['lifeProfile']['personalCalendar']
 def save(self,rows):return self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.state()['truth']['companion'].get('vh2SetupVersion',0),proposal={'personalCalendar':rows})
 def test_birthdays_exist_once_and_do_not_invent_year_age_or_relatives(self):
  c=self.state()['truth']['companion'];rows=self.rows();self.assertEqual({r['personId'] for r in rows},{'self'})
  self.assertTrue(rows[0]['date'].startswith('--'));self.assertEqual(rows[0]['source'],'fictional_assumption')
  for _ in range(3):self.cmd('advance',steps=1)
  self.assertEqual(rows,self.rows());self.assertEqual(self.state()['truth']['companion']['age'],c['age'])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_new_known_people_and_dates_apply_atomically(self):
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'socialCircle':[{'id':'jo','name':'Jo','age':30,'role':'friend','description':'A known friend'}]})
  self.assertEqual({r['personId'] for r in self.rows()},{'self','jo'})
  before=self.state();bad=[{**self.rows()[0],'date':'2026-02-30'}]
  with self.assertRaises(ValueError):self.save(bad)
  self.assertEqual(before,self.state())
 def test_hide_and_delete_do_not_return_on_reload_or_advance(self):
  birthday={**self.rows()[0],'enabled':False};event={'id':'deadline','title':'Portfolio deadline','date':'2026-09-20','kind':'milestone','recurrence':'none','reminderDays':7,'notes':'Submit existing work','personId':'','source':'authored','enabled':True}
  self.save([birthday,event]);self.assertEqual(len(self.rows()),2);self.save([birthday]);self.cmd('advance',steps=1)
  self.assertEqual(self.rows(),[birthday]);self.assertEqual(self.s.context(self.w)['calendar']['upcomingDates'],[])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_yearly_recurrence_and_leap_day_do_not_duplicate(self):
  row={**self.rows()[0],'date':'--02-29'}
  self.assertEqual(str(calendar.occurrence(row,2028)),'2028-02-29');self.assertEqual(str(calendar.occurrence(row,2027)),'2027-02-28')
  c=copy.deepcopy(self.state()['truth']['companion']);c['lifeProfile']['personalCalendar']=[row]
  out=calendar.personal_context(c,datetime.date(2027,3,1));self.assertEqual(len(out['upcomingDates']),1);self.assertEqual(out['upcomingDates'][0]['occursOn'],'2028-02-29')
  row.update(date='2030-05-12',kind='anniversary');self.assertIsNone(calendar.occurrence(row,2029))
 def test_local_midnight_and_reminder_do_not_claim_celebration(self):
  state=self.state();c=state['truth']['companion'];c['timezone']='America/Phoenix';c['lifeProfile']['personalCalendar']=[{**self.rows()[0],'date':'--09-12','reminderDays':7}]
  state['simAt']=int(datetime.datetime(2026,9,12,6,59,tzinfo=datetime.timezone.utc).timestamp()*1000)
  before=copy.deepcopy(state);ctx=calendar.context(state);self.assertEqual(ctx['localDate'],'2026-09-11');self.assertEqual(ctx['upcomingDates'][0]['daysAway'],1);self.assertTrue(ctx['upcomingDates'][0]['reminderActive']);self.assertEqual(before,state)
  state['simAt']+=60000;ctx=calendar.context(state);self.assertEqual(ctx['upcomingDates'][0]['daysAway'],0);self.assertIn('not_completed',ctx['upcomingDates'][0]['scope'])
 def test_personal_dates_reach_same_context_used_by_daily_adviser(self):
  ctx=self.s.context(self.w)['calendar'];self.assertEqual(ctx['upcomingDates'][0]['id'],self.rows()[0]['id'])
  self.assertEqual(ctx['knownBirthdays'][0]['date'],self.rows()[0]['date'])
  frozen=story.snapshot(self.s,self.w,1,self.state());self.assertIn(self.rows()[0]['title'],json.dumps(frozen,ensure_ascii=False))
 def test_unknown_people_duplicates_invalid_dates_and_clearing_cannot_corrupt(self):
  good=self.rows()[0];before=self.state()
  for rows in [[good,good],[{**good,'personId':'invented_sister'}],[{**good,'date':'--04-31'}],[{**good,'recurrence':'none'}],[{**good,'reminderDays':True}],[{**good,'source':'official'}]]:
   with self.assertRaises(ValueError):self.save(rows)
   self.assertEqual(before,self.state())
 def test_concurrent_edit_is_rejected_without_losing_draft(self):
  version=self.state()['truth']['companion'].get('vh2SetupVersion',0);self.save(self.rows());before=self.state()
  with self.assertRaises(Conflict):self.cmd('apply_life_proposal',version=2,baseSetupVersion=version,proposal={'personalCalendar':[]})
  self.assertEqual(before,self.state())
 def test_birthdays_do_not_expose_unknown_population_people(self):
  c=self.state()['truth']['companion'];c['vh2Population']={'residents':[{'id':'unknown','name':'Unknown resident'}]};calendar.prepare({'truth':{'companion':c}})
  self.assertNotIn('unknown',{r['personId'] for r in c['lifeProfile']['personalCalendar']})
 def test_busy_calendar_does_not_forget_birthdays_or_due_reminders(self):
  c=self.state()['truth']['companion'];birthday={**self.rows()[0],'date':'--12-25'};rows=[birthday]
  for i in range(40):rows.append({'id':'event'+str(i),'title':'Known deadline '+str(i),'date':str(datetime.date(2026,9,12)+datetime.timedelta(days=i)),'kind':'milestone','recurrence':'none','reminderDays':60,'personId':'','source':'authored','enabled':True})
  c['lifeProfile']['personalCalendar']=rows;ctx=calendar.personal_context(c,datetime.date(2026,9,12))
  self.assertEqual(len(ctx['upcomingDates']),30);self.assertEqual(ctx['knownBirthdays'][0]['date'],'--12-25');self.assertEqual(len(ctx['activeReminders']),40)

if __name__=='__main__':unittest.main(verbosity=2)
