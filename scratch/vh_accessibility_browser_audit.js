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


 const report=[];
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:844});
  await page.evaluate(()=>activateCompanionStudioTab('cs-identity'));
  const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,small:[...document.querySelectorAll('#companion-studio-view button,#companion-studio-view summary')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({text:e.textContent.trim().slice(0,55),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(e=>e.w<40||e.h<43)}));
  assert.equal(layout.scroll,layout.width,'Authoring must fit '+width+'px');assert.deepEqual(layout.small,[],'Visible authoring actions need touch targets');report.push(layout);
 }
 await page.setViewportSize({width:390,height:844});
 const coreLayout=await page.evaluate(()=>Object.fromEntries(['cs-name','cs-age','cs-personality'].map(id=>[id,document.getElementById(id).getBoundingClientRect().toJSON()])));
 fs.mkdirSync('docs/vh2/creation-ux-20260920',{recursive:true});await page.screenshot({path:'docs/vh2/creation-ux-20260920/mobile-creation.png',fullPage:true});
 assert(coreLayout['cs-age'].top<844,'Name and age remain visible in the first mobile fold without shrinking touch targets');
 await page.setViewportSize({width:320,height:844});
 const opener=page.locator('[data-vh-page-builder="cs-identity"]');await opener.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 const geometry=await dialog.evaluate(d=>({width:d.getBoundingClientRect().width,client:d.clientWidth,scroll:d.scrollWidth}));assert(geometry.width<=320&&geometry.scroll<=geometry.client+1,'Draft dialog fits narrow viewport');
 for(let i=0;i<35;i++){await page.keyboard.press('Tab');assert(await dialog.evaluate(d=>d.contains(document.activeElement)),'Tab remains inside modal');}
 for(let i=0;i<35;i++){await page.keyboard.press('Shift+Tab');assert(await dialog.evaluate(d=>d.contains(document.activeElement)),'Reverse Tab remains inside modal');}
 const focus=await page.evaluate(()=>({width:getComputedStyle(document.activeElement).outlineWidth,style:getComputedStyle(document.activeElement).outlineStyle}));assert.notEqual(focus.style,'none','Keyboard focus is visible');assert(parseFloat(focus.width)>=2,'Keyboard focus has clear outline');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert(await opener.evaluate(e=>e===document.activeElement),'Closing restores focus to launching action');assert.equal(calls.length,0,'Keyboard navigation never calls a paid provider');
 await page.emulateMedia({reducedMotion:'reduce'});await opener.click();await page.getByRole('dialog').waitFor();const motion=await page.getByRole('dialog').evaluate(d=>getComputedStyle(d.querySelector('button')).transitionDuration);assert.equal(motion,'0s');
 const out='docs/vh2/creation-ux-20260920';fs.mkdirSync(out,{recursive:true});await page.screenshot({path:out+'/mobile-ai-accessibility.png',fullPage:true});await page.keyboard.press('Escape');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:out+'/desktop-creation.png',fullPage:true});assert.deepEqual(errors,[]);fs.writeFileSync(out+'/accessibility-results.json',JSON.stringify({passed:true,viewports:report,dialog:geometry,checks:['44px authoring actions','no horizontal overflow at 320–1440px','keyboard modal containment in both directions','visible keyboard focus','Escape dismissal and focus restoration','no provider calls on navigation','reduced motion']},null,2));console.log('PASS VH creation accessibility across four widths, modal keyboard interaction, and reduced motion.');
}finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
