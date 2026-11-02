/**
 * Canonical World turn receipt / immersion engine adversarial audit.
 * Run with: node scratch/immersion_engine_audit.js
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app, buildContext } = require('./app_source.js');

const context = {
    console: { log() {}, warn() {}, error() {} },
    state: {},
    showToast() {},
    rollForScenePopulation() {},
    processStructuredActions(args) {
        context.lastAppliedArgs = JSON.parse(JSON.stringify(args));
        if (args.location_id) context.activeSession.playerLocation = args.location_id;
        (args.npc_moves || []).forEach(move => {
            context.activeSession.entityStates[move.npc_id].location = move.target_location_id;
            context.activeSession.entityStates[move.npc_id].pinnedUntilTurn = context.activeSession.turnCount + 6;
        });
        if (args.outfit_update) context.activeSession.outfit = args.outfit_update;
        return { movementResult: args.location_id ? { ok: true, moved: true, path: [] } : null };
    }
};
buildContext(vm, [
    'normalizeWorldTurnReceipt', 'validateWorldTurnReceipt', 'commitWorldTurnReceipt',
    'buildWorldSceneFrame', 'extractInlineWorldTurnReceipt', 'getWorldTimeData',
    'applyRegexScripts', 'detectNarratedPresence'
], context);

function fixture() {
    const world = {
        id: 'world',
        gameRules: { profileId: 'full_rpg' },
        locations: [
            { id: 'square', name: 'Village Square', mapType: 'outdoor', exits: ['to Chapel', 'to Inn'] },
            { id: 'chapel', name: 'Chapel', mapType: 'building', exits: ['to Village Square'] },
            { id: 'inn', name: 'Inn', mapType: 'building', exits: ['to Village Square'] }
        ],
        entities: [
            { id: 'rowena', name: 'Sister Rowena', type: 'npc' },
            { id: 'maera', name: 'Maera', type: 'npc' }
        ],
        hudConfig: { stats: [] }
    };
    const sess = {
        id: 'session', turnCount: 8, playerLocation: 'square',
        outfit: 'shirt and trousers', inventory: [],
        entityStates: {
            rowena: { location: 'square', observations: [] },
            maera: { location: 'inn', observations: [] }
        },
        turnEvents: [], worldTurnReceipts: [], playerKnownEvents: [],
        playerState: { status: 'active', conditions: [] }
    };
    context.activeSession = sess;
    return { world, sess };
}

function receipt(overrides = {}) {
    return {
        summary: 'A turn happened.',
        scene: {
            player_location_id: 'square',
            player_location_changed: false,
            present_character_ids: ['rowena']
        },
        events: [],
        entity_updates: [],
        state_updates: {},
        ...overrides
    };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('another character walking to a location never teleports the player', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        scene: { player_location_id: 'chapel', player_location_changed: true, present_character_ids: [] },
        events: [{
            type: 'movement', actor_id: 'rowena', status: 'completed',
            from_location_id: 'square', to_location_id: 'chapel',
            evidence: 'Rowena walks into the chapel.'
        }]
    }));
    assert.equal(result.legacyArgs.location_id, undefined);
    assert.equal(result.legacyArgs.npc_moves[0].npc_id, 'rowena');
    assert.equal(result.legacyArgs.npc_moves[0].target_location_id, 'chapel');
    assert(result.rejectedEvents.some(item => item.reason === 'player_location_assertion_mismatch'));
});

test('same-turn entity assertions validate against the projected ending scene', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        scene: {
            player_location_id: 'square',
            player_location_changed: false,
            present_character_ids: []
        },
        events: [{
            type: 'movement', actor_id: 'rowena', status: 'completed',
            from_location_id: 'square', to_location_id: 'chapel'
        }],
        entity_updates: [{
            entity_id: 'rowena', location: 'chapel',
            activity: 'entering the chapel', interacting: []
        }]
    }));
    assert.equal(result.legacyArgs.npc_moves[0].target_location_id, 'chapel');
    assert(!result.rejectedEvents.some(item => item.reason === 'location_assertion_mismatch'));
    assert.equal(result.entityPatches[0].activity, 'entering the chapel');
});

test('consecutive NPC movement legs use the projected origin', () => {
    for (let attempt = 0; attempt < 3; attempt++) {
        const { world, sess } = fixture();
        const candidate = receipt({
            state_updates: { time_skip_minutes: 120 },
            events: [
                { type: 'movement', actor_id: 'rowena', status: 'completed',
                    from_location_id: 'square', to_location_id: 'chapel' },
                { type: 'movement', actor_id: 'rowena', status: 'completed',
                    from_location_id: 'chapel', to_location_id: 'square' }
            ]
        });
        const result = context.validateWorldTurnReceipt(world, sess, candidate);
        assert(!result.rejectedEvents.some(item => item.reason === 'actor_origin_mismatch'),
            JSON.stringify(result.rejectedEvents));
        assert.equal(result.acceptedEvents.filter(item => item.type === 'movement').length, 2);
        assert.equal(result.acceptedEvents[1].from_location_id, 'chapel');
        context.commitWorldTurnReceipt(world, sess, candidate, {}, 'test');
        assert.equal(sess.entityStates.rowena.location, 'square');
    }
});

test('an incorrect second NPC origin remains rejected', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        state_updates: { time_skip_minutes: 120 },
        events: [
            { type: 'movement', actor_id: 'rowena', status: 'completed',
                from_location_id: 'square', to_location_id: 'chapel' },
            { type: 'movement', actor_id: 'rowena', status: 'completed',
                from_location_id: 'inn', to_location_id: 'square' }
        ]
    }));
    assert(result.rejectedEvents.some(item => item.reason === 'actor_origin_mismatch'));
    assert.equal(result.acceptedEvents.filter(item => item.type === 'movement').length, 1);
});

test('display regex does not turn a present NPC into a canonical arrival claim', () => {
    for (let attempt = 0; attempt < 3; attempt++) {
        const { world, sess } = fixture();
        context.state.regexScripts = [{ find: 'Rowena', replace: 'Maera', target: 'ai', enabled: true }];
        const rawNarrative = 'Rowena stands beside you in the square.';
        const display = context.applyRegexScripts(rawNarrative, 'ai');
        assert.equal(display, 'Maera stands beside you in the square.');
        assert.equal(context.detectNarratedPresence(world, sess, rawNarrative).length, 0);
        assert.equal(context.detectNarratedPresence(world, sess, display)[0]?.id, 'maera');
    }
    const auditBlock = app.slice(app.indexOf('// Scrubber: Remove any hallucinated location/system headers'),
        app.indexOf('const audit = sess.lastTurnAudit;', app.indexOf('// Scrubber: Remove any hallucinated location/system headers')));
    assert.match(auditBlock, /const auditText = cleanText;/);
    assert.match(auditBlock, /detectNarratedPresence\(world, sess, auditText\)/);
    context.state.regexScripts = [];
});

test('"walks toward" is tracked but does not complete movement', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        events: [{
            type: 'movement', actor_id: 'rowena', status: 'in_progress',
            from_location_id: 'square', to_location_id: 'chapel',
            evidence: 'Rowena starts toward the chapel.'
        }]
    }));
    assert.equal(result.legacyArgs.npc_moves, undefined);
    assert.equal(result.acceptedEvents.length, 0);
    assert.equal(result.informationalEvents.length, 1);
});

test('a naked legacy player location is always ignored', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        state_updates: { location_id: 'chapel' }
    }));
    assert.equal(result.legacyArgs.location_id, undefined);
});

test('unrequested player movement is rejected even when the model calls it completed', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        scene: { player_location_id: 'chapel', player_location_changed: true, present_character_ids: [] },
        events: [{
            type: 'movement', actor_id: 'player', status: 'completed',
            from_location_id: 'square', to_location_id: 'chapel'
        }]
    }));
    assert.equal(result.legacyArgs.location_id, undefined);
    assert(result.rejectedEvents.some(item => item.reason === 'player_movement_not_authorized'));
});

test('explicit caused forced movement can move the player through a valid route', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        scene: { player_location_id: 'chapel', player_location_changed: true, present_character_ids: [] },
        events: [{
            type: 'movement', actor_id: 'player', status: 'completed',
            from_location_id: 'square', to_location_id: 'chapel',
            movement_mode: 'carried', caused_by_actor_id: 'rowena',
            cause: 'Rowena carries the unconscious player into the chapel.'
        }]
    }));
    assert.equal(result.legacyArgs.location_id, 'chapel');
    assert(!result.rejectedEvents.some(item => item.reason === 'player_movement_not_authorized'));
});

test('a player movement matching deterministic user intent is accepted once', () => {
    const { world, sess } = fixture();
    sess.playerLocation = 'chapel'; // deterministic intent compiler already committed it
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        scene: { player_location_id: 'chapel', player_location_changed: true, present_character_ids: [] },
        events: [{
            type: 'movement', actor_id: 'player', status: 'completed',
            from_location_id: 'square', to_location_id: 'chapel'
        }]
    }), {
        playerStartLocationId: 'square',
        committedPlayerDestinationId: 'chapel',
        playerMovementAuthorized: true,
        authorizedPlayerDestinationId: 'chapel'
    });
    assert.equal(result.legacyArgs.location_id, undefined, 'the same move would have executed twice');
    assert.equal(result.acceptedEvents.length, 1);
});

test('NPC outfit changes patch the NPC, never the player', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        events: [{
            type: 'outfit', actor_id: 'rowena', status: 'completed',
            outfit: 'gold vestments'
        }]
    }));
    assert.equal(result.legacyArgs.outfit_update, undefined);
    assert.equal(result.entityPatches[0].entity_id, 'rowena');
    assert.equal(result.entityPatches[0].outfit, 'gold vestments');
});

test('several NPC outfits stay actor-scoped and incomplete NPC clothing rejects', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({ events: [
        { type: 'outfit', actor_id: 'rowena', status: 'completed', outfit: 'gold vestments' },
        { type: 'outfit', actor_id: 'maera', status: 'completed', outfit: 'grey coat' },
        { type: 'outfit', actor_id: 'maera', status: 'completed', outfit: '' }
    ] }));
    assert.deepEqual(JSON.parse(JSON.stringify(result.entityPatches.map(item => [item.entity_id, item.outfit]))),
        [['rowena', 'gold vestments'], ['maera', 'grey coat']]);
    assert(result.rejectedEvents.some(item => item.reason === 'missing_outfit'));
    assert.equal(result.legacyArgs.outfit_update, undefined);
    assert.equal(sess.outfit, 'shirt and trousers');
});

test('an empty player outfit echo uses only a verified precommitted outfit', () => {
    for (let attempt = 0; attempt < 3; attempt++) {
        const { world, sess } = fixture();
        sess.outfit = 'linen shirt';
        const candidate = receipt({ events: [{ type: 'outfit', actor_id: 'player',
            status: 'completed', outfit: '' }] });
        const result = context.validateWorldTurnReceipt(world, sess, candidate,
            { precommittedOutfit: 'linen shirt' });
        assert(!result.rejectedEvents.some(item => item.reason === 'missing_outfit'));
        assert.equal(result.acceptedEvents[0]?.outfit, 'linen shirt');
        assert.equal(sess.outfit, 'linen shirt');
        const unsupported = context.validateWorldTurnReceipt(world, sess, candidate);
        assert(unsupported.rejectedEvents.some(item => item.reason === 'missing_outfit'));
    }
});

test('actorless legacy outfit and inventory mutations cannot touch the player', () => {
    const { world, sess } = fixture();
    const result = context.validateWorldTurnReceipt(world, sess, receipt({
        state_updates: {
            outfit_update: 'wrong outfit',
            inventory_add: ['imaginary key'],
            inventory_remove: ['real key']
        }
    }));
    assert.equal(result.legacyArgs.outfit_update, undefined);
    assert.equal(result.legacyArgs.inventory_add, undefined);
    assert.equal(result.legacyArgs.inventory_remove, undefined);
});

test('the ending cast is a checksum, not a teleport command', () => {
    const { world, sess } = fixture();
    const committed = context.commitWorldTurnReceipt(world, sess, receipt({
        scene: {
            player_location_id: 'square',
            player_location_changed: false,
            present_character_ids: ['rowena', 'maera']
        }
    }), {}, 'test');
    assert.equal(sess.entityStates.maera.location, 'inn');
    assert.equal(committed.audit.cast_checksum_match, false);
    assert(committed.audit.rejected.some(item => item.reason === 'present_cast_checksum_mismatch'));
});

test('witnessed canonical events become provenance-backed NPC knowledge', () => {
    const { world, sess } = fixture();
    context.commitWorldTurnReceipt(world, sess, receipt({
        events: [{
            id: 'evt_bell', type: 'discovery', actor_id: 'player', status: 'completed',
            witnessed_by: ['rowena'], evidence: 'The player discovers the hidden bell.'
        }]
    }), {}, 'test');
    assert(sess.entityStates.rowena.observations.some(obs =>
        obs.eventId === 'evt_bell' && obs.source === 'witnessed' && obs.confidence === 1));
    const stored = sess.turnEvents.find(event => event.id === 'evt_bell');
    assert.equal(stored.location_id, 'square');
    assert.deepEqual(
        { day: stored.world_time.day, hour: stored.world_time.hour, minute: stored.world_time.minute },
        { day: 1, hour: 8, minute: 35 }
    );
});

test('every no-op response still creates a versioned receipt and audit', () => {
    const { world, sess } = fixture();
    const committed = context.commitWorldTurnReceipt(world, sess, receipt(), {}, 'test');
    assert.equal(sess.worldStateVersion, 1);
    assert.equal(sess.worldTurnReceipts.length, 1);
    assert.equal(committed.audit.accepted, 0);
});

test('tagged provider fallback uses the same receipt shape', () => {
    const parsed = context.extractInlineWorldTurnReceipt(
        '<world_turn_receipt>{"scene":{"player_location_id":"square","player_location_changed":false,"present_character_ids":[]},"events":[],"entity_updates":[],"state_updates":{}}</world_turn_receipt>');
    assert.equal(parsed.scene.player_location_id, 'square');
    assert.deepEqual(Array.from(parsed.events), []);
});

test('the live turn no longer applies prose-derived movement or presence', () => {
    const turn = app.slice(app.indexOf('async function executeWorldTurn'), app.indexOf('function processStructuredActions'));
    assert(!turn.includes('applyNarratedLocation(world, sess, cleanText)'));
    assert(!turn.includes('applyNarratedPresence(world, sess, cleanText)'));
    assert(!turn.includes('applyNarratedOutfit(sess, cleanText)'));
    assert(turn.includes("reason: 'uncommitted_player_location_claim'"));
    assert(turn.includes("reason: 'uncommitted_npc_presence_claim'"));
});

let failures = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log(`✓ ${name}`); }
    catch (error) { failures++; console.error(`✗ ${name}\n  ${error.stack || error.message}`); }
}
if (failures) process.exit(1);
console.log(`\n${tests.length} canonical immersion-engine checks passed.`);
