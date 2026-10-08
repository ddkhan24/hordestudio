/** The live RPG handoff must end an escort without treating conversation as release. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const ctx = buildContext(vm, ['validateWorldTurnReceipt', 'applyWorldEntityPatches',
    'movePlayerAlongWorldPath'], {
    state: { worldInstances: {} }, showToast() {},
    console: { log() {}, warn() {}, error() {} },
    worldForSession: value => value,
    getWorldTimeData: () => ({ currentTotalMinutes: 100, timeStep: 5 })
});
const session = () => ({
    id: 'handoff', playerLocation: 'square', turnCount: 14,
    entityStates: {
        mara: { location: 'inn', status: 'alive' },
        iven: { location: 'square', status: 'alive', currentActivity: 'watching the road' },
        sel: { location: 'cellar', status: 'alive' },
        tomas: { location: 'square', status: 'alive', followingPlayer: true,
            currentActivity: 'Travelling with the player.' }
    },
    playerStats: { hp: 12, might: 3, wits: 4, silver: 6 },
    inventory: ['short sword'], quests: [], history: [], ledger: '',
    pendingChecks: [], playerState: { status: 'active', conditions: [] }
});
const handoffInput = 'I bring Tomas Reed to Captain Iven in the square and tell him: I found Tomas alive in the tower cellar, bound by Sel. I cut him loose and brought him back. I ask what the village should do next.';
const handoffLedger = 'The player returned Tomas Reed to Captain Iven and reported Sel Ardent’s imprisonment of the courier.';
const handoffActivity = { entity_id: 'tomas', location_id: 'square',
    activity: 'leaning on Captain Iven', interacting_with: ['iven'] };
const receipt = (activity = handoffActivity, ledger = handoffLedger) => ({
    scene: { player_location_id: 'square', player_location_changed: false,
        present_character_ids: ['iven', 'tomas'] },
    events: [{ type: 'interaction', actor_id: 'player', status: 'completed',
        action: 'told', participants: ['iven'], evidence: 'I found Tomas alive and brought him back.' }],
    entity_updates: [activity], state_updates: ledger ? { ledger_update: ledger } : {}
});
const inspect = (input = handoffInput, activity = handoffActivity, ledger = handoffLedger,
    sess = session()) => ({ sess, result: ctx.validateWorldTurnReceipt(world, sess,
        receipt(activity, ledger), { playerStartLocationId: 'square', playerInput: input,
            narrativeText: 'You lead the shivering courier to Captain Iven. The Captain reaches out to steady Tomas.' }) });
const hasLeave = result => result.acceptedEvents.some(event =>
    event.type === 'escort' && event.actor_id === 'tomas' && event.action === 'leave');

const actual = inspect();
assert.equal(actual.result.rejectedEvents.length, 0, JSON.stringify(actual.result.rejectedEvents));
assert(hasLeave(actual.result), 'named, committed handoff should produce an escort leave receipt');
ctx.applyWorldEntityPatches(world, actual.sess, actual.result.entityPatches);
assert.equal(actual.sess.entityStates.tomas.followingPlayer, false);
const saved = JSON.parse(JSON.stringify(actual.sess));
assert.equal(saved.entityStates.tomas.followingPlayer, false,
    'the persisted session representation retains the handoff');
const afterHandoffTravel = ctx.movePlayerAlongWorldPath(world, saved,
    world.locations.find(location => location.id === 'inn'), { showTravelToast: false });
assert.equal(afterHandoffTravel.ok, true);
assert.equal(saved.playerLocation, 'inn');
assert.equal(saved.entityStates.tomas.location, 'square',
    'a former follower must remain with Captain Iven after player travel');
assert.equal(afterHandoffTravel.followersMoved.length, 0);

for (const [label, input, activity, ledger] of [
    ['casual conversation', 'I ask Captain Iven what the village should do next while Tomas stands beside me.',
        handoffActivity, handoffLedger],
    ['arrival without handoff', 'I enter the square with Tomas Reed and greet Captain Iven.',
        handoffActivity, handoffLedger],
    ['uncommitted handoff', handoffInput, handoffActivity,
        'The player spoke to Captain Iven while Tomas Reed stood nearby.'],
    ['escort still with player', handoffInput,
        { entity_id: 'tomas', location_id: 'square', activity: 'standing with the player',
            interacting_with: ['player', 'iven'] }, handoffLedger],
    ['recipient only mentioned', handoffInput,
        { entity_id: 'tomas', location_id: 'square', activity: 'standing with the player',
            interacting_with: ['iven'] }, handoffLedger]
]) {
    const { sess, result } = inspect(input, activity, ledger);
    assert.equal(result.rejectedEvents.length, 0, `${label}: ${JSON.stringify(result.rejectedEvents)}`);
    assert(!hasLeave(result), `${label} must not end the escort`);
    ctx.applyWorldEntityPatches(world, sess, result.entityPatches);
    assert.equal(sess.entityStates.tomas.followingPlayer, true, label);
    if (label === 'casual conversation') {
        const afterTalkTravel = ctx.movePlayerAlongWorldPath(world, sess,
            world.locations.find(location => location.id === 'inn'), { showTravelToast: false });
        assert.equal(afterTalkTravel.ok, true);
        assert.equal(sess.entityStates.tomas.location, 'inn',
            'a follower still accompanies the player after casual talk');
        assert.deepEqual(Array.from(afterTalkTravel.followersMoved), ['tomas']);
    }
}

const absentRecipient = session();
absentRecipient.entityStates.iven.location = 'inn';
assert(!hasLeave(inspect(handoffInput, handoffActivity, handoffLedger,
    absentRecipient).result), 'an absent recipient cannot receive the escort');
const notEscorting = session();
notEscorting.entityStates.tomas.followingPlayer = false;
assert(!hasLeave(inspect(handoffInput, handoffActivity, handoffLedger,
    notEscorting).result), 'a non-follower cannot be released');

console.log('PASS: explicit corroborated handoff ends escort; talk, arrival, absent recipient and ambiguous patches do not');
