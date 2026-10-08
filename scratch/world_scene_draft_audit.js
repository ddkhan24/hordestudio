'use strict';
const assert = require('node:assert/strict');
const { compile, schema, decode } = require('../worlds/scene-draft');
assert.deepEqual(decode('```json\n{"protocol":"scene_draft_v2"}\n```'), {protocol:'scene_draft_v2'});
assert.equal(decode('Here is JSON: {"protocol":"scene_draft_v2"}'), null);
assert.equal(decode('```json\n{"protocol": broken}\n```'), null);
assert.deepEqual(decode('<world_turn_receipt>{"protocol":"scene_draft_v2"}</world_turn_receipt>'), {protocol:'scene_draft_v2'});
const context = { input: 'I alert Denton and ask the deadline.', location: 'office', playerStart: 'office',
    present: ['denton', 'examiner'], locations: ['office'], now: 537, commitments: [],
    effectKeys: ['quests_update', 'location_introduced', 'checks'] };
const narrative = 'Denton hears that the examiner has arrived. The examiner says the files are due at 5 PM today.';
const draft = { protocol: 'scene_draft_v2', narrative,
    actions: [{ request: 'I alert Denton ', kind: 'speech', status: 'resolved',
        response: 'Denton hears that the examiner has arrived.' },
    { request: 'and ask the deadline.', kind: 'question', status: 'answered',
        response: 'The examiner says the files are due at 5 PM today.' }],
    events: [], effects: {}, speech: [{ speaker: 'player', listeners: ['denton'],
        statement: 'Denton hears that the examiner has arrived.' }],
    commitments: [{ id: 'files_due', title: 'Reserve files', description: 'Produce the reserve files.',
        day: 1, minute_of_day: 1020, location_id: 'office', status: 'scheduled', reschedule: false,
        evidence: 'The examiner says the files are due at 5 PM today.' }] };
const original = structuredClone(draft);
const result = compile(draft, context);
assert(result.ok, JSON.stringify(result.errors));
assert.deepEqual(draft, original, 'compilation must not mutate the proposal');
assert.equal(result.commitments[0].dueMinute, 1020);
assert.equal(result.receipt.state_updates.world_events[0].due_in_minutes, 483);
assert.equal(result.receipt.events[0].actor_id, 'denton');
assert.equal(result.receipt.events[0].source_type, 'told');
assert.deepEqual(result.receipt.scene.present_character_ids, context.present);
const reasons = (candidate, ctx = context) => compile(candidate, ctx).errors?.map(e => e.reason) || [];
assert(reasons({ ...draft, actions: draft.actions.slice(0, 1) }).includes('incomplete_player_request_coverage'));
assert(reasons({ ...draft, narrative: 'Nothing happens.' }).includes('response_missing_from_scene'));
assert(reasons({ ...draft, speech: [{ ...draft.speech[0], listeners: ['absent'] }] }).includes('invalid_witnessed_speech'));
assert(reasons({ ...draft, effects: { invented_state: true } }).includes('unsupported_draft_effect'));
assert(reasons({ ...draft, effects: { quests_update: [{ objectives: [{ type: 'location', target: 'vault' }] }] } })
    .includes('unknown_quest_location'));
const changedTime = { ...draft, commitments: [{ ...draft.commitments[0], minute_of_day: 1022 }] };
const later = { ...context, now: 600, commitments: [{ id: 'files_due', dueMinute: 1020, status: 'scheduled' }] };
assert(reasons(changedTime, later).includes('commitment_time_changed_without_reschedule'));
assert(compile(draft, later).ok, 'restatement preserves exact deadline');
assert(reasons(draft, { ...later, now: 1100, commitments: [{ ...later.commitments[0], status: 'triggered' }] })
    .includes('resolved_commitment_rearmed'));
assert(reasons({ ...draft, commitments: [draft.commitments[0], draft.commitments[0]] }).includes('invalid_commitment'));
assert(compile({ ...draft, effects: { location_introduced: [{ id: 'vault', name: 'Vault', parent_location_id: 'office' }],
    quests_update: [{ objectives: [{ type: 'location', target: 'vault' }] }] } }, context).ok);
const contract = schema({ events: { type: 'array' }, checks: { type: 'array' }, world_events: {}, npc_observations: {} });
assert(!contract.properties.scene);
assert(!contract.properties.effects.properties.world_events);
assert(!contract.properties.effects.properties.npc_observations);
console.log('PASS scene drafts: coverage, speech provenance, stable deadlines, location integrity, pure compilation');
const linked = { ...draft, narrative: [{ id: 'p1', text: narrative }],
    actions: draft.actions.map(a => ({ request: a.request, kind: a.kind, status: a.status, response_id: 'p1' })),
    speech: [{ speaker: 'player', listeners: ['denton'], passage_id: 'p1' }],
    commitments: draft.commitments.map(({ evidence, ...c }) => ({ ...c, passage_id: 'p1' })) };
assert(compile(linked, context).ok, 'passage links do not require repeated exact quotes');
assert(reasons({ ...linked, speech: [{ speaker: 'player', listeners: ['denton'], passage_id: 'missing' }] })
    .includes('unknown_passage_id'));
assert(reasons({ ...linked, narrative: [linked.narrative[0], linked.narrative[0]] }).includes('invalid_passage'));
assert.equal(contract.properties.narrative.type, 'array');
assert(contract.properties.actions.items.properties.response_id);
const pending = { ...draft, effects: { checks: [{}] },
    actions: [draft.actions[0], { ...draft.actions[1], status: 'pending_check' }] };
assert(compile(pending, context).ok, 'one pending action can coexist with an answered action');
const typedOutcome = compile({...pending,effects:{checks:[{success_text:'The door opens.',
    failure_text:'All your tools break.',on_success:{},on_failure:{}}],ledger_update:'You try the lock.'}},
    {...context,effectKeys:[...context.effectKeys,'ledger_update']});
assert(typedOutcome.ok);
assert.equal(typedOutcome.receipt.state_updates.checks[0].outcome_contract,'state_delta_v1');
assert.equal(typedOutcome.receipt.state_updates.checks[0].failure_text,undefined);
assert.equal(typedOutcome.receipt.state_updates.ledger_update,undefined);
assert(!compile({...pending,effects:{checks:[{on_failure:{ledger_update:'All your tools break.'}}]}},context).ok);
assert(reasons({ ...pending, actions: draft.actions }).includes('check_requires_one_pending_action'));
assert(reasons({ ...pending, effects: {} }).includes('pending_action_requires_check'));
const minimalCommitment = structuredClone(linked);
delete minimalCommitment.commitments[0].description;
delete minimalCommitment.commitments[0].reschedule;
assert(compile(minimalCommitment, context).ok, 'display metadata must not force another model call');
const flatEffects = { ...linked, quests_update: [] };
assert(compile(flatEffects, context).ok, 'known explicit effect placement can be normalized without another API call');
assert(Object.hasOwn(flatEffects, 'quests_update'), 'placement adapter cannot mutate source');
assert(reasons({ ...flatEffects, effects: { quests_update: [{id:'other'}] } }).includes('conflicting_effect_placement'));
assert(reasons({ ...linked, invented_mutation: {} }).includes('unsupported_draft_field'));
assert.equal(compile({...linked,events:[{type:'speech',actor_id:'player',status:'completed',passage_id:'p1'}]},context)
    .receipt.events[0].type,'dialogue');
assert.equal(compile({...linked,events:[{actor_id:'player',status:'completed',action:'offers a deadline',passage_id:'p1'}]},context)
    .receipt.events[0].type,'other');
assert.equal(compile({...linked,events:[{actor_id:'player',status:'completed',to_location_id:'office',passage_id:'p1'}]},context)
    .receipt.events[0].type,undefined,'mechanical payload with missing type must still reach reducer as invalid');
assert.equal(compile({...linked,events:[{actor_id:'player',status:'completed',minutes_elapsed:60,passage_id:'p1'}]},context)
    .receipt.events[0].type,'time','an explicit duration is an unambiguous time operation, never prose inference');
assert(compile(linked, {...context,input:'I alert Denton, and ask the deadline.'}).ok,
    'a comma between exact request excerpts is presentation, not a missing action');
assert(!compile(linked, {...context,input:'I alert Denton and ask the deadline. I do not leave.'}).ok,
    'an omitted constraint remains a real coverage failure');
const spacedPassages = structuredClone(linked);
spacedPassages.narrative.forEach(p => { p.text = ' ' + p.text + ' '; });
assert(compile(spacedPassages, context).ok, 'linked passages use the same whitespace normalization as displayed prose');
const sharedAttempt = structuredClone(pending);
sharedAttempt.actions = [
    {...pending.actions[1],request:'I alert Denton '},
    {...pending.actions[1],request:'and ask the deadline.'}
];
assert(compile(sharedAttempt,context).ok,'multiple clauses bound to one attempt may share its single check');
sharedAttempt.actions[0].response=draft.actions[0].response;
assert(!compile(sharedAttempt,context).ok,'separate attempt passages cannot share one check');
