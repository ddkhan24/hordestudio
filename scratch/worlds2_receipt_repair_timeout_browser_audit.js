/** A stalled HTTP 200 repair body must release the World UI and freeze only verified state. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const host = 'world-repair-timeout.test';

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== host) return route.abort();
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
        await page.goto(`https://${host}/`);
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async rawWorld => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const world = { ...rawWorld, id: 'repair_timeout_replay', model: 'offline/model',
                contextSize: 32768, maxTokens: 2048 };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.playerLocation = 'square';
            sess.entityStates.iven.location = 'square';
            sess.history.push({ id: 'opening', role: 'dm', text: 'Captain Iven stands in the square.', location: 'square' });
            switchView('worldPlay');
            renderWorldPlayState();
            const firstClock = JSON.stringify(sess.worldClock);
            const firstTurn = sess.turnCount;
            const originalJSON = HordeWorldModelClient.json;
            HordeWorldModelClient.json = options => originalJSON({ ...options, timeoutMs: 60 });
            const originalFetch = window.fetch;
            let mainCalls = 0;
            let repairCalls = 0;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return originalFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                if (body.stream) {
                    mainCalls++;
                    const chunk = { choices: [{ delta: { content: 'Captain Iven looks toward the road. A rider appears through the mist and raises a hand.' }, finish_reason: 'stop' }] };
                    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
                        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                repairCalls++;
                return { ok: true, status: 200, text: () => new Promise(() => {}) };
            };
            const start = performance.now();
            document.getElementById('world-user-input').value = 'I ask Iven who is approaching.';
            await executeWorldTurn();
            const elapsed = performance.now() - start;
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            if (HordeDB.writeQueue) await HordeDB.writeQueue;
            const saved = await HordeDB.get(`worldInstance:${world.id}`);
            const savedSess = saved?.sessions?.find(item => item.id === sess.id);
            const last = sess.history.at(-1);
            return { elapsed, mainCalls, repairCalls, inProgress: worldTurnInProgress,
                stopButton: document.getElementById('world-send-btn').classList.contains('stop'),
                source: sess.lastTurnStateSource, lastText: last?.text || '',
                lastRole: last?.role, repairCall: last?.callAudit?.calls?.find(call => call.kind === 'receiptRepair'),
                clockUnchanged: JSON.stringify(sess.worldClock) === firstClock, turnUnchanged: sess.turnCount === firstTurn,
                savedLastText: savedSess?.history?.at(-1)?.text || '',
                savedSource: savedSess?.lastTurnStateSource || '' };
        }, fixture);
        assert.equal(result.mainCalls, 1, JSON.stringify(result));
        assert.equal(result.repairCalls, 1, JSON.stringify(result));
        assert(result.elapsed < 5000, `the stalled body left the UI busy for ${result.elapsed}ms`);
        assert.equal(result.inProgress, false);
        assert.equal(result.stopButton, false);
        assert.equal(result.source, 'frozen_no_receipt');
        assert.equal(result.lastRole, 'dm');
        assert.match(result.lastText, /could not be verified against the world state/);
        assert.match(result.lastText, /provider timed out while verifying the reply/);
        assert.doesNotMatch(result.lastText, /rider appears through the mist/);
        assert.equal(result.repairCall?.status, 200);
        assert.equal(result.clockUnchanged, true);
        assert.equal(result.turnUnchanged, true);
        assert.equal(result.savedSource, 'frozen_no_receipt');
        assert.equal(result.savedLastText, result.lastText);
        assert.deepEqual(errors, []);
        console.log('PASS: stalled HTTP 200 receipt body times out, releases UI, and freezes unverified prose');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
