/** Only explicit impassability, never a generic hazard, closes a World route. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app, buildContext } = require('./app_source.js');

const ctx = buildContext(vm, ['worldLocationTravelBlock']);
const session = label => ({ turnCount: 5, locationStates: {
    causeway: { conditions: [{ id: 'test', label }] }
} });
for (const label of [
    'impassable', 'the bridge is washed out', 'sealed gate',
    'blocked route', 'road closed by fallen stone', 'causeway cut off',
    'road severed', 'road gone', 'road just stops in the water'
]) assert.equal(!!ctx.worldLocationTravelBlock(session(label), 'causeway'), true, label);
for (const label of [
    'flooded', 'marsh flooding', 'the road is wet',
    'sealed warning letter', 'the guard blocked a rumor'
]) assert.equal(!!ctx.worldLocationTravelBlock(session(label), 'causeway'), false, label);

const explicit = session('damaged masonry');
explicit.locationStates.causeway.conditions[0].blocksTravel = true;
assert.equal(!!ctx.worldLocationTravelBlock(explicit, 'causeway'), true);
explicit.locationStates.causeway.conditions[0].expiresTurn = 5;
assert.equal(!!ctx.worldLocationTravelBlock(explicit, 'causeway'), false,
    'an expired closure must not keep an exit disabled');

const sceneCtx = buildContext(vm, ['worldFinalNarrativeConflicts'], {
    normalizeWorldGameRules: () => ({ modules: { inventory: false, health: false, conditions: false } }),
    worldForSession: world => world,
    worldLockedExitClaimConflict: () => null,
    sessionNpcs: () => [],
    findFuzzyLocation: () => null,
    scrubNarrativeArtifacts: text => text
});
const world = { locations: [{ id: 'square', name: 'Village Square', exits: [] },
    { id: 'causeway', name: 'Marsh Causeway', exits: [] }] };
const after = { playerLocation: 'square', turnCount: 5, turnEvents: [],
    locationStates: { causeway: { conditions: [{ label: 'flooded' }] } } };
const conflicts = text => JSON.parse(JSON.stringify(sceneCtx.worldFinalNarrativeConflicts(
    world, after, after, text)));
assert(conflicts('The Marsh Causeway road is severed.').some(item =>
    item.reason === 'uncommitted_route_closure' && item.detail === 'causeway'),
    'a final narrator claim cannot stay visible when the mapped exit remains usable');
assert.deepEqual(conflicts('Scout: “The Marsh Causeway road is severed.”'), [],
    'NPC testimony is not a physical blockade');
assert.deepEqual(conflicts('A scout reports the Marsh Causeway road is severed.'), [],
    'indirect testimony is not a physical blockade');
after.locationStates.causeway.conditions.push({ label: 'impassable' });
assert.deepEqual(conflicts('The Marsh Causeway road is severed.'), [],
    'the final narrator claim is valid once the same exit is actually blocked');
assert.match(app, /routeAssertions\.forEach\(assertion => worldNarratedUncommittedRouteClosures\(world, sess, assertion\)/,
    'receipt acceptance must audit narrator prose, summary, ledger, and completed environment evidence on all turns');
console.log('PASS: route closure receipt/final-scene claims agree with enabled exits; testimony remains unverified');
