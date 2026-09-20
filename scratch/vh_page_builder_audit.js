'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const person={id:'one',name:'Alex',appearance:'old',personality:'Solitary',backstory:'',occupation:'',socialWorld:'',apiKey:'SECRET',model:'test'};
const timeline={id:'t',vh2:{worldId:'w'}},inputs=new Map();let active=timeline,calls=[];
const ctx={AbortController,setTimeout,clearTimeout,console,state:{editingCompanionId:'one'},document:{getElementById:id=>inputs.get(id)},getCompanion:()=>person,getActiveCompanionTimeline:()=>active,
 providerApiBase:()=> 'https://fixture.invalid/v1',providerAuthHeaders:()=>({Authorization:'Bearer secret'}),providerAttributionHeaders:()=>({'X-Title':'Horde'}),
 fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'New visual details'}}]})};}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('virtual_humans/frontend/vh-page-builder.js','utf8'),ctx);
const fields=vm.runInContext("VH_PAGE_DRAFTS['cs-identity'].fields",ctx);
function session(){for(const [key] of fields)inputs.set(('cs-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())),{value:String(person[key]||'')});return {companion:person,page:'cs-identity',timeline,worldId:'w',provider:'local',model:'model-one',direction:'lonely fantasy character',initial:Object.fromEntries(fields.map(([key])=>[key,String(person[key]||'')])),context:ctx.vhPageContext(person),snapshot:ctx.vhPageSnapshot(person,'cs-identity')};}
(async()=>{
 let s=session(),before=JSON.stringify(person);
 s.drafts={name:'Provisional Alex',appearance:'Ignore same field'};
 const text=await ctx.vhPageRequestField(s,['appearance','Appearance',4000],new AbortController().signal);
 assert.equal(text,'New visual details');assert.equal(JSON.stringify(person),before,'Generating cannot mutate authored data');
 const request=JSON.parse(calls[0].options.body);assert.equal(request.model,'model-one');assert(!calls[0].options.body.includes('SECRET'));assert.equal(request.messages.length,2);assert.deepEqual(JSON.parse(request.messages[1].content).provisionalDrafts,{name:'Provisional Alex'});assert(!('tools'in request));
 assert.equal(calls[0].options.headers.Authorization,'Bearer secret');assert.equal(calls[0].options.headers['X-Title'],'Horde');
 person.appearance='edited during generation';assert.throws(()=>ctx.vhPageApplyDraft(s,{appearance:text}),/changed/);person.appearance='old';
 s=session();active={id:'other'};assert.throws(()=>ctx.vhPageApplyDraft(s,{appearance:text}),/life changed/);active=timeline;
 inputs.get('cs-appearance').value='unsaved DOM edit';assert.throws(()=>ctx.vhPageApplyDraft(s,{appearance:text}),/Page fields changed/);
 s=session();assert.throws(()=>ctx.vhPageApplyDraft(s,{appearance:'x'.repeat(4001)}),/exceeds/);assert.equal(person.appearance,'old');
 assert.equal(ctx.vhPageApplyDraft(s,{appearance:text,apiKey:'must not apply'}),1);assert.equal(person.appearance,text);assert.equal(person.apiKey,'SECRET');assert.equal(person.personality,'Solitary');assert.equal(inputs.get('cs-appearance').value,text);
 ctx.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'partial'}}]})});
 await assert.rejects(()=>ctx.vhPageRequestField(session(),fields[0],new AbortController().signal),/incomplete/);
 const longDirection={...session(),direction:'x'.repeat(4001)};await assert.rejects(()=>ctx.vhPageRequestField(longDirection,fields[0],new AbortController().signal),/Directions exceed/);
 ctx.fetch=async()=>({ok:false,status:429});await assert.rejects(()=>ctx.vhPageRequestField(session(),fields[0],new AbortController().signal),/HTTP 429/);
 assert.throws(()=>ctx.vhPageValidateText('```json\n{}\n```',4000),/structured/);
 const huge=ctx.vhPageContext({...person,personality:'x'.repeat(100000),backstory:'y'.repeat(100000)});assert(Object.values(huge).join('').length<=12000);
 console.log('PASS page builder: bounded secret-free text request, no automatic mutation, reviewed whitelist apply, length validation, stale character/life/DOM protection, incomplete and HTTP errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
