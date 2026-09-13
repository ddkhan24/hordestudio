/* Place-bound needs over locally supplied world data. No provider or wall clock. */
'use strict';
const activity=require('./vh-activity-engine'),travel=require('./vh2-travel-engine'),transport=require('./vh2-transport-engine');
const MIN=60000;
function homeAccess(c,place,at){
 if(place.kind!=='home')return true;
 const homes=c.lifeProfile.places.filter(p=>p.kind==='home'),own=c.vh2Travel?.residenceId||(homes.length===1?homes[0].id:null);if(place.id===own)return true;
 const plans=require('./vh2-plans-engine');return (c.vh2Plans?.plans||[]).some(p=>p.placeId===place.id&&p.hostId&&['accepted','active'].includes(p.status)&&p.startsAt<=at&&p.endsAt>at&&p.responses?.[p.hostId]?.decision==='accept'&&plans.committed(c,p,c.id)&&plans.committed(c,p,p.hostId)&&c.vh2People?.actors?.[p.hostId]?.policy.homePlaceId===place.id);
}
function poolAccess(meta){return meta?.capabilities?.includes('swimming')&&['public','permitted'].includes(meta.access)&&meta.closed!==true;}
function cooling(c){
 const g=c.vh2Geography,d=c.humanDynamics;g.coolingProgress||={};g.poolPayments||=[];
 if(g.poolAdmission&&(c.lifeRuntime.world.journey||g.poolAdmission.placeId!==c.lifeRuntime.world.placeId))g.poolAdmission=null;
 for(const goal of c.lifeRuntime.activities.goals){
  if(goal.definitionKey!=='swimming')continue;
  if(goal.steps.some(s=>s.charged&&s.costs.vh_cash>0)&&!g.poolPayments.includes(goal.id)){g.poolPayments.push(goal.id);g.poolPayments=g.poolPayments.slice(-120);g.poolAdmission={placeId:goal.requiredPlaceId,goalId:goal.id};}
  const progress=goal.steps.reduce((n,s)=>n+(s.progressMs||0),0),total=goal.steps.reduce((n,s)=>n+s.durationMs,0),before=g.coolingProgress[goal.id]||0;
  if(progress>before&&total>0){d.heatDiscomfort=Math.max(0,(d.heatDiscomfort||0)-35*(progress-before)/total);g.coolingProgress[goal.id]=progress;}
 }
 const retained=new Set(c.lifeRuntime.activities.goals.map(g=>g.id));for(const id of Object.keys(g.coolingProgress))if(!retained.has(id))delete g.coolingProgress[id];
}
function ensure(c){
 const old=c.vh2Exploration?.policy||{};
 const g=c.vh2Geography||={enabled:old.enabled===true,places:{},knownPlaceIds:[],maxTravelMinutes:old.maxTravelMinutes||60,unknownMealCost:10};
 g.places||={};g.knownPlaceIds||=[];
 for(const place of c.lifeProfile?.places||[]){
  if(!g.places[place.id]){const label=place.label||'';const capabilities=place.kind==='home'?['food','rest','leisure','exercise']:/cafe|café|restaurant|diner|coffee|food court/i.test(label)?['food','leisure']:/pool/i.test(label)?['exercise','leisure','swimming']:/gym|fitness/i.test(label)?['exercise','leisure']:place.kind==='social'?['leisure','rest']:[];
   g.places[place.id]={capabilities,mealCost:null,hours:null,closed:false,source:'authored-place inference',access:'unknown',entryCost:0};}
  if(!place.id.startsWith('osm:')&&!g.knownPlaceIds.includes(place.id))g.knownPlaceIds.push(place.id);
 }
 if(c.vh2Exploration)c.vh2Exploration.policy.enabled=g.enabled;
 return g;
}
function enabled(c){return c.vh2Geography?.enabled===true&&!c.vh2AutonomyPaused;}
function schedule(c){const blocks=c.lifeProfile?.weeklySchedule||[];return c.vh2Geography?.enabled?blocks.filter(b=>b.flexibility==='fixed'||b.availability==='asleep'):blocks;}
function open(meta,at,localAt,c,placeId){
 if(meta.closed===true||require('./vh2-story-engine').closed(c,placeId,at))return false;
 if(!Array.isArray(meta.hours))return null;
 const local=require('./vh2-people-engine').localTime(c,placeId||c.lifeRuntime?.world?.placeId,at,localAt),m=local.hour*60+local.minute;
 return meta.hours.some(h=>h.end>h.start?h.days.includes(local.weekday)&&m>=h.start&&m<h.end:(h.days.includes(local.weekday)&&m>=h.start)||h.days.includes((local.weekday+6)%7)&&m<h.end);
}
function nearby(c,limit){
 const here=c.lifeProfile.places.find(p=>p.id===c.lifeRuntime.world.placeId)?.mapCoordinates;
 const distance=p=>here&&p.mapCoordinates?Math.hypot((p.mapCoordinates[0]-here[0])*Math.cos(here[1]*Math.PI/180),p.mapCoordinates[1]-here[1]):Infinity;
 return [...c.lifeProfile.places].sort((a,b)=>Number(b.id===c.lifeRuntime.world.placeId)-Number(a.id===c.lifeRuntime.world.placeId)||distance(a)-distance(b)||a.id.localeCompare(b.id)).slice(0,limit);
}
function commitmentOptions(c,at,localAt){
 // Flexible real obligations compete for time instead of disappearing from life.
 // Their completion does not assert grades, other people's presence or success.
 const a=c.lifeRuntime.activities,t=localAt(c,at),minute=t.hour*60+t.minute,world=require('./vh-world-engine');
 for(const block of c.lifeProfile.weeklySchedule||[]){
  if(block.flexibility!=='soft'||block.availability!=='busy'||!block.placeId||!world.activeOn(block,t.dateKey)||!block.days.includes(t.weekday)||minute<block.startMinute||minute>=block.endMinute||block.endMinute-block.startMinute>180)continue;
  const id='commitment:'+block.id+':'+t.dateKey;if(a.goals.some(g=>g.id===id))continue;
  const goal=activity.addGoal(a,'focus',id,at,block.activity);if(!goal)continue;
  Object.assign(goal,{label:block.activity,requiredPlaceId:block.placeId,expiresAt:at+(block.endMinute-minute)*MIN,priority:55,reason:'A flexible authored obligation; may be missed when other needs or choices take precedence.'});
  goal.steps=[{label:block.activity,durationMs:(block.endMinute-minute)*MIN,progressMs:0,energy:-8,stress:2,hunger:0,costs:{},produces:{},charged:false}];
 }
}
function propose(c,at,localAt){
 if(!enabled(c))return;
 commitmentOptions(c,at,localAt);
 const g=c.vh2Geography,a=c.lifeRuntime.activities,d=c.humanDynamics,w=c.lifeRuntime.world;
 if(g.poolAdmission&&(w.journey||g.poolAdmission.placeId!==w.placeId))g.poolAdmission=null;
 g.experiences ||= {};g.processed ||= [];g.decisions ||= [];
 for(const goal of a.goals){
  if(!goal.id.startsWith('geo:'))continue;
  if(goal.definitionKey==='swimming'&&!['completed','abandoned'].includes(goal.status)&&!poolAccess(g.places[goal.requiredPlaceId])){goal.status='abandoned';goal.reason='Pool access is no longer available.';}
  if(goal.status==='completed'&&!g.processed.includes(goal.id)){
   const experience=g.experiences[goal.requiredPlaceId||w.placeId] ||= {visits:0,lastAt:0};experience.visits++;experience.lastAt=at;
   // Learn only from completed, recorded effects; never invent reviews or encounters.
   const benefit=goal.steps.reduce((n,s)=>n+Math.max(0,-(s.hunger||0))+Math.max(0,-(s.stress||0))+Math.max(0,s.energy||0),0);
   experience.learnedValue=Math.max(0,Math.min(12,(experience.learnedValue||0)*.8+Math.min(12,benefit/8)*.2));
   experience.lastKind=goal.kind;
   if(goal.definitionKey==='swimming')g.lastSwimAt=goal.completedAt||at;
   if(g.intention?.goalId===goal.id){g.intention.status='completed';g.intention.completedAt=at;}
   g.processed.push(goal.id);g.processed=g.processed.slice(-120);
  }
  if(!['completed','abandoned'].includes(goal.status)&&goal.status!=='active'&&(goal.kind==='meal'&&d.hunger<35||open(g.places[goal.requiredPlaceId]||{},at,localAt,c,goal.requiredPlaceId)===false)){
   goal.status='abandoned';goal.reason=d.hunger<35?'The need was satisfied elsewhere.':'The place is closed at this time.';
  }
 }
 if(g.intention?.status==='active'){
  const intended=a.goals.find(x=>x.id===g.intention.goalId);
  if(!intended||intended.status==='abandoned'||intended.expiresAt&&intended.expiresAt<=at){g.intention.status='abandoned';g.intention.endedAt=at;g.intention.reason=intended?.reason||'The opportunity expired.';}
 }
 // Generic recipes are not evidence of food access at the current location.
 for(const goal of a.goals)if(goal.id.startsWith('need:meal:')&&!['completed','abandoned'].includes(goal.status)){goal.status='abandoned';goal.reason='Replaced with feasible food destinations.';}
 a.resources.vh_cash=Math.max(0,Math.floor((w.balance||0)*100));
 if(g.nextReview>at&&g.lastHungerBand===Math.floor(d.hunger/10))return;
 g.nextReview=at+10*MIN;
 // Looking up reachable nearby places in the installed local directory is not a visit.
 g.knownPlaceIds ||= [];
 for(const place of nearby(c,12)){
  if(g.knownPlaceIds.includes(place.id)||!g.places[place.id])continue;
  const route=transport.route(c,travel.routingActor(c),place.id,at);
  if(route&&route.reduce((n,l)=>n+l.minutes,0)<=10){g.knownPlaceIds.push(place.id);g.discoveries=[...(g.discoveries||[]),{at,placeId:place.id,source:'local map lookup',visited:false}].slice(-100);}
 }
g.lastHungerBand=Math.floor(d.hunger/10);
 if(d.sleep?.stage==='asleep'||w.journey||travel.active(c))return;
 // Available free time has competing local and social intentions, not a blank slot.
 const bucket=Math.floor(at/(3*3600000));
 const addLocal=(kind,key,label,minutes,energy,stress,participantId='',placeId='')=>{
  if(a.goals.some(x=>x.id.startsWith('geo:'+key+':')&&!['completed','abandoned'].includes(x.status)))return;
  const goal=activity.addGoal(a,kind,`geo:${key}:${bucket}`,at,label);if(!goal)return;
  goal.label=label;goal.participantId=participantId;goal.requiredPlaceId=placeId;goal.expiresAt=at+3*3600000;goal.reason='A self-directed option during available time.';
  goal.steps=[{label,durationMs:minutes*MIN,progressMs:0,energy,stress,hunger:0,costs:{},produces:{},charged:false}];
  if(key==='quiet')goal.priority=5;
  if(key.startsWith('exercise:')){goal.definitionKey='home_exercise';goal.minEnergy=45;goal.priority=42;}
 };
 if(d.hunger<80){
  addLocal('leisure','interest','Spend time on a personal interest',25,-2,-6);
  addLocal('recovery','quiet','Take a quiet break',15,6,-4);
  // Calls and invitations reserve independent participants in the canonical plan store.
  const here=g.places[w.placeId],herePlace=c.lifeProfile.places.find(p=>p.id===w.placeId);
  if(d.energy>=45&&(d.illnessSeverity||0)<35&&(d.heatDiscomfort||0)<65&&here?.capabilities?.includes('exercise')&&!here.capabilities.includes('swimming'))addLocal('leisure','exercise:'+w.placeId,herePlace?.kind==='home'?'Work out at home with bodyweight exercises':'Work out at '+(herePlace?.label||'the current place'),25,-12,-12,'',w.placeId);
 }
 const kind=d.hunger>=55?'meal':d.stress>=60?'recovery':'leisure';
 const capability=kind==='meal'?'food':kind==='recovery'?'rest':'leisure';
 const records=[];
 for(const place of nearby(c,32)){
  const meta=g.places[place.id];if(!homeAccess(c,place,at))continue;if(!meta?.capabilities?.includes(capability)||meta.capabilities.includes('swimming'))continue;
  // Packs are world facts, discovered places are each person's knowledge.
  if(!(g.knownPlaceIds||[]).includes(place.id)&&place.id!==w.placeId)continue;
  const hours=open(meta,at,localAt,c,place.id);if(hours===false){records.push({placeId:place.id,excluded:'closed'});continue;}
  if(kind!=='meal'&&at-(g.experiences[place.id]?.lastAt||0)<3*3600000)continue;
  const homeMeal=kind==='meal'&&place.kind==='home';
  if(homeMeal&&!(a.resources.ingredients>=1)){records.push({placeId:place.id,excluded:'no ingredients at home'});continue;}
  const amount=kind==='meal'&&!homeMeal?(meta.mealCost??g.unknownMealCost??10):0;
  if(amount>(w.balance||0)){records.push({placeId:place.id,excluded:'unaffordable'});continue;}
  if(a.goals.some(x=>x.requiredPlaceId===place.id&&x.id.startsWith('geo:')&&!['completed','abandoned'].includes(x.status)))continue;
  const route=transport.route(c,travel.routingActor(c),place.id,at);
  if(route===null){records.push({placeId:place.id,excluded:'no known route'});continue;}
  const minutes=(transport.arrivalTime(route,at)-at)/MIN;
  if(minutes>(g.maxTravelMinutes??60)||open(meta,at+minutes*MIN,localAt,c,place.id)===false){records.push({placeId:place.id,excluded:'cannot arrive in time'});continue;}
  const goal=activity.addGoal(a,kind,`geo:${capability}:${place.id}:${Math.floor(at/(30*MIN))}`,at);if(!goal)break;
  const exercise=kind==='leisure'&&meta.capabilities.includes('exercise')&&!meta.capabilities.includes('swimming')&&d.energy>=45&&(d.illnessSeverity||0)<35&&(d.heatDiscomfort||0)<65;
  goal.label=(exercise?'Work out at ':kind==='meal'?'Eat at ':kind==='recovery'?'Rest at ':'Spend time at ')+place.label;goal.requiredPlaceId=place.id;goal.expiresAt=at+2*3600000;
  goal.reason=`${capability} is available here; ${hours===null?'opening hours unknown':'open according to saved hours'}${kind==='meal'&&meta.mealCost==null?'; meal cost is a simulation estimate':''}.`;
  goal.steps=[{label:goal.label,durationMs:(kind==='meal'?20:25)*MIN,progressMs:0,energy:kind==='meal'?6:kind==='recovery'?15:exercise?-12:-2,stress:-8,hunger:kind==='meal'?-60:0,costs:homeMeal?{ingredients:1}:amount?{vh_cash:Math.round(amount*100)}:{},produces:{},charged:false}];
  records.push({placeId:place.id,minutes,cost:amount,hours:hours===null?'unknown':'open',goalId:goal.id});
 }
 // Swimming is a real activity at a known, accessible pool; its motive is measured heat.
 if((d.heatDiscomfort||0)>=35&&d.energy>=40&&d.hunger<80&&(d.illnessSeverity||0)<35)for(const place of nearby(c,32)){
  const meta=g.places[place.id];if(!homeAccess(c,place,at)||!poolAccess(meta)||!(g.knownPlaceIds||[]).includes(place.id))continue;
  if(a.goals.some(x=>x.definitionKey==='swimming'&&x.requiredPlaceId===place.id&&!['completed','abandoned'].includes(x.status)))continue;
  if(at-(g.lastSwimAt||0)<3*3600000)continue;
  const price=g.poolAdmission?.placeId===place.id&&w.placeId===place.id?0:Number(meta.entryCost||0),actor=travel.routingActor(c);actor.balance-=price;
  if(actor.balance<0||open(meta,at,localAt,c,place.id)===false)continue;
  const legs=transport.route(c,actor,place.id,at);if(legs===null)continue;
  const arrival=transport.arrivalTime(legs,at);if(arrival-at>(g.maxTravelMinutes??60)*MIN||open(meta,arrival+20*MIN-1,localAt,c,place.id)===false)continue;
  const goal=activity.addGoal(a,'leisure',`geo:swim:${place.id}:${Math.floor(at/(3*3600000))}`,at,'Swim to cool down at '+place.label);if(!goal)break;
  Object.assign(goal,{definitionKey:'swimming',requiredPlaceId:place.id,expiresAt:at+2*3600000,minEnergy:35,priority:65,reason:'Feeling hot; this known pool has confirmed access. Travel, opening hours and entry cost allow a cooling swim.'});
  goal.steps=[{label:goal.label,durationMs:20*MIN,progressMs:0,energy:-10,stress:-12,hunger:5,costs:price?{vh_cash:Math.round(price*100)}:{},produces:{},charged:false}];
 }
 // Observed events compete in the same activity queue as needs and personal tasks.
 for(const item of (c.vh2Signals?.known||[]).filter(x=>x.type==='calendar_event'&&x.eventStatus==='listed'&&x.expiresAt>at&&x.startsAt<=at+2*3600000).slice(-8)){
  const place=c.lifeProfile.places.find(p=>p.id===item.placeId);if(!place||item.endsAt!=null&&item.endsAt<=at||item.requiresTicket&&!item.accessConfirmed)continue;
  if(a.goals.some(x=>x.sourceSignalId===item.id)||(c.vh2Plans?.plans||[]).some(p=>p.sourceSignalId===item.id&&['proposed','accepted','active'].includes(p.status)&&require('./vh2-plans-engine').committed(c,p,c.id)))continue;
  const legs=transport.route(c,travel.routingActor(c),place.id,at);if(legs===null)continue;
  const arrival=transport.arrivalTime(legs,at),end=item.endsAt??at+3*3600000;if(arrival>=end||open(g.places[place.id]||{},arrival,localAt,c,place.id)===false)continue;
  const goal=activity.addGoal(a,'leisure','geo:event:'+item.id,at,'Visit '+place.label+' for '+item.title);if(!goal)break;
  Object.assign(goal,{requiredPlaceId:place.id,sourceSignalId:item.id,notBefore:Math.max(at,item.startsAt-(arrival-at)),expiresAt:end,priority:35+((item.tags||[]).some(t=>(c.vh2Exploration?.policy?.interests||[]).includes(t))?15:0),reason:'An event noticed from a source. Admission and attendance are not established by this plan.'});
  goal.steps=[{label:'Spend time at the event location',durationMs:Math.min(30*MIN,end-Math.max(arrival,item.startsAt)),progressMs:0,energy:-4,stress:-4,hunger:0,costs:{},produces:{},charged:false}];
 }
 // Record unmet needs explicitly instead of describing an action that never occurred.
 const feasible=a.goals.some(goal=>goal.id.startsWith('geo:')&&goal.kind===kind&&!['completed','abandoned'].includes(goal.status));
 g.unmetNeed=kind==='meal'&&!feasible?{kind:'food',since:g.unmetNeed?.since||at,lastCheckedAt:at,reason:'No known affordable and reachable food option.',requiresNewOpportunity:true}:null;
 g.decisions.push({at,need:capability,from:w.placeId,candidates:records});g.decisions=g.decisions.slice(-40);
}
function routeGoal(c,goal,at,localAt){
 if(!enabled(c)||!goal.requiredPlaceId)return null;
 const place=c.lifeProfile.places.find(p=>p.id===goal.requiredPlaceId);if(goal.id.startsWith('geo:')&&place&&!homeAccess(c,place,at))return null;
 if(open(c.vh2Geography.places[goal.requiredPlaceId]||{},at,localAt,c,goal.requiredPlaceId)===false)return null;
 if(goal.definitionKey==='swimming'&&!poolAccess(c.vh2Geography.places[goal.requiredPlaceId]))return null;
 const money=(goal.steps?.[0]?.costs?.vh_cash||0)/100;
 const actor=travel.routingActor(c);actor.balance-=money;
 const legs=transport.route(c,actor,goal.requiredPlaceId,at);if(legs===null)return null;
 const minutes=(transport.arrivalTime(legs,at)-at)/MIN;
 if(at+minutes*MIN>Math.min(goal.expiresAt||Infinity,goal.deadline||Infinity)||minutes>(c.vh2Geography.maxTravelMinutes??60)||open(c.vh2Geography.places[goal.requiredPlaceId]||{},at+minutes*MIN,localAt,c,goal.requiredPlaceId)===false)return null;
 return {geographic:true,legs,penalty:minutes*.35+money*.5};
}
function start(c,goal,at,route){
 if(!route?.geographic)return false;
 const r=travel.ensure(c);if(travel.active(c)||c.lifeRuntime.world.journey)return false;
 c.vh2Geography.intention={goalId:goal.id,placeId:goal.requiredPlaceId,reason:goal.reason,chosenAt:at,status:'active'};
 const id=`geo-trip:${goal.id}:${at}`;r.trips=r.trips.slice(-49);r.trips.push({id,label:'Travel for '+goal.label,origin:'needs',goalId:goal.id,stops:[{placeId:goal.requiredPlaceId,stayMinutes:0}],startsAt:at,status:'planned',legSequence:0,stopIndex:0,legs:[],createdAt:at});r.activeId=id;
 travel.tick(c,at,{availability:'available'});return true;
}
function preference(c,goal){if(!enabled(c)||!goal.requiredPlaceId)return 0;const g=c.vh2Geography,e=g.experiences?.[goal.requiredPlaceId];
 const continuity=g.intention?.goalId===goal.id&&!['completed','abandoned'].includes(g.intention.status)?70:0;
 // Learned familiarity is bounded so urgent needs and feasibility retain priority.
 return continuity+(e?.learnedValue||0)+(goal.definitionKey==='swimming'?(c.humanDynamics.heatDiscomfort||0)*.7:0);}
function settle(c,beforeCash){if(!enabled(c))return;cooling(c);const a=c.lifeRuntime.activities;const spent=Math.max(0,beforeCash-(a.resources.vh_cash??beforeCash));c.lifeRuntime.world.balance=Math.max(0,Math.round(((c.lifeRuntime.world.balance||0)-spent/100)*100)/100);}
module.exports={homeAccess,poolAccess,ensure,preference,enabled,schedule,open,propose,routeGoal,start,settle};
