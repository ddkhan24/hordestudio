/** Offline regression: no unverified fiction or pseudo-tool text reaches World canon. */
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
            if (url.hostname !== 'world-receipt-boundary.test') return route.abort();
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
        await page.goto('https://world-receipt-boundary.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const scrubbed = scrubNarrativeArtifacts('The guard studies you.\n<|tool_call>call:checks{"difficulty":11,\n"skill":"might"}');
            const bareTool = scrubNarrativeArtifacts('call:checks{"difficulty":11,\n"skill":"might"}');
            const receipt = {
                summary: 'A quiet scene.',
                scene: { player_location_id: 'hall', player_location_changed: false, present_character_ids: [] },
                events: [], entity_updates: [], state_updates: {}
            };
            const matchingReceipt = {
                ...receipt,
                summary: 'The player drinks the healing draught.',
                events: [{ type: 'inventory', status: 'completed', actor_id: 'player',
                    action: 'consume', item: 'healing draught', evidence: 'The player drank the healing draught.' }]
            };
            const netZeroReceipt = {
                ...receipt,
                summary: 'The player receives and drinks another healing draught.',
                events: [
                    { type: 'inventory', status: 'completed', actor_id: 'player',
                        action: 'add', item: 'healing draught', evidence: 'A second healing draught was given.' },
                    { type: 'inventory', status: 'completed', actor_id: 'player',
                        action: 'consume', item: 'healing draught', evidence: 'The player drank it.' }
                ]
            };
            const wrapped = unwrapWorldTurnReceipt({ commit_world_turn: JSON.stringify(receipt) });
            const bareReceipt = extractInlineWorldTurnReceipt(JSON.stringify(receipt));
            const bareReceiptVisible = hasReadableWorldNarrative(JSON.stringify(receipt));
            const world = {
                id: 'world_receipt_boundary_fixture', name: 'Receipt Boundary Fixture',
                model: 'fixture/model', contextSize: 32768, maxTokens: 2048,
                dmPrompt: 'A quiet guard hall.', intro: '', startLocationId: 'hall',
                locations: [{ id: 'hall', name: 'Hall', description: 'A stone hall.', exits: [] }],
                entities: [], kernel: { enabled: true, memoryMode: 'ledger', repairMode: 'adaptive', resolveFirst: false, sceneDrafts: false },
                hudConfig: { showClock: false, showQuests: false, showLedger: true, stats: [
                    { id: 'hp', name: 'Health', value: 12, min: 0, max: 12 }
                ] },
                gameRules: { profileId: 'adventure', vitalStatId: 'hp', modules: {
                    stats: true, health: true, conditions: true, inventory: true,
                    checks: false, commerce: false, quests: false, relationships: false,
                    schedules: false, livingWorld: false
                } }
            };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.inventory = ['healing draught'];
            sess.history.push({ id: 'opening', role: 'dm', text: 'The hall is quiet.', location: 'hall' });
            switchView('worldPlay');
            renderWorldPlayState();
            const harmlessClaims = [
                { input: 'I drink water.', prose: 'You drink water. The healing draught remains in your pack.' },
                { input: 'I refuse the healing draught.', prose: 'You do not drink the healing draught.' },
                { input: 'I take the captain’s advice.', prose: 'You take the captain’s advice and wait.' },
                { input: 'I take the strap?', prose: 'You do not take the strap.' },
                { input: 'I inspect my arm.', prose: 'Your arm does not burn.' },
                { input: 'I strike the guard.', prose: 'You hit the guard; he staggers back.' }
            ].map(sample => {
                const validation = validateWorldTurnReceipt(world, sess, receipt, {
                    playerStartLocationId: sess.playerLocation,
                    playerInput: sample.input,
                    narrativeText: sample.prose
                });
                const finalConflicts = worldFinalNarrativeConflicts(world, sess, sess,
                    sample.prose, sample.input);
                return {
                    input: sample.input,
                    rejected: validation.rejectedEvents.map(event => event.reason),
                    finalConflicts: finalConflicts.map(event => event.reason)
                };
            });
            let phase = 'frozen';
            const callKinds = [];
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                const sse = choice => `data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`;
                if (body.stream) {
                    callKinds.push(`${phase}:main`);
                    const delta = phase === 'frozen'
                        ? { content: 'You kill the guard and drink the potion.' }
                        : phase === 'wrapped'
                            ? { content: 'The guard waits by the arch.' }
                            : { content: phase === 'tool' ? '<|tool_call>call:checks{"difficulty":11}' : '',
                                tool_calls: [{ index: 0, id: 'receipt-tool', type: 'function',
                                    function: { name: 'commit_world_turn', arguments: JSON.stringify(
                                        phase === 'followup_matching' ? matchingReceipt
                                            : phase === 'followup_net_zero' ? netZeroReceipt : receipt) } }] };
                    return new Response(sse({ delta, finish_reason: 'stop' }), {
                        status: 200, headers: { 'Content-Type': 'text/event-stream' }
                    });
                }
                const prompt = JSON.stringify(body.messages || []);
                if (phase === 'frozen') {
                    callKinds.push('frozen:repair');
                    return new Response(JSON.stringify({ choices: [{ message: { content: '{bad receipt' } }] }), {
                        status: 200, headers: { 'Content-Type': 'application/json' }
                    });
                }
                if (phase === 'wrapped') {
                    callKinds.push('wrapped:repair');
                    return new Response(JSON.stringify({ choices: [{ message: {
                        content: JSON.stringify({ commit_world_turn: receipt })
                    } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (phase === 'followup_conflict' || phase === 'followup_matching'
                    || phase === 'followup_net_zero') {
                    callKinds.push(`${phase}:follow-up`);
                    const content = phase === 'followup_conflict'
                        ? 'You drink the healing draught. Your forearm burns.'
                        : 'You drink the healing draught.';
                    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
                        status: 200, headers: { 'Content-Type': 'application/json' }
                    });
                }
                if (/previous attempt produced no readable prose/i.test(prompt)) {
                    callKinds.push('tool:rescue');
                    return new Response(JSON.stringify({ choices: [{ message: { content: 'The watch is quiet tonight.' } }] }), {
                        status: 200, headers: { 'Content-Type': 'application/json' }
                    });
                }
                callKinds.push('tool:follow-up');
                return new Response(JSON.stringify({ choices: [{ message: { content: 'call:checks{"difficulty":11}' } }] }), {
                    status: 200, headers: { 'Content-Type': 'application/json' }
                });
            };
            const send = async text => {
                document.getElementById('world-user-input').value = text;
                await executeWorldTurn();
                return [...sess.history].reverse().find(message => message.role === 'dm');
            };
            const beforeFrozenTurnCount = sess.turnCount;
            const frozen = await send('I ask the guard for the potion.');
            const frozenResult = {
                source: frozen.stateSource, text: frozen.text,
                ledger: frozen.ledgerEntry || '', turnCount: sess.turnCount,
                beforeTurnCount: beforeFrozenTurnCount,
                historyHasFalseFiction: sess.history.some(message => message.role === 'dm'
                    && /kill the guard|drink the potion/i.test(message.text))
            };
            phase = 'wrapped';
            const repaired = await send('I ask what time it is.');
            const repairedResult = { source: repaired.stateSource, text: repaired.text };
            phase = 'tool';
            const tool = await send('I ask for news.');
            const toolResult = { source: tool.stateSource, text: tool.text,
                transcript: document.getElementById('world-messages-container').textContent };
            phase = 'followup_conflict';
            const beforeConflict = { inventory: JSON.stringify(sess.inventory),
                stats: JSON.stringify(sess.stats || {}), conditions: JSON.stringify(sess.playerConditions || []) };
            const conflict = await send('I ask whether the draught is safe.');
            const conflictResult = { source: conflict.stateSource, text: conflict.text,
                inventory: JSON.stringify(sess.inventory), stats: JSON.stringify(sess.stats || {}),
                conditions: JSON.stringify(sess.playerConditions || []), before: beforeConflict };
            phase = 'followup_matching';
            const matching = await send('I drink the healing draught.');
            const matchingResult = { source: matching.stateSource, text: matching.text,
                inventory: (sess.inventory || []).map(item => String(item?.name || item)) };
            sess.inventory = ['healing draught'];
            phase = 'followup_net_zero';
            const netZero = await send('I accept another healing draught, then drink one.');
            const netZeroResult = { source: netZero.stateSource, text: netZero.text,
                inventory: (sess.inventory || []).map(item => String(item?.name || item)) };
            return { scrubbed, bareTool, wrapped, bareReceipt, bareReceiptVisible,
                harmlessClaims, frozenResult, repairedResult, toolResult, conflictResult,
                matchingResult, netZeroResult, callKinds };
        });
        assert.equal(result.scrubbed, 'The guard studies you.');
        assert.equal(result.bareTool, '');
        assert.equal(result.wrapped?.scene?.player_location_id, 'hall');
        assert.equal(result.bareReceipt?.scene?.player_location_id, 'hall');
        assert.equal(result.bareReceiptVisible, false);
        for (const sample of result.harmlessClaims) {
            assert.deepEqual(sample.rejected, [], `pre-commit receipt wrongly rejected: ${sample.input}`);
            assert.deepEqual(sample.finalConflicts, [], `final-prose audit wrongly rejected: ${sample.input}`);
        }
        assert.equal(result.frozenResult.source, 'frozen_no_receipt');
        assert.match(result.frozenResult.text, /story text was discarded.*Reroll/i);
        assert.equal(result.frozenResult.historyHasFalseFiction, false);
        assert.equal(result.frozenResult.ledger, '');
        assert.equal(result.frozenResult.turnCount, Math.max(1, Number(result.frozenResult.beforeTurnCount) || 1));
        assert.equal(result.repairedResult.source, 'receipt_repair');
        assert.equal(result.repairedResult.text, 'The guard waits by the arch.');
        assert.equal(result.toolResult.source, 'tool_call');
        assert.equal(result.toolResult.text, 'The watch is quiet tonight.');
        assert.doesNotMatch(result.toolResult.transcript, /call:checks|<\|tool_call>/i);
        assert.doesNotMatch(result.conflictResult.text, /you drink the healing draught|your forearm burns/i,
            'a follow-up must not canonize consequences absent from its already accepted no-op receipt');
        assert.match(result.conflictResult.text, /verif|conflict|discard|could not/i);
        assert.equal(result.conflictResult.inventory, result.conflictResult.before.inventory);
        assert.equal(result.conflictResult.stats, result.conflictResult.before.stats);
        assert.equal(result.conflictResult.conditions, result.conflictResult.before.conditions);
        assert.equal(result.matchingResult.text, 'You drink the healing draught.',
            'matching final prose and receipt must remain playable');
        assert.equal(result.matchingResult.inventory.includes('healing draught'), false);
        assert.equal(result.netZeroResult.text, 'You drink the healing draught.',
            'a verified consume event must remain valid even when a same-turn acquisition makes inventory net-zero');
        assert.equal(result.netZeroResult.inventory.includes('healing draught'), true);
        assert(result.callKinds.includes('frozen:repair'));
        assert(result.callKinds.includes('wrapped:repair'));
        assert(result.callKinds.includes('tool:follow-up'));
        assert(result.callKinds.includes('tool:rescue'));
        assert(result.callKinds.includes('followup_conflict:follow-up'));
        assert(result.callKinds.includes('followup_matching:follow-up'));
        assert(result.callKinds.includes('followup_net_zero:follow-up'));
        assert.deepEqual(errors, []);
        console.log('PASS: World receipt failure discards fiction; wrapped repair and pseudo-tool rescue stay readable');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
