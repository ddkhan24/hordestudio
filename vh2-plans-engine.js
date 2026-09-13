/* One canonical joint-activity lifecycle. Intentions never substitute for attendance. */
'use strict';
const activity=require('./vh-activity-engine'),bonds=require('./vh2-social-bonds'),people=require('./vh2-people-engine');
const {random}=require('./vh2-decision-engine');
const MIN=60000,active=p=>['proposed','accepted','active'].includes(p.status),clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,n));
const DEFAULTS={enabled:false,remoteInvitations:true,hostedEvents:true,privateVisits:false,invitationCooldownMinutes:360,socialNeedThreshold:55,maxGuests:5,privateVisitInterest:35};
function ensure(c){const r=c.vh2Plans ||= {plans:[],events:[]};r.policy={...DEFAULTS,...r.policy};r.privateVisitPermissions||=[];r.lastInvites||={};r.sequence||=0;r.privateVisitDefaults={enabled:r.policy.privateVisits,selfWillingness:r.policy.privateVisitInterest,otherWillingnessSource:'Individual private-visit interest or sociability; neutral default 50.',allowIntimacy:false,scope:'Known adults only; each visit still requires independent acceptance and host access.'};return r;}
function members(c,p){return [...new Set(p.people||[c.id,p.personId].filter(Boolean))];}
function committed(c,p,id,at=Infinity){return members(c,p).includes(id)&&!(p.departures?.[id]?.at<=at)&&p.responses?.[id]?.decision!=='decline';}
function participants(c,p){return members(c,p).filter(id=>committed(c,p,id));}
function conflicts(c,id,start,end,ignoreId){return (c.vh2Plans?.plans||[]).some(p=>![ignoreId].flat().includes(p.id)&&active(p)&&committed(c,p,id)&&p.startsAt<end&&p.endsAt>start);}
function event(c,p,kind,at,summary,extra={}){const r=ensure(c);r.events.push({id:`${p.id}:${kind}`,kind:'shared_plan',at,planId:p.id,personId:p.personId,participantIds:participants(c,p),activityKind:p.activityKind||'meeting',phase:kind.startsWith('left:')?'departure':kind,observerIds:participants(c,p).filter(id=>id!==c.id||!['started','completed','missed'].includes(kind)||!p.departures?.[id]).concat(kind==='left:'+c.id?[c.id]:[],kind==='declined'?Object.keys(p.responses||{}):kind.startsWith('response:')?[kind.slice(9),p.initiatorId].filter(Boolean):[]),outcome:kind==='completed'?'shared_activity_completed':kind==='missed'?'insufficient_participation':null,placeId:p.placeId,summary,...extra});r.events=r.events.slice(-200);}
function routineAt(c,id,at,localAt){const t=people.actorLocal(c,people.actor(c,id),at,localAt),m=t.hour*60+t.minute;return (c.lifeProfile.world.people||[]).find(p=>require('./vh-world-engine').activeOn(p,t.dateKey)&&p.personId===id&&p.days.includes(t.weekday)&&m>=p.start&&m<p.end);}
function contactOpen(c,person,at,core){const t=people.actorLocal(c,people.actor(c,person.id),at,core.companionLocalMinuteInfo),m=t.hour*60+t.minute;return (person.contactWindows||[]).some(w=>w.days.includes(t.weekday)&&m>=w.startMinute&&m<w.endMinute);}
function home(c,id){if(id!==c.id)return people.actor(c,id)?.policy.homePlaceId||'';const places=c.lifeProfile.places||[];return c.vh2Travel?.residenceId||(places.filter(p=>p.kind==='home').length===1?places.find(p=>p.kind==='home').id:'');}
function location(c,id){return id===c.id?c.lifeRuntime.world.placeId:people.actor(c,id)?.placeId||c.lifeRuntime.world.people?.[id]?.placeId;}
function state(c,id){return id===c.id?c.humanDynamics||{}:people.actor(c,id)||c.lifeRuntime.world.people?.[id]||{};}
function permission(c,id){
 const r=ensure(c),known=c.lifeProfile.socialCircle?.find(p=>p.id===id),resident=c.vh2Population?.residents?.find(p=>p.id===id),age=require('./vh-simulation-core').companionCurrentAge(c,known||resident);
 if(!known||!Number.isFinite(age)||age<18)return;
 const explicit=r.privateVisitPermissions.find(p=>p.personId===id);if(explicit)return explicit.enabled&&require('./vh-simulation-core').companionAgeConfirmationMatches(c,known,explicit.personAge)?{...explicit,allowIntimacy:explicit.allowIntimacy&&known.role!=='family'}:undefined;
 if(!r.policy.privateVisits)return;
 const a=people.actor(c,id);return {personId:id,personAge:age,enabled:true,selfWillingness:r.policy.privateVisitInterest,otherWillingness:clamp(a?.policy.privateVisitInterest??c.vh2People?.network?.dispositions?.[id]?.sociability??50),allowIntimacy:false,source:'personality_policy'};
}

function access(c,p){if(p.modality==='call')return true;const place=c.lifeProfile.places?.find(x=>x.id===p.placeId);if(!place)return !p.activityKind||p.activityKind==='meeting';if(place.kind!=='home')return p.activityKind!=='private_visit';return !!p.hostId&&home(c,p.hostId)===p.placeId&&members(c,p).includes(p.hostId)&&p.responses?.[p.hostId]?.decision!=='decline';}
function physicallyPresent(c,p,id,at,localAt){
 if(!committed(c,p,id,at))return false;
 if(id===c.id)return !c.lifeRuntime.world.journey&&(p.modality==='call'||c.lifeRuntime.world.placeId===p.placeId);
 const a=people.actor(c,id);
 if(p.modality==='call'){const h=a?.presenceHistory?.find(x=>x.from<=at&&at<x.until);return h?h.actionKind==='call'&&h.planId===p.id:!!a&&at===a.lastAt&&!a.journey&&a.action?.kind==='call'&&a.action.planId===p.id;}
 return a?people.availableAt(c,id,p.placeId,at)&&((a.presenceHistory?.find(x=>x.from<=at&&at<x.until)?.planId??(at===a.lastAt?a.action?.planId:null))===p.id):c.lifeRuntime.world.people?.[id]?.placeId===p.placeId&&!(c.lifeRuntime.world.people[id].restUntil>at)&&(!localAt||routineAt(c,id,at,localAt)?.placeId===p.placeId);
}
function canMeet(c,id,at,localAt){
 const p=c.vh2Plans?.plans.find(p=>p.id===id);if(!p||!['accepted','active'].includes(p.status)||!committed(c,p,c.id)||at<p.startsAt||at>=p.endsAt||!access(c,p)||!physicallyPresent(c,p,c.id,at,localAt))return false;
 const present=participants(c,p).filter(id=>id!==c.id&&physicallyPresent(c,p,id,at,localAt));
 if(p.activityKind==='private_visit')return present.length===1&&privateReady(c,p,at);
 return present.length>0;
}
function leave(c,p,id,at,reason='Chose to leave.'){
 if(!committed(c,p,id))return false;p.departures||={};p.departures[id]={at,reason};
 if(id===c.id){const goal=c.lifeRuntime.activities?.goals.find(g=>g.id===p.goalId);if(goal&&!['completed','abandoned'].includes(goal.status)){goal.status='abandoned';goal.reason=reason;}}
 event(c,p,'left:'+id,at,`${id===c.id?c.name||'The character':c.lifeProfile.socialCircle?.find(x=>x.id===id)?.name||'A participant'} left ${p.label}. ${reason}`,{departedPersonId:id});
 if(id===p.hostId&&p.activityKind==='hosted_event')p.hostLeftAt=at;
 if(id===c.id&&['hosted_event','private_visit','event_outing'].includes(p.activityKind)&&!p.replacedByPlanId)returnHome(c,p,at);
 return true;
}
function command(c,body,now){
 const r=ensure(c);
 if(body.type==='propose_plan'){
  while(r.plans.length>=100){const i=r.plans.findIndex(p=>!active(p));if(i<0)throw Error('Too many unresolved shared plans.');r.plans.splice(i,1);}
  const ids=[c.id,...(body.personIds||[body.personId])],hostId=body.hostId||ids.find(id=>home(c,id)===body.placeId)||null;
  const p={id:body.planId,scope:'shared',people:[...new Set(ids)],personId:body.personId,placeId:body.modality==='call'?'':body.placeId,label:body.label,startsAt:body.startsAt,endsAt:body.endsAt,durationMinutes:body.durationMinutes,createdAt:now,status:'proposed',origin:body.origin||'studio_request',goalId:'',response:null,responses:{},initiatorId:body.initiatorId||c.id,hostId,modality:body.modality||'in_person',activityKind:body.activityKind||'meeting',parentPlanId:body.parentPlanId||null,sourceSignalId:body.sourceSignalId||null,returnPlaceId:body.returnPlaceId||home(c,c.id)||location(c,c.id),attendance:{},pairMinutes:{},departures:{},lastAttendanceAt:now,recordedProgress:0};
  r.plans.push(p);event(c,p,'proposed',now,`Proposed ${p.label}; each person may accept, refuse or leave. Attendance is not established.`);return p;
 }
 const p=r.plans.find(p=>p.id===body.planId);if(!p)throw Error('Unknown plan.');
 if(body.type==='leave_plan'){leave(c,p,body.personId||c.id,now,body.reason||'Chose to leave.');return p;}
 if(body.type==='respond_plan'){
  const id=body.personId||c.id;p.responses||={};p.responses[id]={at:now,decision:body.decision,source:'explicit_response',reason:body.reason||'Recorded response.'};event(c,p,'response:'+id,now,`Recorded ${body.decision==='accept'?'acceptance':'refusal'} of ${p.label}.`,{responderId:id});return p;
 }
 p.status='cancelled';const goal=c.lifeRuntime.activities?.goals.find(g=>g.id===p.goalId);if(goal&&!['completed','abandoned'].includes(goal.status)){goal.status='abandoned';goal.reason='Shared plan cancelled.';}event(c,p,'cancelled',now,`Cancelled ${p.label}.`);return p;
}
function privateReady(c,p,at){
 const other=members(c,p).find(id=>id!==c.id),perm=permission(c,other);if(!(require('./vh-simulation-core').companionCurrentAge(c)>=18)||!perm||members(c,p).length!==2||!access(c,p))return false;
 for(const id of members(c,p)){const d=state(c,id);if((d.energy??75)<25||(d.stress??0)>80||(d.intoxication??0)>=20||d.journey||d.restUntil>at)return false;}
 return !Object.values(c.vh2People?.actors||{}).some(a=>!members(c,p).includes(a.id)&&!a.journey&&a.placeId===p.placeId);
}
function feasible(c,p,id,now,core){
 if(p.modality!=='call'&&require('./vh2-geography-engine').open(c.vh2Geography?.places?.[p.placeId]||{},p.startsAt,core.companionLocalMinuteInfo,c,p.placeId)===false)return 'The place is unavailable at the proposed time.';
 const d=state(c,id);if(d.journey||id===c.id&&c.lifeRuntime.world.journey)return 'Already travelling.';
 if(d.restUntil>now||d.sleep?.stage==='asleep'||['sleep','eat'].includes(d.action?.kind)||(d.energy??75)<25||(d.hunger??0)>90)return 'Needs rest or food first.';
 if(conflicts(c,id,p.startsAt,p.endsAt,[p.id,p.parentPlanId]))return 'Another accepted invitation or intention conflicts.';
 if(p.modality==='call'){
  if(id!==c.id)return people.actor(c,id)?people.meetingConflict(c,id,p,now,core.companionLocalMinuteInfo)||'':'Independent life is not configured.';
  for(let at=p.startsAt;at<p.endsAt;at+=MIN){const t=core.companionLocalMinuteInfo(c,at),minute=t.hour*60+t.minute;
   if((c.lifeProfile.weeklySchedule||[]).some(b=>require('./vh-world-engine').activeOn(b,t.dateKey)&&b.flexibility!=='soft'&&(b.flexibility==='fixed'||['busy','private','asleep'].includes(b.availability))&&b.days.includes(t.weekday)&&minute>=b.startMinute&&minute<b.endMinute))return 'A fixed commitment conflicts with the call.';
  }
  return '';
 }
 if(id===c.id){
  if(location(c,id)===p.placeId)return '';
  if(!c.lifeProfile.world?.transport?.enabled)return 'Travel is not configured.';
  const legs=require('./vh2-transport-engine').route(c,require('./vh2-travel-engine').routingActor(c),p.placeId,now);
  return legs&&require('./vh2-transport-engine').arrivalTime(legs,now)<=p.startsAt?'':'No affordable route arriving in time.';
 }
 if(people.actor(c,id))return people.meetingConflict(c,id,p,now,core.companionLocalMinuteInfo)||'';
 for(let t=p.startsAt;t<p.endsAt;t+=MIN)if(routineAt(c,id,t,core.companionLocalMinuteInfo)?.placeId!==p.placeId)return 'The proposed place/time conflicts with the supporting person’s known routine.';
 return '';
}
function willingness(c,p,id,core){
 const otherId=id===c.id?p.personId:id,person=c.lifeProfile.socialCircle?.find(x=>x.id===otherId)||{},d=state(c,id);
 let probability=clamp(.5+(id===c.id?(c.vh2SocialBonds?.pairs?.[otherId]?.self.warmth??person.closeness??0):(bonds.preference(c,otherId)??person.closeness??0))*.004-(person.tension||0)*.006,.05,.95);
 if(p.activityKind==='private_visit'){const perm=permission(c,p.personId);probability=perm?(id===c.id?perm.selfWillingness:perm.otherWillingness)/100:0;}
 const draw=core.companionSeededRoll(`${c.lifeProfile.seed}|${p.id}|${id}|invitation`);return {probability,draw,accepted:draw<probability};
}
function reserveGoal(c,p,now){
 if(!committed(c,p,c.id)||p.goalId)return;
 const person=c.lifeProfile.socialCircle.find(x=>x.id===p.personId),goal=activity.addGoal(c.lifeRuntime.activities,'contact','shared:'+p.id,now,p.modality==='call'?p.label:`${p.label} with ${person?.name||'the group'}`);
 if(!goal)return false;
 const outbound=(c.lifeProfile.travelLegs||[]).filter(l=>l.from===location(c,c.id)&&l.to===p.placeId).map(l=>l.minutes),lead=location(c,c.id)===p.placeId||p.modality==='call'?0:Math.min(...outbound,120);
 Object.assign(goal,{meetingId:p.id,requiredPlaceId:p.modality==='call'?'':p.placeId,notBefore:Math.max(now,p.startsAt-lead*MIN),expiresAt:p.endsAt,deadline:p.endsAt,priority:75});goal.steps[0].durationMs=p.durationMinutes*MIN;p.goalId=goal.id;return true;
}
function automatic(c,now,core,opportunity=null){
 const r=ensure(c),pol=r.policy;if(!pol.enabled||c.vh2AutonomyPaused||!pol.remoteInvitations||r.lastReview===Math.floor(now/(30*MIN)))return;r.lastReview=Math.floor(now/(30*MIN));
 const w=c.lifeRuntime.world;if(w.journey||c.humanDynamics?.sleep?.stage==='asleep'||(c.humanDynamics?.energy??0)<30||(c.lifeRuntime.activities?.conversationUntil||0)>now)return;
 for(const initiator of [c.id,...Object.keys(c.vh2People?.actors||{}).sort()]){
  const d=state(c,initiator),need=initiator===c.id?d.socialNeed:d.socialNeed??d.boredom;
  if(d.journey||['sleep','eat','call','obligation'].includes(d.action?.kind)||(need??0)<(opportunity?Math.max(20,pol.socialNeedThreshold-15):pol.socialNeedThreshold)||(d.energy??75)<35||(d.hunger??0)>80||now-(r.lastInvites[initiator]??-Infinity)<pol.invitationCooldownMinutes*MIN)continue;
  const candidates=(c.lifeProfile.socialCircle||[]).filter(p=>(initiator===c.id||p.id===initiator)&&people.actor(c,p.id)&&(contactOpen(c,p,now,core)||location(c,p.id)===w.placeId));
  if(!candidates.length)continue;
  // Repeatedly choosing the first closest friend starves every other relationship.
  const ranked=candidates.map(person=>({person,score:(person.closeness||0)*.4+Math.min(25,(now-(r.lastContact?.[person.id]??now-7*86400000))/86400000*4)+random(c.id+'|invite-person|'+person.id+'|'+r.lastReview)*35})).sort((a,b)=>b.score-a.score||a.person.id.localeCompare(b.person.id));
  const person=ranked[0].person;
  const source=(c.vh2Signals?.known||[]).filter(e=>e.type==='calendar_event'&&e.eventStatus==='listed'&&e.expiresAt>now&&e.startsAt<=now+2*3600000&&(e.endsAt==null||e.endsAt>now+20*MIN)&&(!e.requiresTicket||e.accessConfirmed)&&c.lifeProfile.places.some(p=>p.id===e.placeId&&p.kind!=='home')&&!r.plans.some(p=>p.sourceSignalId===e.id)).sort((a,b)=>a.startsAt-b.startsAt||a.id.localeCompare(b.id))[0];
  const hostId=initiator,hostHome=home(c,hostId);let hosted=!source&&pol.hostedEvents&&hostHome&&(person.closeness||0)>=30&&random(c.id+'|host|'+initiator+'|'+r.lastReview)<.35;
  let placeId=source?.placeId||(hosted?hostHome:(c.lifeProfile.places||[]).find(p=>p.kind!=='home'&&(c.vh2Geography?.knownPlaceIds||[]).includes(p.id)&&people.actor(c,person.id).policy.leisurePlaceIds.includes(p.id))?.id);
  const modality=source||placeId&&random(c.id+'|mode|'+initiator+'|'+r.lastReview)>=.3?'in_person':'call';if(modality==='call')hosted=false;
  const startsAt=source?Math.max(now+15*MIN,source.startsAt):now+(modality==='call'?10:90)*MIN,endsAt=source?Math.min(source.endsAt??startsAt+120*MIN,startsAt+120*MIN):startsAt+(hosted?90:30)*MIN;
  if(endsAt<=startsAt||conflicts(c,c.id,startsAt,endsAt)||conflicts(c,person.id,startsAt,endsAt))continue;
  const personIds=[person.id],forwarded=[];
  if(hosted||source)for(const p of c.lifeProfile.socialCircle||[])if(p.id!==person.id&&p.closeness>=30&&people.actor(c,p.id)&&personIds.length<pol.maxGuests&&!conflicts(c,p.id,startsAt,endsAt))personIds.push(p.id);
  if(hosted&&initiator!==c.id)for(const id of Object.keys(c.vh2People?.actors||{}).sort()){
   if(personIds.includes(id)||personIds.length>=pol.maxGuests||conflicts(c,id,startsAt,endsAt))continue;
   const pair=c.vh2People.network?.pairs?.[JSON.stringify([initiator,id].sort())];
   if(pair?.sides?.every(s=>s.stage==='friend')){personIds.push(id);forwarded.push({personId:id,invitedBy:initiator});}
  }
  const p=command(c,{type:'propose_plan',planId:'social:'+c.id+':'+(++r.sequence),personId:person.id,personIds,initiatorId:initiator,hostId:hosted?hostId:null,placeId:placeId||'',modality,activityKind:source?'event_outing':hosted?'hosted_event':'meeting',sourceSignalId:source?.id,startsAt,endsAt,durationMinutes:Math.min((endsAt-startsAt)/MIN,source||hosted?30:modality==='call'?12:20),label:source?'Go together to '+source.title:hosted?'An informal gathering at home':modality==='call'?`Call ${person.name}`:`Spend time together`,origin:'autonomous'},now);p.forwardedInvitations=forwarded;
  r.lastInvites[initiator]=now;r.lastContact||={};r.lastContact[person.id]=now;p.reason='Chose to seek company during available time.';
  if(opportunity)p.storyOpportunityId=opportunity.storyId;return p;
 }
}
function before(c,now,core){
 const r=ensure(c);automatic(c,now,core);
 for(const p of r.plans){
  if(p.scope==='peers'||!active(p))continue;
  if(p.status==='proposed'){
   if(now>=p.startsAt){p.status='expired';event(c,p,'expired',now,`No decision was recorded in time for ${p.label}.`);continue;}
   p.responses||={};
   const primary=state(c,p.personId),person=c.lifeProfile.socialCircle.find(x=>x.id===p.personId);
   if(!person||primary.journey||['sleep','eat','call','obligation'].includes(primary.action?.kind)||c.lifeRuntime.world.journey||c.humanDynamics?.sleep?.stage==='asleep'||(primary.energy??75)<25||primary.restUntil>now||location(c,p.personId)!==location(c,c.id)&&!contactOpen(c,person,now,core))continue;
   // A counterproposal is shared before independent responses; no silent movement.
   if(p.modality!=='call'&&p.activityKind==='meeting'&&!p.counterproposal){
    const alternatives=(c.lifeProfile.places||[]).filter(x=>x.kind!=='home'&&members(c,p).every(id=>!feasible(c,{...p,placeId:x.id},id,now,core)));
    if(members(c,p).some(id=>feasible(c,p,id,now,core))&&alternatives.length){p.counterproposal={at:now,fromPlaceId:p.placeId,toPlaceId:alternatives[0].id,reason:'A mutually reachable alternative.'};p.placeId=alternatives[0].id;}
   }
   for(const id of members(c,p)){
    if(p.responses[id])continue;
    const reason=feasible(c,p,id,now,core)||(!access(c,p)?'Host access is not established.':'')||(p.activityKind==='private_visit'&&!privateReady(c,p,now)?'Adult eligibility, privacy or readiness is not established.':'');
    const decision=willingness(c,p,id,core),initiator=id===p.initiatorId&&p.activityKind!=='private_visit';
    p.responses[id]={at:now,decision:!reason&&(initiator||decision.accepted)?'accept':'decline',reason:reason||'Current individual preference.',source:'participant_decision',probability:decision.probability,draw:decision.draw};
   }
   const accepted=participants(c,p).length>=2&&committed(c,p,c.id)&&(!p.hostId||committed(c,p,p.hostId));
   p.response={at:now,...willingness(c,p,p.personId,core),accepted,source:'participant_decisions',routineBound:!people.actor(c,p.personId)};
   if(!accepted){p.status='declined';event(c,p,'declined',now,`The plan did not gain the required willing participants.`);continue;}
   if(!reserveGoal(c,p,now)){p.status='declined';event(c,p,'capacity',now,'No room for an executable intention.');continue;}
   p.status='accepted';if(p.sourceSignalId)for(const old of c.lifeRuntime.activities.goals)if(old.id!==p.goalId&&old.sourceSignalId===p.sourceSignalId&&!['completed','abandoned'].includes(old.status)){old.status='abandoned';old.reason='Joined the coordinated outing for this event.';}event(c,p,'accepted',now,`Accepted ${p.label}; attendance depends on each person's actual arrival.`);
   if(p.parentPlanId){const parent=r.plans.find(x=>x.id===p.parentPlanId);if(parent){parent.replacedByPlanId=p.id;for(const id of participants(c,p))leave(c,parent,id,now,'Chose a different shared activity.');}}
  }
  if(['accepted','active'].includes(p.status)){
   const primary=state(c,p.personId);
   if(primary.restUntil>now&&now>=p.startsAt&&participants(c,p).length<=2){p.status='cancelled';const goal=c.lifeRuntime.activities.goals.find(g=>g.id===p.goalId);if(goal){goal.status='abandoned';goal.reason='Supporting person is resting.';}event(c,p,'cancelled',now,'The other participant needs rest.');}
   if(p.activityKind==='private_visit'&&p.status==='active'&&now>=p.startsAt&&!privateReady(c,p,now)){for(const id of participants(c,p))leave(c,p,id,now,'Privacy or current willingness/readiness is no longer established.');}
  }
 }
}
function registerAttendance(c,p,now){
 if(!['accepted','active'].includes(p.status)||now<p.startsAt)return;
 p.attendance||={};p.pairMinutes||={};
 const from=Math.max(p.lastAttendanceAt??now,p.startsAt),until=Math.min(now,p.endsAt);p.lastAttendanceAt=now;
 const goal=c.lifeRuntime.activities?.goals.find(g=>g.id===p.goalId),events=(c.lifeRuntime.activities?.events||[]).filter(e=>e.goalId===p.goalId&&['started','paused','completed','missed','abandoned'].includes(e.kind)).sort((a,b)=>a.at-b.at);
 const progress=(goal?.steps||[]).reduce((sum,s)=>sum+(s.progressMs||0),0);let remaining=Math.max(0,progress-(p.recordedProgress||0));p.recordedProgress=progress;
 for(let at=from;at<until;at+=MIN){
  const dt=Math.min(MIN,until-at),last=events.filter(e=>e.at<=at).at(-1);
  const mainWorked=remaining>0&&last?.kind==='started';
  if(mainWorked)remaining-=dt;
  const ids=members(c,p).filter(id=>committed(c,p,id,at)&&(id===c.id?mainWorked:physicallyPresent(c,p,id,at)));
  for(const id of ids){const a=p.attendance[id]||={arrivedAt:at,minutes:0,lastAt:at};a.minutes+=dt/MIN;a.lastAt=at+dt;}
  for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=JSON.stringify([ids[i],ids[j]].sort());p.pairMinutes[key]=(p.pairMinutes[key]||0)+dt/MIN;}
  if(ids.length>=2&&p.status==='accepted'){p.status='active';event(c,p,'started',at,`Started ${p.label} with the recorded participants present.`,{attendeeIds:ids});}
 }
}

function returnHome(c,p,now){
 if(p.returnGoalId||p.modality==='call'||!p.returnPlaceId||p.returnPlaceId===location(c,c.id))return;
 const goal=activity.addGoal(c.lifeRuntime.activities,'recovery','return:'+p.id,now,'Head home after '+p.label);if(!goal)return;
 Object.assign(goal,{requiredPlaceId:p.returnPlaceId,priority:55,expiresAt:now+12*3600000,reason:'The outing ended; returning is an intention that still requires a route and can yield to needs.'});goal.steps[0].durationMs=5*MIN;p.returnGoalId=goal.id;
}
function privateFollowup(c,p,now){
 const r=ensure(c);if(!r.policy.enabled||!r.policy.privateVisits||p.modality==='call'||p.activityKind==='private_visit')return;
 if(typeof p.privateConsidered!=='object'||p.privateConsidered===null)p.privateConsidered={};
 for(const id of participants(c,p).filter(id=>id!==c.id)){
  const perm=permission(c,id);if(!perm||p.privateConsidered[id]||!(p.attendance?.[id]?.minutes>=15)||!(p.attendance?.[c.id]?.minutes>=15))continue;
  p.privateConsidered[id]=now;if(random(c.id+'|private|'+p.id+'|'+id)>=r.policy.privateVisitInterest/100)continue;
  const placeId=home(c,id);if(!placeId||placeId===p.placeId)continue;
  const mainRoute=require('./vh2-transport-engine').route(c,require('./vh2-travel-engine').routingActor(c),placeId,now),otherRoute=people.route(c.lifeProfile.travelLegs,people.actor(c,id),placeId);if(mainRoute===null||otherRoute===null)continue;
  const lead=Math.max(5,Math.ceil((require('./vh2-transport-engine').arrivalTime(mainRoute,now)-now)/MIN),otherRoute.reduce((n,l)=>n+l.minutes,0))+5;
  const start=now+lead*MIN,end=start+45*MIN;if(conflicts(c,c.id,start,end,p.id)||conflicts(c,id,start,end,p.id))continue;
  command(c,{type:'propose_plan',planId:'social:'+c.id+':'+(++r.sequence),personId:id,personIds:[id],placeId,hostId:id,activityKind:'private_visit',parentPlanId:p.id,startsAt:start,endsAt:end,durationMinutes:20,returnPlaceId:home(c,c.id)||p.returnPlaceId,label:'Spend some private time together',origin:'autonomous'},now);break;
 }
}

function after(c,now){
 for(const p of [...ensure(c).plans]){
  if(p.scope==='peers'||!['accepted','active'].includes(p.status))continue;
  registerAttendance(c,p,now);
  const goal=c.lifeRuntime.activities.goals.find(g=>g.id===p.goalId),completed=goal?.status==='completed';
  if(p.activityKind==='hosted_event'&&completed&&committed(c,p,c.id))leave(c,p,c.id,now,'Finished participating in this gathering.');
  if(p.activityKind==='private_visit'&&p.status==='active'&&!p.intimacyResponses&&privateReady(c,p,now)){
   const pref=permission(c,p.personId);if(pref?.allowIntimacy){p.intimacyResponses={};for(const id of members(c,p)){const probability=(id===c.id?pref.selfWillingness:pref.otherWillingness)/100,draw=random(c.id+'|intimacy|'+p.id+'|'+id);p.intimacyResponses[id]={at:now,decision:draw<probability?'accept':'decline',source:'current_individual_decision',probability,draw};}}
  }
  if(p.status==='active'&&(completed||p.attendance?.[c.id]?.minutes>=10))privateFollowup(c,p,now);
  const ended=now>=p.endsAt||p.hostLeftAt||participants(c,p).length<2||p.activityKind!=='hosted_event'&&(completed||goal?.status==='abandoned');
  if(!ended)continue;
  const shared=Math.max(0,...Object.values(p.pairMinutes||{})),legacy=!p.attendance;
  p.status=completed||shared>=Math.min(5,p.durationMinutes)||legacy&&completed?'completed':'missed';p.completedAt=p.status==='completed'?now:undefined;p.resolvedAt=now;
  const attendeeIds=Object.keys(p.attendance||{}).filter(id=>p.attendance[id].minutes>0);
  if(p.activityKind==='private_visit'&&p.status==='completed'&&completed&&participants(c,p).length===2&&privateReady(c,p,now)){
   const mutual=p.intimacyResponses&&members(c,p).every(id=>p.intimacyResponses[id]?.decision==='accept');p.privateOutcome={at:now,kind:mutual?'mutual_private_intimacy':'private_time',participantIds:attendeeIds,description:mutual?'Shared consensual private intimacy. Details remain private.':'Spent private time together.'};
  }
  event(c,p,p.status,now,p.status==='completed'?`Completed ${p.label} with recorded participation. Exact dialogue was not simulated.`:`${p.label} ended without enough shared participation.`,{attendeeIds,sharedMinutes:shared});
  if(p.activityKind==='private_visit'||p.activityKind==='hosted_event'||p.activityKind==='event_outing')returnHome(c,p,now);
 }
}
module.exports={DEFAULTS,ensure,active,members,participants,committed,conflicts,home,access,canMeet,command,automatic,before,after,leave,registerAttendance,privateReady,permission};
