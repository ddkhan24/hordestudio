'use strict';
const assert=require('node:assert/strict'),engine=require('../vh2-psychology-engine'),decision=require('../vh2-decision-engine');
function fixture(){return {mood:{valence:0},lifeRuntime:{activities:{goals:[{id:'g',opportunityId:'walk',definitionKey:'v1',startedAt:1,steps:[{energy:-2,stress:-12,hunger:1}]}],events:[]},world:{events:[]}}};}
function outcome(c,id,kind='completed'){c.lifeRuntime.activities.events.push({id,goalId:'g',kind,at:c.lifeRuntime.activities.events.length+100,summary:kind+' walk'});engine.advance(c,1000);}
const c=fixture();engine.ensure(c);outcome(c,'e1');assert(c.mood.valence>0);assert(engine.experienceScore(c,c.lifeRuntime.activities.goals[0])>0);
const before=JSON.stringify(c);engine.advance(c,1000);assert.equal(JSON.stringify(c),before,'no duplicate appraisal');
const reload=JSON.parse(before);outcome(c,'e2');outcome(reload,'e2');assert.deepEqual(c,reload,'replay/reload identical');
const renamed={...c.lifeRuntime.activities.goals[0],definitionKey:'v2'};assert.equal(engine.experienceScore(c,renamed),0,'changed activity is not assigned stale preferences');
const off=fixture();engine.ensure(off).policy.enabled=false;outcome(off,'off');assert.equal(off.mood.valence,0);assert.equal(off.vh2Psychology.episodes.length,0);
const missed=fixture();engine.ensure(missed);outcome(missed,'miss','missed');assert(missed.mood.valence<0);
const unchosen=fixture();unchosen.lifeRuntime.activities.goals[0].startedAt=0;engine.ensure(unchosen);outcome(unchosen,'miss','missed');assert.equal(unchosen.mood.valence,0,'unchosen expired option is not a personal failure');
for(let i=0;i<300;i++){outcome(c,'next'+i);c.lifeRuntime.activities.events=c.lifeRuntime.activities.events.slice(-150);}
assert.equal(c.vh2Psychology.episodes.length,200);engine.advance(c,1000);const stable=JSON.stringify(c);engine.advance(c,1000);assert.equal(JSON.stringify(c),stable,'buffer rotation never repeats surviving events');
for(let i=0;i<12;i++)outcome(missed,'disappointment'+i,'missed');
const learnedPositive=engine.experienceScore(c,c.lifeRuntime.activities.goals[0]),learnedNegative=engine.experienceScore(missed,missed.lifeRuntime.activities.goals[0]);
let positive=0,negative=0;
for(let seed=0;seed<100;seed++){
 const candidates=[{id:'walk',steps:[{}],stepIndex:0},{id:'read',steps:[{}],stepIndex:0}];
 const choose=experience=>decision.select({},candidates,100,{seed:String(seed),energy:70,hunger:20},g=>({score:g.id==='walk'?experience:0,components:{experience:g.id==='walk'?experience:0}})).id;
 if(choose(learnedPositive)==='walk')positive++;if(choose(learnedNegative)==='walk')negative++;
}
const priorMood=c.mood.valence;engine.advance(c,1000+3*3600000);assert(Math.abs(c.mood.valence-priorMood/2)<1e-8,'transient affect decays without erasing learned preferences');
assert(positive>negative);console.log(`PASS bounded experience, inference provenance, opt-out, reload, no duplicate appraisal, definition isolation; paired choices ${positive} positive vs ${negative} negative out of 100`);
const social=fixture();social.id='main';social.emotionState={felt:{joy:0,sadness:0,anticipation:0}};social.vh2Plans={plans:[{id:'group',status:'accepted'}],events:[]};engine.ensure(social);
social.vh2Plans.events.push({id:'private-peer',kind:'shared_plan',phase:'completed',outcome:'shared_activity_completed',at:1,summary:'Private activity',participantIds:['a','b'],observerIds:['a','b']});engine.advance(social,1000);assert.equal(social.vh2Psychology.episodes.length,0,'Unobserved plans cannot shape feelings');
social.vh2Plans.events.push({id:'accepted',kind:'shared_plan',planId:'group',phase:'accepted',at:2,summary:'An agreed outing',participantIds:['main','a']});engine.advance(social,1000);assert(social.emotionState.felt.anticipation>0);assert.equal(social.emotionState.felt.joy,0,'Acceptance is not a completed experience');
social.vh2Plans.events.push({id:'done',kind:'shared_plan',planId:'group',phase:'completed',outcome:'shared_activity_completed',at:3,summary:'Attended together',participantIds:['main','a']});engine.advance(social,1000);assert(social.emotionState.felt.joy>0);assert.equal(social.vh2Psychology.episodes.at(-1).appraisal.factors.responsibility,'not_established');
const emotions=JSON.stringify(social.emotionState);engine.advance(social,1000);assert.equal(JSON.stringify(social.emotionState),emotions,'Reload cannot reward the same social experience twice');
console.log('PASS observed social anticipation/completion, private perspective isolation, bounded emotional consequences and no repeated credit');
