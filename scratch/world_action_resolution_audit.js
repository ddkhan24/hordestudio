/** The model must account for the submitted action before a receipt can commit. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source.js');

const context = { structuredClone,
    parseExplicitWorldWaitMinutes: input => input === 'I wait an hour.' ? 60 : null,
    isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value) };
vm.createContext(context);
vm.runInContext(`${functionSource('worldActionResolutionFailures')}\nthis.check = worldActionResolutionFailures;`, context);
vm.runInContext(`${functionSource('canonicalizeWorldCheckNarrativeOutcomes')}\nthis.canonicalize = canonicalizeWorldCheckNarrativeOutcomes;`, context);
context.normalizeWorldTurnReceipt = (_world, _session, receipt) => receipt;
context.buildWorldSceneFrame = () => ({ present_character_ids: [] });
context.safeJsonClone = structuredClone;
vm.runInContext(`${functionSource('buildSafeCheckOnlyWorldReceipt')}\nthis.salvage = buildSafeCheckOnlyWorldReceipt;`, context);
const check = (receipt, extra = {}) => Array.from(
    context.check(receipt, 'I pull the pressure lever slowly.', extra), failure => failure.reason);
const base = { events: [], state_updates: {}, action_resolution: {
    kind: 'physical', status: 'resolved', outcome: 'The pressure lever shifts and the valve opens.'
} };
const deadlineOutcome = 'If you are not back by sunset on Wednesday, I will send a search party.';
assert.deepEqual(Array.from(context.check({ ...base, action_resolution: {
    kind:'question',status:'answered',outcome:deadlineOutcome
}}, 'I ask for an exact deadline.', {sceneDraft:true,narrativeText:deadlineOutcome,
    commitments:[{status:'scheduled',evidence:deadlineOutcome,dueMinute:3900}]})), [],
    'a validated linked deadline is authoritative without a keyword whitelist');
assert.deepEqual(Array.from(context.check({ ...base, action_resolution: {
    kind:'wait',status:'resolved',outcome:'The examiner answers your question.'
}}, 'I wait for her answer.', {sceneDraft:true})), []);
assert.equal(context.check({ ...base, action_resolution: {
    kind:'wait',status:'resolved',outcome:'You wait an hour at reception.'
}}, 'I wait an hour.', {sceneDraft:true})[0].reason, 'uncommitted_player_wait');
assert.deepEqual(check({ ...base, action_resolution: null }), ['missing_action_resolution']);
assert.deepEqual(check(base), ['uncommitted_player_action']);
assert.deepEqual(check({ ...base, events: [{ type: 'activity', actor_id: 'player', status: 'completed' }] }), []);
assert.deepEqual(check({ ...base, action_resolution: { ...base.action_resolution,
    status: 'pending_check' } }), ['uncommitted_action_check']);
assert.deepEqual(check({ ...base, action_resolution: { ...base.action_resolution,
    status: 'pending_check' }, state_updates: { checks: [{}] } }), []);
assert.deepEqual(check({ ...base, action_resolution: { kind: 'question', status: 'answered',
    outcome: 'Iven says the gate opens only at first light.' } }), []);
const deadlineInput = 'I ask the examiner for the deadline on the reserve files.';
const deadlineReceipt = { ...base, action_resolution: { kind: 'speech', status: 'resolved',
    outcome: 'You put the examiner on the spot about the reserve files.' } };
assert.equal(context.check(deadlineReceipt,deadlineInput,{sceneDraft:true,
    narrativeText:'The examiner refuses to give a deadline.'}).length,0);
assert.equal(context.check(deadlineReceipt,deadlineInput,{sceneDraft:true,
    narrativeText:'The files are due by noon.'})[0].reason,'uncommitted_answered_deadline');
assert.deepEqual(Array.from(context.check(deadlineReceipt, deadlineInput), failure => failure.reason),
    ['unanswered_deadline_question']);
assert.deepEqual(Array.from(context.check({ ...deadlineReceipt, action_resolution: {
    ...deadlineReceipt.action_resolution,
    outcome: 'The examiner says the reserve files are due by noon today.'
} }, deadlineInput), failure => failure.reason), ['uncommitted_answered_deadline']);
assert.deepEqual(Array.from(context.check({ ...deadlineReceipt,
    state_updates: { world_events: [{ id: 'examiner_deadline', status: 'scheduled',
        urgent: true, due_in_minutes: 180 }] }, action_resolution: {
        ...deadlineReceipt.action_resolution,
        outcome: 'The examiner says the reserve files are due by noon today.'
    } }, deadlineInput), failure => failure.reason), []);
assert.deepEqual(Array.from(context.check({ ...deadlineReceipt, action_resolution: {
    ...deadlineReceipt.action_resolution,
    outcome: 'The examiner declines to answer the deadline question until she reviews the files.'
} }, deadlineInput), failure => failure.reason), []);
assert.deepEqual(check({ ...base, action_resolution: { kind: 'travel', status: 'resolved',
    outcome: 'You reach the watchtower before dusk.' } }), ['uncommitted_player_travel']);
assert.deepEqual(check({ ...base, action_resolution: { kind: 'travel', status: 'resolved',
    outcome: 'You reach the watchtower before dusk.' } }, { precommittedAction: true }), []);
assert.deepEqual(check(base, { specialCommand: true }), []);
assert.deepEqual(check({ ...base, state_updates: { checks: [{}] }, action_resolution: {
    kind: 'question', status: 'answered', outcome: 'Iven says the gate opens at first light.'
} }, { sceneDraft: true }), [], 'another action can be answered while one awaits a check');
assert.deepEqual(check({ ...base, state_updates: { checks: [{}] } }, { sceneDraft: true }),
    ['uncommitted_player_action'], 'another action cannot borrow the pending check as proof of completion');
const proposal = { state_updates: { checks: [{ label: 'Vent valve',
    on_success: { summary: 'The valve vents safely.', invented_mutation: true },
    on_failure: { summary: 'Steam hisses against your sleeve.' } }] } };
const canonical = context.canonicalize(proposal);
assert.equal(canonical.state_updates.checks[0].success_text, 'The valve vents safely.');
assert.equal(canonical.state_updates.checks[0].failure_text,
    'Steam hisses against your sleeve.');
assert.equal(canonical.state_updates.checks[0].on_success.invented_mutation, true,
    'unsupported mutations must remain visible for strict validation');
assert.equal(proposal.state_updates.checks[0].on_success.summary, 'The valve vents safely.',
    'normalization must not mutate the model response or a saved prior version');
const salvage = context.salvage({}, { playerLocation: 'cellar' }, {
    summary: 'The lever awaits a check.',
    action_resolution: { kind: 'physical', status: 'pending_check',
        outcome: 'The lever resists while the check determines the result.' },
    scene: { player_location_id: 'cellar', player_location_changed: false,
        present_character_ids: [] },
    events: [{ type: 'interaction', actor_id: 'player', status: 'attempted' }],
    entity_updates: [{ entity_id: 'player', activity: 'pulling the lever' }],
    state_updates: { checks: [{ label: 'Pull lever', stat_id: 'wits', difficulty: 11 }] }
}, { playerStartLocationId: 'cellar' });
assert.equal(salvage?.action_resolution?.status, 'pending_check',
    'the safe check fallback must preserve the player-action contract');
assert.equal(salvage?.events?.length, 0);
assert.equal(salvage?.entity_updates?.length, 0);

const turn = functionSource('executeWorldTurn');
assert.match(turn, /worldActionResolutionFailures\(committed\.validation\.receipt/);
assert.match(turn, /resolveFirst && !!acceptedTurnReceipt/);
assert.match(turn, /missing_committed_action_outcome/);
assert.match(turn, /if \(!resolveFirst && !knowledgeSensitiveStream/);
console.log('✓ player action disposition is required before canonical commit and final prose');
