'use strict';
const assert=require('node:assert/strict'),health=require('../vh2-health-engine'),population=require('../vh2-population-engine'),kernel=require('../vh2-kernel-worker');
const NOW=Date.UTC(2026,8,13,12),HOUR=3600000;
function fixture(){return {id:'weather-person',humanDynamics:{energy:80,stress:10,heatDiscomfort:0},lifeProfile:{places:[{id:'home',kind:'home',mapCoordinates:[-111.93,33.43]},{id:'distant',kind:'social',mapCoordinates:[-80.19,25.76]}],socialCircle:[]},lifeRuntime:{world:{placeId:'home',people:{}},activities:{goals:[]},environment:{temperature:40,observedAt:NOW,coordinates:[-111.93,33.43],scope:'weather_model_observation',stale:false}},vh2Health:{policy:{enabled:false},lastAt:NOW,lastDay:null,events:[]}};}
for(const scenario of ['fresh','stale','expired','future','remote','unknown']){
 const c=fixture();
 if(scenario==='stale')c.lifeRuntime.environment.stale=true;
 if(scenario==='expired')c.lifeRuntime.environment.observedAt=NOW-2*HOUR;
 if(scenario==='future')c.lifeRuntime.environment.observedAt=NOW+HOUR;
 if(scenario==='remote')c.lifeRuntime.world.placeId='distant';
 if(scenario==='unknown')c.lifeRuntime.world.placeId='missing';
 health.advance(c,NOW+30*60000);
 assert.equal(c.humanDynamics.heatDiscomfort>0,scenario==='fresh',scenario+' must only apply established current local heat');
 const actor={placeId:c.lifeRuntime.world.placeId,journey:null};
 assert.equal(health.temperatureAt(c,NOW+30*60000,actor),scenario==='fresh'?40:null,'same weather evidence for another participant: '+scenario);
}
const cooling=fixture();cooling.humanDynamics.heatDiscomfort=80;cooling.lifeRuntime.environment.stale=true;health.advance(cooling,NOW+HOUR);assert(cooling.humanDynamics.heatDiscomfort<30,'an expired hot afternoon cannot keep a person overheated indefinitely');
const continuous=fixture(),reloaded=fixture();
for(let minute=1;minute<=360;minute++){
 health.advance(continuous,NOW+minute*60000);health.advance(reloaded,NOW+minute*60000);
 Object.assign(reloaded,JSON.parse(JSON.stringify(reloaded)));
}
assert.deepEqual(continuous,reloaded,'weather expiry and cooling survive restart exactly');
assert(continuous.humanDynamics.heatDiscomfort<1,'no six-hour phantom heat after the weather sample expires');
const dated=fixture();dated.lifeRuntime.environment.coordinates=[179.95,60];dated.lifeProfile.places[0].mapCoordinates=[-179.95,60];assert.equal(health.temperatureAt(dated,NOW),40,'nearby points across the date line share regional weather');
const otherHome=fixture();Object.assign(otherHome,{locationLongitude:-111.93,locationLatitude:33.43,vh2Travel:{residenceId:'home'}});otherHome.lifeProfile.places.push({id:'friend-home',kind:'home'});otherHome.lifeRuntime.world.placeId='friend-home';assert.equal(health.temperatureAt(otherHome,NOW),null,'the main residence coordinates cannot locate a different home');
assert.equal(health.temperatureAt(otherHome,NOW,{placeId:'friend-home'}),null,'an unlocated participant home does not inherit the main residence coordinates');
const main=kernel.run({create:true,name:'Weather fixture',entityId:'weather-capture',now:NOW}).companion;
main.lifeRuntime.environment={temperature:40,observedAt:NOW-2*HOUR,scope:'weather_model_observation'};
const capture=kernel.run({companion:main,now:NOW,inspect:true,capture:true});assert.deepEqual(capture.photoContext.environment,{},'expired weather cannot become a new photo prompt');
for(const mode of ['travelling','unresolved','asleep']){
 const c=fixture();c.vh2People={actors:{}};c.vh2Population={enabled:true,residents:[{id:'new-person'}],contacts:{'new-person':{since:NOW-60000}},events:[],sequence:0};
 c.vh2Plans={plans:[{id:'party',activityKind:'hosted_event',status:'active',placeId:'home'}]};
 if(mode==='travelling')c.lifeRuntime.world.journey={from:'home',to:'distant'};
 if(mode==='unresolved')c.lifeRuntime.world.placeId='missing';
 assert.doesNotThrow(()=>population.advance(c,NOW,mode==='asleep'?'asleep':'busy',()=>({hour:12,minute:0}),p=>p));
 assert.deepEqual(c.lifeProfile.socialCircle,[]);assert.deepEqual(c.vh2Population.contacts,{},'overlap timer resets when presence is not established');
}
console.log('PASS shared weather evidence, expiration, travel scope, cooling/replay, capture isolation and unplaced/transit hosted-event safety');
