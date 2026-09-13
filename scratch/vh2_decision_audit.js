const assert=require('node:assert/strict');
const D=require('../vh2-decision-engine'),A=require('../vh-activity-engine');
const t=1788764400000,clone=x=>JSON.parse(JSON.stringify(x));
function goal(id,hunger=0,energy=0){return {id,label:id,status:'planned',stepIndex:0,createdAt:t,priority:50,kind:'leisure',steps:[{label:id,durationMs:20*60000,progressMs:0,costs:{},produces:{},hunger,energy,stress:0,charged:false}]};}
function sample(seed){const r={policy:D.policy({temperature:12,exploration:0})};const g=[goal('a'),goal('b')];D.select(r,g,t,{seed,hunger:20,energy:70},g=>({score:g.id==='a'?60:48,components:{preference:g.id==='a'?60:48}}));return r;}
let a=0;for(let i=0;i<1000;i++){const r=sample('seed-'+i);a+=r.choice.goalId==='a';assert(Math.abs(r.choice.candidates.reduce((n,x)=>n+x.probability,0)-1)<1e-12);assert.deepEqual(r,sample('seed-'+i));}
assert(a>650&&a<820,`weighted variation distribution ${a}/1000`);
const runtime={policy:D.policy()},choices=[goal('rest',0,10),goal('meal',-50,0)];
const urgent=D.select(runtime,choices,t,{seed:'urgent',hunger:99,energy:40},()=>({score:0,components:{}}));assert.equal(urgent.id,'meal');assert.equal(runtime.choice.urgency,'urgent_hunger');
urgent.status='active';const serial=runtime.sequence;D.select(runtime,choices,t+60000,{seed:'urgent',hunger:99,energy:40},()=>({score:0,components:{}}));assert.equal(runtime.sequence,serial,'no resampling on a poll');
const loaded=clone(runtime);D.select(loaded,clone(choices),t+60000,{seed:'urgent',hunger:99,energy:40},()=>({score:0,components:{}}));assert.deepEqual(loaded,runtime,'reload preserves choice and sampled random draw');
// Same kernel feasibility checks, with selection injected only in VH2.
let state=A.normalize({lastAdvancedAt:t,resources:{},goals:[{...goal('locked'),requiredPlaceId:'elsewhere'},{...goal('okay')}]});
let presented=[];A.advance(state,t+60000,{availability:'available',placeId:'home',energy:70,hunger:20,selectAction:c=>{presented=c.map(x=>x.id);return c[0];}});assert.deepEqual(presented,['okay']);
state=A.normalize({lastAdvancedAt:t,resources:{token:1},goals:[goal('task')]});state.goals[0].steps[0].costs={token:1};
A.advance(state,t+60000,{availability:'available',energy:70});assert.equal(state.resources.token,0);
const progress=state.goals[0].steps[0].progressMs;
A.advance(state,t+120000,{availability:'busy',label:'An obligation'});assert.equal(state.goals[0].status,'paused');assert.equal(state.goals[0].steps[0].progressMs,progress);
state=A.normalize(clone(state));A.advance(state,t+180000,{availability:'available',energy:70});assert.equal(state.resources.token,0,'resume must not charge costs twice');assert.equal(state.goals[0].steps[0].progressMs,progress+60000);
const c={timezoneOffsetMinutes:0,lifeProfile:{weeklySchedule:[],activityOptions:[],sleepPolicy:{}},humanDynamics:{lastUpdated:t,sleep:{stage:'awake'}},lifeRuntime:{activities:{lastAdvancedAt:t,goals:[{...goal('short'),status:'active',steps:[{durationMs:120000,progressMs:0}]}]}},vh2Decision:{choice:{at:t,nextAt:t+600000}}};
assert.equal(D.nextWake(c,t).at,t+120000);assert(D.nextWake(c,t).reasons.includes('action_step_complete'));
c.lifeRuntime.activities.goals=[];c.humanDynamics.sleep={stage:'asleep'};assert.equal(D.nextWake(c,t).at,t+300000);
const pausedProgress=state.goals[0].steps[0].progressMs;assert(A.pauseForContext(state,t+180000,'Scheduled obligation started.'));assert.equal(state.goals[0].steps[0].progressMs,pausedProgress);assert(!A.pauseForContext(state,t+180000,'Scheduled obligation started.'));
const worker=require('../vh2-kernel-worker');
let actual=worker.run({create:true,name:'Boundary test',entityId:'boundary-human',now:t}).companion;
actual.lifeProfile.weeklySchedule=[require('../vh-simulation-core').normalizeCompanionScheduleBlock({id:'meeting',days:[1],startMinute:422,endMinute:430,placeId:'home',activity:'Meeting',availability:'busy',breakAllowed:false})];
actual=worker.run({companion:actual,now:t+60000}).companion;
assert(actual.lifeRuntime.activities.goals.some(g=>g.status==='active'));
actual=worker.run({companion:actual,now:t+120000}).companion;
assert(actual.lifeRuntime.activities.goals.some(g=>g.status==='paused'));
assert(actual.lifeRuntime.activities.events.some(e=>e.kind==='paused'&&e.at===t+120000),'obligation pauses at the observed boundary');
console.log(`PASS 1000 seeded choices (${a} preferred), urgent needs, stable holds/reloads, feasibility, interruption costs and earlier completion wakeups`);
