'use strict';
const assert=require('node:assert/strict'),npc=require('../vh2-npc-travel');
const start=1788764400000,minute=60000;
const c={id:'alex',lifeProfile:{socialCircle:[{id:'jo',name:'Jo'}],world:{people:[{personId:'jo',placeId:'home',days:[1],start:0,end:10},{personId:'jo',placeId:'work',days:[1],start:10,end:1440}]},travelLegs:[{from:'home',to:'park',minutes:5,mode:'WALK',cost:0},{from:'park',to:'work',minutes:7,mode:'WALK',cost:0}]},lifeRuntime:{world:{people:{jo:{placeId:'home',lastAt:start}}}}};
const local=(c,at)=>({weekday:1,hour:0,minute:(at-start)/minute});
function advance(at){const p=c.lifeRuntime.world.people.jo;p.placeId=at-start>=10*minute?'work':'home';p.lastAt=at;if(at-start>=10*minute){p.goal='Work task';p.progress=20;p.goalCompleted=true;}npc.advance(c,at,local);}
advance(start);advance(start+10*minute);assert.equal(c.lifeRuntime.world.people.jo.placeId,'');assert.equal(c.vh2NpcTravel.people.jo.journey.to,'park');assert.equal(c.lifeRuntime.world.people.jo.goalCompleted,undefined,'cannot finish work while travelling there');
advance(start+14*minute);assert.equal(c.lifeRuntime.world.people.jo.travel.progress,.8);assert.equal(c.lifeRuntime.world.people.jo.placeId,'','no presence at the destination while travelling');
advance(start+15*minute);assert.equal(c.vh2NpcTravel.people.jo.journey.to,'work');advance(start+22*minute);assert.equal(c.lifeRuntime.world.people.jo.placeId,'work');
const copy=JSON.parse(JSON.stringify(c));npc.advance(copy,start+22*minute,local);assert.deepEqual(copy,c,'reload/same-time evaluation cannot duplicate a journey');
assert.equal(npc.path([{from:'a',to:'b',minutes:1,mode:'DRIVE',cost:0}],'a','b'),null,'do not assume someone owns a car');
const blocked=JSON.parse(JSON.stringify(c));blocked.vh2NpcTravel.people.jo.placeId='unknown';npc.advance(blocked,start+23*minute,local);assert.equal(blocked.lifeRuntime.world.people.jo.placeId,'unknown');assert.match(blocked.vh2NpcTravel.people.jo.blockedReason,/No known/);
console.log('PASS supporting-person multi-leg walking, elapsed travel, restart, no teleportation and missing-route behavior');
