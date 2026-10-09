/** Release regressions: ordered NPC condition changes and historical clock dialogue. */
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
            if (url.hostname !== 'world-release-edge.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '{}' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-release-edge.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = { id: 'release_edges', name: 'Release Edges', model: 'fixture/model',
                contextSize: 32768, maxTokens: 2048, dmPrompt: 'Mara and Ada wait in the hall.', intro: '',
                startLocationId: 'hall', locations: [{ id: 'hall', name: 'Hall', exits: [] }],
                entities: ['mara', 'ada'].map(id => ({ id, name: id === 'mara' ? 'Mara' : 'Ada', type: 'npc', startLocation: 'hall' })),
                kernel: { enabled: true, sceneDrafts: true, memoryMode: 'ledger' },
                hudConfig: { startTimeHours: 8, timeStep: 5 } };
            state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id; state.apiKey = 'offline'; state.globalSettings.apiProvider = 'openrouter';
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
            for (const id of ['mara', 'ada']) sess.entityStates[id].location = 'hall';
            sess.history.push({ id: 'opening', role: 'dm', text: 'Mara and Ada wait beside you.', location: 'hall' });
            switchView('worldPlay'); renderWorldPlayState();
            const base = { scene: { player_location_id: 'hall', player_location_changed: false,
                present_character_ids: ['ada', 'mara'] }, events: [], entity_updates: [], state_updates: {} };
            const conditionCases = [];
            for (const [initial, changes] of [
                [[], [['add', 'bleeding'], ['add', 'poisoned']]],
                [['bleeding', 'poisoned'], [['remove', 'bleeding'], ['remove', 'poisoned']]],
                [[], [['add', 'bleeding'], ['remove', 'bleeding']]],
                [['bleeding'], [['remove', 'bleeding'], ['add', 'bleeding']]]
            ]) {
                sess.entityStates.mara.conditions = initial;
                sess.entityStates.ada.conditions = ['exhausted'];
                const receipt = { ...base, events: changes.map(([action, condition]) => ({
                    type: 'condition', actor_id: 'mara', status: 'completed', action, condition,
                    evidence: 'Mara’s condition changes.' })) };
                const before = JSON.stringify(sess.entityStates);
                validateWorldTurnReceipt(world, sess, receipt, { engineScene: true });
                if (JSON.stringify(sess.entityStates) !== before) throw Error('Validation mutated the live condition state');
                const committed = commitWorldTurnReceipt(world, sess, receipt, { engineScene: true }, 'release_audit');
                conditionCases.push({ conditions: [...sess.entityStates.mara.conditions],
                    otherActor: [...sess.entityStates.ada.conditions], rejected: committed.audit.rejected });
            }
            await saveWorldsState();
            const savedConditions = (await HordeDB.get('worldInstance:' + world.id)).sessions
                .find(session => session.id === sess.id).entityStates.mara.conditions;
            sess.entityStates.mara.conditions = [];
            const ordinary = [
                'Mara says, “I arrived here by noon yesterday.”',
                'Mara says, “Yesterday the gate closed before dawn.”',
                'Mara says, “Breakfast is served before dawn.”',
                'Mara says, “There is no deadline by noon.”',
                'Mara says, “The deadline was by 4 p.m. yesterday.”'
            ];
            const urgent = ['You must bring the files by 5 p.m. or the audit fails.',
                'Unlike yesterday, you must return by noon.', 'The deadline is by 4 p.m. today.'];
            const clockClaims = { ordinary: ordinary.map(text => worldNarratedUrgentClockClaim(text)),
                urgent: urgent.map(text => worldNarratedUrgentClockClaim(text)) };
            const warningsBefore = JSON.stringify(sess.scheduledEvents);
            const recoveredPast = recoverNarratedUrgentDeadline(world, sess,
                'Mara: “The gate closed by noon yesterday and the stranded men drowned.”');
            const recoveryMutatedState = JSON.stringify(sess.scheduledEvents) !== warningsBefore;
            let calls = 0, narrative = ordinary[0];
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const proposal = { protocol: 'scene_draft_v2', narrative: [{ id: 'answer', text: narrative }],
                    actions: [{ request: 'When did you arrive?', kind: 'question', status: 'answered', response_id: 'answer' }],
                    events: [], effects: {}, speech: [{ speaker: 'mara', listeners: ['player'], passage_id: 'answer' }], commitments: [] };
                return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposal) }, finish_reason: 'stop' }] }),
                    { headers: { 'Content-Type': 'application/json' } });
            };
            document.getElementById('world-user-input').value = 'When did you arrive?';
            await executeWorldTurn();
            const ordinaryTurn = { calls, text: sess.history.at(-1).text, source: sess.history.at(-1).stateSource,
                busy: worldTurnInProgress, scheduled: safeJsonClone(sess.scheduledEvents || []) };
            narrative = urgent[0];
            document.getElementById('world-user-input').value = 'When did you arrive?';
            await executeWorldTurn();
            const urgentTurn = { text: sess.history.at(-1).text, source: sess.history.at(-1).stateSource, busy: worldTurnInProgress };
            const beforeBlockedEdit = JSON.stringify(sess);
            worldTurnInProgress = true;
            const resetDuringTurn = await hardResetActiveWorldTimeline();
            const resetKeptCanon = JSON.stringify(sess) === beforeBlockedEdit;
            worldTurnInProgress = false;
            return { conditionCases, savedConditions, clockClaims, recoveredPast,
                recoveryMutatedState, ordinaryTurn, urgentTurn, resetDuringTurn, resetKeptCanon };
        });
        assert.deepEqual(result.conditionCases.map(row => row.conditions), [['bleeding', 'poisoned'], [], [], ['bleeding']]);
        for (const row of result.conditionCases) {
            assert.deepEqual(row.otherActor, ['exhausted']); assert.deepEqual(row.rejected, []);
        }
        assert.deepEqual(result.savedConditions, ['bleeding']);
        assert(result.clockClaims.ordinary.every(value => value === ''), JSON.stringify(result.clockClaims));
        assert(result.clockClaims.urgent.every(Boolean), JSON.stringify(result.clockClaims));
        assert.equal(result.recoveredPast, null); assert.equal(result.recoveryMutatedState, false);
        assert.equal(result.ordinaryTurn.calls, 1, 'ordinary historical dialogue must not need receipt repair');
        assert.equal(result.ordinaryTurn.text, 'Mara says, “I arrived here by noon yesterday.”');
        assert.notEqual(result.ordinaryTurn.source, 'frozen_no_receipt');
        assert.deepEqual(result.ordinaryTurn.scheduled, []);
        assert.equal(result.ordinaryTurn.busy, false);
        assert.equal(result.urgentTurn.source, 'frozen_no_receipt', 'a new uncommitted urgent obligation must still fail closed');
        assert.equal(result.urgentTurn.busy, false);
        assert.equal(result.resetDuringTurn, false);
        assert.equal(result.resetKeptCanon, true, 'reset cannot replace state held by an active turn');
        assert.deepEqual(errors, []);
        console.log('PASS: ordered NPC conditions persist; historical/ordinary times need no repair; urgent clock commitments remain guarded');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
