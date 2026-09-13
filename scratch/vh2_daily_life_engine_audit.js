'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{fixture,START}=require('./vh2_story_audit'),kernel=require('../vh2-kernel-worker'),core=require('../vh-simulation-core'),world=require('../vh-world-engine'),story=require('../vh2-story-engine');
const HOUR=3600000,MIN=60000;
const block={id:'seminar',days:[0,1,2,3,4,5,6],startMinute:600,endMinute:660,activity:'Seminar',availability:'busy',flexibility:'fixed',placeId:'home',startsOn:'2026-09-01',endsOn:'2026-12-04',breaks:[{label:'Autumn break',startsOn:'2026-10-10',endsOn:'2026-10-13'}]};
let c=fixture('dates');c.lifeProfile.weeklySchedule=[core.normalizeCompanionScheduleBlock(block)];
for(const [date,expected] of [['2026-08-31',false],['2026-09-01',true],['2026-10-10',false],['2026-10-13',false],['2026-10-14',true],['2026-12-04',true],['2026-12-05',false],['2027-09-07',false]])assert.equal(!!core.companionScheduleBlockAt(c,Date.parse(date+'T10:30:00Z')),expected,date);
assert.equal(world.activeOn({...block,startsOn:'invalid'},'2026-10-01'),false);
assert.deepEqual(world.calendarFields(world.config({people:[{...block,personId:'jo',start:600,end:660}]}).people[0]),world.calendarFields(block));
c.vh2Institutions={rules:[{id:'university',scheduleId:'seminar',label:'University',minimumAttendance:.5,fee:50,missedStress:10}],sessions:{},events:[],lastAt:null};
for(let m=0;m<120;m++)require('../vh2-institutions-engine').advance(c,Date.parse('2026-10-12T10:00:00Z')+m*MIN,{dateKey:'2026-10-12',weekday:1,hour:10+Math.floor(m/60),minute:m%60},{availability:'available'});
assert.equal(Object.keys(c.vh2Institutions.sessions).length,0);assert.equal(c.vh2Institutions.events.length,0);
// Specific flexible classes survive as choices; legacy all-day umbrellas cannot shadow them.
let student=fixture('student'),classAt=Date.parse('2026-09-08T10:05:00Z');
student.lifeProfile.weeklySchedule=[core.normalizeCompanionScheduleBlock({...block,activity:'classes, study and campus obligations',startMinute:540,endMinute:1020}),core.normalizeCompanionScheduleBlock({...block,id:'specific_class',activity:'Statistics seminar',flexibility:'soft'})];
student=kernel.run({companion:student,now:classAt,inspect:true}).companion;
// Inspect is read-only with respect to time; normal advance performs the recorded repair.
student.lifeRuntime.activities.lastAdvancedAt=classAt;student.lifeRuntime.lastSimulatedAt=classAt;
student=kernel.run({companion:student,now:classAt+MIN}).companion;
assert(!student.lifeProfile.weeklySchedule.some(b=>b.activity==='classes, study and campus obligations'));
assert(student.lifeRuntime.activities.goals.some(g=>g.id.includes('specific_class')));
const agenda=(placeId='home')=>({kind:'new_activity',activity:'study',subject:'a portfolio outline',placeId,durationMinutes:25,reason:'A specific personal project',startsAt:START,expiresAt:START+6*HOUR,reviewId:'test'});
c=fixture('daily-plan');Object.assign(c.vh2Story.policy,{adviserEnabled:true,intensity:40});c.vh2Story.adviser={agenda:[agenda()]};
const before=structuredClone(c);story.seedAgenda(c,START);const g=c.lifeRuntime.activities.goals.find(g=>g.id===c.vh2Story.adviser.agenda[0].goalId);assert(g);assert.equal(g.status,'planned');assert.equal(g.requiredPlaceId,'home');assert.equal(g.steps[0].progressMs,0);assert.equal(c.lifeRuntime.world.balance,before.lifeRuntime.world.balance);assert.deepEqual(c.vh2People,before.vh2People);assert.equal(story.preference(c,g,START),8);
const size=c.lifeRuntime.activities.goals.length;story.seedAgenda(c,START+MIN);assert.equal(c.lifeRuntime.activities.goals.length,size);assert.equal(story.preference(c,g,START+7*HOUR),0);
for(const patch of [{vh2AutonomyPaused:true},{vh2Story:{...structuredClone(c.vh2Story),policy:{...c.vh2Story.policy,adviserEnabled:false}}}])assert.equal(story.preference({...c,...patch},g,START),0);
const unsafe=fixture('private');Object.assign(unsafe.vh2Story.policy,{adviserEnabled:true,intensity:70});unsafe.vh2Story.adviser={agenda:[agenda('jo_home')]};story.seedAgenda(unsafe,START);assert.equal(unsafe.vh2Story.adviser.agenda[0].goalId,undefined);
// Existing homes need not have the newer access metadata; canonical residence still grants access.
const legacyHome=fixture('legacy-home');delete legacyHome.vh2Geography.places.home.access;Object.assign(legacyHome.vh2Story.policy,{adviserEnabled:true,intensity:40});legacyHome.vh2Story.adviser={agenda:[agenda()]};story.seedAgenda(legacyHome,START);assert(legacyHome.vh2Story.adviser.agenda[0].goalId);assert(legacyHome.lifeRuntime.activities.goals.some(g=>g.id===legacyHome.vh2Story.adviser.agenda[0].goalId));
// Diverse economic and motivational conditions, not a cultural/psychological authenticity test.
const cases=[['friend',300,3,15,30],['partner',300,3,15,60],['creator',900,6,70,50],['vlogger',1500,8,70,80],['india_household',120,12,15,35],['dubai_creator',1800,25,40,65],['colorado_farm',600,4,15,25],['london_student',180,5,40,60],['displaced_creator',200,8,15,25],['moscow_student',900,20,15,40],['fictional_deceptive_persona',250,4,40,50]];
const results=[];
for(const [name,balance,mealCost,intensity,socialNeed] of cases){
 let x=fixture('matrix:'+name);x.lifeRuntime.world.balance=balance;x.vh2Geography.places.cafe.mealCost=mealCost;x.humanDynamics.socialNeed=socialNeed;Object.assign(x.vh2Story.policy,{intensity,adviserEnabled:true});x.vh2Story.adviser={agenda:[agenda()]};let completed=false;const visited=new Set();
 for(let minute=5;minute<=3*1440;minute+=5){const now=START+minute*MIN;const prev=minute%1440===5?structuredClone(x):null,r=kernel.run({companion:x,now});x=r.companion;if(prev)assert.deepEqual(r,kernel.run({companion:prev,now}));
  assert(Number.isFinite(x.lifeRuntime.world.balance)&&x.lifeRuntime.world.balance>=0);for(const k of ['energy','hunger','stress','socialNeed'])assert(Number.isFinite(x.humanDynamics[k])&&x.humanDynamics[k]>=0&&x.humanDynamics[k]<=100);
  assert(x.vh2Story.adviser.agenda.length<=3);assert(x.lifeRuntime.activities.goals.length<=60);if(x.lifeRuntime.world.placeId)visited.add(x.lifeRuntime.world.placeId);completed ||= r.events.some(e=>e.kind==='completed'&&String(e.summary||'').includes('portfolio'));
 }
 results.push({name,initialBalance:balance,mealCost,intensity,visited:visited.size,remainingBalance:x.lifeRuntime.world.balance,studyCompleted:completed});
}
assert(results.some(r=>r.studyCompleted));const report={simulatedDays:33,scope:'Bounded needs, spending, dated commitments, temporary goals, access, exact replay. Not cultural authenticity or live LLM quality.',results};fs.writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'vh-daily-life-matrix.json'),JSON.stringify(report,null,2));console.log('PASS dated commitments/breaks, no false attendance, daily agenda bounds/private access and 33 character-days.');
