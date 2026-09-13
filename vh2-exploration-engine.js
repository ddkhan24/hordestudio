/* Attention-limited perception only. Movement belongs to the shared geographic planner. */
'use strict';
const {random}=require('./vh2-decision-engine'),travel=require('./vh2-travel-engine');
const DEFAULTS={enabled:false,curiosity:50,sociability:50,minEnergy:45,maxHunger:65,maxStress:75,cooldownHours:24,maxTravelMinutes:180,stayMinutes:60,threshold:45,interests:[]};
function ensure(c){return c.vh2Exploration ||= {policy:{...DEFAULTS},lastReview:null,lastTripAt:null,decisions:[]};}
function advance(c,now,localAt,availability){
 const r=ensure(c),p=r.policy,d=c.humanDynamics,w=c.lifeRuntime.world,s=c.vh2Signals;
 const hour=Math.floor(now/3600000);if(r.lastReview===hour)return;r.lastReview=hour;
 const free=availability==='available'&&!w.journey&&d.sleep?.stage!=='asleep'&&(c.lifeRuntime.activities?.conversationUntil||0)<=now;
 if(s){s.known ||= [];s.events ||= [];const seen=new Map(s.known.map(k=>[k.id,k]));
  for(const item of s.signals.filter(i=>i.expiresAt>now&&(!seen.has(i.id)||(['calendar_event','sports_update'].includes(i.type)&&i.versionKey!==seen.get(i.id).versionKey))).slice(-30)){
   const match=item.tags.some(t=>p.interests.includes(t));const chance=(p.curiosity/100)*.3+(match?.4:0);
   if(!free||random(c.id+'|notice|'+item.id+'|'+hour)>=chance)continue;
   const known={...item,noticedAt:now};s.known=s.known.filter(k=>k.id!==item.id);s.known.push(known);s.events.push({id:'noticed:'+item.id+':'+(item.versionKey||item.receivedAt),kind:'world_discovery',at:now,summary:`Read a source claim: ${item.title}. Not independently verified.`,sourceId:item.sourceId,signalId:item.id});
  }s.known=s.known.slice(-200);s.events=s.events.slice(-150);
 }
}
module.exports={ensure,observe:advance,advance,DEFAULTS};
