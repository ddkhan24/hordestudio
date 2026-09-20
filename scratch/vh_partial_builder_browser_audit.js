'use strict';
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
(async()=>{const server=spawn(process.env.HORDE_PYTHON_EXECUTABLE||'python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
try{
 const port=await new Promise((resolve,reject)=>{server.stdout.once('data',d=>resolve(+String(d).trim()));server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>reject(Error('server '+c)));});const base=`http://127.0.0.1:${port}`;
 browser=await chromium.launch(launchOptions);const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],calls=[];let failOccupation=true,delay=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const url=r.request().url();if(url===base+'/test/chat/completions'){
  const body=r.request().postDataJSON(),data=JSON.parse(body.messages[1].content);if(data.field)calls.push({body,data});
  if(delay)await new Promise(resolve=>setTimeout(resolve,1200));
  if(data.field==='occupation'&&failOccupation){failOccupation=false;return r.fulfill({status:503,body:'fixture failure'});}
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Reviewed '+data.field+' fixture'}}]})});
 }return url.startsWith(base)?r.continue():r.abort();});
 await page.goto(base+'/index.html');await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
 await page.evaluate(base=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);mcpBridgeBase=()=>base;state.globalSettings.localBaseUrl=base+'/test';state.globalSettings.localApiKey='LOCAL_TEST_KEY';state.globalSettings.apiProvider='local';state.globalSettings.defaultModel='browser-fixture';
 const c=normalizeCompanion({id:'page-draft-fixture',name:'Alex',age:28,personality:'An isolated fantasy archivist.',backstory:'Preserve this authored history.',appearance:'',occupation:'',textProvider:'local',model:'browser-fixture'});state.companions=[c];state.activeCompanionId=c.id;state.companionTimelines={};state.companionThreads={};ensureCompanionTimelineStore(c.id);hideGlobalSettings();openCompanionStudio(c.id);switchView('companionStudio');},base);

 await page.evaluate(()=>{window.fixtureStageCalls=[];window.originalComplete=completeCompanionLifeDraftSections;window.stageFails=true;completeCompanionLifeDraftSections=async(c,d,o)=>{const key=o.requiredSections[0];fixtureStageCalls.push(key);if(key==='wardrobe'&&stageFails)return {draft:d,repairWarning:'Fixture provider unavailable.'};return {draft:{...d,[key]:key==='socialCircle'?[]:[{id:'robe',label:'Archivist robe',context:'home',items:'Dark wool robe, leather boots.'}]},repairWarning:''};};void vhGenerateEssentials(getCompanion('page-draft-fixture'),['socialCircle','wardrobe']);});
 let partial=page.getByRole('dialog',{name:'Generate life essentials',exact:true});await partial.getByText(/1 completed section/).waitFor();
 assert.equal(await partial.getByRole('button',{name:'Review completed sections'}).count(),1);await page.evaluate(()=>window.stageFails=false);await partial.getByRole('button',{name:'Retry missing sections (1)'}).click();
 let review=page.getByRole('dialog',{name:'Review life changes',exact:true});await review.waitFor();
 assert.deepEqual(await page.evaluate(()=>fixtureStageCalls),['socialCircle','wardrobe','wardrobe']);assert.equal(await page.evaluate(()=>getCompanion('page-draft-fixture').lifeProfile.socialCircle.length),0);await review.locator('[data-close]').click();
 await page.evaluate(()=>{completeCompanionLifeDraftSections=originalComplete;activateCompanionStudioTab('cs-chat-style');});
 const long='Voice '.repeat(100);await page.locator('#cs-texting-style').fill(long);assert.equal(await page.locator('#cs-texting-style').inputValue(),long);
 await page.locator('#save-companion-btn').click();await page.getByText(/Writing voice has 600 characters/).waitFor();assert.equal(await page.locator('#cs-texting-style').inputValue(),long,'validation preserves full paste');
 await page.locator('#cs-texting-style').fill('Deliberate and spare.');await page.locator('#save-companion-btn').click();await page.waitForFunction(()=>document.getElementById('vh-save-status').textContent.startsWith('Saved'));
 assert.deepEqual(errors,[]);console.log('PASS partial life draft retained, retries only missing sections, review before apply, visible length validation preserves paste and allows correction.');
}finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
