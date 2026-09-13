'use strict';
const assert=require('node:assert/strict'),e=require('../vh2-people-engine');
const MIN=60000,start=1788764400000;
function fixture(){const a={id:'sam',policy:{homePlaceId:'home',foodPlaceIds:[],leisurePlaceIds:['park'],modes:['WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE'],ownsCar:false,ownsBicycle:false,curiosity:50,conscientiousness:80,temperature:8,sleepStart:23,sleepEnd:7,mealCost:2},placeId:'home',carPlaceId:null,bikePlaceId:null,balance:30,energy:75,hunger:30,stress:20,boredom:35,lastAt:start,sequence:0,started:false,action:null,journey:null,pending:null,remaining:[],visits:{home:start}};return {id:'root',lifeProfile:{world:{people:[]},travelLegs:[{from:'home',to:'park',mode:'WALK',minutes:5,cost:0},{from:'park',to:'home',mode:'WALK',minutes:5,cost:0}]},lifeRuntime:{world:{people:{}}},vh2People:{actors:{sam:a},events:[],sequence:0}};}
const local=(c,t)=>{const d=new Date(t);return {weekday:d.getUTCDay(),hour:d.getUTCHours(),minute:d.getUTCMinutes()};};
let c=fixture(),a=c.vh2People.actors.sam;
assert.equal(e.route([{from:'home',to:'work',mode:'DRIVE',minutes:2,cost:0}],a,'work'),null);
a.carPlaceId='home';assert.equal(e.route([{from:'home',to:'work',mode:'DRIVE',minutes:2,cost:0}],a,'work')[0].mode,'DRIVE');
assert.equal(e.route([{from:'home',to:'station',mode:'WALK',minutes:1,cost:0},{from:'station',to:'work',mode:'DRIVE',minutes:2,cost:0}],a,'work'),null,'parked car cannot teleport');
a.balance=3;const legs=[{from:'home',to:'station',mode:'TRANSIT',minutes:2,cost:2},{from:'station',to:'work',mode:'TRANSIT',minutes:2,cost:2}];assert.equal(e.route(legs,a,'work'),null,'whole journey must be affordable');
a.balance=4;assert.equal(e.route(legs,a,'work').length,2);
// Fast but expensive intermediate path cannot prune a slower affordable route.
assert.equal(e.route([{from:'home',to:'station',mode:'TRANSIT',minutes:1,cost:4},{from:'home',to:'station',mode:'WALK',minutes:4,cost:0},...legs.slice(1)],a,'work')[0].mode,'WALK');
c=fixture();a=c.vh2People.actors.sam;a.hunger=99;a.energy=90;a.policy.temperature=1;e.advance(c,start,local);assert.equal(a.action.kind,'eat');assert.equal(a.balance,28);e.advance(c,start+20*MIN,local);assert.ok(a.hunger<50);assert.ok(a.balance>=26,'meals charged once per start');
const once=JSON.stringify(c);e.advance(c,start+20*MIN,local);assert.equal(JSON.stringify(c),once);
// Whole-day chunking and restart must have exactly the same outcomes as minute stepping.
const bulk=fixture(),stepped=fixture();e.advance(bulk,start+1440*MIN,local);for(let t=start;t<=start+1440*MIN;t+=MIN)e.advance(stepped,t,local);assert.deepEqual(bulk,stepped);
const restart=JSON.parse(JSON.stringify(bulk));e.advance(bulk,start+2880*MIN,local);e.advance(restart,start+2880*MIN,local);assert.deepEqual(bulk,restart);
// A retained interval proves where a person was; current arrival cannot backdate a meeting.
c=fixture();a=c.vh2People.actors.sam;a.boredom=100;a.policy.curiosity=100;a.policy.temperature=1;e.advance(c,start,local);assert.ok(a.journey);assert.equal(a.placeId,'');e.advance(c,start+5*MIN,local);assert.equal(a.placeId,'park');assert.equal(e.availableAt(c,'sam','park',start+4*MIN),false);assert.equal(e.availableAt(c,'sam','park',start+5*MIN),true);
console.log('Independent people: route ownership/cost, needs, timed arrival, no backdated meetings, batching, restart and idempotency passed');
module.exports={fixture,local,start,MIN};
