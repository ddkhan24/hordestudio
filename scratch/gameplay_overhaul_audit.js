/** Regression checks for the August 2026 gameplay-kernel overhaul. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

function functionSource(name) {
    const start = app.indexOf(`function ${name}(`);
    assert(start >= 0, `Missing function ${name}`);
    const brace = app.indexOf('{', start);
    let depth = 0, quote = null, escaped = false;
    for (let index = brace; index < app.length; index++) {
        const char = app[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
        if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return app.slice(start, index + 1);
    }
    throw new Error(`Unclosed function ${name}`);
}

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log(`✓ ${name}`);
}

test('snapshots contain only timeline-owned dynamic characters and locations', () => {
    const start = app.indexOf('function captureWorldTurnState');
    const end = app.indexOf('function addWorldMessage', start);
    const context = {
        structuredClone, JSON,
        safeJsonClone: value => JSON.parse(JSON.stringify(value)),
        isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
        bumpMemoryEpoch() {}
    };
    vm.runInNewContext(`${app.slice(start, end)}\nthis.captureWorldTurnState = captureWorldTurnState; this.restoreWorldTurnState = restoreWorldTurnState;`, context);
    const world = {
        locations: [{ id: 'authored' }, { id: 'mine-place', sessionOrigin: 's1' }, { id: 'their-place', sessionOrigin: 's2' }],
        entities: [{ id: 'template' }, { id: 'mine', sessionOrigin: 's1' }, { id: 'theirs', sessionOrigin: 's2' }]
    };
    const session = { id: 's1', name: 'One', history: [], inventory: [] };
    const snapshot = context.captureWorldTurnState(world, session);
    assert.equal(snapshot.schema, 5);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.world.dynamicEntities)).map(item => item.id), ['mine']);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.world.dynamicLocations)).map(item => item.id), ['mine-place']);
    assert.equal('locations' in snapshot.world, false, 'shared geography must not be snapshotted wholesale');
    world.locations.push({ id: 'later-authored' });
    world.locations.push({ id: 'later-other-place', sessionOrigin: 's2' });
    world.entities.push({ id: 'later-other', sessionOrigin: 's2' });
    context.restoreWorldTurnState(world, session, snapshot);
    assert(world.locations.some(location => location.id === 'later-authored'));
    assert(world.locations.some(location => location.id === 'later-other-place'));
    assert(world.locations.some(location => location.id === 'mine-place'));
    assert(world.entities.some(entity => entity.id === 'later-other'));
});

test('checks expose conditional outcomes and reject sibling mutations', () => {
    assert(app.includes('on_success: {'));
    assert(app.includes('on_failure: {'));
    assert(app.includes('CHECK_GUARDED_ACTION_FIELDS'));
    assert(app.includes("reason: 'unconditional_update_beside_check'"));
    assert(app.includes("reason: 'completed_event_beside_unresolved_check'"));
    assert(app.includes('maxItems: 1'));
});

test('pending rolls are queued, block later actions and use engine identities', () => {
    assert(app.includes('sess.pendingChecks.push(pendingRequest)'));
    assert(app.includes("Resolve the pending check before taking another action."));
    assert(app.includes('`check_${turn}_${index + 1}`'));
    assert(app.includes('sess.pendingChecks = sess.pendingChecks.filter'));
});

test('resources are not rollable by default and custom stat mechanics are editable', () => {
    const start = app.indexOf('function worldStatRollConfig');
    const end = app.indexOf('function worldRuleProfileDescription', start);
    const context = { isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value) };
    vm.runInNewContext(`${app.slice(start, end)}\nthis.config = worldStatRollConfig;`, context);
    assert.equal(context.config({ id: 'hp', name: 'Health' }).enabled, false);
    assert.equal(context.config({ id: 'cash', name: 'Cash' }).enabled, false);
    assert.equal(context.config({ id: 'agility', name: 'Agility' }).enabled, true);
    assert(html.includes('Per-stat mechanics (recommended)'));
    assert(app.includes('stat-roll-direction'));
    assert(app.includes('stat-roll-scale'));
});

test('hard reset reseeds authored systems and invalidates background work', () => {
    const source = functionSource('resetWorldTimeline');
    assert(source.includes('scheduledEvents: safeJsonClone'));
    assert(source.includes('turnEvents: []'));
    assert(source.includes('worldTurnReceipts: []'));
    assert(source.includes('pendingChecks: []'));
    assert(source.includes('episodicMemories: []'));
    assert(source.includes('setupComplete: false'));
    assert(source.includes('bumpWorldEpoch(sess)'));
});

test('late World Agent responses cannot enter a changed timeline', () => {
    const source = functionSource('runWorldAgent');
    assert(source.includes('const startEpoch'));
    assert(source.includes('timelineStillExists'));
    assert(source.includes('discarded stale World Agent response'));
});

test('lore supports delimiter-free keywords with token boundaries', () => {
    const context = { Set, RegExp, String };
    const start = app.indexOf('function parseLoreKeywords');
    const end = app.indexOf('async function buildContext', start);
    vm.runInNewContext(`${app.slice(start, end)}\nthis.parse = parseLoreKeywords; this.matches = loreKeywordMatches;`, context);
    assert.deepEqual(Array.from(context.parse('succession crown queen prince')), ['succession', 'crown', 'queen', 'prince']);
    assert.equal(context.matches('the queen arrived', 'queen'), true);
    assert.equal(context.matches('a sequence began', 'queen'), false);
});

test('ledger stays bounded while archived canon remains retrievable', () => {
    assert(app.includes('WORLD_LEDGER_HOT_LINES = 100'));
    assert(app.includes('WORLD_LEDGER_HOT_CHARS = 24000'));
    assert(app.includes('retrieveWorldLedgerArchive(sess, archiveQuery)'));
    assert(!app.includes("if (!extractedChronicle && kernelConfig.enabled && command !== 'init'"));
});

test('large-world attention rotates and crowded foreground context is bounded', () => {
    const context = { Math, Number, Array };
    vm.runInNewContext(`${functionSource('rotatingWorldWindow')}\nthis.rotate = rotatingWorldWindow;`, context);
    const items = Array.from({ length: 100 }, (_, index) => index);
    assert.notDeepEqual(Array.from(context.rotate(items, 10, 1)), Array.from(context.rotate(items, 10, 2)));
    assert(app.includes('selectForegroundNpcs(world, sess, allPresentNPCs, userInput, 16)'));
    assert(app.includes('additional background people are present'));
});

test('compact gameplay controls and collapsible HUD exist at constrained widths', () => {
    assert(html.includes('id="world-more-btn"'));
    assert(html.includes('id="world-hud-toggle"'));
    assert(css.includes('.world-more-actions.is-open'));
    assert(css.includes('.world-status-col.is-collapsed'));
});

console.log(`\n${passed} gameplay-overhaul checks passed.`);
