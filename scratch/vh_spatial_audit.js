const assert=require('node:assert/strict');
global.VHActivityEngine=require('../virtual_humans/engine/vh-activity-engine');
const core=require('../virtual_humans/engine/vh-simulation-core');
const base=Date.UTC(2026,8,8);
const c={id:'traveller',locationMode:'custom',timezoneOffsetMinutes:0,lifeProfile:core.normalizeCompanionLifeProfile({initializedAt:1,
 places:[{id:'home',label:'Home',googlePlaceId:'abc_123'},{id:'gym',label:'Gym'}],
 weeklySchedule:[{id:'a',days:[2],startMinute:480,endMinute:540,placeId:'home',activity:'Breakfast'}, {id:'b',days:[2],startMinute:550,endMinute:600,placeId:'gym',activity:'Workout'}],
 travelLegs:[{from:'home',to:'gym',mode:'WALK',minutes:20}]}),lifeRuntime:{}};
const at=m=>base+m*60000;
assert.equal(core.companionScheduledJourneyAt(c,at(539)),null);
const journey=core.companionScheduledJourneyAt(c,at(550));
assert.equal(journey.source,'travel');assert.equal(journey.lateMinutes,10);assert.equal(journey.withNames.length,0);
assert.equal(journey.endsAt,at(560));assert.equal(core.companionScheduledJourneyAt(c,at(560)),null);
assert.deepEqual(core.companionScheduledJourneyAt(JSON.parse(JSON.stringify(c)),at(550)),journey);
assert.equal(core.normalizeCompanionLifePlace({label:'X',googlePlaceId:'https://evil'}).googlePlaceId,'');
const chained=JSON.parse(JSON.stringify(c));
chained.lifeProfile.places.push(core.normalizeCompanionLifePlace({id:'work',label:'Work'}));
chained.lifeProfile.travelLegs[0].minutes=80;
chained.lifeProfile.travelLegs.push({from:'gym',to:'work',mode:'WALK',minutes:10});
chained.lifeProfile.weeklySchedule.push(core.normalizeCompanionScheduleBlock({id:'c',days:[2],startMinute:610,endMinute:700,placeId:'work',activity:'Work'}));
assert.equal(core.companionScheduledJourneyAt(chained,at(615)).placeLabel,'Between Home and Gym');
assert.equal(core.companionScheduledJourneyAt(chained,at(620)).placeLabel,'Between Gym and Work');
assert.equal(core.companionScheduledJourneyAt(chained,at(620)).endsAt,at(630));
c.lifeProfile.travelLegs[0].from='gym';c.lifeProfile.travelLegs[0].to='home';assert.equal(core.companionScheduledJourneyAt(c,at(550)),null);
assert.equal(core.normalizeCompanionLifeProfile({}).travelLegs.length,0);
console.log('Spatial audit passed: directional travel, lateness, arrival boundary, reload, invalid IDs and legacy defaults.');
