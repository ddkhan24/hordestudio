const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext, functionSource } = require('./app_source');
const now = Date.now();
async function observerProbe(change, committedAffect = false) {
    let release, begin;
    const started = new Promise(resolve => { begin = resolve; });
    const message = { id: 'r', responseGroupId: 'r', role: 'companion', text: 'hello',
        turnAudit: { affectStatus: committedAffect ? 'committed' : 'pending' } };
    const timeline = { id: 'a', messages: [message] };
    let active = timeline;
    const c = { id: 'h', separatedCognition: true, mood: {}, continuityRuntime: { revision: 0 } };
    let writes = 0, calls = 0;
    const ctx = { console, VHConversationEngine: require('../virtual_humans/engine/vh-conversation-engine'), companionObserverQueues: new Map(), state: {},
        getCompanion: () => c, getActiveCompanionTimeline: () => active, getCompanionThread: () => active.messages,
        refreshCompanionObserverCapabilities: async () => {}, companionObserverPrompt: () => [],
        repairCompanionTurnCommit: async () => { calls++; begin(); return new Promise(resolve => { release = resolve; }); },
        sanitizeCompanionObserverCommit: (c, commit) => commit,
        applyCompanionMoodUpdate: () => { writes++; }, applyCompanionTurnCommit() {},
        companionContinuity: () => c.continuityRuntime, persistCompanionRuntime() {}, saveState: async () => {} };
    vm.createContext(ctx); vm.runInContext(functionSource('scheduleCompanionTurnObservation'), ctx);
    const details = { timelineId: 'a', responseGroupId: 'r', sourceMessageIds: [], nowMs: now };
    const task = ctx.scheduleCompanionTurnObservation(c, timeline.messages, 'hello', details);
    await started;
    if (change === 'timeline') active = { id: 'b', messages: [] };
    if (change === 'revision') c.continuityRuntime.revision++;
    if (change === 'transcript') timeline.messages.push({ id: 'new', role: 'user', text: 'Wait' });
    if (change === 'invalidated') message.invalidated = true;
    release({ commit: { state: { valence_change: 6 } } });
    await task;
    if (!change) {
        await ctx.scheduleCompanionTurnObservation(c, timeline.messages, 'hello', details);
        assert.equal(calls, 1, 'duplicate response group must not reapply observation');
    }
    return { writes, status: message.turnAudit.observerStatus };
}
(async () => {
    for (const change of ['timeline', 'revision', 'transcript', 'invalidated']) {
        assert.deepEqual(await observerProbe(change), { writes: 0, status: 'rejected_stale' });
    }
    assert.deepEqual(await observerProbe(null), { writes: 1, status: 'committed' });
    assert.deepEqual(await observerProbe(null, true), { writes: 0, status: 'committed' });
    console.log('PASS: observer ownership, revision, invalidation, newer input, exactly-once affect');
    const ctx = { console, state: { globalSettings: {}, personas: [], companions: [] },
        companionPendingPersonaVision: () => null, companionInputSupports: () => false };
    buildContext(vm, ['normalizeCompanion', 'buildCompanionMessages', 'companionConversationTransition',
        'companionToolsFor', 'companionAttentionContext', 'decideCompanionAttention'], ctx);
    const c = ctx.normalizeCompanion({ id: 'h', name: 'Ada', age: 28, libidoEnabled: true,
        locationMode: 'custom', timezoneOffsetMinutes: 0, sleepArchetype: 'normal' });
    c.continuityRuntime.conversationGoal = { type: 'practical', objective: 'Choose a cafe together', reason: 'Make plans' };
    c.continuityRuntime.lastExchangeAt = now - 1000;
    assert.equal(ctx.normalizeCompanion(c).continuityRuntime.lastExchangeAt, now - 1000);
    const messages = [{ id: 'a', role: 'companion', type: 'text', text: 'Cafe or park?', timestamp: now-2000 },
        { id: 'u', role: 'user', type: 'text', text: 'Cafe', timestamp: now-1000 },
        { id: 'bad', role: 'companion', text: 'INVALIDATED', invalidated: true, timestamp: now }];
    const prompt = ctx.buildCompanionMessages(c, messages, now, { performanceOnly: true });
    assert(!JSON.stringify(prompt).includes('INVALIDATED'));
    assert(prompt[0].content.includes('Choose a cafe together'));
    assert(ctx.companionToolsFor(c, false, true).some(t => t.function.name === 'companion_state'));
    assert(!ctx.companionToolsFor(c, false, true).some(t => t.function.name === 'commit_human_turn'));
    const experience = { realTimeLife: false, replyDelays: true, allowNoReply: true };
    const attention = ctx.decideCompanionAttention(c, { id: 'u', text: 'Cafe', timestamp: now }, now,
        experience, ctx.companionAttentionContext(c, now, experience));
    assert.equal(attention.stage, 'ready');
    assert.equal(attention.composeUntil, 0);
    console.log('PASS: valid history, conversation intention, foreground affect capability, immediate engaged reply');
    const bedtime = Date.UTC(2026, 8, 8, 0, 0);
    const exchange = [{ role: 'user', timestamp: bedtime-100000 }, { role: 'companion', timestamp: bedtime-90000 }];
    const transition = ctx.companionConversationTransition(c, exchange, bedtime-60000);
    assert(transition.engaged);
    assert.equal(transition.upcoming.availability, 'asleep');
    assert.equal(ctx.companionConversationTransition(c, exchange, bedtime).upcoming, null);
    console.log('PASS: sleep transition is available before departure, never fabricated after sleeping');
})().catch(error => { console.error(error); process.exitCode = 1; });
