/* Directional, experience-backed supporting-person bonds. No invented dialogue. */
'use strict';
const lifecycle=require('./vh2-relationship-lifecycle');
const DAY=86400000;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function ensure(c,now){
 const r=c.vh2SocialBonds ||= {pairs:{},events:[],sequence:0,lastAt:now};r.policy=lifecycle.policy(r);
 for(const p of c.lifeProfile.socialCircle||[]){
  if(Object.hasOwn(r.pairs,p.id))continue;
  const side=()=>({warmth:clamp(Number(p.closeness)||0,-100,100),trust:clamp(Number(p.trust)||0,-100,100),familiarity:0,meetings:0,lastMeetingAt:null,firstMeetingAt:null,stage:'authored',baseline:clamp(Number(p.closeness)||0,-100,100)});
  Object.defineProperty(r.pairs,p.id,{value:{personId:p.id,self:side(),other:side(),processed:[],daily:{}},enumerable:true,writable:true,configurable:true});
 }
 return r;
}
function disposition(c,p,side){
 // Explicit authoring may override each side independently; do not infer traits from nationality or gender.
 const x=side==='self'?c.vh2SocialDisposition:p.vh2SocialDisposition;
 return {openness:clamp(Number(x?.openness??50),0,100),sensitivity:clamp(Number(x?.sensitivity??50),0,100)};
}
function advance(c,now){
 const r=ensure(c,now);if(now<r.lastAt)throw Error('Social bonds cannot advance backwards');
 const elapsed=(now-r.lastAt)/DAY,pol=r.policy;
 for(const p of c.lifeProfile.socialCircle||[]){
  const pair=r.pairs[p.id];
  for(const s of [pair.self,pair.other]){
   // Only earned warmth drifts; a configured family/friend history is not erased.
   if(s.lastMeetingAt!==null&&now-s.lastMeetingAt>pol.quietDays*DAY){
    const quiet=Math.min(elapsed,Math.max(0,(now-s.lastMeetingAt-pol.quietDays*DAY)/DAY));
    s.warmth=s.baseline+(s.warmth-s.baseline)*Math.exp(-quiet/90);
    if(s.stage==='friend'&&now-s.lastMeetingAt>pol.distantDays*DAY)s.stage='distant';
   }
  }
  for(const plan of c.vh2Plans?.plans||[]){
   const members=plan.people||[c.id,plan.personId],pairKey=JSON.stringify([c.id,p.id].sort());
   const shared=plan.pairMinutes?Number(plan.pairMinutes[pairKey]||0):plan.status==='completed'&&members.includes(c.id)&&members.includes(p.id)?Number(plan.durationMinutes)||1:0;
   if(!members.includes(c.id)||!members.includes(p.id)||!['completed','missed','cancelled'].includes(plan.status)||shared<Math.min(5,Number(plan.durationMinutes)||5)||pair.processed.includes(plan.id))continue;
   // A retained completed plan is evidence once, even after restart or replay.
   pair.processed.push(plan.id);
   const at=plan.completedAt??now,day=Math.floor(at/DAY),key=String(day);
   const count=pair.daily[key]||0;pair.daily[key]=count+1;
   pair.daily=Object.fromEntries(Object.entries(pair.daily).filter(([d])=>Number(d)>=day-2));
   if(count>=3)continue;
   const stress=clamp(Number(c.humanDynamics?.stress)||0,0,100),otherStress=clamp(Number(c.lifeRuntime?.world?.people?.[p.id]?.stress)||0,0,100);
   for(const [which,s,load] of [['self',pair.self,stress],['other',pair.other,otherStress]]){
    const d=disposition(c,p,which),duration=clamp(shared,1,120);
    const comfort=1-load/70;
    const delta=clamp(comfort*(.3+d.openness/100)*Math.min(1,duration/30),-1,1);
    s.strain=clamp((s.strain||0)+(delta<0?-delta: -delta*.5),0,100);
    if(delta<0)s.trust=clamp(s.trust+delta*.15,-100,100);
    s.warmth=clamp(s.warmth+delta,-100,100);s.familiarity=clamp(s.familiarity+Math.min(1,duration/30),0,100);
    s.meetings++;s.firstMeetingAt??=at;s.lastMeetingAt=at;
    // Trust requires repeated successful commitments spread over time; proximity cannot earn it.
    if(s.meetings>=3&&at-s.firstMeetingAt>=7*DAY&&comfort>0)s.trust=clamp(s.trust+.15,-100,100);
    const previous=s.stage;
    if(s.stage==='authored')s.stage='acquaintance';
    if(s.stage!=='estranged'&&s.meetings>=pol.friendMeetings&&at-s.firstMeetingAt>=pol.friendDays*DAY&&s.warmth>=pol.friendWarmth&&s.trust>=0)s.stage='friend';
    if(s.stage==='distant'&&comfort>0)s.stage='acquaintance';
    if((s.strain||0)>=pol.strainThreshold)s.stage='estranged';
    else if(s.stage==='estranged'&&(s.strain||0)<pol.strainThreshold/2)s.stage='acquaintance';
    if(previous!==s.stage)r.events.push({id:`bond:${c.id}:${++r.sequence}`,kind:'social_bond',at:now,personId:p.id,direction:which,stage:s.stage,summary:which==='self'?`The recorded relationship with ${p.name} now has ${s.stage} experience evidence.`:'The supporting person’s private relationship appraisal changed.'});
   }
   lifecycle.advance(c,p,pair,plan,now);
  }
  // Resolved plan IDs no longer in the bounded plan projection cannot recur.
  const retained=new Set((c.vh2Plans?.plans||[]).map(p=>p.id));pair.processed=pair.processed.filter(id=>retained.has(id));
 }
 r.lastAt=now;r.events=r.events.slice(-100);return r;
}
function preference(c,personId){return c.vh2SocialBonds?.pairs?.[personId]?.other.warmth;}
function known(c){return Object.values(c.vh2SocialBonds?.pairs||{}).filter(p=>p.self.meetings).map(p=>({personId:p.personId,sharedMeetings:p.self.meetings,lastMeetingAt:p.self.lastMeetingAt,ownAssessment:p.self.stage,ownWarmth:p.self.warmth,ownTrust:p.self.trust,romanticStatus:p.lifecycle?.status||'none',contactExchangedAt:p.lifecycle?.contactExchangedAt||null}));}
module.exports={ensure,advance,preference,known};
