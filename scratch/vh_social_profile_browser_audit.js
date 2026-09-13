'use strict';
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
(async()=>{
 const server=spawn('python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
 try{
  const port=await new Promise((resolve,reject)=>{server.stdout.once('data',d=>resolve(+String(d).trim()));server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',code=>reject(Error('Fixture server '+code)));});const base='http://127.0.0.1:'+port;
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)||r.request().url().startsWith('blob:')?r.continue():r.abort());
  await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  await page.evaluate(base=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);mcpBridgeBase=()=>base;
   state.globalSettings.localBaseUrl=base+'/test';state.globalSettings.localApiKey='LOCAL_TEST_KEY';state.globalSettings.apiProvider='local';state.globalSettings.defaultModel='browser-fixture';
   // Native canvas fixtures test portrait/landscape layout without generating or fetching media.
   const art=(w,h)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d'),g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#e7bd9d');g.addColorStop(.55,'#b67c73');g.addColorStop(1,'#283d4c');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);ctx.fillStyle='#f1d6b0';ctx.beginPath();ctx.arc(w*.68,h*.28,w*.17,0,Math.PI*2);ctx.fill();ctx.fillStyle='#283f4b';ctx.beginPath();ctx.moveTo(0,h*.64);ctx.bezierCurveTo(w*.4,h*.45,w*.4,h*.95,w,h*.57);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();return canvas.toDataURL('image/png');};
   state.personas=[{id:'lena',name:'Lena',text:'A friend.'}];state.activePersonaId='lena';
   const c=normalizeCompanion({id:'social-design-fixture',name:'Mira Chen',age:27,textProvider:'local',model:'browser-fixture',profilePhoto:art(100,100),socialFeedEnabled:true,lifeProfile:{sleepPolicy:{enabled:false}},startingSocialPosts:[{id:'morning',kind:'photo',text:'Took the long way home. Worth it.',photo:art(640,480),seedAgeDays:1},{id:'thought',kind:'status',text:'a slow morning, coffee, and absolutely no plans. needed this.',seedAgeDays:2},{id:'weekend',kind:'photo',text:'Keeping a little of this weekend with me.',photo:art(480,640),seedAgeDays:3}]});
   state.companions=[c];state.activeCompanionId=c.id;state.companionTimelines={};state.companionThreads={};ensureCompanionTimelineStore(c.id);hideGlobalSettings();switchView('companionChat');renderCompanionThread();
  },base);
  await page.evaluate(async()=>{const c=getCompanion('social-design-fixture');await vh2CreateTimeline(c);await vhUiCommand(getActiveCompanionTimeline(c.id),'set_running',{running:false});companionSocialTab='feed';companionSocialPanelVisibility.set(companionSocialPanelKey(c),true);renderCompanionSocialPanel(c);});
  await page.locator('.vh-feed-photo img').first().waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.vh-feed-photo img')].every(i=>i.complete&&i.naturalWidth));
  assert.equal(await page.locator('[data-social-post]').count(),3);
  await page.locator('.vh-feed-like').first().click();await page.locator('.vh-feed-like.is-liked').waitFor();
  await page.locator('.vh-feed-actions [aria-label="Comment on post"]').first().click();await page.locator('.vh-feed-comments[open] input').fill('That light is beautiful.');
  await page.evaluate(()=>renderCompanionSocialPanel(getCompanion('social-design-fixture')));
  assert(await page.locator('.vh-feed-comments[open] input').evaluate(i=>i===document.activeElement&&i.value==='That light is beautiful.'));
  await page.locator('.vh-feed-comments[open] form button').click();await page.getByText('That light is beautiful.',{exact:false}).waitFor();
  await page.evaluate(async()=>{const c=getCompanion('social-design-fixture');c.startingSocialPosts[0].text='Took the long way home. Would do it again.';await vh2ImportStarterProfile(c);await vh2ImportStarterProfile(c);});
  assert.equal(await page.locator('[data-social-post]').count(),3);assert.equal(await page.locator('.vh-feed-like.is-liked').count(),1);assert.match(await page.locator('.vh-feed-caption').first().textContent(),/Would do it again/);
  assert.match(await page.locator('.vh-feed-comments').first().textContent(),/That light is beautiful/);
  await page.locator('.vh-feed-photo').first().click();await page.getByRole('dialog',{name:'Full photo'}).waitFor();await page.getByRole('button',{name:'Close photo',exact:true}).click();
  await page.evaluate(()=>{document.querySelectorAll('.toast').forEach(n=>n.remove());document.querySelector('.vh-feed-comments').open=false;document.getElementById('companion-social-content').scrollTop=0;});await page.mouse.move(5,5);
  await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(), 'vh-social-profile-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(), 'vh-social-profile-mobile.png')});
  assert(await page.evaluate(()=>document.getElementById('companion-social-panel').scrollWidth<=390));
  const ratios=await page.locator('.vh-feed-photo img').evaluateAll(images=>images.map(i=>({natural:i.naturalWidth/i.naturalHeight,display:i.getBoundingClientRect().width/i.getBoundingClientRect().height})));
  for(const r of ratios)assert(Math.abs(r.natural-r.display)<.01,'Image aspect ratio must remain uncropped');
  await page.evaluate(()=>{companionSocialTab='gallery';renderCompanionSocialPanel(getCompanion('social-design-fixture'));});assert.equal(await page.locator('.vh-gallery-ready img').count(),2);
  assert.deepEqual(errors,[]);console.log('PASS repeated starter updates retain 3 posts, image identity, likes and comments; responsive feed, comment submission, lightbox and uncropped portrait/landscape media. No external providers.');
 }finally{await browser?.close();server.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
