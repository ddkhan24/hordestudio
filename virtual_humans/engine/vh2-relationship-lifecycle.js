/* Reciprocal social transitions require recorded shared experience, not tone alone. */
'use strict';
const {random}=require('./vh2-decision-engine');
const DAY=86400000;
const DEFAULTS={contactMeetings:3,contactDays:7,contactStartHour:8,contactEndHour:22,friendMeetings:6,friendDays:21,friendWarmth:5,datingMeetings:10,datingDays:30,partnerMeetings:20,partnerDays:90,strainThreshold:20,quietDays:14,distantDays:60};
function policy(r){return {...DEFAULTS,...r.policy};}
function advance(c,p,pair,plan,now){
 const r=c.vh2SocialBonds,pol=policy(r);pair.lifecycle||={status:p.role==='partner'?'partner':p.role==='ex'?'separated':'none',contactExchangedAt:null,events:[]};const l=pair.lifecycle;
 const elapsed=(now-Math.max(pair.self.firstMeetingAt??now,pair.other.firstMeetingAt??now))/DAY;
 const meetings=Math.min(pair.self.meetings,pair.other.meetings),comfortable=pair.self.warmth>0&&pair.other.warmth>0;
 const append=(kind,summary)=>{const event={id:`social-life:${c.id}:${p.id}:${plan.id}:${kind}`,kind:'relationship_transition',at:now,personId:p.id,transition:kind,summary};l.events.push(event);l.events=l.events.slice(-40);};
 if(l.contactExchangedAt===null&&!p.contactWindows?.length&&comfortable&&meetings>=pol.contactMeetings&&elapsed>=pol.contactDays){
  l.contactExchangedAt=now;p.contactWindows=[{days:[0,1,2,3,4,5,6],startMinute:pol.contactStartHour*60,endMinute:pol.contactEndHour*60}];
  append('contact_exchanged',`Exchanged contact details with ${p.name} after repeated comfortable time together. This permits future contact; it does not establish intimacy.`);
 }
 const romantic=l.policy;
 const core=require('./vh-simulation-core'),actualAge=core.companionCurrentAge(c,p),hasDob=Object.hasOwn(c.vh2Calendar?.ages||{},p.id);
 const adultAge=actualAge??(!hasDob&&p.age==null?romantic?.personAge:null);
 const eligible=romantic?.enabled&&core.companionCurrentAge(c)>=18&&adultAge>=18&&romantic.personAge>=18&&(!hasDob||romantic.personAge<=adultAge)&&p.role!=='family'&&romantic.selfPotential>0&&romantic.otherPotential>0;
 if(!eligible)return;
 if(['dating','partner'].includes(l.status)&&(Math.max(pair.self.strain||0,pair.other.strain||0)>=pol.strainThreshold)){
  l.status='separated';l.separatedAt=now;append('separated',`Ended the romantic relationship with ${p.name} after repeated unsatisfying shared experiences. No betrayal or specific argument is established.`);return;
 }
 if(l.status==='separated'||!comfortable||pair.self.trust<0||pair.other.trust<0)return;
 // Existing partners and other active dating relationships block a new pairing.
 const committed=Object.values(r.pairs).some(x=>x!==pair&&['dating','partner'].includes(x.lifecycle?.status))||(c.lifeProfile.socialCircle||[]).some(x=>x.id!==p.id&&x.role==='partner');
 if(committed)return;
 const next=l.status==='none'&&meetings>=pol.datingMeetings&&elapsed>=pol.datingDays?'dating':l.status==='dating'&&meetings>=pol.partnerMeetings&&elapsed>=pol.partnerDays?'partner':null;
 if(!next)return;
 const selfDraw=random(`${c.id}|${p.id}|${plan.id}|${next}|self`),otherDraw=random(`${c.id}|${p.id}|${plan.id}|${next}|other`);
 const selfChance=romantic.selfPotential/100*Math.max(0,1-(pair.self.strain||0)/pol.strainThreshold),otherChance=romantic.otherPotential/100*Math.max(0,1-(pair.other.strain||0)/pol.strainThreshold);
 l.lastDecision={at:now,next,selfDraw,otherDraw,selfChance,otherChance};
 if(selfDraw<selfChance&&otherDraw<otherChance){l.status=next;l.changedAt=now;append(next,next==='dating'?`Mutually agreed to start dating ${p.name} after sustained shared experience.`:`Mutually agreed to become partners with ${p.name}.`);}
}
function visibleEvents(c){return Object.values(c.vh2SocialBonds?.pairs||{}).flatMap(p=>p.lifecycle?.events||[]);}
module.exports={DEFAULTS,policy,advance,visibleEvents};
