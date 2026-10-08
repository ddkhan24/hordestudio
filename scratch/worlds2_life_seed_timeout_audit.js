/** First-run life generation must fail open when a provider never replies. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source');
const modelClient = require('../worlds/model-client');

let aborted = false;
let timerCleared = false;
let requestedTimeout = 0;
const context = {
    AbortController, console,
    hasApiCredentials: () => true,
    authoredStartingRelationshipSeeds: () => [],
    structuredModelFor: () => 'test-model',
    openRouterModels: [],
    isLocalProvider: () => false,
    apiBase: () => 'https://provider.test',
    authHeaders: () => ({}),
    attributionHeaders: () => ({}),
    extractJSON: JSON.parse,
    setTimeout(callback, timeout) {
        requestedTimeout = timeout;
        queueMicrotask(callback);
        return 1;
    },
    clearTimeout() { timerCleared = true; },
    fetch(_url, options) {
        return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('provider request aborted'));
            });
        });
    }
};
context.HordeWorldModelClient = {
    json: options => modelClient.json({ ...options, fetcher: context.fetch })
};
const request = vm.runInNewContext(`${functionSource('requestTimelineLifePlan')}\nrequestTimelineLifePlan`, context);
const world = { name: 'Test World', description: '', locations: [], entities: [], groups: [] };
const session = { playerLocation: 'start' };
request(world, session, null, null).then(() => {
    throw new Error('A hung life-seed request unexpectedly succeeded');
}, async error => {
    assert.match(error.message, /aborted/);
    assert(aborted, 'provider request was not aborted');
    assert(timerCleared, 'life-seed timeout was not cleared');
    assert.equal(requestedTimeout, 45000, 'first-run setup has no bounded deadline');
    console.log('✓ hung provider request aborts and releases the first-run life initializer');
    let lifePrompt = '';
    context.HordeWorldModelClient.json = async options => {
        lifePrompt = options.body.messages[0].content;
        return { response: { ok: true }, data: { choices: [{ message: {
            content: '{"summary":"An outsider has no established local ties.","unfixed_home":true,"home":{},"people":[],"relationships":[]}'
        } }] } };
    };
    const emptyPlan = await request(world, session, null, { role: 'itinerant ranger' });
    assert.equal(emptyPlan.unfixed_home, true);
    assert.equal(emptyPlan.people.length, 0, 'a valid no-ties model plan was rejected into fallback');
    assert.match(lifePrompt, /zero is valid for a true outsider/i);
    console.log('✓ valid empty outsider plan is accepted instead of manufacturing prior ties');
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
