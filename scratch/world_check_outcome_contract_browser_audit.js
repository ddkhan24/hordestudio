/** Typed dice consequences through the real application; no paid provider. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch(launchOptions);
 try {
  const ctx=await browser.newContext();
  await ctx.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.hostname!=='check-contract.test')return route.abort();
   const f=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
   if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile())return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'text/css'});
  });
  const page=await ctx.newPage();await page.goto('https://check-contract.test');
  await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  const results=await page.evaluate(async()=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);
   const w={id:'check_contract',name:'Gate test',model:'fixture/model',contextSize:32768,maxTokens:2048,
    startLocationId:'gate',locations:[{id:'gate',name:'Gate',exits:[{targetLocationId:'cellar',requiredItem:'key',allowCheckUnlock:true}]},
     {id:'cellar',name:'Cellar',exits:['to Gate']}],entities:[],kernel:{enabled:true,sceneDrafts:true},
    hudConfig:{stats:[{id:'wits',name:'Wits',value:0,roll:{enabled:true}},{id:'hp',name:'HP',value:12,min:0,max:12}]},gameRules:{dice:{criticals:false}}};
   state.worlds=[w];state.activeWorldId=w.id;state.apiKey='offline';state.globalSettings.apiProvider='openrouter';
   const originalFetch=window.fetch;let proposal,calls,narratorPrompt;
   window.fetch=async(url,opts)=>{
    if(!String(url).includes('/chat/completions'))return originalFetch(url,opts);
    calls++;const body=JSON.parse(opts.body);
    if(!body.tools){narratorPrompt=JSON.stringify(body.messages);
     return new Response(JSON.stringify({choices:[{message:{content:getCurrentWorldSession().checkHistory.at(-1).narrativeOutcome}}]}),{headers:{'Content-Type':'application/json'}});}
    const message={tool_calls:[{index:0,id:'check',type:'function',function:{name:'commit_world_turn',arguments:JSON.stringify(proposal)}}]};
    return new Response(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
   };
   const out=[];
   for(const mode of ['no_damage','typed_damage','failure_cost','success','untyped','failed_save','manual_failure']){
    w.gameRules.dice={criticals:false,resolution:mode==='manual_failure'?'player':'automatic'};
    state.worldInstances={[w.id]:{sessions:[],activeSessionId:null}};
    const s=prepareCurrentWorldSession();s.setupComplete=true;s.inventory=[{id:'pick',name:'lockpick',quantity:1}];
    s.history.push({id:'start',role:'dm',text:'The gate is locked. You have a lockpick.',location:'gate'});
    switchView('worldPlay');renderWorldPlayState();calls=0;narratorPrompt='';
    const text='You carefully probe the lock without stepping through the gate.';
    const branch=['typed_damage','failed_save','manual_failure'].includes(mode)?{inventory_remove:['lockpick'],location_state_updates:[{location_id:'cellar',add_conditions:['impassable']}]}:
     mode==='untyped'?{ledger_update:'The lock is permanently jammed and the lockpick is destroyed.'}:{};
    proposal={protocol:'scene_draft_v2',narrative:[{id:'p',text}],actions:[{request:'I pick the lock but stay outside.',kind:'physical',status:'pending_check',response_id:'p'}],
     events:[],effects:{checks:[{id:'gate_roll',label:'Pick the gate',stat_id:'wits',difficulty:mode==='success'?2:30,
      success_text:'Invented treasure appears.',failure_text:'The lock is permanently jammed and your tool is ruined.',
      on_success:{exit_unlocks:[{from_location_id:'gate',to_location_id:'cellar'}]},on_failure:branch}]},speech:[],commitments:[]};
    if(mode==='failure_cost')proposal.effects.checks[0].failure_cost={cause:'blunt impact',condition:'bruised shoulder',stat_changes:{hp:'-1'}};
    await saveWorldsState();
    const originalSave=saveWorldsState;
    if(mode==='failed_save')saveWorldsState=async()=>{throw Error('injected check save failure');};
    const oldRoll=stableWorldRoll;stableWorldRoll=()=>0.5;
    try{document.getElementById('world-user-input').value='I pick the lock but stay outside.';await executeWorldTurn();}
    finally{stableWorldRoll=oldRoll;saveWorldsState=originalSave;}
    if(mode==='manual_failure'){
     if(s.pendingCheck?.outcome_contract!=='state_delta_v1')throw Error('pending check lost its typed outcome contract');
     const oldContinue=executeWorldTurn,oldDie=rollSecureDie;
     executeWorldTurn=async()=>{};rollSecureDie=()=>1;
     try{await resolveWorldCheckFromModal();}finally{executeWorldTurn=oldContinue;rollSecureDie=oldDie;}
    }
    await saveWorldsState();
    const saved=(await HordeDB.get(`worldInstance:${w.id}`)).sessions.find(x=>x.id===s.id);
    out.push({mode,calls,source:s.lastTurnStateSource,errors:s.lastTurnAudit?.rejected,
     result:s.checkHistory.at(-1),saved:saved.checkHistory.at(-1),inventory:s.inventory,
     conditions:s.locationStates?.cellar?.conditions,unlocked:s.unlockedExits,location:s.playerLocation,narratorPrompt});
   }
   const s=getCurrentWorldSession(),before=worldCheckStateProjection(s,w);
   s.factions=[{id:'guild',influence:12}];s.npcScheduleOverrides={guard:[{time:'12:00',locationId:'cellar'}]};
   const probe={id:'projection',success:true};settleWorldCheckStateOutcome(s,probe,before,w);
   if(!probe.stateConsequences.some(x=>x.field==='factions')
     || !probe.stateConsequences.some(x=>x.field.startsWith('npcScheduleOverrides')))
      throw Error('Consequence manifest omitted a supported state family');
   if('checkHistory' in before || 'history' in before)throw Error('Recursive history leaked into check manifest');
   return out;
  });
  for(const r of results){
   if(r.mode==='failed_save'){assert.equal(r.result,undefined);assert.equal(r.inventory.length,1);assert(!JSON.stringify(r.conditions||[]).includes('impassable'));continue;}
   if(r.mode==='untyped'){assert.equal(r.source,'frozen_no_receipt',JSON.stringify(r));assert.equal(r.result,undefined);continue;}
   assert.deepEqual(r.errors,[],JSON.stringify(r));assert.equal(r.calls,r.mode==='manual_failure'?1:2);
   assert.equal(r.result.outcomeContract,'state_delta_v1');assert.deepEqual(r.result,r.saved);
   assert.equal(r.location,'gate');if(r.mode!=='manual_failure')assert.match(r.narratorPrompt,/CHECK CONSEQUENCE AUTHORITY/);
   assert.doesNotMatch(r.narratorPrompt,/your tool is ruined|Invented treasure/);
   if(r.mode==='no_damage'){assert.equal(r.inventory.length,1);assert.deepEqual(r.result.stateConsequences,[]);}
   if(['typed_damage','manual_failure'].includes(r.mode)){assert.equal(r.inventory.length,0);assert(JSON.stringify(r.conditions).includes('impassable'),JSON.stringify(r));assert(r.result.stateConsequences.length>=2);}
   if(r.mode==='success'){assert.equal(r.result.success,true);assert(Object.values(r.unlocked).includes(true));}
  }
  console.log('PASS check consequences: no invented damage, typed loss/route closure, success unlock, persistence and untyped rejection');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
