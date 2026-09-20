'use strict';
const $=id=>document.getElementById(id);
let providerState=null,providerVersion=null;
let selected=null, projection=null, busy=false, pending=null, incompatible=false, policyKey=null;
try{pending=JSON.parse(sessionStorage.getItem('vh2-pending-command')||'null');if(pending?.worldId)selected=pending.worldId;}catch{}
async function api(path,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{const r=await fetch(path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:controller.signal});let data;
  try{data=await r.json();}catch{throw Error('The local service returned an unreadable response. Any pending command is retained for safe retry.');}
  if(!r.ok){const e=Error(data.error||'World service unavailable');e.status=r.status;throw e;}return data;
 }catch(error){if(controller.signal.aborted)throw Error('The local service timed out. Any pending command is retained; reconnect and retry it.');throw error;}
 finally{clearTimeout(timer);}
}
function text(id,value){$(id).textContent=value;}
async function refresh(){
    const status=await api('/vh2/status');
    try{await refreshProvider();}catch(error){providerState=null;text('provider-status','Provider status unavailable: '+error.message);}
    text('notice',status.lastError||status.dialogueError||status.worlds.map(w=>w.error).filter(Boolean).join('; '));
    if(!selected&&status.worlds.length)selected=status.worlds[0].worldId;
    $('worlds').replaceChildren(...status.worlds.map(w=>{const b=document.createElement('button');b.className='world';b.disabled=busy;b.textContent=w.name+(w.running?' · Running':' · Paused');b.setAttribute('aria-pressed',String(w.worldId===selected));b.onclick=()=>perform(async()=>{selected=w.worldId;await refresh();});return b;}));
    try{await refreshCheckpoints();}catch(error){text('checkpoints','Backups unavailable: '+error.message);}
    if(!selected)return;
    projection=await api('/vh2/projection?worldId='+encodeURIComponent(selected));
    const s=projection.state,p=s.truth.present;
    incompatible=s.kernelVersion!==status.kernelVersion;
    $('upgrade').classList.toggle('hidden',!incompatible);
    if(incompatible)text('notice','This test world uses an older engine. Upgrade creates a saved checkpoint and leaves the world paused.');
    const policy=s.truth.companion.vh2Decision?.policy;
    const key=selected+JSON.stringify(policy);
    if(key!==policyKey){for(const input of document.querySelectorAll('[data-policy]'))input.value=policy?.[input.dataset.policy]??'';policyKey=key;}
    text('decision',JSON.stringify(s.truth.companion.vh2Decision?.choice||{note:'No sampled decision yet.'},null,2));
    const attentionAt=s.communication?.nextAt,lifeWake=s.truth.nextWake;
    const next=attentionAt&&attentionAt<(lifeWake?.at||Infinity)?{at:attentionAt,reasons:['message attention']}:lifeWake;
    text('wake',next?`Next evaluation: ${new Date(next.at).toLocaleTimeString()} · ${next.reasons.join(', ')}`:'No boundary available until upgrade.');
    $('empty').classList.add('hidden');$('detail').classList.remove('hidden');
    text('mode',s.running?'Running in the local service':'Paused');text('person',s.truth.companion.name);
    text('situation',`${p.activity||'At home'} · ${p.availability||'available'}`);
    text('clock',`${new Date(s.simAt).toLocaleString()} · Revision ${projection.revision}`);
    $('metrics').replaceChildren(...['energy','hunger','stress'].map(k=>{const box=document.createElement('div');box.className='metric';const label=document.createElement('small');label.textContent=k[0].toUpperCase()+k.slice(1);const n=document.createElement('strong');n.textContent=Math.round(p.needs[k]);const meter=document.createElement('meter');meter.min=0;meter.max=100;meter.value=p.needs[k];meter.setAttribute('aria-label',k);box.append(label,n,meter);return box;}));
    text('running',s.running?'Pause world':'Run world');$('advance').disabled=s.running;
    const recorded=[];let after=Math.max(0,projection.revision-100);
    const log=await api(`/vh2/events?worldId=${encodeURIComponent(selected)}&after=${after}`);
    for(const event of log.events)for(const outcome of event.payload.details.outcomes||[])recorded.push(outcome);
    $('events').replaceChildren(...recorded.slice(-12).reverse().map(e=>{const li=document.createElement('li');li.textContent=`${new Date(e.at||s.simAt).toLocaleTimeString()} — ${e.summary||e.kind}`;return li;}));
    if(!recorded.length){const li=document.createElement('li');li.textContent='No activity outcomes recorded in the recent event window.';$('events').append(li);}
    const inbox=s.communication||{};
    $('messages').replaceChildren(...(inbox.messages||[]).slice(-40).map(m=>{
        const li=document.createElement('li'),label=document.createElement('strong'),body=document.createElement('div'),state=document.createElement('small');
        label.textContent=m.role==='user'?'You':s.truth.companion.name+(m.origin==='offline_worker'?' · offline worker':m.origin==='model_worker'?'':' · operator test');
        body.textContent=m.text;
        state.textContent=m.role==='user'?`${m.readAt?'Read':'Unread'} · ${m.attention?.stage||'received'} · ${m.attention?.reason||''}`:'Delivered';
        li.append(label,body,state);return li;
    }));
    const jobs=await api('/vh2/dialogue-jobs?worldId='+encodeURIComponent(selected));
    $('dialogue-jobs').replaceChildren(...jobs.jobs.map(j=>{const li=document.createElement('li');li.textContent=`${j.status} · attempt ${j.attempt}${j.reason?' · '+j.reason:''}`;return li;}));
    const draft=inbox.draft;
    text('draft-status',draft?`Staged: ${draft.text} · ${draft.contextRevision===projection.revision?'Ready for delivery':'Context changed; stage again'}`:'No staged reply.');
    text('context',JSON.stringify(await api('/vh2/context?worldId='+encodeURIComponent(selected)),null,2));
    text('entities',JSON.stringify(await api('/vh2/entities?worldId='+encodeURIComponent(selected)),null,2));
    text('state',JSON.stringify({revision:projection.revision,kernel:s.kernelVersion,beliefs:s.beliefs,memories:s.memories,playerKnowledge:s.playerKnowledge,current:p},null,2));
}
async function perform(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){text('notice',e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('advance').disabled=!!projection?.state.running||!!pending;$('retry').classList.toggle('hidden',!pending);$('save-checkpoint').disabled=!archiveReport?.canCheckpoint;$('save-policy').disabled=!!projection?.state.running||incompatible||!!pending;$('running').disabled=incompatible;$('advance').disabled ||= incompatible;updateCommunicationControls();if(pending){$('running').disabled=true;document.querySelector('#create button').disabled=true;}}}
async function sendPending(){
    let result;
    try{result=await api('/vh2/command',pending);}catch(e){
        if(e.status>=400&&e.status<500){pending=null;sessionStorage.removeItem('vh2-pending-command');}
        throw e;
    }
    pending=null;sessionStorage.removeItem('vh2-pending-command');selected=result.worldId;if(result.checkpointId){$('kernel-backup').href='/vh2/kernel-checkpoint?id='+encodeURIComponent(result.checkpointId);$('kernel-backup').classList.remove('hidden');}await refresh();
}
async function command(type,params){
    if(pending)throw Error('Retry the pending command before sending another.');
    pending={schemaVersion:1,key:crypto.randomUUID(),type,worldId:selected,expectedRevision:projection?.revision,...params};
    sessionStorage.setItem('vh2-pending-command',JSON.stringify(pending));await sendPending();
}
function updateCommunicationControls(){
    const inbox=projection?.state.communication;
    const disabled=!!pending||incompatible||!inbox;
    const ready=inbox?.messages.some(m=>m.awaitingReply&&m.attention?.stage==='ready');
    $('send-message').disabled=disabled;
    const active=['queued','leased','submitted','unknown'].includes(inbox?.replyJob?.status);
    $('generate-model').disabled=disabled||!ready||active||!providerState?.enabled||providerState.usedToday>=providerState.dailyLimit;
    $('dismiss-unknown').classList.toggle('hidden',inbox?.replyJob?.status!=='unknown');
    $('dismiss-unknown').disabled=disabled;
    text('model-health',inbox?.replyJob?.status==='unknown'?'The provider may have billed this request. Acknowledge to clear the blocked job; this does not retry it.':providerState?.enabled?`${providerState.model} · ${providerState.usedToday}/${providerState.dailyLimit} requests today`:'Model generation is disabled. Configure it below to enable explicit requests.');
    $('queue-dialogue').disabled=disabled||!ready||['queued','leased','submitted','unknown'].includes(inbox?.replyJob?.status);
    $('stage-reply').disabled=disabled||projection?.state.running||!ready;
    $('deliver-reply').disabled=disabled||projection?.state.running||!ready||inbox?.draft?.contextRevision!==projection?.revision;
}
async function refreshProvider(){
    providerState=await api('/vh2/dialogue-provider');
    if(providerVersion!==providerState.version){
        if(providerState.configured){
            for(const [id,key] of [['base','baseUrl'],['model','model'],['tokens','maxTokens'],['limit','dailyLimit'],['temperature','temperature']])$('provider-'+id).value=providerState[key];
            $('provider-enabled').checked=providerState.enabled;
        }
        providerVersion=providerState.version;
    }
    text('provider-status',providerState.configured?`${providerState.enabled?'Enabled':'Disabled'} · ${providerState.hasKey?'Key saved':'No key saved'} · ${providerState.usedToday}/${providerState.dailyLimit} requests today`:'No dialogue provider configured.');
}
$('provider-form').onsubmit=e=>{e.preventDefault();perform(async()=>{
    await api('/vh2/dialogue-provider',{baseUrl:$('provider-base').value,model:$('provider-model').value,apiKey:$('provider-key').value,clearKey:$('provider-clear').checked,enabled:$('provider-enabled').checked,maxTokens:Number($('provider-tokens').value),dailyLimit:Number($('provider-limit').value),temperature:Number($('provider-temperature').value)});
    $('provider-key').value='';$('provider-clear').checked=false;await refresh();
});};
$('generate-model').onclick=()=>perform(()=>command('queue_dialogue',{adapter:'chat_completions'}));
$('dismiss-unknown').onclick=()=>perform(()=>command('dismiss_unknown_dialogue',{jobId:projection.state.communication.replyJob.id}));
$('message-form').onsubmit=e=>{e.preventDefault();const value=$('message-text').value;perform(async()=>{await command('receive_message',{text:value});if($('message-text').value===value)$('message-text').value='';});};
$('reply-form').onsubmit=e=>{e.preventDefault();perform(()=>command('stage_reply',{text:$('reply-text').value,sourceMessageIds:projection.state.communication.messages.filter(m=>m.awaitingReply&&m.attention?.stage==='ready').map(m=>m.id)}));};
$('queue-dialogue').onclick=()=>perform(()=>command('queue_dialogue',{adapter:'offline_fixture',text:$('reply-text').value}));
$('deliver-reply').onclick=()=>perform(()=>command('deliver_reply',{draftId:projection.state.communication.draft.id}));
$('upgrade').onclick=()=>perform(()=>command('upgrade_kernel',{}));
$('policy-form').onsubmit=e=>{e.preventDefault();perform(()=>command('configure_decisions',{policy:Object.fromEntries([...document.querySelectorAll('[data-policy]')].map(i=>[i.dataset.policy,Number(i.value)]))}));};
$('retry').onclick=()=>perform(sendPending);
$('create').onsubmit=e=>{e.preventDefault();perform(()=>command('create',{name:$('name').value}));};
$('running').onclick=()=>perform(()=>command('set_running',{running:!projection.state.running}));
$('advance').onclick=()=>perform(()=>command('advance',{steps:12}));
$('refresh').onclick=()=>perform(refresh);
let archiveText=null,archiveReport=null;
async function refreshCheckpoints(){
    const result=await api('/vh2/checkpoints');
    $('checkpoints').replaceChildren(...result.checkpoints.map(c=>{
        const p=document.createElement('p'),a=document.createElement('a');
        a.href='/vh2/checkpoint/source?id='+encodeURIComponent(c.checkpointId);
        a.download='vh1-source-'+c.checkpointId.slice(0,12)+'.horde_human';
        a.textContent=c.report.name+' · Download original';
        p.append(a,document.createTextNode(' · '+c.report.counts.timelines+' timelines · '+new Date(c.createdAt).toLocaleString()));return p;
    }));
    if(!result.checkpoints.length)text('checkpoints','No source checkpoints saved.');
}
let archiveSelection=0;
$('archive').onchange=async()=>{
    const selection=++archiveSelection,file=$('archive').files[0];
    while(busy)await new Promise(resolve=>setTimeout(resolve,25));
    if(selection!==archiveSelection)return;
    return perform(async()=>{
    archiveText=null;archiveReport=null;$('migration-report').classList.add('hidden');
    if(!file)return;
    if(file.size>12*1024*1024)throw Error('This preview supports archives up to 12 MB; larger media archives need the future streaming importer.');
    // Reject invalid UTF-8 instead of silently replacing bytes in the original checkpoint.
    archiveText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
    const report=await api('/vh2/migration/preview',{sourceText:archiveText});
    if(selection!==archiveSelection)return;
    archiveReport=report;
    text('migration-name',archiveReport.name+' · '+archiveReport.kind);
    text('migration-counts',`${archiveReport.counts.timelines} timelines · ${archiveReport.counts.places} places · ${archiveReport.counts.items} items`);
    $('migration-issues').replaceChildren(...archiveReport.issues.map(issue=>{const li=document.createElement('li');li.textContent=`${issue.severity}: ${issue.message} (${issue.path})`;return li;}));
    text('migration-status',archiveReport.activationReason);$('migration-report').classList.remove('hidden');
});};
$('save-checkpoint').onclick=()=>perform(async()=>{
    if(!archiveReport?.canCheckpoint)return;
    await api('/vh2/migration/checkpoint',{sourceText:archiveText,expectedDigest:archiveReport.archiveDigest});
    text('migration-status','Original archive checkpoint saved. No character was converted or activated.');
    await refreshCheckpoints();
});
let lastPollAt=Date.now();
perform(refresh);setInterval(()=>{
    const active=['queued','leased','submitted'].includes(projection?.state.communication?.replyJob?.status);
    const interval=active?1000:15000;
    if(!busy&&Date.now()-lastPollAt>=interval){lastPollAt=Date.now();perform(refresh);}
},1000);
