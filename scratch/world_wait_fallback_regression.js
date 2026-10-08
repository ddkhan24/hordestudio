/** Offline regression for an explicit player wait when the DM receipt fails. */
'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source.js');

const plain = value => JSON.parse(JSON.stringify(value));
let proposedReceipts = 0;
let committedReceipts = 0;
let appliedTimeEvents = 0;
let recordedReceipt = null;

// Lift the production parser and both production commit functions. The small
// stubs stand in for the state reducer and a scheduled NPC changing location
// while the clock advances.
const context = {
    buildWorldSceneFrame(world, sess) {
        return {
            player_location_id: sess.playerLocation,
            present_character_ids: sess.clockMinutes ? ['arriving_npc'] : ['departing_npc']
        };
    },
    attemptWorldStateMutation(world, sess, mutate, accepts) {
        proposedReceipts++;
        const result = mutate();
        return {
            result,
            accepted: accepts(result),
            commit() { committedReceipts++; }
        };
    },
    validateWorldTurnReceipt(world, sess, receipt, options) {
        assert.equal(options.playerStartLocationId, 'square');
        assert.equal(options.narrativeText, '');
        assert.equal(options.deferFeedback, true);
        assert.deepEqual(Object.keys(receipt).sort(),
            ['entity_updates', 'events', 'scene', 'state_updates', 'summary']);
        assert.equal(receipt.events.length, 1, 'wait must author exactly one event');
        assert.deepEqual(plain(receipt.events[0]), {
            type: 'time', actor_id: 'player', status: 'completed',
            minutes_elapsed: 45, witnessed_by: ['player'],
            evidence: 'Player explicitly waited 45 minutes.'
        });
        assert.deepEqual(plain(receipt.entity_updates), []);
        assert.deepEqual(plain(receipt.state_updates), {});
        assert.deepEqual(plain(receipt.scene), {
            player_location_id: 'square', player_location_changed: false,
            present_character_ids: ['departing_npc']
        });
        return {
            receipt,
            sceneAssertion: { ...receipt.scene },
            acceptedEvents: receipt.events.slice(),
            rejectedEvents: [], entityPatches: [],
            legacyArgs: { events: receipt.events }
        };
    },
    reconcileNarratedWorldDeadlines() { return []; },
    processStructuredActions(args, world, sess, options) {
        assert.equal(options.deferFeedback, true);
        assert.deepEqual(plain(args.events.map(event => event.type)), ['time']);
        appliedTimeEvents += args.events.length;
        sess.clockMinutes += args.events[0].minutes_elapsed;
        return { checkResults: [] };
    },
    applyWorldEntityPatches(world, sess, patches) {
        assert.deepEqual(plain(patches), []);
    },
    resolveWorldActorId(world, sess, id) { return id; },
    recordWorldTurnCommit(world, sess, validation, actionResult, source) {
        recordedReceipt = validation.receipt;
        const actualCast = context.buildWorldSceneFrame(world, sess).present_character_ids;
        const castMatches = JSON.stringify(validation.sceneAssertion.present_character_ids)
            === JSON.stringify(actualCast);
        return {
            source, cast_checksum_match: castMatches,
            rejected: castMatches ? [] : [{ reason: 'present_cast_checksum_mismatch' }]
        };
    }
};
vm.createContext(context);
vm.runInContext([
    functionSource('parseExplicitWorldWaitMinutes'),
    functionSource('worldNarrativeCompletesExplicitWait'),
    functionSource('stripSpokenDialogue'),
    functionSource('worldLocationTravelBlock'),
    functionSource('worldNarratedUncommittedRouteClosures'),
    functionSource('worldRouteClosureReceiptRepairInstruction'),
    functionSource('worldWaitReceiptRepairInstruction'),
    functionSource('attachObservedWorldDeadlineOutcome'),
    functionSource('commitWorldTurnReceipt'),
    functionSource('commitEngineWorldWait'),
    'this.parseExplicitWorldWaitMinutes = parseExplicitWorldWaitMinutes;',
    'this.worldNarrativeCompletesExplicitWait = worldNarrativeCompletesExplicitWait;',
    'this.worldNarratedUncommittedRouteClosures = worldNarratedUncommittedRouteClosures;',
    'this.worldRouteClosureReceiptRepairInstruction = worldRouteClosureReceiptRepairInstruction;',
    'this.worldWaitReceiptRepairInstruction = worldWaitReceiptRepairInstruction;',
    'this.commitEngineWorldWait = commitEngineWorldWait;'
].join('\n'), context);

for (const [input, minutes] of [
    ['I wait for 30 minutes.', 30],
    ['We wait two hours.', 120],
    ['I sit down. I wait for five minutes.', 5],
    ['I do not leave for the tower. I stay in the square and wait twelve hours, until after dawn. I know this may cost the children.', 720],
    ['I wait for 24 hours.', 1440]
]) assert.equal(context.parseExplicitWorldWaitMinutes(input), minutes, input);
for (const input of [
    'Wait for 30 minutes.',
    'Can I wait for 30 minutes?',
    'I wait for 30 minutes?',
    'I want to wait for 30 minutes.',
    'I might wait for 30 minutes.',
    "I won't wait for 30 minutes.",
    'I say I wait for 30 minutes.',
    '"I wait for 30 minutes."',
    'I wait for 0 minutes.',
    'I wait for 25 hours.',
    'I wait for 5 minutes. I wait for 10 minutes.'
]) assert.equal(context.parseExplicitWorldWaitMinutes(input), null, input);
assert.equal(context.worldNarrativeCompletesExplicitWait('You spend the night in the square. At first light the tide arrives.'), true);
assert.equal(context.worldNarrativeCompletesExplicitWait('Iven interrupts you before you can settle in.'), false);
assert.match(context.worldWaitReceiptRepairInstruction('I wait twelve hours.',
    'You spend the night in the square.'), /minutes_elapsed:720/);
assert.equal(context.worldWaitReceiptRepairInstruction('I wait twelve hours.',
    'Iven interrupts you before you can settle in.'), '');
assert.match(context.worldWaitReceiptRepairInstruction('I wait twelve hours.',
    'You spend the night. The Marsh Causeway is impassable.'), /ledger sentence or summary alone does not close the route/);

const routeWorld = { locations: [
    { id: 'square', name: 'Village Square' },
    { id: 'causeway', name: 'Marsh Causeway' }
] };
const routeSession = { turnCount: 3, locationStates: {
    causeway: { conditions: [{ label: 'flooded' }] }
} };
const closedProse = 'A surge sweeps across the Marsh Causeway, obliterating the road. The path to the tower is gone.';
assert.deepEqual(plain(context.worldNarratedUncommittedRouteClosures(routeWorld, routeSession, closedProse)),
    [{ id: 'causeway', name: 'Marsh Causeway' }],
    'A narrated road closure is not satisfied by flooded scenery alone.');
routeSession.locationStates.causeway.conditions.push({ label: 'impassable' });
assert.deepEqual(plain(context.worldNarratedUncommittedRouteClosures(routeWorld, routeSession, closedProse)), [],
    'The same claim is valid when the persistent route condition exists.');
routeSession.locationStates.causeway.conditions = [{ label: 'flooded', blocksTravel: true }];
assert.deepEqual(plain(context.worldNarratedUncommittedRouteClosures(routeWorld, routeSession, closedProse)), [],
    'An explicit route-blocking condition also satisfies the narration.');
routeSession.locationStates.causeway.conditions = [];
for (const speculative of [
    'Captain Iven: “The Marsh Causeway is impassable.”',
    'Scout: The Marsh Causeway road is severed.',
    'A scout reports the Marsh Causeway road just stops in the water.',
    'Captain Iven says the Marsh Causeway is gone.',
    'The Marsh Causeway might be impassable if the tide rises.',
    'The Marsh Causeway is impassable if the tide rises.',
    'Is the Marsh Causeway impassable?',
    'The Marsh Causeway seemed impassable from a distance.',
    'The Marsh Causeway was impassable, but the road cleared and is open again.',
    'The Marsh Causeway is not blocked.',
    'The Marsh Causeway is flooded, but the road remains usable.'
]) assert.deepEqual(plain(context.worldNarratedUncommittedRouteClosures(routeWorld, routeSession, speculative)), [],
    `A claim short of a decisive route closure must not force a persistent blockade: ${speculative}`);
for (const assertion of [
    'The Marsh Causeway road is severed.',
    'The Marsh Causeway road just stops in the water.',
    'The road across the Marsh Causeway is gone.',
    'Captain Iven: “The road is gone.” The Marsh Causeway road is visibly severed.'
]) assert.deepEqual(plain(context.worldNarratedUncommittedRouteClosures(routeWorld, routeSession, assertion)),
    [{ id: 'causeway', name: 'Marsh Causeway' }], assertion);
assert.match(context.worldRouteClosureReceiptRepairInstruction(routeWorld, routeSession,
    'The Marsh Causeway road is severed.'), /add_conditions:\["impassable"\]/);
assert.equal(context.worldRouteClosureReceiptRepairInstruction(routeWorld, routeSession,
    'Scout: “The Marsh Causeway road is severed.”'), '',
    'a witness statement must never be upgraded into a physical closure');

const world = { hudConfig: { timeStep: 5 } };
const session = { playerLocation: 'square', clockMinutes: 0 };
assert.equal(context.commitEngineWorldWait(world, session, 0), null);
assert.equal(proposedReceipts, 0);
const result = context.commitEngineWorldWait(world, session, 45);
assert(result, 'the explicit wait should commit');
assert.equal(proposedReceipts, 1);
assert.equal(committedReceipts, 1);
assert.equal(appliedTimeEvents, 1);
assert.equal(session.clockMinutes, 45);
assert.equal(result.audit.source, 'engine_wait_fallback');
assert.equal(result.audit.cast_checksum_match, true);
assert.deepEqual(plain(result.validation.sceneAssertion.present_character_ids), ['arriving_npc']);
assert.deepEqual(plain(recordedReceipt.scene.present_character_ids), ['arriving_npc'],
    'the saved receipt must record the cast after clock catch-up');

const turn = functionSource('executeWorldTurn');
const freezeStart = turn.indexOf('const freezeUnverifiedWorldTurn = detail => {');
const freezeEnd = turn.indexOf('if (!successfulStateCall', freezeStart);
assert(freezeStart >= 0 && freezeEnd > freezeStart, 'missing unverified-receipt fallback');
const freeze = turn.slice(freezeStart, freezeEnd);
assert.match(freeze, /!isReroll && !committedMovement && !committedOutfit/);
assert.match(freeze, /parseExplicitWorldWaitMinutes\(submittedInput, currentTotalMinutes\)/);
assert.match(freeze, /commitEngineWorldWait\(world, sess, elapsed\)/);
assert.match(freeze, /if \(waited\) \{[\s\S]*?fallbackWaitApplied = elapsed/);
assert.match(freeze, /pendingWorldActionFeedback = waited\.actionResult/);
assert.match(turn, /reason: 'explicit_wait_time_uncommitted'/);
assert.match(turn, /routeAssertions\.forEach\(assertion => worldNarratedUncommittedRouteClosures\(world, sess, assertion\)/);
assert.match(turn, /reason: 'narrated_route_closure_uncommitted'/);
assert.match(turn, /receiptContext\.narrativeText = stripWorldLedgerDirective\(scrubNarrativeArtifacts\(fullText\)\);\s*\/\/ When the first response was completely empty/,
    'Narrative rescue must update receipt validation with its final prose.');
assert.match(freeze, /else \{[\s\S]*?source: 'frozen_no_receipt'|else \{[\s\S]*?'frozen_no_receipt'/);
assert.match(turn, /if \(frozenReceiptApplied\) \{\s*fullText = fallbackWaitApplied\s*\? worldUnverifiedWaitNotice\(world, sess, fallbackWaitApplied\)/);
assert.match(turn, /const completedExplicitWait = explicitWait && !frozenReceiptApplied/);
assert.match(turn, /Number\(sess\.bonusTimeMinutes\)[\s\S]*?- \(Number\(turnSnapshot\?\.session\?\.bonusTimeMinutes\) \|\| 0\) >= explicitWait/);
assert.match(turn, /if \(fallbackWaitApplied \|\| completedExplicitWait\) \{[\s\S]*?sess\.bonusTimeMinutes = Math\.max\(0, \(sess\.bonusTimeMinutes \|\| 0\) - step\)/);

const waitAt = turn.indexOf('let waitPreserved = false;');
const outfitAt = turn.indexOf('if (sess && committedOutfit', waitAt);
assert(waitAt >= 0 && outfitAt > waitAt, 'missing failed-generation wait preservation');
const failedTurnWait = turn.slice(waitAt, outfitAt);
assert(turn.lastIndexOf('restoreWorldTurnState(world, sess, rollbackSnapshot)', waitAt) >= 0,
    'failed generation must roll back before reapplying the player wait');
assert.match(failedTurnWait, /!isReroll && !committedMovement && !committedOutfit/);
assert.match(failedTurnWait, /parseExplicitWorldWaitMinutes\(submittedInput, currentTotalMinutes\)/);
assert.match(failedTurnWait, /commitEngineWorldWait\(world, sess, elapsed\)/);
assert.match(failedTurnWait, /if \(waitCommit\) \{[\s\S]*?waitPreserved = true/);
assert.match(failedTurnWait, /worldUnverifiedWaitNotice\(world, sess, elapsed, true\)/);
assert.match(failedTurnWait, /sess\.turnCount = [^;]+ \+ 1/);
assert.match(failedTurnWait, /sess\.bonusTimeMinutes = Math\.max\(0, \(sess\.bonusTimeMinutes \|\| 0\) - step\)/);
assert.match(failedTurnWait, /addWorldMessage\('user', submittedInput,[\s\S]*?addWorldMessage\('system', notice,/);
assert.match(turn, /!movementPreserved && !waitPreserved && !committedOutfit/);

console.log('✓ explicit wait fallback saves one time event and the settled cast across receipt and generation failures');
