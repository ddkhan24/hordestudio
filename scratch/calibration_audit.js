/**
 * World Calibration audit — Tier 0 (deterministic repair).
 *
 * A hand-authored world leaves most of the engine asleep. Tier 0 covers the
 * part that needs no judgement and no API call: a missing start location, a
 * context window too small for the world's own text, exits that only exist on
 * one side, places nothing leads to, and names that collide.
 *
 * Run with: node scratch/calibration_audit.js
 */
// Runtime values are produced in a vm realm; legacy `deepEqual` intentionally
// compares their data rather than rejecting identical cross-realm prototypes.
const assert = require('node:assert');
const vm = require('node:vm');
const { app, functionSource, asyncFunctionSource, buildContext } = require('./app_source.js');

const context = { console: { warn() {}, log() {} } };
buildContext(vm, [
    'calibrateStructuralFindings', 'applyCalibrationFinding', 'buildCalibrationPrompt',
    'calibrationFindingsFromStructure', 'calibrationFindingsFromPeople', 'calibrationFindingsFromItems',
    'calibrationLocationDigest', 'calibrationPeopleDigest', 'calibrationItemDigest', 'parseCalibrationPayload',
    'structuredModelFor', 'rankStructuredModels', 'structuredModelPricePerMillion',
    'structuredCapabilityBand', 'salvageTruncatedPayload',
    'CALIBRATION_BATCH_SIZES', 'calibrationWorkUnits', 'calibrationBatches', 'calibrationSocietyDigest',
    'calibrationFindingsFromSociety', 'calibrationPairCandidates',
    'estimateWorldPromptTokens', 'getExitTargetName', 'getExitDirection',
    'getOppositeDirection', 'formatWorldMapType', 'isValidScheduleTime', 'safeJsonClone'
], context);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// The world someone actually types in.
function bareWorld() {
    return {
        id: 'w', name: 'Ashford Village',
        dmPrompt: 'You are the DM for Ashford.',
        locations: [
            { id: 'l_square', name: 'Village Square', description: 'A cobbled square.',
              exits: ['to The Tavern', 'to The Mill'] },
            { id: 'l_tavern', name: 'The Tavern', description: 'Low beams.', exits: [] },
            { id: 'l_mill',   name: 'The Mill',   description: 'The wheel turns.', exits: [] },
            { id: 'l_cellar', name: 'Tavern Cellar', description: 'Barrels.', exits: [] }
        ],
        entities: [{ id: 'e_mara', name: 'Mara', type: 'npc', description: 'The innkeeper.' }]
    };
}
const find = (findings, type) => findings.filter(f => f.type === type);

test('a bare world produces findings across every structural category', () => {
    const findings = context.calibrateStructuralFindings(bareWorld(), null);
    ['set_start_location', 'raise_context_size', 'add_reciprocal_exit', 'report_orphan']
        .forEach(type => assert(find(findings, type).length, `nothing reported for ${type}`));
    assert(findings.every(f => f.tier === 'structure' && f.id && f.title && f.detail),
        'a finding is missing its identity or explanation');
});

test('the one-way trap is caught in both directions of the graph', () => {
    const findings = context.calibrateStructuralFindings(bareWorld(), null);
    const reciprocal = find(findings, 'add_reciprocal_exit');
    const targets = reciprocal.map(f => f.patch.locationId).sort();
    assert.deepEqual(targets, ['l_mill', 'l_tavern'],
        'the rooms you can enter but never leave were not both caught');
    assert(reciprocal.every(f => /to Village Square/.test(f.patch.exitText)),
        'the proposed return exit does not point back where it came from');
});

test('applying the reciprocal exit actually makes the room escapable', () => {
    const world = bareWorld();
    const finding = find(context.calibrateStructuralFindings(world, null), 'add_reciprocal_exit')
        .find(f => f.patch.locationId === 'l_tavern');
    assert.equal(context.applyCalibrationFinding(world, finding), true);
    const tavern = world.locations.find(l => l.id === 'l_tavern');
    assert.equal(tavern.exits.length, 1);
    assert.equal(context.getExitTargetName(tavern.exits[0]), 'Village Square');
    assert.equal(tavern.exits[0].isOneWay, false);
});

test('applying a finding twice does not duplicate the exit', () => {
    const world = bareWorld();
    const finding = find(context.calibrateStructuralFindings(world, null), 'add_reciprocal_exit')
        .find(f => f.patch.locationId === 'l_tavern');
    context.applyCalibrationFinding(world, finding);
    assert.equal(context.applyCalibrationFinding(world, finding), false, 'the same exit was added twice');
    assert.equal(world.locations.find(l => l.id === 'l_tavern').exits.length, 1);
});

test('calibration is idempotent — a repaired world reports nothing further', () => {
    const world = bareWorld();
    let findings = context.calibrateStructuralFindings(world, null);
    findings.forEach(f => context.applyCalibrationFinding(world, f));
    findings = context.calibrateStructuralFindings(world, null);
    assert.deepEqual(find(findings, 'add_reciprocal_exit'), [], 'exits were proposed again after repair');
    assert.deepEqual(find(findings, 'set_start_location'), [], 'the start location was proposed again');
    assert.deepEqual(find(findings, 'raise_context_size'), [], 'context size was proposed again');
});

test('a deliberate one-way exit is respected, not "repaired"', () => {
    const world = bareWorld();
    world.locations.push({ id: 'l_pit', name: 'Oubliette', description: 'You fall in.',
        exits: [{ text: 'to Village Square', isOneWay: true }] });
    world.locations[0].exits.push({ text: 'down to Oubliette', isOneWay: true });
    const reciprocal = find(context.calibrateStructuralFindings(world, null), 'add_reciprocal_exit');
    assert(!reciprocal.some(f => f.patch.locationId === 'l_pit'),
        'a deliberate one-way drop was treated as a mistake');
});

test('containment counts as the way back', () => {
    const world = bareWorld();
    const cellar = world.locations.find(l => l.id === 'l_cellar');
    cellar.parentLocationId = 'The Tavern';
    cellar.exits = ['to The Tavern'];
    const reciprocal = find(context.calibrateStructuralFindings(world, null), 'add_reciprocal_exit');
    assert(!reciprocal.some(f => f.patch.locationId === 'l_tavern'
        && /Tavern Cellar/.test(f.patch.exitText)),
        'a contained room demanded an explicit return exit it does not need');
});

test('an unreachable place is reported and a connected one is not', () => {
    const orphans = find(context.calibrateStructuralFindings(bareWorld(), null), 'report_orphan')
        .map(f => f.patch.locationId);
    assert.deepEqual(orphans, ['l_cellar'], 'the orphaned cellar was not identified alone');

    const connected = bareWorld();
    connected.locations.find(l => l.id === 'l_cellar').parentLocationId = 'The Tavern';
    assert.deepEqual(find(context.calibrateStructuralFindings(connected, null), 'report_orphan'), [],
        'a place reachable through containment was called unreachable');
});

test('an orphan carries no automatic repair — connecting it needs judgement', () => {
    const world = bareWorld();
    const orphan = find(context.calibrateStructuralFindings(world, null), 'report_orphan')[0];
    assert.equal(context.applyCalibrationFinding(world, orphan), false,
        'the engine invented a connection it had no basis for');
});

test('context size is sized to the world, not to a constant', () => {
    const small = context.calibrateStructuralFindings(bareWorld(), null);
    const smallSize = find(small, 'raise_context_size')[0].patch.contextSize;

    const big = bareWorld();
    big.dmPrompt = 'x'.repeat(120000);
    const bigSize = find(context.calibrateStructuralFindings(big, null), 'raise_context_size')[0].patch.contextSize;
    assert(bigSize > smallSize, 'a far wordier world asked for no more context');
    assert(smallSize >= 8192, 'context was sized below the engine floor');
    assert.equal(smallSize % 1024, 0, 'context size is not a clean multiple');
});

test('an enabled preset counts toward the context estimate', () => {
    const world = bareWorld();
    const preset = { data: { prompts: [
        { content: 'y'.repeat(60000), enabled: true },
        { content: 'z'.repeat(60000), enabled: false }
    ] } };
    const without = context.estimateWorldPromptTokens(world, null);
    const withPreset = context.estimateWorldPromptTokens(world, preset);
    assert(withPreset > without, 'the preset was ignored when sizing context');
    assert(withPreset - without < 30000, 'a disabled preset prompt was counted');
});

test('colliding location names are reported', () => {
    const world = bareWorld();
    world.locations.push({ id: 'l_mill2', name: 'The Mill', description: 'A second mill.', exits: [] });
    const dupes = find(context.calibrateStructuralFindings(world, null), 'report_duplicate_name');
    assert.equal(dupes.length, 1);
    assert(/2 locations are called/.test(dupes[0].title));
});

test('an already-healthy world is left alone', () => {
    const world = {
        id: 'w', name: 'Tidy', startLocationId: 'a', contextSize: 65536, maxTokens: 2048,
        regions: [{ id: 'reg_home', name: 'Home', description: 'The whole test area.', tags: ['test'] }],
        dmPrompt: 'short', locations: [
            { id: 'a', name: 'A', description: 'a', tags: ['test'], regionId: 'reg_home', mapType: 'area', exits: [{ text: 'to B', targetLocationId: 'b', mode: 'walk', travelTime: 5 }] },
            { id: 'b', name: 'B', description: 'b', tags: ['test'], regionId: 'reg_home', mapType: 'area', exits: [{ text: 'to A', targetLocationId: 'a', mode: 'walk', travelTime: 5 }] }
        ], entities: [], groups: []
    };
    assert.deepEqual(context.calibrateStructuralFindings(world, null), [],
        'a well-formed world was told to change something');
});

test('malformed worlds do not throw', () => {
    [{}, { locations: null }, { locations: [{}] },
     { locations: [{ id: 'x', exits: [null, 42, {}] }] }].forEach(world => {
        assert.doesNotThrow(() => context.calibrateStructuralFindings(world, null),
            `threw on ${JSON.stringify(world)}`);
    });
});

// ---------------------------------------------- Tier 1: the structure pass

function houseWorld() {
    return {
        id: 'w', name: 'Smith House', startLocationId: 'l_house', contextSize: 32768,
        locations: [
            { id: 'l_house', name: 'Smith House', description: 'A two-storey home.',
              exits: [{ text: 'to Bathroom', travelTime: 0 }] },
            { id: 'l_bath', name: 'Bathroom', description: 'Small and cramped.',
              exits: [{ text: 'to Smith House' }] },
            { id: 'l_shed', name: 'Garden Shed', description: 'Spiders and a mower.', exits: [] },
            { id: 'l_town', name: 'Town', description: 'Twenty minutes down the road.', exits: [] }
        ],
        entities: []
    };
}
const structure = (world, payload) => context.calibrationFindingsFromStructure(world, payload);

test('the pass prompt lists the world and never invents vocabulary', () => {
    const prompt = context.buildCalibrationPrompt(houseWorld(), 'structure');
    ['region', 'route', 'building', 'outdoor', 'room', 'area'].forEach(role =>
        assert(prompt.includes(role), `the role "${role}" was not offered to the model`));
    assert(prompt.includes('[l_bath]') && prompt.includes('Garden Shed'),
        'the world was not described to the model');
    assert(/no travel time/.test(prompt), 'the model cannot tell which connections lack a time');
    assert(/Never invent locations/.test(prompt), 'nothing stops the model inventing places');
    assert.equal(context.buildCalibrationPrompt(houseWorld(), 'nonsense'), '');
});

test('containment, role and floor become reviewable findings', () => {
    const findings = structure(houseWorld(), { locations: [
        { id: 'l_bath', role: 'room', inside: 'l_house', floor: '2', why: 'a bathroom is in the house' }
    ] });
    const types = findings.map(f => f.type).sort();
    assert.deepEqual(types, ['set_containment', 'set_floor', 'set_map_type']);
    assert(findings.every(f => f.tier === 'structure' && f.title && f.detail));
});

test('applying containment makes the room enterable', () => {
    const world = houseWorld();
    const finding = structure(world, { locations: [{ id: 'l_bath', inside: 'l_house' }] })[0];
    assert.equal(context.applyCalibrationFinding(world, finding), true);
    assert.equal(world.locations.find(l => l.id === 'l_bath').parentLocationId, 'l_house');
});

test('authored values are never overwritten', () => {
    const world = houseWorld();
    const bath = world.locations.find(l => l.id === 'l_bath');
    bath.mapType = 'area';                 // the author already decided
    bath.parentLocationId = 'l_town';
    bath.mapFloor = '9';
    const findings = structure(world, { locations: [
        { id: 'l_bath', role: 'room', inside: 'l_house', floor: '2' }
    ] });
    assert.deepEqual(findings, [], 'the pass proposed overwriting the author');
});

test('a containment loop is refused', () => {
    const world = houseWorld();
    world.locations.find(l => l.id === 'l_house').parentLocationId = 'l_bath';
    const finding = { type: 'set_containment', patch: { locationId: 'l_bath', parentLocationId: 'l_house' } };
    assert.equal(context.applyCalibrationFinding(world, finding), false,
        'a place was put inside something already inside it');
});

test('an unconnected place is connected in both directions', () => {
    const world = houseWorld();
    const finding = structure(world, { locations: [
        { id: 'l_shed', connect_to: 'l_house', why: 'the shed is in the garden' }
    ] })[0];
    assert.equal(finding.type, 'connect_location');
    assert.equal(context.applyCalibrationFinding(world, finding), true);
    const shed = world.locations.find(l => l.id === 'l_shed');
    const house = world.locations.find(l => l.id === 'l_house');
    assert(shed.exits.some(e => context.getExitTargetName(e) === 'Smith House'), 'no way out of the shed');
    assert(house.exits.some(e => context.getExitTargetName(e) === 'Garden Shed'),
        'no way in — connecting created a fresh one-way trap');
});

test('travel time is proposed only for connections that lack one', () => {
    const world = houseWorld();
    const findings = structure(world, { travel: [
        { from: 'l_house', to: 'l_bath', minutes: 1 },     // already has travelTime 0 → proposable
        { from: 'l_bath', to: 'l_house', minutes: 1 },     // string-ish exit, no time → proposable
        { from: 'l_house', to: 'l_town', minutes: 20 }     // no such exit → skipped
    ] });
    assert.equal(findings.length, 2, 'a time was proposed for a connection that does not exist');
    assert(findings.every(f => f.type === 'set_travel_time'));

    const stated = houseWorld();
    stated.locations[0].exits[0].travelTime = 5;
    assert.deepEqual(structure(stated, { travel: [{ from: 'l_house', to: 'l_bath', minutes: 99 }] }), [],
        'an already-stated travel time was overwritten');
});

test('applying travel time preserves the exit and its direction', () => {
    const world = houseWorld();
    const finding = structure(world, { travel: [{ from: 'l_bath', to: 'l_house', minutes: 1 }] })[0];
    assert.equal(context.applyCalibrationFinding(world, finding), true);
    const exit = world.locations.find(l => l.id === 'l_bath').exits[0];
    assert.equal(exit.travelTime, 1);
    assert.equal(context.getExitTargetName(exit), 'Smith House', 'the exit target was mangled');
    assert.equal(context.applyCalibrationFinding(world, finding), false, 'a stated time was overwritten on re-apply');
});

test('the pass is idempotent — a second run proposes nothing', () => {
    const world = houseWorld();
    const payload = { locations: [{ id: 'l_bath', role: 'room', inside: 'l_house', floor: '2' },
                                  { id: 'l_shed', connect_to: 'l_house' }],
                      travel: [{ from: 'l_bath', to: 'l_house', minutes: 1 }] };
    structure(world, payload).forEach(f => context.applyCalibrationFinding(world, f));
    assert.deepEqual(structure(world, payload), [], 'the pass proposed the same changes twice');
});

test('nonsense from the model is discarded, not applied', () => {
    const world = houseWorld();
    assert.deepEqual(structure(world, { locations: [{ id: 'nope', role: 'room' }] }), [],
        'a location that does not exist was accepted');
    assert.deepEqual(structure(world, { locations: [{ id: 'l_bath', role: 'teleporter' }] }), [],
        'an invented map role was accepted');
    assert.deepEqual(structure(world, { locations: [{ id: 'l_bath', inside: 'l_bath' }] }), [],
        'a place was put inside itself');
    assert.deepEqual(structure(world, { travel: [{ from: 'l_house', to: 'l_bath', minutes: -5 }] }), [],
        'a negative travel time was accepted');
    [null, {}, { locations: 'x' }, { travel: 42 }].forEach(payload =>
        assert.doesNotThrow(() => structure(world, payload), `threw on ${JSON.stringify(payload)}`));
});

test('the calibration reply parser tolerates every shape a model returns', () => {
    const target = { locations: [{ id: 'l_bath', role: 'room' }] };
    const json = JSON.stringify(target);
    assert.deepEqual(context.parseCalibrationPayload(json), target);
    assert.deepEqual(context.parseCalibrationPayload('```json\n' + json + '\n```'), target);
    assert.deepEqual(context.parseCalibrationPayload('Here you go:\n' + json), target);
    assert.deepEqual(context.parseCalibrationPayload('<calibration_json>' + json + '</calibration_json>'), target);
    assert.equal(context.parseCalibrationPayload('I could not comply.'), null);
    assert.equal(context.parseCalibrationPayload('{"unrelated":1}'), null,
        'an object with no calibration arrays was accepted');
});

test('a reasoning model\'s reply is parsed, not defeated by its thinking', () => {
    const target = { locations: [{ id: 'l_bath', role: 'room' }] };
    const json = JSON.stringify(target);
    // Thinking blocks containing braces, before the real answer.
    assert.deepEqual(context.parseCalibrationPayload(
        '<think>Let me consider {the bathroom} and {the hall}. Maybe {"role":"area"}?</think>\n' + json),
        target, 'braces inside a thinking block defeated the parser');
    assert.deepEqual(context.parseCalibrationPayload(
        '<reasoning>{ nonsense }</reasoning>```json\n' + json + '\n```'), target);
    // Prose containing an unrelated object before the payload.
    assert.deepEqual(context.parseCalibrationPayload(
        'First I considered {"a":1}, which was wrong. Final answer:\n' + json),
        target, 'an unrelated object earlier in the reply defeated the parser');
    // Trailing commentary after the payload.
    assert.deepEqual(context.parseCalibrationPayload(json + '\n\nHope that helps! {done}'), target);
    // Two fenced blocks, only the second usable.
    assert.deepEqual(context.parseCalibrationPayload(
        '```json\n{"notes":"draft"}\n```\nand the answer:\n```json\n' + json + '\n```'), target);
});

test('the pass is shaped the way real providers actually need', () => {
    // A system-only conversation returns nothing on many providers, and a
    // reasoning model narrates past a small budget before emitting any JSON.
    const source = asyncFunctionSource('runCalibrationBatch');
    assert(/role: 'user'/.test(source), 'no user turn is sent — many models reply with nothing');
    assert(/max_tokens: 16000/.test(source), 'the budget is too small for a batch\'s answer');
    assert(/response_format/.test(source), 'JSON mode is never requested');
    assert(/not support|json_object/i.test(source), 'a model that rejects JSON mode is not accommodated');
    assert(/extraNudge/.test(source), 'there is no strict retry when the first reply is unparseable');
    assert(/message\.reasoning/.test(source), 'a reply delivered only in the reasoning field is discarded');
    assert(/finish_reason/.test(source), 'truncation is not detected, so it cannot be explained');
    assert(/Full raw reply/.test(source), 'the raw reply is never surfaced, making failures undiagnosable');
});

test('the prompt forbids thinking out loud and offers a place for reasoning', () => {
    const prompt = context.buildCalibrationPrompt(houseWorld(), 'structure');
    assert(/first character you write must be \{/i.test(prompt), 'nothing pins the reply to start with JSON');
    assert(/do not reason in the open/i.test(prompt), 'the model is not told to stop narrating');
    assert(/"why" field/.test(prompt), 'the model has nowhere legitimate to put its reasoning');
});

// -------------------------------------------------- Tier 2: the people pass

function castWorld() {
    return {
        id: 'w', name: 'Ashford', startLocationId: 'l_square', contextSize: 32768,
        locations: [
            { id: 'l_square', name: 'Village Square', description: 'Cobbles and a well.', exits: [] },
            { id: 'l_tavern', name: 'The Tavern', description: 'Low beams.', exits: [] },
            { id: 'l_mill',   name: 'The Mill',   description: 'The wheel turns.', exits: [] }
        ],
        entities: [
            { id: 'e_mara', name: 'Mara', type: 'npc', isMajor: true, description: 'The innkeeper.' },
            { id: 'e_tom',  name: 'Tom',  type: 'npc', description: 'The miller.' },
            { id: 'e_relic', name: 'Old Sword', type: 'item', description: 'Rusted.' }
        ]
    };
}
const people = (world, payload) => context.calibrationFindingsFromPeople(world, payload);
const FULL = {
    id: 'e_mara', start: 'l_tavern', home: 'l_tavern',
    persona: 'Warm, unhurried, watches the door.',
    schedule: [{ time: '18:00', location: 'l_tavern', activity: 'working the bar' },
               { time: '06:00', location: 'l_tavern', activity: 'baking' }],
    goal: 'keep the village safe', beats: ['oiled the old sword', 'asked the carters about the road'],
    next_goals: ['stand a proper watch'], autonomy: 'high', difficulty: 40, why: 'she is the innkeeper'
};

test('the people prompt describes cast and places, and forbids invention', () => {
    const prompt = context.buildCalibrationPrompt(castWorld(), 'people');
    assert(/\[e_mara\]/.test(prompt) && /depth=core/.test(prompt), 'the cast is not described');
    assert(/\[l_tavern\]/.test(prompt), 'the places are not listed, so it cannot place anyone');
    assert(/has nothing set/.test(prompt), 'the model cannot tell what is already authored');
    assert(/not invent a different character/i.test(prompt), 'nothing stops it rewriting the cast');
    assert(/first character you write must be \{/i.test(prompt), 'the reply is not pinned to JSON');
});

test('a full proposal becomes one finding per concern', () => {
    const findings = people(castWorld(), { people: [FULL] });
    assert.deepEqual(findings.map(f => f.type).sort(),
        ['set_agenda', 'set_entity_home', 'set_entity_location', 'set_persona', 'set_schedule']);
    assert(findings.every(f => f.tier === 'people' && f.title && f.detail));
});

test('applying an agenda brings its beats, pool, autonomy and difficulty with it', () => {
    const world = castWorld();
    const finding = people(world, { people: [FULL] }).find(f => f.type === 'set_agenda');
    assert.equal(context.applyCalibrationFinding(world, finding), true);
    const mara = world.entities.find(e => e.id === 'e_mara');
    assert.equal(mara.goal, 'keep the village safe');
    assert.deepEqual(mara.goalSteps, FULL.beats);
    assert.deepEqual(mara.goalPool, FULL.next_goals);
    assert.equal(mara.goalAutonomy, 'high');
    assert.equal(mara.goalDifficulty, 40);
});

test('a schedule is sorted and only applied when every block is usable', () => {
    const world = castWorld();
    const finding = people(world, { people: [FULL] }).find(f => f.type === 'set_schedule');
    assert.deepEqual(finding.patch.schedule.map(b => b.time), ['06:00', '18:00'], 'blocks were not ordered');
    assert.equal(context.applyCalibrationFinding(world, finding), true);
    assert.equal(world.entities.find(e => e.id === 'e_mara').schedule.length, 2);

    // Impossible times and unknown places are dropped, not smuggled through.
    const dirty = people(castWorld(), { people: [{ id: 'e_mara', schedule: [
        { time: '25:99', location: 'l_tavern' }, { time: 'noon', location: 'l_tavern' },
        { time: '09:00', location: 'l_nowhere' }, { time: '07:00', location: 'l_mill', activity: 'ok' }
    ] }] }).find(f => f.type === 'set_schedule');
    assert.deepEqual(dirty.patch.schedule, [{ time: '07:00', locationId: 'l_mill', activity: 'ok' }]);
});

test('every person can receive a persona regardless of simulation depth', () => {
    const findings = people(castWorld(), { people: [
        { id: 'e_mara', persona: 'Warm and watchful.' },
        { id: 'e_tom',  persona: 'Gruff and tired.' }
    ] });
    assert.equal(findings.filter(f => f.type === 'set_persona').length, 2,
        'a background person was left as a blank mannequin');
    assert(findings.some(f => /Mara/.test(f.title)) && findings.some(f => /Tom/.test(f.title)));
});

test('items are enriched in their own pass without human fields', () => {
    const world = castWorld();
    const findings = context.calibrationFindingsFromItems(world, { items: [{
        id: 'e_relic', location: 'l_tavern', tags: ['weapon', 'relic']
    }] });
    assert.deepEqual(findings.map(f => f.type).sort(), ['set_entity_location', 'set_entity_tags']);
    assert(!/persona|schedule|home/i.test(context.buildCalibrationPrompt(world, 'items').split('OUTPUT FORMAT')[1]),
        'the item schema still treats objects like people');
});

test('authored values are never overwritten', () => {
    const world = castWorld();
    Object.assign(world.entities[0], {
        startLocation: 'l_mill', homeLocation: 'l_mill', persona: 'Mine.',
        schedule: [{ time: '08:00', locationId: 'l_mill' }], goal: 'my own aim', goalSteps: ['my beat']
    });
    assert.deepEqual(people(world, { people: [FULL] }), [],
        'the pass proposed overwriting the author');
});

test('beats are offered for an existing agenda that has none', () => {
    const world = castWorld();
    world.entities[0].goal = 'keep the village safe';   // authored aim, no steps
    const findings = people(world, { people: [FULL] });
    const beats = findings.find(f => f.type === 'set_beats');
    assert(beats, 'an agenda with no concrete steps was left vague');
    assert.equal(context.applyCalibrationFinding(world, beats), true);
    assert.deepEqual(world.entities[0].goalSteps, FULL.beats);
    assert.equal(world.entities[0].goal, 'keep the village safe', 'the authored aim was replaced');
});

test('the pass is idempotent and refuses nonsense', () => {
    const world = castWorld();
    people(world, { people: [FULL] }).forEach(f => context.applyCalibrationFinding(world, f));
    assert.deepEqual(people(world, { people: [FULL] }), [], 'the same changes were proposed twice');

    const fresh = castWorld();
    assert.deepEqual(people(fresh, { people: [{ id: 'nobody', start: 'l_tavern' }] }), [],
        'a character that does not exist was accepted');
    assert.deepEqual(people(fresh, { people: [{ id: 'e_relic', start: 'l_tavern' }] }), [],
        'an item was treated as a character');
    assert.deepEqual(people(fresh, { people: [{ id: 'e_mara', start: 'l_atlantis' }] }), [],
        'a location that does not exist was accepted');
    assert.deepEqual(people(fresh, { people: [{ id: 'e_mara', autonomy: 'godlike', difficulty: 999 }] }), [],
        'invented autonomy and out-of-range difficulty produced a finding');
    [null, {}, { people: 'x' }, { people: [null, 42] }].forEach(payload =>
        assert.doesNotThrow(() => people(fresh, payload), `threw on ${JSON.stringify(payload)}`));
});

test('both passes are offered, and the parser accepts a people reply', () => {
    const passes = app.match(/const CALIBRATION_PASSES = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
    assert(/structure:/.test(passes) && /people:/.test(passes), 'a pass is missing from the panel');
    assert.deepEqual(
        context.parseCalibrationPayload('{"people":[{"id":"e_mara"}]}'),
        { people: [{ id: 'e_mara' }] }, 'a people reply is not recognised as calibration output');
});

// ------------------------------- one model for every structured pass

test('every structured caller routes through the chosen model', () => {
    // Narration and JSON want opposite models. Three separate features have
    // already failed by using the storytelling model for structured work.
    ['runCalibrationPass', 'runWorldAgent'].forEach(name => {
        const source = app.slice(app.indexOf(`async function ${name}(`));
        assert(/structuredModelFor\(world\)/.test(source.slice(0, 3000)),
            `${name} does not use the audit model`);
    });
    const audit = app.slice(app.indexOf('async function runAIWorldAudit('));
    assert(/structuredModelFor\(world\)/.test(audit.slice(0, 4000)),
        'the Deep Audit does not use the audit model');
    assert(/recoverWorldLedgerEntry\(structuredModelFor\(world\)/.test(app),
        'the chronicle classifier still uses the narration model');
});

test('the fallback chain never leaves the model empty', () => {
    const source = functionSource('structuredModelFor');
    assert(/globalSettings\?\.structuredModel/.test(source), 'the explicit choice is not read first');
    assert(/normalizeWorldAgentConfig/.test(source), 'the World Agent model is not consulted');
    assert(/world\?\.model/.test(source), "the world's own model is not consulted");
    assert(/defaultModel/.test(source), 'there is no final fallback');
});

test('the offered models come from the live catalog, never a hand-written list', () => {
    // A list written from memory goes stale the moment a provider retires a
    // slug: "No endpoints found for anthropic/claude-3-5-haiku" was an id that
    // had never existed in that form. Nothing may be hardcoded here again.
    assert(!/STRUCTURED_MODEL_SUGGESTIONS/.test(app),
        'the hardcoded suggestion list is back — it will go stale and offer dead ids');
    const wiring = functionSource('wireCalibrationControls');
    assert(/getOpenRouterModels\(\)/.test(wiring),
        'the picker does not read the live catalog');
    assert(/rankStructuredModels\(/.test(wiring), 'the catalog is never filtered for this job');
});

test('only models that can actually do the job are offered', () => {
    const catalog = [
        { id: 'good/cheap', name: 'Cheap', context_length: 128000,
          supported_parameters: ['response_format'], pricing: { prompt: '0.0000001', completion: '0.0000004' } },
        { id: 'good/pricey', name: 'Pricey', context_length: 200000,
          supported_parameters: ['structured_outputs'], pricing: { prompt: '0.00001', completion: '0.00003' } },
        { id: 'bad/batch:batch', name: 'Batch only', context_length: 200000,
          supported_parameters: ['structured_outputs'], pricing: { prompt: '0.000001', completion: '0.000002' } },
        { id: 'good/reasoning-capable', name: 'Reasoner', context_length: 200000,
          supported_parameters: ['response_format', 'reasoning'], pricing: { prompt: '0.0000001', completion: '0.0000002' } },
        { id: 'bad/no-json', name: 'No JSON', context_length: 200000,
          supported_parameters: ['temperature'], pricing: { prompt: '0.0000001', completion: '0.0000002' } },
        { id: 'bad/tiny-context', name: 'Tiny', context_length: 8192,
          supported_parameters: ['response_format'], pricing: { prompt: '0.0000001', completion: '0.0000002' } },
        { id: 'bad/no-price', name: 'Unpriced', context_length: 200000,
          supported_parameters: ['response_format'], pricing: {} },
        // Cheap, JSON-capable, and answers in audio. Sorting by price alone put
        // two of these at the very top of the list.
        { id: 'bad/music', name: 'Music', context_length: 1000000,
          architecture: { output_modalities: ['text', 'audio'] },
          supported_parameters: ['response_format'], pricing: { prompt: '0', completion: '0' } }
    ];
    const ranked = context.rankStructuredModels(catalog);
    const ids = ranked.map(model => model.id);
    assert.deepEqual(ids.sort(), ['good/cheap', 'good/pricey', 'good/reasoning-capable'],
        'the picker hid a modern reasoning-capable JSON model, or offered a model that cannot do the job');
    assert(/\$/.test(ranked[0].note) && /ctx/.test(ranked[0].note),
        'the author cannot see what a choice costs or whether the world fits');
});

test('a free model is labelled as free rather than $0.000', () => {
    const ranked = context.rankStructuredModels([{ id: 'free/model', context_length: 64000,
        supported_parameters: ['response_format'], pricing: { prompt: '0', completion: '0' } }]);
    assert.equal(ranked[0].note.startsWith('free'), true, `a free model reads as "${ranked[0].note}"`);
});

test('a model that reports no modality at all is still offered', () => {
    // Older catalog entries omit architecture entirely; excluding them would
    // quietly shrink the list for no reason.
    const ranked = context.rankStructuredModels([{ id: 'legacy/model', context_length: 64000,
        supported_parameters: ['response_format'], pricing: { prompt: '0.000001', completion: '0.000002' } }]);
    assert.deepEqual(ranked.map(m => m.id), ['legacy/model']);
});

test('an unreachable catalog degrades to typing an id, not to dead options', () => {
    assert.deepEqual(context.rankStructuredModels(null), []);
    assert.deepEqual(context.rankStructuredModels([]), []);
    assert.deepEqual(context.rankStructuredModels([null, 42, {}]), []);
    const wiring = functionSource('wireCalibrationControls');
    assert(/Could not reach the .*catalog/.test(wiring),
        'an offline author is left staring at "Loading models…" forever');
});

test('a model the author typed survives the list being refreshed', () => {
    const wiring = functionSource('wireCalibrationControls');
    assert(/\(typed\)/.test(wiring),
        'a choice the catalog no longer ranks would silently reset to blank');
});

test('the list can be refetched without reloading the app', () => {
    const wiring = functionSource('wireCalibrationControls');
    assert(/structured-model-refresh/.test(wiring), 'there is no way to refresh a stale catalog');
    assert(/openRouterModels = \[\]/.test(wiring), 'refreshing would just return the cached list');
});

test('a complete Society reply is actually accepted by the parser', () => {
    // It was not. `usable()` only recognised locations/travel/people, so a
    // perfect Society answer was rejected as unusable and reported as a model
    // failure. The pass could never have worked, at any size, on any model —
    // and it went unnoticed because the findings builder was tested directly,
    // skipping the parser entirely.
    const reply = JSON.stringify({
        relationships: [{ a: 'e1', b: 'e2', label: 'sister', score: 60, reason: 'kin' }],
        places: [{ id: 'l1', danger: 20, prosperity: 60 }],
        factions: [], memberships: []
    });
    const parsed = context.parseCalibrationPayload(reply);
    assert(parsed, 'a valid Society reply is still rejected');
    assert.equal(parsed.relationships.length, 1);
});

test('every pass\'s reply shape is recognised', () => {
    [['structure', { locations: [] }], ['structure', { travel: [] }],
     ['people', { people: [] }], ['society', { relationships: [] }],
     ['society', { places: [] }], ['society', { factions: [] }],
     ['society', { memberships: [] }]].forEach(([pass, shape]) => {
        assert(context.parseCalibrationPayload(JSON.stringify(shape)),
            `the ${pass} pass shape ${JSON.stringify(shape)} is rejected`);
    });
});

test('a reply cut off mid-flight keeps every entry the model finished', () => {
    // Exactly the shape reported: clean JSON from the first character, cut at
    // the token limit. Discarding it wasted a paid call and blamed the model.
    const cut = '{"relationships":[{"a":"ent_bree","b":"ent_178","label":"sister","score":60,"reason":"share a home"},'
        + '{"a":"ent_178","b":"ent_233","label":"daughter","score":70,"reason":"kin"},'
        + '{"a":"ent_233","b":"ent_9","label":"neigh';
    const parsed = context.parseCalibrationPayload(cut);
    assert(parsed, 'a truncated reply was thrown away whole');
    assert.equal(parsed.relationships.length, 2,
        'the complete entries were not recovered, or a partial one was invented');
    assert.equal(parsed.relationships[1].label, 'daughter');
});

test('a salvaged reply is flagged, so the author is told', () => {
    const cut = '{"places":[{"id":"l1","danger":10,"prosperity":50},{"id":"l2","dang';
    assert.equal(context.parseCalibrationPayload(cut).__truncated, true,
        'a partial result would be presented as if it were the whole answer');
});

test('a truncated reply with nothing complete in it is not guessed at', () => {
    ['{"relationships":[{"a":"ent_bree","b":"ent_1', '{"relationships":[', '{"relat', '{'].forEach(cut => {
        assert.equal(context.parseCalibrationPayload(cut), null,
            `half an entry was accepted from ${JSON.stringify(cut)}`);
    });
});

test('salvage never invents a field or reorders what survived', () => {
    const whole = { relationships: [{ a: 'e1', b: 'e2', label: 'sister', score: 60, reason: 'kin' }] };
    const cut = JSON.stringify(whole).replace(/\}\]\}$/, '},{"a":"e3","b":"e4","lab');
    const parsed = context.parseCalibrationPayload(cut);
    delete parsed.__truncated;
    assert.deepEqual(parsed, whole, 'salvage changed the entries it recovered');
});

// --- batching: the reason a large world failed ------------------------------

function bigWorld(npcs, locations) {
    const world = { id: 'w', name: 'Big', entities: [], locations: [], factions: [] };
    for (let i = 0; i < locations; i++) world.locations.push({ id: `l${i}`, name: `Place ${i}`, exits: [] });
    for (let i = 0; i < npcs; i++) {
        world.entities.push({ id: `e${i}`, name: `Person ${i}`, type: 'npc', description: 'Someone.' });
    }
    return world;
}

test('a large world is cut into batches instead of sent in one call', () => {
    const world = bigWorld(60, 200);
    ['structure', 'people', 'society'].forEach(pass => {
        const batches = context.calibrationBatches(world, pass);
        assert(batches.length > 1, `the ${pass} pass would still send everything in one call`);
        const size = context.CALIBRATION_BATCH_SIZES[pass];
        batches.forEach((batch, index) =>
            assert(batch.length <= size,
                `${pass} batch ${index + 1} holds ${batch.length} units, past the ${size} it is sized for`));
    });
});

test('batching covers every unit exactly once', () => {
    const world = bigWorld(37, 91);
    ['structure', 'people', 'society'].forEach(pass => {
        const units = context.calibrationWorkUnits(world, pass);
        const batched = context.calibrationBatches(world, pass).flat();
        assert.equal(batched.length, units.length,
            `the ${pass} pass would skip or repeat work`);
    });
});

test('a small world still runs in a single call', () => {
    const world = bigWorld(4, 6);
    assert.equal(context.calibrationBatches(world, 'people').length, 1,
        'a tiny world was split into several paid calls for no reason');
});

test('each batch asks for an answer that fits in one reply', () => {
    // The failure was output size, so this is the number that matters: a batch
    // must not provoke more JSON than a model is willing to write.
    const world = bigWorld(60, 200);
    ['structure', 'people', 'society'].forEach(pass => {
        const batches = context.calibrationBatches(world, pass);
        const prompt = context.buildCalibrationPrompt(world, pass, batches[0]);
        assert(prompt, `the ${pass} pass produced no prompt for its first batch`);
        // Roughly 4 chars per token; the reply is bounded by the batch size,
        // and the prompt itself must stay well inside a small context window.
        assert(prompt.length < 40000,
            `a single ${pass} batch prompt is ${prompt.length} characters`);
    });
});

test('a society batch carries only its own slice of the work', () => {
    const world = bigWorld(30, 60);
    const batches = context.calibrationBatches(world, 'society');
    const digest = context.calibrationSocietyDigest(world, batches[0]);
    const pairLines = (digest.pairs.match(/^\d+\. /gm) || []).length;
    const placeLines = (digest.places.match(/^- \[/gm) || []).length;
    assert.equal(pairLines + placeLines, batches[0].length,
        'a batch asked about more than it was given');
});

test('the runner keeps going when one batch fails', () => {
    const source = asyncFunctionSource('runCalibrationPass');
    assert(/catch \(error\)/.test(source), 'one failed batch would sink the whole pass');
    assert(/failures\.push/.test(source), 'a failure is swallowed without being counted');
    assert(/if \(!findings\.length && failures\.length\) throw/.test(source),
        'a pass where everything failed would report success with no findings');
    assert(/onProgress/.test(source), 'the author watches a frozen spinner on a large world');
});

test('a partial result says so rather than passing itself off as complete', () => {
    const source = asyncFunctionSource('runCalibrationPass');
    assert(/cut short/.test(source) && /batches failed/.test(source),
        'the author is not told that some of the world went unexamined');
});

// --- the error message that sent the author after the wrong thing -----------

test('a reply that began as JSON is not blamed on the model reasoning', () => {
    const source = asyncFunctionSource('runCalibrationBatch');
    assert(/\^\\s\*\[\{\\\[\]/.test(source) || /test\(raw\)/.test(source),
        'truncation mid-JSON is not distinguished from a model that never emitted any');
    assert(!/talked itself past the token limit before producing any JSON/.test(app),
        'the message that blamed a correctly-answering model is still there');
});

test('the budget leaves room for a whole batch', () => {
    const source = asyncFunctionSource('runCalibrationBatch');
    const budget = Number((source.match(/max_tokens:\s*(\d+)/) || [])[1]);
    assert(budget >= 16000, `the output budget is ${budget}, too small for a batch's answer`);
});

// --- ranking now reflects what actually failed ------------------------------

test('a model that cannot write enough to finish a batch is not offered', () => {
    const catalog = [
        { id: 'big/enough', context_length: 128000, top_provider: { max_completion_tokens: 16000 },
          supported_parameters: ['response_format'], pricing: { prompt: '0.0000002', completion: '0.0000006' } },
        { id: 'tiny/output', context_length: 200000, top_provider: { max_completion_tokens: 4096 },
          supported_parameters: ['response_format'], pricing: { prompt: '0.00000001', completion: '0.00000002' } }
    ];
    const ids = context.rankStructuredModels(catalog).map(m => m.id);
    assert(ids.includes('big/enough'));
    assert(!ids.includes('tiny/output'),
        'a model that can only write 4k tokens is still offered, and will truncate every batch');
});

test('capability outranks cheapness', () => {
    const catalog = [
        { id: 'small/cheapest', context_length: 33000, top_provider: { max_completion_tokens: 8192 },
          supported_parameters: ['response_format'], pricing: { prompt: '0', completion: '0' } },
        { id: 'solid/dearer', context_length: 131000, top_provider: { max_completion_tokens: 32000 },
          supported_parameters: ['response_format'], pricing: { prompt: '0.0000002', completion: '0.0000008' } }
    ];
    assert.equal(context.rankStructuredModels(catalog)[0].id, 'solid/dearer',
        'the cheapest, smallest model is recommended first — those are the ones that lose a long answer');
});

test('the author can see the output ceiling, since that is what was failing', () => {
    const ranked = context.rankStructuredModels([{ id: 'a/b', context_length: 131000,
        top_provider: { max_completion_tokens: 16384 },
        supported_parameters: ['response_format'], pricing: { prompt: '0.0000002', completion: '0.0000006' } }]);
    assert(/out/.test(ranked[0].note), `the note "${ranked[0].note}" does not mention output capacity`);
});

test('a model that states no output ceiling is still offered', () => {
    const ranked = context.rankStructuredModels([{ id: 'legacy/model', context_length: 64000,
        supported_parameters: ['response_format'], pricing: { prompt: '0.000001', completion: '0.000002' } }]);
    assert.deepEqual(ranked.map(m => m.id), ['legacy/model'],
        'models that omit max_completion_tokens were excluded, shrinking the list for no reason');
});

let failures = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log(`✓ ${name}`); }
    catch (error) { failures++; console.error(`✗ ${name}\n  ${error.message}`); }
}
if (failures) {
    console.error(`\n${failures} calibration check(s) failed.`);
    process.exit(1);
}
console.log(`\n${tests.length} calibration checks passed.`);
