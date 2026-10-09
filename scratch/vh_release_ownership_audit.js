'use strict';
// Opening a persona must keep the same life host, including when a local
// recovery copy exists. No browser, live service or provider is contacted.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('virtual_humans/frontend/vh2-horde-integration.js','utf8');
const code=source.slice(source.indexOf('const vh2ConversationOpenLocks='),source.indexOf('function vh2NewConversationDialog('));
async function scenario(hosted,reuse=false){
 const life={id:'life',vh2:{worldId:'shared-world',running:true,...(hosted?{hostId:'private-host',handoffId:'transfer-receipt',localMirrorRevision:42,localMirrorSavedAt:12345}:{})}};
 const store={sessions:[life]},companion={id:'alex'},persona={id:'persona-b',name:'Morgan',text:'Persona details'};
 const known=reuse?{id:'known',personaId:persona.id,vh2:{worldId:life.vh2.worldId,conversationPersonaId:persona.id,hostId:'stale-host',handoffId:'stale-transfer'}}:null;
 if(known)store.sessions.push(known);
 let active=life,polled;
 const ctx={Set,crypto:{randomUUID:()=> 'fixture'},state:{personas:[persona]},
  ensureCompanionTimelineStore:()=>store,getActiveCompanionTimeline:()=>active,
  activateCompanionTimeline:(_,id)=>{active=store.sessions.find(t=>t.id===id);},
  normalizeCompanionTimeline:value=>value,captureCompanionRuntime:()=>({}),
  saveVirtualHumansState:async()=>{},renderCompanionThread:()=>{},
  vhUiCommand:async(timeline,type)=>{assert.equal(timeline,life);assert.equal(type,'open_conversation');return {conversationPersonaId:persona.id};},
  vh2Poll:async(_,timeline)=>{polled=timeline;assert.equal(timeline.vh2.hostId,life.vh2.hostId,'persona poll must use its shared life host');assert.equal(timeline.vh2.handoffId,life.vh2.handoffId,'handoff receipt belongs to the life');}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const chat=await ctx.vh2OpenPersonaConversation(companion,persona.id);
 assert.equal(chat,polled);assert.equal(active,chat);assert.equal(chat.vh2.worldId,life.vh2.worldId);
 if(hosted){assert.equal(chat.vh2.localMirrorRevision,42);assert.equal(chat.vh2.localMirrorSavedAt,12345);}
 return chat;
}
async function frozenGeneration(){
 const timeline={id:'generation',messages:[],vh2:{conversationPersonaId:'persona-b',conversationGeneration:3}};
 const ctx={Map,Promise,crypto:{randomUUID:()=> 'message-fixture'},state:{view:'fixture'},
  normalizeCompanionMessage:value=>value,getActiveCompanionTimeline:()=>null,
  saveVirtualHumansState:async()=>{}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const vh2EnqueueLocks='),source.indexOf('const vh2FlushLocks=')),ctx);
 await ctx.vh2Enqueue(timeline,'receive_message',{text:'An offline message.'});
 assert.equal(timeline.vh2.outbox[0].conversationGeneration,3);
 timeline.vh2.conversationGeneration=4;
 assert.equal(timeline.vh2.outbox[0].conversationGeneration,3,'queued input keeps its original conversation generation after reset');
}
(async()=>{await scenario(true);await scenario(false);await scenario(true,true);await scenario(false,true);await frozenGeneration();console.log('PASS persona ownership and input fencing: new/existing private/local chats retain life host, transfer/mirror data; durable outbox freezes recipient generation.');})().catch(error=>{console.error(error);process.exitCode=1;});
