/** Offline replay: an invalid group-arrival receipt must not erase a newly named leader. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const host = 'world-introduced-arrival.test';

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
        const beforeReload = await page.evaluate(async rawWorld => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const world = { ...rawWorld, id: 'introduced_arrival_replay', model: 'offline/model',
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
            sess.history.push({ id: 'opening', role: 'dm', text: 'Captain Iven sounds his horn in the square.', location: 'square' });
            switchView('worldPlay');
            renderWorldPlayState();
            await saveWorldsState();

            const input = 'I stay in the square and watch the east road. Who actually arrives after Iven\'s horn, and what do they do? Show only what I can see; do not assume Tomas is dead.';
            const narrative = `The rhythmic thumping grows into a thunder of hooves. Six riders emerge from the morning mist of the east road. At their head is a lean man with a scarred jaw and a heavy cloak of oiled leather.\n\nThe riders pull up short in the square. The lead rider looks at Iven.\n\nLead Rider: "Captain Iven. We received the signal. Where is the courier?"\n\nCaptain Iven: "The courier is missing, sir."\n\nThe lead rider gestures to two of his men. They begin to form a perimeter around the square.`;
            // Captured shape from the hosted failure: the main receipt names a
            // generic, unregistered group and contains a spurious 780-minute skip.
            const invalidMain = {
                scene: { player_location_id: 'square', player_location_changed: false,
                    present_character_ids: ['iven', 'regulars'] },
                events: [{ type: 'movement', status: 'completed', actor_id: 'regulars',
                    action: 'arrival', evidence: 'six riders arrive from east road' }],
                entity_updates: [{ entity_id: 'iven', location_id: 'square', activity: 'blowing horn', interacting_with: [] }],
                state_updates: { ledger_update: 'The Magistrate\'s regulars arrived.', time_skip_minutes: '780' }
            };
            // Captured repair includes a movement from the causeway even though
            // npc_introduced places the new actor directly in the current scene.
            const repair = {
                scene: { player_location_id: 'square', player_location_changed: false,
                    present_character_ids: ['iven', 'lead_rider'] },
                events: [{ type: 'movement', status: 'completed', actor_id: 'lead_rider',
                    from_location_id: 'causeway', to_location_id: 'square', movement_mode: 'voluntary',
                    evidence: 'Six riders emerge from the east road and pull up in the square' }],
                entity_updates: [
                    { entity_id: 'iven', location_id: 'square', activity: 'reporting', interacting_with: ['lead_rider'] },
                    { entity_id: 'lead_rider', location_id: 'square', activity: 'questioning', interacting_with: ['iven'] }
                ],
                state_updates: { npc_introduced: [{ id: 'lead_rider', name: 'Lead Rider',
                    description: 'A scarred man in an oiled leather cloak leading the regulars.',
                    persona: 'Cold, calculating, and professionally detached.' }] },
                summary: 'Six regulars arrive, and their leader questions Captain Iven.'
            };
            const realFetch = window.fetch;
            let mainCalls = 0;
            let repairCalls = 0;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                if (body.stream) {
                    mainCalls++;
                    const chunk = { choices: [{ delta: { content: narrative, tool_calls: [{ index: 0,
                        id: 'arrival-tool', type: 'function', function: {
                            name: 'commit_world_turn', arguments: JSON.stringify(invalidMain)
                        } }] }, finish_reason: 'tool_calls' }] };
                    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
                        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                repairCalls++;
                return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(repair) } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const startLocation = sess.playerLocation;
            const startTurn = sess.turnCount;
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            if (HordeDB.writeQueue) await HordeDB.writeQueue;
            const savedWorld = (await HordeDB.get('worlds') || []).find(item => item.id === world.id);
            const savedInstance = await HordeDB.get(`worldInstance:${world.id}`);
            return { mainCalls, repairCalls, startLocation, startTurn,
                source: sess.lastTurnStateSource, playerLocation: sess.playerLocation,
                turnCount: sess.turnCount, leader: world.entities.find(entity => entity.id === 'lead_rider') || null,
                leaderState: sess.entityStates.lead_rider || null,
                scene: buildWorldSceneFrame(world, sess),
                visibleCast: document.getElementById('world-present-list').innerText,
                lastMessage: [...sess.history].reverse().find(message => message.role === 'dm')?.text || '',
                rejected: sess.lastTurnAudit?.rejected || [],
                savedLeader: savedWorld?.entities?.find(entity => entity.id === 'lead_rider') || null,
                savedLeaderState: savedInstance?.sessions?.find(item => item.id === sess.id)?.entityStates?.lead_rider || null };
        }, fixture);
        assert.equal(beforeReload.mainCalls, 1);
        assert.equal(beforeReload.repairCalls, 1);
        assert.equal(beforeReload.source, 'receipt_repair', JSON.stringify(beforeReload));
        assert.equal(beforeReload.playerLocation, beforeReload.startLocation);
        assert.equal(beforeReload.turnCount, beforeReload.startTurn + 1);
        assert.equal(beforeReload.leader?.name, 'Lead Rider');
        assert.equal(beforeReload.leaderState?.location, 'square');
        assert(beforeReload.scene.present_character_ids.includes('lead_rider'));
        assert.match(beforeReload.visibleCast, /Lead Rider/);
        assert.match(beforeReload.lastMessage, /Lead Rider:/);
        assert.deepEqual(beforeReload.rejected, []);
        assert.equal(beforeReload.savedLeader?.name, 'Lead Rider');
        assert.equal(beforeReload.savedLeaderState?.location, 'square');

        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.introduced_arrival_replay?.sessions?.length, { timeout: 30000 });
        const afterReload = await page.evaluate(() => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = state.worlds.find(item => item.id === 'introduced_arrival_replay');
            state.activeWorldId = world.id;
            const sess = getCurrentWorldSession();
            switchView('worldPlay');
            renderWorldPlayState();
            return { playerLocation: sess.playerLocation, leader: world.entities.find(entity => entity.id === 'lead_rider') || null,
                leaderState: sess.entityStates.lead_rider || null,
                visibleCast: document.getElementById('world-present-list').innerText,
                scene: buildWorldSceneFrame(world, sess) };
        });
        assert.equal(afterReload.playerLocation, 'square');
        assert.equal(afterReload.leader?.name, 'Lead Rider');
        assert.equal(afterReload.leaderState?.location, 'square');
        assert(afterReload.scene.present_character_ids.includes('lead_rider'));
        assert.match(afterReload.visibleCast, /Lead Rider/);
        assert.deepEqual(errors, []);
        console.log('PASS: repaired named arrival stays in scene and storage across reload; player remains in the square');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
