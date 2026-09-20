'use strict';
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
const mind=require('../virtual_humans/engine/vh-mind-engine');
const kernel=require('../virtual_humans/engine/vh2-kernel-worker');

// Pure mechanics: archetypes mix, clinical modules remain separate, exact cues
// have cooldowns, and adult cues are gated independently from personality.
let profile=mind.addPreset({},'possessive_fixation',100);
profile=mind.addPreset(profile,'stalker_pattern',55);
assert(mind.resolvedAxes(profile).fixation>=90);
assert.equal(mind.PRESETS.possessive_fixation.clinical,false);
assert.equal(mind.PRESETS.psychosis_lived_experience.clinical,true);
assert(Object.keys(mind.PRESETS).length>=70,'Expanded library should contain at least 70 composable modules.');
assert(mind.searchPresets('gooner').some(item=>item.id==='porn_compulsive_pattern'));
assert(mind.searchPresets('tweaker').some(item=>item.id==='meth_stimulant_use'));
assert(mind.searchPresets('nipple').some(item=>item.id==='nipple_stimulation_interest'));
let event=mind.evaluate(profile,{},'I am seeing someone else and I need space.',{now:1000,inputId:'m1',age:26,libidoEnabled:false});
assert.deepEqual(new Set(event.matched.map(item=>item.effect)),new Set(['jealousy','fixation']));
assert.equal(mind.evaluate(profile,event.runtime,'I am seeing someone else and I need space.',{now:1001,inputId:'m1',age:26,libidoEnabled:false}).matched.length,0);
const adult=mind.addPreset({},'honorific_arousal',100);
assert.equal(mind.evaluate(adult,{},'come here, mommy',{now:2000,inputId:'a',age:26,libidoEnabled:false}).matched.length,0);
assert.equal(mind.evaluate(adult,{},'come here, mommy',{now:2000,inputId:'b',age:26,libidoEnabled:true}).matched[0].effect,'arousal');
assert.match(mind.prompt(profile,event.runtime,{now:1000}),/not a command/i);
let composite={};for(const id of ['stalker_pattern','nipple_stimulation_interest','porn_compulsive_pattern','masturbation_compulsive_pattern','inhalant_solvent_use','lives_alone','friendless_isolation','shut_in','commercial_sex_patron'])composite=mind.addPreset(composite,id,80);
const compositeContext={now:3000,age:28,libidoEnabled:true},snapshot=mind.contextSnapshot(composite,{},compositeContext);
assert.equal(snapshot.modules.length,9);assert(snapshot.modules.every(item=>item.active));
assert(mind.activityScore(composite,{kind:'leisure',label:'Visit the brothel'},compositeContext)>30);
assert(mind.activityScore(composite,{kind:'focus',label:'Finish ordinary paperwork'},compositeContext)<0);
assert(Math.abs(mind.activityScore(composite,{kind:'leisure',label:'Visit the brothel'},{...compositeContext,libidoEnabled:false})-(mind.mechanics(composite,{}, {...compositeContext,libidoEnabled:false}).activityBias.leisure||0))<1e-9,'Adult term biases stay inactive when adult desire is disabled.');
assert.match(mind.prompt(composite,{},compositeContext),/Nipple-stimulation interest/);
assert.equal(mind.evaluate(mind.addPreset({},'nipple_stimulation_interest',100),{},'touch your nipples',{now:3000,inputId:'n0',age:28,libidoEnabled:false}).matched.length,0);
assert.equal(mind.evaluate(mind.addPreset({},'nipple_stimulation_interest',100),{},'touch your nipples',{now:3000,inputId:'n1',age:28,libidoEnabled:true}).matched[0].effect,'arousal');

// VH2 imports the authored mind and applies the same provider-free trigger.
const now=Date.parse('2026-09-20T12:00:00Z');
const created=kernel.run({create:true,name:'Mara',entityId:'mind-kernel',now,profile:{age:26,libidoEnabled:true,mindProfile:adult,lifeProfile:{places:[{id:'home',label:'Home',kind:'home'}],weeklySchedule:[],activityOptions:[],sleepPolicy:{enabled:false}}}}).companion;
let communication={personaId:'player:mind-kernel',messages:[{id:'kernel-message',role:'user',type:'text',text:'come here, mommy',timestamp:now,deliveredAt:now,readAt:0,awaitingReply:true}]},simulated=created,at=now;
for(let step=0;step<12&&!simulated.mindRuntime?.activePressures?.length;step++){
 const result=kernel.run({companion:simulated,communication,now:at,inspect:true});simulated=result.companion;communication=result.communication;at=Math.max(at+60000,Number(communication.nextAt)||0);
}
assert(simulated.mindRuntime.activePressures.some(item=>item.effect==='arousal'));
assert(simulated.humanDynamics.sexualArousal>0);
assert(simulated.mindContext.modules.some(item=>item.id==='honorific_arousal'&&item.active));

// Authored modules also change provider-free life decisions, not only prose.
let actionHuman=kernel.run({create:true,name:'Rin',entityId:'mind-action',now,profile:{age:28,libidoEnabled:true,mindProfile:mind.addPreset({},'porn_compulsive_pattern',100),lifeProfile:{places:[{id:'home',label:'Home',kind:'home'}],weeklySchedule:[],activityOptions:[{id:'porn',label:'Browse porn',kind:'leisure',startMinute:0,endMinute:1440,priority:30,durationMinutes:30},{id:'paper',label:'Finish paperwork',kind:'focus',startMinute:0,endMinute:1440,priority:30,durationMinutes:30}],sleepPolicy:{enabled:false}}}}).companion;
for(let step=1;step<=3&&!actionHuman.vh2Decision?.choice;step++)actionHuman=kernel.run({companion:actionHuman,now:now+step*60000}).companion;
const actionCandidates=actionHuman.vh2Decision.choice.candidates;
assert(actionCandidates.find(item=>item.id.includes(':porn:')).components.mind>0);
assert(actionCandidates.find(item=>item.id.includes(':paper:')).components.mind<0);
assert(actionHuman.vh2Decision.choice.goalId.includes(':porn:'),'Mind activity bias must reach actual VH2 choice scoring.');

(async()=>{const server=spawn(process.env.HORDE_PYTHON_EXECUTABLE||'python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
try{
 const port=await new Promise((resolve,reject)=>{server.stdout.once('data',data=>resolve(+String(data).trim()));server.stderr.on('data',data=>process.stderr.write(data));server.once('exit',code=>reject(Error('server '+code)));});
 const base=`http://127.0.0.1:${port}`;browser=await chromium.launch(launchOptions);const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base+'/index.html');await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
 const id=await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);hideGlobalSettings();const c=normalizeCompanion({id:'mind-ui',name:'Mara',age:26,personality:'Possessive and watchful.'});state.companions=[c];state.companionTimelines={};state.companionThreads={};ensureCompanionTimelineStore(c.id);openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-mind');return c.id;});
 assert(await page.locator('.vh-mind-studio').isVisible());
 const countText=await page.locator('#cs-mind-library-count').innerText();assert.match(countText,/\d+/,`Library count should render; page errors: ${errors.join(' | ')}`);assert(Number(countText.match(/\d+/)[0])>=70);
 const search=page.locator('#cs-mind-library-search'),add=async(id,query)=>{await search.fill(query);await page.locator(`[data-mind-library="${id}"] [data-mind-library-add]`).click();};
 await search.fill('gooner');assert(await page.locator('[data-mind-library="porn_compulsive_pattern"]').isVisible());
 await search.fill('tweaker');assert(await page.locator('[data-mind-library="meth_stimulant_use"]').isVisible());
 await search.fill('nipple');assert(await page.locator('[data-mind-library="nipple_stimulation_interest"]').isVisible());
 await search.fill('');await page.locator('#cs-mind-library-category').selectOption('adult interest');assert((await page.locator('[data-mind-library]').count())>=10);await page.locator('#cs-mind-library-sort').selectOption('a-z');const labels=await page.locator('.vh-mind-library-card strong').allTextContents();assert.deepEqual(labels,[...labels].sort((a,b)=>a.localeCompare(b)),'A–Z sorting is deterministic.');await page.locator('#cs-mind-library-category').selectOption('all');const scrollable=await page.locator('#cs-mind-library-results').evaluate(node=>{const before=node.scrollTop;node.scrollTop=160;return {overflow:getComputedStyle(node).overflowY,before,after:node.scrollTop,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight};});assert(scrollable.scrollHeight>scrollable.clientHeight&&scrollable.after>scrollable.before&&/auto|scroll/.test(scrollable.overflow),'Large library must actually scroll: '+JSON.stringify(scrollable));
 await add('possessive_fixation','yandere');
 await add('stalker_pattern','stalker');
 assert.equal(await page.locator('[data-mind-module]').count(),2);
 assert.match(await page.locator('#cs-mind-summary').innerText(),/2 configured modules/i);
 const slider=page.locator('[data-mind-intensity="possessive_fixation"]');await slider.fill('92');assert.equal(await slider.inputValue(),'92');
 await page.locator('.vh-mind-advanced').first().click();const fixation=page.locator('[data-mind-axis="fixation"]');assert(Number(await fixation.inputValue())>=80);
 await fixation.fill('73');assert.match(await page.locator('[data-mind-axis-row="fixation"] span').innerText(),/manual/);
 await page.locator('.vh-mind-advanced').nth(1).click();
 await page.locator('#cs-mind-trigger-label').fill('Comparison with an ex');await page.locator('#cs-mind-trigger-cues').fill('my ex, better than you');await page.locator('#cs-mind-trigger-effect').selectOption('jealousy');await page.locator('#cs-mind-trigger-expression').fill('probe, go cold, confront, or resist');await page.locator('#cs-mind-trigger-add').click();assert.equal(await page.locator('.vh-mind-trigger-card').count(),1);
 await add('honorific_arousal','mommy');assert.match(await page.locator('#cs-mind-summary').innerText(),/waiting for Adult desire/i);
 await page.locator('.vh-authoring-extra summary').filter({hasText:'Adult intimacy, desire & boundaries'}).click();
 await page.locator('#cs-libido-enabled').check();assert.match(await page.locator('#cs-mind-summary').innerText(),/adult cue active/i);
 assert.match(await page.locator('#cs-mind-preset-note').innerText(),/separate categories/i);
 await page.locator('#save-companion-btn').click();await page.waitForFunction(()=>document.getElementById('vh-save-status').textContent.startsWith('Saved'));
 await page.reload();await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);await page.evaluate(id=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);hideGlobalSettings();openCompanionStudio(id);switchView('companionStudio');activateCompanionStudioTab('cs-mind');},id);
 assert.equal(await page.locator('[data-mind-module]').count(),3,'Preset mix persists after reload.');assert.equal(await page.locator('.vh-mind-trigger-card').count(),1,'Custom cue persists after reload.');
 await page.evaluate(id=>{const c=getCompanion(id);state.activeCompanionId=id;companionApplyMindCues(c,{id:'mind-diagnostic-message',text:'My ex was better than you.'},Date.now());openCompanionSimulationDetails();document.querySelector('[data-sim-tab="feelings"]')?.click();},id);
 assert.match(await page.locator('[data-mind-diagnostics]').innerText(),/Comparison with an ex/);assert.match(await page.locator('[data-mind-diagnostics]').innerText(),/jealousy/i);
 const initiative=await page.evaluate(id=>{const source=getCompanion(id),anchor=Date.now(),copy=value=>JSON.parse(JSON.stringify(value));const tuned=copy(source),baseline=copy(source),clinical=copy(source);tuned.initiativeMode=baseline.initiativeMode=clinical.initiativeMode='balanced';baseline.mindProfile={version:1,enabled:false,presetMix:[],axes:{},triggers:[]};baseline.mindRuntime={};clinical.mindProfile=VHMindEngine.addPreset({},'psychosis_lived_experience',100);clinical.mindRuntime={};return {tuned:companionInitiativeDelayMs(tuned,anchor),baseline:companionInitiativeDelayMs(baseline,anchor),clinical:companionInitiativeDelayMs(clinical,anchor),pressures:companionDecisionPressures(tuned,anchor),reason:companionMindInitiativeReason(tuned,anchor)};},id);
 assert(initiative.tuned<initiative.baseline,'Authored pursuit mechanics can increase proactive-contact cadence.');
 assert.equal(initiative.clinical,initiative.baseline,'A clinical preset does not become a pursuit mechanic.');
 assert(initiative.pressures.some(item=>/Comparison with an ex/.test(item)));assert.match(initiative.reason,/Acting on it is still a choice/i);
 await page.locator('#close-companion-simulation-btn').click();
 await page.setViewportSize({width:1040,height:800});await search.fill('stalker');const medium=await page.locator('.vh-mind-studio').evaluate(section=>{const box=section.getBoundingClientRect(),button=section.querySelector('[data-mind-library-add]').getBoundingClientRect(),results=section.querySelector('.vh-mind-library-results');return {scroll:section.scrollWidth,client:section.clientWidth,buttonRight:button.right,sectionRight:box.right,resultsScroll:results.scrollHeight,resultsClient:results.clientHeight};});assert(medium.scroll<=medium.client+1&&medium.buttonRight<=medium.sectionRight+1,'Mind library action stays inside the editor at intermediate width: '+JSON.stringify(medium));assert(medium.resultsClient>0,'Library remains scrollable and visible.');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Mind editor has no mobile horizontal overflow.');
 assert.deepEqual(errors,[]);console.log('PASS mind architecture: mixed archetypes, separate clinical semantics, exact cue pressure, adult gate, VH2 mechanics, editor persistence and responsive layout.');
}finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
