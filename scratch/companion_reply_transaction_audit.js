const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source.js');

// Real reply orchestration; only provider, presentation, and unrelated
// cognition/media services are mocked. No network or browser saves are used.
function fixture() {
    const human = { id: 'h', name: 'Ada', mood: { label: 'content' },
        memory: { longTerm: [] }, usage: { textTurns: 0 }, videoJobs: [] };
    const user = { id: 'u', role: 'user', type: 'text', text: 'Hello',
        timestamp: 1, readAt: 1, awaitingReply: true, replyDueAt: 1, replyJobId: 'job' };
    const timeline = { id: 'a', messages: [user] };
    const other = { id: 'b', messages: [] };
    const store = { activeSessionId: 'a', sessions: [timeline, other] };
    let resolveProvider;
    let committedSources = [];
    let observedDetails = null;
    const requestSnapshots = [];
    const response = new Promise(resolve => { resolveProvider = resolve; });
    const ctx = {
        VHWorldEngine: require('../virtual_humans/engine/vh-world-engine'),
        VHConversationEngine: require('../virtual_humans/engine/vh-conversation-engine.js'),
        companionCompactPrompt: () => 'Synthetic profile',
        companionRequestContextSize: () => 8192,
        state: { globalSettings: {}, companions: [human] },
        companionReplyInFlight: new Set(), companionReplyJobsInFlight: new Map(), companionAgencyInFlight: new Set(),
        getCompanion: () => human,
        getActiveCompanionTimeline: () => store.sessions.find(t => t.id === store.activeSessionId),
        ensureCompanionTimelineStore: () => store,
        companionTextProviderId: () => 'test',
        normalizeCompanionChatExperience: () => ({ realTimeLife: true, replyBursts: false }),
        companionChatExperience: () => ({}),
        isPlainObject: x => !!x && typeof x === 'object' && !Array.isArray(x),
        safeJsonClone: x => JSON.parse(JSON.stringify(x)),
        normalizeCompanionMessage: x => ({ ...x }),
        captureCompanionRuntime: () => ({}),
        livingId: () => 'response',
        companionToolsFor: () => [],
        companionPendingPersonaVision: () => null,
        companionConsumeStartingScenario: () => '',
        companionContinuity: () => ({ revision: 0 }),
        buildCompanionMessages: (c, messages) => { requestSnapshots.push(messages.map(message => message.id)); return []; },
        applyCompanionGenerationConfig: x => x,
        sanitizeMessagesForProvider: x => x,
        companionProviderOutputBudget: () => 100,
        providerApiBase: () => 'mock:',
        providerAuthHeaders: () => ({}), providerAttributionHeaders: () => ({}),
        fetchCompanionCompletion: () => response,
        companionProtocolLeakDetected: () => false,
        extractCompanionEmbeddedToolCalls: text => ({ visibleText: text, toolCalls: [] }),
        companionVisibleReplyLimit: x => x,
        sanitizeCompanionTextReply: x => x, quarantineCompanionProtocolText: x => x,
        extractCompanionToolCalls: () => ({}),
        companionHasDeliverableReply: text => !!text,
        companionAlcoholContext: () => false,
        companionSexualSystemActive: () => false,
        companionApplyMindCues: () => [],
        companionDecisionPressures: () => [],
        applyCompanionTurnCommit(c, commit, at, source, sourceIds) { committedSources = [...sourceIds]; },
        applyCompanionSocialPostCommit() {},
        splitCompanionReplyIntoBubbles: text => [text],
        consolidateCompanionMemory() {}, persistCompanionRuntime() {},
        scheduleCompanionTurnObservation(c, messages, reply, details) { observedDetails = details; }, showToast() {}
    };
    vm.createContext(ctx);
    for (const name of ['companionTimelineBusy', 'assertCompanionReplyTarget',
        'activateCompanionTimeline', 'sendCompanionMessage']) {
        vm.runInContext(functionSource(name), ctx);
    }
    return { ctx, human, user, timeline, other, store, requestSnapshots,
        committedSources: () => committedSources, observedDetails: () => observedDetails,
        finish: () => resolveProvider({ ok: true, json: async () => ({ choices: [{ message: { content: 'Hello back' } }] }) }) };
}

(async () => {
    const f = fixture();
    const pending = f.ctx.sendCompanionMessage(f.human, f.timeline.messages, 'Hello', 10,
        { existingUserMessage: f.user, replyBatch: [f.user], responseGroupId: 'job' });
    assert.equal(f.ctx.companionReplyInFlight.has('h'), true);
    assert.equal(f.user.awaitingReply, true);
    assert.equal(f.ctx.activateCompanionTimeline('h', 'b'), null);
    assert.equal(f.store.activeSessionId, 'a');
    f.finish();
    const result = await pending;
    assert.equal(result.replyMessages.length, 1);
    assert.equal(f.timeline.messages[1].responseGroupId, 'job');
    assert.equal(f.user.awaitingReply, false);
    assert.equal(f.user.replyDueAt, 0);
    assert.equal(f.ctx.companionReplyInFlight.size, 0);
    console.log('PASS: active reply blocks timeline replacement; completion consumes the durable claim');
    f.user.awaitingReply = true;
    await f.ctx.sendCompanionMessage(f.human, f.timeline.messages, 'Hello', 11,
        { existingUserMessage: f.user, replyBatch: [f.user], responseGroupId: 'job' });
    assert.equal(f.timeline.messages.length, 2);
    assert.equal(f.human.usage.textTurns, 1);
    assert.equal(f.user.awaitingReply, false);
    console.log('PASS: retry reuses an already committed response group');


    const affect = fixture();
    let affectWrites = 0;
    affect.ctx.extractCompanionToolCalls = () => ({ state: { valence_change: 6, warmth_change: 3 } });
    affect.ctx.applyCompanionMoodUpdate = (c, delta) => { affectWrites++; c.mood.valence = delta.valence_change; };
    const responding = affect.ctx.sendCompanionMessage(affect.human, affect.timeline.messages, 'Hello', 10,
        { existingUserMessage: affect.user, replyBatch: [affect.user], responseGroupId: 'job' });
    affect.finish();
    await responding;
    assert.equal(affectWrites, 1);
    assert.equal(affect.timeline.messages[1].moodLabel, 'content');
    assert.equal(affect.timeline.messages[1].turnAudit.affectStatus, 'committed');
    console.log('PASS: speaking receipt commits affect before the visible reply and records its ownership');

    const stale = fixture();
    const late = stale.ctx.sendCompanionMessage(stale.human, stale.timeline.messages, 'Hello', 10,
        { existingUserMessage: stale.user });
    // Simulate an external replacement that bypasses the UI/core switch gate.
    stale.store.activeSessionId = 'b';
    stale.finish();
    await assert.rejects(late, error => error.code === 'STALE_COMPANION_REPLY');
    assert.equal(stale.timeline.messages.length, 1);
    assert.equal(stale.other.messages.length, 0);
    assert.equal(stale.human.usage.textTurns, 0);
    assert.equal(stale.user.awaitingReply, true);
    assert.equal(stale.ctx.companionReplyInFlight.size, 0);
    console.log('PASS: stale provider result changes neither timeline and releases the lock');

    const queued = fixture();
    const firstReply = queued.ctx.sendCompanionMessage(queued.human, queued.timeline.messages, 'First', 10,
        { existingUserMessage: queued.user, replyBatch: [queued.user], responseGroupId: 'first-job' });
    const lateMessage = { id: 'late', role: 'user', type: 'text', text: 'Second', timestamp: 11,
        readAt: 11, awaitingReply: true, replyDueAt: 11, replyJobId: 'second-job' };
    queued.timeline.messages.push(lateMessage);
    queued.finish();
    await firstReply;
    assert.deepEqual(queued.requestSnapshots[0], ['u']);
    assert.deepEqual(queued.committedSources(), ['u']);
    assert.deepEqual(queued.observedDetails().sourceMessageIds, ['u']);
    assert(!queued.observedDetails().observationMessageIds.includes('late'));
    assert.equal(lateMessage.awaitingReply, true);
    console.log('PASS: a message sent during generation stays queued and is absent from the earlier prompt, commit and observer');
})().catch(error => { console.error(error); process.exitCode = 1; });
