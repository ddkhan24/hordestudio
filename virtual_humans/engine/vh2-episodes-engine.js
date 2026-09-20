/* Multi-day intentions compete with resources, commitments, needs and temperament.
 * They create goals/stops, never a prewritten sequence of daily activities. */
'use strict';
const {random}=require('./vh2-decision-engine'),travel=require('./vh2-travel-engine'),transport=require('./vh2-transport-engine');
const DEFAULTS={enabled:false,curiosity:50,socialPull:50,minEnergy:55,maxHunger:60,maxStress:75,reserveCash:50,maxSpend:500,cooldownDays:14,threshold:35};
function ensure(c){return c.vh2Episodes ||= {policy:{...DEFAULTS},opportunities:[],lastReview:null,lastDeparture:null,decisions:[]};}
function conflicts(c,from,until,localAt){
 if(require('./vh2-plans-engine').conflicts(c,c.id,from,until))return true;
 if(!(c.lifeProfile.weeklySchedule||[]).some(b=>b.days?.length))return false;
 // Check the whole absence in the home clock, including overnight and DST boundaries.
 for(let at=from;at<=until;at+=60000){const t=localAt({...c,vh2Travel:null},at),m=t.hour*60+t.minute;
  if((c.lifeProfile.weeklySchedule||[]).some(b=>b.endMinute>b.startMinute?b.days.includes(t.weekday)&&m>=b.startMinute&&m<b.endMinute:(b.days.includes(t.weekday)&&m>=b.startMinute)||(b.days.includes((t.weekday+6)%7)&&m<b.endMinute)))return true;
 }return false;
}
function advance(c,now,localAt,availability){
 const r=ensure(c),p=r.policy,d=c.humanDynamics,w=c.lifeRuntime.world,review=Math.floor(now/(6*3600000));
 if(!p.enabled||r.lastReview===review)return;r.lastReview=review;
 if(availability!=='available'||w.journey||w.outing||travel.active(c)||!c.lifeProfile.world.transport.enabled||(c.lifeRuntime.activities?.conversationUntil||0)>now||d.energy<p.minEnergy||d.hunger>p.maxHunger||d.stress>p.maxStress||r.lastDeparture!==null&&now-r.lastDeparture<p.cooldownDays*86400000)return;
 const choices=[];
 for(const o of r.opportunities){
  if(!o.enabled||!o.stayAllowed||o.placeId===w.placeId||now<o.availableFrom||now>o.availableUntil)continue;
  const nights=o.minNights+Math.floor(random(c.id+'|nights|'+o.id+'|'+review)*(o.maxNights-o.minNights+1)),lodging=nights*o.nightlyCost;
  const stops=[{placeId:o.placeId,stayMinutes:nights*1440,stayCost:lodging},{placeId:w.placeId,stayMinutes:0}],legs=travel.itinerary(c,stops,now);if(!legs)continue;
  let end=now;for(let i=0;i<legs.length;i++)end=transport.arrivalTime(legs[i],end)+stops[i].stayMinutes*60000;
  const fare=legs.flat().reduce((n,l)=>n+Number(l.cost||0),0),total=fare+lodging;
  if(end>o.availableUntil||total>p.maxSpend||w.balance-total<p.reserveCash||conflicts(c,now,end,localAt))continue;
  const last=r.decisions.filter(x=>x.selected===o.id).at(-1),novelty=last?Math.min(20,(now-last.at)/86400000):20;
  const parts={interest:o.interest*.35,curiosity:p.curiosity*.25,social:o.personId?p.socialPull*.25:0,novelty,energy:(d.energy-50)*.2,stress:-d.stress*.15,cost:-total/Math.max(1,p.maxSpend)*25,travel:-(end-now-nights*86400000)/3600000*2,variation:(random(c.id+'|episode|'+o.id+'|'+review)-.5)*30};
  choices.push({o,nights,stops,end,total,parts,score:Object.values(parts).reduce((a,b)=>a+b,0)});
 }
 choices.sort((a,b)=>b.score-a.score||a.o.id.localeCompare(b.o.id));const selected=choices[0]?.score>=p.threshold?choices[0]:null;
 r.decisions.push({at:now,candidates:choices.map(x=>({id:x.o.id,score:x.score,cost:x.total,endsAt:x.end,components:x.parts})),selected:selected?.o.id||null});r.decisions=r.decisions.slice(-100);
 if(!selected)return;
 const tr=travel.ensure(c),id='episode:'+c.id+':'+review;tr.trips=tr.trips.slice(-49);tr.trips.push({id,label:selected.o.label,origin:'autonomous_episode',opportunityId:selected.o.id,stops:selected.stops,startsAt:now,status:'planned',legSequence:0,stopIndex:0,legs:[],createdAt:now,expectedReturn:selected.end});tr.activeId=id;r.lastDeparture=now;
}
module.exports={ensure,advance,conflicts,DEFAULTS};
