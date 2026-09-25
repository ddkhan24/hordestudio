'use strict';
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
(async()=>{
 const server=spawn('python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
 try{
  const port=await new Promise((resolve,reject)=>{server.stdout.once('data',data=>resolve(Number(String(data).trim())));server.once('exit',code=>reject(Error('Server exit '+code)));server.stderr.on('data',data=>process.stderr.write(data));});
  const base=`http://127.0.0.1:${port}`;browser=await chromium.launch(launchOptions);
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  await page.evaluate(base=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);mcpBridgeBase=()=>base;
   state.globalSettings.localBaseUrl=base+'/test';state.globalSettings.localApiKey='LOCAL_TEST_KEY';state.globalSettings.apiProvider='local';state.globalSettings.defaultModel='browser-fixture';
   const companion=normalizeCompanion({id:'latency-alex',name:'Alex',age:28,textProvider:'local',model:'browser-fixture',allowPhotos:true,locationMode:'custom',timezoneOffsetMinutes:0,lifeProfile:{initializedAt:1788764400000,places:[{id:'home',label:'Home',kind:'home'}],weeklySchedule:[],sleepPolicy:{enabled:false},socialCircle:[],world:{transport:{enabled:false},people:[]}}});
   state.companions=[companion];state.companionTimelines={};state.companionThreads={};state.activeCompanionId=companion.id;ensureCompanionTimelineStore(companion.id);switchView('companionChat');renderCompanionThread();
  },base);
  await page.evaluate(()=>vh2CreateTimeline(getCompanion('latency-alex')));
  await page.waitForFunction(()=>getActiveCompanionTimeline('latency-alex')?.vh2?.running===true);
  await page.evaluate(()=>{
   const timeline=getActiveCompanionTimeline('latency-alex'),now=Date.now()-2000*60000;
   timeline.messages=Array.from({length:1200},(_,index)=>normalizeCompanionMessage({id:'old-'+index,role:index%2?'companion':'user',text:'Earlier conversation '+index,timestamp:now+index*60000,deliveryState:'delivered'}));
   state.companionThreads['latency-alex']=timeline.messages;renderCompanionThread();
  });
  let delayed=false;
  await page.route('**/vh2/projection?**',async route=>{if(!delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,1800));}await route.continue();});
  await page.locator('#companion-composer-input').fill('Hello after a very long conversation.');
  const elapsed=await page.evaluate(async()=>{const start=performance.now();await handleCompanionSend();return performance.now()-start;});
  assert(elapsed<900,`send handler waited ${Math.round(elapsed)}ms for background projection`);
  assert.match(await page.locator('#companion-messages').innerText(),/Hello after a very long conversation/);
  assert((await page.locator('#companion-messages [data-message-id]').count())>=1201,'long transcript remained incrementally rendered');
  for(let index=0;index<12;index++){
   await fetch(base+'/test/tick',{method:'POST'});await new Promise(resolve=>setTimeout(resolve,1100));
   await page.evaluate(()=>vh2Poll(getCompanion('latency-alex'),undefined,{lightweight:true}));
   if(await page.getByText('Local mock model reply',{exact:true}).count())break;
  }
  assert.equal(await page.getByText('Local mock model reply',{exact:true}).count(),1,'reply eventually reconciled once');
  assert.deepEqual(errors,[]);
  console.log('VH2 long-chat foreground audit passed');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
