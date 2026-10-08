'use strict';

const assert = require('node:assert/strict');
const { markResponseHeaders, markResponseComplete, summarizeTurnTiming } = require('./worlds_live_timing');

async function run() {
    // A successful streaming response announces its headers before its body
    // has finished; the recorded `ms` must not claim the call has completed.
    const record = { startedAt: Date.now(), headersMs: null, bodyCompleteMs: null, ms: null };
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('data: first\n\n'));
            setTimeout(() => {
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                controller.close();
            }, 80);
        }
    });
    markResponseHeaders(record);
    assert.equal(record.ms, null);
    assert.equal(record.bodyCompleteMs, null);
    await new Response(body).text();
    markResponseComplete(record);
    assert.ok(record.ms >= 60, `body duration must include delayed stream; got ${record.ms}ms`);
    assert.ok(record.ms > record.headersMs, 'full body must take longer than headers');
    assert.equal(record.bodyCompleteMs, record.ms);

    // These values are from the existing paid regression report: nearly all
    // observed wall time was provider generation, not UI processing.
    assert.deepEqual(summarizeTurnTiming(18449, {
        calls: [{ durationMs: 18357 }]
    }), { wallMs: 18449, modelMs: 18357, otherMs: 92 });
    assert.deepEqual(summarizeTurnTiming(20627, {
        calls: [{ durationMs: 19163 }, { durationMs: 1358 }]
    }), { wallMs: 20627, modelMs: 20521, otherMs: 106 });
    console.log('Worlds live timing regression passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
