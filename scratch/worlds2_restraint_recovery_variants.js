/** Offline adversarial variants for the narrowly recovered live rope release. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const ctx = buildContext(vm, ['validateWorldTurnReceipt'], {
    state: { worldInstances: {} },
    showToast() {},
    console: { log() {}, warn() {}, error() {} }
});

const input = 'I cut Tomas’s ropes with my short sword, ask him to follow me, and remain in the cellar until he answers.';
const completedProse = 'You slice through Tomas’s ropes. The coarse ropes snap and fall away from the beam.\nTomas Reed: “I’ll follow you back to Iven.”';
const cut = () => ({ action: 'cut ropes', actor_id: 'player', cause: 'freeing the courier',
    evidence: 'The coarse ropes snap and fall away.', status: 'completed', target_id: 'tomas' });
const session = () => ({
    id: 'restraint_variants', playerLocation: 'cellar', turnCount: 4,
    entityStates: {
        mara: { location: 'inn', status: 'alive' },
        iven: { location: 'square', status: 'alive' },
        sel: { location: 'cellar', status: 'alive', currentActivity: 'holding valve handle' },
        tomas: { location: 'cellar', status: 'alive', currentActivity: 'bound to support beam', followingPlayer: false }
    },
    playerStats: { hp: 12, might: 3, wits: 4, silver: 6 },
    inventory: ['short sword'], quests: [], history: [], ledger: '',
    pendingChecks: [], playerState: { status: 'active', conditions: [] }
});
const receipt = (events, activity = 'leaning on player') => ({
    scene: { player_location_id: 'cellar', player_location_changed: false,
        present_character_ids: ['sel', 'tomas'] },
    events,
    entity_updates: [{ entity_id: 'tomas', location_id: 'cellar', activity,
        interacting_with: ['player'] }],
    state_updates: {}
});
const inspect = (events, narrativeText = completedProse, activity) =>
    ctx.validateWorldTurnReceipt(world, session(), receipt(events, activity), {
        playerStartLocationId: 'cellar', playerInput: input, narrativeText
    });
const reasons = result => result.rejectedEvents.map(item => item.reason);

const valid = inspect([cut()]);
assert.equal(valid.rejectedEvents.length, 0, JSON.stringify(reasons(valid)));
assert(valid.acceptedEvents.some(event => event.type === 'interaction' && event.actor_id === 'player'));
assert(valid.acceptedEvents.some(event => event.type === 'escort' && event.actor_id === 'tomas'));

const extraTime = inspect([cut(), { type: 'time', status: 'completed', minutes_elapsed: 1 }]);
assert(reasons(extraTime).includes('unsupported_event_type'),
    'An extra event must not turn a malformed physical action into canon.');
assert(!extraTime.acceptedEvents.some(event => event.type === 'interaction' || event.type === 'escort'));

const pretypedEscort = inspect([cut(), { type: 'escort', actor_id: 'tomas', target_id: 'player',
    action: 'join', status: 'completed', evidence: 'Tomas agrees to follow.' }]);
assert(reasons(pretypedEscort).includes('unsupported_event_type'),
    'A pre-typed escort must not make an untyped rope release valid.');
assert(!pretypedEscort.acceptedEvents.some(event => event.type === 'interaction'));

const attempted = inspect([cut()], 'You try to cut Tomas’s ropes, but they remain tight.\nTomas Reed: “I’ll follow you if you free me.”', 'bound to support beam');
assert(reasons(attempted).includes('unsupported_event_type'));
assert(!attempted.acceptedEvents.some(event => event.type === 'interaction' || event.type === 'escort'));

const noAgreement = inspect([cut()], 'You slice through Tomas’s ropes. The ropes snap and fall away.\nTomas Reed: “Maybe I should follow you.”');
assert.equal(noAgreement.rejectedEvents.length, 0, JSON.stringify(reasons(noAgreement)));
assert(noAgreement.acceptedEvents.some(event => event.type === 'interaction'));
assert(!noAgreement.acceptedEvents.some(event => event.type === 'escort'),
    'A tentative reply must not become consent to follow.');

console.log('PASS: restraint recovery accepts only corroborated release/agreement; extra events and ambiguous prose stay rejected');
