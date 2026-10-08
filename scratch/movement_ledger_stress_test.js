/**
 * Movement graph and World Ledger regression/stress test.
 * Run with: node scratch/movement_ledger_stress_test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function functionSource(name) {
    const start = app.indexOf(`function ${name}(`);
    assert(start >= 0, `Missing function: ${name}`);
    const brace = app.indexOf('{', start);
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

const functionNames = [
    'getExitTargetName',
    'getExitDirection',
    'normalizeLocationSearchText',
    'findFuzzyLocation',
    'canTravelDirectly',
    'resolveWorldExitTarget',
    'worldLocationTravelBlock',
    'resolveWorldContainmentParent',
    'findWorldTravelPath',
    'resolveWorldMovementTarget',
    'getExitTravelTime',
    'normalizeWorldTravelMode',
    'getWorldPathTravelTime',
    'movePlayerAlongWorldPath',
    'extractUserMovementTarget',
    'applyUserDirectedMovement',
    'normalizeWorldLedgerEntry',
    'worldLedgerEntryKey',
    'appendWorldLedgerEntry',
    'syncCurrentWorldSnapshotLedger',
    'replaceWorldLedger',
    'buildStructuredLedgerFallback',
    'buildLocalNarrativeLedgerFallback',
    'stripChatLedgerEntry',
    'captureWorldTurnState',
    'restoreWorldTurnState'
];

function sourceBlock(startMarker, endMarker) {
    const start = app.indexOf(startMarker);
    const end = app.indexOf(endMarker, start);
    assert(start >= 0 && end > start, `Missing source block: ${startMarker}`);
    return app.slice(start, end);
}

const toasts = [];
const context = {
    console: { log() {}, warn() {}, error: console.error },
    Map,
    Set,
    Math,
    Number,
    String,
    RegExp,
    JSON,
    parseInt,
    showToast(message) { toasts.push(message); },
    rollForScenePopulation() {},
    normalizePlayerRulesState() { return { status: 'active', conditions: [] }; },
    sessionNpcs(world) { return (world.entities || []).filter(entity => entity.type === 'npc'); },
    isNpcActive(actor) { return !!actor && !['dead', 'gone'].includes(actor.status); },
    resolveNpcId(world, ref) {
        const query = String(ref || '').toLowerCase();
        return world.entities.find(entity =>
            entity.id.toLowerCase() === query || entity.name.toLowerCase() === query)?.id || null;
    },
    findSessionQuest(session, id, title) {
        const query = String(id || title || '').toLowerCase();
        return (session.quests || []).find(quest =>
            quest.id.toLowerCase() === query || quest.title.toLowerCase() === query) || null;
    },
    getLocationRef(world, ref) {
        const query = String(ref || '').toLowerCase();
        return world.locations.find(location =>
            location.id.toLowerCase() === query || location.name.toLowerCase() === query) || null;
    },
    isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); },
    safeJsonClone(value) { return JSON.parse(JSON.stringify(value)); },
    bumpMemoryEpoch() {}
};
vm.createContext(context);
const composedSource = [
    sourceBlock('function getExitTargetName', 'function checkExitTarget'),
    sourceBlock('const WORLD_TRAVEL_MODES', 'const worldRecordInspector'),
    sourceBlock('function getExitTravelTime', '// An NPC moved by the narrative'),
    sourceBlock('function extractUserMovementTarget', 'async function executeWorldTurn'),
    sourceBlock('function normalizeWorldLedgerEntry', 'async function recoverWorldLedgerEntry'),
    functionSource('stripChatLedgerEntry'),
    sourceBlock('function captureWorldTurnState', 'function addWorldMessage'),
    functionNames.map(name => `this.${name} = ${name};`).join('\n')
].join('\n');
try {
    vm.runInContext(composedSource, context);
} catch (error) {
    const line = Number(String(error.stack || '').match(/evalmachine.<anonymous>:(\d+)/)?.[1]) || 1;
    console.error(composedSource.split('\n').slice(Math.max(0, line - 8), line + 5).join('\n'));
    throw error;
}

const world = {
    id: 'movement_world',
    locations: [
        {
            id: 'Hub',
            name: 'Old Hub',
            exits: [
                { text: 'North to Crossroads', travelTime: 5 },
                'East to East Hall',
                'West to West Hall'
            ]
        },
        {
            id: 'crossroads',
            name: 'Crossroads',
            exits: [
                { text: 'South to Old Hub', travelTime: 5 },
                { text: 'East to Gate to Hell', travelTime: 7 }
            ]
        },
        {
            id: 'gate',
            name: 'Gate to Hell',
            exits: [{ text: 'West to Crossroads', travelTime: 7 }]
        },
        { id: 'east_hall', name: 'East Hall', exits: ['West to Old Hub'] },
        { id: 'west_hall', name: 'West Hall', exits: ['East to Old Hub'] },
        { id: 'smith_house', name: 'Smith House', parentLocationId: 'Hub', exits: [] },
        { id: 'bedroom', name: 'Bedroom', mapType: 'room', parentLocationId: 'smith_house', exits: [] },
        { id: 'region_room', name: 'Region Room', mapType: 'room', region: 'Smith House', exits: [] },
        { id: 'legacy_room', name: 'Legacy Room', mapType: 'room', exits: ['to Smith House'] },
        { id: 'balcony_room', name: 'Balcony Room', mapType: 'room', exits: ['Outside to East Hall'] },
        { id: 'ambiguous_room', name: 'Ambiguous Room', mapType: 'room', exits: ['to East Hall', 'to West Hall'] },
        { id: 'island', name: 'Lonely Island', exits: [] }
    ],
    entities: [
        { id: 'rowan', type: 'npc', name: 'Rowan' }
    ]
};

assert.equal(context.getExitTargetName('East to Gate to Hell'), 'Gate to Hell');
assert.equal(context.getExitDirection('East to Gate to Hell'), 'East');
assert.equal(context.getExitTargetName('to Gate to Hell'), 'Gate to Hell');
assert.equal(context.findFuzzyLocation('HALL', world.locations), null, 'ambiguous partial names must not select the first match');
assert.equal(context.findFuzzyLocation('East Hall', world.locations)?.id, 'east_hall');
assert.equal(context.findFuzzyLocation('hub', world.locations)?.id, 'Hub', 'IDs are case-insensitive');

assert.deepEqual(
    Array.from(context.findWorldTravelPath(world, 'Hub', 'gate')),
    ['Hub', 'crossroads', 'gate']
);
assert.equal(context.findWorldTravelPath(world, 'gate', 'east_hall')?.join('>'), 'gate>crossroads>Hub>east_hall');
assert.equal(context.findWorldTravelPath(world, 'Hub', 'island'), null);
assert.equal(context.getWorldPathTravelTime(world, ['Hub', 'crossroads', 'gate']), 12);
assert.equal(context.canTravelDirectly(world, 'Hub', world.locations[2]), false);

// A trailing second action is not part of the destination. (Previously this
// returned 'the Gate to Hell and look around' and leaned on the fuzzy matcher
// to cope; the phrase is now trimmed at the clause boundary instead.)
assert.equal(context.extractUserMovementTarget('Then I make my way to the Gate to Hell and look around'), 'the Gate to Hell');
assert.equal(context.resolveWorldMovementTarget(world, 'Hub', 'the Gate to Hell')?.id, 'gate');
assert.equal(context.extractUserMovementTarget('I tell Rowan to go to the Gate to Hell'), '');
assert.equal(context.extractUserMovementTarget('"Go to the Gate to Hell," I tell Rowan.'), '');
assert.equal(context.extractUserMovementTarget('*I go north.*'), 'north');
assert.equal(context.extractUserMovementTarget('I leave the room.'), 'leave');
assert.equal(context.resolveWorldMovementTarget(world, 'Hub', 'north and knock')?.id, 'crossroads');
assert.equal(context.resolveWorldContainmentParent(world, world.locations.find(location => location.id === 'bedroom'))?.id, 'smith_house');
assert.equal(context.resolveWorldMovementTarget(world, 'bedroom', 'exit')?.id, 'smith_house');
assert.equal(context.resolveWorldMovementTarget(world, 'Bedroom', 'exit')?.id, 'smith_house',
    'legacy sessions that stored the current location name must still resolve exit');
assert.equal(context.resolveWorldMovementTarget(world, 'region_room', 'leave')?.id, 'smith_house');
assert.equal(context.resolveWorldMovementTarget(world, 'legacy_room', 'exit')?.id, 'smith_house');
assert.equal(context.resolveWorldMovementTarget(world, 'balcony_room', 'leave')?.id, 'east_hall');
assert.equal(context.resolveWorldMovementTarget(world, 'ambiguous_room', 'exit'), null,
    'generic exit must remain ambiguous when there are several unlabeled destinations');
assert.equal(context.findWorldTravelPath(world, 'bedroom', 'Hub')?.join('>'), 'bedroom>smith_house>Hub',
    'containment must provide a directed route out through the hierarchy');

const session = { playerLocation: 'Hub', bonusTimeMinutes: 0 };
const arrival = context.applyUserDirectedMovement(world, session, 'I make my way to the Gate to Hell and look around.');
assert.equal(session.playerLocation, 'gate');
assert.equal(session.bonusTimeMinutes, 12);
assert.match(arrival, /Old Hub → Crossroads[\s\S]*Crossroads → Gate to Hell/,
    'the arrival receipt must retain every leg of a multi-stop route');

session.playerLocation = 'Hub';
session.bonusTimeMinutes = 0;
context.applyUserDirectedMovement(world, session, 'I go north.');
assert.equal(session.playerLocation, 'crossroads');
assert.equal(session.bonusTimeMinutes, 5);

session.playerLocation = 'bedroom';
session.bonusTimeMinutes = 0;
context.applyUserDirectedMovement(world, session, 'I exit the room.');
assert.equal(session.playerLocation, 'smith_house', '"I exit the room" must move to the containing location');

session.playerLocation = 'Hub';
context.applyUserDirectedMovement(world, session, 'I tell Rowan to go to the Gate to Hell.');
assert.equal(session.playerLocation, 'Hub', 'commands directed at NPCs must not move the player');

const blocked = context.movePlayerAlongWorldPath(world, session, world.locations.find(location => location.id === 'island'));
assert.equal(blocked.ok, false);
assert.equal(session.playerLocation, 'Hub');

const ledgerSession = {
    ledger: '',
    ledgerRevision: 0,
    quests: [{ id: 'quest_key', title: 'Find the Key', status: 'active' }],
    history: [{
        role: 'dm',
        currentVersion: 0,
        versions: ['The first take.'],
        postSnapshot: { session: { ledger: '', ledgerRevision: 0 } },
        versionSnapshots: [{ session: { ledger: '', ledgerRevision: 0 } }]
    }]
};
assert.equal(context.appendWorldLedgerEntry(ledgerSession, '[MEMORY]: The King is dead.'), 'The King is dead.');
assert.equal(ledgerSession.ledger, '• The King is dead.');
context.appendWorldLedgerEntry(ledgerSession, '- the king is dead');
assert.equal(ledgerSession.ledger.split('\n').length, 1, 'bullet and punctuation variants must deduplicate');
assert.equal(ledgerSession.ledgerRevision, 1);

const preManualSnapshot = context.captureWorldTurnState(world, ledgerSession);
assert.equal(context.replaceWorldLedger(ledgerSession, '- The King survived.\n- The bridge fell.'), true);
assert.equal(ledgerSession.postSnapshot, undefined);
assert.equal(ledgerSession.history[0].postSnapshot.session.ledger, '- The King survived.\n- The bridge fell.');
assert.equal(ledgerSession.history[0].versionSnapshots[0].session.ledger, '- The King survived.\n- The bridge fell.');
assert.equal(context.restoreWorldTurnState(world, ledgerSession, preManualSnapshot), true);
assert.equal(ledgerSession.ledger, '- The King survived.\n- The bridge fell.',
    'a newer manual source-of-truth correction must survive reroll restoration');

const message = { ledgerEntry: 'The bridge fell.' };
ledgerSession.messages = [message];
context.stripChatLedgerEntry(ledgerSession, message);
assert(!ledgerSession.ledger.includes('bridge fell'));

const duplicateA = { ledgerEntry: 'The King survived.' };
const duplicateB = { ledgerEntry: 'The King survived.' };
ledgerSession.ledger = '• The King survived.';
ledgerSession.messages = [duplicateA, duplicateB];
context.stripChatLedgerEntry(ledgerSession, duplicateB);
assert(ledgerSession.ledger.includes('King survived'), 'a fact still referenced by another canonical message must remain');

const fallback = context.buildStructuredLedgerFallback(world, {
    ...ledgerSession,
    entityStates: {},
    revealedSecrets: []
}, {
    inventory_add: ['Silver Key'],
    npc_status_changes: [{ npc_id: 'rowan', status: 'gone', cause: 'left the city' }],
    quests_update: [{ id: 'quest_key', status: 'completed' }]
}, { completed: ['quest_key'], failed: [] });
assert(fallback.includes('Silver Key'));
assert(fallback.includes('Rowan became gone'));
assert(fallback.includes('Find the Key'));

assert.equal(
    context.buildLocalNarrativeLedgerFallback(
        'I search the ruined chapel.',
        'Dust rolls through the nave. You discovered the Silver Key beneath the altar.'
    ),
    'The player discovered the Silver Key beneath the altar.'
);
assert.equal(
    context.buildLocalNarrativeLedgerFallback(
        'I attack the king.',
        'The blade nearly killed the king, but he remains standing.'
    ),
    '',
    'speculative or nearly-completed outcomes must not become canon'
);
assert.equal(
    context.buildLocalNarrativeLedgerFallback(
        'I leave the room.',
        'You walk into the hall and look around.'
    ),
    '',
    'ordinary movement and description must not flood the ledger'
);

const largeWorld = { locations: [] };
for (let index = 0; index < 2000; index++) {
    largeWorld.locations.push({
        id: `loc_${index}`,
        name: `Location ${index}`,
        exits: index < 1999 ? [`to loc_${index + 1}`] : []
    });
}
const stressStart = performance.now();
const longPath = context.findWorldTravelPath(largeWorld, 'loc_0', 'loc_1999');
const stressElapsed = performance.now() - stressStart;
assert.equal(longPath.length, 2000);
assert(stressElapsed < 5000, `2,000-location pathfinding took too long (${stressElapsed.toFixed(1)}ms)`);

console.log('✓ exit names containing "to", case-insensitive IDs, and ambiguous names');
console.log('✓ directed multi-step pathfinding, direction commands, and summed travel time');
console.log('✓ generic exit/leave resolves through hierarchy or one safe legacy exit');
console.log('✓ NPC-directed/quoted commands do not move the player');
console.log('✓ ledger deduplication, manual snapshot persistence, and canonical cleanup');
console.log('✓ structured and provider-independent narrative chronicle fallbacks');
console.log(`✓ 2,000-location path resolved in ${stressElapsed.toFixed(1)}ms`);
