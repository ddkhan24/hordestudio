/** Offline replay of two live rope-cut turns that previously froze. No paid API. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'worlds2-rpg-live.horde_world'), 'utf8'));

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-restraint-replay.test') return route.abort();
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
        await page.goto('https://world-restraint-replay.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async rawWorld => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = { ...rawWorld, model: 'offline/model', contextSize: 32768, maxTokens: 2048 };
            world.kernel={...world.kernel,sceneDrafts:false}; // Recorded legacy restraint receipt.
            state.worlds = [world];
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const first = {
                input: "I use my short sword to cut Tomas's ropes without touching the valve. I offer him my shoulder and ask whether he agrees to follow me back to Iven. I will not leave or move him until he answers.",
                narrative: `You draw your short sword, the blade catching the dim, pulsing light of the cellar. With a few precise, careful slices, the coarse ropes snap and fall away from the support beam. Tomas sags forward, his legs shaking as they take his weight for the first time in days. He nearly collapses, but you steady him, offering your shoulder to brace his bruised frame.\n\nTomas Reed lean into you, his breathing heavy and ragged. He looks back at Sel Ardent with a look of pure, unadulterated loathing before turning his gaze toward you.\n\nTomas Reed: "I'll follow you. I'll follow you anywhere that isn't this godforsaken hole. Just get me back to Captain Iven. Please."\n\nSel Ardent remains frozen by the valve, their expression a mask of desperation. They watch you both with a haunted intensity, their hand still white-knuckled on the iron handle.\n\nSel Ardent: "You're just taking him? You're leaving the valve sealed? You don't understand... if the pressure builds too high in the pipes, the seal won't just leak. It will shatter. And everything in this room, including the two of you, will become a statue of salt."`,
                receipt: {
                    entity_updates: [{ activity: 'leaning on player', entity_id: 'tomas', interacting_with: ['player'], location_id: 'cellar', outfit: 'torn courier clothes' }, { activity: 'holding valve handle', entity_id: 'sel', interacting_with: [], location_id: 'cellar', outfit: 'salt-stained gloves, leather apron' }],
                    events: [{ action: 'cut ropes', actor_id: 'player', cause: 'freeing the courier', evidence: 'short sword used to slice ropes', status: 'completed', target_id: 'tomas' }],
                    ledger_update: 'The ranger freed Tomas Reed from his bonds in the tower cellar.',
                    scene: { player_location_changed: false, player_location_id: 'cellar', present_character_ids: ['sel', 'tomas'] }
                },
                repair: { scene: { player_location_id: 'cellar', player_location_changed: false, present_character_ids: ['sel', 'tomas'] }, events: [], entity_updates: [{ entity_id: 'tomas', location_id: 'cellar', activity: 'leaning on player', interacting_with: ['player'] }, { entity_id: 'sel', location_id: 'cellar', activity: 'holding valve handle', interacting_with: [] }], state_updates: { tomas_bound: false }, summary: "The player cuts Tomas Reed's ropes, freeing him from the support beam. Tomas agrees to follow the player back to Captain Iven. Sel Ardent warns that leaving the valve sealed will cause a catastrophic pressure build-up." }
            };
            const second = {
                input: "I carefully cut Tomas's binding ropes with my short sword. I remain beside him in the cellar and do not touch Sel's valve.",
                narrative: `You draw your short sword and step close to the beam. With a few precise, careful slices, the coarse ropes fray and snap. The sudden release sends Tomas slumped forward; he gasps, rubbing his raw wrists as he slides to the damp floor, his legs still shaking from the confinement.\n\nYou step back, keeping a wide distance from the humming copper pipes and the iron valve. You remain anchored beside the courier, your sword returning to its sheath, making it clear you are not here to sabotage the alchemist's precarious seal.\n\nTomas Reed: "Gods... I thought I was going to die in this hole."\n\nHe looks up at you, then glares toward Sel. The alchemist doesn't move, their grip still white-knuckled on the handle. Sel's gaze is fixed on you, assessing your restraint.\n\nSel Ardent: "You've freed him, but you haven't solved the problem. The pressure in those pipes is peaking. If we just walk away, the seal will burst on its own, and the glass will flood the groundwater anyway. I can't hold it forever."`,
                receipt: {
                    entity_updates: [{ activity: 'sitting on floor', entity_id: 'tomas', interacting_with: [], location_id: 'cellar', outfit: 'torn courier clothes' }, { activity: 'holding valve handle', entity_id: 'sel', interacting_with: [], location_id: 'cellar', outfit: 'salt-stained gloves, leather apron' }, { activity: 'standing beside tomas', entity_id: 'player', interacting_with: [], location_id: 'cellar', outfit: 'Standard attire' }],
                    events: [{ action: 'cut ropes', actor_id: 'player', cause: 'freeing the courier', evidence: "cut Tomas's binding ropes with my short sword", status: 'completed', target_id: 'tomas' }],
                    ledger_update: 'The ranger freed Tomas Reed from his bindings in the tower cellar.',
                    scene: { player_location_changed: false, player_location_id: 'cellar', present_character_ids: ['sel', 'tomas', 'player'] }
                },
                repair: { scene: { player_location_id: 'cellar', player_location_changed: false, present_character_ids: ['sel', 'tomas'] }, events: [], entity_updates: [{ entity_id: 'tomas', location_id: 'cellar', activity: 'recovering', interacting_with: [] }], state_updates: { tomas_bound: false }, summary: "The player cuts Tomas Reed's bindings with a short sword, freeing him from the support beam. The player remains beside Tomas, avoiding the valve, while Sel Ardent warns that the pipe pressure is peaking." }
            };
            const setup = () => {
                state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                const sess = prepareCurrentWorldSession();
                sess.setupComplete = true;
                sess.playerLocation = 'cellar';
                sess.entityStates.sel.location = 'cellar';
                sess.entityStates.tomas.location = 'cellar';
                sess.entityStates.sel.currentActivity = 'holding valve handle';
                sess.entityStates.tomas.currentActivity = 'bound to support beam';
                sess.entityStates.sel.pinnedUntilTurn = (sess.turnCount || 0) + 10;
                sess.entityStates.tomas.pinnedUntilTurn = (sess.turnCount || 0) + 10;
                sess.history.push({ id: 'opening', role: 'dm', text: 'Tomas is bound near the sealed spring.', location: 'cellar' });
                switchView('worldPlay');
                renderWorldPlayState();
                return sess;
            };
            let phase = first;
            let repairCalls = 0;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                if (body.messages?.some(message => String(message.content).includes('[AUTHORITATIVE COMMITTED TURN]')))
                    return new Response(JSON.stringify({ choices: [{ message: { content: phase.narrative } }] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (body.stream) {
                    const chunk = { choices: [{ delta: { content: phase.narrative, tool_calls: [{ index: 0,
                        id: 'live-replay-tool', type: 'function', function: {
                            name: 'commit_world_turn', arguments: JSON.stringify({ ...phase.receipt,
                                action_resolution: { kind: 'physical', status: 'resolved', outcome: phase.narrative } })
                        } }] }, finish_reason: 'tool_calls' }] };
                    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
                        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                repairCalls++;
                return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(phase.repair) } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const play = async sample => {
                phase = sample;
                const sess = setup();
                const before = structuredClone(sess);
                const receiptContext = { playerStartLocationId: 'cellar', playerInput: sample.input, narrativeText: sample.narrative };
                const checked = validateWorldTurnReceipt(world, sess, sample.receipt, receiptContext);
                const repair = validateWorldTurnReceipt(world, sess, sample.repair, receiptContext);
                document.getElementById('world-user-input').value = sample.input;
                await executeWorldTurn();
                const last = [...sess.history].reverse().find(message => message.role === 'dm');
                return {
                    source: last?.stateSource, text: last?.text,
                    accepted: checked.acceptedEvents.map(event => ({ type: event.type, actor: event.actor_id, target: event.target_id || '' })),
                    rejected: checked.rejectedEvents.map(event => event.reason),
                    repairRejected: repair.rejectedEvents.map(event => event.reason),
                    actualEvents: (sess.turnEvents || []).filter(event => event.committed && event.world_state_version === sess.worldStateVersion)
                        .map(event => ({ type: event.type, actor: event.actor_id, target: event.target_id || '' })),
                    beforeActivity: before.entityStates.tomas.currentActivity,
                    afterActivity: sess.entityStates.tomas.currentActivity,
                    follows: sess.entityStates.tomas.followingPlayer === true,
                    ledger: Array.isArray(sess.ledger)
                        ? sess.ledger.map(entry => String(entry?.text || entry)).join(' | ')
                        : String(sess.ledger || ''),
                    messageLedger: last?.ledgerEntry || '', auditRejected: sess.lastTurnAudit?.rejected || [],
                    normalizedCast: checked.receipt.scene.present_character_ids,
                    beforeInput: sample.input
                };
            };
            const one = await play(first);
            const two = await play(second);
            const failedRelease = validateWorldTurnReceipt(world, setup(), first.receipt, {
                playerStartLocationId: 'cellar', playerInput: first.input,
                narrativeText: 'You try to cut the ropes, but the blade slips and Tomas remains bound.'
            });
            const noAgreement = validateWorldTurnReceipt(world, setup(), first.receipt, {
                playerStartLocationId: 'cellar', playerInput: first.input,
                narrativeText: first.narrative.replace("I'll follow you. I'll follow you anywhere that isn't this godforsaken hole. Just get me back to Captain Iven. Please.", "I won't follow you. I'm staying here.")
            });
            const unboundSession = setup();
            unboundSession.entityStates.tomas.currentActivity = 'resting';
            const alreadyUnbound = validateWorldTurnReceipt(world, unboundSession, first.receipt, {
                playerStartLocationId: 'cellar', playerInput: first.input, narrativeText: first.narrative
            });
            return { one, two, repairCalls,
                failedReleaseReasons: failedRelease.rejectedEvents.map(event => event.reason),
                noAgreementTypes: noAgreement.acceptedEvents.map(event => event.type),
                alreadyUnboundReasons: alreadyUnbound.rejectedEvents.map(event => event.reason) };
        }, fixture);
        for (const turn of [result.one, result.two]) {
            assert.deepEqual(turn.rejected, []);
            assert(turn.repairRejected.includes('unsupported_state_update'));
            assert.equal(turn.source, 'tool_call');
            assert.match(turn.beforeActivity, /bound/);
            assert.doesNotMatch(turn.afterActivity, /bound/);
            assert.match(turn.messageLedger || turn.ledger, /freed Tomas Reed/i);
            assert(turn.actualEvents.some(event => event.type === 'interaction' && event.actor === 'player'));
            assert.deepEqual(turn.auditRejected, []);
            assert.deepEqual(turn.normalizedCast, ['sel', 'tomas']);
        }
        assert(result.one.actualEvents.some(event => event.type === 'escort' && event.actor === 'tomas'));
        assert.equal(result.one.follows, true, 'explicit named agreement must persist as escort state');
        assert.equal(result.two.follows, false, 'rope cutting alone must not imply an escort');
        assert.equal(result.repairCalls, 0, 'captured main receipts should not waste a malformed repair call');
        assert(result.failedReleaseReasons.includes('unsupported_event_type'));
        assert(result.alreadyUnboundReasons.includes('unsupported_event_type'));
        assert.deepEqual(result.noAgreementTypes, ['interaction']);
        assert.deepEqual(errors, []);
        console.log('PASS: live rope-cut receipts free Tomas; only explicit agreement starts escort; unsupported repair stays rejected');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
