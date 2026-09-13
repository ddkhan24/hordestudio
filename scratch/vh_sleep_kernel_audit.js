const assert=require('node:assert/strict'),vm=require('node:vm');
const {buildContext}=require('./app_source'),engine=require('../vh-activity-engine'),worker=require('../vh-host-worker'),conversation=require('../vh-conversation-engine');
const minute=60000,t=Date.UTC(2026,8,8,22),clone=x=>JSON.parse(JSON.stringify(x));
const base={energy:65,hunger:20,stress:10,canRest:true,preferred:true};
const seed=pressure=>engine.normalizeSleep({stage:'tired',pressure,lastAt:t,lastWakeAt:t-15*3600000});
const engaged=engine.advanceSleep(seed(65),t+5*minute,{...base,engaged:true});
const quiet=engine.advanceSleep(seed(65),t+5*minute,base);
assert.equal(engaged.stage,'drowsy');assert.equal(quiet.stage,'winding_down');
assert.equal(engine.advanceSleep(quiet,t+10*minute,base).stage,'winding_down');
const sleeping=engine.advanceSleep(quiet,t+15*minute,base);assert.equal(sleeping.stage,'asleep');
assert.notEqual(engine.advanceSleep(seed(99),t+5*minute,{...base,canRest:false}).stage,'asleep');
assert.equal(engine.advanceSleep(quiet,t+15*minute,{...base,canRest:false}).stage,'drowsy');
assert.equal(engine.advanceSleep(seed(10),t+5*minute,{...base,preferred:false,boring:true}).stage,'awake');
const hungry=engine.advanceSleep(seed(35),t+5*minute,{...base,hunger:95}),fed=engine.advanceSleep(seed(35),t+5*minute,{...base,hunger:10});assert(hungry.irritability>fed.irritability);
let waking=sleeping;for(let n=20;n<=495&&waking.stage!=='waking';n+=5)waking=engine.advanceSleep(waking,t+n*minute,{...base,preferred:false});assert.equal(waking.stage,'waking');
assert.match(conversation.physicalBrief({humanDynamics:{sleep:hungry,hunger:95}}),/not anger at the player/);
const ctx={console,state:{globalSettings:{},personas:[],companions:[],companionTimelines:{},companionThreads:{}}};
buildContext(vm,['normalizeCompanion','advanceCompanionLife','advanceCompanionHumanDynamics','advanceCompanionEmotionState','companionSituationAt','companionConversationTransition'],ctx);
function person(){return ctx.normalizeCompanion({id:'sleep-test',name:'Ada',age:28,locationMode:'custom',timezoneOffsetMinutes:0,sleepArchetype:'normal',libidoEnabled:false,lifeWildcardsEnabled:false,lifeWeatherEnabled:false,lifeProfile:{initializedAt:t,places:[{id:'home',label:'Home',kind:'home'}],weeklySchedule:[],sleepPolicy:{enabled:true}},lifeRuntime:{lastSimulatedAt:t,activities:{lastAdvancedAt:t}},humanDynamics:{energy:65,stress:10,hunger:20,lastUpdated:t,sleep:seed(65)},mood:{lastUpdated:t},emotionState:{lastUpdated:t}});}
function replay(host=false,reload=false){let c=person();const stages=new Set();for(let n=0;n<=2880;n+=5){const now=t+n*minute;if(host)c=worker.run({companion:c,messages:[],now}).companion;else{ctx.advanceCompanionLife(c,now);ctx.advanceCompanionHumanDynamics(c,now);ctx.advanceCompanionEmotionState(c,now);}stages.add(c.humanDynamics.sleep.stage);if(reload)c=ctx.normalizeCompanion(clone(c));}return {c,stages};}
const live=replay(),restored=replay(false,true),host=replay(true);assert(live.stages.has('asleep'));assert(live.stages.has('waking'));assert(live.stages.has('winding_down'));assert.deepEqual(clone(live.c.humanDynamics),clone(restored.c.humanDynamics));assert.deepEqual(clone(live.c.humanDynamics),clone(host.c.humanDynamics));
const c=person();c.humanDynamics.sleep=quiet;const transition=ctx.companionConversationTransition(c,[{role:'user',timestamp:t+4*minute},{role:'companion',timestamp:t+4*minute}],t+5*minute);assert(transition.engaged);assert.equal(transition.upcoming.availability,'asleep');assert.equal(transition.upcoming.at,t+15*minute);c.humanDynamics.sleep=sleeping;assert.equal(ctx.companionSituationAt(c,t+15*minute).availability,'asleep');
console.log('PASS staged sleep, engaged delay, wind-down, blocked rest, boredom, hunger irritability, waking, handoff deadline, and 48-hour browser/host/reload parity');

const evening=engine.advanceSleep(quiet,t+15*minute,{...base,preferred:false,hoursUntilBed:1});assert.equal(evening.nap,false,'near-bedtime sleep must not become a repeating short nap');
const afternoon=engine.advanceSleep(quiet,t+15*minute,{...base,preferred:false,hoursUntilBed:7});assert.equal(afternoon.nap,true);
const paused=person();paused.initiativeMode='balanced';paused.continuityRuntime.conversation={status:'paused',topic:'weekend plans',openQuestion:'Cafe or park?',resumeReason:'Finished the errand',resumeAfter:t,updatedAt:t};
const due=worker.run({companion:paused,messages:[],now:t});assert.equal(due.followupDueAt,t);assert.match(due.dialogueGuidance,/Cafe or park/);
const sent=worker.run({companion:due.companion,messages:[],now:t,commit:{state:{},text:'Cafe works'}});assert.equal(sent.companion.continuityRuntime.conversation.resumeAfter,0);assert.equal(sent.companion.continuityRuntime.conversation.status,'active');
const rescheduled=person();rescheduled.initiativeMode='balanced';rescheduled.continuityRuntime.conversation={status:'paused',topic:'plans',resumeReason:'Return now',resumeAfter:t};
const future=worker.run({companion:rescheduled,messages:[],now:t,commit:{state:{conversation:{status:'paused',resumeAfter:t+3600000,resumeReason:'A new interruption'}},text:'Back in a while'}});assert.equal(future.companion.continuityRuntime.conversation.resumeAfter,t+3600000,'committing a return cannot erase a newly scheduled interruption');
// Startup regression: before a preferred wake time, modulo 24 is not awake history.
const morning=Date.UTC(2026,8,11,15); // 08:00 in Phoenix, night owl normally wakes at 10.
const startedEarly=engine.advanceSleep(null,morning,{energy:65,hunger:30,stress:15,preferred:true,hoursSinceWake:22,hoursIntoSleep:5,wasAsleep:false,canRest:false});
assert.equal(startedEarly.stage,'awake');assert.equal(startedEarly.lastWakeAt,morning);assert.equal(startedEarly.sleepStartedAt,0);assert(startedEarly.pressure<30);assert.equal(startedEarly.initializationVersion,2);
let early=startedEarly;for(let n=5;n<=180;n+=5)early=engine.advanceSleep(early,morning+n*minute,{energy:65,hunger:30,stress:15,preferred:n<120,canRest:true,occupied:false,hoursUntilBed:19-n/60});assert.notEqual(early.stage,'asleep','a healthy early start must not manufacture a morning all-nighter crash');
const genuine=engine.advanceSleep(null,morning,{energy:65,preferred:true,hoursSinceWake:22,hoursIntoSleep:5,wasAsleep:true});assert.equal(genuine.stage,'asleep');assert.equal(genuine.sleepStartedAt,morning-5*3600000);
const conversationAtBed=engine.advanceSleep(null,morning,{energy:65,preferred:true,hoursSinceWake:22,hoursIntoSleep:5,wasAsleep:true,engaged:true});assert.equal(conversationAtBed.sleepStartedAt,0,'an engaged awake bootstrap must not invent a sleep onset');
const realExhaustion=engine.advanceSleep({...seed(96),lastAt:morning,lastWakeAt:morning-23*3600000},morning+5*minute,{energy:20,preferred:false,canRest:true});assert.equal(realExhaustion.stage,'winding_down','recorded exhaustion still causes sleep');
console.log('PASS sleep bootstrap: early rising, existing sleep, engagement, and genuine exhaustion remain distinct.');
