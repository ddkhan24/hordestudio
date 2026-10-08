/** Repeated provider/seed labels must not collide in the active World audit. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const { normalizeWorldTurnReceipt } = buildContext(vm, ['normalizeWorldTurnReceipt']);
const session = {
    turnCount: 1, worldStateVersion: 1,
    worldTurnReceipts: [{ receipt: { turn_id: 'turn_1' } }]
};
const normalize = source => normalizeWorldTurnReceipt({}, session, {
    scene: { player_location_id: 'inn', present_character_ids: [] },
    events: [], entity_updates: [], state_updates: {}, ...source
});

const firstPlayerTurn = normalize({});
assert.equal(firstPlayerTurn.turn_id, 'turn_1_2',
    'a seeded turn and first player turn must not share an audit ID');
session.worldTurnReceipts.push({ receipt: firstPlayerTurn });
session.worldStateVersion++;

const providerRepeat = normalize({ turn_id: 'turn_1' });
assert.equal(providerRepeat.turn_id, 'turn_1_3',
    'a repeated provider label must be disambiguated');
assert.equal(normalize({ turn_id: 'turn_1' }).turn_id, providerRepeat.turn_id,
    'retrying validation before commit must keep the same ID');
session.worldTurnReceipts.push({ receipt: providerRepeat });

const freshProviderId = normalize({ turn_id: 'model-turn-44' });
assert.equal(freshProviderId.turn_id, 'model-turn-44',
    'an unused provider label should be preserved');
const longRepeat = 'x'.repeat(100);
session.worldTurnReceipts.push({ receipt: { turn_id: longRepeat } });
assert(normalize({ turn_id: longRepeat }).turn_id.length <= 100,
    'the disambiguated ID must respect the receipt schema limit');

console.log('PASS: World receipt IDs are unique across seed, player turn and repeated provider labels');
