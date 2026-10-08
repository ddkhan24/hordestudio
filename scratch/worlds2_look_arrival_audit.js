/** Exit-button travel prose may mention the origin without claiming to return. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const ctx = buildContext(vm, ['shouldAuditNarratedWorldLocation', 'detectNarratedLocation',
    'validateWorldTurnReceipt'], {
    state: { worldInstances: {} },
    console: { log() {}, warn() {}, error() {} }
});
const sess = { id: 'look_arrival', playerLocation: 'square', inventory: [],
    entityStates: {}, unlockedExits: {} };
const prose = 'You step out of The Reed Inn and cross the square. The walk from the inn is brief; Captain Iven waits by the well.';
assert.equal(ctx.detectNarratedLocation(world, sess, prose)?.id, 'inn',
    'Fixture should reproduce the origin-reference false positive.');

const postTravel = { receiptCheckpoint: { tail: { audit: { source: 'engine_travel' } } } };
assert.equal(ctx.shouldAuditNarratedWorldLocation('look', postTravel, false), false,
    'The immediate look after precommitted exit travel must not audit origin mentions as relocation.');
assert.equal(ctx.shouldAuditNarratedWorldLocation('look', { receiptCheckpoint: {
    tail: { audit: { source: 'tool_call' } }
} }, false), true, 'An ordinary look must retain the narrative audit.');
assert.equal(ctx.shouldAuditNarratedWorldLocation('', postTravel, false), true,
    'Normal player turns must retain the narrative audit.');
assert.equal(ctx.shouldAuditNarratedWorldLocation('', postTravel, true), false,
    'A location changed during the turn is already canonically checked.');

const arrived = { id: 'look_echo', playerLocation: 'causeway', turnCount: 2,
    inventory: [], entityStates: {}, unlockedExits: {}, playerStats: {},
    playerState: { status: 'active', conditions: [] }, quests: [], consequences: [] };
const arrivalReceipt = {
    scene: { player_location_id: 'causeway', player_location_changed: true,
        present_character_ids: [] },
    events: [{ type: 'movement', status: 'completed', actor_id: 'player',
        from_location_id: 'square', to_location_id: 'causeway' }],
    entity_updates: [], state_updates: {}
};
const echo = ctx.validateWorldTurnReceipt(world, arrived, arrivalReceipt, {
    playerStartLocationId: 'causeway', precommittedArrival: { from: 'square', to: 'causeway' }
});
assert.equal(echo.rejectedEvents.length, 0, JSON.stringify(echo.rejectedEvents));
assert.equal(echo.receipt.events.length, 0, 'Exact precommitted route echo is not replayed.');
assert.equal(echo.receipt.scene.player_location_changed, false,
    'Arrival look asserts the already committed current place.');
const unrelated = ctx.validateWorldTurnReceipt(world, arrived, { ...arrivalReceipt,
    events: [{ ...arrivalReceipt.events[0], from_location_id: 'inn' }] }, {
    playerStartLocationId: 'causeway', precommittedArrival: { from: 'square', to: 'causeway' }
});
assert(unrelated.rejectedEvents.length > 0, 'Different movement must not be forgiven.');
const withoutOrigin=structuredClone(arrivalReceipt);
delete withoutOrigin.events[0].from_location_id;
const acknowledged=ctx.validateWorldTurnReceipt(world,arrived,withoutOrigin,{
    playerStartLocationId:'causeway',precommittedArrival:{from:'square',to:'causeway'}});
assert.equal(acknowledged.rejectedEvents.length,0);
assert.equal(acknowledged.receipt.events.length,0,'target-only acknowledgment cannot replay already completed travel');

console.log('PASS: precommitted exit arrival ignores origin prose and exact movement echo, not unrelated travel');
