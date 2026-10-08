/** Offline end-to-end browser gate for resolve-before-narrate Worlds turns. */
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
            if (url.hostname !== 'world-resolve-first.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)]
                || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-resolve-first.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined'
            && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const outcome = 'The pressure lever yields with a heavy metallic click.';
            const receipt = {
                summary: 'The player pulled the pressure lever.',
                action_resolution: { kind: 'physical', status: 'resolved', outcome },
                scene: { player_location_id: 'cellar', player_location_changed: false,
                    present_character_ids: [] },
                events: [{ type: 'interaction', actor_id: 'player', status: 'completed',
                    action: 'pull pressure lever', evidence: 'The lever yields with a metallic click.' }],
                entity_updates: [], state_updates: {}
            };
            const checkedReceipt = {
                ...receipt,
                summary: 'The player strains against the pressure lever; the check decides the valve.',
                action_resolution: { kind: 'physical', status: 'pending_check',
                    outcome: 'The lever resists as you pull; the Wits check decides whether the valve opens.' },
                events: [{ type: 'interaction', actor_id: 'player', status: 'attempted',
                    action: 'pull pressure lever', evidence: 'The player braces and pulls the corroded lever.' }],
                entity_updates: [{ entity_id: 'player', location_id: 'cellar',
                    activity: 'pulling the pressure lever' }],
                state_updates: { checks: [{ label: 'Ease open the pressure valve',
                    stat_id: 'wits', difficulty: 11,
                    success_text: 'The valve opens and vents the steam safely.',
                    failure_text: 'The lever sticks and steam hisses past your hand.',
                    on_success: {}, on_failure: {} }] }
            };
            const questionOutcome = 'The gauge needle rests safely below the red warning mark.';
            const travelOutcome = 'You reach the hall and leave the pressure lever behind.';
            const questionReceipt = { ...receipt, summary: 'The player reads the pressure gauge.',
                action_resolution: { kind: 'question', status: 'answered', outcome: questionOutcome },
                events: [], entity_updates: [], state_updates: {} };
            const travelReceipt = { ...receipt, summary: 'The player reached the hall.',
                action_resolution: { kind: 'travel', status: 'resolved', outcome: travelOutcome },
                scene: { player_location_id: 'hall', player_location_changed: true,
                    present_character_ids: [] },
                events: [], entity_updates: [], state_updates: {} };
            let phase = '';
            const calls = [];
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                const prompt = JSON.stringify(body.messages || []);
                if (body.stream) {
                    calls.push({ phase, kind: 'plan', contract: !!body.tools?.find(tool =>
                        tool.function?.name === 'commit_world_turn')?.function?.parameters?.properties?.action_resolution,
                        forced: body.tool_choice?.function?.name === 'commit_world_turn',
                        requiresParameters: body.provider?.require_parameters === true,
                        temperature: body.temperature });
                    const proposed = phase === 'missing_contract'
                        ? { ...receipt, action_resolution: undefined, events: [] }
                        : phase === 'invalid_then_repair'
                            ? { ...receipt, state_updates: { invented_deadline: 'noon' } }
                        : phase === 'missing_deadline_answer'
                            ? { ...questionReceipt, action_resolution: { kind: 'speech',
                                status: 'resolved', outcome: 'You put the examiner on the spot about the reserve files.' } }
                        : phase.endsWith('_check') ? checkedReceipt
                            : phase === 'valid_question' ? questionReceipt
                                : phase === 'valid_travel' ? travelReceipt : receipt;
                    const delta = { content: phase === 'invalid_then_repair' || phase === 'empty_no_receipt' ? ''
                        : 'A generic description of the cellar that ignores the lever.',
                        tool_calls: phase === 'empty_no_receipt' ? []
                            : [{ index: 0, id: `${phase}-receipt`, type: 'function',
                                function: { name: 'commit_world_turn', arguments: JSON.stringify(proposed) } }] };
                    return new Response(`data: ${JSON.stringify({ choices: [{ delta,
                        finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { status: 200,
                        headers: { 'Content-Type': 'text/event-stream' } });
                }
                if (prompt.includes('[WORLD TURN RECEIPT REPAIR]')) {
                    calls.push({ phase, kind: 'repair', forced: body.tool_choice?.function?.name === 'commit_world_turn',
                        requiresParameters: body.provider?.require_parameters === true,
                        hasExactRejection: prompt.includes('Previous proposal was rejected for these exact reasons'),
                        hasUnsupportedFieldError: prompt.includes('unsupported_state_update') });
                    if (phase === 'missing_deadline_answer') {
                        const corrected = { ...questionReceipt, action_resolution: { kind: 'question',
                            status: 'answered', outcome: 'The examiner declines to answer the deadline question until she reviews the files.' } };
                        return new Response(JSON.stringify({ choices: [{ message: {
                            tool_calls: [{ function: { name: 'commit_world_turn',
                                arguments: JSON.stringify(corrected) } }] } }] }),
                            { status: 200, headers: { 'Content-Type': 'application/json' } });
                    }
                    if (phase === 'invalid_then_repair') {
                        const attempt = calls.filter(call => call.kind === 'repair' && call.phase === phase).length;
                        const repaired = attempt === 1
                            ? { ...receipt, state_updates: { still_invented: true } } : receipt;
                        return new Response(JSON.stringify({ choices: [{ message: {
                            tool_calls: [{ function: { name: 'commit_world_turn',
                                arguments: JSON.stringify(repaired) } }] } }] }),
                            { status: 200, headers: { 'Content-Type': 'application/json' } });
                    }
                    return new Response(JSON.stringify({ choices: [{ message: {
                        content: '{not valid json' } }] }), { status: 200,
                        headers: { 'Content-Type': 'application/json' } });
                }
                if (prompt.includes('The requested tools have been processed')
                    || prompt.includes('[AUTHORITATIVE COMMITTED TURN]')) {
                    calls.push({ phase, kind: 'narration', compact: !prompt.includes('[ENGINE MANDATE: CANONICAL TURN COMMIT]')
                        && prompt.includes('[AUTHORITATIVE COMMITTED TURN]'), hasTools: !!body.tools?.length });
                    if (phase === 'timeout_check') throw new DOMException('Provider stopped', 'AbortError');
                    const narrationPrompt = body.messages?.at(-1)?.content || '';
                    const selectedOutcome = narrationPrompt.match(/"narrativeOutcome":"([^"]+)"/)?.[1] || '';
                    const content = phase === 'omitted_final' || phase === 'omitted_check'
                        ? 'The cellar is cold and quiet.'
                        : phase === 'uncommitted_deadline'
                            ? `${outcome} The deadline is by 4 p.m. today.`
                        : phase === 'missing_deadline_answer'
                            ? 'The examiner declines to answer the deadline question until she reviews the files.'
                        : phase === 'uncommitted_presence'
                            ? `${outcome} Ada Bell steps into the cellar.`
                        : phase === 'valid_check'
                            ? `${selectedOutcome} Steam hisses around the lever.`
                            : phase === 'valid_question' ? questionOutcome
                                : phase === 'valid_travel' ? travelOutcome
                            : `${outcome} Steam rushes through the opened valve.`;
                    return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                throw new Error(`Unexpected completion during ${phase}`);
            };
            const play = async name => {
                phase = name;
                const world = {
                    id: `resolve_first_${name}`, name: 'Resolve First Fixture',
                    model: 'fixture/model', contextSize: 32768, maxTokens: 1024,
                    dmPrompt: 'A pressure lever stands in the cellar.', intro: '',
                    startLocationId: 'cellar',
                    locations: [{ id: 'cellar', name: 'Cellar',
                        description: 'A cellar with a pressure lever.', exits: ['to Hall'] },
                    { id: 'hall', name: 'Hall', description: 'A quiet adjoining hall.',
                        exits: ['to Cellar'] }],
                    entities: name === 'uncommitted_presence'
                        ? [{ id: 'ada', name: 'Ada Bell', type: 'npc', startLocation: 'hall', persona: 'A watchful archivist.' }]
                        : [], kernel: { enabled: true, memoryMode: 'ledger',
                        repairMode: 'adaptive', resolveFirst: true, sceneDrafts: false },
                    hudConfig: { showClock: false, showQuests: false, showLedger: false,
                        stats: name.endsWith('_check') ? [{ id: 'wits', name: 'Wits',
                            value: 4, min: 0, max: 10, roll: { enabled: true } }] : [] },
                    gameRules: { profileId: 'adventure', modules: {
                        stats: name.endsWith('_check'), health: false, conditions: false, inventory: false,
                        checks: name.endsWith('_check'), commerce: false, quests: false, relationships: false,
                        schedules: false, livingWorld: false
                    } }
                };
                state.worlds = [world];
                state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                state.activeWorldId = world.id;
                const session = prepareCurrentWorldSession();
                session.setupComplete = true;
                session.history.push({ id: 'opening', role: 'dm',
                    text: 'The pressure lever is within reach.', location: 'cellar' });
                switchView('worldPlay');
                renderWorldPlayState();
                document.getElementById('world-user-input').value = name === 'missing_deadline_answer'
                    ? 'I ask the examiner for the deadline on the reserve files.'
                    : name === 'valid_question'
                    ? 'What does the pressure gauge indicate?'
                    : name === 'valid_travel' ? 'I go to the hall.'
                        : 'I pull the pressure lever slowly.';
                await executeWorldTurn();
                const last = [...session.history].reverse().find(message => message.role === 'dm');
                const saved = (await HordeDB.get(`worldInstance:${world.id}`))
                    ?.sessions?.find(item => item.id === session.id);
                return { source: last?.stateSource || session.lastTurnStateSource,
                    text: last?.text || '', audit: (session.lastTurnAudit?.rejected || [])
                        .map(item => item.reason),
                    committedEvents: session.worldTurnReceipts?.at(-1)?.receipt?.events?.length || 0,
                    checkCount: session.checkHistory?.length || 0,
                    presentationFallback: session.lastTurnAudit?.presentationFallback || '',
                    receiptCount: session.worldTurnReceipts?.length || 0,
                    savedReceiptCount: saved?.worldTurnReceipts?.length || 0,
                    savedCheckCount: saved?.checkHistory?.length || 0,
                    playerLocation: session.playerLocation,
                    busy: worldTurnInProgress };
            };
            const missing = await play('missing_contract');
            const valid = await play('valid');
            const repaired = await play('invalid_then_repair');
            const omitted = await play('omitted_final');
            const checked = await play('valid_check');
            const omittedCheck = await play('omitted_check');
            const timedOutCheck = await play('timeout_check');
            const question = await play('valid_question');
            const travel = await play('valid_travel');
            const deadline = await play('uncommitted_deadline');
            const presence = await play('uncommitted_presence');
            const deadlineRepaired = await play('missing_deadline_answer');
            const emptyNoReceipt = await play('empty_no_receipt');
            window.fetch = realFetch;
            return { missing, valid, repaired, omitted, checked, omittedCheck, timedOutCheck,
                question, travel, deadline, presence, deadlineRepaired, emptyNoReceipt, calls };
        });
        assert.equal(result.missing.source, 'frozen_no_receipt');
        assert.doesNotMatch(result.missing.text, /generic description/i);
        assert.equal(result.valid.source, 'tool_call');
        assert.match(result.valid.text, /^The pressure lever yields with a heavy metallic click\./);
        assert.doesNotMatch(result.valid.text, /generic description/i);
        assert.equal(result.valid.committedEvents, 1);
        assert.equal(result.repaired.source, 'receipt_repair');
        assert.equal(result.repaired.committedEvents, 1);
        assert.equal(result.repaired.receiptCount, 1);
        assert.equal(result.calls.filter(call => call.phase === 'invalid_then_repair'
            && call.kind === 'repair').length, 2);
        assert(result.calls.some(call => call.phase === 'invalid_then_repair'
            && call.kind === 'repair' && call.hasUnsupportedFieldError));
        assert.equal(result.omitted.source, 'tool_call');
        assert.equal(result.omitted.text, 'The pressure lever yields with a heavy metallic click.');
        assert(result.omitted.audit.includes('missing_committed_action_outcome'));
        assert(['tool_call', 'tool_call_check_salvage'].includes(result.checked.source),
            JSON.stringify(result.checked));
        assert.equal(result.checked.checkCount, 1);
        assert.equal(result.checked.busy, false);
        assert.match(result.checked.text, /valve opens|lever sticks/i);
        assert(result.omittedCheck.audit.includes('missing_committed_check_outcome'));
        assert.match(result.omittedCheck.text, /valve opens|lever sticks/i);
        assert.equal(result.timedOutCheck.presentationFallback, 'narration_stopped');
        assert.equal(result.timedOutCheck.receiptCount, 1);
        assert.equal(result.timedOutCheck.checkCount, 1);
        assert.equal(result.timedOutCheck.savedReceiptCount, 1);
        assert.equal(result.timedOutCheck.savedCheckCount, 1);
        assert.match(result.timedOutCheck.text, /valve opens|lever sticks/i);
        assert.equal(result.question.source, 'tool_call');
        assert.equal(result.question.text, 'The gauge needle rests safely below the red warning mark.');
        assert.equal(result.travel.playerLocation, 'hall');
        assert.equal(result.travel.text, 'You reach the hall and leave the pressure lever behind.');
        assert.equal(result.deadline.source, 'tool_call');
        assert(result.deadline.audit.includes('uncommitted_urgent_deadline'));
        assert.doesNotMatch(result.deadline.text, /4 p\.m\./);
        assert.match(result.deadline.text, /pressure lever yields/);
        assert(result.presence.audit.includes('uncommitted_npc_presence_claim'));
        assert.doesNotMatch(result.presence.text, /steps into the cellar/i);
        assert.equal(result.deadlineRepaired.source, 'receipt_repair');
        assert.equal(result.deadlineRepaired.text,
            'The examiner declines to answer the deadline question until she reviews the files.');
        assert(result.calls.some(call => call.phase === 'missing_deadline_answer'
            && call.kind === 'repair' && call.hasExactRejection));
        assert.equal(result.emptyNoReceipt.source, 'frozen_no_receipt');
        assert.equal(result.calls.filter(call => call.phase === 'empty_no_receipt'
            && call.kind === 'repair').length, 2);
        assert.equal(result.calls.filter(call => call.phase === 'empty_no_receipt'
            && call.kind === 'narration').length, 0);
        assert.deepEqual(result.calls.filter(call => call.kind === 'plan').map(call => call.contract),
            [true, true, true, true, true, true, true, true, true, true, true, true, true]);
        assert(result.calls.filter(call => call.kind === 'plan').every(call => call.forced
            && call.requiresParameters && call.temperature <= 0.2));
        assert(result.calls.filter(call => call.kind === 'repair').every(call => call.forced
            && call.requiresParameters && call.hasExactRejection));
        assert.deepEqual(result.calls.filter(call => call.kind === 'narration').length, 11);
        assert(result.calls.filter(call => call.kind === 'narration').every(call => call.compact && !call.hasTools));
        assert.deepEqual(errors, []);
        console.log('PASS: Worlds resolves and commits the player action before displaying final narration');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
