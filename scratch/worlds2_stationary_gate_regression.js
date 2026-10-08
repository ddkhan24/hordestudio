/** A lock attempt with "stay outside" must never undo committed gate travel. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const ctx = buildContext(vm, ['extractUserMovementTarget', 'resolveWorldMovementTarget',
    'applyUserDirectedMovement'], {
    state: { worldInstances: {} }, showToast() {}, rollForScenePopulation() {},
    console: { log() {}, warn() {}, error() {} }
});
const input = 'I have no key or lockpicks. I carefully pull a thin wire from the torn courier strap in my pack and probe the watchtower gate lock. If this is uncertain, call for a Wits check and leave the gate shut until the roll. I stay outside.';
const sess = {
    id: 'stationary_gate', playerLocation: 'gate', turnCount: 2,
    inventory: [{ name: 'torn satchel strap', quantity: 1 }],
    playerStats: { hp: 12, might: 3, wits: 4, silver: 6 },
    playerState: { status: 'active', conditions: [] }, entityStates: {},
    unlockedExits: {}
};
const extracted = ctx.extractUserMovementTarget(input);
const movement = ctx.applyUserDirectedMovement(world, sess, input);
assert.equal(extracted, '',
    `Leaving the gate shut and staying outside are not player locomotion; extracted=${extracted}, location=${sess.playerLocation}.`);
assert.equal(movement, '');
assert.equal(sess.playerLocation, 'gate');
for (const wording of [
    'I probe the lock and leave the gate locked until the check.',
    'I listen to Sel and leave the valve sealed for now.',
    'I inspect the mechanism and leave the door ajar while I wait.'
]) {
    assert.equal(ctx.extractUserMovementTarget(wording), '', wording);
}
const actualMove = ctx.extractUserMovementTarget(
    'I leave the gate open, then walk back to Marsh Causeway.');
assert.equal(ctx.resolveWorldMovementTarget(world, 'gate', actualMove, true, sess)?.id,
    'causeway', 'A later explicit player move must still be recognized.');
console.log('PASS: stationary gate-lock attempt preserves previously committed location');
