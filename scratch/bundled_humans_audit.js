'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const entry={id:'aslyn-jonas-v18',characterId:'aslyn_jonas_v18',sourceCompanionId:'original',name:'Aslyn Jonas',retiredBundleIds:['aslyn-jonas-v1'],path:'assets/bundled/aslyn-v18/character.json'};
function fixture({companions=[],timelines={},threads={},installed=[]}={}){
 const saved=new Map();let installs=0,writes=0;
 const context=vm.createContext({state:{companions,companionTimelines:timelines,companionThreads:threads,globalSettings:{installedHumanBundles:installed},editingCompanionId:'editing'},fetch:async url=>({ok:true,json:async()=>url.endsWith('humans.json')?{version:1,humans:[entry]}:{_kind:'character-template',companion:{name:'Aslyn Jonas'}}}),safeJsonClone:v=>JSON.parse(JSON.stringify(v)),HordeDB:{set:async(k,v)=>saved.set(k,v)},saveState:async()=>{writes++},deleteCompanion:id=>{context.state.companions=context.state.companions.filter(c=>c.id!==id);delete context.state.companionTimelines[id];delete context.state.companionThreads[id]},validateCompanionArchiveData:a=>a,restoreCompanionArchive:(a,at,id)=>{installs++;context.state.editingCompanionId=id;const c={...a.companion,id};context.state.companions.push(c);return c},renderCompanionsGrid:()=>{}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../bundled-humans.js'),'utf8'),context);
 return {context,saved,run:()=>vm.runInContext('installBundledHumans()',context),installs:()=>installs,writes:()=>writes};
}
(async()=>{
 const fresh=fixture();await Promise.all([fresh.run(),fresh.run()]);assert.equal(fresh.installs(),1);assert.equal(fresh.context.state.editingCompanionId,'editing');
 const deleted=fixture({installed:[entry.id]});await deleted.run();assert.equal(deleted.installs(),0);
 const f=fixture({companions:[{id:'original',name:'Aslyn Jonas'},{id:'unused',name:'Aslyn Jonas',bundledId:'aslyn-jonas-v1'},{id:'with-life',name:'Aslyn Jonas',bundledId:'aslyn-jonas-v1'},{id:'with-chat',name:'Aslyn Jonas',bundledId:'aslyn-jonas-v1'},{id:'another',name:'Another person'}],timelines:{'with-life':{sessions:[{vh2:{worldId:'existing-life'}}]},'with-chat':{sessions:[{messages:[{text:'hello'}]}]}},installed:[entry.id]});await f.run();
 assert.equal(f.installs(),0);assert.equal(f.context.state.companions.length,4);assert(f.saved.has('retired-duplicate-human:unused'));assert.equal(f.writes(),1);assert(f.context.state.companions.some(c=>c.id==='with-life'));assert(f.context.state.companions.some(c=>c.id==='with-chat'));
 console.log('PASS included character installation: concurrent boot, deletion ledger, recoverable unused-duplicate cleanup, existing life/chat preservation, persisted cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
