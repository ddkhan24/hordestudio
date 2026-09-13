/* Seeded decisions over feasible affordances. No wall clock or provider access. */
'use strict';
const DEFAULTS={temperature:12,exploration:0.03,minHoldMinutes:5,reconsiderMinutes:10,urgentHunger:90,urgentEnergy:10};
function policy(raw={}){
 const limits={temperature:[0,50],exploration:[0,.25],minHoldMinutes:[0,30],reconsiderMinutes:[1,60],urgentHunger:[60,100],urgentEnergy:[0,40]};
 return Object.fromEntries(Object.entries(DEFAULTS).map(([k,v])=>[k,Math.max(limits[k][0],Math.min(limits[k][1],Number.isFinite(raw[k])?raw[k]:v))]));
}
function random(key){let h=2166136261;for(const c of key)h=Math.imul(h^c.charCodeAt(0),16777619);h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);return ((h^(h>>>16))>>>0)/4294967296;}
function select(runtime,candidates,now,context,score){
 const p=policy(runtime.policy);runtime.policy=p;
 if(!candidates.length){runtime.choice=null;return null;}
 let feasible=[...candidates].sort((a,b)=>a.id.localeCompare(b.id));
 const relief=g=>g.steps.slice(g.stepIndex).reduce((r,s)=>({hunger:r.hunger+(s.hunger||0),energy:r.energy+(s.energy||0)}),{hunger:0,energy:0});
 let urgency='';
 if(context.hunger>=p.urgentHunger&&feasible.some(g=>relief(g).hunger<0)){feasible=feasible.filter(g=>relief(g).hunger<0);urgency='urgent_hunger';}
 if(context.energy<=p.urgentEnergy&&feasible.some(g=>relief(g).energy>0)){feasible=feasible.filter(g=>relief(g).energy>0);urgency=urgency?urgency+'+urgent_energy':'urgent_energy';}
 const signature=feasible.map(g=>g.id+':'+g.stepIndex).join('|')+'|'+urgency;
 const current=feasible.find(g=>g.id===runtime.choice?.goalId&&g.status==='active');
 const holding=current&&now<runtime.choice.at+p.minHoldMinutes*60000;
 if(current&&runtime.choice.urgency===urgency&&(holding||signature===runtime.choice.signature&&now<runtime.choice.nextAt))return current;
 const scored=feasible.map(g=>({id:g.id,...score(g)}));
 const max=Math.max(...scored.map(g=>g.score));
 const weights=p.temperature===0?scored.map(g=>g.score===max?1:0):scored.map(g=>Math.exp((g.score-max)/p.temperature));
 const total=weights.reduce((a,b)=>a+b,0);
 const probabilities=weights.map(w=>p.temperature===0?w/total:(1-p.exploration)*w/total+p.exploration/weights.length);
 const sequence=(runtime.sequence||0)+1,draw=random(`${context.seed}|decision|${sequence}|${now}|${signature}`);
 let acc=0,index=probabilities.length-1;
 for(let i=0;i<probabilities.length;i++){acc+=probabilities[i];if(draw<acc){index=i;break;}}
 const goal=feasible[index];
 runtime.sequence=sequence;
 runtime.choice={at:now,nextAt:now+p.reconsiderMinutes*60000,sequence,goalId:goal.id,signature,urgency,draw,
   candidates:scored.map((s,i)=>({...s,probability:probabilities[i]})),
   excluded:[...(context.excluded||[]),...candidates.filter(g=>!feasible.includes(g)).map(g=>({id:g.id,reason:urgency}))]};
 runtime.history=[...(runtime.history||[]),runtime.choice].slice(-50);
 return goal;
}
function nextWake(c,now){
 const minute=60000, candidates=[];
 const add=(at,reason)=>{if(Number.isFinite(at)&&at>now)candidates.push({at,reason});};
 for(const p of c.vh2Plans?.plans||[])if(['proposed','accepted','active'].includes(p.status)){add(p.startsAt,'shared_plan_start');add(p.endsAt,'shared_plan_end');}
 for(const person of Object.values(c.vh2People?.actors||{})){add(person.journey?.arrivesAt,'independent_person_arrival');add(person.action?.endsAt,'independent_person_action');}
 for(const person of Object.values(c.vh2NpcTravel?.people||{}))add(person.journey?.arrivesAt,'supporting_person_arrival');
 const a=c.lifeRuntime.activities,d=c.humanDynamics;
 // Retain the shared physiology integrator's five-minute checkpoints.
 add(d.lastUpdated+300000,'physiology');
 add(a.conversationUntil,'attention_released');add(a.break?.endsAt,'break_ends');
 const sleep=d.sleep||{};
 if(sleep.stage==='winding_down'){const deadline=sleep.windDownAt+(c.lifeProfile.sleepPolicy?.windDownMinutes??10)*minute;add(d.lastUpdated+Math.ceil((deadline-d.lastUpdated)/300000)*300000,'sleep_transition');}
 if(sleep.stage==='waking')add(sleep.wakeAt+20*minute,'sleep_inertia_ends');
 const journey=c.lifeRuntime.world?.journey;add(journey?.arrivesAt,'arrival');add(journey?.arrivalAt,'arrival');
 for(const g of a.goals){
  if(['completed','abandoned'].includes(g.status))continue;
  add(g.notBefore,'action_available');add(g.expiresAt,'action_expires');
  if(g.status==='active'){
   const step=g.steps[g.stepIndex];if(step)add(now+Math.max(0,step.durationMs-step.progressMs),'action_step_complete');
  }
 }
 add(c.vh2Decision?.choice?.nextAt,'decision_review');
 const choice=c.vh2Decision?.choice,p=policy(c.vh2Decision?.policy);
 if(choice){
  add(choice.at+p.minHoldMinutes*minute,'hold_expires');
  if(choice.nextAt<=now&&choice.at+p.minHoldMinutes*minute<=now&&a.goals.some(g=>g.status==='active'))add(now+minute,'decision_due');
 }
 if(!c.vh2Decision?.choice&&a.goals.some(g=>g.status==='active'))add(now+minute,'decision_policy_review');
 // A minute is the finest resolution supported by the existing action integrator.
 // Scan for authored availability/opportunity boundaries, not another random poll.
 const offset=c.timezoneOffsetMinutes||0,local=new Date(now+offset*minute),midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-offset*minute;
 for(let day=0;day<2;day++){
  const weekday=(local.getUTCDay()+day)%7;
  for(const block of c.lifeProfile.weeklySchedule||[])if(block.days.includes(weekday)){
   add(midnight+day*86400000+block.startMinute*minute,'schedule_start');add(midnight+day*86400000+block.endMinute*minute,'schedule_end');
  }
  for(const person of c.lifeProfile.world?.people||[])if(person.days.includes(weekday)){add(midnight+day*86400000+person.start*minute,'person_routine_start');add(midnight+day*86400000+person.end*minute,'person_routine_end');}
  for(const o of c.lifeProfile.activityOptions||[]){add(midnight+day*86400000+o.startMinute*minute,'opportunity_start');add(midnight+day*86400000+o.endMinute*minute,'opportunity_end');}
 }
 if(!a.goals.some(g=>g.status==='active')&&d.sleep?.stage!=='asleep'&&
    (now===a.plannerStartedAt||a.goals.some(g=>['planned','paused'].includes(g.status)&&g.notBefore<=now&&(!g.expiresAt||g.expiresAt>now))))add(now+minute,'evaluate_affordances');
 const anchor=a.lastAdvancedAt||now;
 const bounded=candidates.map(x=>({...x,at:Math.max(now+minute,anchor+Math.ceil((x.at-anchor)/minute)*minute)}));
 bounded.push({at:now+300000,reason:'bounded_physiology_check'});
 bounded.sort((a,b)=>a.at-b.at||a.reason.localeCompare(b.reason));
 return {at:bounded[0].at,reasons:[...new Set(bounded.filter(x=>x.at===bounded[0].at).map(x=>x.reason))],resolutionMs:minute};
}
module.exports={policy,select,nextWake,DEFAULTS,random};
