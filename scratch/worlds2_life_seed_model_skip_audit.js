/** Do not charge a model for an unconnected outsider's nonexistent past. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext, functionSource } = require('./app_source');

const dependencies = { console };
buildContext(vm, [
    'stableWorldRoll', 'lifeSeedSlug', 'livingClamp', 'chooseTimelineHome',
    'authoredStartingRelationshipSeeds', 'fallbackTimelineLifePlan'
], dependencies);

let requests = 0;
const context = {
    fallbackTimelineLifePlan: dependencies.fallbackTimelineLifePlan,
    requestTimelineLifePlan: async () => {
        requests++;
        return { summary: 'Model seed', people: [{ id: 'known', name: 'Known person' }], home: {} };
    },
    applyTimelineLifePlan: (_world, _sess, _persona, _origin, plan, source) => ({
        source, people: plan.people, home: plan.home
    }),
    showToast() {},
    console
};
const initialize = vm.runInNewContext(`${functionSource('minimalTimelineOriginPlan')}\n${functionSource('initializeTimelineLife')}\ninitializeTimelineLife`, context);

(async () => {
    const baseWorld = {
        id: 'frontier', name: 'The Salt-Glass Watch',
        description: 'A small fantasy frontier RPG.',
        locations: [{ id: 'inn', name: 'The Reed Inn', description: 'Temporary lodging.' }],
        entities: [],
        startingLives: [{ id: 'ranger', name: 'The Ranger', role: 'marsh ranger', socialRank: 'outsider',
            description: 'An itinerant ranger hired to find a courier.', startLocationId: 'inn' }]
    };
    const session = { id: 'timeline', originId: 'ranger', playerLocation: 'inn' };
    const minimal = await initialize(baseWorld, session, null);
    assert.equal(requests, 0, 'unconnected outsider start called the paid model');
    assert.equal(minimal.source, 'deterministic_origin');
    assert.equal(minimal.people.length, 0);

    const withPersona = await initialize(baseWorld, session, { id: 'persona', name: 'Mira', text: 'A remembered family.' });
    assert.equal(requests, 1, 'an explicit Persona was incorrectly bypassed');
    assert.equal(withPersona.source, 'model');

    baseWorld.startingLives[0].startingRelationships = [{ npcId: 'mara', label: 'former guide' }];
    const authored = await initialize(baseWorld, session, null);
    assert.equal(requests, 2, 'an authored relationship was incorrectly bypassed');
    assert.equal(authored.source, 'model');

    baseWorld.startingLives[0].startingRelationships = [];
    baseWorld.startingLives[0].homeLocationId = 'inn';
    const withHome = await initialize(baseWorld, session, null);
    assert.equal(requests, 3, 'an authored home was incorrectly bypassed');
    assert.equal(withHome.source, 'model');

    baseWorld.startingLives[0] = { id: 'ranger', name: 'The Innkeeper', role: 'innkeeper',
        description: 'Established local resident.', startLocationId: 'inn' };
    const settled = await initialize(baseWorld, session, null);
    assert.equal(requests, 4, 'an established resident was incorrectly bypassed');
    assert.equal(settled.source, 'model');
    console.log('PASS minimal outsider origin avoids model call while Persona, authored ties/home and settled starts retain it');
})().catch(error => { console.error(error); process.exitCode = 1; });
