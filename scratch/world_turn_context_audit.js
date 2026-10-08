'use strict';
const assert = require('node:assert/strict');
const ctx = require('../worlds/turn-context');
const history = [{ id: 'old', role: 'dm', text: 'A secret in the cellar.', location: 'cellar' },
    { id: 'now', role: 'user', text: 'I leave the cellar.', location: 'cellar' }];
const options = { history, start: 1, budget: 500, location: 'hall', locations: [{id:'cellar', name:'Cellar'}], text: m => m.text };
const selected = ctx.history(options);
assert.equal(selected[1].content, 'I leave the cellar.');
assert.match(selected[0].content, /HIDDEN FROM PRESENT NPCs/);
assert.throws(() => ctx.history({...options,budget:1}), /current player action/);
const memory = ctx.sceneMemory({receipt:{events:[],state_updates:{}},speech:[{speaker:'x',listeners:['y'],statement:'The key is red.'}]},'r1','hall',1);
assert.equal(memory.records[0].kind, 'testimony');
const source = [{id:'m1',sceneMemory:memory}];
assert.match(ctx.recall(source,'key','hall'), /sourceMessageId/);
assert.equal(ctx.recall([], 'key', 'hall'), '', 'deleted sources cannot leave ghost summaries');
assert.equal(ctx.recall(source,'key','hall',1), '', 'recall obeys budget');
const failed=[...history,{role:'dm',text:'Unverified reply discarded.',stateSource:'frozen_no_receipt'},
    {role:'user',text:'A fresh action.'}];
const retryContext=ctx.history({...options,history:failed,start:3});
assert(!JSON.stringify(retryContext).includes('Unverified'));
assert(!JSON.stringify(retryContext).includes('I leave the cellar.'));
console.log('PASS context selection, testimony provenance, source deletion and budget');
