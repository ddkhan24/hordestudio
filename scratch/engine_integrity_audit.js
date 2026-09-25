/**
 * Engine integrity regressions for the 2026-09-06 fixes.
 * Assertions for repaired invariants; retained compatibility gaps are labelled.
 * No browser storage, network, or authored project data is touched.
 * Run: node scratch/engine_integrity_audit.js
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext, functionSource } = require('./app_source.js');
const observations = [];
const record = (name, result) => observations.push({ name, result: JSON.parse(JSON.stringify(result)) });
const clone = value => JSON.parse(JSON.stringify(value));

const worldContext = {
    console: { log() {}, warn() {}, error() {} },
    showToast() {},
    normalizeLivingWorldState() {},
    normalizeWorldGameRules: () => ({ modules: { schedules: true } })
};
buildContext(vm, [
    'findWorldTravelPath', 'movePlayerAlongWorldPath', 'buildSemanticWorldGraph',
    'syncNPCSchedules', 'getWorldTimeData', 'detectNarratedDepartures',
    'captureWorldTurnState'
], worldContext);

const oneWay = {
    locations: [
        { id: 'a', name: 'Square', exits: [{ targetLocationId: 'b', text: 'to Garden' }] },
        { id: 'b', name: 'Garden', exits: [] }
    ], entities: []
};
const mapEdge = worldContext.buildSemanticWorldGraph(oneWay).edges[0];
assert.equal(worldContext.findWorldTravelPath(oneWay, 'b', 'a'), null);
assert.equal(mapEdge.isOneWay, true);
record('Map preserves direction for a legacy one-way connection', mapEdge);

const weighted = {
    locations: [
        { id: 'a', name: 'Start', exits: [
            { targetLocationId: 'b', travelTime: 120 },
            { targetLocationId: 'c', travelTime: 1 }
        ] },
        { id: 'b', name: 'Finish', exits: [] },
        { id: 'c', name: 'Shortcut', exits: [{ targetLocationId: 'b', travelTime: 1 }] }
    ], entities: []
};
const traveler = { id: 's', playerLocation: 'a', engineEvents: [] };
const journey = worldContext.movePlayerAlongWorldPath(weighted, traveler, weighted.locations[1]);
assert.equal(journey.travelMinutes, 2);
record('Path search selects the available 2-minute route', {
    path: journey.path, travelMinutes: journey.travelMinutes
});

const explicitTraveler = { id: 'explicit', playerLocation: 'a' };
const explicitJourney = worldContext.movePlayerAlongWorldPath(weighted, explicitTraveler, weighted.locations[1],
    { exit: weighted.locations[0].exits[0] });
assert.equal(explicitJourney.travelMinutes, 120);
assert.equal(explicitJourney.path.join(','), 'a,b');
record('An explicit exit uses the chosen route rather than substituting a faster one', explicitJourney.path);

const blocked = { id: 'blocked', playerLocation: 'a', pendingChecks: [{}], engineEvents: [] };
const blockedBefore = clone(blocked);
assert.equal(worldContext.movePlayerAlongWorldPath(weighted, blocked, weighted.locations[1]).reason, 'pending_check');
assert.deepEqual(blocked, blockedBefore);
record('Pending check prevents every movement mutation', blocked.playerLocation);

const hierarchy = {
    locations: [
        { id: 'house', name: 'House', exits: [] },
        { id: 'room', name: 'Private Room', parentLocationId: 'house', exits: [] }
    ], entities: []
};
assert.equal(worldContext.findWorldTravelPath(hierarchy, 'house', 'room').join(','), 'house,room');
record('Containment creates traversable access without any authored exit', 'house -> room');

const scheduleWorld = {
    id: 'w', startLocationId: 'a',
    hudConfig: { enableSchedules: true, startTimeHours: 8, timeStep: 5 },
    locations: [{ id: 'a', name: 'Home', exits: [] }, { id: 'b', name: 'Work', exits: [] }],
    entities: [{ id: 'ada', name: 'Ada', type: 'npc', schedule: [
        { time: '08:00', locationId: 'b', activity: 'working' }
    ] }]
};
const scheduleSession = {
    id: 's', turnCount: 1, playerLocation: 'a',
    entityStates: { ada: { location: 'a', pinnedUntilTurn: 2 } }, livingWorldActivity: {}
};
worldContext.syncNPCSchedules(scheduleWorld, scheduleSession);
assert.equal(scheduleSession.entityStates.ada.location, 'a');
scheduleSession.turnCount = 2;
worldContext.syncNPCSchedules(scheduleWorld, scheduleSession);
assert.equal(scheduleSession.entityStates.ada.location, 'a');
assert(scheduleSession.entityStates.ada.scheduleBlockedReason);
assert.equal(worldContext.findWorldTravelPath(scheduleWorld, 'a', 'b'), null);
record('NPC pin expiration cannot teleport across disconnected geography', scheduleSession.entityStates.ada);

scheduleWorld.entities[0].startLocation = 'a';
scheduleWorld.locations[0].exits = [{ targetLocationId: 'b', travelTime: 15 }];
worldContext.syncNPCSchedules(scheduleWorld, scheduleSession);
assert.equal(scheduleSession.entityStates.ada.location, null);
assert.equal(scheduleSession.entityStates.ada.journey.arrivalMinute, 500);
const restoredTravel = clone(scheduleSession);
const healing = { state: { activeWorldId: 'w', worlds: [scheduleWorld],
    worldInstances: { w: { activeSessionId: 's', sessions: [restoredTravel] } } },
    normalizeLivingWorldState() {}, normalizePlayerRulesState() {}, normalizeQuestState() {}, console };
vm.createContext(healing);
vm.runInContext(functionSource('getCurrentWorldSession'), healing);
assert.equal(healing.getCurrentWorldSession().entityStates.ada.location, null);
restoredTravel.turnCount = 4;
worldContext.syncNPCSchedules(scheduleWorld, restoredTravel);
assert.equal(restoredTravel.entityStates.ada.location, null);
restoredTravel.turnCount = 5;
worldContext.normalizeWorldGameRules = () => ({ modules: { schedules: false } });
worldContext.syncNPCSchedules(scheduleWorld, restoredTravel);
assert.equal(restoredTravel.entityStates.ada.location, 'b');
assert.equal(restoredTravel.entityStates.ada.journey, undefined);
worldContext.normalizeWorldGameRules = () => ({ modules: { schedules: true } });
record('Trip survives reload and arrives on time even with schedules disabled', restoredTravel.entityStates.ada.location);

const negationWorld = {
    locations: [
        { id: 'a', name: 'Office', exits: ['to Lobby'] },
        { id: 'b', name: 'Lobby', exits: [] }
    ], entities: [{ id: 'ada', name: 'Ada', type: 'npc' }]
};
const negationSession = { id: 's', playerLocation: 'a', entityStates: { ada: { location: 'a' } } };
const departure = worldContext.detectNarratedDepartures(negationWorld, negationSession,
    'Ada refuses to leave the room.');
assert.equal(departure.length, 0);
record('Departure scanner does not interpret refusal as leaving', departure);

const timeSession = { turnCount: 101, bonusTimeMinutes: 0 };
const clockWorld = { hudConfig: { startTimeHours: 8, timeStep: 5 } };
const beforeClock = worldContext.getWorldTimeData(clockWorld, timeSession).currentTotalMinutes;
clockWorld.hudConfig.timeStep = 10;
const afterClock = worldContext.getWorldTimeData(clockWorld, timeSession).currentTotalMinutes;
assert.equal(afterClock, beforeClock);
timeSession.turnCount++;
assert.equal(worldContext.getWorldTimeData(clockWorld, timeSession).currentTotalMinutes, beforeClock + 10);
record('Clock edits affect future turns without rewriting elapsed time', {
    beforeMinutes: beforeClock, afterMinutes: afterClock
});

const dynamicsContext = {
    companionLifeState: (_companion, at) => ({ availability: at < 9 * 3600000 ? 'asleep' : 'available' }),
    companionSexualSystemActive: () => false,
    companionAlcoholContext: () => false,
    companionRegulationFactors: () => ({ recovery: 1 })
};
buildContext(vm, ['advanceCompanionHumanDynamics'], dynamicsContext);
const initialHuman = { humanDynamics: { energy: 50, lastUpdated: 3600000 } };
const incremental = clone(initialHuman);
for (let hour = 2; hour <= 9; hour++) dynamicsContext.advanceCompanionHumanDynamics(incremental, hour * 3600000);
const catchup = clone(initialHuman);
dynamicsContext.advanceCompanionHumanDynamics(catchup, 9 * 3600000);
assert(incremental.humanDynamics.energy > 95);
assert.equal(catchup.humanDynamics.energy, incremental.humanDynamics.energy);
record('Online and catch-up dynamics agree across sleep/wake transition', {
    incrementalEnergy: incremental.humanDynamics.energy,
    singleCatchupEnergy: catchup.humanDynamics.energy
});

// Exercise the real agency orchestration up to its durable pre-request save.
// A process close after this save leaves this exact snapshot on disk.
(async () => {
    const message = { id: 'm', role: 'user', text: 'Hello', timestamp: 1,
        deliveredAt: 1, deliveryState: 'read', awaitingReply: true, replyDueAt: 2 };
    const companion = { id: 'vh', lifeRuntime: {}, socialFeedRuntime: {} };
    const timeline = { id: 't', messages: [message], experience: {} };
    let durableAtRequest;
    let requestReached = false;
    const ctx = {
        console: { warn() {}, error() {} },
        state: { companions: [companion], globalSettings: { companionAgencyPaused: true } },
        refreshCompanionEnvironment: async () => {},
        advanceCompanionHumanDynamics() {}, advanceCompanionEmotionState() {},
        companionMatureIntentions: () => [],
        getActiveCompanionTimeline: () => timeline,
        normalizeCompanionChatExperience: () => ({}),
        getCompanionThread: () => timeline.messages,
        applyCompanionSilenceProgress: () => false,
        providerHasCredentials: () => true,
        companionTextProviderId: () => 'test',
        companionAgencyInFlight: new Set(),
        companionReplyInFlight: new Set(),
        companionObserverQueues: new Map(),
        // The real browser queues an immediate follow-up pass when another
        // message is already due. This isolated assertion tests the durable
        // claim only, so retain the scheduling contract without recursing.
        setTimeout: () => 0,
        advanceCompanionMessageAttention: () => false,
        livingId: (prefix, value) => `${prefix}_${value}`,
        companionRecordContinuityEvent() {},
        companionContinuity: () => ({ intentions: [] }),
        saveState: async () => { if (!requestReached) durableAtRequest = clone(timeline); },
        sendCompanionMessage: async () => {
            requestReached = true;
            assert.equal(durableAtRequest.messages[0].awaitingReply, true);
            assert(durableAtRequest.messages[0].replyJobId);
            return {};
        }
    };
    vm.createContext(ctx);
    vm.runInContext(functionSource('processCompanionAgency'), ctx);
    await ctx.processCompanionAgency(100);
    assert.equal(requestReached, true);
    record('Pending reply remains retryable in the durable pre-request snapshot', durableAtRequest.messages[0]);
    message.awaitingReply = true;
    message.replyDueAt = 2;
    ctx.saveState = async () => { throw new Error('Storage unavailable'); };
    await assert.rejects(ctx.processCompanionAgency(200), /Storage unavailable/);
    assert.equal(ctx.companionAgencyInFlight.size, 0);
    assert.equal(message.awaitingReply, true);
    record('Failed durable claim leaves a retryable message and releases the agency lock', true);

    for (const observation of observations) console.log(JSON.stringify(observation));
    console.log(`${observations.length} integrity and compatibility checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
