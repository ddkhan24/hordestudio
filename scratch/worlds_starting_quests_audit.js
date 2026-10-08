/**
 * Offline authoring/seed/reload gate. No model calls and no user state writes.
 * Run with the bundled Node runtime: node scratch/worlds_starting_quests_audit.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const context = buildContext(vm, [
    'normalizeWorldStartingQuests', 'seedWorldStartingQuests',
    'normalizeQuestState', 'evaluateQuestProgress', 'applyQuestUpdates', 'getQuestPrompt'
], { showToast() {}, console: { log() {}, warn() {}, error() {} } });

let checks = 0;
function check(name, run) {
    run();
    checks++;
    console.log(`PASS ${name}`);
}

world.startingQuests = [
    { id: 'first_errand', title: 'Reach the tower cellar', description: 'Follow the missing courier.',
        objectives: [{ id: 'arrive', text: 'Reach the cellar', type: 'location', target: 'cellar',
            current: 7, status: 'completed' }],
        rewards: { items: ['tower token'], stats: { silver: 5 } },
        status: 'completed', rewardsGranted: true, rewardReceipt: 'old reward' },
    { id: 'first_errand', title: 'Find the second clue',
        objectives: [{ text: 'Find the clue', type: 'manual' }], rewards: {} }
];

check('template normalization strips played state and resolves duplicate IDs', () => {
    context.normalizeWorldStartingQuests(world);
    assert.equal(world.startingQuests.length, 2);
    assert.notEqual(world.startingQuests[0].id, world.startingQuests[1].id);
    assert.equal(world.startingQuests[0].objectives[0].current, 0);
    assert.equal(world.startingQuests[0].objectives[0].status, 'active');
    assert.equal(world.startingQuests[0].rewardsGranted, undefined);
    assert.equal(world.startingQuests[0].rewardReceipt, undefined);
});

const sess = {
    id: 'new-timeline', playerLocation: 'inn', turnCount: 1,
    quests: [], inventory: [], playerStats: { silver: 6 },
    history: [], entityStates: {}, playerState: { status: 'active', conditions: [] }
};

check('new timeline receives active objectives but no setup reward', () => {
    assert.equal(context.seedWorldStartingQuests(world, sess), true);
    assert.equal(sess.startingQuestsSeeded, true);
    assert.equal(sess.quests.length, 2);
    assert.equal(sess.quests[0].status, 'active');
    assert.equal(sess.quests[0].objectives[0].current, 0);
    assert.equal(sess.quests[0].rewardsGranted, false);
    assert.equal(sess.playerStats.silver, 6);
    assert(!sess.inventory.includes('tower token'));
});

check('seeding the same timeline again cannot duplicate quests', () => {
    assert.equal(context.seedWorldStartingQuests(world, sess), false);
    assert.equal(sess.quests.length, 2);
});

check('completion pays once and survives a save/reload normalization', () => {
    sess.playerLocation = 'cellar';
    const first = context.evaluateQuestProgress(world, sess);
    assert(first.rewardsGranted.includes('first_errand'));
    assert.equal(sess.inventory.filter(item => item === 'tower token').length, 1);
    assert.equal(sess.playerStats.silver, 11);
    const reloaded = JSON.parse(JSON.stringify(sess));
    context.normalizeQuestState(world, reloaded);
    assert.equal(context.seedWorldStartingQuests(world, reloaded), false);
    const next = context.evaluateQuestProgress(world, reloaded);
    assert.equal(next.rewardsGranted.length, 0);
    assert.equal(reloaded.inventory.filter(item => item === 'tower token').length, 1);
    assert.equal(reloaded.playerStats.silver, 11);
});

check('old world files with no startingQuests remain valid', () => {
    const legacyWorld = { ...world };
    delete legacyWorld.startingQuests;
    assert.equal(context.normalizeWorldStartingQuests(legacyWorld).length, 0);
    assert.equal(context.seedWorldStartingQuests(legacyWorld, { quests: [] }), true);
});

check('two quest payouts of the same item add two inventory units', () => {
    const duplicate = {
        id: 'two-payouts', playerLocation: 'cellar', turnCount: 1,
        quests: ['one', 'two'].map(id => ({ id, title: id, status: 'active',
            objectives: [{ id: 'arrive', text: 'Reach the cellar', type: 'location', target: 'cellar' }],
            rewards: { items: ['tower token'] } })),
        inventory: [], playerStats: {}, history: [], entityStates: {}
    };
    const result = context.evaluateQuestProgress(world, duplicate);
    assert.equal(result.rewardsGranted.length, 2);
    assert.equal(duplicate.inventory.filter(item => item === 'tower token').length, 2);
    context.evaluateQuestProgress(world, duplicate);
    assert.equal(duplicate.inventory.filter(item => item === 'tower token').length, 2);
});

check('inventory objectives count units in an imported quantity stack', () => {
    const stacked = {
        id: 'stacked', playerLocation: 'inn', turnCount: 1,
        quests: [{ id: 'gather', title: 'Gather two draughts', status: 'active',
            objectives: [{ id: 'own_two', text: 'Own two healing draughts',
                type: 'inventory', target: 'healing draught', required: 2 }], rewards: {} }],
        inventory: [{ id: 'draught', name: 'healing draught', quantity: 2 }],
        playerStats: {}, history: [], entityStates: {}
    };
    context.evaluateQuestProgress(world, stacked);
    assert.equal(stacked.quests[0].objectives[0].current, 2);
    assert.equal(stacked.quests[0].status, 'completed');
});

check('invalid quest stat reward stays pending, then a corrected reward pays exactly once', () => {
    const s = {
        id: 'correctable-reward', playerLocation: 'cellar', turnCount: 1,
        quests: [{ id: 'reach_cellar', title: 'Reach the cellar', status: 'active',
            objectives: [{ id: 'arrive', text: 'Reach cellar', type: 'location', target: 'cellar' }],
            rewards: { stats: { nonexistent_attribute: 5 } } }],
        inventory: [], playerStats: { hp: 12, might: 3, wits: 4, silver: 6 },
        history: [], entityStates: {}, playerState: { status: 'active', conditions: [] }
    };
    const first = context.evaluateQuestProgress(world, s);
    assert(first.completed.includes('reach_cellar'));
    assert.equal(first.rewardsGranted.length, 0);
    assert.equal(s.quests[0].status, 'completed');
    assert.equal(s.quests[0].rewardsGranted, false);
    assert.match(s.quests[0].rewardReceipt, /invalid stat reward/i);
    assert.equal(s.playerStats.silver, 6);

    s.quests[0].rewards.stats = { silver: 5 };
    const second = context.evaluateQuestProgress(world, s);
    assert.deepEqual(Array.from(second.rewardsGranted), ['reach_cellar']);
    assert.equal(s.quests[0].rewardsGranted, true);
    assert.equal(s.playerStats.silver, 11);
    const third = context.evaluateQuestProgress(world, s);
    assert.equal(third.rewardsGranted.length, 0);
    assert.equal(s.playerStats.silver, 11);
});

check('finding the courier requires witnessed confirmation and an explicit manual receipt', () => {
    const courierWorld = JSON.parse(fs.readFileSync(path.join(__dirname,
        'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
    const courierSession = {
        id: 'courier-confirmation', playerLocation: 'cellar', turnCount: 7,
        quests: [], inventory: [], playerStats: { silver: 6 }, history: [],
        entityStates: { tomas: { status: 'alive', locationId: 'cellar' } },
        playerState: { status: 'active', conditions: [] }
    };
    context.seedWorldStartingQuests(courierWorld, courierSession);
    context.evaluateQuestProgress(courierWorld, courierSession);
    assert.equal(courierSession.quests[0].objectives[0].current, 0,
        'entering the same room as a living courier is not proof the player confirmed his fate');
    assert.equal(courierSession.quests[0].status, 'active');
    const prompt = context.getQuestPrompt(courierWorld, courierSession);
    assert.match(prompt, /Manual objectives do not advance automatically/);
    assert.match(prompt, /direct, on-screen evidence/);
    assert.match(prompt, /\[confirm_tomas\]/);
    const committed = context.applyQuestUpdates(courierWorld, courierSession, [{
        id: 'find_missing_courier', objectives: [{ id: 'confirm_tomas', current: 1, status: 'completed' }]
    }]);
    assert(committed.completed.includes('find_missing_courier'));
    assert.equal(courierSession.quests[0].objectives[0].current, 1);
    assert.equal(courierSession.quests[0].status, 'completed');
    context.evaluateQuestProgress(courierWorld, courierSession);
    assert.equal(courierSession.quests[0].objectives[0].current, 1,
        'an already confirmed manual objective must not increment on reevaluation');
});

console.log(`${checks}/${checks} starting quest checks passed`);
