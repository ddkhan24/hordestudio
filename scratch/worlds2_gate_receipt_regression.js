/** Live gate payload, check salvage, manual check binding and false-canon guard. No API. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { app, buildContext } = require('./app_source.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
    'worlds2-rpg-live.horde_world'), 'utf8'));
const world = structuredClone(fixture);
world.gameRules.dice.resolution = 'player';
const context = buildContext(vm, [
    'buildSafeCheckOnlyWorldReceipt', 'validateWorldTurnReceipt',
    'repairWorldSingletonCheckReceipt',
    'processStructuredActions', 'performAuthoritativeChecks',
    'worldManualCheckExitUnlock', 'worldLockedExitClaimConflict',
    'worldFinalNarrativeConflicts', 'worldExitRequirement', 'findWorldTravelPath',
    'worldCheckScaffoldStart', 'worldImperativeCheckRequestStart',
    'worldNarrativeRequestsCheck', 'stripWorldCheckScaffolding',
    'worldMissingCheckNotice', 'worldChecksDisabledNotice', 'worldResolvedCheckNotice'
], {
    console: { log() {}, warn() {}, error() {} },
    showToast() {},
    state: { worldInstances: {} }
});

function session(id) {
    return {
        id, playerLocation: 'gate', turnCount: 3, history: [], checkHistory: [],
        inventory: ['short sword', 'rope'], equipment: {},
        entityStates: {
            mara: { location: 'inn', status: 'alive' },
            iven: { location: 'square', status: 'alive' },
            sel: { location: 'cellar', status: 'alive' },
            tomas: { location: 'cellar', status: 'alive' }
        },
        playerStats: { hp: 12, might: 3, wits: 4, silver: 6 },
        playerState: { status: 'active', conditions: [] },
        pendingChecks: [], quests: [], ledger: '', outfit: 'Standard attire'
    };
}

// Exact structural payload from the live provider call, including the invalid
// attempted event and the activity assertion that previously erased the check.
const live = {
    checks: [{ capability_id: 'wits', difficulty: 11,
        failure_cost: { cause: 'lock jam', condition: 'frustrated', time_skip_minutes: 10 },
        id: 'pick_tower_gate', label: 'Picking the Watchtower Gate Lock', modifier: 0,
        on_failure: {}, on_success: { exit_unlocks: [
            { from_location_id: 'gate', to_location_id: 'cellar' }
        ] }, stat_id: 'wits' }],
    entity_updates: [{ activity: 'picking lock', conditions: [], entity_id: 'player',
        interacting_with: ['gate'], location_id: 'gate', outfit: 'Standard attire' }],
    events: [{ action: 'attempt_pick_lock', actor_id: 'player', cause: 'missing key',
        status: 'attempted', target_id: 'gate' }],
    scene: { player_location_changed: false, player_location_id: 'gate',
        present_character_ids: [] }, state_updates: {}
};

const s = session('gate_salvage');
const receiptContext = { playerStartLocationId: 'gate',
    narrativeText: 'The old mechanism requires a check of your wits.' };
const rejected = context.validateWorldTurnReceipt(world, s, live, receiptContext);
assert(rejected.rejectedEvents.some(event => event.reason === 'unsupported_event_type'),
    'the malformed attempt must not be accepted as a normal receipt');
const safe = context.buildSafeCheckOnlyWorldReceipt(world, s, live, receiptContext);
assert(safe, 'the safe, noncommitting live attempt retains its check');
assert.deepEqual(JSON.parse(JSON.stringify(safe.events)), []);
assert.deepEqual(JSON.parse(JSON.stringify(safe.entity_updates)), []);
assert.deepEqual(JSON.parse(JSON.stringify(safe.state_updates.checks[0].on_success)),
    live.checks[0].on_success);
const accepted = context.validateWorldTurnReceipt(world, s, safe, receiptContext);
assert.equal(accepted.rejectedEvents.length, 0, JSON.stringify(accepted.rejectedEvents));
const queued = context.processStructuredActions(accepted.legacyArgs, world, s,
    { deferFeedback: true });
assert.equal(queued.checkResults[0].pending, true);
assert.deepEqual(JSON.parse(JSON.stringify(s.pendingCheck.on_success)), live.checks[0].on_success);
const gate = world.locations.find(location => location.id === 'gate');
const edge = gate.exits.find(exit => exit.targetLocationId === 'cellar');
assert.equal(context.worldExitRequirement(s, edge, 'gate').ok, false);

const releaseCandidateCheck = {
    checks: [{ difficulty: 11, label: 'Pick Gate Lock with Wire', stat_id: 'wits',
        on_failure: { cause: 'The wire snaps or the lock jams further.',
            condition: 'frustrated', stat_changes: {} },
        on_success: { exit_unlocks: [
            { from_location_id: 'gate', to_location_id: 'cellar' }
        ], stat_changes: {} } }],
    events: [{ action: 'tried to pick lock', actor_id: 'player',
        evidence: 'Using a wire from the courier strap to open the gate lock.',
        status: 'attempted', target_id: 'gate_lock' }],
    entity_updates: [{ activity: 'kneeling', entity_id: 'player',
        interacting_with: ['gate_lock'], location_id: 'gate', outfit: 'Standard attire' }],
    scene: { player_location_changed: false, player_location_id: 'gate',
        present_character_ids: ['player'] }
};
const releaseCheck = context.buildSafeCheckOnlyWorldReceipt(world,
    session('release_candidate_gate'), releaseCandidateCheck,
    { playerStartLocationId: 'gate', narrativeText: 'The gate remains shut.' });
assert(releaseCheck, 'the release candidate attempted player event is structurally salvageable');

const success = context.performAuthoritativeChecks(world, s, [{ ...s.pendingCheck,
    provided_roll: 20, force_resolve: true }], { allowProvidedRoll: true, silent: true })[0];
assert.equal(success.success, true);
const opened = context.processStructuredActions(safe.state_updates.checks[0].on_success,
    world, s, { authorizedCheckOutcome: true, deferFeedback: true });
assert.equal(opened.exitUnlockResults[0].unlocked, true);
assert.equal(context.worldExitRequirement(s, edge, 'gate').ok, true);
assert.deepEqual(Array.from(context.findWorldTravelPath(world, 'gate', 'cellar', { session: s })),
    ['gate', 'cellar']);
const restored = JSON.parse(JSON.stringify(s));
assert.equal(context.worldExitRequirement(restored, edge, 'gate').ok, true,
    'the unlock survives a serialized save/reload');

const failed = session('gate_failure');
const pending = context.processStructuredActions({ checks: live.checks }, world, failed,
    { deferFeedback: true });
assert.equal(pending.checkResults[0].pending, true);
const miss = context.performAuthoritativeChecks(world, failed, [{ ...failed.pendingCheck,
    provided_roll: 1, force_resolve: true }], { allowProvidedRoll: true, silent: true })[0];
assert.equal(miss.success, false);
assert.equal(context.worldExitRequirement(failed, edge, 'gate').ok, false);

assert.equal(context.buildSafeCheckOnlyWorldReceipt(world, session('complete'), {
    ...live, events: [{ type: 'inventory', actor_id: 'player', status: 'completed',
        action: 'add', item: 'brass tower key' }]
}, receiptContext), null, 'a completed event cannot be silently discarded');
assert.equal(context.buildSafeCheckOnlyWorldReceipt(world, session('foreign'), {
    ...live, events: [{ type: 'activity', actor_id: 'mara', status: 'attempted' }]
}, receiptContext), null, 'another actor’s attempt cannot be silently discarded');
assert.equal(context.buildSafeCheckOnlyWorldReceipt(world, session('extra'), {
    ...live, state_updates: { stat_changes: { hp: -3 } }
}, receiptContext), null, 'a non-check mutation cannot be silently discarded');

const malformedProbe4Repair = {
    scene: { player_location_id: 'gate', player_location_changed: false,
        present_character_ids: [] }, events: [], entity_updates: [],
    state_updates: { checks: {
        label: 'Probing the lock with a makeshift wire', rollable_stat_id: 'wits',
        difficulty: 11,
        on_success: { events: [], entity_updates: [], state_updates: {},
            exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }] },
        on_failure: { events: [], entity_updates: [], state_updates: {} }
    } },
    summary: 'A Wits check is required to determine success.'
};
const repairSession = session('probe4_repair');
const strictRepair = context.repairWorldSingletonCheckReceipt(world, repairSession,
    malformedProbe4Repair);
assert(strictRepair, 'the exact side-effect-free probe4 repair can be normalized safely');
assert(Array.isArray(strictRepair.state_updates.checks));
assert.equal(strictRepair.state_updates.checks[0].stat_id, 'wits');
assert.deepEqual(JSON.parse(JSON.stringify(strictRepair.state_updates.checks[0].on_success)),
    { exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }] });
const normalizedValidation = context.validateWorldTurnReceipt(world, repairSession, strictRepair,
    receiptContext);
assert.deepEqual(JSON.parse(JSON.stringify(normalizedValidation.rejectedEvents)), []);
const normalizedQueued = context.processStructuredActions(normalizedValidation.legacyArgs,
    world, repairSession, { deferFeedback: true });
assert.equal(normalizedQueued.checkResults[0].pending, true);
assert.deepEqual(JSON.parse(JSON.stringify(repairSession.pendingCheck.on_success)),
    { exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }] });
const modernRepair = context.repairWorldSingletonCheckReceipt(world, session('modern_repair'), {
    ...malformedProbe4Repair,
    action_resolution: { kind: 'physical', status: 'pending_check',
        outcome: 'You probe the lock; the Wits check decides whether it opens.' },
    state_updates: { checks: { ...malformedProbe4Repair.state_updates.checks,
        success_text: 'You open the lock with the bent wire.',
        failure_text: 'The tumblers jam under the wire.' } }
});
assert.equal(modernRepair?.action_resolution?.status, 'pending_check');
assert.equal(modernRepair?.state_updates?.checks?.[0]?.success_text,
    'You open the lock with the bent wire.');
assert.equal(context.repairWorldSingletonCheckReceipt(world, session('not_drop_event'), {
    ...malformedProbe4Repair, events: [{ type: 'inventory', status: 'completed',
        actor_id: 'player', item: 'improvised wire', action: 'draw wire from strap' }]
}), null, 'the repair normalizer must not drop a completed inventory event');
assert.equal(context.repairWorldSingletonCheckReceipt(world, session('not_nested_mutation'), {
    ...malformedProbe4Repair, state_updates: { checks: {
        ...malformedProbe4Repair.state_updates.checks,
        on_success: { ...malformedProbe4Repair.state_updates.checks.on_success,
            state_updates: { inventory_add: ['improvised wire'] } }
    } }
}), null, 'the repair normalizer must not flatten nested item grants');
assert.equal(context.repairWorldSingletonCheckReceipt(world, session('not_unrollable'), {
    ...malformedProbe4Repair, state_updates: { checks: {
        ...malformedProbe4Repair.state_updates.checks, rollable_stat_id: 'silver'
    } }
}), null, 'resource stats cannot become checks through an alias');

const manual = context.worldManualCheckExitUnlock(world, failed, 'Pick the watchtower gate lock');
assert.deepEqual(JSON.parse(JSON.stringify(manual)), live.checks[0].on_success);
assert.equal(context.worldManualCheckExitUnlock(world, failed, 'Notice the gate'), null);
assert.equal(context.worldManualCheckExitUnlock(world, failed, 'Pick the chest lock by the gate'), null,
    'a nearby item lock must not open the mapped gate');
assert.equal(context.worldManualCheckExitUnlock(world, failed, 'Pick the lock'), null,
    'an unqualified lock is not an unambiguous authored route');
const keyOnly = structuredClone(world);
keyOnly.locations.find(location => location.id === 'gate').exits
    .find(exit => exit.targetLocationId === 'cellar').allowCheckUnlock = false;
assert.equal(context.worldManualCheckExitUnlock(keyOnly, failed, 'Pick the gate lock'), null);
assert.equal(context.worldLockedExitClaimConflict(keyOnly, failed,
    'The gate swings wide.')?.reason, 'uncommitted_exit_unlock_claim',
    'a key-only gate cannot be declared open without its key either');
const ambiguous = structuredClone(world);
ambiguous.locations.find(location => location.id === 'gate').exits.push({
    text: 'through the side door to Village Square', targetLocationId: 'square',
    allowCheckUnlock: true
});
assert.equal(context.worldManualCheckExitUnlock(ambiguous, failed, 'Pick the gate lock'), null);

const falseScene = 'The bolt slides back with a clang. The gate swings wide. The way is open.';
assert.equal(context.worldLockedExitClaimConflict(world, failed, falseScene)?.reason,
    'uncommitted_exit_unlock_claim');
assert.equal(context.worldLockedExitClaimConflict(world, failed,
    'The gate does not open; its lock resists the pick.'), null);
assert.equal(context.worldLockedExitClaimConflict(world, s, falseScene), null,
    'a canonical unlock permits the same prose');
assert(context.worldFinalNarrativeConflicts(world, session('before'), failed, falseScene)
    .some(item => item.reason === 'uncommitted_exit_unlock_claim'));
assert.match(app, /buildSafeCheckOnlyWorldReceipt\(world, sess, receipt, receiptContext\)/,
    'turn execution must actually try the narrow salvage');
assert.match(app, /worldLockedExitClaimConflict\(world, sess, proposedLedger\)/,
    'a false ledger claim must roll back rather than persist');
const omittedLiveCheck = `This requires a check of your ingenuity and steady hand.\n\n**Check Required:**\n**Stat:** Wits\n**Difficulty:** 11\n**Failure Cost:** The wire snaps.\n\n**Please provide a d20 roll or allow the engine to resolve.**`;
assert.equal(context.worldNarrativeRequestsCheck(omittedLiveCheck), true);
assert.equal(context.worldNarrativeRequestsCheck('The gate remains locked.'), false);
assert.match(context.stripWorldCheckScaffolding(omittedLiveCheck), /🎲 Check button/);
assert.doesNotMatch(context.stripWorldCheckScaffolding(omittedLiveCheck), /provide a d20|Failure Cost/i);
assert.match(context.worldMissingCheckNotice(), /no roll or outcome was applied/i);
assert.match(context.worldChecksDisabledNotice(), /checks disabled.*No roll/i);
assert.match(context.worldResolvedCheckNotice({ label: 'Picking the gate lock',
    success: false, total: 8, difficulty: 11 }), /failed \(8 vs 11\)/);
const statFirstLiveCheck = `The sun hangs low, casting long, amber shadows across the scrubland. The iron gate of the watchtower stands cold and imposing, its heavy bars blocking the path forward.

As you lean in, you can see a strange, crystalline growth—thin, translucent filaments of salt-glass—weaving through the mortar and curling around the lock's housing. The wire from your strap is slender, but the mechanism inside the lock is old and likely stiff from the damp marsh air.

This is a delicate operation.

***

**Wits Check: Probing the Lock**
Difficulty: 11
Modifier: +4 (Wits)
Failure Cost: The wire snaps or the lock jams, potentially alerting anyone inside or leaving the gate permanently stuck.`;
assert.equal(context.worldNarrativeRequestsCheck(statFirstLiveCheck), true,
    'the exact stat-first check block from the paid gate probe must register');
assert(context.worldCheckScaffoldStart(statFirstLiveCheck) >= 0);
assert.match(context.stripWorldCheckScaffolding(statFirstLiveCheck), /This is a delicate operation\./);
assert.doesNotMatch(context.stripWorldCheckScaffolding(statFirstLiveCheck),
    /Wits Check|Difficulty: 11|Modifier: \+4|Failure Cost|\*\*\*/i);
assert.equal(context.worldNarrativeRequestsCheck('The clerk performs a safety check of the ledger.'), false,
    'normal descriptive uses of check must remain playable');
const imperativeLiveCheck = `The iron gate is cold and heavy, weeping rust in long, orange streaks down the stonework. Around the edges of the doorframe, crystalline salt-glass filaments shimmer in the fading light, clinging to the masonry like frozen webs.

You lean in, feeling the tension of the wire against the tumblers. The mechanism is old, stiff with age and grit, resisting the probe with a stubborn, metallic grinding.

This attempt is uncertain. Please provide a Wits check to see if you can manipulate the lock.

<world_turn_receipt>{"scene":{"player_location_id":"gate","player_location_changed":false,"present_character_ids":[]},"events":[{"action":"probing lock","activity":"attempting to pick lock","actor_id":"player","status":"in_progress","evidence":"player uses a wire from a satchel strap to probe the gate lock"}],"entity_updates":[],"state_updates":{}}</world_turn_receipt>`;
assert.equal(context.worldNarrativeRequestsCheck(imperativeLiveCheck), true,
    'the exact imperative phrase from the paid gate probe must register');
assert(context.worldImperativeCheckRequestStart(imperativeLiveCheck) >= 0);
assert.match(context.stripWorldCheckScaffolding(imperativeLiveCheck), /This attempt is uncertain\./);
assert.doesNotMatch(context.stripWorldCheckScaffolding(imperativeLiveCheck),
    /Please provide a Wits check|world_turn_receipt|probing lock/i);
for (const phrase of ['Please roll a Wits check.', 'Make a Wits check.',
    'You must make a Wits check.', 'The lock requires a Wits check.']) {
    assert.equal(context.worldNarrativeRequestsCheck(phrase), true, phrase);
}
for (const phrase of ['The gatekeeper asked for a Wits check yesterday.',
    'You made a Wits check and succeeded.', 'We provided a Wits check earlier.']) {
    assert.equal(context.worldNarrativeRequestsCheck(phrase), false, phrase);
}
assert.match(app, /reason: 'unregistered_requested_check'/,
    'a narrated but unregistered check must reject the canonical receipt');
console.log('✓ live gate check survives safe salvage; success, failure, persistence and false-canon guards hold');
