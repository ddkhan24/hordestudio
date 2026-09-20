/* Private NPC relationship evidence and small-group intentions. No invented dialogue. */
'use strict';
const {random}=require('./vh2-decision-engine');
const MIN=60000,DAY=86400000,clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const DEFAULTS={encounterCooldownMinutes:360,friendMeetings:8,friendDays:7,friendWarmth:6,quietDays:21,groupPlansEnabled:false,planCooldownHours:24,planDurationMinutes:30,maxPlanTravelMinutes:60};
const DISPOSITION={openness:50,trustOpenness:50,sensitivity:50,sociability:50};
function ensure(c){const n=c.vh2People?.network;if(!n)return null;n.policy={...DEFAULTS,...n.policy};n.dispositions||={};n.pairs||={};n.events||=[];const store=c.vh2Plans||={plans:[],events:[]};for(const p of n.plans||[])if(!store.plans.some(x=>x.id===p.id))store.plans.push({...p,scope:'peers',origin:p.origin||'autonomous'});delete n.plans;n.sequence||=0;n.observed||=[];return n;}
function peerPlans(c){ensure(c);return (c.vh2Plans?.plans||[]).filter(p=>p.scope==='peers');}
function disposition(n,id){return {...DISPOSITION,...n.dispositions[id]};}
function side(n,id,pair){return {warmth:pair.warmth||0,trust:0,strain:0,meetings:pair.meetings||0,firstAt:null,lastAt:pair.lastAt??null,stage:'acquaintance'};}
function sides(n,pair){if(!pair.sides)pair.sides=pair.people.map(id=>side(n,id,pair));return pair.sides;}
function assessment(n,pair,id){return sides(n,pair)[pair.people.indexOf(id)];}
function emit(n,kind,at,details){n.events.push({id:'network:'+ ++n.sequence,kind,at,scope:'private_world_fact',...details});n.events=n.events.slice(-200);}
function key(a,b){return JSON.stringify([a,b].sort());}
function updateBond(n,pair,a,b,at){
 for(const [i,actor] of [a,b].entries()){
  const s=sides(n,pair)[i],d=disposition(n,actor.id),comfort=1-actor.stress/65;
  const delta=clamp(comfort*(.3+d.openness/100),-1,1);
  s.warmth=clamp(s.warmth+delta,-100,100);s.strain=clamp(s.strain+(delta<0?-delta*(.5+d.sensitivity/100):-delta*.25));
  s.meetings++;s.firstAt??=at;s.lastAt=at;
  if(s.meetings>=3&&at-s.firstAt>=DAY&&delta>0)s.trust=clamp(s.trust+.1*d.trustOpenness/100,-100,100);
  if(delta<0)s.trust=clamp(s.trust+delta*.15,-100,100);
  const previous=s.stage;
  if(s.strain>=8)s.stage='strained';
  else if(s.meetings>=n.policy.friendMeetings&&at-s.firstAt>=n.policy.friendDays*DAY&&s.warmth>=n.policy.friendWarmth&&s.trust>=0)s.stage='friend';
  else if(s.stage==='distant'||s.stage==='strained'&&s.strain<4)s.stage='acquaintance';
  if(previous!==s.stage)emit(n,'npc_bond_changed',at,{people:pair.people,observerId:actor.id,stage:s.stage});
  actor.boredom=clamp(actor.boredom-3);actor.stress=clamp(actor.stress-delta);
 }
 pair.warmth=pair.sides.reduce((sum,s)=>sum+s.warmth,0)/2; // Legacy aggregate for old inspectors only.
}
function advance(c,now,localAt){
 const r=c.vh2People;if(!r?.network?.enabled)return;const n=ensure(c);n.lastAt??=now;
 const actors=Object.values(r.actors).sort((a,b)=>a.id.localeCompare(b.id));
 for(let at=n.lastAt+MIN;at<=now;at+=MIN){
  for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
   const a=actors[i],b=actors[j],pa=a.presenceHistory?.find(h=>h.from<=at-MIN&&h.until>=at),pb=b.presenceHistory?.find(h=>h.from<=at-MIN&&h.until>=at);
   if(!pa?.available||!pb?.available||!pa.placeId||pa.placeId!==pb.placeId)continue;
   const ident=key(a.id,b.id),pair=n.pairs[ident]||={people:[a.id,b.id],minutes:0,meetings:0,warmth:0,lastAt:null};
   sides(n,pair);pair.minutes++;
   if(pair.lastAt!==null&&at-pair.lastAt<n.policy.encounterCooldownMinutes*MIN||pair.minutes<5)continue;
   const chance=(disposition(n,a.id).sociability+disposition(n,b.id).sociability)/200;
   if(random(c.id+'|network|'+ident+'|'+at)>=chance*.05)continue;
   updateBond(n,pair,a,b,at);pair.meetings++;pair.lastAt=at;pair.lastPlaceId=pa.placeId;
   emit(n,'npc_encounter',at,{people:pair.people,placeId:pa.placeId});
  }
  for(const pair of Object.values(n.pairs))for(const s of sides(n,pair)){
   if(s.lastAt!==null&&at-s.lastAt>n.policy.quietDays*DAY&&s.stage==='friend'){s.stage='distant';emit(n,'npc_bond_changed',at,{people:pair.people,stage:'distant'});}
  }
  if(localAt)advancePlans(c,n,at,localAt);
 }
 n.lastAt=now;
}
function busyPlan(c,id,start,end,ignoreId){return require('./vh2-plans-engine').conflicts(c,id,start,end,ignoreId);}
function homeAccess(c,place,ids,responses){const venue=c.lifeProfile.places?.find(p=>p.id===place);if(venue?.kind!=='home')return true;return ids.some(id=>c.vh2People.actors[id]?.policy.homePlaceId===place&&(!responses||responses[id]?.decision==='accept'));}
function feasible(c,a,place,at,start,end,localAt,ignoreId){
 if(!a||a.journey||a.energy<25||a.hunger>80)return false;
 const people=require('./vh2-people-engine'),path=people.route(c.lifeProfile.travelLegs,a,place);
 if(path===null||path.reduce((sum,l)=>sum+l.minutes,0)>ensure(c).policy.maxPlanTravelMinutes||Math.max(at,a.action?.endsAt||at)+path.reduce((sum,l)=>sum+l.minutes,0)*MIN>start||busyPlan(c,a.id,at,end,ignoreId))return false;
 for(let t=at;t<end;t+=MIN)if(people.routine(c,a.id,t,localAt))return false;
 return true;
}
function advancePlans(c,n,at,localAt){
 // Invitations are proposals, never attendance. Each participant resolves their own response.
 for(const plan of peerPlans(c).filter(p=>p.status==='proposed')){
  if(at>=plan.startsAt){plan.status='expired';plan.resolvedAt=at;continue;}
  const members=plan.people.map(id=>c.vh2People.actors[id]);
  let place=plan.placeId;
  const alternatives=[...new Set(members.flatMap(a=>a?.policy.leisurePlaceIds||[]))].filter(id=>members.every(a=>a?.policy.leisurePlaceIds.includes(id)));
  const acceptable=id=>homeAccess(c,id,plan.people)&&members.every(a=>feasible(c,a,id,at,plan.startsAt,plan.endsAt,localAt,plan.id))&&require('./vh2-geography-engine').open(c.vh2Geography?.places?.[id]||{},plan.startsAt,localAt,c)!==false;
  const experience=id=>members.reduce((sum,a)=>sum+require('./vh2-psychology-engine').reflectionScore(a?.psychology,id),0);
  const alternate=alternatives.filter(acceptable).sort((a,b)=>experience(b)-experience(a)||a.localeCompare(b))[0];
  if(alternate&&(!acceptable(place)||experience(alternate)>experience(place)+2)){
   plan.counterproposal={at,fromPlaceId:place,toPlaceId:alternate,reason:'A mutually reachable alternative better fits availability or recorded preferences.'};place=alternate;plan.placeId=place;
  }
  plan.responses=Object.fromEntries(plan.people.map(id=>{
   const a=c.vh2People.actors[id],can=feasible(c,a,place,at,plan.startsAt,plan.endsAt,localAt,plan.id)&&require('./vh2-geography-engine').open(c.vh2Geography?.places?.[place]||{},plan.startsAt,localAt,c)!==false,probability=.2+disposition(n,id).sociability*.006;
   const accepted=can&&random(c.id+'|invite|'+id+'|'+plan.createdAt)<probability;
   return [id,{at,decision:accepted?'accept':'decline',reason:!can?'The location or timing is not feasible.':accepted?'Chose to join.':'Preferred to spend this time differently.',source:'participant_decision'}];
  }));
  plan.status=Object.values(plan.responses).filter(r=>r.decision==='accept').length>=2&&homeAccess(c,place,plan.people,plan.responses)?'accepted':'declined';
  if(plan.status==='declined')plan.resolvedAt=at;
  emit(n,'npc_plan_'+plan.status,at,{planId:plan.id,people:plan.people,placeId:plan.placeId});
 }

 for(const plan of peerPlans(c).filter(p=>p.status==='accepted'||p.status==='active')){
  const privateVenue=c.lifeProfile.places?.find(p=>p.id===plan.placeId&&p.kind==='home'),host=privateVenue&&plan.people.find(id=>c.vh2People.actors[id]?.policy.homePlaceId===plan.placeId);
  if(privateVenue&&(!host||!require('./vh2-plans-engine').committed(c,plan,host))){plan.status=plan.sharedMinutes>=5?'completed':'missed';plan.resolvedAt=at;emit(n,'npc_plan_'+plan.status,at,{people:plan.people,placeId:plan.placeId,planId:plan.id,reason:'The resident host is no longer participating.'});continue;}
  if(at>=plan.startsAt){
   const present=require('./vh2-plans-engine').participants(c,plan).filter(id=>{const a=c.vh2People.actors[id],h=a?.presenceHistory?.find(h=>h.from<=at-MIN&&h.until>=at);return h?.placeId===plan.placeId&&h.peerPlanId===plan.id&&h.available;});
   if(at>plan.startsAt&&present.length>=2){plan.sharedMinutes++;plan.attendance||={};plan.pairMinutes||={};for(const id of present){const entry=plan.attendance[id]||={arrivedAt:at,minutes:0,lastAt:at};entry.minutes++;entry.lastAt=at;}for(let i=0;i<present.length;i++)for(let j=i+1;j<present.length;j++){const k=key(present[i],present[j]);plan.pairMinutes[k]=(plan.pairMinutes[k]||0)+1;}for(const id of present){const actor=c.vh2People.actors[id];actor.boredom=clamp(actor.boredom-.3);actor.stress=clamp(actor.stress-.03);}}
   if(present.length>=2)plan.status='active';
  }
  if(at>=plan.endsAt){plan.status=plan.sharedMinutes>=Math.min(5,n.policy.planDurationMinutes)?'completed':'missed';plan.resolvedAt=at;emit(n,'npc_plan_'+plan.status,at,{people:plan.people,placeId:plan.placeId,planId:plan.id,sharedMinutes:plan.sharedMinutes});}
 }
 c.vh2Plans.plans=c.vh2Plans.plans.filter(p=>p.scope!=='peers'||['proposed','accepted','active'].includes(p.status)||at-(p.resolvedAt||p.createdAt)<14*DAY);
 if(!n.policy.groupPlansEnabled||n.lastPlanReview===Math.floor(at/(60*MIN)))return;n.lastPlanReview=Math.floor(at/(60*MIN));
 const actors=c.vh2People.actors;
 for(const pair of Object.values(n.pairs).sort((a,b)=>key(...a.people).localeCompare(key(...b.people)))){
  if(!sides(n,pair).every(s=>s.stage==='friend')||!pair.lastPlaceId||at-(pair.lastInviteAt??-Infinity)<n.policy.planCooldownHours*60*MIN)continue;
  if(peerPlans(c).some(p=>['proposed','accepted','active'].includes(p.status)&&p.people.some(id=>pair.people.includes(id))))continue;
  const members=pair.people.slice(),place=pair.lastPlaceId,startsAt=at+(n.policy.maxPlanTravelMinutes+30)*MIN,endsAt=startsAt+n.policy.planDurationMinutes*MIN;
  if(!homeAccess(c,place,members)||!members.every(id=>feasible(c,actors[id],place,at,startsAt,endsAt,localAt)))continue;
  pair.lastInviteAt=at;
  // Invite a third person only when both existing members have direct friendship evidence.
  for(const id of Object.keys(actors).sort()){
   if(members.includes(id)||!members.every(other=>{const p=n.pairs[key(id,other)];return p&&sides(n,p).every(s=>s.stage==='friend');})||peerPlans(c).some(p=>['proposed','accepted','active'].includes(p.status)&&p.people.includes(id)))continue;
   if(feasible(c,actors[id],place,at,startsAt,endsAt,localAt)&&random(c.id+'|invite-third|'+id+'|'+at)<disposition(n,id).sociability/100){members.push(id);break;}
  }
  const plan={scope:'peers',origin:'autonomous',id:'peer-plan:'+ ++n.sequence,people:members,placeId:place,startsAt,endsAt,createdAt:at,status:'proposed',sharedMinutes:0};c.vh2Plans.plans.push(plan);emit(n,'npc_plan_proposed',at,{planId:plan.id,people:members,placeId:place});break;
 }
}
function observe(c,now){
 const n=c.vh2People?.network,w=c.lifeRuntime?.world;if(!n?.enabled||!w||w.journey||c.humanDynamics?.sleep?.stage==='asleep')return;
 ensure(c);
 for(const p of peerPlans(c)){
  if(!['accepted','active'].includes(p.status)||now<p.startsAt||now>=p.endsAt||p.placeId!==w.placeId||n.observed.some(o=>o.planId===p.id))continue;
  const attending=require('./vh2-plans-engine').participants(c,p);if(attending.length<2||!attending.every(id=>{const a=c.vh2People.actors[id];return a&&!a.journey&&a.placeId===w.placeId&&a.action?.peerPlanId===p.id;}))continue;
  const known=attending.filter(id=>(c.lifeProfile.socialCircle||[]).some(person=>person.id===id));if(known.length<2)continue;
  n.observed.push({planId:p.id,at:now,placeId:p.placeId,people:known,scope:'direct_observation'});
 }
 n.observed=n.observed.slice(-40);
}
function preference(c,id,place,at){const n=ensure(c);if(!n?.enabled)return 0;return clamp(Object.values(n.pairs).filter(p=>p.people.includes(id)&&p.lastPlaceId===place&&at-p.lastAt<7*DAY).reduce((sum,p)=>sum+assessment(n,p,id).warmth*.5,0),-10,10);}
module.exports={advance,observe,preference,ensure,peerPlans,DEFAULTS,DISPOSITION};
