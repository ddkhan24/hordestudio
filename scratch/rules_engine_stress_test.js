/**
 * Authoritative player rules, defeat, commerce, and check regression suite.
 * Run with: node scratch/rules_engine_stress_test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function functionSource(name) {
    const start = app.indexOf(`function ${name}(`);
    assert(start >= 0, `Missing function: ${name}`);
    const signatureEnd = /\)\s*\{/.exec(app.slice(start));
    assert(signatureEnd, `Missing function body: ${name}`);
    const brace = start + signatureEnd.index + signatureEnd[0].lastIndexOf('{');
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = brace; index < app.length; index++) {
        const char = app[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return app.slice(start, index + 1);
    }
    throw new Error(`Unclosed function: ${name}`);
}

const toasts = [];
const ledger = [];
const context = {
    console: { log() {}, warn() {}, error: console.error },
    Math,
    Number,
    String,
    Object,
    Array,
    Map,
    Set,
    JSON,
    parseInt,
    __cards: [],
    __moduleInputs: [],
    __controls: {},
    document: {
        querySelectorAll(selector) {
            return String(selector).includes('w-rules-modules-grid') ? context.__moduleInputs : context.__cards;
        },
        getElementById(id) { return context.__controls[id] || null; }
    },
    isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    },
    safeJsonClone(value) { return JSON.parse(JSON.stringify(value)); },
    cssColor(value, fallback) { return String(value || fallback); },
    showToast(message) { toasts.push(message); },
    queueEngineEvent(session, text) {
        session.engineEvents = session.engineEvents || [];
        if (!session.engineEvents.includes(text)) session.engineEvents.push(text);
    },
    appendWorldLedgerEntry(session, text) {
        ledger.push(text);
        session.ledger = `${session.ledger ? `${session.ledger}\n` : ''}• ${text}`;
        return text;
    },
    normalizeLivingWorldState(world, session) {
        session.inventory = Array.isArray(session.inventory) ? session.inventory : [];
        session.playerStats = session.playerStats || {};
        session.economy = session.economy || { currency: 'coin', markets: {} };
        session.economy.markets = session.economy.markets || {};
        return session;
    },
    getLocationRef(world, ref) {
        const key = String(ref || '').trim().toLowerCase();
        return world.locations.find(location =>
            location.id.toLowerCase() === key || location.name.toLowerCase() === key) || null;
    }
};
vm.createContext(context);

const names = [
    'questTextKey',
    'stableWorldRoll',
    'normalizeWorldGameRules',
    'applyWorldRuleProfile',
    'syncWorldStudioStatsFromDOM',
    'saveWorldGameRuleControls',
    'normalizePlayerRulesState',
    'applyPlayerStatChanges',
    'planWorldInventoryRemoval',
    'applyWorldInventoryRemovalPlan',
    'executeCommerceTransactions',
    'worldCheckModifier',
    'performAuthoritativeChecks',
    'applyPlayerConditionUpdates'
];
const rulesConstantsStart = app.indexOf('const WORLD_RULE_MODULE_KEYS');
const rulesNormalizerStart = app.indexOf('function normalizeWorldGameRules(');
assert(rulesConstantsStart >= 0 && rulesNormalizerStart > rulesConstantsStart, 'Missing modular rule definitions');
const ruleDefinitionsSource = app.slice(rulesConstantsStart, rulesNormalizerStart);
const composedSource = `${ruleDefinitionsSource}\n${names.map(functionSource).join('\n')}\n${names.map(name => `this.${name} = ${name};`).join('\n')}`;
try {
    vm.runInContext(composedSource, context);
} catch (error) {
    const line = Number(String(error.stack || '').match(/evalmachine.<anonymous>:(\d+)/)?.[1]) || 1;
    console.error(composedSource.split('\n').slice(Math.max(0, line - 8), line + 5).join('\n'));
    throw error;
}

function makeWorld(mode = 'fail_forward') {
    return {
        id: 'rules_world',
        locations: [{ id: 'market', name: 'Market' }],
        hudConfig: {
            stats: [
                { id: 'hp', name: 'Health', value: 20, min: 0, max: 20, color: 'red' },
                { id: 'gold', name: 'Gold', value: 10, min: 0, max: 100, color: 'yellow' },
                { id: 'skill', name: 'Skill', value: 3, min: -10, max: 10, color: 'blue' }
            ]
        },
        gameRules: {
            vitalStatId: 'hp',
            zeroHpMode: mode,
            currencyStatId: 'gold',
            currencyName: 'gold'
        }
    };
}

function makeSession() {
    return {
        id: 'rules_session',
        turnCount: 3,
        playerLocation: 'market',
        playerStats: { hp: 20, gold: 10, skill: 3 },
        playerState: { status: 'active', conditions: [] },
        inventory: ['Rope'],
        economy: {
            currency: 'gold',
            markets: {
                market: {
                    potion: { item: 'Healing Potion', quantity: 2, price: 4, regenPerTurn: 0, maxQuantity: 5 }
                }
            }
        },
        checkHistory: [],
        engineEvents: [],
        ledger: ''
    };
}

// Saving reads the visible editor values directly, so missed input events cannot
// silently reset stats or break their health/currency mappings.
{
    const world = makeWorld();
    world.hudConfig.stats = world.hudConfig.stats.slice(0, 2);
    world.hudConfig.stats[0].id = 'generated_health';
    world.hudConfig.stats[1].id = 'generated_money';
    world.gameRules.vitalStatId = 'generated_health';
    world.gameRules.currencyStatId = 'generated_money';
    const makeCard = values => ({
        querySelector(selector) {
            const key = {
                '.stat-id': 'id',
                '.stat-name': 'name',
                '.stat-val': 'value',
                '.stat-min': 'min',
                '.stat-max': 'max',
                '.stat-color': 'color'
            }[selector];
            return { value: values[key] };
        }
    });
    context.__cards = [
        makeCard({ id: 'hp', name: 'Health', value: '20', min: '0', max: '20', color: 'red' }),
        makeCard({ id: 'gold', name: 'Gold', value: '10', min: '0', max: '0', color: 'yellow' })
    ];
    context.__controls = {
        'w-rules-profile': { value: 'custom' },
        'w-rules-vital-stat': { value: 'generated_health' },
        'w-rules-currency-stat': { value: 'generated_money' },
        'w-rules-zero-hp-mode': { value: 'lethal' },
        'w-rules-currency-name': { value: 'gold' }
    };
    context.__moduleInputs = [
        'stats', 'health', 'conditions', 'checks', 'inventory',
        'commerce', 'quests', 'relationships', 'schedules', 'livingWorld'
    ].map(key => ({ dataset: { ruleModule: key }, checked: key !== 'schedules' }));
    const renames = context.syncWorldStudioStatsFromDOM(world);
    context.saveWorldGameRuleControls(world, renames);
    assert.equal(world.hudConfig.stats[0].id, 'hp');
    assert.equal(world.hudConfig.stats[0].value, 20);
    assert.equal(world.hudConfig.stats[0].max, 20);
    assert.equal(world.gameRules.vitalStatId, 'hp');
    assert.equal(world.gameRules.currencyStatId, 'gold');
    assert.equal(world.gameRules.zeroHpMode, 'lethal');
}

// Genre profiles are mechanical switches, not destructive templates.
{
    const legacy = makeWorld();
    delete legacy.gameRules.profileId;
    delete legacy.gameRules.modules;
    legacy.hudConfig.enableSchedules = false;
    const migrated = context.normalizeWorldGameRules(legacy);
    assert.equal(migrated.profileId, 'custom');
    assert.equal(migrated.modules.health, true);
    assert.equal(migrated.modules.quests, true);
    assert.equal(migrated.modules.schedules, false);

    const world = makeWorld();
    const originalStats = JSON.stringify(world.hudConfig.stats);
    const pure = context.applyWorldRuleProfile(world, 'pure_narrative');
    assert(Object.values(pure.modules).every(enabled => enabled === false));
    assert.equal(JSON.stringify(world.hudConfig.stats), originalStats, 'profiles must preserve dormant stat configuration');
    const session = makeSession();
    session.playerStats.hp = 0;
    session.playerState.status = 'dead';
    context.normalizePlayerRulesState(world, session);
    assert.equal(session.playerState.status, 'active', 'disabling health must remove game-over enforcement');
    assert.equal(context.applyPlayerStatChanges(world, session, { hp: 5 }).rejected[0].reason, 'module_disabled');
    assert.equal(context.executeCommerceTransactions(world, session, [{ type: 'buy', item: 'potion' }])[0].reason, 'module_disabled');
    assert.equal(context.performAuthoritativeChecks(world, session, [{ label: 'Notice', difficulty: 10 }])[0].reason, 'module_disabled');
    assert.equal(context.applyPlayerConditionUpdates(world, session, [{ condition: 'Tired', action: 'add' }])[0].reason, 'module_disabled');

    const slice = context.applyWorldRuleProfile(world, 'slice_of_life');
    assert.equal(slice.modules.health, false);
    assert.equal(slice.modules.checks, false);
    assert.equal(slice.modules.commerce, true);
    assert.equal(slice.modules.relationships, true);
    assert.equal(slice.modules.schedules, true);
    assert.equal(world.hudConfig.showQuests, false);
    assert.equal(world.hudConfig.showInventory, true);

    world.gameRules.profileId = 'custom';
    world.gameRules.modules = { ...slice.modules, stats: false, commerce: true };
    assert.equal(context.normalizeWorldGameRules(world).modules.commerce, false, 'commerce depends on stats and inventory');
}

// Rules infer legacy HP/gold definitions and normalize stat bounds.
{
    const legacy = makeWorld();
    legacy.gameRules = {};
    legacy.hudConfig.stats[0].value = 999;
    const rules = context.normalizeWorldGameRules(legacy);
    assert.equal(rules.vitalStatId, 'hp');
    assert.equal(rules.currencyStatId, 'gold');
    assert.equal(legacy.hudConfig.stats[0].value, 20);
}

// Fail-forward defeat is persistent, bounded, idempotent, and recoverable.
{
    const world = makeWorld();
    const session = makeSession();
    const defeated = context.applyPlayerStatChanges(world, session, { hp: -999 }, { cause: 'Crushed by the gate.' });
    assert.equal(session.playerStats.hp, 0);
    assert.equal(session.playerState.status, 'incapacitated');
    assert.equal(session.playerState.defeatCount, 1);
    assert.equal(defeated.defeat.mode, 'fail_forward');
    assert(session.playerState.conditions.includes('Incapacitated'));
    assert(session.engineEvents.some(event => event.includes('serious fail-forward consequence')));
    const protectedCondition = context.applyPlayerConditionUpdates(world, session, [
        { condition: 'Incapacitated', action: 'remove' }
    ])[0];
    assert.equal(protectedCondition.reason, 'health_still_zero');

    context.applyPlayerStatChanges(world, session, { hp: -5 });
    assert.equal(session.playerState.defeatCount, 1, 'damage at zero must not create duplicate defeats');

    const recovered = context.applyPlayerStatChanges(world, session, { hp: 6 });
    assert.equal(session.playerStats.hp, 6);
    assert.equal(session.playerState.status, 'active');
    assert.equal(recovered.recovered, true);
    context.applyPlayerConditionUpdates(world, session, [{ condition: 'Bruised', action: 'add' }]);
    assert(session.playerState.conditions.includes('Bruised'));
    context.applyPlayerConditionUpdates(world, session, [{ condition: 'Bruised', action: 'remove' }]);
    assert(!session.playerState.conditions.includes('Bruised'));
}

// Lethal mode creates a real game-over state; only a manual correction revives it.
{
    const world = makeWorld('lethal');
    const session = makeSession();
    const fatal = context.applyPlayerStatChanges(world, session, { hp: -20 }, { cause: 'Fatal wound.' });
    assert.equal(fatal.defeat.mode, 'game_over');
    assert.equal(session.playerState.status, 'dead');
    const rejectedHeal = context.applyPlayerStatChanges(world, session, { hp: 10 });
    assert.equal(rejectedHeal.success, false);
    assert.equal(rejectedHeal.rejected[0].reason, 'timeline_ended');
    assert.equal(session.playerStats.hp, 0);
    context.applyPlayerStatChanges(world, session, { hp: 10 }, { allowDeadRecovery: true });
    assert.equal(session.playerState.status, 'active');
    assert.equal(session.playerStats.hp, 10);
}

// A malformed stat batch is atomic and cannot partly mutate valid stats.
{
    const world = makeWorld();
    const session = makeSession();
    const invalid = context.applyPlayerStatChanges(world, session, { gold: -4, missing: 10 });
    assert.equal(invalid.success, false);
    assert.equal(session.playerStats.gold, 10);
}

// Buying and selling validate money, stock, ownership, and update all sides atomically.
{
    const world = makeWorld();
    const session = makeSession();
    const bought = context.executeCommerceTransactions(world, session, [
        { type: 'buy', item: 'potion', quantity: 2 }
    ])[0];
    assert.equal(bought.success, true);
    assert.equal(session.playerStats.gold, 2);
    assert.equal(session.economy.markets.market.potion.quantity, 0);
    assert.equal(session.inventory.filter(item => item === 'Healing Potion').length, 2);

    const noStock = context.executeCommerceTransactions(world, session, [
        { type: 'buy', item: 'Healing Potion' }
    ])[0];
    assert.equal(noStock.reason, 'insufficient_stock');
    assert.equal(session.playerStats.gold, 2);

    const sold = context.executeCommerceTransactions(world, session, [
        { type: 'sell', item: 'Healing Potion' }
    ])[0];
    assert.equal(sold.success, true);
    assert.equal(session.playerStats.gold, 6);
    assert.equal(session.economy.markets.market.potion.quantity, 1);
    assert.equal(session.inventory.filter(item => item === 'Healing Potion').length, 1);

    session.economy.markets.market.potion.quantity = 1;
    session.playerStats.gold = 3;
    const cannotAfford = context.executeCommerceTransactions(world, session, [
        { type: 'buy', item: 'Healing Potion' }
    ])[0];
    assert.equal(cannotAfford.reason, 'cannot_afford');
    assert.equal(session.playerStats.gold, 3);
    assert.equal(session.economy.markets.market.potion.quantity, 1);
}

// Checks are stable across rerolls and apply declared failure costs exactly once per execution.
{
    const world = makeWorld();
    const sessionA = makeSession();
    const sessionB = JSON.parse(JSON.stringify(sessionA));
    let checkId = '';
    for (let index = 0; index < 100; index++) {
        const candidate = `hard_check_${index}`;
        const roll = 1 + Math.floor(context.stableWorldRoll(`${world.id}|${sessionA.id}|${sessionA.turnCount}|${candidate}`) * 20);
        if (roll !== 20) {
            checkId = candidate;
            break;
        }
    }
    const request = [{
        id: checkId,
        label: 'Hold the collapsing door',
        stat_id: 'skill',
        difficulty: 30,
        failure_cost: {
            stat_changes: { hp: -5 },
            inventory_remove: ['Rope'],
            time_skip_minutes: 15,
            condition: 'Bruised',
            cause: 'The door collapsed.'
        }
    }];
    const first = context.performAuthoritativeChecks(world, sessionA, request)[0];
    const replay = context.performAuthoritativeChecks(world, sessionB, request)[0];
    assert.equal(first.roll, replay.roll);
    assert.equal(first.total, replay.total);
    assert.equal(first.success, false);
    assert.equal(first.statModifier, 1, 'a −10…10 skill is normalized instead of receiving its raw value');
    assert.equal(sessionA.playerStats.hp, 15);
    assert(!sessionA.inventory.includes('Rope'));
    assert.equal(sessionA.bonusTimeMinutes, 15);
    assert(sessionA.playerState.conditions.includes('Bruised'));
    const replaySameTurn = context.performAuthoritativeChecks(world, sessionA, request)[0];
    assert.equal(replaySameTurn.replayed, true);
    assert.equal(replaySameTurn.roll, first.roll);
    assert.equal(sessionA.playerStats.hp, 15, 'replaying a check must not repeat its stat cost');
    assert.equal(sessionA.bonusTimeMinutes, 15, 'replaying a check must not repeat its time cost');
    assert.equal(sessionA.checkHistory.length, 1, 'one check ID may resolve only once per turn');
}

console.log('✓ bounded stats, fail-forward incapacitation, recovery, and lethal game over');
console.log('✓ atomic purchases and sales enforce currency, stock, ownership, and affordability');
console.log('✓ deterministic checks preserve rolls and apply declared failure costs');

// Model-authored check JSON is not a die source, even in engine-roll mode.
{
    const world = makeWorld();
    const session = makeSession();
    const expected = 1 + Math.floor(context.stableWorldRoll(
        `${world.id}|${session.id}|${session.turnCount}|check_${session.turnCount}_1`)
        * context.normalizeWorldDiceConfig(world).sides);
    const result = context.performAuthoritativeChecks(world, session, [{
        label: 'Force the portcullis', difficulty: 10,
        provided_roll: expected === 1 ? 20 : 1, force_resolve: true
    }])[0];
    assert.equal(result.roll, expected, 'model-provided roll is ignored in engine mode');
}

// Player-roll mode pauses the fiction, exposes one canonical pending check,
// then accepts exactly the supplied die result instead of rolling again.
{
    const world = makeWorld();
    world.gameRules.dice = { resolution: 'player', sides: 12, modifierMode: 'ability', defaultDifficulty: 7, criticals: true };
    const session = makeSession();
    const pending = context.performAuthoritativeChecks(world, session, [{
        id: 'player_lockpick', label: 'Pick the archive lock', stat_id: 'skill', difficulty: 9
    }])[0];
    assert.equal(pending.pending, true);
    assert.equal(session.checkHistory.length, 0);
    assert.equal(session.pendingCheck.id, 'check_3_1');
    const forged = context.performAuthoritativeChecks(world, session, [{
        id: session.pendingCheck.id, label: 'Pick the archive lock', stat_id: 'skill', difficulty: 9,
        provided_roll: 12, force_resolve: true
    }])[0];
    assert.equal(forged.pending, true, 'model-supplied rolls and force_resolve cannot settle a player check');
    assert.equal(session.checkHistory.length, 0);
    const resolved = context.performAuthoritativeChecks(world, session, [{
        id: session.pendingCheck.id, label: 'Pick the archive lock', stat_id: 'skill', difficulty: 9,
        provided_roll: 8, force_resolve: true
    }], { allowProvidedRoll: true })[0];
    assert.equal(resolved.sides, 12);
    assert.equal(resolved.roll, 8);
    assert.equal(resolved.statModifier, -4);
    assert.equal(resolved.total, 4);
    assert.equal(resolved.success, false);
    assert.equal(session.pendingCheck, null);
    assert.equal(session.checkHistory.length, 1);
}

console.log('✓ player-requested d6/d10/d12/d20 checks pause and consume the supplied roll');
