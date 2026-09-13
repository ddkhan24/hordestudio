'use strict';
const assert=require('node:assert/strict'),{fixture,local,start,MIN}=require('./vh2_people_audit'),e=require('../vh2-people-engine');
function sample(){const c=fixture(),a=c.vh2People.actors.sam;c.lifeProfile.travelLegs=[];a.policy.leisurePlaceIds=['home'];a.policy.curiosity=100;c.vh2People.actors.jo={...JSON.parse(JSON.stringify(a)),id:'jo'};c.vh2People.network={enabled:true,lastAt:start,pairs:{},events:[]};return c;}
let a=sample(),b=sample();e.advance(a,start+1440*MIN,local);for(let t=start;t<=start+1440*MIN;t+=MIN)e.advance(b,t,local);assert.deepEqual(a,b);assert.ok(a.vh2People.network.events.length);assert.ok(a.vh2People.network.events.every(x=>x.scope==='private_world_fact'));assert.equal(a.vh2Signals,undefined);let saved=JSON.parse(JSON.stringify(a));e.advance(a,start+2880*MIN,local);e.advance(saved,start+2880*MIN,local);assert.deepEqual(a,saved);
a=sample();a.vh2People.actors.jo.placeId='elsewhere';e.advance(a,start+60*MIN,local);assert.equal(a.vh2People.network.events.length,0);
a=sample();a.vh2People.network.enabled=false;e.advance(a,start+1440*MIN,local);assert.equal(a.vh2People.network.events.length,0);
console.log('NPC network: private co-presence evidence, consequences, separated places, opt-in, batching and replay passed.');
