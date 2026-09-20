const assert = require('node:assert/strict');
const engine = require('../virtual_humans/engine/vh-activity-engine');
const t = 1800000000000, minute = 60000;
const free = { availability: 'available', energy: 70 };
const busy = { availability: 'private', label: 'a meeting', energy: 70 };
const tick = (state, minutes, context = free) => engine.advance(state, t + minutes * minute, context);
function state() { return engine.normalize({ lastAdvancedAt: t }); }
function test(name, fn) { fn(); console.log(`PASS ${name}`); }
test('a meal requires ingredients, preparation, and eating before the goal completes', () => {
    const s = state(); engine.addGoal(s, 'meal', 'meal', t);
    tick(s, 19); assert.equal(s.resources.ingredients, undefined);
    tick(s, 20); assert.equal(s.resources.ingredients, 1);
    tick(s, 21); assert.equal(s.resources.ingredients, 0);
    tick(s, 45); assert.equal(s.resources.meal, 1);
    const delta = tick(s, 60);
    assert.equal(s.resources.meal, 0); assert.equal(delta.energy, 12);
    assert.equal(s.goals[0].status, 'completed');
    assert.equal(s.events.filter(e => e.kind === 'completed').length, 1);
    assert.deepEqual(tick(s, 60), { energy: 0, stress: 0, hunger: 0 });
});
test('interruption and reload retain work and charge resources exactly once', () => {
    let s = state(); engine.addGoal(s, 'meal', 'meal', t);
    tick(s, 30); assert.equal(s.resources.ingredients, 0);
    tick(s, 40, busy); assert.equal(s.goals[0].status, 'paused');
    assert.equal(s.goals[0].steps[1].progressMs, 10 * minute);
    s = engine.normalize(JSON.parse(JSON.stringify(s)));
    tick(s, 55); assert.equal(s.resources.ingredients, 0); assert.equal(s.resources.meal, 1);
    tick(s, 70); assert.equal(s.goals[0].status, 'completed');
    assert(s.events.some(e => e.summary.startsWith('Resumed')));
});
test('resource prerequisites block and can later resume without inventing supplies', () => {
    const s = state(); const goal = engine.addGoal(s, 'meal', 'meal', t);
    goal.steps.shift();
    tick(s, 10); assert.equal(goal.status, 'blocked'); assert.equal(s.resources.meal, undefined);
    s.resources.ingredients = 1; tick(s, 35);
    assert.equal(s.resources.meal, 1);
});
test('recovery competes with a focus goal and its consequence changes later capacity', () => {
    const s = state(); engine.addGoal(s, 'focus', 'work', t);
    tick(s, 10);
    engine.addGoal(s, 'recovery', 'rest', t + 10 * minute);
    const delta = tick(s, 30, { ...free, energy: 15 });
    assert.equal(s.goals[0].status, 'paused'); assert.equal(s.goals[0].steps[0].progressMs, 10 * minute);
    assert.equal(s.goals[1].status, 'completed'); assert.equal(delta.energy, 18);
    tick(s, 50); assert.equal(s.goals[0].status, 'completed');
});
test('abandoning an activity stops progress and consequences', () => {
    const s = state(); const goal = engine.addGoal(s, 'recovery', 'rest', t);
    tick(s, 10); goal.status = 'abandoned';
    assert.deepEqual(tick(s, 60), { energy: 0, stress: 0, hunger: 0 });
    assert.equal(goal.steps[0].progressMs, 10 * minute);
});
test('one long free interval equals minute-wise execution; no future goal runs before creation', () => {
    const a = state(), b = state();
    engine.addGoal(a, 'meal', 'meal', t); engine.addGoal(b, 'meal', 'meal', t);
    const first = tick(a, 60); let energy = 0, stress = 0;
    for (let i = 1; i <= 60; i++) { const d = tick(b, i); energy += d.energy; stress += d.stress; }
    assert.equal(energy, first.energy); assert.equal(stress, first.stress);
    assert.deepEqual(a.resources, b.resources); assert.deepEqual(a.goals, b.goals);
    const c = state(); engine.addGoal(c, 'focus', 'future', t + 90 * minute);
    tick(c, 60); assert.equal(c.goals[0].steps[0].progressMs, 0);
});

test('future higher-priority goals cannot steal time before they exist', () => {
    const a = state(), b = state();
    for (const s of [a, b]) {
        engine.addGoal(s, 'focus', 'work', t);
        engine.addGoal(s, 'recovery', 'rest', t + 10 * minute);
    }
    tick(a, 50, { ...free, energy: 15 });
    for (let i = 1; i <= 50; i++) tick(b, i, { ...free, energy: 15 });
    assert.deepEqual(a.goals, b.goals);
});
