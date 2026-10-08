/** Model transport outcome contract shared by Worlds turn and background calls. */
'use strict';
const assert = require('node:assert/strict');
const client = require('../worlds/model-client.js');

(async () => {
    const body = { model: 'fixture/model', messages: [{ role: 'user', content: 'hello' }] };
    const observed = [];
    const success = await client.json({ url: 'https://fixture.test/chat/completions', body,
        fetcher: async (url, init) => {
            assert.equal(url, 'https://fixture.test/chat/completions');
            assert.deepEqual(JSON.parse(init.body), body);
            return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 4 } }), { status: 200 });
        }, onSettled: detail => observed.push(detail) });
    assert.equal(success.data.choices[0].message.content, 'hi');
    assert.equal(observed.at(-1).outcome, 'ok');
    assert.equal(observed.at(-1).usage.prompt_tokens, 4);

    const rejected = await client.json({ url: 'https://fixture.test/chat/completions', body,
        fetcher: async () => new Response(JSON.stringify({ error: { message: 'bad model' } }), { status: 400 }),
        onSettled: detail => observed.push(detail) });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.data.error.message, 'bad model');
    assert.equal(observed.at(-1).outcome, 'http_error');

    await assert.rejects(client.json({ url: 'https://fixture.test/chat/completions', body,
        fetcher: async () => new Response('not json', { status: 200 }),
        onSettled: detail => observed.push(detail) }), error => error.code === 'WORLD_MODEL_INVALID_JSON');
    assert.equal(observed.at(-1).outcome, 'invalid_json');
    assert.equal(observed.at(-1).status, 200);

    const aborted = new Error('stopped');
    aborted.name = 'AbortError';
    await assert.rejects(client.json({ url: 'https://fixture.test/chat/completions', body,
        fetcher: async () => { throw aborted; }, onSettled: detail => observed.push(detail) }), /stopped/);
    assert.equal(observed.at(-1).outcome, 'aborted');

    // Reproduce the hosted failure exactly: headers arrived with HTTP 200,
    // but the non-streaming repair body never completed. Neither a provider
    // nor a browser that ignores fetch abort may hold the turn indefinitely.
    let stalledSignal;
    const stalledResponse = { ok: true, status: 200, text: () => new Promise(() => {}) };
    const started = Date.now();
    await assert.rejects(client.json({ url: 'https://fixture.test/chat/completions', body,
        timeoutMs: 30,
        fetcher: async (_url, init) => { stalledSignal = init.signal; return stalledResponse; },
        onSettled: detail => observed.push(detail) }),
    error => error.code === 'WORLD_MODEL_TIMEOUT');
    assert(Date.now() - started < 2000, 'a stalled HTTP 200 body must settle promptly');
    assert.equal(stalledSignal.aborted, true);
    assert.equal(observed.at(-1).outcome, 'timeout');
    assert.equal(observed.at(-1).status, 200);

    // The existing turn idle timer aborts its controller. The await itself
    // must reject even when response.text() fails to observe that abort.
    const idleController = new AbortController();
    const idleRead = client.json({ url: 'https://fixture.test/chat/completions', body,
        init: { signal: idleController.signal },
        fetcher: async () => stalledResponse,
        onSettled: detail => observed.push(detail) });
    setTimeout(() => idleController.abort(), 20);
    await assert.rejects(idleRead, error => error.name === 'AbortError');
    assert.equal(observed.at(-1).outcome, 'aborted');
    assert.equal(observed.at(-1).status, 200);

    const stream = await client.stream({ url: 'https://fixture.test/chat/completions', body,
        fetcher: async () => new Response('data: ok\n\n', { status: 200 }) });
    assert.equal(stream.response.status, 200);
    assert(Number.isFinite(stream.startedAt));
    assert.equal(client.decodeCompletionBody('{"choices":[{"message":{"content":"hi"}}]}')
        .choices[0].message.content, 'hi');
    assert.throws(() => client.decodeCompletionBody('{bad'), error =>
        error.code === 'WORLD_MODEL_INVALID_COMPLETION');
    assert.throws(() => client.decodeCompletionBody('{"choices":[]}'), error =>
        error.code === 'WORLD_MODEL_EMPTY_COMPLETION');
    assert.throws(() => client.decodeCompletionBody('{"error":{"message":"blocked"}}'), error =>
        error.code === 'WORLD_MODEL_PROVIDER_ERROR' && /blocked/.test(error.message));
    const stalledStream = new AbortController();
    const neverHeaders = client.stream({ url: 'https://fixture.test/chat/completions', body,
        init: { signal: stalledStream.signal }, fetcher: () => new Promise(() => {}) });
    setTimeout(() => stalledStream.abort(), 20);
    await assert.rejects(neverHeaders, error => error.name === 'AbortError');
    const stalledChunk = new AbortController();
    const neverBody = client.readChunk({ read: () => new Promise(() => {}) }, stalledChunk.signal);
    setTimeout(() => stalledChunk.abort(), 20);
    await assert.rejects(neverBody, error => error.name === 'AbortError');
    const stalledErrorText = new AbortController();
    const neverError = client.readText({ text: () => new Promise(() => {}) }, stalledErrorText.signal);
    setTimeout(() => stalledErrorText.abort(), 20);
    await assert.rejects(neverError, error => error.name === 'AbortError');
    let streamFailure = null;
    await assert.rejects(client.stream({ url: 'https://fixture.test/chat/completions', body,
        fetcher: async () => { throw aborted; }, onFailure: detail => { streamFailure = detail; } }), /stopped/);
    assert.equal(streamFailure.outcome, 'aborted');
    assert.equal(observed.length, 6, 'each JSON attempt produces exactly one diagnostic');
    const callbackSafe = await client.json({ url: 'https://fixture.test/chat/completions', body,
        fetcher: async () => new Response('{"choices":[]}', { status: 200 }),
        onSettled: () => { throw new Error('diagnostics unavailable'); } });
    assert.equal(callbackSafe.response.status, 200, 'a telemetry failure must not discard a valid reply');
    console.log('✓ World model client bounds stalled HTTP 200 bodies and reports each outcome once');
})().catch(error => { console.error(error); process.exitCode = 1; });
