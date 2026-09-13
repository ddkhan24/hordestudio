/* Low-fidelity independent people: needs -> feasible actions -> timed consequences.
 * Provider-free; actual route records are required. Private state is not perception.
 */
'use strict';
const decisions=require('./vh2-decision-engine');
const MIN=60000,clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,n));
const localFormatters=new Map();
function localTime(c,placeId,at,fallback,preferred){
 const zone=c.vh2Travel?.places?.[placeId]?.timeZone||preferred;
 if(zone){try{let formatter=localFormatters.get(zone);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});localFormatters.set(zone,formatter);}
 const parts=Object.fromEntries(formatter.formatToParts(new Date(at)).map(p=>[p.type,p.value]));return {hour:Number(parts.hour),minute:Number(parts.minute),weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday),dateKey:parts.year+'-'+parts.month+'-'+parts.day};}catch{}}
 return fallback(c,at);
}
function actorLocal(c,a,at,fallback){return localTime(c,a?.placeId||a?.journey?.from||a?.policy?.homePlaceId,at,fallback,a?.policy?.timeZone||c.vh2Travel?.places?.[a?.policy?.homePlaceId]?.timeZone);}
function ensure(c){const r=c.vh2People ||= {actors:{},sequence:0,events:[]};for(const a of Object.values(r.actors)){a.policy.incomePerHour??=0;a.policy.paidPlaceIds??=[];a.policy.dailyExpense??=0;a.socialNeed??=35;}return r;}
function actor(c,id){const actors=c.vh2People?.actors;return actors&&Object.hasOwn(actors,id)?actors[id]:undefined;}
function route(legs,a,to){
 if(!a.placeId)return null;if(a.placeId===to)return [];
 const queue=[{place:a.placeId,car:a.carPlaceId,bike:a.bikePlaceId,cost:0,minutes:0,legs:[],seen:[a.placeId]}],labels=new Map();let visits=0;
 while(queue.length&&visits++<2000){
  queue.sort((x,y)=>x.minutes-y.minutes||x.cost-y.cost||x.place.localeCompare(y.place));const n=queue.shift();if(n.place===to)return n.legs;
  const key=JSON.stringify([n.place,n.car,n.bike]);const prior=labels.get(key)||[];
  if(prior.some(p=>p.cost<=n.cost&&p.minutes<=n.minutes))continue;
  labels.set(key,[...prior.filter(p=>!(n.cost<=p.cost&&n.minutes<=p.minutes)),{cost:n.cost,minutes:n.minutes}]);
  if(n.legs.length>=12)continue;
  for(const l of legs){
   if(l.from!==n.place||n.seen.includes(l.to)||!Number.isFinite(l.minutes)||l.minutes<=0||!a.policy.modes.includes(l.mode))continue;
   if(l.mode==='DRIVE'&&n.car!==n.place||l.mode==='BICYCLE'&&n.bike!==n.place)continue;
   const cost=Number(l.cost||0);if(!Number.isFinite(cost)||cost<0||n.cost+cost>a.balance)continue;
   queue.push({place:l.to,car:l.mode==='DRIVE'?l.to:n.car,bike:l.mode==='BICYCLE'?l.to:n.bike,cost:n.cost+cost,minutes:n.minutes+l.minutes,legs:[...n.legs,l],seen:[...n.seen,l.to]});
  }
 }
 return null;
}
function routine(c,id,at,localAt){const t=actorLocal(c,actor(c,id),at,localAt),m=t.hour*60+t.minute;return c.lifeProfile.world.people.find(p=>require('./vh-world-engine').activeOn(p,t.dateKey)&&p.personId===id&&p.flexibility!=='soft'&&!/relax|spending time|hanging out|free time/i.test(p.activity||'')&&p.days.includes(t.weekday)&&m>=p.start&&m<p.end);}
function meetingConflict(c,id,plan,now,localAt){
 const a=actor(c,id);if(!a)return null;
 if(a.journey)return 'Already travelling; arrival and availability are not yet established.';
 const path=plan.modality==='call'?[]:route(c.lifeProfile.travelLegs,a,plan.placeId);
 if(path===null||now+path.reduce((n,l)=>n+l.minutes,0)*MIN>plan.startsAt)return 'No affordable route arriving before the meeting.';
 for(let at=plan.startsAt;at<plan.endsAt;at+=MIN){const block=routine(c,id,at,localAt);if(block&&(plan.modality==='call'||block.placeId!==plan.placeId))return 'Another obligation conflicts with that place and time.';}
 return '';
}
function emit(c,a,kind,at,details){const r=ensure(c);r.events.push({id:`person:${c.id}:${++r.sequence}`,kind,at,personId:a.id,...details});r.events=r.events.slice(-200);}
function depart(c,a,at){
 const leg=a.remaining.shift();
 if(!leg||leg.from!==a.placeId||Number(leg.cost||0)>a.balance){a.remaining=[];a.pending=null;a.blockedReason='The next route leg is unavailable or unaffordable.';return;}
 if(leg.mode==='DRIVE'&&a.carPlaceId!==a.placeId||leg.mode==='BICYCLE'&&a.bikePlaceId!==a.placeId){a.remaining=[];a.pending=null;a.blockedReason='The required vehicle is elsewhere.';return;}
 a.balance=Math.round((a.balance-Number(leg.cost||0))*100)/100;a.poolAdmission=null;
 a.journey={...leg,departedAt:at,arrivesAt:at+leg.minutes*MIN};a.placeId='';
 emit(c,a,'person_departed',at,{from:leg.from,to:leg.to,mode:leg.mode,cost:Number(leg.cost||0),source:leg.source||'authored_duration'});
}
function startAction(c,a,choice,at,localAt){
 if(choice.kind==='swimming'&&(!require('./vh2-geography-engine').poolAccess(c.vh2Geography?.places?.[a.placeId])||require('./vh2-geography-engine').open(c.vh2Geography?.places?.[a.placeId]||{},at,localAt,c,a.placeId)===false)){a.blockedReason='Pool access is no longer available.';return;}
 if(choice.entryCost){if(a.balance<choice.entryCost){a.blockedReason='Cannot afford entry.';return;}a.balance=Math.round((a.balance-choice.entryCost)*100)/100;a.poolAdmission=choice.placeId;}
 if(choice.kind==='eat'){
  if(a.balance<a.policy.mealCost){a.blockedReason='Cannot afford this meal.';return;}
  a.balance=Math.round((a.balance-a.policy.mealCost)*100)/100;
 }
 a.action={needsBefore:{energy:a.energy,hunger:a.hunger,stress:a.stress,socialNeed:a.socialNeed},kind:choice.kind,placeId:choice.placeId,startedAt:at,endsAt:choice.until??at+choice.minutes*MIN,planId:choice.planId||null,peerPlanId:choice.peerPlanId||null};
 a.blockedReason='';emit(c,a,'person_action_started',at,{action:choice.kind,placeId:a.placeId,planId:choice.planId||null,cost:choice.kind==='eat'?a.policy.mealCost:choice.entryCost||0});
}
function choose(c,a,at,localAt){
 const candidates=[],p=a.policy,t=actorLocal(c,a,at,localAt),hour=t.hour+t.minute/60;
 const add=(kind,placeId,minutes,score,extra={})=>{
  if(c.lifeProfile.places?.find(x=>x.id===placeId)?.kind==='home'&&placeId!==p.homePlaceId&&!extra.planId&&!extra.peerPlanId)return;
  const path=route(c.lifeProfile.travelLegs,a,placeId);if(path===null)return;
  const cost=path.reduce((n,l)=>n+Number(l.cost||0),0),travel=path.reduce((n,l)=>n+l.minutes,0);
  if(require('./vh2-geography-engine').open(c.vh2Geography?.places?.[placeId]||{},at+travel*MIN,localAt,c,placeId)===false)return;
  if(kind==='eat'&&cost+p.mealCost>a.balance||cost+(extra.entryCost||0)>a.balance)return;
  if(extra.deadline&&at+(travel+minutes)*MIN>extra.deadline)return;
  candidates.push({kind,placeId,minutes,path,score:score-travel*.7-cost*.15,...extra});
 };
 const night=p.sleepStart>p.sleepEnd?(hour>=p.sleepStart||hour<p.sleepEnd):(hour>=p.sleepStart&&hour<p.sleepEnd);
 add('rest',a.placeId,15,15+(100-a.energy)*.35+a.stress*.15+(a.illnessSeverity||0)*.65);
 add('sleep',p.homePlaceId,60,(100-a.energy)*.9+(night?30:-35));
 for(const id of [...new Set([p.homePlaceId,...p.foodPlaceIds])])add('eat',id,20,a.hunger*.95-30);
 for(const id of p.leisurePlaceIds){
  if(c.vh2Geography?.places?.[id]?.capabilities?.includes('swimming'))continue;
  const familiar=require('./vh2-network-engine').preference(c,a.id,id,at);
  const resident=(c.vh2Population?.residents||[]).find(x=>x.id===a.id),preferred=resident?.placeId===id&&resident.days.includes(t.weekday)&&hour*60>=resident.start&&hour*60<resident.end?12:0;
  add('leisure',id,30,a.boredom*.7+p.curiosity*.3+Math.min(15,(at-(a.visits[id]||at))/86400000*3)+familiar+preferred-(a.illnessSeverity||0)*.6);
 }
 if(a.energy>=45&&a.hunger<80&&(a.illnessSeverity||0)<35){
  if(a.placeId===p.homePlaceId&&at-(a.lastExerciseAt??-Infinity)>=2*3600000)add('exercise',a.placeId,25,15+a.boredom*.25+a.stress*.35+p.conscientiousness*.2);
  for(const id of p.leisurePlaceIds){const meta=c.vh2Geography?.places?.[id];if((a.heatDiscomfort||0)>=35&&at-(a.lastSwimAt??-Infinity)>=2*3600000&&require('./vh2-geography-engine').poolAccess(meta))add('swimming',id,20,25+a.heatDiscomfort*.85+a.stress*.2,{entryCost:a.poolAdmission===id&&a.placeId===id?0:Number(meta.entryCost||0)});}
 }
 const obligation=routine(c,a.id,at,localAt);
 if(obligation)add('obligation',obligation.placeId,15,95+p.conscientiousness*.3-(a.energy<15?80:0)-Math.max(0,a.hunger-80));
 const plans=require('./vh2-plans-engine');
 for(const plan of c.vh2Plans?.plans||[]){
  if(plan.scope==='peers'||!plans.committed(c,plan,a.id)||!['accepted','active'].includes(plan.status)||plan.endsAt<=at)continue;
  const calling=plan.modality==='call',path=calling?[]:route(c.lifeProfile.travelLegs,a,plan.placeId);if(path===null)continue;
  const lead=path.reduce((n,l)=>n+l.minutes,0)*MIN;if(at+lead+(calling?0:10*MIN)<plan.startsAt)continue;
  if(a.hunger>90||a.energy<15||obligation&&(calling||obligation.placeId!==plan.placeId))continue;
  add(calling?'call':'meeting',calling?a.placeId:plan.placeId,Math.max(1,Math.min(plan.durationMinutes,(plan.endsAt-Math.max(at+lead,plan.startsAt))/MIN)),150,{planId:plan.id,deadline:plan.endsAt,until:plan.endsAt});
 }
 for(const plan of (c.vh2Plans?.plans||[]).filter(p=>p.scope==='peers')){
  if(!plans.committed(c,plan,a.id)||!c.vh2People.network.enabled||!plan.people.includes(a.id)||!['accepted','active'].includes(plan.status)||at>=plan.endsAt)continue;
  const path=route(c.lifeProfile.travelLegs,a,plan.placeId);if(path===null)continue;
  const lead=path.reduce((n,l)=>n+l.minutes,0)*MIN;if(at+lead+10*MIN<plan.startsAt)continue;
  if(obligation&&obligation.placeId!==plan.placeId||a.energy<15||a.hunger>90)continue;
  add('peer_meeting',plan.placeId,Math.max(1,(plan.endsAt-Math.max(plan.startsAt,at+lead))/MIN),100,{peerPlanId:plan.id,deadline:plan.endsAt,until:plan.endsAt});
 }
 if(!candidates.length){a.blockedReason='No feasible activity at a reachable place.';return;}
 candidates.sort((x,y)=>x.kind.localeCompare(y.kind)||x.placeId.localeCompare(y.placeId));
 a.decision ||= {policy:{...decisions.DEFAULTS,temperature:p.temperature},sequence:a.sequence||0,history:[]};
 a.decision.policy.temperature=p.temperature;
 for(const x of candidates){x.id=x.kind+':'+x.placeId;x.stepIndex=0;x.steps=[{hunger:x.kind==='eat'?-60:0,energy:['rest','sleep'].includes(x.kind)?30:0}];}
 const choice=decisions.select(a.decision,candidates,at,{seed:c.id+'|'+a.id,hunger:a.hunger,energy:a.energy},x=>({score:x.score+require('./vh2-psychology-engine').reflectionScore(a.psychology,x.placeId),components:{needsAndTravel:x.score,reflection:require('./vh2-psychology-engine').reflectionScore(a.psychology,x.placeId)}}));
 a.sequence=a.decision.sequence;
 a.lastDecision={at,draw:a.decision.choice.draw,candidates:a.decision.choice.candidates,selected:choice.kind,destination:choice.placeId};
 if(choice.path.length){a.pending=choice;a.remaining=[...choice.path];depart(c,a,at);}else startAction(c,a,choice,at,localAt);
}
function tick(c,a,at,localAt){
 const elapsed=(at-a.lastAt)/MIN,kind=a.action?.kind;
 require('./vh2-health-engine').advanceActor(c,a,at);
 const health=require('./vh2-health-engine');
 health.updateHeat(a,health.temperatureAt(c,at,a),elapsed/60);
 if(kind==='swimming')a.heatDiscomfort=clamp((a.heatDiscomfort||0)-elapsed*1.75);
 const sharedPlan=['call','meeting'].includes(kind)&&(c.vh2Plans?.plans||[]).find(p=>p.id===a.action.planId);
 const talking=!!sharedPlan&&require('./vh2-plans-engine').committed(c,sharedPlan,a.id)&&require('./vh2-plans-engine').committed(c,sharedPlan,c.id)&&(c.lifeRuntime.activities?.goals||[]).some(g=>g.meetingId===sharedPlan.id&&g.status==='active')&&(kind==='call'||!c.lifeRuntime.world.journey&&c.lifeRuntime.world.placeId===a.placeId);
 const peerTalking=kind==='peer_meeting'&&Object.values(c.vh2People.actors).some(other=>other.id!==a.id&&!other.journey&&other.placeId===a.placeId&&other.action?.peerPlanId===a.action.peerPlanId);
 a.socialNeed=clamp((a.socialNeed??35)+elapsed*(talking||peerTalking?-.7:kind==='sleep'?0:.025));
 const today=actorLocal(c,a,at,localAt).dateKey||String(Math.floor((at+(c.timezoneOffsetMinutes||0)*MIN)/86400000));
 if(a.expenseDay!=null&&a.expenseDay!==today&&a.policy.dailyExpense>0){const due=Math.round(a.policy.dailyExpense*100)/100,paid=Math.min(a.balance,due);a.balance=Math.round((a.balance-paid)*100)/100;a.unpaidExpenses=Math.round(((a.unpaidExpenses||0)+due-paid)*100)/100;if(paid<due)a.stress=clamp(a.stress+Math.min(15,(due-paid)/Math.max(1,due)*15));emit(c,a,'person_expense',at,{due,paid,outstanding:a.unpaidExpenses});}
 a.expenseDay=today;
 const work=routine(c,a.id,a.lastAt,localAt);
 if(elapsed>0&&kind==='obligation'&&!a.journey&&work?.placeId===a.placeId&&a.policy.paidPlaceIds?.includes(a.placeId)&&a.policy.incomePerHour>0){
  const cents=(a.incomeRemainder||0)+elapsed*a.policy.incomePerHour*100/60,whole=Math.floor(cents+1e-8);a.incomeRemainder=cents-whole;a.balance=Math.round((a.balance+whole/100)*100)/100;a.earnedIncome=Math.round(((a.earnedIncome||0)+whole/100)*100)/100;
 }

 if(at>a.lastAt){a.presenceHistory||=[];a.presenceHistory.push({from:a.lastAt,until:at,placeId:a.placeId,available:!a.journey&&!['sleep','obligation','eat','call'].includes(kind),peerPlanId:a.action?.peerPlanId||null,planId:a.action?.planId||null,actionKind:kind||null});a.presenceHistory=a.presenceHistory.slice(-360);}
 a.hunger=clamp(a.hunger+elapsed*(kind==='eat'?-3:.06));
 a.energy=clamp(a.energy+elapsed*(kind==='sleep'?.6:kind==='rest'?.18:a.journey?-.08:['exercise','swimming'].includes(kind)?-.45:-.045));
 a.stress=clamp(a.stress+elapsed*(kind==='sleep'||kind==='rest'?-.12:kind==='obligation'?.035:['exercise','swimming'].includes(kind)?-.35:kind==='leisure'?-.06:0));
 a.boredom=clamp(a.boredom+elapsed*(['leisure','exercise','swimming'].includes(kind)||talking||peerTalking?-.5:kind==='sleep'?0:.04));
 a.lastAt=at;
 if(a.journey&&at>=a.journey.arrivesAt){
  const j=a.journey;a.placeId=j.to;if(j.mode==='DRIVE')a.carPlaceId=j.to;if(j.mode==='BICYCLE')a.bikePlaceId=j.to;
  a.visits[j.to]=at;a.journey=null;emit(c,a,'person_arrived',at,{placeId:j.to,mode:j.mode});
  if(a.remaining.length)depart(c,a,at);
  else if(a.pending){const choice=a.pending;a.pending=null;if(!choice.deadline||at+choice.minutes*MIN<=choice.deadline)startAction(c,a,choice,at,localAt);}
 }
 if(a.journey)return;
 if(a.action){
  // Accepting a plan creates a reason to reconsider a flexible activity once, not a forced action.
  let planReview=false;
  if(!a.action.planId&&!a.action.peerPlanId&&['leisure','exercise','rest'].includes(a.action.kind)&&a.energy>=25){
   a.planReviews||={};
   for(const p of c.vh2Plans?.plans||[]){
    if(p.scope==='peers'||a.planReviews[p.id]||!['accepted','active'].includes(p.status)||p.endsAt<=at||!require('./vh2-plans-engine').committed(c,p,a.id))continue;
    const legs=p.modality==='call'?[]:route(c.lifeProfile.travelLegs,a,p.placeId);if(legs===null||at+legs.reduce((n,l)=>n+l.minutes,0)*MIN<p.startsAt)continue;
    a.planReviews[p.id]=at;planReview=true;break;
   }
   const retained=new Set((c.vh2Plans?.plans||[]).map(p=>p.id));for(const id of Object.keys(a.planReviews))if(!retained.has(id))delete a.planReviews[id];
  }
  const active=a.action,plan=active.planId&&(c.vh2Plans?.plans||[]).find(p=>p.id===active.planId);
  const peer=active.peerPlanId&&((c.vh2Plans?.plans||[]).filter(p=>p.scope==='peers')).find(p=>p.id===active.peerPlanId);
  const wishesToLeave=active.peerPlanId&&at-active.startedAt>=10*MIN&&(a.stress>75||a.boredom<10&&(c.vh2People.network?.dispositions?.[a.id]?.sociability??50)<35);
  const peerInterrupted=active.peerPlanId&&(!c.vh2People.network?.enabled||!['accepted','active'].includes(peer?.status)||a.hunger>90||!!routine(c,a.id,at,localAt)&&routine(c,a.id,at,localAt).placeId!==a.placeId||wishesToLeave);
  if(peerInterrupted&&peer){peer.departures||={};peer.departures[a.id]={at,reason:wishesToLeave?'Chose to leave early.':'Needs or another commitment interrupted participation.'};}

  const sharedWishes=active.planId&&at-active.startedAt>=5*MIN&&(a.stress>80||a.hunger>90||a.energy<15||!!routine(c,a.id,at,localAt)&&(active.kind==='call'||routine(c,a.id,at,localAt).placeId!==a.placeId));
  const sharedInterrupted=active.planId&&(!plan||!require('./vh2-plans-engine').committed(c,plan,a.id)||!['accepted','active'].includes(plan?.status)||sharedWishes);
  if(sharedWishes&&plan)require('./vh2-plans-engine').leave(c,plan,a.id,at,'Needs or another commitment interrupted participation.');
  const swimInterrupted=active.kind==='swimming'&&(!require('./vh2-geography-engine').poolAccess(c.vh2Geography?.places?.[a.placeId])||require('./vh2-geography-engine').open(c.vh2Geography?.places?.[a.placeId]||{},at,localAt,c,a.placeId)===false);
  const interrupted=planReview||peerInterrupted||sharedInterrupted||swimInterrupted||a.energy<8&&active.kind!=='sleep'&&active.kind!=='rest';
  if(at>=active.endsAt||interrupted){
   if(at-active.startedAt>=10*MIN&&active.kind==='exercise')a.lastExerciseAt=at;
   if(at-active.startedAt>=10*MIN&&active.kind==='swimming')a.lastSwimAt=at;
   emit(c,a,interrupted?'person_action_interrupted':'person_action_completed',at,{action:active.kind,placeId:a.placeId,planId:active.planId});const recorded=ensure(c).events.at(-1);require('./vh2-psychology-engine').rememberParticipant(a,recorded,active.needsBefore||a,at);a.action=null;
  }
 }
 if(!a.action)choose(c,a,at,localAt);
}
function advance(c,now,localAt){
 const r=ensure(c);require('./vh2-network-engine').ensure(c);
 const actors=Object.values(r.actors);
 for(const a of actors){if(now<a.lastAt)throw Error('Independent people cannot advance backwards');if(!a.started){a.started=true;tick(c,a,a.lastAt,localAt);}}
 let next=Math.min(...actors.map(a=>a.lastAt+MIN));
 while(next<=now){
  for(const a of actors)if(a.lastAt+MIN===next)tick(c,a,next,localAt);
  require('./vh2-network-engine').advance(c,next,localAt);
  next=Math.min(...actors.map(a=>a.lastAt+MIN));
 }
 for(const a of actors){
  const sleeping=a.action?.kind==='sleep',busy=['obligation','eat','call'].includes(a.action?.kind);
  c.lifeRuntime.world.people[a.id]={placeId:a.placeId,activity:a.journey?'travelling':a.action?.kind||'considering options',energy:a.energy,stress:a.stress,hunger:a.hunger,lastAt:now,restUntil:sleeping?a.action.endsAt:0,availability:sleeping?'asleep':a.journey||busy?'busy':'available',positionSource:'independent_person',...(a.journey?{travel:{...a.journey,progress:clamp((now-a.journey.departedAt)/(a.journey.arrivesAt-a.journey.departedAt),0,1)}}:{})};
 }
 return r;
}
function availableAt(c,id,placeId,at){const a=actor(c,id);if(!a)return false;const past=a.presenceHistory?.find(h=>h.from<=at&&at<h.until);if(past)return past.placeId===placeId&&past.available;return at===a.lastAt&&a.placeId===placeId&&!a.journey&&!['sleep','obligation','eat','call'].includes(a.action?.kind);}
module.exports={localTime,actorLocal,ensure,actor,route,advance,meetingConflict,routine,availableAt};
