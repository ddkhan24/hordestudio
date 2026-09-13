'use strict';
const assert=require('node:assert/strict'),plans=require('../vh2-plans-engine'),activity=require('../vh-activity-engine');
const now=1788764400000,minute=60000;
const core={companionLocalMinuteInfo:()=>({weekday:1,hour:8,minute:0}),companionSeededRoll:()=>.1};
function make(){return {id:'alex',lifeProfile:{seed:'test',socialCircle:[{id:'jo',name:'Jo',closeness:80,tension:0,contactWindows:[{days:[1],startMinute:0,endMinute:1440}]}],travelLegs:[],world:{people:[{personId:'jo',placeId:'home',days:[1],start:0,end:1440}]}},lifeRuntime:{activities:activity.normalize({}),world:{placeId:'home',people:{jo:{placeId:'home',energy:80}}}}};}
function propose(c){plans.command(c,{type:'propose_plan',planId:'meeting',personId:'jo',placeId:'home',startsAt:now+10*minute,endsAt:now+30*minute,durationMinutes:5,label:'Catch up'},now);plans.before(c,now+minute,core);return c.vh2Plans.plans[0];}
const c=make(),p=propose(c);assert.equal(p.status,'accepted');
assert.equal(plans.canMeet(c,p.id,now,core.companionLocalMinuteInfo),false);
assert.equal(plans.canMeet(c,p.id,now+10*minute,core.companionLocalMinuteInfo),true);
c.lifeRuntime.world.journey={};assert.equal(plans.canMeet(c,p.id,now+10*minute,core.companionLocalMinuteInfo),false);c.lifeRuntime.world.journey=null;
c.lifeRuntime.world.people.jo.placeId='elsewhere';assert.equal(plans.canMeet(c,p.id,now+10*minute,core.companionLocalMinuteInfo),false);
const goal=c.lifeRuntime.activities.goals[0];
activity.advance(c.lifeRuntime.activities,now+15*minute,{availability:'available',placeId:'home',meetingAvailable:()=>false});assert.equal(goal.steps[0].progressMs,0,'no phantom shared activity');
c.lifeRuntime.world.people.jo.placeId='home';
activity.advance(c.lifeRuntime.activities,now+20*minute,{availability:'available',placeId:'home',meetingAvailable:()=>true});plans.after(c,now+20*minute);assert.equal(p.status,'completed');
const declined=make();declined.lifeProfile.world.people[0].placeId='work';assert.equal(propose(declined).status,'declined');
const silent=make();silent.lifeRuntime.world.people.jo.energy=10;const unanswered=propose(silent);assert.equal(unanswered.status,'proposed');plans.before(silent,now+11*minute,core);assert.equal(unanswered.status,'expired');
const cancelled=make();const cp=propose(cancelled);plans.command(cancelled,{type:'cancel_plan',planId:cp.id},now+2*minute);assert.equal(cancelled.lifeRuntime.activities.goals[0].status,'abandoned');
const missed=make(),mp=propose(missed);plans.after(missed,now+31*minute);assert.equal(mp.status,'missed');
const resting=make(),rp=propose(resting);resting.lifeRuntime.world.people.jo.restUntil=now+60*minute;plans.before(resting,now+11*minute,core);assert.equal(rp.status,'cancelled');
console.log('PASS shared-plan decisions, attendance gates, activity execution, cancellation, silence and missed outcomes');

const long=make();plans.ensure(long);
long.vh2Plans.plans=Array.from({length:100},(_,i)=>({id:'old'+i,status:i===0?'accepted':'completed'}));
plans.command(long,{type:'propose_plan',planId:'new',personId:'jo',placeId:'home',startsAt:now+minute,endsAt:now+30*minute,durationMinutes:5,label:'New plan'},now);
assert.equal(long.vh2Plans.plans.length,100);assert.equal(long.vh2Plans.plans[0].id,'old0','never evict unfinished plans');assert.equal(long.vh2Plans.plans.at(-1).id,'new','past plans must not impose a lifetime limit');
