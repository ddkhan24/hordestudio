/**
 * Deterministic, offline long-campaign acceptance test. The real World turn
 * transaction, renderer and IndexedDB save run for every turn; only the model
 * endpoint is mocked. CI runs 1,110 successful turns across three timelines,
 * including 1,050 in a single long timeline.
 * WORLD_SOAK_TURNS can lower the count for a local smoke run, but fewer than
 * 1,110 successful turns are explicitly reported as a smoke test, not a full pass.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const successfulTurns = Number(process.env.WORLD_SOAK_TURNS || 1110);
const ignoreScrollForDiagnosis = process.env.WORLD_SOAK_IGNORE_SCROLL === '1';
const ignoreWindowForDiagnosis = process.env.WORLD_SOAK_IGNORE_WINDOW === '1';
const profileOnly = process.env.WORLD_SOAK_PROFILE === '1';
assert(Number.isInteger(successfulTurns) && successfulTurns >= 12 && successfulTurns <= 2000);
const distribution = profileOnly
    ? [successfulTurns - 8, 4, 4]
    : successfulTurns >= 1100
    ? [successfulTurns - 60, 30, 30]
    : [Math.floor(successfulTurns * 0.4), Math.floor(successfulTurns * 0.36)];
if (distribution.length === 2) distribution.push(successfulTurns - distribution[0] - distribution[1]);
const fixtureOrigin = 'https://worlds2-long-soak.test';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z4sAAAAASUVORK5CYII=';

function percentile(values, ratio) {
    if (!values.length) return 0;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
}

async function ready(page) {
    await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
    await page.evaluate(() => {
        clearInterval(companionAgencyTimer);
        clearInterval(companionAlwaysOnTimer);
        state.apiKey = 'offline-soak-fixture';
        if (window.HordeLabs?.policyFor) window.HordeLabs.policyFor = () => 'off';
    });
}

async function instrument(page) {
    await page.evaluate(() => {
        window.__worldSoak.saveDurations = [];
        window.__worldSoak.renderDurations = [];
        const originalSave = window.saveWorldsState;
        window.saveWorldsState = async function (...args) {
            const started = performance.now();
            try { return await originalSave(...args); }
            finally { window.__worldSoak.saveDurations.push(Math.round(performance.now() - started)); }
        };
        const originalRender = window.renderWorldPlayState;
        window.renderWorldPlayState = function (...args) {
            const started = performance.now();
            try { return originalRender(...args); }
            finally { window.__worldSoak.renderDurations.push(Math.round(performance.now() - started)); }
        };
    });
}

async function snapshot(page) {
    return page.evaluate(() => {
        const instance = state.worldInstances.worlds2_long_soak;
        const sessions = instance.sessions.map(session => {
            const actions = session.history.filter(message => message.role === 'user').map(message => message.text);
            const scenes = session.history.filter(message => message.role === 'dm' && /Scene #\d+/.test(message.text));
            return {
                id: session.id,
                name: session.name,
                count: actions.length,
                actionDuplicates: actions.length - new Set(actions).size,
                sceneCount: scenes.length,
                sceneDuplicates: scenes.length - new Set(scenes.map(message => message.text.match(/Scene #(\d+)/)?.[1])).size,
                idDuplicates: session.history.length - new Set(session.history.map(message => message.id)).size,
                firstAction: actions[0] || '',
                lastAction: actions.at(-1) || '',
                failedCalls: session.worldCallDiagnostics?.length || 0,
                bytes: JSON.stringify(session).length
            };
        });
        const container = document.getElementById('world-messages-container');
        const rendered = [...(container?.children || [])].filter(child => child.dataset.worldMessageId);
        return {
            sessions,
            totalActions: sessions.reduce((sum, session) => sum + session.count, 0),
            totalScenes: sessions.reduce((sum, session) => sum + session.sceneCount, 0),
            renderedMessages: rendered.length,
            renderedDuplicates: rendered.length - new Set(rendered.map(child => child.dataset.worldMessageId)).size,
            activeTimeline: instance.activeSessionId,
            mediaPresent: !!worldMediaSource(state.worlds.find(world => world.id === 'worlds2_long_soak'), 'soak_media'),
            inProgress: worldTurnInProgress
        };
    });
}

(async () => {
    const browser = await chromium.launch(launchOptions);
    const timings = [];
    const saveTimings = [];
    const perTurnSaveTimes = [];
    const perTurnRenderTimes = [];
    const reloadTimings = [];
    const checkpoints = [];
    const pageErrors = [];
    const unexpectedNetwork = [];
    const startedAt = Date.now();
    try {
        const context = await browser.newContext();
        await context.addInitScript(() => {
            const realFetch = window.fetch.bind(window);
            window.__worldSoak = { serial: 0, mode: 'ok', calls: 0 };
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const soak = window.__worldSoak;
                soak.calls++;
                const body = JSON.parse(options.body || '{}');
                if (soak.mode === 'failure') return new Response('Mock provider unavailable', { status: 503 });
                if (soak.mode === 'interrupt') {
                    return new Response(new ReadableStream({ start(controller) {
                        controller.error(new Error('Mock stream interrupted'));
                    } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                if (soak.mode === 'hang') {
                    return new Promise((resolve, reject) => {
                        const fail = () => reject(new DOMException('Stopped', 'AbortError'));
                        if (options.signal?.aborted) fail();
                        else options.signal?.addEventListener('abort', fail, { once: true });
                    });
                }
                const receipt = { summary: `No lasting change on turn ${soak.serial}.`,
                    scene: { player_location_id: 'room', player_location_changed: false, present_character_ids: [] },
                    events: [], entity_updates: [], state_updates: {} };
                if (!body.stream) {
                    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(receipt) } }],
                        usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 } }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                const variant = soak.mode === 'reroll' ? ' alternate' : '';
                const content = `Scene #${soak.serial}${variant}: A clear, uneventful moment.\n<world_turn_receipt>${JSON.stringify(receipt)}</world_turn_receipt>`;
                const event = { choices: [{ delta: { content }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 } };
                return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,
                    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
            };
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'worlds2-long-soak.test') {
                unexpectedNetwork.push(url.origin);
                return route.abort();
            }
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, body: '' });
            }
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(fixtureOrigin);
        await ready(page);
        await page.evaluate(source => {
            const world = { id: 'worlds2_long_soak', name: 'Long Campaign Soak', model: 'fixture/offline',
                dmPrompt: 'Narrate the scene.', intro: '', startLocationId: 'room',
                locations: [{ id: 'room', name: 'Room', description: 'A quiet room.', exits: [],
                    visuals: { backgroundAssetId: 'soak_media' } }],
                entities: [], hudConfig: { stats: [] }, gameRules: { profileId: 'pure_narrative' },
                kernel: { enabled: true, memoryMode: 'ledger' }, worldAgent: { enabled: false },
                presentation: { enabled: true, mode: 'cinematic' }, mediaAssets: [] };
            state.worlds = [world];
            state.worldInstances = { worlds2_long_soak: { activeSessionId: 'soak_a', sessions: [{
                id: 'soak_a', name: 'Main Timeline', history: [], playerLocation: 'room', entityStates: {}, setupComplete: true
            }] } };
            state.activeWorldId = world.id;
            addWorldMediaAsset(world, source, 'background', 'Soak scene');
            world.mediaAssets[0].id = 'soak_media';
            const session = prepareCurrentWorldSession();
            session.history.push({ id: 'opening_a', role: 'dm', text: 'Opening scene.', location: 'room' });
            switchView('worldPlay');
            renderWorldPlayState();
        }, png);
        await page.evaluate(() => saveWorldsState());
        await instrument(page);

        let serial = 0;
        for (let branch = 0; branch < distribution.length; branch++) {
            if (branch) {
                await page.evaluate(branchIndex => {
                    const world = state.worlds.find(item => item.id === 'worlds2_long_soak');
                    const session = resetWorldTimeline(world, { id: `soak_${branchIndex + 1}`, name: `Branch ${branchIndex + 1}` });
                    session.setupComplete = true;
                    session.history.push({ id: `opening_${branchIndex + 1}`, role: 'dm', text: 'Opening scene.', location: 'room' });
                    const instance = state.worldInstances.worlds2_long_soak;
                    instance.sessions.push(session);
                    instance.activeSessionId = session.id;
                    resetWorldInsightFilters();
                    renderWorldPlayState();
                    return saveWorldsState();
                }, branch);
            }
            const endSerial = serial + distribution[branch];
            while (serial < endSerial) {
                const batchEnd = Math.min(endSerial, serial + 20);
                const batch = await page.evaluate(async ({ first, last }) => {
                    const times = [];
                    const saveTimes = [];
                    const renderTimes = [];
                    for (let current = first; current < last; current++) {
                        window.__worldSoak.serial = current;
                        window.__worldSoak.mode = 'ok';
                        document.getElementById('world-user-input').value = `Action #${current}`;
                        const started = performance.now();
                        const savesBefore = window.__worldSoak.saveDurations.length;
                        const rendersBefore = window.__worldSoak.renderDurations.length;
                        await executeWorldTurn();
                        times.push(Math.round(performance.now() - started));
                        saveTimes.push(window.__worldSoak.saveDurations.slice(savesBefore)
                            .reduce((sum, value) => sum + value, 0));
                        renderTimes.push(window.__worldSoak.renderDurations.slice(rendersBefore)
                            .reduce((sum, value) => sum + value, 0));
                        const session = getCurrentWorldSession();
                        if (session.history.at(-2)?.text !== `Action #${current}`
                            || !session.history.at(-1)?.text?.includes(`Scene #${current}`)) {
                            throw new Error(`Turn ${current} did not commit exactly once: ${JSON.stringify({
                                last: session.history.slice(-2).map(message => ({ role: message.role, text: String(message.text || '').slice(0, 160) })),
                                input: document.getElementById('world-user-input')?.value,
                                toast: document.querySelector('#toast-container')?.textContent?.slice(-500),
                                calls: window.__worldSoak.calls
                            })}`);
                        }
                    }
                    const container = document.getElementById('world-messages-container');
                    return { times, saveTimes, renderTimes, calls: window.__worldSoak.calls,
                        rendered: [...container.children].filter(node => node.dataset.worldMessageId).length,
                        atBottom: container.scrollHeight - container.scrollTop - container.clientHeight < 120,
                        scroll: [container.scrollHeight, container.scrollTop, container.clientHeight],
                        visible: getComputedStyle(container).display };
                }, { first: serial, last: batchEnd });
                timings.push(...batch.times);
                perTurnSaveTimes.push(...batch.saveTimes);
                perTurnRenderTimes.push(...batch.renderTimes);
                if (!ignoreWindowForDiagnosis) {
                    assert(batch.rendered <= 240, `transcript DOM grew to ${batch.rendered} rendered messages`);
                }
                if (!ignoreScrollForDiagnosis) {
                    assert(batch.atBottom, `transcript lost the newest message after turn ${batchEnd - 1}: ${JSON.stringify(batch)}`);
                }
                serial = batchEnd;
                if (Date.now() - startedAt > 15 * 60 * 1000) {
                    throw new Error(`Long-campaign soak exceeded 15 minutes at turn ${serial}`);
                }
                if (serial % 100 < 20 || serial === endSerial) {
                    const state = await snapshot(page);
                    assert.equal(state.renderedDuplicates, 0, 'rendered transcript contains duplicate messages');
                    assert.equal(state.totalActions, serial, 'committed action count differs from successful turns');
                    assert.equal(state.totalScenes, serial, 'committed scene count differs from successful turns');
                    checkpoints.push({ turns: serial, bytes: state.sessions.reduce((sum, item) => sum + item.bytes, 0),
                        p95Ms: percentile(timings.slice(-100), 0.95) });
                    if (serial === 100 || serial === 500 || serial === distribution[0]) {
                        const saveMs = await page.evaluate(async () => {
                            const started = performance.now();
                            await saveWorldsState();
                            return Math.round(performance.now() - started);
                        });
                        saveTimings.push({ turns: serial, ms: saveMs });
                    }
                    console.log(`soak ${serial}/${successfulTurns}: ${state.totalActions} actions, ${state.renderedMessages} DOM messages, ${checkpoints.at(-1).bytes} session bytes`);
                }
            }
            if (branch === 0) {
                const disruption = await page.evaluate(async lastSerial => {
                    const session = getCurrentWorldSession();
                    const before = session.history.length;
                    window.__worldSoak.serial = lastSerial;
                    window.__worldSoak.mode = 'failure';
                    document.getElementById('world-user-input').value = 'Failed action';
                    await executeWorldTurn();
                    const failed = { stable: session.history.length === before,
                        restoredInput: document.getElementById('world-user-input').value === 'Failed action',
                        diagnostic: session.worldCallDiagnostics?.at(-1)?.calls?.some(call => call.status === 503) };
                    window.__worldSoak.mode = 'interrupt';
                    document.getElementById('world-user-input').value = 'Interrupted action';
                    await executeWorldTurn();
                    const interrupted = { stable: session.history.length === before,
                        diagnostic: session.worldCallDiagnostics?.at(-1)?.reason === 'Failed turn' };
                    window.__worldSoak.mode = 'hang';
                    document.getElementById('world-user-input').value = 'Cancelled action';
                    const pending = executeWorldTurn();
                    await new Promise(resolve => setTimeout(resolve, 30));
                    worldGenController.abort();
                    await pending;
                    const stopped = { stable: session.history.length === before,
                        diagnostic: session.worldCallDiagnostics?.at(-1)?.reason === 'Stopped turn' };
                    window.__worldSoak.mode = 'reroll';
                    window.__worldSoak.serial = lastSerial;
                    await executeWorldTurn(true);
                    const latest = session.history.at(-1);
                    const reroll = { stable: session.history.length === before,
                        takes: latest.versions?.length, selected: latest.currentVersion,
                        currentText: latest.text, priorText: latest.versions?.[0] };
                    const prior = [...document.querySelectorAll('#world-messages-container .prev-ver')].at(-1);
                    if (prior) await prior.onclick();
                    reroll.priorSelected = latest.currentVersion;
                    const next = [...document.querySelectorAll('#world-messages-container .next-ver')].at(-1);
                    if (next) await next.onclick();
                    reroll.alternateSelected = latest.currentVersion;
                    window.__worldSoak.mode = 'ok';
                    return { failed, interrupted, stopped, reroll };
                }, serial - 1);
                assert.deepEqual(disruption.failed, { stable: true, restoredInput: true, diagnostic: true });
                assert.deepEqual(disruption.interrupted, { stable: true, diagnostic: true });
                assert.deepEqual(disruption.stopped, { stable: true, diagnostic: true });
                assert.equal(disruption.reroll.stable, true);
                assert.equal(disruption.reroll.takes, 2);
                assert.equal(disruption.reroll.selected, 1);
                assert.equal(disruption.reroll.priorSelected, 0);
                assert.equal(disruption.reroll.alternateSelected, 1);
                assert(disruption.reroll.currentText.includes('alternate'));
                assert(!disruption.reroll.priorText.includes('alternate'));
                if (distribution[0] >= 200) {
                    // An asynchronous scene arriving while a player is reading
                    // an old part of a long transcript must not steal their
                    // scroll position or cause the DOM window to grow forever.
                    const olderReading = await page.evaluate(async () => {
                        const session = getCurrentWorldSession();
                        const world = state.worlds.find(item => item.id === 'worlds2_long_soak');
                        const oldMessage = session.history.find(message => message.text === 'Action #50');
                        if (!oldMessage || !jumpToWorldMessage(oldMessage.id)) throw new Error('Could not open old transcript scene');
                        const container = document.getElementById('world-messages-container');
                        const oldNode = [...container.children].find(node => node.dataset.worldMessageId === oldMessage.id);
                        const topBefore = oldNode.getBoundingClientRect().top;
                        const before = session.history.length;
                        addWorldMessage('dm', 'Background scene notice.', { deferPersist: true }, session, world);
                        renderWorldPlayState();
                        const anchored = [...container.children].find(node => node.dataset.worldMessageId === oldMessage.id);
                        const result = {
                            lengthAdded: session.history.length === before + 1,
                            anchorDelta: anchored ? Math.abs(anchored.getBoundingClientRect().top - topBefore) : Infinity,
                            rendered: [...container.children].filter(node => node.dataset.worldMessageId).length,
                            jumpAvailable: !!container.querySelector('[data-world-window-action="latest"]')
                        };
                        session.history.pop();
                        await saveWorldsState();
                        renderWorldPlayState();
                        container.querySelector('[data-world-window-action="latest"]')?.click();
                        return result;
                    });
                    assert.equal(olderReading.lengthAdded, true);
                    assert(olderReading.anchorDelta <= 3, `older transcript anchor moved ${olderReading.anchorDelta}px`);
                    assert(olderReading.rendered <= 240, `reading older messages rendered ${olderReading.rendered} nodes`);
                    assert.equal(olderReading.jumpAvailable, true);
                }
            }
            if (branch < distribution.length - 1) {
                const begin = Date.now();
                await page.reload();
                await ready(page);
                await page.waitForFunction(() => state.worldInstances?.worlds2_long_soak?.sessions?.length, { timeout: 30000 });
                await instrument(page);
                await page.evaluate(() => { switchView('worldPlay'); renderWorldPlayState(); });
                reloadTimings.push(Date.now() - begin);
                const afterReload = await snapshot(page);
                assert.equal(afterReload.totalActions, serial);
                assert.equal(afterReload.totalScenes, serial);
                assert(afterReload.mediaPresent, 'scene image disappeared on reload');
                assert(afterReload.sessions.every(session => !session.idDuplicates && !session.actionDuplicates && !session.sceneDuplicates));
            }
        }

        // Delete and replay the last action using the same UI confirmation path
        // a player uses. The deletion must rewind state and never duplicate it.
        await page.evaluate(async lastSerial => {
            const session = getCurrentWorldSession();
            const before = session.history.length;
            const userId = session.history.at(-2).id;
            const userRow = [...document.querySelectorAll('#world-messages-container [data-world-message-id]')]
                .find(node => node.dataset.worldMessageId === userId);
            if (!userRow) throw new Error('Latest user action was not rendered');
            userRow.querySelector('.msg-del-btn').click();
            document.getElementById('confirm-ok-btn').click();
            await new Promise(resolve => setTimeout(resolve, 80));
            if (session.history.length !== before - 2) throw new Error('Delete did not trim the user action and its scene');
            window.__worldSoak.serial = lastSerial;
            window.__worldSoak.mode = 'ok';
            document.getElementById('world-user-input').value = `Action #${lastSerial}`;
            await executeWorldTurn();
            if (session.history.length !== before) throw new Error('Replay produced the wrong number of messages');
        }, successfulTurns - 1);

        const final = await snapshot(page);
        const sizeProfile = await page.evaluate(() => {
            const session = state.worldInstances.worlds2_long_soak.sessions[0];
            const size = value => JSON.stringify(value)?.length || 0;
            const topLevel = Object.entries(session).map(([field, value]) => ({ field, bytes: size(value) }))
                .sort((a, b) => b.bytes - a.bytes).slice(0, 12);
            const historyFields = {};
            const checkpointFields = {};
            session.history.forEach(message => Object.entries(message).forEach(([field, value]) => {
                historyFields[field] = (historyFields[field] || 0) + size(value);
            }));
            session.history.forEach(message => {
                if (!message.turnSnapshot?.session) return;
                Object.entries(message.turnSnapshot.session).forEach(([field, value]) => {
                    checkpointFields[field] = (checkpointFields[field] || 0) + size(value);
                });
            });
            return { topLevel, historyFields: Object.entries(historyFields)
                .map(([field, bytes]) => ({ field, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, 12),
            checkpointFields: Object.entries(checkpointFields)
                .map(([field, bytes]) => ({ field, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, 12) };
        });
        const compressionProfile = profileOnly ? await page.evaluate(async () => {
            const instance = state.worldInstances.worlds2_long_soak;
            const json = JSON.stringify(instance);
            if (typeof CompressionStream !== 'function') return { supported: false, sourceBytes: json.length };
            const started = performance.now();
            const compressed = await new Response(new Blob([json]).stream()
                .pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
            return { supported: true, sourceBytes: json.length, compressedBytes: compressed.byteLength,
                ratio: Math.round((compressed.byteLength / json.length) * 1000) / 1000,
                durationMs: Math.round(performance.now() - started) };
        }) : null;
        assert.equal(final.totalActions, successfulTurns);
        assert.equal(final.totalScenes, successfulTurns);
        assert.equal(final.renderedDuplicates, 0);
        assert.equal(final.inProgress, false);
        assert.equal(final.mediaPresent, true);
        assert(final.sessions.every(session => !session.idDuplicates && !session.actionDuplicates && !session.sceneDuplicates),
            JSON.stringify(final.sessions));
        assert.deepEqual(final.sessions.map(session => session.count), distribution);
        assert.equal(final.sessions[0].failedCalls, 3);
        const bytes = final.sessions.reduce((sum, session) => sum + session.bytes, 0);
        if (successfulTurns >= 1100 && !profileOnly) {
            assert(bytes < 20_000_000,
                `Minimal 1,000-turn campaign consumed ${bytes} uncompressed session bytes before media`);
        }
        assert(Math.max(...reloadTimings) < 30000, `reload took ${Math.max(...reloadTimings)}ms`);
        // The first 100 turns include browser warm-up and tiny records. Compare
        // a settled early window with the tail of the same 1,050-turn branch.
        const early = percentile(timings.slice(distribution[0] >= 200 ? 100 : 0,
            distribution[0] >= 200 ? 200 : distribution[0]), 0.95);
        const late = percentile(timings.slice(Math.max(0, distribution[0] - 100), distribution[0]), 0.95);
        assert(late < Math.max(500, early * 8), `late p95 turn time regressed: ${early}ms → ${late}ms`);
        assert.deepEqual(pageErrors, []);

        await page.reload();
        await ready(page);
        await page.waitForFunction(() => state.worldInstances?.worlds2_long_soak?.sessions?.length === 3, { timeout: 30000 });
        await page.evaluate(() => { switchView('worldPlay'); renderWorldPlayState(); });
        const restored = await snapshot(page);
        assert.deepEqual(restored.sessions.map(session => session.count), distribution);
        assert(restored.sessions.every(session => !session.idDuplicates && !session.actionDuplicates && !session.sceneDuplicates));
        assert.equal(restored.sessions[0].failedCalls, 3);
        assert.equal(restored.mediaPresent, true);
        const diagnosticOnly = profileOnly || ignoreScrollForDiagnosis || ignoreWindowForDiagnosis;
        const report = { test: diagnosticOnly ? 'diagnostic only'
            : successfulTurns >= 1100 ? 'full acceptance' : 'smoke only',
            successfulTurns, timelines: distribution, elapsedMs: Date.now() - startedAt,
            turnP50Ms: percentile(timings, 0.5), turnP95Ms: percentile(timings, 0.95),
            saveP50Ms: percentile(perTurnSaveTimes, 0.5), saveP95Ms: percentile(perTurnSaveTimes, 0.95),
            renderP50Ms: percentile(perTurnRenderTimes, 0.5), renderP95Ms: percentile(perTurnRenderTimes, 0.95),
            earlyP95Ms: early, lateP95Ms: late, reloadMs: reloadTimings,
            sessionBytes: bytes, renderedMessages: final.renderedMessages,
            saveTimings, sizeProfile, compressionProfile,
            blockedExternalOrigins: [...new Set(unexpectedNetwork)], checkpoints };
        console.log(`${diagnosticOnly ? 'DIAGNOSTIC' : 'PASS'}: Worlds long-campaign ${report.test}: ${JSON.stringify(report)}`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
