const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source');

const source = functionSource('recoverWorldLedgerEntry');
const turnSource = functionSource('executeWorldTurn');
assert(source && turnSource, 'World call paths must be extractable');
assert(/fetchWorldTurnStream\(/.test(turnSource) && /fetchWorldTurnJSON\(/.test(turnSource),
    'main streaming and secondary JSON calls must both be timed');
assert(/narrativeRescue\+\+/.test(turnSource) && /calls: turnCallDetails\.slice/.test(turnSource),
    'rescue calls and compact diagnostics must be retained in the turn audit');

const responses = [
    { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'NO_MEMORY' } }],
        usage: { prompt_tokens: 123, completion_tokens: 7, total_tokens: 130 } }) },
    { ok: false, status: 429 }
];
const context = {
    performance,
    fetch: async () => responses.shift(),
    apiBase: () => 'https://offline.test/v1',
    authHeaders: () => ({}),
    attributionHeaders: () => ({}),
    sanitizeMessagesForProvider: messages => messages,
    extractWorldLedgerEntry: value => value,
    normalizeWorldLedgerEntry: value => value,
    console: { warn() {} }
};
const recover = vm.runInNewContext(`(${source})`, context);
(async () => {
    const diagnostics = [];
    assert.equal(await recover('fixture/model', 'hello', 'A quiet scene.', null, item => diagnostics.push(item)), '');
    assert.equal(await recover('fixture/model', 'hello', 'Another scene.', null, item => diagnostics.push(item)), '');
    assert.equal(diagnostics.length, 2);
    assert.equal(diagnostics[0].status, 200);
    assert.equal(diagnostics[0].usage.prompt_tokens, 123);
    assert.equal(diagnostics[1].status, 429);
    assert.equal(diagnostics[1].usage, null);
    assert(diagnostics.every(item => Number.isFinite(item.startedAt)));
    console.log('PASS: Worlds call telemetry records provider-reported usage and honest failed-call status');
})().catch(error => { console.error(error); process.exitCode = 1; });
