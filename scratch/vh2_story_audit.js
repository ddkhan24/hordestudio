'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),kernel=require('../vh2-kernel-worker'),story=require('../vh2-story-engine'),plans=require('../vh2-plans-engine'),core=require('../vh-simulation-core');
const START=Date.UTC(2026,8,7,12),HOUR=3600000,MIN=60000;
function fixture(seed='story'){
 const places=[['home','home'],['jo_home','home'],['cafe','social'],['park','outdoor'],['gym','social']].map(([id,kind])=>({id,kind,label:id}));
 const travelLegs=places.flatMap(a=>places.filter(b=>b!==a).map(b=>({from:a.id,to:b.id,mode:'WALK',minutes:5,cost:0})));
 const c=kernel.run({create:true,name:'Alex',entityId:seed,now:START,profile:{age:28,timezoneOffsetMinutes:0,lifeProfile:{places,travelLegs,weeklySchedule:[],socialCircle:[{id:'jo',name:'Jo',age:28,role:'friend',closeness:70,contactWindows:[{days:[0,1,2,3,4,5,6],startMinute:0,endMinute:1440}]}],sleepPolicy:{enabled:true},activityOptions:[{id:'reading',kind:'leisure',label:'Read a novel',requiredPlaceId:'home',startMinute:0,endMinute:1440,repeatMinutes:240}],world:{transport:{enabled:true,goalTravel:true,modes:['WALK'],budget:300}}}}}).companion;
 c.lifeRuntime.world.placeId='home';c.lifeRuntime.world.balance=300;c.humanDynamics.energy=80;c.humanDynamics.hunger=20;c.humanDynamics.socialNeed=65;
 c.vh2Geography.enabled=true;c.vh2Geography.places={home:{capabilities:['rest','exercise'],access:'permitted'},jo_home:{capabilities:['rest'],access:'unknown'},cafe:{capabilities:['food','leisure'],mealCost:3,access:'public'},park:{capabilities:['leisure'],access:'public'},gym:{capabilities:['exercise'],access:'public'}};
 c.vh2Health.policy.enabled=false;c.vh2Travel.residenceId='home';Object.assign(plans.ensure(c).policy,{enabled:true,hostedEvents:true});
 c.vh2People.actors.jo={id:'jo',policy:{homePlaceId:'jo_home',foodPlaceIds:['cafe'],leisurePlaceIds:['park','gym'],paidPlaceIds:[],modes:['WALK'],ownsCar:false,ownsBicycle:false,curiosity:60,conscientiousness:70,temperature:8,sleepStart:23,sleepEnd:7,mealCost:3,incomePerHour:0,dailyExpense:0},placeId:'jo_home',balance:300,energy:80,hunger:20,stress:0,boredom:60,socialNeed:65,lastAt:START,sequence:0,started:false,action:null,journey:null,pending:null,remaining:[],visits:{},health:{policy:{enabled:false}}};
 return c;
}
if(require.main===module){
let c=fixture();story.ensure(c).policy.intensity=0;const before=structuredClone(c);story.advance(c,START,core);assert.equal(c.vh2Story.threads.length,0);assert.deepEqual(c.lifeRuntime,before.lifeRuntime);
for(const patch of [{vh2AutonomyPaused:true},{humanDynamics:{...c.humanDynamics,energy:10}},{humanDynamics:{...c.humanDynamics,stress:95}}]){const x={...structuredClone(c),...patch};x.vh2Story.policy.intensity=100;story.advance(x,START+3*HOUR,core);assert.equal(x.vh2Story.threads.length,0);}
// Fictional closures affect canonical feasibility and expire without changing map facts.
c.vh2Story.threads.push({id:'closure',kind:'complication',placeId:'park',at:START,endsAt:START+2*HOUR,status:'active'});
assert.equal(require('../vh2-geography-engine').open(c.vh2Geography.places.park,START,core.companionLocalMinuteInfo,c,'park'),false);
assert.equal(require('../vh2-geography-engine').open(c.vh2Geography.places.park,START+2*HOUR,core.companionLocalMinuteInfo,c,'park'),null);
assert.equal(c.vh2Geography.places.park.closed,undefined);story.finish(c,START+2*HOUR);assert.equal(c.vh2Story.threads[0].status,'resolved');
// Pacing statistics isolate the director; physical outcomes are tested below.
const rates={};for(const intensity of [0,15,40,70,100]){let count=0;for(let seed=0;seed<20;seed++){
 const x=fixture('pace-'+seed);Object.assign(x.vh2Story.policy,{intensity,social:0,novelty:0,complications:100,recoveryHours:6});
 for(let hour=0;hour<24*30;hour+=3){story.advance(x,START+hour*HOUR,core);story.finish(x,START+hour*HOUR);}count+=x.vh2Story.sequence;
 assert(x.vh2Story.threads.every(t=>!['home','jo_home','cafe'].includes(t.placeId)));assert(x.vh2Story.threads.length<=100);
 for(let i=1;i<x.vh2Story.threads.length;i++)assert(x.vh2Story.threads[i].at-x.vh2Story.threads[i-1].at>=48*HOUR);
 }rates[intensity]=count;}assert.equal(rates[0],0);assert(rates[100]>rates[15]);
const runs=[];for(let seed=0;seed<8;seed++){
 let x=fixture('living-story-'+seed);Object.assign(x.vh2Story.policy,{intensity:seed%2?100:40,recoveryHours:6});let slept=0,nearStarvation=0,longest=0;const events=new Map();
 for(let minute=5;minute<=14*1440;minute+=5){const now=START+minute*MIN,checkpoint=minute%1440===5?structuredClone(x):null;const r=kernel.run({companion:x,now});x=r.companion;if(checkpoint)assert.deepEqual(kernel.run({companion:checkpoint,now}),r);
  for(const k of ['energy','hunger','stress','socialNeed'])assert(Number.isFinite(x.humanDynamics[k])&&x.humanDynamics[k]>=0&&x.humanDynamics[k]<=100);
  assert(x.lifeRuntime.world.balance>=0);assert(x.lifeRuntime.activities.goals.length<=60);assert(x.vh2Story.threads.length<=100);
  if(x.humanDynamics.sleep?.stage==='asleep')slept+=5;nearStarvation=x.humanDynamics.hunger>=95?nearStarvation+5:0;longest=Math.max(longest,nearStarvation);
  for(const e of r.events){const key=e.kind+':'+e.id;if(events.has(key))assert.deepEqual(e,events.get(key));else events.set(key,structuredClone(e));}
 }
 assert(slept>14*120);assert(longest<8*60);runs.push({seed,threads:x.vh2Story.sequence,kinds:[...new Set(x.vh2Story.threads.map(t=>t.kind))],sleepHours:slept/60,plans:x.vh2Plans.plans.length});
}
assert(runs.some(r=>r.threads>0));const kinds=new Set(runs.flatMap(r=>r.kinds));assert(kinds.has('novelty'));assert(kinds.has('social'));assert(kinds.has('complication'));
const report={rates,rateScope:'20 synthetic seeds x 30 days per level, circumstances only',simulatedDays:112,runs,providersUsed:0};fs.writeFileSync(process.argv[2]||require('node:path').join(require('node:os').tmpdir(), 'vh-story-stress.json'),JSON.stringify(report,null,2));console.log('PASS story pacing, zero/paused/pressure, closure access/expiry, physical constraints, 112 character-days and daily exact replay');console.log(JSON.stringify(report));
}
module.exports={fixture,START};
