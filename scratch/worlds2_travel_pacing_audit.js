/** A familiar transit can be brief; a changed scene must not be compressed. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const ctx = buildContext(vm, ['classifyWorldArrivalPacing']);
const world = {};
const location = { id: 'causeway' };
const travel = { receiptCheckpoint: { tail: { audit: { source: 'engine_travel' } } } };
const ordinary = { receiptCheckpoint: { tail: { audit: { source: 'tool_call' } } } };
const session = () => ({ turnCount: 4, history: [
    { role: 'dm', location: 'causeway', text: 'The player first saw the causeway.' }
] });
const pacing = (sess, snapshot = travel, npcs = []) =>
    ctx.classifyWorldArrivalPacing(world, sess, location, snapshot, npcs, 560);

assert.equal(pacing(session(), ordinary), 'ordinary');
assert.equal(pacing({ turnCount: 4, history: [] }), 'first');
assert.equal(pacing(session()), 'familiar');
assert.equal(pacing({ ...session(), quests: [{ status: 'active', title: 'Find Tomas' }] }), 'familiar',
    'a distant quest alone must not force repeated scenery on every transit');
assert.equal(pacing(session(), travel, [{ id: 'guide' }]), 'familiar',
    'A familiar resident alone is not a new arrival event every time.');
assert.equal(pacing({ turnCount: 4, history: [] }, travel, [{ id: 'guide' }]), 'eventful');
assert.equal(pacing({ ...session(), engineEvents: ['The bridge collapses.'] }), 'eventful');
assert.equal(ctx.classifyWorldArrivalPacing(world, session(), location, travel, [], 560, true), 'eventful',
    'already-drained engine events must still make the arrival eventful');
assert.equal(pacing({ ...session(), threads: [{ status: 'open', text: 'A warning' }] }), 'familiar',
    'An unrelated open thread must not lengthen every routine journey.');
assert.equal(pacing({ ...session(), threads: [{ status: 'open', locationId: 'causeway', text: 'A warning' }] }), 'eventful');
assert.equal(pacing({ ...session(), pendingChecks: [{ label: 'Avoid collapse' }] }), 'eventful');
assert.equal(pacing({ ...session(), locationStates: { causeway: {
    conditions: [{ label: 'Flooded' }] } } }), 'eventful');
assert.equal(pacing({ ...session(), consequences: [{ state: 'active', locationId: 'causeway', severity: 20 }] }), 'eventful');
assert.equal(pacing({ ...session(), consequences: [{ state: 'active', locationId: 'elsewhere', severity: 75,
    createdTurn: 4 }] }), 'eventful', 'a fresh severe consequence can still affect the next arrival');
assert.equal(pacing({ ...session(), consequences: [{ state: 'active', locationId: 'elsewhere', severity: 75,
    createdTurn: 1, updatedTurn: 1 }] }), 'familiar',
    'an old unresolved remote warning must not make every later routine trip verbose');
assert.equal(pacing({ ...session(), scheduledEvents: [{ status: 'scheduled', dueMinute: 560 }] }), 'eventful');
assert.equal(pacing({ ...session(), scheduledEvents: [{ status: 'scheduled', dueTurn: 5 }] }), 'eventful');
assert.equal(pacing({ ...session(), scheduledEvents: [{ status: 'scheduled', dueMinute: 561, dueTurn: 6 }] }), 'familiar');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.match(appSource, /const hadEngineEvents = \(sess\.engineEvents \|\| \[\]\)\.length > 0;[\s\S]*?sess\.engineEvents = \[\];/,
    'capture queued events before draining them');
assert.match(appSource, /classifyWorldArrivalPacing\(world, sess, loc, turnSnapshot, presentNPCs, currentTotalMinutes, hadEngineEvents\)/,
    'pass the pre-drain event flag into arrival pacing');

console.log('PASS: only familiar, uneventful mapped arrivals receive brief pacing');
