"use strict";
// Perception observes sources. The canonical geography/activity planner owns movement.
const assert=require('node:assert/strict'),engine=require('../vh2-exploration-engine'),geo=require('../vh2-geography-engine'),kernel=require('../vh2-kernel-worker'),travel=require('../vh2-travel-engine');
const now=1788764400000,local=()=>({hour:10,minute:0,weekday:1});
function fixture(seed,hot=false){
 const c=kernel.run({create:true,entityId:'exploration:'+seed,name:'Example',now}).companion;
 c.lifeProfile.places=[{id:'home',kind:'home',label:'Home'},{id:'park',kind:'social',label:'Park'},{id:'cafe',kind:'social',label:'Cafe'},{id:'pool',kind:'social',label:'Pool'}];c.lifeProfile.weeklySchedule=[];c.lifeProfile.sleepPolicy.enabled=false;c.lifeProfile.activityOptions=[];
 c.lifeProfile.travelLegs=['park','cafe','pool'].flatMap(to=>[{from:'home',to,mode:'WALK',cost:0,minutes:1},{from:to,to:'home',mode:'WALK',cost:0,minutes:1}]);
 c.lifeProfile.world.transport.enabled=true;c.lifeRuntime.world.placeId='home';c.lifeRuntime.world.balance=50;c.lifeRuntime.activities.goals=[];c.humanDynamics={...c.humanDynamics,energy:75,hunger:10,stress:10,heatDiscomfort:hot?80:0};c.lifeRuntime.environment={temperature:hot?38:20,observedAt:now,stale:false};
 c.vh2Geography={enabled:true,places:{home:{capabilities:[]},park:{capabilities:['leisure']},cafe:{capabilities:['leisure']},pool:{capabilities:['swimming'],access:'permitted',entryCost:1}},knownPlaceIds:['home','park','cafe','pool']};
 c.vh2Signals={signals:[{id:'news',title:'News',tags:['art'],expiresAt:now+10000000,sourceId:'s',placeId:'park'}],known:[],events:[]};return c;
}
const outcomes=new Set();let mildSwims=0,hotSwims=0,noticed=0;
for(let seed=0;seed<100;seed++){
 const perception=fixture(seed);engine.ensure(perception).policy={...engine.DEFAULTS,enabled:true,interests:['art']};engine.advance(perception,now+3600000,local,'available');noticed+=perception.vh2Signals.known.length;assert.ok(!perception.vh2Travel?.activeId,'observation cannot start a second travel controller');
 for(const hot of [false,true]){let c=fixture(seed,hot);c=kernel.run({companion:c,now:now+30*60000}).companion;const swims=c.lifeRuntime.activities.goals.some(g=>g.definitionKey==='swimming'&&g.status==='completed');if(hot)hotSwims+=swims;else{mildSwims+=swims;outcomes.add(c.vh2Geography.intention?.placeId||'stay');}}
}
assert.ok(outcomes.size>=2,'canonical choices must vary across seeds');assert.ok(noticed>0&&noticed<100,'attention is neither omniscient nor permanently blind');assert.ok(hotSwims>mildSwims,'measured heat must cause executable cooling choices');
const busy=fixture('busy');engine.advance(busy,now+3600000,local,'private');assert.equal(busy.vh2Signals.known.length,0);
const absent=fixture('unreachable');absent.lifeProfile.travelLegs=[];geo.propose(absent,now,local);assert.equal(absent.lifeRuntime.activities.goals.some(g=>g.requiredPlaceId&&g.requiredPlaceId!=='home'),false);
console.log(`PASS100 canonical exploration seeds: ${outcomes.size} outcomes, ${noticed} source notices, mild swims ${mildSwims}, hot swims ${hotSwims}; attention, weather and real route feasibility.`);
const event={id:'concert',type:'calendar_event',versionKey:'v1',title:'Live concert',placeId:'park',startsAt:now+2*3600000,endsAt:now+3*3600000,expiresAt:now+3*3600000,eventStatus:'listed',tags:['art']};
const listed=fixture('event');listed.vh2Signals.known=[event];geo.propose(listed,now,local);const goal=listed.lifeRuntime.activities.goals.find(g=>g.sourceSignalId==='concert');assert.ok(goal);assert.equal(goal.expiresAt,event.endsAt);assert.ok(goal.notBefore>now,'future event attendance waits until useful departure time');
for(const mode of ['cancelled','unseen','shared-plan']){const c=fixture(mode);c.vh2Signals.known=mode==='unseen'?[]:[{...event,eventStatus:mode==='cancelled'?'cancelled':'listed'}];if(mode==='shared-plan')c.vh2Plans={plans:[{id:'group-event',sourceSignalId:'concert',status:'accepted',people:[c.id,'friend']}]};geo.propose(c,now,local);assert.equal(c.lifeRuntime.activities.goals.some(g=>g.sourceSignalId==='concert'),false,mode);}
console.log('PASS canonical calendar goals respect event times, cancellation, personal knowledge and shared-plan ownership.');
// Existing itinerary stay mechanics receive an explicit authored trip; perception does not create it.
const open=fixture('flexible');open.lifeProfile.travelLegs=[{from:'home',to:'park',mode:'WALK',cost:0,minutes:20},{from:'park',to:'home',mode:'WALK',cost:0,minutes:20}];open.lifeProfile.places=open.lifeProfile.places.filter(p=>!['cafe','pool'].includes(p.id));open.vh2Decision={policy:{temperature:0,exploration:0,minHoldMinutes:0}};
const flexible={id:'explicit-event-trip',label:'Concert visit',sourceSignalId:'concert',interestMatched:true,stops:[{placeId:'park',stayMinutes:60,flexibleStay:true,eventStartsAt:now+10*60000},{placeId:'home',stayMinutes:0}],status:'staying',createdAt:now,startsAt:now,stopIndex:0,legSequence:0,legs:[]};travel.ensure(open).trips.push(flexible);open.vh2Travel.activeId=flexible.id;assert.equal(flexible.stops[0].eventEndsAt,undefined,'no invented event end');
// Begin the stay at its actual destination with recorded return routes.
flexible.status='staying';flexible.stopIndex=0;flexible.stayStartedAt=now;flexible.stayUntil=null;open.lifeRuntime.world.placeId='park';open.vh2Travel.custody=true;
travel.tick(open,now+90*60000,{availability:'available'},local);assert.equal(flexible.status,'staying','healthy interested character can stay beyond a 60-minute estimate');
const satisfied=JSON.parse(JSON.stringify(open));open.humanDynamics.hunger=95;travel.tick(open,now+91*60000,{availability:'available'},local);assert.equal(flexible.status,'travelling','urgent hunger triggers a real return journey');assert.equal(open.lifeRuntime.world.journey.to,'home');assert.ok(open.vh2Travel.events.some(e=>e.transition==='stay_reconsidered'&&e.summary.includes('needs')));
const commitment=JSON.parse(JSON.stringify(satisfied));commitment.vh2Plans={plans:[{status:'accepted',startsAt:now+115*60000,endsAt:now+180*60000}]};travel.tick(commitment,now+91*60000,{availability:'available'},local);assert.equal(travel.active(commitment).status,'travelling','return travel time protects an upcoming commitment');
const onsite=JSON.parse(JSON.stringify(satisfied));onsite.humanDynamics.hunger=95;onsite.lifeRuntime.activities.goals=[{status:'active',kind:'meal',requiredPlaceId:'park',stepIndex:0,steps:[{hunger:-60,energy:6}]}];travel.tick(onsite,now+91*60000,{availability:'available'},local);assert.equal(travel.active(onsite).status,'staying','available meal at the venue can resolve hunger without leaving');
const ended=JSON.parse(JSON.stringify(satisfied));travel.active(ended).stops[0].eventEndsAt=now+90*60000;travel.tick(ended,now+91*60000,{availability:'available'},local);assert.equal(travel.active(ended).status,'travelling','published event end still bounds the visit');
console.log('PASS open-ended events: needs, on-site meals, continued interest, return travel and commitments determine departure.');

const early=JSON.parse(JSON.stringify(satisfied));travel.active(early).stops[0].eventEndsAt=now+240*60000;early.humanDynamics.hunger=95;travel.tick(early,now+91*60000,{availability:'available'},local);assert.equal(travel.active(early).status,'travelling','a published future end never forces attendance until that time');
console.log('PASS characters may leave well before a published event end.');
// Target opening hours follow the venue clock; actor life remains on its own local day.
const zoned=fixture('local-hours');zoned.vh2Travel={places:{home:{timeZone:'America/Phoenix'},park:{timeZone:'America/New_York'}}};
const window={hours:[{days:[0,1,2,3,4,5,6],start:60,end:120}]},instant=Date.parse('2026-09-12T05:30:00Z');
assert.equal(geo.open(window,instant,local,zoned,'park'),true,'01:30 Eastern is within opening hours');assert.equal(geo.open(window,instant,local,zoned,'home'),false,'22:30 Arizona is outside those hours');
console.log('PASS venue opening hours use destination IANA time zone.');
