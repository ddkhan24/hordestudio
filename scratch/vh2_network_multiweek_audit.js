'use strict';
const assert=require('node:assert/strict'),{fixture,local,start,MIN}=require('./vh2_people_audit'),engine=require('../vh2-people-engine');
const rows=[];
for(let seed=0;seed<8;seed++){
 const c=fixture();c.id='network-seed-'+seed;const a=c.vh2People.actors.sam;
 for(let i=0;i<2;i++){const b=JSON.parse(JSON.stringify(a));b.id='npc-'+i;b.policy.curiosity=30+i*50;c.vh2People.actors[b.id]=b;}
 for(const actor of Object.values(c.vh2People.actors))actor.balance=1000;
 c.vh2People.network={enabled:true,lastAt:start,pairs:{},events:[],policy:{groupPlansEnabled:true}};
 engine.advance(c,start+14*1440*MIN,local);
 const pairs=Object.values(c.vh2People.network.pairs),actors=Object.values(c.vh2People.actors);
 assert(actors.every(a=>Number.isFinite(a.energy)&&a.balance>=0&&a.hunger>=0&&a.hunger<=100));
 assert(c.vh2People.network.events.length<=200);
 rows.push({seed,days:14,actors:actors.length,meetings:pairs.reduce((n,p)=>n+p.meetings,0),bonds:pairs.length,completedPlans:(c.vh2Plans?.plans||[]).filter(p=>p.status==='completed').length,missedPlans:(c.vh2Plans?.plans||[]).filter(p=>p.status==='missed').length});
}
assert(rows.some(r=>r.meetings>0));assert(rows.some(r=>r.completedPlans>0),'Established friends can complete group plans over two weeks');assert(new Set(rows.map(r=>r.meetings)).size>1,'Seeds must produce differing encounter histories');
if(process.argv[2])require('node:fs').writeFileSync(process.argv[2],JSON.stringify({scope:'Independent NPC encounters and group intentions; not universal human realism',runs:rows},null,2));
console.log('Eight 14-day network simulations passed:',JSON.stringify(rows));
