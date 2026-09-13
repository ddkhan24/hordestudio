'use strict';
const assert=require('node:assert/strict'),presence=require('../vh2-presence-engine');
function make(kind='home'){return {id:'alex',lifeProfile:{places:[{id:'a',label:'Place A',kind},{id:'b',label:'Place B',kind}],socialCircle:[{id:'maya',name:'Maya'}]},lifeRuntime:{world:{placeId:'a',people:{maya:{placeId:'a',lastAt:1000}}}}};}
function step(c,at,availability='available'){if(c.lifeRuntime.world.people.maya)c.lifeRuntime.world.people.maya.lastAt=at;return presence.advance(c,at,availability);}
const c=make();step(c,1000);assert.equal(c.vh2Presence.visit.placeId,'a');assert.equal(presence.observed(c).length,0);
step(c,121000);assert.equal(presence.observed(c).length,1);assert.equal(c.vh2Presence.events.filter(e=>e.kind==='encounter').length,1);
const copy=JSON.parse(JSON.stringify(c));step(copy,181000);step(c,181000);assert.deepEqual(copy,c,'restart cannot duplicate notices');
c.lifeRuntime.world.journey={to:'b'};step(c,241000);assert.equal(c.vh2Presence.visit,null);assert.equal(presence.observed(c).length,0);
assert.equal(c.vh2Presence.visits[0].departedAt,241000);
c.lifeRuntime.world.journey=null;c.lifeRuntime.world.placeId='b';step(c,301000);assert.equal(c.vh2Presence.visit.placeId,'b');assert.equal(presence.observed(c).length,0);
c.lifeRuntime.world.placeId='a';step(c,361000);step(c,481000);assert.equal(c.vh2Presence.events.filter(e=>e.kind==='encounter').length,2,'a new visit can create a new encounter');
c.lifeRuntime.world.people.maya.placeId='b';step(c,541000);assert.equal(presence.observed(c).length,0);
const asleep=make();step(asleep,1000,'asleep');step(asleep,181000,'asleep');assert.equal(presence.observed(asleep).length,0);step(asleep,241000);assert.equal(presence.observed(asleep).length,1);
const large=make('study');step(large,1000);step(large,301000);assert.equal(presence.observed(large).length,0,'same campus does not prove noticing');
const cafe=make('social');cafe.lifeProfile.places[0].encounterScope='nearby';cafe.lifeProfile.places[0].noticeMinutes=1;step(cafe,1000);step(cafe,61000);assert.equal(presence.observed(cafe).length,1,'authored place scale controls noticing');
const broadHome=make();broadHome.lifeProfile.places[0].encounterScope='area';step(broadHome,1000);step(broadHome,301000);assert.equal(presence.observed(broadHome).length,0);
const stale=make();step(stale,1000);presence.advance(stale,301000,'available');assert.deepEqual(stale.vh2Presence.contacts,{},'stale routine position cannot establish continued presence');
assert.throws(()=>step(stale,1000),/backwards/);
console.log('PASS visits, transport exclusion, repeated encounters, restart, sleep, coarse places and stale routine positions');
