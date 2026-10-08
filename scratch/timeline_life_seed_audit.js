/** Timeline-scoped Persona and active-life initialization audit. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app, buildContext, functionSource } = require('./app_source.js');

const context = { console };
context.isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
buildContext(vm, ['stableWorldRoll', 'lifeSeedSlug', 'livingClamp', 'chooseTimelineHome', 'authoredStartingRelationshipSeeds', 'fallbackTimelineLifePlan'], context);

const world = {
    id: 'town', name: '2005 Suburbia', description: 'A suburban school life simulation.',
    locations: [
        { id: 'small_flat', name: 'Westgate Flat', mapType: 'building', prosperity: 25, description: 'A modest apartment home.' },
        { id: 'lake_house', name: 'Lakeview House', mapType: 'building', prosperity: 94, description: 'An affluent family home.' },
        { id: 'high_school', name: 'Bellwether High School', mapType: 'area', prosperity: 55, description: 'The public high school.' },
        { id: 'hospital', name: 'Bellwether General Hospital', mapType: 'building', prosperity: 70, description: 'The medical campus.' }
    ]
};
const session = { id: 'timeline_1', playerLocation: 'high_school' };
const persona = { id: 'p1', name: 'Jamie Mercer', text: 'A new high-school student. Both parents are doctors and the family lives in a rich part of town.' };
const origin = { id: 'new_kid', name: 'The New Kid', role: 'high-school junior', description: 'Moved here yesterday.' };
const plan = context.fallbackTimelineLifePlan(world, session, persona, origin);

assert.equal(plan.home.location_id, 'lake_house', 'wealth did not select the affluent home');
assert.equal(plan.people.filter(person => /parent/.test(person.relationship_to_player)).length, 2, 'student did not receive a household');
assert(plan.people.filter(person => /parent/.test(person.relationship_to_player)).every(person => person.role === 'doctor'), 'doctor parents were reduced to flavor text');
assert(plan.people.filter(person => /parent/.test(person.relationship_to_player)).every(person => person.day_location_id === 'hospital'), 'doctor parents were not assigned a workplace');
assert(plan.people.some(person => /classmate|friend|rival/.test(person.relationship_to_player)), 'student received no persistent peers');

const adultWorld = { id: 'office', name: '2005 Office Hours', description: 'A workplace.', locations: [
    { id: 'reception', name: 'Reception Lobby', description: '', mapType: 'room' },
    { id: 'bullpen', name: 'Main Bullpen', description: '', mapType: 'room' }
], entities: [] };
const adultPlan = context.fallbackTimelineLifePlan(adultWorld,
    { id: 'adult_timeline', playerLocation: 'reception' }, null,
    { name: 'The New Hire', role: 'employee', description: '' });
assert.equal(new Set(adultPlan.people.map(person => person.name.toLowerCase())).size, adultPlan.people.length,
    'fallback created two people with the same name');
assert.equal(adultPlan.people.find(person => person.role === 'coworker')?.day_location_id, 'bullpen',
    'fallback coworker did not receive the authored workplace');
assert(!adultPlan.people.some(person => person.day_location_id === 'reception'),
    'fallback populated the player opening room with unrelated acquaintances');

const fantasyWorld = {
    id: 'fantasy_watch', name: 'The Salt-Glass Watch',
    description: 'A small fantasy frontier RPG with a missing courier.',
    locations: [{ id: 'inn', name: 'The Reed Inn', description: 'Temporary lodging for travellers.' }],
    entities: []
};
const rangerOrigin = {
    id: 'ranger', name: 'The Ranger', role: 'marsh ranger', socialRank: 'outsider',
    description: 'An itinerant ranger hired to find a courier.', startLocationId: 'inn'
};
const rangerSession = { id: 'ranger_timeline', playerLocation: 'inn' };
const rangerPlan = context.fallbackTimelineLifePlan(fantasyWorld, rangerSession, null, rangerOrigin);
assert.equal(rangerPlan.people.length, 0, 'model failure invented prior contacts for an outsider');
assert.equal(rangerPlan.unfixed_home, true, 'model failure assigned an unverified home to an itinerant player');
assert.equal(rangerPlan.home.name, undefined, 'model failure created a fictional family house for an itinerant player');

const applyFallback = vm.runInNewContext(`${functionSource('applyTimelineLifePlan')}\napplyTimelineLifePlan`, {
    isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
    getLocationRef: (world, ref) => world.locations.find(location => location.id === ref || location.name === ref) || null,
    chooseTimelineHome: () => { throw new Error('unfixed fallback must not infer a home'); },
    authoredStartingRelationshipSeeds: () => [],
    safeJsonClone: value => JSON.parse(JSON.stringify(value)),
    appendWorldLedgerEntry() {}, normalizeAuthoredWorld() {}, normalizeLivingWorldState() {}
});
const appliedRangerSession = {
    ...rangerSession, entityStates: {}, npcRelationships: {}, npcScheduleOverrides: {}, originRelationshipNpcIds: []
};
applyFallback(fantasyWorld, appliedRangerSession, null, rangerOrigin, rangerPlan, 'deterministic_fallback');
assert.equal(appliedRangerSession.playerIdentity.homeLocationId, '', 'starting inn was silently promoted to a fixed home');
assert.equal(appliedRangerSession.lifeSeed.homeLocationId, '', 'unverified home leaked into life seed');
assert.equal(appliedRangerSession.lifeSeed.people.length, 0, 'unverified people leaked into life seed');
assert.equal(fantasyWorld.locations.length, 1, 'fallback created an unverified home location');

const settledFantasyPlan = context.fallbackTimelineLifePlan(fantasyWorld,
    { id: 'settled_timeline', playerLocation: 'inn' }, null,
    { name: 'The Innkeeper', role: 'innkeeper', description: 'Keeps the local inn.' });
assert(settledFantasyPlan.people.every(person => !/\b(?:Jamie|Morales|Chen|Sullivan)\b/.test(person.name)),
    'the word “small” caused fantasy names to be misclassified as modern');

const createSession = functionSource('createNewWorldSession');
assert(/personaId:\s*state\.activePersonaId/.test(createSession), 'new timelines do not capture the active Persona');
assert(/lifeSeed:\s*null/.test(createSession), 'new timelines lack explicit life initialization state');
assert(/s\.personaId\s*=\s*personaSelect\.value/.test(functionSource('openSessionZero')), 'Session Zero Persona choice is not persisted');
assert(/closeButton\.onclick\s*=\s*dismiss/.test(functionSource('openSessionZero')), 'the modal X still commits instead of dismissing');
assert(/Object\.assign\(sess,[\s\S]*sessionSetupSnapshot/.test(functionSource('openSessionZero')), 'dismissing does not restore the uncommitted timeline preview');
assert(/New Session Setup/.test(app), 'the old Session Zero name is still exposed');
assert(/getTimelinePersona\(sess\)/.test(app), 'world narration still reads only the mutable global Persona');
assert(/relationshipToPlayer/.test(functionSource('applyTimelineLifePlan')), 'seeded relationships are not committed as structured state');
assert(/homeLocationId/.test(functionSource('applyTimelineLifePlan')), 'seeded home is not committed to player identity');
assert(/const authoredHome = getLocationRef\(world, origin\?\.homeLocationId\)/.test(functionSource('applyTimelineLifePlan')), 'the model can still override an authored player home');
assert(/authoredStartingRelationshipSeeds\(world, origin\)\.forEach/.test(functionSource('applyTimelineLifePlan')), 'authored relationships are not merged back over model output');
assert(/location: location\?\.id \|\| ''/.test(functionSource('applyTimelineLifePlan')),
    'unspecified contacts still crowd the player opening room');

world.groups = [{ id: 'family_mercer', name: 'Mercer Family', type: 'household' }];
world.entities = [
    { id: 'mara', name: 'Mara Mercer', type: 'npc', groupIds: ['family_mercer'] },
    { id: 'alex', name: 'Alex Mercer', type: 'npc', groupIds: ['family_mercer'] }
];
const authored = context.authoredStartingRelationshipSeeds(world, {
    householdId: 'family_mercer',
    startingRelationships: [{ npcId: 'mara', label: 'mother', disposition: 91 }]
});
assert.equal(authored.length, 2, 'household members were left at the model’s mercy');
assert.deepEqual({ id: authored[0].npc.id, label: authored[0].label, disposition: authored[0].disposition },
    { id: 'mara', label: 'mother', disposition: 91 });
assert.equal(authored[1].label, 'household member');

console.log('✓ rich household resolution');
console.log('✓ parent professions and workplace');
console.log('✓ persistent school social anchors');
console.log('✓ timeline-scoped Persona selection');
console.log('✓ structured home and relationship commit');
console.log('✓ reversible New Session Setup dismissal');
console.log('✓ author-owned home, family, groups and relationships');
console.log('✓ unique fallback contacts remain offstage or at their workplace');
console.log('✓ itinerant fallback avoids invented home and social graph');
console.log('✓ fantasy setting does not trigger modern names from “small”');
console.log('\n10 timeline life-seed audits passed.');
