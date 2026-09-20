/* Fictional everyday health episodes integrated with the existing needs clock.
 * These parameters are simulation controls, not medical predictions. */
'use strict';
const {random}=require('./vh2-decision-engine');
const HOUR=3600000,DAY=24*HOUR;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const DEFAULTS={enabled:true,illnessRatePerYear:2,recoveryScale:1};
function policy(p={}){return {enabled:p.enabled!==false,illnessRatePerYear:clamp(p.illnessRatePerYear??2,0,12),recoveryScale:clamp(p.recoveryScale??1,.5,2)};}
function ensure(c){const h=c.vh2Health||={policy:{...DEFAULTS},episode:null,events:[],lastAt:null,lastDay:null};h.policy=policy(h.policy);h.events||=[];return h;}
// A weather sample describes one region at one time, not the whole world.
// Both the central character and other participants use the same evidence gate.
function temperatureAt(c,at,participant=null){
 const environment=c.lifeRuntime?.environment;
 if(!environment||environment.stale||!Number.isFinite(environment.temperature))return null;
 const observed=environment.observedAt??environment.fetchedAt;
 if(Number.isFinite(observed)&&(at<observed||at-observed>HOUR))return null;
 if(environment.scope==='weather_model_observation'&&!Number.isFinite(observed))return null;
 if(Array.isArray(environment.coordinates)){
  const world=participant?{...c.lifeRuntime.world,placeId:participant.placeId,journey:participant.journey}:c.lifeRuntime?.world;
  let point=require('./vh-world-engine').position({...c,lifeRuntime:{...c.lifeRuntime,world}},at)?.coordinates;
  const place=c.lifeProfile?.places?.find(p=>p.id===world?.placeId);
  const homes=(c.lifeProfile?.places||[]).filter(p=>p.kind==='home'),residence=c.vh2Travel?.residenceId||(homes.length===1?homes[0].id:null);
  if(!point&&!world?.journey&&place?.id===residence&&!place.googlePlaceId&&[c.locationLongitude,c.locationLatitude].every(Number.isFinite))point=[c.locationLongitude,c.locationLatitude];
  if(!point||!environment.coordinates.every(Number.isFinite)||environment.coordinates.length!==2)return null;
  const [longitude,latitude]=environment.coordinates;
  const longitudeDelta=((point[0]-longitude+540)%360)-180;
  const km=111.2*Math.hypot(point[1]-latitude,longitudeDelta*Math.cos((point[1]+latitude)*Math.PI/360));
  if(km>20)return null;
 }
 return environment.temperature;
}
function updateHeat(d,temperature,hours){
 // Residual discomfort fades when there is no current local heat observation.
 const target=Number.isFinite(temperature)?clamp((temperature-27)*7,0,100):0;
 if(!Number.isFinite(d.heatDiscomfort)&&temperature===null)return;
 d.heatDiscomfort=clamp((d.heatDiscomfort??target)+(target-(d.heatDiscomfort??target))*(1-Math.exp(-Math.max(0,hours))),0,100);
}
function update(h,id,d,at,resting){
 const p=policy(h.policy),last=h.lastAt;h.lastAt=at;
 const hours=last===null||last===undefined?0:clamp((at-last)/HOUR,0,24),day=Math.floor(at/DAY);
 if(!p.enabled){d.illnessSeverity=0;return;}
 // One deterministic opportunity per day; revisiting an instant never rerolls it.
 if(h.lastDay!==day){
  h.lastDay=day;
  if(!h.episode&&(!h.lastRecoveredAt||at-h.lastRecoveredAt>7*DAY)&&random(id+'|health-onset|'+day)<p.illnessRatePerYear/365){
   const kinds=['low energy and feeling run-down','cold-like discomfort','headache and fatigue','stomach discomfort'];
   h.episode={id:'health:'+id+':'+day,startedAt:at,endsAt:at+(24+Math.floor(random(id+'|health-duration|'+day)*49))*HOUR*p.recoveryScale,
    label:kinds[Math.floor(random(id+'|health-kind|'+day)*kinds.length)],peak:25+random(id+'|health-severity|'+day)*40,restHours:0};
   h.events.push({id:h.episode.id+':start',kind:'health_started',at,summary:'Started feeling unwell: '+h.episode.label+'.',truthScope:'simulation'});
  }
 }
 const e=h.episode;
 if(e){
  if(resting)e.restHours+=hours;
  const effectiveEnd=e.endsAt-Math.min(6,e.restHours*.15)*HOUR;
  if(at>=effectiveEnd){h.events.push({id:e.id+':recovered',kind:'health_recovered',at,summary:'Recovered from the recent period of feeling unwell.',truthScope:'simulation'});h.lastRecoveredAt=at;h.episode=null;d.illnessSeverity=0;}
  else{
   const phase=clamp((at-e.startedAt)/(effectiveEnd-e.startedAt),0,1);
   d.illnessSeverity=Math.round(e.peak*Math.max(.25,Math.sin(Math.PI*phase)));
   d.energy=clamp((d.energy??70)-hours*d.illnessSeverity/100*(resting?.4:3),0,100);
   d.stress=clamp((d.stress??20)+hours*d.illnessSeverity/100*(resting?-.8:1.2),0,100);
  }
 }else d.illnessSeverity=0;
 h.events=h.events.slice(-80);
}
function advance(c,at){
 const h=ensure(c),d=c.humanDynamics||{},last=h.lastAt;
 const active=c.lifeRuntime?.activities?.goals?.find(g=>g.status==='active');
 update(h,c.id,d,at,d.sleep?.stage==='asleep'||active?.kind==='recovery');
 updateHeat(d,temperatureAt(c,at),last==null?0:clamp((at-last)/HOUR,0,24));
}
function advanceActor(c,actor,at){
 const parent=ensure(c);actor.health||={policy:{...parent.policy},episode:null,events:[],lastAt:null,lastDay:null};
 actor.health.policy={...parent.policy};update(actor.health,actor.id,actor,at,['sleep','rest'].includes(actor.action?.kind));
}
function preference(c,goal){const severity=c.humanDynamics?.illnessSeverity||0;return goal.kind==='recovery'?severity*.8:goal.kind==='meal'?severity*.08:severity>20?-severity*.45:0;}
function context(c){const h=ensure(c);return {feelingUnwell:h.policy.enabled&&!!h.episode,severity:h.policy.enabled?(c.humanDynamics?.illnessSeverity||0):0,symptoms:h.policy.enabled?(h.episode?.label||''):'',since:h.policy.enabled?(h.episode?.startedAt||null):null,heatDiscomfort:c.humanDynamics?.heatDiscomfort??null};}
module.exports={DEFAULTS,policy,ensure,advance,advanceActor,preference,context,temperatureAt,updateHeat};
