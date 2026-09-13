'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),e=require('../vh2-people-engine');
const {fixture,local,start,MIN}=require('./vh2_people_audit');
let signatures=new Set(),balances=[],earned=[],actions=new Set();
for(let seed=0;seed<100;seed++){
 const c=fixture();c.id='world-'+seed;const a=c.vh2People.actors.sam;
 Object.assign(a.policy,{incomePerHour:12,paidPlaceIds:['work'],dailyExpense:5});
 c.lifeProfile.world.people=[{personId:'sam',placeId:'work',days:[1,2,3,4,5],start:8*60,end:16*60}];
 c.lifeProfile.travelLegs.push({from:'home',to:'work',mode:'WALK',minutes:12,cost:0},{from:'work',to:'home',mode:'WALK',minutes:12,cost:0});
 for(let day=0;day<14;day++){
  e.advance(c,start+(day+1)*1440*MIN,local);
  assert.ok(Number.isFinite(a.balance)&&a.balance>=0);for(const key of ['energy','hunger','stress','boredom'])assert.ok(a[key]>=0&&a[key]<=100);
  for(const event of c.vh2People.events)if(event.action)actions.add(event.action);
 }
 assert.ok(a.earnedIncome>0,'actual work should earn money');assert.ok(a.earnedIncome<=12*8*10+.01,'no income outside ten working days');
 const spent=c.vh2People.events.filter(x=>x.kind==='person_departed').reduce((s,x)=>s+(x.cost||0),0);assert.ok(spent>=0);
 signatures.add(JSON.stringify([a.balance,a.energy,a.hunger,a.sequence,a.placeId]));balances.push(a.balance);earned.push(a.earnedIncome);
}
assert.ok(signatures.size>90,'long lives should vary across seeds');assert.ok(actions.has('eat')&&actions.has('sleep')&&actions.has('obligation')&&actions.has('leisure'));
// No salary at a location the person has not reached.
const blocked=fixture(),a=blocked.vh2People.actors.sam;a.policy.incomePerHour=12;a.policy.paidPlaceIds=['work'];blocked.lifeProfile.world.people=[{personId:'sam',placeId:'work',days:[0,1,2,3,4,5,6],start:0,end:1440}];e.advance(blocked,start+1440*MIN,local);assert.equal(a.earnedIncome||0,0);
// An expense cannot create a negative travel balance or disappear when unaffordable.
const poor=fixture(),p=poor.vh2People.actors.sam;p.balance=0;p.policy.dailyExpense=10;e.advance(poor,start+1440*MIN,local);assert.equal(p.balance,0);assert.equal(p.unpaidExpenses,10);
const report={seeds:100,daysPerSeed:14,uniqueOutcomes:signatures.size,actions:[...actions].sort(),finalBudgetRange:[Math.min(...balances),Math.max(...balances)],earnedIncomeRange:[Math.min(...earned),Math.max(...earned)],providersUsed:0};
fs.writeFileSync('/tmp/vh2-people-14-day-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
