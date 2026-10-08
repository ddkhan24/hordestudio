/** Optional paid Worlds acceptance test. Read the key from stdin; never store it. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const model = 'google/gemma-4-31b-it';

async function readKey() {
    const input = readline.createInterface({ input: process.stdin, terminal: false });
    const key = await new Promise(resolve => input.once('line', resolve));
    input.close();
    if (!/^sk-or-v1-[a-z0-9]+$/i.test(key)) throw new Error('Expected an OpenRouter key on stdin.');
    return key;
}

(async () => {
    const key = await readKey();
    const browser = await chromium.launch(launchOptions);
    let calls = 0;
    let conservativeSpendUsd = 0;
    const statuses = [];
    try {
        const context = await browser.newContext();
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/chat/completions') {
                const body = route.request().postData() || '';
                const request = JSON.parse(body);
                if (request.model !== model) throw new Error('Unexpected model in live test.');
                if (++calls > 10 || body.length > 120_000 || Number(request.max_tokens) > 1024) {
                    throw new Error('Live-test call/token ceiling reached before another provider request.');
                }
                // Very conservative preflight: count one token per character,
                // charge 4x the published input/output prices, and reserve a
                // full max_tokens completion for every call.
                conservativeSpendUsd += 4 * ((body.length * 0.09 + Number(request.max_tokens || 1024) * 0.34) / 1_000_000);
                if (conservativeSpendUsd > 1.5) throw new Error('Live-test budget ceiling reached.');
                const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                    body
                });
                statuses.push(upstream.status);
                const responseBody = Buffer.from(await upstream.arrayBuffer());
                return route.fulfill({ status: upstream.status,
                    contentType: upstream.headers.get('content-type') || 'application/json',
                    body: responseBody });
            }
            if (url.hostname !== 'worlds2-live.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, body: '' });
            }
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://worlds2-live.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async liveModel => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.globalSettings.apiProvider = 'openrouter';
            state.apiKey = 'live-test-key-in-node-only';
            const world = { id: 'live_world_fixture', name: 'Live World Fixture', model: liveModel,
                dmPrompt: 'Narrate a grounded scene in two sentences. Use the world-state tool or tagged receipt when needed.',
                intro: '', startLocationId: 'room', maxTokens: 768,
                locations: [{ id: 'room', name: 'Room', description: 'A quiet room with a lamp.', exits: [] }],
                entities: [], hudConfig: { showClock: false, showQuests: false, showLedger: true, stats: [] },
                kernel: { enabled: true, memoryMode: 'ledger' } };
            state.worlds = [world];
            state.worldInstances = { live_world_fixture: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.history.push({ id: 'opening', role: 'dm', text: 'You enter the room.', location: 'room' });
            switchView('worldPlay');
            renderWorldPlayState();
            document.getElementById('world-user-input').value = 'I inspect the lamp without touching it.';
            await executeWorldTurn();
            const dm = [...sess.history].reverse().find(message => message.role === 'dm');
            return { lastRole: sess.history.at(-1)?.role, textLength: dm?.text?.length || 0,
                stateSource: dm?.stateSource || '', callKinds: dm?.callAudit?.calls?.map(call => call.kind) || [],
                failedAttempts: sess.worldCallDiagnostics?.length || 0,
                persisted: !!(await HordeDB.get('worldInstance:live_world_fixture'))?.sessions?.[0]?.history?.at(-1),
                receiptCount: sess.worldTurnReceipts?.length || 0 };
        }, model);
        assert.equal(errors.length, 0, errors.join('; '));
        assert.equal(result.lastRole, 'dm', 'live World turn should finish with a DM reply');
        assert(result.textLength > 15, 'live World turn should have meaningful prose');
        assert(result.persisted, 'live World turn should persist');
        assert(result.callKinds.includes('main'), 'live main call should be in turn diagnostics');
        console.log(JSON.stringify({ pass: true, model, calls, statuses, conservativeSpendUsd,
            result }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error('Live Worlds acceptance failed:', error.message); process.exitCode = 1; });
