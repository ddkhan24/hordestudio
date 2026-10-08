/** Offline replay of the hosted Gemma dawn wait and receipt-only repair. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const host = 'world-dawn-wait-receipt.test';

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
            const action = 'I refuse the lantern for now. I wait here by the well until just after dawn, watching whether Iven actually gathers a search party. I do not travel or take any item.';
            const prose = `You leave the lantern resting on the stone lip of the well. Captain Iven watches while the storm breaks.

The rain descends in a sudden, violent sheet. For hours, the only sound is water on slate. Iven retreats to the watch post, occasionally glancing at you.

As the hours bleed into a cold night, the rain slows. The first grey light of dawn filters through the clouds. Iven emerges from the post and calls for his men. Three villagers and two guards gather by the well. Iven prepares to lead the search party.`;
            const contradictoryProse = `You leave the lantern resting on the stone lip of the well. Captain Iven's brow furrows, a look of genuine bewilderment crossing his face as you simply stand your ground. He doesn't push the lamp into your hand, but he watches you with growing impatience while the storm finally breaks.

The rain descends in a sudden, violent sheet, turning the village square into a grey blur. For hours, the only sound is the rhythmic drumming of water on slate and the distant, mournful howl of the wind. Iven eventually retreats to the shelter of the watch post, his silhouette a dark, brooding shape against the rain, occasionally glancing at you—a solitary figure enduring the deluge.

As the hours bleed into a cold, sleepless night, the rain slows to a persistent drizzle. The first grey light of dawn filters through the clouds. True to his word, Iven emerges from the post. He does not look at you as he bellows for his men, his voice cutting through the morning mist. Three villagers and two weary-eyed guards gather, clutching spears and torches, their faces grim.

Captain Iven: "Right. The ranger's gone missing or died in the muck. We head for the causeway. Now."`;
            const hostedSearchProse = `You wait by the well until just after dawn. Captain Iven blows a brass whistle. Within minutes, three men from the local watch assemble in the square.

Captain Iven: "Gear up! We're moving out. If the ranger hasn't come back, we search the tower road first."`;
            const quietProse = `You wait by the well until just after dawn. Captain Iven remains at the watch post and sees you in the square. No search party leaves.`;
            const heldScoutsProse = `You wait by the well until just after dawn. Captain Iven emerges with two scouts who are tightening their horses' cinches. He sees you standing in the square and signals the scouts to hold their positions. No search party departs.`;
            const baseRepair = {
                scene: { player_location_id: 'square', player_location_changed: false,
                    present_character_ids: ['iven'] },
                events: [],
                entity_updates: [{ entity_id: 'iven', location_id: 'square',
                    activity: 'leading search party', interacting_with: [] }],
                state_updates: { npc_introduced: [
                    ['villager_1', 'Villager 1', 'A grim-faced local', 'Cautious and weary'],
                    ['villager_2', 'Villager 2', 'A grim-faced local', 'Cautious and weary'],
                    ['villager_3', 'Villager 3', 'A grim-faced local', 'Cautious and weary'],
                    ['guard_1', 'Guard 1', 'A weary-eyed watchman', 'Disciplined but tired'],
                    ['guard_2', 'Guard 2', 'A weary-eyed watchman', 'Disciplined but tired']
                ].map(([id, name, description, persona]) => ({ id, name, description, persona })) },
                summary: 'The player waited in the square through a storm until dawn. Captain Iven gathered a search party consisting of three villagers and two guards to head for the causeway.'
            };
            const parser = {
                exact: parseExplicitWorldWaitMinutes(action, 1078),
                dawn: parseExplicitWorldWaitMinutes('I wait until dawn.', 1078),
                question: parseExplicitWorldWaitMinutes('Can I wait until dawn?', 1078),
                hypothetical: parseExplicitWorldWaitMinutes('I might wait until dawn.', 1078),
                ambiguous: parseExplicitWorldWaitMinutes('I wait until dawn. I wait until first light.', 1078),
                completion: worldNarrativeCompletesExplicitWait(prose),
                referencedCrowdRejected: omitUnnamedWorldRepairCrowd({ ...baseRepair,
                    scene: { ...baseRepair.scene,
                        present_character_ids: ['iven', 'villager_1'] } }, prose) === null
            };
            const originalFetch = window.fetch;
            let phase = 'repair';
            const prompts = [];
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return originalFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                if (body.stream) {
                    const chunk = { choices: [{ delta: { content: phase === 'contradiction'
                        ? contradictoryProse : phase === 'conditional_prose_only'
                        ? hostedSearchProse : phase === 'conditional_resurrect'
                        ? quietProse : phase === 'conditional_summary_only'
                        ? heldScoutsProse : prose }, finish_reason: 'stop' }] };
                    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
                        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                const prompt = String(body.messages?.[0]?.content || '');
                if (prompt.startsWith('[WORLD TURN RECEIPT REPAIR]')) prompts.push(prompt);
                const receipt = phase === 'conditional'
                    ? { ...baseRepair, state_updates: {},
                        entity_updates: [{ entity_id: 'iven', location_id: 'square',
                            activity: 'gathering a search party', interacting_with: [] }] }
                    : phase === 'conditional_prose_only'
                    ? { ...baseRepair, state_updates: {}, entity_updates: [],
                        summary: 'The ranger waited in the square with Iven until dawn.' }
                    : phase === 'conditional_resurrect'
                    ? { ...baseRepair, state_updates: { world_events: [{
                        id: 'search_at_first_light', status: 'triggered', urgent: true }] },
                        entity_updates: [], summary: 'The ranger waited with Iven until dawn.' }
                    : phase === 'conditional_summary_only'
                    ? { ...baseRepair, state_updates: {}, entity_updates: [{
                        entity_id: 'iven', location_id: 'square', activity: 'speaking',
                        interacting_with: ['player'] }],
                        summary: 'The player waited in the village square overnight until dawn. Captain Iven arrived with a search party and questioned why the player was still idling.' }
                    : phase === 'invalid'
                    ? { ...baseRepair, events: [{ type: 'unsupported_magic', status: 'completed',
                        actor_id: 'iven' }] }
                    : baseRepair;
                return new Response(JSON.stringify({ choices: [{ message: {
                    content: JSON.stringify(receipt)
                } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const run = async id => {
                const world = { ...rawWorld, id, model: 'offline/model',
                    contextSize: 32768, maxTokens: 2048,
                    kernel: { ...rawWorld.kernel, resolveFirst: false, sceneDrafts: false } };
                state.worlds = [world];
                state.worldInstances = { [id]: { sessions: [], activeSessionId: null } };
                state.activeWorldId = id;
                state.apiKey = 'offline-fixture';
                state.globalSettings.apiProvider = 'openrouter';
                const sess = prepareCurrentWorldSession();
                sess.setupComplete = true;
                sess.originId = 'ranger';
                sess.playerIdentity = { ...sess.playerIdentity, role: 'marsh ranger' };
                sess.playerLocation = 'square';
                sess.entityStates.iven.location = 'square';
                sess.worldClock = { absoluteMinutes: 1078, turnCount: sess.turnCount,
                    bonusTimeMinutes: sess.bonusTimeMinutes || 0 };
                const conditionalPhase = phase.startsWith('conditional');
                let deadlineId = conditionalPhase ? 'search_at_first_light' : `warning_${id}`;
                if (phase === 'conditional_recovered' || phase === 'conditional_request_recovered') {
                    const promise = phase === 'conditional_request_recovered'
                        ? `Captain Iven: "First light, you have it. If you aren't back by the time the sun hits the road, I'll pull every able man from the village and we'll sweep the marsh. Just don't make me waste my men on a ghost hunt."`
                        : 'Captain Iven: “If you are not back by first light, I will pull every able man from the watch and send a search party. The marsh may kill them.”';
                    const requested = phase === 'conditional_request_recovered'
                        ? 'I ask if Iven will arrange a search at first light if I am not back by then.' : '';
                    const recovered = recoverNarratedUrgentDeadline(world, sess, promise, requested);
                    if (!recovered) throw new Error('Narrated conditional promise was not recovered');
                    deadlineId = recovered.id;
                } else if (conditionalPhase) {
                    const agreement = commitWorldTurnReceipt(world, sess, {
                        scene: { player_location_id: 'square', player_location_changed: false,
                            present_character_ids: ['iven'] },
                        events: [{ type: 'interaction', actor_id: 'iven', status: 'completed',
                            action: 'agreement', participants: ['player', 'iven'],
                            evidence: 'Captain Iven agreed to search at first light if the ranger had not returned.' }],
                        entity_updates: [{ entity_id: 'iven', location_id: 'square',
                            activity: 'speaking with the ranger', interacting_with: ['player'] }],
                        state_updates: {
                            ledger_update: 'Captain Iven agreed to organize a search for Tomas if the ranger does not return by first light.',
                            world_events: [{ id: deadlineId, title: 'Search Party Departure',
                                urgent: true, status: 'scheduled', due_in_turns: 12 }]
                        }
                    }, { playerStartLocationId: 'square', deferFeedback: true,
                        playerInput: 'I ask Iven to arrange a search at first light if I am not back by then.',
                        narrativeText: 'Captain Iven: “First light, then. If you are not back, I will pull together a party.”' });
                    if (agreement.audit.rejected.length) throw new Error(JSON.stringify(agreement.audit.rejected));
                    if (phase === 'conditional') {
                        const narrated = recoverNarratedUrgentDeadline(world, sess,
                            'Captain Iven: “If you are not back by first light, I will take two scouts to search for Tomas. They could die in the marsh.”');
                        if (narrated?.id !== deadlineId || sess.scheduledEvents.length !== 1) {
                            throw new Error('Model and narrated warning duplicated one conditional promise');
                        }
                    }
                } else {
                    sess.scheduledEvents.push({ id: deadlineId, title: 'Iven search warning',
                        dueMinute: 1800, urgent: true, reportedWarning: true, status: 'scheduled' });
                }
                const scheduled = sess.scheduledEvents.find(event => event.id === deadlineId);
                const scheduledDueMinute = scheduled?.dueMinute;
                const scheduledDueTurn = scheduled?.dueTurn;
                const scheduledWarning = scheduled?.reportedWarning;
                sess.history.push({ id: 'opening', role: 'dm',
                    text: 'Iven holds out a lantern by the well.', location: 'square' });
                switchView('worldPlay');
                renderWorldPlayState();
                const before = getWorldTimeData(world, sess).currentTotalMinutes;
                const beforeItems = JSON.stringify(sess.inventory);
                const beforeIvenActivity = sess.entityStates.iven.currentActivity;
                document.getElementById('world-user-input').value = action;
                await executeWorldTurn();
                await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
                if (HordeDB.writeQueue) await HordeDB.writeQueue;
                const saved = await HordeDB.get(`worldInstance:${id}`);
                const persisted = saved?.sessions?.find(item => item.id === sess.id);
                const lastReceipt = sess.worldTurnReceipts.at(-1);
                return {
                    before, after: getWorldTimeData(world, sess).currentTotalMinutes,
                    source: sess.lastTurnStateSource, lastText: sess.history.at(-1)?.text || '',
                    lastRole: sess.history.at(-1)?.role, playerLocation: sess.playerLocation,
                    ivenActivity: sess.entityStates.iven.currentActivity, beforeIvenActivity,
                    placeholderIds: Object.keys(sess.entityStates).filter(key => /^(?:villager|guard)_\d+$/.test(key)),
                    inventoryUnchanged: JSON.stringify(sess.inventory) === beforeItems,
                    warningStatus: sess.scheduledEvents.find(event => event.id === deadlineId)?.status,
                    scheduledEventCount: sess.scheduledEvents.length,
                    conditionResolution: sess.scheduledEvents.find(event => event.id === deadlineId)?.conditionResolution,
                    conditionPromisor: scheduled?.playerAbsentCondition?.promisorId,
                    conditionSerial: scheduled?.playerAbsentCondition?.playerMovementSerial,
                    scheduledDueMinute, scheduledDueTurn, scheduledWarning,
                    deadlineDetail: sess.consequences.find(item => item.type === 'deadline'
                        && String(item.sourceEventId || '').startsWith(`deadline_${deadlineId}_`))?.detail,
                    receiptEvents: lastReceipt?.receipt?.events || [],
                    receiptSummary: lastReceipt?.receipt?.summary || '',
                    receiptSource: lastReceipt?.audit?.source,
                    savedClock: persisted?.worldClock?.absoluteMinutes,
                    savedSource: persisted?.lastTurnStateSource,
                    savedText: persisted?.history?.at(-1)?.text || '',
                    savedConditionResolution: persisted?.scheduledEvents?.find(event => event.id === deadlineId)?.conditionResolution,
                    savedConditionPromisor: persisted?.scheduledEvents?.find(event => event.id === deadlineId)?.playerAbsentCondition?.promisorId
                };
            };
            const repaired = await run('dawn_repair_success');
            phase = 'contradiction';
            const contradiction = await run('dawn_repair_contradiction');
            phase = 'invalid';
            const invalid = await run('dawn_repair_rejected');
            phase = 'conditional';
            const conditional = await run('dawn_conditional_deadline');
            phase = 'conditional_recovered';
            const conditionalRecovered = await run('dawn_conditional_recovered');
            phase = 'conditional_request_recovered';
            const conditionalRequestRecovered = await run('dawn_conditional_request_recovered');
            phase = 'conditional_prose_only';
            const conditionalProseOnly = await run('dawn_conditional_prose_only');
            phase = 'conditional_resurrect';
            const conditionalResurrect = await run('dawn_conditional_resurrect');
            phase = 'conditional_summary_only';
            const conditionalSummaryOnly = await run('dawn_conditional_summary_only');
            return { parser, prompts, repaired, contradiction, invalid, conditional,
                conditionalRecovered, conditionalRequestRecovered, conditionalProseOnly, conditionalResurrect,
                conditionalSummaryOnly };
        }, fixture);
        assert.deepEqual(result.parser, {
            exact: 727, dawn: 722, question: null, hypothetical: null,
            ambiguous: null, completion: true, referencedCrowdRejected: true
        });
        assert(result.prompts.length >= 9 && result.prompts.length <= 18,
            'each of nine turns may make at most one validation-guided repair retry');
        for (const prompt of result.prompts) {
            assert.match(prompt, /minutes_elapsed:727/);
            assert.match(prompt, /Anonymous villagers, guards and crowds/);
            assert.match(prompt, /An offered or held-out item is not a player pickup/);
        }
        assert.equal(result.repaired.source, 'receipt_repair', JSON.stringify(result.repaired));
        assert.equal(result.repaired.after - result.repaired.before, 727);
        assert.match(result.repaired.lastText, /Iven prepares to lead the search party/);
        assert.equal(result.repaired.playerLocation, 'square');
        assert.equal(result.repaired.ivenActivity, 'leading search party');
        assert.deepEqual(result.repaired.placeholderIds, []);
        assert.equal(result.repaired.inventoryUnchanged, true);
        assert.equal(result.repaired.warningStatus, 'triggered');
        assert.equal(result.repaired.receiptEvents.filter(event => event.type === 'time').length, 1);
        assert.equal(result.repaired.receiptEvents.find(event => event.type === 'time')?.minutes_elapsed, 727);
        assert.equal(result.repaired.receiptSource, 'repair_receipt');
        assert.equal(result.repaired.savedClock, 1805);
        assert.equal(result.repaired.savedSource, 'receipt_repair');
        assert.equal(result.repaired.savedText, result.repaired.lastText);
        assert.equal(result.contradiction.source, 'frozen_no_receipt',
            JSON.stringify(result.contradiction));
        assert.equal(result.contradiction.after - result.contradiction.before, 727);
        assert.doesNotMatch(result.contradiction.lastText, /ranger's gone missing|search party/i);
        assert.equal(result.contradiction.ivenActivity, result.contradiction.beforeIvenActivity);
        assert.deepEqual(result.contradiction.placeholderIds, []);
        assert.equal(result.contradiction.receiptEvents.filter(event => event.type === 'time').length, 1);
        assert.equal(result.contradiction.savedText, result.contradiction.lastText);
        assert.equal(result.invalid.source, 'frozen_no_receipt', JSON.stringify(result.invalid));
        assert.equal(result.invalid.after - result.invalid.before, 727);
        assert.doesNotMatch(result.invalid.lastText, /Iven prepares to lead the search party/);
        assert.equal(result.invalid.ivenActivity, result.invalid.beforeIvenActivity);
        assert.deepEqual(result.invalid.placeholderIds, []);
        assert.equal(result.invalid.warningStatus, 'triggered');
        assert.equal(result.invalid.receiptEvents.filter(event => event.type === 'time').length, 1);
        assert.equal(result.invalid.savedClock, 1805);
        assert.equal(result.conditional.source, 'frozen_no_receipt', JSON.stringify(result.conditional));
        assert.equal(result.conditional.scheduledDueMinute, 1800,
            'A full tool commit must convert the corroborated first-light promise into a clock deadline.');
        assert.equal(result.conditional.scheduledDueTurn, null);
        assert.equal(result.conditional.scheduledWarning, true,
            'The conditional search must not be asserted as a guaranteed departure.');
        assert.equal(result.conditional.warningStatus, 'cancelled',
            'The explicit wait must clear the unfulfilled search promise.');
        assert.equal(result.conditional.conditionResolution, 'player_present');
        assert.equal(result.conditional.conditionPromisor, 'iven');
        assert.equal(result.conditional.conditionSerial, 0);
        assert.equal(result.conditional.scheduledEventCount, 1,
            'Model and narrator must not create two deadlines for one promise.');
        assert.equal(result.conditional.after, 1805);
        assert.equal(result.conditional.deadlineDetail, undefined);
        assert.match(result.conditional.lastText, /condition for .* was not met/i);
        assert.doesNotMatch(result.conditional.lastText, /villagers.*gather|prepares to lead/i);
        assert.equal(result.conditional.ivenActivity, result.conditional.beforeIvenActivity);
        assert.equal(result.conditional.savedClock, 1805);
        assert.equal(result.conditional.savedSource, 'frozen_no_receipt');
        assert.equal(result.conditional.savedConditionResolution, 'player_present');
        assert.equal(result.conditional.savedConditionPromisor, 'iven');
        for (const entry of [result.conditionalRecovered, result.conditionalRequestRecovered,
            result.conditionalProseOnly,
            result.conditionalResurrect]) {
            assert.equal(entry.source, 'frozen_no_receipt', JSON.stringify(entry));
            assert.equal(entry.after, 1805);
            assert.equal(entry.warningStatus, 'cancelled');
            assert.equal(entry.conditionResolution, 'player_present');
            assert.equal(entry.deadlineDetail, undefined);
            assert.equal(entry.ivenActivity, entry.beforeIvenActivity);
            assert.equal(entry.savedConditionResolution, 'player_present');
        }
        assert.equal(result.conditionalRecovered.conditionPromisor, 'iven');
        assert.equal(result.conditionalRequestRecovered.conditionPromisor, 'iven');
        assert.equal(result.conditionalRequestRecovered.scheduledDueMinute, 1800);
        assert.equal(result.conditionalRequestRecovered.scheduledEventCount, 1);
        assert.doesNotMatch(result.conditionalProseOnly.lastText, /men from the local watch assemble|moving out/i);
        assert.doesNotMatch(result.conditionalResurrect.lastText, /men from the local watch assemble|moving out/i);
        assert.equal(result.conditionalSummaryOnly.source, 'receipt_repair',
            JSON.stringify(result.conditionalSummaryOnly));
        assert.equal(result.conditionalSummaryOnly.after, 1805);
        assert.equal(result.conditionalSummaryOnly.warningStatus, 'cancelled');
        assert.equal(result.conditionalSummaryOnly.deadlineDetail, undefined);
        assert.match(result.conditionalSummaryOnly.lastText, /signals the scouts to hold/);
        assert.match(result.conditionalSummaryOnly.receiptSummary, /waited in the village square overnight/);
        assert.doesNotMatch(result.conditionalSummaryOnly.receiptSummary, /arrived with a search party/);
        assert.equal(result.conditionalSummaryOnly.savedConditionResolution, 'player_present');
        assert.deepEqual(errors, []);
        console.log('PASS: dawn wait repairs, conditional first-light cancellations, persistence, and false-mobilization guard');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
