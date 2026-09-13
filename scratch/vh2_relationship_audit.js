'use strict';
const assert=require('node:assert/strict'),core=require('../vh-simulation-core'),psy=require('../vh2-psychology-engine'),worker=require('../vh2-kernel-worker');
const start=1788764400000;
const make=traits=>{const c=worker.run({create:true,name:'Alex',entityId:'alex',now:start}).companion;psy.ensure(c).relationshipPolicy={...psy.RELATIONSHIP_DEFAULTS,...traits};return c;};
let seq=0;
function exchange(c,at,interpretation='support'){
 const id='m'+(++seq),text='I am here for you';
 return psy.appraiseConversation(c,{personaId:'player',messages:[{id,role:'user',text,readAt:at}],proposals:[{sourceMessageId:id,evidence:text,interpretation,confidence:1}]},at);
}
const initial=core.normalizeCompanionRelationshipDimensions({},20,7);
assert.equal(initial.trust,20);assert.equal(initial.familiarity,14);assert.equal(initial.attraction,0);
assert.equal(core.normalizeCompanionRelationshipDimensions({trust:-30},20).trust,-30);
const profile=worker.run({create:true,name:'Alex',entityId:'copy',now:start,profile:{startingRelationship:20,knownBeforeDays:7,emotionExpression:'transparent',lifeProfile:{}}}).companion;
assert.equal(profile.relationshipDynamics.trust,20);assert.equal(profile.relationshipDynamics.familiarity,14);assert.equal(profile.emotionExpression,'transparent');
const fresh=make();for(let n=0;n<30;n++)exchange(fresh,start+n*1000);
assert.equal(fresh.relationshipDynamics.warmth,0);assert.equal(fresh.relationshipDynamics.trust,0);assert.equal(fresh.vh2Psychology.relationshipEvidence.positiveExchanges,1);
const open=make({guardedness:0,trustOpenness:100}),guarded=make({guardedness:100,trustOpenness:0});
for(const c of [open,guarded])for(const hours of [0,1,24])exchange(c,start+hours*3600000);
assert.ok(open.relationshipDynamics.comfort>guarded.relationshipDynamics.comfort);
assert.ok(open.relationshipDynamics.trust>0);assert.equal(guarded.relationshipDynamics.trust,0);
const friendly=make({friendliness:100,minPositiveSpanHours:0,minPositiveExchanges:1}),reserved=make({friendliness:0,minPositiveSpanHours:0,minPositiveExchanges:1});
exchange(friendly,start,'enjoyment');exchange(reserved,start,'enjoyment');assert.ok(friendly.relationshipDynamics.warmth>reserved.relationshipDynamics.warmth);assert.equal(friendly.relationshipDynamics.trust,0);
const sensitive=make({rejectionSensitivity:100}),steady=make({rejectionSensitivity:0});exchange(sensitive,start,'hostility');exchange(steady,start,'hostility');assert.ok(sensitive.relationshipDynamics.trust<steady.relationshipDynamics.trust);
const capped=make({dailyLimit:.25,cooldownMinutes:1});for(let n=0;n<30;n++)exchange(capped,start+n*60000,'hostility');assert.ok(capped.relationshipDynamics.trust>=-.250001);assert.ok(capped.relationshipDynamics.resentment<=.250001);
const before=structuredClone(capped.relationshipDynamics);psy.ensure(capped).relationshipPolicy.enabled=false;exchange(capped,start+86400000,'hostility');assert.deepEqual(capped.relationshipDynamics,before);
for(const c of [fresh,open,guarded,friendly,reserved,sensitive,steady,capped]){assert.equal(c.relationshipDynamics.attraction,0);assert.equal(c.mood.relationship,0);}
console.log('Relationship baseline, personality divergence, first-contact restraint, spam resistance, daily budget and disabling passed.');
