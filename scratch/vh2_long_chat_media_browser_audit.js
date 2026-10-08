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
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  let scroll=await page.locator('#companion-messages').evaluate(element=>({top:element.scrollTop,height:element.scrollHeight,client:element.clientHeight}));
  assert(scroll.height-scroll.top-scroll.client<4,'opening a long chat lands on its newest message');
  const layout=await page.locator('#companion-messages .companion-message-entry').evaluateAll(entries=>({
   display:getComputedStyle(entries[0]).display,
   maxGap:Math.max(...entries.slice(1).map((entry,index)=>entry.getBoundingClientRect().top-entries[index].getBoundingClientRect().bottom))
  }));
  assert.equal(layout.display,'block','message groups own stable layout boxes');
  assert(layout.maxGap<80,`transcript developed a ${Math.round(layout.maxGap)}px phantom gap`);
  const identityAudit=await page.evaluate(()=>{
   const first=normalizeCompanionMessage({role:'user',text:'same short message'});
   const second=normalizeCompanionMessage({role:'user',text:'same short message'});
   const repaired=normalizeCompanionTimeline({messages:[{id:'legacy-collision',role:'user',text:'same short message'},{id:'legacy-collision',role:'user',text:'same short message'}]},getCompanion('latency-alex'));
   return {newIds:[first.id,second.id],restoredIds:repaired.messages.map(message=>message.id)};
  });
  assert.notEqual(identityAudit.newIds[0],identityAudit.newIds[1],'repeated user text creates distinct message IDs');
  assert.notEqual(identityAudit.restoredIds[0],identityAudit.restoredIds[1],'older saved chats retain both messages while repairing collided IDs');
  const duplicateRender=await page.evaluate(()=>{
   const timeline=getActiveCompanionTimeline('latency-alex'),container=document.getElementById('companion-messages');
   timeline.messages.push({...timeline.messages[600]});
   renderCompanionThread();renderCompanionThread();
   const during={rows:container.querySelectorAll('.companion-message-entry').length,sameId:container.querySelectorAll('[data-message-id="old-600"]').length};
   timeline.messages.pop();
   container.append(container.querySelector('[data-message-id="old-600"]').cloneNode(true));
   renderCompanionThread();
   return {during,after:{rows:container.querySelectorAll('.companion-message-entry').length,sameId:container.querySelectorAll('[data-message-id="old-600"]').length}};
  });
  assert.deepEqual(duplicateRender,{during:{rows:1200,sameId:1},after:{rows:1200,sameId:1}},'duplicate state and orphan DOM rows cannot multiply transcript bubbles');
  const anchored=await page.evaluate(()=>{
   const container=document.getElementById('companion-messages'),entry=container.querySelector('[data-message-id="old-600"]');
   container.scrollTop=entry.offsetTop-37;
   return {id:entry.dataset.messageId,offset:entry.getBoundingClientRect().top-container.getBoundingClientRect().top};
  });
  await page.evaluate(()=>{const timeline=getActiveCompanionTimeline('latency-alex');timeline.messages.push(normalizeCompanionMessage({id:'below-anchor',role:'companion',text:'A later update',timestamp:Date.now(),deliveryState:'delivered'}));renderCompanionThread();});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const restored=await page.evaluate(id=>{const container=document.getElementById('companion-messages'),entry=container.querySelector(`[data-message-id="${id}"]`);return {top:container.scrollTop,offset:entry.getBoundingClientRect().top-container.getBoundingClientRect().top};},anchored.id);
  assert(restored.top>100,'a background render did not jump a reading position to the top');
  assert(Math.abs(restored.offset-anchored.offset)<3,'a background render preserved the visible message anchor');
  await page.locator('#companion-messages').evaluate(element=>{element.scrollTop=element.scrollHeight;});
  await page.evaluate(()=>{const timeline=getActiveCompanionTimeline('latency-alex');timeline.messages.push(normalizeCompanionMessage({id:'newest-response',role:'companion',text:'Newest response',timestamp:Date.now()+1,deliveryState:'delivered'}));renderCompanionThread();});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  scroll=await page.locator('#companion-messages').evaluate(element=>({top:element.scrollTop,height:element.scrollHeight,client:element.clientHeight}));
  assert(scroll.height-scroll.top-scroll.client<4,'a new response keeps a reader who was at the bottom at the bottom');
  const mergeAudit=await page.evaluate(()=>{
   const companion=getCompanion('latency-alex'),temporary={vh2:{conversationPersonaId:'persona-a',outbox:[]},messages:[
    normalizeCompanionMessage({id:'older',role:'user',text:'older',timestamp:500,playerPersonaId:'persona-a'}),
    normalizeCompanionMessage({id:'service-b',role:'companion',text:'B stale',timestamp:100,playerPersonaId:'persona-a'}),
    normalizeCompanionMessage({id:'wrong-persona',role:'user',text:'wrong',timestamp:1,playerPersonaId:'persona-b'})]};
   const latest=[normalizeCompanionMessage({id:'service-a',role:'user',text:'A',timestamp:300,playerPersonaId:'persona-a'}),normalizeCompanionMessage({id:'service-b',role:'companion',text:'B',timestamp:100,playerPersonaId:'persona-a'})];
   vh2ReconcileProjectionMessages(companion,temporary,latest,new Set());
   const leak=vh2NormalizeProjectionMessages(companion,temporary,[{id:'private-json',role:'assistant',type:'text',timestamp:600,text:JSON.stringify({reply:'visible reply',companionState:{conversationGoal:{type:'respond'},valenceChange:12,emotionAppraisal:{summary:'private'}}})}]);
   return {ids:temporary.messages.map(message=>message.id),leakText:leak[0].text,protocolLeak:leak[0].protocolLeak};
  });
  assert.deepEqual(mergeAudit.ids,['older','service-a','service-b'],'service order wins over timestamps and stale persona data');
  assert.equal(mergeAudit.leakText,'visible reply','private state JSON is stripped while its visible reply is recovered');
  assert.equal(mergeAudit.protocolLeak,false);
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
  const beforeReload=await page.evaluate(async()=>{await saveVirtualHumansState();const timeline=getActiveCompanionTimeline('latency-alex');return {ids:timeline.messages.slice(-30).map(message=>message.id),count:timeline.messages.length};});
  await page.reload();await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  await page.evaluate(base=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);mcpBridgeBase=()=>base;state.activeCompanionId='latency-alex';switchView('companionChat');},base);
  await page.evaluate(()=>vh2Poll(getCompanion('latency-alex'),getActiveCompanionTimeline('latency-alex'),{force:true}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const afterReload=await page.evaluate(()=>{const timeline=getActiveCompanionTimeline('latency-alex'),container=document.getElementById('companion-messages');return {ids:timeline.messages.slice(-30).map(message=>message.id),count:timeline.messages.length,bottom:container.scrollHeight-container.scrollTop-container.clientHeight,rendered:container.querySelectorAll('.companion-message-entry').length};});
  assert.deepEqual(afterReload.ids,beforeReload.ids,'reload and service poll preserve canonical tail order');
  assert.equal(afterReload.count,beforeReload.count,'reload and service poll neither duplicate nor drop messages');
  assert.equal(afterReload.rendered,afterReload.count,'reload renders each canonical message exactly once');
  assert(afterReload.bottom<4,'reopened long chat remains at the newest message after synchronization');
  assert.deepEqual(errors,[]);
  console.log('VH2 long-chat foreground audit passed');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
