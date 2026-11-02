'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source.js');

const context = vm.createContext({});
vm.runInContext(`${functionSource('worldReceiptRepairOutputLimit')}\nthis.budget = worldReceiptRepairOutputLimit;`, context);
assert.equal(context.budget(4096, 0, 32768, 1000), 8192,
    'a truncated scene draft should get a larger one-off repair budget');
assert.equal(context.budget(2048, 0, 32768, 1000), 4096,
    'repair budget must exceed a small configured generation limit');
assert.equal(context.budget(4096, 4096, 32768, 1000), 4096,
    'respect an advertised provider output ceiling');
assert.equal(context.budget(4096, 128, 32768, 1000), 128,
    'never exceed even a low advertised provider output ceiling');
assert.equal(context.budget(4096, 0, 6000, 16000), 0,
    'do not request output tokens after the repair prompt exhausts context');
const turn = functionSource('executeWorldTurn');
assert.match(turn, /repairBody\.max_tokens = worldReceiptRepairOutputLimit/,
    'the actual receipt repair request must use the expanded budget');
assert.match(turn, /about 150 words total unless the player explicitly asks for detail/,
    'the initial scene draft should avoid spending its receipt budget on unrequested verbosity');

console.log('✓ receipt repair output budget expands safely for truncated drafts');
