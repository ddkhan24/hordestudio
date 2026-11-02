/** Live local Ollama test through the actual browser World turn pipeline.
 * Usage: node scratch/world_live_reliability_audit.js [normal attempts] [rerolls]
 * No model download or paid endpoint is used. Results are local and untracked.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const normalCount = Math.max(0, Number(process.argv[2] ?? 1) || 0);
const rerollCount = Math.max(0, Number(process.argv[3]) || 0);
const model = process.env.HORDE_LIVE_MODEL || 'ministral-3:14b';
const resultPath = path.join(root, 'scratch', 'world-live-results.json');

(async () => {
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext();
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1' || url.port !== '11434') return route.abort();
        if (url.pathname.startsWith('/v1/')) return route.continue();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
            return route.fulfill({ status: 404, body: '' });
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(900000);
    const pageErrors = [];
    const providerTraffic = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
        if (['error', 'warning'].includes(message.type())) process.stdout.write(`browser ${message.type()}: ${message.text().slice(0, 240)}\n`);
    });
    page.on('request', request => {
        if (request.url().includes('/v1/chat/completions')) {
            providerTraffic.push({ request: request.postData() || '', response: '', status: null });
            process.stdout.write(`request ${request.method()} ${new URL(request.url()).pathname}\n`);
        }
    });
    page.on('response', async response => {
        if (!response.url().includes('/v1/chat/completions')) return;
        const entry = providerTraffic.find(item => item.status === null);
        if (!entry) return;
        entry.status = response.status();
        try { entry.response = await response.text(); } catch (error) { entry.response = String(error); }
    });
    await page.goto('http://127.0.0.1:11434/');
    await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
    await page.evaluate(modelId => {
        clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
        state.apiKey = 'ollama';
        state.globalSettings.apiProvider = 'local';
        state.globalSettings.localBaseUrl = 'http://127.0.0.1:11434/v1';
        const world = {
            id: 'live_reliability_fixture', name: 'House and Garden', model: modelId,
            contextSize: 32768, maxTokens: 3072, temp: 0.2,
            supportedParams: ['temperature', 'max_tokens', 'top_p'],
            dmPrompt: 'Describe only observed, validated actions. Keep each answer brief.',
            intro: '', startLocationId: 'hall',
            locations: [
                { id: 'hall', name: 'Hall', mapType: 'room', exits: ['to Kitchen', 'to Garden'] },
                { id: 'kitchen', name: 'Kitchen', mapType: 'room', exits: ['to Hall'] },
                { id: 'garden', name: 'Garden', mapType: 'outdoor', exits: ['to Hall'] }
            ],
            entities: [
                { id: 'linda', name: 'Linda', type: 'npc', startLocation: 'hall', persona: 'Friendly resident' },
                { id: 'marc', name: 'Marc', type: 'npc', startLocation: 'kitchen', persona: 'Cook' },
                { id: 'ena', name: 'Ena', type: 'npc', startLocation: 'garden', persona: 'Gardener' },
                { id: 'letter', name: 'Letter', type: 'item', startLocation: 'hall' }
            ],
            kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true,
                sceneDraftProtocol: 'scene_draft_v3' },
            hudConfig: { startTimeHours: 9, startTimeMinutes: 0, timeStep: 5 }
        };
        state.worlds = [world];
        state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
        state.activeWorldId = world.id;
        const sess = prepareCurrentWorldSession();
        sess.setupComplete = true;
        sess.inventory = ['letter'];
        sess.outfit = 'linen shirt, blue coat';
        sess.entityStates.linda.location = 'hall';
        sess.entityStates.marc.location = 'kitchen';
        sess.entityStates.ena.location = 'garden';
        sess.history.push({ id: 'opening', role: 'dm', text: 'Linda waits with you in the hall.', location: 'hall' });
        switchView('worldPlay'); renderWorldPlayState();
        window.__liveInitial = captureWorldTurnState(world, sess);
        window.__linkedDiagnostics = [];
        const originalLinked = HordeLinkedWorldActions.executeLinkedActions;
        HordeLinkedWorldActions.executeLinkedActions = (plan, targetWorld, targetSession, options) => {
            const working = options?.workingState;
            window.__linkedDiagnostics.push({
                actions: safeJsonClone(plan.actions), narrative: safeJsonClone(plan.narrative),
                present: (targetWorld.entities || []).filter(entity => entity.type === 'npc'
                    && working.getEntity(entity.id).state?.location === working.getSession('playerLocation'))
                    .map(entity => entity.id),
                location: working.getSession('playerLocation'),
                local: plan.actions.map(action => HordeWorldSceneDraft.localInteraction(action.request, {
                    inventory: working.getSession('inventory') || [],
                    actors: (targetWorld.entities || []).filter(entity => entity.type === 'npc'),
                    present: (targetWorld.entities || []).filter(entity => entity.type === 'npc'
                        && working.getEntity(entity.id).state?.location === working.getSession('playerLocation'))
                        .map(entity => entity.id) }))
            });
            return originalLinked(plan, targetWorld, targetSession, options);
        };
    }, model);
    const frameDiagnostic = await page.evaluate(() => {
        const world = state.worlds.find(item => item.id === state.activeWorldId);
        const sess = getCurrentWorldSession();
        const present = buildWorldSceneFrame(world, sess).present_character_ids;
        return { present, location: sess.playerLocation,
            localInteraction: HordeWorldSceneDraft.localInteraction('I wave to Linda.', {
                present, actors: sessionNpcs(world, sess).map(npc => ({ id: npc.id, name: npc.name })),
                inventory: sess.inventory || [] }) };
    });
    process.stdout.write(`frame ${JSON.stringify(frameDiagnostic)}\n`);
    const outcomes = [];
    process.stdout.write('browser fixture ready\n');
    const inputs = ['I wave to Linda.', 'I show Linda the letter.', 'I take off my blue coat.',
        'I ask Linda how she is.', 'I nod and ask Linda to wait.'];
    for (let attempt = 0; attempt < normalCount; attempt++) {
        const input = inputs[attempt % inputs.length];
        const startedAt = Date.now();
        process.stdout.write(`starting normal ${attempt + 1}: ${input}\n`);
        const result = await page.evaluate(async input => {
            const world = state.worlds.find(item => item.id === state.activeWorldId);
            const sess = getCurrentWorldSession();
            restoreWorldTurnState(world, sess, window.__liveInitial);
            sess.history = [{ id: 'opening', role: 'dm', text: 'Linda waits with you in the hall.', location: 'hall' }];
            window.__linkedDiagnostics = [];
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            return { input, text: sess.history.at(-1)?.text || '',
                source: sess.history.at(-1)?.stateSource || '',
                audit: safeJsonClone(sess.lastTurnAudit),
                state: { location: sess.playerLocation, outfit: sess.outfit,
                    inventory: safeJsonClone(sess.inventory),
                    npcLocations: Object.fromEntries(['linda','marc','ena'].map(id => [id,sess.entityStates[id]?.location])),
                    worldStateVersion: sess.worldStateVersion },
                historyLength: sess.history.length,
                linkedDiagnostics: safeJsonClone(window.__linkedDiagnostics),
                error: document.querySelector('#world-turn-error')?.textContent || '' };
        }, input);
        outcomes.push({ kind: 'normal', attempt: attempt + 1, model, elapsedMs: Date.now() - startedAt, ...result });
        fs.writeFileSync(resultPath, JSON.stringify({ model, normalCount, rerollCount, outcomes, pageErrors,
            providerTraffic }, null, 2));
        process.stdout.write(`normal ${attempt + 1}/${normalCount}: ${result.source || 'unknown'} ${Date.now() - startedAt}ms\n`);
    }
    let seedAttemptCount = 0;
    if (rerollCount) {
        let seeded = false;
        while (!seeded && seedAttemptCount < 20) {
            seedAttemptCount++;
            seeded = await page.evaluate(async () => {
                const world = state.worlds.find(item => item.id === state.activeWorldId);
                const sess = getCurrentWorldSession();
                restoreWorldTurnState(world, sess, window.__liveInitial);
                sess.history = [{ id: 'opening', role: 'dm', text: 'Linda waits with you in the hall.', location: 'hall' }];
                document.getElementById('world-user-input').value = 'I wave to Linda.';
                await executeWorldTurn();
                if (!['inline_receipt', 'repair_scene_draft', 'linked_actions'].includes(sess.history.at(-1)?.stateSource)) return false;
                window.__liveRerollBase = captureWorldTurnState(world, sess);
                window.__liveRerollHistory = safeJsonClone(sess.history);
                return true;
            });
            process.stdout.write(`reroll seed ${seedAttemptCount}: ${seeded ? 'success' : 'failure'}\n`);
        }
        if (!seeded) throw new Error('Could not produce an accepted original turn for reroll measurement');
    }
    for (let attempt = 0; attempt < rerollCount; attempt++) {
        const startedAt = Date.now();
        const result = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === state.activeWorldId);
            const sess = getCurrentWorldSession();
            restoreWorldTurnState(world, sess, window.__liveRerollBase);
            sess.history = safeJsonClone(window.__liveRerollHistory);
            const before = safeJsonClone(sess.history.at(-1));
            const beforeState = captureWorldTurnState(world, sess);
            await executeWorldTurn(true);
            return { before: { text: before.text, stateSource: before.stateSource },
                after: { text: sess.history.at(-1)?.text, stateSource: sess.history.at(-1)?.stateSource,
                    versions: sess.history.at(-1)?.versions?.length || 1,
                    audit: safeJsonClone(sess.lastTurnAudit),
                    state: { location: sess.playerLocation, outfit: sess.outfit,
                        inventory: safeJsonClone(sess.inventory),
                        npcLocations: Object.fromEntries(['linda','marc','ena'].map(id => [id,sess.entityStates[id]?.location])) } },
                beforeStateVersion: beforeState.session.worldStateVersion,
                error: document.querySelector('#world-turn-error')?.textContent || '' };
        });
        outcomes.push({ kind: 'reroll', attempt: attempt + 1, model, elapsedMs: Date.now() - startedAt, ...result });
        fs.writeFileSync(resultPath, JSON.stringify({ model, normalCount, rerollCount, seedAttemptCount, outcomes, pageErrors,
            providerTraffic }, null, 2));
        process.stdout.write(`reroll ${attempt + 1}/${rerollCount}: ${result.after.stateSource || 'unknown'} ${Date.now() - startedAt}ms\n`);
    }
    await browser.close();
    process.stdout.write(`Wrote ${resultPath}\n`);
})().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
