// Offline checks for ordinary conversation context; no provider calls.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const engine = require('../virtual_humans/engine/vh-conversation-engine');
const { buildContext } = require('./app_source');
const now = Date.UTC(2026, 8, 8, 12);
const message = { id: 'u1', role: 'user', text: 'I remembered your interview. How did it go?', timestamp: now - 1000, readAt: now, awaitingReply: true };
const receipt = { topic: 'The interview', openQuestion: 'How did it go?', reaction: {
    summary: 'Feeling supported because they remembered.', evidence: 'I remembered your interview', lingerMinutes: 60 } };
const conversation = engine.receive(null, receipt, [message], now);
assert.equal(conversation.reaction.sourceMessageId, 'u1');
assert.equal(engine.reactionContext(conversation, now + 30 * 60000).salience, 50);
assert.equal(engine.reactionContext(conversation, now + 60 * 60000), null);
assert.deepEqual(engine.normalize(JSON.parse(JSON.stringify(conversation))), conversation);
for (const invalid of [{ ...message, readAt: 0 }, { ...message, invalidated: true }, { ...message, timestamp: now + 1000 }]) {
    assert.equal(engine.receive(null, receipt, [invalid], now).reaction, null);
}
assert.equal(engine.receive(null, { reaction: { ...receipt.reaction, evidence: 'You are my best friend' } }, [message], now).reaction, null);
const repeated = engine.receive(conversation, receipt, [{ ...message, id: 'u2', timestamp: now + 1000, readAt: now + 1000 }], now + 1000);
assert.equal(repeated.reaction.expiresAt, conversation.reaction.expiresAt);
const paused = engine.receive(conversation, { status: 'paused', resumeReason: 'Work interruption' }, [], now + 1000);
assert.equal(paused.openQuestion, conversation.openQuestion);
assert.deepEqual(paused.reaction, conversation.reaction);
console.log('PASS evidence grounding, unread/future exclusion, impression expiry, reload, repetition and interruption continuity');
assert.equal(engine.hasAffect({}), false);
assert.equal(engine.hasAffect({ conversation: receipt }), false);
assert.equal(engine.hasAffect({ valence_change: NaN }), false);
assert.equal(engine.hasAffect({ valence_change: 0 }), true);
const c = { humanDynamics: { energy: 15, stress: 80 }, lifeRuntime: { activities: { goals: [] } } };
const bandwidth = engine.receptiveness(c, { availability: 'available', withNames: ['Coworker'], now });
assert.equal(bandwidth.bandwidth, 'divided');
assert.deepEqual(bandwidth.reasons, ['tired', 'under stress', 'with other people']);
assert.equal(engine.receptiveness(c, { availability: 'asleep', now }).bandwidth, 'unavailable');
assert(!('willingness' in bandwidth));
console.log('PASS explicit zero differs from absent affect; bandwidth does not invent interest or willingness');
const ctx = { console, state: { globalSettings: {}, personas: [], companions: [], companionTimelines: {}, companionThreads: {} } };
buildContext(vm, ['normalizeCompanion', 'buildCompanionContextPacket', 'companionContextPacketText', 'companionCompactPrompt', 'sanitizeCompanionObserverCommit'], ctx);
const person = ctx.normalizeCompanion({ id: 'context', name: 'Ada', age: 28, humanDynamics: { energy: 20, stress: 80, lastUpdated: now }, continuityRuntime: { conversation } });
const packet = ctx.buildCompanionContextPacket(person, [message], now, { experience: { realTimeLife: false } });
assert.equal(packet.lingeringReaction.sourceMessageId, 'u1');
assert(ctx.companionContextPacketText(packet).includes('subjective, fading'));
assert(ctx.companionCompactPrompt(person, [message], now, { experience: { realTimeLife: false } }).includes('Feeling supported'));
assert.equal(ctx.buildCompanionContextPacket(person, [message], now + 61 * 60000).lingeringReaction, null);
assert(!ctx.sanitizeCompanionObserverCommit(person, { agency: {} }, now).state);
console.log('PASS full and compact prompts carry the grounded impression; missing observer affect is not fabricated');

const roomy = engine.fitRequest({max_tokens: 3000, messages: [{role:'user', content:'Hello'}]}, {contextSize:8192});
assert.equal(roomy.body.max_tokens, 3000, 'configured output must not be silently capped to a quarter of context');
const tight = engine.fitRequest({max_tokens: 3000, messages: [{role:'user', content:'Hello'}]}, {contextSize:1024});
assert(tight.audit.estimatedInputTokens + tight.audit.outputReserve + tight.audit.margin <= 1024);
console.log('PASS configured output allowance and actual context ceiling');
