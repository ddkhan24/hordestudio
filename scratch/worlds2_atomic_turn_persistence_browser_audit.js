/** A pending World turn must not become durable through embedding telemetry. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'worlds2-atomic-turn.test') return route.abort();
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
        await page.goto('https://worlds2-atomic-turn.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const baseline = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const world = {
                id: 'atomic_turn_fixture', name: 'Atomic Turn Fixture', model: 'fixture/model',
                dmPrompt: 'Narrate the scene.', intro: '', startLocationId: 'room',
                locations: [{ id: 'room', name: 'Room', description: 'A quiet room.', exits: [] }],
                entities: [], kernel: { enabled: false }
            };
            state.worlds = [world];
            state.worldInstances = { atomic_turn_fixture: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.history.push({ id: 'opening', role: 'dm', text: 'You enter the room.', location: 'room' });
            switchView('worldPlay');
            renderWorldPlayState();
            await saveWorldsState();
            const saved = await HordeDB.get('worldInstance:atomic_turn_fixture');
            window.__atomicTurnDiagnosticCount = 0;
            window.__atomicTurnProviderPending = false;
            HordeVectorMemory.getCachedEmbedding = async (_text, onDiagnostics) => {
                if (onDiagnostics) {
                    window.__atomicTurnDiagnosticCount++;
                    onDiagnostics({ provider: 'fixture', model: 'fixture/embedding', status: 200,
                        outcome: 'ok', durationMs: 1, usage: { total_tokens: 1 } });
                }
                return [1, 0];
            };
            window.__atomicTurnOriginalFetch = window.fetch;
            window.fetch = (url, options) => {
                if (String(url).includes('/chat/completions')) {
                    window.__atomicTurnProviderPending = true;
                    return new Promise(() => {});
                }
                return window.__atomicTurnOriginalFetch(url, options);
            };
            return { historyLength: saved.sessions[0].history.length,
                turnCount: saved.sessions[0].turnCount };
        });
        // Keep all model calls pending. The diagnostic save, if any, must not
        // include the uncommitted player message or simulation changes.
        await page.evaluate(() => {
            document.getElementById('world-user-input').value = 'I wait and listen.';
            void executeWorldTurn();
        });
        await page.waitForFunction(() => window.__atomicTurnDiagnosticCount > 0
            && window.__atomicTurnProviderPending && worldTurnInProgress, { timeout: 15000 });
        const during = await page.evaluate(async () => {
            // A settings/full-state save during the pending turn must also see
            // the last committed World definition, not story-born edits.
            state.worlds[0].entities.push({ id: 'uncommitted_npc', name: 'Uncommitted',
                type: 'npc', sessionOrigin: getCurrentWorldSession().id });
            await saveState();
            if (worldSaveInFlight) await worldSaveInFlight;
            if (HordeDB.writeQueue) await HordeDB.writeQueue;
            const saved = await HordeDB.get('worldInstance:atomic_turn_fixture');
            return { historyLength: saved.sessions[0].history.length,
                turnCount: saved.sessions[0].turnCount,
                savedEntity: (await HordeDB.get('worlds'))?.[0]?.entities?.some(entity => entity.id === 'uncommitted_npc'),
                liveHistoryLength: getCurrentWorldSession().history.length,
                pending: worldTurnInProgress };
        });
        assert.equal(await page.evaluate(async () => {
            try { await exportFullBackup(); return false; }
            catch (error) { return /World turn is still generating/.test(error.message); }
        }), true, 'a full backup must not capture a half-completed turn');
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.atomic_turn_fixture?.sessions?.length, { timeout: 30000 });
        const reloaded = await page.evaluate(() => {
            const sess = state.worldInstances.atomic_turn_fixture.sessions[0];
            return { historyLength: sess.history.length, turnCount: sess.turnCount,
                lastRole: sess.history.at(-1)?.role };
        });
        assert.equal(during.pending, true);
        assert.equal(during.liveHistoryLength, baseline.historyLength + 1);
        assert.equal(during.historyLength, baseline.historyLength,
            'Embedding telemetry persisted an uncommitted World message while narration was pending');
        assert.equal(during.turnCount, baseline.turnCount,
            'Embedding telemetry persisted an uncommitted World simulation tick');
        assert.equal(during.savedEntity, false,
            'A full-state save persisted a World entity born during an uncommitted turn');
        assert.equal(reloaded.historyLength, baseline.historyLength,
            'Reload resumed a World turn that had never finished');
        assert.equal(reloaded.lastRole, 'dm');
        assert.deepEqual(errors, []);
        console.log('PASS: a pending World turn remains uncommitted during embedding diagnostics and after reload');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
