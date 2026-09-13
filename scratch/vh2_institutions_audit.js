'use strict';
const assert=require('node:assert/strict'),e=require('../vh2-institutions-engine');
const start=1788764400000;
function fixture(){return {humanDynamics:{stress:10},lifeProfile:{weeklySchedule:[{id:'class',days:[1],startMinute:420,endMinute:480,placeId:'college'}]},lifeRuntime:{world:{placeId:'college',balance:20}},vh2Institutions:{rules:[{id:'u',label:'Seminar',scheduleId:'class',minimumAttendance:1,fee:5,missedStress:3}],sessions:{},events:[],unpaid:0,lastAt:null}};}
function run(c){for(let m=420;m<=480;m++)e.advance(c,start+(m-420)*60000,{hour:Math.floor(m/60),minute:m%60,weekday:1,dateKey:'2026-09-07'},{availability:'available'});}
let c=fixture();run(c);assert.equal(c.vh2Institutions.events[0].attendedMinutes,60);assert.equal(c.lifeRuntime.world.balance,15);const saved=JSON.stringify(c);e.advance(c,start+60*60000,{hour:8,minute:0,weekday:1,dateKey:'2026-09-07'},{});assert.equal(JSON.stringify(c),saved);
c=fixture();c.lifeRuntime.world.placeId='home';run(c);assert.equal(c.vh2Institutions.events[0].status,'missed');assert.equal(c.humanDynamics.stress,13);assert.equal(c.lifeRuntime.world.balance,20);
c=fixture();c.lifeRuntime.world.balance=2;run(c);assert.equal(c.vh2Finance.unpaid,3);assert.equal(c.lifeRuntime.world.balance,0);
c=fixture();e.advance(c,start,{hour:7,minute:0,weekday:1,dateKey:'2026-09-07'},{});e.advance(c,start+3600000,{hour:8,minute:0,weekday:1,dateKey:'2026-09-07'},{});assert.equal(c.vh2Institutions.events[0].attendedMinutes,0,'No invented attendance across unobserved gaps');
console.log('Institutions: full attendance, absence, no gap interpolation, single fees, debt and idempotency passed.');
