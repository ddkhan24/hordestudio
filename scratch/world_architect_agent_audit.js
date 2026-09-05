/** Regression checks for the staged existing-world Architect Agent. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { buildContext } = require('./app_source.js');
const appSource = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');

const context = { console: { log() {}, warn() {}, error() {} } };
buildContext(vm, [
    'worldArchitectRequestedCounts', 'defaultWorldArchitectPlan', 'normalizeWorldArchitectPlan',
    'normalizeWorldArchitectOperation', 'worldArchitectOperationCounts', 'applyWorldArchitectOperation', 'worldArchitectFingerprint',
    'worldArchitectCountRecords', 'stageWorldArchitectJob', 'removeWorldGroupRecord', 'mergeWorldGroupRecords',
    'parseWorldArchitectJSON', 'worldArchitectResponseCandidates', 'worldArchitectOperationArray'
], context);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const world = () => ({
    id: 'w', name: 'Test World', authoringRevision: 0,
    regions: [{ id: 'reg_city', name: 'City', description: 'A city.', tags: ['city'] }],
    locations: [{ id: 'loc_inn', name: 'Inn', description: 'An inn.', regionId: 'reg_city', mapType: 'building', tags: ['inn'], exits: [] }],
    entities: [], groups: [], factions: [], lorebook: [], startLocationId: 'loc_inn'
});

test('literal scale is preserved and divided into bounded batches', () => {
    const plan = context.defaultWorldArchitectPlan(world(), 'Add 100 rooms and 7 characters.', { batchSize: 12 });
    assert.equal(plan.requestedCounts.rooms, 100);
    assert.equal(plan.requestedCounts.people, 7);
    assert.equal(plan.batches.reduce((sum, batch) => sum + (batch.expectedCounts.rooms || 0), 0), 100);
    assert.equal(plan.batches.reduce((sum, batch) => sum + (batch.expectedCounts.people || 0), 0), 7);
    assert(plan.batches.every(batch => Object.values(batch.expectedCounts).every(value => value <= 12)));
});

test('a planner cannot silently shrink an exact request', () => {
    const fallback = context.defaultWorldArchitectPlan(world(), 'Add 100 rooms.', { batchSize: 12 });
    const bad = { title: 'Smaller', batches: [{ label: 'Only ten', instruction: 'Ten', expectedCounts: { rooms: 10 } }] };
    const plan = context.normalizeWorldArchitectPlan(bad, fallback);
    assert.equal(plan.batches.reduce((sum, batch) => sum + (batch.expectedCounts.rooms || 0), 0), 100);
});

test('semantic planner labels cannot inherit unrelated exact counts by position', () => {
    const fallback = context.defaultWorldArchitectPlan(world(), 'Add 7 characters and establish their family structure.', { batchSize: 12 });
    const semantic = { title: 'Family plan', summary: 'Build the family', batches: [
        { label: 'Establish family structure', instruction: 'Add households and relationships.', expectedCounts: { people: 7 } }
    ] };
    const plan = context.normalizeWorldArchitectPlan(semantic, fallback);
    assert.match(plan.batches[0].label, /7 people/);
    assert.match(plan.batches[0].instruction, /Create exactly 7 new people/);
});

test('deletion and unknown free-form mutations are rejected at the boundary', () => {
    assert.equal(context.normalizeWorldArchitectOperation({ type: 'delete_location', targetId: 'loc_inn' }), null);
    assert.equal(context.normalizeWorldArchitectOperation({ type: 'replace_world', record: {} }), null);
});

test('group editing operations are typed while destructive world operations remain rejected', () => {
    assert.equal(context.normalizeWorldArchitectOperation({ type: 'update_group', targetId: 'grp_a' }).type, 'update_group');
    assert.equal(context.normalizeWorldArchitectOperation({ type: 'merge_groups', from: 'grp_a', to: 'grp_b' }).type, 'merge_groups');
    assert.equal(context.normalizeWorldArchitectOperation({ type: 'delete_group', targetId: 'grp_a' }).type, 'delete_group');
    assert.equal(context.normalizeWorldArchitectOperation({ type: 'delete_character', targetId: 'npc_a' }), null);
});

test('Architect normalizes common model vocabulary and flattened records', () => {
    const household = context.normalizeWorldArchitectOperation({ operation: 'add_household', id: 'grp_ash', name: 'Ash Family', description: 'A household.' });
    assert.equal(household.type, 'add_group');
    assert.equal(household.record.name, 'Ash Family');
    assert.equal(household.record.type, 'household');
    const person = context.normalizeWorldArchitectOperation({ action: 'create', entityType: 'npc', id: 'npc_ana', name: 'Ana', persona: 'Direct and loyal.' });
    assert.equal(person.type, 'add_character');
    assert.equal(person.record.persona, 'Direct and loyal.');
    const room = context.normalizeWorldArchitectOperation({ type: 'create_room', record: { id: 'loc_den', name: 'Den' } });
    assert.equal(room.type, 'add_location');
    assert.equal(room.record.mapType, 'room');
    const genericRoom = context.normalizeWorldArchitectOperation({ action: 'create', entityType: 'room', id: 'loc_attic', name: 'Attic' });
    assert.equal(genericRoom.type, 'add_location');
    assert.equal(genericRoom.record.mapType, 'room');
});

test('Architect repairs split and already-staged add records with meaningful IDs', () => {
    const split = context.normalizeWorldArchitectOperation({
        type: 'add_character', record: { id: 'ent_tony' }, fields: { name: 'Tony Mercer', persona: 'Patient and watchful.' }
    });
    assert.equal(split.record.name, 'Tony Mercer');
    assert.equal(split.record.persona, 'Patient and watchful.');
    const staged = context.normalizeWorldArchitectOperation({ type: 'add_character', id: 'ent_celeste', record: {} });
    assert.equal(staged.record.name, 'Celeste');
    const wrapped = context.normalizeWorldArchitectOperation({ type: 'add_character', character: { id: 'ent_aunt_birdie', name: 'Aunt Birdie' } });
    assert.equal(wrapped.record.name, 'Aunt Birdie');
    const opaque = context.normalizeWorldArchitectOperation({ type: 'add_character', id: 'npc_07', record: {} });
    assert.equal(opaque.record.name || '', '', 'opaque numeric IDs must not invent a character name');
});

test('the exact failed eight-character review can be staged after repair', () => {
    const ids = ['ent_tony', 'ent_celeste', 'ent_aunt_birdie', 'ent_winston_pike', 'ent_the_stranger', 'ent_greg_morrison', 'ent_karen_morrison', 'ent_chad_brooks'];
    const staged = context.stageWorldArchitectJob(world(), {
        options: { policy: 'fill_gaps' }, dismissed: [],
        operations: ids.map(id => ({ type: 'add_character', id, record: {} })),
        plan: { requestedCounts: { people: 8 } }
    });
    assert.equal(staged.deltas.people, 8);
    assert.equal(staged.blockers.length, 0, staged.blockers.join('\n'));
    assert.equal(staged.world.entities[0].name, 'Tony');
    assert.equal(staged.world.entities[7].name, 'Chad Brooks');
});

test('pre-existing world defects do not deadlock unrelated staged changes', () => {
    const draft = world();
    draft.locations[0].exits = [{ targetLocationId: 'Main Dock', text: 'to Main Dock' }];
    const staged = context.stageWorldArchitectJob(draft, {
        options: { policy: 'fill_gaps' }, dismissed: [],
        operations: [{ type: 'add_character', record: { id: 'npc_greta', name: 'Greta Voss', description: 'Concierge.' } }],
        plan: { requestedCounts: { people: 1 } }
    });
    assert.equal(staged.deltas.people, 1);
    assert.equal(staged.blockers.length, 0, staged.blockers.join('\n'));
    assert(staged.existingIssues.some(item => /Main Dock/.test(item)));
    assert(staged.warnings.every(Boolean), 'validation rendered an empty warning');
});

test('defects introduced by a proposed operation still block apply', () => {
    const staged = context.stageWorldArchitectJob(world(), {
        options: { policy: 'fill_gaps' }, dismissed: [],
        operations: [{ type: 'add_character', record: { id: 'npc_bad', name: 'Bad Reference', startLocation: 'loc_missing' } }],
        plan: { requestedCounts: { people: 1 } }
    });
    assert(staged.blockers.some(item => /Missing location/.test(item)));
});

test('staging resolves out-of-order dependencies inside one generated batch', () => {
    const staged = context.stageWorldArchitectJob(world(), {
        options: { policy: 'fill_gaps' }, dismissed: [],
        operations: [
            { type: 'add_relationship', a: 'npc_ana', b: 'npc_ben', label: 'siblings' },
            { type: 'add_character', record: { id: 'npc_ana', name: 'Ana', groups: 'Vale Family', household: 'Vale Family', tags: 'guest, family' } },
            { type: 'add_character', record: { id: 'npc_ben', name: 'Ben', groupIds: ['grp_vale'], goalSteps: 'arrive, investigate' } },
            { type: 'add_group', record: { id: 'grp_vale', name: 'Vale Family', type: 'household', homeLocationId: 'loc_inn' } }
        ],
        plan: { requestedCounts: { people: 2, groups: 1 } }
    });
    assert.equal(staged.blockers.length, 0, staged.blockers.join('\n'));
    assert.equal(staged.world.relationships.length, 1);
    assert.equal(staged.world.entities[0].householdId, 'grp_vale');
    assert.deepEqual(Array.from(staged.world.entities[1].goalSteps), ['arrive', 'investigate']);
    assert.equal(staged.world.groups[0].homeLocationId, 'loc_inn');
});

test('relationship authoring uses a searchable picker with button and Enter support', () => {
    assert.match(appSource, /class="form-input ent-add-relation-search" list=/);
    assert.match(appSource, /class="tool-btn ent-add-relation-btn"/);
    assert.match(appSource, /relationSearch\.onkeydown/);
    assert.match(appSource, /event\.key !== 'Enter'/);
    assert.doesNotMatch(appSource, /class="form-select ent-add-relation"/);
});

test('Architect parser accepts fenced JSON and prose-wrapped reasoning output', () => {
    const fenced = context.parseWorldArchitectJSON('Here is the plan:\n```json\n{"batches":[{"label":"Cast"}]}\n```', 'batches');
    assert.equal(fenced.batches[0].label, 'Cast');
    const reasoned = context.parseWorldArchitectJSON('I considered {"risk":"low"}. Final answer: {"operations":[{"type":"add_group","record":{"name":"House Vale"}}]}', 'operations');
    assert.equal(reasoned.operations[0].type, 'add_group');
});

test('Architect parser accepts bare arrays and nested provider wrappers', () => {
    const bare = context.parseWorldArchitectJSON('[{"type":"add_lore","keyword":"moon"}]', 'operations');
    assert.equal(bare.operations.length, 1);
    const wrapped = context.parseWorldArchitectJSON({ result: '{"batches":[{"label":"Places"}]}' }, 'batches');
    assert.equal(wrapped.batches[0].label, 'Places');
});

test('Architect recovers alternate envelopes and domain arrays', () => {
    const changes = context.parseWorldArchitectJSON('{"changes":[{"operation":"add_household","name":"House Vale"}]}', 'operations');
    assert.equal(context.worldArchitectOperationArray(changes).length, 1);
    assert.equal(context.normalizeWorldArchitectOperation(changes.operations[0]).type, 'add_group');
    const people = context.parseWorldArchitectJSON('{"people":[{"id":"npc_mara","name":"Mara"}]}', 'operations');
    assert.equal(people.operations[0].type, 'add_character');
});

test('Architect reads tool-call arguments when message content is empty', () => {
    const candidates = context.worldArchitectResponseCandidates({ choices: [{ message: {
        content: '', tool_calls: [{ function: { arguments: '{"operations":[]}' } }]
    } }] });
    assert.equal(candidates.length, 1);
    assert.equal(context.parseWorldArchitectJSON(candidates[0], 'operations').operations.length, 0);
});

test('Architect structured requests retry malformed output before failing', () => {
    assert.match(appSource, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
    assert.match(appSource, /A strict repair retry also failed/);
    assert.match(appSource, /useResponseFormat = false/);
    assert.match(appSource, /if \(hasExactCounts\)/);
    assert.doesNotMatch(appSource, /job\.error\s*=\s*`Planner fallback used:/);
    assert.match(appSource, /none of its entries used a supported operation schema/);
    assert.match(appSource, /await persistWorldArchitectCheckpoint\(world\)/,
        'Architect jobs must survive refresh while planning and generating');
    assert.doesNotMatch(appSource, /data-world-architect-action="apply"[^>]*disabled/,
        'Apply must explain blockers instead of becoming a visually active dead button');
    assert.match(appSource, /Architect changes applied and saved/);
});

test('batch counts distinguish rooms from other playable locations', () => {
    const counts = context.worldArchitectOperationCounts([
        { type: 'add_location', record: { name: 'Bedroom', mapType: 'room' } },
        { type: 'add_location', record: { name: 'Market', mapType: 'outdoor' } },
        { type: 'add_character', record: { name: 'Mara' } },
        { type: 'connect_locations', from: 'a', to: 'b' }
    ]);
    assert.equal(counts.rooms, 1);
    assert.equal(counts.locations, 1);
    assert.equal(counts.people, 1);
});

test('room additions resolve parent and region references canonically', () => {
    const draft = world();
    const result = context.applyWorldArchitectOperation(draft, { type: 'add_location', record: {
        id: 'loc_room_1', name: 'Room One', description: 'A small room.', parentLocationId: 'loc_inn', regionId: 'reg_city', mapType: 'room', tags: ['private']
    } });
    assert.equal(result.applied, true);
    assert.equal(draft.locations[1].parentLocationId, 'loc_inn');
    assert.equal(draft.locations[1].regionId, 'reg_city');
    assert.equal(draft.locations[1].mapType, 'room');
});

test('replaying a completed batch is idempotent', () => {
    const draft = world();
    const operation = { type: 'add_location', record: { id: 'loc_room_1', name: 'Room One', parentLocationId: 'loc_inn', mapType: 'room' } };
    assert.equal(context.applyWorldArchitectOperation(draft, operation).applied, true);
    const again = context.applyWorldArchitectOperation(draft, operation);
    assert.equal(again.applied, true);
    assert.equal(again.idempotent, true);
    assert.equal(draft.locations.filter(item => item.id === 'loc_room_1').length, 1);
});

test('invalid references fail closed instead of creating broken records', () => {
    const draft = world();
    const result = context.applyWorldArchitectOperation(draft, { type: 'add_location', record: { id: 'bad', name: 'Bad room', parentLocationId: 'missing' } });
    assert.equal(result.applied, false);
    assert.equal(draft.locations.length, 1);
});

test('connections are reciprocal unless explicitly one-way', () => {
    const draft = world();
    context.applyWorldArchitectOperation(draft, { type: 'add_location', record: { id: 'loc_yard', name: 'Yard', regionId: 'reg_city', mapType: 'outdoor' } });
    const result = context.applyWorldArchitectOperation(draft, { type: 'connect_locations', from: 'loc_inn', to: 'loc_yard', mode: 'walk', minutes: 2 });
    assert.equal(result.applied, true);
    assert.equal(draft.locations[0].exits[0].targetLocationId, 'loc_yard');
    assert.equal(draft.locations[1].exits[0].targetLocationId, 'loc_inn');
});

test('fill-gaps never overwrites authored prose, while safe edits can', () => {
    const draft = world();
    const update = { type: 'update_location', targetId: 'loc_inn', fields: { description: 'Replacement', tags: ['new'] } };
    context.applyWorldArchitectOperation(draft, update, 'fill_gaps');
    assert.equal(draft.locations[0].description, 'An inn.');
    context.applyWorldArchitectOperation(draft, update, 'allow_edits');
    assert.equal(draft.locations[0].description, 'Replacement');
});

test('deleting a group keeps characters and clears dangling memberships', () => {
    const draft = world();
    draft.groups = [
        { id: 'grp_old', name: 'Old Household', type: 'household', tags: [] },
        { id: 'grp_new', name: 'New Household', type: 'household', tags: [] }
    ];
    draft.entities = [{ id: 'npc_ana', type: 'npc', name: 'Ana', groupIds: ['grp_old', 'grp_new'], householdId: 'grp_old' }];
    assert.equal(context.removeWorldGroupRecord(draft, 'grp_old'), true);
    assert.equal(draft.entities.length, 1);
    assert.equal(JSON.stringify(draft.entities[0].groupIds), JSON.stringify(['grp_new']));
    assert.equal(draft.entities[0].householdId, 'grp_new');
    assert.equal(draft.groups.some(group => group.id === 'grp_old'), false);
});

test('merging groups moves and deduplicates members and preserves useful details', () => {
    const draft = world();
    draft.groups = [
        { id: 'grp_old', name: 'Lindstrom Family', type: 'family', description: 'Old canon.', homeLocationId: 'loc_inn', tags: ['old-money'] },
        { id: 'grp_new', name: 'Lindström Family', type: 'household', description: '', homeLocationId: '', tags: ['nobility'] }
    ];
    draft.entities = [{ id: 'npc_ana', type: 'npc', name: 'Ana', groupIds: ['grp_old', 'grp_new'], householdId: '' }];
    assert.equal(context.mergeWorldGroupRecords(draft, 'grp_old', 'grp_new'), true);
    assert.equal(JSON.stringify(draft.entities[0].groupIds), JSON.stringify(['grp_new']));
    assert.equal(draft.groups.length, 1);
    assert.equal(draft.groups[0].description, 'Old canon.');
    assert.equal(draft.groups[0].homeLocationId, 'loc_inn');
    assert.equal(JSON.stringify(draft.groups[0].tags), JSON.stringify(['nobility', 'old-money']));
});

test('Architect group deletion and merging require safe-edit permission', () => {
    const draft = world();
    draft.groups = [
        { id: 'grp_a', name: 'A', type: 'family', tags: [] },
        { id: 'grp_b', name: 'B', type: 'household', tags: [] }
    ];
    draft.entities = [{ id: 'npc_ana', type: 'npc', name: 'Ana', groupIds: ['grp_a'], householdId: '' }];
    assert.equal(context.applyWorldArchitectOperation(draft, { type: 'delete_group', targetId: 'grp_a' }, 'fill_gaps').applied, false);
    assert.equal(draft.groups.length, 2);
    assert.equal(context.applyWorldArchitectOperation(draft, { type: 'merge_groups', from: 'grp_a', to: 'grp_b' }, 'allow_edits').applied, true);
    assert.equal(JSON.stringify(draft.entities[0].groupIds), JSON.stringify(['grp_b']));
    assert.equal(draft.groups.length, 1);
});

test('Architect updates group metadata under the configured change policy', () => {
    const draft = world();
    draft.groups = [{ id: 'grp_a', name: 'A', type: 'family', description: '', homeLocationId: '', tags: [] }];
    const result = context.applyWorldArchitectOperation(draft, { type: 'update_group', targetId: 'grp_a', fields: { name: 'House A', description: 'Expanded.', homeLocationId: 'loc_inn' } }, 'fill_gaps');
    assert.equal(result.applied, true);
    assert.equal(draft.groups[0].name, 'A', 'fill-gaps replaced an authored name');
    assert.equal(draft.groups[0].description, 'Expanded.');
    assert.equal(draft.groups[0].homeLocationId, 'loc_inn');
});

test('job and undo metadata do not stale their own world fingerprint', () => {
    const draft = world();
    const before = context.worldArchitectFingerprint(draft);
    draft.architectJob = { status: 'running', operations: [] };
    draft.architectUndo = { snapshot: world() };
    assert.equal(context.worldArchitectFingerprint(draft), before);
    draft.locations[0].name = 'Changed';
    assert.notEqual(context.worldArchitectFingerprint(draft), before);
});

test('staging validates an exact multi-record request without touching its source', () => {
    const source = world();
    const before = JSON.stringify(source);
    const operations = Array.from({ length: 20 }, (_, index) => ({
        type: 'add_location', record: { id: `loc_room_${index + 1}`, name: `Room ${index + 1}`, description: `Playable room ${index + 1}.`, parentLocationId: 'loc_inn', regionId: 'reg_city', mapType: 'room', tags: ['room'] }
    }));
    const staged = context.stageWorldArchitectJob(source, {
        options: { policy: 'fill_gaps' }, operations, dismissed: [],
        plan: { requestedCounts: { rooms: 20 } }
    });
    assert.equal(JSON.stringify(source), before, 'staging mutated the authored world');
    assert.equal(staged.deltas.rooms, 20);
    assert.equal(staged.blockers.length, 0, staged.blockers.join('\n'));
});

let failed = 0;
for (const item of tests) {
    try { item.fn(); console.log(`✓ ${item.name}`); }
    catch (error) { failed++; console.error(`✗ ${item.name}\n  ${error.stack}`); }
}
if (failed) process.exitCode = 1;
else console.log(`\n${tests.length} World Architect checks passed.`);
