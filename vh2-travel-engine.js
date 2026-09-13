/* Persistent itineraries over recorded routes. Never synthesize routes or bookings. */
'use strict';
const routing=require('./vh2-people-engine'),transport=require('./vh2-transport-engine'),MIN=60000;
const RECOVERY_DEFAULTS={enabled:false,reconsiderMinutes:5,maxAttempts:12,maxSpend:100,maxWaitMinutes:240};
function ensure(c){const r=c.vh2Travel ||= {places:{},trips:[],events:[],sequence:0,activeId:null,clockHistory:[],residenceId:c.lifeProfile.places.find(p=>p.kind==='home')?.id||'',hometownId:null,custody:false,carPlaceId:null,bikePlaceId:null};r.recoveryPolicy ||= {...RECOVERY_DEFAULTS};return r;}
function active(c){const r=c.vh2Travel;return r?.trips.find(t=>t.id===r.activeId&& !['completed','cancelled','expired'].includes(t.status));}
function emit(c,t,at,kind,summary,extra={}){const r=ensure(c);r.events.push({id:`trip:${c.id}:${++r.sequence}`,kind:'trip',at,tripId:t.id,transition:kind,summary,...extra});r.events=r.events.slice(-150);}
function modes(c){const p=c.lifeProfile.world.transport;return ['WALK',...(p.car?['DRIVE']:[]),...(p.bicycle?['BICYCLE']:[]),...(p.transit?['TRANSIT']:[]),...(p.rideshare?['RIDESHARE']:[])];}
function routingActor(c){const r=ensure(c),w=c.lifeRuntime.world,p=c.lifeProfile.world.transport;return {placeId:w.placeId,carPlaceId:r.custody?r.carPlaceId:p.car?r.residenceId:null,bikePlaceId:r.custody?r.bikePlaceId:p.bicycle?r.residenceId:null,balance:w.balance??p.budget,policy:{modes:modes(c)}};}
function itinerary(c,stops,at,budget=Infinity,maxWaitMinutes=Infinity){const a=routingActor(c),result=[];a.policy.maxWaitMinutes=maxWaitMinutes;a.balance=Math.min(budget,a.balance-stops.reduce((n,s)=>n+Number(s.stayCost||0),0));if(a.balance<0)return null;let time=at;for(const stop of stops){const legs=transport.route(c,a,stop.placeId,time);if(legs===null)return null;result.push(legs);for(const l of legs){a.balance-=Number(l.cost||0);if(l.mode==='DRIVE')a.carPlaceId=l.to;if(l.mode==='BICYCLE')a.bikePlaceId=l.to;a.placeId=l.to;}if(Number.isFinite(time)){time=transport.arrivalTime(legs,time);if(stop.eventEndsAt&&time>=stop.eventEndsAt)return null;time+=(stop.stayMinutes||0)*MIN;}}return result;}
function recover(c,t,at,manual=false){
 const r=ensure(c),p=r.recoveryPolicy,w=c.lifeRuntime.world;
 if(w.journey||!w.placeId||t.status!=='blocked')return false;
 t.recovery ||= {attempts:0,lastAt:null};
 if(!manual&&(!p.enabled||t.recovery.attempts>=p.maxAttempts||t.recovery.lastAt!==null&&at-t.recovery.lastAt<p.reconsiderMinutes*MIN))return false;
 t.recovery.attempts++;t.recovery.lastAt=at;
 const index=t.recoveryTargetIndex??t.stopIndex;
 const remaining=t.stops.slice(index).map((s,i)=>({...s,stayCost:t.paidStays?.includes(index+i)?0:s.stayCost}));
 const routes=itinerary(c,remaining,at,p.maxSpend,p.maxWaitMinutes),first=routes?.[0];let cursor=at,wait=0;
 for(const [i,legs] of (routes||[]).entries()){for(const leg of legs){if(leg.scheduledDeparture)wait=Math.max(wait,(leg.scheduledDeparture-cursor)/MIN);cursor=leg.scheduledArrival??cursor+leg.minutes*MIN;}cursor+=(remaining[i].stayMinutes||0)*MIN;}
 if(!first||wait>p.maxWaitMinutes){t.recovery.reason=!first?'No affordable replacement through the remaining stops.':'The next replacement exceeds the permitted wait.';emit(c,t,at,'recovery_deferred',t.recovery.reason,{attempt:t.recovery.attempts,from:w.placeId});return false;}
 t.stopIndex=index;t.legs=first;t.reason='';delete t.recoveryTargetIndex;t.recovery.reason='Replacement selected from the actual location.';
 emit(c,t,at,'recovery_selected',t.recovery.reason,{attempt:t.recovery.attempts,from:w.placeId,serviceIds:first.filter(l=>l.serviceId).map(l=>l.serviceId)});
 // Preserve original stops, completed legs and paid accommodation. No fare is charged until departure.
 t.status='recovering';if(first.length)depart(c,t,at);else stay(c,t,at);return true;
}
function setContext(c,placeId,at){
 const r=ensure(c),place=r.places[placeId]||{timeZone:null};
 const last=r.clockHistory.at(-1);if(!last||last.timeZone!==place.timeZone)r.clockHistory.push({at,timeZone:place.timeZone,placeId});r.clockHistory=r.clockHistory.slice(-1000);
 r.currentContext={...place,placeId,arrivedAt:at};
 // Old local weather is not evidence about a new city.
 c.lifeRuntime.environment=null;c.currentLocationDetail=c.lifeProfile.places.find(p=>p.id===placeId)?.label||placeId;
}
function depart(c,t,at){
 const w=c.lifeRuntime.world,r=ensure(c),leg=t.legs[0];
 if(!leg)return false;
 const a=routingActor(c);
 if(leg.serviceId){
  const service=transport.ensure(c).services.find(s=>s.id===leg.serviceId);
  if(!service||service.status!=='scheduled'||(at>service.departsAt&&!(t.status==='waiting'&&at-service.departsAt<MIN))||(t.status!=='waiting'&&at>service.departsAt-service.boardingMinutes*MIN)){t.status='blocked';t.reason='Scheduled service cancelled, removed or missed; remaining at the actual place.';emit(c,t,at,'connection_missed',t.reason,{serviceId:leg.serviceId});return false;}
  leg.scheduledDeparture=service.departsAt;leg.scheduledArrival=service.arrivesAt;leg.minutes=(service.arrivesAt-service.departsAt)/MIN;leg.cost=service.cost;
  if(at<service.departsAt){if(t.status!=='waiting')emit(c,t,at,'waiting',`Waiting at the departure place for ${service.label}.`,{serviceId:service.id,departuresAt:service.departsAt});t.status='waiting';t.reason='Waiting for the scheduled departure.';return false;}
  // A character already waiting boards between minute ticks at the actual departure.
  at=service.departsAt;
 }
 if(leg.from!==w.placeId||leg.cost>a.balance||leg.mode==='DRIVE'&&a.carPlaceId!==leg.from||leg.mode==='BICYCLE'&&a.bikePlaceId!==leg.from){t.status='blocked';t.reason='The next leg is no longer affordable or its vehicle is elsewhere.';return false;}
 t.legs.shift();
 w.balance=Math.round((a.balance-Number(leg.cost||0))*100)/100;
 const stop=t.stops[t.stopIndex];
 w.journey={...leg,id:t.id+':'+t.stopIndex+':'+(++t.legSequence),toLabel:c.lifeProfile.places.find(p=>p.id===leg.to)?.label||leg.to,departedAt:at,arrivesAt:leg.scheduledArrival??at+leg.minutes*MIN,...(leg.serviceId?{routeStatus:'scheduled'}:{}),targetStart:leg.scheduledArrival??at+leg.minutes*MIN,targetEnd:at+leg.minutes*MIN+1,purpose:'itinerary',tripId:t.id,routeSource:leg.source||'authored_duration'};
 t.lastLeg={...w.journey};t.status='travelling';
 emit(c,t,at,'departed',`Departed for ${w.journey.toLabel} by ${leg.serviceKind||leg.mode.toLowerCase()} on ${t.label}.`,{from:leg.from,to:leg.to,mode:leg.mode,cost:Number(leg.cost||0)});return true;
}
function stay(c,t,at){const stop=t.stops[t.stopIndex];t.paidStays ||= [];if(stop.stayCost&&!t.paidStays.includes(t.stopIndex)){if(c.lifeRuntime.world.balance<stop.stayCost){t.status='blocked';t.reason='Cannot afford the planned accommodation; no stay purchased.';return;}c.lifeRuntime.world.balance=Math.round((c.lifeRuntime.world.balance-stop.stayCost)*100)/100;t.paidStays.push(t.stopIndex);emit(c,t,at,'accommodation_paid',`Paid ${stop.stayCost} for the planned accommodation.`,{cost:stop.stayCost,placeId:stop.placeId});}t.status='staying';t.stayStartedAt=at;t.stayUntil=stop.eventEndsAt?Math.max(at,Math.min(stop.eventEndsAt,at+stop.stayMinutes*MIN)):at+stop.stayMinutes*MIN;if(stop.flexibleStay){t.stayUntil=stop.eventEndsAt??null;t.stayDecision=null;}setContext(c,stop.placeId,at);emit(c,t,at,'stay_started',`Reached ${c.lifeProfile.places.find(p=>p.id===stop.placeId)?.label||stop.placeId}; ${stop.flexibleStay?'will reconsider staying as needs and commitments change':'staying for '+stop.stayMinutes+' minutes'}.`,{placeId:stop.placeId,until:t.stayUntil});}
function reviewStay(c,t,at,localAt){
 const stop=t.stops[t.stopIndex],next=t.stops[t.stopIndex+1];if(!stop.flexibleStay||!next)return false;
 const d=c.humanDynamics||{},decision=require('./vh2-decision-engine'),policy=decision.policy(c.vh2Decision?.policy);
 if(stop.eventEndsAt&&at>=stop.eventEndsAt){t.leaveReason='The published event end has passed.';return true;}
 const legs=transport.route(c,routingActor(c),next.placeId,at);
 // A decision to leave never invents a route or teleports the character.
 if(legs===null){t.leaveReason='No affordable return route is currently available.';return false;}
 const arrival=transport.arrivalTime(legs,at);
 let deadline=Infinity;
 for(const plan of c.vh2Plans?.plans||[])if(!['completed','cancelled','declined','missed'].includes(plan.status)&&plan.endsAt>at)deadline=Math.min(deadline,plan.startsAt);
 if(localAt){const local=localAt(c,at),minute=local.hour*60+local.minute;
  for(const block of c.lifeProfile.weeklySchedule||[])for(let day=0;day<=1;day++)if(require('./vh-world-engine').activeOn(block,localAt(c,at+day*86400000).dateKey)&&block.days.includes((local.weekday+day)%7)&&(day||block.endMinute>minute))deadline=Math.min(deadline,at+(day*1440+block.startMinute-minute)*MIN);
 }
 if(arrival+5*MIN>=deadline){t.leaveReason='Leaving time to return before the next commitment.';return true;}
 const pressure=Math.max(Number(d.hunger)||0,100-(d.energy??70),Number(d.stress)||0),urgent=(d.hunger??0)>=policy.urgentHunger||(d.energy??70)<=policy.urgentEnergy||(d.stress??0)>=95;
 if(t.stayDecision?.nextAt>at&&!urgent)return false;
 const activeGoal=c.lifeRuntime.activities?.goals?.find(g=>g.status==='active'&&(!g.requiredPlaceId||g.requiredPlaceId===c.lifeRuntime.world.placeId));
 const relief=(activeGoal?.steps||[]).slice(activeGoal?.stepIndex||0).reduce((r,s)=>({hunger:r.hunger+(s.hunger||0),energy:r.energy+(s.energy||0)}),{hunger:0,energy:0});
 const onsiteRelief=(d.hunger>=65&&relief.hunger<0)||(d.energy<30&&relief.energy>0);
 const elapsed=Math.max(0,(at-(t.stayStartedAt??at))/MIN),waiting=stop.eventStartsAt>at;
 const known=(c.vh2Signals?.known||[]).find(s=>s.id===t.sourceSignalId),interested=known?known.tags.some(tag=>(c.vh2Exploration?.policy.interests||[]).includes(tag)):t.interestMatched;
 const mood=Math.max(-10,Math.min(10,Number(c.mood?.valence)||0));
 t.stayDecision ||= {policy,sequence:0,history:[]};t.stayDecision.policy=policy;
 const candidates=[{id:'stay',status:'active',stepIndex:0,steps:[relief]},{id:'leave',status:'planned',stepIndex:0,steps:[{hunger:-60,energy:30}]}];
 const chosen=decision.select(t.stayDecision,candidates,at,{energy:d.energy??70,hunger:d.hunger??0,seed:c.id+'|'+t.id+'|stay'},g=>{
  const components=g.id==='stay'?{engagement:35+(interested?20:0)+(waiting?15:0)+mood,onsiteRelief:onsiteRelief?35:0,novelty:Math.max(0,15-elapsed*.1)}:{needs:Math.max(0,pressure-35)*1.4,elapsed:Math.min(25,elapsed*.03),travel:-Math.max(0,(arrival-at)/MIN)*.08};
  return {score:Object.values(components).reduce((a,b)=>a+b,0),components};
 });
 t.stayDecision.nextAt=at+policy.reconsiderMinutes*MIN;
 if(chosen?.id!=='leave')return false;
 t.leaveReason=urgent?'Urgent needs outweighed staying.':pressure>=60?'Needs outweighed continuing the visit.':'Chose to move on after reconsidering the visit.';return true;
}
function tick(c,at,baseline,localAt){
 const r=ensure(c),t=active(c),w=c.lifeRuntime.world;if(!t)return;
 const currentService=w.journey?.serviceId||(t.status==='waiting'?t.legs[0]?.serviceId:null);
 const service=currentService&&transport.ensure(c).services.find(s=>s.id===currentService),update=service?.realtime;
 if(update&&update.status!=='no_prediction'&&at-update.observedAt<=5*MIN&&!['asleep','private'].includes(baseline.availability)){
  const key=`${currentService}|${update.observedAt}|${update.status}`;r.transportNotices ||= [];
  if(!r.transportNotices.some(n=>n.key===key)){
   const notice={key,serviceId:currentService,label:service.label,noticedAt:at,observedAt:update.observedAt,sourceUrl:update.sourceUrl,status:update.status,expectedDeparture:service.departsAt,expectedArrival:service.arrivesAt,scope:'provider_prediction'};
   r.transportNotices.push(notice);r.transportNotices=r.transportNotices.slice(-30);
   emit(c,t,at,'service_update_noticed',update.status==='cancelled'?'The current service is reported cancelled. No alternative arrival place is confirmed.':'Noticed an updated prediction for the current service.',{serviceId:currentService,notice});
  }
 }
 if(t.sourceSignalId&&(c.vh2Signals?.known||[]).some(x=>x.id===t.sourceSignalId&&['cancelled','postponed','unavailable','tentative'].includes(x.eventStatus))){
  if(w.journey){t.cancelAfterArrival=true;}else{t.status='cancelled';r.activeId=null;emit(c,t,at,'cancelled','Reconsidered the visit after noticing the listed event was cancelled, changed or unavailable.');return;}
 }
 if(t.status==='blocked'){
  if(!['asleep','private'].includes(baseline.availability)&&(c.lifeRuntime.activities?.conversationUntil||0)<=at){const manual=!!t.recoveryRequested;delete t.recoveryRequested;recover(c,t,at,manual);}
  return;
 }
 if(t.status==='planned'){
  if(at<t.startsAt)return;
  if(at>t.startsAt+1440*MIN){t.status='expired';r.activeId=null;emit(c,t,at,'expired',`Could not begin ${t.label} within its departure window.`);return;}
  if(w.journey||w.outing||['asleep','private'].includes(baseline.availability)||(c.lifeRuntime.activities?.conversationUntil||0)>at){t.reason='Waiting for attention and the current activity to permit departure.';return;}
  const routes=itinerary(c,t.stops,at);if(!routes){t.reason='No affordable recorded route through all stops.';return;}
  if(!r.custody){const a=routingActor(c);r.carPlaceId=a.carPlaceId;r.bikePlaceId=a.bikePlaceId;r.custody=true;}
  t.legs=routes[0];t.stopIndex=0;t.reason='';t.startedAt=at;
  c.lifeRuntime.temporarySituation=null;
  if(t.legs.length)depart(c,t,at);else stay(c,t,at);return;
 }
 if(t.status==='waiting'){if(['asleep','private'].includes(baseline.availability)||(c.lifeRuntime.activities?.conversationUntil||0)>at)return;depart(c,t,at);return;}
 if(t.status==='travelling'&&!w.journey){
  if(w.placeId!==t.lastLeg.to){t.status='blocked';t.reason='Actual arrival does not match the recorded leg.';return;}
  if(t.cancelAfterArrival){t.status='cancelled';r.activeId=null;setContext(c,w.placeId,at);emit(c,t,at,'cancelled',`Stopped ${t.label} at the actual arrival place.`,{placeId:w.placeId});return;}
  if(t.legs.length){depart(c,t,at);return;}stay(c,t,at);
 }
 const flexible=t.status==='staying'&&t.stops[t.stopIndex]?.flexibleStay;
 const leave=flexible&&reviewStay(c,t,at,localAt);
 if(t.status==='staying'&&(flexible?leave:at>=t.stayUntil)){
  if(t.stopIndex===t.stops.length-1){t.status='completed';t.completedAt=at;r.activeId=null;emit(c,t,at,'completed',`Completed ${t.label}.`,{placeId:w.placeId});return;}
  if(['asleep','private'].includes(baseline.availability)||(c.lifeRuntime.activities?.conversationUntil||0)>at)return;
  if(leave)emit(c,t,at,'stay_reconsidered',t.leaveReason,{placeId:w.placeId,decision:t.stayDecision?.choice||null});
  const next=t.stops[t.stopIndex+1],legs=transport.route(c,routingActor(c),next.placeId,at);
  if(legs===null){t.status='blocked';t.recoveryTargetIndex=t.stopIndex+1;t.reason='No affordable route onward. Staying at the actual place.';return;}
  t.stopIndex++;t.legs=legs;if(t.legs.length)depart(c,t,at);else stay(c,t,at);
 }
}
function arrival(c,j,at){const r=c.vh2Travel;if(!r)return;if(r.custody){if(j.mode==='DRIVE')r.carPlaceId=j.to;if(j.mode==='BICYCLE')r.bikePlaceId=j.to;}setContext(c,j.to,at);}
function availableVehicle(c,leg,afterLeg=null){const r=c.vh2Travel;if(!r?.custody)return true;const car=afterLeg?.mode==='DRIVE'?afterLeg.to:r.carPlaceId,bike=afterLeg?.mode==='BICYCLE'?afterLeg.to:r.bikePlaceId;return leg.mode==='DRIVE'?car===leg.from:leg.mode==='BICYCLE'?bike===leg.from:true;}
module.exports={ensure,active,tick,itinerary,routingActor,arrival,availableVehicle,recover,RECOVERY_DEFAULTS};
