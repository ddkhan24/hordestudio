/**
 * Movement phrasing + location hierarchy audit for the starter campaign.
 * Reproduces "I stepped out of the room" class failures and verifies the
 * containment hierarchy of The Shattered Crown of Aldenmere.
 * Run with: node scratch/movement_hierarchy_audit.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Lexer-aware span matcher: skips strings, template literals, line/block
// comments, and regex literals (the naive quote-only scanner used by older
// suites is poisoned by patterns like /[’']/g and comments with apostrophes).
function matchSpan(startIndex, openChar, closeChar, label, searchFrom = startIndex) {
    const open = app.indexOf(openChar, searchFrom);
    assert(open >= 0, `No opening ${openChar} for ${label}`);
    let depth = 0;
    let lastSignificant = '';
    for (let i = open; i < app.length; i++) {
        const char = app[i];
        const next = app[i + 1];
        if (char === '/' && next === '/') {
            i = app.indexOf('\n', i);
            if (i < 0) break;
            continue;
        }
        if (char === '/' && next === '*') {
            i = app.indexOf('*/', i + 2) + 1;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === char) break;
            }
            lastSignificant = char;
            continue;
        }
        if (char === '/' && /[(,=:[!&|?{};\n+\-*%^~<>]/.test(lastSignificant || '\n')) {
            // Regex literal: scan to its unescaped closing slash, honoring [...]
            let inClass = false;
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === '[') inClass = true;
                else if (app[i] === ']') inClass = false;
                else if (app[i] === '/' && !inClass) break;
            }
            lastSignificant = '/';
            continue;
        }
        if (!/\s/.test(char)) lastSignificant = char;
        if (char === openChar) depth++;
        else if (char === closeChar && --depth === 0) return app.slice(startIndex, i + 1);
    }
    throw new Error(`Unclosed ${label}`);
}

function functionSource(name) {
    const start = app.indexOf(`function ${name}(`);
    assert(start >= 0, `Missing function: ${name}`);
    // Default parameters like `options = {}` put braces inside the parameter
    // list; resolve the parameter span first, then match the body after it.
    const params = matchSpan(start, '(', ')', `params of ${name}`);
    return matchSpan(start, '{', '}', `function ${name}`, start + params.length);
}

function constSource(name) {
    const start = app.indexOf(`const ${name} = [`);
    assert(start >= 0, `Missing const: ${name}`);
    return matchSpan(start, '[', ']', `const ${name}`) + ';';
}

const context = {
    console,
    state: {},
    showToast() {},
    rollForScenePopulation() {},
    normalizePlayerRulesState() { return { status: 'active', conditions: [] }; },
    sessionNpcs(world) { return (world.entities || []).filter(entity => entity.type === 'npc'); },
    isNpcActive(actor) { return !!actor && !['dead', 'gone'].includes(actor.status); }
};
vm.createContext(context);
const sources = [
    // STARTER_WORLDS is evaluated in production after both factory-backed
    // presets are defined. Keep the audit harness on that same boot path so
    // changes to the registry cannot make this focused movement suite fail
    // before it reaches the Aldenmere fixture it actually exercises.
    'createThronefallSandboxWorld',
    'createBellwether2005World',
    'getExitTargetName',
    'getExitDirection',
    'normalizeLocationSearchText',
    'findFuzzyLocation',
    'resolveWorldExitTarget',
    'questTextKey',
    'worldExitUnlockKey', 'worldExitRequirement',
    'worldLocationTravelBlock',
    'resolveWorldContainmentParent',
    'findWorldTravelPath',
    'resolveWorldMovementTarget',
    'getExitTravelTime',
    'getLocationRef',
    'normalizeWorldTravelMode',
    'getWorldTravelLeg',
    'getWorldPathTravelTime',
    'movePlayerAlongWorldPath',
    'extractUserMovementTarget'
].map(functionSource).join('\n');
vm.runInContext(`${sources}\n${constSource('STARTER_WORLDS')}\n` +
    'this.extractUserMovementTarget = extractUserMovementTarget;' +
    'this.resolveWorldMovementTarget = resolveWorldMovementTarget;' +
    'this.resolveWorldContainmentParent = resolveWorldContainmentParent;' +
    'this.findWorldTravelPath = findWorldTravelPath;' +
    'this.getWorldPathTravelTime = getWorldPathTravelTime;' +
    'this.movePlayerAlongWorldPath = movePlayerAlongWorldPath;' +
    'this.resolveWorldExitTarget = resolveWorldExitTarget;' +
    'this.getExitTargetName = getExitTargetName;' +
    'this.STARTER_WORLDS = STARTER_WORLDS;', context);

const aldenmere = context.STARTER_WORLDS.find(candidate => candidate?.id === 'world_aldenmere');
assert(aldenmere, 'Aldenmere starter world is present');
const world = JSON.parse(JSON.stringify(aldenmere));
const byId = Object.fromEntries(world.locations.map(l => [l.id, l]));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Resolve a typed player message from a given location to a destination id
// (or null), through the same extract → resolve pipeline the app uses.
function resolvePhrase(fromId, phrase) {
    const target = context.extractUserMovementTarget(phrase);
    if (!target) return { target, dest: null };
    const loc = context.resolveWorldMovementTarget(world, fromId, target);
    return { target, dest: loc ? loc.id : null };
}

// ---------- Hierarchy integrity ----------

test('every exit in the campaign resolves to a real location', () => {
    for (const loc of world.locations) {
        for (const exit of loc.exits || []) {
            const target = context.resolveWorldExitTarget(world, exit);
            assert(target, `${loc.id}: unresolvable exit "${context.getExitTargetName(exit)}"`);
        }
    }
});

test('every room and every floored location has a containment parent', () => {
    for (const loc of world.locations) {
        const floored = loc.mapFloor !== undefined && String(loc.mapFloor) !== '0';
        if (loc.mapType === 'room' || floored) {
            const parent = context.resolveWorldContainmentParent(world, loc);
            assert(parent, `${loc.id} (${loc.mapType}, floor ${loc.mapFloor}) has no resolvable parent`);
        }
    }
});

test('every building inside a settlement has a containment parent', () => {
    for (const loc of world.locations) {
        if (loc.mapType !== 'building') continue;
        const parent = context.resolveWorldContainmentParent(world, loc);
        assert(parent, `${loc.id} (building) has no resolvable parent — "step outside" cannot resolve`);
    }
});

test('containment graph has no cycles and parents are real', () => {
    for (const loc of world.locations) {
        const seen = new Set([loc.id]);
        let current = loc;
        while (true) {
            const parent = context.resolveWorldContainmentParent(world, current);
            if (!parent) break;
            assert(!seen.has(parent.id), `containment cycle at ${parent.id}`);
            seen.add(parent.id);
            current = parent;
        }
    }
});

test('every location is reachable from the start location', () => {
    for (const loc of world.locations) {
        if (loc.id === world.startLocationId) continue;
        const path = context.findWorldTravelPath(world, world.startLocationId, loc.id);
        assert(path, `${loc.id} unreachable from ${world.startLocationId}`);
    }
});

test('containment does not create free shortcuts past timed exits', () => {
    // Walking out of the gatehouse must still bill the 15m road exit.
    const path = context.findWorldTravelPath(world, 'loc_mine_gate', 'loc_mine_road');
    assert.deepEqual(Array.from(path), ['loc_mine_gate', 'loc_mine_road']);
    assert.equal(context.getWorldPathTravelTime(world, path), 15);
});

// ---------- Typed movement phrases: outward ----------

test('"I step out of the room" leaves the taproom for the square', () => {
    assert.equal(resolvePhrase('loc_griffin_tap', 'I step out of the room').dest, 'loc_square');
});

test('"I stepped outside." (past tense) leaves the chapel', () => {
    assert.equal(resolvePhrase('loc_chapel', 'I stepped outside.').dest, 'loc_square');
});

test('"I walked out" (past tense) leaves the forge', () => {
    assert.equal(resolvePhrase('loc_forge', 'I walked out').dest, 'loc_square');
});

test('"I left the taproom" resolves outward, not to where I already am', () => {
    assert.equal(resolvePhrase('loc_griffin_tap', 'I left the taproom').dest, 'loc_square');
});

test('"leave" alone works from a two-exit building via its parent', () => {
    assert.equal(resolvePhrase('loc_chapel', 'leave').dest, 'loc_square');
});

test('"go outside" from the vault climbs one level to the Deepgate', () => {
    assert.equal(resolvePhrase('loc_vault', 'go outside').dest, 'loc_deepgate');
});

test('"I step out" from the keep returns to the bazaar', () => {
    assert.equal(resolvePhrase('loc_keep', 'I step out').dest, 'loc_bazaar');
});

test('"We left." moves out of the Red Ledger house', () => {
    assert.equal(resolvePhrase('loc_ledger', 'We left.').dest, 'loc_bazaar');
});

// ---------- Typed movement phrases: directional, nested, multi-hop ----------

test('"I go upstairs" from the cellar reaches the taproom', () => {
    assert.equal(resolvePhrase('loc_griffin_cellar', 'I go upstairs').dest, 'loc_griffin_tap');
});

test('"I climb down to the Deepgate" descends from the galleries', () => {
    assert.equal(resolvePhrase('loc_galleries', 'I climb down to the Deepgate').dest, 'loc_deepgate');
});

test('"I head north" from the square takes the Mine Road', () => {
    assert.equal(resolvePhrase('loc_square', 'I head north').dest, 'loc_mine_road');
});

test('"I went to the Grand Bazaar" (past tense) works from the northgate', () => {
    assert.equal(resolvePhrase('loc_northgate', 'I went to the Grand Bazaar').dest, 'loc_bazaar');
});

test('compound transition phrasing still resolves the player destination', () => {
    assert.equal(resolvePhrase('loc_square', 'I shrug as I turn to head out to the Mine Road').dest, 'loc_mine_road');
    assert.equal(resolvePhrase('loc_square', "I'm walking to the Mine Road").dest, 'loc_mine_road');
});

test('"I enter the Gilded Griffin" from the square finds the taproom', () => {
    assert.equal(resolvePhrase('loc_square', 'I enter the Gilded Griffin').dest, 'loc_griffin_tap');
});

test('multi-hop: "I make my way to Karsholm Keep" routes and bills travel time', () => {
    const { dest } = resolvePhrase('loc_square', 'I make my way to Karsholm Keep');
    assert.equal(dest, 'loc_keep');
    const path = context.findWorldTravelPath(world, 'loc_square', 'loc_keep');
    assert.deepEqual(Array.from(path), ['loc_square', 'loc_crossroads', 'loc_northgate', 'loc_bazaar', 'loc_keep']);
    assert.equal(context.getWorldPathTravelTime(world, path), 180);
});

test('movePlayerAlongWorldPath applies an outward move end-to-end', () => {
    const sess = { playerLocation: 'loc_griffin_tap', bonusTimeMinutes: 0 };
    const target = context.resolveWorldMovementTarget(world, sess.playerLocation,
        context.extractUserMovementTarget('I step out of the room'));
    assert(target, 'outward target did not resolve');
    const result = context.movePlayerAlongWorldPath(world, sess, target, { showTravelToast: false });
    assert.equal(result.moved, true);
    assert.equal(sess.playerLocation, 'loc_square');
});

// ---------- Containment is a two-way route, not a one-way trap ----------

// A room authored the way the Studio presents it: attached to its parent, with
// an exit back out — but no reciprocal exit on the parent, because only the
// Studio's own edit handler creates those.
function houseWorld() {
    return { id: 'w_house', locations: [
        { id: 'loc_house', name: 'Smith House', exits: [] },
        { id: 'loc_bathroom', name: 'Bathroom', region: 'Smith House',
          parentLocationId: 'Smith House', mapType: 'room', mapFloor: '2',
          exits: [{ text: 'to Smith House', travelTime: 0, isOneWay: false }] },
        { id: 'loc_emily', name: "Emily's Room", region: 'Smith House',
          parentLocationId: 'Smith House', mapType: 'room', mapFloor: '2', exits: [] }
    ], entities: [] };
}

test('a contained room can be entered, not only left', () => {
    const world = houseWorld();
    assert.deepEqual(Array.from(context.findWorldTravelPath(world, 'loc_bathroom', 'loc_house')),
        ['loc_bathroom', 'loc_house'], 'leaving the room broke');
    assert.deepEqual(Array.from(context.findWorldTravelPath(world, 'loc_house', 'loc_bathroom')),
        ['loc_house', 'loc_bathroom'],
        'a room inside the house could not be entered from the house — a one-way trap');
});

test('the reported case resolves: "I go to the bathroom" from the house', () => {
    const world = houseWorld();
    const target = context.resolveWorldMovementTarget(world, 'loc_house',
        context.extractUserMovementTarget('I go to the bathroom'));
    assert(target, 'the bathroom exists and is attached to the house, but was unreachable');
    assert.equal(target.id, 'loc_bathroom');
});

test('sibling rooms route through their shared parent', () => {
    const world = houseWorld();
    assert.deepEqual(Array.from(context.findWorldTravelPath(world, 'loc_bathroom', 'loc_emily')),
        ['loc_bathroom', 'loc_house', 'loc_emily'],
        'two rooms in the same house could not reach each other');
});

test('containment still does not invent routes between unrelated places', () => {
    const world = houseWorld();
    world.locations.push({ id: 'loc_far', name: 'Distant Tower', exits: [] });
    assert.equal(context.findWorldTravelPath(world, 'loc_house', 'loc_far'), null,
        'an unconnected location became reachable');
});

test('containment does not shortcut past a timed exit in the campaign', () => {
    // Regression guard: the mine gatehouse is contained by the mine road, and
    // the 15-minute climb between them must still be billed.
    const path = context.findWorldTravelPath(world, 'loc_mine_gate', 'loc_mine_road');
    assert.deepEqual(Array.from(path), ['loc_mine_gate', 'loc_mine_road']);
    assert.equal(context.getWorldPathTravelTime(world, path), 15);
});

// ---------- Roleplay prose must not be swallowed as a destination ----------

test('the reported case: dialogue and stage business are not part of the destination', () => {
    // "I head to the bathroom gently pushing Emily away "first one out gets dips Em""
    // previously produced the whole tail as one location name.
    const target = context.extractUserMovementTarget(
        'I head to the bathroom gently pushing Emily away "first one out gets dips Em"');
    assert(!target.includes('Emily'), `stage business leaked into the destination: "${target}"`);
    assert(!target.includes('dips'), `dialogue leaked into the destination: "${target}"`);
    assert(!/["'“”]/.test(target), `quotes leaked into the destination: "${target}"`);
    assert.equal(target.toLowerCase(), 'the bathroom');
});

test('a destination is cut at the start of dialogue', () => {
    assert.equal(context.extractUserMovementTarget('I go to the tavern "wait here" I tell her').toLowerCase(),
        'the tavern');
});

test('a destination is cut at a new clause', () => {
    const cases = [
        ['I walk to the forge while thinking about the seal', 'the forge'],
        ['I head to the chapel and then sit down', 'the chapel'],
        ['I go to the square as the bell rings', 'the square'],
        ['I move to the cellar quietly closing the door behind me', 'the cellar'],
        ['I return to the taproom with Emily in tow', 'the taproom']
    ];
    cases.forEach(([input, expected]) => {
        assert.equal(context.extractUserMovementTarget(input).toLowerCase(), expected,
            `"${input}" produced "${context.extractUserMovementTarget(input)}"`);
    });
});

test('a participle that belongs to a place name is kept', () => {
    assert.equal(context.extractUserMovementTarget('I go to the Burning Hall').toLowerCase(), 'the burning hall');
});

test('a runaway phrase is capped rather than passed on whole', () => {
    const target = context.extractUserMovementTarget(
        'I walk to the place ' + 'blah '.repeat(40));
    assert(target.split(/\s+/).length <= 8, `phrase was not capped: "${target}"`);
});

test('trailing noise still resolves via the longest matching prefix', () => {
    // "the Gilded Griffin Taproom on the left past the fountain"
    const target = context.resolveWorldMovementTarget(world, 'loc_square',
        'the Gilded Griffin Taproom on the left past the fountain');
    assert(target, 'prefix retry did not recover a real destination');
    assert.equal(target.id, 'loc_griffin_tap');
});

// ---------- Guard rails: things that must NOT move the player ----------

test('quoted commands still do not move the player', () => {
    assert.equal(context.extractUserMovementTarget('"Go to the tower," I tell Rowena'), '');
});

test('"I ran my fingers along the wall" resolves to no destination', () => {
    assert.equal(resolvePhrase('loc_square', 'I ran my fingers along the wall').dest, null);
});

test('"I left him standing there" resolves to no destination', () => {
    // "him standing there" matches no location; must not move or crash.
    assert.equal(resolvePhrase('loc_square', 'I left him standing there').dest, null);
});

test('ambiguous "enter" from the square (three buildings) stays put', () => {
    assert.equal(resolvePhrase('loc_square', 'I step inside').dest, null);
});

let failures = 0;
for (const { name, fn } of tests) {
    try {
        fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        failures++;
        console.error(`✗ ${name}\n  ${error.message}`);
    }
}
if (failures) {
    console.error(`\n${failures} movement/hierarchy check(s) failed.`);
    process.exit(1);
}
console.log(`\n${tests.length} movement + hierarchy checks passed.`);
