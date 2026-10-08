/** Replays the live no-check gate receipt through the browser turn pipeline. No API. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
    'worlds2-rpg-live.horde_world'), 'utf8'));

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-narrated-check.test') return route.abort();
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
        await page.goto('https://world-narrated-check.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined'
            && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async source => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const narrative = `You strip a thin wire from the satchel strap and slide it into the old gate lock.

This requires a check of your ingenuity and steady hand.

**Check Required:**
**Stat:** Wits
**Difficulty:** 11
**Failure Cost:** The wire snaps and the lock jams.

**Please provide a d20 roll or allow the engine to resolve.**`;
            const statFirstNarrative = `The sun hangs low, casting long, amber shadows across the scrubland. The iron gate of the watchtower stands cold and imposing, its heavy bars blocking the path forward.

As you lean in, you can see a strange, crystalline growth—thin, translucent filaments of salt-glass—weaving through the mortar and curling around the lock's housing. The wire from your strap is slender, but the mechanism inside the lock is old and likely stiff from the damp marsh air.

This is a delicate operation.

***

**Wits Check: Probing the Lock**
Difficulty: 11
Modifier: +4 (Wits)
Failure Cost: The wire snaps or the lock jams, potentially alerting anyone inside or leaving the gate permanently stuck.`;
            const imperativeNarrative = `The iron gate is cold and heavy, weeping rust in long, orange streaks down the stonework. Around the edges of the doorframe, crystalline salt-glass filaments shimmer in the fading light, clinging to the masonry like frozen webs.

You lean in, feeling the tension of the wire against the tumblers. The mechanism is old, stiff with age and grit, resisting the probe with a stubborn, metallic grinding.

This attempt is uncertain. Please provide a Wits check to see if you can manipulate the lock.

<world_turn_receipt>{"scene":{"player_location_id":"gate","player_location_changed":false,"present_character_ids":[]},"events":[{"action":"probing lock","activity":"attempting to pick lock","actor_id":"player","status":"in_progress","evidence":"player uses a wire from a satchel strap to probe the gate lock"}],"entity_updates":[],"state_updates":{}}</world_turn_receipt>`;
            // The exact structural no-check receipt returned by the live model.
            const noCheckReceipt = {
                entity_updates: [{ activity: 'probing lock', entity_id: 'player',
                    interacting_with: ['watchtower gate lock'], location_id: 'gate',
                    outfit: 'Standard attire' }],
                events: [{ action: 'draw wire', actor_id: 'player',
                    evidence: 'wire from satchel strap', status: 'completed', type: 'activity' }],
                scene: { player_location_changed: false, player_location_id: 'gate',
                    present_character_ids: [] },
                state_updates: {}
            };
            const checkedReceipt = {
                summary: 'The watchtower gate lock awaits the roll.',
                scene: noCheckReceipt.scene, events: [], entity_updates: [],
                state_updates: { checks: [{ id: 'pick_tower_gate',
                    label: 'Picking the Watchtower Gate Lock', stat_id: 'wits',
                    difficulty: 11, on_success: { exit_unlocks: [
                        { from_location_id: 'gate', to_location_id: 'cellar' }
                    ] }, on_failure: {} }] }
            };
            const probe4Narrative = `The light drizzle turns the iron of the gate slick and cold. You strip a length of stiff, thin wire from the frayed edges of your satchel strap, feeling the tension of the metal as you guide it into the keyhole. The lock is old, the mechanism grinding with a gritty, salt-like residue that resists the wire's movement.

The gate remains shut, the heavy bars immovable as you search for the internal tumblers.

***

**Action:** Probing the lock with a makeshift wire.
**Check Required:** Wits (Difficulty 11)`;
            const probe4MainReceipt = {
                entity_updates: [{ activity: 'probing the lock', entity_id: 'player',
                    interacting_with: ['watchtower gate'], location_id: 'gate',
                    outfit: 'Standard attire' }],
                events: [{ action: 'draw wire from strap', actor_id: 'player',
                    evidence: 'used torn satchel strap to create a probe',
                    item: 'improvised wire', status: 'completed', type: 'inventory' }],
                scene: { player_location_changed: false, player_location_id: 'gate',
                    present_character_ids: ['player'] }, state_updates: {},
                checks: [{ difficulty: 11, id: 'pick_gate_lock',
                    label: 'Picking the gate lock with wire', stat_id: 'wits',
                    on_failure: { time_skip_minutes: '5' },
                    on_success: { exit_unlocks: [
                        { from_location_id: 'gate', to_location_id: 'cellar' }
                    ] } }]
            };
            const probe4Repair = {
                scene: { player_location_id: 'gate', player_location_changed: false,
                    present_character_ids: [] }, events: [], entity_updates: [],
                state_updates: { checks: {
                    label: 'Probing the lock with a makeshift wire',
                    rollable_stat_id: 'wits', difficulty: 11,
                    on_success: { events: [], entity_updates: [], state_updates: {},
                        exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }] },
                    on_failure: { events: [], entity_updates: [], state_updates: {} }
                } }, summary: 'A Wits check is required to determine success.'
            };
            const probe5Narrative = `You pull the torn courier strap from your pack and slide a thin wire into the old gate lock. The tumblers resist as you feel for the bolt; the gate stays shut while the outcome is uncertain.`;
            const probe5MainReceipt = {
                checks: [{ difficulty: 11, label: 'Pick Gate Lock with Wire', stat_id: 'wits',
                    on_success: { exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }],
                        stat_changes: {} },
                    on_failure: { cause: 'The wire snaps or the lock jams further.',
                        condition: 'frustrated', stat_changes: {} } }],
                events: [{ action: 'tried to pick lock', actor_id: 'player',
                    evidence: 'Using a wire from the courier strap to open the gate lock.',
                    status: 'attempted', target_id: 'gate_lock' }],
                entity_updates: [{ activity: 'kneeling', entity_id: 'player',
                    interacting_with: ['gate_lock'], location_id: 'gate',
                    outfit: 'Standard attire' }],
                scene: { player_location_changed: false, player_location_id: 'gate',
                    present_character_ids: ['player'] }
            };
            let phase = 'player';
            const calls = [];
            const promptContracts = {};
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                const prompt = JSON.stringify(body.messages || []);
                const respond = content => new Response(JSON.stringify({
                    choices: [{ message: { content } }]
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (body.stream) {
                    calls.push(`${phase}:main`);
                    if (phase === 'imperative_valid') promptContracts.main =
                        /prose requests or requires a check[\s\S]*state_updates\.checks/i.test(prompt)
                        && /default difficulty 11/i.test(prompt);
                    const statFirst = phase.startsWith('stat_');
                    const imperative = phase.startsWith('imperative_');
                    const exactProbe4 = phase === 'probe4';
                    const exactProbe5 = phase === 'probe5';
                    const toolOnlyRejectedCheck = phase === 'tool_only_rejected_check';
                    const delta = {
                        content: phase === 'late' || toolOnlyRejectedCheck ? '' : statFirst ? statFirstNarrative
                            : imperative ? imperativeNarrative
                                : exactProbe4 ? probe4Narrative
                                    : exactProbe5 ? probe5Narrative : narrative,
                        tool_calls: statFirst || imperative ? [] : toolOnlyRejectedCheck ? [
                            { index: 0, id: 'bad-move', type: 'function', function: {
                                name: 'commit_world_turn', arguments: JSON.stringify({
                                    scene: null,
                                    events: [{ type: 'movement', actor_id: 'player', status: 'completed',
                                        to_location_id: 'gate' }], entity_updates: []
                                }) } },
                            { index: 1, id: 'bad-check', type: 'function', function: {
                                name: 'commit_world_turn', arguments: JSON.stringify({
                                    scene: { player_location_id: 'gate', player_location_changed: false,
                                        present_character_ids: [] }, events: [], entity_updates: [],
                                    checks: [{ label: 'Pick the gate lock', difficulty: 11,
                                        stat_id_modifier: 'wits', on_successy: {} }]
                                }) } }
                        ] : [{ index: 0, id: `${phase}-receipt`, type: 'function',
                            function: { name: 'commit_world_turn',
                                arguments: JSON.stringify(exactProbe4 ? probe4MainReceipt
                                    : exactProbe5 ? probe5MainReceipt : noCheckReceipt) } }]
                    };
                    const sse = `data: ${JSON.stringify({ choices: [{ delta,
                        finish_reason: statFirst || imperative ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`;
                    return new Response(sse, { status: 200,
                        headers: { 'Content-Type': 'text/event-stream' } });
                }
                if (/\[WORLD TURN RECEIPT REPAIR\]/i.test(prompt)) {
                    calls.push(`${phase}:repair`);
                    if (phase === 'imperative_valid') promptContracts.repair =
                        /state_updates:\{\} and a no-check receipt are invalid/i.test(prompt)
                        && /default difficulty 11/i.test(prompt);
                    return respond(phase === 'failed' ? '{not valid json'
                        : phase === 'probe4' ? JSON.stringify(probe4Repair)
                        : phase === 'probe5' ? JSON.stringify({ ...noCheckReceipt,
                            events: [], entity_updates: [], summary: 'The lock remains uncertain.' })
                        : phase === 'stat_failed' || phase === 'stat_disabled'
                            || phase === 'imperative_failed' || phase === 'imperative_disabled'
                            ? JSON.stringify({ ...noCheckReceipt, events: [], entity_updates: [],
                                summary: 'The player attempts to probe the lock; the narrator requests a Wits check.' })
                        : JSON.stringify(checkedReceipt));
                }
                if (/The requested tools have been processed/i.test(prompt)) {
                    calls.push(`${phase}:follow-up`);
                    if (phase === 'late') return respond(narrative);
                    const unlocked = getCurrentWorldSession()?.unlockedExits?.['gate::cellar'] === true;
                    return respond(unlocked
                        ? 'The tumblers yield and the gate unlocks. The cellar route is open.'
                        : 'The wire bends against the tumblers. The gate remains locked.');
                }
                calls.push(`${phase}:other`);
                return respond('');
            };
            const play = async (name, resolution) => {
                phase = name;
                const world = structuredClone(source);
                world.id = `world_check_${name}_fixture`;
                world.model = 'offline/fixture';
                world.kernel = { ...world.kernel, resolveFirst: false, sceneDrafts: false }; // legacy provider-repair fixture
                world.contextSize = 32768;
                world.maxTokens = 2048;
                world.startLocationId = 'gate';
                world.gameRules.dice.resolution = resolution;
                if (name === 'disabled' || name === 'stat_disabled'
                    || name === 'imperative_disabled') world.gameRules.modules.checks = false;
                state.worlds = [world];
                state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                state.activeWorldId = world.id;
                const session = prepareCurrentWorldSession();
                session.setupComplete = true;
                session.playerLocation = 'gate';
                session.inventory = name === 'probe4' ? ['torn satchel strap']
                    : name === 'probe5' ? ['torn courier strap'] : [];
                session.pendingChecks = [];
                session.pendingCheck = null;
                session.history.push({ id: 'opening', role: 'dm',
                    text: 'The watchtower gate is locked.', location: 'gate' });
                switchView('worldPlay');
                document.getElementById('modal-overlay')?.classList.add('hidden');
                renderWorldPlayState();
                document.getElementById('world-user-input').value =
                    'I probe the gate lock with wire. Ask for a Wits check before opening it.';
                await executeWorldTurn();
                const gate = world.locations.find(location => location.id === 'gate');
                const exit = gate.exits.find(item => item.targetLocationId === 'cellar');
                const last = [...session.history].reverse().find(message => message.role === 'dm');
                return { source: last?.stateSource || session.lastTurnStateSource,
                    text: last?.text || '', pending: session.pendingChecks?.length || 0,
                    checks: session.checkHistory?.length || 0,
                    rollSuccess: session.checkHistory?.at(-1)?.success ?? null,
                    unlocked: worldExitRequirement(session, exit, 'gate').ok,
                    inventory: (session.inventory || []).map(item => String(item?.name || item)),
                    audit: session.lastTurnAudit?.rejected?.map(item => item.reason) || [],
                    auditSource: session.lastTurnAudit?.source || '',
                    auditSalvaged: session.lastTurnAudit?.salvaged || '',
                    saved: await HordeDB.get(`worldInstance:${world.id}`) };
            };
            const player = await play('player', 'player');
            const automatic = await play('automatic', 'automatic');
            const failed = await play('failed', 'player');
            const late = await play('late', 'player');
            const disabled = await play('disabled', 'automatic');
            const statValid = await play('stat_valid', 'player');
            const statFailed = await play('stat_failed', 'player');
            const statDisabled = await play('stat_disabled', 'automatic');
            const imperativeValid = await play('imperative_valid', 'player');
            const imperativeFailed = await play('imperative_failed', 'player');
            const imperativeDisabled = await play('imperative_disabled', 'automatic');
            const probe4 = await play('probe4', 'player');
            const probe5 = await play('probe5', 'player');
            const toolOnlyRejectedCheck = await play('tool_only_rejected_check', 'player');
            window.fetch = realFetch;
            return { player, automatic, failed, late, disabled,
                statValid, statFailed, statDisabled,
                imperativeValid, imperativeFailed, imperativeDisabled, probe4, probe5,
                toolOnlyRejectedCheck, calls,
                promptContracts,
                parserMatchesLiveText: worldNarrativeRequestsCheck(narrative),
                stripped: stripWorldCheckScaffolding(narrative),
                parserMatchesStatFirst: worldNarrativeRequestsCheck(statFirstNarrative),
                strippedStatFirst: stripWorldCheckScaffolding(statFirstNarrative),
                parserMatchesImperative: worldNarrativeRequestsCheck(imperativeNarrative),
                strippedImperative: stripWorldCheckScaffolding(imperativeNarrative) };
        }, fixture);
        assert.equal(result.parserMatchesLiveText, true);
        assert.doesNotMatch(result.stripped, /provide a d20|Failure Cost/i);
        assert.equal(result.player.source, 'receipt_repair');
        assert.equal(result.player.pending, 1, 'repair must register the player roll');
        assert.equal(result.player.checks, 0, 'player-resolution mode must not autoroll');
        assert.equal(result.player.unlocked, false, 'the gate remains closed before the roll');
        assert.match(result.player.text, /🎲 Check button/i);
        assert.doesNotMatch(result.player.text, /provide a d20|Failure Cost/i);
        assert.equal(result.player.saved?.sessions?.[0]?.pendingChecks?.length, 1,
            'the pending check must survive save/reload');
        assert.equal(result.automatic.source, 'receipt_repair');
        assert.equal(result.automatic.pending, 0);
        assert.equal(result.automatic.checks, 1, 'automatic mode must roll exactly once');
        assert.equal(result.automatic.unlocked, result.automatic.rollSuccess,
            'the gate must open iff the authoritative roll succeeds');
        assert.equal(result.automatic.saved?.sessions?.[0]?.unlockedExits?.['gate::cellar'] === true,
            result.automatic.rollSuccess, 'the persisted route must match the authoritative roll');
        assert.doesNotMatch(result.automatic.text, /Check Required|provide a d20/i);
        assert.equal(result.failed.source, 'frozen_no_receipt');
        assert.equal(result.failed.pending, 0);
        assert.match(result.failed.text, /did not register.*no roll or outcome/i);
        assert.equal(result.late.source, 'tool_call');
        assert.equal(result.late.pending, 0);
        assert.match(result.late.text, /did not register.*no roll or outcome/i,
            'a late check request cannot silently pass under an earlier no-op receipt');
        assert.equal(result.disabled.source, 'tool_call');
        assert.match(result.disabled.text, /checks disabled.*No roll or check outcome/i);
        assert.equal(result.disabled.checks, 0);
        assert.equal(result.parserMatchesStatFirst, true);
        assert.match(result.strippedStatFirst, /This is a delicate operation/);
        assert.doesNotMatch(result.strippedStatFirst, /Wits Check|Difficulty: 11|Failure Cost|\*\*\*/i);
        assert.equal(result.statValid.source, 'receipt_repair');
        assert.equal(result.statValid.pending, 1,
            'the exact stat-first block must bind the valid repaired check');
        assert.match(result.statValid.text, /🎲 Check button/i);
        assert.doesNotMatch(result.statValid.text, /Wits Check|Difficulty: 11|Failure Cost/i);
        assert.equal(result.statFailed.source, 'frozen_no_receipt');
        assert.equal(result.statFailed.pending, 0);
        assert.match(result.statFailed.text, /did not register.*no roll or outcome/i,
            'the captured empty repair cannot silently accept a stat-first check');
        assert.equal(result.statDisabled.source, 'receipt_repair');
        assert.match(result.statDisabled.text, /checks disabled.*No roll or check outcome/i);
        assert.equal(result.statDisabled.pending, 0);
        assert.equal(result.parserMatchesImperative, true);
        assert.match(result.strippedImperative, /This attempt is uncertain\./);
        assert.doesNotMatch(result.strippedImperative, /Please provide a Wits check|world_turn_receipt/i);
        assert.equal(result.imperativeValid.source, 'receipt_repair');
        assert.equal(result.promptContracts.main, true,
            'the first-pass prompt must require canonical checks rather than raw dice');
        assert.equal(result.promptContracts.repair, true,
            'the no-DC repair prompt must use the World default difficulty');
        assert.equal(result.imperativeValid.pending, 1);
        assert.match(result.imperativeValid.text, /🎲 Check button/i);
        assert.doesNotMatch(result.imperativeValid.text, /Please provide a Wits check|world_turn_receipt/i);
        assert.equal(result.imperativeFailed.source, 'frozen_no_receipt');
        assert.equal(result.imperativeFailed.pending, 0);
        assert.match(result.imperativeFailed.text, /did not register.*no roll or outcome/i);
        assert.equal(result.imperativeDisabled.source, 'receipt_repair');
        assert.match(result.imperativeDisabled.text, /checks disabled.*No roll or check outcome/i);
        assert.equal(result.probe4.source, 'receipt_repair');
        assert.equal(result.probe4.pending, 1,
            'the exact malformed singleton repair should safely queue its check');
        assert.equal(result.probe4.unlocked, false);
        assert(result.probe4.inventory.includes('torn satchel strap'));
        assert(!result.probe4.inventory.includes('improvised wire'),
            'normalizing the check must not grant the unsupported invented item');
        assert.deepEqual(result.probe4.saved?.sessions?.[0]?.pendingChecks?.[0]?.on_success,
            { exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }] });
        assert.doesNotMatch(result.probe4.text, /Check Required|improvised wire.*item/i);
        assert.equal(result.probe5.source, 'frozen_no_receipt',
            'unsupported check outcome keys must not be silently discarded from a pending roll');
        assert.equal(result.probe5.pending, 0);
        assert.equal(result.probe5.unlocked, false);
        assert(result.probe5.audit.includes('missing_mandatory_receipt'));
        assert(result.probe5.inventory.includes('torn courier strap'));
        assert(!result.probe5.inventory.includes('improvised wire'));
        assert(result.calls.includes('probe5:repair'),
            'a malformed check branch needs a repair attempt before it can become canon');
        assert.equal(result.toolOnlyRejectedCheck.source, 'receipt_repair',
            `Rejected multi-tool check proposals must repair before any prose is requested: ${JSON.stringify({ turn: result.toolOnlyRejectedCheck, calls: result.calls.filter(call => call.startsWith('tool_only_rejected_check:')) })}`);
        assert.equal(result.toolOnlyRejectedCheck.pending, 1);
        assert.equal(result.toolOnlyRejectedCheck.unlocked, false);
        assert.deepEqual(result.calls.filter(call => call.startsWith('tool_only_rejected_check:')),
            ['tool_only_rejected_check:main', 'tool_only_rejected_check:repair',
                'tool_only_rejected_check:follow-up']);
        assert(result.calls.includes('player:repair'));
        assert(result.calls.includes('automatic:repair'));
        assert(result.calls.includes('automatic:follow-up'));
        assert.deepEqual(errors, []);
        console.log('PASS: narrated check request repairs or explicitly warns; pending/auto rolls and late prose are canonical');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
