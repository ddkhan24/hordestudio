'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const modelClient = require('../worlds/model-client.js');
const app = fs.readFileSync('app.js', 'utf8');
const start = app.indexOf('async function executeIsolatedMultiplayerTurn(');
const end = app.indexOf('\nfunction buildWorldMultiplayerSnapshot(', start);
assert.ok(start >= 0 && end > start);
const runtime = { console, state: { globalSettings: { defaultModel: 'audit' } },
    HordeWorldModelClient: modelClient,
    normalizedProviderId: value => value,
    providerHasCredentials: () => true, providerDisplayName: value => value,
    providerApiBase: () => 'https://audit.invalid', providerAuthHeaders: () => ({}), providerAttributionHeaders: () => ({}),
    sanitizeMessagesForProvider: value => value, multiplayerMessageText: value => value,
    parseMultiplayerReceipt: value => JSON.parse(value), humanizeApiError: value => value };
runtime.window = runtime;
vm.createContext(runtime);
vm.runInContext(app.slice(start, end), runtime);
const campaign = { provider: 'audit', snapshot: { history: [] }, system: {}, model: 'audit' };

async function main() {
    const previous = global.fetch;
    try {
        global.fetch = async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) });
        await assert.rejects(runtime.executeIsolatedMultiplayerTurn(campaign, 'Act', { timeoutMs: 15 }),
            error => error.code === 'WORLD_MODEL_TIMEOUT', 'a stalled HTTP200 body must release the host turn');
        const bodies = [];
        global.fetch = async (_, options) => {
            bodies.push(JSON.parse(options.body));
            if (bodies.length === 1) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'response_format unsupported' } }) };
            return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
                narration: 'The party enters the keep.', summary: 'Enter', operations: [], checks: []
            }) } }] }) };
        };
        const result = await runtime.executeIsolatedMultiplayerTurn(campaign, 'Act', { timeoutMs: 100 });
        assert.equal(result.text, 'The party enters the keep.');
        assert.ok(bodies[0].response_format);
        assert.ok(!bodies[1].response_format, 'bounded transport must preserve compatible-provider retries');
        const controller = new AbortController(); controller.abort();
        await assert.rejects(runtime.executeIsolatedMultiplayerTurn(campaign, 'Act', { signal: controller.signal }),
            error => error.name === 'AbortError');
    } finally { global.fetch = previous; }
    console.log('multiplayer_model_deadline_regression: ok');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
