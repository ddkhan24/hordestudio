/** Routine inventory changes remain canonical without becoming plot hooks. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const context = buildContext(vm, ['validateWorldTurnReceipt', 'recordWorldTurnCommit'], {
    state: { worldInstances: {} },
    showToast() {},
    console: { log() {}, warn() {}, error() {} }
});

function session() {
    return {
        id: 'offline_inventory_consequence', playerLocation: 'causeway', turnCount: 1,
        entityStates: Object.fromEntries(world.entities.map(npc => [npc.id, {
            location: npc.locationId || npc.location || '', status: 'alive'
        }])),
        playerStats: { hp: 12, might: 3, wits: 4, silver: 6 },
        inventory: [], quests: [], history: [], ledger: '',
        pendingChecks: [], playerState: { status: 'active', conditions: [] },
        turnEvents: [], worldTurnReceipts: [], playerKnownEvents: [], consequences: []
    };
}

function validateAndRecord(sess, events, narrativeText) {
    const candidate = {
        summary: 'A strap is recovered and examined.',
        scene: { player_location_id: 'causeway', player_location_changed: false,
            present_character_ids: [] },
        events, entity_updates: [], state_updates: {}
    };
    const validation = context.validateWorldTurnReceipt(world, sess, candidate, {
        playerStartLocationId: 'causeway',
        playerInput: 'I pick up the torn satchel strap and inspect its guild mark.',
        narrativeText
    });
    assert.equal(validation.rejectedEvents.length, 0, JSON.stringify(validation.rejectedEvents));
    context.recordWorldTurnCommit(world, sess, validation, null);
    return sess;
}

const pickup = {
    type: 'inventory', status: 'completed', actor_id: 'player',
    action: 'add', item: 'torn satchel strap',
    evidence: 'The ranger tucked the torn satchel strap into their pack.',
    witnessed_by: ['player']
};
const mundane = validateAndRecord(session(), [pickup],
    'You pick up the torn satchel strap and tuck it into your pack.');
assert.equal(mundane.turnEvents.length, 1);
assert.equal(mundane.turnEvents[0].type, 'inventory');
assert.equal(mundane.turnEvents[0].item, 'torn satchel strap');
assert.equal(mundane.consequences.length, 0,
    'A routine pickup must not become an active unresolved story consequence.');

const significant = validateAndRecord(session(), [pickup, {
    type: 'discovery', status: 'completed', actor_id: 'player',
    evidence: 'The guild mark identifies the strap as Tomas Reed’s missing courier satchel.',
    witnessed_by: ['player']
}], 'You pick up the strap and recognize the courier guild mark as Tomas Reed’s.');
assert.equal(significant.turnEvents.length, 2);
assert.equal(significant.consequences.length, 1,
    'An explicitly authored discovery must still become a story consequence.');
assert.equal(significant.consequences[0].type, 'discovery');
assert.equal(significant.consequences[0].sourceEventId, significant.turnEvents[1].id);

function lanternReceipt(input, narrativeText) {
    const sess = session();
    return context.validateWorldTurnReceipt(world, sess, {
        summary: 'A lantern changes hands.',
        scene: { player_location_id: 'causeway', player_location_changed: false,
            present_character_ids: [] },
        events: [{ type: 'inventory', status: 'completed', actor_id: 'player',
            action: 'add', item: 'iron lantern',
            evidence: 'Iven holds an iron lantern out to the player.' }],
        entity_updates: [], state_updates: {}
    }, { playerStartLocationId: 'causeway', playerInput: input, narrativeText });
}
assert(lanternReceipt('I ask Iven for an iron lantern.',
    'Iven holds an iron lantern out to you, but does not let go until you reach for it.')
    .rejectedEvents.some(event => event.reason === 'inventory_gain_not_completed'),
    'a held-out item is an offer, not a completed pickup');
assert(lanternReceipt('I refuse the iron lantern.',
    'Iven gives you the iron lantern.')
    .rejectedEvents.some(event => event.reason === 'inventory_gain_not_completed'),
    'explicit refusal cannot become a granted item');
assert(lanternReceipt('I listen to Iven.',
    'You take the captain’s advice; the iron lantern remains on the well.')
    .rejectedEvents.some(event => event.reason === 'inventory_gain_not_completed'),
    'an unrelated “take” in the scene cannot corroborate an item grant');
assert(lanternReceipt('I ask for the lantern.',
    'Captain Iven: “You take the iron lantern, ranger.” He keeps his hand on it.')
    .rejectedEvents.some(event => event.reason === 'inventory_gain_not_completed'),
    'an NPC suggestion in dialogue cannot grant an item');
assert.equal(lanternReceipt('I take the iron lantern.',
    'You take the iron lantern and tuck it into your pack.').rejectedEvents.length, 0,
    'a completed player pickup remains valid');
assert.equal(lanternReceipt('I ask for the iron lantern.',
    'Iven gives you the iron lantern, placing it in your hands.').rejectedEvents.length, 0,
    'a completed NPC-to-player handoff remains valid');

console.log('PASS: routine pickup is durable without an active consequence; explicit discovery still creates one');
