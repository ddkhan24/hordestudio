'use strict';
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();

(async()=>{const server=spawn(process.env.HORDE_PYTHON_EXECUTABLE||'python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
try{
 const port=await new Promise((resolve,reject)=>{server.stdout.once('data',data=>resolve(+String(data).trim()));server.stderr.on('data',data=>process.stderr.write(data));server.once('exit',code=>reject(Error('server '+code)));});
 const base=`http://127.0.0.1:${port}`;browser=await chromium.launch(launchOptions);const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],providerCalls=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=route.request().url();if(url.includes('/chat/completions')){providerCalls.push(url);return route.abort();}return url.startsWith(base)?route.continue():route.abort();});
 await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
 const id=await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);hideGlobalSettings();const c=normalizeCompanion({id:'authored-opener',name:'Mara',age:24,personality:'Possessive, watchful, and theatrically calm.',behaviorExamples:'When jealous, she becomes exact and unnervingly polite.',initiativeMode:'off'});state.companions=[c];state.activeCompanionId=c.id;state.editingCompanionId=c.id;state.companionTimelines={};state.companionThreads={};ensureCompanionTimelineStore(c.id);openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-mind');return c.id;});
 assert.equal(await page.locator('#cs-opening-mode').inputValue(),'player_first','Player-first is the default.');
 assert.equal(await page.locator('#cs-opening-message-wrap').isHidden(),true,'Optional opening text stays hidden for player-first.');
 await page.locator('#cs-opening-mode').selectOption('vh_first');assert.equal(await page.locator('#cs-opening-message-wrap').isVisible(),true,'VH-first reveals the exact message field.');
 assert.match(await page.locator('[data-vh-field-help="openingMessage"]').getAttribute('data-help'),/exact first text/i,'The field explains its exact, one-time role.');
 assert.match(await page.evaluate(()=>vhAuthoringFieldProblem()),/Write the opening message/,'VH-first cannot silently save an empty opener.');
 const exact='you took 11 minutes to answer last time. I counted.';await page.locator('#cs-opening-message').fill(exact);
 assert.equal(await page.evaluate(()=>vhAuthoringFieldProblem()),'');await page.locator('#save-companion-btn').click();await page.waitForFunction(()=>document.getElementById('vh-save-status').textContent.startsWith('Saved'));
 providerCalls.length=0;await page.evaluate(()=>{state.activeCompanionId='authored-opener';switchView('companionChat');});await page.waitForFunction(()=>state.view==='companionChat');
 assert.deepEqual(await page.evaluate(()=>getCompanionThread('authored-opener').filter(m=>m.role==='companion').map(m=>m.text)),[exact],'The authored opener is delivered verbatim once.');
 const statusSnapshot=await page.evaluate(()=>({status:document.getElementById('cc-status').textContent,agency:document.getElementById('cc-agency-status').textContent,contact:companionContactHistory(getCompanion('authored-opener'),getCompanionThread('authored-opener'))}));assert.equal(statusSnapshot.status,'message sent · waiting for your reply',JSON.stringify(statusSnapshot));assert.equal(statusSnapshot.agency.includes('waiting for your reply'),true,JSON.stringify(statusSnapshot));
 assert.equal(providerCalls.length,0,'Authored opening does not call a text provider.');
 await page.evaluate(async()=>{renderCompanionThread();renderCompanionThread();await saveState();});assert.equal(await page.evaluate(()=>getCompanionThread('authored-opener').filter(m=>m.role==='companion').length),1,'Renders do not duplicate the opener.');
 await page.reload();await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);await page.evaluate(id=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);state.activeCompanionId=id;switchView('companionChat');},id);
 assert.deepEqual(await page.evaluate(()=>getCompanionThread('authored-opener').filter(m=>m.role==='companion').map(m=>m.text)),[exact],'Reload does not duplicate the opener.');
 await page.evaluate(()=>{const c=getCompanion('authored-opener'),messages=getCompanionThread(c.id);messages.length=0;renderCompanionThread();});assert.equal(await page.evaluate(()=>getCompanionThread('authored-opener').length),0,'Clearing an established chat does not replay the authored opener.');
 await page.evaluate(()=>{const c=getCompanion('authored-opener');c.openingMode='player_first';c.openingMessage='';c.continuityRuntime.originScenarioConsumedAt=0;renderCompanionThread();});assert.equal(await page.evaluate(()=>getCompanionThread('authored-opener').length),0,'Player-first never injects a message.');
 assert.equal(providerCalls.length,0);assert.deepEqual(errors,[]);console.log('PASS optional authored opening: player-first default, VH-first exact once, zero provider calls, reload/clear idempotence, truthful status.');
}finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
