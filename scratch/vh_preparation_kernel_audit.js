const assert=require('node:assert/strict'),vm=require('node:vm');
const {buildContext}=require('./app_source');
const engine=require('../vh-activity-engine'),worker=require('../vh-host-worker');
const ctx={console,state:{globalSettings:{},personas:[],companions:[],companionTimelines:{},companionThreads:{}}};
buildContext(vm,['normalizeCompanion','advanceCompanionLife','advanceCompanionHumanDynamics'],ctx);
const minute=60000,t=Date.UTC(2026,8,8,9),clone=x=>JSON.parse(JSON.stringify(x));
function person(missing=false){return ctx.normalizeCompanion({id:'prep-person',name:'Ada',age:28,locationMode:'custom',timezoneOffsetMinutes:0,
 lifeProfile:{initializedAt:t,seed:'prep',decisionPolicy:{variation:0},supplies:[{id:'paper',label:'Notes',quantity:0},{id:'packed',label:'Packed bag',quantity:0}],
 places:[{id:'home',label:'Home',kind:'home'},{id:'campus',label:'Campus',kind:'study'}],
 weeklySchedule:[{id:'class',activity:'Attend class',days:[2],startMinute:570,endMinute:600,placeId:'campus',departureCosts:{packed:1}}],
 travelLegs:[{from:'home',to:'campus',mode:'WALK',minutes:10,cost:0}],world:{transport:{enabled:true,delayChance:0}},
 activityOptions:[...(!missing?[{id:'notes',label:'Prepare notes',kind:'preparation',days:[2],startMinute:540,endMinute:600,requiredPlaceId:'home',durationMinutes:4,priority:5,produces:{paper:1}}]:[]),{id:'pack',label:'Pack bag',kind:'preparation',days:[2],startMinute:540,endMinute:600,requiredPlaceId:'home',durationMinutes:5,priority:10,costs:{paper:1},produces:{packed:1}}]},
 lifeRuntime:{lastSimulatedAt:t,activities:{lastAdvancedAt:t}},humanDynamics:{energy:90,stress:0,hunger:0,lastUpdated:t},mood:{lastUpdated:t},emotionState:{lastUpdated:t}});}
function run({reload=false,missing=false,chat=false,host=false}={}){let c=person(missing);if(chat)c.lifeRuntime.activities.conversationUntil=t+25*minute;
 for(let m=0;m<=65;m++){const at=t+m*minute;if(host)c=worker.run({companion:c,messages:[],now:at,experience:{realTimeLife:true,replyDelays:true,allowNoReply:true}}).companion;else {ctx.advanceCompanionLife(c,at);ctx.advanceCompanionHumanDynamics(c,at);}if(reload)c=ctx.normalizeCompanion(clone(c));}return c;}
const normal=run(),restored=run({reload:true}),background=run({host:true});
assert.deepEqual(clone(normal.lifeRuntime.activities),clone(restored.lifeRuntime.activities));
assert.deepEqual(clone(normal.lifeRuntime.activities),clone(background.lifeRuntime.activities));
const arrival=normal.lifeRuntime.world.events.find(e=>e.kind==='arrival');assert(arrival);assert.equal(arrival.lateMinutes,0);
assert.equal(normal.lifeRuntime.activities.resources.packed,0,'departure consumes preparation exactly once');
assert.equal(normal.lifeRuntime.activities.resources.paper,0,'packing consumes its prerequisites');
const missing=run({missing:true});assert(!missing.lifeRuntime.world.events.some(e=>e.kind==='arrival'));assert(missing.lifeRuntime.world.events.some(e=>e.kind==='missed'));assert.equal(missing.lifeRuntime.activities.resources.packed,0);
const delayed=run({chat:true});assert(delayed.lifeRuntime.world.events.some(e=>e.kind==='arrival'&&e.lateMinutes>0));
const cycles=engine.normalize({lastAdvancedAt:t});
for(const [id,input,output] of [['a','b','a'],['b','a','b']]){const g=engine.addGoal(cycles,'preparation',id,t);g.steps[0].costs={[input]:1};g.steps[0].produces={[output]:1};}
engine.advance(cycles,t+minute,{availability:'available',energy:90});assert(cycles.goals.every(g=>g.status==='blocked'));assert.equal(Object.keys(cycles.resources).length,0);
console.log('PASS preparation chain → real departure → arrival; exact resource consumption; missing supplies cause missed appointment; chat causes lateness; cyclic prerequisites cannot fabricate resources; browser/host/reload parity');
