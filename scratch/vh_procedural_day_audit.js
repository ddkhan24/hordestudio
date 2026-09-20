// Accelerated, offline integration scenarios through the production kernel.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext } = require('./app_source');
const activity = require('../virtual_humans/engine/vh-activity-engine');
const conversation = require('../virtual_humans/engine/vh-conversation-engine');
const worker = require('../virtual_humans/engine/vh-host-worker');
const ctx = { console, state: { globalSettings: {}, personas: [], companions: [], companionTimelines: {}, companionThreads: {} } };
buildContext(vm, ['normalizeCompanion', 'normalizeCompanionCommitment', 'advanceCompanionLife', 'advanceCompanionHumanDynamics', 'companionAttentionContext', 'advanceCompanionMessageAttention', 'buildCompanionContextPacket'], ctx);
const t = Date.UTC(2026,8,8,9), minute = 60000;
const clone = value => JSON.parse(JSON.stringify(value));
const options = [
    { id:'project', kind:'focus', label:'a draft for a class', days:[2], startMinute:540, endMinute:780, priority:55 },
    { id:'friend', kind:'contact', participantId:'friend', label:'Talk with Jo', days:[2], startMinute:600, endMinute:660, priority:65 },
    { id:'supplies', kind:'focus', label:'an art project needing supplies', days:[2], startMinute:540, endMinute:570, priority:80, costs:{supplies:2} }
];
function person() { return ctx.normalizeCompanion({ id:'day',name:'Ada',age:28,locationMode:'custom',timezoneOffsetMinutes:0,
    lifeProfile:{ initializedAt:t, seed:'day-seed', socialCircle:[{id:'friend',name:'Jo',role:'friend',contactFrequency:'daily',contactWindows:[{days:[2],startMinute:600,endMinute:630}]}], activityOptions:options },
    lifeRuntime:{lastSimulatedAt:t, activities:{lastAdvancedAt:t}, temporarySituation:{activity:'At home',availability:'available',startedAt:t,endsAt:t+12*60*minute}},
    humanDynamics:{energy:90,stress:10,hunger:0,lastUpdated:t},mood:{lastUpdated:t},emotionState:{lastUpdated:t} }); }
function run({promise=false,reload=false,unavailable=false}={}) {
    let c=person(); if(unavailable)c.lifeProfile.socialCircle[0].contactWindows=[];
    for(let m=0;m<=720;m++) {
        const at=t+m*minute;
        if(promise && m===2)c.commitments.push(ctx.normalizeCompanionCommitment({id:'promise',text:'Send the draft after preparing it',medium:'text',status:'pending',createdAt:at,dueAt:t+25*minute}));
        ctx.advanceCompanionLife(c,at);ctx.advanceCompanionHumanDynamics(c,at);
        if(reload && m%17===0)c=ctx.normalizeCompanion(clone(c));
    }
    return c;
}
const plain=run(), changed=run({promise:true}), restored=run({promise:true,reload:true});
assert.deepEqual(clone(changed.lifeRuntime.activities),clone(restored.lifeRuntime.activities));
assert.deepEqual(clone(changed.humanDynamics),clone(restored.humanDynamics));
const byOption=(c,id)=>c.lifeRuntime.activities.goals.find(goal=>goal.opportunityId===id);
assert.equal(byOption(plain,'supplies').status,'abandoned');
assert.equal(byOption(plain,'supplies').steps[0].progressMs,0);
assert.equal(byOption(plain,'project').status,'completed');
assert(byOption(changed,'project').completedAt>byOption(plain,'project').completedAt);
assert.equal(changed.lifeRuntime.activities.goals.find(goal=>goal.commitmentId==='promise').status,'completed');
assert.equal(changed.commitments[0].status,'pending','preparation is not fulfillment');
assert.equal(changed.lifeRuntime.socialWorld.interactions.filter(item=>item.personId==='friend').length,1);
assert.equal(byOption(changed,'friend').status,'completed');
const unavailable=run({unavailable:true});
assert.equal(byOption(unavailable,'friend').status,'abandoned');
assert.equal(unavailable.lifeRuntime.socialWorld.interactions.length,0);
console.log('PASS competing goals, chat promise changes the day, missing supplies, real contact windows, no duplicate social events, reload parity');
// Persisted durations are stable. A cancelled or moved promise cannot duplicate work.
const s=activity.normalize({lastAdvancedAt:t});
const p={id:'p',text:'Call later',status:'pending',createdAt:t,dueAt:t+60*minute};
const plan={dateKey:'2026-09-08',weekday:2,midnight:t-540*minute,seed:'x',opportunities:[],people:[],commitments:[p]};
activity.plan(s,t,plan);p.dueAt+=60*minute;activity.plan(s,t+minute,plan);
assert.equal(s.goals.length,1);assert.equal(s.goals[0].deadline,p.dueAt);
p.status='cancelled';activity.plan(s,t+2*minute,plan);assert.equal(s.goals[0].status,'abandoned');
console.log('PASS meaningful commitment rescheduling and cancellation preserve one preparation job');
const edited=activity.normalize({lastAdvancedAt:t});
const catalog={...plan,commitments:[],opportunities:[{id:'task',kind:'focus',label:'First draft',days:[2],startMinute:540,endMinute:780}]};
activity.plan(edited,t,catalog);
activity.advance(edited,t+minute,{availability:'available',energy:90});
const original=edited.goals[0];
catalog.opportunities[0].label='Revised draft';
activity.plan(edited,t+minute,catalog);
assert.equal(original.status,'abandoned');
assert.equal(original.steps[0].progressMs,minute);
assert.equal(edited.goals.filter(goal=>goal.status!=='abandoned').length,1);
activity.plan(edited,t+2*minute,catalog);
assert.equal(edited.goals.length,2);
console.log('PASS changed opportunities replan without overwriting past progress or duplicating new work');

// Interest affects attention only through a grounded prior reaction.
const c=person();c.lifeRuntime.activities=activity.normalize({lastAdvancedAt:t});
const goal=activity.addGoal(c.lifeRuntime.activities,'focus','focus',t);
activity.advance(c.lifeRuntime.activities,t+minute,{availability:'available',energy:90});
const at=t+minute;
const source={id:'source',role:'user',text:'Want to discuss that draft?',timestamp:t,readAt:t};
c.continuityRuntime.conversation=conversation.receive({}, {reaction:{summary:'Interested in discussing the draft',evidence:'discuss that draft',engagement:95,lingerMinutes:60}},[source],t);
const experience={realTimeLife:true,replyDelays:true,allowNoReply:true};
const context=ctx.companionAttentionContext(c,at,experience);assert(context.canMakeTime);
const input={id:'new',role:'user',type:'text',text:'Which part?',timestamp:at,deliveredAt:at,awaitingReply:true};
ctx.advanceCompanionMessageAttention(c,input,at,experience,[input]);
assert.equal(input.attention.stage,'ready');assert.equal(goal.status,'paused');
const progress=goal.steps[0].progressMs;
const reservedUntil=c.lifeRuntime.activities.conversationUntil;
activity.advance(c.lifeRuntime.activities,Math.floor((at+reservedUntil)/2),{availability:'available',energy:90});
assert.equal(goal.steps[0].progressMs,progress,'replying reserves time instead of double-booking activity');
assert.equal(activity.reserveAttention(c.lifeRuntime.activities,at+minute,'new'),false);
activity.advance(c.lifeRuntime.activities,reservedUntil+minute,{availability:'available',energy:90});
assert(goal.steps[0].progressMs>progress);
c.lifeRuntime.temporarySituation.availability='asleep';
assert(!ctx.companionAttentionContext(c,at,experience).canMakeTime);
c.lifeRuntime.temporarySituation.availability='available';c.humanDynamics.cooldownUntil=at+10*minute;
assert(!ctx.companionAttentionContext(c,at,experience).canMakeTime);
console.log('PASS grounded interest makes room for a reply, time is reserved once, work resumes, sleep and boundaries win');
// Same initialized snapshot has the same outcomes in the local host adapter.
let browser=person(), host={companion:clone(browser),messages:[],experience};
for(let m=0;m<=120;m++) {
    const now=t+m*minute;
    ctx.advanceCompanionLife(browser,now);ctx.advanceCompanionHumanDynamics(browser,now);
    // Worker also advances emotions: compare the activity/social mechanics here.
    host=worker.run({...host,experience,now});
}
assert.deepEqual(clone(browser.lifeRuntime.activities),host.companion.lifeRuntime.activities);
assert.deepEqual(clone(browser.lifeRuntime.socialWorld),host.companion.lifeRuntime.socialWorld);
console.log('PASS browser and host execute the same procedural day and supporting-person contact');
