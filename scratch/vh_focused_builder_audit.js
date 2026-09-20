'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),{buildContext,constSource}=require('./app_source');
let requested=[];let reply={socialCircle:[]};
const c=buildContext(vm,['companionFocusedLifePrompt','completeCompanionLifeDraftSections','buildCompanionLifeWithAI','normalizeCompanion'],{
 getActiveCompanionTimeline:()=>null,providerHasCredentials:()=>true,companionTextProviderId:()=> 'local',companionEffectiveLifeBuilderModel:()=> 'fixture',providerApiBase:()=> 'http://fixture',providerAuthHeaders:()=>({}),providerAttributionHeaders:()=>({}),
 fetch:async(_url,options)=>{requested.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply)}}]})};},
 vhBuilderDossier:()=>({name:'Solitary archivist',socialWorld:'No friends or family',apiKey:undefined}),state:{globalSettings:{}},Intl,Date,crypto:require('node:crypto').webcrypto
});
vm.runInContext(require('node:fs').readFileSync('app.js','utf8').split('\n').find(line=>line.startsWith('const DEFAULT_DRAFT_COMPLETION_SECTIONS =')),c);
(async()=>{
 const full=c.companionLifeBuilderSystemPrompt();
 for(const key of ['places','rooms','socialCircle','wardrobe','styleProfiles','weeklySchedule','healthPolicy','peopleLives','finance']){
  const prompt=c.companionFocusedLifePrompt([key]);assert(prompt.length<full.length*.35,key+' prompt is focused');
  const schema=JSON.parse(prompt.split('sections:\n')[1].split('\n')[0]);assert.deepEqual(Object.keys(schema),[key]);
 }
 const p={id:'isolated',name:'Archivist',age:30,lifeProfile:{socialCircle:[]}};
 for(const key of ['socialCircle','peopleLives','weeklySchedule','routes']){
  requested=[];reply={[key]:[]};const result=await c.completeCompanionLifeDraftSections(p,{}, {requiredSections:[key],skipLifeRefresh:true});assert.equal(result.repairWarning,'',key);assert.equal(requested.length,1);assert.equal(result.draft[key].length,0);
 }
 requested=[];reply={grooming:'Uses a wooden comb and keeps a simple washing ritual.'};const prose=await c.completeCompanionLifeDraftSections(p,{}, {requiredSections:['grooming'],skipLifeRefresh:true});assert.equal(prose.repairWarning,'');assert.equal(requested.length,1);assert.equal(prose.draft.grooming,reply.grooming);
 reply={peopleLives:[]};const missing=await c.completeCompanionLifeDraftSections({...p,lifeProfile:{socialCircle:[{id:'friend'}]}},{},{requiredSections:['peopleLives'],skipLifeRefresh:true});assert.match(missing.repairWarning,/did not return usable/);
 for(const key of ['textingStyle','conversationStyle','chatExamples','chatAvoid','backstory','appearance']){const text='Authored text 🐉 '.repeat(300);assert.equal(c.normalizeCompanion({...p,[key]:text})[key],text.trim());}
 requested=[];
 await assert.rejects(c.buildCompanionLifeWithAI(p,{wholeLife:true,skipLifeRefresh:true}),/Whole-human AI generation is disabled/);
 await assert.rejects(c.buildCompanionLifeWithAI(p,{skipLifeRefresh:true}),/Whole-human AI generation is disabled/);
 await assert.rejects(c.completeCompanionLifeDraftSections(p,{},{wholeLife:true,skipLifeRefresh:true}),/Whole-human AI generation is disabled/);
 assert.equal(requested.length,0,'Whole-human and unscoped legacy paths stop before a provider request');
 console.log('PASS focused schemas, bounded prompts, explicit solitude and empty commitments, populated-cast validation, authored text survives normalization, whole-human generation blocked before provider');
})().catch(error=>{console.error(error);process.exitCode=1});
