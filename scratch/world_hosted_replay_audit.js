// Replay a recorded fictional hosted scene against the real engine, no API.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
const root=path.resolve(__dirname,'..');
(async()=>{
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/worlds/hosted-conversational-wait.json'),'utf8'));
 const turn={action:fixture.action};
 const proposal=fixture.proposal;
 const world=JSON.parse(fs.readFileSync(path.join(root,'Policy Panic at Bramble and Pike.horde_world'),'utf8'));
 const browser=await chromium.launch(launchOptions);
 try {
  const context=await browser.newContext();
  await context.route('**/*',route=>{
   const u=new URL(route.request().url()); if(u.hostname!=='hosted-replay.test')return route.abort();
   const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/css'});
  });
  const page=await context.newPage(); await page.goto('https://hosted-replay.test');
  await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  const result=await page.evaluate(async({world,proposal,input})=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);
   world.model='fixture/model';world.contextSize=65536;world.kernel={enabled:true,sceneDrafts:true,memoryMode:'ledger'};
   state.worlds=[world];state.worldInstances={[world.id]:{sessions:[],activeSessionId:null}};state.activeWorldId=world.id;
   state.apiKey='offline';state.globalSettings.apiProvider='openrouter';
   world.entities.push({id:'npc_halloway',name:'Agent Halloway',type:'npc',startLocation:'loc_reception',persona:'Examiner'});
   const sess=prepareCurrentWorldSession();sess.setupComplete=true;sess.playerLocation='loc_reception';
   sess.worldClock={absoluteMinutes:542,turnCount:sess.turnCount,bonusTimeMinutes:sess.bonusTimeMinutes||0};
   sess.entityStates.npc_halloway.location='loc_reception';
   sess.history.push({id:'start',role:'dm',text:'Agent Halloway and Gloria wait at reception.',location:'loc_reception'});
   switchView('worldPlay');renderWorldPlayState();
   const requests=[];
   const realFetch=window.fetch;
   window.fetch=async(url,options)=>{
    if(!String(url).includes('/chat/completions'))return realFetch(url,options);
    const body=JSON.parse(options.body);requests.push(body.messages);
    const message={tool_calls:[{id:'replay',index:0,type:'function',function:{name:'commit_world_turn',arguments:JSON.stringify(proposal)}}]};
    return body.stream?new Response(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}})
      :new Response(JSON.stringify({choices:[{message}]}),{headers:{'Content-Type':'application/json'}});
   };
   document.getElementById('world-user-input').value=input;await executeWorldTurn();
   return {source:sess.lastTurnStateSource,text:sess.history.at(-1)?.text,
    errors:sess.lastTurnAudit?.rejected, correction:requests[1]?.at(-1)?.content, calls:requests.length,
    callAudit:sess.history.at(-1)?.callAudit, requestKinds:requests.map(m=>m?.[0]?.content?.slice(0,100))};
  },{world,proposal,input:turn.action});
  console.log(JSON.stringify(result,null,2));
  assert.equal(result.source,'tool_call');assert.equal(result.calls,1);
  const transfer = await page.evaluate(async () => {
   const w=state.worlds[0],s=getCurrentWorldSession();
   // Real hosted wording previously failed two legacy keyword gates despite
   // explicit, linked transfer and deadline records.
   w.gameRules=normalizeWorldGameRules(w);w.gameRules.modules.inventory=true;
   const action='I accept the offered watch-lamp. I ask for an exact deadline.';
   const p1='Denton lets the heavy iron lantern drop into your grip.';
   const p2='If you are not back by sunset on Wednesday, I will send a search party.';
   const speaker=buildWorldSceneFrame(w,s).present_character_ids[0];
   const draft={protocol:'scene_draft_v2',narrative:[{id:'p1',text:p1+' '},{id:'p2',text:p2+' '}],
    actions:[{request:'I accept the offered watch-lamp.',kind:'physical',status:'resolved',response_id:'p1'},
     {request:'I ask for an exact deadline.',kind:'question',status:'answered',response_id:'p2'}],
    events:[{type:'inventory',actor_id:'player',status:'completed',item:'watch-lamp',action:'add',passage_id:'p1'}],
    effects:{},speech:[{speaker,listeners:['player'],passage_id:'p2'}],
    commitments:[{id:'lamp_return',title:'Search party',day:3,minute_of_day:1020,
     location_id:s.playerLocation,status:'scheduled',passage_id:'p2'}]};
   let calls=0;
   s.sceneDraftJsonModels=['openrouter:fixture/model'];
   window.fetch=async(url,options)=>{
    if(!String(url).includes('/chat/completions'))return new Response('{}',{headers:{'Content-Type':'application/json'}});
    calls++;const body=JSON.parse(options.body);
    const message={content:'```json\n'+JSON.stringify(draft)+'\n```'};
    return body.stream?new Response(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}})
     :new Response(JSON.stringify({choices:[{message}]}),{headers:{'Content-Type':'application/json'}});
   };
   document.getElementById('world-user-input').value=action;await executeWorldTurn();
   const first={calls,errors:s.lastTurnAudit?.rejected,items:s.inventory.map(x=>x.name||x),deadline:s.scheduledEvents.find(x=>x.id==='lamp_return')};
   // Structured completion never overrides an explicit player refusal.
   draft.actions=[{request:'I refuse the watch-lamp.',kind:'physical',status:'resolved',response_id:'p1'}];
   draft.commitments=[];draft.speech=[];
   document.getElementById('world-user-input').value='I refuse the watch-lamp.';await executeWorldTurn();
   return {first,refusal:s.lastTurnStateSource,errors:s.lastTurnAudit?.rejected};
  });
  assert.equal(transfer.first.calls,1,JSON.stringify(transfer));
  assert.deepEqual(transfer.first.errors,[],JSON.stringify(transfer));
  assert(transfer.first.items.includes('watch-lamp'));
  assert.equal(transfer.first.deadline?.dueMinute,3900);
  assert.equal(transfer.refusal,'frozen_no_receipt',JSON.stringify(transfer));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
