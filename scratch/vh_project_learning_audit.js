const assert=require('node:assert/strict');
const engine=require('../vh-activity-engine');
const minute=60000,day=86400000,start=Date.UTC(2026,8,8);
const options=[{id:'draft',kind:'focus',label:'a short story',projectMinutes:240,learnFromOutcomes:true,startMinute:600,endMinute:630,priority:70,minEnergy:0}];
function simulate(interrupt,reload=false){let state=engine.normalize();let energy=0;
 for(let d=0;d<7;d++){
  const midnight=start+d*day,at=midnight+600*minute;
  engine.plan(state,at,{opportunities:options,seed:'same-person',dateKey:String(d),weekday:d%7,midnight});
  state.lastAdvancedAt=at;
  for(let m=0;m<31;m++){
   const time=at+m*minute;
   if(interrupt && m===2)engine.reserveAttention(state,time,`conversation-${d}`,120000);
   if(interrupt && m===5)engine.reserveAttention(state,time,`conversation-later-${d}`,120000);
   const delta=engine.advance(state,time+minute,{availability:'available',energy:70,hunger:0,socialNeed:0});energy+=delta.energy;
   if(reload)state=engine.normalize(JSON.parse(JSON.stringify(state)));
  }
 }
 return {state,energy};}
const quiet=simulate(false),social=simulate(true),reloaded=simulate(true,true);
assert(quiet.state.projects[0].progressMs>social.state.projects[0].progressMs);
assert.deepEqual(social,reloaded);
assert(social.state.learning[0].missed>0);assert(social.energy<0,'unfinished project work must still cost energy');
assert(quiet.state.learning[0].completed>social.state.learning[0].completed);
const learning=engine.normalize(); learning.learning=[{id:'draft',completed:4,missed:0}];
const baseline=engine.normalize();
const context={opportunities:options,seed:'same',dateKey:'day',weekday:0,midnight:start};
engine.plan(learning,start+600*minute,context);engine.plan(baseline,start+600*minute,context);
assert.equal(engine.utility(learning.goals[0],learning,start+600*minute,{}).components.habit-engine.utility(baseline.goals[0],baseline,start+600*minute,{}).components.habit,6);
assert.equal(learning.goals[0].priority,baseline.goals[0].priority,'learning changes utility, not the authored base preference');
learning.learning[0].definitionKey=learning.goals[0].definitionKey;
const before=learning.learning[0].completed;
engine.advance(learning,start+631*minute,{availability:'asleep',energy:70});engine.advance(learning,start+632*minute,{availability:'asleep',energy:70});
assert.equal(learning.learning[0].completed,before);
assert.equal(learning.learning[0].missed,1);
const complete=engine.normalize();const tiny={...context,opportunities:[{...options[0],projectMinutes:1}]};
engine.plan(complete,start+600*minute,tiny);complete.lastAdvancedAt=start+600*minute;engine.advance(complete,start+602*minute,{availability:'available',energy:70});
assert.equal(complete.projects[0].progressMs,minute);assert.equal(complete.events.filter(e=>e.kind==='project_completed').length,1);
const count=complete.goals.length;engine.plan(complete,start+day+600*minute,{...tiny,dateKey:'next',midnight:start+day});assert.equal(complete.goals.length,count);
console.log('PASS seven-day alternate histories: interruptions change persistent effort, fatigue and learned outcomes; per-minute reload parity');
console.log('PASS bounded learned priority, missed-window dedupe, exact work target, one completion receipt and no further project sessions');
