/** Transactional manual-check regression. No provider or browser required. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { asyncFunctionSource } = require('./app_source.js');

const world = { id: 'check_world' };
const sess = {
    id: 'check_session', turnCount: 3, playerLocation: 'gate', history: [], checkHistory: [],
    pendingChecks: [{ id: 'check_3_1', label: 'Pick the gate', difficulty: 8,
        on_success: { exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }] } }]
};
sess.pendingCheck = sess.pendingChecks[0];
const toasts = [];
let mode = 'invalid_outcome';
let rolls = 0;
let saves = 0;
let closes = 0;
let continuations = 0;
const restore = before => {
    Object.keys(sess).forEach(key => delete sess[key]);
    Object.assign(sess, structuredClone(before));
};
const context = {
    console, worldTurnInProgress: false, worldMutationInProgress: false,
    state: { worlds: [world], activeWorldId: world.id },
    document: { getElementById: () => ({ value: '' }) },
    isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
    CHECK_GUARDED_ACTION_FIELDS: ['exit_unlocks'],
    worldManualCheckExitUnlock: () => null,
    worldCheckLooksLikeExitUnlock: () => true,
    getCurrentWorldSession: () => sess,
    normalizeWorldDiceConfig: () => ({ sides: 20, defaultDifficulty: 10 }),
    rollSecureDie: () => { rolls++; return 9; },
    performAuthoritativeChecks: (_world, session, checks, options) => {
        assert.equal(options.allowProvidedRoll, true);
        assert.equal(checks[0].provided_roll, 9);
        session.checkHistory.push({ id: checks[0].id, roll: 9 });
        session.pendingChecks = [];
        session.pendingCheck = null;
        return [{ id: checks[0].id, label: checks[0].label, success: true, sides: 20,
            roll: 9, total: 9, difficulty: 8, statModifier: 0, situationalModifier: 0 }];
    },
    sanitizeCheckOutcomeActions: value => value,
    processStructuredActions: (_outcome, _world, session, authority) => {
        assert.equal(authority.authorizedCheckOutcome, true);
        session.unlockedExits = { 'gate::cellar': true };
        return mode === 'invalid_outcome'
            ? { inventoryFailures: [{ reason: 'item_not_owned' }], moduleRejections: [] }
            : { inventoryFailures: [], moduleRejections: [], feedback: [] };
    },
    commitEngineWorldNoOp: (_world, session) => {
        session.worldStateVersion = (session.worldStateVersion || 0) + 1;
        return { audit: { rejected: [] } };
    },
    addWorldMessage: (_role, text) => { sess.history.push({ text }); },
    attemptWorldStateMutation: (_world, session, apply, accepts) => {
        const before = structuredClone(session);
        const result = apply();
        let closed = false;
        const rollback = () => { if (!closed) { restore(before); closed = true; } };
        if (!accepts(result)) { rollback(); return { accepted: false, result, rollback }; }
        return { accepted: true, result, rollback, commit: () => { closed = true; } };
    },
    saveWorldsState: async () => { saves++; if (mode === 'save_failure') throw new Error('disk full'); },
    flushWorldActionFeedback: () => {},
    closeWorldCheckModal: () => { closes++; },
    renderWorldPlayState: () => {},
    executeWorldTurn: () => { continuations++; },
    showToast: message => { toasts.push(message); }
};
vm.createContext(context);
vm.runInContext(`${asyncFunctionSource('resolveWorldCheckFromModal').replace(/^function /, 'async function ')}\nthis.resolveWorldCheckFromModal = resolveWorldCheckFromModal;`, context);

(async () => {
    await context.resolveWorldCheckFromModal();
    assert.equal(saves, 0, 'an invalid consequence must never reach persistence');
    assert.equal(sess.pendingChecks.length, 1, 'failed outcome retains the pending check');
    assert.equal(sess.checkHistory.length, 0, 'failed outcome rolls back check history');
    assert.equal(sess.unlockedExits, undefined, 'failed outcome rolls back even a partially applied unlock');
    assert.equal(sess.history.length, 0, 'failed outcome never leaves a result message');
    assert.equal(sess.uncommittedCheckRoll.roll, 9, 'the rolled die is held for a fair retry');
    assert.equal(context.worldMutationInProgress, false);

    sess.pendingChecks[0].on_success = { invented_unlock: true };
    sess.pendingCheck = sess.pendingChecks[0];
    await context.resolveWorldCheckFromModal();
    assert.equal(saves, 0, 'an unsupported outcome key cannot be silently discarded');
    assert.equal(sess.pendingChecks.length, 1);
    assert.equal(sess.history.length, 0);
    sess.pendingChecks[0].on_success = { exit_unlocks: [
        { from_location_id: 'gate', to_location_id: 'cellar' }
    ] };
    sess.pendingCheck = sess.pendingChecks[0];

    mode = 'save_failure';
    await context.resolveWorldCheckFromModal();
    assert.equal(rolls, 1, 'retry must reuse the original die');
    assert.equal(saves, 1);
    assert.equal(sess.pendingChecks.length, 1, 'failed save restores the pending check');
    assert.equal(sess.checkHistory.length, 0);
    assert.equal(sess.unlockedExits, undefined);
    assert.equal(sess.history.length, 0);
    assert.equal(closes, 0, 'the modal stays open so the user can retry');
    assert.equal(continuations, 0, 'a failed save cannot advance the DM');

    mode = 'success';
    await context.resolveWorldCheckFromModal();
    assert.equal(rolls, 1);
    assert.equal(saves, 2);
    assert.equal(sess.pendingChecks.length, 0);
    assert.equal(sess.checkHistory.length, 1);
    assert.equal(sess.unlockedExits['gate::cellar'], true);
    assert.equal(sess.history.length, 1);
    assert.equal(sess.uncommittedCheckRoll, undefined);
    assert.equal(closes, 1);
    assert.equal(continuations, 1);
    assert(toasts.some(message => message.includes('not saved')));
    console.log('✓ check outcomes and save failures roll back atomically; retries retain the same die');
})().catch(error => { console.error(error); process.exitCode = 1; });
