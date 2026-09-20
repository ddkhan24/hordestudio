const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const app = fs.readFileSync('app.js', 'utf8');
let passed = 0;
function test(name, fn) {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
}

test('new Virtual Humans receive collision-resistant IDs instead of name-derived IDs', () => {
    const context = {
        state: { companions: [] },
        globalThis: { crypto: { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } }
    };
    buildContext(vm, ['freshCompanionId'], context);
    assert.equal(context.freshCompanionId(), 'companion_aaaaaaaabbbb4ccc8dddeeeeeeeeeeee');
    context.state.companions.push({ id: 'companion_aaaaaaaabbbb4ccc8dddeeeeeeeeeeee' });
    context.globalThis.crypto.randomUUID = () => `${Math.random()}`.padEnd(36, 'f').slice(0, 36);
    assert.notEqual(context.freshCompanionId(), context.state.companions[0].id);
});

test('creation passes an explicit fresh ID into normalization', () => {
    const start = app.indexOf('function createCompanion()');
    const end = app.indexOf('function deleteCompanion(', start);
    const source = app.slice(start, end);
    assert.match(source, /id:\s*freshCompanionId\(\)/);
    assert.doesNotMatch(source, /normalizeCompanion\(\{\s*name:/);
});

test('legacy duplicate IDs are separated and only the first record retains shared history', () => {
    const start = app.indexOf('async function loadCompanionsState()');
    const end = app.indexOf('function createCompanion()', start);
    const source = app.slice(start, end);
    assert.match(source, /occupiedIds\.has\(sourceId\)/);
    assert.match(source, /companion\.id\s*=\s*freshCompanionId\(occupiedIds\)/);
    assert.match(source, /!duplicate\s*&&\s*isPlainObject\(rawTimelines\[sourceId\]\)/);
    assert.match(source, /!duplicate\s*&&\s*Array\.isArray\(rawThreads\[sourceId\]\)/);
    assert.match(source, /return repairedDuplicateIds/);
});

test('New Virtual Human clears transient photo, voice and file state', () => {
    const start = app.indexOf('function resetNewCompanionStudioState()');
    const end = app.indexOf('function setupCompanionStudioTabs()', start);
    const source = app.slice(start, end);
    for (const id of [
        'cs-photo-test-prompt', 'cs-photo-test-result', 'cs-photo-test-image',
        'cs-voice-sample-text', 'cs-voice-preview-status', 'cs-voice-preview-player',
        'cs-photo-input', 'cs-reference-input'
    ]) assert.match(source, new RegExp(id));
    assert.match(app, /openCompanionStudio\(companion\.id\);\s*resetNewCompanionStudioState\(\)/);
});

console.log(`\n${passed} Virtual Human creation-lifecycle checks passed.`);
