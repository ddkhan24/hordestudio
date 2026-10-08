const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source');
const modelClient = require('../worlds/model-client');

const names = [
    'worldReportedModelUsage', 'recordWorldModelAttempt',
    'recordWorldEmbeddingAttempt', 'recordWorldLabsResult', 'fetchWorldObservedJSON', 'getEmbedding'
];
const sources = names.map(name => functionSource(name));
assert(sources.every(Boolean), 'World model diagnostic helpers must remain extractable');

let saves = 0;
const context = vm.createContext({
    Date, Math, Number, String, Array, performance,
    state: { globalSettings: { apiProvider: 'openrouter' } },
    window: { HordeLabs: { currentConfig: () => ({ runtime: 'needle', model: '' }) } },
    saveWorldsState: async () => { saves++; },
    console: { warn: error => { throw error; } },
    apiBase: () => 'https://offline.example/v1',
    hasEmbeddingCredentials: () => true,
    embeddingApiBase: () => 'https://offline.example/v1',
    embeddingAuthHeaders: () => ({}),
    fetch: async (url, options) => {
        if (String(url).endsWith('/embeddings')) return new Response(JSON.stringify({
            data: [{ embedding: [0.2, 0.4] }], usage: { prompt_tokens: 3, total_tokens: 3 }
        }), { status: 200 });
        const body = JSON.parse(options.body);
        if (body.model === 'network/down') throw new Error('socket closed');
        if (body.model === 'fixture/429') return new Response('{"error":{"message":"rate limited"}}', { status: 429 });
        return new Response(JSON.stringify({
            choices: [{ message: { content: '{}' } }],
            usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cost: 0.00004 }
        }), { status: 200 });
    },
    Response
});
context.HordeWorldModelClient = {
    json: options => modelClient.json({ ...options, fetcher: context.fetch })
};
vm.runInContext(`const WORLD_MODEL_ATTEMPT_LIMIT = 120;\n${sources.join('\n')}`, context);

(async () => {
    const world = { id: 'w1' };
    const sess = { turnCount: 7 };
    const normalized = vm.runInContext('worldReportedModelUsage({prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, cost: 0})', context);
    assert.equal(normalized.costUsd, 0, 'an explicit reported zero remains distinguishable from unknown cost');
    assert.equal(vm.runInContext('worldReportedModelUsage(null)', context), null);
    const record = vm.runInContext('recordWorldModelAttempt', context);
    const observed = vm.runInContext('fetchWorldObservedJSON', context);
    const embed = vm.runInContext('recordWorldEmbeddingAttempt', context);
    const labs = vm.runInContext('recordWorldLabsResult', context);
    const getEmbedding = vm.runInContext('getEmbedding', context);

    const success = await observed(world, sess, 'worldAgent', { model: 'fixture/model', messages: [{ role: 'user', content: 'PRIVATE STORY' }] },
        { method: 'POST', headers: { Authorization: 'SECRET KEY' } });
    assert.equal(success.response.status, 200);
    assert.equal(success.diagnostic().usage.total, 25);
    assert.equal(success.diagnostic().usage.costUsd, 0.00004);
    assert.equal(success.diagnostic().background, true);
    const failure = await observed(world, sess, 'memoryConsolidation', { model: 'fixture/429' }, { method: 'POST' });
    assert.equal(failure.response.status, 429);
    assert.equal(failure.diagnostic().outcome, 'http_error');
    assert.equal(failure.diagnostic().usage, null);
    await assert.rejects(observed(world, sess, 'worldAgent', { model: 'network/down' }, { method: 'POST' }), /socket closed/);
    assert.equal(sess.worldModelAttempts.at(-1).outcome, 'network_error');

    embed(world, sess, 'messageEmbedding', {
        model: 'fixture/embed', status: 200, outcome: 'ok', durationMs: 12,
        usage: { prompt_tokens: 9 }, provider: 'separate embedding endpoint'
    });
    assert.equal(sess.worldModelAttempts.at(-1).kind, 'messageEmbedding');
    const embeddingDiagnostics = [];
    assert.equal((await getEmbedding('quiet room', item => embeddingDiagnostics.push(item))).length, 2);
    assert.equal(embeddingDiagnostics[0].usage.prompt_tokens, 3);
    assert.equal(embeddingDiagnostics[0].outcome, 'ok');
    labs(world, sess, 'labsWorldFrame', { ok: true, latencyMs: 8, source: 'local_cognition' }, false);
    assert.equal(sess.worldModelAttempts.at(-1).billing, 'local');
    labs(world, sess, 'labsWorldFrame', { ok: true, latencyMs: 0, source: 'cache' }, false);
    assert.equal(sess.worldModelTotals.attempts, 5, 'cached Labs results must not be counted as attempts');

    for (let index = 0; index < 125; index++) record(world, sess, {
        kind: 'main', model: 'fixture/model', status: 200,
        durationMs: 1, usage: null, background: false
    });
    assert.equal(sess.worldModelAttempts.length, 120, 'detailed ledger is bounded');
    assert.equal(sess.worldModelTotals.attempts, 130, 'cumulative counters survive rotation');
    assert.equal(sess.worldModelTotals.local, 1);
    assert.equal(sess.worldModelTotals.reportedCostUsd, 0.00004);
    assert.equal(sess.worldModelTotals.unpricedProviderAttempts, 128);
    assert(saves >= 4, 'asynchronous attempts must request persistence');
    const diagnosticText = JSON.stringify({ attempts: sess.worldModelAttempts, totals: sess.worldModelTotals });
    assert(!diagnosticText.includes('PRIVATE STORY') && !diagnosticText.includes('SECRET KEY'),
        'diagnostics must not retain prompts or credentials');
    console.log('PASS: Worlds model ledger captures background/failed/local attempts, honest unknown cost, and bounded durable totals');
})().catch(error => { console.error(error); process.exitCode = 1; });
