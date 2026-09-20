/* Observable text check-ins. A quoted promise is an interpretation; its later
 * message receipt is an observation. Neither proves an offscreen action. */
'use strict';
const psyche=require('./vh2-psychology-engine');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function ensure(c){const r=psyche.ensure(c);r.checkIns||=[];return r;}
function register(c,input,now){
 const r=ensure(c);if(!r.conversationPolicy.enabled||!Array.isArray(input?.commitments))return;
 for(const p of input.commitments.slice(0,2)){
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['sourceMessageId','evidence','dueInMinutes','confidence'].includes(k)))continue;
  const m=(input.messages||[]).find(m=>m.id===p.sourceMessageId&&m.role==='user'&&m.readAt>0&&m.readAt<=now);
  if(!m||typeof p.evidence!=='string'||p.evidence.trim().length<3||p.evidence.length>500||!m.text.includes(p.evidence))continue;
  if(!Number.isFinite(p.confidence)||p.confidence<r.conversationPolicy.minConfidence||p.confidence>1||!Number.isInteger(p.dueInMinutes)||p.dueInMinutes<1||p.dueInMinutes>10080)continue;
  if(r.checkIns.length>=100||r.checkIns.some(x=>x.sourceMessageId===m.id))continue;
  const at=m.timestamp;if(!Number.isSafeInteger(at)||at>now)continue;
  const dueAt=at+p.dueInMinutes*60000,window=Math.min(15*60000,p.dueInMinutes*15000);
  r.checkIns.push({id:'checkin:'+m.id,sourceMessageId:m.id,personaId:input.personaId,evidence:p.evidence,confidence:p.confidence,
   createdAt:now,promisedAt:at,dueAt,notBefore:dueAt-window,graceUntil:dueAt+15*60000,status:'pending',truthScope:'model_interpretation'});
 }
}
function advance(c,inbox,now){
 const r=ensure(c),used=new Set(r.checkIns.map(x=>x.outcomeMessageId).filter(Boolean));
 for(const item of r.checkIns){
  if(!['pending','overdue'].includes(item.status)||item.personaId!==inbox.personaId)continue;
  const m=inbox.messages.filter(m=>!used.has(m.id)&&m.id!==item.sourceMessageId&&m.role==='user'&&m.readAt>0&&m.readAt<=now&&m.timestamp>=item.notBefore&&m.timestamp<=now&&m.playerPersonaId===item.personaId).sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id))[0];
  if(!m){if(now>item.graceUntil)item.status='overdue';continue;}
  used.add(m.id);
  item.status=m.timestamp<=item.graceUntil?'fulfilled':'late';item.observedAt=now;item.outcomeMessageId=m.id;item.receivedAt=m.timestamp;
  const changes={};const cfg=r.relationshipPolicy;
  // Actual punctuality can add a small trust impression, sharing the existing
  // 24-hour budget. Silence and lateness do not establish harmful intent.
  if(item.status==='fulfilled'&&cfg.enabled&&c.relationshipDynamics){
   const e=r.relationshipEvidence||{personaId:inbox.personaId,positiveExchanges:0,negativeExchanges:0,spent:{}};
   if(e.personaId===inbox.personaId){
    r.relationshipEvidence=e;
    if(e.budgetWindowAt===undefined||now-e.budgetWindowAt>=86400000){e.budgetWindowAt=now;e.spent={};}
    const before=c.relationshipDynamics.trust||0,delta=Math.min(cfg.positiveStep*.5*cfg.trustOpenness/100,Math.max(0,cfg.dailyLimit-(e.spent.trust||0)));
    c.relationshipDynamics.trust=clamp(before+delta,-100,100);changes.trust=c.relationshipDynamics.trust-before;e.spent.trust=(e.spent.trust||0)+changes.trust;
   }
  }
  item.relationshipChanges=changes;
  r.episodes.push({id:item.id+':outcome',kind:'check_in_outcome',at:now,personaId:inbox.personaId,sourceMessageId:m.id,
   summary:`Text check-in ${item.status}: a subsequent player message arrived. Original quoted expectation: ${item.evidence}`,
   appraisal:{truthScope:'observed_communication',promiseSourceMessageId:item.sourceMessageId,outcomeMessageId:m.id,relationshipChanges:changes,basis:'Observed message timing against an interpreted expectation; no offscreen completion or intent inferred.'}});
 }
 r.episodes=r.episodes.slice(-r.policy.memoryLimit);
}
module.exports={register,advance};
