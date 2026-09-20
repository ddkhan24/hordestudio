/* Persistent authored local residents, separate from the character's known people.
 * Public-place overlap permits an introduction attempt, never automatic friendship.
 */
'use strict';
const {random}=require('./vh2-decision-engine');
function ensure(c){return c.vh2Population ||= {enabled:false,openness:50,residents:[],contacts:{},events:[],sequence:0};}
function advance(c,now,availability,localAt,normalizePerson){
 const r=ensure(c),w=c.lifeRuntime.world,local=localAt(c,now),m=local.hour*60+local.minute;
 const place=!w.journey&&c.lifeProfile.places.find(p=>p.id===w.placeId);
 const eligible=r.enabled&&availability!=='asleep'&&place;
 const plans=require('./vh2-plans-engine');
 for(const p of r.residents){
  if(p.introducedAt!=null)continue;
  if(!eligible){delete r.contacts[p.id];continue;}
  const independent=Object.hasOwn(c.vh2People?.actors||{},p.id),actual=w.people[p.id];
  // A preferred visit window is an opportunity, never evidence of presence.
  const hosted=(c.vh2Plans?.plans||[]).some(plan=>['hosted_event','event_outing'].includes(plan.activityKind)&&['accepted','active'].includes(plan.status)&&plan.placeId===place.id&&plans.committed(c,plan,c.id)&&plans.committed(c,plan,p.id)&&c.vh2People?.actors?.[p.id]?.action?.planId===plan.id&&c.lifeRuntime.activities?.goals?.some(g=>g.meetingId===plan.id&&g.status==='active'));
  const venue=place&&(place.kind!=='home'&&place.encounterScope==='nearby'||hosted);
  const present=eligible&&(availability==='available'||hosted)&&venue&&independent&&actual?.placeId===place.id&&actual?.availability==='available';
  if(!present){delete r.contacts[p.id];continue;}
  if(!Object.hasOwn(r.contacts,p.id))Object.defineProperty(r.contacts,p.id,{value:{since:now,attempted:false},enumerable:true,writable:true,configurable:true});
  const contact=r.contacts[p.id];
  if(contact.attempted||now-contact.since<15*60000||c.lifeProfile.socialCircle.length>=30)continue;
  // One opportunity per visit, with a one-day bound across revisits; no polling lottery.
  if(p.lastAttemptAt!=null&&now-p.lastAttemptAt<86400000)continue;
  contact.attempted=true;p.lastAttemptAt=now;
  const stress=Math.max(0,Math.min(100,c.humanDynamics.stress||0));
  const selfChance=r.openness/100*(1-stress/120),otherChance=p.openness/100;
  const selfDraw=random(`${c.id}|${p.id}|${contact.since}|approach`),otherDraw=random(`${c.id}|${p.id}|${contact.since}|response`);
  p.lastDecision={at:now,selfChance,otherChance,selfDraw,otherDraw};
  if(selfDraw>=selfChance||otherDraw>=otherChance)continue;
  const person=normalizePerson({id:p.id,name:p.name,role:'acquaintance',relationship:'Recently introduced',closeness:0,trust:0,tension:0,description:p.sharedDescription||'',contactWindows:[],...(p.age!=null?{age:p.age}:{})});
  // Exchanging names does not establish a phone number or permission to contact.
  person.contactWindows=[];person.vh2SocialDisposition={openness:p.openness};
  c.lifeProfile.socialCircle.push(person);
  p.introducedAt=now;p.introducedPlaceId=place.id;
  r.events.push({id:`introduction:${c.id}:${++r.sequence}`,kind:'introduction',at:now,personId:p.id,placeId:place.id,summary:`Exchanged names with ${p.name} at ${place.label}. ${p.sharedDescription||''} No friendship, romantic interest or contact exchange is established.`});
 }
 r.events=r.events.slice(-100);return r;
}
function known(c){return (c.vh2Population?.residents||[]).filter(p=>p.introducedAt!=null).map(p=>({personId:p.id,name:p.name,introducedAt:p.introducedAt,placeId:p.introducedPlaceId||p.placeId,sharedDescription:p.sharedDescription||''}));}
module.exports={ensure,advance,known};
