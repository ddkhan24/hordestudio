/** Offline regression for urgent world-event deadlines and their visible aftermath. */
'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext, functionSource } = require('./app_source.js');

const urgentNode = {
    textContent: '',
    hidden: true,
    classList: {
        toggle(name, hidden) {
            assert.equal(name, 'hidden');
            urgentNode.hidden = hidden;
        }
    }
};
const context = buildContext(vm, [
    'normalizeLivingWorldState', 'processStructuredActions', 'runLivingWorldTick',
    'describeWorldEventDeadline', 'worldEventMinutesRemaining', 'getLivingWorldPrompt',
    'recoverNarratedUrgentDeadline', 'reconcileNarratedWorldDeadlines', 'validateWorldTurnReceipt',
    'attachObservedWorldDeadlineOutcome', 'worldUnmetConditionalSearchClaims',
    'worldUnverifiedWaitNotice', 'worldDeadlineNarrativeSourceKey'
], {
    console: { log() {}, warn() {}, error() {} },
    showToast() {},
    state: { worldInstances: {} },
    document: { getElementById: id => id === 'world-urgent-stakes' ? urgentNode : null }
});

// Execute the actual urgent-status branch without building the rest of the UI.
// This also catches a regression where the consequence is stored but not shown.
const playRenderer = functionSource('renderWorldPlayState');
const urgentStart = playRenderer.indexOf("    const urgentStakes = document.getElementById('world-urgent-stakes');");
const urgentEnd = playRenderer.indexOf('    // 1. Core Header', urgentStart);
assert(urgentStart >= 0 && urgentEnd > urgentStart, 'urgent status branch is missing');
const renderUrgentStatus = vm.runInContext(
    `(function(world, sess) { ${playRenderer.slice(urgentStart, urgentEnd)} })`, context);

const world = {
    id: 'urgent_deadline_test', name: 'Deadline Test', startLocationId: 'home',
    hudConfig: { timeStep: 10, startTimeHours: 8 },
    locations: [
        { id: 'home', name: 'Home', exits: [] },
        { id: 'station', name: 'Station', exits: [] },
        { id: 'causeway', name: 'Marsh Causeway', exits: [] }
    ],
    entities: [], regions: [], groups: []
};
function session(id) {
    return {
        id, turnCount: 1, playerLocation: 'home', bonusTimeMinutes: 0,
        entityStates: {}, playerStats: {}, playerState: { status: 'active', conditions: [] },
        inventory: [], equipment: {}, history: [], ledger: '', quests: [],
        pendingChecks: [], checkHistory: [], engineEvents: []
    };
}
function apply(sess, update) {
    return context.processStructuredActions({ world_events: [update] }, world, sess,
        { deferFeedback: true });
}
function event(sess, id) {
    return sess.scheduledEvents.find(item => item.id === id);
}
function draw(sess) {
    renderUrgentStatus(world, sess);
    return urgentNode.textContent;
}

const sess = session('deadline_lifecycle');
const hazardReceipt = {
    scene: { player_location_id: 'home', player_location_changed: false,
        present_character_ids: [] }, events: [], entity_updates: [],
    state_updates: { location_state_updates: [{ location_id: 'marsh_causeway',
        add_conditions: ['flooded', 'impassable'] }] }
};
const resolvedHazard = context.validateWorldTurnReceipt(world, sess, hazardReceipt, {});
assert.equal(resolvedHazard.rejectedEvents.length, 0, JSON.stringify(resolvedHazard.rejectedEvents));
assert.equal(resolvedHazard.legacyArgs.location_state_updates[0].location_id, 'causeway',
    'A unique display-name slug should become a canonical location id.');
const missingHazard = context.validateWorldTurnReceipt(world, sess, {
    ...hazardReceipt, state_updates: { location_state_updates: [{ location_id: 'invented_road',
        add_conditions: ['flooded'] }] }
}, {});
assert(missingHazard.rejectedEvents.some(item => item.reason === 'unknown_location_state_target'),
    'An unresolvable hazard target must reject the receipt, not disappear silently.');
context.normalizeLivingWorldState(world, sess);
context.processStructuredActions(resolvedHazard.legacyArgs, world, sess, { deferFeedback: true });
assert(sess.locationStates.causeway.conditions.some(item => item.label === 'flooded'),
    'The canonicalized hazard must survive into persistent location state.');
apply(sess, {
    id: 'station_warning', title: 'Station warning',
    description: 'A guarded train reaches the station.', urgent: true,
    due_in_turns: 3, location_id: 'station',
    condition_on_trigger: 'platform sealed', condition_duration_turns: 4
});
assert.equal(event(sess, 'station_warning').urgent, true);
assert.equal(event(sess, 'station_warning').dueTurn, 4);
assert.equal(context.describeWorldEventDeadline(world, sess, event(sess, 'station_warning')), 'in 3 turns');
assert.match(draw(sess), /Urgent · Station warning · in 3 turns/);
assert.equal(urgentNode.hidden, false);

// Updating the same id revises the existing clock and text instead of making a
// second deadline. Round-trip normalization must preserve the urgent flag.
apply(sess, { id: 'station_warning', title: 'Station closure', due_in_turns: 1 });
assert.equal(sess.scheduledEvents.length, 1);
assert.equal(event(sess, 'station_warning').dueTurn, 2);
assert.equal(event(sess, 'station_warning').title, 'Station closure');
context.normalizeLivingWorldState(world, sess);
assert.equal(event(sess, 'station_warning').urgent, true);
assert.equal(context.describeWorldEventDeadline(world, sess, event(sess, 'station_warning')), 'in 1 turn');
assert.match(draw(sess), /Urgent · Station closure · in 1 turn/);
assert.doesNotMatch(urgentNode.textContent, /Station warning/);

assert.equal(context.runLivingWorldTick(world, sess).events, 0);
sess.turnCount = 2;
assert.equal(context.runLivingWorldTick(world, sess).events, 1);
assert.equal(event(sess, 'station_warning').status, 'triggered');
assert(sess.locationStates.station.conditions.some(item => item.label === 'platform sealed'),
    'deadline did not change the named location');
const aftermath = sess.consequences.find(item =>
    item.type === 'deadline' && item.sourceEventId === 'deadline_station_warning_2');
assert(aftermath, 'the deadline did not create a durable consequence');
assert.equal(aftermath.visibility, 'private');
assert.equal(aftermath.state === 'resolved', false);
const remoteNews = sess.worldNews.find(item => item.type === 'event'
    && item.text.includes('Station closure'));
assert(remoteNews, 'the event was not recorded as world news');
assert.equal(remoteNews.playerVisible, false);
assert.equal(remoteNews.playerWitnessed, false);
assert.equal(sess.engineEvents.some(item => JSON.stringify(item).includes('Station closure')), false,
    'a remote event was queued for immediate narration');
assert.match(draw(sess), /Consequence · Deadline reached: Station closure/);
assert.doesNotMatch(urgentNode.textContent, /guarded train|platform sealed/,
    'remote details leaked into the player-facing status area');
assert.equal(urgentNode.hidden, false);
const prompt = context.getLivingWorldPrompt(world, sess, []);
assert.match(prompt, /Developments NOT yet reachable[^\n]*Station closure/);
assert.doesNotMatch(prompt, /Developments reachable in this scene[^\n]*Station closure/);

// Cancellation after firing closes the deadline consequence so the banner
// cannot keep claiming an active aftermath after a later resolution.
apply(sess, { id: 'station_warning', status: 'cancelled' });
assert.equal(event(sess, 'station_warning').status, 'cancelled');
const resolvedAftermath = sess.consequences.find(item => item.sourceEventId === aftermath.sourceEventId);
assert.equal(resolvedAftermath.state, 'resolved');
assert.equal(resolvedAftermath.resolvedTurn, 2);
draw(sess);
assert.equal(urgentNode.hidden, true);
assert.equal(urgentNode.textContent, '');

const cancelled = session('cancel_before_due');
apply(cancelled, {
    id: 'evacuate', title: 'Evacuation order', urgent: true,
    due_in_turns: 1, location_id: 'station',
    condition_on_trigger: 'platform emptied'
});
apply(cancelled, { id: 'evacuate', status: 'cancelled' });
cancelled.turnCount = 2;
assert.equal(context.runLivingWorldTick(world, cancelled).events, 0);
assert.equal(event(cancelled, 'evacuate').status, 'cancelled');
assert.equal(cancelled.locationStates.station?.conditions?.length || 0, 0);
assert.equal(cancelled.consequences.filter(item => item.type === 'deadline').length, 0);
assert.equal(cancelled.worldNews.filter(item => item.type === 'event').length, 0);

const clock = session('minute_deadline');
apply(clock, { id: 'bell', title: 'Final bell', urgent: true, due_in_minutes: 25 });
assert.equal(event(clock, 'bell').dueTurn, null);
assert.equal(context.describeWorldEventDeadline(world, clock, event(clock, 'bell')), 'in 25 min');
apply(clock, { id: 'bell', due_in_minutes: 5 });
assert.equal(clock.scheduledEvents.length, 1);
assert.equal(context.describeWorldEventDeadline(world, clock, event(clock, 'bell')), 'in 5 min');
clock.bonusTimeMinutes = 5;
assert.equal(context.describeWorldEventDeadline(world, clock, event(clock, 'bell')), 'due now');
apply(clock, { id: 'bell', status: 'cancelled' });
assert.equal(context.runLivingWorldTick(world, clock).events, 0);

const warningWorld = { ...world, hudConfig: { timeStep: 5, startTimeHours: 17, startTimeMinutes: 45 } };
const clockMismatch = session('named_deadline_mismatch');
clockMismatch.bonusTimeMinutes = 3;
const wrongDawn = { id: 'dawn_tide', title: 'Dawn Tide', urgent: true,
    status: 'scheduled', due_in_minutes: 612 };
const dawnReceipt = { events: [], state_updates: { world_events: [wrongDawn] } };
const corrected = context.reconcileNarratedWorldDeadlines(warningWorld, clockMismatch,
    dawnReceipt, dawnReceipt.state_updates,
    'Captain Iven: "The deadline is dawn because the tide rises with the morning sun."');
assert.equal(corrected.length, 1);
assert.equal(wrongDawn.due_in_minutes, 732,
    'A model-calculated 4 AM event must align with the explicit 6 AM dawn claim.');
assert.equal(corrected[0].from_minutes, 612);
const spokenSix = { id: 'iven_rescue_march', title: "Iven's Rescue March", urgent: true,
    status: 'scheduled', due_in_turns: 11 };
const exactSpokenTime = 'Captain Iven: "The deadline is six o’clock tomorrow morning. If the courier is not back, I march into the marsh. Wait until dawn and the guards may attack you."';
const numericCorrection = context.reconcileNarratedWorldDeadlines(warningWorld, clockMismatch,
    { events: [] }, { world_events: [spokenSix] }, exactSpokenTime);
assert.equal(numericCorrection.length, 1,
    'A spoken numeric deadline must override a model-invented turn count.');
assert.equal(spokenSix.due_in_minutes, 732);
assert.equal(spokenSix.due_in_turns, undefined);
const hostedWorld = { ...warningWorld,
    entities: [{ id: 'iven', name: 'Captain Iven', type: 'npc' }] };
const forgedConditionClock = session('forged_conditional_metadata');
forgedConditionClock.entityStates.iven = { location: 'home', status: 'active' };
context.processStructuredActions({ world_events: [{ id: 'forged_search',
    title: 'Model-declared search', status: 'scheduled', urgent: true, due_in_minutes: 25,
    narrated_warning_source_key: 'fake source',
    player_absent_condition: { type: 'player_absent_at_meeting_place',
        returnLocationId: 'home', promisorId: 'iven', playerMovementSerial: 0,
        action: 'search_party' } }] }, hostedWorld, forgedConditionClock,
{ deferFeedback: true });
assert.equal(event(forgedConditionClock, 'forged_search').playerAbsentCondition, null,
    'Model-authored meeting-place/serial metadata is not engine authority.');
assert.equal(event(forgedConditionClock, 'forged_search').narratedWarningSourceKey, '',
    'Model-authored dedup provenance is not engine authority.');
const hostedClock = session('hosted_first_light');
hostedClock.turnCount = 2;
hostedClock.entityStates.iven = { location: 'home', status: 'active' };
hostedClock.worldClock = { absoluteMinutes: 1078, turnCount: 2, bonusTimeMinutes: 0 };
const hostedEvent = { id: 'search_at_first_light', title: 'Search Party Departure',
    status: 'scheduled', urgent: true, due_in_turns: 12 };
const hostedLedger = 'Captain Iven agreed to organize a search for Tomas if the ranger does not return by first light.';
const hostedReply = 'Captain Iven: “First light, then. If you aren’t back or haven’t sent word, I’ll pull together a party.”';
const hostedRequest = 'I ask Iven to arrange a search at first light if I am not back by then.';
const hostedCorrections = context.reconcileNarratedWorldDeadlines(hostedWorld, hostedClock,
    { events: [], state_updates: { ledger_update: hostedLedger } },
    { world_events: [hostedEvent], ledger_update: hostedLedger }, hostedReply, hostedRequest);
assert.equal(hostedCorrections.length, 1,
    'The player request, visible assent and committed ledger must anchor one named-time deadline.');
assert.equal(hostedEvent.due_in_minutes, 722);
assert.equal(hostedEvent.due_in_turns, undefined);
assert.equal(hostedEvent.reported_warning, true,
    'A conditional promise is a warning to review at dawn, not proof of a departure.');
assert.equal(hostedEvent.reported_warning_speaker, 'Captain Iven');
context.processStructuredActions({ world_events: [hostedEvent] }, hostedWorld, hostedClock,
    { deferFeedback: true });
assert.equal(event(hostedClock, 'search_at_first_light').dueMinute, 1800);
assert.equal(event(hostedClock, 'search_at_first_light').dueTurn, null);
assert.equal(event(hostedClock, 'search_at_first_light').reportedWarning, true);
assert.equal(event(hostedClock, 'search_at_first_light').playerAbsentCondition?.returnLocationId, 'home');
assert.equal(event(hostedClock, 'search_at_first_light').playerAbsentCondition?.promisorId, 'iven');
const narratedSamePromise = 'Captain Iven: "If you are not back by first light, I will take two scouts to search for Tomas. They could die in the marsh."';
assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, hostedClock,
    narratedSamePromise)?.id, 'search_at_first_light',
'A narrated first-light warning must reuse the model-receipt event for the same conditional promise.');
assert.equal(hostedClock.scheduledEvents.length, 1,
    'The urgent banner must not count one promise twice under different IDs.');
const final4Request = 'I tell Iven Mara saw Tomas take the brass key east three days ago. I ask if he will arrange a search at first light if I am not back by then. I do not take the lantern, leave the square, or promise anything yet.';
const final4Promise = `Captain Iven: "First light, you have it. If you aren't back by the time the sun hits the road, I'll pull every able man from the village and we'll sweep the marsh. Just don't make me waste my men on a ghost hunt."`;
const final4Clock = session('first_light_assent_without_danger_word');
final4Clock.entityStates.iven = { location: 'home', status: 'active' };
final4Clock.worldClock = { absoluteMinutes: 1078, turnCount: 1, bonusTimeMinutes: 0 };
assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, final4Clock,
    final4Promise), null, 'A poetic sun-road metaphor alone cannot set the engine clock.');
const final4Recovered = context.recoverNarratedUrgentDeadline(hostedWorld,
    final4Clock, final4Promise, final4Request);
assert(final4Recovered, 'The explicit player request and NPC assent must recover the omitted first-light deadline.');
assert.equal(final4Recovered.dueMinute, 1800);
assert.equal(final4Recovered.playerAbsentCondition?.promisorId, 'iven');
assert.equal(final4Recovered.playerAbsentCondition?.returnLocationId, 'home');
assert.equal(final4Recovered.reportedWarning, true);
assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld,
    final4Clock, final4Promise, final4Request)?.id, final4Recovered.id,
    'Replaying the assent must not duplicate the deadline.');
const liveCoalesceClock = session('live_same_turn_turn_clock');
liveCoalesceClock.turnCount = 3;
liveCoalesceClock.entityStates.iven = { location: 'home', status: 'active' };
liveCoalesceClock.worldClock = { absoluteMinutes: 1080, turnCount: 3, bonusTimeMinutes: 0 };
const turnClockUpdate = { id: 'dawn_search_party', title: "Captain Iven's Search Party",
    status: 'scheduled', urgent: true, due_in_turns: 10 };
context.processStructuredActions({ world_events: [turnClockUpdate] }, hostedWorld,
    liveCoalesceClock, { deferFeedback: true });
liveCoalesceClock.worldTurnReceipts = [{ turn: 3,
    receipt: { state_updates: { world_events: [turnClockUpdate] } } }];
const livePlayerRequest = 'I ask him to organize a search at first light if I am not back.';
const liveNpcPromise = `Captain Iven: "Fair enough. If you aren't back by the first light of tomorrow's sun, I'll gather the watch and we'll scour the causeway."`;
const coalesced = context.recoverNarratedUrgentDeadline(hostedWorld, liveCoalesceClock,
    liveNpcPromise, livePlayerRequest);
assert.equal(coalesced?.id, 'dawn_search_party',
    'The accepted turn-count event and its spoken first-light promise must become one deadline.');
assert.equal(liveCoalesceClock.scheduledEvents.length, 1);
assert.equal(coalesced.dueTurn, null);
assert.equal(coalesced.dueMinute, 1800);
assert.equal(coalesced.reportedWarning, true);
assert.equal(coalesced.playerAbsentCondition?.promisorId, 'iven');
assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, liveCoalesceClock,
    liveNpcPromise, livePlayerRequest)?.id, coalesced.id);
assert.equal(liveCoalesceClock.scheduledEvents.length, 1);
const sunriseReply = `Captain Iven: "If the sun rises tomorrow and you haven't returned to this spot, I'll take four of my best and ride for the tower."`;
const sunriseRequest = 'I ask Captain Iven to send a search party at first light if I am not back.';
const sunriseClock = session('requested_sunrise_synonym');
sunriseClock.entityStates.iven = { location: 'home', status: 'active' };
sunriseClock.worldClock = { absoluteMinutes: 1080, turnCount: 1, bonusTimeMinutes: 0 };
const sunrisePromise = context.recoverNarratedUrgentDeadline(hostedWorld, sunriseClock,
    sunriseReply, sunriseRequest);
assert.equal(sunrisePromise?.dueMinute, 1800,
    'A named NPC accepting the requested first-light search as sunrise tomorrow must create the deadline.');
assert.equal(sunrisePromise.playerAbsentCondition?.promisorId, 'iven');
const hereReply = `Captain Iven: "First light. Fair. If the sun hits the well and you aren't standing here, I'll pull every able body from the inn and push into that mire."`;
const hereClock = session('request_if_not_standing_here');
hereClock.entityStates.iven = { location: 'home', status: 'active' };
hereClock.worldClock = { absoluteMinutes: 1080, turnCount: 1, bonusTimeMinutes: 0 };
assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, hereClock,
    hereReply, sunriseRequest)?.dueMinute, 1800,
    'A speaker may express the same requested absence as not standing at the meeting place.');
const pushClock = session('requested_search_as_push');
pushClock.entityStates.iven = { location: 'home', status: 'active' };
pushClock.worldClock = { absoluteMinutes: 1080, turnCount: 1, bonusTimeMinutes: 0 };
const pushUpdate = { id: 'first_light_search', title: 'First Light Search Party',
    status: 'scheduled', urgent: true, due_in_turns: 10 };
context.processStructuredActions({ world_events: [pushUpdate] }, hostedWorld,
    pushClock, { deferFeedback: true });
pushClock.worldTurnReceipts = [{ turn: 1,
    receipt: { state_updates: { world_events: [pushUpdate] } } }];
const pushReply = `Captain Iven: "I told you, Ranger. First light. I'll be the one waking them up. If you aren't back to tell me why the well tastes like salt, I'll lead the push myself. You have my word on it."`;
const pushRecovered = context.recoverNarratedUrgentDeadline(hostedWorld, pushClock,
    pushReply, sunriseRequest);
assert.equal(pushRecovered?.id, 'first_light_search');
assert.equal(pushClock.scheduledEvents.length, 1);
assert.equal(pushRecovered.dueTurn, null);
assert.equal(pushRecovered.dueMinute, 1800);
assert.equal(pushRecovered.playerAbsentCondition?.promisorId, 'iven',
    'An accepted model event must inherit the witnessed conditional promise, even when called a push.');
const confirmationRequest = 'Please send your people at first light if I am not back. Does he agree?';
const confirmationReply = `Captain Iven: "Fine. The agreement stands. First light, I send the party."`;
const confirmationClock = session('conditional_request_confirmed_next_turn');
confirmationClock.entityStates.iven = { location: 'home', status: 'active' };
confirmationClock.worldClock = { absoluteMinutes: 1080, turnCount: 1, bonusTimeMinutes: 0 };
assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, confirmationClock,
    confirmationReply, confirmationRequest)?.dueMinute, 1800,
    'An NPC can confirm the player\'s conditional first-light request without repeating the condition.');
const refusedConfirmation = session('conditional_request_refused_next_turn');
refusedConfirmation.entityStates.iven = { location: 'home', status: 'active' };
refusedConfirmation.worldClock = { absoluteMinutes: 1080, turnCount: 1, bonusTimeMinutes: 0 };
assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, refusedConfirmation,
    `Captain Iven: "No. First light, I won't send the party."`, confirmationRequest), null);
for (const [index, reply] of [
    `Captain Iven: "If the sun rises tomorrow and you haven't returned, I won't take my men into the marsh."`,
    `Captain Iven: "If the sun rises tomorrow and you haven't returned, I might take four of my best."`
].entries()) {
    const control = session(`sunrise_false_promise_${index}`);
    control.entityStates.iven = { location: 'home', status: 'active' };
    control.worldClock = { absoluteMinutes: 1080, turnCount: 1, bonusTimeMinutes: 0 };
    assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, control,
        reply, sunriseRequest), null, 'Refusal or speculation may not become a search-party commitment.');
}
const sunriseNoRequest = session('sunrise_without_player_request');
sunriseNoRequest.entityStates.iven = { location: 'home', status: 'active' };
sunriseNoRequest.worldClock = { absoluteMinutes: 1080, turnCount: 1, bonusTimeMinutes: 0 };
assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, sunriseNoRequest,
    sunriseReply), null, 'A poetic sunrise line without the player request is not a clock authority.');
const falseAssents = [
    `Captain Iven: "First light? No. If you aren't back, I won't pull men into the marsh."`,
    `Captain Iven: "First light, perhaps. If you aren't back, I could pull men into the marsh."`,
    `Captain Iven: "First light, I will send a patrol now. If you aren't back, I won't pull a search party together."`,
    `Captain Iven: "If you aren't back by the time the sun hits the road, I'll pull every able man from the village and sweep the marsh."`
];
falseAssents.forEach((text, index) => {
    const alternative = session(`no_false_first_light_${index}`);
    alternative.entityStates.iven = { location: 'home', status: 'active' };
    alternative.worldClock = { absoluteMinutes: 1078, turnCount: 1, bonusTimeMinutes: 0 };
    assert.equal(context.recoverNarratedUrgentDeadline(hostedWorld, alternative,
        text, final4Request), null, 'Refusals, hypotheticals and unanchored metaphors are not promises.');
});
const unrelatedDawnWarning = session('unrelated_same_hour_warning');
unrelatedDawnWarning.entityStates.iven = { location: 'home', status: 'active' };
unrelatedDawnWarning.worldClock = { absoluteMinutes: 1078, turnCount: 1, bonusTimeMinutes: 0 };
context.processStructuredActions({ world_events: [{ id: 'bridge_warning', title: 'Bridge watch relief',
    status: 'scheduled', urgent: true, reported_warning: true, due_in_minutes: 722 }] },
hostedWorld, unrelatedDawnWarning, { deferFeedback: true });
const distinctRecovery = context.recoverNarratedUrgentDeadline(hostedWorld,
    unrelatedDawnWarning, narratedSamePromise);
assert(distinctRecovery && distinctRecovery.id !== 'bridge_warning',
    'An unrelated warning at the same minute must not absorb Iven’s conditional search.');
assert.equal(unrelatedDawnWarning.scheduledEvents.length, 2);
const awayClock = JSON.parse(JSON.stringify(hostedClock));
awayClock.id = 'hosted_first_light_away';
awayClock.playerLocation = 'station';
awayClock.playerMovementSerial = 1;
context.runLivingWorldTick(hostedWorld, hostedClock);
hostedClock.bonusTimeMinutes = 727;
assert.equal(context.runLivingWorldTick(hostedWorld, hostedClock).events, 0,
    'The player never left the meeting place; the conditional search must not fire.');
assert.equal(event(hostedClock, 'search_at_first_light').status, 'cancelled');
assert.equal(event(hostedClock, 'search_at_first_light').conditionResolution, 'player_present');
assert.equal(hostedClock.consequences.filter(item => item.type === 'deadline').length, 0);
assert.equal(hostedClock.worldNews.filter(item => item.type === 'event').length, 0);
assert.doesNotMatch(draw(hostedClock), /Search Party Departure/);
assert.match(context.worldUnverifiedWaitNotice(hostedWorld, hostedClock, 727),
    /condition for Search Party Departure was not met/);
const rejectedSearch = context.worldUnmetConditionalSearchClaims(hostedWorld, hostedClock, {
    receipt: { summary: 'Iven assembled the search party.' }, legacyArgs: {},
    acceptedEvents: [], entityPatches: [{ entity_id: 'iven', activity: 'organizing search party' }]
}, 'Iven blows a whistle. Three men from the local watch assemble. We search the tower road.');
assert.equal(rejectedSearch[0]?.reason, 'conditional_deadline_not_met');
const arrivalSummary = context.worldUnmetConditionalSearchClaims(hostedWorld, hostedClock, {
    receipt: { summary: 'Captain Iven arrived with a search party and questioned why the player was still idling.' },
    legacyArgs: {}, acceptedEvents: [], entityPatches: []
}, 'Iven sees the ranger at the well and holds two scouts back before they ride.');
assert.equal(arrivalSummary[0]?.reason, 'conditional_deadline_not_met',
    'A repair summary cannot canonize an active search party after the condition failed.');
const proseOnlySearch = context.worldUnmetConditionalSearchClaims(hostedWorld, hostedClock, {
    receipt: {}, legacyArgs: {}, acceptedEvents: [], entityPatches: []
}, `Captain Iven blows a brass whistle. Within minutes, three men from the local watch assemble in the square.
Captain Iven: "Gear up! We're moving out. If the ranger hasn't come back, we search the tower road first."`);
assert.equal(proseOnlySearch[0]?.reason, 'conditional_deadline_not_met',
    'The exact hosted-style prose must fail even when a repair omits an NPC activity patch.');
const harmlessWatch = context.worldUnmetConditionalSearchClaims(hostedWorld, hostedClock, {
    receipt: { summary: 'Iven resumed ordinary morning watch.' }, legacyArgs: {},
    acceptedEvents: [], entityPatches: [{ entity_id: 'iven', activity: 'morning watch' }]
}, 'Iven watches the road and asks how the ranger slept.');
assert.equal(harmlessWatch.length, 0, 'Ordinary watch duty must not be mistaken for a launched search.');
const unfulfilledPlan = context.worldUnmetConditionalSearchClaims(hostedWorld, hostedClock, {
    receipt: { summary: 'Iven promised to organize a search party, but did not because the ranger remained.' },
    legacyArgs: { ledger_update: 'The planned search party was cancelled when the ranger stayed.' },
    acceptedEvents: [], entityPatches: [{ entity_id: 'iven', activity: 'planning a search party, not mobilizing it' }]
}, 'Iven had planned to gather men, but the ranger remained in the square. No search party departs.');
assert.equal(unfulfilledPlan.length, 0,
    'A discussed or cancelled search plan is not an actual mobilization.');
for (const status of ['scheduled', 'triggered', 'completed']) {
    const attempt = context.processStructuredActions({ world_events: [{
        id: 'search_at_first_light', status, due_in_turns: 1,
        title: 'Search Party Departure' }] }, hostedWorld, hostedClock,
    { deferFeedback: true });
    assert(attempt.moduleRejections.some(item => item.reason === 'conditional_deadline_not_met'),
        `A ${status} receipt must not re-arm the false search promise.`);
    assert.equal(event(hostedClock, 'search_at_first_light').status, 'cancelled');
    assert.equal(event(hostedClock, 'search_at_first_light').dueMinute, 1800);
}
assert.equal(context.processStructuredActions({ world_events: [{
    id: 'search_at_first_light', status: 'cancelled' }] }, hostedWorld, hostedClock,
{ deferFeedback: true }).moduleRejections.length, 0,
'An idempotent cancellation is safe to acknowledge.');
context.runLivingWorldTick(hostedWorld, awayClock);
awayClock.bonusTimeMinutes = 727;
assert.equal(context.runLivingWorldTick(hostedWorld, awayClock).events, 1,
    'When the player genuinely leaves the meeting place, the warning reaches its review point.');
assert.equal(event(awayClock, 'search_at_first_light').status, 'triggered');
assert(awayClock.consequences.some(item => item.type === 'deadline'
    && /predicted outcome has not been verified/.test(item.detail)),
    'Even with the player away, the promised search remains unverified until observed.');
const reloadedConditional = JSON.parse(JSON.stringify(hostedClock));
context.normalizeLivingWorldState(hostedWorld, reloadedConditional);
assert.equal(event(reloadedConditional, 'search_at_first_light').status, 'cancelled');
assert.equal(event(reloadedConditional, 'search_at_first_light').conditionResolution, 'player_present');
assert.equal(event(reloadedConditional, 'search_at_first_light').playerAbsentCondition?.promisorId, 'iven');
assert.equal(event(reloadedConditional, 'search_at_first_light').playerAbsentCondition?.playerMovementSerial, 0);
const alreadyTimed = { id: 'timed_conditional_search', title: 'Search Party Departure',
    status: 'scheduled', urgent: true, due_in_minutes: 722 };
const pendingClock = session('already_timed_agreement');
pendingClock.worldClock = { absoluteMinutes: 1078, turnCount: 1, bonusTimeMinutes: 0 };
assert.equal(context.reconcileNarratedWorldDeadlines(hostedWorld, pendingClock,
    { events: [], state_updates: { ledger_update: hostedLedger } },
    { world_events: [alreadyTimed], ledger_update: hostedLedger }, hostedReply, hostedRequest).length, 0,
    'An already-correct minute clock needs no duplicate correction.');
assert.equal(alreadyTimed.reported_warning, true,
    'A correct clock must still preserve the conditional, unverified-outcome semantics.');
const explicitTimed = { id: 'explicit_conditional_search', title: 'Search Party Departure',
    status: 'scheduled', urgent: true, due_in_turns: 12 };
assert.equal(context.reconcileNarratedWorldDeadlines(hostedWorld, pendingClock,
    { events: [], state_updates: { ledger_update: hostedLedger } },
    { world_events: [explicitTimed], ledger_update: hostedLedger },
    'Captain Iven: “At first light, I will gather the party if you are not back.”', hostedRequest).length, 1);
assert.equal(explicitTimed.due_in_minutes, 722);
assert.equal(explicitTimed.reported_warning, true);
const refusedAgreement = { ...hostedEvent, due_in_turns: 12,
    due_in_minutes: undefined, reported_warning: undefined };
assert.equal(context.reconcileNarratedWorldDeadlines(hostedWorld, hostedClock,
    { events: [], state_updates: { ledger_update: 'Captain Iven refused to search at first light.' } },
    { world_events: [refusedAgreement] }, hostedReply, hostedRequest).length, 0,
    'A refusal may not be converted into an agreed clock deadline.');
const uncorrroboratedAgreement = { ...hostedEvent, due_in_turns: 12,
    due_in_minutes: undefined, reported_warning: undefined };
assert.equal(context.reconcileNarratedWorldDeadlines(hostedWorld, hostedClock,
    { events: [], state_updates: { ledger_update: hostedLedger } },
    { world_events: [uncorrroboratedAgreement] }, 'Captain Iven says he will decide later.', hostedRequest).length, 0,
    'Player request and ledger alone must not forge a spoken first-light agreement.');
const numericWarning = session('spoken_six_warning');
numericWarning.bonusTimeMinutes = 3;
assert.equal(context.recoverNarratedUrgentDeadline(warningWorld, numericWarning, exactSpokenTime)?.dueMinute,
    1800, 'The numeric spoken deadline must survive an otherwise empty receipt.');
const nonconditionalClock = session('same_spoken_warning_model_and_recovery');
nonconditionalClock.worldClock = { absoluteMinutes: 1078, turnCount: 1, bonusTimeMinutes: 0 };
const dawnScouts = { id: 'dawn_scouts', title: 'Dawn scouts to causeway',
    status: 'scheduled', urgent: true, due_in_minutes: 722 };
const dawnScoutsNarrative = 'Captain Iven: "At dawn I will send scouts to the causeway. They may drown if the water rises."';
context.reconcileNarratedWorldDeadlines(warningWorld, nonconditionalClock,
    { events: [] }, { world_events: [dawnScouts] }, dawnScoutsNarrative);
assert(dawnScouts.narrated_warning_source_key,
    'A linked model deadline needs explicit spoken-source identity.');
context.processStructuredActions({ world_events: [dawnScouts,
    { id: 'dawn_supply_cart', title: 'Dawn supply cart to station',
        status: 'scheduled', urgent: true, due_in_minutes: 722 }] },
warningWorld, nonconditionalClock, { deferFeedback: true });
assert.equal(context.recoverNarratedUrgentDeadline(warningWorld, nonconditionalClock,
    dawnScoutsNarrative)?.id, 'dawn_scouts',
'Recovery must reuse the model event linked to the exact spoken warning.');
assert.equal(nonconditionalClock.scheduledEvents.length, 2,
    'A different model event at 6 AM remains an independent deadline.');
const nonconditionalReload = JSON.parse(JSON.stringify(nonconditionalClock));
context.normalizeLivingWorldState(warningWorld, nonconditionalReload);
assert.equal(event(nonconditionalReload, 'dawn_scouts').narratedWarningSourceKey,
    dawnScouts.narrated_warning_source_key,
    'Linked source identity must survive normalization and reload.');
const unrelatedDawn = { id: 'dawn_tide', title: 'Dawn Tide', urgent: true,
    status: 'scheduled', due_in_minutes: 612 };
assert.equal(context.reconcileNarratedWorldDeadlines(warningWorld, clockMismatch,
    { events: [] }, { world_events: [unrelatedDawn] }, 'The gate closes at dusk.').length, 0);
assert.equal(unrelatedDawn.due_in_minutes, 612,
    'Unrelated or ambiguous scene times must not rewrite an event.');
const warned = session('narrated_warning');
assert.equal(context.recoverNarratedUrgentDeadline(warningWorld, warned,
    'Captain Iven: "We will meet by noon."'), null,
    'An ordinary appointment must not become a danger deadline.');
const warningText = 'Captain Iven: "The tide hits the lower flats by midnight. If Tomas is trapped in a cellar, the water will drown him."';
const recovered = context.recoverNarratedUrgentDeadline(warningWorld, warned, warningText);
assert(recovered, 'An explicit timed danger in final prose must survive an empty model receipt.');
assert.equal(recovered.dueMinute, 1440);
assert.equal(recovered.reportedWarning, true);
assert.equal(recovered.urgent, true);
assert.match(recovered.description, /Captain Iven warned/);
assert.equal(context.recoverNarratedUrgentDeadline(warningWorld, warned, warningText).id,
    recovered.id, 'Replaying the final prose must not multiply the deadline.');
assert.equal(warned.scheduledEvents.length, 1);
const recoveryWarning = session('recovery_party_warning');
const recoveryClaim = 'Captain Iven: "If you are not there by dawn, I have to assume Tomas is dead. Once the sun hits the tower, I will be forced to send a recovery party, which means more men risking their necks."';
assert(context.recoverNarratedUrgentDeadline(warningWorld, recoveryWarning, recoveryClaim),
    'A specific deadline that forces a dangerous NPC decision must survive an empty receipt.');
assert.equal(recoveryWarning.scheduledEvents[0].dueMinute, 1800);
const explicitDeadlineWarning = session('explicit_dawn_deadline');
assert(context.recoverNarratedUrgentDeadline(warningWorld, explicitDeadlineWarning,
    'Captain Iven: "The deadline is dawn. If I have no word of Tomas by then, I am sending a recovery party. I will not leave a missing man to rot."'),
    'A spoken deadline is dawn must register even without a model world_event.');
assert.equal(explicitDeadlineWarning.scheduledEvents[0].dueMinute, 1800);
assert.match(explicitDeadlineWarning.scheduledEvents[0].title, /Captain Iven/,
    'A deadline at the start of dialogue should identify who made the choice.');
assert.match(explicitDeadlineWarning.scheduledEvents[0].title, /sending a recovery party/,
    'The urgent HUD must say what the speaker will do, not just who spoke and when.');
const pseudoOnly = session('pseudo_receipt_deadline');
assert.equal(context.recoverNarratedUrgentDeadline(warningWorld, pseudoOnly,
    'Iven looks worried.\n\ncommit_world_turn(events=[{"observation":"The road will be closed by midnight and everyone will drown."}])'), null,
    'A deadline mentioned only in a printed tool call is not player-heard dialogue.');
const mixedPseudo = session('narrative_before_pseudo_receipt');
const mixedWarning = context.recoverNarratedUrgentDeadline(warningWorld, mixedPseudo,
    'Captain Iven: "At dawn, I am sending two scouts because the road may close."\n\ncommit_world_turn(events=[{"observation":"The road closes by midnight."}])');
assert.equal(mixedWarning?.dueMinute, 1800,
    'A pseudo receipt must not replace the timing of a real spoken warning.');
assert.match(mixedWarning?.title || '', /Captain Iven/);
const hostedStyle = session('hosted_style_warning');
const hostedSpeech = 'Captain Iven: "At dawn, I will be staring at a salt-choked well and wondering which villager falls sick first. I will send another pair of scouts to the causeway to see if the road is still holding, and pray they do not sink into the mire."\n\ncommit_world_turn(events=[{"observation":"The route might close by midnight."}])';
const hostedRecovered = context.recoverNarratedUrgentDeadline(warningWorld, hostedStyle, hostedSpeech);
assert.equal(hostedRecovered?.dueMinute, 1800);
assert.match(hostedRecovered?.title || '', /Captain Iven:.*send another pair of scouts/,
    'An early time phrase should still surface the impending decision rather than generic scenery.');
const sixBellsWarning = session('six_bells_warning');
const sixBellsSpeech = 'Captain Iven: "By dawn—let’s say six bells—I’ll be forced to pull my men from the perimeter and march them toward the tower. My men could die in the marsh."';
const sixBellsRecovered = context.recoverNarratedUrgentDeadline(warningWorld, sixBellsWarning, sixBellsSpeech);
assert.match(sixBellsRecovered?.title || '', /Captain Iven: I’ll be forced to pull my men/,
    'The urgent banner should lead with the action, not with filler before it.');
const conditionalDawn = session('conditional_dawn');
const conditionalSpeech = 'Captain Iven: "If dawn comes and I have no word, I’ll be forced to take three of my best men in. We may walk straight into a trap or a plague."';
const conditionalRecovered = context.recoverNarratedUrgentDeadline(warningWorld, conditionalDawn, conditionalSpeech);
assert.equal(conditionalRecovered?.dueMinute, 1800,
    'A conditional spoken dawn deadline must not disappear merely because the model omitted world_events.');
assert.match(conditionalRecovered?.title || '', /Captain Iven/);
const firstLightWarning = session('first_light_warning');
const firstLightSpeech = 'Captain Iven: "At first light, maybe six or seven, I’ll be forced to lead a search party. We’ll stumble into whatever poisoned the well and my men could drown."';
const firstLightRecovered = context.recoverNarratedUrgentDeadline(warningWorld, firstLightWarning, firstLightSpeech);
assert.equal(firstLightRecovered?.dueMinute, 1800,
    'First light is the earliest announced action time, even when the exact bell is uncertain.');
assert.match(firstLightRecovered?.title || '', /lead a search party/);
const routeWarning = session('route_warning');
const routeClaim = 'Captain Iven: "The tide creeps up the causeway by midnight. After that, the salt-flats turn into a slurry that will swallow a horse whole. You go now, you have a few hours of dry footing."';
assert(context.recoverNarratedUrgentDeadline(warningWorld, routeWarning, routeClaim),
    'An imminent route becoming impassable must also be tracked as a warning.');
const childrenWarning = session('children_warning');
const childrenClaim = 'Captain Iven: "Midnight. I told you. By twelve, the causeway is gone, and the way to that tower is closed until the tide recedes. If the salt-glass is in their blood, they will stiffen and stop breathing before the dawn."';
const childrenDeadline = context.recoverNarratedUrgentDeadline(warningWorld, childrenWarning, childrenClaim);
assert(childrenDeadline, 'A dawn warning phrased as stop breathing must be tracked.');
assert.equal(childrenDeadline.dueMinute, 1800);
context.normalizeLivingWorldState(warningWorld, warned);
assert.equal(event(warned, recovered.id).reportedWarning, true,
    'Reported-warning semantics must survive serialization normalization.');
assert.equal(event(warned, recovered.id).reportedWarningSpeaker, 'Captain Iven');
event(warned, recovered.id).conditionOnTrigger = 'Tomas drowned';
context.runLivingWorldTick(warningWorld, warned);
warned.bonusTimeMinutes = 375;
assert.equal(context.runLivingWorldTick(warningWorld, warned).events, 1);
assert.equal(event(warned, recovered.id).status, 'triggered');
assert.equal(warned.locationStates.home.conditions.length, 0,
    'A reported prediction must never apply its claimed physical condition.');
assert(warned.worldNews.some(item => /outcome is unverified/.test(item.text)));
assert(warned.consequences.some(item => item.type === 'deadline'
    && /not been verified/.test(item.detail)));
assert(warned.engineEvents.some(item => /do not invent the warned harm/.test(JSON.stringify(item))));
apply(warned, { id: recovered.id, status: 'cancelled' });
assert.notEqual(warned.consequences.find(item => item.type === 'deadline').state, 'resolved',
    'Cancelling the reminder in the firing wait must not erase the reached deadline.');
assert.match(draw(warned), /Consequence · Deadline reached/);
const witnessedWorld = { ...world, entities: [{ id: 'iven', name: 'Captain Iven', type: 'npc' }] };
const observedOutcome = { legacyArgs: { world_events: [{ id: recovered.id, status: 'cancelled' }] },
    acceptedEvents: [{ type: 'activity', status: 'completed', actor_id: 'iven',
        evidence: 'A brass horn sounded across the square.' }],
    entityPatches: [{ entity_id: 'iven', activity: 'blowing the alarm horn' }] };
context.attachObservedWorldDeadlineOutcome(witnessedWorld, warned, observedOutcome);
assert.match(warned.consequences.find(item => item.type === 'deadline').detail,
    /Captain Iven: blowing the alarm horn/,
    'An accepted observed action should make the deadline aftermath concrete without confirming a rumored death.');
assert.deepEqual(Array.from(warned.consequences.find(item => item.type === 'deadline').actorIds), ['iven']);
const observedWithoutCancellation = session('observed_without_cancel');
observedWithoutCancellation.turnCount = 2;
observedWithoutCancellation.scheduledEvents = [{ id: 'scout_deadline', reportedWarning: true,
    reportedWarningSpeaker: 'Captain Iven', lastTriggeredTurn: 2, status: 'triggered' }];
observedWithoutCancellation.consequences = [{ type: 'deadline', state: 'active',
    sourceEventId: 'deadline_scout_deadline_2', detail: 'Outcome not verified.' }];
context.attachObservedWorldDeadlineOutcome(witnessedWorld, observedWithoutCancellation, {
    legacyArgs: {}, acceptedEvents: [{ id: 'wait_event', type: 'time', status: 'completed', actor_id: 'player' }],
    entityPatches: [{ entity_id: 'iven', activity: 'dispatching two scouts to the causeway' }]
});
assert.match(observedWithoutCancellation.consequences[0].detail, /dispatching two scouts/,
    'A canonical observed speaker action must show at the reached deadline even without a model cancellation.');
const eventOnlyOutcome = session('event_only_outcome');
eventOnlyOutcome.turnCount = 2;
eventOnlyOutcome.scheduledEvents = [{ id: 'scout_deadline', reportedWarning: true,
    reportedWarningSpeaker: 'Captain Iven', lastTriggeredTurn: 2, status: 'triggered' }];
eventOnlyOutcome.consequences = [{ type: 'deadline', state: 'active',
    sourceEventId: 'deadline_scout_deadline_2', detail: 'Outcome not verified.' }];
context.attachObservedWorldDeadlineOutcome(witnessedWorld, eventOnlyOutcome, {
    legacyArgs: {}, acceptedEvents: [{ id: 'scouts_dispatched', type: 'activity', status: 'completed',
        actor_id: 'iven', evidence: 'Captain Iven dispatched two scouts to the causeway.' }],
    entityPatches: []
});
assert.match(eventOnlyOutcome.consequences[0].detail, /dispatched two scouts/,
    'A completed action event must make the reached deadline visible without requiring a duplicate entity patch.');
const movementOutcome = session('movement_outcome');
movementOutcome.turnCount = 2;
movementOutcome.playerLocation = 'home';
movementOutcome.scheduledEvents = [{ id: 'march_deadline', reportedWarning: true,
    reportedWarningSpeaker: 'Captain Iven', lastTriggeredTurn: 2, status: 'triggered' }];
movementOutcome.consequences = [{ type: 'deadline', state: 'active',
    sourceEventId: 'deadline_march_deadline_2', detail: 'Outcome not verified.' }];
context.attachObservedWorldDeadlineOutcome(witnessedWorld, movementOutcome, {
    legacyArgs: {}, acceptedEvents: [{ id: 'iven_marched', type: 'movement', status: 'completed',
        actor_id: 'iven', from_location_id: 'home', to_location_id: 'station',
        evidence: 'Iven marched out of the square toward the station.' }], entityPatches: []
});
assert.match(movementOutcome.consequences[0].detail, /Captain Iven: departed for Station/,
    'A witnessed, accepted speaker departure is visible without asserting the threatened harm.');
const ambiguous = session('two_warnings_one_speaker');
ambiguous.turnCount = 2;
ambiguous.scheduledEvents = [
    { id: 'first_warning', reportedWarning: true, reportedWarningSpeaker: 'Captain Iven', lastTriggeredTurn: 2 },
    { id: 'second_warning', reportedWarning: true, reportedWarningSpeaker: 'Captain Iven', lastTriggeredTurn: 2 }
];
ambiguous.consequences = [{ type: 'deadline', state: 'active',
    sourceEventId: 'deadline_first_warning_2', detail: 'Outcome not verified.' }];
context.attachObservedWorldDeadlineOutcome(witnessedWorld, ambiguous, {
    ...observedOutcome, legacyArgs: { world_events: [{ id: 'first_warning', status: 'cancelled' }] }
});
assert.equal(ambiguous.consequences[0].detail, 'Outcome not verified.',
    'One NPC action must not be attached arbitrarily to multiple warnings from that speaker.');
warned.turnCount += 1;
apply(warned, { id: recovered.id, status: 'cancelled' });
assert.notEqual(warned.consequences.find(item => item.type === 'deadline').state, 'resolved',
    'A later empty cancellation must not erase an unverified warning consequence.');
apply(warned, { id: recovered.id, status: 'cancelled',
    resolution: 'The player saw Iven call off the recovery party after confirming the courier is safe.' });
assert.notEqual(warned.consequences.find(item => item.type === 'deadline').state, 'resolved',
    'A model-authored resolution sentence without a linked completed event cannot clear the deadline.');
const proofEvent = { id: 'turn_3_confirmed_safe', type: 'dialogue', status: 'completed', actor_id: 'iven',
    evidence: 'Captain Iven confirmed he called off the search after the courier returned.' };
context.attachObservedWorldDeadlineOutcome(witnessedWorld, warned, {
    legacyArgs: { world_events: [{ id: recovered.id, status: 'cancelled',
        resolution: 'Iven called off the recovery party after confirming the courier is safe.',
        resolution_event_id: 'wrong_event' }] },
    acceptedEvents: [proofEvent], entityPatches: []
});
assert.notEqual(warned.consequences.find(item => item.type === 'deadline').state, 'resolved',
    'An unrelated event id cannot serve as resolution proof.');
context.attachObservedWorldDeadlineOutcome(witnessedWorld, warned, {
    legacyArgs: { world_events: [{ id: recovered.id, status: 'cancelled',
        resolution: 'Iven called off the recovery party after confirming the courier is safe.',
        resolution_event_id: 'turn_3_unrelated' }] },
    acceptedEvents: [{ id: 'turn_3_unrelated', type: 'activity', status: 'completed', actor_id: 'iven',
        evidence: 'Captain Iven repaired the old village bell outside the inn.' }], entityPatches: []
});
assert.notEqual(warned.consequences.find(item => item.type === 'deadline').state, 'resolved',
    'A real but unrelated event cannot validate a warning resolution.');
context.attachObservedWorldDeadlineOutcome(witnessedWorld, warned, {
    legacyArgs: { world_events: [{ id: recovered.id, status: 'cancelled',
        resolution: 'Iven called off the recovery party after confirming the courier is safe.',
        resolution_event_id: proofEvent.id }] },
    acceptedEvents: [proofEvent], entityPatches: []
});
assert.equal(warned.consequences.find(item => item.type === 'deadline').state, 'resolved');

const turnSource = functionSource('executeWorldTurn');
assert.match(turnSource, /recoverNarratedUrgentDeadline\(world, sess, fullText,\s*submittedInput \|\| userInput\)/,
    'Final narrative reconciliation must run even after a valid empty receipt.');

console.log('✓ urgent factual events and reported warning deadlines remain visible without turning predictions into canon');
