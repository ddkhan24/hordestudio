/** Explicit timeline preparation and pure session lookup regressions. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app, buildContext } = require('./app_source.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }

function contextFor(state) {
    return buildContext(vm, ['getCurrentWorldSession', 'prepareCurrentWorldSession'], {
        state,
        isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
        normalizeLivingWorldState: () => {},
        normalizePlayerRulesState: () => {},
        normalizeQuestState: () => {}
    });
}

test('session lookup is read-only even for an unprepared legacy instance', () => {
    const state = {
        activeWorldId: 'w', worlds: [{ id: 'w' }],
        worldInstances: { w: { history: [{ role: 'user', text: 'Hello' }], playerLocation: 'Start' } }
    };
    const before = copy(state);
    const context = contextFor(state);
    assert.equal(context.getCurrentWorldSession(), null);
    assert.deepEqual(state, before);
});

test('preparation recovers a stale selected timeline without replacing saved timelines', () => {
    const original = {
        id: 'timeline_a', playerLocation: 'Start', history: [{ role: 'user', text: 'Kept' }],
        entityStates: { offstage: { location: '', offstage: true, observations: [] } }
    };
    const other = { id: 'timeline_b', playerLocation: 'start', history: [], entityStates: {} };
    const state = {
        activeWorldId: 'w',
        worlds: [{ id: 'w', startLocationId: 'start', hudConfig: { stats: [] },
            locations: [
                { id: 'start', name: 'Start', exits: [] },
                { id: 'other_room', name: 'Other Room', sessionOrigin: 'timeline_b', exits: [] }
            ],
            entities: [
                { id: 'offstage', type: 'npc', name: 'Distant friend', startLocation: '', sessionOrigin: 'timeline_a' },
                { id: 'other_npc', type: 'npc', name: 'Other timeline person', startLocation: 'other_room', sessionOrigin: 'timeline_b' }
            ] }],
        worldInstances: { w: { sessions: [original, other], activeSessionId: 'deleted_timeline' } }
    };
    const context = contextFor(state);
    const prepared = context.prepareCurrentWorldSession();
    assert.equal(prepared, original);
    assert.equal(state.worldInstances.w.sessions.length, 2);
    assert.equal(state.worldInstances.w.activeSessionId, 'timeline_a');
    assert.equal(original.playerLocation, 'start');
    assert.equal(original.entityStates.offstage.location, '', 'a contact without a location remains offstage');
    assert.equal(original.entityStates.other_npc, undefined, 'foreign NPC state is not invented in this timeline');
    const after = copy(state);
    assert.equal(context.getCurrentWorldSession(), original);
    assert.deepEqual(copy(state), after, 'subsequent lookups do not run another healing pass');
});

test('legacy flat-world data migrates only at explicit preparation', () => {
    const state = {
        activeWorldId: 'w', worlds: [{ id: 'w', startLocationId: 'start', hudConfig: { stats: [] },
            locations: [{ id: 'start', name: 'Start', exits: [] }], entities: [] }],
        worldInstances: { w: { history: [{ role: 'user', text: 'Saved' }], playerLocation: 'Start' } }
    };
    const context = contextFor(state);
    assert.equal(context.getCurrentWorldSession(), null);
    const session = context.prepareCurrentWorldSession();
    assert.equal(session.history[0].text, 'Saved');
    assert.equal(session.playerLocation, 'start');
    assert.equal(state.worldInstances.w.sessions.length, 1);
});

test('chosen starting life keeps its own opening location', () => {
    const session = { id: 'chosen', originId: 'life_elsewhere', playerLocation: 'home', history: [], entityStates: {} };
    const state = {
        activeWorldId: 'w', worlds: [{ id: 'w', startLocationId: 'start', hudConfig: { stats: [] },
            locations: [{ id: 'start', name: 'Start', exits: [] }, { id: 'home', name: 'Home', exits: [] }], entities: [] }],
        worldInstances: { w: { sessions: [session], activeSessionId: 'chosen' } }
    };
    const context = contextFor(state);
    context.prepareCurrentWorldSession();
    assert.equal(session.playerLocation, 'home');
    assert.doesNotMatch(app.slice(app.indexOf('function renderWorldPlayState()'), app.indexOf('// 1. Core Header', app.indexOf('function renderWorldPlayState()'))),
        /sess\.playerLocation\s*=/, 'rendering cannot reset an authored opening location');
});

test('entry and timeline switches explicitly prepare before rendering', () => {
    assert.match(app, /function enterWorld\(worldId\)[\s\S]*?const sess = prepareCurrentWorldSession\(\)/);
    assert.match(app, /document\.getElementById\('world-session-select'\)\.onchange[\s\S]*?activeSessionId = e\.target\.value;\s*prepareCurrentWorldSession\(\)/);
});

let passed = 0;
for (const { name, fn } of tests) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (error) { console.error(`✗ ${name}`); throw error; }
}
console.log(`\n${passed}/${tests.length} world session boundary checks passed.`);
