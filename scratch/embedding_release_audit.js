/** Bounded embedding transport, cancellation, diagnostics, cache and model-change regressions. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { app, functionSource } = require('./app_source');
const client = fs.readFileSync(path.join(__dirname, '../worlds/model-client.js'), 'utf8');
const memorySource = app.slice(app.indexOf('const HordeVectorMemory = {'), app.indexOf('\nfunction memorySearchTerms('));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = (data, status = 200) => ({ status, ok: status >= 200 && status < 300, text: async () => typeof data === 'string' ? data : JSON.stringify(data) });
const vector = values => ({ data: [{ embedding: values }], usage: { total_tokens: 4 } });

function fixture(responder) {
    const calls = [], diagnostics = [];
    const state = { globalSettings: { embeddingModel: 'old/model', embeddingBaseUrl: 'https://old.test/v1', embeddingApiKey: 'fixture-old', apiProvider: 'openrouter' } };
    const context = {
        state, performance, AbortController, DOMException, Error,
        console: { log() {}, warn() {}, error() {} },
        setTimeout: (fn, milliseconds) => setTimeout(fn, milliseconds === 30000 ? 20 : milliseconds), clearTimeout,
        hasEmbeddingCredentials: () => true,
        embeddingApiBase: () => state.globalSettings.embeddingBaseUrl,
        embeddingAuthHeaders: () => ({ Authorization: `Bearer ${state.globalSettings.embeddingApiKey}` }),
        document: { getElementById: () => null }, HordeDB: { get: async () => null, set: async () => {} },
        fetch: async (url, init) => { calls.push({ url, init }); return responder(url, init, calls.length); }
    };
    vm.createContext(context);
    vm.runInContext(client, context);
    vm.runInContext([
        functionSource('getEmbedding'), functionSource('cosineSimilarity'),
        functionSource('memorySearchTerms'), functionSource('memoryLexicalScore'), functionSource('memoryDedupeKey'),
        memorySource, 'globalThis.memory = HordeVectorMemory;'
    ].join('\n'), context);
    context.memory.scheduleCacheSave = () => {};
    return { context, state, calls, diagnostics, memory: context.memory,
        get: (signal = null) => context.getEmbedding('query', value => diagnostics.push(value), signal) };
}

(async () => {
    let checks = 0;
    for (const phase of ['fetch', 'body']) {
        const f = fixture(() => phase === 'fetch' ? new Promise(() => {}) : { status: 200, ok: true, text: () => new Promise(() => {}) });
        await assert.rejects(f.get(), error => error.code === 'HORDE_EMBEDDING_TIMEOUT');
        assert.equal(f.calls.length, 1, 'Timed out embedding calls must not be retried');
        assert.equal(f.calls[0].init.signal.aborted, true);
        assert.equal(f.diagnostics.length, 1);
        assert.equal(f.diagnostics[0].status, phase === 'fetch' ? 0 : 200);
        assert.equal(f.diagnostics[0].outcome, 'timeout');
        checks++;
    }
    for (const phase of ['fetch', 'body']) {
        const f = fixture(() => phase === 'fetch' ? new Promise(() => {}) : { status: 200, ok: true, text: () => new Promise(() => {}) });
        const caller = new AbortController();
        const pending = f.get(caller.signal); await tick(); caller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].init.signal.aborted, true);
        assert.equal(f.diagnostics[0].outcome, 'aborted');
        checks++;
    }
    {
        const f = fixture(() => reply(vector([0.2, 0.8]))), caller = new AbortController();
        caller.abort(); await assert.rejects(f.get(caller.signal), error => error.name === 'AbortError');
        assert.equal(f.calls.length, 0, 'A cancelled caller must not initiate a paid embedding call');
        checks++;
    }
    {
        const barrier = deferred(); const f = fixture(() => barrier.promise);
        const pending = f.get(); await tick();
        f.state.globalSettings.embeddingModel = 'new/model'; f.state.globalSettings.embeddingBaseUrl = 'https://new.test/v1';
        f.state.globalSettings.embeddingApiKey = 'fixture-new';
        barrier.resolve(reply(vector([0.25, -0.5, 1])));
        assert.deepEqual(Array.from(await pending), [0.25, -0.5, 1]);
        assert.equal(f.calls[0].url, 'https://old.test/v1/embeddings');
        assert.equal(JSON.parse(f.calls[0].init.body).model, 'old/model');
        assert.equal(f.calls[0].init.headers.Authorization, 'Bearer fixture-old');
        assert.equal(f.diagnostics[0].model, 'old/model');
        assert.equal(f.diagnostics[0].provider, 'separate embedding endpoint');
        assert.equal(f.diagnostics[0].outcome, 'ok');
        assert.equal(f.diagnostics[0].usage.total_tokens, 4);
        assert.ok(f.diagnostics[0].durationMs >= 0);
        checks++;
    }
    for (const [data, status, outcome, pattern] of [
        [{ error: { message: 'quota exhausted' } }, 429, 'http_error', /quota exhausted/],
        [{ error: { message: 'provider rejected input' } }, 200, 'provider_error', /provider rejected/],
        [{ data: [] }, 200, 'empty_vector', /no vector/],
        ['{bad JSON', 200, 'invalid_response', /invalid JSON/]
    ]) {
        const f = fixture(() => reply(data, status));
        await assert.rejects(f.get(), pattern);
        assert.equal(f.diagnostics[0].outcome, outcome);
        assert.equal(f.calls.length, 1);
        checks++;
    }
    for (const invalid of [[1, null], [1, '2'], [1, NaN], [1, Infinity]]) {
        const f = fixture(() => reply(vector(invalid)));
        await assert.rejects(f.get(), /invalid vector coordinates/);
        assert.equal(f.diagnostics[0].outcome, 'invalid_vector');
        assert.equal(f.calls.length, 1);
        checks++;
    }
    {
        const f = fixture(() => reply('{"data":[{"embedding":[1,1e400]}]}'));
        await assert.rejects(f.get(), /invalid vector coordinates/);
        assert.equal(f.diagnostics[0].outcome, 'invalid_vector');
        checks++;
    }
    {
        const f = fixture(() => reply(vector([1, 0])));
        const result = await f.context.getEmbedding('query', () => { throw Error('Bad diagnostics consumer'); });
        assert.deepEqual(Array.from(result), [1, 0], 'Diagnostics must not replace a successfully decoded vector');
        checks++;
    }
    {
        const f = fixture(() => new Promise(() => {})), caller = new AbortController();
        const pending = f.memory.getCachedEmbedding('query', value => f.diagnostics.push(value), caller.signal);
        await tick(); caller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(f.memory.isFallbackActive, false, 'Caller stop is not a provider outage');
        assert.equal(f.memory.cache.size, 0);
        assert.equal(f.calls.length, 1);
        checks++;
    }
    {
        const f = fixture(() => reply(vector([1, 0]))), caller = new AbortController();
        f.memory.init = () => new Promise(() => {});
        const pending = f.memory.getCachedEmbedding('query', null, caller.signal);
        await tick(); caller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(f.calls.length, 0, 'Cancelling cache hydration must not subsequently start a provider request');
        checks++;
    }
    {
        const f = fixture(() => new Promise(() => {}));
        const records = [{ text: 'query survived the provider timeout', importance: 0.8 }];
        const selected = await f.memory.search(records, 'query', 4, 0.35);
        assert.equal(selected[0], records[0]);
        assert.equal(f.memory.isFallbackActive, true);
        assert.equal(f.calls.length, 1, 'A search timeout must fall back lexically without a paid retry');
        checks++;
    }
    {
        const f = fixture(() => reply(vector([1, 0])));
        const key = `${f.memory.namespace()}|${f.memory.hashText('query')}`;
        f.memory.cache.set(key, [1, NaN]);
        assert.deepEqual(Array.from(await f.memory.getCachedEmbedding('query')), [1, 0]);
        assert.deepEqual(Array.from(f.memory.cache.get(key)), [1, 0]);
        assert.equal(f.calls.length, 1, 'Invalid old cache data must not poison recall');
        checks++;
    }
    {
        const barrier = deferred(), f = fixture(() => barrier.promise);
        const records = [{ text: 'query matches this stale record' }];
        const pending = f.memory.search(records, 'query', 4, 0.35);
        await tick(); f.state.globalSettings.embeddingModel = 'new/model'; barrier.resolve(reply(vector([1, 0])));
        assert.equal((await pending)[0], records[0]);
        assert.equal(f.calls.length, 1);
        assert.equal(records[0].embedding, undefined);
        assert.ok(Array.from(f.memory.cache.keys())[0].includes('|old/model|'));
        checks++;
    }
    {
        const barrier = deferred(), f = fixture((_url, _init, count) => count === 1 ? reply(vector([1, 0])) : barrier.promise);
        const records = [{ text: 'query record needs a backfill' }];
        const pending = f.memory.search(records, 'query', 4, 0.35);
        await tick(); assert.equal(f.calls.length, 2);
        f.state.globalSettings.embeddingModel = 'new/model'; barrier.resolve(reply(vector([1, 0]))); await pending;
        assert.equal(records[0].embedding, undefined, 'Changing models during backfill must not relabel the old vector');
        assert.equal(records[0].embeddingNamespace, undefined);
        checks++;
    }
    {
        const f = fixture((_url, _init, count) => count === 1 ? reply(vector([1, 0])) : new Promise(() => {}));
        const caller = new AbortController(), records = [{ text: 'query record needs a backfill' }];
        const pending = f.memory.search(records, 'query', 4, 0.35, null, 12, caller.signal);
        await tick(); assert.equal(f.calls.length, 2); caller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(records[0].embedding, undefined);
        assert.equal(f.memory.isFallbackActive, false);
        checks++;
    }
    {
        const f = fixture(() => reply(vector([1, 0])));
        f.memory.isFallbackActive = true; f.memory.fallbackUntil = Date.now() - 1;
        await f.memory.search([{ text: 'query record', embedding: [1, 0], embeddingNamespace: f.memory.namespace() }], 'query');
        assert.equal(f.calls.length, 1, 'Expired temporary keyword fallback must allow the next search to recover');
        assert.equal(f.memory.isFallbackActive, false);
        checks++;
    }
    console.log(`PASS ${checks} embedding release regressions: deadlines, fetch/body cancellation, vectors, diagnostics, cache, namespace isolation and fallback`);
})().catch(error => { console.error(error); process.exitCode = 1; });
