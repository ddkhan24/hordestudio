/**
 * Offline regression for unit accounting in stacked Worlds inventory.
 * No provider calls, browser, or persisted user data.
 * Run: node scratch/worlds2_stacked_inventory_regression.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const mechanicsWindow = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'rpg-mechanics.js'), 'utf8'),
    { window: mechanicsWindow });
const context = buildContext(vm,
    ['executeCommerceTransactions', 'performAuthoritativeChecks', 'processStructuredActions'],
    { HordeRpgMechanics: mechanicsWindow.HordeRpgMechanics, showToast() {},
        state: { worldInstances: {} }, console: { log() {}, warn() {}, error() {} } });

function session(inventory = [{ name: 'healing draught', quantity: 2 }], market = false) {
    return {
        id: 'stacked_inventory_probe', playerLocation: 'inn', turnCount: 1,
        entityStates: {}, playerStats: { hp: 12, might: 3, wits: 4, silver: 6 },
        playerState: { status: 'active', conditions: [] }, inventory: structuredClone(inventory),
        equipment: {}, quests: [], history: [], ledger: '', pendingChecks: [], checkHistory: [],
        economy: { currency: 'silver', markets: market ? {
            inn: { healing_draught: { item: 'healing draught', quantity: 3, price: 2, maxQuantity: 100 } }
        } : {} }
    };
}

function ownedUnits(sess) {
    return sess.inventory.reduce((sum, item) => {
        const name = typeof item === 'string' ? item : item?.name;
        if (name !== 'healing draught') return sum;
        return sum + (typeof item === 'string' ? 1 : Math.max(1, Math.trunc(Number(item.quantity) || 1)));
    }, 0);
}

const probes = [];
function probe(name, fn) {
    try { fn(); probes.push({ name, pass: true }); }
    catch (error) { probes.push({ name, pass: false, error: error.message }); }
}

probe('open-market sale of one from quantity two leaves one unit and credits one', () => {
    const s = session();
    const [result] = context.executeCommerceTransactions(world, s,
        [{ type: 'sell', item: 'healing draught', quantity: 1, price: 2 }]);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(ownedUnits(s), 1);
    assert.equal(s.playerStats.silver, 8);
});

probe('open-market sale of two from quantity two removes both and credits two', () => {
    const s = session();
    const [result] = context.executeCommerceTransactions(world, s,
        [{ type: 'sell', item: 'healing draught', quantity: 2, price: 2 }]);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(ownedUnits(s), 0);
    assert.equal(s.playerStats.silver, 10);
});

probe('defined-market sale of one from quantity two keeps the second unit', () => {
    const s = session(undefined, true);
    const [result] = context.executeCommerceTransactions(world, s,
        [{ type: 'sell', item: 'healing draught', quantity: 1 }]);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(ownedUnits(s), 1);
    assert.equal(s.playerStats.silver, 8);
    assert.equal(s.economy.markets.inn.healing_draught.quantity, 4);
});

probe('defined-market sale of two from quantity two credits both units', () => {
    const s = session(undefined, true);
    const [result] = context.executeCommerceTransactions(world, s,
        [{ type: 'sell', item: 'healing draught', quantity: 2 }]);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(ownedUnits(s), 0);
    assert.equal(s.playerStats.silver, 10);
    assert.equal(s.economy.markets.inn.healing_draught.quantity, 5);
});

function failedCheck(sess, inventoryRemove) {
    const localWorld = structuredClone(world);
    localWorld.gameRules.dice.criticals = false;
    const [result] = context.performAuthoritativeChecks(localWorld, sess, [{
        label: 'Handle a volatile flask', difficulty: 20, modifier: -5,
        provided_roll: 1, failure_cost: { inventory_remove: inventoryRemove }
    }], { allowProvidedRoll: true, silent: true });
    assert.equal(result.success, false, JSON.stringify(result));
    return result;
}

probe('failed check removes one unit of a quantity-two stack', () => {
    const s = session();
    const result = failedCheck(s, ['healing draught']);
    assert.equal(result.failureCost?.applied, true, JSON.stringify(result));
    assert.equal(ownedUnits(s), 1);
});

probe('failed check can remove both units from one quantity-two stack', () => {
    const s = session();
    const result = failedCheck(s, ['healing draught', 'healing draught']);
    assert.equal(result.failureCost?.applied, true, JSON.stringify(result));
    assert.equal(ownedUnits(s), 0);
});

probe('two structured removals consume both units of a quantity-two stack', () => {
    const s = session();
    const result = context.processStructuredActions(
        { inventory_remove: ['healing draught', 'healing draught'] }, world, s, { deferFeedback: true });
    assert.equal(result.inventoryFailures.length, 0, JSON.stringify(result.inventoryFailures));
    assert.equal(ownedUnits(s), 0);
});

for (const item of probes) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `: ${item.error}` : ''}`);
}
const failed = probes.filter(item => !item.pass);
console.log(`${probes.length - failed.length}/${probes.length} stacked-inventory probes passed`);
if (failed.length) process.exitCode = 1;
