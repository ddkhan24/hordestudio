/* Opt-in VH2 text timelines in the existing Horde UI. The service owns reality;
 * browser state is a recoverable projection plus a durable command outbox. */
'use strict';
const vh2PollLocks=new Map(),vh2ProviderSignatures=new Map(),vh2BibleGenerationLocks=new Set();
function vh2ConversationQuery(timeline){const id=timeline?.vh2?.conversationPersonaId||timeline?.vh2?.canonicalPersonaId;return id?'&personaId='+encodeURIComponent(id):'';}
const vh2ConversationOpenLocks=new Set();
async function vh2OpenPersonaConversation(companion,personaId){
 const persona=state.personas.find(p=>p.id===personaId);if(!persona)throw Error('Choose a saved persona.');
 if(vh2ConversationOpenLocks.has(companion.id))throw Error('A conversation is already opening.');
 vh2ConversationOpenLocks.add(companion.id);
 try{
  const store=ensureCompanionTimelineStore(companion.id),current=getActiveCompanionTimeline(companion.id);
  const life=current?.vh2?.worldId?current:store.sessions.find(t=>t.vh2?.worldId);
  if(!life)throw Error('Start this character’s life before opening another conversation.');
  if(current!==life)activateCompanionTimeline(companion.id,life.id);
  const receipt=await vhUiCommand(life,'open_conversation',{personaId,profile:{templateId:persona.id,name:persona.name||'',text:persona.text||''}});
  const id=receipt.conversationPersonaId;
  let chat=store.sessions.find(t=>t.vh2?.worldId===life.vh2.worldId&&((t.vh2.conversationPersonaId||t.vh2.canonicalPersonaId)===id||t.personaId===personaId));
  if(chat?.vh2.conversationDeleted){chat.vh2.conversationDeleted=false;chat.name=persona.name||'Conversation';chat.messages=[];}
  if(!chat){
   chat=normalizeCompanionTimeline({id:'vh_chat_'+crypto.randomUUID(),name:persona.name||'Conversation',personaId,personaPinned:true,messages:[],runtime:captureCompanionRuntime(companion),vh2:{worldId:life.vh2.worldId,conversationPersonaId:id,outbox:[],error:'',running:life.vh2.running}},companion);
   store.sessions.push(chat);await saveState();
  }
  await vh2Poll(companion,chat,{force:true,throwOnError:true});
  store.sessions=store.sessions.filter(t=>t===chat||!t.vh2?.conversationDeleted);activateCompanionTimeline(companion.id,chat.id);await saveState();renderCompanionThread();return chat;
 }finally{vh2ConversationOpenLocks.delete(companion.id);}
}
function vh2NewConversationDialog(companion){
 const dialog=document.createElement('dialog');dialog.className='vh-review-dialog vh-conversation-picker';dialog.setAttribute('aria-label','New conversation');
 dialog.innerHTML='<header><h2>Chat as someone else</h2><button type="button" data-close aria-label="Close">×</button></header><p>One continuous life. Each persona has their own conversation and relationship.</p><div data-personas></div><p role="status" aria-live="polite"></p>';
 const list=dialog.querySelector('[data-personas]'),store=ensureCompanionTimelineStore(companion.id),current=getActiveCompanionTimeline(companion.id);
 for(const persona of state.personas){
  const known=store.sessions.find(t=>!t.vh2?.conversationDeleted&&t.vh2?.worldId===current?.vh2?.worldId&&(t.personaId===persona.id||t.vh2?.playerProfile?.templateId===persona.id));
  const button=document.createElement('button');button.type='button';button.className='vh-conversation-option';
  button.textContent=(persona.name||'Unnamed persona')+' · '+(known===current?'Current chat':known?'Open existing chat':'Start chat');
  button.onclick=async()=>{dialog.querySelectorAll('[data-personas] button').forEach(b=>b.disabled=true);dialog.querySelector('[role=status]').textContent='Opening conversation…';try{await vh2OpenPersonaConversation(companion,persona.id);dialog.close();dialog.remove();}catch(error){dialog.querySelector('[role=status]').textContent=error.message;dialog.querySelectorAll('[data-personas] button').forEach(b=>b.disabled=false);}};list.append(button);
 }
 if(!state.personas.length){const p=document.createElement('p');p.textContent='Create a persona first, then choose it here.';list.append(p);}
 const manage=document.createElement('button');manage.type='button';manage.className='btn btn-ghost';manage.textContent='Manage personas';manage.onclick=()=>{dialog.close();dialog.remove();switchView('personas');};list.append(manage);
 dialog.querySelector('[data-close]').onclick=()=>{dialog.close();dialog.remove();};dialog.addEventListener('cancel',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
function vh2ConversationActionDialog(companion,action){
 const timeline=getActiveCompanionTimeline(companion.id);if(!timeline?.vh2)return;
 const labels={rename:'Rename chat',clear:'Clear messages',reset:'Reset chat & relationship',delete:'Delete chat'};
 const copy={rename:'Choose a name for this conversation.',clear:'Clear this chat’s messages. Relationship memories and their ongoing life are kept.',reset:'Clear this chat and reset its learned relationship to the authored starting connection. Their ongoing life, public feed and other chats are kept.',delete:'Delete this chat and its messages. Their ongoing life and relationship memories are kept. You can start a new chat with this persona later.'};
 closeCompanionThreadMenu();const dialog=document.createElement('dialog');dialog.className='vh-review-dialog vh-conversation-picker';dialog.setAttribute('aria-label',labels[action]);
 dialog.innerHTML='<form><header><h2></h2><button type="button" data-cancel aria-label="Close">×</button></header><p data-copy></p><label data-name-label>Chat name<input class="form-input" name="chatName" maxlength="100" required></label><p role="status" aria-live="polite"></p><div class="vh-chat-action-buttons"><button type="button" class="btn btn-ghost" data-cancel>Cancel</button><button type="submit" class="btn btn-primary"></button></div></form>';
 dialog.querySelector('h2').textContent=labels[action];dialog.querySelector('[data-copy]').textContent=copy[action];dialog.querySelector('[type=submit]').textContent=labels[action];
 const input=dialog.querySelector('input');input.value=timeline.name;input.disabled=action!=='rename';dialog.querySelector('[data-name-label]').hidden=action!=='rename';
 for(const button of dialog.querySelectorAll('[data-cancel]'))button.onclick=()=>{dialog.close();dialog.remove();};
 dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const submit=dialog.querySelector('[type=submit]'),status=dialog.querySelector('[role=status]');submit.disabled=true;status.textContent='Saving…';
  try{await vhUiCommand(timeline,'manage_conversation',{action,...(action==='rename'?{name:input.value.trim()}:{})});
   if(action==='delete'){
    const store=ensureCompanionTimelineStore(companion.id),next=store.sessions.find(t=>t!==timeline&&!t.vh2?.conversationDeleted);
    if(next){store.sessions=store.sessions.filter(t=>t!==timeline);activateCompanionTimeline(companion.id,next.id);await vh2Poll(companion,next,{force:true,throwOnError:true});}
    else timeline.name='Choose a persona';
   }
   await saveState();renderCompanionThread();dialog.close();dialog.remove();showToast(action==='rename'?'Chat renamed.':action==='clear'?'Messages cleared.':action==='reset'?'Chat and relationship reset.':'Chat deleted.','success');
  }catch(error){status.textContent=error.message;submit.disabled=false;}
 };
 dialog.addEventListener('cancel',()=>dialog.remove());document.body.append(dialog);dialog.showModal();if(action==='rename'){input.focus();input.select();}
}
function vh2Linked(companion){return companion&&getActiveCompanionTimeline(companion.id)?.vh2;}
function vh2TextOnly(companion){if(!vh2Linked(companion))return false;showToast('This action is not connected to VH2 yet. Photos and simulated posts are available in the VH2 controls; calls are not available in VH2 yet.','info');return true;}
async function vh2SyncProvider(companion){
    const provider=companionTextProviderId(companion);
    if(!['openrouter','gptproto','nanogpt','nvidia','local'].includes(provider)){
        await mcpBridgeRequest('/vh2/dialogue-provider',{method:'POST',body:{disableScope:'horde:'+companion.id}});
        vh2ProviderSignatures.delete(companion.id);
        throw Error('This VH2 text preview needs a supported chat-completions provider. Its previous provider binding has been disabled.');
    }
    const headers=providerAuthHeaders(provider),key=(headers.Authorization||'').replace(/^Bearer\s+/i,'');
    const config={scope:'horde:'+companion.id,baseUrl:providerApiBase(provider),model:companion.model||state.globalSettings.defaultModel,
        apiKey:key,clearKey:true,enabled:providerHasCredentials(provider),maxTokens:Math.min(4096,companionProviderOutputBudget(companion)),
        temperature:Math.max(0,Math.min(2,Number(companion.temperature??.8))),dailyLimit:state.globalSettings.companionAlwaysOnDailyLimit||6};
    const signature=JSON.stringify(config);
    if(vh2ProviderSignatures.get(companion.id)!==signature){
        await mcpBridgeRequest('/vh2/dialogue-provider',{method:'POST',body:config});
        vh2ProviderSignatures.set(companion.id,signature);
    }
    if(!config.enabled)throw Error('Configure this character’s provider in Settings before enabling automatic replies.');
}
const vh2EnqueueLocks=new Map();
async function vh2Enqueue(timeline,type,extra={}){
    const previous=vh2EnqueueLocks.get(timeline.id)||Promise.resolve();
    const current=previous.catch(()=>{}).then(()=>vh2EnqueueOwned(timeline,type,extra));
    vh2EnqueueLocks.set(timeline.id,current);
    try{return await current;}finally{if(vh2EnqueueLocks.get(timeline.id)===current)vh2EnqueueLocks.delete(timeline.id);}
}
async function vh2EnqueueOwned(timeline,type,extra={}){
    timeline.vh2.outbox ||= [];
    const key=crypto.randomUUID();
    if(typeof vhTrackUiCommand==='function')vhTrackUiCommand(key);
    const conversationPersonaId=timeline.vh2.conversationPersonaId||timeline.vh2.canonicalPersonaId;
    timeline.vh2.outbox.push({schemaVersion:1,key,type,...(conversationPersonaId?{conversationPersonaId}:{}),...extra});
    if(type==='receive_message')timeline.messages.push(normalizeCompanionMessage({id:'vh2-pending:'+key,role:'user',type:'text',text:extra.text,timestamp:Date.now(),deliveryState:'sent',awaitingReply:true}));
    try{await saveState();}catch(error){
        // A command whose durable enqueue failed must not be sent by a later poll.
        timeline.vh2.outbox=timeline.vh2.outbox.filter(command=>command.key!==key);
        if(type==='receive_message')timeline.messages=timeline.messages.filter(message=>message.id!=='vh2-pending:'+key);
        throw error;
    }
    return key;
}
const vh2FlushLocks=new Map();
async function vh2Flush(timeline){
    const previous=vh2FlushLocks.get(timeline.id)||Promise.resolve();
    const current=previous.catch(()=>{}).then(()=>vh2FlushOwned(timeline));vh2FlushLocks.set(timeline.id,current);
    try{return await current;}finally{if(vh2FlushLocks.get(timeline.id)===current)vh2FlushLocks.delete(timeline.id);}
}
async function vh2FlushOwned(timeline){
    const link=timeline.vh2;
    for(let attempt=0;link.outbox?.length&&attempt<8;attempt++){
        // Never submit a command until its enqueue transaction has completed.
        await vh2EnqueueLocks.get(timeline.id)?.catch(()=>{});
        const body=link.outbox[0];if(!body)break;
        if(body.type!=='create_profile'&&body.expectedRevision===undefined){
            const p=await mcpBridgeRequest('/vh2/projection?worldId='+encodeURIComponent(link.worldId));
            body.worldId=link.worldId;body.expectedRevision=p.revision;await saveState();
        }
        try{
            const receipt=await mcpBridgeRequest('/vh2/command',{method:'POST',body,timeoutMs:30000});
            if(typeof vhUiAcknowledged==='function')vhUiAcknowledged(body.key,receipt);
            link.worldId=receipt.worldId;if(receipt.photoId)link.lastPhotoId=receipt.photoId;if(receipt.checkpointId)link.checkpointId=receipt.checkpointId;link.outbox.shift();await saveState();
        }catch(error){
            // A received 409 proves this request did not commit. Network failures
            // retain the exact body/key, so the service can return its receipt.
            if(error.status===409&&error.message.startsWith('World changed;')){delete body.expectedRevision;const priorKey=body.key;body.key=crypto.randomUUID();const pendingMessage=timeline.messages.find(m=>m.id==='vh2-pending:'+priorKey);if(pendingMessage)pendingMessage.id='vh2-pending:'+body.key;if(typeof vhUiRetried==='function')vhUiRetried(priorKey,body.key);await saveState();continue;}
            if(error.status===409&&error.message==='World requires a kernel migration'&&body.type!=='upgrade_kernel'){
                // The rejected command did not commit. Upgrade through the canonical
                // checkpointed path, then retry it at the new revision.
                delete body.expectedRevision;
                const priorKey=body.key;body.key=crypto.randomUUID();const pendingMessage=timeline.messages.find(m=>m.id==='vh2-pending:'+priorKey);if(pendingMessage)pendingMessage.id='vh2-pending:'+body.key;
                if(typeof vhUiRetried==='function')vhUiRetried(priorKey,body.key);
                link.outbox.unshift({schemaVersion:1,key:crypto.randomUUID(),type:'upgrade_kernel'});
                link.error='Updating the timeline engine and creating a backup before saving…';
                await saveState();continue;
            }
            if(typeof vhUiFailed==='function')vhUiFailed(body.key,error);
            // Terminal validation/conflict responses cannot succeed by replaying the
            // unchanged request. Preserve network/5xx uncertainty for idempotent retry.
            if([400,409].includes(error.status)&&!error.message.includes('kernel migration')){
                link.failedCommands=[...(link.failedCommands||[]),{type:body.type,key:body.key,message:error.message,at:Date.now()}].slice(-20);
                if(body.type==='receive_message'){const pending=timeline.messages.find(m=>m.id==='vh2-pending:'+body.key);if(pending){pending.deliveryState='failed';pending.awaitingReply=false;}}
                link.outbox.shift();await saveState();
            }
            throw error;
        }
    }
}
async function vh2Poll(companion,timeline=getActiveCompanionTimeline(companion.id),options={}){
    if(!timeline?.vh2||timeline.vh2.importPending)return;
    const prior=vh2PollLocks.get(timeline.id);
    if(prior){
        await prior;
        if(!options.force&&!timeline.vh2.outbox?.length)return;
        return vh2Poll(companion,timeline,options);
    }
    const pending=Promise.resolve().then(()=>vh2PollOwned(companion,timeline,options));
    vh2PollLocks.set(timeline.id,pending);
    try{return await pending;}finally{if(vh2PollLocks.get(timeline.id)===pending)vh2PollLocks.delete(timeline.id);}
}
function vh2ProviderRead(result,previous){
 return result.status==='fulfilled'?{...result.value,stale:false}:{...(previous||{}),stale:true,error:String(result.reason?.message||'Settings unavailable')};
}
function vh2ImageStudioFingerprint(companion){
 const fields={source:companion.imageSource||'provider',model:companion.imageModel||'',tool:companion.mcpImageTool||'',arguments:companion.mcpImageArguments||{},parameters:companion.imageParameters||{},options:companion.imageProviderOptions||{},endpoint:companion.imageProviderTag||''};
 const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
 return JSON.stringify(sorted(fields));
}
function vh2ImageConfiguration(companion,saved={}){
 const provider=companion.imageSource==='provider'||!companion.imageSource?companionImageProviderId(companion):companion.imageSource;
 if(!['openrouter','gemini','magnific','higgsfield'].includes(provider))throw Error(provider+' does not support background image jobs yet. No fallback provider was selected.');
 const mcp=['magnific','higgsfield'].includes(provider);
 if(mcp&&!companion.mcpImageTool)throw Error('Select an image generation tool for '+provider+' in Photos & Voice.');
 const model=companion.imageModel||(mcp?'provider default':saved.provider===provider?saved.model:'');
 if(!model)throw Error('Select an image model for '+provider+'.');
 const apiKey=provider==='openrouter'?(providerAuthHeaders(provider).Authorization||'').replace(/^Bearer\s+/i,''):'';
 return {scope:'horde:'+companion.id,provider,enabled:saved.enabled===true,tool:mcp?companion.mcpImageTool:'',arguments:mcp?safeJsonClone(companion.mcpImageArguments||{}):{},model,dailyLimit:saved.dailyLimit||4,maxReferences:saved.maxReferences||10,apiKey,imageParameters:provider==='openrouter'?safeJsonClone(companion.imageParameters||{}):{},imageProviderOptions:provider==='openrouter'?safeJsonClone(companion.imageProviderOptions||{}):{},imageProviderTag:provider==='openrouter'?companion.imageProviderTag||'':'',imageProviderSlug:provider==='openrouter'?saved.imageProviderSlug||'':''};
}
function vh2SupportsDurableImages(companion,timeline=getActiveCompanionTimeline(companion.id)){
 const provider=timeline?.vh2?.imageProvider?.provider||((companion.imageSource==='provider'||!companion.imageSource)?companionImageProviderId(companion):companion.imageSource);
 return ['openrouter','gemini','magnific','higgsfield'].includes(provider);
}
async function vh2SyncImageConfiguration(companion,timeline,options={}){
 // The active-life renderer owns queued jobs. A stale Studio draft cannot replace it on retry.
 const saved=timeline.vh2.imageProvider||{};
 if(saved.configured&&!options.fromStudio)return saved;
 const config=vh2ImageConfiguration(companion,saved);
 if(config.provider==='openrouter'&&Object.keys(config.imageProviderOptions).length){const endpoints=await getCompanionImageEndpoints(config.model,false,'openrouter'),endpoint=chooseCompanionImageEndpoint(endpoints,companion,true);config.imageProviderSlug=endpoint?.providerSlug||'';}
 return vh2SaveImageProvider(companion,timeline,config);
}
async function vh2SaveImageProvider(companion,timeline,body){
 const receipt=await mcpBridgeRequest('/vh2/image-provider',{method:'POST',body});
 timeline.vh2.imageProviderSaveEpoch=(timeline.vh2.imageProviderSaveEpoch||0)+1;
 timeline.vh2.imageProvider={...receipt,stale:false};
 // Keep Studio and the autonomous worker on the acknowledged configuration.
 if(receipt.provider!=='gemini'){companion.imageSource=receipt.provider;companion.imageModel=receipt.model==='provider default'?'':receipt.model;companion.mcpImageTool=receipt.tool||'';companion.mcpImageArguments=safeJsonClone(receipt.arguments||{});}
 timeline.vh2.imageStudioFingerprint=vh2ImageStudioFingerprint(companion);
 await saveState();
 // Wait for any earlier poll, then force a fresh read after the save.
 await vh2Poll(companion,timeline,{force:true});
 return receipt;
}
async function vh2PollOwned(companion,timeline,options={}){
    let changed=false;
    try{
        let providerError='';
        try{await vh2SyncProvider(companion);}catch(error){providerError=error.message;}
        await vh2Flush(timeline);
        const link=timeline.vh2;
        if(!link.worldId)return;
        const projection=await mcpBridgeRequest('/vh2/projection?worldId='+encodeURIComponent(link.worldId)+vh2ConversationQuery(timeline));
        link.conversations=projection.conversations||[];
        link.conversationPersonaId=projection.state.communication.personaId;
        if(projection.worldId&&projection.worldId!==link.worldId){link.worldId=projection.worldId;link.revision=projection.revision;changed=true;}
        const imageReadEpoch=link.imageProviderSaveEpoch||0;
        const optional=await Promise.allSettled([mcpBridgeRequest('/vh2/provider-jobs?worldId='+encodeURIComponent(link.worldId)),mcpBridgeRequest('/vh2/image-provider?scope='+encodeURIComponent('horde:'+companion.id)),mcpBridgeRequest('/vh2/flight-provider?scope='+encodeURIComponent('horde:'+companion.id))]);
        const workerStatus=optional[0].status==='fulfilled'?optional[0].value:{jobs:link.providerJobs||[]};
        const imageProvider=imageReadEpoch!==(link.imageProviderSaveEpoch||0)?link.imageProvider:vh2ProviderRead(optional[1],link.imageProvider);
        const flightProvider=vh2ProviderRead(optional[2],link.flightProvider);
        link.optionalProviderErrors=optional.map((result,index)=>result.status==='rejected'?{capability:['Background jobs','Background images','Flights'][index],message:String(result.reason?.message||'Unavailable')}:null).filter(Boolean);
        const workerSignature=JSON.stringify([workerStatus,imageProvider,flightProvider]);
        link.lastSyncedAt=Date.now();link.imageStudioFingerprint??=vh2ImageStudioFingerprint(companion);
        const s=projection.state,c=s.truth.companion;link.runtimeReboot=s.runtimeReboot||null;link.currentAge=companionCurrentAge(c);link.calendarAges=c.vh2Calendar?.ages||{};
        link.clips=s.clips||[];link.conversationDeleted=!!s.communication.deletedAt;
        if(s.communication.name)timeline.name=s.communication.name;
        if(link.conversationGeneration!==(s.communication.generation||0)){
            if((s.communication.generation||0)>0)timeline.messages=[];
            link.conversationGeneration=s.communication.generation||0;link.transcriptBefore=undefined;
        }
        link.contactRelationship={role:c.connectionType||'stranger',context:c.relationshipContext||'',knownBeforeDays:c.knownBeforeDays||0};
        if(link.revision===projection.revision&&link.error===providerError&&link.requiresMigration===!!projection.requiresMigration&&link.workerSignature===workerSignature)return;
        link.workerSignature=workerSignature;link.providerJobs=workerStatus.jobs;link.imageProvider=imageProvider;link.flightProvider=flightProvider;link.imageStudioFingerprint??=vh2ImageStudioFingerprint(companion);
        if(s.clips){const local=new Map();for(const t of state.companionTimelines?.[companion.id]?.sessions||[])for(const j of t.runtime?.videoJobs||[])if(j.status==='ready'&&(j.assetId||j.outputUrl||j.bundledSrc)&&!j.deletedAt)local.set(j.id,j);for(const j of companion.videoJobs||[])if(!local.has(j.id)||j.deletedAt||j.status==='ready')local.set(j.id,j);for(const j of s.clips){const prior=local.get(j.id)||companion.startingVideoClips?.find(seed=>seed.id===j.id);local.set(j.id,normalizeCompanionVideoJob({...prior,...j,...(!j.deletedAt&&['draft','ready'].includes(j.status)&&prior?.status==='ready'?{status:'ready',assetId:prior.assetId,outputUrl:prior.outputUrl,bundledSrc:prior.bundledSrc}:{})}));}companion.videoJobs=[...local.values()];}
        changed=true;link.requiresMigration=!!projection.requiresMigration;link.psychology=s.truth.companion.vh2Psychology?.policy;link.conversationAppraisal=c.vh2Psychology?.conversationPolicy;link.relationshipLearning=c.vh2Psychology?.relationshipPolicy;link.checkIns=c.vh2Psychology?.checkIns||[];link.photos=s.photos||[];link.socialPosts=s.social?.posts||[];link.socialSettings={enabled:c.socialFeedEnabled,frequency:c.socialPostFrequency,audience:c.socialAudience};link.clipSettings={enabled:c.allowVideoClips};link.error=providerError;link.revision=projection.revision;link.running=s.running;link.autoReplies=!!s.integration?.autoReplies;
        link.institutions=c.vh2Institutions;link.schedule=c.lifeProfile.weeklySchedule;link.exploration=c.vh2Exploration;link.signals=c.vh2Signals;link.bible=c.vh2Assets;link.entityId=c.id;
        link.referencePlan=c.vh2ReferencePlan||[];link.executableSetup={institutions:safeJsonClone(c.vh2Institutions?.rules||[]),routes:(c.lifeProfile.travelLegs||[]).filter(r=>!r.geometry).slice(0,100).map(r=>({from:r.from,to:r.to,mode:r.mode,minutes:r.minutes,cost:r.cost||0})),finance:{...c.vh2Finance?.policy,currency:c.vh2Gifts?.currency||'USD'},exploration:c.vh2Exploration?.policy,sleepPolicy:c.lifeProfile.sleepPolicy,breakPolicy:c.lifeProfile.breakPolicy,peopleLives:Object.values(c.vh2People?.actors||{}).map(a=>({personId:a.id,policy:a.policy,commitments:(c.lifeProfile.world.people||[]).filter(p=>p.personId===a.id).map((p,i)=>({...VHWorldEngine.calendarFields(p),id:p.id||('commitment_'+a.id+'_'+i),placeId:p.placeId,days:p.days,start:p.start,end:p.end,activity:p.activity||'Commitment',flexibility:p.flexibility||'hard'}))})),rooms:(c.vh2Visual?.zones||[]).map(z=>({id:z.id,placeId:z.placeId,label:z.label,description:z.description})),referencePlan:c.vh2ReferencePlan||[]};Object.assign(link.executableSetup,{...(c.personalPreferences?{personalPreferences:Object.fromEntries(['interests','aversions','boundaries','affectionStyle','contextNotes','openness','privacyPreference','initiative','restraint'].map(k=>[k,c.personalPreferences[k]]))}:{}),possessions:(c.lifeProfile.world.items||[]).filter(i=>i.owned!==false&&['object','food','top','bottom','dress','outerwear','underwear','shoes','accessory'].includes(i.category)).map(i=>({...Object.fromEntries(['id','name','category','tags'].filter(k=>i[k]!==undefined).map(k=>[k,safeJsonClone(i[k])])),description:i.referenceDescription||i.description||i.name})),expression:typeof vhExpressionFields==='function'?vhExpressionFields(c):{},autonomy:{enabled:!!c.vh2Geography?.enabled,spontaneousExpression:!!c.vh2Agency?.policy?.enabled,socialPosting:c.socialFeedEnabled===true,liveWeather:c.lifeWeatherEnabled===true},socialPolicy:{...c.vh2SocialSetup,encountersEnabled:!!c.vh2People?.network?.enabled,groupPlansEnabled:!!c.vh2People?.network?.policy?.groupPlansEnabled,introductionsEnabled:!!c.vh2Population?.enabled,dispositions:safeJsonClone(c.vh2People?.network?.dispositions||{})},geography:{enabled:!!c.vh2Geography?.enabled,maxTravelMinutes:c.vh2Geography?.maxTravelMinutes||60,places:Object.entries(c.vh2Geography?.places||{}).filter(([placeId])=>c.lifeProfile.places.some(p=>p.id===placeId)).map(([placeId,p])=>({placeId,...safeJsonClone(p)}))},population:{enabled:!!c.vh2Population?.enabled,openness:c.vh2Population?.openness??50,residents:(c.vh2Population?.residents||[]).map(r=>Object.fromEntries(['id','name','sharedDescription','placeId','days','start','end','openness','homePlaceId','initialPlaceId','age','personality'].filter(k=>r[k]!==undefined).map(k=>[k,safeJsonClone(r[k])]))),...(c.vh2Population?.fictional?{fictional:safeJsonClone(c.vh2Population.fictional)}:{})},socialPlanPolicy:safeJsonClone(c.vh2Plans?.policy||{}),socialPrivateVisitPermissions:safeJsonClone(c.vh2Plans?.privateVisitPermissions||[]),storyPolicy:safeJsonClone(c.vh2Story?.policy||{intensity:0,social:50,novelty:50,complications:20,recoveryHours:18}),healthPolicy:safeJsonClone(c.vh2Health?.policy||{}),psychologyPolicy:safeJsonClone(c.vh2Psychology?.policy||{}),relationshipPolicy:safeJsonClone(c.vh2Psychology?.relationshipPolicy||{})});link.story=c.vh2Story;link.health=c.vh2Health;link.socialPlanPolicy=c.vh2Plans?.policy;link.setupVersion=c.vh2SetupVersion||0;link.setupProfile=c.lifeProfile;link.routeLegs=c.lifeProfile.travelLegs||[];link.currentOutfit=c.lifeRuntime.world.outfit;link.journey=c.lifeRuntime.world.journey;link.commerce=c.vh2Commerce;link.legacyPresets=c.lifeProfile.wardrobe;link.visual=c.vh2Visual;link.geography=c.vh2Geography;link.legacyHistory=s.legacyHistory?{digest:s.legacyHistory.digest,sessionId:s.legacyHistory.sessionId,sourceName:s.legacyHistory.sourceName,count:s.legacyHistory.messages.length}:null;link.canonicalPersonaId=s.communication.personaId;link.personalPreferences=c.personalPreferences||{};link.playerProfile=s.communication.playerProfile||null;link.episodes=c.vh2Episodes;link.transportServices=c.vh2Transport?.services||[];link.finance=c.vh2Finance;link.closet=c.vh2Closet;link.travel=c.vh2Travel;link.travelPlaces=c.lifeProfile.places;
        link.gifts={trust:c.relationshipDynamics?.trust??c.mood?.relationship??0,balance:c.lifeRuntime.world.balance,policy:c.lifeProfile.world.gifts,currency:c.vh2Gifts?.currency||"USD",items:c.lifeProfile.world.items,records:c.lifeRuntime.world.gifts,inventory:c.lifeRuntime.world.inventory,cashConsent:c.lifeRuntime.world.cashConsent,mailConsent:c.lifeRuntime.world.mailConsent,playerBalance:c.lifeRuntime.world.playerBalance};link.socialBonds=c.vh2SocialBonds;link.people=c.vh2People;link.population=c.vh2Population;link.knownPeople=c.lifeProfile.socialCircle;link.npcTravel=c.vh2NpcTravel;link.worldData=s.worldData||{};link.agencyPaused=!!c.vh2AutonomyPaused;link.agency=c.vh2Agency;link.plans=c.vh2Plans?.plans||[];link.presence=c.vh2Presence;link.present=s.truth.present;link.simAt=s.simAt;link.replyJob=s.communication.replyJob||null;link.call=s.communication.call||null;link.callMessages=s.communication.messages.filter(m=>m.channel==='call');
        timeline.runtime=captureCompanionRuntime(c);
        // Clip jobs belong to the service state, outside truth.companion.
        // Do not let the legacy runtime restore erase the just-loaded queue.
        if(s.clips)timeline.runtime.videoJobs=companion.videoJobs;
        const pendingIds=new Set((link.outbox||[]).filter(command=>command.type==='receive_message').map(command=>'vh2-pending:'+command.key));
        const hiddenClipIds=new Set(s.hiddenClipMessageIds||[]);
        const retained=new Map(timeline.messages.filter(m=>!hiddenClipIds.has(m.id)&&(!m.id.startsWith('vh2-pending:')||pendingIds.has(m.id)||m.deliveryState==='failed')).map(m=>[m.id,m]));
        const latest=s.communication.messages.map(m=>({...normalizeCompanionMessage({...m,photo:m.assetId&&m.type==='photo'?vh2PhotoAssetUrl(link.worldId,m.assetId):m.photo,audio:m.assetId&&m.type==='voice'?vh2PhotoAssetUrl(link.worldId,m.assetId):m.audio,role:m.role==='assistant'?'companion':m.role,
            deliveryState:m.role==='assistant'?'delivered':m.readAt?'read':'delivered'}),text:m.text}));
        for(const m of latest)retained.set(m.id,m);
        timeline.messages=[...retained.values()].sort((a,b)=>a.timestamp-b.timestamp);
        if(getActiveCompanionTimeline(companion.id)===timeline){
            applyCompanionRuntime(companion,timeline.runtime);state.companionThreads[companion.id]=timeline.messages;
        }
        await saveState();
    }catch(error){if(timeline.vh2.error!==error.message){changed=true;timeline.vh2.error=error.message;await saveState();}if(options.throwOnError)throw error;}
    finally{if(changed&&state.activeCompanionId===companion.id&&getActiveCompanionTimeline(companion.id)===timeline&&state.view==='companionChat')renderCompanionThread();if(changed&&state.activeCompanionId===companion.id&&getActiveCompanionTimeline(companion.id)===timeline&&state.view==='vhWorkspace'&&typeof vhRenderWorkspace==='function')vhRenderWorkspace();}
}
async function vh2CreateTimeline(companion){
    if(!companion||companionTimelineBusy(companion))return;
    const existing=ensureCompanionTimelineStore(companion.id).sessions.find(t=>t.vh2?.worldId);
    if(existing){activateCompanionTimeline(companion.id,existing.id);await vh2Poll(companion,existing,{force:true,throwOnError:true});if(existing.vh2.starterProfilePending)await vh2ImportStarterProfile(companion);return existing;}
    await vh2SyncProvider(companion);
    const old=getActiveCompanionTimeline(companion.id),personaId=old.personaId||('player:'+companion.id);
    const timeline=old&&!old.vh2&&!old.messages.length?old:createCompanionTimeline(companion,{name:'Conversation'});
    if(timeline===old){timeline.runtime=freshCompanionRuntime(companion);applyCompanionRuntime(companion,timeline.runtime);}
    timeline.name=state.personas.find(p=>p.id===old.personaId)?.name||'Conversation';
    timeline.personaId=old.personaId;timeline.profileOverrides=safeJsonClone(old.profileOverrides);
    timeline.vh2={worldId:'',outbox:[],error:'',running:false,starterProfilePending:true};
    const profile={lifeProfile:safeJsonClone(companion.lifeProfile)};
    for(const place of profile.lifeProfile.places||[])delete place.photo;
    for(const item of profile.lifeProfile.world?.items||[])delete item.photo;
    for(const k of ['appearance','photoStyle','photoDirection','age','pronouns','occupation','locationLabel','locationLatitude','locationLongitude','personality','behaviorExamples','description','backstory','socialWorld','privateLife','routine','playerKnowledge','initialMotive','connectionAuthenticity','startingScenario','chatStyle','textingStyle','conversationStyle','chatExamples','chatAvoid','chatLength','values','contradictions','vulnerabilities','relationshipStyle','habits','locationMode','location','timezone','timezoneOffsetMinutes','sleepArchetype','lifeWeatherEnabled','initiativeMode','moodBaseline','startingRelationship','knownBeforeDays','regulationProfile','conflictRecovery','emotionExpression','ruminationStyle','reactionTiming','emotionalGranularity'])if(companion[k]!==undefined)profile[k]=safeJsonClone(companion[k]);
    await vh2Enqueue(timeline,'create_profile',{name:companion.name.slice(0,80),profile,personaId,companionId:companion.id,providerScope:'horde:'+companion.id});
    const setup={...(companion.lifeSetupPolicies||{}),...(companion.lifeStyleProfiles?.length?{styleProfiles:companion.lifeStyleProfiles}:{})};const savedRooms=old.vh2?.visual?.zones||[];if(savedRooms.length){const rooms=new Map((setup.rooms||[]).map(r=>[r.id,r]));for(const r of savedRooms)if(profile.lifeProfile.places.some(p=>p.id===r.placeId))rooms.set(r.id,{id:r.id,placeId:r.placeId,label:r.label,description:r.description});setup.rooms=[...rooms.values()];}if(Object.keys(setup).length)await vh2Enqueue(timeline,'apply_life_proposal',{version:2,baseSetupVersion:0,proposal:setup});
    const chosen=state.personas.find(p=>p.id===timeline.personaId);
    await vh2Enqueue(timeline,'configure_player_profile',{profile:{templateId:chosen?.id||'',name:chosen?.name||'',text:timeline.profileOverrides?.[timeline.personaId]??chosen?.text??''}});
    await vh2Enqueue(timeline,'configure_auto_replies',{enabled:true});
    await vh2Enqueue(timeline,'set_running',{running:true});
    renderCompanionThread();await vh2Poll(companion,timeline,{force:true,throwOnError:true});
    await vh2ImportStarterProfile(companion);
}
function vh2RenderControls(companion){
    if(typeof vhRenderSystemStatus==='function')vhRenderSystemStatus(companion);
    const host=document.getElementById('vh2-chat-controls');if(!host)return;
    const timeline=getActiveCompanionTimeline(companion.id),link=timeline?.vh2;
    if(host.dataset.controlTimeline===timeline?.id&&host.contains?.(document.activeElement)&&document.activeElement?.matches?.('input, textarea, select'))return;
    const expanded=host.dataset.controlTimeline===timeline?.id?new Set([...host.querySelectorAll('details[open]')].map(d=>d.querySelector(':scope > summary')?.textContent)):new Set();
    if(typeof vhRememberPanels==='function')vhRememberPanels(host);
    host.dataset.controlTimeline=timeline?.id||'';
    for(const id of ['companion-fork-timeline-btn','cc-real-time-life','cc-reply-delays','cc-allow-no-reply','cc-silence-consequences','cc-reply-bursts']){const control=document.getElementById(id);if(control)control.disabled=!!link;}
    if(link){const reroll=document.getElementById('companion-reroll-btn');if(reroll)reroll.disabled=true;}
    host.innerHTML=link?`<strong>VH2 timeline · ${link.running?'Life running':'Life paused'}</strong><p class="form-hint">${escapeHTML(link.error||link.replyJob?.reason||(link.replyJob?`Reply: ${link.replyJob.status}`:'Replies follow attention.'))}</p><button type="button" class="tool-btn" data-vh2-pause>${link.running?'Pause life':'Resume life'}</button><button type="button" class="tool-btn" data-vh2-refresh>Refresh / retry connection</button>${link.replyJob?.status==='unknown'?'<button type="button" class="tool-btn" data-vh2-ack>Acknowledge uncertain submission (no retry)</button>':''}${['failed','abandoned','superseded'].includes(link.replyJob?.status)?'<button type="button" class="tool-btn" data-vh2-retry>Retry reply using configured model</button>':''}<p class="form-hint">Profile snapshot. Text, photo gallery, simulated posts and shared plans use this timeline. Calls share the life transcript and attention. Timeline rewinds are not supported here yet. Your profile is configurable per chat. Gifts use the service-owned controls below. Previous data is retained for export and migration. Uses the existing character model and the daily request limit in Settings → Always-on.</p>`:
        '<button type="button" class="tool-btn" data-vh2-create>Start VH2 text timeline (experimental)</button><p class="form-hint">Creates a fresh life from this profile; preserves this timeline. Automatic replies use your selected model and provider credits while the local service runs. Uses the existing Always-on daily request limit.</p>';
    vh2RenderBackupControls(host,companion,timeline);
    if(link){vh2ExtendedTravelControls(host,companion,timeline);vh2ReferenceStudyControls(host,companion,timeline);}
    if(link){
        const history=document.createElement('button');history.type='button';history.className='tool-btn';history.textContent='Load earlier messages';history.disabled=link.transcriptBefore===null;
        history.onclick=async()=>{history.disabled=true;try{await vh2LoadHistory(companion,timeline);}catch(error){showToast(error.message,'error');}finally{vh2RenderControls(companion);}};host.append(history);
        if(link.requiresMigration){
            const upgrade=document.createElement('button');upgrade.type='button';upgrade.className='tool-btn';upgrade.textContent='Upgrade timeline engine (creates backup)';
            upgrade.onclick=async()=>{link.outbox.unshift({schemaVersion:1,key:crypto.randomUUID(),type:'upgrade_kernel'});await saveState();await vh2Poll(companion,timeline);};host.prepend(upgrade);
        }
        {
            const panel=document.createElement('details');panel.innerHTML='<summary>Photo capture preview</summary><p class="form-hint">First review a frozen moment and its references. Capturing the moment makes no provider call. Generation uses your configured provider and credits; you choose when to submit.</p>';
            const scene=document.createElement('input');scene.className='form-input';scene.placeholder='Expression or framing, e.g. a relaxed close-up';scene.maxLength=600;scene.dataset.vh2PhotoScene='';panel.append(scene);
            const mode=document.createElement('select');mode.className='form-input';mode.innerHTML='<option value="front_camera_selfie">Front camera selfie</option><option value="mirror_selfie">Mirror selfie</option>';panel.append(mode);
            const destination=document.createElement('select');destination.className='form-input';destination.innerHTML='<option value="private_chat">Send in private chat</option><option value="gallery">Keep in gallery (do not send or post)</option>';panel.append(destination);
            const button=document.createElement('button');button.type='button';button.className='tool-btn';button.textContent='Review current moment';button.disabled=vh2PhotoLocks.has(timeline.id);
            button.onclick=async()=>{if(!scene.value.trim())return showToast('Describe the photo framing first.','info');button.disabled=true;try{await vhUiCommand(timeline,'capture_photo',{scene:scene.value,captureType:mode.value,destination:destination.value});await vhOpenPhotoReview(companion,timeline,timeline.vh2.lastPhotoId);}catch(error){showToast(error.message,'error');}finally{button.disabled=false;vh2RenderControls(companion);}};panel.append(button);
            for(const photo of [...(link.photos||[]).filter(p=>['captured','submitted'].includes(p.status)),...(link.photos||[]).filter(p=>!['captured','submitted'].includes(p.status)).slice(-5)].sort((a,b)=>b.at-a.at)){
                const row=document.createElement('p');row.className='form-hint';row.textContent=`${photo.status} · ${photo.scene}`;
                if(photo.status==='captured'&&!vh2PhotoLocks.has(timeline.id)){
                    const render=document.createElement('button');render.type='button';render.className='tool-btn';render.textContent='Render saved moment';render.onclick=async()=>{render.disabled=true;try{await vhOpenPhotoReview(companion,timeline,photo.id);}catch(error){showToast(error.message,'error');}finally{vh2RenderControls(companion);}};row.append(render);
                    if(link.imageProvider?.enabled){const background=document.createElement('button');background.type='button';background.className='tool-btn';background.textContent='Render in background';background.onclick=async()=>{background.disabled=true;try{await vhUiCommand(timeline,'queue_photo_render',{photoId:photo.id});}catch(error){showToast(error.message,'error');}};row.append(background);}
                }
                if(['captured','submitted'].includes(photo.status)&&!vh2PhotoLocks.has(timeline.id)){
                    const abandon=document.createElement('button');abandon.type='button';abandon.className='tool-btn';abandon.textContent='Abandon capture (does not cancel provider billing)';abandon.onclick=async()=>{await vh2Enqueue(timeline,'abandon_photo',{photoId:photo.id});await vh2Poll(companion,timeline);};row.append(abandon);
                }panel.append(row);
            }host.append(panel);
        }
        {
            const panel=document.createElement('details');panel.innerHTML='<summary>Shared plans</summary><p class="form-hint">Propose a plan with someone in this profile. They can decline or leave it unanswered. Accepted plans use executable activities and existing travel; attendance is not guaranteed. Each participant checks their own needs, availability and route.</p>';
            const form=document.createElement('form');form.className='form-group';
            const person=document.createElement('select');person.className='form-input';person.setAttribute('aria-label','Plan participant');
            for(const p of link.knownPeople||companion.lifeProfile.socialCircle||[]){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;person.append(option);}
            const place=document.createElement('select');place.className='form-input';place.setAttribute('aria-label','Plan location');
            for(const p of link.travelPlaces||[]){const option=document.createElement('option');option.value=p.id;option.textContent=p.label;place.append(option);}
            const label=document.createElement('input');label.className='form-input';label.required=true;label.maxLength=160;label.placeholder='Plan, e.g. catch up over coffee';label.setAttribute('aria-label','Shared plan description');
            const fields={};for(const [key,title,value,min,max] of [['delay','Starts in simulated minutes',30,1,10000],['window','Available window in minutes',30,1,240],['duration','Time together in minutes',10,1,120]]){const row=document.createElement('label');row.textContent=title;const input=document.createElement('input');input.className='form-input';input.type='number';input.required=true;input.min=min;input.max=max;input.step=1;input.value=value;fields[key]=input;row.append(input);form.append(row);}
            const send=document.createElement('button');send.type='submit';send.className='tool-btn';send.textContent='Propose shared plan';send.disabled=!person.options.length;form.prepend(person,place,label);form.append(send);
            form.onsubmit=async e=>{e.preventDefault();send.disabled=true;try{const startsAt=link.simAt+Number(fields.delay.value)*60000;await vhUiCommand(timeline,'propose_plan',{personId:person.value,placeId:place.value,label:label.value,startsAt,endsAt:startsAt+Number(fields.window.value)*60000,durationMinutes:Number(fields.duration.value)});}catch(error){showToast(error.message,'error');}finally{send.disabled=false;}};panel.append(form);
            for(const p of (link.plans||[]).slice(-10).reverse()){const row=document.createElement('p');row.className='form-hint';row.textContent=`${p.label||'Group outing'} · ${p.status} · ${new Date(p.startsAt).toLocaleString()}${p.reason?' · '+p.reason:''}`;
                if(['proposed','accepted','active'].includes(p.status)){const cancel=document.createElement('button');cancel.type='button';cancel.className='tool-btn';cancel.textContent='Cancel plan';cancel.onclick=async()=>{cancel.disabled=true;try{await vhUiCommand(timeline,'cancel_plan',{planId:p.id});}catch(error){showToast(error.message,'error');}finally{cancel.disabled=false;}};row.append(cancel);}panel.append(row);}
            host.append(panel);
        }
        vh2PopulationPanel(host,companion,timeline);
        vh2PeoplePanel(host,companion,timeline);
        vh2SocialProgressionPanel(host,companion,timeline);
        vh2GiftsPanel(host,companion,timeline);
        vh2TravelPanel(host,companion,timeline);
        vh2EcosystemPanels(host,companion,timeline);
        vh2BackgroundPanel(host,companion,timeline);
        vh2LifestylePanels(host,companion,timeline);
        vh2GeographyPanel(host,companion,timeline);
        if(link.present?.socialRelationships?.length){
            const panel=document.createElement('details');
            const title=document.createElement('summary');title.textContent='Relationships through shared experiences';panel.append(title);
            const note=document.createElement('p');note.className='form-hint';note.textContent='Their own assessment, based on completed time together. This does not reveal what the other person privately feels.';panel.append(note);
            for(const bond of link.present.socialRelationships){
                const row=document.createElement('p');row.className='form-hint';
                const name=(link.knownPeople||companion.lifeProfile.socialCircle).find(p=>p.id===bond.personId)?.name||bond.personId;
                row.textContent=`${name} · ${bond.ownAssessment}${bond.romanticStatus&&bond.romanticStatus!=='none'?' · '+bond.romanticStatus:''} · ${bond.sharedMeetings} shared meetings · last together ${new Date(bond.lastMeetingAt).toLocaleDateString()}`;
                panel.append(row);
            }
            host.append(panel);
        }
        if(link.npcTravel){const panel=document.createElement('details');panel.innerHTML='<summary>Supporting people’s travel</summary><p class="form-hint">Walking routes use recorded durations. Initial locations come from authored routines. People with independent life enabled use the separate life and transport controls below.</p>';for(const [id,p] of Object.entries(link.npcTravel.people)){if(link.people?.actors?.[id])continue;const row=document.createElement('p');row.className='form-hint';row.textContent=((link.knownPeople||companion.lifeProfile.socialCircle).find(x=>x.id===id)?.name||id)+': '+(p.journey?`Walking ${p.journey.from} → ${p.journey.to} · arrival ${new Date(p.journey.arrivesAt).toLocaleTimeString()}`:p.placeId)+(p.blockedReason?' · '+p.blockedReason:'');panel.append(row);}host.append(panel);}
        if(link.presence){
            const panel=document.createElement('details');panel.innerHTML='<summary>Visits & encounters</summary><p class="form-hint">Recorded place membership and noticed people. Supporting people follow routines using known walking routes. Missing routes retain their last position. Noticing does not establish conversation or participation in a photo.</p>';
            const visit=document.createElement('p');visit.textContent=link.presence.visit?`At ${link.presence.visit.placeLabel} since ${new Date(link.presence.visit.arrivedAt).toLocaleString()}`:'In transit or no established place';panel.append(visit);
            for(const event of link.presence.events.slice(-8).reverse()){const row=document.createElement('p');row.className='form-hint';row.textContent=`${new Date(event.at).toLocaleTimeString()} · ${event.summary}`;panel.append(row);}host.append(panel);
        }
        if(link.checkIns?.length){
            const panel=document.createElement('details');panel.innerHTML='<summary>Text check-ins</summary><p class="form-hint">Quoted expectations interpreted from messages. Overdue does not mean intentional rejection. Dismiss an incorrect interpretation.</p>';
            for(const item of link.checkIns.slice(-10).reverse()){
                const row=document.createElement('div');row.className='form-group';const quote=document.createElement('p');quote.textContent=item.evidence;
                const status=document.createElement('p');status.className='form-hint';status.textContent=`${item.status} · expected ${new Date(item.dueAt).toLocaleString()}`;row.append(quote,status);
                if(['pending','overdue'].includes(item.status)){
                    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='tool-btn';dismiss.textContent='Dismiss expectation';dismiss.dataset.checkInId=item.id;
                    dismiss.onclick=async()=>{dismiss.disabled=true;try{await vhUiCommand(timeline,'dismiss_check_in',{checkInId:item.id});}catch(error){showToast(error.message,'error');}finally{dismiss.disabled=false;}};row.append(dismiss);
                }
                panel.append(row);
            }host.append(panel);
        }
        if(link.agency)vh2RenderAgency(host,companion,timeline);
        if(link.relationshipLearning){
            const editor=document.createElement('details');editor.innerHTML='<summary>Relationship pace</summary><p class="form-hint">Repeated interpreted exchanges can gradually change warmth and comfort. Positive progress requires exchanges separated in time; hostile exchanges can reduce comfort. Repeated supportive exchanges may build a fallible impression of trust. Friendliness is not intimacy; claims remain unverified. Attraction and relationship stage do not advance from this evidence. Requires conversation emotions to be enabled.</p>';
            const config=link.relationshipLearning;
            const enabled=document.createElement('label');enabled.textContent='Learn relationship impressions ';const check=document.createElement('input');check.type='checkbox';check.checked=config.enabled;check.dataset.relationshipEnabled='';enabled.append(check);editor.append(enabled);
            for(const [key,label,min,max,step] of [['friendliness','Outward friendliness (0–100)',0,100,1],['guardedness','Guardedness / pace of opening up (0–100)',0,100,1],['trustOpenness','Willingness to give benefit of doubt (0–100)',0,100,1],['rejectionSensitivity','Sensitivity to negative interactions (0–100)',0,100,1],['positiveStep','Positive change per eligible exchange',0,1,.05],['negativeStep','Negative change per eligible exchange',0,2,.05],['dailyLimit','Maximum absolute change per dimension in 24 hours',0,5,.1],['minPositiveExchanges','Positive exchanges before progress',1,20,1],['minPositiveSpanHours','Minimum positive history (hours)',0,168,1],['cooldownMinutes','Minimum time between counted exchanges (minutes)',1,1440,1]]){
                const row=document.createElement('label');row.className='form-label';row.textContent=label;const input=document.createElement('input');input.type='number';input.required=true;input.className='form-input';input.min=min;input.max=max;input.step=step;input.value=config[key];input.dataset.relationshipPolicy=key;row.append(input);editor.append(row);
            }
            const save=document.createElement('button');save.type='button';save.className='tool-btn';save.textContent='Save relationship pace';save.onclick=async()=>{
                if([...editor.querySelectorAll('input[type=number]')].some(i=>!i.reportValidity()))return;
                const policy={enabled:check.checked,...Object.fromEntries([...editor.querySelectorAll('[data-relationship-policy]')].map(i=>[i.dataset.relationshipPolicy,Number(i.value)]))};save.disabled=true;
                try{await vhUiCommand(timeline,'configure_relationship_learning',{policy});}catch(error){showToast(error.message,'error');}finally{save.disabled=false;}
            };editor.append(save);host.append(editor);
        }
        if(link.conversationAppraisal){
            const editor=document.createElement('details');editor.innerHTML='<summary>Conversation emotions</summary><p class="form-hint">Interpret read messages and carry small emotional reactions into later replies. Uses the existing reply call. Model confidence is an estimate; this does not advance trust or intimacy.</p>';
            const config=link.conversationAppraisal;
            const enabled=document.createElement('label');enabled.textContent='Let conversations affect emotions ';
            const check=document.createElement('input');check.type='checkbox';check.checked=config.enabled;check.dataset.conversationEnabled='';enabled.append(check);editor.append(enabled);
            for(const [key,label,min,max,step] of [['emotionalImpact','Reaction strength',0,3,.1],['minConfidence','Minimum interpretation confidence',.5,1,.05],['maxEmotionChange','Maximum change per emotion, per reply',0,10,.5]]){
                const row=document.createElement('label');row.className='form-label';row.textContent=label;
                const input=document.createElement('input');input.type='number';input.required=true;input.className='form-input';input.min=min;input.max=max;input.step=step;input.value=config[key];input.dataset.conversationPolicy=key;row.append(input);editor.append(row);
            }
            const save=document.createElement('button');save.type='button';save.className='tool-btn';save.textContent='Save conversation emotions';save.onclick=async()=>{
                if([...editor.querySelectorAll('input[type=number]')].some(i=>!i.reportValidity()))return;
                const policy={enabled:check.checked,...Object.fromEntries([...editor.querySelectorAll('[data-conversation-policy]')].map(i=>[i.dataset.conversationPolicy,Number(i.value)]))};
                save.disabled=true;
                try{await vhUiCommand(timeline,'configure_conversation_appraisal',{policy});}catch(error){showToast(error.message,'error');}finally{save.disabled=false;}
            };editor.append(save);host.append(editor);
        }
        if(link.psychology){
            const editor=document.createElement('details');editor.innerHTML='<summary>Experience and memory</summary>';
            const config=link.psychology;
            for(const [key,label,min,max,step] of [['learningRate','Learning rate',0,1,.05],['experienceWeight','Influence on future choices',0,20,1],['emotionalImpact','Mood impact',0,3,.1],['affectHalfLifeHours','Mood effect half-life (hours)',.25,48,.25],['memoryLimit','Recent memory window',20,500,1]]){
                const row=document.createElement('label');row.className='form-label';row.textContent=label;
                const input=document.createElement('input');input.type='number';input.className='form-input';input.min=min;input.max=max;input.step=step;input.value=config[key];input.dataset.experiencePolicy=key;row.append(input);editor.append(row);
            }
            const enabled=document.createElement('label');enabled.textContent='Learn from action outcomes ';const check=document.createElement('input');check.type='checkbox';check.checked=config.enabled;enabled.append(check);editor.append(enabled);
            const save=document.createElement('button');save.type='button';save.className='tool-btn';save.textContent='Save experience settings';save.onclick=async()=>{
                if([...editor.querySelectorAll('input[type=number]')].some(i=>!i.reportValidity()))return;
                const policy={enabled:check.checked,...Object.fromEntries([...editor.querySelectorAll('[data-experience-policy]')].map(i=>[i.dataset.experiencePolicy,Number(i.value)]))};
                await vh2Enqueue(timeline,'configure_psychology',{policy});await vh2Poll(companion,timeline);
            };editor.append(save);host.append(editor);
        }
    }
    host.querySelector('[data-vh2-create]')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{await vh2CreateTimeline(companion);}catch(error){showToast(error.message,'error');}finally{vh2RenderControls(companion);}});
    const controlAction=(selector,type,payload)=>host.querySelector(selector)?.addEventListener('click',async e=>{const button=e.currentTarget;button.disabled=true;try{await vhUiCommand(timeline,type,payload());}catch(error){showToast(error.message,'error');}finally{button.disabled=false;}});
    controlAction('[data-vh2-pause]','set_running',()=>({running:!link.running}));
    controlAction('[data-vh2-ack]','dismiss_unknown_dialogue',()=>({jobId:link.replyJob.id}));
    controlAction('[data-vh2-retry]','queue_dialogue',()=>({adapter:'chat_completions'}));
    host.querySelector('[data-vh2-refresh]')?.addEventListener('click',()=>vh2Poll(companion,timeline));
    for(const details of host.querySelectorAll('details'))if(expanded.has(details.querySelector(':scope > summary')?.textContent))details.open=true;
    if(typeof vhRestorePanels==='function'&&timeline)vhRestorePanels(host,timeline);
    if(typeof vhArrangeWorkspace==='function')vhArrangeWorkspace(companion,timeline);if(typeof vhMeaningfulControls==='function')vhMeaningfulControls(host);
}

const vh2PhotoLocks=new Set();
function vh2PhotoAssetUrl(worldId,id){return mcpBridgeBase()+'/vh2/photo-asset?worldId='+encodeURIComponent(worldId)+'&id='+encodeURIComponent(id);}
async function vh2PhotoData(source){
    if(typeof source!=='string'||!source.trim())throw Error('The image reference has no usable image URL.');
    if(source.startsWith('data:'))return source;
    const response=await fetch(source);if(!response.ok)throw Error('Could not import generated photo.');
    const blob=await response.blob();if(blob.size>8_000_000)throw Error('Photo exceeds the current 8 MB import limit.');
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read photo.'));reader.readAsDataURL(blob);});
}
async function vh2PreparePhoto(companion,timeline,photoId,authored=safeJsonClone(companion),history=safeJsonClone(timeline.messages)){
        const worldId=timeline.vh2.worldId;
        const snapshot=await mcpBridgeRequest('/vh2/photo-job?worldId='+encodeURIComponent(worldId)+'&id='+encodeURIComponent(photoId));
        const frozen={...authored,...snapshot.companion,id:authored.id};
        const renderer=timeline.vh2.imageProvider,referenceCapture=snapshot.destination==='reference'||!!snapshot.photoContext?.referenceStudy;
        if(renderer?.configured&&!(referenceCapture&&authored.referenceImageSource))Object.assign(frozen,{imageSource:renderer.provider,imageModel:renderer.model==='provider default'?'':renderer.model,mcpImageTool:renderer.tool||'',mcpImageArguments:safeJsonClone(renderer.arguments||{}),imageParameters:safeJsonClone(renderer.imageParameters||{}),imageProviderOptions:safeJsonClone(renderer.imageProviderOptions||{}),imageProviderTag:renderer.imageProviderTag||''});
        if(renderer?.configured&&vh2SupportsDurableImages(companion,timeline)&&!(referenceCapture&&authored.referenceImageSource)){
            const preview=await mcpBridgeRequest('/vh2/photo-preview?worldId='+encodeURIComponent(worldId)+'&id='+encodeURIComponent(photoId));
            const references=await Promise.all(preview.referenceAssetIds.map(id=>vh2PhotoData(vh2PhotoAssetUrl(worldId,id))));
            const manifest={provider:preview.provider,model:preview.model,promptPreview:preview.prompt,referenceHashes:[]};
            return {snapshot,frozen,context:{...snapshot.photoContext,style:snapshot.companion.photoStyle,direction:snapshot.companion.photoDirection||''},previous:preview.referenceAssetIds.some(id=>!(snapshot.referenceAssets||[]).some(r=>r.assetId===id))?{}:null,bibleReferences:references,manifest,references,providerVersion:preview.providerVersion};
        }
        if(referenceCapture&&authored.referenceImageSource){frozen.imageSource=authored.referenceImageSource||authored.imageSource||'provider';frozen.imageModel=authored.referenceImageSource?authored.referenceImageModel||'':authored.imageModel||'';}
        if(!frozen.imageModel&&!['higgsfield','magnific','local_image','comfyui'].includes(frozen.imageSource)&&typeof companionImageModelFallback==='function')frozen.imageModel=companionImageModelFallback(companionImageProviderId(frozen));
        // Resolve image assets by canonical IDs; runtime and context remain service-owned.
        vh2RestorePhotoReferences(frozen,authored);
        const context={...snapshot.photoContext,roomId:'',style:snapshot.companion.photoStyle||authored.photoStyle,direction:snapshot.companion.photoDirection??authored.photoDirection??'',personality:snapshot.companion.personality||''};
        const previous=context.referenceStudy?null:companionPhotoPrevious(history.filter(m=>(m.photoContext?.atMs||m.timestamp)<=snapshot.photoContext.atMs),context,authored.photoContinuityMinutes??90,true);
        if(previous?.photo){previous.photo=await vh2PhotoData(previous.photo);context.style=previous.photoContext.style||context.style;context.direction=previous.photoContext.direction??context.direction;}
        const bibleReferences=await Promise.all((snapshot.referenceAssets||[]).map(e=>vh2PhotoData(vh2PhotoAssetUrl(worldId,e.assetId))));
        if(context.assetStudy?.role==='identity'&&!bibleReferences.length&&authored.basePhoto)bibleReferences.push(await vh2PhotoData(authored.basePhoto));
        context.bibleRoles=(snapshot.referenceAssets||[]).map(e=>({role:e.role,label:e.label}));
        const references=companionPhotoReferences(frozen,snapshot.scene,{photoContext:context,previousPhoto:previous,bibleReferences});
        if(context.referenceStudy&&(!context.assetStudy||context.assetStudy.requiresReference)&&!references.length)throw Error('Upload and approve an identity reference before generating missing views.');
        if(references.length>1&&['local_image','comfyui'].includes(frozen.imageSource))throw Error('This local image route cannot yet preserve multiple VH2 references. Choose a multi-reference provider.');
        const referenceHashes=await Promise.all(references.map(async ref=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ref)))).map(b=>b.toString(16).padStart(2,'0')).join('')));
        const manifest={style:context.style||'',direction:context.direction||'',promptPreview:buildCompanionPhotoPrompt(frozen,snapshot.scene,{photoContext:context,previousPhoto:previous,atMs:context.atMs,captureType:snapshot.captureType}),referenceHashes,provider:String(['higgsfield','magnific','local_image','comfyui'].includes(frozen.imageSource)?frozen.imageSource:companionImageProviderId(frozen)),model:String(frozen.imageModel||'provider default')};
        return {snapshot,frozen,context,previous,bibleReferences,references,manifest,photoId};
}
async function vh2GeneratePhoto(companion,timeline,scene,captureType,destination='private_chat',existingPhotoId=null,reviewed=null,onProgress=()=>{}){
    if(vh2PhotoLocks.has(timeline.id))throw Error('Photo generation is already running.');
    vh2PhotoLocks.add(timeline.id);
    // Freeze browser-owned visual configuration before any asynchronous work.
    const authored=safeJsonClone(companion),history=safeJsonClone(timeline.messages);
    for(const p of timeline.vh2.photos||[])if(p.status==='stored')history.push({type:'photo',photo:vh2PhotoAssetUrl(timeline.vh2.worldId,p.assetId),timestamp:p.at,photoContext:p.photoContext});
    history.sort((a,b)=>a.timestamp-b.timestamp);
    try{
        if(!existingPhotoId)await vh2Enqueue(timeline,'capture_photo',{scene,captureType,destination});
        await vh2Flush(timeline);
        const photoId=existingPhotoId||timeline.vh2.lastPhotoId;
        if(vh2SupportsDurableImages(companion,timeline)&&!((destination==='reference'||timeline.vh2.photos?.find(p=>p.id===photoId)?.destination==='reference')&&companion.referenceImageSource)){
            onProgress('saving generation request…');
            const receipt=await vhUiCommand(timeline,'queue_photo_render',{photoId,...(reviewed?.providerVersion?{providerVersion:reviewed.providerVersion}:{})});
            if(!receipt?.jobId)throw Error('The generation job was not confirmed. Check Image activity.');
            const until=Date.now()+10*60*1000;
            while(Date.now()<until){
                await vh2Poll(companion,timeline,{force:true,throwOnError:true});
                const photo=timeline.vh2.photos?.find(p=>p.id===photoId),job=timeline.vh2.providerJobs?.find(j=>j.id===receipt.jobId);
                const view=vh2ImageJobPresentation(photo,job);onProgress(view.title+' — '+view.detail);
                if(photo?.assetId)return;
                if(['failed','unknown'].includes(job?.status))throw Error(job.error||view.detail);
                await new Promise(resolve=>setTimeout(resolve,2000));
            }
            throw Error('The job is still saved. Check Image activity for its result; no new attempt was submitted.');
        }
        onProgress('preparing approved references…');
        const {snapshot,frozen,context,previous,bibleReferences,manifest}=reviewed||await vh2PreparePhoto(companion,timeline,photoId,authored,history);
        onProgress('submitting to image provider…');
        await vh2Enqueue(timeline,'submit_photo',{photoId,manifest});await vh2Flush(timeline);
        onProgress('waiting for the image provider…');
        const generated=await generateCompanionPhoto(frozen,snapshot.scene,{vh2Capture:true,bibleReferences,photoContext:context,previousPhoto:previous,atMs:context.atMs,captureType:snapshot.captureType,fallbackWithoutReference:false});
        onProgress('importing generated image…');
        const stable=await stabilizeGeneratedImageSource(generated),image=await vh2PhotoData(stable);
        await loadGeneratedImage(new Image(),image);
        await vh2Enqueue(timeline,'import_photo',{photoId,image});await vh2Flush(timeline);
        await vh2Poll(companion,timeline);
    }finally{vh2PhotoLocks.delete(timeline.id);}
}

async function vh2LoadHistory(companion,timeline){
    const link=timeline.vh2;
    const endpoint='/vh2/transcript?worldId='+encodeURIComponent(link.worldId)+vh2ConversationQuery(timeline)+'&before=';
    let result=await mcpBridgeRequest(endpoint+(link.transcriptBefore||0));
    if(link.transcriptBefore===undefined&&result.before!==null&&result.messages.every(m=>timeline.messages.some(existing=>existing.id===m.id)))result=await mcpBridgeRequest(endpoint+result.before);
    const merged=new Map(result.messages.map(m=>[m.id,{...normalizeCompanionMessage({...m,photo:m.assetId&&m.type==='photo'?vh2PhotoAssetUrl(link.worldId,m.assetId):m.photo,audio:m.assetId&&m.type==='voice'?vh2PhotoAssetUrl(link.worldId,m.assetId):m.audio,role:m.role==='assistant'?'companion':m.role,deliveryState:m.role==='assistant'?'delivered':m.readAt?'read':'delivered'}),text:m.text}]));
    for(const message of timeline.messages)merged.set(message.id,message);
    timeline.messages=[...merged.values()].sort((a,b)=>a.timestamp-b.timestamp);link.transcriptBefore=result.before;
    if(getActiveCompanionTimeline(companion.id)===timeline)state.companionThreads[companion.id]=timeline.messages;
    await saveState();
    if(state.activeCompanionId===companion.id&&getActiveCompanionTimeline(companion.id)===timeline){
        renderCompanionThread();
        const container=document.getElementById('companion-messages');if(container)container.scrollTop=0;
    }
}

async function vh2ImportStarterPosts(companion,status){
 const timeline=getActiveCompanionTimeline(companion.id);let imported=0,skipped=0;
 for(const [index,post] of (companion.startingSocialPosts||[]).entries()){
  if(post.visibility&&post.visibility!=='public'||post.kind==='photo'&&!post.photo){skipped++;continue;}
  if(!post.text&&!post.photo){skipped++;continue;}
  if(status)status.textContent=`Importing starter post ${index+1} of ${companion.startingSocialPosts.length}…`;
  try{const image=post.photo?await makeWorldVisualPortable(post.photo):'';await vhUiCommand(timeline,'import_starter_post',{sourceId:String(post.id||'starter-'+index),caption:post.text||'',ageDays:Number(post.seedAgeDays)||1,image});imported++;}
  catch(error){if(status)status.textContent=`Stopped after ${imported} posts: ${error.message}. Imported posts are kept; retry safely.`;throw error;}
 }
 if(status)status.textContent=`${imported} starter posts available in this life. ${skipped} skipped (private, empty or awaiting a photo). Existing posts and interactions are preserved.`;
 renderCompanionSocialPanel(companion);
}

async function vh2ImportStarterProfile(companion,status){
 const timeline=getActiveCompanionTimeline(companion.id);
 for(const [index,ref] of (companion.startingReferences||[]).entries()){
  const tag='sref_'+String(ref.id||index).replace(/[^a-zA-Z0-9]/g,'').slice(0,32),entityId=ref.role==='identity'?timeline.vh2.entityId:ref.entityId;
  let existing=(timeline.vh2.bible?.entries||[]).find(e=>e.tags?.includes(tag));
  if(!existing){await vhUiCommand(timeline,'add_bible_asset',{role:ref.role,entityId,label:ref.label.slice(0,120),tags:[...ref.tags.slice(0,19),tag],image:await makeWorldVisualPortable(ref.image)});existing=(timeline.vh2.bible?.entries||[]).find(e=>e.tags?.includes(tag));}
  if(existing&&ref.status==='approved'&&existing.status!=='approved')await vhUiCommand(timeline,'review_bible_asset',{entryId:existing.id,status:'approved'});
 }
 await vh2ImportStarterPosts(companion,status);
 for(const photo of companion.startingGallery||[]){if(status)status.textContent='Importing gallery photos…';await vhUiCommand(timeline,'import_starter_gallery',{sourceId:photo.id,caption:photo.text||photo.scene||'',ageDays:Number(photo.seedAgeDays)||1,image:await makeWorldVisualPortable(photo.photo)});}
 await vh2SyncStarterClips(companion,timeline);
 timeline.vh2.starterProfilePending=false;await saveState();
 if(status)status.textContent='Starting posts and clips are saved to this life. Existing history is preserved.';
}
const vh2StarterClipSyncLocks=new Map();
async function vh2SyncStarterClips(companion,timeline=getActiveCompanionTimeline(companion.id)){
 if(!timeline?.vh2?.worldId)return;
 const world=timeline.vh2.worldId;if(vh2StarterClipSyncLocks.has(world))return vh2StarterClipSyncLocks.get(world);
 const task=(async()=>{
  for(const clip of companion.startingVideoClips||[]){
   const existing=(timeline.vh2.clips||[]).find(j=>j.id===clip.id);if(existing?.deletedAt)continue;
   if(!await companionVideoJobSource(clip))throw Error('Starter clip media is missing. Upload it again in Person → Social media → Starter clips.');
   if(!existing)await vhUiCommand(timeline,'import_starter_clip',{clipId:clip.id,caption:clip.caption||'',ageDays:Number(clip.seedAgeDays)||0});
   const stored=normalizeCompanionVideoJob({...clip,...(timeline.vh2.clips||[]).find(j=>j.id===clip.id),assetId:clip.assetId,outputUrl:clip.outputUrl,bundledSrc:clip.bundledSrc,status:'ready'});
   for(const t of state.companionTimelines?.[companion.id]?.sessions||[]){if(t.vh2?.worldId!==world)continue;const jobs=t.runtime.videoJobs||=[];const old=jobs.find(j=>j.id===clip.id);if(old)Object.assign(old,stored);else jobs.push(safeJsonClone(stored));}
   companion.videoJobs=timeline.runtime.videoJobs;
  }
  await saveState();
 })();vh2StarterClipSyncLocks.set(world,task);
 try{return await task;}finally{vh2StarterClipSyncLocks.delete(world);}
}

function vh2RenderSavedGallery(companion,timeline,content){
 const link=timeline.vh2,all=[...new Map([...(link.libraryPhotos||[]),...(link.photos||[])].map(p=>[p.id,p])).values()].sort((a,b)=>b.at-a.at);
 const posts=[...new Map([...(link.libraryPosts||[]),...(link.socialPosts||[])].map(p=>[p.id,p])).values()];
 const saved=all.filter(p=>p.destination==='gallery'&&['captured','submitted'].includes(p.status));
 const ready=all.filter(p=>p.destination==='gallery'&&p.assetId);
 const published=posts.filter(p=>p.status==='published'&&p.visibility==='public'&&p.assetId&&!ready.some(photo=>photo.assetId===p.assetId));
 content.innerHTML='<section class="vh-saved-gallery"><header><div><h3>Gallery</h3><p>Saved ideas are free. Generate when you want, with the original prompt and references.</p></div><button type="button" class="tool-btn" data-image-activity>Image activity</button></header><div data-saved-moments></div><div class="vh-gallery-ready" data-gallery-ready></div></section>';
 content.querySelector('[data-image-activity]').onclick=()=>vh2OpenImageActivity(companion,timeline);
 const moments=content.querySelector('[data-saved-moments]');
 if(saved.length){const title=document.createElement('h4');title.textContent='Saved ideas · '+saved.length;moments.append(title);}
 for(const photo of saved){
  const job=(link.providerJobs||[]).find(j=>j.photoId===photo.id||j.id==='image:'+photo.id),view=vh2ImageJobPresentation(photo,job),card=document.createElement('article');card.className='vh-saved-moment';
  const references=photo.referenceLabels||(photo.photoContext?.referenceAssetIds||[]).map(id=>(link.bible?.entries||[]).find(r=>r.id===id)).filter(Boolean);
  const selected=!!photo.publicationIntent;
  card.innerHTML=`<div class="vh-saved-moment-heading"><strong>${escapeHTML(photo.captureReason||photo.photoContext?.placeLabel||'Saved moment')}</strong><span>${escapeHTML(selected?'Selected for a post':view.state==='waiting'?'Idea · no image generated':view.title)}</span></div><small>${escapeHTML(new Date(photo.at).toLocaleString())} · ${escapeHTML(photo.photoContext?.placeLabel||'Recorded place')}</small><p>${escapeHTML(selected?photo.publicationIntent.reason:photo.scene)}</p><details><summary>Prompt & references</summary><p>${escapeHTML(photo.publicationIntent?.scene||photo.scene)}</p><div class="vh-reference-tags">${references.map(r=>`<span>${escapeHTML(r.role+': '+r.label)}</span>`).join('')||'<span>No approved references were available at capture.</span>'}</div><p class="form-hint">The original capture stays fixed if the character moves or changes clothes.</p></details><div class="vh-image-actions"><button type="button" data-generate-moment>${view.state==='waiting'?'Review & generate':'View generation'}</button>${view.state==='waiting'?'<button type="button" data-dismiss-moment>Remove idea</button>':''}</div>`;
  card.querySelector('[data-generate-moment]').onclick=()=>view.state==='waiting'?vhOpenPhotoReview(companion,timeline,photo.id):vh2OpenImageActivity(companion,timeline);
  const remove=card.querySelector('[data-dismiss-moment]');if(remove)remove.onclick=async()=>{remove.disabled=true;try{await vhUiCommand(timeline,'dismiss_photo_render',{photoId:photo.id});renderCompanionSocialPanel(companion);}catch(error){showToast(error.message,'error');remove.disabled=false;}};
  moments.append(card);
 }
 const images=content.querySelector('[data-gallery-ready]');
 for(const photo of [...ready,...published]){const figure=document.createElement('figure');figure.innerHTML=`<img loading="lazy" src="${escapeHTML(vh2PhotoAssetUrl(link.worldId,photo.assetId))}" alt="${escapeHTML(photo.caption||photo.scene||'Saved photo')}"><figcaption>${escapeHTML(posts.some(p=>p.assetId===photo.assetId&&p.status==='published')?'Shared on the social feed':'Private gallery · not posted or sent')}</figcaption>`;images.append(figure);}
 if(!saved.length&&!ready.length&&!published.length)moments.innerHTML='<p class="vh-social-empty">No saved moments yet. Ideas will appear here as life unfolds.</p>';
 const earlier=document.createElement('button');earlier.type='button';earlier.className='tool-btn';earlier.textContent='Load earlier moments';earlier.disabled=link.photoBefore===null;
 earlier.onclick=async()=>{earlier.disabled=true;try{const result=await mcpBridgeRequest('/vh2/library?worldId='+encodeURIComponent(link.worldId)+vh2ConversationQuery(timeline)+'&kind=photo&before='+(link.photoBefore||0));link.libraryPhotos=[...new Map([...(link.libraryPhotos||[]),...result.items].map(p=>[p.id,p])).values()];link.photoBefore=result.before;await saveState();renderCompanionSocialPanel(companion);}catch(error){showToast(error.message,'error');earlier.disabled=false;}};content.querySelector('section').append(earlier);
}

function vh2SleepExplanation(companion,link){
 const sleep=link?.present?.needs?.sleep;if(sleep?.stage!=='asleep'||!sleep.sleepStartedAt)return '';
 const minutes=Math.max(0,Math.floor((link.simAt-sleep.sleepStartedAt)/60000));
 let time;try{time=new Date(sleep.sleepStartedAt).toLocaleTimeString([], {timeZone:companion.timezone||undefined,hour:'numeric',minute:'2-digit'});}catch(_){time='the recorded bedtime';}
 return `Asleep since ${time} · ${Math.floor(minutes/60)}h ${minutes%60}m slept. Sleep pressure ${Math.round(sleep.pressure)}/100. Physical energy can recover before sleep need; waking also considers time slept and their body clock.`;
}

function vh2OpenFeedPhoto(link,post){
 const d=document.createElement('dialog');d.className='vh-feed-lightbox';d.setAttribute('aria-label','Full photo');d.innerHTML=`<button type="button">Close photo</button><img src="${escapeHTML(vh2PhotoAssetUrl(link.worldId,post.assetId))}" alt="${escapeHTML(post.caption||'Social photograph')}">${post.caption?`<p>${escapeHTML(post.caption)}</p>`:''}`;d.querySelector('button').onclick=()=>d.close();d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();
}

function vh2FeedIcon(name){
 const paths={heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',comment:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z'};
 return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"></path></svg>`;
}

function vh2RenderSocial(companion,content,button,author=false){
    const timeline=getActiveCompanionTimeline(companion.id),link=timeline.vh2;
    if(!author&&companionSocialTab==='gallery')return vh2RenderSavedGallery(companion,timeline,content);
    const focused=content.contains(document.activeElement)&&document.activeElement.matches('.vh-feed-comments input')?{id:document.activeElement.closest('[data-social-post]')?.dataset.socialPost,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null,scrollTop=content.scrollTop;
    for(const card of content.querySelectorAll('[data-social-post]')){const comments=card.querySelector('.vh-feed-comments');if(comments)(link.socialOpenComments||={})[card.dataset.socialPost]=comments.open;}
    button.innerHTML='<span aria-hidden="true">▦</span> Social Media';button.title='Public profile';
    const merge=(older,recent)=>[...new Map([...(older||[]),...(recent||[])].map(p=>[p.id,p])).values()];
    const posts=merge(link.libraryPosts,link.socialPosts).filter(p=>author||p.visibility==='public').filter(p=>author||companionSocialTab!=='gallery'||p.assetId).sort((a,b)=>a.publishedAt-b.publishedAt),photos=merge(link.libraryPhotos,link.photos).sort((a,b)=>a.at-b.at).filter(p=>['stored','delivered'].includes(p.status));
    content.classList.toggle('vh-social-feed',!author);
    content.innerHTML=author?'<h3>Captured photos & publishing</h3><p class="form-hint">Author view. Captures are private until published. A manually requested photo requires your explicit publishing action.</p>':(!posts.some(p=>p.status==='published')?'<div class="vh-social-empty"><h3>No posts yet</h3><p>When they share something publicly, it will appear here.</p></div>':'');
    if(!author){
        const profile=document.createElement('section');profile.className='vh-feed-profile';
        const handle=String(companion.name||'profile').replace(/[^a-z0-9]/gi,'').toLowerCase();
        profile.innerHTML=`<div class="vh-feed-avatar">${companion.profilePhoto?`<img src="${escapeHTML(companion.profilePhoto)}" alt="">`:escapeHTML(companionInitials(companion.name))}</div><div><strong>${escapeHTML(companion.name)}</strong><span>@${escapeHTML(handle)}</span><small>${posts.filter(p=>p.status==='published').length}${link.postBefore!==null?'+':''} posts · ${link.agencyPaused?'Posting paused':link.socialSettings?.enabled?'Life updates':'Feed paused'}</small></div>`;
        content.prepend(profile);
        if((companion.startingSocialPosts||[]).length){
            const tools=document.createElement('details');tools.className='vh-feed-tools';tools.innerHTML='<summary>Profile tools</summary>';
            const apply=document.createElement('button'),status=document.createElement('p');apply.type='button';apply.textContent='Sync starter profile';status.setAttribute('role','status');apply.onclick=async()=>{apply.disabled=true;apply.textContent='Syncing…';try{await vh2ImportStarterProfile(companion,status);showToast('Starter profile updated.','success');}catch(error){showToast(error.message,'error');}finally{apply.disabled=false;apply.textContent='Sync starter profile';}};tools.append(apply,status);profile.append(tools);
        }
    }
    const draftHost=document.createElement('details');draftHost.className='vh-feed-drafts';draftHost.innerHTML='<summary>Posting activity</summary>';if((link.socialPosts||[]).some(p=>p.status==='draft'))content.append(draftHost);
    for(const draft of (link.socialPosts||[]).filter(p=>p.status==='draft')){
        const status=document.createElement('p');status.className='form-hint';status.setAttribute('role','status');status.textContent=draft.generationError||draft.imageError||(draft.imagePending?'Photo selected for this post. Waiting for its image before publishing.':draft.captionReady?'Caption ready; waiting for an available moment to publish.':'Social draft awaiting the configured text model and request budget.');draftHost.append(status);
        if(draft.imagePending){const progress=document.createElement('button');progress.type='button';progress.className='tool-btn';progress.textContent='View post image';progress.onclick=()=>vh2OpenImageActivity(companion,timeline);draftHost.append(progress);}
        if(draft.generationError){const retry=document.createElement('button');retry.type='button';retry.className='tool-btn';retry.textContent='Regenerate post';retry.title='New generation attempt using your provider credits';retry.onclick=async()=>{retry.disabled=true;retry.textContent='Queuing regeneration…';try{await vhUiCommand(timeline,'regenerate_social_draft',{postId:draft.id});renderCompanionSocialPanel(companion);}catch(error){retry.disabled=false;retry.textContent='Regenerate post';showToast(error.message,'error');}};draftHost.append(retry);const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='tool-btn';dismiss.textContent='Dismiss draft without retrying generation';dismiss.onclick=async()=>{dismiss.disabled=true;try{await vhUiCommand(timeline,'dismiss_social_draft',{postId:draft.id});renderCompanionSocialPanel(companion);}catch(error){showToast(error.message,'error');}finally{dismiss.disabled=false;}};draftHost.append(dismiss);}
    }
    for(const [kind,label] of (author?[['photo','Load earlier gallery photos'],['post','Load earlier posts']]:[['post','Load earlier posts']])){
        const load=document.createElement('button');load.type='button';load.className='tool-btn vh-feed-load';load.textContent=label;load.disabled=link[kind+'Before']===null;load.onclick=async()=>{load.disabled=true;try{const result=await mcpBridgeRequest('/vh2/library?worldId='+encodeURIComponent(link.worldId)+vh2ConversationQuery(timeline)+'&kind='+kind+'&before='+(link[kind+'Before']||0));const key=kind==='photo'?'libraryPhotos':'libraryPosts';link[key]=merge(link[key],result.items);link[kind+'Before']=result.before;await saveState();}catch(error){showToast(error.message,'error');}finally{if(state.activeCompanionId===companion.id&&getActiveCompanionTimeline(companion.id)===timeline)renderCompanionSocialPanel(companion);}};load.hidden=load.disabled;content.append(load);
    }
    if(author){
    const available=photos.filter(p=>p.destination!=='reference'&&!posts.some(post=>post.photoId===p.id));
    if(available.length){
        const form=document.createElement('form');form.className='form-group';
        const select=document.createElement('select');select.className='form-input';select.setAttribute('aria-label','Photo to publish');
        for(const photo of available){const option=document.createElement('option');option.value=photo.id;option.textContent=`${photo.destination==='gallery'?'Gallery':'Previously sent privately'} · ${photo.scene}`;select.append(option);}
        const preview=document.createElement('img');preview.style.cssText='max-width:100%;max-height:240px;object-fit:contain';preview.alt='Selected photograph';
        const refresh=()=>{const p=available.find(p=>p.id===select.value);preview.src=vh2PhotoAssetUrl(link.worldId,p.assetId);};select.onchange=refresh;refresh();
        const caption=document.createElement('textarea');caption.className='form-input';caption.maxLength=1200;caption.placeholder='Optional caption';caption.setAttribute('aria-label','Post caption');caption.value=link.publishCaptionDraft||'';caption.oninput=()=>{link.publishCaptionDraft=caption.value;};
        const submit=document.createElement('button');submit.type='submit';submit.className='tool-btn';submit.textContent='Publish to simulated profile';
        form.append(select,preview,caption,submit);form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{await vhUiCommand(timeline,'publish_photo',{photoId:select.value,caption:caption.value});link.publishCaptionDraft='';caption.value='';}catch(error){showToast(error.message,'error');}finally{submit.disabled=false;if(state.activeCompanionId===companion.id&&getActiveCompanionTimeline(companion.id)===timeline)renderCompanionSocialPanel(companion);if(author&&state.view==='vhWorkspace')vhWorkspaceSpecial(true);}};content.append(form);
    }else{const hint=document.createElement('p');hint.className='form-hint';hint.textContent='Use Photo capture preview to save a photo to the gallery. Capturing does not publish it.';content.append(hint);}
    }
    const act=async(type,values)=>{try{await vh2Enqueue(timeline,type,values);await vh2Flush(timeline);if(type==='comment_post'&&link.socialDrafts?.[values.postId]===values.text)delete link.socialDrafts[values.postId];await vh2Poll(companion,timeline);if(values.postId&&!link.socialPosts.some(p=>p.id===values.postId)){const result=await mcpBridgeRequest('/vh2/library?worldId='+encodeURIComponent(link.worldId)+vh2ConversationQuery(timeline)+'&kind=post&id='+encodeURIComponent(values.postId));if(result.item){link.libraryPosts=merge(link.libraryPosts,[result.item]);await saveState();}}}catch(error){showToast(error.message,'error');}if(state.activeCompanionId===companion.id&&getActiveCompanionTimeline(companion.id)===timeline)renderCompanionSocialPanel(companion);if(author&&state.view==='vhWorkspace')vhWorkspaceSpecial(true);};
    for(const post of posts.filter(p=>p.status==='published').slice().reverse()){
        const card=document.createElement('article');card.className='companion-social-post';
        const handle=String(companion.name||'profile').replace(/[^a-z0-9]/gi,'').toLowerCase();
        const avatar=companion.profilePhoto?`<img src="${escapeHTML(companion.profilePhoto)}" alt="">`:escapeHTML(companionInitials(companion.name));
        const date=new Date(post.publishedAt),stamp=date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{})});
        card.dataset.socialPost=post.id;
        card.innerHTML=`<header class="vh-feed-post-head"><span class="vh-feed-avatar">${avatar}</span><div><strong>${escapeHTML(companion.name)}</strong><span>@${escapeHTML(handle)} · <time datetime="${date.toISOString()}" title="${escapeHTML(date.toLocaleString())}">${escapeHTML(stamp)}</time></span></div><details class="vh-feed-post-info"><summary aria-label="Post details">•••</summary><p>${post.origin==='authored_starter'?'From their starting profile':escapeHTML(post.captureContext?.placeLabel||'A moment from their life')}</p></details></header>${post.caption?`<p class="vh-feed-caption">${escapeHTML(post.caption)}</p>`:''}${post.assetId?`<button type="button" class="vh-feed-photo" aria-label="Open full photo"><img loading="lazy" src="${escapeHTML(vh2PhotoAssetUrl(link.worldId,post.assetId))}" alt="${escapeHTML(post.caption||'Photo from '+companion.name)}"></button>`:''}<div class="vh-feed-actions"></div>`;
        card.querySelector('.vh-feed-photo')?.addEventListener('click',()=>vh2OpenFeedPhoto(link,post));
        const actions=card.querySelector('.vh-feed-actions'),like=document.createElement('button');like.type='button';like.className='vh-feed-like'+(post.likedByPlayer?' is-liked':'');like.setAttribute('aria-pressed',String(!!post.likedByPlayer));like.setAttribute('aria-label',post.likedByPlayer?'Unlike post':'Like post');like.innerHTML=vh2FeedIcon('heart')+'<span>'+(post.likedByPlayer?'Liked':'Like')+'</span>';like.onclick=()=>{like.disabled=true;return act('like_post',{postId:post.id,liked:!post.likedByPlayer});};actions.append(like);
        const comments=document.createElement('details');comments.className='vh-feed-comments';comments.open=!!link.socialOpenComments?.[post.id];comments.innerHTML=`<summary>${post.comments.length?'View '+post.comments.length+' comment'+(post.comments.length===1?'':'s'):'Add a comment'}</summary>`;comments.ontoggle=()=>{(link.socialOpenComments||={})[post.id]=comments.open;};
        const commentButton=document.createElement('button');commentButton.type='button';commentButton.setAttribute('aria-label','Comment on post');commentButton.innerHTML=vh2FeedIcon('comment')+'<span>'+(post.comments.length||'Comment')+'</span>';commentButton.onclick=()=>{comments.open=true;comments.querySelector('input').focus({preventScroll:true});};actions.append(commentButton);
        if(author){const withdraw=document.createElement('button');withdraw.type='button';withdraw.textContent='Withdraw post';withdraw.onclick=()=>{withdraw.disabled=true;return act('withdraw_post',{postId:post.id});};card.querySelector('.vh-feed-post-info').append(withdraw);}
        for(const comment of post.comments){const row=document.createElement('p');const who=comment.authorName||(comment.authorId===timeline.vh2.personaId||comment.authorId===timeline.personaId?'You':'Contact');row.innerHTML=`<strong>${escapeHTML(who)}</strong> ${escapeHTML(comment.text)}`;comments.append(row);}
        const form=document.createElement('form'),input=document.createElement('input'),send=document.createElement('button');input.maxLength=500;input.required=true;input.placeholder='Add a comment…';input.setAttribute('aria-label','Comment on post');input.value=link.socialDrafts?.[post.id]||'';input.oninput=()=>{(link.socialDrafts ||= {})[post.id]=input.value;};send.type='submit';send.textContent='Post';form.append(input,send);
        form.onsubmit=event=>{event.preventDefault();if(!input.value.trim())return;send.disabled=true;return act('comment_post',{postId:post.id,text:input.value});};comments.append(form);card.append(comments);content.append(card);

    }
    content.querySelectorAll('.vh-feed-load').forEach(load=>content.append(load));
    content.scrollTop=scrollTop;
    if(focused?.id){const input=content.querySelector(`[data-social-post="${CSS.escape(focused.id)}"] .vh-feed-comments input`);if(input){input.focus({preventScroll:true});input.setSelectionRange(focused.start,focused.end);}}
}

function vh2RenderAgency(host,companion,timeline){
    const agency=timeline.vh2.agency,editor=document.createElement('details');
    editor.innerHTML='<summary>Life expression & spontaneous plans</summary><p class="form-hint">Recorded experiences can prompt invitations, photo captures and later sharing. Choices consider interest, novelty, needs and attention. Gallery ideas save their original prompt and references without generating images. Automatic rendering requires a selected social post and enabled image generation. Manual generation remains available.</p>';
    const enabled=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=agency.policy.enabled;check.dataset.agencyEnabled='';enabled.append(check,' Enable spontaneous plans, capture and sharing');editor.append(enabled);
    const basic=document.createElement('div'),advanced=document.createElement('details');advanced.innerHTML='<summary>Decision tuning</summary>';editor.append(basic,advanced);
    for(const [key,label,min,max] of [['captureInterest','Interest in taking photos',0,100],['sharingInterest','Interest in sharing photos',0,100],['sociability','Desire to initiate plans',0,100],['noveltyWeight','Influence of unfamiliar places',0,50],['minEnergy','Minimum energy',0,100],['maxStress','Maximum stress',0,100],['captureThreshold','Capture decision threshold',0,200],['shareThreshold','Sharing decision threshold',0,200],['invitationThreshold','Invitation decision threshold',0,200],['captureCooldownMinutes','Minimum minutes between captures',5,1440],['postCooldownMinutes','Minimum minutes between posts',5,1440],['inviteCooldownMinutes','Minimum minutes between invitations',10,10080],['maxPendingCaptures','Maximum unrendered moments',1,12]]){
        const labelNode=document.createElement('label'),input=document.createElement('input');labelNode.className='form-label';labelNode.textContent=label;input.type='number';input.className='form-input';input.required=true;input.min=min;input.max=max;input.step=1;input.value=agency.policy[key];input.dataset.agencyPolicy=key;labelNode.append(input);(['captureInterest','sharingInterest','sociability'].includes(key)?basic:advanced).append(labelNode);
    }
    const save=document.createElement('button');save.type='button';save.className='tool-btn';save.textContent='Save life expression';save.onclick=async()=>{
        if([...editor.querySelectorAll('input[type=number]')].some(i=>!i.reportValidity()))return;
        save.disabled=true;const policy={enabled:check.checked,...Object.fromEntries([...editor.querySelectorAll('[data-agency-policy]')].map(i=>[i.dataset.agencyPolicy,Number(i.value)]))};
        try{await vhUiCommand(timeline,'configure_life_expression',{policy});}catch(error){showToast(error.message,'error');}finally{save.disabled=false;}
    };editor.append(save);
    const trace=document.createElement('details');trace.innerHTML='<summary>Why these choices?</summary>';
    for(const decision of agency.decisions.slice(-8).reverse()){const row=document.createElement('p');row.className='form-hint';row.textContent=`${decision.kind}: ${decision.accepted?'chosen':'passed over'} · ${decision.score.toFixed(1)} / ${decision.threshold} · `+Object.entries(decision.components).map(([key,value])=>`${key} ${value>=0?'+':''}${value.toFixed(1)}`).join(', ');trace.append(row);}
    editor.append(trace);host.append(editor);
}

function vh2RenderBackupControls(host,companion,timeline){
    const panel=document.createElement('details');panel.innerHTML='<summary>Timeline backup & recovery</summary><p class="form-hint">Archive this service timeline with its event history, conversations and generated images. Provider credentials and the separate Horde Studio settings/reference library are excluded. Restores pause the life and automatic replies, and never overwrite an existing timeline.</p>';
    if(timeline?.vh2?.worldId){const download=document.createElement('button');download.type='button';download.className='tool-btn';download.textContent='Download VH2 timeline backup';download.onclick=async()=>{download.disabled=true;try{const response=await fetch(mcpBridgeBase()+'/vh2/backup?worldId='+encodeURIComponent(timeline.vh2.worldId));if(!response.ok)throw Error((await response.json()).error||'Backup failed.');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='horde-vh2-'+timeline.vh2.worldId+'.vh2.gz';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(error){showToast(error.message,'error');}finally{download.disabled=false;}};panel.append(download);}
    const label=document.createElement('label');label.className='form-label';label.textContent='Restore a VH2 timeline archive';const file=document.createElement('input');file.type='file';file.accept='.gz,application/gzip';label.append(file);panel.append(label);
    file.onchange=async()=>{const archive=file.files?.[0];if(!archive)return;file.disabled=true;try{
        const response=await fetch(mcpBridgeBase()+'/vh2/restore',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:archive});const result=await response.json();if(!response.ok)throw Error(result.error||'Restore failed.');
        const projection=await mcpBridgeRequest('/vh2/projection?worldId='+encodeURIComponent(result.worldId)),snapshot=projection.state.truth.companion;
        const originalId=projection.state.integration?.sourceCompanionId;let target=originalId?getCompanion(originalId):null;
        if(!target){target=normalizeCompanion({...snapshot,id:originalId||crypto.randomUUID()});state.companions.push(target);ensureCompanionTimelineStore(target.id);}
        const restored=createCompanionTimeline(target,{name:'Recovered VH2 · '+target.name});restored.vh2={worldId:result.worldId,outbox:[],error:'',running:false};
        state.activeCompanionId=target.id;await saveState();switchView('companionChat');await vh2Poll(target,restored);renderCompanionThread();showToast('Timeline restored and paused. Review provider settings before resuming.','success');
    }catch(error){showToast(error.message,'error');}finally{file.disabled=false;file.value='';}};
    host.append(panel);
}

function vh2ReadinessIssues(link){
    return typeof vhLifeReadiness==='function'?vhLifeReadiness(link).filter(item=>item.state==='action').map(item=>item.message):[];
}

function vh2PopulationPanel(host,companion,timeline){
 const link=timeline.vh2,r=link.population;if(!r)return;
 const panel=document.createElement('details'),title=document.createElement('summary');title.textContent='Local people & introductions';panel.append(title);
 const note=document.createElement('p');note.className='form-hint';note.textContent='Create residents she has not met yet. They can exchange names after sustained overlap at a nearby public place. These are authored local residents. Enable independent life below to give a resident needs, activity choices and travel before or after an introduction.';panel.append(note);
 const make=(parent,label,type,value)=>{const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('input');input.type=type;if(type==='checkbox')input.checked=!!value;else input.value=value;wrapper.append(input);parent.append(wrapper);return input;};
 const settings=document.createElement('form'),enabled=make(settings,'Enable introductions','checkbox',r.enabled),openness=make(settings,'Character willingness to approach (0–100)','number',r.openness);openness.min=0;openness.max=100;
 const save=document.createElement('button');save.type='submit';save.textContent='Save introduction settings';settings.append(save);
 const send=async(type,body,button)=>{button.disabled=true;try{await vhUiCommand(timeline,type,body);}catch(error){showToast(error.message,'error');}finally{button.disabled=false;}};
 settings.onsubmit=e=>{e.preventDefault();send('configure_population',{enabled:enabled.checked,openness:Number(openness.value)},save);};panel.append(settings);
 const form=document.createElement('form'),name=make(form,'Resident name','text',''),description=make(form,'What they share when introduced','text','');name.required=true;name.maxLength=100;description.maxLength=500;
 const placeLabel=document.createElement('label');placeLabel.textContent='Public place';const place=document.createElement('select');
 for(const p of link.travelPlaces||[]){if(p.kind==='home'||p.encounterScope!=='nearby')continue;const option=document.createElement('option');option.value=p.id;option.textContent=p.label;place.append(option);}placeLabel.append(place);form.append(placeLabel);
 const start=make(form,'Available from (local time)','time','09:00'),end=make(form,'Until (local time)','time','17:00'),willing=make(form,'Their willingness to respond (0–100)','number',50);willing.min=0;willing.max=100;
 const days=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Days at this place';days.append(legend);const checks=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>make(days,day,'checkbox',true));form.append(days);
 const add=document.createElement('button');add.type='submit';add.textContent='Add resident';add.disabled=!place.options.length;form.append(add);
 if(!place.options.length){const hint=document.createElement('p');hint.className='form-hint';hint.textContent='Add a public recurring place with nearby encounter scope first.';form.append(hint);}
 const minutes=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
 form.onsubmit=e=>{e.preventDefault();send('add_resident',{name:name.value,sharedDescription:description.value,placeId:place.value,start:minutes(start.value),end:minutes(end.value),days:checks.flatMap((check,i)=>check.checked?[i]:[]),openness:Number(willing.value)},add);};panel.append(form);
 for(const p of r.residents){const row=document.createElement('p');row.textContent=p.name+' · '+(p.introducedAt!=null?'Introduced':'Not yet met');if(p.introducedAt==null&&!link.people?.actors?.[p.id]){const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>send('remove_resident',{residentId:p.id},remove);row.append(remove);}panel.append(row);}
 host.append(panel);
}

function vh2PeoplePanel(host,companion,timeline){
 const link=timeline.vh2;if(!link.people)return;
 const panel=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Independent people & transport';panel.append(summary);
 const note=document.createElement('p');note.className='form-hint';note.textContent='Give a person their own needs, choices and movement. Authored routine blocks become obligations they try to reach. Routes must already exist; transit uses recorded route durations, not live timetables. Budgets are simulated local units.';panel.append(note);
 const people=new Map([...(link.knownPeople||[]),...(link.population?.residents||[])].map(p=>[p.id,p]));
 const choose=document.createElement('select');choose.className='form-input';choose.setAttribute('aria-label','Person for independent life');for(const [id,p] of people){const option=document.createElement('option');option.value=id;option.textContent=p.name;choose.append(option);}panel.append(choose);
 const container=document.createElement('div');panel.append(container);
 const render=()=>{
  container.replaceChildren();const id=choose.value;if(!id){container.textContent='Add a supporting person or local resident first.';return;}
  const a=link.people.actors[id],policy=a?.policy||{homePlaceId:'',foodPlaceIds:[],leisurePlaceIds:[],modes:['WALK','TRANSIT','RIDESHARE'],ownsCar:false,ownsBicycle:false,curiosity:50,conscientiousness:70,temperature:8,sleepStart:23,sleepEnd:7,mealCost:2,incomePerHour:0,paidPlaceIds:[],dailyExpense:0};
  if(a){const status=document.createElement('p');status.className='form-hint';status.textContent=a.journey?`${a.journey.mode}: ${a.journey.from} → ${a.journey.to}; arriving ${new Date(a.journey.arrivesAt).toLocaleTimeString()}`:`${a.action?.kind||'Considering options'} at ${a.placeId}. Budget ${a.balance.toFixed(2)}; income earned ${(a.earnedIncome||0).toFixed(2)}; unpaid expenses ${(a.unpaidExpenses||0).toFixed(2)}.`;container.append(status);if(a.blockedReason){const reason=document.createElement('p');reason.textContent=a.blockedReason;container.append(reason);}}
  const form=document.createElement('form');form.style.display='grid';form.style.gap='12px';const inputs={};
  const input=(key,label,type,value)=>{const row=document.createElement('label');row.textContent=label;const field=document.createElement('input');field.className='form-input';field.type=type;if(type==='checkbox')field.checked=value;else field.value=value;field.dataset.behaviorKey=key;row.append(field);form.append(row);inputs[key]=field;return field;};
  for(const [key,label,multiple] of [['homePlaceId','Home / usual sleeping place',false],['foodPlaceIds','Places to eat (optional, select multiple)',true],['leisurePlaceIds','Places to spend free time (select multiple)',true],['paidPlaceIds','Places where obligations earn income (select multiple)',true]]){const row=document.createElement('label');row.textContent=label;const field=document.createElement('select');field.className='form-input';field.multiple=multiple;for(const place of link.travelPlaces){const opt=document.createElement('option');opt.value=place.id;opt.textContent=place.label;opt.selected=multiple?policy[key].includes(place.id):policy[key]===place.id;field.append(opt);}row.append(field);form.append(row);inputs[key]=field;}
  for(const [key,label,min,max] of [['curiosity','Curiosity',0,100],['conscientiousness','Commitment to obligations',0,100],['temperature','Variation in choices',1,50],['sleepStart','Usual bedtime hour (local)',0,23],['sleepEnd','Usual waking hour (local)',0,23],['mealCost','Cost per meal in simulated local units',0,10000],['incomePerHour','Income per hour actually worked',0,100000],['dailyExpense','Recurring daily living expenses',0,100000]]){const field=input(key,label,'number',policy[key]);field.min=min;field.max=max;field.required=true;field.step=['mealCost','incomePerHour','dailyExpense'].includes(key)?'.01':'1';if(['sleepStart','sleepEnd'].includes(key)){field.type='time';field.removeAttribute('min');field.removeAttribute('max');field.step='3600';field.value=String(policy[key]).padStart(2,'0')+':00';}}
  input('ownsCar','Owns a car','checkbox',policy.ownsCar).disabled=!!a;input('ownsBicycle','Owns a bicycle','checkbox',policy.ownsBicycle).disabled=!!a;
  const modes=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Allowed transport';modes.append(legend);const modeInputs={};for(const mode of ['WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE']){const row=document.createElement('label');row.textContent=({WALK:'Walking',DRIVE:'Driving',BICYCLE:'Cycling',TRANSIT:'Public transport',RIDESHARE:'Taxi / rideshare'})[mode]||mode;const field=document.createElement('input');field.type='checkbox';field.checked=policy.modes.includes(mode);row.append(field);modes.append(row);modeInputs[mode]=field;}form.append(modes);
  if(!a){const field=input('startingBalance','Starting simulated budget','number',100);field.min=0;field.max=1000000;field.step='.01';}
  const save=document.createElement('button');save.type='submit';save.className='tool-btn';save.textContent=a?'Save independent life':'Enable independent life';save.disabled=!!a?.journey;form.append(save);
  form.onsubmit=async event=>{event.preventDefault();const next={};for(const key of ['curiosity','conscientiousness','temperature','sleepStart','sleepEnd','mealCost','incomePerHour','dailyExpense'])next[key]=['sleepStart','sleepEnd'].includes(key)?Number(inputs[key].value.split(':')[0]):Number(inputs[key].value);for(const key of ['ownsCar','ownsBicycle'])next[key]=inputs[key].checked;next.homePlaceId=inputs.homePlaceId.value;for(const key of ['foodPlaceIds','leisurePlaceIds','paidPlaceIds'])next[key]=Array.from(inputs[key].selectedOptions).map(x=>x.value);next.modes=Object.entries(modeInputs).filter(([,f])=>f.checked).map(([mode])=>mode);save.disabled=true;try{await vhUiCommand(timeline,'configure_person_life',{personId:id,policy:next,...(!a?{startingBalance:Number(inputs.startingBalance.value)}:{})});}catch(error){showToast(error.message,'error');}finally{save.disabled=false;}};
  container.append(form);
  if(a?.lastDecision){const trace=document.createElement('details'),title=document.createElement('summary');title.textContent='Why this action?';trace.append(title);for(const candidate of a.lastDecision.candidates){const row=document.createElement('p');row.className='form-hint';row.textContent=`${candidate.kind} at ${candidate.placeId}: score ${candidate.score.toFixed(1)}, chance ${Math.round(candidate.probability*100)}%`;trace.append(row);}container.append(trace);}
 };choose.onchange=render;render();host.append(panel);
}

function vh2SocialProgressionPanel(host,companion,timeline){
 const link=timeline.vh2,r=link.socialBonds;if(!r?.policy)return;
 const panel=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Friendships, contact & romantic progression';panel.append(summary);
 const note=document.createElement('p');note.className='form-hint';note.textContent='Progression requires recorded shared time. Potential romantic interest is optional, applies separately on each side, and never means current attraction or guaranteed agreement. This does not change the player relationship settings.';panel.append(note);
 const form=document.createElement('form');form.style.display='grid';form.style.gap='10px';const fields={};
 const labels={contactMeetings:'Meetings before exchanging contact details',contactDays:'Days before exchanging contact details',contactStartHour:'Contact availability starts (local hour)',contactEndHour:'Contact availability ends (local hour)',friendMeetings:'Meetings before friendship',friendDays:'Days before friendship',friendWarmth:'Warmth needed for friendship',datingMeetings:'Meetings before considering dating',datingDays:'Days before considering dating',partnerMeetings:'Meetings before considering partnership',partnerDays:'Days before considering partnership',strainThreshold:'Accumulated strain before estrangement or separation',quietDays:'Quiet days before earned closeness starts fading',distantDays:'Quiet days before a friendship becomes distant'};
 for(const [key,value] of Object.entries(r.policy)){if(!labels[key])continue;const row=document.createElement('label');row.textContent=labels[key];const input=document.createElement('input');input.type='number';input.className='form-input';input.value=value;input.required=true;row.append(input);form.append(row);fields[key]=input;}
 const save=document.createElement('button');save.type='submit';save.className='tool-btn';save.textContent='Save social progression';form.append(save);
 const send=async(type,body,button)=>{button.disabled=true;try{await vhUiCommand(timeline,type,body);}catch(error){showToast(error.message,'error');}finally{button.disabled=false;}};
 form.onsubmit=e=>{e.preventDefault();send('configure_social_progression',{policy:Object.fromEntries(Object.entries(fields).map(([k,f])=>[k,Number(f.value)]))},save);};panel.append(form);
 const choose=document.createElement('select');choose.className='form-input';choose.setAttribute('aria-label','Person for romantic potential');for(const person of link.knownPeople||[]){const opt=document.createElement('option');opt.value=person.id;opt.textContent=person.name;choose.append(opt);}panel.append(choose);const editor=document.createElement('div');panel.append(editor);
 const render=()=>{editor.replaceChildren();if(!choose.value)return;const value=r.pairs[choose.value]?.lifecycle?.policy||{enabled:false,personAge:0,selfPotential:0,otherPotential:0};const form=document.createElement('form');form.style.display='grid';form.style.gap='10px';const fields={};for(const [key,label] of [['enabled','Allow adult romantic progression for this pair'],['personAge','Established age of this person'],['selfPotential','Character potential interest (0–100)'],['otherPotential','Other person potential interest (0–100)']]){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.className='form-input';input.type=key==='enabled'?'checkbox':'number';if(key==='enabled')input.checked=value[key];else input.value=value[key];row.append(input);form.append(row);fields[key]=input;}const save=document.createElement('button');save.type='submit';save.className='tool-btn';save.textContent='Save romantic potential';form.append(save);form.onsubmit=e=>{e.preventDefault();send('configure_romantic_potential',{personId:choose.value,policy:{enabled:fields.enabled.checked,personAge:Number(fields.personAge.value),selfPotential:Number(fields.selfPotential.value),otherPotential:Number(fields.otherPotential.value)}},save);};editor.append(form);};choose.onchange=render;render();host.append(panel);
}

function vh2OpenGifts(companion){return vhOpenGiftSheet(companion);}
function vh2GiftsPanel(host,companion,timeline){
 const link=timeline.vh2,g=link.gifts;if(!g)return;const p=g.policy;
 const panel=document.createElement('details');panel.id='vh2-gifts-panel';const title=document.createElement('summary');title.textContent='Gifts & money';panel.append(title);
 const note=document.createElement('p');note.className='form-hint';note.textContent=`For ${companion.name}. Simulated funds: ${g.currency} ${(g.playerBalance??p.playerBudget).toFixed(2)}. Money and deliveries exist only in this timeline.`;panel.append(note);
 const send=async(type,body,button)=>{button.disabled=true;try{await vhUiCommand(timeline,type,body);}catch(error){showToast(error.message,'error');}finally{button.disabled=false;}};
 const openGift=document.createElement('button');openGift.type='button';openGift.className='tool-btn';openGift.textContent='Open gifts & money';openGift.onclick=()=>vhOpenGiftSheet(companion);panel.append(openGift);
 const upload=document.createElement('details'),uploadTitle=document.createElement('summary');uploadTitle.textContent='Add an item or clothing reference';upload.append(uploadTitle);const uploadForm=document.createElement('form');uploadForm.style.display='grid';uploadForm.style.gap='10px';const name=document.createElement('input');name.className='form-input';name.required=true;name.maxLength=200;name.setAttribute('aria-label','Gift item name');name.placeholder='Item name';uploadForm.append(name);
 const category=document.createElement('select');category.className='form-input';category.setAttribute('aria-label','Gift item category');for(const value of ['top','bottom','dress','outerwear','underwear','shoes','accessory']){const opt=document.createElement('option');opt.value=value;opt.textContent=value;category.append(opt);}uploadForm.append(category);
 const tags=document.createElement('input');tags.className='form-input';tags.setAttribute('aria-label','Gift item tags');tags.placeholder='Tags, e.g. casual, cozy, sleep';uploadForm.append(tags);const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.setAttribute('aria-label','Gift item reference photo');uploadForm.append(file);const add=document.createElement('button');add.type='submit';add.className='tool-btn';add.textContent='Add gift item';uploadForm.append(add);
 uploadForm.onsubmit=async e=>{e.preventDefault();add.disabled=true;try{const photo=file.files[0]?await normalizeUploadedImage(file.files[0],960,.8):'';await send('add_gift_item',{name:name.value,category:category.value,tags:tags.value.split(',').map(t=>t.trim()).filter(Boolean),photo},add);}catch(error){showToast(error.message,'error');}finally{add.disabled=false;}};upload.append(uploadForm);panel.append(upload);
 for(const gift of g.records.slice(-8).reverse()){const row=document.createElement('p');row.className='form-hint';row.textContent=`${gift.kind==='cash'?'Money':gift.label} · ${gift.currency||g.currency} ${gift.value.toFixed(2)} · ${gift.status}`;panel.append(row);}
 const setup=document.createElement('details'),setupTitle=document.createElement('summary');setupTitle.textContent='Gift preferences & starting funds';setup.append(setupTitle);const settings=document.createElement('form');settings.style.display='grid';settings.style.gap='10px';const fields={};for(const [key,label] of [['enabled','Enable gifts'],['mailAllowed','Permission to receive mailed gifts'],['cashAllowed','Permission to receive money'],['minTrust','Minimum relationship trust'],['maxValue','Maximum accepted gift value'],['deliveryHours','Delivery time in simulated hours'],['playerBudget','Initial simulated sender funds']]){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.className='form-input';input.type=typeof p[key]==='boolean'?'checkbox':'number';if(input.type==='checkbox')input.checked=p[key];else input.value=p[key];if(key==='playerBudget'&&g.playerBalance!==null)input.disabled=true;row.append(input);settings.append(row);fields[key]=input;}
 const currencyLabel=document.createElement('label');currencyLabel.textContent='Currency label (no conversion)';const currency=document.createElement('input');currency.className='form-input';currency.value=g.currency;currency.maxLength=3;currency.disabled=!!g.records.length;currencyLabel.append(currency);settings.append(currencyLabel);const save=document.createElement('button');save.type='submit';save.className='tool-btn';save.textContent='Save gift preferences';settings.append(save);settings.onsubmit=e=>{e.preventDefault();send('configure_gifts',{currency:currency.value.toUpperCase(),policy:Object.fromEntries(Object.entries(fields).map(([key,f])=>[key,f.type==='checkbox'?f.checked:Number(f.value)]))},save);};setup.append(settings);panel.append(setup);host.append(panel);
}

function vh2TravelPanel(host,companion,timeline){
 const link=timeline.vh2,panel=document.createElement('details'),title=document.createElement('summary');title.textContent='Trips & temporary stays';panel.append(title);
 const active=link.travel?.trips?.find(t=>t.id===link.travel.activeId),note=document.createElement('p');note.className='form-hint';note.textContent=active?`${active.label}: ${active.status}. ${active.reason||''}`:'Plan a visit using configured places and routes. Travel uses time and simulated funds; no real bookings are made.';panel.append(note);
 const send=async(type,body,button)=>{button.disabled=true;try{await vhUiCommand(timeline,type,body);}catch(error){showToast(error.message,'error');}finally{button.disabled=false;}};
 if(active){const cancel=document.createElement('button');cancel.className='tool-btn';cancel.textContent=active.status==='travelling'?'End trip after arrival':'Cancel trip';cancel.onclick=()=>send('cancel_trip',{},cancel);panel.append(cancel);}
 else{
 const form=document.createElement('form');form.style.cssText='display:grid;gap:12px';
 const name=document.createElement('input');name.className='form-input';name.placeholder='Trip name';name.setAttribute('aria-label','Trip name');name.required=true;name.maxLength=120;form.append(name);
 const rows=document.createElement('div'),stops=[];
 const addRow=()=>{if(stops.length>=12)return;const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;margin:8px 0';const place=document.createElement('select');place.className='form-input';place.setAttribute('aria-label','Trip stop');for(const p of link.travelPlaces||[]){const option=document.createElement('option');option.value=p.id;option.textContent=p.label;place.append(option);}const stay=document.createElement('input');stay.className='form-input';stay.type='number';stay.min=0;stay.max=43200;stay.value=60;stay.setAttribute('aria-label','Stay duration in minutes');const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.className='tool-btn';const record={place,stay};remove.onclick=()=>{stops.splice(stops.indexOf(record),1);row.remove();};row.append(place,stay,remove);stops.push(record);rows.append(row);};addRow();form.append(rows);
 const add=document.createElement('button');add.type='button';add.textContent='Add stop';add.className='tool-btn';add.onclick=addRow;const submit=document.createElement('button');submit.type='submit';submit.className='tool-btn';submit.textContent='Plan trip';form.append(add,submit);form.onsubmit=e=>{e.preventDefault();send('plan_trip',{label:name.value,stops:stops.map(s=>({placeId:s.place.value,stayMinutes:Number(s.stay.value)}))},submit);};panel.append(form);
 }
 host.append(panel);
}

// Older snapshots may omit assets; an explicit empty reference is a removal.
function vh2RestorePhotoReferences(frozen,authored){
 const restore=(item,source)=>Object.prototype.hasOwnProperty.call(item,'photo')?item:{...item,photo:source?.photo};
 frozen.lifeProfile.places=frozen.lifeProfile.places.map(p=>restore(p,authored.lifeProfile.places.find(x=>x.id===p.id)));
 if(frozen.lifeProfile.world?.items)frozen.lifeProfile.world.items=frozen.lifeProfile.world.items.map(i=>restore(i,authored.lifeProfile.world?.items?.find(x=>x.id===i.id)));
}

// Reference generation state belongs to the timeline, not to a button that polling replaces.
const vh2ReferenceJobs=new Map();
function vh2PendingReferenceCapture(timeline){return (timeline.vh2.photos||[]).find(p=>['captured','submitted'].includes(p.status));}
function vh2SetReferenceProgress(timeline,patch){
 const job={...(vh2ReferenceJobs.get(timeline.id)||{}),...patch};vh2ReferenceJobs.set(timeline.id,job);vh2PaintReferenceProgress(timeline);return job;
}
function vh2PaintReferenceProgress(timeline){
 const job=vh2ReferenceJobs.get(timeline.id),pending=vh2PendingReferenceCapture(timeline);
 const busy=vh2BibleGenerationLocks.has(timeline.id)||vh2PhotoLocks.has(timeline.id);
 for(const box of document.querySelectorAll('[data-reference-job]')){
  if(box.dataset.referenceJob!==timeline.id)continue;
  const button=box.querySelector('[data-reference-start]'),status=box.querySelector('[data-reference-status]'),actions=box.querySelector('[data-reference-recovery]');
  button.disabled=busy||!!pending||box.dataset.referenceEmpty==='true'||button.dataset.referenceEmpty==='true';button.textContent=busy?'Generating reference…':pending?'Resolve saved capture first':box.dataset.idleLabel;
  box.dataset.busy=String(busy);
  const detail=pending?.status==='submitted'?'A photo was submitted, but its result is not yet confirmed. It may still be processing or may have failed. Do not start another paid request.':pending?'A saved capture is waiting to be rendered. Review it, or abandon it before starting a new capture.':'';
  status.textContent=job?.running?job.message+(job.total?` (${job.completed||0} of ${job.total} saved for review)`:'')+' Keep this tab open; image generation can take several minutes.':job?.error?[job.message,detail].filter(Boolean).join(' '):detail||job?.message||'Ready. Progress and any errors will appear here.';
  status.dataset.state=job?.error||pending&&!busy?'attention':busy?'running':'ready';
  actions.hidden=busy||!pending;
  const review=actions.querySelector('[data-reference-resume]');review.hidden=pending?.status!=='captured';
  const abandon=actions.querySelector('[data-reference-abandon]');abandon.textContent=pending?.status==='submitted'?'Abandon capture · billing may still apply':'Abandon saved capture';
 }
 for(const button of document.querySelectorAll('[data-reference-generate]'))if(button.dataset.referenceGenerate===timeline.id)button.disabled=busy||!!pending;
}
function vh2ReferenceGenerationControl(host,companion,timeline,label,run){
 const box=document.createElement('section');box.className='vh-reference-progress';box.dataset.referenceJob=timeline.id;box.dataset.idleLabel=label;
 box.innerHTML='<button type="button" class="tool-btn" data-reference-start></button><p data-reference-status role="status" aria-live="polite" aria-atomic="true"></p><div data-reference-recovery hidden><button type="button" class="tool-btn" data-reference-resume>Review saved capture</button><button type="button" class="tool-btn" data-reference-media>Open capture in Media</button><button type="button" class="tool-btn" data-reference-abandon>Abandon saved capture</button></div>';
 box.querySelector('[data-reference-start]').onclick=run;
 box.querySelector('[data-reference-media]').onclick=()=>{if(getActiveCompanionTimeline(companion.id)!==timeline)activateCompanionTimeline(companion.id,timeline.id);vhOpenWorkspace('media',companion.id);};
 box.querySelector('[data-reference-resume]').onclick=async()=>{
  const photo=vh2PendingReferenceCapture(timeline);if(!photo||photo.status!=='captured')return;
  const study=photo.photoContext?.assetStudy;
  try{await vhOpenPhotoReview(companion,timeline,photo.id,study?async()=>{await vhUiCommand(timeline,'add_bible_asset',{role:study.role,entityId:study.entityId,label:study.view.replaceAll('_',' ')+' reference',tags:[study.view,...(study.view==='front_face'?['face']:[])],photoId:photo.id});vh2SetReferenceProgress(timeline,{running:false,error:false,message:'Reference saved. Review and approve it in the Reference Library.'});}:null);}
  catch(error){vh2SetReferenceProgress(timeline,{running:false,error:true,message:error.message});}
 };
 box.querySelector('[data-reference-abandon]').onclick=async()=>{
  const photo=vh2PendingReferenceCapture(timeline);if(!photo||vh2PhotoLocks.has(timeline.id)||vh2BibleGenerationLocks.has(timeline.id))return;
  vh2BibleGenerationLocks.add(timeline.id);vh2SetReferenceProgress(timeline,{running:true,message:'Abandoning saved capture…',total:0});
  try{await vhUiCommand(timeline,'abandon_photo',{photoId:photo.id});vh2SetReferenceProgress(timeline,{running:false,error:false,message:'Capture abandoned. You can start reference generation again.'});}
  catch(error){vh2SetReferenceProgress(timeline,{running:false,error:true,message:error.message});}
  finally{vh2BibleGenerationLocks.delete(timeline.id);vh2PaintReferenceProgress(timeline);}
 };
 host.append(box);vh2PaintReferenceProgress(timeline);
}
async function vh2GenerateReferenceViews(companion,timeline,requested,options={}){
 if(vh2BibleGenerationLocks.has(timeline.id)||vh2PhotoLocks.has(timeline.id)){vh2PaintReferenceProgress(timeline);return;}
 vh2BibleGenerationLocks.add(timeline.id);vh2SetReferenceProgress(timeline,{running:true,error:false,message:'Checking saved captures…',completed:0,total:0});
 try{
  // Read authoritative capture state before creating anything, including after a reload.
  await vh2Flush(timeline);
  const projection=await mcpBridgeRequest('/vh2/projection?worldId='+encodeURIComponent(timeline.vh2.worldId));
  timeline.vh2.photos=projection.state.photos||[];
  const pending=vh2PendingReferenceCapture(timeline);if(pending)throw Error('No new generation started. Resolve the existing capture below.');
  const entries=projection.state.truth.companion.vh2Assets?.entries||timeline.vh2.bible?.entries||[];
  const candidates=requested||[{role:'identity',entityId:timeline.vh2.entityId,view:'turnaround'}];
  const views=candidates.filter(selection=>options.regenerate||!entries.some(e=>e.role===selection.role&&e.entityId===selection.entityId&&!['archived','rejected'].includes(e.status)&&(e.tags||[]).includes(selection.view)));

  vh2SetReferenceProgress(timeline,{total:views.length});
  for(const [index,selection] of views.entries()){
   if(!selection.entityId)throw Error('Add a subject before generating its reference.');
   const name=selection.view.replaceAll('_',' '),report=message=>vh2SetReferenceProgress(timeline,{message:`${name}: ${message}`,completed:index});
   const seed=entries.filter(e=>e.role===selection.role&&e.entityId===selection.entityId&&['approved','pending'].includes(e.status)).sort((a,b)=>(b.status==='approved')-(a.status==='approved'))[0];
   report('capturing reference…');await vh2Enqueue(timeline,'capture_reference',{role:selection.role,entityId:selection.entityId,view:selection.view,description:(selection.description||'').slice(0,1200),...(seed?{seedEntryId:seed.id}:{})});await vh2Flush(timeline);
   const photoId=timeline.vh2.lastPhotoId;
   await vh2GeneratePhoto(companion,timeline,'','front_camera_selfie','reference',photoId,null,report);
   report('saving to Reference Library…');await vh2Enqueue(timeline,'add_bible_asset',{role:selection.role,entityId:selection.entityId,label:(selection.label||name+' reference').slice(0,120),tags:[selection.view,...(selection.view==='front_face'?['face']:[])],photoId});await vh2Flush(timeline);await vh2Poll(companion,timeline);
   const fresh=await mcpBridgeRequest('/vh2/projection?worldId='+encodeURIComponent(timeline.vh2.worldId));entries.splice(0,entries.length,...(fresh.state.truth.companion.vh2Assets?.entries||[]));
   vh2SetReferenceProgress(timeline,{completed:index+1});
  }
  vh2SetReferenceProgress(timeline,{running:false,error:false,message:views.length?`${views.length} reference${views.length===1?'':'s'} saved. Review and approve the images below.`:'These references already exist. Review any pending images below.'});
 }catch(error){
  try{const p=await mcpBridgeRequest('/vh2/projection?worldId='+encodeURIComponent(timeline.vh2.worldId));timeline.vh2.photos=p.state.photos||[];}catch(_){}
  vh2SetReferenceProgress(timeline,{running:false,error:true,message:'Generation stopped. '+error.message});
 }finally{vh2BibleGenerationLocks.delete(timeline.id);vh2PaintReferenceProgress(timeline);}
}

function vh2EcosystemPanels(host,companion,timeline){
 const link=timeline.vh2;
 const send=async(type,body,button)=>{button.disabled=true;try{await vhUiCommand(timeline,type,body);}catch(error){showToast(error.message,'error');}finally{button.disabled=false;}};
 const panel=title=>{const el=document.createElement('details'),summary=document.createElement('summary');summary.textContent=title;el.append(summary);host.append(el);return el;};
 const button=(label,action)=>{const b=document.createElement('button');b.className='tool-btn';b.type='button';b.textContent=label;b.onclick=()=>action(b);return b;};
 const input=(container,label,value,type='text')=>{const l=document.createElement('label');l.textContent=label;const f=document.createElement('input');f.className='form-input';f.type=type;if(type==='checkbox')f.checked=!!value;else f.value=value;l.append(f);container.append(l);return f;};
 const select=(container,label,items)=>{const l=document.createElement('label');l.textContent=label;const f=document.createElement('select');f.className='form-input';f.setAttribute('aria-label',label);for(const [id,name] of items){const o=document.createElement('option');o.value=id;o.textContent=name;f.append(o);}l.append(f);container.append(l);return f;};
 const note=(container,text)=>{const p=document.createElement('p');p.className='form-hint';p.textContent=text;container.append(p);};
 const explore=panel('Independent life & nearby choices');note(explore,link.geography?.enabled?'Independent life is on. Needs, interests, recorded travel, opening hours and commitments shape their next choice.':'Independent life is off. Enable it in Life settings.');explore.append(button('Open life settings',()=>vhOpenLifeActivity(companion)),button('Places & map',()=>vhOpenWorkspace('places',companion.id)));const last=link.geography?.decisions?.at(-1);if(last)note(explore,'Latest choice: '+(last.reason||last.label||last.kind||last.placeId||'Reviewed nearby possibilities'));
 const institutions=panel('Institutions & commitments');note(institutions,'Attach an authored attendance requirement and consequences to an existing scheduled commitment. This adds local rules without guessing them from nationality or occupation.');
 for(const rule of link.institutions?.rules||[]){note(institutions,`${rule.label}: ${Math.round(rule.minimumAttendance*100)}% attendance · session fee ${rule.fee}`);institutions.append(button('Remove '+rule.label,b=>send('remove_institution',{id:rule.id},b)));}
 const institutionName=input(institutions,'Institution name',''),commitment=select(institutions,'Institution commitment',(link.schedule||[]).filter(b=>b.endMinute>b.startMinute).map(b=>[b.id,b.activity||b.label||b.id])),attendance=input(institutions,'Required attendance fraction (0.01–1)',0.8,'number'),sessionFee=input(institutions,'Fee per completed session',0,'number'),missedStress=input(institutions,'Stress from missed commitment (0–20)',2,'number');institutions.append(button('Add institution rule',b=>send('configure_institution',{rule:{label:institutionName.value,scheduleId:commitment.value,minimumAttendance:Number(attendance.value),fee:Number(sessionFee.value),missedStress:Number(missedStress.value)}},b)));
 for(const outcome of (link.institutions?.events||[]).slice(-5))note(institutions,`${outcome.institution}: ${outcome.status} · ${outcome.attendedMinutes} minutes attended · paid ${outcome.paid}`);
 const flights=panel('Flight connection — Aviationstack');note(flights,'Optional authenticated flight listings. Add an Aviationstack feed below with two airport codes mapped to physical places. Keys stay in the local bridge and are excluded from timeline backups. Each refresh counts toward your provider quota, including failed requests. No booking or ticket purchase is made.');
 const steps=document.createElement('ol');for(const text of ['Create an Aviationstack account and copy its API key.','Paste the key below, set a daily request limit and enable requests.','Save, then return to World information → Flights to link two airports to saved places.']){const li=document.createElement('li');li.textContent=text;steps.append(li);}flights.append(steps);const docs=document.createElement('a');docs.href='https://docs.apilayer.com/aviationstack/docs/api-documentation';docs.target='_blank';docs.rel='noopener noreferrer';docs.textContent='Aviationstack account and API setup guide';flights.append(docs);
 const fp=link.flightProvider||{},flightEnabled=input(flights,'Enable Aviationstack requests',!!fp.enabled,'checkbox'),flightKey=input(flights,fp.hasKey?'Replace Aviationstack API key (leave blank to keep)':'Aviationstack API key','','password'),flightLimit=input(flights,'Maximum flight API requests per day',fp.dailyLimit||4,'number'),flightClear=input(flights,'Remove saved flight API key',false,'checkbox');note(flights,`${fp.hasKey?'API key configured':'API key missing'} · ${fp.usedToday||0} requests reserved today. Live feeds only refresh near current real time.`);
 flights.append(button('Save flight connection',async b=>{b.disabled=true;try{await mcpBridgeRequest('/vh2/flight-provider',{method:'POST',body:{scope:'horde:'+companion.id,enabled:flightEnabled.checked,apiKey:flightKey.value,clearKey:flightClear.checked,dailyLimit:Number(flightLimit.value)}});flightKey.value='';await vh2Poll(companion,timeline);}catch(error){showToast(error.message,'error');}finally{b.disabled=false;}}));
 const feeds=panel('World feeds & awareness');note(feeds,'Public HTTPS RSS/Atom, iCalendar, transit, flight-timetable and OpenLigaDB feeds refresh in the local bridge while this timeline runs, even with the browser closed. Flight JSON needs a compatible source; it is not a booking or aircraft-position feed. Feed publication is not an event date. A place scope is context. Only confirm a calendar venue for a feed whose events actually take place there; calendar entries need explicit start/end times. Unsupported recurrence and all-day entries are reported.');
 for(const source of link.signals?.sources||[]){const row=document.createElement('div');note(row,`${source.url} · ${source.warning||''} ${source.error|| (source.lastSuccessAt?`${source.itemCount} recent claims received`:'Waiting for refresh when running')}`);row.append(button('Remove feed',b=>send('remove_world_feed',{sourceId:source.id},b)));feeds.append(row);}
 const networks=panel('Supporting-person network');note(networks,'Optional private encounters between independently simulated people who share a place. Encounters can change boredom, stress and their recorded bond; they do not automatically become player knowledge.');
 const net=link.people?.network||{},network=input(networks,'Enable private supporting-person encounters',!!net.enabled,'checkbox');
 const networkFields={},networkDefinitions=[['encounterCooldownMinutes','Minutes between encounters with the same person',360],['friendMeetings','Encounters needed before friendship',8],['friendDays','Days needed before friendship',7],['friendWarmth','Warmth needed before friendship',6],['quietDays','Quiet days before friendship becomes distant',21],['planCooldownHours','Hours between invitations',24],['planDurationMinutes','Planned meeting duration (minutes)',30],['maxPlanTravelMinutes','Maximum travel per person (minutes)',60]];
 const groups=input(networks,'Allow small-group plans between established friends',!!net.policy?.groupPlansEnabled,'checkbox');
 for(const [key,label,value] of networkDefinitions)networkFields[key]=input(networks,label,net.policy?.[key]??value,'number');
 const traits={};for(const id of Object.keys(link.people?.actors||{})){const person=(link.knownPeople||[]).find(p=>p.id===id)||(link.population?.residents||[]).find(p=>p.id===id);const row=document.createElement('details'),summary=document.createElement('summary');summary.textContent=(person?.name||id)+' — social disposition';row.append(summary);traits[id]={};for(const [key,label] of [['openness','Openness'],['trustOpenness','Willingness to trust'],['sensitivity','Sensitivity to negative encounters'],['sociability','Sociability']])traits[id][key]=input(row,label+' (0–100)',net.dispositions?.[id]?.[key]??50,'number');networks.append(row);}
 networks.append(button('Save supporting-person network',b=>send('configure_person_network',{enabled:network.checked,policy:{groupPlansEnabled:groups.checked,...Object.fromEntries(Object.entries(networkFields).map(([key,f])=>[key,Number(f.value)]))},dispositions:Object.fromEntries(Object.entries(traits).map(([id,fields])=>[id,Object.fromEntries(Object.entries(fields).map(([key,f])=>[key,Number(f.value)]))]))},b)));
 note(networks,'Studio inspector: these private plans are not automatically known to the character. Invitations may be missed if needs, obligations or travel intervene.');
 const personName=id=>(link.knownPeople||[]).find(p=>p.id===id)?.name||(link.population?.residents||[]).find(p=>p.id===id)?.name||id;
 for(const p of (link.plans||[]).filter(p=>p.scope==='peers').slice(-8))note(networks,`${(p.people||p.participantIds||[]).map(personName).join(', ')} · ${(link.travelPlaces||[]).find(x=>x.id===p.placeId)?.label||p.placeId||'Remote conversation'} · ${p.status} · ${Math.round(p.sharedMinutes||0)} shared minutes`);

 const sportsResult=input(feeds,'Sports score result type ID (league-defined)',2,'number');
 const feedKind=select(feeds,'World feed format',[['rss','RSS, Atom or iCalendar'],['gtfs','GTFS timetable ZIP'],['gtfs_rt','GTFS realtime TripUpdates (protobuf)'],['flights_json','Flight timetable JSON (version 1)'],['aviationstack','Aviationstack live flights'],['openliga','OpenLigaDB sports JSON']]);
 const scheduleSource=select(feeds,'Realtime schedule source',(link.signals?.sources||[]).filter(s=>s.kind==='gtfs').map(s=>[s.id,s.url]));
 const stopFrom=input(feeds,'Departure terminal / stop ID',''),stopTo=input(feeds,'Arrival terminal / stop ID',''),mappedFrom=select(feeds,'Departure place',(link.travelPlaces||[]).map(p=>[p.id,p.label])),mappedTo=select(feeds,'Arrival place',(link.travelPlaces||[]).map(p=>[p.id,p.label])),fare=input(feeds,'Estimated timetable fare',0,'number');
 const zone=input(feeds,'Calendar timezone (IANA, optional)',''),venue=input(feeds,'Calendar events take place at the selected venue',false,'checkbox');const url=input(feeds,'Public feed URL','','url'),scope=select(feeds,'Feed place scope',[['','No place scope'],...(link.travelPlaces||[]).map(p=>[p.id,p.label])]),tags=input(feeds,'Feed interest tags',''),interval=input(feeds,'Refresh interval (minutes)',60,'number'),fresh=input(feeds,'Freshness (hours)',48,'number');feeds.append(button('Add world feed',b=>send('configure_world_feed',{kind:feedKind.value,departureIata:stopFrom.value.trim().toUpperCase(),arrivalIata:stopTo.value.trim().toUpperCase(),sportsResultType:Number(sportsResult.value),scheduleSourceId:feedKind.value==='gtfs_rt'?scheduleSource.value:null,stopMappings:['gtfs','flights_json','aviationstack'].includes(feedKind.value)?{[feedKind.value==='aviationstack'?stopFrom.value.trim().toUpperCase():stopFrom.value]:mappedFrom.value,[feedKind.value==='aviationstack'?stopTo.value.trim().toUpperCase():stopTo.value]:mappedTo.value}:{},fare:Number(fare.value),url:url.value,placeId:scope.value||null,timeZone:feedKind.value==='rss'?(zone.value||null):null,calendarVenueConfirmed:feedKind.value==='rss'&&venue.checked,tags:tags.value.split(',').map(x=>x.trim()).filter(Boolean),intervalMinutes:Number(interval.value),freshHours:Number(fresh.value)},b)));note(feeds,`${link.signals?.signals?.length||0} source claims · ${link.signals?.known?.length||0} noticed by the character. Feed text is unverified external information.`);
 const updateFeedFields=()=>{url.parentElement.hidden=feedKind.value==='aviationstack';sportsResult.parentElement.hidden=feedKind.value!=='openliga';const gtfs=['gtfs','flights_json','aviationstack'].includes(feedKind.value),rt=feedKind.value==='gtfs_rt';for(const f of [stopFrom,stopTo,mappedFrom,mappedTo,fare])f.parentElement.hidden=!gtfs;scheduleSource.parentElement.hidden=!rt;zone.parentElement.hidden=gtfs||rt;venue.parentElement.hidden=gtfs||rt;if(rt)interval.value='1';else if(Number(interval.value)<15)interval.value='60';};feedKind.onchange=updateFeedFields;updateFeedFields();
 const bible=panel('Asset bible');note(bible,'Generate a character sheet, supporting portraits, places and props in the Reference Library. These tools manage individual legacy references. Approve each reference before use. Photos freeze selected reference IDs and versions, so later edits cannot change an earlier capture.');
 const entries=link.bible?.entries||[];
 vh2ReferenceGenerationControl(bible,companion,timeline,'Generate character sheet',()=>vh2GenerateReferenceViews(companion,timeline));note(bible,'Generating a character sheet uses your configured image provider and credits. New images remain pending until approved.');note(bible,`${entries.filter(e=>e.status==='approved').length} approved references. Roles without approved coverage: ${['identity','place','person','garment','pose'].filter(r=>!entries.some(e=>e.role===r&&e.status==='approved')).join(', ')||'none'}.`);
 for(const e of entries.filter(e=>e.status!=='archived')){const row=document.createElement('div');row.className='vh-reference-tile';row.dataset.referenceOwner=e.entityId;row.dataset.referenceRole=e.role;row.dataset.referenceStatus=e.status;row.dataset.referenceLabel=e.label;row.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0';const img=document.createElement('img');img.src=vh2PhotoAssetUrl(link.worldId,e.assetId);img.alt=e.label;img.style.cssText='width:72px;height:72px;object-fit:cover;border-radius:8px';row.append(img);note(row,`${e.label} · ${e.role} · ${e.status} · v${e.version}`);if(e.status!=='approved')row.append(button('Approve reference',b=>send('review_bible_asset',{entryId:e.id,status:'approved'},b)));if(e.status!=='rejected')row.append(button('Reject reference',b=>send('review_bible_asset',{entryId:e.id,status:'rejected'},b)));row.append(button('Archive reference',b=>send('archive_bible_asset',{entryId:e.id},b)));bible.append(row);}
 const role=select(bible,'Reference role',['identity','place','zone','person','prop','garment','pose'].map(r=>[r,r])),owner=select(bible,'Reference subject',[]);
 const owners=()=>{owner.replaceChildren();const items=role.value==='identity'?[[link.entityId,companion.name]]:role.value==='pose'?[['pose','Identity-independent pose']]:role.value==='place'?(link.travelPlaces||[]).map(p=>[p.id,p.label]):role.value==='zone'?(link.visual?.zones||[]).map(z=>[z.id,z.label]):role.value==='person'?(link.knownPeople||[]).map(p=>[p.id,p.name]):(link.gifts?.items||[]).map(i=>[i.id,i.name]);for(const [id,name] of items){const o=document.createElement('option');o.value=id;o.textContent=name;owner.append(o);}};role.onchange=owners;owners();
 const label=input(bible,'Reference label',''),refTags=input(bible,'Reference tags (face, profile, mirror_selfie…)',''),photo=input(bible,'Upload reference image','','file');photo.accept='image/png,image/jpeg,image/webp';const generated=select(bible,'Or use a rendered timeline photo',[['','Upload a new image'],...(link.photos||[]).filter(p=>p.assetId).map(p=>[p.id,p.scene||p.id])]);
 bible.append(button('Add reference for review',async b=>{try{let image='';if(!generated.value){const file=photo.files?.[0];if(!file)throw Error('Choose an image or rendered photo.');image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read image.'));reader.readAsDataURL(file);});}await send('add_bible_asset',{role:role.value,entityId:owner.value,label:label.value,tags:refTags.value.split(',').map(x=>x.trim()).filter(Boolean),...(generated.value?{photoId:generated.value}:{image})},b);}catch(error){showToast(error.message,'error');}}));
}

function vh2ImageSettingsFields(host,companion,timeline){
 const p=timeline.vh2.imageProvider||{},feedback=document.createElement('p');feedback.setAttribute('role','status');
 const explanation=document.createElement('p');explanation.textContent='Manual generation uses provider credits and is not limited by the automatic daily allowance. Turning off automatic photos does not disable Generate image.';host.append(explanation);
 const providerSelect=document.createElement('select');providerSelect.className='form-input';providerSelect.setAttribute('aria-label','Background image provider');for(const id of ['openrouter','gemini','magnific','higgsfield']){const option=document.createElement('option');option.value=id;option.textContent=id==='gemini'?'Google Gemini (direct API)':id;providerSelect.append(option);}providerSelect.value=p.provider||'openrouter';host.append(providerSelect);
 const toolLabel=document.createElement('label');toolLabel.textContent='Image tool';const toolSelect=document.createElement('select');toolSelect.setAttribute('aria-label','Image tool');toolLabel.append(toolSelect);host.append(toolLabel);
 const geminiKey=document.createElement('input');geminiKey.type='password';geminiKey.autocomplete='off';geminiKey.className='form-input';geminiKey.placeholder='Gemini API key (blank keeps the saved key)';geminiKey.setAttribute('aria-label','Background Gemini API key');host.append(geminiKey);
 const controls={};for(const [key,label,value,type] of [['enabled','Render photos selected for social posts',p.enabled||false,'checkbox'],['model','Image model',p.model||companion.imageModel||'','text'],['dailyLimit','Automatic photos per day',p.dailyLimit||4,'number'],['maxReferences','Model reference capacity',p.maxReferences||10,'number']]){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.className='form-input';input.type=type;if(type==='checkbox')input.checked=value;else input.value=value;row.append(input);host.append(row);controls[key]=input;}
 const save=document.createElement('button');save.className='tool-btn';save.textContent='Save image settings';save.onclick=async()=>{save.disabled=true;try{const provider=providerSelect.value;const key=provider==='openrouter'?(providerAuthHeaders('openrouter').Authorization||'').replace(/^Bearer\s+/i,''):provider==='gemini'?geminiKey.value:'';if(['magnific','higgsfield'].includes(provider)&&!toolSelect.value)throw Error('Choose an image generation tool.');await vh2SaveImageProvider(companion,timeline,{...(provider===p.provider?{imageParameters:p.imageParameters||{},imageProviderOptions:p.imageProviderOptions||{},imageProviderTag:p.imageProviderTag||'',imageProviderSlug:p.imageProviderSlug||''}:{}),provider,tool:toolSelect.value||'',arguments:safeJsonClone(provider===p.provider?p.arguments||{}:companion.imageSource===provider?companion.mcpImageArguments||{}:{}),scope:'horde:'+companion.id,apiKey:key,enabled:controls.enabled.checked,model:controls.model.value||(['magnific','higgsfield'].includes(provider)?'provider default':''),dailyLimit:Number(controls.dailyLimit.value),maxReferences:Number(controls.maxReferences.value)});feedback.textContent='Image settings saved. '+vh2ImageBudgetText(timeline.vh2.imageProvider);}catch(error){feedback.textContent=error.message;}finally{save.disabled=false;}};host.append(save,feedback);

 const models=document.createElement('datalist');models.id='vh-image-models-'+crypto.randomUUID();controls.model.setAttribute('list',models.id);host.append(models);let version=0,tools=[];
 const populateModels=()=>{models.replaceChildren();const tool=tools.find(t=>t.name===toolSelect.value),root=tool?.inputSchema||{},schema=root.properties?.params?.properties?root.properties.params:root;const fields=schema.properties||{},key=['model','model_id','modelId','model_name','mode'].find(k=>fields[k]?.enum);for(const value of fields[key]?.enum||[])models.append(new Option(String(value),String(value)));};toolSelect.onchange=populateModels;
 providerSelect.onchange=async()=>{const provider=providerSelect.value,epoch=++version,mcp=['magnific','higgsfield'].includes(provider);geminiKey.hidden=provider!=='gemini';toolLabel.hidden=!mcp;models.replaceChildren();toolSelect.replaceChildren();
  const current=provider===p.provider?p.tool:provider===companion.imageSource?companion.mcpImageTool:'';if(current)toolSelect.append(new Option(current,current));
  if(mcp){const args=provider===p.provider?p.arguments||{}:companion.mcpImageArguments||{},native=args.params||args;if(controls.model.value==='provider default')controls.model.value=native.model||native.mode||'';toolSelect.disabled=true;feedback.textContent='Loading available image tools…';try{const result=await mcpBridgeRequest('/providers/'+provider+'/tools',{timeoutMs:15000});if(epoch!==version)return;tools=result.tools||result;for(const tool of tools){const root=tool.inputSchema||{},schema=root.properties?.params?.properties?root.properties.params:root;if(!['prompt','text','description','positive_prompt'].some(k=>schema.properties?.[k]))continue;if(![...toolSelect.options].some(o=>o.value===tool.name))toolSelect.append(new Option(tool.title||tool.name,tool.name));}populateModels();feedback.textContent='';}catch(error){if(epoch===version)feedback.textContent='Could not load tool choices. '+error.message;}finally{if(epoch===version)toolSelect.disabled=false;}}
  else if(provider==='openrouter'&&typeof getCompanionOutputModels==='function'){try{const choices=await getCompanionOutputModels('image',false,'openrouter');if(epoch===version)for(const m of choices||[])models.append(new Option(m.name||m.id,m.id));}catch(error){if(epoch===version)feedback.textContent='Saved model kept. Model choices could not be refreshed.';}}
 };providerSelect.onchange();
 controls.dailyLimit.min=1;controls.dailyLimit.max=100;controls.maxReferences.min=1;controls.maxReferences.max=20;
}

function vh2BackgroundPanel(host,companion,timeline){
 vh2PersonalPreferencesPanel(host,companion,timeline);
 vh2HistoryImportPanel(host,companion,timeline);
 vh2ZonePanel(host,companion,timeline);
 vh2CommercePanel(host,companion,timeline);
 const apply=document.createElement('button');apply.className='tool-btn';apply.type='button';apply.textContent='Apply Studio personality, chat & photo settings';apply.onclick=async()=>{apply.disabled=true;try{const revision=await vhApplyExpression(companion,timeline);showToast('Expression active at revision '+revision+'.','success');}catch(error){showToast(error.message,'error');}finally{apply.disabled=false;}};host.append(apply);
 const link=timeline.vh2,p=link.imageProvider||{},panel=document.createElement('details');panel.innerHTML='<summary>Background images & routes</summary><p class="form-hint">Automatic camera moments can render while the browser is closed. Uses existing OpenRouter credentials, a direct Gemini key, or connected Magnific/Higgsfield MCP tools and their Studio arguments. Results return to the original captured moment. Unknown outcomes are never automatically retried. Live routes use Settings → Connections → Maps.</p>';
 vh2ImageSettingsFields(panel,companion,timeline);
 for(const job of (link.providerJobs||[]).slice(0,12)){const row=document.createElement('p');row.className='form-hint';row.textContent=`${job.kind}: ${job.status}${job.error?' · '+job.error:''}`;panel.append(row);}
 const health=document.createElement('p');health.className='form-hint';health.textContent=vh2ReadinessIssues(link).join(' · ')||'Configured systems are ready.';panel.prepend(health);host.append(panel);
}

function vh2LifestylePanels(host,companion,timeline){
 const link=timeline.vh2,send=async(type,body,b)=>{b.disabled=true;try{await vhUiCommand(timeline,type,body);}catch(error){showToast(error.message,'error');}finally{b.disabled=false;}};
 const panel=title=>{const p=document.createElement('details'),h=document.createElement('summary');h.textContent=title;p.append(h);host.append(p);return p;};
 const field=(p,label,value,type='text')=>{const l=document.createElement('label');l.textContent=label;const i=document.createElement('input');i.className='form-input';i.type=type;if(type==='checkbox')i.checked=value;else i.value=value;l.append(i);p.append(l);return i;};
 const button=(p,label,fn)=>{const b=document.createElement('button');b.type='button';b.className='tool-btn';b.textContent=label;b.onclick=()=>fn(b);p.append(b);return b;};
 const note=(p,text)=>{const n=document.createElement('p');n.className='form-hint';n.textContent=text;p.append(n);};
 const place=panel('Residence, hometown & local time'),select=document.createElement('select');select.className='form-input';select.setAttribute('aria-label','Place context');for(const p of link.travelPlaces||[]){const o=document.createElement('option');o.value=p.id;o.textContent=p.label;select.append(o);}place.append(select);
 const city=field(place,'City',''),country=field(place,'Country',''),zone=field(place,'IANA timezone','');const load=()=>{const context=link.travel?.places?.[select.value]||{};city.value=context.city||'';country.value=context.country||'';zone.value=context.timeZone||'';};select.onchange=load;load();
 button(place,'Save place context',b=>send('configure_place_context',{placeId:select.value,city:city.value,country:country.value,timeZone:zone.value},b));button(place,'Set hometown',b=>send('set_hometown',{placeId:select.value},b));button(place,'Make current residence',b=>send('set_residence',{placeId:select.value},b));note(place,'Residence changes require actual presence at a home place. Arrival changes the character’s local clock; people left behind keep their original clock.');
 note(place,`Residence: ${link.travelPlaces?.find(p=>p.id===link.travel?.residenceId)?.label||'initial home'} · Hometown: ${link.travelPlaces?.find(p=>p.id===link.travel?.hometownId)?.label||'not set'}`);
 const finance=panel('Finances & recurring costs'),fp=link.finance?.policy;
 if(fp){const controls={};for(const [key,label] of [['enabled','Enable recurring finances'],['incomePerHour','Income per hour of scheduled work'],['dailyIncome','Recurring daily income'],['dailyExpense','Recurring daily expenses']])controls[key]=field(finance,label,fp[key],typeof fp[key]==='boolean'?'checkbox':'number');const work=[];for(const p of link.travelPlaces||[])work.push([p.id,field(finance,'Paid work place: '+p.label,fp.workPlaceIds.includes(p.id),'checkbox')]);button(finance,'Save finances',b=>send('configure_finances',{policy:{...Object.fromEntries(Object.entries(controls).map(([k,i])=>[k,i.type==='checkbox'?i.checked:Number(i.value)])),workPlaceIds:work.filter(([id,i])=>i.checked).map(([id])=>id)}},b));note(finance,`Currency: ${link.gifts?.currency||'USD'}. Unpaid expenses: ${(link.finance.unpaid||0).toFixed(2)}. Starting funds are not reset by this form.`);for(const e of (link.finance.ledger||[]).slice(-8).reverse())note(finance,`${e.kind.replaceAll('_',' ')}: ${e.currency} ${(e.amountMinor/100).toFixed(2)} · ${e.detail}`);}
 if(fp){const payment=field(finance,'Pay outstanding expenses',Math.min(link.finance.unpaid||0,link.gifts?.balance||0),'number');payment.min='0.01';payment.step='0.01';payment.setAttribute('aria-label','Pay outstanding expenses');button(finance,'Record expense payment',b=>send('settle_expenses',{amount:Number(payment.value),currency:link.gifts?.currency||'USD'},b));note(finance,'Uses existing simulated funds and reduces recorded debt. Does not create a real payment.');}
 const closet=panel('Procedural closet & style profiles'),cp=link.closet;
 if(cp){note(closet,'Style profiles describe garments already in the character’s broader closet. Pieces enter the same owned-item pool as uploaded and received clothing; selection considers context, warmth, laundry and recent wear. Saved outfits remain available; specific garments join the same closet.');const enabled=field(closet,'Enable procedural closet',cp.enabled,'checkbox'),repeat=field(closet,'Recent-wear repetition penalty',cp.repetitionPenalty,'number');button(closet,'Save closet policy',b=>send('configure_closet',{enabled:enabled.checked,repetitionPenalty:Number(repeat.value)},b));
 for(const s of cp.styles){note(closet,`${s.name} · ${s.context}`);button(closet,'Remove '+s.name,b=>send('remove_closet_style',{styleId:s.id},b));}
 const name=field(closet,'Style name',''),context=document.createElement('select');context.className='form-input';context.setAttribute('aria-label','Style context');for(const x of ['any','casual','home','work','fitness','active','sleep','social','formal']){const o=document.createElement('option');o.value=x;o.textContent=x;context.append(o);}closet.append(context);const tags=field(closet,'Style tags',''),warmth=field(closet,'Garment warmth (0–5)',1,'number'),pieces={};for(const category of ['top','bottom','dress','outerwear','underwear','shoes','accessory'])pieces[category]=field(closet,category+' options (separate with semicolons)','');button(closet,'Add style profile',b=>send('add_closet_style',{name:name.value,context:context.value,tags:tags.value.split(',').map(x=>x.trim()).filter(Boolean),warmth:Number(warmth.value),pieces:Object.fromEntries(Object.entries(pieces).map(([k,i])=>[k,i.value.split(';').map(x=>x.trim()).filter(Boolean)]))},b));}
}

function vh2GeographyPanel(host,companion,timeline){
 const link=timeline.vh2,panel=document.createElement('details');panel.innerHTML='<summary>Saved places & routes</summary><p class="form-hint">Add places directly to this persistent timeline. Route estimates and live departures use the same stable place IDs.</p>';host.append(panel);
 const field=(label,value='',type='text')=>{const row=document.createElement('label');row.textContent=label;const i=document.createElement('input');i.type=type;i.className='form-input';i.value=value;row.append(i);panel.append(row);return i;};
 const select=(label,options)=>{const row=document.createElement('label');row.textContent=label;const s=document.createElement('select');s.className='form-input';s.setAttribute('aria-label',label);for(const [id,name] of options){const o=document.createElement('option');o.value=id;o.textContent=name;s.append(o);}row.append(s);panel.append(row);return s;};
 const send=async(type,body,b)=>{b.disabled=true;try{await vhUiCommand(timeline,type,body);}catch(error){showToast(error.message,'error');}finally{b.disabled=false;}};
 const edit=select('Place to edit',[['','New place'],...(link.travelPlaces||[]).map(p=>[p.id,p.label])]),label=field('Saved place name'),kind=select('Place kind',['home','work','study','social','errand','outdoor','transit','other'].map(x=>[x,x])),lon=field('Longitude','','number'),lat=field('Latitude','','number'),providerId=field('Google place ID (optional)');edit.onchange=()=>{const p=link.travelPlaces.find(p=>p.id===edit.value);label.value=p?.label||'';kind.value=p?.kind||'other';lon.value=p?.mapCoordinates?.[0]??'';lat.value=p?.mapCoordinates?.[1]??'';providerId.value=p?.googlePlaceId||'';};providerId.oninput=()=>{const old=link.travelPlaces.find(p=>p.id===edit.value)?.googlePlaceId||'';if(providerId.value!==old){lon.value='';lat.value='';}};
 const source=select('Position source',[['listing','Use Google listing when supplied'],['coordinates','Use coordinates instead']]);const updateSource=()=>{if(source.value==='coordinates')providerId.value='';providerId.readOnly=source.value==='coordinates';lon.readOnly=lat.readOnly=source.value==='listing'&&!!providerId.value;};source.onchange=updateSource;const loadPlace=edit.onchange;edit.onchange=()=>{loadPlace();source.value=providerId.value?'listing':'coordinates';updateSource();};const changeProvider=providerId.oninput;providerId.oninput=()=>{changeProvider();updateSource();};updateSource();
 const save=document.createElement('button');save.className='tool-btn';save.textContent='Save timeline place';save.onclick=()=>send('upsert_place',{place:{...(edit.value?{id:edit.value}:{}),label:label.value,kind:kind.value,...(lon.value!==''&&lat.value!==''?{longitude:Number(lon.value),latitude:Number(lat.value)}:{}),googlePlaceId:source.value==='coordinates'?'':providerId.value}},save);panel.append(save);
 const choices=(link.travelPlaces||[]).map(p=>[p.id,p.label]),from=select('Route origin',choices),to=select('Route destination',choices),mode=select('Travel mode',['WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE'].map(x=>[x,x])),minutes=field('Estimated route minutes',15,'number'),cost=field('Simulated route fare',0,'number');
 const live=document.createElement('button');live.className='tool-btn';live.textContent='Calculate with configured Maps provider';live.onclick=async()=>{live.disabled=true;try{const a=link.travelPlaces.find(p=>p.id===from.value),b=link.travelPlaces.find(p=>p.id===to.value);const result=await mcpBridgeRequest('/maps/route',{method:'POST',body:{origin:a.googlePlaceId,destination:b.googlePlaceId,originCoordinates:a.mapCoordinates,destinationCoordinates:b.mapCoordinates,mode:mode.value}});const n=Number(String(result.routes?.[0]?.duration||'').replace(/s$/,''));if(!Number.isFinite(n)||n<=0)throw Error('The provider returned no usable route.');minutes.value=Math.ceil(n/60);}catch(error){showToast(error.message,'error');}finally{live.disabled=false;}};panel.append(live);
 const route=document.createElement('button');route.className='tool-btn';route.textContent='Save route estimate';route.onclick=()=>send('record_route',{from:from.value,to:to.value,mode:mode.value,minutes:Number(minutes.value),cost:Number(cost.value)},route);panel.append(route);
}

function vh2ExtendedTravelControls(host,companion,timeline){
 const link=timeline.vh2;
 const section=title=>{const p=document.createElement('details'),h=document.createElement('summary');h.textContent=title;p.append(h);host.append(p);return p;};
 const field=(p,title,value,type='text')=>{const label=document.createElement('label');label.textContent=title;const i=document.createElement('input');i.className='form-input';i.type=type;if(type==='checkbox')i.checked=!!value;else i.value=value;label.append(i);p.append(label);return i;};
 const select=(p,title,values)=>{const l=document.createElement('label');l.textContent=title;const i=document.createElement('select');i.className='form-input';i.setAttribute('aria-label',title);for(const [id,name] of values){const o=document.createElement('option');o.value=id;o.textContent=name;i.append(o);}l.append(i);p.append(l);return i;};
 const send=(p,title,type,body)=>{const b=document.createElement('button');b.type='button';b.className='tool-btn';b.textContent=title;b.onclick=async()=>{b.disabled=true;try{await vhUiCommand(timeline,type,body());}catch(error){showToast(error.message,'error');}finally{b.disabled=false;}};p.append(b);};
 const note=(p,text)=>{const n=document.createElement('p');n.className='form-hint';n.textContent=text;p.append(n);};
 const places=(link.travelPlaces||[]).map(p=>[p.id,p.label]),services=section('Scheduled transport');
 note(services,'Recorded train, flight, bus and ferry departures are simulated services, not bookings. Use saved terminal places and connecting local routes. Times below are UTC; the character uses each destination’s configured local time.');
 for(const s of link.transportServices||[]){note(services,`${s.label} · ${s.kind} · ${new Date(s.departsAt).toISOString()} · ${s.status}`);if(s.status==='scheduled')send(services,'Cancel service '+s.label,'cancel_transport_service',()=>({serviceId:s.id}));}
 const name=field(services,'Service name',''),kind=select(services,'Service type',['train','flight','bus','ferry'].map(x=>[x,x])),from=select(services,'Service origin',places),to=select(services,'Service destination',places),dep=field(services,'Departure UTC',new Date((link.simAt||Date.now())+3600000).toISOString().slice(0,16),'datetime-local'),arr=field(services,'Arrival UTC',new Date((link.simAt||Date.now())+7200000).toISOString().slice(0,16),'datetime-local'),buffer=field(services,'Boarding buffer minutes',15,'number'),cost=field(services,'Service fare',0,'number'),source=field(services,'Service provenance','user-authored');
 send(services,'Save scheduled service','save_transport_service',()=>({service:{label:name.value,kind:kind.value,from:from.value,to:to.value,departsAt:Date.parse(dep.value+'Z'),arrivesAt:Date.parse(arr.value+'Z'),boardingMinutes:Number(buffer.value),cost:Number(cost.value),source:source.value}}));
 if(link.travel?.trips?.some(t=>t.id===link.travel.activeId&&t.status==='blocked'))send(services,'Reconsider blocked trip','retry_trip',()=>({}));
 const recovery=section('Travel disruption recovery'),policy=link.travel?.recoveryPolicy||{enabled:false,reconsiderMinutes:5,maxAttempts:12,maxSpend:100,maxWaitMinutes:240};
 note(recovery,'Optional replacement-route decisions after blocked travel. Uses actual position, available vehicles, remaining funds and known departures. Past fares and paid stays are preserved; no real tickets or automatic refunds.');
 const rf={};for(const [key,label] of [['enabled','Find replacement routes automatically'],['reconsiderMinutes','Minutes between recovery reviews'],['maxAttempts','Maximum automatic recovery attempts'],['maxSpend','Maximum replacement transport spending'],['maxWaitMinutes','Maximum replacement wait minutes']])rf[key]=field(recovery,label,policy[key],key==='enabled'?'checkbox':'number');
 send(recovery,'Save travel recovery','configure_travel_recovery',()=>({policy:Object.fromEntries(Object.entries(rf).map(([k,f])=>[k,f.type==='checkbox'?f.checked:Number(f.value)]))}));
 const episodes=section('Overnight visits & vacations'),r=link.episodes;if(!r)return;
 note(episodes,'These are possible visits, not a schedule. The character decides using interest, needs, cost, time and personality. Accommodation permission, an affordable return route and freedom from existing commitments are required.');
 const controls={};for(const [key,label] of [['enabled','Enable autonomous overnight trips'],['curiosity','Travel curiosity'],['socialPull','Interest in visiting people'],['minEnergy','Minimum travel energy'],['maxHunger','Maximum travel hunger'],['maxStress','Maximum travel stress'],['reserveCash','Keep cash in reserve'],['maxSpend','Maximum trip spending'],['cooldownDays','Days between overnight trips'],['threshold','Overnight decision threshold']])controls[key]=field(episodes,label,r.policy[key],key==='enabled'?'checkbox':'number');
 send(episodes,'Save overnight policy','configure_episodes',()=>({policy:Object.fromEntries(Object.entries(controls).map(([k,i])=>[k,i.type==='checkbox'?i.checked:Number(i.value)]))}));
 for(const o of r.opportunities){note(episodes,`${o.label} · ${o.minNights}–${o.maxNights} nights · ${o.stayAllowed?'accommodation permitted':'accommodation not permitted'}`);send(episodes,'Remove opportunity '+o.label,'remove_trip_opportunity',()=>({opportunityId:o.id}));}
 const title=field(episodes,'Opportunity name',''),place=select(episodes,'Overnight destination',places),person=select(episodes,'Person to visit',[['','No specific person'],...(link.knownPeople||[]).map(p=>[p.id,p.name])]),start=field(episodes,'Available from UTC',new Date(link.simAt||Date.now()).toISOString().slice(0,16),'datetime-local'),end=field(episodes,'Available until UTC',new Date((link.simAt||Date.now())+30*86400000).toISOString().slice(0,16),'datetime-local'),low=field(episodes,'Minimum nights',1,'number'),high=field(episodes,'Maximum nights',2,'number'),nightly=field(episodes,'Nightly accommodation cost',0,'number'),interest=field(episodes,'Personal interest in this visit',50,'number'),allowed=field(episodes,'Accommodation is permitted',false,'checkbox');
 send(episodes,'Add overnight opportunity','save_trip_opportunity',()=>({opportunity:{label:title.value,placeId:place.value,personId:person.value||null,availableFrom:Date.parse(start.value+'Z'),availableUntil:Date.parse(end.value+'Z'),minNights:Number(low.value),maxNights:Number(high.value),nightlyCost:Number(nightly.value),interest:Number(interest.value),enabled:true,stayAllowed:allowed.checked}}));
 for(const d of (r.decisions||[]).slice(-3).reverse())note(episodes,`${new Date(d.at).toISOString()}: ${d.selected?'chose an overnight visit':'stayed'} · ${d.candidates.length} feasible options`);
}

function vh2ReferenceStudyControls(host,companion,timeline){
 const link=timeline.vh2,p=document.createElement('details');p.innerHTML='<summary>Build room, person, garment & pose references</summary><p class="form-hint">Generate a production reference through your configured image provider. It remains pending review in the Asset bible. Rooms and objects stay linked by ID; no reference study is posted as a life photograph.</p>';host.append(p);
 const select=(title)=>{const l=document.createElement('label');l.textContent=title;const s=document.createElement('select');s.className='form-input';s.setAttribute('aria-label',title);l.append(s);p.append(l);return s;},fill=(s,rows)=>{s.replaceChildren(...rows.map(([id,text])=>{const o=document.createElement('option');o.value=id;o.textContent=text;return o;}));};
 const role=select('Study role'),owner=select('Study subject'),view=select('Study view');fill(role,['identity','place','person','garment','pose'].map(x=>[x,x]));
 const views={identity:['front_face','three_quarter','profile','full_body'],person:['front_face','three_quarter','profile','full_body'],place:['establishing','reverse_angle','detail'],garment:['front','back','detail'],pose:['front_camera_selfie','mirror_selfie','full_body']};
 const refresh=()=>{const owners={identity:[[link.entityId,companion.name]],place:(link.travelPlaces||[]).map(x=>[x.id,x.label]),person:(link.knownPeople||[]).map(x=>[x.id,x.name]),garment:(link.gifts?.items||[]).map(x=>[x.id,x.name]),pose:[['pose','Identity-independent pose']]};fill(owner,owners[role.value]);fill(view,views[role.value].map(x=>[x,x.replaceAll('_',' ')]));};role.onchange=refresh;refresh();
 const label=document.createElement('label');label.textContent='Reference visual details';const details=document.createElement('textarea');details.className='form-input';details.maxLength=1200;label.append(details);p.append(label);
 vh2ReferenceGenerationControl(p,companion,timeline,'Generate reference for review',()=>vh2GenerateReferenceViews(companion,timeline,[{role:role.value,entityId:owner.value,view:view.value,description:details.value}]));
}

function vh2RenderPlayerProfile(companion,timeline,select,details){
 if(details?.contains(document.activeElement)&&document.activeElement?.matches('input, textarea'))return;
 const saved=timeline.vh2.playerProfile||{},template=saved.templateId??timeline.personaId??'';select.disabled=false;if(template&&!Array.from(select.options).some(o=>o.value===template)){const o=document.createElement('option');o.value=template;o.textContent=saved.name||'Saved chat profile';select.append(o);}select.value=template;
 if(details){details.innerHTML='<summary>Profile for this chat</summary><p class="form-hint">This profile is shared with this character as your own description. Changing it does not erase your conversation or remembered facts.</p><label>Profile name<input class="form-input" data-vh2-profile-name maxlength="160"></label><label>About you<textarea class="form-input" data-vh2-profile-text maxlength="6000" rows="4"></textarea></label><button class="tool-btn" type="button" data-vh2-profile-save>Save profile for this chat</button>';
 const name=details.querySelector('[data-vh2-profile-name]'),text=details.querySelector('[data-vh2-profile-text]');name.value=saved.name||state.personas.find(p=>p.id===template)?.name||'';text.value=saved.text??timeline.profileOverrides?.[template]??state.personas.find(p=>p.id===template)?.text??'';
 const save=async(profile)=>{await vhUiCommand(timeline,'configure_player_profile',{profile});};
 details.querySelector('[data-vh2-profile-save]').onclick=async e=>{e.target.disabled=true;try{await save({templateId:select.value,name:name.value,text:text.value});showToast('Saved for this chat.','success');}catch(error){showToast(error.message,'error');}};
 const relationship=document.createElement('section');relationship.className='vh-contact-relationship';relationship.innerHTML='<h3>Their connection to you</h3><p class="form-hint">Authored background for this persona. Learned trust and shared events stay intact.</p><label>Connection<select class="form-select" data-role></select></label><label>Known before this chat (days)<input class="form-input" type="number" min="0" max="36500" data-days></label><label>Background<textarea class="form-textarea" rows="3" maxlength="2000" data-context></textarea></label><button class="btn btn-ghost" type="button">Save connection</button><p role="status"></p>';
 const role=relationship.querySelector('[data-role]'),cfg=timeline.vh2.contactRelationship||{};
 for(const [id,label] of [['stranger','Just meeting'],['friend','Friend'],['best_friend','Best friend'],['partner','Partner'],['family','Family'],['colleague','Colleague'],['ex_partner','Former partner'],['custom','Other connection']])role.add(new Option(label,id));role.value=cfg.role; if(!role.value)role.value='custom';
 relationship.querySelector('[data-days]').value=cfg.knownBeforeDays||0;relationship.querySelector('[data-context]').value=cfg.context||'';
 relationship.querySelector('button').onclick=async e=>{e.target.disabled=true;try{await vhUiCommand(timeline,'configure_contact_relationship',{role:role.value,context:relationship.querySelector('[data-context]').value,knownBeforeDays:Number(relationship.querySelector('[data-days]').value)||0});relationship.querySelector('[role=status]').textContent='Connection saved for this persona.';}catch(error){relationship.querySelector('[role=status]').textContent=error.message;}finally{e.target.disabled=false;}};details.append(relationship);
 select.onchange=async()=>{const chosen=select.value;select.disabled=true;try{await vh2OpenPersonaConversation(companion,chosen);}catch(error){showToast(error.message,'error');select.value=template;select.disabled=false;}};
 }
}

function vh2PersonalPreferencesPanel(host,companion,timeline){
 if(!(Number(companion.age)>=18))return;
 const panel=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Personal preferences & boundaries';panel.append(heading);
 const note=document.createElement('p');note.className='form-hint';note.textContent='Adult character settings for non-graphic conversation. These guide expression; they do not change consent, relationship history, physical drives or autonomous actions. Saved separately for this timeline.';panel.append(note);
 const saved=timeline.vh2.personalPreferences||{},controls={};
 for(const [key,label] of [['interests','Interests and welcome attention'],['aversions','Dislikes and unwelcome attention'],['boundaries','Firm boundaries'],['affectionStyle','How they express affection'],['contextNotes','Context: privacy, mood, stress and fatigue']]){
 const row=document.createElement('label');row.textContent=label;row.style.display='block';const field=document.createElement('textarea');field.className='form-input';field.maxLength=2000;field.rows=3;field.value=saved[key]||'';field.setAttribute('aria-label',label);row.append(field);panel.append(row);controls[key]=field;
 }
 const preview=document.createElement('p');preview.className='form-hint';
 const refresh=()=>{preview.textContent=`Expression guidance: openness ${controls.openness.value}/100, privacy ${controls.privacyPreference.value}/100, initiative ${controls.initiative.value}/100, restraint ${controls.restraint.value}/100. These are preferences, not probabilities or consent scores.`;};
 for(const [key,label] of [['openness','Openness in conversation'],['privacyPreference','Preference for privacy'],['initiative','Conversational initiative'],['restraint','Expressive restraint']]){
 const row=document.createElement('label');row.textContent=label;row.style.display='block';const field=document.createElement('input');field.className='form-input';field.type='number';field.min=0;field.max=100;field.value=saved[key]??50;field.setAttribute('aria-label',label);field.oninput=refresh;row.append(field);panel.append(row);controls[key]=field;
 }
 refresh();panel.append(preview);const save=document.createElement('button');save.type='button';save.className='tool-btn';save.textContent='Save personal preferences';save.onclick=async()=>{save.disabled=true;try{const profile=Object.fromEntries(Object.entries(controls).map(([key,field])=>[key,field.type==='number'?Number(field.value):field.value]));await vhUiCommand(timeline,'configure_personal_preferences',{profile});showToast('Personal preferences saved for this timeline.','success');}catch(error){showToast(error.message,'error');}finally{save.disabled=false;}};panel.append(save);host.append(panel);
}

function vh2HistoryImportPanel(host,companion,timeline){
 const link=timeline.vh2,panel=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Bring prior conversation into VH2';panel.append(heading);host.append(panel);
 const note=document.createElement('p');note.className='form-hint';panel.append(note);
 if(link.legacyHistory){note.textContent=`Imported ${link.legacyHistory.count} historical messages from ${link.legacyHistory.sourceName}. Original source is retained in the timeline backup. Old jobs and physical state were not activated.`;return;}
 note.textContent='Pause life first. Select a portable .horde_human archive and explicitly map one source conversation to this player. Original data is preserved. Only already-read/delivered conversation becomes historical context; this is not a full runtime migration.';
 const file=document.createElement('input');file.type='file';file.accept='.horde_human,.json';file.setAttribute('aria-label','Prior human archive');panel.append(file);
 const choices=document.createElement('select');choices.className='form-input';choices.setAttribute('aria-label','Prior conversation');panel.append(choices);
 const review=document.createElement('p');review.className='form-hint';panel.append(review);
 const label=document.createElement('label'),checked=document.createElement('input');checked.type='checkbox';checked.setAttribute('aria-label','Confirm historical player mapping');label.append(checked,document.createTextNode('I reviewed this source and confirm it is the same character and player.'));panel.append(label);
 const button=document.createElement('button');button.type='button';button.className='tool-btn';button.textContent='Import reviewed conversation';button.disabled=true;panel.append(button);let sourceText='',report=null;
 const refresh=()=>{const session=report?.timelines.find(x=>x.id===choices.value);review.textContent=session?`${report.name}: ${session.name||session.id}, ${session.messages} source messages. Source player: ${session.personaId||'unspecified'} → target player: ${link.canonicalPersonaId}. ${report.issues.length} source warnings; historical runtime is preserved only.`:'';button.disabled=link.running||!checked.checked||!session||report.kind==='character-template'||report.issues.some(x=>x.severity==='error');};
 choices.onchange=()=>{checked.checked=false;refresh();};checked.onchange=refresh;
 file.onchange=async()=>{report=null;sourceText='';checked.checked=false;choices.replaceChildren();button.disabled=true;try{const selected=file.files[0];if(!selected)return;if(selected.size>12*1024*1024)throw Error('Archive limit is 12 MB.');sourceText=await selected.text();report=await mcpBridgeRequest('/vh2/migration/preview',{method:'POST',body:{sourceText}});for(const s of report.timelines){const o=document.createElement('option');o.value=s.id;o.textContent=s.name||s.id;choices.append(o);}refresh();if(report.issues.some(x=>x.severity==='error'))review.textContent=report.issues.filter(x=>x.severity==='error').map(x=>x.message).join(' ');}catch(error){review.textContent=error.message;}};
 button.onclick=async()=>{button.disabled=true;try{await vhUiCommand(timeline,'import_vh1_history',{sourceText,expectedDigest:report.archiveDigest,sessionId:choices.value,targetPersonaId:link.canonicalPersonaId,reviewed:checked.checked});showToast('Historical conversation attached. Life remains paused.','success');}catch(error){showToast(error.message,'error');refresh();}};
}

function vh2ZonePanel(host,companion,timeline){
 const v=timeline.vh2.visual||{zones:[]},panel=document.createElement('details'),title=document.createElement('summary');title.textContent='Room zones & visual continuity';panel.append(title);host.append(panel);
 const note=document.createElement('p');note.className='form-hint';note.textContent=`Outfit revision ${v.outfitRevision||0}. Current zone: ${v.zones.find(z=>z.id===v.zoneId)?.label||'not specified'}. Zone references are linked by ID in the Asset bible. Entering a zone requires presence at its place.`;panel.append(note);
 const place=document.createElement('select');place.className='form-input';place.setAttribute('aria-label','Zone parent place');for(const p of timeline.vh2.travelPlaces||[]){const o=document.createElement('option');o.value=p.id;o.textContent=p.label;place.append(o);}panel.append(place);
 const name=document.createElement('input');name.className='form-input';name.setAttribute('aria-label','Zone name');name.placeholder='Bedroom mirror';panel.append(name);const description=document.createElement('textarea');description.className='form-input';description.setAttribute('aria-label','Zone description');description.placeholder='Layout, furniture, materials and persistent objects';panel.append(description);
 const send=async(type,body)=>{try{await vhUiCommand(timeline,type,body);}catch(error){showToast(error.message,'error');}};
 const add=document.createElement('button');add.type='button';add.className='tool-btn';add.textContent='Add room zone';add.onclick=()=>send('save_place_zone',{placeId:place.value,label:name.value,description:description.value});panel.append(add);
 for(const z of v.zones){const row=document.createElement('p');row.textContent=z.label+' · revision '+z.revision+' ';const enter=document.createElement('button');enter.type='button';enter.className='tool-btn';enter.textContent='Enter '+z.label;enter.onclick=()=>send('enter_place_zone',{zoneId:z.id});row.append(enter);panel.append(row);}
}

function vh2CommercePanel(host,companion,timeline){
 const link=timeline.vh2,panel=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Purchases, currencies & wardrobe conversion';panel.append(summary);host.append(panel);
 const note=document.createElement('p');note.className='form-hint';note.textContent='Simulated purchases use existing funds. Foreign prices require a fresh Frankfurter reference rate; original amount, rate and accounting amount are recorded. No real payment occurs. Preset conversion is reviewed, preserving the original preset.';panel.append(note);
 const field=(label,value='')=>{const row=document.createElement('label');row.textContent=label;const i=document.createElement('input');i.className='form-input';i.value=value;i.setAttribute('aria-label',label);row.append(i);panel.append(row);return i;};
 const button=(label,type,body)=>{const b=document.createElement('button');b.type='button';b.className='tool-btn';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await vhUiCommand(timeline,type,body());}catch(e){showToast(e.message,'error');}finally{b.disabled=false;}};panel.append(b);};
 const currency=field('Purchase currency',link.gifts?.currency||'USD');button('Refresh exchange rate','refresh_fx_rate',()=>({currency:currency.value.trim().toUpperCase()}));
 const select=document.createElement('select');select.className='form-input';select.setAttribute('aria-label','Item to purchase');for(const item of link.gifts?.items||[]){if(item.owned)continue;const o=document.createElement('option');o.value=item.id;o.textContent=item.name;select.append(o);}panel.append(select);const amount=field('Purchase price','10');amount.type='number';amount.min='.01';amount.step='.01';button('Purchase with simulated funds','purchase_item',()=>({itemId:select.value,amount:Number(amount.value),currency:currency.value.trim().toUpperCase()}));
 for(const q of Object.values(link.commerce?.quotes||{})){const row=document.createElement('p');row.textContent=`${q.base} → ${q.quote}: ${q.rate} · ${q.source}, ${q.date}`;panel.append(row);}
 if(!(link.legacyPresets||[]).some(p=>!link.commerce?.convertedPresets?.includes(p.id)))return;
 const presets=document.createElement('select');presets.className='form-input';presets.setAttribute('aria-label','Saved outfit to turn into garments');for(const preset of link.legacyPresets||[]){if(link.commerce?.convertedPresets?.includes(preset.id))continue;const o=document.createElement('option');o.value=preset.id;o.textContent=preset.label||preset.description||preset.id;presets.append(o);}panel.append(presets);
 const pieces={};for(const category of ['top','bottom','dress','outerwear','underwear','shoes','accessory'])pieces[category]=field('Reviewed '+category+' from saved outfit');button('Add garments from this saved outfit','convert_wardrobe_preset',()=>({presetId:presets.value,pieces:Object.entries(pieces).filter(([k,i])=>i.value.trim()).map(([category,i])=>({category,name:i.value.trim()}))}));
}

async function vh2CallExchange(companion,call,text=null){
 const timeline=getActiveCompanionTimeline(companion.id);
 if(!timeline?.vh2)throw Error('The selected life changed.');
 await vh2SyncProvider(companion);
 if(!call.serviceCallId)call.serviceCallId=crypto.randomUUID();
 await vhUiCommand(timeline,text===null?'start_call':'call_turn',{callId:call.serviceCallId,...(text===null?{}:{text})});
 const source=(timeline.vh2.callMessages||[]).filter(m=>m.role==='user'&&m.callId===call.serviceCallId).at(-1);
 if(!source)throw Error('Call turn receipt is missing. Check Life → Connections before retrying.');
 const deadline=Date.now()+90000;
 while(activeCompanionCall===call&&Date.now()<deadline){
  const reply=(timeline.vh2.callMessages||[]).find(m=>m.role==='assistant'&&m.sourceMessageIds?.includes(source.id));
  if(reply)return reply.text;
  const job=timeline.vh2.replyJob;
  if(['failed','unknown','abandoned'].includes(job?.status))throw Error(job.reason||'The reply needs attention in Life → Connections.');
  if(timeline.vh2.call?.status!=='active')throw Error('The call has ended.');
  await new Promise(resolve=>setTimeout(resolve,1500));
  if(activeCompanionCall!==call)break;
  await vh2Poll(companion,timeline,{force:true,throwOnError:true});
 }
 if(activeCompanionCall!==call)throw Error('Call ended.');
 throw Error('Still awaiting their reply. It remains in the life transcript; do not resend the same turn.');
}

function vh2ImageJobSummary(link){
 const jobs=new Map((link.providerJobs||[]).filter(j=>j.kind==='image').map(j=>[j.photoId||j.id.slice(6),j]));
 const result={interrupted:[],running:[],waiting:[],saved:[]};
 for(const photo of link.photos||[]){
  if(!['captured','submitted'].includes(photo.status))continue;
  const job=jobs.get(photo.id),entry={photo,job};
  if(photo.origin==='autonomous'&&!photo.publicationIntent&&(!job||!['queued','submitted','rendered'].includes(job.status))){result.saved.push(entry);continue;}
  if(job&&['unknown','failed'].includes(job.status)||photo.status==='submitted'&&!job)result.interrupted.push(entry);
  else if(job&&['queued','submitted','rendered'].includes(job.status))result.running.push(entry);
  else if(photo.status==='captured')result.waiting.push(entry);
 }
 return result;
}
function vh2ImageJobPresentation(photo,job){
 if(photo?.referenceBinding?.status==='needs_attention')return {title:'Image saved · reference needs attention',detail:photo.referenceBinding.error||'The image is saved, but its reference-library entry could not be linked.',state:'ready'};
 if(photo?.assetId||job?.status==='succeeded')return {title:'Ready',detail:'Saved to this life.',state:'ready'};
 if(job?.status==='submitted'&&!job.providerAccepted&&job.referenceProgress)return {title:'Preparing references',detail:job.referenceProgress.message||'Uploading references before generation.',state:'working'};
 if(job?.status==='submitted'&&job.providerAccepted)return {title:'Generating image',detail:'Accepted by the provider. The result will save here automatically.',state:'working'};
 const states={queued:['Queued locally','Waiting for a worker. The provider has not accepted this request yet.','working'],submitted:['Submitting to provider','The request is in progress. Provider acceptance is not yet confirmed.','working'],rendered:['Saving image','The image has returned and is being imported.','working'],failed:['Could not generate',job?.error||'The generation failed.','failed'],unknown:['Outcome unconfirmed',job?.error||'The connection ended before a result was confirmed.','failed']};
 const value=states[job?.status]||(photo?.status==='abandoned'?['Dismissed','This attempt is closed.','closed']:photo?.status==='submitted'?['Interrupted','This saved capture has no recoverable result yet.','failed']:[photo?.origin==='autonomous'&&!photo?.publicationIntent?'Saved idea · not generating':'Ready to generate','Uses the saved moment and its original references.','waiting']);
 return {title:value[0],detail:value[1],state:value[2]};
}
function vh2ImageBudgetText(p={}){
 const b=p.autonomousBudget;
 return 'Automatic photos: '+(p.enabled?(b?`${b.used} / ${b.limit} today`:`up to ${p.dailyLimit||4} per day`):'off')+'. Manual generation is outside this allowance.';
}
async function vh2OpenImageSettings(companion,timeline){
 const d=vhProductDialog('Image settings','Choose the renderer for this life. Automatic photos have a daily allowance; images you generate yourself are separate.');
 d.classList.add('vh-image-settings');const form=d.querySelector('form');form.onsubmit=e=>e.preventDefault();
 vh2ImageSettingsFields(form,companion,timeline);
}
async function vh2OpenImageActivity(companion,timeline=getActiveCompanionTimeline(companion.id)){
 if(!timeline?.vh2)return;
 const d=vhProductDialog('Image activity','Follow each image from its saved moment to its result. You can close this window while generation continues.');d.classList.add('vh-image-activity');
 const form=d.querySelector('form'),status=d.querySelector('[role=status]');form.onsubmit=e=>e.preventDefault();status.setAttribute('aria-live','polite');
 const toolbar=document.createElement('div');toolbar.className='vh-image-toolbar';
 const info=document.createElement('div'),providerLabel=document.createElement('strong'),budget=document.createElement('p');info.append(providerLabel,budget);
 const settings=document.createElement('button');settings.type='button';settings.textContent='Image settings';settings.onclick=()=>vh2OpenImageSettings(companion,timeline);
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh';toolbar.append(info,settings,refresh);form.append(toolbar);
 const list=document.createElement('div');list.className='vh-image-list';form.append(list);const cards=new Map();let refreshing=false,busy=0,timer;
 function updateHeader(){const p=timeline.vh2.imageProvider||{};providerLabel.textContent=p.configured||p.provider?`${p.provider} · ${p.model==='provider default'?((p.arguments?.params||p.arguments||{}).model||(p.arguments?.params||p.arguments||{}).mode||'Tool model'):p.model||'Choose a model'}`:'Choose an image renderer';budget.textContent=vh2ImageBudgetText(p);}
 const paint=()=>{
  updateHeader();const photos=timeline.vh2.photos||[],jobs=timeline.vh2.providerJobs||[];
  const findJob=id=>jobs.find(j=>j.photoId===id||j.id==='image:'+id);
  for(const photo of photos.filter(p=>['captured','submitted'].includes(p.status)||p.referenceBinding?.status==='needs_attention'))if(!cards.has(photo.id)&&![...cards.values()].some(c=>c.id===photo.id))makeCard(photo,findJob(photo.id));
  for(const card of cards.values()){
   if(card.busy)continue;if(card.commandError){card.badge.textContent='Not submitted';card.detail.textContent=card.commandError;continue;}const photo=photos.find(p=>p.id===card.id);if(!photo)continue;
   const job=findJob(photo.id),view=vh2ImageJobPresentation(photo,job);card.row.dataset.state=view.state;card.badge.textContent=view.title;card.detail.textContent=view.detail;
   const posted=(timeline.vh2.socialPosts||[]).some(p=>p.photoId===photo.id&&p.status==='published');
   card.purpose.textContent=posted?'Shared on the social feed':photo.publicationIntent?'Selected for a social post · '+photo.publicationIntent.reason:photo.destination==='private_chat'?'Private photo for the conversation':photo.destination==='reference'?'Production reference for the character library':'Personal gallery idea · not posted or sent. Generation is optional.';
   card.meta.textContent=[photo.photoContext?.placeLabel,photo.at?new Date(photo.at).toLocaleString():'',photo.origin==='autonomous'?'Saved by the character':'Requested manually',job?.providerJobIds?.length?'Provider job: '+job.providerJobIds.join(', '):''].filter(Boolean).join(' · ');
   const canGenerate=['failed','waiting'].includes(view.state),bindingIssue=photo.referenceBinding?.status==='needs_attention';card.actions.hidden=!canGenerate&&!bindingIssue;card.generate.hidden=!canGenerate;card.actions.querySelector('[data-dismiss]').hidden=!canGenerate;card.recovery.hidden=view.state!=='failed';
   let repair=card.actions.querySelector('[data-binding-repair]');if(bindingIssue&&!repair){repair=document.createElement('button');repair.type='button';repair.dataset.bindingRepair='';repair.textContent='Open Reference Library';repair.onclick=()=>{d.close();vhOpenWorkspace('references',companion.id);};card.actions.append(repair);}if(repair)repair.hidden=!bindingIssue;
   card.generate.textContent=view.state==='waiting'?'Generate image':'Generate again';card.generate.dataset.command=view.state==='waiting'?'queue_photo_render':'retry_photo_render';
   card.uncertain.hidden=job?.status!=='unknown'&&!(photo.status==='submitted'&&!job);
   if(photo.assetId&&!card.row.querySelector('img')){const image=document.createElement('img');image.src=vh2PhotoAssetUrl(timeline.vh2.worldId,photo.assetId);image.alt=photo.scene||'Generated image';card.row.append(image);}
  }
  let empty=list.querySelector('.vh-image-empty');if(!cards.size&&!empty){empty=document.createElement('p');empty.className='vh-image-empty';empty.textContent='No unfinished images. New captures will appear here.';list.append(empty);}if(cards.size&&empty)empty.remove();
 };
 function makeCard(photo,job){
  const row=document.createElement('article');row.className='vh-activity-image-card';const heading=document.createElement('div');heading.className='vh-activity-image-heading';const title=document.createElement('h3');title.textContent=photo.scene||'Saved photo moment';const badge=document.createElement('span');badge.className='vh-image-state';heading.append(title,badge);
  const detail=document.createElement('p'),meta=document.createElement('small');detail.setAttribute('role','status');detail.setAttribute('aria-live','polite');const uncertain=document.createElement('p');uncertain.className='vh-image-caution';uncertain.textContent='The previous attempt may have used provider credits. Generate again creates a new paid attempt.';
  const actions=document.createElement('div');actions.className='vh-image-actions';const generate=document.createElement('button'),dismiss=document.createElement('button');generate.type=dismiss.type='button';generate.className='vh-image-primary';dismiss.textContent='Dismiss';dismiss.dataset.dismiss='';actions.append(generate,dismiss);
  const recovery=document.createElement('details');recovery.className='vh-image-recovery';const summary=document.createElement('summary');summary.textContent='Have the image already?';const label=document.createElement('label');label.textContent='Import an existing image';const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';label.append(file);recovery.append(summary,label);
  const purpose=document.createElement('p');purpose.className='vh-image-purpose';row.append(heading,meta,purpose,detail,uncertain,actions,recovery);list.append(row);const card={id:photo.id,row,badge,detail,meta,purpose,uncertain,actions,generate,recovery,busy:false};cards.set(photo.id,card);
  async function run(type,extra={}){
   card.commandError='';card.busy=true;busy++;row.querySelectorAll('button,input').forEach(b=>b.disabled=true);detail.textContent='Saving request…';badge.textContent='Saving';
   try{
    const receipt=await vhUiCommand(timeline,type,{photoId:card.id,...extra});
    if(type==='retry_photo_render'&&!receipt?.photoId)throw Error('The new attempt ID was not confirmed. Refresh activity before retrying.');
    if(receipt?.photoId)card.id=receipt.photoId;
    await refreshData();status.textContent=type==='dismiss_photo_render'?'Attempt dismissed.':type==='import_photo'?'Image imported.':'Request saved. Follow its status below.';
   }catch(error){if(error.commandAcknowledged&&error.receipt?.photoId){card.id=error.receipt.photoId;badge.textContent='Saved';detail.textContent='Request saved. Reconnecting for its status…';}else{card.commandError=error.message;detail.textContent=error.message;badge.textContent='Not submitted';}status.textContent=error.message;}
   finally{card.busy=false;busy--;row.querySelectorAll('button,input').forEach(b=>b.disabled=false);}
   // Paint only confirmed changes; keep command errors visible until the next refresh.
   if(status.textContent==='Request saved. Follow its status below.'||status.textContent==='Attempt dismissed.'||status.textContent==='Image imported.')paint();
  }
  generate.onclick=()=>run(generate.dataset.command);dismiss.onclick=()=>run('dismiss_photo_render');
  file.onchange=()=>{const f=file.files?.[0];if(!f)return;if(f.size>8500000){detail.textContent='Choose an image smaller than 8.5 MB.';return;}const reader=new FileReader();reader.onload=()=>run('import_photo',{image:reader.result});reader.onerror=()=>{detail.textContent='Could not read the image.';};reader.readAsDataURL(f);};
 }
 async function refreshData(){
  if(refreshing)return;refreshing=true;refresh.disabled=true;
  try{await vh2Poll(companion,timeline,{force:true,throwOnError:true});if(d.isConnected)paint();}
  catch(error){status.textContent='Could not refresh: '+error.message;}
  finally{refreshing=false;refresh.disabled=false;}
 }
 refresh.onclick=refreshData;
 function schedule(){timer=setTimeout(async()=>{if(!d.open)return;if(!busy&&document.visibilityState!=='hidden')await refreshData();schedule();},4000);}
 d.addEventListener('close',()=>clearTimeout(timer),{once:true});paint();refreshData();schedule();
}
