'use strict';
const assert=require('node:assert/strict'),health=require('../vh2-health-engine'),{random}=require('../vh2-decision-engine');
const at=Date.parse('2026-09-12T12:00:00Z'),day=Math.floor(at/86400000);
let id;for(let n=0;n<10000;n++)if(random('health-test:'+n+'|health-onset|'+day)<12/365){id='health-test:'+n;break;}
assert(id);
const c={id,humanDynamics:{energy:80,stress:10},lifeRuntime:{environment:{temperature:35},activities:{goals:[]}},vh2Health:{policy:{enabled:true,illnessRatePerYear:12,recoveryScale:1},episode:null,events:[],lastAt:null,lastDay:null}};
health.advance(c,at);assert(c.vh2Health.episode);assert.equal(c.vh2Health.events.length,1);
const saved=JSON.stringify(c);health.advance(c,at);assert.equal(JSON.stringify(c),saved);
const continuous=JSON.parse(saved);let reloaded=JSON.parse(saved);
for(let n=1;n<=72*60;n++){health.advance(continuous,at+n*60000);health.advance(reloaded,at+n*60000);reloaded=JSON.parse(JSON.stringify(reloaded));}
assert.deepEqual(continuous,reloaded);assert(continuous.vh2Health.events.some(e=>e.kind==='health_recovered'));
assert.equal(health.context(continuous).feelingUnwell,false);assert.equal(continuous.humanDynamics.illnessSeverity,0);
const off=JSON.parse(saved);off.vh2Health.policy.enabled=false;health.advance(off,at+3600000);assert.equal(off.humanDynamics.illnessSeverity,0);assert.equal(health.context(off).feelingUnwell,false);assert.equal(health.context(off).symptoms,'');
const sick=JSON.parse(saved);health.advance(sick,at+8*3600000);assert(sick.humanDynamics.energy<80);assert(health.preference(sick,{kind:'recovery'})>health.preference(sick,{kind:'leisure'}));
const actor={id:'actor',energy:80,stress:10,action:{kind:'rest'}};health.advanceActor(c,actor,at);const actorSaved=JSON.stringify(actor);health.advanceActor(c,actor,at);assert.equal(JSON.stringify(actor),actorSaved);
console.log('PASS illness onset, recovery, bounded needs, rest preference, opt-out, actor idempotency, 72-hour minute/reload equivalence');
