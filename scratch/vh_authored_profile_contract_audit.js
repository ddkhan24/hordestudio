'use strict';
// Execute the actual client create/save paths with only transport and UI mocked.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const plain=v=>JSON.parse(JSON.stringify(v));
const authored={socialWorld:'Shares a home with two friends.',privateLife:'An unspoken academic concern.',routine:'Usually studies late.',
 playerKnowledge:'This contact said they grew up in York.',initialMotive:'Curious but guarded.',connectionAuthenticity:'mixed',startingScenario:'A reply to a public post.'};
const voice={emojiDensity:10};
const person={id:'test',name:'Test Person',age:28,...authored,
 apiKey:'DO_NOT_COPY',memory:{longTerm:[{text:'Private runtime transcript must not travel with a template.'}]},
 lifeProfile:{places:[{id:'home',photo:'DO_NOT_COPY_PHOTO'}],world:{items:[{id:'phone',photo:'DO_NOT_COPY_ITEM_PHOTO'}],voice}},
 lifeSetupPolicies:{rooms:[{id:'bedroom',placeId:'home',label:'Private bedroom',description:'Authored details.'}]}};
const timeline={id:'timeline',personaId:'selected',profileOverrides:{selected:'This selected persona.'},messages:[]};
const commands=[];let actual={};
const ctx={safeJsonClone:plain,state:{personas:[{id:'selected',name:'Selected Person',text:'Default persona'}]},
 companionTimelineBusy:()=>false,ensureCompanionTimelineStore:()=>({sessions:[timeline]}),getActiveCompanionTimeline:()=>timeline,
 freshCompanionRuntime:()=>({}),applyCompanionRuntime:()=>{},createCompanionTimeline:()=>{throw Error('Unexpected duplicate timeline');},
 vh2SyncProvider:async()=>{},vh2Enqueue:async(t,type,body)=>{commands.push({type,...plain(body)});if(type==='configure_expression_profile')actual={...plain(body.fields),lifeProfile:{world:{voice:plain(body.fields.voice)}}};},
 vh2Poll:async()=>{},vh2Flush:async()=>{},vh2ImportStarterProfile:async()=>{},renderCompanionThread:()=>{},saveState:async()=>{},
 mcpBridgeRequest:async()=>({revision:42,state:{truth:{companion:actual}}})};
vm.createContext(ctx);
const integration=fs.readFileSync('vh2-horde-integration.js','utf8'),begin=integration.indexOf('async function vh2CreateTimeline('),end=integration.indexOf('\nfunction vh2RenderControls(',begin);
assert(begin>=0&&end>begin);vm.runInContext(integration.slice(begin,end),ctx);
const workspace=fs.readFileSync('vh-workspace.js','utf8'),stop=workspace.indexOf('\nfunction vhStudioScope(');
assert(stop>0);vm.runInContext(workspace.slice(0,stop),ctx);
(async()=>{
 const before=plain(person);await ctx.vh2CreateTimeline(person);
 const profile=commands.find(c=>c.type==='create_profile').profile;
 for(const [key,value] of Object.entries(authored))assert.equal(profile[key],value,'Creation lost '+key);
 assert.equal(profile.apiKey,undefined);assert.equal(profile.memory,undefined);
 assert.equal(profile.lifeProfile.places[0].photo,undefined);assert.equal(profile.lifeProfile.world.items[0].photo,undefined);
 assert.deepEqual(person,before,'Creation changed the authored person');
 assert.equal(commands.find(c=>c.type==='configure_player_profile').profile.text,'This selected persona.');
 profile.lifeProfile.world.voice.emojiDensity=99;assert.equal(person.lifeProfile.world.voice.emojiDensity,10);
 const changed={...person,privateLife:'A revised concern.',initialMotive:'Wants a quiet conversation.'};
 timeline.vh2.worldId='world';const result=await ctx.vhApplyExpression(changed,timeline);
 const fields=commands.filter(c=>c.type==='configure_expression_profile').at(-1).fields;
 for(const key of Object.keys(authored))assert.equal(fields[key],changed[key],'Save lost '+key);
 assert.equal(fields.apiKey,undefined);assert.equal(fields.memory,undefined);assert.deepEqual(fields.voice,voice);assert.equal(result,42);
 fields.voice.emojiDensity=80;assert.equal(person.lifeProfile.world.voice.emojiDensity,10);
 actual.privateLife='Unexpected stale server value';
 ctx.vh2Enqueue=async()=>{};
 await assert.rejects(()=>ctx.vhApplyExpression(changed,timeline),/active expression differs/);
 console.log('PASS actual create/save commands retain seven authored fields, isolate selected persona, exclude credentials/runtime/media, deep-copy nested fields and reject stale acknowledgements.');
})().catch(error=>{console.error(error);process.exitCode=1;});
