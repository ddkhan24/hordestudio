/** Offline browser check: exit travel is saved once or fully rolled back. */
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
            if (url.hostname !== 'world-command.test') return route.abort();
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
        await page.goto('https://world-command.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        await page.evaluate(() => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = {
                id: 'world_command_fixture', name: 'Command Fixture', startLocationId: 'start',
                intro: '', dmPrompt: 'Narrate the scene.', kernel: { enabled: true, memoryMode: 'ledger' },
                gameRules: { profile: 'pure_narrative' }, hudConfig: { stats: [] },
                locations: [
                    { id: 'start', name: 'Start', description: 'The starting room.', exits: ['to Garden'] },
                    { id: 'garden', name: 'Garden', description: 'A garden.', exits: ['to Start'] }
                ], entities: []
            };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const session = prepareCurrentWorldSession();
            session.setupComplete = true;
            session.history.push({ id: 'opening', role: 'dm', text: 'You are in the starting room.', location: 'start' });
            switchView('worldPlay');
            document.getElementById('modal-overlay')?.classList.add('hidden');
            renderWorldPlayState();
            window.__worldCommandSave = saveWorldsState;
            window.__worldCommandSaveCount = 0;
            window.saveWorldsState = async () => {
                window.__worldCommandSaveCount++;
                throw new Error('fixture: storage unavailable');
            };
        });
        await page.locator('#world-exits-list button').first().click();
        await page.waitForFunction(() => window.__worldCommandSaveCount === 1 && !worldMutationInProgress);
        const afterFailure = await page.evaluate(() => {
            const session = getCurrentWorldSession();
            return {
                location: session.playerLocation, history: session.history.map(message => message.text),
                turnInProgress: worldTurnInProgress, saveCount: window.__worldCommandSaveCount,
                worldEpoch: session._worldEpoch,
                movementEvents: (session.turnEvents || []).filter(event => event.type === 'movement').length
            };
        });
        assert(afterFailure.worldEpoch > 0, 'rollback invalidates any background proposal against the failed movement');
        const failedEpoch = afterFailure.worldEpoch;
        delete afterFailure.worldEpoch;
        assert.deepEqual(afterFailure, {
            location: 'start', history: ['You are in the starting room.'],
            turnInProgress: false, saveCount: 1, movementEvents: 0
        });
        const success = await page.evaluate(async () => {
            window.saveWorldsState = async (...args) => {
                window.__worldCommandSaveCount++;
                return window.__worldCommandSave(...args);
            };
            const world = state.worlds[0];
            const session = getCurrentWorldSession();
            const movement = await travelThroughWorldExit(world, session, world.locations[0].exits[0]);
            const persisted = await HordeDB.get('worldInstance:world_command_fixture');
            return {
                movement: movement.ok && movement.moved,
                location: session.playerLocation,
                history: session.history.map(message => message.text),
                persistedLocation: persisted?.sessions?.[0]?.playerLocation,
                persistedHistory: persisted?.sessions?.[0]?.history?.length,
                persistedDispatchFlagsAbsent: persisted?.sessions?.[0]?.history?.every(message =>
                    !['deferPersist', 'deferEmbedding', 'isReroll'].some(key => Object.hasOwn(message, key))),
                saveCount: window.__worldCommandSaveCount,
                busy: worldMutationInProgress,
                worldEpoch: session._worldEpoch,
                movementEvent: persisted?.sessions?.[0]?.turnEvents?.find(event =>
                    event.type === 'movement' && event.actor_id === 'player' && event.from_location_id === 'start'
                    && event.to_location_id === 'garden'),
                engineReceipt: persisted?.sessions?.[0]?.worldTurnReceipts?.some(entry =>
                    entry.audit?.source === 'engine_travel')
            };
        });
        assert(success.worldEpoch > failedEpoch, 'committed travel invalidates a proposal drafted in the prior room');
        delete success.worldEpoch;
        assert.equal(success.movementEvent?.committed, true, 'direct travel must persist a canonical movement event');
        delete success.movementEvent;
        assert.deepEqual(success, {
            movement: true, location: 'garden',
            history: ['You are in the starting room.', 'You move to Garden.'],
            persistedLocation: 'garden', persistedHistory: 2,
            persistedDispatchFlagsAbsent: true, saveCount: 2, busy: false,
            engineReceipt: true
        });
        const staleAgent = await page.evaluate(async () => {
            const world = state.worlds[0];
            const session = getCurrentWorldSession();
            const originalFetch = fetchWorldObservedJSON;
            let deliver;
            fetchWorldObservedJSON = () => new Promise(resolve => { deliver = resolve; });
            try {
                const pendingAgent = runWorldAgent(world, session);
                if (!deliver) throw new Error('World Agent did not begin its mocked request');
                const newsBefore = session.worldNews.length;
                const travel = await travelThroughWorldExit(world, session, world.locations[1].exits[0]);
                deliver({ response: { ok: true }, data: { choices: [{ message: {
                    content: JSON.stringify({ developments: [{ summary: 'A plan based on the old room.' }] })
                } }] }, diagnostic: () => null });
                const agent = await pendingAgent;
                return { travelled: travel.ok && travel.moved, stale: agent.stale,
                    newsUnchanged: session.worldNews.length === newsBefore };
            } finally {
                fetchWorldObservedJSON = originalFetch;
            }
        });
        assert.deepEqual(staleAgent, { travelled: true, stale: true, newsUnchanged: true });
        assert.deepEqual(errors, []);
        console.log('PASS: failed exit save restores place and transcript; travel persists once and discards stale World Agent work');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
