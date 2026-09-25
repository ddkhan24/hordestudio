/* Horde human workspace. UI state only; life changes remain service commands. */
'use strict';
const VH_EXPRESSION_FIELDS=[...new Set([...VH2_PROFILE_TRANSFER_FIELDS,'regulationProfile','conflictRecovery','emotionExpression','ruminationStyle','reactionTiming','emotionalGranularity','appearance','personality','behaviorExamples','description','backstory','chatStyle','textingStyle','conversationStyle','chatExamples','chatAvoid','chatLength','values','contradictions','vulnerabilities','relationshipStyle','habits','photoStyle','photoDirection'])];
const vhStudioSaves=new Map(),vhStudioLifeSyncs=new Map(),vhStudioEditVersions=new Map();
function vhIsCreationDraft(companion){
 if(!companion)return false;
 const hasConversation=typeof getCompanionThread==='function'&&getCompanionThread(companion.id).length>0;
 return !hasConversation&&(!String(companion.name||'').trim()||companion.name==='New Virtual Human'||companionReadinessIssues(companion).length>0);
}
function vhIsBlankCreation(companion){
 if(!companion||!['','New Virtual Human'].includes(String(companion.name||'').trim()))return false;
 return !['personality','backstory','appearance','occupation','socialWorld','profilePhoto','basePhoto']
  .some(key=>String(companion[key]||'').trim());
}
function vhExpressionFields(companion){const fields={};for(const key of VH_EXPRESSION_FIELDS)if(companion[key]!==undefined)fields[key]=safeJsonClone(companion[key]);if(companion.lifeProfile?.world?.voice)fields.voice=safeJsonClone(companion.lifeProfile.world.voice);return fields;}
async function vhApplyExpression(companion,timeline){
 if(!timeline?.vh2)throw Error('Select a persistent life first.');
 const fields=vhExpressionFields(companion);
 // Flush returns only after the command receipt, unlike a poll which may be busy.
 await vh2Enqueue(timeline,'configure_expression_profile',{fields});await vh2Flush(timeline);
 if(timeline.vh2.outbox.some(c=>c.type==='configure_expression_profile'))throw Error('The change is queued but not yet acknowledged. Reconnect before continuing.');
 const projection=await vh2Request(timeline,'/vh2/projection?worldId='+encodeURIComponent(timeline.vh2.worldId));
 const actual=projection.state.truth.companion;
 const stable=v=>JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;})(v));
 for(const [key,value] of Object.entries(fields))if(stable(key==='voice'?actual.lifeProfile.world.voice:actual[key])!==stable(value))throw Error('The active expression differs from this draft. Reload the life before applying again.');
 if(timeline.vh2.imageProvider?.configured&&timeline.vh2.imageStudioFingerprint!==undefined&&timeline.vh2.imageStudioFingerprint!==vh2ImageStudioFingerprint(companion))await vh2SyncImageConfiguration(companion,timeline,{fromStudio:true});
 timeline.vh2.expressionApplied={revision:projection.revision,at:Date.now()};await (typeof saveVirtualHumansState==='function'?saveVirtualHumansState():saveState());await vh2Poll(companion,timeline);return projection.revision;
}
function vhStudioStatus(companionId,message,error=false,throughVersion=null){
 if(state.editingCompanionId!==companionId)return;
 if(throughVersion!==null&&(vhStudioEditVersions.get(companionId)||0)>throughVersion)return;
 const status=document.getElementById('vh-save-status');if(!status)return;
 status.textContent=message;if(error)status.setAttribute('data-error','true');else status.removeAttribute('data-error');
}
function vhQueueStudioLifeSync(companion,timeline,version){
 const key=companion.id+'|'+timeline.id,existing=vhStudioLifeSyncs.get(key);
 if(existing){existing.version=Math.max(existing.version,version);return existing.promise;}
 const job={version,promise:null};
 job.promise=(async()=>{
  let applied=-1,lastRevision=null;
  while(applied<job.version){const target=job.version;lastRevision=await vhApplyExpression(companion,timeline);applied=target;}
  vhStudioStatus(companion.id,`Saved. Current life updated at revision ${lastRevision}.`,false,applied);return true;
 })().catch(error=>{console.error('Virtual Human active-life sync failed:',error);if(typeof vhRecordIssue==='function')vhRecordIssue('Update current life',error);vhStudioStatus(companion.id,`Human saved on this device. Current life update needs attention: ${error.message}`,true,job.version);return false;}).finally(()=>{if(vhStudioLifeSyncs.get(key)===job)vhStudioLifeSyncs.delete(key);});
 vhStudioLifeSyncs.set(key,job);return job.promise;
}
function vhStudioScope(companion){
 if(!companion||typeof document==='undefined')return;
 const studioView=document.getElementById('companion-studio-view');
 if(studioView)studioView.classList.toggle('is-creating',vhIsCreationDraft(companion));
 const parent=document.querySelector('#companion-studio-view .studio-content-wrap');if(!parent)return;
 let banner=document.getElementById('vh-studio-scope');
 if(!banner){banner=document.createElement('section');banner.id='vh-studio-scope';banner.className='vh-scope-banner';banner.innerHTML='<div><strong data-scope-title></strong><p data-scope-help></p></div><label>Save destination<select id="vh-save-scope"><option value="active">Template + this life’s expression</option><option value="template">Character template only</option></select></label><p id="vh-save-status" role="status" aria-live="polite"></p>';parent.prepend(banner);}
 const timeline=getActiveCompanionTimeline(companion.id),linked=!!timeline?.vh2;banner.dataset.linked=String(linked);
 if(banner.dataset.companion!==companion.id||banner.dataset.timeline!==timeline?.id){banner.dataset.companion=companion.id;banner.dataset.timeline=timeline?.id||'';const saveScope=banner.querySelector('#vh-save-scope');if(saveScope)saveScope.value=linked?'active':'template';const saveStatus=banner.querySelector('#vh-save-status');if(saveStatus)saveStatus.textContent='';}
 banner.querySelector('[data-scope-title]').textContent=linked?`Editing ${companion.name} · ${timeline.name||'current life'}`:`Editing ${companion.name}`;
 banner.querySelector('[data-scope-help]').textContent=linked?'Save updates this person and the current life’s expression. Edit routines, places and references in Life.':'Author the person, their relationship context, expressive behavior, autonomous life, media systems, and runtime.';
 const select=banner.querySelector('select');if(select){select.closest('label').hidden=!linked;select.options[0].disabled=!linked;select.disabled=!linked;}
 let destinations=banner.querySelector('[data-life-links]');
 if(!destinations){destinations=document.createElement('nav');destinations.dataset.lifeLinks='';destinations.className='vh-studio-destinations';destinations.setAttribute('aria-label','Life tools');banner.append(destinations);}
 destinations.hidden=!linked;destinations.replaceChildren();
 for(const [section,label] of [['references','Reference Library / Bible'],['connections','Providers, feeds & events']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{if(!await vhSaveStudio())return;vhOpenWorkspace(section,companion.id);};destinations.append(b);}
 vhRenderPrimaryBar(companion,'studio');vhStudioSetupOverview(companion);
 const save=document.getElementById('save-companion-btn');if(save){save.textContent=linked?'Save changes':'Save human';save.disabled=vhStudioSaves.has(companion.id);}
 const remove=document.getElementById('delete-companion-btn');if(remove)remove.textContent=vhIsCreationDraft(companion)?'Discard draft':'Delete human';
}
async function vhSaveStudio(){
 const status=document.getElementById('vh-save-status'),button=document.getElementById('save-companion-btn');
 const fieldProblem=typeof vhAuthoringFieldProblem==='function'?vhAuthoringFieldProblem():'';
 if(fieldProblem){if(status){status.textContent=fieldProblem;status.setAttribute('data-error','true');}return false;}
 const companion=commitCompanionStudioForm();
 if(!companion){
   if(status){status.textContent='No Virtual Human selected to save.';status.setAttribute('data-error','true');}
   return false;
 }
 const version=vhStudioEditVersions.get(companion.id)||0,existing=vhStudioSaves.get(companion.id);
 if(existing){
   if(status){status.removeAttribute('data-error');status.textContent='Finishing the current device save…';}
   const saved=await existing.promise;
   if(!saved)return false;
   return (vhStudioEditVersions.get(companion.id)||0)>existing.version?vhSaveStudio():true;
 }
 const timeline=getActiveCompanionTimeline(companion.id),scope=document.getElementById('vh-save-scope')?.value;
 if(button)button.disabled=true;
 const operation=(async()=>{
  try{if(status){status.removeAttribute('data-error');status.textContent='Saving human on this device…';}await (typeof saveCompanionTemplatesState==='function'?saveCompanionTemplatesState():saveState());
   if(scope==='active'&&timeline?.vh2){vhStudioStatus(companion.id,'Saved on this device. Updating the current life in the background…',false,version);void vhQueueStudioLifeSync(companion,timeline,version);}
   else vhStudioStatus(companion.id,'Saved human. Existing persistent lives were not changed.',false,version);
   return true;
  }catch(error){console.error('Virtual Human studio save failed:', error);if(typeof vhRecordIssue==='function')vhRecordIssue('Save human',error);vhStudioStatus(companion.id,`Human was not saved. ${error.message} Your draft is retained.`,true);return false;}
 })();
 const entry={promise:operation,version};vhStudioSaves.set(companion.id,entry);
 try{return await operation;}finally{if(vhStudioSaves.get(companion.id)===entry)vhStudioSaves.delete(companion.id);if(button)button.disabled=false;}
}
const VH_WORKSPACE_SECTIONS={
 overview:['Overview','This life at a glance. System health is separate from character availability.'],
 life:['Routine & goals','Commitments, everyday activities and plans for this life.'],
 people:['People','Known people, introductions and independent social lives.'],
 places:['Places','Linked places, room zones, routes and local time.'],
 closet:['Wardrobe','Style presets, saved outfits and clothes they own.'],
 possessions:['Gifts & possessions','Food, tickets, vehicles and other belongings.'],
 money:['Money','Balances, purchases and recurring expenses.'],
 references:['Reference Library','Character sheets, portraits, rooms and props—organized automatically.'],
 media:['Media','Author view: captured moments, generation jobs and publishing controls.'],
 connections:['Providers, feeds & events','Ticketmaster events, RSS feeds, images, Maps and world information.'],
 inspector:['Inspector','Author-only decisions, internal state, memory and diagnostics.'],
 recovery:['Always-on server','Move this running life to your private server, switch it back safely, or manage recovery copies.']
};
const VH_PANEL_GROUPS={
 'Timeline backup & recovery':'recovery','Timeline backup & hosting':'recovery','Cloud hosting & local backup':'recovery','Private server & recovery':'recovery','Bring prior conversation into VH2':'recovery',
 'Scheduled transport':'places','Travel disruption recovery':'life','Overnight visits & vacations':'life',
 'Build room, person, garment & pose references':'references','Photo capture preview':'media','Shared plans':'life',
 'Local people & introductions':'people','Independent people & transport':'people','Friendships, contact & romantic progression':'people',
 'Gifts & money':'possessions','Trips & temporary stays':'life','Autonomous exploration':'life','Institutions & commitments':'life',
 'Flight connection — Aviationstack':'connections','World feeds & awareness':'connections','Supporting-person network':'people',
 'Asset bible':'references','Personal preferences & boundaries':'inspector','Room zones & visual continuity':'places',
 'Purchases, currencies & wardrobe conversion':'money','Background images & routes':'connections','Residence, hometown & local time':'places',
 'Finances & recurring costs':'money','Procedural closet & style profiles':'closet','Saved places & routes':'places',
 'Supporting people’s travel':'people','Visits & encounters':'people','Life expression & spontaneous plans':'life',
 'Relationship pace':'inspector','Conversation emotions':'inspector','Experience and memory':'inspector','Text check-ins':'inspector'
};
let vhWorkspaceSection='overview';
function vhOpenWorkspace(section='overview',id=state.activeCompanionId){
 const companion=getCompanion(id)||state.companions[0];if(!companion){showToast('Create or select a human first.','info');switchView('companions');return;}
 state.activeCompanionId=companion.id;const live=!!getActiveCompanionTimeline(companion.id)?.vh2;vhWorkspaceSection=live&&VH_WORKSPACE_SECTIONS[section]?section:'overview';
 const search=document.getElementById('vh-workspace-search');if(search)search.value='';switchView('vhWorkspace');
}
function vhWorkspaceSelect(section){
    vhAdvancedOpen=false;
    vhWorkspaceSection=section;
    const search=document.getElementById('vh-workspace-search');
    const title=document.getElementById('vh-workspace-title');
    const main=document.querySelector('.vh-workspace-main');
    if (search) search.value='';
    // Section changes only filter the already-built workspace. Rebuilding all
    // life controls here made every sidebar click increasingly expensive.
    const controls=document.getElementById('vh2-chat-controls');
    if(controls?.children.length)vhFilterWorkspace();else vhRenderWorkspace();
    if (main) main.scrollTop=0;
    if (title) title.focus({preventScroll:true});
}
function vhRenderWorkspace(){
     const companion=getCompanion(state.activeCompanionId);if(!companion)return;
     vhRenderPrimaryBar(companion,'life');
     const timeline=getActiveCompanionTimeline(companion.id);
     const linked=!!timeline?.vh2,view=document.getElementById('vh-workspace-view');
     if(view)view.classList.toggle('is-unstarted',!linked);
     const workspaceName=document.getElementById('vh-workspace-name');
     const workspaceLife=document.getElementById('vh-workspace-life');
     const nav=document.getElementById('vh-workspace-nav');
     if(!nav) return;
     if(workspaceName) workspaceName.textContent=companion.name;
     if(workspaceLife) workspaceLife.textContent=linked?`${timeline?.name||'Current timeline'} · Persistent timeline · changes here affect this life`:'Character saved · persistent timeline not started';
     if(!document.getElementById('vh-mobile-section')){const label=document.createElement('label');label.className='vh-mobile-section';label.textContent='Workspace section';const select=document.createElement('select');select.id='vh-mobile-section';for(const [key,[name]] of Object.entries(VH_WORKSPACE_SECTIONS)){const option=document.createElement('option');option.value=key;option.textContent=name;select.append(option);}select.onchange=()=>vhWorkspaceSelect(select.value);label.append(select);nav.before(label);}
     const mobileSelect=document.getElementById('vh-mobile-section');if(mobileSelect){mobileSelect.value=vhWorkspaceSection;mobileSelect.closest('label').hidden=!linked;}
     if(!nav.children.length){
      const groups=[['This life',['overview','life','people','places']],['Belongings',['closet','possessions','money']],['Images & media',['references','media']],['Settings & cloud',['connections','inspector','recovery']]];
      for(const [index,[title,keys]] of groups.entries()){const group=document.createElement(index?'details':'section');group.className='vh-workspace-nav-group';const heading=document.createElement(index?'summary':'h2');heading.textContent=title;group.append(heading);for(const key of keys){const button=document.createElement('button');button.type='button';button.textContent=VH_WORKSPACE_SECTIONS[key][0];button.dataset.section=key;button.onclick=()=>vhWorkspaceSelect(key);group.append(button);}nav.append(group);}
     }
    const backButton=document.querySelector('[data-vh-back-chat]'),editTemplateButton=document.querySelector('[data-vh-edit-template]');
    if(backButton)backButton.onclick=()=>switchView('companionChat');
    if(editTemplateButton)editTemplateButton.onclick=()=>{openCompanionStudio(companion.id);switchView('companionStudio');};
    const searchInput=document.getElementById('vh-workspace-search');
    if(searchInput)searchInput.oninput=()=>vhFilterWorkspace();
    vh2RenderControls(companion);vhFilterWorkspace();
}
function vhArrangeWorkspace(companion,timeline){
 const host=document.getElementById('vh2-chat-controls');if(!host)return;
 for(const node of host.children){const title=node.matches('details')?node.querySelector(':scope > summary')?.textContent:'';node.dataset.workspaceSection=VH_PANEL_GROUPS[title]||'overview';if(node.matches('details')){node.dataset.panelKey=title;node.classList.add('vh-workspace-card');}}
 // Legacy scaffolding isn't an overview. Only explicit recovery/start commands remain there.
 for(const node of host.children)if(!node.matches('details,button'))node.dataset.workspaceSection='inspector';
 for(const node of host.querySelectorAll(':scope > button')){if(node.matches('[data-vh2-pause],[data-vh2-refresh],[data-vh2-create]'))node.dataset.workspaceSection='overview';else node.dataset.workspaceSection='recovery';}
 const sectionInfo=VH_WORKSPACE_SECTIONS[vhWorkspaceSection]||VH_WORKSPACE_SECTIONS.overview;
 const [name,description]=sectionInfo;
 const sectionTitle=document.getElementById('vh-workspace-title');
 const sectionDescription=document.getElementById('vh-workspace-description');
 if(sectionTitle) sectionTitle.textContent=name;
 if(sectionDescription) sectionDescription.textContent=description;
 const overview=document.getElementById('vh-workspace-overview');const link=timeline?.vh2;
 overview.innerHTML=`<div class="vh-overview-grid"><article><span>Active life</span><strong>${escapeHTML(timeline?.name||'Original timeline')}</strong><p>${link?(link.running?(Date.now()-(link.simAt||Date.now())>300000?'Catching up automatically in the background · '+Math.ceil((Date.now()-link.simAt)/60000)+' minutes remaining.':'Running in the background. Missed time catches up automatically.'):'Paused. Resume life to catch up automatically.'):'Original life engine. Your conversation is preserved.'}</p></article><article><span>Connection</span><strong>${link?.error?'Needs attention':link?(link.lastSyncedAt?'Last sync '+new Date(link.lastSyncedAt).toLocaleTimeString():'Connection not yet verified'):'Browser-owned life'}</strong><p>${escapeHTML(link?.error||'Open Connections to review effective providers and limits.')}</p></article><article><span>Your profile</span><strong>${escapeHTML(link?.playerProfile?.name||state.personas.find(p=>p.id===timeline?.personaId)?.name||'Not selected')}</strong><p>Choose the profile shared in this chat from its profile control.</p></article></div>`;
 if(!link)overview.replaceChildren();
 else overview.innerHTML+='<div class="vh-overview-actions"><button type="button" data-open-section="life">Explore this life</button><button type="button" data-open-section="recovery">Always-on private server</button><button type="button" data-open-section="references">Reference Library</button><button type="button" data-open-section="connections">Providers, feeds &amp; events</button><button type="button" data-maps-direct>Maps &amp; places</button><button type="button" data-ticketmaster-direct>Ticketmaster events</button><button type="button" data-reboot-life>Reboot life</button></div>';
 overview.querySelector('[data-maps-direct]')?.addEventListener('click',()=>vhMapsSetup());
 overview.querySelector('[data-ticketmaster-direct]')?.addEventListener('click',()=>vhTicketmasterSetup(companion,(link.signals?.sources||[]).find(s=>s.kind==='ticketmaster')||null));
 overview.querySelector('[data-reboot-life]')?.addEventListener('click',()=>vhRebootLife(companion));
 overview.querySelectorAll('[data-open-section]').forEach(b=>b.onclick=()=>vhWorkspaceSelect(b.dataset.openSection));
 if(link){const statusButton=document.createElement('button');statusButton.type='button';statusButton.textContent='Life status';statusButton.onclick=()=>vhOpenLifeStatus(companion);overview.querySelector('.vh-overview-actions')?.prepend(statusButton);}
 vhFilterWorkspace();
}
function vhFilterWorkspace(){
 const host=document.getElementById('vh2-chat-controls');if(!host)return;
 const linked=!!getActiveCompanionTimeline(state.activeCompanionId)?.vh2;if(!linked)vhWorkspaceSection='overview';
 const info=VH_WORKSPACE_SECTIONS[vhWorkspaceSection]||VH_WORKSPACE_SECTIONS.overview;
 document.getElementById('vh-workspace-title').textContent=linked?info[0]:'Start a persistent life';document.getElementById('vh-workspace-description').textContent=linked?info[1]:'Edit human defines who they are. Live human is the evolving timeline where routines, relationships, places, possessions, memory and events change over time.';
 const mobile=document.getElementById('vh-mobile-section');if(mobile)mobile.value=vhWorkspaceSection;
 const query=(document.getElementById('vh-workspace-search')?.value||'').trim().toLowerCase();
 document.querySelectorAll('#vh-workspace-nav button').forEach(b=>{b.classList.toggle('active',b.dataset.section===vhWorkspaceSection);b.setAttribute('aria-current',b.dataset.section===vhWorkspaceSection?'page':'false');if(b.dataset.section===vhWorkspaceSection&&b.parentElement.tagName==='DETAILS')b.parentElement.open=true;});
 document.getElementById('vh-workspace-overview').hidden=vhWorkspaceSection!=='overview'||!!query||!getActiveCompanionTimeline(state.activeCompanionId)?.vh2;
 for(const el of host.children){const searchable=el.textContent+' '+(VH_WORKSPACE_SECTIONS[el.dataset.workspaceSection]||[]).join(' ');el.hidden=query?!searchable.toLowerCase().includes(query):el.dataset.workspaceSection!==vhWorkspaceSection;}
 let result=document.getElementById('vh-search-result');if(!result){result=document.createElement('p');result.id='vh-search-result';result.setAttribute('role','status');result.setAttribute('aria-live','polite');host.before(result);}
 const count=[...host.children].filter(el=>!el.hidden).length;result.hidden=!query;result.textContent=count?`${count} matching sections across this life. Open a section to edit its settings.`:'No matching settings. Try a broader term such as places, photos or memory.';
 if(typeof vhWorkspaceSpecial==='function')vhWorkspaceSpecial();
 vhWorkspaceProgressive(query);
}
function vhRenderSystemStatus(companion){
 const root=document.getElementById('vh-chat-system');if(!root)return;vhRenderPrimaryBar(companion,'chat');const timeline=getActiveCompanionTimeline(companion.id),link=timeline?.vh2;
 const pending=(timeline?.messages||[]).filter(m=>m.role==='user'&&m.awaitingReply),job=link?.replyJob;
 const attention=pending.slice().reverse().find(m=>m.attention?.reason)?.attention;
 let status='Conversation ready';
 if(link){
  if(link.error)status='Connection needs attention: '+link.error;
  else if(link.dialogueError&&pending.length)status='Reply service needs attention: '+link.dialogueError;
  else if(link.requiresMigration)status='Life update needed before continuing';
  else if(link.outbox?.length)status=`Sending ${link.outbox.length===1?'your change':link.outbox.length+' changes'} — waiting for confirmation`;
  else if(job?.status==='unknown')status='Reply outcome unknown — review before retrying';
  else if(['failed','abandoned','superseded'].includes(job?.status))status='Reply did not finish'+(job.reason?': '+job.reason:'');
  else if(link.running===false)status=pending.length?'Message saved · life is paused, so replies are waiting':'Life is paused';
  else if(['submitted','leased','queued'].includes(job?.status))status='Preparing a reply…';
  else if(pending.length&&link.autoReplies===false)status=attention?.stage==='ready'?'Reply ready · automatic replies are off':'Message saved · automatic replies are off';
  else if(pending.length&&attention?.stage==='ready')status='Reply ready · starting the text model…';
  else if(pending.length)status='Waiting for a reply'+(attention?.reason?': '+attention.reason:'. Check life status for current activity and availability.');
  else status=link.lastSyncedAt?'Connected':'Connecting to this life…';
 }
 root.innerHTML='<span class="'+(link?.error||link?.dialogueError&&pending.length||['failed','unknown','abandoned','superseded'].includes(job?.status)?'is-error':'')+'">'+escapeHTML(status)+'</span><nav aria-label="Life tools"></nav>';
 const activity=document.getElementById('vh-chat-activity');if(activity)activity.hidden=!link;
 const nav=root.querySelector('nav');
 if(link){const statusButton=document.createElement('button');statusButton.type='button';statusButton.textContent='Life status';statusButton.onclick=()=>vhOpenLifeStatus(companion);nav.append(statusButton);}
 if(link?.running!==false&&link?.autoReplies===false&&pending.length){const enable=document.createElement('button');enable.type='button';enable.textContent='Enable replies · may use credits';enable.title='A ready message may use the selected text model and provider credits';enable.onclick=async()=>{enable.disabled=true;enable.textContent='Enabling…';try{await vhSetAutomaticReplies(companion,timeline,true);showToast('Automatic replies enabled. The saved message will continue without being resent.','success');}catch(error){showToast(error.message,'error');}finally{vhRenderSystemStatus(companion);}};nav.append(enable);}
 if(link?.outbox?.length){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry sync';retry.title='Retry saved actions without creating duplicates';retry.onclick=async()=>{retry.disabled=true;retry.textContent='Syncing…';try{await vh2Poll(companion,timeline,{force:true,throwOnError:true});if(link.outbox?.length)showToast('Actions are still awaiting server confirmation.','info');}catch(error){showToast(error.message,'error');}finally{vhRenderSystemStatus(companion);}};nav.append(retry);}
 // Routine destinations live in the person toolbar; recovery remains visible here.
 if(link?.error||link?.dialogueError&&pending.length||['failed','unknown','abandoned','superseded'].includes(link?.replyJob?.status)){const b=document.createElement('button');b.type='button';b.textContent='Resolve issue';b.onclick=()=>vhOpenWorkspace(link?.replyJob||link?.dialogueError?'recovery':'connections',companion.id);nav.append(b);}
 for(const id of ['companion-call-btn','companion-reroll-btn','companion-fork-timeline-btn']){const button=document.getElementById(id);if(button&&link){if(!button.dataset.vhUnsupported){button.dataset.vhPriorTitle=button.title;button.dataset.vhPriorDisabled=String(button.disabled);}button.dataset.vhUnsupported='true';button.disabled=true;button.title='Not supported in VH2 yet.';}else if(button?.dataset.vhUnsupported){button.disabled=button.dataset.vhPriorDisabled==='true';button.title=button.dataset.vhPriorTitle||'';delete button.dataset.vhUnsupported;}}
}
function vhLifeReadiness(link={}){
 const entries=[],add=(id,state,message,destination,action)=>entries.push({id,state,message,destination,action});
 if(link.requiresMigration)add('migration','action','This life needs an engine update.','recovery','Open recovery');
 if(link.error)add('connection','action',String(link.error),'connections','Open connections');
 if(link.dialogueError)add('reply-worker','action',String(link.dialogueError),'recovery','Open recovery');
 if(link.running===false)add('paused','info','Life is paused. Its saved settings and history are retained.','overview','Open life');
 if(link.autoReplies===false)add('replies-off','action','Automatic chat replies are off. Ready messages remain saved until you enable them.','connections','Open conversation settings');
 if(link.agencyPaused)add('agency-paused','info','Automatic activity is paused globally.','settings','Open life settings');
 if(link.outbox?.length)add('sync','waiting',`${link.outbox.length} change${link.outbox.length===1?' is':'s are'} waiting to sync.`,'connections','Open connections');
 const sources=link.signals?.sources||[];
 if(!sources.length)add('feeds-off','info','No live world feeds selected. The simulation can run without them.','connections','Choose world feeds');
 for(const [index,source] of sources.entries()){
  const name=source.kind==='ticketmaster'?'Ticketmaster':source.kind==='gtfs'?'Timetable':source.kind==='aviationstack'?'Flight feed':'World feed';
  if(source.enabled===false||source.kind==='aviationstack'&&link.flightProvider?.enabled===false){add('source:'+index,'info',name+' is off.','connections','Open world feeds');continue;}
  if(source.error)add('source:'+index,'action',name+': '+source.error,'connections','Check world feed');
  else if(!source.lastSuccessAt)add('source:'+index,'waiting',name+' is waiting for its first refresh.','connections','View world feed');
 }
 if(sources.some(source=>source.kind==='aviationstack'&&source.enabled!==false)){
  const flight=link.flightProvider||{};
  if(!flight.enabled)add('flights-off','info','Automatic flight requests are off.','connections','Flight settings');
  else if(!flight.hasKey)add('flight-key','action','The enabled flight feed needs its API key.','connections','Connect flight feed');
  else if(Number.isFinite(flight.dailyLimit)&&flight.usedToday>=flight.dailyLimit)add('flight-budget','waiting','The daily flight allowance is used. Requests resume after the allowance resets.','connections','View flight settings');
 }
 if(link.episodes?.policy?.enabled&&!(link.episodes.opportunities||[]).some(item=>item.enabled&&item.stayAllowed))add('overnight','action','Overnight trips are enabled but no destination allows a stay.','life','Choose trip destinations');
 const images=typeof vh2ImageJobSummary==='function'?vh2ImageJobSummary(link):{interrupted:[],running:[],waiting:[]},provider=link.imageProvider||{},imageWork=images.interrupted.length+images.running.length+images.waiting.length;
 if(!link.bible?.entries?.some(entry=>entry.role==='identity'&&entry.status==='approved'))add('identity',provider.enabled||imageWork?'action':'info','No approved identity reference is available for consistent photos.','references','Open Reference Library');
 if(provider.stale)add('image-status',provider.configured||provider.enabled||imageWork?'action':'info','Image settings could not be refreshed. The last saved connection is retained.','images','Check image settings');
 if(!provider.enabled)add('images-off','info','Automatic photos are off. Manual generation is still available.','images','Image settings');
 if((provider.enabled||imageWork)&&['openrouter','gemini'].includes(provider.provider)&&!provider.hasKey)add('image-key','action','The selected image connection needs its API key.','images','Connect image provider');
 if((provider.enabled||imageWork)&&['magnific','higgsfield'].includes(provider.provider)&&!provider.tool)add('image-tool','action','The selected image connection needs a generation tool.','images','Choose image tool');
 if(provider.enabled&&provider.autonomousBudget?.remaining===0)add('image-budget','waiting','The automatic image allowance is used. Manual generation still works.','images','View image allowance');
 if(images.interrupted.length)add('images-interrupted','action',`${images.interrupted.length} image attempt${images.interrupted.length===1?' needs':'s need'} attention.`,'image-activity','Open Image activity');
 if(images.running.length)add('images-running','waiting',`${images.running.length} image attempt${images.running.length===1?' is':'s are'} in progress. Results import automatically.`,'image-activity','View image progress');
 if(images.waiting.length)add('images-waiting','waiting',`${images.waiting.length} saved photo moment${images.waiting.length===1?' is':'s are'} ready for generation.`,'image-activity','Open saved moments');
 const routes=Object.values(link.people?.actors||{}).filter(person=>person.blockedReason).length;
 if(routes)add('routes','action',`${routes} supporting ${routes===1?'person needs':'people need'} a usable route.`,'places','Check places and routes');
 const drafts=(link.socialPosts||[]).filter(post=>post.status==='draft'&&post.generationError);
 if(drafts.length)add('social-drafts','action',`${drafts.length} social draft${drafts.length===1?' could':'s could'} not be generated.`,'media','Review social drafts');
 for(const quote of Object.values(link.commerce?.quotes||{}))if(quote.expiresAt<Date.now())add('quote:'+quote.base+':'+quote.quote,'info',`${quote.base}/${quote.quote} rate needs refreshing before another currency purchase.`,'money','Open money settings');
 return entries;
}

async function vhSetAutomaticReplies(companion,timeline,enabled){
 if(enabled)await vh2SyncProvider(companion,{timeline});
 await vhUiCommand(timeline,'configure_auto_replies',{enabled});
}
function vhOpenLifeStatus(companion){
 const timeline=getActiveCompanionTimeline(companion.id);if(!timeline?.vh2)return;
 const d=vhProductDialog('Life status','Current activity, saved preferences and issues that need your attention.');d.id='vh-life-status-dialog';const form=d.querySelector('form'),status=d.querySelector('[role=status]');form.onsubmit=event=>event.preventDefault();
 let maintenance=null,maintenanceError='',maintenanceWorldError='',maintenanceDialogueError='';
 const open=entry=>{d.close();if(entry.destination==='images')return vh2OpenImageSettings(companion,timeline);if(entry.destination==='image-activity')return vh2OpenImageActivity(companion,timeline);if(entry.destination==='settings')return vhOpenLifeActivity(companion);vhOpenWorkspace(entry.destination||'overview',companion.id);};
 const render=()=>{form.replaceChildren();const entries=vhLifeReadiness(timeline.vh2),actions=entries.filter(entry=>entry.state==='action');status.textContent=actions.length?`${actions.length} item${actions.length===1?' needs':'s need'} attention.`:'No action needed in the last synced state.';for(const [state,label] of [['action','Needs attention'],['waiting','In progress or waiting'],['info','Saved preferences']]){
  const items=entries.filter(entry=>entry.state===state);if(!items.length)continue;const section=document.createElement('section');section.dataset.readinessState=state;const heading=document.createElement('h3');heading.textContent=label;section.append(heading);for(const entry of items){const row=document.createElement('article');row.className='vh-job-card';const copy=document.createElement('p');copy.textContent=entry.message;const button=document.createElement('button');button.type='button';button.textContent=entry.action;button.onclick=()=>open(entry);row.append(copy,button);section.append(row);}form.append(section);
 }};
 const renderRecovery=()=>{form.querySelector('[data-maintenance]')?.remove();const section=document.createElement('section');section.dataset.maintenance='';const title=document.createElement('h3');title.textContent='Automatic recovery';section.append(title);const records=Object.entries(maintenance||{}).filter(([,r])=>r.state==='recovering');const info=document.createElement('p');info.className='form-hint';info.textContent=maintenanceError||(maintenanceDialogueError?'The reply worker is recovering. The saved message remains in this life. '+maintenanceDialogueError:'')||(maintenanceWorldError?'A life step is waiting for recovery. The service will retry from its saved state; history is preserved. '+maintenanceWorldError:'')||(!maintenance?'Checking background services…':records.length?'A background service is recovering. Life continues independently.':'Background services are healthy. Clock and wakeup recovery run automatically.');section.append(info);for(const [name,r] of records){const p=document.createElement('p');p.textContent=({clock:'Life clock',scheduler:'Life wakeups',media:'Images and routes',feeds:'World feeds',weather:'Weather',social:'Social expression'}[name]||name)+': '+r.error+' · Next check in '+Math.max(0,Math.ceil((r.nextAttemptAt-Date.now())/1000))+'s.';section.append(p);}form.prepend(section);};
 const refreshRecovery=async()=>{try{const result=await vh2Request(timeline,'/vh2/status');maintenance=result.maintenance||{};maintenanceWorldError=(result.worlds||[]).find(w=>w.worldId===timeline.vh2.worldId)?.error||'';maintenanceDialogueError=result.dialogueError||result.lastError||'';maintenanceError='';}catch(error){maintenanceError='Background service status is unavailable. '+error.message;}if(d.open)renderRecovery();};
 const runtime=document.createElement('section');runtime.className='vh-current-card';form.before(runtime);
 const renderRuntime=()=>{runtime.replaceChildren();const link=timeline.vh2,heading=document.createElement('h3');heading.textContent=link.running?'Life is running':'Life is paused';const activity=document.createElement('p');activity.textContent=(link.present?.activity||'No current activity recorded')+' · '+(link.present?.availability||'availability unknown');const pending=(timeline.messages||[]).filter(m=>m.role==='user'&&m.awaitingReply),reply=document.createElement('p');reply.setAttribute('role','status');const attention=pending.find(m=>m.attention?.reason)?.attention;if(link.running===false)reply.textContent='Simulation time and attention timers are paused. Resume life to let waiting messages progress.';else if(link.dialogueError&&pending.length)reply.textContent=link.dialogueError;else if(link.replyJob?.reason)reply.textContent=link.replyJob.reason;else if(link.autoReplies===false&&pending.length)reply.textContent='Automatic replies are off. The message is saved; enable replies in Connections when you want it to continue.';else if(attention?.stage==='ready')reply.textContent='Attention is available and the reply is being handed to the selected text model.';else reply.textContent=attention?.reason||(pending.length?'A message is waiting. Refresh status for the latest attention or generation state.':'No waiting message is recorded.');if(attention?.nextCheckAt>link.simAt&&link.running)reply.textContent+=' Next attention check in about '+Math.max(1,Math.ceil((attention.nextCheckAt-link.simAt)/60000))+' minute(s) of life time; this is not a promised reply time.';const toggle=document.createElement('button');toggle.type='button';toggle.textContent=link.running?'Pause life':'Resume life';toggle.onclick=async()=>{toggle.disabled=true;try{await vhUiCommand(timeline,'set_running',{running:!timeline.vh2.running});renderRuntime();render();await refreshRecovery();}catch(error){reply.textContent=error.message;toggle.disabled=false;}};const routines=document.createElement('button');routines.type='button';routines.textContent='Edit activity and availability';routines.onclick=()=>{d.close();vhOpenWorkspace('life',companion.id);};const reboot=document.createElement('button');reboot.type='button';reboot.textContent='Restart life service state…';reboot.onclick=()=>{d.close();vhRebootLife(companion);};runtime.append(heading,activity,reply,toggle,routines,reboot);};renderRuntime();
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh status';refresh.onclick=async()=>{refresh.disabled=true;status.textContent='Refreshing…';try{await vh2Poll(companion,timeline,{force:true,throwOnError:true});if(d.open){render();renderRuntime();await refreshRecovery();}}catch(error){status.textContent='Could not refresh: '+error.message;}finally{refresh.disabled=false;}};d.querySelector('header').after(refresh);render();renderRecovery();void refreshRecovery();
}
function vhSetupChatActions(){
 const actions=document.querySelector('.companion-chat-actions');if(!actions||document.getElementById('vh-chat-more'))return;
 const more=document.createElement('details');more.id='vh-chat-more';more.innerHTML='<summary class="companion-header-btn" aria-label="More chat actions">•••</summary><div></div>';const life=actions.querySelector('button[onclick]');if(life)life.remove();actions.append(more);
 const inspector=document.getElementById('companion-simulation-btn');if(inspector){actions.insertBefore(inspector,more);inspector.textContent='Relationship';inspector.setAttribute('aria-label','Relationship inspector');inspector.title='Inspect relationship, emotions and memories';inspector.classList.add('vh-direct-inspector');}
 const activity=document.createElement('button');activity.type='button';activity.id='vh-chat-activity';activity.className='companion-header-btn vh-direct-activity';activity.textContent='Life settings';activity.onclick=()=>{const c=getCompanion(state.activeCompanionId);if(c)vhOpenLifeActivity(c);};actions.insertBefore(activity,more);
 const immersion=document.querySelector('#companion-immersion-menu > summary');if(immersion)immersion.textContent='Reply timing';
 const menu=more.querySelector('div');if(inspector)menu.append(inspector);menu.append(activity);const profile=document.querySelector('#companion-chat-view .companion-chat-context');if(profile)menu.append(profile);for(const [id,label] of [['companion-call-btn','Call'],['companion-immersion-menu',null],['companion-chat-edit-btn','Edit human']]){const el=document.getElementById(id);if(el){menu.append(el);if(label)el.textContent=label;}}
 menu.addEventListener('click',e=>{if(e.target.closest('button')&&!e.target.closest('#companion-immersion-menu'))more.open=false;});
 more.addEventListener('keydown',e=>{if(e.key==='Escape'){more.open=false;more.querySelector('summary').focus();}});
 document.addEventListener('click',e=>{if(!more.contains(e.target))more.open=false;});
}
document.addEventListener('DOMContentLoaded',()=>{vhSetupChatActions();const title=document.getElementById('vh-workspace-title');if(title)title.tabIndex=-1;const studio=document.getElementById('companion-studio-view');studio?.addEventListener('input',event=>{if(event.target.matches('#vh-studio-section,input[type=search]'))return;const id=state.editingCompanionId;if(id)vhStudioEditVersions.set(id,(vhStudioEditVersions.get(id)||0)+1);if(studio.classList.contains('is-creating'))return;const status=document.getElementById('vh-save-status');if(status&&!vhStudioSaves.size){status.textContent='Unsaved changes. Save to apply the selected scope.';status.removeAttribute('data-error');}});});
async function vhUiCommand(timeline,type,body){
 if(!timeline?.vh2)throw Error('Select a persistent life before saving this change.');
 const owner=state.companions.find(c=>(state.companionTimelines[c.id]?.sessions||[]).some(t=>t===timeline||t?.id===timeline.id));
 if(owner&&getActiveCompanionTimeline(owner.id)!==timeline)throw Error('The selected life changed. Reopen this editor for the intended life.');
 if(owner&&['queue_photo_render','retry_photo_render'].includes(type))await vh2SyncImageConfiguration(owner,timeline);
 if(owner&&getActiveCompanionTimeline(owner.id)!==timeline)throw Error('The selected life changed. Reopen this editor for the intended life.');
 const prior=timeline.vh2.outbox?.find(c=>c.type===type&&Object.entries(body).every(([k,v])=>JSON.stringify(c[k])===JSON.stringify(v)));
 const key=prior?.key||await vh2Enqueue(timeline,type,body),outcome=vhUiCommandOutcome(key);
 // Another poll may flush this action while enqueue is saving. A missing outbox
 // entry is not evidence of success: only this action's acknowledged receipt is.
 let flushError;
 try{await vh2Flush(timeline);}catch(error){flushError=error;}
 if(!outcome.receipt){
  const failure=timeline.vh2.failedCommands?.find(c=>outcome.keys.has(c.key));
  if(failure)throw Error(failure.message);
  if(outcome.error)throw outcome.error;
  if(flushError)throw flushError;
  throw Error('Still queued. Reconnect to finish this action; it has not been confirmed.');
 }
 if(owner){try{await vh2Poll(owner,timeline,{force:true,throwOnError:true});}catch(error){
  const savedError=Error('The change was saved, but its latest status could not be loaded. Refresh to check it; do not submit it again. '+error.message);
  savedError.receipt=outcome.receipt;savedError.commandAcknowledged=true;throw savedError;
 }}
 return outcome.receipt;
}
async function vhOpenGiftSheet(companion){
    const timeline=getActiveCompanionTimeline(companion.id);if(!timeline?.vh2)return;
    const dialog=document.getElementById('cc-gift-dialog'),host=document.getElementById('cc-life-actions');if(!dialog||!host){showToast('Gift panel not available in this state.','error');return;}
    host.innerHTML='<p role="status">Loading gifts…</p>';document.body.append(dialog);dialog.setAttribute('aria-label',`Gifts for ${companion.name}`);if(!dialog.open)dialog.showModal();
    document.getElementById('cc-gift-close').onclick=()=>dialog.close();
    await vh2Poll(companion,timeline);const g=timeline.vh2.gifts;
 if(!g){host.innerHTML='<p role="alert">Could not load this life’s gifts. Reconnect in Life workspace → Connections.</p>';return;}
 const currency=g.currency,format=value=>`${currency} ${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
 let mode='item',selected='',busy=false;
 const available=()=>timeline.vh2.gifts.items.filter(i=>!i.owned&&!timeline.vh2.gifts.inventory.includes(i.id)&&!timeline.vh2.gifts.records.some(r=>r.itemId===i.id&&r.status!=='declined'));
 host.innerHTML=`<header class="gift-heading"><span class="vh-eyebrow">A little something</span><h2>For ${escapeHTML(companion.name)}</h2><p>Send a gift or share a little money.</p></header><div class="gift-tabs" aria-label="Gift type"><button type="button" data-gift-choice="item">Gift</button><button type="button" data-gift-choice="cash">Money</button></div><div data-gift-picker></div><details class="vh-gift-add"><summary>Add a gift</summary><form data-add-gift><label>Item name<input name="name" class="form-input" required maxlength="200" autocomplete="off"></label><label>Category<select name="category" class="form-select">${['top','bottom','dress','outerwear','underwear','shoes','accessory'].map(v=>`<option>${v}</option>`).join('')}</select></label><label>Tags<input name="tags" class="form-input" placeholder="casual, cozy, work"></label><label>Photo<input name="photo" type="file" accept="image/png,image/jpeg,image/webp"></label><button class="btn btn-ghost" type="submit">Add to gift choices</button></form></details><form data-send-gift><label class="vh-gift-value"><span data-amount-label>Gift value</span> (${escapeHTML(currency)})<input class="form-input" type="number" name="value" required min="0.01" max="1000000" step=".01" value="10"></label><p class="gift-permission" data-permission></p><p class="gift-wallet">Available: ${format(g.playerBalance??g.policy.playerBudget)}</p><button class="btn btn-primary gift-submit" type="submit">Choose a gift</button></form><p data-gift-feedback role="status" aria-live="polite"></p><p class="gift-footnote">Simulated money and gifts. Nothing is charged or shipped.</p><section class="gift-history"><h3>Recent gifts</h3><div data-gift-receipts></div></section>`;
 vhItemDetails(host.querySelector('[data-add-gift]'),timeline);const feedback=host.querySelector('[data-gift-feedback]');
 const update=()=>{const current=timeline.vh2.gifts,p=current.policy;host.querySelectorAll('[data-gift-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.giftChoice===mode)));host.querySelector('[data-gift-picker]').hidden=mode==='cash';host.querySelector('.vh-gift-add').hidden=mode==='cash';host.querySelector('[data-amount-label]').textContent=mode==='cash'?'Amount':'Gift value';
 const relationshipReady=current.trust>=p.minTrust;const allowed=p.enabled&&relationshipReady&&(mode==='cash'?(current.cashConsent??p.cashAllowed):(current.mailConsent??p.mailAllowed));host.querySelector('[data-permission]').textContent=!p.enabled?'Gifts are not enabled for this life.':!relationshipReady?'They are not yet comfortable receiving gifts from you.':!allowed?(mode==='cash'?'They have not agreed to accept money.':'They have not shared permission to receive mailed gifts. Ask them in chat.'):(mode==='cash'?'They accept money transfers.':'They accept mailed gifts. Receipt follows delivery and collection.');
 const item=available().find(i=>i.id===selected),submit=host.querySelector('[data-send-gift] button');submit.disabled=busy||!allowed||mode==='item'&&!item;submit.textContent=busy?'Sending…':mode==='cash'?`Send ${format(host.querySelector('[name=value]').value)}`:item?`Offer ${item.name}`:'Choose a gift';host.querySelector('.gift-wallet').textContent='Available: '+format(current.playerBalance??p.playerBudget);
 host.querySelector('[data-gift-receipts]').innerHTML=current.records.slice(-8).reverse().map(r=>`<article class="vh-gift-receipt"><strong>${escapeHTML(r.kind==='cash'?'Money transfer':r.label)}</strong><span>${format(r.value)}</span><small>${escapeHTML(r.kind==='cash'&&r.status==='shipping'?'Transfer pending':r.status)}</small></article>`).join('')||'<p>No gifts sent yet.</p>';};
 const tiles=()=>{const items=available(),picker=host.querySelector('[data-gift-picker]');picker.innerHTML=items.length?`<div class="gift-catalogue">${items.map(i=>`<button type="button" class="gift-tile" data-item-id="${escapeHTML(i.id)}" aria-pressed="${i.id===selected}">${i.photo?`<img src="${escapeHTML(i.photo)}" alt="">`:'<span class="gift-tile-icon">🎁</span>'}<span>${escapeHTML(i.name)}</span></button>`).join('')}</div>`:'<div class="gift-empty"><strong>Something personal</strong><p>Add an item and a photo to choose your first gift.</p></div>';picker.querySelectorAll('[data-item-id]').forEach(b=>b.onclick=()=>{selected=b.dataset.itemId;tiles();update();});};
 host.querySelectorAll('[data-gift-choice]').forEach(b=>b.onclick=()=>{mode=b.dataset.giftChoice;update();});host.querySelector('[name=value]').oninput=update;
 host.querySelector('[data-send-gift]').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;update();feedback.textContent='Waiting for the life to acknowledge this gift…';try{await vhUiCommand(timeline,'offer_gift',{kind:mode,itemId:mode==='item'?selected:'',value:Number(host.querySelector('[name=value]').value),currency});feedback.textContent='Recorded in this life. See its status below.';selected='';tiles();}catch(error){feedback.textContent=error.message;}finally{busy=false;update();}};
 host.querySelector('[data-add-gift]').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const button=e.target.querySelector('button');button.disabled=true;try{const form=e.target,photo=form.elements.photo.files[0]?await normalizeUploadedImage(form.elements.photo.files[0],960,.8):'';await vhUiCommand(timeline,'add_gift_item',{...vhItemPayload(form,timeline),photo});selected=available().at(-1)?.id||'';feedback.textContent='Item added. Choose a value and offer it when ready.';form.reset();host.querySelector('.vh-gift-add').open=false;tiles();}catch(error){feedback.textContent=error.message;}finally{busy=false;button.disabled=false;update();}};
 tiles();update();
}
async function vhOpenPhotoReview(companion,timeline,photoId,onImported=null){
 const previous=document.getElementById('vh-photo-review');if(previous){previous.close();previous.remove();}
 const dialog=document.createElement('dialog');dialog.id='vh-photo-review';dialog.className='vh-review-dialog';document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.setAttribute('aria-label','Review captured photo');dialog.innerHTML='<button type="button" class="btn btn-ghost" data-close>Close</button><h2>Review this moment</h2><p role="status">Preparing reference preview… No generation submitted.</p>';dialog.querySelector('[data-close]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
 try{
  const history=safeJsonClone(timeline.messages);for(const p of timeline.vh2.photos||[])if(p.status==='stored')history.push({type:'photo',photo:vh2PhotoAssetUrl(timeline.vh2.worldId,p.assetId),timestamp:p.at,photoContext:p.photoContext});history.sort((a,b)=>a.timestamp-b.timestamp);
  const prepared=await vh2PreparePhoto(companion,timeline,photoId,safeJsonClone(companion),history),ctx=prepared.context;
  if(!dialog.open||!dialog.isConnected)return;
  if(getActiveCompanionTimeline(companion.id)!==timeline)throw Error('The selected life changed. Reopen this photo in its original life.');
  const labels=(prepared.snapshot.referenceAssets||[]).map(e=>`${e.role}: ${e.label}`);
  const referenceCapture=!!ctx.referenceStudy||prepared.snapshot.destination==='reference';
  const durable=vh2SupportsDurableImages(companion,timeline)&&!(referenceCapture&&companion.referenceImageSource);
  const renderer=durable?timeline.vh2.imageProvider:null;
  const displayProvider=renderer?.provider||prepared.manifest.provider;
  const nativeModel=renderer?.arguments?.model||renderer?.arguments?.mode;
  const displayModel=renderer?(renderer.model&&renderer.model!=='provider default'?renderer.model:typeof nativeModel==='string'?nativeModel:renderer.tool||'Configured image tool'):prepared.manifest.model;
  dialog.innerHTML=`<header><div><span class="vh-eyebrow">Frozen capture · not submitted</span><h2>Review this moment</h2></div><button type="button" class="btn btn-ghost" data-close>Close</button></header><dl class="vh-capture-facts"><dt>Scene</dt><dd>${escapeHTML(prepared.snapshot.scene)}</dd><dt>Place</dt><dd>${escapeHTML(ctx.placeLabel||ctx.location||'Not established')}</dd><dt>Outfit</dt><dd>${escapeHTML(typeof ctx.outfit==='string'?(ctx.outfit||'Not established'):JSON.stringify(ctx.outfit||'Not established'))}</dd><dt>Captured</dt><dd>${escapeHTML(new Date(ctx.atMs).toLocaleString())}</dd><dt>Delivery</dt><dd>${escapeHTML({private_chat:'Private chat',gallery:'Private gallery',reference:'Reference study'}[prepared.snapshot.destination]||prepared.snapshot.destination)}</dd><dt>Provider / model</dt><dd>${escapeHTML(prepared.manifest.provider)} / ${escapeHTML(prepared.manifest.model)}</dd></dl><h3>${prepared.references.length} references selected</h3><p>${prepared.previous?'Includes an eligible previous photo for follow-up continuity.':'No eligible previous photo selected.'} ${escapeHTML(labels.join(' · '))}</p><div class="vh-reference-preview">${prepared.references.map((ref,i)=>`<figure><img src="${escapeHTML(ref)}" alt="Selected reference ${i+1}"><figcaption>Reference ${i+1}</figcaption></figure>`).join('')||'<p>No reference images available. Add approved references before generating for consistency.</p>'}</div><details><summary>Exact prompt</summary><pre>${escapeHTML(prepared.manifest.promptPreview)}</pre></details><p data-review-status role="status"></p><footer><button type="button" class="btn btn-primary" data-submit-render>Generate this photo · uses credits</button><p>Keep this browser open until import completes. This sends the reviewed moment to your configured image provider.</p></footer>`;

 dialog.querySelector('[data-close]').onclick=()=>dialog.close();const submit=dialog.querySelector('[data-submit-render]'),status=dialog.querySelector('[data-review-status]');
  if(durable){dialog.querySelector('details > summary').textContent='Prompt preview';dialog.querySelector('footer p').textContent='Generation uses your selected image connection. Its progress and result appear in Image activity. The automatic image allowance does not limit this manual request.';}
  else dialog.querySelector('footer p').textContent='This provider currently renders through the browser. Keep this tab open until import completes.';
  const providerRow=[...dialog.querySelectorAll('.vh-capture-facts dt')].find(row=>row.textContent==='Provider / model');if(providerRow)providerRow.nextElementSibling.textContent=displayProvider+' / '+displayModel;
  submit.onclick=async()=>{submit.disabled=true;status.textContent='Preparing the generation request…';try{
   if(durable&&!onImported){await vhUiCommand(timeline,'queue_photo_render',{photoId,...(prepared.providerVersion?{providerVersion:prepared.providerVersion}:{})});dialog.close();await vh2OpenImageActivity(companion,timeline);return;}
   await vh2GeneratePhoto(companion,timeline,'','',prepared.snapshot.destination||'private_chat',photoId,prepared,message=>{status.textContent=message;});
   const saved=(timeline.vh2.photos||[]).find(photo=>photo.id===photoId);
   if(saved?.status!=='stored'||!saved.assetId)throw Error('The image has not been confirmed as imported. Check Image activity for its progress.');
   if(onImported)await onImported();status.textContent='Imported successfully into the original life.';submit.textContent='Photo imported';
  }catch(error){status.textContent=error.message;submit.textContent='View image activity';submit.disabled=false;submit.onclick=()=>{dialog.close();vh2OpenImageActivity(companion,timeline);};}if(state.view==='vhWorkspace')vhRenderWorkspace();};
 }catch(error){if(!dialog.open||!dialog.isConnected)return;dialog.querySelector('p').textContent=error.message+' No generation was submitted. The captured moment is retained in Media.';}
}
let vhReferenceOwner='all';
const vhDraftPanels=new Map(),vhUiOrigins=new Map(),vhPanelReceipts=new Map(),vhUiCommandOutcomes=new Map();
function vhUiCommandOutcome(key){
 let outcome=vhUiCommandOutcomes.get(key);
 if(!outcome){outcome={keys:new Set([key]),receipt:null,error:null,updatedAt:Date.now()};vhUiCommandOutcomes.set(key,outcome);}
 // Keep pending and recently settled commands available to concurrent callers.
 if(vhUiCommandOutcomes.size>1000)for(const [id,value] of vhUiCommandOutcomes)if(value.receipt&&Date.now()-value.updatedAt>300000)vhUiCommandOutcomes.delete(id);
 return outcome;
}

function vhRememberPanels(host){
 const timeline=host.dataset.controlTimeline;if(!timeline)return;
 for(const panel of host.querySelectorAll(':scope > details[data-dirty=true]')){
  // Preserve the live editor and its event closures, including FileLists,
  // repeated field labels, dependent selects and multi-select choices.
  vhDraftPanels.set(timeline+'|'+panel.querySelector(':scope > summary').textContent,{panel});
 }
}
function vhRestorePanels(host,timeline){
 for(const panel of host.querySelectorAll(':scope > details')){
  const retained=vhDraftPanels.get(timeline.id+'|'+panel.querySelector(':scope > summary')?.textContent);
  if(retained?.panel&&retained.panel!==panel)panel.replaceWith(retained.panel);
  else{const receipt=vhPanelReceipts.get(timeline.id+'|'+panel.querySelector(':scope > summary')?.textContent);if(receipt)panel.prepend(receipt);}
 }
}
function vhTrackUiCommand(key){
 vhUiCommandOutcome(key);
 const active=document.activeElement,host=document.getElementById('vh2-chat-controls');if(!host?.contains(active))return;
 let panel=active.closest('details');while(panel?.parentElement!==host&&panel)panel=panel.parentElement.closest('details');if(panel)vhUiOrigins.set(key,{panel,editVersion:panel.dataset.editVersion||'0',timeline:host.dataset.controlTimeline});
}
function vhUiAcknowledged(key,receipt){
 const outcome=vhUiCommandOutcome(key);outcome.receipt=receipt;outcome.error=null;outcome.updatedAt=Date.now();
 const origin=vhUiOrigins.get(key);if(!origin)return;const panel=origin.panel;vhUiOrigins.delete(key);const newerEdits=(panel.dataset.editVersion||'0')!==origin.editVersion;
 if(!newerEdits){panel.removeAttribute('data-dirty');panel.querySelectorAll('[data-vh-dirty]').forEach(f=>delete f.dataset.vhDirty);vhDraftPanels.delete(origin.timeline+'|'+panel.querySelector(':scope > summary')?.textContent);}
 let feedback=panel.querySelector(':scope > .vh-editor-receipt');if(!feedback){feedback=document.createElement('div');feedback.className='vh-editor-receipt';feedback.setAttribute('role','status');panel.prepend(feedback);}
 feedback.innerHTML=`<span>Change recorded at revision ${Number(receipt.revision)||'current'}. ${newerEdits?'Newer edits are still unsaved.':'Your saved values are retained.'}</span> <button type="button">Reload saved values</button>`;
 vhPanelReceipts.set(origin.timeline+'|'+panel.querySelector(':scope > summary')?.textContent,feedback);
 feedback.querySelector('button').onclick=()=>{const panel=feedback.closest('details');panel.removeAttribute('data-dirty');const host=document.getElementById('vh2-chat-controls');vhDraftPanels.delete(host.dataset.controlTimeline+'|'+panel.querySelector(':scope > summary')?.textContent);panel.querySelectorAll('[data-vh-dirty]').forEach(f=>delete f.dataset.vhDirty);vhRenderWorkspace();};
}
function vhUiFailed(key,error){const outcome=vhUiCommandOutcome(key);if(!outcome.receipt)outcome.error=error;outcome.updatedAt=Date.now();const panel=vhUiOrigins.get(key)?.panel;if(!panel)return;let feedback=panel.querySelector(':scope > .vh-editor-receipt');if(!feedback){feedback=document.createElement('div');feedback.className='vh-editor-receipt';feedback.setAttribute('role','alert');panel.prepend(feedback);}feedback.textContent='Not confirmed. '+error.message+' Your draft is retained.';}
document.addEventListener('DOMContentLoaded',()=>{document.getElementById('vh2-chat-controls')?.addEventListener('input',e=>{const host=e.currentTarget;let panel=e.target.closest('details');while(panel?.parentElement!==host&&panel)panel=panel.parentElement.closest('details');if(panel){panel.dataset.dirty='true';panel.dataset.editVersion=String(Number(panel.dataset.editVersion||0)+1);e.target.dataset.vhDirty='true';const receipt=panel.querySelector(':scope > .vh-editor-receipt span');if(receipt)receipt.textContent='Unsaved changes. Save this section to apply them.';}});});
function vhOpenPanel(title){vhAdvancedOpen=true;const panel=[...document.querySelectorAll('#vh2-chat-controls>details')].find(d=>d.querySelector(':scope > summary')?.textContent===title);if(panel){vhWorkspaceSection=VH_PANEL_GROUPS[title]||'overview';vhFilterWorkspace();panel.open=true;panel.scrollIntoView({block:'start',behavior:'smooth'});}}
function vhWorkspaceSpecial(force=false){
  const root=document.getElementById('vh-workspace-special');if(!root||(!force&&root.dataset.life===getActiveCompanionTimeline(state.activeCompanionId)?.id&&root.dataset.section===vhWorkspaceSection&&root.contains(document.activeElement)&&document.activeElement.matches('input,select,textarea')))return;
  root.dataset.section=vhWorkspaceSection;const companion=getCompanion(state.activeCompanionId),timeline=companion&&getActiveCompanionTimeline(companion.id),link=timeline?.vh2;if(root.dataset.life!==timeline?.id){vhReferenceOwner='all';root.dataset.life=timeline?.id||'';}root.replaceChildren();root.classList.toggle('vh-auto-reference-library',vhWorkspaceSection==='references');
  const searchInput=document.getElementById('vh-workspace-search');
  if(!link){
   root.innerHTML='<section class="vh-current-card vh-life-onboarding"><span class="vh-state-chip">Not started</span><h3>Start '+escapeHTML(companion.name)+'’s persistent life</h3><p>The saved character remains the source of identity, psychology and expression. Starting a life creates the separate, evolving timeline for routines, people, places, possessions, media, memory and outside events.</p><div class="vh-life-onboarding-parts"><span><strong>Edit human</strong>Durable person and starting world</span><span><strong>Live human</strong>Evolving state and history</span></div><p class="vh-cost-note">Starting can use your configured AI provider and Always-on allowance. Nothing is charged until you choose to start.</p><div class="vh-onboarding-actions"><button type="button" data-open-blueprint>Review starting world</button><button type="button" data-start-persistent>Start persistent life</button></div><p role="status"></p></section>';
   root.querySelector('[data-start-persistent]').onclick=async e=>{e.target.disabled=true;try{await vh2CreateTimeline(companion);if(state.view==='vhWorkspace'&&state.activeCompanionId===companion.id)vhRenderWorkspace();}catch(error){root.querySelector('[role=status]').textContent=error.message;e.target.disabled=false;}};
   root.querySelector('[data-open-blueprint]').onclick=()=>{openCompanionStudio(companion.id);activateCompanionStudioTab('cs-life');switchView('companionStudio');};
   return;
  }
  if(searchInput?.value){const q=searchInput.value.trim().toLowerCase();for(const [section,info] of Object.entries(VH_WORKSPACE_SECTIONS)){if(!info.join(' ').toLowerCase().includes(q))continue;const b=document.createElement('button');b.type='button';b.textContent='Open '+info[0];b.onclick=()=>vhWorkspaceSelect(section);root.append(b);}return;}
 const card=(title,body)=>`<article class="vh-entity-card"><h3>${escapeHTML(title)}</h3>${body}</article>`;
 const editButton=(label,panel)=>`<button type="button" data-open-panel="${escapeHTML(panel)}">${escapeHTML(label)}</button>`;
 if(vhWorkspaceSection==='overview'){vhScheduleRepairAction(root,companion);vhLifeActivityControls(root,companion,timeline);}
 if(vhWorkspaceSection==='life')vhRoutineHome(root,companion,timeline);
 if(vhWorkspaceSection==='people')vhPeopleHome(root,companion,timeline);
 if(vhWorkspaceSection==='places'){
  const places=(link.travelPlaces||[]).filter(p=>!p.id.startsWith('osm:')||p.id===link.present?.placeId||(link.bible?.entries||[]).some(e=>e.role==='place'&&e.entityId===p.id&&e.status!=='archived')),p=link.present||{},journey=link.journey;const name=id=>places.find(x=>x.id===id)?.label||id||'Unknown';
  root.innerHTML=`<div class="vh-outfit-strip"><span>Current place</span><strong>${escapeHTML(journey?`${name(journey.from)} → ${name(journey.to)}`:name(p.placeId))}</strong><p>${escapeHTML(journey?`${journey.mode} · ${journey.routeSource||'Saved estimate'} · arrival ${new Date(journey.arrivesAt||journey.endsAt).toLocaleTimeString()}`:p.activity||'No activity established')}</p></div><div class="vh-place-map" role="img" aria-label="Geographic overview of saved places"></div><div class="vh-entity-grid">${places.map(place=>card(place.label,`<p>${escapeHTML(place.kind)}${place.id===link.travel?.residenceId?' · Current home':''}${place.id===link.travel?.hometownId?' · Hometown':''}</p><p>${place.mapCoordinates?escapeHTML(place.mapCoordinates.join(', ')):'Coordinates not set'}</p><p>${(link.visual?.zones||[]).filter(z=>z.placeId===place.id).map(z=>escapeHTML(z.label)).join(' · ')||'No rooms added yet'}</p><button type="button" data-manage-place="${escapeHTML(place.id)}">Open place & rooms</button><button type="button" data-place-references="${escapeHTML(place.id)}">Linked references</button>`)).join('')}</div>`;
  for(const card of root.querySelectorAll('.vh-entity-grid>.vh-entity-card')){const id=card.querySelector('[data-manage-place]')?.dataset.managePlace;const entry=[...(link.bible?.entries||[])].reverse().find(e=>e.role==='place'&&e.entityId===id&&e.status==='approved');if(entry){const img=document.createElement('img');img.src=vh2PhotoAssetUrl(link.worldId,entry.assetId);img.alt=card.querySelector('h3').textContent+' reference';img.loading='lazy';img.style.cssText='width:100%;max-height:180px;object-fit:contain;border-radius:10px';card.prepend(img);}}
  const toolbar=document.createElement('div');toolbar.className='vh-task-heading';toolbar.innerHTML='<div><h3>Saved places</h3><label class="vh-place-search">Find a place<input type="search" placeholder="Name or room…" aria-label="Find a place"></label></div><button type="button" data-add-place>Add place</button>';root.querySelector('.vh-entity-grid').before(toolbar);toolbar.querySelector('button').onclick=()=>vhAddPlace(companion);const mapsButton=document.createElement('button');mapsButton.type='button';mapsButton.textContent='World setup';mapsButton.onclick=()=>vhWorldSetup(companion);toolbar.append(mapsButton);vhGenerationActions(root,companion,['places','rooms']);toolbar.querySelector('input').oninput=e=>{const q=e.target.value.trim().toLowerCase();root.querySelectorAll('.vh-entity-grid>.vh-entity-card').forEach(c=>c.hidden=!c.textContent.toLowerCase().includes(q));};
  const coords=places.filter(p=>Array.isArray(p.mapCoordinates)&&p.mapCoordinates.length===2&&p.mapCoordinates.every(Number.isFinite));const map=root.querySelector('.vh-place-map');
  vhRenderLocalMap(map,link.travelPlaces||[],link);
 }
 if(vhWorkspaceSection==='closet'){
  const owned=(link.gifts?.items||[]).filter(i=>!i.archived&&(i.owned||link.gifts.inventory.includes(i.id))&&!['food','ticket','vehicle','object'].includes(i.category));const worn=link.currentOutfit||{};
  vhWardrobeHome(root,companion,timeline,owned,worn);
 }
 if(vhWorkspaceSection==='possessions'){
 root.innerHTML='<div class="vh-task-heading"><div><h3>Beyond the wardrobe</h3><p>Give something, or record a belonging they already have.</p></div><button type="button" data-owned-item>Add a possession</button></div><div class="vh-entity-grid" data-possession-grid></div>';
 root.querySelector('[data-owned-item]').onclick=()=>vhOpenOwnedItem(companion);
 const grid=root.querySelector('[data-possession-grid]');
 for(const item of (link.gifts?.items||[]).filter(i=>['food','ticket','vehicle','object'].includes(i.category)&&(i.owned||link.gifts.inventory.includes(i.id)))){const row=document.createElement('article');row.className='vh-entity-card';const p=item.possession||{};const detail=item.category==='food'?`${p.servings||0} servings left`:item.category==='ticket'?p.eventName||'Event ticket':item.category==='vehicle'?(p.usedAt?'Collected':'Awaiting collection'):'Owned';row.innerHTML=`<span class="vh-state-chip">${escapeHTML(VH_ITEM_CATEGORIES[item.category])}</span><h3>${escapeHTML(item.name)}</h3><p>${escapeHTML(detail)}</p>`;if(item.category!=='object'){const b=document.createElement('button');b.textContent={food:'Eat a serving',ticket:'Use at venue',vehicle:'Collect vehicle'}[item.category];b.disabled=item.category==='food'?(!p.servings||p.expiresAt<=link.simAt):!!p.usedAt;b.onclick=async()=>{b.disabled=true;try{await vhUiCommand(timeline,'use_possession',{itemId:item.id});vhRenderWorkspace();}catch(error){showToast(error.message,'error');b.disabled=false;}};row.append(b);}grid.append(row);}
 if(!grid.children.length)grid.innerHTML='<div class="vh-empty-state"><h3>No other possessions yet</h3><p>Food, event tickets, vehicles and keepsakes appear here after they are added or received.</p></div>';
 }
 if(vhWorkspaceSection==='references')vhRenderReferenceLibrary(root,companion,timeline);
 if(vhWorkspaceSection==='media'){
  root.innerHTML='<div class="vh-media-jobs"><h3>Photo jobs</h3></div><div class="vh-media-publishing"></div>';
  const jobs=root.querySelector('.vh-media-jobs');const activity=document.createElement('button');activity.type='button';activity.textContent='Image activity';activity.onclick=()=>vh2OpenImageActivity(companion,timeline);jobs.append(activity);for(const photo of [...(link.photos||[])].reverse().slice(0,12)){const row=document.createElement('article');row.className='vh-job-card';const worker=(link.providerJobs||[]).find(j=>j.id==='image:'+photo.id);row.innerHTML=`<div><strong>${escapeHTML(photo.scene||'Reference study')}</strong><span class="vh-state-chip">${escapeHTML(worker?.status||photo.status)}</span></div><p>${escapeHTML(photo.photoContext?.placeLabel||'Place not established')} · ${escapeHTML(photo.photoContext?.outfit||'Outfit not established')}</p><small>${escapeHTML(new Date(photo.at).toLocaleString())} · ${escapeHTML(photo.destination)}</small>${photo.assetId?`<img src="${escapeHTML(vh2PhotoAssetUrl(link.worldId,photo.assetId))}" alt="Captured photo">`:''}${worker?.error?`<p role="status">${escapeHTML(worker.error)}</p>`:''}`;const inspect=document.createElement('button');inspect.type='button';inspect.textContent=photo.status==='captured'?'Review & generate':'View capture details';inspect.onclick=async()=>{if(photo.status==='captured')return vhOpenPhotoReview(companion,timeline,photo.id);const d=document.createElement('dialog');d.className='vh-review-dialog';d.setAttribute('aria-label','Photo lineage');d.innerHTML=`<button type="button" class="btn btn-ghost">Close</button><h2>Captured moment & lineage</h2><pre>${escapeHTML(JSON.stringify({captured:photo.photoContext,manifest:photo.manifest,status:photo.status},null,2))}</pre>`;d.querySelector('button').onclick=()=>{d.close();d.remove();};document.body.append(d);d.showModal();};row.append(inspect);jobs.append(row);}if(!link.photos?.length)jobs.innerHTML+='<p>No captures yet. Review a moment below to take the first photo.</p>';
  vh2RenderSocial(companion,root.querySelector('.vh-media-publishing'),document.createElement('button'),true);
 }
 if(vhWorkspaceSection==='connections')vhConnectionsHome(root,companion,timeline);
 if(vhWorkspaceSection==='inspector')root.innerHTML='<div class="vh-current-card"><span>Author-only view</span><strong>Internal state is not player knowledge</strong><p>These tools expose needs, decisions and remembered evidence for debugging. They do not imply the character shared this information.</p><button type="button" data-inspect-life>Inspect connection, emotions & history</button></div>';
   if(vhWorkspaceSection==='recovery')root.innerHTML='<div class="vh-current-card"><span>Recovery & developer tools</span><strong>Original lives remain intact</strong><p>Backups and imported histories retain their source identity. An uncertain provider submission must be reconciled before creating another paid request.</p><a href="/virtual_humans/frontend/vh2.html" target="_blank" rel="noopener">Open developer lab</a></div>';
 if(vhWorkspaceSection!=='references'&&!root.querySelector('.vh-generation-actions'))vhAssistantActions(root,companion,vhWorkspaceSection);
 root.querySelector('[data-inspect-life]')?.addEventListener('click',openCompanionSimulationDetails);
 root.querySelectorAll('[data-manage-place]').forEach(b=>b.onclick=()=>vhOpenPlace(companion,b.dataset.managePlace));
 root.querySelectorAll('[data-place-references]').forEach(b=>b.onclick=()=>{vhReferenceOwner=b.dataset.placeReferences;vhWorkspaceSelect('references');});
 root.querySelectorAll('[data-open-panel]').forEach(b=>b.onclick=()=>vhOpenPanel(b.dataset.openPanel));
}

// Compact Studio navigation keeps authoring reachable on narrow screens.
function vhPolishStudioNavigation(){
    const nav=document.querySelector('#companion-studio-view .studio-nav');if(!nav||document.getElementById('vh-studio-section'))return;
    const tabs=nav.querySelector('.studio-tabs'),actions=nav.querySelector('.studio-nav-actions');if(!tabs||!actions){return;}
    const groups=[
     ['Architecture',[['cs-overview','System map']]],
     ['Person',[['cs-identity','Identity & history'],['cs-mind','Psychology & relationship'],['cs-chat-style','Conversation & expression']]],
     ['Life & agency',[['cs-life','World & autonomous life'],['cs-social','Social presence']]],
     ['Media',[['cs-voice','Appearance, photos & voice'],['cs-video','Video & clips']]],
     ['Runtime',[['cs-models','Models & providers']]]
    ];
    const label=document.createElement('label');label.className='vh-studio-section';label.textContent='Section';const select=document.createElement('select');select.id='vh-studio-section';
 for(const [groupName,items] of groups){
  const heading=document.createElement('span');heading.className='vh-tab-group-label';heading.textContent=groupName;tabs.append(heading);
  const optionGroup=document.createElement('optgroup');optionGroup.label=groupName;select.append(optionGroup);
  for(const [key,title] of items){const button=tabs.querySelector('[data-tab="'+key+'"]');if(!button)continue;button.textContent=title;tabs.append(button);const option=document.createElement('option');option.value=key;option.textContent=title;optionGroup.append(option);button.addEventListener('click',()=>{select.value=key;const studio=document.getElementById('companion-studio-view');if(studio?.classList.contains('is-creating'))studio.classList.toggle('is-advanced-creation',key!=='cs-identity');});}
 }
 select.onchange=()=>{const studio=document.getElementById('companion-studio-view');if(studio?.classList.contains('is-creating'))studio.classList.toggle('is-advanced-creation',select.value!=='cs-identity');tabs.querySelector(`[data-tab="${select.value}"]`)?.click();};label.append(select);tabs.after(label);
 const more=document.createElement('details');more.className='vh-studio-more';more.innerHTML='<summary>More actions</summary><div></div>';
 for(const id of ['export-companion-btn','close-companion-studio-btn']){const button=document.getElementById(id);if(button)more.querySelector('div').append(button);}actions.querySelector('button[onclick]')?.remove();const remove=document.getElementById('delete-companion-btn');if(remove){remove.textContent='Delete human';remove.classList.add('vh-studio-delete');}actions.append(more);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){more.open=false;const menu=document.getElementById('vh-chat-more');if(menu)menu.open=false;}});
 const observer=new MutationObserver(()=>{const active=tabs.querySelector('.active');if(active)select.value=active.dataset.tab;});observer.observe(tabs,{attributes:true,subtree:true,attributeFilter:['class']});
}
document.addEventListener('DOMContentLoaded',vhPolishStudioNavigation);

// Give the dense authoring system a visible hierarchy without reducing the person
// to a prompt or hiding foundational traits behind progressive disclosure.
function vhMountAuthoringSubnav(panel,items){
 if(!panel||panel.querySelector(':scope > .vh-authoring-subnav'))return;
 const nav=document.createElement('nav');nav.className='vh-authoring-subnav';nav.setAttribute('aria-label',panel.querySelector('h2')?.textContent+' sections');
 for(const [key,label] of items){const section=panel.querySelector('[data-vh-authoring-section="'+key+'"]');if(!section)continue;const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.authoringJump=key;button.onclick=()=>{section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});section.querySelector('h3,[id]')?.focus?.({preventScroll:true});};nav.append(button);}
 panel.querySelector('.panel-header')?.after(nav);
}
function vhOpenAuthoringSection(tab,key){
 activateCompanionStudioTab(tab);
 requestAnimationFrame(()=>requestAnimationFrame(()=>{const section=document.querySelector('#tab-'+tab+' [data-vh-authoring-section="'+key+'"]');if(section){section.scrollIntoView({block:'start',behavior:'auto'});const heading=section.querySelector('h3');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}}));
}
function vhPolishAuthoringPages(){
 const wrap=(node,title)=>{if(!node||node.parentElement?.classList.contains('vh-authoring-extra'))return;const details=document.createElement('details');details.className='vh-authoring-extra';const summary=document.createElement('summary');summary.textContent=title;details.append(summary);node.before(details);details.append(node);return details;};
 const group=(key,title,copy,nodes)=>{const section=document.createElement('section');section.className='vh-authoring-group';section.dataset.vhAuthoringSection=key;const head=document.createElement('header');const h=document.createElement('h3');h.textContent=title;h.tabIndex=-1;const p=document.createElement('p');p.textContent=copy;head.append(h,p);section.append(head,...nodes.filter(Boolean));return section;};
 const companion=getCompanion(state.editingCompanionId),creating=vhIsCreationDraft(companion),identityPanel=document.getElementById('tab-cs-identity');
 const identity=identityPanel?.querySelector('.form-body');
 if(identity&&!identity.dataset.vhOrganized){
  identity.dataset.vhOrganized='true';
  const facts=document.getElementById('cs-name')?.closest('.form-row');
  const photos=identity.querySelector('.vh-image-pair');
  const embodiment=identity.querySelector('.vh-body-studio');
  const temperament=document.getElementById('cs-personality')?.closest('.form-section');
  const history=document.getElementById('cs-backstory')?.closest('.form-section');
  const context=document.getElementById('cs-occupation')?.closest('.form-row');
  identity.replaceChildren(
   group('identity','Identity, body & access','Establish identity, anatomy, capabilities, sensory access, communication and accommodations without collapsing them into personality.',[facts,embodiment]),
   group('visual','Visual identity','Profile presentation and the identity reference used to keep generated images consistent.',[photos]),
   group('temperament','Temperament & behavior','Describe enduring personality patterns and concrete reactions. This is authored personhood, not a one-line prompt.',[temperament]),
   group('history','History & social context','Define the experiences, competence, home, relationships, and tensions that existed before this timeline.',[history,context])
  );
 }
 vhMountAuthoringSubnav(identityPanel,[['identity','Identity & body'],['visual','Visuals'],['temperament','Temperament'],['history','History']]);
 if(identityPanel&&companion){
  const title=identityPanel.querySelector('.panel-header h2'),copy=identityPanel.querySelector('.panel-header p');
  if(title)title.textContent='Identity & history';
  if(copy)copy.textContent=creating?'Author the person who exists before the first conversation: body, temperament, history, work, home, and social world.':'Edit the durable person model shared by conversation, life simulation, and media.';
 }
 const voice=document.getElementById('cs-voice-builder');
 if(voice){const old=voice.querySelector('[data-build-chat-style]');if(old)old.hidden=true;}
 const intimacy=wrap(document.getElementById('cs-libido-enabled')?.closest('.form-section'),'Adult intimacy, desire & boundaries');
 const mindPanel=document.getElementById('tab-cs-mind'),mind=mindPanel?.querySelector('.form-body');
 if(mind&&!mind.dataset.vhOrganized){
  mind.dataset.vhOrganized='true';
  const mood=document.getElementById('cs-mood-baseline')?.closest('.form-row');
  const regulation=document.getElementById('cs-regulation-profile')?.closest('.form-section');
  const emotion=document.getElementById('cs-emotion-expression')?.closest('.form-section');
  const cognition=mind.querySelector('.vh-cognition-studio');
  const mindArchitecture=mind.querySelector('.vh-mind-studio');
  const location=document.getElementById('cs-location-label')?.closest('.form-row');
  const locationMode=document.getElementById('cs-custom-location-mode')?.closest('.vh-location-mode');
  const relationship=document.getElementById('cs-relationship-start')?.closest('.vh-relationship-origin');
  const values=document.getElementById('cs-values')?.closest('.form-row');
  const wounds=document.getElementById('cs-vulnerabilities')?.closest('.form-row');
  const habits=document.getElementById('cs-habits')?.closest('.form-section');
  const routine=document.getElementById('cs-routine')?.closest('.form-section');
  const agency=document.getElementById('cs-initiative-mode')?.closest('.form-section');
  const privateLife=document.getElementById('cs-private-life')?.closest('.form-section');
  const live=document.getElementById('cs-mood-live-box'),memory=document.getElementById('cs-memory-box');
  mind.replaceChildren(...[
   group('emotion','Regulation & emotional dynamics','Baseline state and durable response patterns shape how events affect them; live feelings still evolve from experience.',[mood,regulation,emotion]),
   group('cognition','Intelligence & cognition','Model uneven reasoning, expertise, learning, blind spots, and adaptive skills without turning intelligence into personality.',[cognition]),
   group('mind','Traits, quirks & triggers','Compose behavioral modules, compulsions, interests, disorders, fictional danger patterns, and custom triggers deliberately.',[mindArchitecture]),
   group('relationship','Relationship & conversation start','Establish what this person and the player actually know, want, and have experienced, then choose who sends the first message.',[relationship]),
   group('inner','Inner life','Values, contradictions, wounds, attachment patterns, habits, pressures, and private facts give decisions causal depth.',[values,wounds,habits,routine,privateLife]),
   group('intimacy','Intimacy & personal boundaries','Explicit adult-only preferences and limits remain a distinct, opt-in part of the person model.',[intimacy]),
   group('place','Place & lived time','Home and timezone ground sleep, routines, travel, weather, and delayed replies.',[location,locationMode]),
   group('agency','Agency & access','Control whether this person can act or reach out independently and which outside information they can access.',[agency]),
   group('state','Evolving state & memory','These records are produced by lived events and conversation rather than authored as static personality text.',[live,memory])
  ].filter(Boolean));
 }
 vhMountAuthoringSubnav(mindPanel,[['emotion','Emotion'],['cognition','Cognition'],['mind','Traits & triggers'],['relationship','Conversation start'],['inner','Inner life'],['intimacy','Intimacy'],['place','Place & time'],['agency','Agency'],['state','State & memory']]);
 if(mindPanel){mindPanel.querySelector('.panel-header h2').textContent='Psychology & relationship';mindPanel.querySelector('.panel-header p').textContent='Author durable psychological tendencies, the relationship’s starting truth, and the conditions that shape autonomous behavior.';}
 const chatPanel=document.getElementById('tab-cs-chat-style'),chat=chatPanel?.querySelector('.form-body');
 if(chat&&!chat.dataset.vhOrganized){
  chat.dataset.vhOrganized='true';
  const texting=document.getElementById('cs-texting-style')?.closest('.form-section');
  const length=document.getElementById('cs-chat-length')?.closest('.form-section');
  const behavior=document.getElementById('cs-conversation-style')?.closest('.form-section');
  const examples=document.getElementById('cs-chat-examples')?.closest('.form-section');
  const avoid=document.getElementById('cs-chat-avoid')?.closest('.form-section');
  chat.replaceChildren(
   group('language','Language & cadence','Define vocabulary, rhythm, writing voice, and the range of response lengths they naturally use.',[voice,texting,length]),
   group('behavior','Conversation behavior','Author how they participate, disagree, follow up, initiate, and avoid repetitive assistant-like habits.',[behavior,examples,avoid])
  );
 }
 vhMountAuthoringSubnav(chatPanel,[['language','Language & cadence'],['behavior','Conversation behavior']]);
 if(chatPanel){chatPanel.querySelector('.panel-header h2').textContent='Conversation & expression';chatPanel.querySelector('.panel-header p').textContent='Translate the person model into recognizable language and interaction patterns without scripting every reply.';}
}


const VH_LIFE_SECTIONS={personalCalendar:'Birthdays & important dates',expression:'Personality, appearance & voice',...VH_LIFE_POLICY_LABELS,routes:'Estimated travel connections',finance:'Income & recurring costs',sleepPolicy:'Sleep needs',breakPolicy:'Breaks & food access',exploration:'Exploring nearby places',peopleLives:'Supporting people’s independent lives',rooms:'Rooms',possessions:'Personal belongings & props',referencePlan:'Reference images to create',workweekDays:'Working days',styleProfiles:'Wardrobe style preferences',places:'Places',socialCircle:'People',wardrobe:'Saved outfits',weeklySchedule:'Commitments',activityOptions:'Activities',fashionSense:'Style preferences',grooming:'Grooming',foodHabits:'Food habits',mediaHabits:'Media habits',moneyPattern:'Money habits',healthRoutine:'Health routine',digitalLife:'Phone habits',seasonalVariation:'Seasonal habits'};
function vhSupportingCommitmentFields(person,existing,places,onChange){
 const host=document.createElement('details');host.className='vh-supporting-commitments';const summary=document.createElement('summary');summary.textContent='Adjust work, classes & appointments';const body=document.createElement('div');host.append(summary,body);
 const draw=()=>{body.replaceChildren();const rows=person.commitments||existing?.commitments||[];for(const [index,row] of rows.entries()){const line=document.createElement('fieldset');const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');line.innerHTML='<legend>Obligation '+(index+1)+'</legend><label>Activity<input data-field="activity" maxlength="200" value="'+escapeHTML(row.activity||'')+'"></label><label>Place<select data-field="placeId">'+vhOptions(places.map(p=>[p.id,p.label]),row.placeId)+'</select></label><div class="vh-form-columns"><label>Starts<input type="time" data-field="start" value="'+clock(row.start)+'"></label><label>Ends<input type="time" data-field="end" value="'+clock(row.end===1440?0:row.end)+'"></label></div><label>Flexibility<select data-field="flexibility">'+vhOptions([['hard','Required obligation'],['soft','May rearrange it']],row.flexibility||'hard')+'</select></label><div data-days aria-label="Days of the week"></div><button type="button" data-remove>Remove obligation</button>';for(const [day,name] of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].entries()){const label=document.createElement('label');label.className='vh-choice-row';const check=document.createElement('input');check.type='checkbox';check.dataset.day=day;check.checked=(row.days||[]).includes(day);label.append(check,document.createTextNode(name));line.querySelector('[data-days]').append(label);}const materialize=()=>person.commitments??=safeJsonClone(rows);line.oninput=()=>{const target=materialize()[index];for(const input of line.querySelectorAll('[data-field]')){const key=input.dataset.field;target[key]=['start','end'].includes(key)?input.value?(key==='end'&&input.value==='00:00'?1440:input.value.split(':').reduce((n,v)=>n*60+Number(v),0)):null:input.value;}target.days=[...line.querySelectorAll('[data-day]:checked')].map(i=>Number(i.dataset.day));onChange();};line.querySelector('[data-remove]').onclick=()=>{materialize().splice(index,1);draw();onChange();};body.append(line);}const add=document.createElement('button');add.type='button';add.textContent='Add obligation';add.disabled=rows.length>=14;add.onclick=()=>{person.commitments??=safeJsonClone(rows);person.commitments.push({id:'obligation_'+crypto.randomUUID(),placeId:person.policy?.homePlaceId||places[0]?.id||'',days:[1,2,3,4,5],start:540,end:1020,activity:'',flexibility:'hard'});draw();onChange();};body.append(add);};draw();return host;
}
async function vhReviewLifeProposal(companion,built,options={}){
 const timeline=getActiveCompanionTimeline(companion.id);if(timeline?.vh2&&!options.skipRefresh)await vh2Poll(companion,timeline);
 if(getActiveCompanionTimeline(companion.id)!==timeline)throw Error('The selected life changed. Reopen the draft for the intended life.');
 const current=timeline?.vh2?{...timeline.vh2.setupProfile,...timeline.vh2.executableSetup,styleProfiles:timeline.vh2.closet?.styles||[]}: {...companion.lifeProfile,...companion.lifeSetupPolicies,styleProfiles:companion.lifeStyleProfiles||[]},baseSetupVersion=options.baseSetupVersion??timeline?.vh2?.setupVersion??0;
 const proposal=Object.fromEntries(Object.keys(VH_LIFE_SECTIONS).filter(k=>built[k]!==undefined).map(k=>[k,safeJsonClone(built[k])]));
 if(options.wholeLife)for(const key of companionWholeLifeMissing(options.personDraft||companion,{...current,...built}))if(proposal[key]===undefined)proposal[key]=Object.hasOwn(VH_LIFE_POLICY_LABELS,key)||['finance','exploration','sleepPolicy','breakPolicy'].includes(key)?{}:[];
 for(const key of options.repairIssues?.length||options.focusedSections?[]:VH_ESSENTIAL_SECTIONS)if(proposal[key]===undefined&&!vhSectionHasContent(key,current[key]??(key==='styleProfiles'?(timeline?.vh2?.closet?.styles||companion.lifeStyleProfiles):undefined)))proposal[key]=[];
 const isSectionEmpty = (value)=>Array.isArray(value)?value.length===0:isPlainObject(value)?!Object.keys(value).length:(!value&&value!==0&&value!==false);
 const dialog=document.createElement('dialog');dialog.className='vh-review-dialog';dialog.id='vh-life-proposal';dialog.setAttribute('aria-label','Review life changes');
 dialog.innerHTML=`<header><h2>${options.wholeLife?(timeline?.vh2?'Review changes for '+escapeHTML(companion.name):'Meet '+escapeHTML(options.personDraft?.name||companion.name)):'Review life changes'}</h2><button type="button" class="btn btn-ghost" data-close>Cancel</button></header><p>${timeline?.vh2?'Apply selected changes to this running life. Existing entities are kept; matching IDs update. Memories, possessions and past events are preserved.':'Review this life blueprint before starting a new life.'}</p><div data-sections></div><p role="status" data-status></p><div><button type="button" class="btn btn-ghost" data-fill-missing>Fill missing sections</button><button type="button" class="btn btn-ghost" data-fill>Fill selected sections</button><button type="button" class="btn btn-primary" data-apply>Apply selected changes</button></div>`;
 for(const [key,value] of Object.entries(proposal)){const isEmpty=isSectionEmpty(value);const box=document.createElement('details');box.innerHTML=`<summary><label><input type="checkbox" ${isEmpty?'':'checked'} data-section="${key}"> ${VH_LIFE_SECTIONS[key]}${isEmpty?' (empty)':VH_ESSENTIAL_SECTIONS.includes(key)&&!vhSectionHasContent(key,value)?' (needs detail)':''}</label></summary>`;const body=document.createElement('div');if(options.repairIssues?.every(vhIsTimingIssue))box.open=true;if(Array.isArray(value)){for(const row of value){const old=typeof row==='object'&&(current[key]||[]).find(x=>key==='peopleLives'?x.personId===row.personId:x.id===row.id);if(options.repairIssues?.every(vhIsTimingIssue)&&JSON.stringify(old)===JSON.stringify(row))continue;const p=document.createElement('p');p.textContent=`${old?'Update':'Add'}: ${row.title||row.label||row.name||row.activity||row.personId||row.id||(key==='routes'?`${row.from} → ${row.to} · ${row.minutes} min · estimated`:null)||VH_DAY_NAMES[row]||row}`;if(options.repairIssues?.length&&key==='weeklySchedule'&&old){const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');p.textContent+=' · '+clock(old.startMinute)+'–'+clock(old.endMinute)+' → '+clock(row.startMinute)+'–'+clock(row.endMinute);}if(key==='personalCalendar')p.textContent+=' · '+vhCalendarDateLabel(row.date)+(row.recurrence==='yearly'?' · yearly':'')+(row.source==='fictional_assumption'?' · suggested fictional date':'');if(key==='institutions')p.textContent+=' · '+vhSetupSummary('institutions',[row]);body.append(p);if(key==='peopleLives'){const commitments=document.createElement('p');const name=id=>(proposal.places||current.places||[]).find(x=>x.id===id)?.label||id;commitments.textContent=(row.policy?.timeZone?'Local time: '+row.policy.timeZone+' · ':'')+(row.commitments?.length?row.commitments.map(c=>(c.activity||'Commitment')+' at '+name(c.placeId)+' · '+Math.floor(c.start/60)+':'+String(c.start%60).padStart(2,'0')+'–'+Math.floor(c.end/60)+':'+String(c.end%60).padStart(2,'0')+' ('+c.flexibility+')').join('; '):row.commitments===undefined?'Existing recurring obligations are kept.':'No recurring obligations in this draft.');body.append(commitments);body.append(vhSupportingCommitmentFields(row,old,[...new Map([...(current.places||[]),...(proposal.places||[])].map(p=>[p.id,p])).values()],()=>{checkDependencies();commitments.textContent=(row.commitments||[]).map(c=>(c.activity||'Unnamed obligation')+' · '+c.flexibility).join('; ')||'No recurring obligations in this draft.';for(const pre of body.querySelectorAll(':scope > details > pre'))pre.textContent=JSON.stringify(row,null,2);}));}const details=document.createElement('details');details.innerHTML='<summary>Details</summary>';const pre=document.createElement('pre');pre.textContent=JSON.stringify(row,null,2);details.append(pre);body.append(details);}}else{const p=document.createElement('p');p.textContent=typeof value==='object'?vhSetupSummary(key,value):value;body.append(p);if(typeof value==='object'){const advanced=document.createElement('details');advanced.innerHTML='<summary>Exact settings</summary>';const pre=document.createElement('pre');pre.textContent=JSON.stringify(value,null,2);advanced.append(pre);body.append(advanced);}}box.append(body);dialog.querySelector('[data-sections]').append(box);}
 const omitted=Object.keys(built).filter(k=>!(k in VH_LIFE_SECTIONS)&&!['summary','assumptions','worldFeeds','researchNotes','__generationWarning','__setupReport','__coherenceReview','__lifeDesign','initializedAt','seed','wildcardDeck'].includes(k));if(built.__generationWarning||omitted.length||(built.wildcardDeck||[]).length){const note=document.createElement('p');note.className='vh-editor-receipt';note.textContent=[built.__generationWarning,omitted.length?'Not applied: '+omitted.join(', '):'',(built.wildcardDeck||[]).length?'Scripted legacy wildcards are not applied to VH2.':''].filter(Boolean).join(' ');dialog.querySelector('[data-sections]').before(note);}
 let reviewBusy=false,reviewApplied=false;
 const staleReview=()=>!!timeline?.vh2&&timeline.vh2.setupVersion!==baseSetupVersion;
 const refreshReview=document.createElement('button');refreshReview.type='button';refreshReview.textContent='Review against latest saved setup';refreshReview.hidden=!staleReview();
 dialog.querySelector('[data-status]').before(refreshReview);
 refreshReview.onclick=async()=>{if(reviewBusy||reviewApplied)return;refreshReview.disabled=true;try{if(getActiveCompanionTimeline(companion.id)!==timeline)throw Error('The selected life changed. Reopen this draft for the intended life.');await vh2Poll(companion,timeline,{force:true,throwOnError:true});dialog.close();await vhReviewLifeProposal(companion,{...built,...proposal},{...options,baseSetupVersion:timeline?.vh2?.setupVersion,skipRefresh:true});}catch(error){dialog.querySelector('[data-status]').textContent=error.message;refreshReview.disabled=false;}};
 if(options.repairIssues?.length){for(const b of dialog.querySelectorAll('[data-fill],[data-fill-missing]'))b.hidden=true;const evidence=document.createElement('p');evidence.textContent='Repair targets: '+options.repairIssues.map(x=>x.title+' — '+x.detail).join(' · ');dialog.querySelector('[data-sections]').before(evidence);}
 const selectedSections=()=>Object.fromEntries([...dialog.querySelectorAll('[data-section]:checked')].map(i=>[i.dataset.section,proposal[i.dataset.section]]));
 const completionSections=()=>{const selected=selectedSections();const sections=new Set(Object.keys(selected));for(const issue of vhProposalDependencyIssues(proposal,current,selected))sections.add(issue.owner);return [...sections];};
 const missingSections=()=>options.wholeLife?[...new Set([...companionWholeLifeMissing(options.personDraft||companion,{...current,...proposal}),...vhLifeCoherenceFindings({...current,...proposal}).map(i=>i.section)])]:Object.entries(proposal).filter(([key,value])=>(isSectionEmpty(value)&&companionLifeSectionNeedsGeneration(key,value))||(VH_ESSENTIAL_SECTIONS.includes(key)&&!vhSectionHasContent(key,value))||!!companionLifePolicyProblem(key,value)).map(([key])=>key);
 const selectSections=(keys)=>{for(const checkbox of dialog.querySelectorAll('[data-section]'))checkbox.checked=keys.includes(checkbox.dataset.section);checkDependencies();};
 const enableFillMissing=()=>{const missing=missingSections();dialog.querySelector('[data-fill-missing]').disabled=reviewBusy||reviewApplied||staleReview()||!missing.length;};
 vhLifeDraftOverview(dialog,built,proposal,current,options);
 if(built.__setupReport)vhLifeSetupReport(dialog,built);
 const fixes=document.createElement('section');fixes.className='vh-setup-help';dialog.querySelector('[data-status]').before(fixes);
 const checkDependencies=()=>{if(reviewApplied)return;refreshReview.hidden=!staleReview();refreshReview.disabled=reviewBusy;const selected=selectedSections(),coherenceGaps=options.wholeLife?vhLifeCoherenceFindings({...current,...selected}):[],wholeGaps=options.wholeLife?companionWholeLifeMissing(options.personDraft||companion,{...current,...selected}):[],invalid=Object.entries(selected).map(([k,v])=>[k,companionLifePolicyProblem(k,v)]).filter(([,message])=>message),issues=vhProposalDependencyIssues(proposal,current,selected),repairCheck=options.repairIssues?.length?vhAuditRepairCheck(companion,current,selected,options.repairIssues):null;dialog.querySelector('[data-status]').textContent=staleReview()?'Saved setup changed after this draft began. Review against the latest setup before applying; your draft is retained.':wholeGaps.length?'Complete this life: '+wholeGaps.map(k=>VH_LIFE_SECTIONS[k]||k).join(', ')+'. Use Fill missing sections to finish the draft.':coherenceGaps.length?'Needs a connected life: '+coherenceGaps.map(i=>i.detail).join(' '):invalid.length?'Needs completion: '+invalid.map(([k,message])=>VH_LIFE_SECTIONS[k]+' — '+message).join(' '):repairCheck&&!repairCheck.ok?repairCheck.errors.join(' '):issues.length?'Resolve the links below. '+vhProposalDependencies(proposal,current,selected).join(' '):Object.keys(selected).length?'Ready to apply selected changes.':'Select at least one section.';dialog.querySelector('[data-apply]').disabled=reviewBusy||staleReview()||!!wholeGaps.length||!!coherenceGaps.length||!!invalid.length||!!issues.length||(repairCheck&&!repairCheck.ok)||!Object.keys(selected).length;dialog.querySelector('[data-fill]').disabled=reviewBusy||staleReview()||!Object.keys(selected).length;vhRenderDependencyFixes(fixes,issues,proposal,current,dialog,checkDependencies);};dialog.querySelectorAll('[data-section]').forEach(i=>i.onchange=checkDependencies);checkDependencies();
 selectSections(Object.keys(proposal).filter(key=>!isSectionEmpty(proposal[key])||options.wholeLife&&Array.isArray(proposal[key])&&!companionWholeLifeMissing(options.personDraft||companion,{...current,...proposal}).includes(key)));
 enableFillMissing();
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
 const fillWithAI=async e=>{
  if(reviewBusy||reviewApplied)return;reviewBusy=true;
  const status=dialog.querySelector('[data-status]'),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),180000);
  dialog.addEventListener('close',()=>controller.abort(),{once:true});
  dialog.querySelectorAll('button,input,select,textarea').forEach(b=>{if(!b.hasAttribute('data-close'))b.disabled=true;});
  try{
   if(e.target.hasAttribute('data-fill-missing'))selectSections(missingSections());
   const sections=completionSections();if(!sections.length)throw Error('Select at least one section.');
   if(getActiveCompanionTimeline(companion.id)!==timeline)throw Error('The active timeline changed. Reopen this draft.');
   const candidate=safeJsonClone(companion);if(options.personDraft)applyBuiltCompanionProfile(candidate,options.personDraft);
   const completion=await completeCompanionLifeDraftSections(candidate,{...current,...built},{lifeDesign:built.__lifeDesign,wholeLife:!!options.wholeLife,model:options.generationModel||companionEffectiveLifeBuilderModel(companion),direction:options.generationDirection,repairIssues:options.repairIssues,requiredSections:sections,skipLifeRefresh:true,signal:controller.signal,onProgress:message=>status.textContent=message});
   if(!dialog.open||controller.signal.aborted)return;
   if(getActiveCompanionTimeline(companion.id)!==timeline)throw Error('The active timeline changed. Reopen this draft.');
   let updated={...built,__generationWarning:completion.repairWarning};
   for(const key of sections)updated[key]=vhConstrainAuditRepair(key,current[key],completion.draft[key]??[],options.repairIssues);
   if(options.wholeLife)updated=await reviewCompanionLifeCoherence(candidate,updated,{model:options.generationModel||companionEffectiveLifeBuilderModel(companion),direction:options.generationDirection,lifeDesign:built.__lifeDesign,signal:controller.signal,onProgress:message=>status.textContent=message});
   if(!dialog.open||controller.signal.aborted)return;
   dialog.close();await vhReviewLifeProposal(companion,updated,{...options,baseSetupVersion,generationDirection:options.generationDirection,generationModel:options.generationModel,repairIssues:options.repairIssues});
  }catch(error){reviewBusy=false;checkDependencies();enableFillMissing();status.textContent=controller.signal.aborted?'Generation timed out or was cancelled. Your draft is retained.':error.message;}
  finally{clearTimeout(timer);reviewBusy=false;if(dialog.open){const message=status.textContent;dialog.querySelectorAll('input,select,textarea').forEach(i=>i.disabled=false);checkDependencies();enableFillMissing();status.textContent=message;}}
 };dialog.querySelector('[data-fill]').onclick=fillWithAI;dialog.querySelector('[data-fill-missing]').onclick=fillWithAI;
 if(options.wholeLife){
  const retry=document.createElement('button');retry.type='button';retry.className='btn btn-ghost';retry.textContent='Check consistency with AI';dialog.querySelector('[data-fill]').after(retry);
  retry.onclick=async()=>{if(reviewBusy||reviewApplied||staleReview())return;reviewBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000),status=dialog.querySelector('[data-status]');dialog.addEventListener('close',()=>controller.abort(),{once:true});checkDependencies();retry.disabled=true;
   try{const candidate=safeJsonClone(companion);if(options.personDraft)applyBuiltCompanionProfile(candidate,options.personDraft);const updated=await reviewCompanionLifeCoherence(candidate,{...built,...proposal},{model:options.generationModel||companionEffectiveLifeBuilderModel(companion),direction:options.generationDirection,lifeDesign:built.__lifeDesign,signal:controller.signal,onProgress:message=>status.textContent=message});if(!dialog.open||controller.signal.aborted)return;if(getActiveCompanionTimeline(companion.id)!==timeline)throw Error('The selected life changed. Reopen this draft.');dialog.close();await vhReviewLifeProposal(companion,updated,{...options,baseSetupVersion,skipRefresh:true});}
   catch(error){status.textContent=controller.signal.aborted?'Consistency check cancelled. Your draft is retained.':error.message;}
   finally{clearTimeout(timer);reviewBusy=false;if(dialog.open){const message=status.textContent;checkDependencies();enableFillMissing();status.textContent=message;retry.disabled=false;}}
  };
 }

 dialog.querySelector('[data-apply]').onclick=async e=>{if(reviewBusy||reviewApplied)return;reviewBusy=true;dialog.querySelectorAll('input,select,textarea,button:not([data-close])').forEach(i=>i.disabled=true);e.target.disabled=true;const status=dialog.querySelector('[data-status]');status.textContent='Applying…';try{if(getActiveCompanionTimeline(companion.id)!==timeline)throw Error('The selected life changed. Reopen this draft for the intended life.');const selected=Object.fromEntries([...dialog.querySelectorAll('[data-section]:checked')].map(i=>[i.dataset.section,proposal[i.dataset.section]]));if(!Object.keys(selected).length)throw Error('Select at least one section.');if(options.repairIssues?.length){if(JSON.stringify(vhAuditSnapshot(companion,timeline))!==JSON.stringify(current))throw Error('Saved setup changed during repair review. Run Audit VH again.');const check=vhAuditRepairCheck(companion,vhAuditSnapshot(companion,timeline),selected,options.repairIssues);if(!check.ok)throw Error(check.errors.join(' '));}if(selected.places&&built.__setupReport)for(const p of selected.places){const draft=built.places.find(x=>x.id===p.id);if(draft)for(const key of ['googlePlaceId','mapCoordinates'])if(Object.hasOwn(draft,key))p[key]=safeJsonClone(draft[key]);}if(timeline?.vh2){await vhUiCommand(timeline,'apply_life_proposal',{version:2,baseSetupVersion,proposal:selected});const failures=await vhApplyDraftFeeds(timeline,built);if(failures.length){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry remaining feeds';retry.onclick=async()=>{retry.disabled=true;const remaining=await vhApplyDraftFeeds(timeline,built);status.textContent=remaining.length?remaining.join(' · '):'Remaining feeds connected.';retry.disabled=!remaining.length;};status.after(retry);}status.textContent='Applied to this life. Memories, inventory and history preserved. '+(failures.length?'Some feeds need attention: '+failures.join(' · '):'Selected news feeds connected.');}else{await vhSaveBlueprintProposal(companion,selected,{personDraft:options.personDraft});if(state.editingCompanionId===companion.id)renderCompanionStudioForm();renderCompanionLifeOverview(companion);status.textContent='Person and world saved. Ready to start a persistent life.';if(options.wholeLife){const start=document.createElement('button');start.type='button';start.className='btn btn-primary';start.textContent='Start this life';start.onclick=async()=>{start.disabled=true;status.textContent='Starting their persistent life…';try{const pending=getActiveCompanionTimeline(companion.id);if(pending?.vh2){await vh2Poll(companion,pending,{force:true,throwOnError:true});if(!pending.vh2.running)await vhUiCommand(pending,'set_running',{running:true});}else await vh2CreateTimeline(companion);const live=getActiveCompanionTimeline(companion.id);if(!live?.vh2?.running||live.vh2.error)throw Error(live?.vh2?.error||'The running life was not confirmed.');dialog.close();state.activeCompanionId=companion.id;switchView('companionChat');}catch(error){status.textContent='Blueprint saved. '+error.message;start.disabled=false;}};status.after(start);}}if(options.repairIssues?.length){const saved=vhAuditSnapshot(companion,timeline),check=vhAuditRepairCheck(companion,current,saved,options.repairIssues);status.textContent=check.ok?'Saved and checked: selected audit findings are resolved.':'Changes saved, but repair verification failed: '+check.errors.join(' ')+' Use Check saved setup to inspect the remaining items.';}if(options.repairIssues?.length){const recheck=document.createElement('button');recheck.type='button';recheck.textContent='Check saved setup';recheck.onclick=()=>{dialog.close();vhOpenAuditor(companion);};status.after(recheck);}reviewApplied=true;e.target.textContent='Applied';dialog.querySelector('[data-close]').textContent='Close';}catch(error){reviewBusy=false;dialog.querySelectorAll('input,select,textarea').forEach(i=>i.disabled=false);checkDependencies();enableFillMissing();status.textContent=error.message;}finally{reviewBusy=false;}};

 const applyButton=dialog.querySelector('[data-apply]'),applyDraft=applyButton.onclick;
 applyButton.onclick=async e=>{await applyDraft(e);if(applyButton.textContent==='Applied'){document.dispatchEvent(new CustomEvent('vh-author-saved',{detail:{companionId:companion.id}}));if(state.view==='vhWorkspace')vhRenderWorkspace();}};
 }

const VH_ITEM_CATEGORIES={object:'Other item',accessory:'Bag, jewellery or accessory',food:'Food & drink',ticket:'Tickets & experiences',vehicle:'Vehicle',top:'Top',bottom:'Trousers or skirt',dress:'Dress',outerwear:'Coat or jacket',underwear:'Underwear',shoes:'Shoes'};
function vhItemDetails(form,timeline){
 const select=form.elements.category;select.innerHTML=Object.entries(VH_ITEM_CATEGORIES).map(([v,label])=>`<option value="${v}">${label}</option>`).join('');
 const extra=document.createElement('div');extra.className='vh-item-details';select.closest('label').after(extra);
 const places=(timeline.vh2.travelPlaces||[]).map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.label)}</option>`).join('');
 select.onchange=()=>{const kind=select.value;extra.innerHTML=kind==='food'?'<label>Servings<input name="servings" type="number" min="1" max="50" value="1" required></label><label>Portion<select name="portion"><option value="10">Snack</option><option value="25" selected>Light meal</option><option value="45">Full meal</option></select></label><label>Fresh for (hours)<input name="freshHours" type="number" min="1" max="720" value="24" required></label><label>Ingredients / dietary tags<input name="dietaryTags" placeholder="e.g. dairy, vegetarian"></label>':kind==='ticket'?`<label>Event name<input name="eventName" required maxlength="160"></label><label>Venue<select name="placeId" required>${places}</select></label><label>Starts (your local time)<input name="startsAt" type="datetime-local" required></label><label>Ends (your local time)<input name="endsAt" type="datetime-local" required></label><p>The ticket records its venue and time. It can be used there during the event; receiving it does not schedule a visit.</p>`:kind==='vehicle'?`<label>Vehicle<select name="vehicleType"><option value="car">Car</option><option value="bicycle">Bicycle</option></select></label><label>Collection location<select name="placeId" required>${places}</select></label><label>They can operate this vehicle<input name="canOperate" type="checkbox"></label><p>Transport access changes after the received vehicle is collected at this location.</p>`:'';};select.onchange();
}
function vhItemPayload(form,timeline){
 const f=form.elements,kind=f.category.value,now=timeline.vh2.simAt||Date.now();let possession={};
 if(kind==='food')possession={servings:Number(f.servings.value),hungerRelief:Number(f.portion.value),expiresAt:now+Number(f.freshHours.value)*3600000,dietaryTags:f.dietaryTags.value.split(',').map(s=>s.trim()).filter(Boolean)};
 if(kind==='ticket')possession={placeId:f.placeId.value,eventName:f.eventName.value,startsAt:Date.parse(f.startsAt.value),endsAt:Date.parse(f.endsAt.value)};
 if(kind==='vehicle')possession={placeId:f.placeId.value,vehicleType:f.vehicleType.value,canOperate:f.canOperate.checked};
 return {name:f.name.value,category:kind,tags:f.tags.value.split(',').map(s=>s.trim()).filter(Boolean),possession};
}
function vhOpenOwnedItem(companion){
 const timeline=getActiveCompanionTimeline(companion.id);if(!timeline?.vh2)return;
 const d=document.createElement('dialog');d.className='vh-review-dialog';d.setAttribute('aria-label','Add an owned item');d.innerHTML='<header><h2>They already own this</h2><button type="button" class="btn btn-ghost" data-close>Close</button></header><p>Add a possession without buying or sending it. Clothing joins their wardrobe.</p><form><label>Item name<input name="name" required maxlength="200"></label><label>Kind<select name="category"></select></label><label>Tags<input name="tags" placeholder="casual, favourite, cozy"></label><label>Reference photo<input name="photo" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="submit" class="btn btn-primary">Add owned item</button></form><p role="status"></p>';
 const form=d.querySelector('form');vhItemDetails(form,timeline);form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button[type=submit],button:not([type])');b.disabled=true;try{const photo=form.elements.photo.files[0]?await normalizeUploadedImage(form.elements.photo.files[0],960,.8):'';await vhUiCommand(timeline,'add_owned_item',{...vhItemPayload(form,timeline),photo});d.querySelector('[role=status]').textContent='Added to their possessions.';b.textContent='Added';vhRenderWorkspace();}catch(error){d.querySelector('[role=status]').textContent=error.message;b.disabled=false;}};
 d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>d.remove();document.body.append(d);d.showModal();
}

async function vhOpenPlace(companion,placeId){
 const timeline=getActiveCompanionTimeline(companion.id),link=timeline.vh2,place=link.travelPlaces.find(p=>p.id===placeId);if(!place)return;
 const d=document.createElement('dialog');d.className='vh-review-dialog';d.id='vh-place-editor';d.setAttribute('aria-label',place.label);d.innerHTML=`<header><h2>${escapeHTML(place.label)}</h2><button type="button" class="btn btn-ghost" data-close>Close</button></header><form data-place-form><label>Name<input name="label" value="${escapeHTML(place.label)}" required maxlength="200"></label><label>Place details<textarea name="detail" maxlength="2000">${escapeHTML(place.detail||'')}</textarea></label><div class="vh-form-columns"><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" value="${place.mapCoordinates?.[1]??''}" placeholder="33.4255"></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" value="${place.mapCoordinates?.[0]??''}" placeholder="-111.9400"></label></div><p>Coordinates work without a map listing or API key. Existing photos stay linked. Travel still uses saved routes; a pin alone does not establish a walkable route.</p><button type="submit">Save place</button></form><h3>Rooms</h3><div data-rooms></div><form data-room-form><label>New room<input name="label" placeholder="Bedroom, kitchen…" required maxlength="120"></label><label>Room appearance<textarea name="description" maxlength="2000"></textarea></label><button type="submit">Add room</button></form><h3>Photos of this place</h3><div data-photos></div><p role="status"></p>`;
 const placeForm=d.querySelector('[data-place-form]');let coordinateOnly=!place.googlePlaceId;if(place.googlePlaceId){const source=document.createElement('label');source.textContent='Position source';const choice=document.createElement('select');choice.name='positionSource';choice.innerHTML='<option value="listing">Linked map listing</option><option value="coordinates">Use coordinates instead</option>';source.append(choice);placeForm.querySelector('.vh-form-columns').before(source);const update=()=>{coordinateOnly=choice.value==='coordinates';placeForm.elements.latitude.readOnly=placeForm.elements.longitude.readOnly=!coordinateOnly;};choice.onchange=update;update();}
 const status=d.querySelector('[role=status]');const run=async(form,fn)=>{const b=form.querySelector('button[type=submit],button:not([type])');b.disabled=true;try{await fn();status.textContent='Saved to this life.';render();vhRenderWorkspace();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};
 d.querySelector('[data-place-form]').onsubmit=e=>{e.preventDefault();run(e.target,()=>vhUiCommand(timeline,'upsert_place',{place:{id:place.id,label:e.target.elements.label.value,kind:place.kind,detail:e.target.elements.detail.value,...(coordinateOnly?{googlePlaceId:''}:{}),...((e.target.elements.latitude.value!==''||e.target.elements.longitude.value!=='')?{latitude:e.target.elements.latitude.value===''?null:Number(e.target.elements.latitude.value),longitude:e.target.elements.longitude.value===''?null:Number(e.target.elements.longitude.value)}:{})}}));};
 d.querySelector('[data-room-form]').onsubmit=e=>{e.preventDefault();run(e.target,async()=>{await vhUiCommand(timeline,'save_place_zone',{placeId,label:e.target.elements.label.value,description:e.target.elements.description.value});e.target.reset();});};
 const render=()=>{const rooms=d.querySelector('[data-rooms]');rooms.replaceChildren();for(const zone of link.visual?.zones||[]){if(zone.placeId!==placeId)continue;const row=document.createElement('article');row.className='vh-entity-card';row.innerHTML=`<h4>${escapeHTML(zone.label)}</h4><p>${escapeHTML(zone.description)}</p>`;const b=document.createElement('button');b.textContent='Room photos';b.onclick=()=>vhEntityPhotos(companion,timeline,'zone',zone.id,zone.label,zone.description);row.append(b);const edit=document.createElement('button');edit.textContent='Edit room';edit.onclick=()=>vhRoomEditor(companion,zone);row.append(edit);rooms.append(row);}const photos=d.querySelector('[data-photos]');photos.replaceChildren();for(const e of link.bible?.entries||[]){if(e.role!=='place'||e.entityId!==placeId||e.status==='archived')continue;const img=document.createElement('img');img.src=vh2PhotoAssetUrl(link.worldId,e.assetId);img.alt=e.label+' · '+e.status;img.style.cssText='width:100px;height:100px;object-fit:cover;margin:8px';photos.append(img);}const b=document.createElement('button');b.textContent='Add or review place photos';b.onclick=()=>vhEntityPhotos(companion,timeline,'place',placeId,place.label,place.detail||'');photos.append(b);};
 const travel=document.createElement('button');travel.textContent='Travel settings';travel.onclick=()=>{d.close();vhOpenPanel('Saved places & routes');const select=document.querySelector('#vh2-chat-controls select[aria-label="Place to edit"]');if(select){select.value=placeId;select.dispatchEvent(new Event('change',{bubbles:true}));select.focus();}const origin=document.querySelector('#vh2-chat-controls select[aria-label="Route origin"]');if(origin)origin.value=placeId;};d.querySelector('[data-place-form]').after(travel);
 const removal=document.createElement('section');const removalNote=document.createElement('p');removalNote.textContent='A place contains rooms. Remove an unused place while life is running or paused; its rooms and saved routes are removed from future use, and its reference photos are archived. Conversation, past events and captured photos remain. Places used by current locations, commitments, people or plans must be unlinked first.';const remove=document.createElement('button');remove.type='button';remove.textContent='Remove this place and its rooms';removal.append(removalNote,remove);status.before(removal);
 remove.onclick=async()=>{remove.disabled=true;status.textContent='Checking linked settings…';try{await vhUiCommand(timeline,'remove_place',{placeId,baseSetupVersion:link.setupVersion});d.close();vhRenderWorkspace();}catch(error){status.textContent=error.message;remove.disabled=false;}};
 render();d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>d.remove();document.body.append(d);d.showModal();
}
async function vhEntityPhotos(companion,timeline,role,entityId,label,description=''){
 const d=document.createElement('dialog');d.className='vh-review-dialog';d.setAttribute('aria-label',label+' photos');d.innerHTML=`<header><h2>${escapeHTML(label)} · Photos</h2><button type="button" class="btn btn-ghost" data-close>Close</button></header><p>Linked to ${escapeHTML(label)}. New images need approval before use.</p><div data-assets></div><form><label>Photo label<input name="label" value="${escapeHTML(label)} reference" required maxlength="120"></label><label>Upload<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required></label><button type="submit">Upload for review</button></form><details><summary>Generate a reference</summary><label>Visual details<textarea data-description>${escapeHTML(description)}</textarea></label><p>One image using this character’s image provider. You will review the prompt before submission.</p><button type="button" data-generate>Review generation</button></details><p role="status"></p>`;
 const view=document.createElement('select');view.name='view';view.setAttribute('aria-label','Reference view');view.innerHTML=vhOptions(VH_REFERENCE_VIEWS[role]||[]);const viewLabel=document.createElement('label');viewLabel.textContent='View';viewLabel.append(view);d.querySelector('form').before(viewLabel);
 const status=d.querySelector('[role=status]');const refresh=()=>{const host=d.querySelector('[data-assets]');host.replaceChildren();for(const entry of timeline.vh2.bible?.entries||[]){if(entry.entityId!==entityId||entry.role!==role||entry.status==='archived')continue;const row=document.createElement('article');row.className='vh-entity-card';row.innerHTML=`<img style="width:120px;height:120px;object-fit:contain" src="${escapeHTML(vh2PhotoAssetUrl(timeline.vh2.worldId,entry.assetId))}" alt="${escapeHTML(entry.label)}"><p>${escapeHTML(entry.label)} · ${escapeHTML(entry.status)}</p>`;for(const [text,type,body] of [['Approve','review_bible_asset',{entryId:entry.id,status:'approved'}],['Remove from use','archive_bible_asset',{entryId:entry.id}]]){const b=document.createElement('button');b.textContent=text;b.onclick=async()=>{b.disabled=true;try{await vhUiCommand(timeline,type,body);refresh();}catch(e){status.textContent=e.message;b.disabled=false;}};row.append(b);}host.append(row);}};
 d.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button[type=submit],button:not([type])');b.disabled=true;try{const file=f.elements.image.files[0];if(!file)throw Error('Choose an image to upload.');status.textContent='Optimizing image for storage…';const image=await vh2NormalizeUploadedImage(file);await vhUiCommand(timeline,'add_bible_asset',{role,entityId,label:f.elements.label.value,tags:[view.value],image});status.textContent='Uploaded. Approve to use in future photos.';refresh();}catch(error){status.textContent=error.message;}finally{b.disabled=false;}};
 d.querySelector('[data-generate]').onclick=async e=>{e.target.disabled=true;const selectedView=view.value;try{await vhUiCommand(timeline,'capture_reference',{role,entityId,view:view.value,description:d.querySelector('[data-description]').value});const capturedPhotoId=timeline.vh2.lastPhotoId;await vhOpenPhotoReview(companion,timeline,capturedPhotoId,async()=>{await vhUiCommand(timeline,'add_bible_asset',{role,entityId,label:label+' reference',tags:[selectedView],photoId:capturedPhotoId});refresh();});}catch(error){status.textContent=error.message;}finally{e.target.disabled=false;}};
 refresh();d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>d.remove();document.body.append(d);d.showModal();
}

function vhMeaningfulControls(host){
 const definitions={
 'Recent-wear repetition penalty':{label:'Outfit variety',choices:[[0,'Repeat favourites'],[12,'Balanced rotation'],[30,'Prefer variety'],[60,'Strong variety preference']],hint:'Reduces the ranking of recently worn clothes; it does not force an outfit change.'},
 'Garment warmth (0–5)':{label:'How warm are these clothes?',choices:[[0,'Very light'],[1,'Light'],[2,'Medium'],[3,'Warm'],[4,'Very warm'],[5,'Insulated']],hint:'Used with the weather when choosing clothing.'},
 'Travel curiosity':{label:'Interest in exploring',choices:[[20,'Usually stays local'],[50,'Sometimes explores'],[80,'Often explores']],hint:'Interest competes with cost, energy and commitments; visits are never guaranteed.'},
 'Curiosity':{label:'Curiosity',choices:[[20,'Familiar routines'],[50,'Open to something new'],[80,'Actively curious']],hint:'Affects exploration alongside energy, money and obligations.'},
 'Commitment to obligations':{label:'Commitment to obligations',choices:[[20,'Easygoing'],[50,'Usually dependable'],[80,'Highly conscientious']],hint:'How strongly commitments compete with other needs.'},
 'Willingness to trust (0–100)':{label:'Willingness to trust',choices:[[20,'Guarded'],[50,'Cautiously open'],[80,'Readily trusting']],hint:'A starting disposition, not an automatic relationship level.'},
 'Sociability (0–100)':{label:'Social appetite',choices:[[20,'Prefers solitude'],[50,'Enjoys a balance'],[80,'Seeks company']],hint:'Social motivation competes with fatigue, context and relationships.'},
 'Openness (0–100)':{label:'Openness to new experiences',choices:[[20,'Prefers the familiar'],[50,'Selectively curious'],[80,'Adventurous']],hint:'Shapes responses to unfamiliar situations.'},
 'Sensitivity to negative encounters (0–100)':{label:'Sensitivity to friction',choices:[[20,'Usually brushes it off'],[50,'Moderately sensitive'],[80,'Takes it to heart']],hint:'How strongly negative encounters affect social appraisal.'},
 'Variation in choices':{label:'How varied are their choices?',choices:[[5,'Predictable'],[20,'Flexible'],[40,'Spontaneous']],hint:'Adds variation among available choices; does not override physical limits.'}
 };
 const keyed={curiosity:definitions.Curiosity,conscientiousness:definitions['Commitment to obligations'],temperature:definitions['Variation in choices'],sociability:definitions['Sociability (0–100)'],trustOpenness:definitions['Willingness to trust (0–100)'],openness:definitions['Openness (0–100)'],sensitivity:definitions['Sensitivity to negative encounters (0–100)']};
 for(const field of host.querySelectorAll('input[type=number]')){if(field.dataset.meaningful)continue;const label=field.closest('label');if(!label)continue;const text=label.textContent.trim(),spec=keyed[field.dataset.behaviorKey]||definitions[text];if(!spec)continue;field.dataset.meaningful='true';const box=document.createElement('div');box.className='vh-meaningful-control';const select=document.createElement('select');select.setAttribute('aria-label',spec.label);for(const [value,name] of spec.choices){const opt=document.createElement('option');opt.value=String(value);opt.textContent=name;select.append(opt);}if(!spec.choices.some(([v])=>v===Number(field.value))){const custom=document.createElement('option');custom.value=field.value;custom.textContent='Custom preference';select.append(custom);}select.value=field.value;const title=document.createElement('label');title.textContent=spec.label;title.append(select);const hint=document.createElement('p');hint.textContent=spec.hint;const advanced=document.createElement('button');advanced.type='button';advanced.textContent='Adjust exact value';advanced.onclick=()=>{label.hidden=!label.hidden;advanced.setAttribute('aria-expanded',String(!label.hidden));};select.onchange=()=>{field.value=select.value;field.dispatchEvent(new Event('input',{bubbles:true}));};field.addEventListener('input',()=>{let opt=[...select.options].find(o=>o.value===field.value);if(!opt){opt=document.createElement('option');opt.value=field.value;opt.textContent='Custom preference';select.append(opt);}select.value=field.value;});box.append(title,hint,advanced);label.hidden=true;label.before(box);}
 if(typeof vhSmartControls==='function')vhSmartControls(host);
}

function vhLifeDraftOverview(dialog,built,proposal,current,options={}){
 const box=document.createElement('section');box.className='vh-draft-overview';box.setAttribute('aria-label','What this draft makes possible');
 const title=document.createElement('h3');title.textContent='A life you can fine-tune';box.append(title);
 const design=vhBuilderLifeDesign(built.__lifeDesign);
 if(design){const h=document.createElement('h3');h.textContent='What drives them';const p=document.createElement('p');p.textContent=design.premise;box.append(h,p);const list=document.createElement('ul');for(const motive of design.motivations){const item=document.createElement('li');item.textContent=motive.want+' — '+motive.opportunity+(motive.friction?' · '+motive.friction:'');list.append(item);}box.append(list);if(design.limits.length){const note=document.createElement('p');note.textContent='Not covered by this draft: '+design.limits.join(' ');box.append(note);}}
 const quality=built.__coherenceReview;
 if(quality){const h=document.createElement('h3');h.textContent=quality.status==='checked'?'Checked against the brief':quality.status==='unavailable'?'Consistency check did not finish':'Details that need attention';const p=document.createElement('p');p.textContent=quality.summary;box.append(h,p);if(quality.issues.length){const list=document.createElement('ul');for(const issue of quality.issues){const row=document.createElement('li');row.textContent=(VH_LIFE_SECTIONS[issue.section]||issue.section)+': '+issue.detail;list.append(row);}box.append(list);}}
 if(built.summary){const p=document.createElement('p');p.textContent=built.summary;box.append(p);}
 const all={...current,...proposal},cards=[['Person',proposal.expression?.personality||options.personDraft?.personality],['Appearance & voice',[proposal.expression?.appearance,proposal.expression?.textingStyle].filter(Boolean).join(' ')],['Independent choices',all.autonomy?vhSetupSummary('autonomy',all.autonomy):'Independent-life settings are missing.'],['Social life',all.socialPlanPolicy?vhSetupSummary('socialPlanPolicy',all.socialPlanPolicy):'Invitation settings are missing.'],['Important dates',all.personalCalendar?.length?all.personalCalendar.length+' saved dates, including birthdays. Suggested fictional dates are marked below.':'Missing birthdays receive editable fictional dates when this life starts.'],['Story & everyday drama',all.storyPolicy&&vhSetupSummary('storyPolicy',all.storyPolicy)],['Personal preferences & boundaries',all.personalPreferences&&vhSetupSummary('personalPreferences',all.personalPreferences)],['Health & emotions',[all.healthPolicy&&vhSetupSummary('healthPolicy',all.healthPolicy),all.psychologyPolicy&&vhSetupSummary('psychologyPolicy',all.psychologyPolicy)].filter(Boolean).join(' · ')]];
 const grid=document.createElement('div');grid.className='vh-draft-summary-grid';for(const [label,detail] of cards){if(!detail)continue;const article=document.createElement('article'),h=document.createElement('h4'),p=document.createElement('p');h.textContent=label;p.textContent=detail;article.append(h,p);grid.append(article);}box.append(grid);
 const counts=document.createElement('p');counts.className='vh-draft-coverage';const count=(n,one,many)=>n+' '+(n===1?one:many);counts.textContent=[count((all.places||[]).length,'place','places'),count((all.rooms||[]).length,'room','rooms'),count((all.socialCircle||[]).length,'known person','known people'),count((all.peopleLives||[]).filter(p=>p.policy?.homePlaceId).length,'independent supporting life','independent supporting lives'),count((all.wardrobe||[]).length,'saved outfit','saved outfits'),count((all.activityOptions||[]).length,'free-time activity','free-time activities')].join(' · ');box.append(counts);
 const assumptions=Array.isArray(built.assumptions)?built.assumptions:[];if(assumptions.length){const h=document.createElement('h3');h.textContent='Assumptions to review';box.append(h);const list=document.createElement('ul');for(const a of assumptions){const li=document.createElement('li');li.textContent=typeof a==='string'?a:[a.label,a.detail].filter(Boolean).join(': ');if(a.section&&VH_LIFE_SECTIONS[a.section]){const b=document.createElement('button');b.type='button';b.className='btn btn-ghost';b.textContent='Review '+VH_LIFE_SECTIONS[a.section].toLowerCase();b.onclick=()=>{const section=dialog.querySelector('[data-section="'+a.section+'"]')?.closest('details');if(section){section.open=true;section.scrollIntoView({block:'center',behavior:'smooth'});}};li.append(b);}list.append(li);}box.append(list);}
 const gaps=[];for(const key of Object.keys(VH_LIFE_POLICY_LABELS).filter(k=>k!=='socialPrivateVisitPermissions'))if(options.wholeLife&&companionLifeSectionNeedsGeneration(key,all[key]))gaps.push(VH_LIFE_SECTIONS[key]+': '+(companionLifePolicyProblem(key,all[key])||'settings are missing')+'');const actors=new Set((all.peopleLives||[]).filter(p=>p.policy?.homePlaceId).map(p=>p.personId));const unplaced=(all.socialCircle||[]).filter(p=>!actors.has(p.id));if(unplaced.length)gaps.push('No independent home setup for '+unplaced.map(p=>p.name||p.id).join(', ')+'.');
 const fict=all.population?.fictional;if(fict?.enabled&&(!(fict.homePlaceIds||[]).length||!(fict.publicPlaceIds||[]).length))gaps.push('New residents need both homes and public places before they can participate.');
 if(!(all.places||[]).some(p=>p.mapCoordinates?.length===2))gaps.push('Street-map positioning still needs a local map or verified coordinates. Proposed travel times work as simulation estimates.');
 const readiness=document.createElement('p');readiness.className='vh-setup-help';readiness.textContent=gaps.length?'Still needs attention: '+gaps.join(' '):'Linked places and supporting lives are present. Review the selections below before applying.';box.append(readiness);
 const media=document.createElement('p');media.className='form-hint';media.textContent='Reference slots and descriptions are prepared. Generating images or videos uses the connection you choose later. Existing provider settings and automatic rendering permissions are preserved.';box.append(media);dialog.querySelector('[data-sections]').before(box);
}

const vhLifeDraftJobs=new Map();
async function vhImportTemplateReferences(companion,timeline){
 let added=0;for(const place of companion.lifeProfile.places||[]){if(!place.photo||place.referenceDisabled||!timeline.vh2.travelPlaces.some(p=>p.id===place.id))continue;const existing=(timeline.vh2.bible?.entries||[]).some(e=>e.entityId===place.id&&e.tags.includes('blueprint_import'));if(existing)continue;await vhUiCommand(timeline,'add_bible_asset',{role:'place',entityId:place.id,label:place.label+' · imported reference',tags:['blueprint_import'],image:await vh2NormalizeStoredImage(place.photo)});added++;}showToast(added?`${added} references imported for review.`:'No unmatched place photos to import. Places must already exist in this life.','info');vhRenderWorkspace();
}

// Task-first authoring. Engine forms remain available under Advanced settings.
let vhAdvancedOpen=false;
let vhWardrobeTab='presets';
function vhWorkspaceProgressive(query){
 const host=document.getElementById('vh2-chat-controls');if(!host)return;
 let toggle=document.getElementById('vh-advanced-toggle');if(!toggle){toggle=document.createElement('button');toggle.id='vh-advanced-toggle';toggle.className='vh-advanced-toggle';host.before(toggle);toggle.onclick=()=>{vhAdvancedOpen=!vhAdvancedOpen;vhFilterWorkspace();};}
 const linked=!!getActiveCompanionTimeline(state.activeCompanionId)?.vh2;
 const use=linked&&['closet','places','people','life','connections','references'].includes(vhWorkspaceSection)&&!query;
 toggle.hidden=!use;toggle.textContent=vhWorkspaceSection==='references'?(vhAdvancedOpen?'Hide extra tools':'More reference tools'):(vhAdvancedOpen?'Hide advanced settings':'Advanced settings');toggle.setAttribute('aria-expanded',String(vhAdvancedOpen));
 if(!linked||(use&&!vhAdvancedOpen))for(const el of host.children)el.hidden=true;
}
const VH_STYLE_STARTERS=[
 {name:'Everyday casual',context:'casual',description:'Easy separates for ordinary days.',pieces:{top:['Cotton T-shirt','Relaxed shirt'],bottom:['Straight-leg jeans','Cotton trousers'],shoes:['Everyday trainers']},warmth:2},
 {name:'At home',context:'home',description:'Soft layers and comfortable favourites.',pieces:{top:['Soft cotton tee','Loose long-sleeve top'],bottom:['Lounge trousers','Jersey shorts'],shoes:['House slippers']},warmth:2},
 {name:'Work & study',context:'work',description:'Simple, practical weekday options.',pieces:{top:['Button-down shirt','Fine-knit top'],bottom:['Tailored trousers','Dark jeans'],shoes:['Flat everyday shoes']},warmth:2},
 {name:'Activewear',context:'fitness',description:'Mix-and-match exercise clothes.',pieces:{top:['Breathable training top','Athletic tee'],bottom:['Training shorts','Track trousers'],shoes:['Running shoes']},warmth:1},
 {name:'Going out',context:'social',description:'More intentional evening separates.',pieces:{top:['Fitted evening top','Textured shirt'],bottom:['Dark tailored trousers','Black jeans'],shoes:['Smart shoes']},warmth:2},
 {name:'Sleepwear',context:'sleep',description:'Comfortable options for bedtime.',pieces:{top:['Soft sleep tee','Pyjama shirt'],bottom:['Pyjama trousers','Sleep shorts']},warmth:1}
];
function vhWardrobeHome(root,companion,timeline,owned,worn){
 const link=timeline.vh2,presets=link.legacyPresets||[],styles=link.closet?.styles||[];
 root.innerHTML=`<div class="vh-outfit-strip"><span>Wearing now</span><strong>${escapeHTML(worn.label||'No outfit recorded yet')}</strong></div><div class="vh-local-tabs" role="tablist" aria-label="Wardrobe views">${[['presets','Outfit presets',presets.length],['items','Clothing items',owned.length],['styles','Style preferences',styles.length]].map(([id,name,count])=>`<button role="tab" id="vh-wardrobe-${id}" aria-controls="vh-wardrobe-panel" tabindex="${vhWardrobeTab===id?0:-1}" aria-selected="${vhWardrobeTab===id}" data-wardrobe-tab="${id}">${name}<span>${count}</span></button>`).join('')}</div><section id="vh-wardrobe-panel" data-wardrobe-content role="tabpanel" aria-labelledby="vh-wardrobe-${vhWardrobeTab}"></section>`;
 vhGenerationActions(root,companion,['wardrobe','styleProfiles']);
 root.querySelectorAll('[data-wardrobe-tab]').forEach(b=>b.onclick=()=>{vhWardrobeTab=b.dataset.wardrobeTab;vhWorkspaceSpecial(true);});
 root.querySelector('.vh-local-tabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const keys=['presets','items','styles'];let i=keys.indexOf(vhWardrobeTab);i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;vhWardrobeTab=keys[i];vhWorkspaceSpecial(true);document.getElementById('vh-wardrobe-'+vhWardrobeTab)?.focus();};
 const mode=document.createElement('label');mode.className='vh-wardrobe-mode';mode.innerHTML='<span>How they choose clothes</span><select aria-label="How they choose clothes"><option value="presets">Choose complete outfit presets</option><option value="items">Mix clothing items & style preferences</option></select>';const select=mode.querySelector('select');select.value=link.closet?.enabled?'items':link.setupProfile?.world?.closet?.mode||'presets';select.onchange=async()=>{select.disabled=true;try{await vhUiCommand(timeline,'configure_closet',{enabled:select.value==='items',outfitMode:select.value,repetitionPenalty:link.closet?.repetitionPenalty??12});vhRenderWorkspace();}catch(error){showToast(error.message,'error');select.disabled=false;}};root.querySelector('.vh-outfit-strip').after(mode);
 const body=root.querySelector('[data-wardrobe-content]'),heading=(title,copy,action)=>`<div class="vh-task-heading"><div><h3>${title}</h3><p>${copy}</p></div><button type="button" data-primary>${action}</button></div>`;
 if(vhWardrobeTab==='presets'){
 body.innerHTML=heading('Outfit presets','Saved complete looks. Open one to see its clothes and occasion.','Add outfit preset')+'<div class="vh-entity-grid" data-grid></div>';
 body.querySelector('[data-primary]').onclick=()=>vhOutfitEditor(companion);
 const grid=body.querySelector('[data-grid]');for(const preset of presets){const card=document.createElement('article');card.className='vh-wardrobe-card';card.innerHTML=`<span class="vh-state-chip">${escapeHTML(preset.context||'Everyday')}</span><h3>${escapeHTML(preset.label)}</h3><p>${escapeHTML(preset.items||'No clothes described yet')}</p><button type="button">Edit preset</button>`;card.querySelector('button').onclick=()=>vhOutfitEditor(companion,preset);grid.append(card);}
 if(!presets.length)grid.innerHTML='<div class="vh-empty-state"><h3>Save a complete look</h3><p>An outfit preset describes one look, such as a favourite work outfit. Style preferences below let them choose between different pieces.</p></div>';
 }else if(vhWardrobeTab==='items'){
 body.innerHTML=heading('Clothes they own','Individual garments and received clothing gifts.','Add clothing item')+'<div class="vh-entity-grid">'+owned.map(i=>`<article class="vh-wardrobe-card">${i.photo?`<img class="vh-garment-image" src="${escapeHTML(i.photo)}" alt="${escapeHTML(i.name)}">`:'<div class="vh-garment-placeholder" aria-hidden="true">◇</div>'}<h3>${escapeHTML(i.name)}</h3><p>${escapeHTML(VH_ITEM_CATEGORIES[i.category]||i.category)}</p><span class="vh-state-chip">${worn.ids?.includes(i.id)?'Wearing now':'In wardrobe'}</span><button type="button" data-edit-garment="${escapeHTML(i.id)}">Edit item</button></article>`).join('')+'</div>';
 body.querySelectorAll('[data-edit-garment]').forEach(b=>b.onclick=()=>vhGarmentEditor(companion,owned.find(i=>i.id===b.dataset.editGarment)));
 body.querySelector('[data-primary]').onclick=()=>{vhOpenOwnedItem(companion);const f=document.querySelector('dialog[aria-label="Add an owned item"] form');f.elements.category.value='top';f.elements.category.onchange();};if(!owned.length)body.insertAdjacentHTML('beforeend','<div class="vh-empty-state"><h3>No individual clothes recorded</h3><p>Add an item they own, or use a style preference to build their closet over time.</p></div>');
 }else{
 body.innerHTML=heading('Style preferences','Different pieces they can combine for an occasion. Starter styles are editable suggestions.','Create a style')+'<div class="vh-entity-grid" data-grid></div><h3 class="vh-section-label">Start with a style</h3><div class="vh-style-starters"></div>';
 body.querySelector('[data-primary]').onclick=()=>vhStyleEditor(companion);
 const grid=body.querySelector('[data-grid]');for(const style of styles){const card=document.createElement('article');card.className='vh-wardrobe-card';card.innerHTML=`<span class="vh-state-chip">${escapeHTML(style.context)}</span><h3>${escapeHTML(style.name)}</h3><p>${Object.values(style.pieces||{}).reduce((n,a)=>n+a.length,0)} garment options</p><button type="button">Edit style</button>`;card.querySelector('button').onclick=()=>vhStyleEditor(companion,style);grid.append(card);}if(!styles.length)grid.innerHTML='<p>No style preferences yet. Choose a starter below or create your own.</p>';
 const starters=body.querySelector('.vh-style-starters');for(const style of VH_STYLE_STARTERS){const b=document.createElement('button');b.innerHTML=`<strong>${escapeHTML(style.name)}</strong><span>${escapeHTML(style.description)}</span><small>Preview & customize →</small>`;b.onclick=()=>vhStyleEditor(companion,style);starters.append(b);}
 }
}
function vhProductDialog(title,copy){const d=document.createElement('dialog');d.className='vh-review-dialog vh-product-dialog';d.setAttribute('aria-label',title);d.innerHTML=`<header><div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(copy)}</p></div><button type="button" data-close>Close</button></header><form></form><p role="status"></p>`;const opener=document.activeElement;d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>{d.remove();if(opener?.isConnected&&typeof opener.focus==='function')opener.focus();};d.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const controls=[...d.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.checkVisibility()&&el.getClientRects().length);if(!controls.length){event.preventDefault();return;}const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&(document.activeElement===first||!d.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!d.contains(document.activeElement))){event.preventDefault();first.focus();}});document.body.append(d);d.showModal();queueMicrotask(()=>{if(d.isConnected)vhSmartControls(d);});return d;}
async function vhSaveAuthorSection(companion,key,rows,reviewedVersion,expectedTimeline){
 const timeline=getActiveCompanionTimeline(companion.id);
 if(getCompanion(companion.id)!==companion||(expectedTimeline!==undefined&&timeline!==expectedTimeline))throw Error('The selected life changed. Close this editor and reopen it for the intended life.');
 for(const row of rows){
  const name=key==='socialCircle'||key==='styleProfiles'?row.name:key==='weeklySchedule'?row.activity:row.label;
  if(!String(name||'').trim())throw Error('Enter a name before saving.');
  if(key==='wardrobe'&&!String(row.items||'').trim())throw Error('Describe the clothes before saving this outfit.');
 }
 if(timeline?.vh2){await vhUiCommand(timeline,'apply_life_proposal',{version:2,baseSetupVersion:reviewedVersion??timeline.vh2.setupVersion??0,proposal:{[key]:rows}});}
 else{
  const target=key==='styleProfiles'?companion:companion.lifeProfile,field=key==='styleProfiles'?'lifeStyleProfiles':key,previous=target[field];
  const map=new Map((previous||[]).map(s=>[s.id,s]));for(const row of rows)map.set(row.id,{...map.get(row.id),...row});
  const limits={wardrobe:30,socialCircle:30,places:48,weeklySchedule:160,activityOptions:16,styleProfiles:20};
  if(limits[key]&&map.size>limits[key])throw Error('This section supports '+limits[key]+' entries. Edit an existing entry or remove one before adding another.');
  target[field]=[...map.values()];
  try{await saveCompanionTemplatesState();}catch(error){target[field]=previous;throw error;}
 }
 document.dispatchEvent(new CustomEvent('vh-author-saved',{detail:{companionId:companion.id,key}}));
}
async function vhSaveBlueprintProposal(companion,selected,options={}){
 const merged={...companion.lifeProfile,...selected};
 for(const key of ['places','socialCircle','wardrobe','weeklySchedule','activityOptions'])if(Array.isArray(selected[key])){
  const rows=new Map((companion.lifeProfile[key]||[]).map(row=>[row.id,row]));for(const row of selected[key])rows.set(row.id,{...rows.get(row.id),...row});merged[key]=[...rows.values()];
 }
 const candidate=safeJsonClone(companion);if(options.personDraft&&selected.expression)applyBuiltCompanionProfile(candidate,options.personDraft);if(selected.expression)for(const [key,value] of Object.entries(selected.expression)){if(key==='voice')candidate.lifeProfile.world.voice=safeJsonClone(value);else candidate[key]=safeJsonClone(value);}applyBuiltCompanionLife(candidate,merged);
 for(const key of ['places','socialCircle','wardrobe','weeklySchedule','activityOptions'])if(Array.isArray(selected[key])){
  const actual=new Set(candidate.lifeProfile[key].map(row=>row.id));if(merged[key].some(row=>!actual.has(row.id)))throw Error('The '+VH_LIFE_SECTIONS[key]+' draft exceeds limits or contains an invalid entry. No changes were saved.');
 }
 if(selected.styleProfiles){const rows=new Map((companion.lifeStyleProfiles||[]).map(row=>[row.id,row]));for(const row of selected.styleProfiles)rows.set(row.id,row);if(rows.size>20)throw Error('The wardrobe supports twenty styles. No changes were saved.');candidate.lifeStyleProfiles=[...rows.values()];}
 candidate.lifeSetupPolicies={...companion.lifeSetupPolicies};
 for(const key of VH_EXECUTABLE_POLICY_KEYS)if(selected[key]!==undefined){
  if(Array.isArray(selected[key])){const id=row=>['peopleLives','socialPrivateVisitPermissions'].includes(key)?row.personId:key==='routes'?[row.from,row.to,row.mode].join('|'):row.id,rows=new Map((candidate.lifeSetupPolicies[key]||[]).map(row=>[id(row),row]));for(const row of selected[key])rows.set(id(row),{...rows.get(id(row)),...row});candidate.lifeSetupPolicies[key]=[...rows.values()];}
  else candidate.lifeSetupPolicies[key]={...candidate.lifeSetupPolicies[key],...selected[key]};
 }
 if(selected.expression)candidate.lifeSetupPolicies.expression={...candidate.lifeSetupPolicies.expression,...selected.expression};
 const keys=[...new Set(['lifeProfile','lifeRuntime','lifeStyleProfiles','lifeSetupPolicies','currentOutfit','currentLocationDetail',...(selected.expression?Object.keys(selected.expression).filter(k=>k!=='voice'):[]),...(options.personDraft&&selected.expression?[...COMPANION_BUILDER_FIELDS,'moodBaseline','mood']:[])])],previous=Object.fromEntries(keys.map(key=>[key,companion[key]])),timeline=getActiveCompanionTimeline(companion.id),previousRuntime=timeline?.runtime;
 for(const key of keys)companion[key]=candidate[key];
 try{await saveVirtualHumansState();}catch(error){Object.assign(companion,previous);if(timeline)timeline.runtime=previousRuntime;throw error;}
}
function vhOutfitEditor(companion,preset={}){
 preset=safeJsonClone(preset);const saveTimeline=getActiveCompanionTimeline(companion.id);let reviewedVersion=getActiveCompanionTimeline(companion.id)?.vh2?.setupVersion;
 const d=vhProductDialog(preset.id?'Edit outfit preset':'Add outfit preset','A complete look saved for this person. Existing photos keep their original outfit.');const f=d.querySelector('form');f.innerHTML=`<label>Preset name<input name="label" required maxlength="100" value="${escapeHTML(preset.label||'')}" placeholder="e.g. Favourite café outfit"></label><label>Occasion<select name="context">${['home','work','social','active','sleep','formal','weather'].map(c=>`<option value="${c}" ${preset.context===c?'selected':''}>${({home:'At home',work:'Work / study',social:'Going out',active:'Exercise',sleep:'Sleep',formal:'Formal',weather:'Weather layers'})[c]}</option>`).join('')}</select></label><label>The complete outfit<textarea name="items" required rows="4" maxlength="500" placeholder="Blue linen shirt, cream trousers and white trainers">${escapeHTML(preset.items||'')}</textarea></label><label>Notes <span class="form-hint">optional</span><textarea name="notes" rows="2" maxlength="300">${escapeHTML(preset.notes||'')}</textarea></label><p class="form-hint">Saved outfits describe complete looks. Style preferences supply the garment options used for dynamic clothing.</p><button type="submit">Save preset</button>`;
 f.oninput=()=>{const b=f.querySelector('button[type=submit]');if(b&&b.textContent==='Saved'){b.disabled=false;b.textContent='Save changes';}};
 f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit],button:not([type])');b.disabled=true;f.inert=true;try{await vhSaveAuthorSection(companion,'wardrobe',[{...preset,id:preset.id||(preset.id='outfit_'+crypto.randomUUID()),label:f.elements.label.value,context:f.elements.context.value,items:f.elements.items.value,notes:f.elements.notes.value}],reviewedVersion,saveTimeline);reviewedVersion=getActiveCompanionTimeline(companion.id)?.vh2?.setupVersion;d.querySelector('[role=status]').textContent='Outfit preset saved.';if(state.view==='vhWorkspace')vhRenderWorkspace();b.textContent='Saved';}catch(error){d.querySelector('[role=status]').textContent=error.message;b.disabled=false;}finally{f.inert=false;}};
}
function vhStyleEditor(companion,style={}){
 style=safeJsonClone(style);const saveTimeline=getActiveCompanionTimeline(companion.id);let reviewedVersion=getActiveCompanionTimeline(companion.id)?.vh2?.setupVersion;
 const d=vhProductDialog(style.id?'Edit style preference':'Create a style preference','Describe the pieces they can combine. One option per line. Nothing is generated or purchased when you save.');const f=d.querySelector('form');f.innerHTML=`<label>Style name<input name="name" required maxlength="120" value="${escapeHTML(style.name||'')}" placeholder="e.g. Weekend casual"></label><label>When to wear it<select name="context">${['any','casual','home','work','fitness','active','sleep','social','formal'].map(c=>`<option value="${c}" ${style.context===c?'selected':''}>${({any:'Any occasion',casual:'Everyday',home:'At home',work:'Work / study',fitness:'Exercise',active:'Active / outdoors',sleep:'Sleep',social:'Going out',formal:'Formal'})[c]}</option>`).join('')}</select></label><div class="vh-form-columns">${['top','bottom','dress','outerwear','shoes','accessory'].map(k=>`<label>${({top:'Tops',bottom:'Bottoms',dress:'Dresses / one-pieces',outerwear:'Outer layers',shoes:'Shoes',accessory:'Accessories'})[k]}<textarea name="${k}" rows="3" maxlength="2400" placeholder="One option per line">${escapeHTML((style.pieces?.[k]||[]).join('\n'))}</textarea></label>`).join('')}</div><label>Style tags<input name="tags" value="${escapeHTML((style.tags||[]).join(', '))}"></label><p data-completeness class="form-hint"></p><label>Warmth<select name="warmth">${['Very light','Light','Everyday','Warm','Very warm','Heavy winter'].map((label,i)=>`<option value="${i}" ${(style.warmth??2)===i?'selected':''}>${label}</option>`).join('')}</select></label><button type="submit">Save style preference</button>`;
 const check=()=>{const complete=!!(f.elements.dress.value.trim()||f.elements.top.value.trim()&&f.elements.bottom.value.trim());f.querySelector('[data-completeness]').textContent=complete?'Ready to combine: dress or top and bottom provided.':'Add a dress, or both a top and a bottom, before saving.';f.querySelector('[type=submit]').disabled=!complete;};check();f.addEventListener('input',check);
 f.oninput=()=>{const b=f.querySelector('button[type=submit]');if(b&&b.textContent==='Saved'){b.disabled=false;b.textContent='Save changes';}};
 f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit],button:not([type])');b.disabled=true;f.inert=true;try{const pieces={...style.pieces};for(const key of ['top','bottom','dress','outerwear','shoes','accessory'])pieces[key]=f.elements[key].value.split('\n').map(s=>s.trim()).filter(Boolean);if(!pieces.dress.length&&(!pieces.top.length||!pieces.bottom.length))throw Error('Add a dress, or at least one top and one bottom.');await vhSaveAuthorSection(companion,'styleProfiles',[{id:style.id||(style.id='style_'+crypto.randomUUID()),name:f.elements.name.value,context:f.elements.context.value,tags:f.elements.tags.value.split(',').map(t=>t.trim()).filter(Boolean),warmth:Number(f.elements.warmth.value),pieces}],reviewedVersion,saveTimeline);reviewedVersion=getActiveCompanionTimeline(companion.id)?.vh2?.setupVersion;d.querySelector('[role=status]').textContent='Style preference saved.';if(state.view==='vhWorkspace')vhRenderWorkspace();b.textContent='Saved';}catch(error){d.querySelector('[role=status]').textContent=error.message;b.disabled=false;}finally{f.inert=false;}};
}
function vhStudioLifeHome(companion){
 if(state.editingCompanionId!==companion.id)return;
 const panel=document.getElementById('tab-cs-life');if(!panel)return;const live=!!getActiveCompanionTimeline(companion.id)?.vh2;
 let home=document.getElementById('vh-studio-life-home');if(!home){home=document.createElement('section');home.id='vh-studio-life-home';home.className='vh-life-home';panel.querySelector('.form-body').prepend(home);}
 const destinations=live?[['places','Places & rooms','Homes, recurring places and their reference photos'],['closet','Wardrobe & presets','Complete outfits, clothing items and style preferences'],['people','People','Friends, family and the people they meet'],['life','Routine & goals','Commitments, activities and plans'],['references','Reference Library','Identity, people, places and clothing references'],['connections','Providers, feeds & events','Ticketmaster events, news feeds and provider connections']]:[['places','Places & rooms','Homes and recurring places in the starting world'],['closet','Wardrobe & presets','Complete outfits, clothing items and style preferences'],['people','People','Friends, family and other established relationships'],['life','Routine & goals','Starting commitments, activities and plans'],['references','Identity references','Appearance anchors for consistent generated media'],['connections','Models & providers','Conversation, observer and generation connections']];
 home.dataset.live=String(live);home.innerHTML=`<div class="vh-task-heading"><div><span class="vh-eyebrow">${live?'Current life':'Starting world'}</span><h3>${escapeHTML(companion.name)}’s everyday world</h3><p>${live?'Open the live timeline to inspect or change its evolving state.':'Build the ordinary world this person will inhabit before you start the persistent timeline.'}</p></div>${live?'<button type="button" data-open-live>Open live human</button>':''}</div><div class="vh-life-destinations">${destinations.map(([key,title,copy])=>`<button type="button" data-destination="${key}"><strong>${title}</strong><span>${copy}</span><small>${live?'Open live section':'Configure'} →</small></button>`).join('')}</div>`;
 vhGenerationActions(home,companion);
 vhScheduleRepairAction(home,companion);
 home.querySelector('[data-open-live]')?.addEventListener('click',()=>vhOpenWorkspace('overview',companion.id));
 home.querySelectorAll('[data-destination]').forEach(b=>b.onclick=()=>{if(live)vhOpenWorkspace(b.dataset.destination,companion.id);else if(b.dataset.destination==='places')vhBlueprintPlaces(companion);else if(b.dataset.destination==='closet')vhBlueprintWardrobe(companion);else if(b.dataset.destination==='references')activateCompanionStudioTab('cs-voice');else if(b.dataset.destination==='connections')activateCompanionStudioTab('cs-models');else vhBlueprintLifeSection(companion,b.dataset.destination);});
 const refs=document.getElementById('cs-legacy-place-references');if(refs)refs.hidden=!refs.closest('dialog');const systems=document.getElementById('cs-world-systems');if(systems)systems.hidden=live;
 const dashboard=panel.querySelector('.vh-life-dashboard');dashboard.classList.toggle('vh-running-setup',live);
 if(live){let button=home.querySelector('[data-life-draft]');if(!button){button=document.createElement('button');button.dataset.lifeDraft='';button.className='vh-secondary-action';button.textContent='Draft life changes with AI';button.onclick=()=>vhDraftCurrentLife(companion);home.append(button);}}
}
function vhAddPlace(companion){
 const d=vhProductDialog('Add place','Save a recurring place first, then add its rooms, photos and travel details.');const f=d.querySelector('form');f.innerHTML='<label>Place name<input name="label" required maxlength="160" placeholder="e.g. Apartment, favourite café"></label><label>Type<select name="kind"><option value="home">Home</option><option value="work">Work</option><option value="study">Study</option><option value="social">Social</option><option value="outdoor">Outdoors</option><option value="other">Other</option></select></label><label>Details <span class="form-hint">optional</span><textarea name="detail" rows="3" maxlength="2000" placeholder="What makes this place familiar?"></textarea></label><button type="submit">Create place</button>';
 f.oninput=()=>{const b=f.querySelector('button[type=submit]');if(b&&b.textContent==='Saved'){b.disabled=false;b.textContent='Save changes';}};
 f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit],button:not([type])');b.disabled=true;try{const timeline=getActiveCompanionTimeline(companion.id),id='place_'+crypto.randomUUID();await vhUiCommand(timeline,'upsert_place',{place:{id,label:f.elements.label.value,kind:f.elements.kind.value,detail:f.elements.detail.value}});d.close();vhRenderWorkspace();await vhOpenPlace(companion,id);}catch(error){d.querySelector('[role=status]').textContent=error.message;b.disabled=false;}};
}
function vhRoomEditor(companion,zone){const d=vhProductDialog('Edit room','The room keeps its linked references when renamed.');const f=d.querySelector('form');f.innerHTML=`<label>Room name<input name="label" required maxlength="120" value="${escapeHTML(zone.label)}"></label><label>Appearance<textarea name="description" rows="4" maxlength="2000">${escapeHTML(zone.description)}</textarea></label><button type="submit">Save room</button>`;const removalNote=document.createElement('p');removalNote.textContent='Remove this room from future use and archive its reference images. Past events and captured photos stay intact; the place remains available.';const remove=document.createElement('button');remove.type='button';remove.textContent='Remove room';remove.onclick=async()=>{remove.disabled=true;try{await vhUiCommand(getActiveCompanionTimeline(companion.id),'remove_place_zone',{zoneId:zone.id,zoneRevision:zone.revision});d.close();document.getElementById('vh-place-editor')?.close();await vhOpenPlace(companion,zone.placeId);}catch(error){d.querySelector('[role=status]').textContent=error.message;remove.disabled=false;}};f.append(removalNote,remove);f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit],button:not([type])');b.disabled=true;try{await vhUiCommand(getActiveCompanionTimeline(companion.id),'save_place_zone',{zoneId:zone.id,placeId:zone.placeId,label:f.elements.label.value,description:f.elements.description.value});d.close();document.getElementById('vh-place-editor')?.close();await vhOpenPlace(companion,zone.placeId);}catch(error){d.querySelector('[role=status]').textContent=error.message;b.disabled=false;}};}
function vhGarmentEditor(companion,item){const d=vhProductDialog('Edit clothing item','Changes apply to future outfit choices. Existing photos retain their original references.');const f=d.querySelector('form');f.innerHTML=`<label>Item name<input name="name" required maxlength="200" value="${escapeHTML(item.name)}"></label><label>Category<select name="category">${['top','bottom','dress','outerwear','underwear','shoes','accessory'].map(k=>`<option value="${k}" ${item.category===k?'selected':''}>${escapeHTML(VH_ITEM_CATEGORIES[k])}</option>`).join('')}</select></label><label>Tags<input name="tags" value="${escapeHTML((item.tags||[]).join(', '))}"></label><label>Replace reference photo <input type="file" name="photo" accept="image/png,image/jpeg,image/webp"></label><button type="submit">Save item</button><button type="button" data-remove>Remove from rotation</button>`;f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('[type=submit]');b.disabled=true;try{const photo=f.elements.photo.files[0]?await normalizeUploadedImage(f.elements.photo.files[0],960,.8):item.photo||'';await vhUiCommand(getActiveCompanionTimeline(companion.id),'update_owned_item',{itemId:item.id,name:f.elements.name.value,category:f.elements.category.value,tags:f.elements.tags.value.split(',').map(t=>t.trim()).filter(Boolean),photo});d.close();vhRenderWorkspace();}catch(error){d.querySelector('[role=status]').textContent=error.message;b.disabled=false;}};f.querySelector('[data-remove]').onclick=async e=>{e.target.disabled=true;try{await vhUiCommand(getActiveCompanionTimeline(companion.id),'archive_owned_item',{itemId:item.id});d.close();vhRenderWorkspace();}catch(error){d.querySelector('[role=status]').textContent=error.message;e.target.disabled=false;}};}
function vhBlueprintWardrobe(companion){
 const d=vhProductDialog('Starting wardrobe','These outfits and preferences are saved to the character blueprint.');d.querySelector('form').remove();
 const body=document.createElement('div');d.querySelector('header').after(body);
 const render=()=>{
  body.innerHTML='<div class="vh-task-heading"><h3>Outfit presets</h3><button type="button" data-outfit>Add outfit preset</button></div><div class="vh-entity-grid" data-outfits></div><div class="vh-task-heading"><h3>Style preferences</h3><button type="button" data-style>Create a style</button></div><div class="vh-entity-grid" data-styles></div><h3>Editable starters</h3><div class="vh-style-starters"></div>';
  vhGenerationActions(body,companion,['wardrobe','styleProfiles']);body.querySelector('[data-outfit]').onclick=()=>vhOutfitEditor(companion);body.querySelector('[data-style]').onclick=()=>vhStyleEditor(companion);
  for(const [key,rows,edit] of [['outfits',companion.lifeProfile.wardrobe||[],vhOutfitEditor],['styles',companion.lifeStyleProfiles||[],vhStyleEditor]]){
   const host=body.querySelector('[data-'+key+']');
   for(const row of rows){const card=document.createElement('article');card.className='vh-wardrobe-card';const title=document.createElement('h3'),detail=document.createElement('p'),button=document.createElement('button');title.textContent=row.label||row.name;detail.textContent=row.items||row.context||'';button.type='button';button.textContent='Edit '+(key==='outfits'?'outfit':'style');button.onclick=()=>edit(companion,row);card.append(title,detail,button);host.append(card);}
   if(!rows.length)host.textContent=key==='outfits'?'No saved outfits yet.':'No saved styles yet.';
  }
  for(const s of VH_STYLE_STARTERS){const b=document.createElement('button');b.type='button';b.innerHTML=`<strong>${escapeHTML(s.name)}</strong><span>${escapeHTML(s.description)}</span>`;b.onclick=()=>vhStyleEditor(companion,s);body.querySelector('.vh-style-starters').append(b);}
 };
 const refresh=e=>{if(e.detail?.companionId===companion.id&&d.open)render();};document.addEventListener('vh-author-saved',refresh);d.addEventListener('close',()=>document.removeEventListener('vh-author-saved',refresh),{once:true});render();
}
function vhBlueprintLifeSection(companion,section){
 const people=section==='people';
 const d=vhProductDialog(people?'Starting people':'Starting routine','Edit the saved blueprint. Opening this editor preserves the existing life setup.');d.querySelector('form').remove();const body=document.createElement('div');d.querySelector('header').after(body);
 const render=()=>{
  body.replaceChildren();vhGenerationActions(body,companion,people?['socialCircle']:['weeklySchedule','activityOptions']);
  for(const key of people?['socialCircle']:['weeklySchedule','activityOptions']){
   const heading=document.createElement('div');heading.className='vh-task-heading';const title=document.createElement('h3'),add=document.createElement('button');title.textContent=VH_LIFE_SECTIONS[key];add.type='button';add.textContent='Add '+(people?'person':key==='weeklySchedule'?'commitment':'activity');add.onclick=()=>people?vhPersonEditor(companion):vhRoutineEditor(companion,key);heading.append(title,add);body.append(heading);
   const grid=document.createElement('div');grid.className='vh-entity-grid';body.append(grid);
   for(const row of companion.lifeProfile[key]||[]){const card=document.createElement('article');card.className='vh-wardrobe-card';const label=document.createElement('h3'),detail=document.createElement('p'),edit=document.createElement('button');label.textContent=row.name||row.activity||row.label;detail.textContent=row.description||row.reason||'';edit.type='button';edit.textContent='Edit';edit.onclick=()=>people?vhPersonEditor(companion,row):vhRoutineEditor(companion,key,row);card.append(label,detail,edit);grid.append(card);}
   if(!grid.children.length)grid.textContent='No entries yet.';
  }
 };
 const refresh=e=>{if(e.detail?.companionId===companion.id&&d.open)render();};document.addEventListener('vh-author-saved',refresh);d.addEventListener('close',()=>document.removeEventListener('vh-author-saved',refresh),{once:true});render();
}
function vhPersonLifeDialog(companion,person){
 const timeline=getActiveCompanionTimeline(companion.id),link=timeline.vh2,actor=link.people?.actors?.[person.id],setup=link.people?.setup?.[person.id]||{};
 const d=vhProductDialog(person.name+' · Life & location','Supporting people use the same places and routes. No provider credits are used for basic simulation.');const f=d.querySelector('form');
 if(actor){
  f.innerHTML=`<p>This person is participating in the world.</p><p>${escapeHTML(actor.journey?'Travelling to '+(link.travelPlaces.find(p=>p.id===actor.journey.to)?.label||actor.journey.to):(actor.action?.kind||'Considering options')+' · '+(link.travelPlaces.find(p=>p.id===actor.placeId)?.label||'Position unknown'))}</p><button type="button" data-tune>Adjust life & travel</button><details data-vehicle-correction><summary>Correct vehicle ownership</summary><p>Restore an existing vehicle that was missed in setup, or correct an ownership mistake. This is an authoring correction; it does not buy a vehicle or spend their money.</p><fieldset class="vh-vehicle-ownership" ${actor.journey?'disabled':''}><legend>Recorded vehicle ownership</legend><label class="vh-choice-row"><input type="checkbox" name="ownsCar" ${actor.policy.ownsCar?'checked':''}> Owns a car</label><label class="vh-choice-row"><input type="checkbox" name="ownsBicycle" ${actor.policy.ownsBicycle?'checked':''}> Owns a bicycle</label><label>Reason for this correction<textarea name="reason" rows="3" maxlength="600" required placeholder="For example: Their saved background already establishes that they own a car."></textarea></label><p>A newly recorded vehicle is placed where they are now. Their current location and balance are preserved.</p><button type="submit">Save setup correction</button></fieldset>${actor.journey?'<p>They are travelling. Reopen this editor after they arrive to correct vehicle ownership.</p>':''}</details>`;
  f.querySelector('[data-tune]').onclick=()=>{d.close();vhOpenPanel('Independent people & transport');const field=document.querySelector('select[aria-label="Person for independent life"]');if(field){field.value=person.id;field.dispatchEvent(new Event('change'));}};
  const correction=f.querySelector('[data-vehicle-correction]'),save=correction.querySelector('button[type=submit]'),fields=correction.querySelector('fieldset'),status=d.querySelector('[role=status]');
  correction.addEventListener('input',()=>{save.textContent='Save setup correction';save.disabled=false;status.textContent='';});
  f.onsubmit=async e=>{e.preventDefault();const reason=f.elements.reason.value.trim();if(!reason){status.textContent='Describe the existing ownership fact this correction restores.';f.elements.reason.focus();return;}const body={personId:person.id,ownsCar:f.elements.ownsCar.checked,ownsBicycle:f.elements.ownsBicycle.checked,reason};save.disabled=true;fields.disabled=true;status.textContent='Saving ownership correction…';try{await vhUiCommand(timeline,'correct_person_vehicle_ownership',body);const saved=timeline.vh2.people?.actors?.[person.id]?.policy;if(!saved||saved.ownsCar!==body.ownsCar||saved.ownsBicycle!==body.ownsBicycle)throw Error('The correction was acknowledged, but the updated ownership is not available. Close and reopen this editor to check it.');status.textContent='Saved as a setup correction. No purchase was made.';save.textContent='Saved';vhRenderWorkspace();}catch(error){status.textContent=error.message;save.disabled=Boolean(error.commandAcknowledged);}finally{fields.disabled=false;}};
  return;
 }
 const options='<option value="">Choose a saved place</option>'+link.travelPlaces.filter(p=>!p.id.startsWith('osm:')).map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.label)}</option>`).join('');
 f.innerHTML=`<p>${escapeHTML(setup.reason||'Their residence and initial position need to be established.')}</p><label>Home<select name="home" required>${options}</select></label><label>Starting place<select name="initial" required>${options}</select></label><label>Starting simulated budget<input name="budget" type="number" min="0" max="1000000" value="100" required></label><p>Suggested defaults: ordinary needs, sleep around 23:00–07:00, walking/transit/rideshare, no owned vehicle or paid job assumed. Adjust these later. Family living elsewhere needs a separate saved location.</p><button type="submit">Start participating</button>`;
 f.elements.home.value=setup.homePlaceId||'';
 f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit]'),status=d.querySelector('[role=status]');b.disabled=true;status.textContent='Saving location and preparing their life…';try{await vhUiCommand(timeline,'set_person_location',{personId:person.id,homePlaceId:f.elements.home.value,initialPlaceId:f.elements.initial.value,startingBalance:Number(f.elements.budget.value)});status.textContent=timeline.vh2.people?.actors?.[person.id]?'Saved. They are now participating.':'Saved. Waiting for their existing journey to finish.';vhRenderWorkspace();b.textContent='Saved';}catch(error){status.textContent=error.message;b.disabled=false;}};
}

function vhPeopleHome(root,companion,timeline){
 const people=timeline.vh2.knownPeople||[];root.innerHTML='<div class="vh-task-heading"><div><h3>The people in their life</h3><p>Existing relationships, familiar faces and their individual lives.</p></div><button type="button" data-add-person>Add person</button></div><label class="vh-place-search">Find a person<input type="search" aria-label="Find a person" placeholder="Name or relationship…"></label><div class="vh-entity-grid" data-people></div><div class="vh-overview-actions"><button type="button" data-population>Meeting new people</button><button type="button" data-network>Social connections</button></div>';
 vhGenerationActions(root,companion,['socialCircle']);
 const ready=people.filter(p=>timeline.vh2.people?.actors?.[p.id]).length;const health=document.createElement('section');health.className='vh-current-card';health.innerHTML=`<h3>${ready} of ${people.length} people participating</h3><p>People with an established residence and position are prepared automatically. Explicit roommates start at the shared home. Others need a location; their background and relationships are already saved.</p><button type="button">Prepare existing people</button><p role="status"></p>`;root.querySelector('[data-people]').before(health);health.querySelector('button').onclick=async e=>{e.target.disabled=true;health.querySelector('[role=status]').textContent='Checking saved residences and positions…';try{await vhUiCommand(timeline,'prepare_people',{});vhRenderWorkspace();}catch(error){health.querySelector('[role=status]').textContent=error.message;e.target.disabled=false;}};

 const complete=document.createElement('button');complete.type='button';complete.textContent='Complete people & world with AI';complete.onclick=()=>vhGenerateEssentials(companion,['places','socialCircle','rooms','peopleLives','routes','referencePlan'],{direction:'Complete the missing operational setup for every supporting person. Preserve existing IDs, concrete authored details, current locations, balances and ownership. First propose missing fictional residences consistent with background, including remote hometowns; never move everyone into the main home. Then configure all new/unplaced people with these places and explicit starting-position assumptions. Supply plausible local estimated connections both ways where missing, rooms and linked reference plans. Do not manufacture geographic coordinates, real opening hours, tickets, private access or intercity walking routes. Explain unresolved dependencies individually.'});root.querySelector('.vh-overview-actions').prepend(complete);
 const routines=document.createElement('button');routines.type='button';routines.textContent='Draft people’s routines with AI';routines.onclick=()=>vhDraftSupportingRoutines(companion);root.querySelector('.vh-overview-actions').prepend(routines);
 root.querySelector('[data-add-person]').onclick=()=>vhPersonEditor(companion);root.querySelector('[data-population]').onclick=()=>vhOpenPanel('Local people & introductions');root.querySelector('[data-network]').onclick=()=>vhOpenPanel('Supporting-person network');
 const grid=root.querySelector('[data-people]');for(const person of people){const row=document.createElement('article');row.className='vh-wardrobe-card';row.innerHTML=`<span class="vh-state-chip">${escapeHTML(person.role||'Known person')}</span><h3>${escapeHTML(person.name)}</h3><p>${escapeHTML(person.relationship||'')}</p><p>${escapeHTML(person.description||'No background added yet.')}</p><button type="button">Open person</button>`;row.querySelector('button').onclick=()=>vhPersonEditor(companion,person);const actor=timeline.vh2.people?.actors?.[person.id],note=document.createElement('p');note.textContent=actor?(actor.journey?'Participating · travelling':`Participating · ${actor.action?.kind||'considering options'} · ${timeline.vh2.travelPlaces.find(p=>p.id===actor.placeId)?.label||'Position unknown'}`):'Needs location · not yet participating';row.append(note);const life=document.createElement('button');life.type='button';life.textContent='Life & location';life.onclick=()=>vhPersonLifeDialog(companion,person);row.append(life);grid.append(row);}if(!people.length)grid.innerHTML='<div class="vh-empty-state"><h3>Build their social circle</h3><p>Add someone they already know. Meeting new people controls how unfamiliar people enter their life.</p></div>';root.querySelector('input').oninput=e=>grid.querySelectorAll('article').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(e.target.value.trim().toLowerCase()));
}
function vhPersonEditor(companion,person={}){
 person=safeJsonClone(person);const saveTimeline=getActiveCompanionTimeline(companion.id);const reviewedVersion=getActiveCompanionTimeline(companion.id)?.vh2?.setupVersion;const d=vhProductDialog(person.id?'Edit person':'Add person','Author their background here. Existing memories and evolving relationship state are preserved.');const f=d.querySelector('form');f.innerHTML=`<label>Name<input name="name" required maxlength="100" value="${escapeHTML(person.name||'')}"></label><label>Relationship type<select name="role">${['friend','family','coworker','classmate','partner','ex','neighbor','acquaintance','other'].map(k=>`<option value="${k}" ${person.role===k?'selected':''}>${k[0].toUpperCase()+k.slice(1)}</option>`).join('')}</select></label><label>How they know each other<input name="relationship" maxlength="120" value="${escapeHTML(person.relationship||'')}" placeholder="e.g. Roommate from their first year"></label><label>What they look like<textarea name="appearance" rows="4" maxlength="2000" placeholder="Face, hair, eyes, skin, build and distinctive features. Keep their job and relationship in Background.">${escapeHTML(person.appearance||'')}</textarea></label><label>Age (optional)<input name="age" type="number" min="0" max="120" value="${person.age??''}"></label><label>Background<textarea name="description" rows="4" maxlength="500">${escapeHTML(person.description||'')}</textarea></label><button type="submit">Save person</button>`;
 f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit],button:not([type])');b.disabled=true;f.inert=true;try{await vhSaveAuthorSection(companion,'socialCircle',[{id:person.id||'person_'+crypto.randomUUID(),name:f.elements.name.value,role:f.elements.role.value,relationship:f.elements.relationship.value,description:f.elements.description.value,appearance:f.elements.appearance.value,age:f.elements.age.value===''?null:Number(f.elements.age.value)}],reviewedVersion,saveTimeline);d.close();vhRenderWorkspace();}catch(error){d.querySelector('[role=status]').textContent=error.message;b.disabled=false;}finally{f.inert=false;}};
 if(person.id){const actions=document.createElement('div');actions.className='vh-overview-actions';for(const [name,panel] of [['Daily life & transport','Independent people & transport'],['Relationship development','Friendships, contact & romantic progression']]){const b=document.createElement('button');b.textContent=name;b.onclick=()=>{d.close();vhOpenPanel(panel);const field=document.querySelector('select[aria-label="'+(panel==='Independent people & transport'?'Person for independent life':'Person for romantic potential')+'"]');if(field&&[...field.options].some(o=>o.value===person.id)){field.value=person.id;field.dispatchEvent(new Event('change'));}};actions.append(b);}const photo=document.createElement('button');photo.textContent='Reference photos';photo.onclick=()=>vhEntityPhotos(companion,getActiveCompanionTimeline(companion.id),'person',person.id,person.name,person.appearance||'');actions.append(photo);f.after(actions);}
}
const VH_DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function vhClockText(minute){return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}
function vhRoutineHome(root,companion,timeline){
 const link=timeline.vh2;root.innerHTML=`<div class="vh-outfit-strip"><span>Now</span><strong>${escapeHTML(link.present?.activity||'No activity recorded')}</strong></div><div class="vh-task-heading"><div><h3>Recurring commitments</h3><p>Times follow the character’s local day. Free time remains available for needs and choices.</p></div><button type="button" data-add-commitment>Add commitment</button></div><div class="vh-entity-grid" data-schedule></div><div class="vh-task-heading vh-section-label"><div><h3>Everyday activities</h3><p>Options they can choose in free time, rather than fixed appointments.</p></div><button type="button" data-add-activity>Add activity</button></div><div class="vh-entity-grid" data-activities></div><div class="vh-overview-actions"><button type="button" data-plans>Shared plans</button><button type="button" data-trips>Trips & stays</button><button type="button" data-draft-life>Draft life changes with AI</button></div>`;
 vhGenerationActions(root,companion,['weeklySchedule','activityOptions']);
 vhScheduleRepairAction(root,companion);
 root.querySelector('[data-add-commitment]').onclick=()=>vhRoutineEditor(companion,'weeklySchedule');root.querySelector('[data-add-activity]').onclick=()=>vhRoutineEditor(companion,'activityOptions');root.querySelector('[data-plans]').onclick=()=>vhOpenPanel('Shared plans');root.querySelector('[data-trips]').onclick=()=>vhOpenPanel('Trips & temporary stays');root.querySelector('[data-draft-life]').onclick=()=>vhDraftCurrentLife(companion);
 for(const [key,target] of [['weeklySchedule','[data-schedule]'],['activityOptions','[data-activities]']]){const host=root.querySelector(target),rows=link.setupProfile?.[key]||[];for(const entry of rows){const card=document.createElement('article');card.className='vh-wardrobe-card';card.innerHTML=`<span class="vh-state-chip">${escapeHTML((entry.days||[]).map(i=>VH_DAY_NAMES[i]).join(' · '))}</span><h3>${escapeHTML(entry.activity||entry.label)}</h3><p>${key==='weeklySchedule'?'Commitment':'Available window'} · ${vhClockText(entry.startMinute)}–${vhClockText(entry.endMinute)}</p><p>${key==='weeklySchedule'?`${entry.endMinute-entry.startMinute} minutes · ${escapeHTML(entry.availability||'busy')}`:entry.durationMinutes?`Each time: ${entry.durationMinutes} minutes`:'Each time: automatic duration; this window is not the activity length.'}</p><p>${escapeHTML(link.travelPlaces.find(p=>p.id===(entry.placeId||entry.requiredPlaceId))?.label||'No specific place required')}</p><button type="button">Edit ${key==='weeklySchedule'?'commitment':'activity'}</button>`;card.querySelector('button').onclick=()=>vhRoutineEditor(companion,key,entry);host.append(card);}if(!rows.length)host.innerHTML=`<div class="vh-empty-state"><p>No ${key==='weeklySchedule'?'recurring commitments':'authored activities'} yet.</p></div>`;}
}
function vhRoutineEditor(companion,key,entry={}){
 entry=safeJsonClone(entry);const saveTimeline=getActiveCompanionTimeline(companion.id);const reviewedVersion=getActiveCompanionTimeline(companion.id)?.vh2?.setupVersion;const fixed=key==='weeklySchedule',timeline=getActiveCompanionTimeline(companion.id),d=vhProductDialog((entry.id?'Edit ':'Add ')+(fixed?'commitment':'activity'),'Use the character’s local time. These changes affect future choices, not past events.');const f=d.querySelector('form');f.innerHTML=`<label>Name<input name="label" required maxlength="160" value="${escapeHTML(entry.activity||entry.label||'')}"></label><fieldset class="vh-days"><legend>Days</legend>${VH_DAY_NAMES.map((name,i)=>`<label><input type="checkbox" name="days" value="${i}" ${(entry.days||[1,2,3,4,5]).includes(i)?'checked':''}>${name}</label>`).join('')}</fieldset><div class="vh-form-columns"><label>From<input name="start" type="time" required value="${vhClockText(entry.startMinute??540)}"></label><label>Until<input name="end" type="time" required value="${vhClockText((entry.endMinute??1020)%1440)}"></label></div><label>Place<select name="place">${fixed?'':'<option value="">Any suitable place</option>'}${(timeline?.vh2?.travelPlaces||companion.lifeProfile.places||[]).map(p=>`<option value="${escapeHTML(p.id)}" ${(entry.placeId||entry.requiredPlaceId)===p.id?'selected':''}>${escapeHTML(p.label)}</option>`).join('')}</select></label>${fixed?'<p>Existing flexibility, clothing and notification settings are retained. New commitments are fixed busy periods.</p>':`<label>Activity type<select name="kind">${(entry.kind==='contact'?['focus','leisure','recovery','meal','contact']:['focus','leisure','recovery','meal']).map(k=>`<option ${entry.kind===k?'selected':''}>${k}</option>`).join('')}</select></label>`}<button type="submit">Save ${fixed?'commitment':'activity'}</button>`;
 const timing=document.createElement('p');timing.className='form-hint';timing.setAttribute('role','status');f.querySelector('.vh-form-columns').after(timing);
 const timingCopy=()=>{const minutes=v=>{const [h,m]=v.split(':').map(Number);return h*60+m;},start=minutes(f.elements.start.value),end=minutes(f.elements.end.value)||1440,duration=end-start;timing.textContent=fixed?(duration>0?'This commitment occupies '+duration+' minutes ('+(duration/60).toFixed(1)+' hours). '+(duration>=360?'For a short meal or errand, check the start time and AM/PM; a broad window belongs under Everyday activities.':'Choose whether conversation is available during it.'):'Choose an end after the start; split overnight commitments across two days.'):'These times are when the activity may be chosen. They do not make it last for the entire window.';};f.elements.start.addEventListener('input',timingCopy);f.elements.end.addEventListener('input',timingCopy);timingCopy();
 const policy=document.createElement('label');if(fixed){policy.textContent='Conversation availability';const select=document.createElement('select');select.name='availability';for(const [value,label] of [['available','Available to chat'],['busy','Busy — occasional phone checks'],['private','Private — no phone checks'],['asleep','Asleep — wait until awake']]){const option=new Option(label,value);option.selected=value===(entry.availability||'busy');select.append(option);}policy.append(select);}else{policy.textContent='Duration each time (minutes; 0 uses the activity default)';const duration=document.createElement('input');duration.name='durationMinutes';duration.type='number';duration.min='0';duration.max='1440';duration.step='1';duration.value=String(entry.durationMinutes||0);policy.append(duration);}timing.after(policy);
 if(entry.id){const remove=document.createElement('button');remove.type='button';remove.textContent=fixed?'Remove recurring commitment':'Remove activity option';remove.onclick=async()=>{remove.disabled=true;try{await vhUiCommand(timeline,'remove_life_entry',{section:key,entryId:entry.id,baseSetupVersion:reviewedVersion});d.close();vhRenderWorkspace();}catch(error){d.querySelector('[role=status]').textContent=error.message;remove.disabled=false;}};const note=document.createElement('p');note.className='form-hint';note.textContent='Removing an entry stops future selection. Past events and already-started activities remain recorded.';f.append(note,remove);}
 f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button[type=submit],button:not([type])');b.disabled=true;f.inert=true;try{const days=[...f.querySelectorAll('[name=days]:checked')].map(i=>Number(i.value));if(!days.length)throw Error('Choose at least one day.');const minute=v=>{const [h,m]=v.split(':').map(Number);return h*60+m;};const startMinute=minute(f.elements.start.value),endMinute=minute(f.elements.end.value)||1440;if(endMinute<=startMinute)throw Error('End time must be later than start time. Split overnight commitments across two days.');const row={...entry,id:entry.id||'routine_'+crypto.randomUUID(),days,startMinute,endMinute};if(fixed)Object.assign(row,{activity:f.elements.label.value,placeId:f.elements.place.value,flexibility:entry.flexibility||'fixed',availability:f.elements.availability.value});else Object.assign(row,{label:f.elements.label.value,kind:f.elements.kind.value,requiredPlaceId:f.elements.place.value,durationMinutes:Number(f.elements.durationMinutes.value)});await vhSaveAuthorSection(companion,key,[row],reviewedVersion,saveTimeline);d.close();vhRenderWorkspace();}catch(error){d.querySelector('[role=status]').textContent=error.message;b.disabled=false;}finally{f.inert=false;}};
}

function vhUiRetried(previousKey,nextKey){const outcome=vhUiCommandOutcome(previousKey);outcome.keys.add(nextKey);outcome.error=null;outcome.updatedAt=Date.now();vhUiCommandOutcomes.set(nextKey,outcome);const panel=vhUiOrigins.get(previousKey);if(panel){vhUiOrigins.delete(previousKey);vhUiOrigins.set(nextKey,panel);}}


// The same recovery entry point is available in setup and in each everyday editor.
const VH_ESSENTIAL_SECTIONS=['places','socialCircle','wardrobe','styleProfiles','rooms','activityOptions','peopleLives','routes','referencePlan'];
function vhSectionHasContent(key,value){
 return !companionLifeSectionNeedsGeneration(key,value);
}

function vhGenerationActions(host,companion,sections){
 const bar=document.createElement('section');bar.className='vh-generation-actions';
 const text=document.createElement('p');text.textContent=sections?'Let AI draft this section from their personality and current life. Review before saving.':'Choose one part of this life to draft. Add only what fits your character; review changes before saving.';
 const button=document.createElement('button');button.type='button';button.className='btn btn-primary';button.textContent=sections?'Generate '+({wardrobe:'wardrobe',socialCircle:'people',places:'places & rooms',weeklySchedule:'routine'}[sections[0]]||'section'):'Choose a section to generate';
 button.onclick=()=>!sections?vhAIHelpers(companion,'places'):sections[0]==='wardrobe'?vhWardrobeBuilder(companion):vhGenerateEssentials(companion,sections);text.textContent+=' '+(sections?sections.length+' section request'+(sections.length===1?'':'s'):'Only your selected section')+' using your text model. Images are separate.';bar.append(text,button);
 if(sections){const missing=document.createElement('button');missing.type='button';missing.className='btn btn-ghost';missing.textContent='Choose another section';missing.onclick=()=>vhAIHelpers(companion,'places');bar.append(missing);}
 vhAssistantActions(bar,companion,sections?.[0]);
 host.prepend(bar);
}
async function vhGenerateEssentials(companion,requested,options={}){
 if(vhLifeDraftJobs.has(companion.id)){vhLifeDraftJobs.get(companion.id).focus();return;}
 const d=vhProductDialog(options.repairIssues?.length?'Repairing audit findings':'Generate life essentials','AI drafts are reviewed before they change this life.');
 const form=d.querySelector('form'),controller=new AbortController();vhLifeDraftJobs.set(companion.id,d);
 form.innerHTML='<p role="status" aria-live="polite">Reading current setup…</p><button type="button">Stop generation</button>';
 const status=form.querySelector('[role=status]');form.querySelector('button').onclick=()=>controller.abort('stopped');d.addEventListener('close',()=>controller.abort(),{once:true});
 let timeline, current, baseSetupVersion, model, sections;
 const proposal=safeJsonClone(options.previousProposal||{}),warnings=[];
 const timer=setTimeout(()=>controller.abort('timeout'),180000);
 try{
  timeline=getActiveCompanionTimeline(companion.id);
  if(timeline?.vh2)await vh2Poll(companion,timeline);
  if(options.expectedSetupVersion!==undefined&&timeline?.vh2?.setupVersion!==options.expectedSetupVersion){d.close();await vhOpenAuditor(companion);return;}
  current=timeline?.vh2?{...timeline.vh2.setupProfile,...timeline.vh2.executableSetup,styleProfiles:timeline.vh2.closet?.styles||[]}: {...companion.lifeProfile,...companion.lifeSetupPolicies,styleProfiles:companion.lifeStyleProfiles||[]};
  sections=requested||VH_ESSENTIAL_SECTIONS.filter(k=>k==='peopleLives'?(current.socialCircle||[]).some(p=>!(current.peopleLives||[]).some(a=>a.personId===p.id)):!vhSectionHasContent(k,current[k]));
  if(!sections.length){status.textContent='All essentials are present. Open People, Places or Wardrobe to generate changes for one section.';form.querySelector('button').textContent='Close';return;}
  baseSetupVersion=timeline?.vh2?.setupVersion;
  model=options.model||companionEffectiveLifeBuilderModel(companion);const context={...safeJsonClone(current),...safeJsonClone(proposal)};
  // Smaller dependent requests avoid overflowing a single all-life response.
  for(const key of sections){
   if(controller.signal.aborted)throw Error('Generation cancelled.');
   const result=await completeCompanionLifeDraftSections(companion,context,{model,requiredSections:[key],direction:options.direction,repairIssues:options.repairIssues,skipLifeRefresh:true,signal:controller.signal,onProgress:message=>status.textContent=message});
   if(result.repairWarning){warnings.push(result.repairWarning);continue;}
   if(result.draft[key]!==undefined){proposal[key]=vhConstrainAuditRepair(key,current[key],result.draft[key],options.repairIssues);context[key]=Array.isArray(proposal[key])&&Array.isArray(current[key])?[...new Map([...current[key],...proposal[key]].map(r=>[key==='peopleLives'?r.personId:key==='routes'?[r.from,r.to,r.mode].join('|'):r.id,r])).values()]:proposal[key];}else proposal[key]=[];
  }
  if(controller.signal.aborted)throw Error('Generation stopped.');
  if(!d.open)return;
  if(warnings.length)throw Error(warnings.join(' '));
  if(getActiveCompanionTimeline(companion.id)!==timeline)throw Error('The active life changed. Reopen generation for the life you want.');
  if(sections.includes('peopleLives')){const unconfigured=(context.socialCircle||[]).filter(p=>!(context.peopleLives||[]).some(a=>a.personId===p.id));if(unconfigured.length)warnings.push('Still needs independent-life setup: '+unconfigured.map(p=>p.name||p.id).join(', ')+'. These people will not be described as fully configured.');}
  if(proposal.referencePlan){const references=await vhChoosePhotoTargets(companion,{...current,...proposal});if(!references)return;proposal.referencePlan=references;}
  if(options.repairIssues?.length){const check=vhAuditRepairCheck(companion,current,proposal,options.repairIssues);if(!check.ok){if((proposal.rooms||[]).some(r=>!String(r.description||'').trim())){vhFinishRoomDraft(companion,current,proposal,options,timeline,baseSetupVersion);d.close();return;}vhRecoverAuditDraft(companion,current,proposal,options,timeline,baseSetupVersion);d.close();return;}}
  proposal.__generationWarning=warnings.join(' ');
  await vhReviewLifeProposal(companion,proposal,{skipRefresh:true,baseSetupVersion,generationDirection:options.direction,generationModel:model,repairIssues:options.repairIssues,focusedSections:options.focusedSections||Object.keys(proposal).filter(key=>!key.startsWith('__'))});d.close();
 }catch(error){if(d.open){if(error.code==='VH_TIMING_CONFLICT'){d.close();vhTimingRepairOptions(companion,error.setup,error.issues,getActiveCompanionTimeline(companion.id));}else{
   const completed=Object.keys(proposal).filter(key=>!key.startsWith('__'));
   status.textContent=(controller.signal.reason==='timeout'?'Generation timed out.':controller.signal.aborted?'Generation stopped.':error.message)+' '+completed.length+' completed section(s) are retained here. Nothing has been applied.';
   const close=form.querySelector('button');close.textContent='Close';close.onclick=()=>d.close();
   if(completed.length){const review=document.createElement('button');review.type='button';review.textContent='Review completed sections';review.onclick=async()=>{if(getActiveCompanionTimeline(companion.id)!==timeline){status.textContent='The active life changed. Reopen generation for the intended life.';return;}await vhReviewLifeProposal(companion,{...proposal,__generationWarning:status.textContent},{skipRefresh:true,baseSetupVersion,generationDirection:options.direction,generationModel:model,focusedSections:completed});d.close();};form.append(review);}
   const remaining=(sections||requested||[]).filter(key=>!completed.includes(key));
   if(remaining.length){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry missing sections ('+remaining.length+')';retry.onclick=()=>{if(getActiveCompanionTimeline(companion.id)!==timeline||timeline?.vh2?.setupVersion!==baseSetupVersion){status.textContent='The life setup changed. Review completed sections before generating a new draft.';return;}d.close();void vhGenerateEssentials(companion,remaining,{...options,previousProposal:proposal});};form.append(retry);}
  }}}
 finally{clearTimeout(timer);vhLifeDraftJobs.delete(companion.id);}
}


function vhBlueprintPlaces(companion){
 const existing=document.getElementById('vh-blueprint-places');if(existing){existing.focus();return;}
 const d=vhProductDialog('Places & photos','Starting blueprint · Save the places they return to and a photo of each setting.');d.id='vh-blueprint-places';d.querySelector('form').remove();
 const refs=document.getElementById('cs-legacy-place-references'),anchor=document.createComment('blueprint place photos');refs.before(anchor);refs.hidden=false;d.querySelector('header').after(refs);
 const toolbar=document.createElement('div');toolbar.className='vh-task-heading';toolbar.innerHTML='<p>Photos are optional. Upload a reference or describe the setting to generate one.</p><button type="button" class="btn btn-ghost">Add place</button>';refs.before(toolbar);
 toolbar.querySelector('button').onclick=()=>{const editor=vhProductDialog('Add blueprint place','Add a recurring place to this person’s starting setup.');const f=editor.querySelector('form');f.innerHTML='<label>Place name<input name="label" required maxlength="160" placeholder="e.g. Apartment or favourite café"></label><label>Type<select name="kind"><option value="home">Home</option><option value="work">Work</option><option value="study">Study</option><option value="social">Social</option><option value="outdoor">Outdoors</option><option value="other">Other</option></select></label><button type="submit">Add place</button>';f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;try{companion.lifeProfile.places.push(normalizeCompanionLifePlace({id:'place_'+crypto.randomUUID(),label:f.elements.label.value,kind:f.elements.kind.value}));await saveCompanionTemplatesState();renderCompanionPhotoLocations(companion);editor.close();}catch(error){editor.querySelector('[role=status]').textContent=error.message;b.disabled=false;}};};
 renderCompanionPhotoLocations(companion);
 d.addEventListener('close',()=>{refs.hidden=true;anchor.replaceWith(refs);},{once:true});
}


function vhWardrobeBuilder(companion){
 const d=vhProductDialog('AI wardrobe builder','Describe the wardrobe you want. Review complete outfits and mix-and-match garment choices before applying.');
 const form=d.querySelector('form');form.innerHTML=`<label>Your wardrobe brief<textarea name="direction" rows="6" maxlength="6000" required placeholder="Example: A Tempe art student who thrifts 90s pieces. Sun-faded earth tones, oversized linen shirts, straight-leg denim and worn leather sandals. Build campus, studio, going-out and sleep outfits. Avoid generic athleisure, luxury labels and all-white outfits."></textarea></label><div class="vh-wardrobe-brief-examples"><span>Start with an idea</span><button type="button" data-brief="A cohesive capsule wardrobe with repeatable pieces. Specify colors, fabrics, cuts, shoes and accessories. Include home, work, casual outings and sleep; reuse favourite garments across outfits.">Everyday capsule</button><button type="button" data-brief="A distinctive thrifted wardrobe shaped by their personality. Mix faded colors, interesting textures and lived-in details. Give each look specific garments, footwear and accessories; avoid generic fashion descriptions.">Thrifted & personal</button></div><label>Life-builder model<input name="model" required value="${escapeHTML(companionEffectiveLifeBuilderModel(companion)||'')}" placeholder="Your text provider’s model ID"></label><p class="form-hint">Uses this character’s text connection. Creates saved outfits and style preferences in two focused requests. No images are generated or clothes purchased.</p><button type="submit" class="btn btn-primary">Build wardrobe</button>`;
 for(const button of form.querySelectorAll('[data-brief]'))button.onclick=()=>{form.elements.direction.value=button.dataset.brief;form.elements.direction.focus();};
 form.onsubmit=e=>{e.preventDefault();const direction=form.elements.direction.value.trim(),model=form.elements.model.value.trim();if(!direction||!model)return;d.close();void vhGenerateEssentials(companion,['wardrobe','styleProfiles'],{direction,model});};
}


function vhScheduleRepairAction(host,companion){
 const issues=vhAuditLifeData(companion,vhAuditSnapshot(companion,getActiveCompanionTimeline(companion.id))).filter(vhIsTimingIssue);
 const card=document.createElement('section');card.className='vh-task-heading';
 const text=document.createElement('p');text.textContent=issues.length?issues.filter(x=>x.title==='Overlapping fixed commitments').length+' schedule overlaps · '+issues.filter(x=>x.title==='Not enough travel time').length+' travel gaps. Repair them together without AI or Maps calls.':'Schedule timing: no overlaps or insufficient travel gaps found.';
 const button=document.createElement('button');button.type='button';button.textContent='Fix schedule conflicts';button.onclick=()=>vhFixScheduleConflicts(companion);
 card.append(text,button);host.prepend(card);
}

function vhRenderPrimaryBar(companion,surface){
 const id='vh-primary-'+surface;
 let bar=document.getElementById(id);
 if(!bar){
  bar=document.createElement('div');bar.id=id;bar.className='vh-primary-bar';
  const anchor=surface==='chat'?document.querySelector('.companion-chat-header'):surface==='life'?document.querySelector('.vh-workspace-head'):document.getElementById('vh-studio-scope');
  if(!anchor)return;
  if(surface==='studio')anchor.before(bar);else anchor.after(bar);
 }
 bar.dataset.companion=companion.id;bar.replaceChildren();
 const nav=document.createElement('nav');nav.className='vh-person-links';nav.setAttribute('aria-label','Virtual human navigation');
 const title=document.createElement('strong');title.className='vh-person-name';title.textContent=companion.name||'Your person';bar.append(title);
 const blank=vhIsBlankCreation(companion),entries=[['chat','Chat'],['studio','Edit human'],['life','Live human']];
 const library=document.createElement('button');library.type='button';library.className='vh-library-back';library.textContent='← Humans';library.setAttribute('aria-label','Back to Virtual Humans 2.0');
 library.onclick=async()=>{if(surface==='studio'){if(vhIsCreationDraft(companion)){commitCompanionStudioForm();const discarded=vhIsBlankCreation(companion);if(discarded)deleteCompanion(companion.id);await (typeof saveVirtualHumansState==='function'?(discarded?saveVirtualHumansState():saveCompanionTemplatesState()):saveState());}else if(!await vhSaveStudio())return;}switchView('companions');};bar.prepend(library);
 if(surface==='studio'){
  bar.classList.add('vh-studio-header');
  title.textContent=vhIsCreationDraft(companion)?'Create a virtual human':`Edit ${companion.name||'profile'}`;
 }else bar.classList.remove('vh-studio-header');
 const active=surface;
 for(const [key,label] of entries){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.mode=key;if(key===active)b.setAttribute('aria-current','page');
  b.disabled=blank&&key!=='studio';
  b.onclick=async()=>{if(key===active)return;if(surface==='studio'&&!await vhSaveStudio())return;state.activeCompanionId=companion.id;
   if(key==='chat'){switchView('companionChat');}
   else if(key==='life')vhOpenWorkspace('overview',companion.id);
   else{openCompanionStudio(companion.id);switchView('companionStudio');activateCompanionStudioTab('cs-overview');vhRenderPrimaryBar(companion,'studio');}
  };nav.append(b);
 }
 const model=document.createElement('button');model.type='button';model.className='vh-model-control';
 const scope=surface==='chat'?'chat':'life',value=scope==='chat'?(companion.model||state.globalSettings.defaultModel):companionEffectiveLifeBuilderModel(companion);
 model.innerHTML='<span>'+ (scope==='chat'?'Chat model':'Life AI model')+'</span><strong>'+escapeHTML(value||'Choose a model')+'</strong><span aria-hidden="true">⌄</span>';
 model.setAttribute('aria-label',(scope==='chat'?'Chat model':'Life AI model')+': '+(value||'Choose a model'));model.onclick=()=>{model.closest('details').open=false;vhSelectAIModel(companion,scope);};
 const tools=document.createElement('details');tools.className='vh-person-tools';
 const linked=!!getActiveCompanionTimeline(companion.id)?.vh2;
 const summary=document.createElement('summary');summary.textContent=linked?'Tools':'Setup';tools.append(summary);
 const menu=document.createElement('div');menu.className='vh-person-tools-menu';tools.append(menu);
 const destinations=linked?[["references","Reference Library"],["connections","Providers & feeds"]]:[["cs-life","Review starting world"],["cs-models","Models & providers"]];
 for(const [destination,label] of destinations){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{if(surface==='studio'&&!await vhSaveStudio())return;tools.open=false;if(destination.startsWith('cs-')){openCompanionStudio(companion.id);switchView('companionStudio');activateCompanionStudioTab(destination);}else vhOpenWorkspace(destination,companion.id);};menu.append(b);}
 menu.append(model);tools.addEventListener('keydown',e=>{if(e.key==='Escape'){tools.open=false;summary.focus();}});
 bar.append(nav);
 if(surface==='chat'){const moreMenu=document.querySelector('#vh-chat-more > div');if(moreMenu){moreMenu.querySelector('.vh-person-tools')?.remove();moreMenu.append(tools);}else bar.append(tools);}else bar.append(tools);
 if(surface==='studio')tools.remove();
 if(surface==='studio'){
  const sidebar=document.querySelector('#companion-studio-view .studio-nav');sidebar.prepend(bar);
  const content=document.querySelector('#companion-studio-view .studio-content-wrap');
  const tabs=document.querySelector('#companion-studio-view .studio-tabs');if(tabs&&tabs.parentElement!==content)content.prepend(tabs);const section=document.querySelector('.vh-studio-section');if(section&&section.parentElement!==content)content.prepend(section);
 }else document.getElementById(surface==='chat'?'companion-chat-view':'vh-workspace-view').prepend(bar);
}
function vhSelectAIModel(companion,initialScope='life'){
 const d=vhProductDialog('Choose AI model','Choose which model writes replies or drafts life changes. Selecting a model does not generate anything.');
 const form=d.querySelector('form'),status=d.querySelector('[role=status]');
 form.innerHTML='<label>Use for<select name="scope"><option value="chat">Chat replies</option><option value="life">Life drafts and AI repairs</option></select></label><label>Search models or enter a model ID<input name="model" autocomplete="off" required></label><div data-model-results></div><button type="submit">Save model</button>';
 const scope=form.elements.scope,input=form.elements.model,results=form.querySelector('[data-model-results]');scope.value=initialScope;
 let catalogue=[];
 const reset=()=>input.value=scope.value==='chat'?(companion.model||state.globalSettings.defaultModel||''):companionEffectiveLifeBuilderModel(companion);
 const render=()=>{results.replaceChildren();const q=input.value.toLowerCase();for(const entry of catalogue.filter(m=>(m.id+' '+(m.name||'')).toLowerCase().includes(q)).slice(0,8)){const b=document.createElement('button');b.type='button';b.className='vh-model-result';b.textContent=entry.name?entry.name+' · '+entry.id:entry.id;b.onclick=()=>{input.value=entry.id;results.replaceChildren();};results.append(b);}};
 reset();scope.onchange=()=>{reset();render();};input.oninput=render;
 status.textContent='Loading models from '+providerDisplayName(companionTextProviderId(companion))+'…';
 getCompanionOutputModels('text',false,companionTextProviderId(companion)).then(models=>{catalogue=rankCompanionTextModels(models);if(d.open){render();status.textContent='Choose a model above, or enter its exact ID.';}}).catch(()=>{if(d.open)status.textContent='Model list unavailable. Enter an exact model ID, or configure your connection in Edit human → Models & providers.';});
 form.onsubmit=async e=>{
  e.preventDefault();const value=input.value.trim();if(!value)return;
  const key=scope.value==='chat'?'model':'lifeBuilderModel',previous=companion[key],button=form.querySelector('[type=submit]');button.disabled=true;form.inert=true;
  try{
   companion[key]=value;try{await saveCompanionTemplatesState();}catch(error){companion[key]=previous;throw error;}
   if(state.editingCompanionId===companion.id){const field=document.getElementById(key==='model'?'cs-text-model-custom':'cs-life-builder-model');if(field)field.value=value;}
   for(const element of document.querySelectorAll('.vh-primary-bar'))if(element.dataset.companion===companion.id)vhRenderPrimaryBar(companion,element.id.replace('vh-primary-',''));
   vhStudioSetupOverview(companion);
   if(key==='model'&&getActiveCompanionTimeline(companion.id)?.vh2){try{await vh2SyncProvider(companion);}catch(error){status.textContent='Model saved. The live connection still needs attention: '+error.message;return;}}
   d.close();
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;form.inert=false;}
 };
}
function vhStudioSetupOverview(companion){
 const panel=document.getElementById('tab-cs-overview');if(!panel||state.editingCompanionId!==companion.id)return;
 const timeline=getActiveCompanionTimeline(companion.id),life=!!timeline?.vh2;
 const identityReady=companionReadinessIssues(companion).length===0;
 const modelReady=!!((companion.model||state.globalSettings.defaultModel)&&providerHasCredentials(companionTextProviderId(companion)));
 const identityCount=['name','age','pronouns','appearance','personality','backstory','occupation','socialWorld'].filter(key=>key==='age'?Number(companion[key])>=18:key==='name'?!!String(companion[key]||'').trim()&&companion[key]!=='New Virtual Human':!!String(companion[key]||'').trim()).length;
 const mindCount=['values','contradictions','vulnerabilities','relationshipStyle','startingScenario','initialMotive'].filter(key=>String(companion[key]||'').trim()).length;
 const conversationCount=['textingStyle','conversationStyle','chatExamples','chatAvoid'].filter(key=>String(companion[key]||'').trim()).length;
 const worldCount=(companion.lifeProfile?.places?.length||0)+(companion.lifeProfile?.socialCircle?.length||0)+(companion.lifeProfile?.weeklySchedule?.length||0);
 const visualAnchors=Number(!!companion.profilePhoto)+Number(!!companion.basePhoto)+(companion.startingReferences?.length||0);
 const systems=[
  {tab:'cs-identity',title:'Identity & history',copy:'Body, appearance, enduring temperament, biography, competence, home, and social context.',status:`${identityCount} of 8 areas authored`,tone:identityReady?'authored':'needs'},
  {tab:'cs-mind',title:'Psychology & relationship',copy:'Emotional regulation, contradictions, wounds, attachment, motives, boundaries, prior contact, and player knowledge.',status:mindCount?`${mindCount} narrative areas authored`:'Behavioral defaults active',tone:mindCount?'authored':'default'},
  {tab:'cs-chat-style',title:'Conversation & expression',copy:'Vocabulary, cadence, reply length, conversational habits, examples, and behaviors to avoid.',status:conversationCount?`${conversationCount} areas authored`:'Adaptive defaults active',tone:conversationCount?'authored':'default'},
  {tab:'cs-life',title:'World & autonomous life',copy:'Places, people, rooms, routines, commitments, travel, possessions, wardrobe, resources, and background agency.',status:life?'Persistent life running':worldCount?`${worldCount} blueprint elements`:'No life blueprint yet',tone:life||worldCount?'authored':'default'},
  {tab:'cs-voice',title:'Appearance, photos & voice',copy:'Identity anchors, photo direction, continuity, image generation, speech, and voice-note behavior.',status:visualAnchors?`${visualAnchors} visual anchors`:'No visual anchors',tone:visualAnchors?'authored':'default'},
  {tab:'cs-social',title:'Social presence & video',copy:'Audience, platform persona, posting rules, access boundaries, monetization, images, and clips.',status:`Feed ${companion.socialFeedEnabled?'enabled':'disabled'} · Video ${companion.allowVideoClips?'enabled':'disabled'}`,tone:companion.socialFeedEnabled||companion.allowVideoClips?'authored':'default'},
  {tab:'cs-models',title:'Models, providers & runtime',copy:'Conversation and observer models, reasoning, modalities, generation limits, web access, and always-on execution.',status:modelReady?'Runtime connected':'Runtime connection needed',tone:modelReady?'authored':'needs'}
 ];
 const next=!identityReady?systems[0]:!modelReady?systems[6]:null;
 const personAuthored=identityCount>=5&&(mindCount>=2||companion.mindProfile?.enabled)&&conversationCount>=1;
 const stage=(label,ready,detail)=>'<span class="is-'+(ready?'ready':'pending')+'"><strong>'+label+'</strong><small>'+detail+'</small></span>';
 const stages=stage('Chat',identityReady&&modelReady,identityReady&&modelReady?'Ready':'Needs identity + model')+stage('Person depth',personAuthored,personAuthored?'Authored':'Defaults remain')+stage('Starting life',life||worldCount>0,life?'Running':worldCount>0?'Blueprint ready':'Not configured')+stage('Media',visualAnchors>0||companion.socialFeedEnabled||companion.allowVideoClips,visualAnchors>0||companion.socialFeedEnabled||companion.allowVideoClips?'Configured':'Optional');
 panel.innerHTML='<div class="panel-header"><span class="vh-eyebrow">Virtual Human Studio</span><h2>'+escapeHTML(companion.name&&companion.name!=='New Virtual Human'?companion.name:'New virtual human')+'</h2><p>A Virtual Human is a persistent person model: authored identity and psychology, a causally grounded life, expressive media, and the runtime that connects those systems.</p></div><div class="form-body vh-setup-overview"><nav class="vh-overview-shortcuts" aria-label="Creation shortcuts"><button type="button" data-page-authoring>Open identity &amp; body</button><button type="button" data-opening>Set conversation start</button></nav><p class="vh-page-ai-note">AI drafting is deliberately page-by-page. Open a system below, choose only the fields you want, and review the exact request count before anything is sent.</p><section class="vh-next-step"><div><span>'+(next?'Next unresolved layer':'Creation architecture')+'</span><h3>'+(next?escapeHTML(next.title):'Review the complete person')+'</h3><p>'+(next?escapeHTML(next.copy):'Identity and runtime are usable. Review every authored, defaulted, disabled, and unconfigured system before saving or starting a life.')+'</p></div><button type="button" data-next>'+(next?'Open section':'Review identity')+'</button></section><div class="vh-readiness-stages" aria-label="Creation readiness">'+stages+'</div><section class="vh-system-intro"><div><h3>Human architecture</h3><p>These layers cooperate but remain separately authored. “Default” means the engine has behavior; it does not mean you have defined this person.</p></div><span>'+systems.filter(system=>system.tone==='authored').length+' authored · '+systems.filter(system=>system.tone==='needs').length+' need attention</span></section><div class="vh-system-grid"></div><section class="vh-live-access"><div><span class="vh-eyebrow">'+(life?'Persistent timeline':'Starting world')+'</span><h3>'+(life?'Live human is running':'When the person is ready, start their life')+'</h3><p>'+(life?'Open the evolving timeline to manage current routines, relationships, places, possessions, media, memories and events.':'Edit human holds the durable person and starting world. Live human begins the evolving timeline without replacing that authored foundation.')+'</p></div><button type="button" data-live-access>'+(life?'Open live human':'Set up persistent life')+'</button></section><p role="status"></p></div>';
 panel.querySelector('[data-next]').onclick=()=>activateCompanionStudioTab(next?.tab||'cs-identity');
 panel.querySelector('[data-page-authoring]').onclick=()=>activateCompanionStudioTab('cs-identity');
 panel.querySelector('[data-opening]').onclick=()=>vhOpenAuthoringSection('cs-mind','relationship');
 const grid=panel.querySelector('.vh-system-grid');
 for(const system of systems){const button=document.createElement('button');button.type='button';button.className='vh-system-card';button.innerHTML='<span class="vh-system-state is-'+system.tone+'">'+escapeHTML(system.status)+'</span><strong>'+escapeHTML(system.title)+'</strong><p>'+escapeHTML(system.copy)+'</p><em>Open section →</em>';button.onclick=()=>activateCompanionStudioTab(system.tab);grid.append(button);}
 panel.querySelector('[data-live-access]').onclick=()=>life?vhOpenWorkspace('overview',companion.id):activateCompanionStudioTab('cs-life');

}


// Dismiss the shared tools popover without retaining handlers for rebuilt bars.
document.addEventListener('click',e=>{document.querySelectorAll('.vh-person-tools[open]').forEach(menu=>{if(!menu.contains(e.target))menu.open=false;});});

/* Reference subjects and slots are derived from the saved life, never typed twice. */
'use strict';
let vhReferenceGroup='identity';
const VH_AUTO_REFERENCE_VIEWS={identity:['turnaround','front_face','three_quarter','profile','full_body'],person:['front_face','three_quarter','profile','full_body'],place:['establishing','reverse_angle','detail'],zone:['establishing','reverse_angle','detail'],prop:['front','back','detail'],garment:['front','back','detail']};
const VH_REFERENCE_LABELS={turnaround:'Character turnaround sheet',front_face:'Portrait',three_quarter:'Three-quarter portrait',profile:'Profile',full_body:'Full body',establishing:'Room overview',reverse_angle:'Another angle',detail:'Detail',front:'Product image',back:'Back view'};
const VH_REFERENCE_GROUPS={identity:['Main character','One sheet with front, side, back and a face close-up.'],person:['Supporting people','One portrait per person. Names and descriptions are already linked.'],rooms:['Rooms & places','One image per space. Add another angle whenever it helps.'],prop:['Props','Generate images of the objects in this life.'],garment:['Clothing','Product references for the clothes and accessories they own.']};
function vhReferenceSubjects(companion,link){
 const wearable=new Set(['top','bottom','dress','outerwear','underwear','shoes','accessory']);
 const items=(link.gifts?.items||link.setupProfile?.world?.items||[]).filter(i=>!i.archived);
 const subjects=[{role:'identity',entityId:link.entityId,name:companion.name||'Main character',description:companion.appearance||'',group:'identity'},
  ...(link.knownPeople||[]).map(p=>({role:'person',entityId:p.id,name:p.name,description:p.appearance||'',group:'person'})),
  ...(link.travelPlaces||[]).filter(p=>!p.id.startsWith('osm:')||(link.bible?.entries||[]).some(e=>e.role==='place'&&e.entityId===p.id&&e.status!=='archived')).map(p=>({role:'place',entityId:p.id,name:p.label,description:p.referenceDescription||p.detail||p.description||'',group:'rooms'})),
  ...(link.visual?.zones||[]).map(p=>({role:'zone',entityId:p.id,name:p.label,description:p.description||'',group:'rooms',parent:(link.travelPlaces||[]).find(x=>x.id===p.placeId)?.label})),
  ...items.map(p=>({role:wearable.has(p.category)?'garment':'prop',entityId:p.id,name:p.name,description:[p.name,...(p.tags||[])].join(', '),group:wearable.has(p.category)?'garment':'prop'}))];
 return subjects.filter(s=>s.entityId);
}
function vhReferenceSubjectSlots(subject,link){
 const allowed=VH_AUTO_REFERENCE_VIEWS[subject.role]||[],views=new Set([allowed[0]]);
 for(const plan of link.referencePlan||[])if(plan.id?.startsWith('ref-slot:')&&plan.role===subject.role&&plan.entityId===subject.entityId&&allowed.includes(plan.view))views.add(plan.view);
 for(const e of link.bible?.entries||[])if(e.role===subject.role&&e.entityId===subject.entityId&&e.status!=='archived')for(const tag of e.tags||[])if(allowed.includes(tag))views.add(tag);
 return [...views].filter(Boolean).map(view=>({role:subject.role,entityId:subject.entityId,view,label:(subject.name+' · '+VH_REFERENCE_LABELS[view]).slice(0,120),description:subject.description.slice(0,1200)}));
}
function vhReferenceSlotEntries(slot,link){return (link.bible?.entries||[]).filter(e=>e.role===slot.role&&e.entityId===slot.entityId&&e.status!=='archived'&&(e.tags||[]).includes(slot.view));}
function vhMissingReferenceSlots(subjects,link){return subjects.flatMap(s=>vhReferenceSubjectSlots(s,link)).filter(slot=>!vhReferenceSlotEntries(slot,link).some(e=>e.status==='approved'||e.status==='pending'));}
function vhRefreshReferenceLibrary(companion,timeline){
 if(state.activeCompanionId===companion.id&&getActiveCompanionTimeline(companion.id)===timeline&&state.view==='vhWorkspace'&&vhWorkspaceSection==='references')vhWorkspaceSpecial(true);
}
async function vhReferenceUpload(companion,timeline,slot,file){
 if(!file)return;
 try{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP image.');
  vh2SetReferenceProgress(timeline,{running:false,error:false,message:'Importing '+slot.label+'…'});
  const image=await vh2NormalizeUploadedImage(file);
  await vhUiCommand(timeline,'add_bible_asset',{role:slot.role,entityId:slot.entityId,label:slot.label,tags:[slot.view,...(slot.view==='front_face'?['face']:[])],image});
  vh2SetReferenceProgress(timeline,{running:false,error:false,message:'Image added to '+slot.label+'. Review it below.'});vhRefreshReferenceLibrary(companion,timeline);
 }catch(error){vh2SetReferenceProgress(timeline,{running:false,error:true,message:error.message});}
}
function vhReferenceImageDialog(entry,timeline){
 const d=vhProductDialog(entry.label,'This image belongs to its saved subject.');d.querySelector('form')?.remove();
 const img=document.createElement('img');img.src=vh2PhotoAssetUrl(timeline.vh2.worldId,entry.assetId);img.alt=entry.label;img.style.cssText='display:block;max-width:100%;max-height:70vh;object-fit:contain;margin:16px auto';d.append(img);
}
async function vhAddReferenceView(companion,timeline,subject,view){
 if(!VH_AUTO_REFERENCE_VIEWS[subject.role]?.includes(view))return;
 const plan={id:'ref-slot:'+subject.role+':'+view+':'+Array.from(subject.entityId).reduce((hash,c)=>(Math.imul(hash,31)+c.charCodeAt(0))>>>0,0).toString(36),role:subject.role,entityId:subject.entityId,view,label:(subject.name+' · '+VH_REFERENCE_LABELS[view]).slice(0,120),description:(subject.description||'Reference image for '+subject.name).slice(0,2000)};
 try{await vhUiCommand(timeline,'apply_life_proposal',{version:2,baseSetupVersion:timeline.vh2.setupVersion||0,proposal:{referencePlan:[plan]}});vhRefreshReferenceLibrary(companion,timeline);}
 catch(error){vh2SetReferenceProgress(timeline,{running:false,error:true,message:error.message});}
}
function vhAddReferenceProp(companion,timeline){
 const d=vhProductDialog('Add a prop','Name the object. The app will prepare its image slot automatically.');const form=d.querySelector('form'),status=d.querySelector('[role=status]');
 form.innerHTML='<label>Prop name<input name="name" required maxlength="200" placeholder="e.g. A silver laptop with stickers"></label><button type="submit">Add prop</button>';
 form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await vhUiCommand(timeline,'add_owned_item',{name:form.elements.name.value.trim(),category:'object',tags:[]});d.close();vhRefreshReferenceLibrary(companion,timeline);}catch(error){status.textContent=error.message;button.disabled=false;}};
}
function vhReferenceImageConfig(companion,timeline=getActiveCompanionTimeline(companion.id)){
 const saved=timeline?.vh2?.imageProvider;
 if(!companion.referenceImageSource&&saved?.configured){const native=saved.arguments?.model||saved.arguments?.mode;return {...companion,imageSource:saved.provider,imageModel:saved.model&&saved.model!=='provider default'?saved.model:typeof native==='string'?native:saved.tool||'',mcpImageTool:saved.tool||'',mcpImageArguments:safeJsonClone(saved.arguments||{})};}
 return {...companion,imageSource:companion.referenceImageSource||companion.imageSource||'provider',imageModel:companion.referenceImageSource?companion.referenceImageModel||'':companion.imageModel||''};
}
function vhReferenceModelPicker(companion,timeline){
 const config=vhReferenceImageConfig(companion,timeline),d=vhProductDialog('Reference image model','Use this life’s image connection, or choose an override for reference images only.');
 const form=d.querySelector('form'),status=d.querySelector('[role=status]');
 form.innerHTML='<label>Image provider<select name="provider"></select></label><label>Image model<select name="model"></select></label><label>Or enter a model ID<input name="custom" placeholder="Optional custom model ID" maxlength="500"></label><button type="submit">Save image model</button>';
 const provider=form.elements.provider,model=form.elements.model,custom=form.elements.custom,submit=form.querySelector('button');
 const sources={inherit:'Same as this life',provider:'App default provider (override)',openrouter:'OpenRouter',gptproto:'GPTProto',nanogpt:'NanoGPT',fal:'fal',local:'Local API',local_image:'Local image server',comfyui:'ComfyUI',higgsfield:'Higgsfield',magnific:'Magnific'};
 for(const [id,name] of Object.entries(sources))provider.append(new Option(name,id));provider.value=companion.referenceImageSource||'inherit';
 let revision=0;
 const populate=async()=>{
  const current=++revision,source=provider.value;model.replaceChildren(new Option('Loading models…',''));model.disabled=true;submit.disabled=true;custom.value='';status.textContent='Loading image models…';
  model.closest('label').hidden=source==='inherit';custom.closest('label').hidden=source==='inherit';
  if(source==='inherit'){const inherited=vhReferenceImageConfig({...companion,referenceImageSource:'',referenceImageModel:''},timeline);model.replaceChildren(new Option('Uses this life’s image connection',''));status.textContent='Same as this life: '+(inherited.imageSource==='provider'?companionImageProviderId(inherited):inherited.imageSource)+' · '+(inherited.imageModel||'Configured route default')+'. Changes to Image settings apply to future reference images too.';submit.disabled=false;return;}
  try{
   const routed=['local_image','comfyui','higgsfield','magnific'].includes(source);
   const models=routed?[]:rankCompanionImageModels(await getCompanionOutputModels('image',false,companionImageProviderId({imageSource:source})),companionImageProviderId({imageSource:source}));
   if(current!==revision||!d.isConnected)return;
   model.replaceChildren(new Option(routed?'Configured route default':'Choose an image model…',''));
   for(const item of models)model.append(new Option(item.name||item.id,item.id));
   const selected=source===config.imageSource?config.imageModel:'';
   if(selected&&!models.some(m=>m.id===selected))model.append(new Option(selected,selected));model.value=selected;
   status.textContent='Override for reference images only. '+(['local_image','comfyui','local','gptproto','nanogpt','fal','provider'].includes(source)?'This route requires the browser to remain open during generation. ':'')+(routed?'Uses the connection and image options saved in Photo setup.':models.length?'Choose the model to use.':'No catalog available. Enter a model ID, or check Settings → Connections.');
  }catch(error){if(current!==revision)return;model.replaceChildren(new Option('Enter a model ID below',''));status.textContent='Could not load models. '+error.message;}
  finally{if(current===revision){model.disabled=false;submit.disabled=false;}}
 };
 provider.onchange=populate;void populate();
 form.onsubmit=async event=>{event.preventDefault();const source=provider.value,chosen=custom.value.trim()||model.value;if(source!=='inherit'&&!chosen&&!['local_image','comfyui','higgsfield','magnific'].includes(source)){status.textContent='Choose an image model or enter its ID.';return;}
  const previous=[companion.referenceImageSource,companion.referenceImageModel];submit.disabled=true;
  try{companion.referenceImageSource=source==='inherit'?'':source;companion.referenceImageModel=source==='inherit'?'':chosen;await saveCompanionTemplatesState();d.close();vhRefreshReferenceLibrary(companion,timeline);}
  catch(error){[companion.referenceImageSource,companion.referenceImageModel]=previous;status.textContent=error.message;submit.disabled=false;}
 };
}
function vhRenderReferenceLibrary(root,companion,timeline){
 const link=timeline.vh2,subjects=vhReferenceSubjects(companion,link),entries=(link.bible?.entries||[]).filter(e=>e.status!=='archived');
 const selected=subjects.filter(s=>s.group===vhReferenceGroup),missing=vhMissingReferenceSlots(selected,link);
 root.classList.add('vh-auto-reference-library');
 const intro=document.createElement('div');intro.className='vh-reference-intro';intro.innerHTML='<div><h3>Images for their world</h3><p>Subjects are already linked. Generate the missing images, then approve the results you want to use.</p></div><span>'+entries.filter(e=>e.status==='approved').length+' approved · '+entries.filter(e=>e.status==='pending').length+' to review</span>';root.append(intro);
 const tabs=document.createElement('nav');tabs.className='vh-reference-tabs';tabs.setAttribute('aria-label','Reference categories');
 for(const [key,[label]] of Object.entries(VH_REFERENCE_GROUPS)){const b=document.createElement('button');b.type='button';b.textContent=label+' · '+subjects.filter(s=>s.group===key).length;b.setAttribute('aria-pressed',String(key===vhReferenceGroup));b.onclick=()=>{const job=vh2ReferenceJobs.get(timeline.id);if(job&&!job.running&&!job.error)vh2ReferenceJobs.delete(timeline.id);vhReferenceGroup=key;vhRefreshReferenceLibrary(companion,timeline);};tabs.append(b);}root.append(tabs);
 const heading=document.createElement('div');heading.className='vh-reference-group-heading';heading.innerHTML='<div><h3>'+VH_REFERENCE_GROUPS[vhReferenceGroup][0]+'</h3><p>'+VH_REFERENCE_GROUPS[vhReferenceGroup][1]+'</p></div>';root.append(heading);
 if(vhReferenceGroup==='prop'){const b=document.createElement('button');b.type='button';b.textContent='+ Add prop';b.onclick=()=>vhAddReferenceProp(companion,timeline);heading.append(b);}
 const config=vhReferenceImageConfig(companion,timeline),modelRow=document.createElement('div');modelRow.className='vh-reference-model';const modelText=document.createElement('div'),modelTitle=document.createElement('strong'),modelDetail=document.createElement('span');modelTitle.textContent=companion.referenceImageSource?'Reference image override':'Same image connection as this life';modelDetail.textContent=(config.imageSource==='provider'?companionImageProviderId(config):config.imageSource)+' · '+(config.imageModel||'Configured route default');modelText.append(modelTitle,modelDetail);const changeModel=document.createElement('button');changeModel.type='button';changeModel.textContent='Change model';changeModel.onclick=()=>vhReferenceModelPicker(companion,timeline);modelRow.append(modelText,changeModel);root.append(modelRow);
 vh2ReferenceGenerationControl(root,companion,timeline,missing.length?'Generate missing images · '+missing.length:'All images generated',async()=>{const latest=vhMissingReferenceSlots(vhReferenceSubjects(companion,timeline.vh2).filter(s=>s.group===vhReferenceGroup),timeline.vh2);if(!latest.length)return;await vh2GenerateReferenceViews(companion,timeline,latest);vhRefreshReferenceLibrary(companion,timeline);});
 const batch=root.querySelector('[data-reference-start]');batch.dataset.referenceEmpty=String(!missing.length);
 const credits=document.createElement('p');credits.className='vh-reference-credits';credits.textContent=missing.length?`${missing.length} image${missing.length===1?'':'s'} · uses your selected image provider and credits. Generated images wait for your review.`:'Add another view only if you need it. Existing images are kept.';root.append(credits);
 const grid=document.createElement('div');grid.className='vh-reference-subjects';root.append(grid);
 if(!selected.length){const empty=document.createElement('div');empty.className='vh-reference-empty';empty.innerHTML='<h4>No '+VH_REFERENCE_GROUPS[vhReferenceGroup][0].toLowerCase()+' yet</h4><p>'+(vhReferenceGroup==='prop'?'Add an object and its image slot will appear here.':'Saved subjects appear here automatically. Add them in '+(vhReferenceGroup==='person'?'People':vhReferenceGroup==='rooms'?'Places':'Wardrobe')+'.')+'</p>';grid.append(empty);if(vhReferenceGroup!=='prop'){const b=document.createElement('button');b.type='button';b.textContent='Open '+(vhReferenceGroup==='person'?'People':vhReferenceGroup==='rooms'?'Places':'Wardrobe');b.onclick=()=>vhWorkspaceSelect(({person:'people',rooms:'places',garment:'closet'})[vhReferenceGroup]);empty.append(b);}}
 for(const subject of selected){
  const article=document.createElement('article');article.className='vh-reference-subject';article.dataset.subject=subject.entityId;
  const head=document.createElement('header');const name=document.createElement('h4');name.textContent=subject.name;head.append(name);if(subject.parent){const parent=document.createElement('small');parent.textContent=subject.parent;head.append(parent);}article.append(head);
  const slots=vhReferenceSubjectSlots(subject,link),list=document.createElement('div');list.className='vh-reference-slots';article.append(list);
  for(const slot of slots){
   const versions=vhReferenceSlotEntries(slot,link),available=versions.filter(e=>e.status!=='rejected'),entry=[...available].reverse().find(e=>e.status==='pending')||[...available].reverse().find(e=>e.status==='approved');
   const tile=document.createElement('section');tile.className='vh-reference-slot';
   if(entry){const preview=document.createElement('button');preview.type='button';preview.className='vh-reference-image';preview.setAttribute('aria-label','View '+slot.label);const img=document.createElement('img');img.src=vh2PhotoAssetUrl(link.worldId,entry.assetId);img.alt=slot.label;preview.append(img);preview.onclick=()=>vhReferenceImageDialog(entry,timeline);tile.append(preview);}
   else{const placeholder=document.createElement('div');placeholder.className='vh-reference-placeholder';placeholder.setAttribute('aria-hidden','true');placeholder.textContent=slot.view==='turnaround'?'◯  ◯  ◯  ◯':subject.group==='person'?'◯':subject.group==='rooms'?'▱':'◇';tile.append(placeholder);}
   const title=document.createElement('strong');title.textContent=VH_REFERENCE_LABELS[slot.view];tile.append(title);
   const label=document.createElement('span');label.className='vh-reference-slot-state';label.textContent=entry?.status==='approved'?'Approved':entry?'Ready to review':versions.length?'Needs a new image':'Ready to generate';tile.append(label);
   const actions=document.createElement('div');actions.className='vh-reference-slot-actions';tile.append(actions);
   const action=(text,handler)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=async()=>{b.disabled=true;try{await handler();}catch(error){vh2SetReferenceProgress(timeline,{running:false,error:true,message:error.message});}finally{if(b.isConnected)b.disabled=false;}};actions.append(b);return b;};
   if(entry?.status==='pending')action('Approve',async()=>{await vhUiCommand(timeline,'review_bible_asset',{entryId:entry.id,status:'approved'});if(!vh2BibleGenerationLocks.has(timeline.id))vh2ReferenceJobs.delete(timeline.id);vhRefreshReferenceLibrary(companion,timeline);});
   const gen=action(entry?'Generate another':'Generate image',async()=>{await vh2GenerateReferenceViews(companion,timeline,[slot],{regenerate:!!entry});vhRefreshReferenceLibrary(companion,timeline);});gen.dataset.referenceGenerate=timeline.id;
   const upload=document.createElement('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';upload.hidden=true;upload.setAttribute('aria-label','Upload '+slot.label);upload.onchange=()=>vhReferenceUpload(companion,timeline,slot,upload.files?.[0]);tile.append(upload);action('Upload instead',()=>upload.click());
   if(entry)action('Reject',async()=>{await vhUiCommand(timeline,'review_bible_asset',{entryId:entry.id,status:'rejected'});vhRefreshReferenceLibrary(companion,timeline);});
   list.append(tile);
  }
  const unused=(VH_AUTO_REFERENCE_VIEWS[subject.role]||[]).filter(view=>!slots.some(s=>s.view===view));
  if(unused.length){const label=document.createElement('label');label.className='vh-reference-add-view';label.textContent='Optional extra view';const select=document.createElement('select');select.append(new Option('Choose an extra view…',''));for(const view of unused)select.append(new Option(VH_REFERENCE_LABELS[view],view));select.onchange=()=>{if(select.value)void vhAddReferenceView(companion,timeline,subject,select.value);};label.append(select);article.append(label);}
  // Untagged uploads from older versions stay reachable; never discard existing references.
  const unplaced=entries.filter(e=>e.role===subject.role&&e.entityId===subject.entityId&&!slots.some(slot=>(e.tags||[]).includes(slot.view)));
  if(unplaced.length){const old=document.createElement('details');old.innerHTML='<summary>Other saved images · '+unplaced.length+'</summary>';for(const e of unplaced){const b=document.createElement('button');b.type='button';b.textContent=e.label+' · '+e.status;b.onclick=()=>vhReferenceImageDialog(e,timeline);old.append(b);}article.append(old);}
  grid.append(article);
 }
 vh2PaintReferenceProgress(timeline);
}

function vhRebootLife(companion){
 const timeline=getActiveCompanionTimeline(companion.id),d=vhProductDialog('Reboot current life','Refresh this life while keeping its history.');const form=d.querySelector('form'),status=d.querySelector('[role=status]');
 form.innerHTML='<p>Saves a recovery checkpoint, reloads the current life state, and repairs the known sleep-startup error if its recorded history confirms it.</p><p>Your conversation, memories, relationships, photos, possessions and plans stay intact. Running lives catch up automatically in the background; paused lives remain paused. Submitted generation jobs are not retried.</p><button type="submit">Reboot life — keep history</button>';
 form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;status.textContent='Saving checkpoint and rebooting life…';try{const wasRunning=timeline.vh2.running;await vhUiCommand(timeline,'reboot_life',{});if(typeof wasRunning==='boolean'&&timeline.vh2.running!==wasRunning)await vhUiCommand(timeline,'set_running',{running:wasRunning});const result=timeline.vh2.runtimeReboot;status.textContent=result?.sleepInitializationRepaired?'Life rebooted. The faulty sleep initialization was repaired. History preserved.':'Life rebooted. History preserved; no faulty sleep initialization needed repair.';b.textContent='Rebooted';vhRenderWorkspace();}catch(error){status.textContent=error.message;b.disabled=false;}};
}

function vhStoryControls(host,companion,timeline){
 const link=timeline.vh2,defaults={intensity:0,social:50,novelty:50,complications:20,recoveryHours:18,adviserEnabled:false};
 const saved=()=>({...defaults,...link.executableSetup?.storyPolicy});
 const section=document.createElement('section');section.className='vh-story-settings';section.setAttribute('aria-label','Story and everyday drama');
 section.innerHTML='<div class="vh-story-heading"><div><span class="vh-eyebrow">Life rhythm</span><h3>Story & everyday drama</h3></div><output data-level></output></div><p>Add invitations, reasons to try something different and occasional small disruptions. People still choose what to do.</p><div class="vh-story-presets" role="group" aria-label="Drama presets"></div><label>Drama level<input name="intensity" type="range" min="0" max="100" step="1"></label><p data-description></p><details><summary>Shape the mix</summary><div class="vh-story-mix"></div><label>Breathing room between added opportunities (hours)<input name="recoveryHours" type="number" min="6" max="72" step="1"></label><p>Weights change the mix of added opportunities. Zero excludes that type. Existing friendships, obligations and ordinary life keep their own rhythm.</p></details><div class="vh-story-adviser"><label class="vh-choice-row"><input name="adviserEnabled" type="checkbox">Daily life adviser</label><p>Once a day, review lived experience and suggest a gentle direction. Uses this character’s text model and its existing allowance. No image or video calls.</p><p data-adviser-status aria-live="polite"></p><details><summary>Latest direction</summary><p data-adviser-direction></p></details></div><div class="vh-story-save"><button type="button" data-save>Save story settings</button><span role="status" aria-live="polite"></span></div><p data-runtime></p>';
 const intensity=section.querySelector('[name=intensity]'),status=section.querySelector('[role=status]'),button=section.querySelector('[data-save]');
 const presets=[[0,'Unassisted'],[15,'Quiet'],[40,'Everyday'],[70,'Lively'],[100,'Dramatic']];
 for(const [value,label] of presets){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.value=value;b.onclick=()=>{intensity.value=value;update();};section.querySelector('.vh-story-presets').append(b);}
 for(const [name,label] of [['social','Social opportunities'],['novelty','Personal interests & variety'],['complications','Small complications']]){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.name=name;input.min=0;input.max=100;input.step=1;const output=document.createElement('output');input.oninput=()=>{output.value=input.value;status.textContent='Unsaved changes';};l.append(input,output);section.querySelector('.vh-story-mix').append(l);}
 function update(){const n=Number(intensity.value);section.querySelector('[data-level]').value=n+'/100';section.querySelector('[data-description]').textContent=n===0?'No added story events. Life unfolds through its existing needs, people and choices.':n<30?'Mostly ordinary days, with occasional openings for something different.':n<65?'A varied everyday life with room for quiet stretches.':n<90?'More opportunities and changing plans, with time to settle between them.':'Frequent opportunities for change. This increases pacing, not guaranteed conflict or romance.';for(const b of section.querySelectorAll('[data-value]'))b.setAttribute('aria-pressed',String(Number(b.dataset.value)===n));status.textContent='Unsaved changes';}
 const read=()=>Object.fromEntries(Object.keys(defaults).map(k=>[k,k==='adviserEnabled'?section.querySelector('[name='+k+']').checked:Number(section.querySelector('[name='+k+']').value)]));
 const populate=()=>{for(const [key,value] of Object.entries(saved())){const input=section.querySelector('[name='+key+']');if(input){if(input.type==='checkbox')input.checked=value;else input.value=value;if(input.nextElementSibling?.tagName==='OUTPUT')input.nextElementSibling.value=value;}}update();status.textContent='Saved to this life';};
 intensity.oninput=update;section.querySelector('[name=recoveryHours]').oninput=()=>status.textContent='Unsaved changes';
 button.onclick=async()=>{const draft=read();if(!section.querySelector('[name=recoveryHours]').reportValidity())return;section.querySelectorAll('input,button').forEach(x=>x.disabled=true);status.textContent='Saving…';try{await vhUiCommand(timeline,'apply_life_proposal',{version:2,baseSetupVersion:link.setupVersion||0,proposal:{storyPolicy:draft}});if(Object.keys(draft).some(k=>saved()[k]!==draft[k]))throw Error('The saved settings were not confirmed.');status.textContent='Saved · persists after reload and restart';renderAdviser();}catch(error){status.textContent='Not saved: '+error.message+' Your draft is retained.';}finally{section.querySelectorAll('input,button').forEach(x=>x.disabled=false);}};
 const renderAdviser=()=>{const a=link.story?.adviser||{};const labels={reviewing:'Reviewing recent life…',reviewed:'Last daily review completed',waiting:'Waiting',unknown:'Review outcome unconfirmed',failed:'Review failed',discarded:'Outdated review discarded'};section.querySelector('[data-adviser-status]').textContent=!saved().adviserEnabled?'Off':(labels[a.status]||'Ready for its first daily review')+(a.error?' · '+a.error:'')+(a.nextWallAt?' · Next review '+new Date(a.nextWallAt).toLocaleString():'');section.querySelector('[data-adviser-direction]').textContent=[a.lastResult?.direction||'No direction proposed. Ordinary days are welcome.',...(a.agenda||[]).map(x=>(x.subject||x.reason)+' · flexible, '+new Date(x.startsAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'–'+new Date(x.expiresAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))].join('\n');};
 section.querySelector('[name=adviserEnabled]').onchange=()=>status.textContent='Unsaved changes';
 populate();renderAdviser();section.querySelector('[data-runtime]').textContent=link.agencyPaused?'Agency is paused globally. These preferences take effect when it resumes.':link.story?.reason||'Drama pacing runs locally. The optional daily adviser uses one text-model call per review.';host.prepend(section);const timer=setInterval(()=>{if(!section.isConnected)clearInterval(timer);else renderAdviser();},2000);host.closest('dialog')?.addEventListener('close',()=>clearInterval(timer),{once:true});
}
function vhOpenLifeActivity(companion){
 const timeline=getActiveCompanionTimeline(companion.id);if(!timeline?.vh2)return;
 const existing=document.getElementById('vh-life-settings-dialog');if(existing){existing.focus();return;}
 const d=vhProductDialog('Life settings','Choose their independence and the rhythm of their life. Switches save immediately; story settings have their own Save button.');d.id='vh-life-settings-dialog';
 const body=d.querySelector('form');body.onsubmit=e=>e.preventDefault();vhLifeActivityControls(body,companion,timeline,true);vhStoryControls(body,companion,timeline);const calendarButton=document.createElement('button');calendarButton.type='button';calendarButton.textContent='Open calendar';calendarButton.onclick=()=>vhOpenPersonalCalendar(companion);body.prepend(calendarButton);
 d.querySelector(':scope > [role=status]')?.remove();
}
function vhLifeActivityControls(host,companion,timeline,expanded=false){
 const link=timeline?.vh2;if(!link)return;
 if(!expanded){
  if(host.closest('#companion-social-panel'))return;
  const row=document.createElement('div');row.className='vh-life-settings-launch';
  const button=document.createElement('button');button.type='button';button.textContent='Life settings';button.setAttribute('aria-haspopup','dialog');button.onclick=()=>vhOpenLifeActivity(companion);
  const status=document.createElement('span');const enabled=[link.agency?.policy?.enabled,link.geography?.enabled,link.socialSettings?.enabled].filter(Boolean).length;status.textContent=link.geography?.enabled?'Independent life on · '+(link.socialSettings?.enabled?'social posting on':'social posting off'):'Independent life off';const calendar=document.createElement('button');calendar.type='button';calendar.textContent='Calendar';calendar.setAttribute('aria-haspopup','dialog');calendar.onclick=()=>vhOpenPersonalCalendar(companion);row.append(button,calendar,status);host.prepend(row);return;
 }
 const section=document.createElement('section');section.className='vh-life-activity';section.dataset.lifeId=timeline.id;section.setAttribute('aria-label','Autonomous life settings');
 section.innerHTML='<div class="vh-life-switches"></div><p class="vh-life-save-receipt" role="status" aria-live="polite"></p>';
 const receipt=section.querySelector('[role=status]'),grid=section.querySelector('.vh-life-switches');
 const feedback=(text,status)=>{link.activitySaveReceipt={text,status};for(const panel of document.querySelectorAll('.vh-life-activity'))if(panel.dataset.lifeId===timeline.id){const r=panel.querySelector('[role=status]');r.textContent=text;r.dataset.state=status;}};
 if(link.activitySaveReceipt){receipt.textContent=link.activitySaveReceipt.text;receipt.dataset.state=link.activitySaveReceipt.status;}
 const choices=[['geography','Independent life & exploration','Choose activities and nearby places from needs, interests and commitments. Travel takes time; flexible routines are preferences.',()=>!!link.geography?.enabled],['expression','Spontaneous expression','Choose moments to photograph and invite people to spend time together.',()=>!!link.agency?.policy?.enabled],['social','Social posting','Write posts from lived moments and share selected photos in the simulated feed.',()=>link.socialSettings?.enabled===true],['encounters','Supporting people interact','People in the same place can talk and develop relationships of their own.',()=>!!link.people?.network?.enabled],['groups','Friends make plans','Established friends can choose shared outings. Each person has their own needs and availability.',()=>!!link.people?.network?.policy?.groupPlansEnabled],['introductions','Meet new people','Encounter the local residents configured in this world and gradually form connections.',()=>!!link.population?.enabled],['invitations','Invitations & hosting','Friends can suggest meeting, hosting or going out; participants may decline or leave early.',()=>!!link.socialPlanPolicy?.enabled],['weather','Respond to live weather','Use available weather information when choosing clothing, movement and activities.',()=>link.executableSetup?.autonomy?.liveWeather===true],['health','Ordinary health variation','Occasional simulated illness and recovery affect energy, rest and plans.',()=>link.health?.policy?.enabled===true]];
 const save=async(button,label,enabled,command,body,read)=>{button.disabled=true;button.textContent='Saving…';receipt.textContent='Saving '+label.toLowerCase()+'…';receipt.dataset.state='saving';try{await vhUiCommand(timeline,command,body);if(read()!==enabled)throw Error('The saved value was not confirmed.');button.setAttribute('aria-checked',String(enabled));button.textContent=enabled?'On':'Off';feedback(label+' '+(enabled?'enabled':'disabled')+' · saved to this life. Persists after reload and restart.','saved');}catch(error){button.setAttribute('aria-checked',String(read()));button.textContent=read()?'On':'Off';feedback('Not saved: '+error.message,'error');}finally{button.disabled=false;}};
 for(const [key,label,description,read] of choices){const row=document.createElement('div');row.className='vh-life-switch-row';const copy=document.createElement('div');copy.innerHTML='<strong>'+escapeHTML(label)+'</strong><p>'+escapeHTML(description)+'</p>';const toggle=document.createElement('button');toggle.type='button';toggle.className='vh-life-switch';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',label);toggle.setAttribute('aria-checked',String(read()));toggle.textContent=read()?'On':'Off';toggle.onclick=()=>{const enabled=!read();if(key==='geography')return save(toggle,label,enabled,'configure_geographic_life',{enabled},read);if(key==='expression')return save(toggle,label,enabled,'configure_life_expression',{policy:{...link.agency.policy,enabled}},read);const sections={encounters:['socialPolicy','encountersEnabled'],groups:['socialPolicy','groupPlansEnabled'],introductions:['socialPolicy','introductionsEnabled'],invitations:['socialPlanPolicy','enabled'],weather:['autonomy','liveWeather'],health:['healthPolicy','enabled']};if(sections[key]){const [section,field]=sections[key];return save(toggle,label,enabled,'apply_life_proposal',{version:2,baseSetupVersion:link.setupVersion||0,proposal:{[section]:{...link.executableSetup?.[section],[field]:enabled}}},read);}return save(toggle,label,enabled,'configure_expression_profile',{fields:{socialFeedEnabled:enabled,...(enabled&&(!link.socialSettings?.frequency||link.socialSettings.frequency==='manual')?{socialPostFrequency:'few_week'}:{})}},read);};row.append(copy,toggle);grid.append(row);}
 const fineTune=document.createElement('div');fineTune.className='vh-life-settings-actions';fineTune.innerHTML='<button type="button" data-ai>Shape this life with AI</button><button type="button" data-places>Places & household</button><button type="button" data-people>People & relationships</button><button type="button" data-boundaries>Private visit boundaries</button>';fineTune.querySelector('[data-ai]').onclick=()=>{section.closest('dialog')?.close();vhAIHelpers(companion,'autonomy');};fineTune.querySelector('[data-places]').onclick=()=>{section.closest('dialog')?.close();vhOpenWorkspace('places',companion.id);};fineTune.querySelector('[data-people]').onclick=()=>{section.closest('dialog')?.close();vhOpenWorkspace('people',companion.id);};fineTune.querySelector('[data-boundaries]').onclick=()=>vhPrivateVisitSettings(companion,timeline);section.append(fineTune);
 const locals=link.population?.residents||[];if(link.population?.enabled&&!locals.length){const p=document.createElement('p');p.className='vh-setup-help';p.textContent='Meeting new people is enabled, but this world has no local residents yet. Use Shape this life with AI to propose residents and their homes.';section.append(p);}
 if(link.agencyPaused){const pause=document.createElement('p');pause.className='vh-life-pause-note';pause.textContent='Agency is paused globally. These preferences are saved; use Resume agency in the sidebar to allow automatic activity.';section.append(pause);}
 const frequency=document.createElement('label');frequency.className='vh-life-frequency';frequency.append(document.createTextNode('Posting frequency'));const select=document.createElement('select');select.className='form-select';select.setAttribute('aria-label','Posting frequency');for(const [value,label] of [['manual','Manual only'],['rare','Occasionally'],['weekly','About weekly'],['few_week','A few times a week'],['daily','About daily'],['active','More often']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=link.socialSettings?.frequency||'few_week';select.onchange=async()=>{select.disabled=true;receipt.textContent='Saving posting frequency…';try{await vhUiCommand(timeline,'configure_expression_profile',{fields:{socialPostFrequency:select.value}});if(link.socialSettings.frequency!==select.value)throw Error('Saved frequency was not confirmed.');feedback('Posting frequency saved. Moments and availability still determine whether they post.','saved');}catch(error){feedback('Not saved: '+error.message,'error');select.value=link.socialSettings?.frequency||'few_week';}finally{select.disabled=false;}};frequency.append(select);section.append(frequency);host.prepend(section);
}

function vhPrivateVisitSettings(companion,timeline){
 const link=timeline.vh2,d=vhProductDialog('Private visit boundaries','These settings allow possibilities. Every participant still decides independently, and can decline or leave.');const f=d.querySelector('form');
 const saved=link.executableSetup?.socialPrivateVisitPermissions||[],policy=link.socialPlanPolicy||{};f.innerHTML='<label class="vh-choice-row"><input name="enabled" type="checkbox">Allow private visit invitations</label><div data-people></div><p>Known adults with a recorded home can consider visits using their own personalities. Individual rules below can override that. Interest is not automatic consent or a promise of a relationship.</p><button type="submit">Save boundaries</button>';
 f.elements.enabled.checked=!!policy.privateVisits;
 const eligible=(link.knownPeople||[]).filter(p=>Number(p.age)>=18&&link.people?.actors?.[p.id]?.policy?.homePlaceId);
 for(const p of eligible){const old=saved.find(x=>x.personId===p.id)||{},row=document.createElement('fieldset');row.dataset.personId=p.id;row.dataset.age=String(p.age);row.innerHTML='<legend>'+escapeHTML(p.name)+'</legend><label>Private visits<select name="visitRule"><option value="inherit">Use personality and current interest</option><option value="custom">Use an individual rule</option><option value="block">Do not consider private visits</option></select></label><div class="vh-form-columns"><label>'+escapeHTML(companion.name)+'’s authored interest<input type="number" name="selfWillingness" min="0" max="100" value="'+Number(old.selfWillingness||0)+'"></label><label>'+escapeHTML(p.name)+'’s authored interest<input type="number" name="otherWillingness" min="0" max="100" value="'+Number(old.otherWillingness||0)+'"></label></div><label class="vh-choice-row"><input type="checkbox" name="allowIntimacy">Adult intimacy may be considered within their boundaries</label>';row.querySelector('[name=visitRule]').value=old.personId?(old.enabled?'custom':'block'):'inherit';row.querySelector('[name=allowIntimacy]').checked=old.allowIntimacy===true;const update=()=>{for(const input of row.querySelectorAll('input'))input.disabled=row.querySelector('[name=visitRule]').value!=='custom';};row.querySelector('[name=visitRule]').onchange=update;update();f.querySelector('[data-people]').append(row);}
 if(!eligible.length){const p=document.createElement('p');p.className='vh-setup-help';p.textContent='No eligible supporting person has both an explicit adult age and a home. Add those details in People & relationships or ask the AI helper to complete their setup.';f.querySelector('[data-people]').append(p);}
 f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('[type=submit]'),status=d.querySelector(':scope > [role=status]');button.disabled=true;try{const selected=[...f.querySelectorAll('[data-person-id]')].filter(row=>row.querySelector('[name=visitRule]').value!=='inherit').map(row=>({personId:row.dataset.personId,personAge:Number(row.dataset.age),enabled:row.querySelector('[name=visitRule]').value==='custom',selfWillingness:Number(row.querySelector('[name=selfWillingness]').value),otherWillingness:Number(row.querySelector('[name=otherWillingness]').value),allowIntimacy:row.querySelector('[name=allowIntimacy]').checked}));const eligibleIds=new Set(eligible.map(x=>x.id));await vhUiCommand(timeline,'configure_social_plans',{policy:{...policy,privateVisits:f.elements.enabled.checked},privateVisitPermissions:[...saved.filter(x=>!eligibleIds.has(x.personId)),...selected]});status.textContent='Boundaries saved to this life.';button.textContent='Saved';}catch(error){status.textContent=error.message;button.disabled=false;}};
}

function vhRenderLocalMap(host,places,link){
 const coords=places.filter(p=>p.mapCoordinates?.length===2);if(!coords.length){host.innerHTML='<p>No geographic position has been established. Link saved places to an offline world pack.</p>';return;}
 const xs=coords.map(p=>p.mapCoordinates[0]),ys=coords.map(p=>p.mapCoordinates[1]),left=Math.min(...xs),bottom=Math.min(...ys),dx=Math.max(.001,Math.max(...xs)-left),dy=Math.max(.001,Math.max(...ys)-bottom);
 const point=xy=>[25+(xy[0]-left)/dx*650,330-(xy[1]-bottom)/dy*300];const line=points=>points.map(x=>point(x).join(',')).join(' ');
 const routes=(link.routeLegs||[]).filter(r=>r.geometry?.length>=2);
 const current=link.present?.position?.coordinates;host.hidden=false;
 const participants=Object.values(link.people?.actors||{});
 host.innerHTML=`<svg viewBox="0 0 700 360" role="img" aria-label="Offline places and recorded walking routes"><rect width="700" height="360" fill="#111b25"/>${(()=>{const seen=new Set(),segments=[];for(const r of routes)for(let i=1;i<r.geometry.length;i++){const a=point(r.geometry[i-1]).map(n=>n.toFixed(1)).join(','),b=point(r.geometry[i]).map(n=>n.toFixed(1)).join(',');if(a===b)continue;const key=[a,b].sort().join('|');if(seen.has(key))continue;seen.add(key);segments.push('M'+a+'L'+b);}return '<path d="'+segments.join('')+'" fill="none" stroke="#688099" stroke-opacity=".3" stroke-width="1"/>';})()}${link.journey?.geometry?`<polyline points="${line(link.journey.geometry)}" fill="none" stroke="#71dbb4" stroke-width="3"/>`:''}${coords.map(p=>{const [x,y]=point(p.mapCoordinates);return `<circle cx="${x}" cy="${y}" r="${p.id===link.present?.placeId?6:3}" fill="${p.id===link.present?.placeId?'#71dbb4':'#91bdf0'}"><title>${escapeHTML(p.label)}</title></circle>`;}).join('')}${current?`<circle cx="${point(current)[0]}" cy="${point(current)[1]}" r="7" fill="#71dbb4" stroke="white" stroke-width="2"/>`:''}</svg><p>${routes.length?'Offline walking network · travel times and entrance connections are estimates.':'Saved coordinates · no street routes loaded.'} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p><div class="vh-map-participants" aria-label="People in this world">${participants.map(a=>{const name=(link.knownPeople||[]).find(p=>p.id===a.id)?.name||a.id,place=places.find(p=>p.id===a.placeId);return `<p><strong>${escapeHTML(name)}</strong> · ${escapeHTML(a.journey?'Travelling to '+(places.find(p=>p.id===a.journey.to)?.label||a.journey.to):(a.action?.kind||'Considering options')+' at '+(place?.label||'unknown position'))}</p>`;}).join('')}</div>`;
}

async function vhWorldSetup(companion){
 const timeline=getActiveCompanionTimeline(companion.id),link=timeline?.vh2;if(!link){showToast('Start a persistent life before assigning its region.');return;}
 const dialog=vhProductDialog('World setup','Offline regions are stored once on this device and reused across characters.');
 dialog.id='vh-world-setup-dialog';const body=dialog.querySelector('form');body.onsubmit=e=>e.preventDefault();const content=document.createElement('div');content.className='vh-world-setup';
 content.innerHTML='<label>Region<select class="form-select" data-region><option value="">Choose an installed region</option></select></label><div data-library></div><div data-bindings></div><p role="status" aria-live="polite">Loading world library…</p><button type="button" class="btn btn-primary" data-apply disabled>Use this region</button>';
 body.append(content);const coordinates=document.createElement('section');coordinates.innerHTML='<h3>Place by coordinates</h3><p>No map listing needed. Choose a saved place to enter latitude and longitude.</p>';for(const place of (link.travelPlaces||[]).filter(p=>!p.id.startsWith('osm:'))){const b=document.createElement('button');b.type='button';b.textContent=place.label+(place.mapCoordinates?' · Placed':' · Set position');b.onclick=()=>{dialog.close();vhOpenPlace(companion,place.id);};coordinates.append(b);}content.prepend(coordinates);const select=content.querySelector('[data-region]'),status=content.querySelector('[role=status]'),bindings=content.querySelector('[data-bindings]'),apply=content.querySelector('[data-apply]');let pack=null,selectionVersion=0;
 const appliedPack=()=>pack&&(timeline.vh2.geography?.packs||[]).find(p=>p.source===pack.source&&JSON.stringify(p.packId??null)===JSON.stringify(pack.id===undefined?(pack.bbox??null):pack.id));
 bindings.onchange=()=>{if(pack){apply.disabled=false;apply.textContent=appliedPack()?'Update region links':'Use this region';status.textContent='Links changed. Apply to save them to this life.';}};
 const refresh=async()=>{const library=await vh2Request(timeline,'/vh2/world-packs');const prior=select.value;select.innerHTML='<option value="">Choose an installed region</option>';for(const p of library.packs){const o=document.createElement('option');o.value=p.id;o.textContent=p.name+' · '+p.placeCount+' places · Available offline';select.append(o);}select.value=prior;return library;};
 select.onchange=async()=>{const version=++selectionVersion;pack=null;apply.disabled=true;bindings.replaceChildren();if(!select.value)return;status.textContent='Reading region…';try{const loaded=await vh2Request(timeline,'/vh2/world-packs?id='+encodeURIComponent(select.value));if(version!==selectionVersion)return;pack=loaded;const installed=appliedPack(),current=link.present?.placeId,home=link.travel?.residenceId;bindings.innerHTML='<h3>Link your saved places</h3><p>This links map coordinates and routes. Their actual place and history stay unchanged.</p>';for(const p of (link.travelPlaces||[]).filter(p=>!p.id.startsWith('osm:'))){const row=document.createElement('label');row.textContent=p.label+(p.id===current?' · Currently here':p.id===home?' · Home':'');const picker=document.createElement('select');picker.className='form-select';picker.dataset.savedPlace=p.id;const empty=document.createElement('option');empty.value='';empty.textContent='Keep existing location';picker.append(empty);for(const q of pack.places){const o=document.createElement('option');o.value=q.id;o.textContent=q.label+' · '+q.mapCoordinates.map(n=>n.toFixed(4)).join(', ');picker.append(o);}picker.value=Object.entries(installed?.bindings||{}).find(([,saved])=>saved===p.id)?.[0]||'';row.append(picker);bindings.append(row);}status.textContent=pack.license+(installed?' · Already used by this life. Update the links or reapply the saved region.':' · Unlinked locations keep their existing position.');apply.textContent=installed?'Update region links':'Use this region';apply.disabled=false;}catch(e){status.textContent='Could not read region: '+e.message;}};
 apply.onclick=async()=>{apply.disabled=true;status.textContent='Applying region to this life…';try{const links={};for(const picker of bindings.querySelectorAll('select'))if(picker.value){if(links[picker.value])throw Error('Each map place can link to only one saved place.');links[picker.value]=picker.dataset.savedPlace;}const installed=appliedPack();if(!Object.keys(links).length&&!installed)throw Error('Link at least one saved place to connect this life to the walking network.');await vhUiCommand(timeline,'import_world_pack',{packId:select.value,bindings:links,...(installed?{refresh:true}:{})});status.textContent=installed?'Region links updated. Saved history and current place preserved.':'Region applied. Saved history and current place preserved.';apply.textContent='Applied';}catch(e){status.textContent='Not applied: '+e.message;apply.disabled=false;}};
 try{const installed=await refresh();status.textContent='Choose an installed region, or add one below.';const response=await fetch('world-packs/catalog.json');if(response.ok)for(const item of await response.json()){if(!/^[a-z0-9-]+\.json$/.test(item.file))continue;const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.textContent=installed.packs.some(p=>p.name===item.name)?item.name+' · Available offline':'Add '+item.name+' to library';button.disabled=installed.packs.some(p=>p.name===item.name);button.onclick=async()=>{button.disabled=true;status.textContent='Reading bundled region…';try{const response=await fetch('world-packs/'+item.file);if(!response.ok)throw Error('Region file unavailable.');const pack=await response.json();status.textContent='Saving region to the shared library…';await vh2Request(timeline,'/vh2/world-packs',{method:'POST',body:{name:item.name,pack}});await refresh();status.textContent='Available offline for every character. Choose it above to use it here.';button.textContent='Available offline';}catch(e){status.textContent='Region not installed: '+e.message;button.disabled=false;}};content.querySelector('[data-library]').append(button);}}catch(e){status.textContent='World library unavailable: '+e.message;}
 const upload=document.createElement('input');upload.type='file';upload.accept='.json,application/json';upload.hidden=true;const importButton=document.createElement('button');importButton.type='button';importButton.className='btn btn-secondary';importButton.textContent='Import region file';importButton.onclick=()=>upload.click();upload.onchange=async()=>{const file=upload.files[0];if(!file)return;importButton.disabled=true;status.textContent='Reading region file…';try{if(file.size>1900000)throw Error('Split regions larger than 1.9 MB.');await vh2Request(timeline,'/vh2/world-packs',{method:'POST',body:{name:file.name.replace(/\.json$/i,''),pack:JSON.parse(await file.text())}});await refresh();status.textContent='Region installed. Choose it above to use it here.';}catch(e){status.textContent='Import failed: '+e.message;}finally{importButton.disabled=false;upload.value='';}};content.querySelector('[data-library]').append(importButton,upload);
}

function vhCalendarOccurrence(row,year){
 const partial=/^--\d{2}-\d{2}$/.test(row.date||''),origin=partial?'2000'+row.date.slice(1):row.date;
 if(!VHWorldEngine.validDate(origin))return '';
 if(row.recurrence!=='yearly')return origin.startsWith(year+'-')?origin:'';
 if(!partial&&Number(origin.slice(0,4))>year)return '';
 let date=year+origin.slice(4);if(!VHWorldEngine.validDate(date)&&date.endsWith('-02-29'))date=year+'-02-28';return date;
}
function vhCalendarDateLabel(value){
 const partial=String(value||'').startsWith('--'),full=partial?'2000'+value.slice(1):value;
 if(!VHWorldEngine.validDate(full))return 'Choose a date';
 return new Date(full+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric',...(partial?{}:{year:'numeric'})});
}
function vhPersonalCalendarProblem(rows){
 if(!Array.isArray(rows)||rows.length>200)return 'Use up to 200 calendar dates.';
 const ids=new Set(),birthdays=new Set(),fields=['id','title','date','kind','recurrence','personId','reminderDays','notes','source','enabled'];
 for(const r of rows){
  if(!r||typeof r!=='object'||Object.keys(r).some(k=>!fields.includes(k))||typeof r.id!=='string'||!r.id||r.id.length>80||ids.has(r.id))return 'Calendar dates need unique IDs and supported fields.';ids.add(r.id);
  if(typeof r.title!=='string'||!r.title.trim()||r.title.trim().length>160)return 'Give every date a short title.';
  const partial=/^--\d{2}-\d{2}$/.test(r.date||'');if(!VHWorldEngine.validDate(partial?'2000'+r.date.slice(1):r.date)||partial&&r.recurrence!=='yearly')return 'Use a valid date; a month and day must repeat yearly.';
  if(!['birthday','anniversary','milestone','holiday','other'].includes(r.kind)||!['none','yearly'].includes(r.recurrence))return 'Choose an event type and whether it repeats yearly.';
  if(r.kind==='birthday'){if(!r.personId||r.recurrence!=='yearly'||birthdays.has(r.personId))return 'Use one yearly birthday per person.';birthdays.add(r.personId);}
  if(!Number.isInteger(r.reminderDays)||r.reminderDays<0||r.reminderDays>90)return 'Use a reminder from 0 to 90 days before the date.';
  if(r.source!==undefined&&!['authored','fictional_assumption'].includes(r.source)||r.enabled!==undefined&&typeof r.enabled!=='boolean'||r.notes!==undefined&&(typeof r.notes!=='string'||r.notes.length>1000))return 'Check the date’s source, reminder and notes.';
 }
 return '';
}
function vhOpenPersonalCalendar(companion){
 const timeline=getActiveCompanionTimeline(companion.id),link=timeline?.vh2;if(!link)return;
 const existing=document.getElementById('vh-personal-calendar');if(existing){existing.focus();return;}
 const localDate=at=>companionLocalMinuteInfo({...companion,vh2Travel:link.travel},at).dateKey;
 let today=localDate(link.simAt);const d=vhProductDialog('Calendar','Birthdays, important dates and the commitments that give this life its rhythm.');d.id='vh-personal-calendar';
 const f=d.querySelector('form'),status=d.querySelector(':scope > [role=status]');f.onsubmit=e=>e.preventDefault();let month=today.slice(0,7),selected='',view='upcoming';
 f.innerHTML='<div class="vh-calendar-toolbar"><div><button type="button" data-prev aria-label="Previous month">‹</button><h3 data-month></h3><button type="button" data-next aria-label="Next month">›</button></div><div><button type="button" data-today>Today</button><button type="button" data-add class="vh-calendar-primary">+ Add date</button></div></div><p data-local class="vh-calendar-local"></p><div class="vh-calendar-layout"><section><div class="vh-calendar-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="vh-calendar-grid" role="group" aria-label="Month dates"></div><p class="vh-calendar-legend">● Personal dates <span>● Commitments & breaks</span> <em>● Public calendar listings</em></p></section><section class="vh-calendar-agenda"><div><h3 data-agenda-title>Coming up</h3><button type="button" data-upcoming>Upcoming</button></div><div data-agenda></div></section></div><div class="vh-calendar-footer"><button type="button" data-terms>Term dates & breaks</button><button type="button" data-hidden>Hidden reminders</button><span>Suggested birthdays are fictional and editable. Feb 29 is observed on Feb 28 in other years.</span></div>';
 const personal=()=>link.setupProfile?.personalCalendar||[];
 const entriesOn=date=>{
  const year=Number(date.slice(0,4)),weekday=new Date(date+'T12:00:00Z').getUTCDay(),rows=[];
  for(const r of personal())if(r.enabled!==false&&vhCalendarOccurrence(r,year)===date)rows.push({...r,occursOn:date,category:'personal'});
  const seen=new Set();for(const r of link.setupProfile?.weeklySchedule||[]){
   if((r.days||[]).includes(weekday)&&VHWorldEngine.activeOn(r,date))rows.push({id:'commitment:'+r.id,title:r.activity,occursOn:date,category:'commitment',detail:Math.floor(r.startMinute/60)+':'+String(r.startMinute%60).padStart(2,'0')+' · '+(r.flexibility==='fixed'?'Commitment':'Flexible intention')});
   for(const b of r.breaks||[])if(b.startsOn<=date&&date<=b.endsOn&&!seen.has(b.label+'|'+b.startsOn)){seen.add(b.label+'|'+b.startsOn);rows.push({id:'break:'+b.label+':'+b.startsOn,title:b.label,occursOn:date,category:'commitment',detail:'Break · '+vhCalendarDateLabel(b.startsOn)+'–'+vhCalendarDateLabel(b.endsOn)});}
  }
  for(const r of link.signals?.signals||[])if(r.type==='calendar_event'&&Number.isFinite(r.startsAt)&&Number.isFinite(r.endsAt)&&r.eventStatus!=='cancelled'&&localDate(r.startsAt)<=date&&date<=localDate(r.endsAt-1))rows.push({id:r.id,title:r.title,occursOn:date,category:'public',detail:'Public listing · attendance is not confirmed',sourceUrl:r.sourceUrl});
  return rows;
 };
 const render=()=>{
  f.querySelector('[data-month]').textContent=new Date(month+'-01T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',month:'long',year:'numeric'});
  f.querySelector('[data-local]').textContent=companion.name+'’s local date · '+vhCalendarDateLabel(today)+' · '+(link.travel?.currentContext?.timeZone||companion.timezone||'character time');
  const grid=f.querySelector('.vh-calendar-grid');grid.replaceChildren();const start=new Date(month+'-01T12:00:00Z'),offset=start.getUTCDay(),days=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
  for(let i=0;i<offset;i++)grid.append(document.createElement('span'));
  for(let day=1;day<=days;day++){
   const date=month+'-'+String(day).padStart(2,'0'),entries=entriesOn(date),button=document.createElement('button');button.type='button';button.className='vh-calendar-day';button.dataset.today=String(date===today);button.setAttribute('aria-pressed',String(date===selected));button.setAttribute('aria-label',vhCalendarDateLabel(date)+(entries.length?' · '+entries.map(e=>e.title).join(', '):' · No saved events'));
   const n=document.createElement('span');n.textContent=day;button.append(n);for(const type of ['personal','commitment','public'])if(entries.some(e=>e.category===type)){const mark=document.createElement('i');mark.dataset.category=type;mark.setAttribute('aria-hidden','true');button.append(mark);}
   button.onclick=()=>{view='day';selected=date;render();};grid.append(button);
  }
  let rows=[];
  if(view==='day')rows=entriesOn(selected);
  else if(view==='hidden')rows=personal().filter(r=>r.enabled===false).map(r=>({...r,category:'personal',occursOn:''}));
  else {for(let i=0;i<31;i++){const at=new Date(today+'T12:00:00Z');at.setUTCDate(at.getUTCDate()+i);const date=at.toISOString().slice(0,10);rows.push(...entriesOn(date).filter(r=>r.category!=='commitment'||r.id.startsWith('break:')));}const seen=new Set();rows=rows.filter(r=>!seen.has(r.id)&&seen.add(r.id));}
  const agenda=f.querySelector('[data-agenda]');agenda.replaceChildren();f.querySelector('[data-agenda-title]').textContent=view==='day'?vhCalendarDateLabel(selected):view==='hidden'?'Hidden reminders':'Next 30 days';
  if(!rows.length){const p=document.createElement('p');p.className='vh-calendar-empty';p.textContent=view==='day'?'No saved events for this day. Add a date when something matters.':view==='hidden'?'No hidden reminders.':'No important dates in the next 30 days. Browse the months or add a date.';agenda.append(p);}
  for(const row of rows){const article=document.createElement('article');article.dataset.category=row.category;const h=document.createElement('strong');h.textContent=row.title;const info=document.createElement('p');info.textContent=[row.occursOn&&vhCalendarDateLabel(row.occursOn),row.detail|| (row.recurrence==='yearly'?'Every year':'One-time date'),row.source==='fictional_assumption'?'Suggested fictional date':'',link.calendarAges?.[row.personId]?'Age '+link.calendarAges[row.personId].currentAge+' · '+(link.calendarAges[row.personId].source==='inferred_birth_year'?'birth year inferred from established age/date':'from saved birth date'):''].filter(Boolean).join(' · ');article.append(h,info);if(row.notes){const p=document.createElement('p');p.textContent=row.notes;article.append(p);}if(row.category==='personal'){const b=document.createElement('button');b.type='button';b.textContent=row.enabled===false?'Edit / show reminder':'Edit';b.onclick=()=>vhEditPersonalDate(companion,timeline,row,render);article.append(b);}agenda.append(article);}
 };
 const move=delta=>{const at=new Date(month+'-01T12:00:00Z');at.setUTCMonth(at.getUTCMonth()+delta);month=at.toISOString().slice(0,7);render();};
 f.querySelector('[data-prev]').onclick=()=>move(-1);f.querySelector('[data-next]').onclick=()=>move(1);f.querySelector('[data-today]').onclick=()=>{month=today.slice(0,7);selected=today;view='day';render();};f.querySelector('[data-upcoming]').onclick=()=>{view='upcoming';selected='';render();};f.querySelector('[data-hidden]').onclick=()=>{view='hidden';render();};f.querySelector('[data-add]').onclick=()=>vhEditPersonalDate(companion,timeline,{date:selected||today},render);f.querySelector('[data-terms]').onclick=()=>vhOpenCommitmentCalendar(companion);render();status.textContent='Saved dates are shared with chat and the daily life adviser. Dates create awareness; people still decide what to do.';
 const timer=setInterval(()=>{if(!d.isConnected){clearInterval(timer);return;}today=localDate(link.simAt);render();},30000);d.addEventListener('close',()=>clearInterval(timer),{once:true});
}
function vhEditPersonalDate(companion,timeline,entry={},onSaved=()=>{}){
 const link=timeline.vh2,baseVersion=link.setupVersion||0,rows=safeJsonClone(link.setupProfile?.personalCalendar||[]),prior=rows.find(r=>r.id===entry.id),draft=prior||entry;
 const d=vhProductDialog(prior?'Edit important date':'Add important date','Save a date they know about. A reminder does not force a plan or publish a post.'),f=d.querySelector('form'),status=d.querySelector(':scope > [role=status]');
 f.innerHTML='<label>Title<input name="title" maxlength="160" required placeholder="e.g. Jordan’s birthday"></label><div class="vh-form-columns"><label>Type<select name="kind">'+vhOptions([['birthday','Birthday'],['anniversary','Anniversary'],['milestone','Milestone or deadline'],['holiday','Holiday'],['other','Other important date']],draft.kind||'other')+'</select></label><label>Person<select name="personId">'+vhOptions([['','No specific person'],['self',companion.name],...(link.knownPeople||[]).map(p=>[p.id,p.name])],draft.personId||'')+'</select></label></div><div class="vh-calendar-date-fields"><label>Month<select name="month">'+vhOptions(Array.from({length:12},(_,i)=>[String(i+1).padStart(2,'0'),new Date(Date.UTC(2000,i,1)).toLocaleDateString(undefined,{timeZone:'UTC',month:'long'})]))+'</select></label><label>Day<input name="day" type="number" min="1" max="31" required></label><label>Year <small>(optional for yearly dates)</small><input name="year" type="number" min="1000" max="9999" placeholder="Unknown"></label></div><label class="vh-choice-row"><input name="yearly" type="checkbox">Repeat every year</label><div class="vh-form-columns"><label>Remind them before this date<select name="reminderDays">'+vhOptions([[0,'On the day'],[1,'1 day before'],[3,'3 days before'],[7,'1 week before'],[14,'2 weeks before'],[30,'1 month before']],draft.reminderDays??7)+'</select></label><label>Source<select name="source">'+vhOptions([['authored','Established in their setup'],['fictional_assumption','Suggested fictional date']],draft.source||'authored')+'</select></label></div><label>Notes<textarea name="notes" maxlength="1000" rows="3" placeholder="Why this date matters to them"></textarea></label><label class="vh-choice-row"><input name="enabled" type="checkbox">Show this date and let them remember it</label><div class="vh-calendar-edit-actions"><button type="submit">Save date</button>'+(prior?'<button type="button" data-remove>'+(prior.kind==='birthday'?'Hide birthday':'Delete date')+'</button>':'')+'</div>';
 for(const key of ['title','notes'])f.elements[key].value=draft[key]||'';const parts=(draft.date||'--01-01').split('-');f.elements.month.value=parts.at(-2);f.elements.day.value=Number(parts.at(-1));f.elements.year.value=draft.date?.startsWith('--')?'':parts[0];f.elements.yearly.checked=draft.recurrence==='yearly';f.elements.enabled.checked=draft.enabled!==false;
 const kindChanged=()=>{if(f.elements.kind.value==='birthday'){f.elements.yearly.checked=true;if(!f.elements.personId.value)f.elements.personId.value='self';}f.elements.yearly.disabled=f.elements.kind.value==='birthday';};f.elements.kind.onchange=kindChanged;kindChanged();
 const save=async action=>{const buttons=f.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);status.textContent='Saving date…';try{let next=rows;
  if(action==='remove'){next=prior.kind==='birthday'?rows.map(r=>r.id===prior.id?{...r,enabled:false}:r):rows.filter(r=>r.id!==prior.id);}
  else {const yearly=f.elements.yearly.checked,year=f.elements.year.value;if(!year&&!yearly)throw Error('A one-time date needs a year.');const row={id:prior?.id||'date_'+crypto.randomUUID(),title:f.elements.title.value.trim(),kind:f.elements.kind.value,personId:f.elements.personId.value,date:(year||'-')+'-'+f.elements.month.value+'-'+String(f.elements.day.value).padStart(2,'0'),recurrence:yearly?'yearly':'none',reminderDays:Number(f.elements.reminderDays.value),notes:f.elements.notes.value,source:f.elements.source.value,enabled:f.elements.enabled.checked};next=[...rows.filter(r=>r.id!==row.id),row];}
  const problem=vhPersonalCalendarProblem(next);if(problem)throw Error(problem);
  await vhUiCommand(timeline,'apply_life_proposal',{version:2,baseSetupVersion:baseVersion,proposal:{personalCalendar:next}});
  const saved=link.setupProfile?.personalCalendar||[];if(next.some(r=>!saved.some(s=>s.id===r.id&&Object.keys(r).every(k=>r[k]===s[k])))||action==='remove'&&prior.kind!=='birthday'&&saved.some(r=>r.id===prior.id))throw Error('The date save was not confirmed.');onSaved();d.close();
 }catch(error){status.textContent='Not saved: '+error.message+' Your draft is retained.';}finally{buttons.forEach(b=>b.disabled=false);}};
 f.onsubmit=e=>{e.preventDefault();save('save');};f.querySelector('[data-remove]')?.addEventListener('click',()=>save('remove'));
 if(prior?.source==='fictional_assumption')status.textContent='This birthday was suggested because no date was supplied. Edit it freely; a month/day placeholder does not establish a birth year. A full saved birth date determines current age in this life.';
}

function vhOpenCommitmentCalendar(companion){
 const timeline=getActiveCompanionTimeline(companion.id),link=timeline?.vh2;if(!link)return;
 const rows=link.setupProfile?.weeklySchedule||[];
 const d=vhProductDialog('Commitment calendar','Set term dates and breaks on existing classes, shifts and appointments.'),f=d.querySelector('form'),status=d.querySelector('[role=status]');
 f.innerHTML='<label>Commitment<select name="commitment">'+vhOptions(rows.map(r=>[r.id,r.activity]),rows[0]?.id||'')+'</select></label><p data-current></p><div class="vh-form-columns"><label>First day<input name="startsOn" type="date"></label><label>Last day<input name="endsOn" type="date"></label></div><p>Dates include both days and use the character’s local calendar. Empty dates leave a commitment open-ended.</p><section data-breaks></section><button type="button" data-add-break>+ Add break</button><label>Calendar source or authoring note<input name="calendarSource" maxlength="1000" placeholder="Official calendar URL, or fictional dates"></label><label class="vh-choice-row"><input name="samePlace" type="checkbox">Apply these dates to all commitments at this place</label><p>Breaks suspend these commitments and their attendance penalties. They do not cancel personal plans or establish graduation.</p><button type="submit">Save calendar dates</button>';
 const select=f.elements.commitment;
 const addBreak=(row={})=>{const line=document.createElement('div');line.className='vh-calendar-break';line.innerHTML='<label>Break name<input data-label maxlength="120" required></label><div class="vh-form-columns"><label>From<input data-start type="date" required></label><label>Through<input data-end type="date" required></label></div><button type="button">Remove break</button>';line.querySelector('[data-label]').value=row.label||'';line.querySelector('[data-start]').value=row.startsOn||'';line.querySelector('[data-end]').value=row.endsOn||'';line.querySelector('button').onclick=()=>line.remove();f.querySelector('[data-breaks]').append(line);};
 const fill=()=>{const r=rows.find(x=>x.id===select.value);if(!r)return;for(const key of ['startsOn','endsOn','calendarSource'])f.elements[key].value=r[key]||'';f.querySelector('[data-current]').textContent=(link.travelPlaces||[]).find(p=>p.id===r.placeId)?.label||'No fixed place';f.querySelector('[data-breaks]').replaceChildren();(r.breaks||[]).forEach(addBreak);f.elements.samePlace.checked=false;};
 select.onchange=fill;f.querySelector('[data-add-break]').onclick=()=>{if(f.querySelectorAll('.vh-calendar-break').length<30)addBreak();};fill();
 if(!rows.length){status.textContent='This life has no recurring commitments. The AI builder can propose dated classes or work shifts when appropriate.';f.querySelector('[type=submit]').disabled=true;}
 f.onsubmit=async e=>{e.preventDefault();const selected=rows.find(r=>r.id===select.value);if(!selected)return;const button=f.querySelector('[type=submit]');button.disabled=true;status.textContent='Saving calendar dates…';try{const dates={startsOn:f.elements.startsOn.value,endsOn:f.elements.endsOn.value,calendarSource:f.elements.calendarSource.value,breaks:[...f.querySelectorAll('.vh-calendar-break')].map(r=>({label:r.querySelector('[data-label]').value,startsOn:r.querySelector('[data-start]').value,endsOn:r.querySelector('[data-end]').value}))};if(dates.startsOn&&dates.endsOn&&dates.endsOn<dates.startsOn)throw Error('The last day must follow the first day.');if(dates.breaks.some(r=>r.endsOn<r.startsOn))throw Error('A break cannot end before it starts.');const affected=rows.filter(r=>r.id===selected.id||f.elements.samePlace.checked&&selected.placeId&&r.placeId===selected.placeId);await vhUiCommand(timeline,'apply_life_proposal',{version:2,baseSetupVersion:link.setupVersion||0,proposal:{weeklySchedule:affected.map(r=>({id:r.id,...dates}))}});for(const r of affected){const saved=link.setupProfile.weeklySchedule.find(s=>s.id===r.id);if(saved?.startsOn!==dates.startsOn||saved?.endsOn!==dates.endsOn||saved?.breaks?.length!==dates.breaks.length||dates.breaks.some((b,i)=>['label','startsOn','endsOn'].some(k=>saved.breaks[i][k]!==b[k])))throw Error('Calendar save was not confirmed.');Object.assign(r,dates);}status.textContent='Saved to this life · '+affected.length+' commitment'+(affected.length===1?'':'s')+' updated.';button.textContent='Save calendar dates';}catch(error){status.textContent='Not saved: '+error.message+' Your draft is retained.';}finally{button.disabled=false;}};
}
