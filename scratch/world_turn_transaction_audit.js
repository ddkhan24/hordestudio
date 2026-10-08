/**
 * World turn transaction/session integrity regression audit.
 * Run with: node scratch/world_turn_transaction_audit.js
 */
const assert = require('node:assert/strict');
const { app, functionSource } = require('./app_source.js');

const execute = functionSource('executeWorldTurn');
const addMessage = functionSource('addWorldMessage');
const commit = functionSource('commitWorldTurnReceipt');
const render = functionSource('renderWorldPlayState');
const travel = functionSource('travelThroughWorldExit');

assert(execute && addMessage && commit && render && travel, 'transaction functions must remain extractable');

assert(/function addWorldMessage\(role, text, metadata = \{\}, targetSession = null, targetWorld = null\)/.test(addMessage),
    'world messages must accept an explicit initiating timeline and world');
assert(/const sess = targetSession \|\| getCurrentWorldSession\(\)/.test(addMessage),
    'explicit message targets must win over the currently selected timeline');
assert(/const world = targetWorld \|\| state\.worlds\.find/.test(addMessage),
    'message observations must use the initiating world');

const boundMessageCalls = execute.match(/addWorldMessage\([\s\S]*?\}, sess, world\);/g) || [];
assert(boundMessageCalls.length >= 9,
    'every normal, reroll, fallback, and rollback message path must bind to the initiating timeline');
assert(/processStructuredActions\(validation\.legacyArgs, world, sess, \{/.test(commit),
    'receipt reducers must never look up the active timeline after generation');
assert(/pendingSecretReveals\.push\(args\.label\)/.test(execute)
    && /if \(!frozenReceiptApplied && \(successfulStateCall \|\| inlineStateApplied \|\| repairedReceiptApplied\)\) \{[\s\S]*?processStructuredActions\(\{ label \}, world, sess\)/.test(execute),
    'secret discovery must be deferred until a verified receipt and bound to the initiating timeline');

assert(/let stateCallSeen = false/.test(execute),
    'turn execution must track whether its single canonical receipt was already consumed');
assert(/if \(stateCallSeen\) throw new Error\('Duplicate commit_world_turn ignored/.test(execute),
    'duplicate canonical receipts must be rejected before mutation');
assert(/attemptWorldStateMutation\(world, sess, \(\) => \{[\s\S]*?commitWorldTurnReceipt/.test(execute)
    && /\}, candidate => candidate\.accepted\)/.test(execute),
    'a rejected receipt must use the shared rollback boundary');
assert(/const auditOk = \(committed\.audit\?\.rejected \|\| \[\]\)\.length === 0/.test(execute),
    'receipt acceptance must include semantic validation and cast assertions');
assert(/successfulStateCall = candidate\.accepted/.test(execute)
    && !/successfulStateCall = true/.test(execute),
    'a rejected receipt must not suppress the repair/freeze path');

const sessionHandler = app.slice(app.indexOf("document.getElementById('world-session-select').onchange"),
    app.indexOf("document.getElementById('world-session-zero-btn').onclick"));
assert(sessionHandler.indexOf('if (worldTurnInProgress || worldMutationInProgress)') >= 0
    && sessionHandler.indexOf('if (worldTurnInProgress || worldMutationInProgress)') < sessionHandler.indexOf('.activeSessionId = e.target.value'),
    'timeline switching must be blocked before changing activeSessionId');

const exitHandler = render.slice(render.indexOf('// 3. Location & Exits'), render.indexOf('// 4. Inventory & Outfit'));
assert(/const movement = await travelThroughWorldExit\(sourceWorld, sourceSess, exit\)/.test(exitHandler),
    'exit clicks must enter the shared command boundary');
assert(travel.indexOf('if (worldTurnInProgress || worldMutationInProgress)') < travel.indexOf('movePlayerAlongWorldPath'),
    'exit travel must be rejected before any movement during an active command');
assert(/await saveWorldsState\(\{ worldId: world\.id \}\);\s*attempt\.commit\(\)/.test(travel)
    && /attempt\.rollback\(\)/.test(travel),
    'exit travel must commit only after save and roll back on save failure');

console.log('✓ World turn receipt and cross-timeline transaction guards are present');
