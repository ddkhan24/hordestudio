/**
 * Offline release contract probes for the October 2026 live RPG findings.
 * No provider calls and no persisted user data.
 * Run: node scratch/worlds_rpg_release_contract_audit.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const context = buildContext(vm, [
    'validateWorldTurnReceipt', 'scrubNarrativeArtifacts',
    'shouldRepairMissingWorldReceipt', 'extractUserMovementTarget',
    'resolveWorldMovementTarget', 'findWorldTravelPath',
    'evaluateQuestProgress', 'applyQuestUpdates', 'seedWorldStartingQuests', 'trimDanglingWorldDialogue',
    'processStructuredActions', 'buildWorldLintReport'
], {
    showToast() {},
    state: { worldInstances: {} },
    console: { log() {}, warn() {}, error() {} }
});

function session(location = 'inn') {
    return {
        id: 'offline_rpg_contract', playerLocation: location, turnCount: 1,
        entityStates: {
            mara: { location: 'inn', status: 'alive' },
            iven: { location: 'square', status: 'alive' },
            sel: { location: 'cellar', status: 'alive' },
            tomas: { location: 'cellar', status: 'alive' }
        },
        playerStats: { hp: 12, might: 3, wits: 4, silver: 6 },
        inventory: ['short sword', 'rope', 'healing draught'],
        quests: [], history: [], ledger: '',
        pendingChecks: [], playerState: { status: 'active', conditions: [] }
    };
}

function receipt(stateUpdates = {}, events = [], location = 'inn', cast = ['mara']) {
    return {
        summary: 'Offline contract probe.',
        scene: { player_location_id: location, player_location_changed: false,
            present_character_ids: cast },
        events, entity_updates: [], state_updates: stateUpdates
    };
}

const probes = [];
function probe(name, fn) {
    try { fn(); probes.push({ name, pass: true }); }
    catch (error) { probes.push({ name, pass: false, error: error.message }); }
}

probe('reject unknown state-update keys before accepting a turn', () => {
    const s = session();
    const result = context.validateWorldTurnReceipt(world, s,
        receipt({ player_health: -3, inventory_updates: [{ remove: 'healing draught' }] }),
        { playerStartLocationId: 'inn' });
    assert(result.rejectedEvents.some(event => /state[_ ]?update|unknown|unsupported/i.test(event.reason)),
        `unknown keys were accepted: ${JSON.stringify(result.rejectedEvents)}`);
});

probe('reject an unknown event type rather than converting it to other', () => {
    const s = session();
    const result = context.validateWorldTurnReceipt(world, s,
        receipt({}, [{ type: 'transaction', status: 'completed', actor_id: 'player',
            evidence: 'A healing draught was consumed.' }]),
        { playerStartLocationId: 'inn' });
    assert(result.rejectedEvents.some(event => /event[_ ]?type|unknown|unsupported/i.test(event.reason)),
        `unknown type was accepted: ${JSON.stringify(result.acceptedEvents)}`);
});

probe('reject missing or mistyped event status rather than completing it', () => {
    for (const status of [undefined, 'attempting']) {
        const event = { type: 'condition', actor_id: 'player',
            condition: 'Chemical burn', evidence: 'The steam might burn the ranger.' };
        if (status !== undefined) event.status = status;
        const result = context.validateWorldTurnReceipt(world, session(), receipt({}, [event]),
            { playerStartLocationId: 'inn' });
        assert(result.rejectedEvents.length > 0,
            `${String(status)} became canonical: ${JSON.stringify(result.acceptedEvents)}`);
    }
});

probe('reject an unsupported entity patch that claims health changed', () => {
    const candidate = receipt();
    candidate.entity_updates = [{ entity_id: 'player', location_id: 'inn',
        activity: 'holding a burned arm', interacting_with: [], health_delta: -3 }];
    const result = context.validateWorldTurnReceipt(world, session(), candidate,
        { playerStartLocationId: 'inn' });
    assert(result.rejectedEvents.length > 0,
        'health_delta was ignored while the entity patch passed');
});

probe('reject a completed chemical burn with no health or condition change', () => {
    const result = context.validateWorldTurnReceipt(world, session(), receipt(), {
        playerStartLocationId: 'inn',
        narrativeText: 'The spray catches you across the forearm, searing through your sleeve and leaving a stinging, chemical burn.'
    });
    assert(result.rejectedEvents.length > 0,
        'the live burn narrative passed with an empty receipt and 12/12 health');
});

probe('reject consuming a named inventory item with no inventory removal', () => {
    const result = context.validateWorldTurnReceipt(world, session(), receipt(), {
        playerStartLocationId: 'inn',
        narrativeText: 'You reach into your pack and pull out the healing draught. You swallow the remainder of the draught in one gulp.'
    });
    assert(result.rejectedEvents.length > 0,
        'the live draught consumption passed without removing the draught');
});

probe('hypothetical harm and a spoken item question need no mutation', () => {
    for (const narrativeText of [
        'Sel says, "If that steam catches your forearm, it could burn you."',
        'Sel asks, "Will you drink the healing draught?"'
    ]) {
        const result = context.validateWorldTurnReceipt(world, session(), receipt(), {
            playerStartLocationId: 'inn', narrativeText
        });
        assert.equal(result.rejectedEvents.length, 0,
            `hypothetical or question should not mutate canon: ${JSON.stringify(result.rejectedEvents)}`);
    }
});

probe('hurting another actor or an object does not imply player injury', () => {
    for (const narrativeText of ['You hit the guard.', 'You burn the rope.']) {
        const result = context.validateWorldTurnReceipt(world, session(), receipt(), {
            playerStartLocationId: 'inn', narrativeText
        });
        assert(!result.rejectedEvents.some(event => event.reason === 'uncommitted_player_injury'),
            `off-target harm rejected: ${JSON.stringify(result.rejectedEvents)}`);
    }
});

probe('drinking water does not consume a separately mentioned healing draught', () => {
    const result = context.validateWorldTurnReceipt(world, session(), receipt(), {
        playerStartLocationId: 'inn',
        narrativeText: 'You drink water. The healing draught remains in your pack.'
    });
    assert(!result.rejectedEvents.some(event => event.reason === 'uncommitted_consumable_use'),
        `unrelated item was consumed: ${JSON.stringify(result.rejectedEvents)}`);
});

probe('taking a captain’s advice is not an inventory pickup', () => {
    const result = context.validateWorldTurnReceipt(world, session(), receipt(), {
        playerStartLocationId: 'inn', playerInput: 'I take the captain’s advice.',
        narrativeText: 'You take the captain’s advice and stay aboard.'
    });
    assert(!result.rejectedEvents.some(event => event.reason === 'uncommitted_item_pickup'),
        `abstract advice was counted as an item: ${JSON.stringify(result.rejectedEvents)}`);
});

probe('completed strap pickup requires a matching typed inventory-add event', () => {
    const result = context.validateWorldTurnReceipt(world, session(), receipt(), {
        playerStartLocationId: 'inn', playerInput: 'I take the strap from Sel.',
        narrativeText: 'You tuck the leather strap into your pack and turn back to Sel.'
    });
    assert(result.rejectedEvents.some(event => event.reason === 'uncommitted_item_pickup'),
        `confirmed pickup passed without inventory-add: ${JSON.stringify(result.rejectedEvents)}`);
});

probe('refusal and hypothetical strap wording do not demand an inventory event', () => {
    for (const narrativeText of [
        'You refuse to tuck the leather strap into your pack.',
        'You could tuck the leather strap into your pack, but leave it on the table.'
    ]) {
        const result = context.validateWorldTurnReceipt(world, session(), receipt(), {
            playerStartLocationId: 'inn', playerInput: 'I take the strap from Sel.', narrativeText
        });
        assert(!result.rejectedEvents.some(event => event.reason === 'uncommitted_item_pickup'),
            `non-pickup was rejected: ${JSON.stringify(result.rejectedEvents)}`);
    }
});

probe('trim only the dangling speaker line after complete prose', () => {
    const scene = 'The stairwell settles into silence after the iron latch clicks shut. Sel watches the lamplight catch on the wet stone.';
    assert.equal(context.trimDanglingWorldDialogue(`${scene}\nSel Ardent: “Go`), scene);
    const complete = `${scene}\nSel Ardent: “Go now.”`;
    assert.equal(context.trimDanglingWorldDialogue(complete), complete);
});

probe('post-check consequence gets receipt repair', () => {
    assert.equal(context.shouldRepairMissingWorldReceipt(world, 'continue', '',
        'The caustic liquid burns your forearm and Sel frees Tomas.'), true);
});

probe('strip provider pseudo-tool calls before transcript display', () => {
    const visible = context.scrubNarrativeArtifacts(
        'Iven folds his arms.\n<|tool_call>call:checks{difficulty:11,stat_id:"wits"}</|tool_call>');
    assert.equal(visible, 'Iven folds his arms.', visible);
});

probe('resolve live RPG causeway movement wording to the mapped destination', () => {
    const input = 'I leave the square by the east road and follow the mapped causeway toward the tower. At the Marsh Causeway I stop.';
    const phrase = context.extractUserMovementTarget(input);
    const target = context.resolveWorldMovementTarget(world, 'square', phrase);
    assert.equal(target?.id, 'causeway', `phrase=${JSON.stringify(phrase)} target=${target?.id}`);
});

probe('authored gate stays locked until a successful check opens its route', () => {
    const gate = world.locations.find(location => location.id === 'gate');
    const edge = gate.exits.find(exit => exit.targetLocationId === 'cellar');
    const s = session('gate');
    assert.match(`${gate.description} ${edge.text}`, /lock/i);
    assert.equal(edge.requiredItem, 'brass tower key');
    assert.equal(edge.allowCheckUnlock, true);
    assert.equal(context.findWorldTravelPath(world, 'gate', 'cellar', { session: s }), null);
    const localWorld = JSON.parse(JSON.stringify(world));
    localWorld.gameRules.dice.criticals = false;
    const premature = session('gate');
    const blocked = context.processStructuredActions({ checks: [{
        label: 'Try to enter without opening the lock', difficulty: 2, modifier: 5,
        on_success: { location_id: 'cellar' }
    }] }, localWorld, premature, { deferFeedback: true });
    assert.equal(blocked.checkOutcomeResults[0].movementResult.reason, 'required_item');
    assert.equal(premature.playerLocation, 'gate');
    const result = context.processStructuredActions({ checks: [{
        label: 'Pick the tower lock', difficulty: 2, modifier: 5,
        on_success: { exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }] }
    }] }, localWorld, s, { deferFeedback: true });
    assert.equal(result.checkResults[0].success, true);
    assert.equal(result.checkOutcomeResults[0].exitUnlockResults[0].unlocked, true);
    assert.deepEqual(Array.from(context.findWorldTravelPath(localWorld, 'gate', 'cellar', { session: s })), ['gate', 'cellar']);
});

probe('World Audit flags prose-only locks without flagging a configured gate', () => {
    const legacy = JSON.parse(JSON.stringify(world));
    const gate = legacy.locations.find(location => location.id === 'gate');
    const edge = gate.exits.find(exit => exit.targetLocationId === 'cellar');
    delete edge.requiredItem;
    delete edge.allowCheckUnlock;
    assert(context.buildWorldLintReport(legacy).some(finding =>
        finding.area === 'Exits' && /remains traversable/i.test(finding.msg)));
    assert(!context.buildWorldLintReport(world).some(finding =>
        finding.area === 'Exits' && /remains traversable/i.test(finding.msg)));
});

probe('authored courier obligation seeds once as a tracked quest', () => {
    const s = session();
    assert(world.startingLives[0].obligations.some(item => /missing courier/i.test(item)));
    assert.equal(context.seedWorldStartingQuests(world, s), true);
    assert.equal(context.seedWorldStartingQuests(world, s), false);
    assert.equal(s.quests.length, 1);
    assert.equal(s.quests[0].id, 'find_missing_courier');
    assert.equal(s.quests[0].status, 'active');
    assert.equal(s.quests[0].objectives[0].type, 'manual');
    const result = context.evaluateQuestProgress(world, s);
    assert.equal(result.changed, false);
    assert.equal(s.quests[0].status, 'active');
});

probe('absolute and incremental quest progress in one receipt never double-count', () => {
    const s = session('cellar');
    context.seedWorldStartingQuests(world, s);
    const update = [{ id: 'find_missing_courier', status: 'active', objectives: [{
        id: 'confirm_tomas', type: 'manual', required: 1, current: 1,
        progress_change: 1, status: 'completed'
    }] }];
    context.applyQuestUpdates(world, s, update);
    assert.equal(s.quests[0].objectives[0].current, 1);
    assert.equal(s.quests[0].status, 'completed');
    context.applyQuestUpdates(world, s, update);
    assert.equal(s.quests[0].objectives[0].current, 1);
    s.quests[0].objectives[0].current = 2; // normalize an already-saved 2/1 objective too
    context.evaluateQuestProgress(world, s);
    assert.equal(s.quests[0].objectives[0].current, 1);
});

probe('an explicitly structured quest completes and grants its reward once', () => {
    const s = session('cellar');
    s.quests = [{ id: 'reach_cellar', title: 'Enter the tower', status: 'active',
        objectives: [{ id: 'arrive', text: 'Reach the cellar', type: 'location',
            target: 'cellar', required: 1 }], rewards: { items: ['tower token'] } }];
    const first = context.evaluateQuestProgress(world, s);
    const second = context.evaluateQuestProgress(world, s);
    assert(first.completed.includes('reach_cellar'));
    assert(first.rewardsGranted.includes('reach_cellar'));
    assert.equal(s.quests[0].status, 'completed');
    assert.equal(s.inventory.filter(item => item === 'tower token').length, 1);
    assert.equal(second.rewardsGranted.length, 0);
});

probe('duplicate pickups count as two units and one consumption leaves one', () => {
    const s = session();
    s.inventory = [];
    const localWorld = JSON.parse(JSON.stringify(world));
    const total = () => s.inventory.reduce((sum, item) => {
        const name = typeof item === 'string' ? item : item?.name;
        return name === 'healing draught' ? sum + Math.max(1, Number(item?.quantity) || 1) : sum;
    }, 0);
    context.processStructuredActions({ inventory_add: ['healing draught', 'healing draught'] },
        localWorld, s, { deferFeedback: true });
    assert.equal(total(), 2);
    const result = context.processStructuredActions({ inventory_remove: ['healing draught'] },
        localWorld, s, { deferFeedback: true });
    assert.equal(result.inventoryFailures.length, 0);
    assert.equal(total(), 1);
});

probe('consuming an absent inventory item is a rejected candidate action', () => {
    const s = session();
    s.inventory = [];
    const localWorld = JSON.parse(JSON.stringify(world));
    const result = context.processStructuredActions({ inventory_remove: ['healing draught'] },
        localWorld, s, { deferFeedback: true });
    assert(result.inventoryFailures.some(failure => failure.reason === 'item_not_owned'));
});

probe('ambiguous draught removal refuses to consume an arbitrary item', () => {
    const s = session();
    s.inventory = ['healing draught', 'poison draught'];
    const localWorld = JSON.parse(JSON.stringify(world));
    const result = context.processStructuredActions({ inventory_remove: ['draught'] },
        localWorld, s, { deferFeedback: true });
    assert(result.inventoryFailures.some(failure => failure.reason === 'ambiguous_item'));
    assert.equal(s.inventory.length, 2);
});

for (const item of probes) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `: ${item.error}` : ''}`);
}
const failed = probes.filter(item => !item.pass);
console.log(`${probes.length - failed.length}/${probes.length} release contract probes passed`);
if (failed.length) process.exitCode = 1;
