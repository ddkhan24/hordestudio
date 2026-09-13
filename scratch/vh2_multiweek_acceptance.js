'use strict';
// Long-run mechanism acceptance. This is not a test of culture, dialogue or sentience.
const assert=require('node:assert/strict'),fs=require('node:fs'),e=require('../vh2-people-engine');
const {fixture,local,start,MIN}=require('./vh2_people_audit');
const DAY=1440*MIN,runs=[];
for(const curiosity of [5,50,95])for(let seed=0;seed<8;seed++){
 const c=fixture();c.id=`acceptance-${seed}`;const a=c.vh2People.actors.sam;
 a.policy.curiosity=curiosity;a.balance=200;a.policy.incomePerHour=10;a.policy.paidPlaceIds=['office'];a.policy.dailyExpense=8;
 c.lifeProfile.world.people=[{personId:'sam',placeId:'office',days:[1,2,3,4,5],start:540,end:1020}];
 c.lifeProfile.travelLegs.push({from:'home',to:'office',mode:'WALK',minutes:12,cost:0},{from:'office',to:'home',mode:'WALK',minutes:12,cost:0},{from:'office',to:'park',mode:'WALK',minutes:8,cost:0},{from:'park',to:'office',mode:'WALK',minutes:8,cost:0});
 const counts={},seen=new Set();let restart;
 for(let step=0;step<=28*4;step++){
  const now=start+step*DAY/4;e.advance(c,now,local);
  if(restart){e.advance(restart,now,local);assert.deepEqual(restart,c,'restart preserves all outcomes');restart=null;}
  if(step%28===0)restart=JSON.parse(JSON.stringify(c));
  assert(Number.isFinite(a.balance)&&a.balance>=0,'balance cannot become negative or non-finite');
  for(const key of ['hunger','energy','stress','boredom'])assert(a[key]>=0&&a[key]<=100,key+' remains bounded');
  assert(!(a.journey&&a.placeId),'actor cannot occupy a place during travel');
  for(const event of c.vh2People.events)if(!seen.has(event.id)){
   seen.add(event.id);const key=event.action||event.kind;counts[key]=(counts[key]||0)+1;
   if(event.kind==='person_arrived')assert(c.lifeProfile.travelLegs.some(l=>l.to===event.placeId),'arrival requires a real route destination');
  }
 }
 assert(counts.sleep>0&&counts.eat>0&&counts.obligation>0&&counts.person_departed>0,'basic needs, work and movement must all occur');
 runs.push({seed,curiosity,counts,balance:a.balance,earnedIncome:a.earnedIncome,unpaidExpenses:a.unpaidExpenses||0,finalNeeds:{energy:a.energy,hunger:a.hunger,stress:a.stress}});
}
const totals=curiosity=>runs.filter(r=>r.curiosity===curiosity).reduce((n,r)=>n+(r.counts.leisure||0),0);
assert(totals(95)>totals(5),'curiosity changes long-run leisure selection');
assert(new Set(runs.filter(r=>r.curiosity===50).map(r=>JSON.stringify(r.counts))).size>1,'different seeds produce different action histories');
const report={daysPerRun:28,runs:runs.length,passed:true,scope:'Independent supporting-person needs, work, travel, resource limits, seeded variety and restart continuity. Does not certify the main human kernel, locale authenticity, weather sensitivity or dialogue.',leisureByCuriosity:Object.fromEntries([5,50,95].map(x=>[x,totals(x)])),results:runs};
fs.writeFileSync(process.argv[2]||'/tmp/vh2-multiweek-acceptance.json',JSON.stringify(report,null,2));
console.log(`PASS ${runs.length} independent-person runs × 28 days, replay after restart, resources, routes and personality perturbation`);
