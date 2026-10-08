/** Shared state-command rollback regression for receipts, travel and World Agent. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext, functionSource } = require('./app_source.js');

const context = buildContext(vm, ['attemptWorldStateMutation'], {
    captureWorldTurnState: (world, session) => ({
        value: session.value,
        entities: JSON.parse(JSON.stringify(world.entities))
    }),
    restoreWorldTurnState: (world, session, snapshot) => {
        session.value = snapshot.value;
        world.entities = JSON.parse(JSON.stringify(snapshot.entities));
        return true;
    }
});

const world = { entities: [] };
const session = { value: 1, history: [{ text: 'Before' }] };

const rejected = context.attemptWorldStateMutation(world, session, () => {
    session.value = 2;
    session.history.push({ text: 'Tentative' });
    world.entities.push({ id: 'tentative' });
    return { valid: false };
}, result => result.valid);
assert.equal(rejected.accepted, false);
assert.equal(session.value, 1);
assert.deepEqual(session.history, [{ text: 'Before' }]);
assert.deepEqual(world.entities, []);

const savedFailure = context.attemptWorldStateMutation(world, session, () => {
    session.value = 3;
    session.history.push({ text: 'Not saved' });
    world.entities.push({ id: 'not_saved' });
    return { valid: true };
}, result => result.valid);
assert.equal(savedFailure.accepted, true);
assert.equal(savedFailure.rollback(), true, 'a failed persistence must be able to undo an accepted proposal');
assert.equal(savedFailure.rollback(), false, 'rollback is idempotent');
assert.equal(session.value, 1);
assert.deepEqual(session.history, [{ text: 'Before' }]);
assert.deepEqual(world.entities, []);

assert.throws(() => context.attemptWorldStateMutation(world, session, () => {
    session.value = 4;
    session.history.push({ text: 'Throwing' });
    throw new Error('reducer failed');
}), /reducer failed/);
assert.equal(session.value, 1);
assert.deepEqual(session.history, [{ text: 'Before' }]);

const accepted = context.attemptWorldStateMutation(world, session, () => {
    session.value = 5;
    session.history.push({ text: 'Saved' });
    return { valid: true };
}, result => result.valid);
accepted.commit();
assert.equal(accepted.rollback(), false, 'committed state cannot be undone by a stale command handle');
assert.equal(session.value, 5);
assert.equal(session.history.at(-1).text, 'Saved');

const exit = functionSource('travelThroughWorldExit');
const agent = functionSource('runWorldAgent');
const turn = functionSource('executeWorldTurn');
assert.match(exit, /attemptWorldStateMutation\(world, sess/);
assert.match(agent, /attemptWorldStateMutation\(world, sess/);
assert.match(turn, /attemptWorldStateMutation\(world, sess/);
assert.match(exit, /\{ deferPersist: true, deferEmbedding: true \}/);
console.log('✓ receipt, exit travel and World Agent share a rollback boundary; rejected, thrown and unsaved changes unwind');
