/** Receipt feedback must not escape a rejected or unsaved transaction. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource, buildContext } = require('./app_source.js');

const reducer = functionSource('processStructuredActions');
const receipt = functionSource('commitWorldTurnReceipt');
const turn = functionSource('executeWorldTurn');
const agent = functionSource('runWorldAgent');

assert.match(receipt, /deferFeedback: context\.deferFeedback === true/);
assert.match(turn, /\{ \.\.\.receiptContext, deferFeedback: true \}/);
const transactionIndex = turn.indexOf('}, candidate => candidate.accepted);');
const feedbackIndex = turn.indexOf('if (attempt.accepted) pendingWorldActionFeedback = attempt.result.actionResult');
assert(transactionIndex >= 0 && feedbackIndex > transactionIndex,
    'only an accepted transaction may expose pending feedback, including after summary-only salvage');
assert.match(turn, /const saved = await saveWorldsState\(options\);\s*if \(pendingWorldActionFeedback\)/);
assert.match(turn, /pendingWorldActionFeedback = null;[\s\S]*?const rollbackSnapshot/);
assert.match(agent, /processStructuredActions\(actions, world, sess, \{ deferFeedback: true \}\)/);
assert.equal((reducer.match(/showToast\(/g) || []).length, 1,
    'the reducer may only invoke showToast in its immediate-feedback adapter');
assert.equal((reducer.match(/renderWorld(?:Locations|Entities)\(/g) || []).length, 2,
    'the reducer may only refresh Studio from its immediate-feedback adapter');

const shown = [];
const state = { editingWorld: { id: 'w' } };
const context = buildContext(vm, ['flushWorldActionFeedback'], {
    state,
    document: { getElementById: id => id === 'w-entities-list' ? {} : null },
    showToast: (message, level) => shown.push([message, level]),
    renderWorldLocations: () => { throw new Error('locations are not visible'); },
    renderWorldEntities: () => shown.push(['refreshed entities'])
});
const proposed = {
    feedback: [{ type: 'toast', message: 'Character introduced', level: 'success' },
        { type: 'entities', worldId: 'w' }],
    checkOutcomeResults: [{ feedback: [{ type: 'toast', message: 'Check passed', level: 'info' }] }]
};
assert.deepEqual(shown, [], 'constructing a proposed result emits nothing');
context.flushWorldActionFeedback(null); // a rejected turn has no accepted result to flush
assert.deepEqual(shown, []);
context.flushWorldActionFeedback(proposed);
assert.deepEqual(shown, [
    ['Check passed', 'info'], ['Character introduced', 'success'], ['refreshed entities']
]);
console.log('✓ tentative World feedback stays buffered until an accepted saved transaction flushes it');
