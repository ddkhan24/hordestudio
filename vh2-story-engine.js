/* Optional pacing inside the canonical life kernel. Offers are not outcomes.
 * No narrator, provider, forced feelings, relationship changes or teleportation. */
'use strict';
const schema=require('./vh2-story-policy.json'),{random}=require('./vh2-decision-engine');
const HOUR=3600000,active=p=>['proposed','accepted','active'].includes(p.status);
function policy(raw={}){return Object.fromEntries(Object.entries(schema).map(([k,s])=>[k,s.type==='boolean'?(typeof raw[k]==='boolean'?raw[k]:s.default):Number.isFinite(raw[k])?Math.max(s.min,Math.min(s.max,raw[k])):s.default]));}
function ensure(c){const r=c.vh2Story ||= {policy:policy(),threads:[],events:[],sequence:0,lastReview:null,nextAt:0};r.policy=policy(r.policy);return r;}
function closed(c,placeId,at){return (c.vh2Story?.threads||[]).some(t=>t.kind==='complication'&&t.status==='active'&&t.placeId===placeId&&t.at<=at&&at<t.endsAt);}
function preference(c,goal,at){if(c.vh2AutonomyPaused||!c.vh2Story?.policy.intensity)return 0;const adviserCurrent=c.vh2Story.adviser?.lastResult?.setupVersion===undefined||c.vh2Story.adviser.lastResult.setupVersion===(c.vh2SetupVersion||0);const focus=adviserCurrent&&c.vh2Story.policy.adviserEnabled&&c.vh2Story.adviser?.focus;const matches=f=>f&&f.expiresAt>at&&(!f.startsAt||f.startsAt<=at)&&(f.kind==='new_activity'&&f.goalId===goal.id||f.kind==='activity'&&goal.opportunityId===f.targetId||f.kind==='place'&&goal.requiredPlaceId===f.targetId);const advised=matches(focus)||(adviserCurrent&&c.vh2Story.policy.adviserEnabled&&(c.vh2Story.adviser?.agenda||[]).some(matches));if(advised)return 8;return (c.vh2Story?.threads||[]).some(t=>t.kind==='novelty'&&t.goalId===goal.id&&t.status==='offered'&&at<t.endsAt)?8:0;}
function finish(c,now){
 const r=ensure(c);
 for(const t of r.threads){
  if(!['offered','active'].includes(t.status))continue;
  const linked=t.planId?(c.vh2Plans?.plans||[]).find(p=>p.id===t.planId):(c.lifeRuntime.activities?.goals||[]).find(g=>g.id===t.goalId);
  if(t.kind==='complication'){if(now>=t.endsAt){t.status='resolved';t.resolvedAt=now;}continue;}
  if(linked&&['completed','missed','cancelled','expired','declined','abandoned'].includes(linked.status)){t.status=linked.status;t.resolvedAt=now;}
  else if(linked&&['active','accepted'].includes(linked.status))t.status='active';
  else if(now>=t.endsAt){t.status='expired';t.resolvedAt=now;}
 }
 // Bounded receipts retain unresolved threads; outcomes remain in their canonical stores.
 r.threads=r.threads.filter(t=>['offered','active'].includes(t.status)||now-(t.resolvedAt||t.at)<30*24*HOUR).slice(-100);
 r.events=r.events.slice(-100);
}
function seedAgenda(c,now){
 const r=ensure(c);if(!r.policy.adviserEnabled||!r.policy.intensity||c.vh2AutonomyPaused||(r.adviser?.lastResult?.setupVersion!==undefined&&r.adviser.lastResult.setupVersion!==(c.vh2SetupVersion||0))){for(const entry of r.adviser?.agenda||[]){const goal=(c.lifeRuntime.activities?.goals||[]).find(g=>g.id===entry.goalId);if(goal&&['planned','paused','blocked'].includes(goal.status)){goal.status='abandoned';goal.reason='Daily advice was disabled or the authored life changed.';}}return;}
 const activities=require('./vh-activity-engine'),geography=require('./vh2-geography-engine');
 const types={study:['focus','Study ',-6,2],creative_work:['focus','Work on ',-6,-4],household_task:['focus','Take care of ',-8,-4],exercise:['leisure','Exercise: ',-12,-10],rest:['recovery','Rest: ',10,-8],leisure:['leisure','Spend time on ',-2,-6],prepare_trip:['focus','Think through travel preparations: ',-5,1]};
 for(const [i,entry] of (r.adviser?.agenda||[]).entries()){
  if(entry.kind!=='new_activity'||entry.goalId||entry.startsAt>now||entry.expiresAt<=now||!types[entry.activity])continue;
  const place=c.lifeProfile.places.find(p=>p.id===entry.placeId),meta=c.vh2Geography?.places?.[entry.placeId];
  if(!place||(!['public','permitted'].includes(meta?.access)&&!(place.kind==='home'&&geography.homeAccess(c,place,now)))||!geography.homeAccess(c,place,now)||meta?.closed===true){entry.status='unavailable';continue;}
  if(entry.activity==='exercise'&&!meta.capabilities?.includes('exercise')){entry.status='unavailable';continue;}
  const [kind,prefix,energy,stress]=types[entry.activity],label=(prefix+entry.subject).slice(0,200);
  const goal=activities.addGoal(c.lifeRuntime.activities,kind,'adviser:'+entry.reviewId+':'+i,now,label);if(!goal)continue;
  Object.assign(goal,{label,requiredPlaceId:entry.placeId,expiresAt:entry.expiresAt,priority:25,minEnergy:entry.activity==='exercise'?45:20,reason:entry.reason});
  goal.steps=[{label,durationMs:entry.durationMinutes*60000,progressMs:0,energy,stress,hunger:0,costs:{},produces:{},charged:false}];
  entry.goalId=goal.id;entry.status='available';
 }
}
function advance(c,now,core){
 const r=ensure(c),p=r.policy;finish(c,now);seedAgenda(c,now);
 if(!p.intensity||c.vh2AutonomyPaused)return;
 const bucket=Math.floor(now/(3*HOUR));if(r.lastReview===bucket)return;r.lastReview=bucket;
 const d=c.humanDynamics||{},w=c.lifeRuntime.world,available=core.companionSituationAt(c,now).availability;
 const pressure=Math.max(d.stress||0,d.illnessSeverity||0);
 if(now<r.nextAt||available!=='available'||w.journey||w.outing||d.sleep?.stage==='asleep'||d.energy<40||d.hunger>75||pressure>60||(c.lifeRuntime.activities.conversationUntil||0)>now||r.threads.some(t=>['offered','active'].includes(t.status))){r.reason='Allowing existing life, needs and plans to unfold.';return;}
 const recent=[...(c.vh2Health?.events||[]),...(c.vh2Plans?.events||[])].some(e=>e.at<=now&&now-e.at<p.recoveryHours*HOUR&&(e.kind==='health_started'||e.phase==='missed'));
 if(recent){r.reason='Quiet time after a difficult recorded event.';return;}
 if(random(c.id+'|story:pace|'+bucket)>.025+p.intensity/100*.4){r.reason='An ordinary stretch of life.';return;}
 const choices=[],plans=require('./vh2-plans-engine');
 if(p.social&&c.vh2Plans?.policy?.enabled&&c.vh2Plans.policy.remoteInvitations&&!c.vh2Plans.plans.some(active))choices.push({kind:'social',weight:p.social});
 const goals=(c.lifeRuntime.activities.goals||[]).filter(g=>['leisure','focus'].includes(g.kind)&&['planned','paused'].includes(g.status)&&!g.meetingId&&!g.commitmentId&&g.notBefore<=now&&(!g.expiresAt||g.expiresAt>now));
 if(p.novelty&&goals.length)choices.push({kind:'novelty',weight:p.novelty});
 const occupied=new Set([w.placeId,w.journey?.to,...Object.values(c.vh2People?.actors||{}).flatMap(a=>[a.placeId,a.journey?.to])]);
 const places=(c.lifeProfile.places||[]).filter(place=>['social','outdoor','other'].includes(place.kind)&&!occupied.has(place.id)&&(c.vh2Geography?.knownPlaceIds||[]).includes(place.id)&&c.vh2Geography.places[place.id]?.access==='public'&&c.vh2Geography.places[place.id]?.closed!==true&&!c.vh2Geography.places[place.id]?.capabilities?.includes('food'));
 if(p.complications&&places.length&&!r.threads.some(t=>t.kind==='complication'&&now-t.at<48*HOUR))choices.push({kind:'complication',weight:p.complications});
 if(!choices.length){r.reason='No suitable opportunity with the current places and people.';return;}
 let draw=random(c.id+'|story:kind|'+bucket)*choices.reduce((n,x)=>n+x.weight,0),choice=choices.at(-1);
 for(const option of choices){draw-=option.weight;if(draw<=0){choice=option;break;}}
 const t={id:'story:'+c.id+':'+(r.sequence+1),kind:choice.kind,at:now,endsAt:now+2*HOUR,status:'offered',source:'procedural_opportunity'};
 if(t.kind==='social'){
  const plan=plans.automatic(c,now,core,{storyId:t.id});
  if(!plan){r.reason='Nobody chose to propose an additional plan.';return;}
  t.planId=plan.id;t.endsAt=plan.endsAt;t.label=plan.label;
 }else if(t.kind==='novelty'){
  goals.sort((a,b)=>a.id.localeCompare(b.id));const goal=goals[Math.floor(random(c.id+'|story:interest|'+bucket)*goals.length)];
  t.goalId=goal.id;t.label=goal.label;t.endsAt=Math.min(t.endsAt,goal.expiresAt||Infinity);
 }else{
  places.sort((a,b)=>a.id.localeCompare(b.id));const place=places[Math.floor(random(c.id+'|story:place|'+bucket)*places.length)];
  t.placeId=place.id;t.status='active';t.label='A short-notice closure at '+place.label;
  r.events.push({id:t.id+':notice',kind:'world_discovery',at:now,placeId:place.id,observerIds:[c.id],summary:t.label+'. Expected to reopen in two hours.',source:'simulated_circumstance',truthScope:'fictional_world_event'});
  if(c.vh2Geography)c.vh2Geography.nextReview=0;
 }
 r.sequence++;r.threads.push(t);r.nextAt=now+p.recoveryHours*HOUR;r.reason='An opportunity is unfolding; outcomes remain up to the participants.';
}
module.exports={seedAgenda,schema,policy,ensure,closed,preference,advance,finish};
