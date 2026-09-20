"""Reviewed authoring repair for Aslyn's existing life; no model/provider calls.

Use a database copy first. All mutations use canonical versioned commands.
"""
import argparse,json,sqlite3,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from virtual_humans.backend.vh2_runtime import WorldService
WORLD='47a6412a-d208-54f5-a85f-eb74e10c1bfa'
LEGACY_LABELS={'waking up, getting ready and having a normal morning','commuting, errands and decompressing','having an ordinary evening at home','spending the evening with people they know','a slower morning and personal chores','errands and unstructured personal time','seeing friends or family'}

def main():
 p=argparse.ArgumentParser();p.add_argument('--db',required=True,type=Path);p.add_argument('--copy-from',type=Path);p.add_argument('--report',required=True,type=Path);p.add_argument('--simulate-hours',type=int,default=0);args=p.parse_args()
 if args.copy_from:
  with sqlite3.connect(args.copy_from.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(args.db) as dest:src.backup(dest)
  args.db.chmod(0o600)
 s=WorldService(args.db,str(ROOT/'runtime/darwin-arm64/node'),ROOT)
 def projection():return s.projection(WORLD)
 def cmd(kind,**values):
  before=projection();return s.command({'schemaVersion':1,'worldId':WORLD,'key':str(uuid.uuid4()),'expectedRevision':before['revision'],'type':kind,**values})
 def protected(state):
  c=state['truth']['companion'];return {**{k:state.get(k) for k in ('communication','memories','photos','clips','running')},'references':c.get('vh2Assets'),'rooms':c.get('vh2Visual'),'balance':c['lifeRuntime']['world']['balance'],'placeId':c['lifeRuntime']['world']['placeId'],'journey':c['lifeRuntime']['world'].get('journey'),'people':c.get('vh2People',{}).get('actors')}
 try:
  before=projection();keep=protected(before['state']);
  if before['requiresMigration']:cmd('upgrade_kernel')
  c=projection()['state']['truth']['companion'];assert c['name']=='Aslyn Jonas'
  assert not c['lifeRuntime']['world'].get('journey'),'Apply after the current journey ends.'
  remove=[r['id'] for r in c['lifeProfile']['weeklySchedule'] if r['id'].startswith('routine_') and r['activity'] in LEGACY_LABELS]
  linked={r['scheduleId'] for r in c.get('vh2Institutions',{}).get('rules',[])};assert not set(remove)&linked,'Review linked institution rules first.'
  for ident in remove:cmd('remove_life_entry',section='weeklySchedule',entryId=ident,baseSetupVersion=projection()['state']['truth']['companion'].get('vh2SetupVersion',0))
  c=projection()['state']['truth']['companion'];life=c['lifeProfile'];existing={r['id'] for r in life['activityOptions']}
  def activity(ident,label,kind,place,reason,priority=25,minutes=25,repeat=1440,person='',days=None,start=600,end=1200):
   return {'id':ident,'label':label,'kind':kind,'requiredPlaceId':place,'participantId':person,'reason':reason,'priority':priority,'durationMinutes':minutes,'repeatMinutes':repeat,'minEnergy':25,'days':days or list(range(7)),'startMinute':start,'endMinute':end,'costs':{},'produces':{},'learnFromOutcomes':True}
  additions=[
   activity('psych_notes_review','Review a few Introduction to Psychology notes','focus','campus','She envies classmates who seem to understand things. A brief review is less daunting than a large study plan.',days=[1,2,3,4,5],start=600,end=1020),
   activity('english_draft_step','Write a paragraph for English Composition','focus','home','She is enrolled in English Composition. This is an attempt at a small piece of coursework, not proof of a grade or submission.',priority=28,minutes=30),
   activity('major_options_reflection','Look through possible majors and jot down one question','focus','home','She wants to find something she cares about but loses momentum easily. This leaves room for uncertainty and changing her mind.',priority=18,minutes=15,repeat=10080),
   activity('easy_home_stretch','Try a short stretch or easy bodyweight routine','leisure','home','A low-effort movement option at home, if she feels like it; this is not a new fitness identity.',priority=24,minutes=15,repeat=2880),
   activity('call_tammy_option','Catch up with Tammy by phone','contact','','Her mother is an established warm connection in Ashburn. Both people still need attention and availability.',priority=32,minutes=20,repeat=4320,person='tammy_jonas',start=600,end=1080),
   activity('check_in_cody','Have a quick catch-up with Cody','contact','','They have an easy sibling rapport. A short check-in is an optional way to reconnect, not a claim that a call occurred.',priority=20,minutes=15,repeat=10080,person='cody_jonas',start=600,end=1020)
  ];additions=[r for r in additions if r['id'] not in existing];assert len(existing)+len(additions)<=16
  calendar=list(life.get('personalCalendar',[]));known={r['id'] for r in calendar}
  dates=[{'id':'colton_relationship_anniversary','title':'Anniversary with Colton','kind':'anniversary','personId':'colton_marsh','date':'--10-14','recurrence':'yearly','reminderDays':7,'enabled':True,'source':'fictional_assumption','notes':'Suggested date for the relationship already established in her biography; its exact start date was not supplied. Does not override how that relationship evolves.'},
   {'id':'fall_term_planning_reminder','title':'Think about next term before fall classes end','kind':'milestone','personId':'self','date':'2026-12-04','recurrence':'none','reminderDays':14,'enabled':True,'source':'fictional_assumption','notes':'An optional planning reminder tied to her authored Fall 2026 Session C courses. It is not an official application deadline or proof of enrollment next term. Term dates: https://registrar.asu.edu/academic-calendar'}]
  calendar.extend(r for r in dates if r['id'] not in known)
  people=[]
  for person in life['socialCircle']:
   if person['id'] in ('tammy_jonas','cody_jonas') and not person.get('contactWindows'):
    people.append({'id':person['id'],'contactWindows':[{'days':[0,1,2,3,4,5,6],'startMinute':900,'endMinute':1080}]})
  proposal={'personalCalendar':calendar,'activityOptions':additions,**({'socialCircle':people} if people else {})}
  cmd('apply_life_proposal',version=2,baseSetupVersion=c.get('vh2SetupVersion',0),proposal=proposal)
  campus=c['vh2Geography']['places']['campus'];home=c['vh2Geography']['places']['home']
  cmd('set_place_capabilities',placeId='campus',capabilities={**campus,'capabilities':list(dict.fromkeys(campus.get('capabilities',[])+['food','leisure'])),'access':'public','source':'Authored campus description: Memorial Union food court and benches; unknown prices use the existing meal estimate.'})
  cmd('set_place_capabilities',placeId='home',capabilities={**home,'access':'permitted','source':'Established current residence and authored household.'})
  after=projection();assert protected(after['state'])==keep,'Authoring must not rewrite current lived state.';assert after['state']==s.replay(WORLD)
  report={'removedLegacyRoutineIds':remove,'addedActivityIds':[r['id'] for r in additions],'addedImportantDates':[r['title'] for r in dates if r['id'] not in known],'preserved':['history','messages','photos','clips','references','rooms','balance','position','journey','supporting_people'],'providerCalls':0,'replayExact':True}
  if args.simulate_hours:cmd('set_running',running=False)
  for _ in range(args.simulate_hours):cmd('advance',steps=12)
  if args.simulate_hours:
   after=projection();assert after['state']==s.replay(WORLD);report['simulatedHours']=args.simulate_hours;report['newActivitiesAvailable']=[g['label'] for g in after['state']['truth']['companion']['lifeRuntime']['activities']['goals'] if g.get('opportunityId') in {a['id'] for a in additions}]
  args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
 finally:s.close()

if __name__=='__main__':main()
