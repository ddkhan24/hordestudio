'use strict';
const assert=require('node:assert/strict'),b=require('../vh2-social-bonds');
const D=86400000;
function fixture(){return {id:'a',lifeProfile:{socialCircle:[{id:'b',name:'Sam',closeness:0,trust:0}]},lifeRuntime:{world:{people:{b:{stress:95}}}},humanDynamics:{stress:0},vh2Plans:{plans:[]}};}
let c=fixture();b.advance(c,D);b.advance(c,30*D);assert.equal(c.vh2SocialBonds.pairs.b.self.meetings,0);
for(let i=0;i<12;i++){
 let now=(31+i*4)*D;c.vh2Plans.plans.push({id:'p'+i,personId:'b',status:'completed',completedAt:now,durationMinutes:30});b.advance(c,now);
 const once=JSON.stringify(c);b.advance(c,now);assert.equal(JSON.stringify(c),once,'repeated advance must be idempotent');
}
assert.equal(c.vh2SocialBonds.pairs.b.self.stage,'friend');
assert.ok(c.vh2SocialBonds.pairs.b.other.warmth<0,'reciprocal appraisal must permit asymmetry');
assert.equal(c.vh2SocialBonds.pairs.b.other.stage,'acquaintance');
assert.ok(!JSON.stringify(b.known(c)).includes('other'),'private counterpart appraisal excluded');
let copy=JSON.parse(JSON.stringify(c));b.advance(c,180*D);b.advance(copy,180*D);assert.deepEqual(c,copy);assert.equal(c.vh2SocialBonds.pairs.b.self.stage,'distant');
assert.throws(()=>b.advance(c,D),/backwards/);
let burst=fixture();b.advance(burst,D);for(let i=0;i<10;i++)burst.vh2Plans.plans.push({id:'x'+i,personId:'b',status:'completed',completedAt:D,durationMinutes:120});b.advance(burst,D);assert.equal(burst.vh2SocialBonds.pairs.b.self.meetings,3);assert.equal(burst.vh2SocialBonds.pairs.b.self.trust,0);
let missed=fixture();missed.vh2Plans.plans=[{id:'miss',personId:'b',status:'missed'}];b.advance(missed,D);assert.equal(missed.vh2SocialBonds.pairs.b.self.warmth,0,'missing a meeting is not proof of intentional rejection');
console.log('VH2 social bonds: repeated experience, asymmetry, privacy, quiet drift, restart, idempotency and daily bounds passed');
