/** Hosted Worlds turns must end even when a provider only drips keepalive chunks. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const host = 'world-hosted-deadline.test';

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
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const world = {
                id: 'hosted_deadline_fixture', name: 'Hosted Deadline Fixture',
                model: 'fixture/model', contextSize: 32768, maxTokens: 1024,
                dmPrompt: 'A quiet hall.', intro: '', startLocationId: 'hall',
                locations: [{ id: 'hall', name: 'Hall', description: 'A quiet hall.', exits: [] }],
                entities: [], kernel: { enabled: true, memoryMode: 'ledger', repairMode: 'adaptive' },
                hudConfig: { showClock: false, showQuests: false, showLedger: false, stats: [] },
                gameRules: { profileId: 'adventure', modules: {
                    stats: false, health: false, conditions: false, inventory: false,
                    checks: false, commerce: false, quests: false, relationships: false,
                    schedules: false, livingWorld: false
                } }
            };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.history.push({ id: 'opening', role: 'dm', text: 'The hall is quiet.', location: 'hall' });
            switchView('worldPlay');
            renderWorldPlayState();
            const realFetch = window.fetch;
            const realSetTimeout = window.setTimeout;
            const realClearTimeout = window.clearTimeout;
            let phase = '';
            let scheduledCaps = 0;
            let clearedCaps = 0;
            const capIds = new Set();
            window.setTimeout = (callback, ms, ...args) => {
                if (ms === WORLD_HOSTED_TURN_DEADLINE_MS) {
                    scheduledCaps++;
                    const id = realSetTimeout(callback, 75, ...args);
                    capIds.add(id);
                    return id;
                }
                if (phase === 'keepalive' && ms === 45000) return realSetTimeout(callback, 30, ...args);
                if (phase === 'hosted_idle' && ms === 45000) return realSetTimeout(callback, 35, ...args);
                return realSetTimeout(callback, ms, ...args);
            };
            window.clearTimeout = id => {
                if (capIds.delete(id)) clearedCaps++;
                return realClearTimeout(id);
            };
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                if (!body.stream) throw new Error('An aborted stream must not spawn a repair request.');
                if (phase === 'keepalive') {
                    return new Response(new ReadableStream({
                        start(controller) {
                            const bytes = new TextEncoder().encode(': keepalive\n\n');
                            const interval = setInterval(() => controller.enqueue(bytes), 5);
                            options.signal?.addEventListener('abort', () => clearInterval(interval), { once: true });
                        }
                    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                return new Response(new ReadableStream({ start() {} }),
                    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
            };
            const run = async (name, provider, input) => {
                phase = name;
                state.globalSettings.apiProvider = provider;
                if (provider === 'local') state.globalSettings.localGenerationTimeoutSeconds = 0;
                document.getElementById('world-user-input').value = input;
                const before = sess.history.length;
                const capBefore = scheduledCaps;
                const clearBefore = clearedCaps;
                const started = performance.now();
                const pending = executeWorldTurn();
                if (name === 'local_user_stop') realSetTimeout(() => worldGenController?.abort(), 35);
                await Promise.race([pending, new Promise((_, reject) => realSetTimeout(() =>
                    reject(new Error(`${name} did not release the World turn`)), 1500))]);
                return {
                    elapsed: performance.now() - started,
                    caps: scheduledCaps - capBefore,
                    clears: clearedCaps - clearBefore,
                    historyBefore: before,
                    historyAfter: sess.history.length,
                    input: document.getElementById('world-user-input').value,
                    busy: worldTurnInProgress,
                    stopButton: document.getElementById('world-send-btn').classList.contains('stop'),
                    toast: document.querySelector('#toast-container .toast:last-child')?.textContent || ''
                };
            };
            const outcomes = {
                keepalive: await run('keepalive', 'openrouter', 'I listen in the hall.'),
                bodyHang: await run('body_hang', 'openrouter', 'I inspect the walls.'),
                hostedIdle: await run('hosted_idle', 'openrouter', 'I wait for an answer.'),
                localStop: await run('local_user_stop', 'local', 'I listen to the local storyteller.')
            };
            window.fetch = realFetch;
            window.setTimeout = realSetTimeout;
            window.clearTimeout = realClearTimeout;
            return outcomes;
        });
        for (const [name, outcome] of Object.entries(result)) {
            assert(outcome.elapsed < 1000, `${name} took ${outcome.elapsed}ms`);
            assert.equal(outcome.historyAfter, outcome.historyBefore, `${name} committed an unverified reply`);
            assert(outcome.input, `${name} lost the player action`);
            assert.equal(outcome.busy, false, `${name} left the composer busy`);
            assert.equal(outcome.stopButton, false, `${name} left a Stop button`);
        }
        for (const outcome of [result.keepalive, result.bodyHang]) {
            assert.equal(outcome.caps, 1);
            assert.equal(outcome.clears, 1);
            assert.match(outcome.toast, /Hosted Worlds turn exceeded 150s/i);
            assert.doesNotMatch(outcome.toast, /local timeout/i);
        }
        assert.equal(result.hostedIdle.caps, 1);
        assert.equal(result.hostedIdle.clears, 1);
        assert.match(result.hostedIdle.toast, /Hosted model sent no data for 45s/i);
        assert.doesNotMatch(result.hostedIdle.toast, /local timeout/i);
        assert.equal(result.localStop.caps, 0, 'local generation must not have a hosted hard cap');
        assert.match(result.localStop.toast, /Generation stopped/i);
        assert.deepEqual(errors, []);
        console.log('PASS: hosted keepalive/body stalls hit an absolute cap, hosted idle copy is accurate, local generation remains idle-only');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
