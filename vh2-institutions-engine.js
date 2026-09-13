/* Authored institutions attach consequences to existing commitments and actual presence. */
'use strict';
function advance(c,at,local,baseline){
 const r=c.vh2Institutions;if(!r||r.lastAt===at)return;
 const elapsed=r.lastAt==null?0:Math.max(0,Math.min(1,(at-r.lastAt)/60000));r.lastAt=at;
 const w=c.lifeRuntime.world,m=local.hour*60+local.minute;
 for(const rule of r.rules){
  const block=c.lifeProfile.weeklySchedule.find(b=>b.id===rule.scheduleId);
  if(!block)continue;
  // Session enrollment is explicit. No nationality/occupation defaults or invented attendance.
  const active=require('./vh-world-engine').activeOn(block,local.dateKey)&&block.days.includes(local.weekday)&&m>=block.startMinute&&m<block.endMinute;
  for(const session of Object.values(r.sessions).filter(s=>s.ruleId===rule.id&&s.status==='open')){
   if(session.observedAt===at-60000&&session.eligible&&!w.journey&&w.placeId===session.placeId)session.attendedMinutes+=elapsed;
  }
  if(active){
   const key=JSON.stringify([rule.id,local.dateKey]);
   const s=r.sessions[key]||={ruleId:rule.id,date:local.dateKey,placeId:block.placeId,expectedMinutes:block.endMinute-block.startMinute,attendedMinutes:0,startedAt:at,status:'open'};
   s.observedAt=at;s.eligible=!w.journey&&w.placeId===block.placeId&&baseline.availability!=='asleep';
  }
  for(const session of Object.values(r.sessions).filter(s=>s.ruleId===rule.id&&s.status==='open')){
   if(active&&session.date===local.dateKey)continue;
   const complete=session.attendedMinutes/Math.max(1,session.expectedMinutes)>=rule.minimumAttendance;
   session.status=complete?'completed':'missed';session.resolvedAt=at;
   const due=complete?rule.fee:0,paid=Math.min(w.balance,due);w.balance=Math.round((w.balance-paid)*100)/100;
   const finance=require('./vh2-lifestyle-engine');finance.ensure(c);c.vh2Finance.unpaid=Math.round((c.vh2Finance.unpaid+due-paid)*100)/100;
   if(due){finance.entry(c,at,'institution_fee',-paid,`${rule.label}: due ${due}; unpaid ${due-paid}.`);c.vh2Finance.trackedBalance=w.balance;}
   if(!complete)c.humanDynamics.stress=Math.min(100,c.humanDynamics.stress+rule.missedStress);
   r.events.push({kind:'institution_outcome',at,institution:rule.label,ruleId:rule.id,status:session.status,attendedMinutes:session.attendedMinutes,due,paid,unpaid:c.vh2Finance.unpaid});
  }
 }
 r.events=r.events.slice(-200);
 const keys=Object.keys(r.sessions);for(const key of keys.slice(0,Math.max(0,keys.length-200)))if(r.sessions[key].status!=='open')delete r.sessions[key];
}
module.exports={advance};
