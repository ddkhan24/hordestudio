'use strict';
const assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const context = { console, DOMException, window: { HordeHelp: { knowledgeEntries: () => [{id:'global-embedding-model',text:'Configure the embedding model in Settings Memory.'}] } } };
vm.createContext(context);vm.runInContext(fs.readFileSync('horde-handbook.js','utf8'),context);vm.runInContext(fs.readFileSync('pip-knowledge.js','utf8'),context);
const knowledge=context.window.HordePipKnowledge;knowledge.initialize();
assert(knowledge.info().chunks>75);
assert(knowledge.search('are you running an llm?').every(doc=>doc.title.includes('Pip')));
assert(knowledge.search('How do I set up a Virtual Human?').some(doc=>doc.ch==='Virtual Humans 2.0'));
assert(knowledge.search('World movement travel locations').some(doc=>doc.ch==='Worlds'));
assert(knowledge.search('global embedding model').some(doc=>doc.id==='control:global-embedding-model'));
(async()=>{
let saved,requests=0;const adapter={embeddingIdentity:()=> 'fixture|embedding-a', embed:async(input)=>{requests++;return input.map(text=>[text.toLowerCase().includes('virtual human')?1:0.01,text.toLowerCase().includes('world')?1:0.01,1]);},saveIndex:async cache=>{saved=cache;}};
const signal=new AbortController().signal;const count=await knowledge.build(adapter,signal,()=>{});assert.equal(count,knowledge.info().chunks);assert(requests>1);assert(knowledge.info().indexed);assert(knowledge.restore(saved,adapter.embeddingIdentity()));assert(!knowledge.restore(saved,'other-model'));
const result=await knowledge.retrieve('person with an ongoing routine','semantic',adapter,signal);assert.match(result.method,/semantic/);assert(result.sources.length>0);
const fallback=await knowledge.retrieve('World travel','semantic',{...adapter,embed:async()=>{throw Error('fixture offline');}},signal);assert.match(fallback.method,/full-text/);assert.match(fallback.notice,/fixture offline/);
const cancelled=new AbortController();cancelled.abort();await assert.rejects(knowledge.build(adapter,cancelled.signal,()=>{}),/cancelled/);
assert(knowledge.info().indexed);console.log('PASS: chunked retrieval, focused self-identity sources, real batch embeddings, cached index identity, hybrid semantic ranking, fallback and cancellation ('+count+' chunks).');
})().catch(e=>{console.error(e);process.exit(1);});
