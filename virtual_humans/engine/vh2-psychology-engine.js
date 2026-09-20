/* Experience appraisal over completed kernel actions. No language classifier,
 * provider calls, invented episodes or authoritative interpretation of messages. */
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const DEFAULTS={enabled:true,learningRate:.2,experienceWeight:6,emotionalImpact:1,affectHalfLifeHours:3,memoryLimit:200};
function policy(raw={}){return {enabled:raw.enabled!==false,learningRate:clamp(raw.learningRate??.2,0,1),experienceWeight:clamp(raw.experienceWeight??6,0,20),emotionalImpact:clamp(raw.emotionalImpact??1,0,3),affectHalfLifeHours:clamp(raw.affectHalfLifeHours??3,.25,48),memoryLimit:Math.round(clamp(raw.memoryLimit??200,20,500))};}
const CONVERSATION_DEFAULTS={enabled:true,emotionalImpact:1,minConfidence:.8,maxEmotionChange:4};
function conversationPolicy(raw={}){return {enabled:raw.enabled!==false,emotionalImpact:clamp(raw.emotionalImpact??1,0,3),minConfidence:clamp(raw.minConfidence??.8,.5,1),maxEmotionChange:clamp(raw.maxEmotionChange??4,0,10)};}
const RELATIONSHIP_DEFAULTS={enabled:true,positiveStep:.1,negativeStep:.2,dailyLimit:1,minPositiveExchanges:3,minPositiveSpanHours:24,cooldownMinutes:30,friendliness:50,guardedness:50,trustOpenness:50,rejectionSensitivity:50};
function relationshipPolicy(raw={}){return {enabled:raw.enabled!==false,positiveStep:clamp(raw.positiveStep??.1,0,1),negativeStep:clamp(raw.negativeStep??.2,0,2),dailyLimit:clamp(raw.dailyLimit??1,0,5),minPositiveExchanges:Math.round(clamp(raw.minPositiveExchanges??3,1,20)),minPositiveSpanHours:clamp(raw.minPositiveSpanHours??24,0,168),cooldownMinutes:clamp(raw.cooldownMinutes??30,1,1440),friendliness:clamp(raw.friendliness??50,0,100),guardedness:clamp(raw.guardedness??50,0,100),trustOpenness:clamp(raw.trustOpenness??50,0,100),rejectionSensitivity:clamp(raw.rejectionSensitivity??50,0,100)};}
function relationshipEvidence(c,proposal,personaId,now){
 const r=ensure(c),cfg=r.relationshipPolicy,changes={};
 if(!cfg.enabled||!c.relationshipDynamics)return changes;
 const e=r.relationshipEvidence||{personaId,positiveExchanges:0,negativeExchanges:0,spent:{}};
 if(e.personaId!==personaId)return changes;
 r.relationshipEvidence=e;
 const positive=['support','enjoyment','relief'].includes(proposal.interpretation),negative=proposal.interpretation==='hostility';
 if(!positive&&!negative)return changes;
 const cooldown=cfg.cooldownMinutes*60000;
 const reserve=.5+cfg.guardedness/100,openness=cfg.trustOpenness/100;
 if(proposal.interpretation==='support'&&(e.lastSupportAt===undefined||now-e.lastSupportAt>=cooldown)){
  e.firstSupportAt??=now;e.lastSupportAt=now;e.supportiveExchanges=Math.min(100000,(e.supportiveExchanges||0)+1);
 }
 if(positive&&(e.lastPositiveAt===undefined||now-e.lastPositiveAt>=cooldown)){
  e.firstPositiveAt??=now;e.lastPositiveAt=now;e.positiveExchanges=Math.min(100000,e.positiveExchanges+1);
 }
 if(negative&&(e.lastNegativeAt===undefined||now-e.lastNegativeAt>=cooldown)){
  e.lastNegativeAt=now;e.negativeExchanges=Math.min(100000,e.negativeExchanges+1);
 }
 if(e.lastAppliedAt!==undefined&&now-e.lastAppliedAt<cooldown)return changes;
 if(positive&&(e.positiveExchanges<cfg.minPositiveExchanges||now-e.firstPositiveAt<cfg.minPositiveSpanHours*reserve*3600000))return changes;
 if(e.budgetWindowAt===undefined||now-e.budgetWindowAt>=86400000){e.budgetWindowAt=now;e.spent={};}
 const trustEligible=negative||(proposal.interpretation==='support'&&openness>0&&(e.supportiveExchanges||0)>=cfg.minPositiveExchanges&&now-e.firstSupportAt>=cfg.minPositiveSpanHours*(2-1.5*openness)*3600000);
 for(const field of ['warmth','comfort',...(negative?['resentment']:[]),...(trustEligible?['trust']:[])]){
  const before=c.relationshipDynamics[field]||0,min=['warmth','trust'].includes(field)?-100:0;
  const positiveScale=field==='trust'?openness*.5:field==='warmth'?.5+cfg.friendliness/100:1.5-cfg.guardedness/100;
  const signed=positive?cfg.positiveStep*positiveScale:(field==='resentment'?1:-1)*cfg.negativeStep*(.5+cfg.rejectionSensitivity/100);
  const budget=Math.max(0,cfg.dailyLimit-(e.spent[field]||0));
  const delta=clamp(signed*proposal.confidence,-budget,budget),after=clamp(before+delta,min,100);
  c.relationshipDynamics[field]=after;changes[field]=after-before;e.spent[field]=(e.spent[field]||0)+Math.abs(after-before);
 }
 if(Object.values(changes).some(Boolean)){e.lastAppliedAt=now;e.lastSourceMessageId=proposal.sourceMessageId;}
 return changes;
}
function events(c){return [...(c.lifeRuntime?.activities?.events||[]),...(c.lifeRuntime?.world?.events||[]),...(c.vh2Health?.events||[]),...(c.vh2Plans?.events||[]).filter(e=>(e.observerIds||e.participantIds||[]).includes(c.id)||e.departedPersonId===c.id)];}
function ensure(c){
 if(!c.vh2Psychology)c.vh2Psychology={version:1,policy:{...DEFAULTS},processed:events(c).map(e=>e.id),episodes:[],preferences:{}};
 const r=c.vh2Psychology;r.policy=policy(r.policy);r.relationshipPolicy=relationshipPolicy(r.relationshipPolicy);r.conversationPolicy=conversationPolicy(r.conversationPolicy||{enabled:r.policy.enabled});return r;
}
function key(goal){return goal.opportunityId?goal.opportunityId+'|'+(goal.definitionKey||''):'';}
function experienceScore(c,goal){
 const r=ensure(c),learned=r.preferences[key(goal)];
 if(!r.policy.enabled||!learned)return 0;
 return learned.mean*r.policy.experienceWeight*Math.min(1,learned.count/3);
}
function advance(c,now){
 const r=ensure(c),all=events(c),seen=new Set(r.processed),fresh=all.filter(e=>!seen.has(e.id));
 // Retain receipts for every event still available, preventing bounded buffers
 // from re-appraising an old event after a restart or long quiet interval.
 r.processed=all.map(e=>e.id);
 const oldOffset=r.affectOffset||0,elapsed=Math.max(0,now-(r.lastAffectAt??now));
 r.affectOffset=oldOffset*Math.pow(.5,elapsed/(r.policy.affectHalfLifeHours*3600000));r.lastAffectAt=now;
 if(c.mood)c.mood.valence=clamp((c.mood.valence||0)+r.affectOffset-oldOffset,-100,100);
 if(!r.policy.enabled)return [];
 const added=[];
 for(const e of fresh){
  if(!['completed','missed','outing_return','arrival','shared_plan','health_started','health_recovered'].includes(e.kind))continue;
  const goal=c.lifeRuntime.activities.goals.find(g=>g.id===e.goalId);
  let value=0,basis='Recorded experience; no emotional interpretation assigned.',emotionChanges={},appraisalFactors={};
  if(e.kind==='completed'&&goal){
   const effects=goal.steps.reduce((a,s)=>({energy:a.energy+(s.energy||0),stress:a.stress+(s.stress||0),hunger:a.hunger+(s.hunger||0)}),{energy:0,stress:0,hunger:0});
   value=clamp(.15+effects.energy/80-effects.stress/30-effects.hunger/150,-1,1);
   basis='Estimated appraisal of finishing this action and its authored physical effects; not an observed feeling.';
  }else if(e.kind==='missed'&&goal&&(goal.startedAt||goal.commitmentId)){
   value=goal?.commitmentId?-.7:-.25;
   basis='Estimated disappointment from a missed commitment or opportunity; not a judgment about another person.';
  }
  if(e.kind==='health_started'){value=-.25;basis='Discomfort from a recorded period of feeling unwell.';emotionChanges={sadness:1};}
  if(e.kind==='health_recovered'){value=.3;basis='Relief after recovery from recorded discomfort.';emotionChanges={joy:1};}
  if(e.kind==='shared_plan'){
   const sensitivity=r.relationshipPolicy.rejectionSensitivity/100,sociability=(c.vh2Agency?.policy?.sociability??50)/100;
   const phase=e.phase||e.id.split(':').at(-1),plan=c.vh2Plans?.plans.find(p=>p.id===e.planId);
   const agreed=!!plan&&['accepted','active','completed','missed'].includes(plan.status);
   appraisalFactors={goalRelevance:sociability,expectedParticipation:agreed,responsibility:'not_established',certainty:'recorded_participation_only'};
   if(phase==='completed'&&e.outcome==='shared_activity_completed'){
    value=.2+sociability*.3;emotionChanges={joy:value*2};basis='A personally relevant shared activity was completed; no attraction or trust is inferred.';
   }else if(phase==='missed'&&agreed){value=-(.1+sensitivity*.25);emotionChanges={sadness:-value*2};basis='An agreed shared activity did not happen as expected; another person’s intention remains unknown.';}
   else if(phase==='accepted'){emotionChanges={anticipation:.5+sociability};basis='Anticipation of an accepted plan, not evidence it happened.';}
   else if(phase==='departure'){basis='A participant left the plan; motive and blame are not inferred.';}
  }
  for(const [emotion,amount] of Object.entries(emotionChanges))if(c.emotionState?.felt)c.emotionState.felt[emotion]=clamp((c.emotionState.felt[emotion]||0)+amount*r.policy.emotionalImpact,0,100);
  const episode={id:e.id,at:e.at,summary:e.summary,kind:e.kind,goalId:e.goalId||null,
   placeId:goal?.requiredPlaceId||e.placeId||null,opportunityId:goal?.opportunityId||null,
   appraisal:{value,basis,emotionChanges,factors:appraisalFactors,truthScope:'simulation_inference'}};
  r.episodes.push(episode);added.push(episode);
  const k=goal&&key(goal);
  if(k&&value&&['completed','missed'].includes(e.kind)){
   const previous=r.preferences[k]||{mean:0,count:0};
   r.preferences[k]={mean:clamp(previous.mean+r.policy.learningRate*(value-previous.mean),-1,1),count:Math.min(10000,previous.count+1),lastAt:e.at,sourceId:e.id};
  }
  // Small bounded consequences, never relationship/attraction rewards for simply
  // completing an action. Shared physiology has already applied physical costs.
  if(value&&c.mood){const next=clamp(r.affectOffset+value*r.policy.emotionalImpact,-15,15);c.mood.valence=clamp((c.mood.valence||0)+next-r.affectOffset,-100,100);r.affectOffset=next;}
 }
 r.episodes=r.episodes.slice(-r.policy.memoryLimit);
 r.preferences=Object.fromEntries(Object.entries(r.preferences).sort((a,b)=>b[1].lastAt-a[1].lastAt||a[0].localeCompare(b[0])).slice(0,128));
 reflect(r,now);
 return added;
}
// Interpretations have bounded affect, never authority over relationships or facts.
function appraiseConversation(c,input,now){
 const r=ensure(c),accepted=[];
 const config=r.conversationPolicy;
 if(!config.enabled||!Array.isArray(input?.proposals))return accepted;
 const values={support:.6,enjoyment:.4,disappointment:-.5,hostility:-.7,curiosity:.15,concern:-.3,relief:.5,neutral:0};
 const vectors={support:{joy:1,fear:-1},enjoyment:{joy:2},disappointment:{sadness:2},hostility:{anger:2,fear:1},curiosity:{anticipation:2,surprise:.5},concern:{fear:1,sadness:.5},relief:{joy:1,fear:-2},neutral:{}};
 const emotionSpent={};
 const seen=new Set(r.socialProcessed||[]);
 for(const p of input.proposals.slice(0,3)){
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['sourceMessageId','evidence','interpretation','confidence'].includes(k)))continue;
  const m=(input.messages||[]).find(m=>m.id===p.sourceMessageId&&m.role==='user'&&m.readAt>0&&m.readAt<=now);
  if(!m||seen.has(m.id)||typeof p.evidence!=='string'||p.evidence.trim().length<3||p.evidence.length>500||!m.text.includes(p.evidence))continue;
  if(!Object.hasOwn(values,p.interpretation)||!Number.isFinite(p.confidence)||p.confidence<config.minConfidence||p.confidence>1)continue;
  seen.add(m.id);
  const value=values[p.interpretation]*p.confidence;
  const emotionChanges={};
  // Diminishing increases; an entire reply batch shares a per-emotion budget.
  // The shared emotion engine handles subsequent decay and expression masking.
  for(const [emotion,weight] of Object.entries(vectors[p.interpretation])){
   const previous=clamp(c.emotionState?.felt?.[emotion]||0,0,100);
   const remaining=Math.max(0,config.maxEmotionChange-(emotionSpent[emotion]||0));
   const delta=clamp(weight*p.confidence*config.emotionalImpact*(['hostility','disappointment','concern'].includes(p.interpretation)? .5+r.relationshipPolicy.rejectionSensitivity/100:1)*(weight>0?1-previous/100:1),-remaining,remaining);
   const next=clamp(previous+delta,0,100);
   if(c.emotionState?.felt){c.emotionState.felt[emotion]=next;emotionChanges[emotion]=next-previous;emotionSpent[emotion]=(emotionSpent[emotion]||0)+Math.abs(next-previous);}
  }
  const relationshipChanges=relationshipEvidence(c,p,input.personaId,now);
  const episode={id:'appraisal:'+m.id,at:now,kind:'conversation_appraisal',personaId:input.personaId,
   sourceMessageId:m.id,summary:`Interpreted player message as ${p.interpretation}: ${p.evidence}`,
   appraisal:{value,emotionChanges,relationshipChanges,evidence:p.evidence,confidence:p.confidence,truthScope:'model_interpretation',basis:'Unverified interpretation of a read message; fallible interpersonal impressions, not verified reliability, shared history or attraction.'}};
  r.episodes.push(episode);accepted.push(episode);
  const previous=r.affectOffset||0,next=clamp(previous+value*config.emotionalImpact,-15,15);
  c.mood.valence=clamp((c.mood.valence||0)+next-previous,-100,100);r.affectOffset=next;r.lastAffectAt=now;
 }
 r.socialProcessed=[...seen];r.episodes=r.episodes.slice(-r.policy.memoryLimit);
 return accepted;
}

// Shared, evidence-linked reflection for every simulated participant.
function reflect(r,now){
 const cfg=policy(r.policy);r.policy=cfg;if(!cfg.enabled)return;
 const groups=new Map();
 for(const e of r.episodes||[]){
  if(!e.placeId||!Number.isFinite(e.appraisal?.value)||e.at>now)continue;
  const group=groups.get(e.placeId)||[];group.push(e);groups.set(e.placeId,group);
 }
 r.reflections=[...groups].map(([placeId,events])=>{
  const recent=events.sort((a,b)=>b.at-a.at).slice(0,12);let weight=0,value=0;
  for(const e of recent){const w=Math.pow(.5,(now-e.at)/(7*86400000));weight+=w;value+=e.appraisal.value*w;}
  return {id:'place:'+placeId,placeId,at:now,sourceIds:recent.map(e=>e.id),count:recent.length,value:weight?value/weight:0,
   confidence:Math.min(.85,recent.length/6),truthScope:'simulation_inference',
   summary:'A tentative preference inferred from recorded outcomes at this place; not a verified fact about the place or other people.'};
 }).filter(r=>r.count>=2).sort((a,b)=>b.count-a.count||a.placeId.localeCompare(b.placeId)).slice(0,48);
}
function reflectionScore(r,placeId){const item=r?.reflections?.find(x=>x.placeId===placeId);return r?.policy?.enabled===false||!item?0:item.value*item.confidence*12;}
function rememberParticipant(a,event,before,now){
 const r=a.psychology||={policy:{...DEFAULTS},episodes:[],reflections:[]};
 if(r.episodes.some(e=>e.id===event.id))return;
 const value=clamp(((a.energy-before.energy)-(a.stress-before.stress)-(a.hunger-before.hunger))/60,-1,1);
 r.episodes.push({id:event.id,at:now,kind:event.kind,placeId:event.placeId,summary:event.action+' '+(event.kind==='person_action_completed'?'completed':'interrupted'),
  appraisal:{value,basis:'Recorded change in this participant’s needs during the action.',truthScope:'simulation_inference'}});
 r.episodes=r.episodes.slice(-policy(r.policy).memoryLimit);reflect(r,now);
}

module.exports={reflect,reflectionScore,rememberParticipant,ensure,advance,experienceScore,policy,DEFAULTS,conversationPolicy,CONVERSATION_DEFAULTS,relationshipPolicy,RELATIONSHIP_DEFAULTS,appraiseConversation};
