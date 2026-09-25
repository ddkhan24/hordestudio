#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const net=require('node:net');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium,launchOptions}=require('../scratch/browser_runtime').browserRuntime();

const ROOT=path.resolve(__dirname,'..');
const PYTHON=process.env.HORDE_PYTHON_EXECUTABLE||'python3';
const TOKEN='browser-transfer-'+('c'.repeat(40));

function sourceServer(){
 const child=spawn(PYTHON,['scratch/vh2_browser_server.py'],{cwd:ROOT,env:process.env,stdio:['ignore','pipe','pipe']});
 return new Promise((resolve,reject)=>{
  child.stdout.once('data',data=>resolve({child,base:'http://127.0.0.1:'+Number(String(data).trim())}));
  child.once('exit',code=>reject(Error('Local fixture server exited during startup ('+code+').')));
  child.stderr.on('data',data=>process.stderr.write(data));
 });
}
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}
async function remoteServer(origin,directory){
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const environment={...process.env,HORDE_CONFIG_DIR:directory,HORDE_SERVER_LISTEN_HOST:'127.0.0.1',HORDE_SERVER_HOST:'127.0.0.1',HORDE_SERVER_PORT:String(port),HORDE_VH2_REMOTE_MODE:'1',HORDE_VH2_ACCESS_TOKEN:TOKEN,HORDE_VH2_ALLOWED_ORIGINS:origin};
 const child=spawn(PYTHON,['-u','horde_mcp_bridge.py'],{cwd:ROOT,env:environment,stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',data=>process.stderr.write(data));
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw Error('Private host exited during startup ('+child.exitCode+').');
  try{const response=await fetch(base+'/health',{headers:{Authorization:'Bearer '+TOKEN,Origin:origin}});if(response.ok)return {child,base};}catch(_){}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 child.kill();throw Error('Private host did not become ready.');
}
async function remoteJson(base,pathname,options={}){
 const response=await fetch(base+pathname,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+TOKEN,Origin:options.origin||''}});
 if(!response.ok)throw Error('Remote '+pathname+' failed: '+response.status+' '+await response.text());
 return response.json();
}
async function waitRemote(base,pathname,predicate,origin,timeout=20000){
 const deadline=Date.now()+timeout;let last;
 while(Date.now()<deadline){last=await remoteJson(base,pathname,{origin});if(predicate(last))return last;await new Promise(resolve=>setTimeout(resolve,100));}
 throw Error('Timed out waiting for private host state: '+JSON.stringify(last));
}
async function main(){
 let local,remote,browser;const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vh2-self-host-browser-'));
 try{
  local=await sourceServer();remote=await remoteServer(local.base,temporary);browser=await chromium.launch(launchOptions);
  const page=await browser.newPage(),errors=[],transferRequests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\/vh2\/(?:mirror|backup|restore|transfer-checkpoint)/.test(request.url()))transferRequests.push(request.method()+' '+request.url());});
  await page.route('**/*',route=>{const url=route.request().url();return url.startsWith(local.base)||url.startsWith(remote.base)?route.continue():route.abort();});
  await page.goto(local.base+'/index.html');
  await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  await page.evaluate(base=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);mcpBridgeBase=()=>base;
   state.apiKey='BROWSER_TEST_KEY';state.globalSettings.apiProvider='openrouter';state.globalSettings.defaultModel='browser-cloud-fixture';
   const companion=normalizeCompanion({id:'self-host-alex',name:'Alex',age:28,textProvider:'openrouter',model:'browser-cloud-fixture',locationMode:'custom',timezoneOffsetMinutes:0,personality:'Quiet and curious',lifeProfile:{initializedAt:1788764400000,places:[{id:'home',label:'Home',kind:'home'},{id:'cafe',label:'Cafe',kind:'social',encounterScope:'nearby'}],weeklySchedule:[],sleepPolicy:{enabled:false},socialCircle:[],world:{transport:{enabled:true},people:[]}}});
   state.companions=[companion];state.companionTimelines={};state.companionThreads={};state.activeCompanionId=companion.id;ensureCompanionTimelineStore(companion.id);hideGlobalSettings();vhOpenWorkspace('overview');
  },local.base);
  await page.locator('[data-start-persistent]').click();
  await page.waitForFunction(()=>getActiveCompanionTimeline('self-host-alex')?.vh2?.running===true);
  const originalWorld=await page.evaluate(()=>getActiveCompanionTimeline('self-host-alex').vh2.worldId);

  await page.getByRole('button',{name:'Always-on private server',exact:true}).click();
  const panel=page.locator('details').filter({has:page.locator('.vh-private-hosting')}).last();
  assert.equal(await panel.isVisible(),true,'private-server panel is reachable from the live-human overview');
  await panel.locator('summary').click();
  await panel.locator('[data-cloud-host="existing"]').click();
  await panel.getByLabel('Server address',{exact:true}).fill(remote.base);
  await panel.getByLabel('Private server key',{exact:true}).fill(TOKEN);
  const upload=panel.locator('button').filter({hasText:'Move running life to private server'});
  assert.equal(await upload.isDisabled(),true,'runtime move stays unavailable until the private server is verified');
  await panel.getByRole('button',{name:'Test private server',exact:true}).click();
  await assert.doesNotReject(async()=>page.waitForFunction(()=>[...document.querySelectorAll('.vh-private-hosting [role=status]')].some(node=>node.textContent.includes('Server connected')),null,{timeout:10000}));
  assert.equal(await upload.isEnabled(),true,'successful connection testing enables the explicit upload action');
  page.once('dialog',dialog=>dialog.accept());
  await upload.click();
  await page.waitForFunction(()=>!!getActiveCompanionTimeline('self-host-alex').vh2.hostId,null,{timeout:20000});
  const hosted=await waitRemote(remote.base,'/vh2/projection?worldId='+encodeURIComponent(originalWorld),projection=>projection.state.running===true,local.base);
  await page.waitForFunction(()=>document.querySelector('.vh-private-hosting')?.textContent.includes('Switch back to this computer'),null,{timeout:10000});
  assert.equal(hosted.worldId,originalWorld,'browser transferred the same canonical life');
  assert.equal(hosted.state.running,true,'the remotely restored life resumed its prior running state');
  const localPaused=await (await fetch(local.base+'/vh2/projection?worldId='+encodeURIComponent(originalWorld))).json();
  assert.equal(localPaused.state.running,false,'the source remained paused');
  const firstMirror=await (await fetch(local.base+'/vh2/mirror?worldId='+encodeURIComponent(originalWorld))).json();
  assert.equal(firstMirror.available,true,'the initial cloud revision was mirrored locally');
  assert.equal(firstMirror.revision,hosted.revision,'the local mirror matches the active cloud revision');
  const guarded=await page.evaluate(async()=>{const companion=getCompanion('self-host-alex'),timeline=getActiveCompanionTimeline(companion.id);try{await vh2EmergencyLocalFailover(companion,timeline,{textContent:''});return '';}catch(error){return error.message;}});
  assert.match(guarded,/cloud is reachable/i,'emergency failover is refused while cloud can be paused cleanly');

  await page.evaluate(async()=>{const timeline=getActiveCompanionTimeline('self-host-alex');await vhUiCommand(timeline,'set_running',{running:false});await vhUiCommand(timeline,'set_running',{running:true});});
  assert.equal((await remoteJson(remote.base,'/vh2/projection?worldId='+encodeURIComponent(originalWorld),{origin:local.base})).state.running,true,'workspace commands route to the private host');
  assert.equal((await (await fetch(local.base+'/vh2/projection?worldId='+encodeURIComponent(originalWorld))).json()).state.running,false,'hosted commands never mutate the stale local source');
  const portable=await page.evaluate(()=>({timelines:portableCompanionTimelineState(state.companionTimelines),settings:redactGlobalSettingsCredentials(state.globalSettings)}));
  assert.equal(JSON.stringify(portable.timelines).includes('hostId'),false,'portable browser state omits remote ownership pointers');
  assert.equal(JSON.stringify(portable).includes(TOKEN),false,'portable state omits the access token');

  await page.evaluate(()=>{vhOpenWorkspace('recovery');vhRenderWorkspace();});
  const hostedPanel=page.locator('details').filter({has:page.locator('.vh-private-hosting')}).last();
  if(!await hostedPanel.evaluate(element=>element.open))await hostedPanel.locator('summary').click();
  const bringHome=hostedPanel.getByRole('button',{name:'Switch back to this computer',exact:true});
  if(!await bringHome.count()){
   const diagnostic=await page.evaluate(()=>{const timeline=getActiveCompanionTimeline('self-host-alex');return {hostId:timeline?.vh2?.hostId,host:state.globalSettings?.vh2SelfHosts?.[timeline?.vh2?.hostId],workspace:vhWorkspaceSection,panels:[...document.querySelectorAll('#vh2-chat-controls details')].map(node=>node.innerText.slice(0,500))};});
   throw Error('Bring-home control was not rendered: '+JSON.stringify(diagnostic));
  }
  await bringHome.waitFor({state:'visible',timeout:10000});
  page.once('dialog',dialog=>dialog.accept());
  await bringHome.click();
  try{await page.waitForFunction(old=>{const link=getActiveCompanionTimeline('self-host-alex').vh2;return !link.hostId&&link.worldId!==old;},originalWorld,{timeout:20000});}
  catch(error){const diagnostic=await page.evaluate(()=>{const link=getActiveCompanionTimeline('self-host-alex')?.vh2;return {link:{worldId:link?.worldId,hostId:link?.hostId,handoffId:link?.handoffId,revision:link?.revision},status:[...document.querySelectorAll('.vh-private-hosting [role=status]')].map(node=>node.textContent),toasts:[...document.querySelectorAll('.toast')].map(node=>node.textContent),saveStateInFlight:!!saveStateInFlight,virtualHumanSaveInFlight:!!virtualHumanSaveInFlight,virtualHumanSaveScope};});diagnostic.transferRequests=transferRequests;throw Error('Bring-home transfer did not finish: '+JSON.stringify(diagnostic),{cause:error});}
  const returnedWorld=await page.evaluate(()=>getActiveCompanionTimeline('self-host-alex').vh2.worldId);
  assert.notEqual(returnedWorld,originalWorld,'local mirror promotion creates a conflict-safe local identity');
  const promoted=await waitRemote(local.base,'/vh2/projection?worldId='+encodeURIComponent(returnedWorld),projection=>projection.state.running===true,local.base);
  assert.equal(promoted.state.running,true,'the promoted local mirror resumed');
  assert.equal((await remoteJson(remote.base,'/vh2/projection?worldId='+encodeURIComponent(originalWorld),{origin:local.base})).state.running,false,'the remote source stayed paused after return');

  await page.evaluate(async({base,token})=>{const companion=getCompanion('self-host-alex'),timeline=getActiveCompanionTimeline(companion.id);await vh2MoveToPrivateHost(companion,timeline,{baseUrl:base,accessToken:token},{textContent:''});},{base:remote.base,token:TOKEN});
  await waitRemote(remote.base,'/vh2/projection?worldId='+encodeURIComponent(returnedWorld),projection=>projection.state.running===true,local.base);
  const emergencyMirror=await waitRemote(local.base,'/vh2/mirror?worldId='+encodeURIComponent(returnedWorld),mirror=>mirror.available===true,local.base);
  assert.equal(emergencyMirror.available,true,'a local mirror exists before emergency failover');
  remote.child.kill();await new Promise(resolve=>remote.child.once('exit',resolve));
  await page.evaluate(()=>{vhOpenWorkspace('recovery');vhRenderWorkspace();});
  const outagePanel=page.locator('details').filter({has:page.locator('.vh-private-hosting')}).last();
  if(!await outagePanel.evaluate(element=>element.open))await outagePanel.locator('summary').click();
  const emergencyTools=outagePanel.locator('.vh-cloud-emergency');
  if(!await emergencyTools.evaluate(element=>element.open))await emergencyTools.locator('summary').click();
  page.once('dialog',dialog=>dialog.accept());
  await outagePanel.getByRole('button',{name:'Emergency: use local backup',exact:true}).click();
  await page.waitForFunction(old=>{const link=getActiveCompanionTimeline('self-host-alex').vh2;return !link.hostId&&link.worldId!==old;},returnedWorld,{timeout:20000});
  const emergencyWorld=await page.evaluate(()=>getActiveCompanionTimeline('self-host-alex').vh2.worldId);
  const emergency=await waitRemote(local.base,'/vh2/projection?worldId='+encodeURIComponent(emergencyWorld),projection=>projection.state.running===true,local.base);
  assert.equal(emergency.state.running,true,'the last local mirror can be promoted while cloud is unreachable');
  assert.equal(await page.evaluate(()=>Object.values(state.globalSettings.vh2SelfHosts).some(host=>host.detachedAt&&host.name==='Detached after local failover'&&!host.accessToken)),true,'unreachable cloud ownership is detached and its active credential is forgotten instead of silently reconciled');
  assert.deepEqual(errors,[],'no browser exceptions');
  console.log(JSON.stringify({passed:true,checks:21,originalWorld,returnedWorld,emergencyWorld,flow:['overview always-on server entry','guided runtime-move gating','authenticated connection test','private-server primary activation','automatic local mirror','reachable-server failover guard','remote command routing','portable secret redaction','final mirror sync','conflict-safe local promotion','offline emergency failover','detached-server split-brain guard']},null,2));
 }finally{
  if(browser)await browser.close();
  local?.child.kill();remote?.child.kill();
  fs.rmSync(temporary,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
