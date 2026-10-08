/** Offline replay: a negated departure cannot undo a previously committed exit. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const host = 'world-negated-movement-receipt.test';

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== host) return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html'
                : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`https://${host}/`);
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined'
            && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async rawWorld => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const action = 'I tell Iven Mara saw Tomas take the brass key east four days ago. I ask if he will arrange a search at first light if I am not back by then. I do not take the lantern, leave the square, or promise anything yet.';
            const parser = {
                hosted: extractUserMovementTarget(action),
                negated: extractUserMovementTarget('I do not take the lantern, leave the square, or promise anything.'),
                affirmative: extractUserMovementTarget('I refuse the lantern, but I leave the square.'),
                laterAction: extractUserMovementTarget('I do not take the lantern. Then I leave the square.')
            };
            const world = { ...rawWorld, id: 'world_negated_movement_receipt',
                model: 'offline/model', contextSize: 32768, maxTokens: 2048 };
            world.kernel={...world.kernel,sceneDrafts:false}; // Replay the captured legacy provider contract.
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.originId = 'ranger';
            sess.playerIdentity = { ...sess.playerIdentity, role: 'marsh ranger' };
            sess.history.push({ id: 'opening', role: 'dm', text: 'Mara points toward the square.',
                location: 'inn' });
            switchView('worldPlay');
            renderWorldPlayState();
            const travel = await travelThroughWorldExit(world, sess,
                world.locations.find(location => location.id === 'inn').exits[0]);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            if (HordeDB.writeQueue) await HordeDB.writeQueue;
            const persistedAfterTravel = await HordeDB.get(`worldInstance:${world.id}`);
            const travelReceiptCount = sess.worldTurnReceipts.length;
            const travelMovementCount = (sess.turnEvents || []).filter(event =>
                event.type === 'movement' && event.actor_id === 'player').length;
            const before = {
                travelOk: !!(travel.ok && travel.moved),
                location: sess.playerLocation,
                persistedLocation: persistedAfterTravel?.sessions?.find(item => item.id === sess.id)?.playerLocation,
                travelReceipt: sess.worldTurnReceipts.some(entry => entry.audit?.source === 'engine_travel'),
                travelReceiptCount, travelMovementCount
            };
            const malformedReceipt = {
                scene: { player_location_id: 'square', player_location_changed: false,
                    present_character_ids: [] },
                events: [{ type: 'dialogue', status: 'completed', actor_idpytorch: 'player',
                    participantsindustrie: ['iven'], evidencenucleus: 'Tells Iven about the key.' }],
                entity_updates: [{ entity_id: 'iven', location_id: 'square',
                    activity: 'waiting', interacting_with: [] },
                { entity_id: 'player', location_id: 'square', activity: 'talking',
                    interacting_with: [] }],
                state_updates: { ledger_update: 'The player informed Iven about the key.' },
                world_events: [{ due_in_turns: 12, ids: 'search_party_deadline' }],
                time_skip_minutesH: 0
            };
            const invalidRepair = {
                scene: { player_location_id: 'square', player_location_changed: true,
                    present_character_ids: ['iven'] },
                events: [], entity_updates: [{ entity_id: 'iven', location_id: 'square',
                    activity: 'waiting', interacting_with: ['player'] }], state_updates: {},
                summary: 'Iven hears the report and agrees to prepare a search.'
            };
            const prose = 'Captain Iven hears the report at the well and promises a search at first light.';
            const mainRequests = [];
            const actualFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return actualFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                if (body.stream) {
                    mainRequests.push(body);
                    const chunk = { choices: [{ delta: { content: prose, tool_calls: [{
                        index: 0, id: 'hosted-malformed-receipt', type: 'function',
                        function: { name: 'commit_world_turn',
                            arguments: JSON.stringify(malformedReceipt) }
                    }] }, finish_reason: 'tool_calls' }] };
                    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
                        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                return new Response(JSON.stringify({ choices: [{ message: {
                    content: JSON.stringify(invalidRepair)
                } }] }), { status: 200,
                    headers: { 'Content-Type': 'application/json' } });
            };
            document.getElementById('world-user-input').value = action;
            await executeWorldTurn();
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            if (HordeDB.writeQueue) await HordeDB.writeQueue;
            const persisted = await HordeDB.get(`worldInstance:${world.id}`);
            const saved = persisted?.sessions?.find(item => item.id === sess.id);
            const lastReceipt = sess.worldTurnReceipts.at(-1);
            const prompt = mainRequests[0]?.messages?.at(-1)?.content || '';
            return {
                parser, before,
                after: {
                    location: sess.playerLocation,
                    persistedLocation: saved?.playerLocation,
                    source: sess.lastTurnStateSource,
                    lastText: sess.history.at(-1)?.text || '',
                    savedLastText: saved?.history?.at(-1)?.text || '',
                    receiptScene: lastReceipt?.receipt?.scene,
                    rejected: lastReceipt?.audit?.rejected?.map(item => item.reason),
                    receiptCount: sess.worldTurnReceipts.length,
                    movementCount: (sess.turnEvents || []).filter(event =>
                        event.type === 'movement' && event.actor_id === 'player').length,
                    priorTravelReceiptPreserved: saved?.worldTurnReceipts?.some(entry =>
                        entry.audit?.source === 'engine_travel'),
                    inputRetained: sess.history.some(message => message.role === 'user'
                        && message.text === action),
                    mainRequests: mainRequests.length,
                    falseInnArrivalPrompt: prompt.includes('The player has just arrived at The Reed Inn'),
                    squarePrompt: prompt.includes('Village Square')
                }
            };
        }, fixture);
        assert.deepEqual(result.parser, {
            hosted: '', negated: '', affirmative: 'the square', laterAction: 'the square'
        });
        assert.equal(result.before.travelOk, true, JSON.stringify(result.before));
        assert.equal(result.before.location, 'square');
        assert.equal(result.before.persistedLocation, 'square');
        assert.equal(result.before.travelReceipt, true);
        assert.equal(result.after.location, 'square', JSON.stringify(result.after));
        assert.equal(result.after.persistedLocation, 'square');
        assert.equal(result.after.source, 'frozen_no_receipt');
        assert.match(result.after.lastText, /story text was discarded/);
        assert.equal(result.after.savedLastText, result.after.lastText);
        assert.equal(result.after.receiptScene?.player_location_id, 'square');
        assert.equal(result.after.receiptScene?.player_location_changed, false);
        assert(result.after.rejected?.includes('missing_mandatory_receipt'));
        assert.equal(result.after.receiptCount, result.before.travelReceiptCount + 1);
        assert.equal(result.after.movementCount, result.before.travelMovementCount);
        assert.equal(result.after.priorTravelReceiptPreserved, true);
        assert.equal(result.after.inputRetained, true);
        assert.equal(result.after.mainRequests, 1);
        assert.equal(result.after.falseInnArrivalPrompt, false);
        assert.equal(result.after.squarePrompt, true);
        assert.deepEqual(errors, []);
        console.log('PASS: negated departure leaves committed square travel intact through invalid receipt and persistence');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
