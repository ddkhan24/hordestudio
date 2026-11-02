'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../worlds/effect-registry');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');
const workingApi = require('../worlds/working-state');

const legacySchemas = { inventory_add: { type: 'array', items: { type: 'string' } } };
const capability = registry.capabilities({ legacySchemas });
const contract = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' }, actor_id: { type: 'string' },
        status: { type: 'string' } } } }, ...legacySchemas },
'scene_draft_v3', { linkedRequired: true, capability });
assert.deepEqual(Object.keys(contract.properties.actions.items.properties.action_effects.properties).sort(),
    capability.names.slice().sort());
assert.deepEqual(linked.createWorldEffectRegistry(capability.legacyNames).types().sort(),
    capability.names.filter(name => name !== 'checks').sort());
for (const name of capability.nativeNames) {
    const descriptor = registry.technicalEffects.get(name);
    assert.equal(typeof descriptor.validate, 'function', `${name} must bind validation`);
    assert.equal(typeof descriptor.reduce, 'function', `${name} must bind execution`);
}
assert.throws(() => registry.capabilities({ protocol: 'scene_draft_v2', executionMode: 'legacy' }),
    error => error.code === 'derived_from_empty_schema' && error.stage === 'capability_derivation');
const empty = registry.capabilities({ protocol: 'scene_draft_v2', executionMode: 'legacy',
    legacySchemas, intentionallyEffectFree: true });
assert.equal(empty.status, 'intentionally_effect_free');
assert.deepEqual(empty.names, []);
const emptyContract = scene.schema({ events: { type: 'array' }, ...legacySchemas },
    'scene_draft_v2', { capability: empty });
assert.deepEqual(emptyContract.properties.effects.properties, {});

const world = { id: 'synthetic_archive', entities: [
    { id: 'key_1', name: 'Bronze key', type: 'item' },
    { id: 'guide_1', name: 'Guide', type: 'npc' }
], locations: [
    { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: 'archive', doorId: 'gate_1' }] },
    { id: 'archive', name: 'Archive', exits: [{ targetLocationId: 'foyer', doorId: 'gate_1' }] }
] };
const initial = { id: 'synthetic_save', playerLocation: 'foyer', inventory: [],
    unlockedExits: {}, entityStates: { player: { location: 'foyer' },
        key_1: { location: 'foyer' }, guide_1: { location: 'foyer', followingPlayer: true } },
    locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1 };
const action = (id, status, action_effects = {}, depends_on = []) =>
    ({ action_id: id, kind: 'physical', status, action_effects, depends_on });
const run = (actions, events = [], options = {}) => linked.executeLinkedActions({ actions, events,
    narrative: actions.map(item => ({ action_id: item.action_id, text: item.action_id })) },
world, structuredClone(initial), options);
const unknown = run([action('strange', 'resolved', { impossible_effect: [{}] })]);
assert.equal(unknown.ok, false);
assert.equal(unknown.errors[0].code, 'unknown_technical_effect');
assert.equal(unknown.errors[0].effect, 'impossible_effect');
assert(unknown.errors[0].available.includes('actor_move'));
assert.equal(unknown.errors[0].action_id, 'strange');
assert.equal(unknown.errors[0].source, 'worlds/effect-registry.js');
const unsupported = run([action('move', 'resolved', { actor_move: [
    { actor_id: 'player', to_location_id: 'archive' }] })], [], { capability: empty });
assert.equal(unsupported.errors[0].code, 'unsupported_capability');
assert.deepEqual(unsupported.errors[0].available, []);
const invalidPayload = run([action('bad_shape', 'resolved', { actor_move: [
    { actor_id: 'player', to_location_id: 'archive', invented: true }] })]);
assert.equal(invalidPayload.errors[0].code, 'invalid_technical_effect');
assert.equal(invalidPayload.errors[0].stage, 'payload_validation');
for (const effects of [{}, { event_emit: [{ id: 'claim', type: 'claim',
    description: 'The model claims success.' }] }, {
    time_advance: [{ minutes: 1 }], event_emit: [{ id: 'claim',
        type: 'claim', description: 'The model claims success.' }] }]) {
    const unsupportedSuccess = run([action('claim', 'resolved', effects)]);
    assert.equal(unsupportedSuccess.ok, false);
    assert.equal(unsupportedSuccess.errors[0].code, 'unverified_action_success');
}
assert.equal(run([{ ...action('claim', 'resolved'), verifiedLocalInteraction: true }]).ok,
    false, 'a local-interaction flag without an observed event cannot prove success');
const uncommittedTravel = run([{ ...action('walk', 'resolved'), kind: 'travel' }], [
    { action_id: 'walk', type: 'movement', actor_id: 'player', status: 'completed',
        to_location_id: 'archive' }]);
assert.equal(uncommittedTravel.errors[0].code, 'unverified_action_success');
const effectFreeSpeech = linked.executeLinkedActions({ actions: [{
    ...action('speak', 'resolved'), kind: 'speech', request: 'That is the wrong answer.',
    response_id: 'spoken_reply' }], events: [], narrative: [{ id: 'spoken_reply',
    action_id: 'speak', text: 'The reply acknowledges the correction.' }] },
world, structuredClone(initial), { capability: empty });
assert(effectFreeSpeech.ok, JSON.stringify(effectFreeSpeech.errors));
assert.equal(effectFreeSpeech.outcomes.get('speak'), 'succeeded');
const unlinkedSpeech = run([{ ...action('claim', 'resolved'), kind: 'speech' }]);
assert.equal(unlinkedSpeech.errors[0].code, 'unverified_action_success');

const input = 'I wave.';
const draft = { protocol: 'scene_draft_v3', narrative: [
    { id: 'p1', action_id: 'wave', text: 'You wave to the guide.' } ],
    actions: [{ action_id: 'wave', kind: 'physical', status: 'resolved', response_id: 'p1',
        action_effects: {} }], events: [{ type: 'interaction', actor_id: 'player',
            status: 'completed', passage_id: 'p1' }], effects: {}, speech: [], commitments: [] };
const context = { input, linkedRequired: true, capability, contract,
    location: 'foyer', playerStart: 'foyer', present: ['guide_1'],
    locations: ['foyer', 'archive'], commitments: [], now: 0 };
const compoundInput = 'I tap the desk and wave to the guide.';
const compoundContract = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' }, actor_id: { type: 'string' },
        status: { type: 'string' } } } }, ...legacySchemas }, 'scene_draft_v3',
{ linkedRequired: true, capability, input: compoundInput });
assert(compoundContract.properties.actions.items.required.includes('request'));
const compoundDraft = { protocol: 'scene_draft_v3', narrative: [
    { id: 'tap_passage', action_id: 'tap', text: 'You tap the desk.' },
    { id: 'wave_passage', action_id: 'wave', text: 'You wave to the guide.' }],
    actions: [
        { action_id: 'tap', kind: 'physical', status: 'resolved',
            request: 'I tap the desk', response_id: 'tap_passage', action_effects: {} },
        { action_id: 'wave', kind: 'physical', status: 'resolved',
            request: 'and wave to the guide.', response_id: 'wave_passage', action_effects: {} }
    ], events: [
        { type: 'interaction', actor_id: 'player', status: 'completed',
            action_id: 'tap', passage_id: 'tap_passage' },
        { type: 'interaction', actor_id: 'player', status: 'completed',
            action_id: 'wave', passage_id: 'wave_passage' }
    ], effects: {}, speech: [], commitments: [] };
const compoundContext = { ...context, input: compoundInput, contract: compoundContract };
const missingCompoundRequest = scene.compile({ ...compoundDraft,
    actions: compoundDraft.actions.map(({ request, ...action }) => action) }, compoundContext);
assert(missingCompoundRequest.errors.some(error => error.reason === 'explicit_request_coverage_required'));
const compoundCompiled = scene.compile(compoundDraft, compoundContext);
assert(compoundCompiled.ok, JSON.stringify(compoundCompiled.errors));
const compoundResult = linked.executeLinkedActions(compoundCompiled.linkedPlan, world,
    structuredClone(initial), { capability });
assert(compoundResult.ok, JSON.stringify(compoundResult.errors));
assert.deepEqual(Object.fromEntries(compoundResult.outcomes),
    { tap: 'succeeded', wave: 'succeeded' });
const unlinkedInteraction = linked.executeLinkedActions({
    ...compoundCompiled.linkedPlan,
    events: compoundCompiled.linkedPlan.events.map((event, index) => index === 0
        ? { ...event, passage_id: 'wave_passage' } : event)
}, world, structuredClone(initial), { capability });
assert.equal(unlinkedInteraction.errors[0].code, 'unverified_action_success');
const repaired = scene.compile(draft, context);
assert(repaired.ok, JSON.stringify(repaired.errors));
assert.equal(repaired.linkedPlan.actions[0].verifiedLocalInteraction, true);
const localSuccess = linked.executeLinkedActions(repaired.linkedPlan, world,
    structuredClone(initial), { capability });
assert(localSuccess.ok, JSON.stringify(localSuccess.errors));
assert.equal(localSuccess.outcomes.get('wave'), 'succeeded');
for (let attempt = 0; attempt < 3; attempt++) {
    const prematureCheck = { ...draft,
        events: [],
        actions: [{ ...draft.actions[0], status: 'pending_check' }] };
    const recoveredGesture = scene.compile(prematureCheck, context);
    assert(recoveredGesture.ok, JSON.stringify(recoveredGesture.errors));
    assert.equal(recoveredGesture.actions[0].status, 'resolved');
    assert.equal(recoveredGesture.actions[0].verifiedLocalInteraction, true);
    assert(linked.executeLinkedActions(recoveredGesture.linkedPlan, world,
        structuredClone(initial), { capability }).ok);
    assert.equal(prematureCheck.actions[0].status, 'pending_check', 'proposal remains immutable');
}
const mislabeledWave = scene.compile({ ...draft, events: [],
    actions: [{ ...draft.actions[0], kind: 'speech', status: 'pending_check',
        request: 'I wave to Guide.' }] },
    { ...context, input: 'I wave to Guide.', actors: [{ id: 'guide_1', name: 'Guide' }] });
assert(mislabeledWave.ok, JSON.stringify(mislabeledWave.errors));
assert.equal(mislabeledWave.actions[0].kind, 'physical');
assert.equal(mislabeledWave.actions[0].status, 'resolved');
const pendingWithInteraction = scene.compile({ ...draft,
    events: [{ ...draft.events[0], action_id: 'wave' }],
    actions: [{ ...draft.actions[0], status: 'pending_check' }] }, context);
assert(pendingWithInteraction.ok, JSON.stringify(pendingWithInteraction.errors));
assert.equal(pendingWithInteraction.actions[0].status, 'resolved');
const unresolvedWave = scene.compile({ ...draft, events: [],
    narrative: [{ id: 'p1', action_id: 'wave', text: 'You try to wave, but cannot move your arm.' }],
    actions: [{ ...draft.actions[0], status: 'pending_check' }] }, context);
assert(!unresolvedWave.ok, 'an unperformed gesture without a check remains invalid');
const lockedDoor = scene.compile({ ...draft, events: [],
    narrative: [{ id: 'p1', action_id: 'door', text: 'You try to open the locked door.' }],
    actions: [{ ...draft.actions[0], action_id: 'door', request: 'I open the locked door.',
        status: 'pending_check' }] }, { ...context, input: 'I open the locked door.' });
assert(!lockedDoor.ok, 'a persistent interaction cannot be normalized as a harmless gesture');
const namedWave = scene.compile({ ...draft, events: [],
    actions: [{ ...draft.actions[0], request: 'I wave to Guide.' }] },
    { ...context, input: 'I wave to Guide.', actors: [{ id: 'guide_1', name: 'Guide' }] });
assert(namedWave.ok, JSON.stringify(namedWave.errors));
assert.equal(namedWave.actions[0].verifiedLocalInteraction, true);
assert(linked.executeLinkedActions(namedWave.linkedPlan, world,
    structuredClone(initial), { capability }).ok, 'a gesture to a present NPC needs no durable effect');
const selectedTake = { ...structuredClone(initial), bonusTimeMinutes: 30 };
const rerollBase = { ...structuredClone(initial), bonusTimeMinutes: 0 };
const rerollWorking = workingApi.createWorkingState(world, selectedTake);
rerollWorking.applyDetached((_world, session) => Object.assign(session, rerollBase));
const rerollWait = linked.executeLinkedActions({
    narrative: [{ id: 'wait_passage', action_id: 'wait', text: 'You wait five minutes.' }],
    actions: [{ action_id: 'wait', request: 'I wait five minutes.', response_id: 'wait_passage',
        kind: 'wait', status: 'resolved', action_effects: { time_advance: [{ minutes: 5 }] } }],
    events: []
}, world, selectedTake, { capability, workingState: rerollWorking });
assert(rerollWait.ok, JSON.stringify(rerollWait.errors));
assert.equal(rerollWait.elapsedMinutes, 5, 'reroll time is measured from the restored base');
const gestureAndSpeechInput = 'I wave and ask Guide to wait.';
const gestureAndSpeechDraft = { protocol: 'scene_draft_v3', narrative: [
    { id: 'wave_reply', action_id: 'wave', text: 'You wave to Guide.' },
    { id: 'ask_reply', action_id: 'ask', text: 'Guide says she will wait.' }
], actions: [
    { action_id: 'wave', request: 'I wave', kind: 'physical', status: 'resolved',
        response_id: 'wave_reply', action_effects: {} },
    { action_id: 'ask', request: 'and ask Guide to wait.', kind: 'speech', status: 'resolved',
        response_id: 'ask_reply', action_effects: {} }
], events: [], effects: {}, speech: [], commitments: [] };
const gestureAndSpeech = scene.compile(gestureAndSpeechDraft, { ...context,
    input: gestureAndSpeechInput,
    contract: scene.schema({ events: { type: 'array', items: { type: 'object',
        properties: { type: { type: 'string' }, actor_id: { type: 'string' },
            status: { type: 'string' } } } }, ...legacySchemas }, 'scene_draft_v3',
    { linkedRequired: true, capability, input: gestureAndSpeechInput }) });
assert(gestureAndSpeech.ok, JSON.stringify(gestureAndSpeech.errors));
assert.equal(gestureAndSpeech.actions[0].verifiedLocalInteraction, true);
assert(linked.executeLinkedActions(gestureAndSpeech.linkedPlan, world,
    structuredClone(initial), { capability }).ok);
const spokenInput = 'That is the wrong answer; do not forget your purpose.';
const spokenDraft = { protocol: 'scene_draft_v3', narrative: [{ id: 'reply',
    action_id: 'spoken_correction', text: 'The response acknowledges the correction.' }],
    actions: [{ action_id: 'spoken_correction', kind: 'speech', status: 'resolved',
        request: spokenInput, response_id: 'reply', action_effects: {} }],
    events: [], effects: {}, speech: [], commitments: [] };
for (const kind of ['speech', 'question', 'observation', 'other']) {
    const candidate = { ...spokenDraft, actions: [{ ...spokenDraft.actions[0], kind,
        status: kind === 'question' ? 'answered' : 'resolved' }] };
    const spokenCompiled = scene.compile(candidate, { ...context, input: spokenInput });
    assert(spokenCompiled.ok, JSON.stringify(spokenCompiled.errors));
    const spokenResult = linked.executeLinkedActions(spokenCompiled.linkedPlan, world,
        structuredClone(initial), { capability });
    assert(spokenResult.ok, JSON.stringify(spokenResult.errors));
    assert.equal(spokenResult.outcomes.get('spoken_correction'), 'succeeded');
}
const quotedInput = '"Well, really! What exactly is that supposed to mean, peculiar? Hmph. Ahem... Is there something we can help you with?"';
const quotedDraft = { ...spokenDraft, actions: [{ ...spokenDraft.actions[0],
    request: quotedInput }], events: [{ type: 'status', actor_id: 'guide_1',
    status: 'completed', action_id: 'spoken_correction', passage_id: 'reply' }] };
const quotedCompiled = scene.compile(quotedDraft, { ...context, input: quotedInput });
assert(quotedCompiled.ok, JSON.stringify(quotedCompiled.errors));
assert.deepEqual(quotedCompiled.linkedPlan.events, []);
assert.equal(quotedCompiled.repairCount, 1);
assert.equal(quotedCompiled.repairs[0].type, 'discard_uncommitted_speech_event');
const quotedOmittingEmptyFields = scene.compile({ ...quotedDraft, effects: undefined,
    actions: [{ ...quotedDraft.actions[0], action_effects: undefined }] },
{ ...context, input: quotedInput });
assert(quotedOmittingEmptyFields.ok, JSON.stringify(quotedOmittingEmptyFields.errors));
assert.equal(quotedOmittingEmptyFields.repairCount, 1);
const quotedResult = linked.executeLinkedActions(quotedCompiled.linkedPlan, world,
    structuredClone(initial), { capability });
assert(quotedResult.ok, JSON.stringify(quotedResult.errors));
const substantiveQuotedEvent = scene.compile({ ...quotedDraft, events: [{
    ...quotedDraft.events[0], next_status: 'gone' }] },
{ ...context, input: quotedInput, contract: null });
assert(substantiveQuotedEvent.ok, JSON.stringify(substantiveQuotedEvent.errors));
assert.equal(substantiveQuotedEvent.linkedPlan.events.length, 1,
    'a proposed lasting status change must not be discarded as speech');
const uncommittedStatus = linked.executeLinkedActions({
    actions: [{ ...spokenDraft.actions[0], request: quotedInput }],
    narrative: [{ id: 'reply', action_id: 'spoken_correction',
        text: 'The response acknowledges the correction.' }],
    events: [{ type: 'status', actor_id: 'guide_1', status: 'completed',
        next_status: 'gone', action_id: 'spoken_correction', passage_id: 'reply' }]
}, world, structuredClone(initial), { capability });
assert.equal(uncommittedStatus.errors[0].code, 'uncommitted_completed_event');
assert.equal(uncommittedStatus.errors[0].effect, 'status');
assert.equal(uncommittedStatus.errors[0].event_index, 0);
assert.deepEqual(uncommittedStatus.errors[0].requiredEffects, ['npc_status_changes']);
const unquotedReaction = { ...spokenDraft, events: [{ type: 'status', actor_id: 'guide_1',
    status: 'completed', action_id: 'spoken_correction', passage_id: 'reply' }] };
const unquotedCompiled = scene.compile(unquotedReaction, { ...context, input: spokenInput });
assert(unquotedCompiled.ok, JSON.stringify(unquotedCompiled.errors));
assert.deepEqual(unquotedCompiled.linkedPlan.events, [],
    'a payload-free NPC reaction in a speech response is narrative, not a completed change');
assert.equal(unquotedCompiled.repairCount, 1);
assert.equal(unquotedReaction.events.length, 1, 'the original model draft must remain untouched');
const unquotedResult = linked.executeLinkedActions(unquotedCompiled.linkedPlan, world,
    structuredClone(initial), { capability });
assert(unquotedResult.ok, JSON.stringify(unquotedResult.errors));
const unquotedSubstantive = scene.compile({ ...unquotedReaction, events: [{
    ...unquotedReaction.events[0], next_status: 'gone' }] },
{ ...context, input: spokenInput, contract: null });
assert(unquotedSubstantive.ok, JSON.stringify(unquotedSubstantive.errors));
assert.equal(unquotedSubstantive.linkedPlan.events.length, 1,
    'a lasting NPC status change must not be silently removed');
const unquotedPlayerEvent = scene.compile({ ...unquotedReaction, events: [{
    ...unquotedReaction.events[0], actor_id: 'player' }] },
{ ...context, input: spokenInput, contract: null });
assert(unquotedPlayerEvent.ok, JSON.stringify(unquotedPlayerEvent.errors));
assert.equal(unquotedPlayerEvent.linkedPlan.events.length, 1,
    'a player event must not be silently removed from unquoted input');
const unquotedInventoryEvent = scene.compile({ ...unquotedReaction, events: [{
    ...unquotedReaction.events[0], type: 'inventory' }] },
{ ...context, input: spokenInput, contract: null });
assert(unquotedInventoryEvent.ok, JSON.stringify(unquotedInventoryEvent.errors));
assert.equal(unquotedInventoryEvent.linkedPlan.events.length, 1,
    'an inventory claim must not be silently removed from unquoted input');
const wrongActionReference = scene.compile({ ...unquotedReaction, events: [{
    ...unquotedReaction.events[0], action_id: 'nonexistent_action' }] },
{ ...context, input: spokenInput });
assert.equal(wrongActionReference.ok, false);
assert(wrongActionReference.errors.some(error => error.reason === 'unknown_action_reference'));
const forgedLocal = scene.compile({ ...draft, actions: [{ ...draft.actions[0],
    request: 'I open the sealed gate', verifiedLocalInteraction: true }] }, context);
assert.equal(forgedLocal.ok, false, 'model-authored proof fields must fail the contract');
assert.equal(repaired.repairCount, 1);
assert.deepEqual(repaired.repairs[0].original,
    { event_index: 0, passage_id: 'p1', action_id: null });
assert.deepEqual(repaired.repairs[0].corrected,
    { event_index: 0, passage_id: 'p1', action_id: 'wave' });
const compound = scene.compile({ ...draft, actions: [{ ...draft.actions[0],
    request: 'I wave then open the gate' }] },
    { ...context, input: 'I wave then open the gate' });
assert.equal(compound.ok, false);
assert(compound.errors.some(error => error.reason === 'unknown_action_reference'));
assert.equal(draft.events[0].action_id, undefined, 'compilation cannot alter model input');
const unsupportedDraft = scene.compile({ ...draft, actions: [{ ...draft.actions[0],
    action_effects: { imaginary_change: [{}] } }] }, context);
assert.equal(unsupportedDraft.errors[0].code, 'unsupported_capability');
assert.equal(unsupportedDraft.errors[0].effect, 'imaginary_change');
assert.equal(unsupportedDraft.errors[0].action_id, 'wave');

const undoProbe = registry.defineTechnicalEffect('audit_probe', {
    schema: { type: 'array', items: { type: 'object', properties: {
        value: { type: 'string' } }, required: ['value'], additionalProperties: false } },
    validate: value => typeof value?.value === 'string',
    reduce: (value, working) => {
        working.writeSession('auditProbe', field => { field.value = value.value; });
    }
});
try {
    const changed = registry.capabilities();
    assert(changed.names.includes('audit_probe'));
    const changedSchema = scene.schema({ events: { type: 'array' } }, 'scene_draft_v3',
        { linkedRequired: true, capability: changed });
    assert(changedSchema.properties.actions.items.properties.action_effects.properties.audit_probe);
    const result = run([action('probe', 'resolved', { audit_probe: [{ value: 'present' }] })],
        [], { capability: changed });
    assert(result.ok, JSON.stringify(result.errors));
    assert.equal(result.working.getSession('auditProbe'), 'present');
} finally { undoProbe(); }

const undoFailure = registry.defineTechnicalEffect('audit_fail', {
    schema: { type: 'array', items: { type: 'object' } }, validate: () => true,
    reduce: (value, working) => {
        working.writeSession('auditProbe', field => { field.value = 'unsafe'; });
        throw new Error('reducer_boom');
    }
});
try {
    const state = structuredClone(initial);
    const result = linked.executeLinkedActions({ actions: [
        action('first', 'resolved', { outfit_set: [{ actor_id: 'player', outfit: 'blue coat' }] }),
        action('second', 'resolved', { audit_fail: [{}] }) ], events: [], narrative: [] },
    world, state, { capability: registry.capabilities() });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'reducer_boom');
    assert.equal(state.outfit, undefined);
    assert.equal(state.auditProbe, undefined);
} finally { undoFailure(); }
const undoFollowUp = registry.defineTechnicalEffect('audit_follow_up', {
    schema: { type: 'array', items: { type: 'object' } }, validate: () => true,
    reduce: (value, working) => {
        working.writeSession('auditProbe', field => { field.value = 'transient'; });
        return [{ type: 'missing_follow_up', payload: {} }];
    }
});
try {
    const state = structuredClone(initial);
    const result = linked.executeLinkedActions({ actions: [action('follow', 'resolved',
        { audit_follow_up: [{}] })], events: [], narrative: [] }, world, state,
    { capability: registry.capabilities() });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'unknown_technical_effect');
    assert.equal(state.auditProbe, undefined);
} finally { undoFollowUp(); }
const partial = run([
    action('dress', 'resolved', { outfit_set: [{ actor_id: 'player', outfit: 'blue coat' }] }),
    action('enter', 'blocked', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] })
], [], { canMove: () => ({ ok: false, reason: 'locked_exit' }) });
assert(partial.ok, JSON.stringify(partial.errors));
assert.equal(partial.working.getSession('outfit'), 'blue coat');
assert.equal(partial.working.getSession('playerLocation'), 'foyer');
assert.deepEqual(Object.fromEntries(partial.outcomes), { dress: 'succeeded', enter: 'blocked' });
const companionDenied = run([action('enter', 'blocked', { actor_move: [
    { actor_id: 'player', to_location_id: 'archive' }] })], [], {
    canMove: (view, state, actor) => ({ ok: actor === 'player', reason: 'npc_access_denied' }) });
assert(companionDenied.ok, JSON.stringify(companionDenied.errors));
assert.equal(companionDenied.working.getEntity('guide_1').state.location, 'foyer');
const stacked = structuredClone(initial);
stacked.inventory = [{ id: 'key_1', name: 'Bronze key', quantity: 2 }];
stacked.entityStates.key_1.location = '';
const impossibleDrop = linked.executeLinkedActions({ actions: [action('drop', 'blocked', {
    item_transfer: [{ item_id: 'key_1', from_id: 'player', to_id: 'foyer', quantity: 2 }]
})], events: [], narrative: [] }, world, stacked);
assert(impossibleDrop.ok, JSON.stringify(impossibleDrop.errors));
assert.equal(impossibleDrop.working.getSession('inventory')[0].quantity, 2);
assert.equal(impossibleDrop.working.getEntity('key_1').state.location, '');

const canMove = (view, state, actor, from, to) => ({ ok: !!state.unlockedExits?.gate_1
    && from === 'foyer' && to === 'archive', reason: 'locked_exit' });
const plan = [
    action('take', 'resolved', { item_transfer: [{ item_id: 'key_1', from_id: 'foyer',
        to_id: 'player' }] }),
    action('open', 'resolved', { interactable_transition: [{ target_id: 'gate_1', to_state: 'open' }] }),
    action('enter', 'resolved', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] }),
    action('trust', 'resolved', { relation_set: [{ subject_id: 'guide_1',
        target_id: 'player', value: 25 }], event_emit: [{ id: 'archive_seen',
        type: 'discovery', description: 'The archive is reached.' }] })
];
const events = [{ type: 'movement', status: 'completed', action_id: 'enter',
    actor_id: 'player', to_location_id: 'archive' }];
const state = structuredClone(initial);
const result = linked.executeLinkedActions({ actions: plan, events,
    narrative: plan.map(item => ({ action_id: item.action_id, text: item.action_id })) },
world, state, { canMove });
assert(result.ok, JSON.stringify(result.errors));
const candidate = result.working.prepare();
const receipt = { scene: { player_location_id: candidate.session.playerLocation },
    events: result.events };
assert(workingApi.assertWorldModelInvariants(world, state, candidate));
assert(workingApi.assertReceiptMatchesCandidate(receipt, candidate));
assert(workingApi.assertReceiptMatchesCandidate({ scene: receipt.scene, events: [
    { type: 'movement', status: 'completed', actor_id: 'player', to_location_id: 'foyer' },
    ...result.events
] }, candidate), 'only the final completed move must match the final canonical location');
assert.throws(() => workingApi.assertReceiptMatchesCandidate({ scene: {
    player_location_id: 'foyer' }, events: result.events }, candidate),
    /receipt_state_mismatch/);
const invalidLocation = { ...candidate, session: { ...candidate.session,
    entityStates: { ...candidate.session.entityStates,
        guide_1: { ...candidate.session.entityStates.guide_1, location: 'nowhere' } } },
    dirtySet: new Set(['entity:guide_1']) };
assert.throws(() => workingApi.assertWorldModelInvariants(world, state, invalidLocation),
    /unknown_entity_location/);
const normalizeSnapshot = value => {
    if (Array.isArray(value)) return value.map(normalizeSnapshot);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['generatedAt', 'worldStateVersion', 'durationMs'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalizeSnapshot(entry)]));
};
const snapshot = {
    positions: Object.fromEntries(Object.entries(candidate.session.entityStates)
        .map(([id, value]) => [id, value.location || '']).sort(([a], [b]) => a.localeCompare(b))),
    playerLocation: candidate.session.playerLocation,
    inventory: candidate.session.inventory,
    relationships: candidate.session.npcRelationships,
    objectStates: Object.fromEntries(Object.entries(candidate.session.entityStates)
        .filter(([, value]) => value.interactableState).map(([id, value]) => [id, value.interactableState])),
    doors: candidate.session.unlockedExits,
    events: { emitted: candidate.session.engineEvents, receipt: result.events },
    actionResults: Object.fromEntries(result.outcomes), generatedAt: Date.now(),
    worldStateVersion: candidate.session.worldStateVersion
};
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
    'world_linked_turn_snapshot.json'), 'utf8'));
assert.deepEqual(normalizeSnapshot(snapshot), normalizeSnapshot(golden));

(async () => {
    await assert.rejects(result.working.commit(async () => {
        throw new Error('storage_boom');
    }, 1), /storage_boom/);
    assert.deepEqual(state, initial, 'storage failure cannot partially publish a turn');
    console.log('PASS linked effect contract, diagnostics, repairs, invariants, snapshots and rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });
