/**
 * Authored-world integrity audit.
 *
 * Shops, factions, standings and place state were only ever repaired when the
 * app loaded stored state. That left three ways to keep bad data and one way
 * to crash:
 *
 *   - import: a .horde_world is validated for locations and entities only, so
 *     a half-formed faction went straight into storage and threw the moment
 *     the Factions panel drew it
 *   - save:   the Studio edits a clone and persisted it as-is
 *   - export: the same clone was written to a file unrepaired
 *   - delete: removing a person or place left standings, memberships, vendor
 *     bindings and territory pointing at them until the next reload
 *
 * These checks pin the repair itself, the four crashes it prevents, and the
 * paths it now runs on.
 *
 * Run with: node scratch/authored_world_audit.js
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app, functionSource, buildContext } = require('./app_source.js');

const context = { console: { warn() {}, log() {} }, state: { worldInstances: {} } };
buildContext(vm, ['normalizeAuthoredWorld', 'normalizeWorldShops', 'normalizeWorldFactions',
    'normalizeWorldRelationships', 'calibrateStructuralFindings', 'estimateWorldPromptTokens',
    'relationshipKey', 'livingClamp', 'removeWorldLocationRecord'], context);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function world() {
    return {
        id: 'w', name: 'Emberwick',
        locations: [
            { id: 'l_inn', name: 'The Inn', exits: [],
              shop: [{ item: 'ale', price: 2, quantity: 5, maxQuantity: 5, regenPerTurn: 1 }] },
            { id: 'l_road', name: 'The Road', exits: [] }
        ],
        entities: [
            { id: 'e_maera', name: 'Maera', type: 'npc', vendorFor: 'l_inn', factionId: 'f_crown' },
            { id: 'e_vess', name: 'Vess', type: 'npc' }
        ],
        factions: [{ id: 'f_crown', name: 'The Crown', territory: ['l_inn'], relations: [] }],
        relationships: [{ a: 'e_maera', b: 'e_vess', label: 'old debt', score: -20 }]
    };
}

// --- the four shapes that crashed the editor --------------------------------

test('a faction without its arrays is repaired, not left to throw', () => {
    // This is the import case exactly: {id, name} and nothing else. The editor
    // read faction.territory.map and took the whole panel down.
    const raw = { id: 'w', name: 'X', locations: [], entities: [],
        factions: [{ id: 'f1', name: 'Raw Faction' }] };
    context.normalizeAuthoredWorld(raw);
    assert(Array.isArray(raw.factions[0].territory), 'territory is still not an array');
    assert(Array.isArray(raw.factions[0].relations), 'relations is still not an array');
    assert.equal(raw.factions[0].name, 'Raw Faction', 'the author\'s content was lost in the repair');
});

test('a shop that is not an array is repaired', () => {
    const raw = { id: 'w', name: 'X', entities: [],
        locations: [{ id: 'l', name: 'L', shop: 'not an array' }] };
    context.normalizeAuthoredWorld(raw);
    assert.equal('shop' in raw.locations[0], false, 'a non-array shop survived');
});

test('junk inside a shop is dropped', () => {
    const raw = { id: 'w', name: 'X', entities: [],
        locations: [{ id: 'l', name: 'L', shop: [null, 42, { item: 'rope', price: 3 }] }] };
    context.normalizeAuthoredWorld(raw);
    assert.deepEqual(raw.locations[0].shop.map(s => s.item), ['rope'],
        'a null or a number survived as a sellable good');
});

test('a relationship list that is not an array is repaired', () => {
    const raw = { id: 'w', name: 'X', locations: [],
        entities: [{ id: 'e1', name: 'A', type: 'npc' }], relationships: 'nope' };
    context.normalizeAuthoredWorld(raw);
    assert.equal('relationships' in raw, false, 'a non-array relationship list survived');
});

test('malformed worlds of every shape are survivable', () => {
    [{}, { locations: null, entities: null }, { locations: 'x' }, { entities: [null] },
     { locations: [{ id: 'l', conditions: 'nope' }], entities: [] },
     { locations: [{ id: 'l', danger: 'very', prosperity: [] }], entities: [] },
     { locations: [], entities: [], factions: 'no', relationships: 7 }].forEach(raw => {
        assert.doesNotThrow(() => context.normalizeAuthoredWorld(raw),
            `repair threw on ${JSON.stringify(raw)}`);
    });
});

// --- referential integrity ---------------------------------------------------

test('deleting a person takes their standings and membership with them', () => {
    const raw = world();
    raw.entities = raw.entities.filter(entity => entity.id !== 'e_vess');
    context.normalizeAuthoredWorld(raw);
    assert.deepEqual(raw.relationships, undefined,
        'a standing with someone who no longer exists survived');
});

test('deleting a place clears the vendor and the claim on it', () => {
    const raw = world();
    raw.locations = raw.locations.filter(location => location.id !== 'l_inn');
    context.normalizeAuthoredWorld(raw);
    assert.equal('vendorFor' in raw.entities[0], false, 'someone still sells at a place that is gone');
    // Values returned from the VM have a different Array prototype, so compare
    // content rather than realm identity.
    assert.equal(raw.factions[0].territory.length, 0, 'a faction still holds ground that is gone');
});

test('the directory deletion transaction clears every canonical place link', () => {
    const raw = world();
    raw.locations[1].parentLocationId = 'l_inn';
    raw.locations[1].exits = [{ targetLocationId: 'l_inn', text: 'to The Inn' }];
    raw.entities[0].startLocation = 'l_inn';
    raw.entities[0].homeLocation = 'l_inn';
    raw.entities[0].schedule = [{ day: 'mon', locationId: 'l_inn' }];
    raw.startLocationId = 'l_inn';
    raw.startingLives = [{ name: 'Innkeeper', startLocationId: 'l_inn', holdings: ['l_inn'] }];
    raw.groups = [{ id: 'g', name: 'Inn household', type: 'household', homeLocationId: 'l_inn' }];
    context.removeWorldLocationRecord(raw, 'l_inn');
    assert.equal(raw.locations.some(location => location.id === 'l_inn'), false);
    assert.equal(raw.locations[0].parentLocationId, '');
    assert.equal(raw.locations[0].exits.length, 0);
    assert.equal(raw.entities[0].startLocation, '');
    assert.equal(raw.entities[0].homeLocation, '');
    assert.equal(raw.entities[0].schedule.length, 0);
    assert.equal(raw.groups[0].homeLocationId, '');
    assert.equal(raw.startingLives[0].startLocationId, '');
    assert.equal(raw.startingLives[0].holdings.length, 0);
    assert.equal(raw.startLocationId, 'l_road');
});

test('deleting a faction clears the membership into it', () => {
    const raw = world();
    raw.factions = [];
    context.normalizeAuthoredWorld(raw);
    assert.equal('factionId' in raw.entities[0], false, 'an NPC still serves a faction that is gone');
});

test('a valid world keeps everything the author wrote', () => {
    // Repair fills in defaults an author never typed (a faction's status, a
    // stock's base price). What it must never do is change or drop something
    // that was stated.
    const raw = world();
    const before = JSON.parse(JSON.stringify(raw));
    context.normalizeAuthoredWorld(raw);
    const stated = (source, target, path) => Object.entries(source).forEach(([key, value]) => {
        if (value && typeof value === 'object') return stated(value, target?.[key], `${path}.${key}`);
        assert.deepEqual(target?.[key], value, `repair changed ${path}.${key}, which the author had stated`);
    });
    stated(before, raw, 'world');
    assert.equal(raw.locations[0].shop.length, 1, 'an authored good was dropped');
    assert.equal(raw.relationships.length, 1, 'an authored standing was dropped');
    assert.equal(raw.factions.length, 1, 'an authored faction was dropped');
});

test('repair is idempotent', () => {
    const raw = world();
    context.normalizeAuthoredWorld(raw);
    const once = JSON.stringify(raw);
    context.normalizeAuthoredWorld(raw);
    assert.equal(JSON.stringify(raw), once, 'repairing twice changed the world again');
});

test('out-of-range place state is clamped', () => {
    const raw = { id: 'w', name: 'X', entities: [],
        locations: [{ id: 'l', name: 'L', danger: 5000, prosperity: -20, conditions: ['', ' curfew '] }] };
    context.normalizeAuthoredWorld(raw);
    assert.equal(raw.locations[0].danger, 100);
    assert.equal(raw.locations[0].prosperity, 0);
    assert.deepEqual(raw.locations[0].conditions, ['curfew'], 'a blank condition survived');
});

// --- every path that produces or persists a world ----------------------------

test('the repair runs on load, import, save, export and delete', () => {
    const paths = {
        'load': functionSource('repairLoadedState'),
        'save': functionSource('saveWorld'),
        'the factions panel': functionSource('renderWorldFactions'),
        'the locations panel': functionSource('renderWorldLocations'),
        'the entities panel': functionSource('renderWorldEntities')
    };
    Object.entries(paths).forEach(([label, source]) => {
        assert(/normalizeAuthoredWorld\(/.test(source),
            `a world can reach ${label} unrepaired`);
    });
    // Import and export are wired inside a larger setup function, so they are
    // pinned against the file with enough context to be unambiguous.
    assert(/world\.lorebook = Array\.isArray\(world\.lorebook\) \? world\.lorebook : \[\];\s*(\/\/[^\n]*\n\s*)*normalizeAuthoredWorld\(world\);/.test(app),
        'an imported world is never repaired — the crash that motivated this is back');
    assert(/normalizeAuthoredWorld\(state\.editingWorld\);[\s\S]{0,700}?const data = JSON\.stringify\(exportedWorld/.test(app),
        'an exported world is never repaired, so damage travels to whoever opens it');
    assert(/entities\.splice\(idx, 1\);[\s\S]{0,200}?normalizeAuthoredWorld/.test(app),
        'deleting a person leaves their standings behind');
    assert(/removeWorldLocationRecord\(state\.editingWorld, loc\.id\);[\s\S]{0,300}?normalizeAuthoredWorld/.test(app),
        'deleting a place bypasses the canonical-link cleanup transaction');
});

test('World Studio preserves an intentional zero temperature', () => {
    const save = functionSource('saveWorld');
    assert.match(save, /w\.temp = Number\.isFinite\(requestedTemperature\) \? requestedTemperature : 0\.9/);
    assert.doesNotMatch(save, /w\.temp = parseFloat\([^\n]+\) \|\| 0\.9/);
});

// --- what the audit now tells the author -------------------------------------

test('a faction with nobody and nothing is reported', () => {
    const raw = world();
    raw.factions.push({ id: 'f_ghost', name: 'The Ghosts', territory: [], relations: [] });
    const findings = context.calibrateStructuralFindings(raw, null);
    assert(findings.some(f => f.type === 'report_faction_inert' && /Ghosts/.test(f.title)),
        'a faction nothing anchors to the world was not flagged');
    assert(!findings.some(f => f.type === 'report_faction_inert' && /Crown/.test(f.title)),
        'a faction with members and ground was wrongly flagged');
});

test('factions that have no view of each other are reported', () => {
    const raw = world();
    raw.factions.push({ id: 'f_hand', name: 'The Hand', territory: ['l_road'], relations: [] });
    assert(context.calibrateStructuralFindings(raw, null).some(f => f.type === 'report_faction_relations'),
        'two factions with no stated standing were not flagged');
});

test('a shop the player can loot or can never use is reported', () => {
    const raw = world();
    raw.locations[0].shop.push({ item: 'free sword', price: 0, quantity: 1, maxQuantity: 1, regenPerTurn: 0 });
    raw.locations[0].shop.push({ item: 'phantom', price: 5, quantity: 0, maxQuantity: 0, regenPerTurn: 0 });
    const findings = context.calibrateStructuralFindings(raw, null);
    assert(findings.some(f => f.type === 'report_shop_price' && /free sword/.test(f.detail)),
        'an item priced at zero was not flagged');
    assert(findings.some(f => f.type === 'report_shop_stock' && /phantom/.test(f.detail)),
        'an item that can never be bought was not flagged');
});

test('a shop with no trader is reported, and one with a trader is not', () => {
    const raw = world();
    assert(!context.calibrateStructuralFindings(raw, null).some(f => f.type === 'report_shop_vendor'),
        'a tended shop was wrongly flagged');
    delete raw.entities[0].vendorFor;
    assert(context.calibrateStructuralFindings(raw, null).some(f => f.type === 'report_shop_vendor'),
        'a shop nobody tends was not flagged');
});

test('these findings report rather than pretend to be repairable', () => {
    // Applying one would mean inventing the author's intent — which faction
    // should hold what, what a loaf is worth. They carry no patch, so the
    // "Apply" button never offers to guess.
    const raw = world();
    raw.factions.push({ id: 'f_ghost', name: 'The Ghosts', territory: [], relations: [] });
    const society = ['report_faction_inert', 'report_faction_relations',
        'report_shop_price', 'report_shop_stock', 'report_shop_vendor'];
    const reported = context.calibrateStructuralFindings(raw, null)
        .filter(finding => society.includes(finding.type));
    assert(reported.length, 'none of the new checks produced a finding to examine');
    reported.forEach(finding => {
        assert.equal(finding.patch, undefined,
            `${finding.type} carries a patch, but it is a judgement the author has to make`);
    });
});

test('a sound world produces no society complaints', () => {
    const findings = context.calibrateStructuralFindings(world(), null)
        .filter(finding => /faction|shop/.test(finding.type));
    assert.equal(findings.length, 0, `a well-formed world was nagged: ${findings.map(f => f.title).join('; ')}`);
});

// --- counting what actually reaches the model --------------------------------

test('authored society counts toward the context size recommendation', () => {
    const bare = { name: 'X', locations: [], entities: [], lorebook: [] };
    const rich = {
        name: 'X', lorebook: [], entities: [],
        locations: [{ id: 'l', shop: [{ item: 'a very long item name indeed' }] }],
        factions: [{ name: 'The Crown', description: 'A long description of the ruling power here.', goal: 'Hold the ford' }],
        relationships: [{ label: 'estranged brother', reason: 'the inheritance was split badly' }]
    };
    assert(context.estimateWorldPromptTokens(rich, null) > context.estimateWorldPromptTokens(bare, null),
        'factions, shops and standings reach the prompt but are not counted, so the recommended context comes out short');
});

test('the studio token counter moves when society is authored', () => {
    const counter = functionSource('updateWorldTokenCount');
    assert(/w\.factions/.test(counter) && /w\.relationships/.test(counter),
        'the editors call the counter but what they add never changes the number');
});

// --- error messages the author actually sees ---------------------------------

test('a pass with nothing to do says so, instead of claiming it does not exist', () => {
    const run = functionSource('runCalibrationPass');
    assert(/Nothing left for the/.test(run),
        'a finished world reports "Unknown calibration pass", sending the author hunting a bug');
    assert(/if \(!CALIBRATION_PASSES\[pass\]\)/.test(run),
        'a genuinely unknown pass no longer reports itself as unknown');
});

let failures = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log(`✓ ${name}`); }
    catch (error) { failures++; console.error(`✗ ${name}\n  ${error.message}`); }
}
if (failures) {
    console.error(`\n${failures} authored-world check(s) failed.`);
    process.exit(1);
}
console.log(`\n${tests.length} authored-world checks passed.`);
