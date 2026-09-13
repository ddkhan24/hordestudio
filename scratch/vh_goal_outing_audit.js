'use strict';
const assert=require('node:assert/strict');
const worker=require('../vh2-kernel-worker'),core=require('../vh-simulation-core');
const start=Date.UTC(2026,8,7,12),minute=60000;
function fixture({returnRoute=true,budget=100,enabled=true,schedule=false}={}){
 let c=worker.run({create:true,entityId:'outing-test',name:'Alex',now:start}).companion;
 c.lifeProfile=core.normalizeCompanionLifeProfile({...c.lifeProfile,
 places:[{id:'home',label:'Home',kind:'home',mapCoordinates:[0,51]},{id:'park',label:'Park',kind:'outdoor',mapCoordinates:[.01,51.01]}],
 weeklySchedule:schedule?[{id:'work',days:[1],startMinute:730,endMinute:800,placeId:'home',activity:'Work',availability:'busy'}]:[],
 travelLegs:[{from:'home',to:'park',mode:'WALK',minutes:10,cost:4},...(returnRoute?[{from:'park',to:'home',mode:'WALK',minutes:10,cost:6}]:[])],
 activityOptions:[{id:'park',kind:'leisure',label:'Spend time at the park',requiredPlaceId:'park',startMinute:0,endMinute:1440,priority:80,minEnergy:0,durationMinutes:10,repeatMinutes:1440}],
 world:{...c.lifeProfile.world,transport:{...c.lifeProfile.world.transport,enabled:true,goalTravel:enabled,budget,maxOutingMinutes:90}}});
 c.lifeRuntime.world=VHWorldEngine.runtime({});c.lifeRuntime.activities=VHActivityEngine.normalize({lastAdvancedAt:start});
 return c;
}
function advance(c,minutes,{reload=false,shared=false}={}){
 let now=c.lifeRuntime.lastSimulatedAt;
 for(let i=0;i<minutes;i++){
  now+=minute;
  if(shared){core.advanceCompanionActivities(c,now);core.advanceCompanionWorld(c,now);core.advanceCompanionHumanDynamics(c,now);c.lifeRuntime.lastSimulatedAt=now;}
  else c=worker.run({companion:c,now}).companion;
  if(reload){c=JSON.parse(JSON.stringify(c));c.lifeRuntime=core.normalizeCompanionLifeRuntime(c.lifeRuntime);}
 }
 return c;
}
function audit(){
const completed=advance(fixture(),70),world=completed.lifeRuntime.world;
assert.equal(world.placeId,'home');assert.equal(world.outing,null);assert.equal(world.balance,90);
assert.equal(world.events.filter(e=>e.kind==='outing').length,1);
assert.equal(world.events.filter(e=>e.kind==='outing_return').length,1);
assert(completed.lifeRuntime.activities.goals.some(g=>g.opportunityId==='park'&&g.status==='completed'));
const outbound=advance(fixture(),5);
assert.equal(outbound.lifeRuntime.world.journey.to,'park');
assert.equal(outbound.lifeRuntime.world.balance,90,'return fare reserved before departure');
assert.equal(outbound.lifeRuntime.activities.goals.find(g=>g.opportunityId==='park').steps.reduce((n,s)=>n+s.progressMs,0),0,'no activity progress while outbound');
const reloaded=advance(fixture(),70,{reload:true});
assert.deepEqual(reloaded.lifeRuntime.world,completed.lifeRuntime.world,'normalized save/reload retains outing and exact costs');
assert.deepEqual(reloaded.lifeRuntime.activities,completed.lifeRuntime.activities,'activity progress survives normalized reload');
for(const args of [{returnRoute:false},{budget:9},{enabled:false},{schedule:true}]){
 const c=advance(fixture(args),8);
 assert.equal(c.lifeRuntime.world.journey,null,JSON.stringify(args));assert.equal(c.lifeRuntime.world.balance,args.budget??100);
}
const overnight=fixture();overnight.timezoneOffsetMinutes=11*60+30;overnight.lifeProfile.travelLegs[1].minutes=30;overnight.lifeProfile.weeklySchedule=[{id:'early',days:[2],startMinute:5,endMinute:60,placeId:'home',activity:'Early obligation',availability:'busy',departureCosts:{},withIds:[]}];
assert.equal(advance(overnight,8).lifeRuntime.world.journey,null,'next-day obligation constrains the return leg');
const shared=advance(fixture(),70,{shared:true});
assert.equal(shared.lifeRuntime.world.placeId,'home');assert(shared.lifeRuntime.world.events.some(e=>e.kind==='outing_return'),'existing Horde core executes outings too');
const tired=advance(fixture(),13);tired.humanDynamics.energy=10;
const returned=advance(tired,15);
assert(returned.lifeRuntime.world.events.some(e=>e.summary==='Heading home because of tiredness.'));
assert.equal(returned.lifeRuntime.world.placeId,'home');
let visits=0,expensiveVisits=0;
for(let seed=0;seed<100;seed++){
 const c=fixture();c.lifeProfile.seed='paired-'+seed;
 c.lifeProfile.activityOptions.push({...c.lifeProfile.activityOptions[0],id:'read',label:'Read at home',requiredPlaceId:'home'});
 const costly=JSON.parse(JSON.stringify(c));costly.lifeProfile.travelLegs[0].cost=80;
 if(advance(c,3).lifeRuntime.world.outing)visits++;
 if(advance(costly,3).lifeRuntime.world.outing)expensiveVisits++;
}
assert(visits>0&&visits<100,'both local and remote activities can be selected');
assert(expensiveVisits<visits,'higher travel cost reduces outings across paired seeds');
console.log(`Paired seeds: ${visits}/100 ordinary outings; ${expensiveVisits}/100 with higher fare.`);
console.log('PASS unscheduled goal outing/return, fare reservation, no remote progress, reload, missing return route, affordability, opt-out, calendar fit, existing Horde core and tired return');

}
if(require.main===module)audit();
module.exports={fixture,advance,start};
