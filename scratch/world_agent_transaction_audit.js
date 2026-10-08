/** World Agent proposals must save atomically or leave no new world state. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

(async () => {
    const world = { id: 'w', entities: [] };
    const session = { id: 's', turnCount: 10, _worldEpoch: 0, marker: 'before', worldNews: [] };
    const state = { worldInstances: { w: { sessions: [session] } } };
    let saves = 0;
    let feedback = 0;
    let rejectActions = false;
    let failSave = false;
    const context = buildContext(vm, ['runWorldAgent', 'attemptWorldStateMutation'], {
        state, worldTurnInProgress: false, worldMutationInProgress: false,
        normalizeWorldAgentConfig: () => ({ model: 'fixture/model' }),
        buildWorldAgentDigest: () => 'fixture world',
        authHeaders: () => ({}),
        fetchWorldObservedJSON: async () => ({
            response: { ok: true },
            data: { choices: [{ message: { content: JSON.stringify({
                developments: [{ summary: 'An NPC plans a meeting.' }],
                world_events: [{ id: 'meeting', title: 'Meeting', due_turn: 12 }]
            }) } }] }, diagnostic: () => null
        }),
        parseWorldAgentPayload: JSON.parse,
        sanitizeWorldAgentActions: parsed => ({ actions: { world_events: parsed.world_events }, dropped: 0 }),
        processStructuredActions: (_actions, _world, sess) => {
            sess.marker = 'tentative';
            world.entities.push({ id: 'new_person', sessionOrigin: sess.id });
            return { moduleRejections: rejectActions ? [{ reason: 'invalid' }] : [], feedback: [] };
        },
        addWorldNews: (sess, summary) => sess.worldNews.push(summary),
        captureWorldTurnState: (_world, sess) => ({ marker: sess.marker,
            entities: JSON.parse(JSON.stringify(world.entities)), news: [...sess.worldNews] }),
        restoreWorldTurnState: (_world, sess, snapshot) => {
            sess.marker = snapshot.marker;
            sess.worldNews = [...snapshot.news];
            world.entities = JSON.parse(JSON.stringify(snapshot.entities));
            return true;
        },
        saveWorldsState: async () => { saves++; if (failSave) throw new Error('disk failed'); },
        flushWorldActionFeedback: () => { feedback++; }
    });

    rejectActions = true;
    const rejected = await context.runWorldAgent(world, session);
    assert.equal(rejected.applied, false);
    assert.equal(rejected.rejected.length, 1);
    assert.equal(session.marker, 'before');
    assert.deepEqual(world.entities, []);
    assert.deepEqual(session.worldNews, []);
    assert.equal(feedback, 0);
    assert.equal(saves, 1, 'a rejected proposal only persists the attempted interval');
    assert.equal(context.worldMutationInProgress, false);

    rejectActions = false;
    failSave = true;
    await assert.rejects(context.runWorldAgent(world, session), /disk failed/);
    assert.equal(session.marker, 'before');
    assert.deepEqual(world.entities, []);
    assert.deepEqual(session.worldNews, []);
    assert.equal(feedback, 0);
    assert.equal(context.worldMutationInProgress, false);

    failSave = false;
    const accepted = await context.runWorldAgent(world, session);
    assert.equal(accepted.applied, true);
    assert.equal(session.marker, 'tentative');
    assert.equal(world.entities[0].id, 'new_person');
    assert.deepEqual(session.worldNews, ['An NPC plans a meeting.']);
    assert.equal(feedback, 1, 'feedback occurs after the save succeeds');
    assert.equal(context.worldMutationInProgress, false);
    console.log('✓ World Agent rejection and save failure roll back; accepted proposal saves before feedback');
})().catch(error => { console.error(error); process.exitCode = 1; });
