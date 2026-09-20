/* Behavior audit, not a passing release gate. Uses production decisions at the production 5s cadence.
   Fixed circumstances isolate policy; these numbers exclude provider/network latency. */
const fs = require('node:fs');
const vm = require('node:vm');
const { buildContext, functionSource } = require('./app_source');
const engine = require('../virtual_humans/engine/vh-activity-engine');
const start = Date.UTC(2026, 8, 7, 12);
const experience = { realTimeLife: true, replyDelays: true, allowNoReply: true };
const ctx = { console, companionLifeState: c => c.life,
    companionNextWakeAt: (c, at) => c.life.situation.endsAt || at + 3600000,
    companionSetDecisionEvidence() {}, advanceCompanionEmotionState: () => ({}) };
buildContext(vm, ['advanceCompanionMessageAttention', 'advanceCompanionHumanDynamics', 'companionResponsePlan'], Object.assign(ctx, {
    companionRegulationFactors: () => ({ recovery: 1 }), companionAlcoholContext: () => false,
    companionSexualSystemActive: () => false
}));
function person(patch = {}) {
    const c = { id: 'audit', humanDynamics: { energy: 65, stress: 35, anger: 0, socialNeed: 45, lastUpdated: start },
        relationshipDynamics: { warmth: 35, resentment: 0 }, commitments: [],
        life: { activity: 'home', label: 'at home', availability: 'available', situation: {} } };
    Object.assign(c.humanDynamics, patch.dynamics || {});
    Object.assign(c.relationshipDynamics, patch.relationship || {});
    Object.assign(c, patch.other || {});
    if (patch.life) c.life = patch.life;
    return c;
}
function simulate(name, options = {}) {
    const c = person(options), inbox = [...(options.history || [])];
    const m = { id: 'new', role: 'user', type: options.type || 'text', text: options.text || 'hey',
        timestamp: start, deliveredAt: start + 500, deliveryState: 'sent', awaitingReply: true };
    if (!options.legacyPending) {
        const plan = ctx.companionResponsePlan(c, m, start, experience);
        Object.assign(m, { attention: plan.attention, deliveredAt: plan.deliveredAt, readAt: plan.readAt, replyDueAt: plan.replyDueAt });
    }
    inbox.push(m);
    let ready = null;
    for (let elapsed = 0; elapsed <= (options.horizon || 8 * 3600000); elapsed += 5000) {
        if (options.change) options.change(c, elapsed);
        ctx.advanceCompanionMessageAttention(c, m, start + elapsed, experience, inbox);
        if (m.readAt) m.deliveryState = 'read';
        if (m.attention?.stage === 'ready') { ready = elapsed / 1000; break; }
        if (!m.awaitingReply) break;
    }
    return { name, readSeconds: m.readAt ? (m.readAt - start) / 1000 : null,
        readySeconds: ready, finalStage: m.attention.stage, finalReason: m.attention.reason };
}
const busy = (company = 0) => ({ activity: 'working', label: 'working', availability: 'busy',
    situation: { withNames: Array(company).fill('colleague'), endsAt: start + 8 * 3600000 } });
const results = [
    simulate('Available: hey'),
    simulate('Available: legacy pending message', { legacyPending: true }),
    simulate('Available: yes', { text: 'yes' }),
    simulate('Available: 900-character message', { text: 'a'.repeat(900) }),
    simulate('Available: high energy', { dynamics: { energy: 90, stress: 10 } }),
    simulate('Available: photo', { type: 'photo' }),
    simulate('Already chatting: follow-up', { history: [{ id: 'reply', role: 'companion', text: 'I am here!', timestamp: start - 1000 }] }),
    simulate('Busy alone: hey', { life: busy() }),
    simulate('Busy with two people: hey', { life: busy(2) }),
    simulate('Busy: urgent content', { life: busy(), text: 'SOS' }),
    simulate('Busy: ordinary content', { life: busy(), text: 'hey' }),
    simulate('Busy: closer relationship', { life: busy(), relationship: { warmth: 95 } }),
    simulate('Busy: unrelated old promise', { life: busy(), other: { commitments: [{ status: 'pending', dueAt: start - 86400000, text: 'Send a photo someday' }] } }),
    simulate('Very low capacity, constant circumstances', { dynamics: { energy: 5, stress: 80 } }),
    simulate('Twenty-minute restorative activity', { life: { activity: 'Taking a restorative break', label: 'Taking a restorative break', availability: 'busy', situation: { endsAt: start + 20 * 60000 } },
        change(c, elapsed) { if (elapsed >= 20 * 60000) c.life = person().life; } }),
    simulate('Free after five-minute meeting', { life: busy(), change(c, elapsed) { if (elapsed >= 5 * 60000) c.life = person().life; } })
];
const labelEffects = ['work', 'working', 'working on an essay', 'studying', 'rest', 'resting', 'at home'].map(label => {
    const c = person({ dynamics: { energy: 80, stress: 20 }, life: { activity: label, label, availability: 'available', situation: {} } });
    ctx.advanceCompanionHumanDynamics(c, start + 8 * 3600000);
    return { label, energyAfter8h: +c.humanDynamics.energy.toFixed(2), stressAfter8h: +c.humanDynamics.stress.toFixed(2) };
});
const resources = engine.normalize({ lastAdvancedAt: start });
engine.addGoal(resources, 'meal', 'meal', start);
engine.advance(resources, start + 60 * 60000, { availability: 'available', energy: 65 });
const output = { generatedAt: new Date().toISOString(), timing: results, labelEffects,
    meal: { state: resources.goals[0].status, supplies: resources.resources, outcomes: resources.events.filter(e => e.kind === 'step_completed').map(e => e.summary) } };
(async () => {
    const ledger = [];
    const beatContext = { window: { HordeLabs: { taskCapabilities: () => [{ id: 'life_beat', available: true }] } },
        companionSituationAt: () => ({ label: 'at home', availability: 'available' }),
        labsProposal: async () => ({ candidate: { beats: [{ anchorId: 'nonexistent', summary: 'Completed a trip to an unauthored place.' }] } }),
        livingId: (prefix, value) => `${prefix}:${value}`, normalizeCompanionLifeEvent: raw => raw,
        companionRecordContinuityEvent: (c, event) => ledger.push(event) };
    vm.createContext(beatContext);
    vm.runInContext(functionSource('processCompanionLabsLifeBeat'), beatContext);
    const c = { id: 'probe', lifeProfile: { initializedAt: start - 1, weeklySchedule: [], places: [], socialCircle: [] },
        lifeRuntime: { lastLabsBeatAt: 0 }, lifeEvents: [] };
    await beatContext.processCompanionLabsLifeBeat(c, start);
    output.ungroundedLifeBeat = { acceptedLifeEvents: c.lifeEvents.length,
        acceptedAsCertain: ledger[0]?.certainty, summary: ledger[0]?.summary };
    fs.writeFileSync('docs/vh-life-sim-audit-results-2026-09-07.json', JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify(output, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
