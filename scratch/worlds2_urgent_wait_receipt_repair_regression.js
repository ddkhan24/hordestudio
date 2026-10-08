/** A hosted urgent wait may need receipt-only repair without losing witnessed NPC travel. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext, functionSource } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
    'worlds2-rpg-live.horde_world'), 'utf8'));
const ctx = buildContext(vm, [
    'restoreExplicitWorldWaitOnReceiptRepair', 'validateWorldTurnReceipt'
], {
    console: { log() {}, warn() {}, error() {} },
    showToast() {},
    worldForSession: value => value,
    sessionNpcs: value => (value.entities || []).filter(entity => entity.type === 'npc'),
    isNpcActive: value => value && !['dead', 'gone'].includes(value.status),
    normalizeWorldGameRules: () => ({ modules: {
        inventory: true, conditions: true, relationships: true
    } }),
    buildWorldSceneFrame: (_, sess) => ({ player_location_id: sess.playerLocation,
        present_character_ids: Object.entries(sess.entityStates || {})
            .filter(([, state]) => state.location === sess.playerLocation)
            .map(([id]) => id), activities: {} }),
    getWorldTimeData: () => ({ currentTotalMinutes: 1073, timeStep: 5 }),
    globalThis: { HordeRpgMechanics: { itemName: item => item?.name || String(item || '') } }
});
const sess = {
    id: 'urgent_wait', playerLocation: 'square', turnCount: 2,
    inventory: [], entityStates: { iven: { location: 'square', status: 'alive' } }
};
const input = 'I wait thirteen hours in the square, taking no other action. At the end, what do I directly see Iven and his guards actually do?';
const narrated = 'For thirteen hours, you remain stationary. As the clock strikes six bells, Captain Iven orders the guards to form up. They march out of the square and head east toward the watchtower.';
const repairReceipt = {
    scene: { player_location_id: 'square', player_location_changed: false,
        present_character_ids: [] },
    events: [{ type: 'movement', status: 'completed', actor_id: 'iven',
        from_location_id: 'square', to_location_id: 'gate',
        movement_mode: 'voluntary', evidence: 'Iven marched out of the square toward the tower.' }],
    entity_updates: [{ entity_id: 'iven', location_id: 'gate',
        activity: 'leading sweep of the tower', interacting_with: [] }],
    state_updates: {},
    summary: 'Iven departed the square after the player waited thirteen hours.'
};
const context = { playerStartLocationId: 'square', playerInput: input, narrativeText: narrated };
const original = ctx.validateWorldTurnReceipt(world, sess, repairReceipt, context);
assert(original.rejectedEvents.some(event => event.reason === 'insufficient_travel_time'),
    'Without a wait, square→gate exceeds a five-minute turn.');

const restored = ctx.restoreExplicitWorldWaitOnReceiptRepair(repairReceipt, input, narrated);
assert.notEqual(restored, repairReceipt);
assert.equal(repairReceipt.events.length, 1, 'provider receipt must not be mutated in place');
assert.equal(restored.events[0].type, 'time');
assert.equal(restored.events[0].minutes_elapsed, 780);
const validated = ctx.validateWorldTurnReceipt(world, sess, restored, context);
assert.equal(validated.rejectedEvents.length, 0, JSON.stringify(validated.rejectedEvents));
assert.equal(validated.legacyArgs.time_skip_minutes, 780);
assert.deepEqual(Array.from(ctx.findWorldTravelPath(world, 'square', 'gate')), [
    'square', 'causeway', 'gate'
], 'NPC movement still uses the authored two-leg route.');
assert.equal(validated.legacyArgs.npc_moves[0].npc_id, 'iven');
assert.equal(validated.legacyArgs.npc_moves[0].target_location_id, 'gate');
assert.equal(validated.entityPatches[0].activity, 'leading sweep of the tower');

const mainReceipt = { ...repairReceipt,
    events: [...restored.events, { type: 'movement', status: 'completed',
        actor_id: 'guards', from_location_id: 'square', to_location_id: 'gate' }],
    summarybcc: 'unsupported guessed field' };
const invalidMain = ctx.validateWorldTurnReceipt(world, sess, mainReceipt, context);
assert(invalidMain.rejectedEvents.some(event => event.reason === 'unknown_actor'));
assert(invalidMain.rejectedEvents.some(event => event.reason === 'unsupported_receipt_field'));

for (const [candidateInput, candidateNarrative] of [
    ['Can I wait thirteen hours?', narrated],
    [input, 'Iven interrupts the ranger before they can wait.'],
    [input, 'For ten hours, you remain stationary. Iven then leaves the square.'],
    ['I wait ten minutes. I wait thirteen hours.', narrated]
]) assert.equal(ctx.restoreExplicitWorldWaitOnReceiptRepair(repairReceipt,
    candidateInput, candidateNarrative), repairReceipt,
    'Ambiguous or uncompleted waits must not be filled in.');
const conflicting = { ...repairReceipt, events: [{ type: 'time', actor_id: 'player',
    status: 'completed', minutes_elapsed: 10 }, ...repairReceipt.events] };
assert.equal(ctx.restoreExplicitWorldWaitOnReceiptRepair(conflicting, input, narrated), conflicting,
    'A contradictory reported duration must not be silently replaced.');

const liveTurn = functionSource('executeWorldTurn');
assert.match(liveTurn, /restoreExplicitWorldWaitOnReceiptRepair\(repairedReceipt,[\s\S]*?repairNarrative, currentTotalMinutes\)/,
    'The first receipt repair path must use the canonical wait restoration.');
assert.match(liveTurn, /restoreExplicitWorldWaitOnReceiptRepair\(repaired,[\s\S]*?receiptContext\.narrativeText, currentTotalMinutes\)/,
    'The narrative-rescue receipt repair path must use the same restoration.');
console.log('✓ explicit wait survives receipt repair and permits only graph-valid witnessed NPC travel');
