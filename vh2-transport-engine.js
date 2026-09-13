/* Time-dependent travel over authored service departures and known local routes.
 * A service record is simulation data, never evidence of a real booking. */
'use strict';
const MIN=60000;
function ensure(c){const r=c.vh2Transport ||= {services:[],sequence:0};return r;}
function route(c,a,to,at){
 if(a.placeId===to)return [];
 if(!Number.isFinite(at))return require('./vh2-people-engine').route(c.lifeProfile.travelLegs,a,to);
 const queue=[{place:a.placeId,car:a.carPlaceId,bike:a.bikePlaceId,at,cost:0,legs:[],seen:[a.placeId]}],labels=new Map();let count=0;
 while(queue.length&&count++<3000){
  queue.sort((x,y)=>x.at-y.at||x.cost-y.cost||x.place.localeCompare(y.place));const n=queue.shift();if(n.place===to)return n.legs;
  const key=JSON.stringify([n.place,n.car,n.bike]),prior=labels.get(key)||[];
  if(prior.some(x=>x.at<=n.at&&x.cost<=n.cost))continue;
  labels.set(key,[...prior.filter(x=>!(n.at<=x.at&&n.cost<=x.cost)),{at:n.at,cost:n.cost}]);
  if(n.legs.length>=12)continue;
  const edges=[...c.lifeProfile.travelLegs,...ensure(c).services.filter(s=>s.status==='scheduled'&&n.at<=s.departsAt-s.boardingMinutes*MIN&&s.departsAt-n.at<=(a.policy.maxWaitMinutes??Infinity)*MIN).map(s=>({from:s.from,to:s.to,mode:'TRANSIT',minutes:(s.arrivesAt-s.departsAt)/MIN,cost:s.cost,source:s.source,serviceId:s.id,serviceKind:s.kind,serviceLabel:s.label,scheduledDeparture:s.departsAt,scheduledArrival:s.arrivesAt,boardingMinutes:s.boardingMinutes}))];
  for(const l of edges){
   if(l.from!==n.place||n.seen.includes(l.to)||!a.policy.modes.includes(l.mode)||!Number.isFinite(l.minutes)||l.minutes<=0)continue;
   if(l.mode==='DRIVE'&&n.car!==l.from||l.mode==='BICYCLE'&&n.bike!==l.from)continue;
   const cost=Number(l.cost||0);if(!Number.isFinite(cost)||cost<0||n.cost+cost>a.balance)continue;
   const arrive=l.scheduledArrival??n.at+l.minutes*MIN;
   queue.push({place:l.to,car:l.mode==='DRIVE'?l.to:n.car,bike:l.mode==='BICYCLE'?l.to:n.bike,at:arrive,cost:n.cost+cost,legs:[...n.legs,{...l,estimatedArrival:arrive}],seen:[...n.seen,l.to]});
  }
 }
 return null;
}
function arrivalTime(legs,start){return legs.reduce((at,l)=>l.scheduledArrival??at+l.minutes*MIN,start);}
module.exports={ensure,route,arrivalTime};
