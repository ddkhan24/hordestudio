const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const appPath = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');
const helperStart = source.indexOf('function isValidScheduleTime');
const helperEnd = source.indexOf('function validateWorldReferences', helperStart);
const actionsStart = source.indexOf('function processStructuredActions(args)');
const actionsEnd = source.indexOf('// (removed: processAIActions', actionsStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'Living-world helper block not found');
assert(actionsStart >= 0 && actionsEnd > actionsStart, 'Structured-action block not found');

const context = {
    console: { log() {}, warn() {}, error: console.error },
    Math,
    Date,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    RegExp,
    JSON,
    parseInt,
    structuredClone,
    isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    },
    __ruleModules: {
        stats: true, health: true, conditions: true, checks: true,
        inventory: true, commerce: true, quests: true, relationships: true,
        schedules: true, livingWorld: true
    },
    showToast() {},
    saveState: async () => {},
    document: { getElementById: () => null },
    getLocationRef(world, ref) {
        if (!ref) return null;
        const query = String(ref).trim().toLowerCase();
        return world.locations.find(location => location.id === ref || String(location.name).toLowerCase() === query) || null;
    },
    findFuzzyLocation(ref, locations) {
        if (!ref) return null;
        const query = String(ref).trim().toLowerCase();
        return locations.find(location => location.id === ref || String(location.name).toLowerCase() === query)
            || locations.find(location => String(location.name).toLowerCase().includes(query))
            || null;
    },
    sessionNpcs(world, sess) {
        return world.entities.filter(entity => entity.type === 'npc' && (!entity.sessionOrigin || entity.sessionOrigin === sess.id));
    },
    isVisibleToSession(entity, sess) {
        return !entity.sessionOrigin || entity.sessionOrigin === sess.id;
    },
    isNpcActive(entState) {
        return !entState || (entState.status !== 'dead' && entState.status !== 'gone');
    },
    isNpcPinned(sess, entState) {
        return !!(entState?.pinnedUntilTurn && (sess.turnCount || 1) < entState.pinnedUntilTurn);
    },
    resolveNpcId(world, ref, sess) {
        if (!ref) return null;
        const query = String(ref).trim().toLowerCase();
        const entity = world.entities.find(item =>
            item.type === 'npc'
            && (!item.sessionOrigin || item.sessionOrigin === sess.id)
            && (item.id.toLowerCase() === query || item.name.toLowerCase() === query));
        return entity?.id || null;
    },
    getWorldTimeData(world, sess) {
        const timeStep = world.hudConfig?.timeStep ?? 5;
        const startMinutes = (world.hudConfig?.startTimeHours ?? 8) * 60;
        const currentTotalMinutes = startMinutes + ((sess.turnCount || 1) - 1) * timeStep + (sess.bonusTimeMinutes || 0);
        const totalMinutesToday = currentTotalMinutes % 1440;
        return {
            days: Math.floor(currentTotalMinutes / 1440) + 1,
            hours24: Math.floor(totalMinutesToday / 60),
            mins: totalMinutesToday % 60,
            totalMinutesToday,
            currentTotalMinutes,
            timeStep,
            startMinutes
        };
    },
    isScheduleBlockForWorldDay(world, block, dayNumber) {
        const raw = block?.days ?? block?.day;
        if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return true;
        const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
        const weekday = days[(Math.max(1, Number(dayNumber) || 1) - 1) % 7];
        const index = days.indexOf(weekday) + 1;
        const wanted = new Set((Array.isArray(raw) ? raw : String(raw).split(',')).map(value => String(value).toLowerCase()));
        return wanted.has(weekday) || wanted.has(weekday.slice(0, 3)) || wanted.has(String(index))
            || (wanted.has('weekday') && index <= 5) || (wanted.has('weekend') && index >= 6)
            || wanted.has('daily') || wanted.has('everyday');
    },
    queueEngineEvent(sess, text) {
        sess.engineEvents = sess.engineEvents || [];
        if (!sess.engineEvents.includes(text)) sess.engineEvents.push(text);
    },
    applyTravelTime() { return 0; },
    appendWorldLedgerEntry() { return null; },
    buildStructuredLedgerFallback() { return ''; },
    normalizeWorldGameRules() {
        return { modules: context.__ruleModules };
    },
    normalizePlayerRulesState() { return { status: 'active', conditions: [] }; },
    executeCommerceTransactions() { return []; },
    performAuthoritativeChecks() { return []; },
    applyPlayerStatChanges() { return { success: true, applied: [], rejected: [] }; },
    safeJsonClone(value) { return JSON.parse(JSON.stringify(value)); },
    applyQuestUpdates(world, sess, updates) {
        sess.questEvaluationPasses = (sess.questEvaluationPasses || 0) + 1;
        return { changed: false, completed: [], failed: [], rewardsGranted: [], updateCount: Array.isArray(updates) ? updates.length : 0 };
    },
    renderWorldLocations() {}
};
vm.createContext(context);
Object.assign(context, { livingClamp: require('../virtual_humans/engine/vh-simulation-core').livingClamp, livingId: require('../virtual_humans/engine/vh-simulation-core').livingId });
vm.runInContext(source.slice(helperStart, helperEnd), context, { filename: 'living-world-helpers.js' });
vm.runInContext(source.slice(actionsStart, actionsEnd), context, { filename: 'living-world-actions.js' });
// Load the actual navigation dependencies instead of assuming schedules teleport.
require('./app_source.js').buildContext(vm, ['worldForSession', 'findWorldTravelPath', 'getWorldPathTravelTime'], context);

function makeWorld(locationCount = 3, npcCount = 3) {
    const locations = Array.from({ length: locationCount }, (_, index) => ({
        id: `loc_${index}`,
        name: `Location ${index}`,
        description: `Location ${index}`,
        exits: []
    }));
    const entities = Array.from({ length: npcCount }, (_, index) => ({
        id: `npc_${index}`,
        type: 'npc',
        name: `NPC ${index}`,
        startLocation: locations[index % locations.length].id,
        schedule: []
    }));
    return {
        id: 'stress_world',
        name: 'Stress World',
        locations,
        entities,
        hudConfig: { timeStep: 5, startTimeHours: 8, enableSchedules: false }
    };
}

function makeSession(world) {
    return {
        id: 'stress_session',
        name: 'Stress Session',
        playerLocation: world.locations[0].id,
        entityStates: Object.fromEntries(world.entities.map((npc, index) => [npc.id, {
            location: world.locations[(index + 1) % world.locations.length].id,
            observations: []
        }])),
        inventory: [],
        playerStats: {},
        history: [],
        turnCount: 1,
        bonusTimeMinutes: 0
    };
}

function json(value) {
    return JSON.parse(JSON.stringify(value));
}

// Legacy migration and normalization.
{
    const world = makeWorld();
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    assert.deepEqual(Array.from(sess.scheduledEvents), []);
    assert.equal(sess.economy.currency, 'coin');
    assert.equal(sess.playstyle.summary, 'No clear playstyle pattern yet.');
    assert.deepEqual(Object.keys(sess.npcScheduleOverrides), []);
    assert.equal(sess.locationStates.loc_0.prosperity, 50, 'the current location must bootstrap persistent local state');
    assert.equal(sess.locationStates.loc_0.danger, 0);
    assert.equal(sess.livingWorldActivity.turn, 0);
    context.addWorldNews(sess, 'A hidden agenda advanced.', { playerVisible: false, type: 'npc_goal' });
    assert.equal(sess.worldNews[0].playerVisible, false);
}

// Authored agendas bootstrap once into timeline state.
{
    const world = makeWorld();
    world.entities[0].goal = 'protect the river crossing';
    world.entities[0].goalAutonomy = 'high';
    world.entities[0].goalSteps = ['watch the ford', 'repair the warning bell'];
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    assert.equal(sess.entityStates.npc_0.goal, 'protect the river crossing');
    assert.equal(sess.entityStates.npc_0.goalAutonomy, 'high');
    assert.equal(sess.entityStates.npc_0.goalSteps.length, 2);
}

// Determinism, idempotence, events, expiry, economy, goals, and dead-NPC safety.
{
    const world = makeWorld();
    const sess = makeSession(world);
    Object.assign(sess.entityStates.npc_0, {
        goal: 'secure the archive',
        goalProgress: 0,
        goalDifficulty: 0,
        goalAutonomy: 'high',
        goalStatus: 'active',
        goalSteps: ['find a key', 'enter the vault']
    });
    Object.assign(sess.entityStates.npc_1, {
        status: 'dead',
        goal: 'haunt the market',
        goalProgress: 0,
        goalDifficulty: 0,
        goalAutonomy: 'high',
        goalStatus: 'active',
        goalSteps: []
    });
    sess.scheduledEvents = [
        {
            id: 'one_shot',
            title: 'The bridge falls',
            description: 'The old bridge collapses.',
            status: 'scheduled',
            dueTurn: 1,
            locationId: 'loc_0',
            conditionOnTrigger: 'Bridge destroyed',
            conditionDurationTurns: 2
        },
        {
            id: 'patrol',
            title: 'Patrol changes',
            description: 'A patrol rotates.',
            status: 'scheduled',
            dueTurn: 1,
            repeatEveryTurns: 2
        }
    ];
    sess.economy = {
        currency: 'coin',
        markets: {
            loc_0: {
                bread: { item: 'Bread', quantity: 1, price: 2, regenPerTurn: 2, maxQuantity: 5 }
            }
        }
    };
    context.normalizeLivingWorldState(world, sess);
    const before = json(sess);
    const cloneA = json(before);
    const cloneB = json(before);
    context.runLivingWorldTick(world, cloneA);
    context.runLivingWorldTick(world, cloneB);
    assert.deepEqual(cloneA, cloneB, 'Same snapshot and turn must produce identical simulation state');
    const afterFirstTick = json(cloneA);
    const duplicateResult = context.runLivingWorldTick(world, cloneA);
    assert.equal(duplicateResult.advanced, false);
    assert.equal(JSON.stringify(cloneA), JSON.stringify(afterFirstTick), 'A second tick on the same turn must be a no-op');
    assert.equal(cloneA.scheduledEvents.find(event => event.id === 'one_shot').status, 'triggered');
    assert.equal(cloneA.scheduledEvents.find(event => event.id === 'patrol').dueTurn, 3);
    assert.equal(cloneA.locationStates.loc_0.conditions[0].label, 'Bridge destroyed');
    assert.equal(cloneA.entityStates.npc_1.goalProgress, 0, 'Dead NPC goals must never advance');
    assert.equal(cloneA.economy.markets.loc_0.bread.quantity, 3);

    cloneA.turnCount = 2;
    context.runLivingWorldTick(world, cloneA);
    assert.equal(cloneA.economy.markets.loc_0.bread.quantity, 5);
    cloneA.turnCount = 3;
    context.runLivingWorldTick(world, cloneA);
    assert.equal(cloneA.locationStates.loc_0.conditions.length, 0, 'Expired conditions must be removed');
    assert.equal(cloneA.scheduledEvents.find(event => event.id === 'patrol').dueTurn, 5);
}

// Playstyle learning is a soft, cumulative signal.
{
    const world = makeWorld();
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    context.updatePlaystyleProfile(sess, 'I quietly sneak in and inspect the evidence.');
    context.updatePlaystyleProfile(sess, 'I investigate the clue and ask the guard questions.');
    assert.equal(sess.playstyle.turnsObserved, 2);
    assert(sess.playstyle.dominant.includes('investigation'));
    assert(sess.playstyle.signals.stealth >= 1);
}

// Disabled simulation modules preserve dormant data and reject hidden mutations.
{
    const enabled = context.__ruleModules;
    context.__ruleModules = {
        ...enabled,
        schedules: false,
        relationships: false,
        livingWorld: false
    };
    const world = makeWorld();
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    sess.scheduledEvents = [{
        id: 'dormant',
        title: 'Dormant event',
        description: 'Must not fire.',
        status: 'scheduled',
        dueTurn: 1
    }];
    const tick = context.runLivingWorldTick(world, sess);
    assert.equal(tick.disabled, true);
    assert.equal(sess.scheduledEvents[0].status, 'scheduled');
    assert.equal(sess.lastLivingWorldTick, 0);

    context.state = { activeWorldId: world.id, worlds: [world], worldInstances: {}, editingWorld: null };
    context.getCurrentWorldSession = () => sess;
    const action = context.processStructuredActions({
        world_events: [{ id: 'blocked_event', title: 'Blocked' }],
        schedule_updates: [{ npc_id: 'npc_0', blocks: [{ time: '08:00', location_id: 'loc_1' }] }],
        npc_relationship_updates: [{ source_npc_id: 'npc_0', target_npc_id: 'npc_1', change: 10 }]
    });
    assert.equal(action.moduleRejections.length, 3);
    assert(!sess.scheduledEvents.some(event => event.id === 'blocked_event'));
    assert.equal(Object.keys(sess.npcScheduleOverrides).length, 0);
    assert.equal(Object.keys(sess.npcRelationships).length, 0);
    context.__ruleModules = enabled;
}

// GM tool pipeline: all new state types work together in one atomic update.
{
    const world = makeWorld();
    const sess = makeSession(world);
    context.state = {
        activeWorldId: world.id,
        worlds: [world],
        worldInstances: { [world.id]: {} },
        editingWorld: null
    };
    context.getCurrentWorldSession = () => sess;
    context.processStructuredActions({
        faction_updates: [
            {
                id: 'guild',
                name: 'Lantern Guild',
                goal: 'control the crossings',
                territory_add: ['loc_0'],
                relations: [{ faction_id: 'watch', change: -20 }]
            },
            { id: 'watch', name: 'River Watch' }
        ],
        location_state_updates: [{
            location_id: 'loc_0',
            add_conditions: ['Under curfew'],
            condition_duration_turns: 4,
            control_faction_id: 'guild',
            danger_change: 15,
            prosperity_change: -5,
            resource_changes: { timber: 20 }
        }],
        npc_relationship_updates: [{
            source_npc_id: 'npc_0',
            target_npc_id: 'npc_1',
            change: -25,
            label: 'rivals',
            reason: 'They competed for the same post.'
        }],
        schedule_updates: [{
            npc_id: 'npc_0',
            replace: true,
            reason: 'The curfew changed the routine.',
            blocks: [
                { time: '07:00', location_id: 'loc_1', activity: 'opens the shop' },
                { time: '21:00', location_id: 'loc_2', activity: 'returns home' },
                { time: '99:00', location_id: 'loc_0', activity: 'invalid' }
            ]
        }],
        world_events: [{
            id: 'curfew_end',
            title: 'Curfew review',
            description: 'The council reviews the curfew.',
            due_in_turns: 3,
            location_id: 'loc_0',
            faction_id: 'guild'
        }, {
            id: 'clock_event',
            title: 'Noon bell',
            description: 'The bell rings after an hour.',
            due_in_minutes: 60
        }],
        economy_updates: [{
            location_id: 'loc_0',
            item: 'Lamp oil',
            set_quantity: 8,
            price: 4,
            regen_per_turn: 1,
            max_quantity: 12
        }],
        player_preference_updates: [{
            key: 'mystery_density',
            value: 'high',
            confidence: 0.9,
            source: 'player explicitly asked for mysteries'
        }],
        npc_goal_updates: [{
            npc_id: 'npc_0',
            goal: 'learn who imposed the curfew',
            motivation: 'The shop is suffering.',
            steps: ['question customers', 'find the decree'],
            difficulty: 40,
            autonomy: 'high',
            deadline_in_turns: 8
        }]
    });
    assert.equal(sess.questEvaluationPasses, 1, 'Structured actions must finish with one quest evaluation pass');
    assert.equal(sess.factions.length, 2);
    assert.equal(sess.locationStates.loc_0.controlFactionId, 'guild');
    assert.equal(sess.locationStates.loc_0.danger, 15);
    assert.equal(sess.factions.find(faction => faction.id === 'guild').relations[0].factionId, 'watch');
    assert.equal(sess.npcScheduleOverrides.npc_0.length, 2, 'Invalid schedule blocks must be rejected');
    assert.equal(sess.scheduledEvents.find(event => event.id === 'curfew_end').dueTurn, 4);
    assert.equal(sess.scheduledEvents.find(event => event.id === 'clock_event').dueTurn, null);
    assert.equal(sess.scheduledEvents.find(event => event.id === 'clock_event').dueMinute, 540);
    assert.equal(sess.economy.markets.loc_0.lamp_oil.quantity, 8);
    assert.equal(sess.playstyle.preferences.mystery_density.value, 'high');
    assert.equal(sess.entityStates.npc_0.goalAutonomy, 'high');
    assert.equal(sess.entityStates.npc_0.goalDeadlineTurn, 9);
    assert.equal(sess.npcRelationships['npc_0|npc_1'].score, -25);

    // A story-created timeline override is honored even if authored schedules are disabled.
    world.locations[2].exits.push('to Location 1');
    sess.entityStates.npc_0.location = 'loc_2';
    const scheduleResult = context.syncNPCSchedules(world, sess);
    assert.equal(sess.entityStates.npc_0.location, 'loc_1');
    assert.equal(scheduleResult.moves, 1);
    assert.equal(scheduleResult.active, 1);
    assert.equal(sess.livingWorldActivity.activeSchedules, 1);

    context.processStructuredActions({
        schedule_updates: [{
            npc_id: 'npc_0', replace: true,
            blocks: [
                { time: '08:00', location_id: 'loc_1', activity: 'weekday shift', days: ['weekday'] },
                { time: '08:00', location_id: 'loc_2', activity: 'weekend breakfast', days: ['weekend'] }
            ]
        }]
    });
    assert.equal(sess.npcScheduleOverrides.npc_0.length, 2,
        'same-time routines on different days must not overwrite one another');
}

// Exact documented world limits: 2,000 locations, 5,000 NPCs, 500 events.
{
    const world = makeWorld(2000, 5000);
    const sess = makeSession(world);
    for (let index = 0; index < world.entities.length; index++) {
        Object.assign(sess.entityStates[`npc_${index}`], {
            goal: `complete task ${index}`,
            goalProgress: index % 80,
            goalDifficulty: index % 101,
            goalAutonomy: ['low', 'medium', 'high'][index % 3],
            goalStatus: 'active',
            goalSteps: ['prepare', 'act', 'finish']
        });
    }
    sess.scheduledEvents = Array.from({ length: 500 }, (_, index) => ({
        id: `event_${index}`,
        title: `Event ${index}`,
        description: `Development ${index}`,
        status: 'scheduled',
        dueTurn: 2 + (index % 60),
        locationId: `loc_${index % 2000}`
    }));
    sess.factions = Array.from({ length: 200 }, (_, index) => ({
        id: `faction_${index}`,
        name: `Faction ${index}`,
        influence: index % 101,
        reputation: (index % 201) - 100,
        resources: 1000,
        goal: `Objective ${index}`,
        goalProgress: index % 90,
        territory: [`loc_${index}`]
    }));
    sess.economy = { currency: 'coin', markets: {} };
    for (let index = 0; index < 500; index++) {
        sess.economy.markets[`loc_${index}`] = {
            grain: { item: 'Grain', quantity: 10, price: 2, regenPerTurn: 1, maxQuantity: 100 }
        };
    }
    const start = performance.now();
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 120; turn++) {
        sess.turnCount = turn;
        context.runLivingWorldTick(world, sess);
    }
    const elapsedMs = performance.now() - start;
    assert.equal(sess.lastLivingWorldTick, 120);
    assert.equal(sess.scheduledEvents.length, 500);
    assert.equal(sess.factions.length, 200);
    assert(elapsedMs < 15000, `Exact-limit simulation took too long: ${elapsedMs.toFixed(0)}ms`);
    console.log(`PASS exact-limit stress: 2,000 locations, 5,000 NPCs, 500 events, 200 factions, 120 turns in ${elapsedMs.toFixed(0)}ms`);
}

console.log('PASS living-world regression suite');
