'use strict';
const assert=require('node:assert/strict'),kernel=require('../virtual_humans/engine/vh2-kernel-worker'),geo=require('../virtual_humans/engine/vh2-geography-engine');
const now=1788764400000;
function fixture(id='person'){
 const c=kernel.run({create:true,entityId:id,name:id,now}).companion;
 c.lifeProfile.places=[{id:'home',label:'Home',kind:'home'},{id:'cafe',label:'Cafe',kind:'other'},{id:'closed',label:'Closed cafe',kind:'other'}];
 c.lifeProfile.weeklySchedule=[];c.lifeProfile.activityOptions=[];c.lifeProfile.sleepPolicy.enabled=false;
 c.lifeProfile.world.transport={...c.lifeProfile.world.transport,enabled:true,goalTravel:true};
 c.lifeProfile.travelLegs=[{from:'home',to:'cafe',mode:'WALK',minutes:5,cost:0},{from:'cafe',to:'home',mode:'WALK',minutes:5,cost:0},{from:'home',to:'closed',mode:'WALK',minutes:1,cost:0}];
 c.lifeRuntime.world.placeId='home';c.lifeRuntime.world.balance=20;c.lifeRuntime.activities.goals=[];c.humanDynamics.hunger=85;c.humanDynamics.energy=80;
 c.vh2Decision.policy={temperature:0,exploration:0,minHoldMinutes:0,reconsiderMinutes:5,urgentHunger:90,urgentEnergy:10};
 c.vh2Geography={enabled:true,places:{home:{capabilities:['rest']},cafe:{capabilities:['food'],mealCost:4,hours:null},closed:{capabilities:['food'],mealCost:1,closed:true}},knownPlaceIds:['home','cafe','closed']};return c;
}
let c=fixture();for(let i=1;i<=40;i++)c=kernel.run({companion:c,now:now+i*60000}).companion;
assert.equal(c.lifeRuntime.world.placeId,'cafe');assert.ok(c.humanDynamics.hunger<45,JSON.stringify(c.humanDynamics));assert.equal(c.lifeRuntime.world.balance,16);assert.ok(!c.lifeRuntime.world.journey,'no forced return home');
assert.ok(c.vh2Geography.experiences.cafe.visits>=1);assert.ok(c.vh2Geography.decisions.some(d=>d.candidates.some(x=>x.excluded==='closed')));
const poor=fixture('poor');poor.lifeRuntime.world.balance=1;geo.propose(poor,now,()=>({hour:10,minute:0,weekday:1}));assert.ok(!poor.lifeRuntime.activities.goals.some(g=>g.kind==='meal'));
const unknown=fixture('unknown');unknown.vh2Geography.knownPlaceIds=['home'];unknown.lifeProfile.travelLegs.forEach(l=>l.minutes=40);geo.propose(unknown,now,()=>({hour:10,minute:0,weekday:1}));assert.ok(!unknown.lifeRuntime.activities.goals.some(g=>g.kind==='meal'));
const discover=fixture('discover');discover.vh2Geography.knownPlaceIds=['home'];geo.propose(discover,now,()=>({hour:10,minute:0,weekday:1}));assert.ok(discover.vh2Geography.discoveries.some(x=>x.placeId==='cafe'&&!x.visited));
const routine=fixture();routine.lifeProfile.weeklySchedule=[{id:'soft',flexibility:'soft'},{id:'work',flexibility:'fixed'}];assert.deepEqual(geo.schedule(routine).map(b=>b.id),['work']);assert.equal(routine.lifeProfile.weeklySchedule.length,2);
let a=fixture('repeat'),b=JSON.parse(JSON.stringify(a));for(let i=1;i<=40;i++)a=kernel.run({companion:a,now:now+i*60000}).companion;for(let i=1;i<=40;i++)b=kernel.run({companion:JSON.parse(JSON.stringify(b)),now:now+i*60000}).companion;assert.deepEqual(a,b);
console.log('PASS: travel to food, pay once, eat after arrival, remain at destination, closed/unaffordable/unknown places excluded, soft routines retained but not enforced, deterministic persistence.');

const free=fixture('free');free.humanDynamics.hunger=20;free.humanDynamics.socialNeed=85;free.vh2Geography.places.home.capabilities=['rest','exercise'];free.lifeProfile.socialCircle=[{id:'friend',name:'Sam',contactWindows:[{days:[1],startMinute:0,endMinute:1440}]}];geo.propose(free,now,()=>({weekday:1,hour:10,minute:0}));for(const word of ['Work out','personal interest','quiet break'])assert.ok(free.lifeRuntime.activities.goals.some(g=>g.label.includes(word)),word);assert.ok(!free.lifeRuntime.activities.goals.some(g=>g.id.startsWith('geo:call:')),'calls must reserve real participants through the canonical plan store');
console.log('PASS: free time offers place-bound exercise, interests and deliberate rest; calls require canonical shared plans.');
