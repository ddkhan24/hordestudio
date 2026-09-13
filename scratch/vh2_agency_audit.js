'use strict';
const assert=require('node:assert/strict'),agency=require('../vh2-agency-engine');
const now=1788764400000;
function human(seed='alex'){return {id:seed,humanDynamics:{energy:80,stress:10,socialNeed:80},mood:{valence:10},lifeProfile:{socialCircle:[{id:'jo',name:'Jo',closeness:80,tension:5}]},lifeRuntime:{world:{placeId:'home'},activities:{goals:[],conversationUntil:0}},vh2Presence:{visits:[]}};}
const event={id:'notice',at:now,kind:'encounter',personId:'jo',summary:'Noticed Jo at Home.'};
function enable(c,extra={}){agency.ensure(c).policy={...agency.DEFAULTS,enabled:true,captureThreshold:0,invitationThreshold:0,shareThreshold:0,...extra};}
const c=human();enable(c);agency.advance(c,now,'available',[event]);
assert.equal(c.vh2Agency.captures.length,1);assert.equal(c.vh2Plans.plans.length,1);assert.equal(c.vh2Plans.plans[0].origin,'autonomous');
agency.advance(c,now,'available',[event]);assert.equal(c.vh2Agency.captures.length,1,'repeat tick cannot duplicate a capture');
const sleepy=human();enable(sleepy);agency.advance(sleepy,now,'asleep',[event]);agency.advance(sleepy,now+300000,'available',[event]);assert.equal(sleepy.vh2Agency.captures.length,0,'waking cannot replay a missed photo opportunity');
const moving=human();enable(moving);moving.lifeRuntime.world.journey={};agency.advance(moving,now,'available',[event]);assert.equal(moving.vh2Agency.captures.length,0);
const busy=human();enable(busy);busy.lifeRuntime.activities.conversationUntil=now+60000;agency.advance(busy,now,'available',[event]);assert.equal(busy.vh2Agency.captures.length,0);
const off=human();agency.advance(off,now,'available',[event]);assert.equal(off.vh2Agency.captures.length,0);
const blocked=human();enable(blocked,{captureThreshold:200,invitationThreshold:200});agency.advance(blocked,now,'available',[event]);assert.equal(blocked.vh2Agency.captures.length,0);assert.equal(blocked.vh2Plans,undefined);
const photo={id:'photo',origin:'autonomous',destination:'gallery',status:'stored',deliveredAt:now-1,at:now-1000};
assert.equal(agency.publications(c,now,'available',[{...photo,origin:'explicit_player_request'}],[]).length,0,'never auto-publish private/operator photos');
const decisions=agency.publications(c,now,'available',[photo],[]);assert.equal(decisions[0].publish,true);assert.equal(agency.publications(c,now,'available',[photo],[]).length,0,'cooldown is a bound, not another lottery');
const twins=[human('same'),human('same')];twins.forEach(x=>{enable(x,{captureThreshold:65});agency.advance(x,now,'available',[event]);});assert.deepEqual(twins[0],twins[1]);
let yes=0;for(let i=0;i<100;i++){const x=human('seed'+i);enable(x,{captureInterest:55,captureThreshold:85});agency.advance(x,now,'available',[event]);yes+=x.vh2Agency.captures.length;}
assert(yes>0&&yes<100,`Different seeds must vary at an ambiguous threshold, got ${yes}`);
console.log('PASS event-driven invitations, capture/share decisions, attention gates, provenance, deterministic replay and 100-seed variation');

const backlog=human();enable(backlog);backlog.vh2Agency.captures=[{id:'unrendered',status:'pending',at:1},...Array.from({length:110},(_,i)=>({id:'rendered'+i,status:'rendered',at:now}))];agency.advance(backlog,now,'available',[]);assert.equal(backlog.vh2Agency.captures.filter(x=>x.status==='pending').length,1,'history compaction must retain pending capture capacity reservations');

const worker=require('../vh2-kernel-worker');const old=worker.run({create:true,name:'Alex',entityId:'old-timeline',now}).companion;delete old.vh2Agency;delete old.vh2NpcTravel;const upgraded=worker.run({companion:old,now,inspect:true});assert.equal(upgraded.companion.vh2Agency.policy.enabled,false,'upgrades initialize controls while paused');assert.deepEqual(upgraded.companion.vh2NpcTravel.people,{});
