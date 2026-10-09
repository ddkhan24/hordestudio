'use strict';
// Real browser + ephemeral service; a routed private-host sentinel proves that
// opening and using another persona never falls back to the local life copy.
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
(async()=>{
 const server=spawn(process.env.HORDE_PYTHON_EXECUTABLE||'python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
 try{
  const port=await new Promise((resolve,reject)=>{server.stdout.once('data',data=>resolve(Number(String(data).trim())));server.stderr.on('data',data=>process.stderr.write(data));server.once('exit',code=>reject(Error('Fixture exited '+code)));});
  const base='http://127.0.0.1:'+port,remote=base+'/private-host-sentinel',requests=[];
  browser=await chromium.launch(launchOptions);const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=request.url();
   if(url.startsWith(remote+'/')){
    requests.push({path:url.slice(remote.length),method:request.method(),authorization:request.headers().authorization});
    return route.fulfill({response:await route.fetch({url:base+url.slice(remote.length)})});
   }
   return url.startsWith(base)?route.continue():route.abort();
  });
  await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  const primary=await page.evaluate(async({base,remote})=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);mcpBridgeBase=()=>base;
   Object.assign(state.globalSettings,{localBaseUrl:base+'/test',localApiKey:'LOCAL_TEST_KEY',apiProvider:'local',defaultModel:'browser-fixture',companionAlwaysOnEnabled:false});
   const companion=normalizeCompanion({id:'remote-persona-fixture',name:'Alex',age:28,textProvider:'local',model:'browser-fixture',lifeProfile:{weeklySchedule:[],sleepPolicy:{enabled:false}}});
   state.companions=[companion];state.activeCompanionId=companion.id;state.companionTimelines={};state.companionThreads={};
   state.personas=[{id:'persona-a',name:'Taylor',text:'Primary persona'},{id:'persona-b',name:'Morgan',text:'Other persona'}];
   ensureCompanionTimelineStore(companion.id);hideGlobalSettings();await vh2CreateTimeline(companion);
   const life=getActiveCompanionTimeline(companion.id);await vhUiCommand(life,'configure_auto_replies',{enabled:false});await vhUiCommand(life,'set_running',{running:false});
   state.globalSettings.vh2SelfHosts={'fixture-private':{baseUrl:remote,accessToken:'private-fixture-token'}};
   Object.assign(life.vh2,{hostId:'fixture-private',handoffId:'fixture-transfer',localMirrorRevision:Number.MAX_SAFE_INTEGER,localMirrorSavedAt:Date.now()});
   await saveVirtualHumansState();switchView('companionChat');renderCompanionThread();vh2NewConversationDialog(companion);
   return {id:life.id,worldId:life.vh2.worldId};
  },{base,remote});
  await page.getByRole('button',{name:'Morgan · Start chat',exact:true}).click();
  await page.waitForFunction(primary=>getActiveCompanionTimeline('remote-persona-fixture')?.id!==primary,primary.id);
  const opened=await page.evaluate(()=>{const t=getActiveCompanionTimeline('remote-persona-fixture');return {id:t.id,hostId:t.vh2.hostId,handoffId:t.vh2.handoffId,worldId:t.vh2.worldId,persona:t.vh2.conversationPersonaId};});
  assert.equal(opened.hostId,'fixture-private');assert.equal(opened.handoffId,'fixture-transfer');assert.equal(opened.worldId,primary.worldId);assert.equal(opened.persona,'persona-b');
  assert(requests.some(request=>request.path.includes('/vh2/projection?')&&request.path.includes('personaId=persona-b')),'new persona projection uses private host');
  assert(requests.every(request=>request.authorization==='Bearer private-fixture-token'),'private host keeps authentication for persona requests');
  await page.evaluate(async()=>{const c=getCompanion('remote-persona-fixture'),t=getActiveCompanionTimeline(c.id);await vhUiCommand(t,'receive_message',{text:'Keep this with Morgan.'});await vh2Poll(c,t,{force:true,readOnly:true,throwOnError:true});});
  const projection=await (await fetch(base+'/vh2/projection?worldId='+primary.worldId+'&personaId=persona-b')).json();
  assert.equal(projection.state.communication.messages.filter(message=>message.role==='user').length,1);assert.equal(projection.state.communication.messages[0].text,'Keep this with Morgan.');
  const untouched=await (await fetch(base+'/vh2/projection?worldId='+primary.worldId)).json();assert.equal(untouched.state.communication.messages.length,0);
  assert.deepEqual(errors,[]);console.log('PASS private-host browser persona creation, authenticated remote projection/input, shared world and isolated recipient transcript; no provider spend.');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
