/**
 * Horde Studio regression audit.
 * Run with: node scratch/engine_audit.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildContext, functionSource: sharedFunctionSource } = require('./app_source.js');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const presetsSource = fs.readFileSync(path.join(root, 'presets.js'), 'utf8');

/**
 * Lexer-aware span matcher. The previous version counted braces while treating
 * every apostrophe as a string opener, so an ordinary comment ("mirroring an
 * NPC's goalPool") silently truncated the extracted function and made unrelated
 * assertions fail. It now skips comments, strings, template literals and regex
 * literals, and steps over a default parameter's braces (`options = {}`).
 */
function matchSpan(startIndex, openChar, closeChar, label, searchFrom = startIndex) {
    const open = app.indexOf(openChar, searchFrom);
    assert(open >= 0, `No opening ${openChar} for ${label}`);
    let depth = 0;
    let lastSignificant = '';
    for (let i = open; i < app.length; i++) {
        const char = app[i];
        const next = app[i + 1];
        if (char === '/' && next === '/') { i = app.indexOf('\n', i); if (i < 0) break; continue; }
        if (char === '/' && next === '*') { i = app.indexOf('*/', i + 2) + 1; continue; }
        if (char === '"' || char === "'" || char === '`') {
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === char) break;
            }
            lastSignificant = char;
            continue;
        }
        if (char === '/' && /[(,=:[!&|?{};\n+\-*%^~<>]/.test(lastSignificant || '\n')) {
            let inClass = false;
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === '[') inClass = true;
                else if (app[i] === ']') inClass = false;
                else if (app[i] === '/' && !inClass) break;
            }
            lastSignificant = '/';
            continue;
        }
        if (!/\s/.test(char)) lastSignificant = char;
        if (char === openChar) depth++;
        else if (char === closeChar && --depth === 0) return app.slice(startIndex, i + 1);
    }
    throw new Error(`Unclosed ${label}`);
}

function functionSource(name) {
    return sharedFunctionSource(name);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('document closes after every modal and script', () => {
    assert(html.lastIndexOf('</body>') > html.lastIndexOf('world-clock-modal-overlay'));
    assert(html.lastIndexOf('</html>') > html.lastIndexOf('</body>'));
    assert(html.lastIndexOf('app.js') < html.lastIndexOf('</body>'));
});

test('static IDs are unique', () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepStrictEqual([...new Set(duplicates)], []);
});

test('external executable scripts were removed', () => {
    assert(!/<script[^>]+src=["']https?:/i.test(html));
    assert(!/mermaid\.initialize|securityLevel\s*:\s*['"]loose/.test(app));
});

test('CSP blocks inline scripts and plugins', () => {
    const csp = html.match(/Content-Security-Policy" content="([^"]+)/)?.[1] || '';
    assert(csp.includes("script-src 'self'"));
    assert(csp.includes("object-src 'none'"));
    assert(!csp.includes("script-src 'self' 'unsafe-inline'"));
    assert(!/\sonclick=|\sonchange=|\soninput=/i.test(html));
    assert(!/\sonclick=|\sonchange=|\soninput=/i.test(app));
});

test('starter world points to an installed preset', () => {
    const context = {};
    vm.runInNewContext(`${presetsSource}\nthis.presets = DEFAULT_SYSTEM_PRESETS;`, context);
    const starterId = app.match(/const STARTER_WORLDS[\s\S]*?activePresetId:\s*'([^']+)'/)?.[1];
    assert(starterId);
    assert(context.presets.some(preset => preset.id === starterId));
});

test('preset editor does not inject duplicate world-clock IDs', () => {
    const editorStart = app.indexOf('function renderPresetEditor');
    const editorEnd = app.indexOf('function mapTavernDataToNexus', editorStart);
    const editor = app.slice(editorStart, editorEnd);
    assert(!editor.includes('hud-section-clock'));
    assert(!editor.includes('world-clock-display'));
});

test('HTML escaping neutralizes stored markup', () => {
    const context = {};
    const start = app.indexOf('function escapeHTML');
    const end = app.indexOf('function cssUrl', start);
    vm.runInNewContext(`${app.slice(start, end)}\nthis.escapeHTML = escapeHTML;`, context);
    const escaped = context.escapeHTML(`<img src=x onerror="globalThis.pwned=1">`);
    assert(!escaped.includes('<img'));
    assert(escaped.includes('&lt;img'));
});

test('CSS-facing values reject declaration injection', () => {
    const context = {};
    const start = app.indexOf('function cssUrl');
    const end = app.indexOf('let accessibilityObserver', start);
    vm.runInNewContext(`${app.slice(start, end)}\nthis.cssUrl = cssUrl; this.cssColor = cssColor;`, context);
    assert.strictEqual(context.cssColor('red; position:fixed'), 'var(--accent)');
    assert.strictEqual(context.cssColor('#E63946'), '#E63946');
    assert(!context.cssUrl(`x');background:url(javascript:alert(1))`).includes("'"));
});

test('nested import schemas reject malformed records', () => {
    const context = buildContext(vm, ['validateCharacterData', 'validateRoomData', 'validateWorldData']);
    assert.throws(() => context.validateCharacterData({ name: 'Bad', tags: [{}] }));
    assert.throws(() => context.validateRoomData({ name: 'Bad', characterIds: ['../../escape'] }));
    assert.throws(() => context.validateWorldData({ name: 'Bad', locations: [{ name: 'Here', exits: [null] }] }));
});

test('user travel is limited to a direct exit', () => {
    const context = {};
    vm.runInNewContext(`${functionSource('getExitTargetName')}\n${functionSource('canTravelDirectly')}\nthis.canTravelDirectly = canTravelDirectly;`, context);
    const hall = { id: 'hall', name: 'Great Hall', exits: ['to Garden'] };
    const garden = { id: 'garden', name: 'Garden', exits: [] };
    const tower = { id: 'tower', name: 'Tower', exits: [] };
    const world = { locations: [hall, garden, tower] };
    assert.strictEqual(context.canTravelDirectly(world, 'hall', garden), true);
    assert.strictEqual(context.canTravelDirectly(world, 'hall', tower), false);
});

test('movement uses one authoritative routed graph across typed, clicked, and tool paths', () => {
    const movementSource = app.slice(app.indexOf('function extractUserMovementTarget'), app.indexOf('async function executeWorldTurn'));
    const executeSource = app.slice(app.indexOf('async function executeWorldTurn'), app.indexOf('function processStructuredActions'));
    const renderSource = app.slice(app.indexOf('function renderWorldPlayState'), app.indexOf('function appendWorldMessageUI'));
    const actionSource = app.slice(app.indexOf('function processStructuredActions'), app.indexOf('// (removed: processAIActions'));
    assert(app.includes('function findWorldTravelPath'));
    assert(app.includes('function resolveWorldMovementTarget'));
    assert(app.includes('function movePlayerAlongWorldPath'));
    assert(movementSource.includes('movePlayerAlongWorldPath'));
    assert(renderSource.includes('resolveWorldExitTarget'));
    assert(renderSource.includes('travelThroughWorldExit'));
    assert(functionSource('travelThroughWorldExit').includes('movePlayerAlongWorldPath'));
    assert(actionSource.includes('movePlayerAlongWorldPath'));
    assert(executeSource.includes('movementPreserved'));
    assert(executeSource.includes('Movement completed to'));
    assert(executeSource.includes('isReroll ? failureRestoreSnapshot : turnSnapshot'));
    assert(app.includes('Known destinations require a valid route'));
    assert(app.includes('function validateWorldTurnReceipt'));
});

test('world ledger has deterministic fallbacks and snapshot-safe manual saves', () => {
    const actionSource = app.slice(app.indexOf('function processStructuredActions'), app.indexOf('// (removed: processAIActions'));
    assert(app.includes('function buildStructuredLedgerFallback'));
    assert(app.includes('function buildLocalNarrativeLedgerFallback'));
    assert(app.includes('function replaceWorldLedger'));
    assert(actionSource.includes('buildStructuredLedgerFallback'));
    assert(app.includes('Chronicle recovered locally'));
    assert(html.includes('id="world-ledger-status"'));
    assert(/await saveWorldsState\(\);\s+renderWorldPlayState\(\);/.test(app));
    assert(functionSource('stripChatLedgerEntry').includes('worldLedgerEntryKey'));
});

test('living world bootstraps visible local state and reports schedules and agendas', () => {
    const normalizeSource = functionSource('normalizeLivingWorldState');
    const renderSource = app.slice(app.indexOf('function renderWorldPlayState'), app.indexOf('function appendWorldMessageUI'));
    const scheduleSource = app.slice(app.indexOf('function syncNPCSchedules'), app.indexOf('function validateWorldReferences'));
    const entityEditorSource = app.slice(app.indexOf('function renderWorldEntities'), app.indexOf('function addWorldLore'));
    assert(normalizeSource.includes("the player's current place"));
    assert(normalizeSource.includes('npc.goal || npc.agenda'));
    assert(renderSource.includes('character routine'));
    assert(renderSource.includes('autonomous agenda'));
    assert(renderSource.includes('visibleCards.length'));
    assert(scheduleSource.includes('activeSchedules'));
    assert(scheduleSource.includes('return { moves: moveCount, active: activeCount }'));
    assert(entityEditorSource.includes('Starting Living World Agenda'));
    assert(entityEditorSource.includes('ent-goal-autonomy'));
});

test('player rules enforce bounded stats, defeat, commerce, and checks', () => {
    const actionSource = app.slice(app.indexOf('function processStructuredActions'), app.indexOf('// (removed: processAIActions'));
    const executeSource = app.slice(app.indexOf('async function executeWorldTurn'), app.indexOf('function processStructuredActions'));
    assert(app.includes('function applyPlayerStatChanges'));
    assert(app.includes('function executeCommerceTransactions'));
    assert(app.includes('function performAuthoritativeChecks'));
    assert(actionSource.includes('executeCommerceTransactions(world, sess, args.transactions)'));
    assert(actionSource.includes('performAuthoritativeChecks(world, sess, requestedChecks)'));
    assert(actionSource.includes('unconditional_update_beside_check'));
    assert(actionSource.includes('applyPlayerStatChanges(world, sess, args.stat_changes'));
    assert(executeSource.includes('12d. Commerce:'));
    assert(executeSource.includes('12e. Checks:'));
    assert(executeSource.includes('Game Over — reroll the fatal turn'));
    assert(html.includes('id="w-rules-vital-stat"'));
    assert(html.includes('id="w-rules-zero-hp-mode"'));
    assert(html.includes('id="w-rules-currency-stat"'));
    assert(app.includes("playerState.status = lethal ? 'dead' : 'incapacitated'"));
    assert(app.includes("reason: 'cannot_afford'"));
});

test('world rule profiles make every mechanical subsystem optional', () => {
    const executeSource = app.slice(app.indexOf('async function executeWorldTurn'), app.indexOf('function processStructuredActions'));
    const actionsSource = app.slice(app.indexOf('function processStructuredActions'), app.indexOf('// (removed: processAIActions'));
    assert(app.includes('const WORLD_RULE_MODULE_KEYS'));
    assert(app.includes('const WORLD_RULE_PROFILES'));
    assert(app.includes('pure_narrative: {'));
    assert(app.includes('slice_of_life: {'));
    assert(app.includes('full_rpg: {'));
    assert(app.includes('function applyWorldRuleProfile'));
    assert(html.includes('id="w-rules-profile"'));
    assert(html.includes('data-rule-module="health"'));
    assert(html.includes('data-rule-module="livingWorld"'));
    assert(executeSource.includes("removeToolFields(['transactions'])"));
    assert(executeSource.includes("removeToolFields(['quests_update'])"));
    assert(executeSource.includes('Off-screen simulation is DISABLED'));
    assert(actionsSource.includes("reason: 'module_disabled'"));
    assert(actionsSource.includes('moduleRejections'));
});

test('world clock cannot produce negative days or hours', () => {
    const context = {};
    vm.runInNewContext(`${functionSource('getWorldTimeData')}\nthis.getWorldTimeData = getWorldTimeData;`, context);
    const result = context.getWorldTimeData({ hudConfig: { startTimeHours: 1, timeStep: 5 } }, { turnCount: 1, bonusTimeMinutes: -9999 });
    assert.strictEqual(result.days, 1);
    assert.strictEqual(result.hours24, 0);
    assert.strictEqual(result.mins, 0);
});

test('turn snapshots restore timeline state without replacing shared authored geography', () => {
    const context = buildContext(vm, ['captureWorldTurnState', 'restoreWorldTurnState'], {
        state: { worldInstances: {} }, bumpMemoryEpoch() {}
    });
    context.capture = context.captureWorldTurnState;
    context.restore = context.restoreWorldTurnState;
    const world = { locations: [{ id: 'a', name: 'A' }], entities: [{ id: 'n', name: 'N' }, { id: 'owned', name: 'Owned', sessionOrigin: 's' }] };
    const session = {
        id: 's',
        name: 'T',
        history: [],
        playerLocation: 'a',
        inventory: [],
        playerStats: { hp: 10 },
        quests: [{ id: 'quest_a', title: 'A', status: 'completed', rewardsGranted: true, rewardReceipt: 'key' }],
        turnCount: 1
    };
    const snapshot = context.capture(world, session);
    session.playerLocation = 'b';
    session.inventory.push('key');
    session.playerStats.hp = 1;
    session.quests[0].rewardReceipt = 'duplicated';
    session.quests.push({ id: 'quest_b', title: 'B', status: 'active' });
    session.turnCount = 2;
    world.locations.push({ id: 'b', name: 'B' });
    world.entities.find(entity => entity.id === 'owned').name = 'Changed';
    world.entities.push({ id: 'x', name: 'X', sessionOrigin: 'other' });
    assert.strictEqual(context.restore(world, session, snapshot), true);
    assert.strictEqual(session.playerLocation, 'a');
    assert.strictEqual(JSON.stringify(session.inventory), '[]');
    assert.strictEqual(session.playerStats.hp, 10);
    assert.strictEqual(session.quests.length, 1);
    assert.strictEqual(session.quests[0].rewardReceipt, 'key');
    assert.strictEqual(session.turnCount, 1);
    assert.strictEqual(world.locations.length, 2, 'shared geography added later must survive a reroll');
    assert.strictEqual(world.entities.find(entity => entity.id === 'owned').name, 'Owned');
    assert(world.entities.some(entity => entity.id === 'x'), 'another timeline\'s NPC must survive');
});

test('streamed tool calls are accumulated and answered in parallel-safe order', () => {
    const start = app.indexOf('async function executeWorldTurn');
    const end = app.indexOf('function processStructuredActions', start);
    const source = app.slice(start, end);
    assert(source.includes('const streamedToolCalls = new Map()'));
    assert(source.includes('incomingCalls.forEach(tc => accumulateWorldToolCall'));
    assert(source.includes('if (buffer.trim()) processWorldStreamLine(buffer)'));
    assert(app.includes('function parseWorldToolArguments'));
    assert(source.includes('for (const call of toolCalls)'));
    assert(source.includes('...toolResponses'));
    assert(source.includes('signal: controller.signal'));
});

test('quest engine is authoritative across prompts, tools, fallbacks, resets, and rewards', () => {
    const executeStart = app.indexOf('async function executeWorldTurn');
    const executeEnd = app.indexOf('function processStructuredActions', executeStart);
    const executeSource = app.slice(executeStart, executeEnd);
    const actionsStart = app.indexOf('function processStructuredActions');
    const actionsEnd = app.indexOf('// (removed: processAIActions', actionsStart);
    const actionsSource = app.slice(actionsStart, actionsEnd);
    const setupStart = app.indexOf('function setupWorldPlayLogic');
    const setupEnd = app.indexOf('function getCurrentWorldSession', setupStart);
    const setupSource = app.slice(setupStart, setupEnd);
    assert(executeSource.includes('const questPrompt = getQuestPrompt(world, sess)'));
    assert(executeSource.includes('${questPrompt}${npcContext}'));
    assert(executeSource.includes('evaluateQuestProgress(world, sess)'));
    assert(/tool_choice:\s*receiptFirstToolCall/.test(executeSource));
    assert(executeSource.includes("name: 'commit_world_turn' } } : 'auto'"));
    assert(executeSource.includes('name: "commit_world_turn"'));
    assert(executeSource.includes('objectives: {'));
    assert(executeSource.includes('faction_reputation: {'));
    assert(executeSource.includes('<world_turn_receipt>'));
    assert(executeSource.includes('quests_update'));
    assert(actionsSource.includes('applyQuestUpdates(world, sess, args.quests_update)'));
    assert(!actionsSource.includes("'q_' + Date.now()"));
    assert(app.includes('if (!quest || quest.status !== \'completed\' || quest.rewardsGranted) return false'));
    assert(setupSource.includes('quests: []'));
    assert(setupSource.includes('scheduledEvents: safeJsonClone'));
    assert(setupSource.includes('inventory: []'));
    assert(html.includes('id="world-quest-modal-overlay"'));
    assert(html.includes('id="m-quest-reward-items"'));
    assert(html.includes('id="m-quest-reward-stats"'));
    assert(css.includes('.quest-objective-row'));
    assert(app.includes("querySelectorAll('.m-quest-objective-status')"));
    assert(css.includes('#confirm-modal-overlay {\n    z-index: 1300;'));
    const repairSource = functionSource('repairLoadedState');
    assert(repairSource.includes('showQuests: true'));
    assert(repairSource.includes('...(isPlainObject(world.hudConfig) ? world.hudConfig : {})'));
});

test('backup validation bounds nested quest records', () => {
    const source = functionSource('validateBackupData');
    assert(source.includes('session.quests'));
    assert(source.includes('max: 500'));
    assert(source.includes('quest.objectives'));
    assert(source.includes('max: 100'));
    assert(source.includes('quest.rewards'));
});

test('semantic world map is native SVG with text-only labels', () => {
    const start = app.indexOf('function renderSemanticWorldMap');
    const end = app.indexOf('function renderWorldArchitectMap', start);
    const source = app.slice(start, end);
    assert(source.includes("document.createElementNS(ns, 'svg')"));
    assert(source.includes('span.textContent'));
    assert(!source.includes('innerHTML'));
    assert(functionSource('renderWorldMap').includes('renderSemanticWorldMap'));
    assert(functionSource('renderWorldArchitectMap').includes('renderSemanticWorldMap'));
});

test('world map defaults to cartographic routing with graph fallback', () => {
    const start = app.indexOf('function renderSemanticWorldMap');
    const end = app.indexOf('function renderWorldArchitectMap', start);
    const source = app.slice(start, end);
    assert(app.includes('function routeSemanticMapEdges'));
    assert(source.includes("container.dataset.mapMode || 'map'"));
    assert(source.includes("['map', 'Map']"));
    assert(source.includes("['graph', 'Graph']"));
    assert(source.includes('routeSemanticMapEdges(graph, layout)'));
    assert(css.includes('.cartographic-map-edge-casing'));
    assert(css.includes('.semantic-map-compass'));
    assert(css.includes('.semantic-map-mode-btn[aria-pressed="true"]'));
});

test('world map models hierarchy and simplifies dense connection meshes', () => {
    const start = app.indexOf('function buildSemanticWorldGraph');
    const end = app.indexOf('function layoutSemanticWorldGraph', start);
    const source = app.slice(start, end);
    assert(source.includes('parentLocationId'));
    assert(source.includes('containment already communicates this'));
    assert(source.includes('Dense room meshes are reduced'));
    assert(css.includes('.semantic-cluster-box.type-building'));
    assert(css.includes('.location-map-metadata'));
});

test('API keys are not exported and device persistence remains opt-in', () => {
    const exportStart = app.indexOf('function exportFullBackup');
    const exportEnd = app.indexOf('function importFullBackup', exportStart);
    assert(!/apiKey\s*:\s*state\.apiKey/.test(app.slice(exportStart, exportEnd)));
    assert(functionSource('exportFullBackup').includes('...inMemoryBackupPayload()'));
    const context = buildContext(vm, ['redactGlobalSettingsCredentials']);
    const settings = { localApiKey: 'LOCAL', embeddingApiKey: 'EMBED', localTtsApiKey: 'TTS',
        localImageApiKey: 'IMAGE', labs: { apiKey: 'LABS', model: 'local-model' },
        vh2SelfHosts: { private: { accessToken: 'PRIVATE', url: 'https://private.invalid' } } };
    const exported = context.redactGlobalSettingsCredentials(settings);
    assert(!JSON.stringify(exported).match(/LOCAL|EMBED|TTS|IMAGE|LABS|PRIVATE/));
    assert.equal(exported.labs.model, 'local-model');
    assert.equal(settings.localApiKey, 'LOCAL', 'redaction must not remove credentials from the running app');
    const saveStart = app.indexOf('async function persistStateSnapshot');
    const saveEnd = app.indexOf('// Global Error Handler', saveStart);
    assert(/apiKey:\s*state\.globalSettings\.rememberApiKey\s*\?[\s\S]*:\s*''/.test(app.slice(saveStart, saveEnd)));
});

test('responsive and accessibility safeguards exist', () => {
    assert(css.includes('@media (max-width: 600px)'));
    assert(css.includes('.world-play-container { flex-direction: column; }'));
    assert(app.includes("overlay.setAttribute('aria-modal', 'true')"));
    assert(app.includes("if (event.key === 'Escape')"));
    assert(css.includes('.world-narrative-col {\n    flex: 1;\n    min-width: 0;'));
    assert(/\.world-status-col\s*\{[^}]*min-width:\s*0;[^}]*box-sizing:\s*border-box;/.test(css));
    assert(css.includes('#world-play-view .chat-toolbar'));
});

test('New Session Setup has explicit commit and reversible dismissal paths', () => {
    const start = app.indexOf('function openSessionZero');
    const end = app.indexOf('function openNpcDossier', start);
    const source = app.slice(start, end);
    assert(source.includes('closeButton.onclick = dismiss'));
    assert(source.includes("saveButton.onclick = () => saveAndFinish(true)"));
    assert(source.includes("switchView('worlds')"));
    assert(source.includes("saveStatus.textContent = 'Saved'"));
    assert(html.includes('class="modal modal-md session-zero-modal"'));
    assert(css.includes('.modal-sm .modal-ft-row { padding: 0; }'));
    assert(!/(?:^|\n)\.modal-ft-row\s*\{[^}]*padding:\s*0/.test(css));
});

test('world API errors do not consume the same response body twice', () => {
    const turn = functionSource('executeWorldTurn');
    const start = turn.indexOf("let activeStream = await fetchWorldTurnStream");
    const source = turn.slice(start, turn.indexOf('if (!response.body)', start));
    assert.match(source, /let errBody = await HordeWorldModelClient\.readText\(response, controller\.signal\)/);
    assert.match(source, /response = activeStream\.response;\s+if \(!response\.ok\)\s*\{\s*errBody = await HordeWorldModelClient\.readText/);
    assert.doesNotMatch(source, /const finalErr = await/);
});

let failures = 0;
for (const { name, fn } of tests) {
    try {
        fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        failures++;
        console.error(`✗ ${name}\n  ${error.message}`);
    }
}

if (failures) {
    console.error(`\n${failures} regression check(s) failed.`);
    process.exit(1);
}
console.log(`\n${tests.length} regression checks passed.`);
