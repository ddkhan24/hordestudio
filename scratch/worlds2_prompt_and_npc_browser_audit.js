/** Offline browser regression for World prompt budget and new-NPC receipts. */
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
            if (url.hostname !== 'worlds2-prompt.test') return route.abort();
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
        await page.goto('https://worlds2-prompt.test/');
        try {
            await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        } catch (error) {
            throw new Error(`World app did not finish booting: ${error.message}; page errors: ${errors.join(' | ') || 'none'}; title: ${await page.title()}`);
        }
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = {
                id: 'world_prompt_npc_fixture', name: 'Prompt NPC Fixture', model: 'fixture/model',
                contextSize: 8192, maxTokens: 2048, dmPrompt: 'Long world bible. '.repeat(1800),
                intro: '', startLocationId: 'lobby',
                locations: [{ id: 'lobby', name: 'Lobby', description: 'A quiet office lobby.', exits: [] }],
                entities: [{ id: 'npc_gloria', name: 'Gloria Bell', type: 'npc', startLocation: 'lobby', persona: 'Receptionist' }],
                kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: false }, // Legacy receipt compatibility fixture.
                hudConfig: { showClock: true, showQuests: false, showLedger: true, stats: [] }
            };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.entityStates.npc_gloria = { location: 'lobby', status: 'alive' };
            sess.history.push({ id: 'opening', role: 'dm', text: 'Gloria is at the desk.', location: 'lobby' });
            switchView('worldPlay');
            renderWorldPlayState();
            let calls = 0;
            const realFetch = window.fetch;
            window.fetch = (url, options) => {
                if (String(url).includes('/chat/completions')) calls++;
                return realFetch(url, options);
            };
            const input = 'I ask Gloria if the examiner has a name.';
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            const guarded = {
                calls, inputRestored: document.getElementById('world-user-input').value === input,
                historyLength: sess.history.length, location: sess.playerLocation
            };
            const receipt = {
                summary: 'Agent Halloway identifies herself.',
                scene: { player_location_id: 'lobby', player_location_changed: false,
                    present_character_ids: ['npc_gloria', 'npc_halloway'] },
                events: [],
                entity_updates: [{ entity_id: 'npc_halloway', location_id: 'lobby',
                    activity: 'Showing her badge', interacting_with: ['player'] }],
                state_updates: { npc_introduced: [{ id: 'npc_halloway', name: 'Agent Halloway',
                    description: 'A rain-soaked examiner.', persona: 'Exacting state examiner.' }] }
            };
            const committed = commitWorldTurnReceipt(world, sess, receipt,
                { playerStartLocationId: 'lobby' }, 'fixture');
            world.dmPrompt = 'Narrate the office truthfully.';
            world.contextSize = 32768;
            world.locations[0].exits = ['to Claims Cave'];
            world.locations.push({ id: 'claims', name: 'Claims Cave', description: 'An archive room.', exits: ['to Lobby'] });
            let forceBadFlag = false;
            const repairPrompts = [];
            const modelRequests = [];
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                modelRequests.push(body);
                if (body.messages?.some(message => String(message.content).includes('[AUTHORITATIVE COMMITTED TURN]')))
                    return new Response(JSON.stringify({ choices: [{ message: { content: 'You arrive and look around.' } }] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (body.stream) {
                    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'You arrive and look around.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
                    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                repairPrompts.push(body.messages?.[0]?.content || '');
                const frame = buildWorldSceneFrame(world, sess);
                const repaired = { summary: 'The player arrived.',
                    action_resolution: { kind: 'travel', status: 'resolved', outcome: 'You arrive and look around.' }, scene: {
                    player_location_id: frame.player_location_id,
                    player_location_changed: !forceBadFlag,
                    present_character_ids: frame.present_character_ids
                }, events: [], entity_updates: [], state_updates: {} };
                return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(repaired) } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            document.getElementById('world-user-input').value = 'I walk to Claims Cave.';
            await executeWorldTurn();
            const repairedMove = { location: sess.playerLocation, source: sess.lastTurnStateSource,
                rejected: [...(sess.lastTurnAudit?.rejected || [])] };
            forceBadFlag = true;
            document.getElementById('world-user-input').value = 'I return to Lobby.';
            await executeWorldTurn();
            const frozenMove = { location: sess.playerLocation, source: sess.lastTurnStateSource,
                rejected: [...(sess.lastTurnAudit?.rejected || [])], receipt: sess.worldTurnReceipts?.at(-1)?.receipt };
            world.locations.find(location => location.id === 'claims').exits.push('to Denton Office');
            world.locations.push({ id: 'office', name: 'Denton Office', description: 'A small office.', exits: ['to Claims Cave'] });
            world.locations.find(location => location.id === 'lobby').exits.push('to Denton Office');
            const routeReceipt = {
                summary: 'The player crossed Claims Cave to the office.',
                scene: { player_location_id: 'office', player_location_changed: true, present_character_ids: [] },
                events: [
                    { type: 'movement', status: 'completed', actor_id: 'player', from_location_id: 'lobby', to_location_id: 'claims', movement_mode: 'voluntary' },
                    { type: 'movement', status: 'completed', actor_id: 'player', from_location_id: 'claims', to_location_id: 'office', movement_mode: 'voluntary' }
                ],
                entity_updates: [{ entity_id: 'player', location_id: 'office', activity: 'Speaking to Denton', interacting_with: [] }],
                state_updates: { npc_introduced: [{ id: 'npc_gloria', name: 'Gloria', description: 'Already present.' }] }
            };
            const routeContext = { playerStartLocationId: 'lobby', playerMovementAuthorized: true,
                authorizedPlayerDestinationId: 'office', authorizedPlayerWaypointIds: ['claims'] };
            const actorCountBeforeRoute = world.entities.length;
            const routeCommit = commitWorldTurnReceipt(world, sess, routeReceipt, routeContext, 'fixture_route');
            const multiLeg = { location: sess.playerLocation, rejected: [...routeCommit.audit.rejected] };
            const precommitted = commitWorldTurnReceipt(world, sess, routeReceipt,
                { ...routeContext, committedPlayerDestinationId: 'office' }, 'fixture_precommitted_route');
            const precommittedMultiLeg = { location: sess.playerLocation, rejected: [...precommitted.audit.rejected],
                extraActors: world.entities.length - actorCountBeforeRoute };
            forceBadFlag = false;
            await executeWorldTurn('look');
            const lookRequest = [...modelRequests].reverse().find(request => request.stream);
            // A second mapped-exit arrival at the same already-described,
            // empty room should ask for a brief scene and a compact output
            // allowance without changing the receipt contract.
            forceBadFlag = true;
            sess.worldTurnReceipts.at(-1).audit.source = 'engine_travel';
            await executeWorldTurn('look');
            const familiarLookRequest = [...modelRequests].reverse().find(request => request.stream);
            return {
                guarded,
                rejected: committed.audit.rejected,
                castMatch: committed.audit.cast_checksum_match,
                newNpc: world.entities.find(entity => entity.id === 'npc_halloway') || null,
                npcState: sess.entityStates.npc_halloway || null,
                count: sess.worldTurnReceipts?.length || 0,
                repairedMove, frozenMove, repairPrompts, multiLeg, precommittedMultiLeg,
                lookSystemPrompt: lookRequest?.messages?.filter(message => message.role === 'system')
                    .map(message => message.content).join('\n') || '',
                lookUserPrompt: lookRequest?.messages?.at(-1)?.content || '',
                familiarLookPrompt: familiarLookRequest?.messages?.filter(message => message.role === 'system')
                    .map(message => message.content).join('\n') || '',
                familiarLookUserPrompt: familiarLookRequest?.messages?.at(-1)?.content || '',
                familiarLookMaxTokens: familiarLookRequest?.max_tokens
            };
        });
        assert.equal(result.guarded.calls, 0, 'an over-budget turn must not bill the provider');
        assert.equal(result.guarded.inputRestored, true, 'a guarded action must be returned to the composer');
        assert.equal(result.guarded.historyLength, 1, 'a guarded action must not append a fake reply');
        assert.equal(result.guarded.location, 'lobby');
        assert.deepEqual(result.rejected, []);
        assert.equal(result.castMatch, true);
        assert.equal(result.newNpc?.sessionOrigin?.startsWith('wsess_'), true);
        assert.equal(result.npcState?.location, 'lobby');
        assert.equal(result.npcState?.currentActivity, 'Showing her badge');
        assert.equal(result.repairedMove.location, 'claims');
        assert.equal(result.repairedMove.source, 'receipt_repair', JSON.stringify({
            move: result.repairedMove, prompts: result.repairPrompts.map(prompt => prompt.slice(0, 180)),
            frozen: result.frozenMove
        }));
        assert.deepEqual(result.repairedMove.rejected, []);
        assert.match(result.repairPrompts[0], /scene\.player_location_changed MUST be true/);
        assert.equal(result.frozenMove.location, 'lobby');
        assert.equal(result.frozenMove.source, 'frozen_no_receipt');
        assert.equal(result.frozenMove.receipt.scene.player_location_changed, true);
        assert.deepEqual(result.frozenMove.rejected.map(item => item.reason), ['missing_mandatory_receipt', 'player_location_change_flag_mismatch']);
        assert.equal(result.multiLeg.location, 'office');
        assert.deepEqual(result.multiLeg.rejected, []);
        assert.equal(result.precommittedMultiLeg.location, 'office');
        assert.deepEqual(result.precommittedMultiLeg.rejected, []);
        assert.equal(result.precommittedMultiLeg.extraActors, 0, 'an already-authored NPC was duplicated');
        assert.match(result.lookSystemPrompt, /player and any existing escorts have already moved/i);
        assert.match(result.lookSystemPrompt, /scene\.player_location_changed=false/);
        assert.match(result.lookSystemPrompt, /TURN RECEIPT DELIVERY FAILSAFE/);
        assert.match(result.lookUserPrompt, /Separately submit the required commit_world_turn receipt/);
        assert.doesNotMatch(result.lookUserPrompt, /prose only/i);
        assert.match(result.familiarLookPrompt, /This is a familiar, uneventful route/);
        assert.match(result.familiarLookUserPrompt, /one or two sentences/);
        assert.equal(result.familiarLookMaxTokens, 2048);
        assert.match(result.familiarLookPrompt, /scene\.player_location_changed=false/);
        assert.deepEqual(errors, []);
        console.log('PASS: prompt guard, NPC introduction, receipt repair, honest fallback and authorized multi-leg movement');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
