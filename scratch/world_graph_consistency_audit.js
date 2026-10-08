/**
 * Canonical location graph and timeline geography regression audit.
 * Run with: node scratch/world_graph_consistency_audit.js
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app, buildContext } = require('./app_source.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function json(value) { return JSON.parse(JSON.stringify(value)); }

test('canonical ids win over colliding display names and ambiguous names fail closed', () => {
    const context = buildContext(vm, ['getLocationRef', 'resolveWorldExitTarget', 'findWorldTravelPath'], {});
    const collision = { locations: [
        { id: 'room_a', name: 'hall' },
        { id: 'hall', name: 'Gallery' }
    ] };
    assert.equal(context.getLocationRef(collision, 'hall').id, 'hall');
    assert.equal(context.getLocationRef({ locations: [
        { id: 'a', name: 'Hall' },
        { id: 'b', name: 'hall' }
    ] }, 'hall'), null);
    const duplicateIds = { locations: [
        { id: 'same', name: 'One', exits: [] },
        { id: 'same', name: 'Two', exits: [] }
    ] };
    assert.equal(context.resolveWorldExitTarget(duplicateIds, { targetLocationId: 'same' }), null);
    assert.equal(context.resolveWorldExitTarget(collision, 'to Galler'), null,
        'a misspelled saved exit must remain unresolved instead of guessing');
    assert.equal(context.findWorldTravelPath(collision, 'room', 'hall'), null,
        'the graph walker must not fuzzy-resolve persisted endpoint ids');
});

test('session world view owns dynamic exits and timeline-created locations', () => {
    const context = buildContext(vm, ['worldForSession', 'resolveWorldExitTarget'], {
        isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value)
    });
    const world = { entities: [
        { id: 'template_person', type: 'npc' },
        { id: 'person_a', type: 'npc', sessionOrigin: 'a' },
        { id: 'person_b', type: 'npc', sessionOrigin: 'b' }
    ], locations: [
        { id: 'square', name: 'Square', exits: [] },
        { id: 'secret_a', name: 'Secret Room', sessionOrigin: 'a', exits: [] },
        { id: 'secret_b', name: 'Secret Room', sessionOrigin: 'b', exits: [] }
    ] };
    const session = { id: 'a', dynamicExits: { square: [{ targetLocationId: 'secret_a' }] } };
    const view = context.worldForSession(world, session);
    assert.deepEqual(Array.from(view.locations, location => location.id), ['square', 'secret_a']);
    assert.deepEqual(Array.from(view.entities, entity => entity.id), ['template_person', 'person_a']);
    assert.equal(world.entities.length, 3, 'the projected view must not remove another timeline’s records');
    assert.deepEqual(Array.from(context.worldForSession(world, null).entities, entity => entity.id), ['template_person'],
        'missing session context must not expose all timelines');
    assert.equal(context.resolveWorldExitTarget(view, view.locations[0].exits[0]).id, 'secret_a');
});

test('renaming a location migrates authored and every live timeline reference', () => {
    const state = { worldInstances: { w: { sessions: [] } } };
    const context = buildContext(vm, ['renameWorldLocationId'], {
        state,
        isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value)
    });
    const session = {
        playerLocation: 'old',
        entityStates: { npc: { location: 'old' } },
        locationStates: { old: { danger: 2 } },
        economy: { markets: { old: { stock: 1 } } },
        dynamicExits: { old: [{ targetLocationId: 'old' }] },
        scheduledEvents: [{ locationId: 'old' }],
        npcScheduleOverrides: { npc: [{ locationId: 'old' }] },
        consequences: [{ locationId: 'old' }],
        worldNews: [{ locationId: 'old' }],
        turnEvents: [{ location_id: 'old', from_location_id: 'old', to_location_id: 'old' }],
        playerIdentity: { homeLocationId: 'old' },
        lifeSeed: { homeLocationId: 'old', startLocationId: 'old' }
    };
    state.worldInstances.w.sessions.push(session);
    const world = {
        id: 'w', startLocationId: 'old', groups: [], factions: [], startingLives: [],
        entities: [{ startLocation: 'old', homeLocation: 'old', schedule: [{ locationId: 'old' }] }],
        locations: [
            { id: 'old', name: 'Old Room', exits: [] },
            { id: 'other', name: 'Other', parentLocationId: 'old', exits: [{ targetLocationId: 'old' }] }
        ]
    };
    context.renameWorldLocationId(world, world.locations[0], 'new');
    assert.equal(world.startLocationId, 'new');
    assert.equal(world.locations[1].parentLocationId, 'new');
    assert.equal(world.locations[1].exits[0].targetLocationId, 'new');
    assert.equal(session.playerLocation, 'new');
    assert.equal(session.entityStates.npc.location, 'new');
    assert.equal(session.locationStates.new.danger, 2);
    assert.equal(session.economy.markets.new.stock, 1);
    assert.equal(session.dynamicExits.new[0].targetLocationId, 'new');
    assert.equal(session.npcScheduleOverrides.npc[0].locationId, 'new');
    assert.equal(session.turnEvents[0].to_location_id, 'new');
});

test('deleting a location removes dangling name exits and invalid future session work', () => {
    const state = { worldInstances: { w: { sessions: [] } } };
    const context = buildContext(vm, ['removeWorldLocationRecord'], {
        state,
        isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value)
    });
    const session = {
        playerLocation: 'old', entityStates: { npc: { location: 'old' } },
        locationStates: { old: {} }, economy: { markets: { old: {} } },
        dynamicExits: { safe: ['to Old Room', { targetLocationId: 'old' }] },
        scheduledEvents: [{ locationId: 'old' }, { locationId: 'safe' }],
        npcScheduleOverrides: { npc: [{ locationId: 'old' }, { locationId: 'safe' }] },
        consequences: [{ locationId: 'old' }], worldNews: [{ locationId: 'old' }],
        turnEvents: [{ location_id: 'old' }], playerIdentity: { homeLocationId: 'old' },
        lifeSeed: { homeLocationId: 'old', startLocationId: 'old' }
    };
    state.worldInstances.w.sessions.push(session);
    const world = {
        id: 'w', startLocationId: 'old', entities: [], groups: [], factions: [], startingLives: [],
        locations: [
            { id: 'old', name: 'Old Room', exits: [] },
            { id: 'safe', name: 'Safe', exits: ['to Old Room', { targetLocationId: 'old' }] }
        ]
    };
    context.removeWorldLocationRecord(world, 'old');
    assert.equal(world.startLocationId, 'safe');
    assert.deepEqual(Array.from(world.locations[0].exits), []);
    assert.equal(session.playerLocation, 'safe');
    assert.deepEqual(Array.from(session.dynamicExits.safe), []);
    assert.deepEqual(Array.from(session.scheduledEvents, event => event.locationId), ['safe']);
    assert.deepEqual(Array.from(session.npcScheduleOverrides.npc, block => block.locationId), ['safe']);
    assert.equal(session.consequences[0].locationId, '');
    assert.equal(session.playerIdentity.homeLocationId, '');
    assert.equal(session.lifeSeed.startLocationId, 'safe');
});

test('turn snapshots restore only the active timeline dynamic geography', () => {
    const context = buildContext(vm, ['captureWorldTurnState', 'restoreWorldTurnState'], {
        safeJsonClone: json,
        isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value),
        bumpMemoryEpoch: session => { session._memEpoch = (session._memEpoch || 0) + 1; },
        bumpWorldEpoch: session => { session._worldEpoch = (session._worldEpoch || 0) + 1; }
    });
    const world = {
        locations: [
            { id: 'authored', name: 'Authored' },
            { id: 'kept', name: 'Kept', sessionOrigin: 'a' },
            { id: 'other', name: 'Other timeline', sessionOrigin: 'b' }
        ],
        entities: []
    };
    const session = { id: 'a', name: 'A', history: [], ledger: '', dynamicExits: {}, _memEpoch: 0, _worldEpoch: 0 };
    const snapshot = context.captureWorldTurnState(world, session);
    assert.equal(snapshot.schema, 5);
    world.locations.push({ id: 'ghost', name: 'Ghost', sessionOrigin: 'a' });
    context.restoreWorldTurnState(world, session, snapshot);
    assert.deepEqual(Array.from(world.locations, location => location.id), ['authored', 'other', 'kept']);
});

test('turn snapshots store the latest audit once and restore old snapshots', () => {
    const context = buildContext(vm, ['captureWorldTurnState', 'restoreWorldTurnState'], {
        safeJsonClone: json,
        isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value),
        bumpMemoryEpoch: () => {},
        bumpWorldEpoch: () => {}
    });
    const world = { entities: [], locations: [] };
    const audit = { world_state_version: 7, rejected: [{ reason: 'example' }] };
    const session = { id: 'a', name: 'A', history: [], worldStateVersion: 7,
        lastTurnAudit: audit,
        worldTurnReceipts: [{ receipt: { turn_id: 'turn_7' }, audit }] };
    const snapshot = context.captureWorldTurnState(world, session);
    assert.equal(snapshot.schema, 5);
    assert.equal(Object.hasOwn(snapshot.session, 'lastTurnAudit'), false);
    assert.deepEqual(snapshot.receiptCheckpoint.tail.audit, audit);
    session.lastTurnAudit = { world_state_version: 8 };
    session.worldTurnReceipts.push({ receipt: { turn_id: 'turn_8' }, audit: { world_state_version: 8 } });
    assert.equal(context.restoreWorldTurnState(world, session, snapshot), true);
    assert.deepEqual(session.lastTurnAudit, audit);
    assert.equal(session.worldTurnReceipts.at(-1).receipt.turn_id, 'turn_7');
    assert.equal(session.lastTurnAudit, session.worldTurnReceipts.at(-1).audit,
        'a restored audit must remain the selected receipt audit, not diverge on later annotation');

    const oldSnapshot = json(snapshot);
    oldSnapshot.schema = 4;
    oldSnapshot.session.lastTurnAudit = { world_state_version: 6, source: 'old_snapshot' };
    session.lastTurnAudit = null;
    assert.equal(context.restoreWorldTurnState(world, session, oldSnapshot), true);
    assert.equal(session.lastTurnAudit.source, 'old_snapshot');
});

test('deleting one timeline removes only its story-born people and places', () => {
    const context = buildContext(vm, ['removeWorldTimelineOwnedContent'], {});
    const world = {
        locations: [
            { id: 'square', name: 'Square', exits: ['to Secret A', 'to Secret B'] },
            { id: 'secret_a', name: 'Secret A', sessionOrigin: 'a', exits: [] },
            { id: 'secret_b', name: 'Secret B', sessionOrigin: 'b', exits: [] }
        ],
        entities: [
            { id: 'author', type: 'npc' },
            { id: 'npc_a', type: 'npc', sessionOrigin: 'a' },
            { id: 'npc_b', type: 'npc', sessionOrigin: 'b' }
        ]
    };
    context.removeWorldTimelineOwnedContent(world, 'a');
    assert.deepEqual(Array.from(world.locations, location => location.id), ['square', 'secret_b']);
    assert.deepEqual(Array.from(world.entities, entity => entity.id), ['author', 'npc_b']);
    assert.deepEqual(Array.from(world.locations[0].exits), ['to Secret B']);
    assert.match(app, /removeWorldTimelineOwnedContent\(world, removedSession\.id\)/);
});

test('play and prompt paths resolve exits against the same session world view', () => {
    assert.match(app, /const playWorldView = worldForSession\(world, sess\)/);
    assert.match(app, /resolveWorldExitTarget\(playWorldView, exit\)/);
    assert.match(app, /const visibleWorld = worldForSession\(world, sess\)/);
    assert.match(app, /getLocationRef\(visibleWorld, ex\.targetLocationId \|\| getExitTargetName\(ex\)\)/);
});

let passed = 0;
for (const { name, fn } of tests) {
    try {
        fn();
        passed++;
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        throw error;
    }
}
console.log(`\n${passed}/${tests.length} world graph consistency checks passed.`);
