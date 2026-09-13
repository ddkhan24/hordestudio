"""Calendar-derived age, privacy boundaries and replay; no providers or user lives."""
import copy,datetime,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_calendar as cal
from vh2_runtime import WorldService
from test_runtime import node_executable

ROOT=Path(__file__).resolve().parents[1]
def stamp(value):return int(datetime.datetime.fromisoformat(value).timestamp()*1000)
def birthday(person='self',date='2008-09-14',source='authored'):
 return dict(id='birthday_'+person,title='Birthday',kind='birthday',personId=person,date=date,recurrence='yearly',source=source,enabled=True)
def fixture(at='2026-09-13T23:59:00+00:00',rows=None,age=18,zone='UTC'):
 return {'simAt':stamp(at),'truth':{'companion':{'id':'alex','name':'Alex','age':age,'timezone':zone,'lifeProfile':{'socialCircle':[],'personalCalendar':rows or [birthday()]}}}}

class AgeCalendar(unittest.TestCase):
 def test_explicit_dob_boundary_preserves_authored_age(self):
  state=fixture();cal.prepare(state);c=state['truth']['companion']
  self.assertEqual(cal.current_age(c),17);self.assertEqual(c['age'],18)
  state['simAt']+=60000;cal.prepare(state)
  self.assertEqual(cal.current_age(c),18);self.assertEqual(c['age'],18)
  self.assertEqual(c['vh2Calendar']['ages']['self']['source'],'authored_dob')
 def test_inferred_year_is_anchored_once_and_placeholder_does_not_infer(self):
  state=fixture(rows=[birthday(date='--09-14')],age=24);cal.prepare(state);c=state['truth']['companion']
  anchor=copy.deepcopy(c['vh2Calendar']['ages']['self']);self.assertEqual(anchor['birthDate'],'2001-09-14')
  state['simAt']=stamp('2028-09-14T00:00:00+00:00');cal.prepare(state)
  record=c['vh2Calendar']['ages']['self'];self.assertEqual(record['currentAge'],27);self.assertEqual(record['referenceDate'],anchor['referenceDate']);self.assertEqual(c['age'],24)
  self.assertEqual(record['source'],'inferred_birth_year')
  c['lifeProfile']['personalCalendar'][0]['source']='fictional_assumption';cal.prepare(state)
  self.assertEqual(cal.current_age(c),24);self.assertEqual(c['vh2Calendar']['ages'],{})
 def test_explicit_fictional_dob_is_distinct_from_placeholder(self):
  state=fixture(rows=[birthday(date='2002-09-14',source='fictional_assumption')],age=23);cal.prepare(state)
  c=state['truth']['companion'];self.assertEqual(cal.current_age(c),23);self.assertEqual(c['vh2Calendar']['ages']['self']['source'],'authored_fictional_dob')
  state['simAt']+=60000;cal.prepare(state);self.assertEqual(cal.current_age(c),24)
 def test_leap_day_does_not_make_an_adult_early(self):
  state=fixture(at='2026-02-28T23:59:00+00:00',rows=[birthday(date='2008-02-29')]);cal.prepare(state)
  c=state['truth']['companion'];self.assertEqual(cal.current_age(c),17)
  self.assertEqual(cal.occurrence(c['lifeProfile']['personalCalendar'][0],2026),datetime.date(2026,2,28))
  state['simAt']+=60000;cal.prepare(state);self.assertEqual(cal.current_age(c),18)
  bad=fixture(rows=[birthday(date='--02-29')],age=24);cal.prepare(bad);self.assertNotIn('vh2Calendar',bad['truth']['companion'])
 def test_timezones_year_boundary_and_remote_people(self):
  state=fixture(at='2027-01-01T04:59:00+00:00',rows=[birthday(date='2000-01-01'),birthday('jo','2000-01-01')],age=26,zone='America/New_York')
  c=state['truth']['companion'];c['lifeProfile']['socialCircle']=[{'id':'jo','name':'Jo','age':26}];c['vh2People']={'actors':{'jo':{'policy':{'timeZone':'Asia/Tokyo'}}}}
  cal.prepare(state);self.assertEqual(cal.current_age(c),26);self.assertEqual(cal.current_age(c,c['lifeProfile']['socialCircle'][0]),27)
  self.assertEqual(cal.next_age_boundary(state),state['simAt']+60000)
  state['simAt']+=60000;cal.prepare(state);self.assertEqual(cal.current_age(c),27)
 def test_unknown_people_disabled_reminders_and_bounds(self):
  state=fixture();c=state['truth']['companion'];c['lifeProfile']['socialCircle']=[{'id':'unknown','name':'Unknown age','age':None}]
  c['lifeProfile']['personalCalendar']+=[birthday('unknown','--05-01')];c['lifeProfile']['personalCalendar'][0]['enabled']=False;cal.prepare(state)
  self.assertEqual(cal.current_age(c),17);self.assertNotIn('unknown',c['vh2Calendar']['ages'])
  for date in ('1700-01-01','2027-01-01','2026-02-30'):
   with self.assertRaises(ValueError):cal.validate_personal([birthday(date=date)],c,datetime.date(2026,9,13))
 def test_permissions_keep_authored_confirmation_and_reject_early_adulthood(self):
  state=fixture(rows=[birthday(date='2000-09-14'),birthday('jo','2002-09-14')],age=25);c=state['truth']['companion'];p={'id':'jo','name':'Jo','age':23};c['lifeProfile']['socialCircle']=[p];cal.prepare(state)
  self.assertTrue(cal.age_confirmation_matches(c,p,23));state['simAt']+=60000;cal.prepare(state)
  self.assertTrue(cal.age_confirmation_matches(c,p,23));self.assertEqual(p['age'],23)
  c['lifeProfile']['personalCalendar'][1]['date']='2010-09-14';cal.prepare(state)
  self.assertFalse(cal.age_confirmation_matches(c,p,23))
 def test_service_restart_replay_and_template_age(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'age.sqlite';now=stamp('2026-09-13T23:59:00+00:00');node=node_executable(ROOT)
   service=WorldService(path,node,ROOT,clock=lambda:now)
   try:
    profile={'age':24,'timezone':'UTC','lifeProfile':{'personalCalendar':[birthday(date='2001-09-14')],'sleepPolicy':{'enabled':False},'weeklySchedule':[]}}
    world=service.command(dict(schemaVersion=1,key='age-world',type='create_profile',name='Alex',profile=profile,providerScope='horde:age-fixture',personaId='age-player'))['worldId']
    state=service.projection(world)['state'];self.assertEqual(cal.current_age(state['truth']['companion']),24)
    service.command(dict(schemaVersion=1,key='birthday',type='advance',worldId=world,expectedRevision=service.projection(world)['revision'],steps=1))
    state=service.projection(world)['state'];self.assertEqual(cal.current_age(state['truth']['companion']),25);self.assertEqual(state['truth']['companion']['age'],24)
    self.assertEqual(state,service.replay(world));service.close()
    service=WorldService(path,node,ROOT,clock=lambda:now)
    self.assertEqual(service.projection(world)['state'],state);self.assertEqual(service.replay(world),state)
    self.assertEqual(profile['age'],24);self.assertNotIn('vh2Calendar',profile)
    self.assertEqual(service.context(world)['calendar']['ages'][0]['currentAge'],25)
   finally:service.close()

if __name__=='__main__':unittest.main(verbosity=2)
