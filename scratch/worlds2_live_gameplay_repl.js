/** Manual, paid Worlds playtest in a disposable browser profile.
 *  The API key is read once from stdin and never stored in the page or report.
 *  Commands after READY are JSON lines: {"op":"act","text":"..."},
 *  {"op":"status"}, {"op":"reload"}, {"op":"screenshot"}, {"op":"quit"}.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const childProcess = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const { markResponseHeaders, markResponseComplete, summarizeTurnTiming } = require('./worlds_live_timing');

const root = path.resolve(__dirname, '..');
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.split('=').slice(1).join('') || '';
const worldPath = option('world-path') || path.join(root, 'Policy Panic at Bramble and Pike.horde_world');
const worldName = option('world-name') || 'Policy Panic at Bramble & Pike';
const originName = option('origin-name') || 'The New Hire';
const freshBudget = process.argv.includes('--fresh-budget');
const model = 'google/gemma-4-31b-it';
const maxOutputTokens = Math.max(256, Math.min(8000, Number(process.argv.find(x => x.startsWith('--tokens='))?.split('=')[1] || 2048)));
const contextTokens = Math.max(2048, Math.min(262144, Number(process.argv.find(x => x.startsWith('--context='))?.split('=')[1] || 8192)));
const origin = 'https://worlds2-playtest.test';
const price = { input: 0.09, output: 0.34 }; // USD per million, recheck before use.
const priorReportPaths = [
    '/tmp/worlds2-live-gameplay-20261005.json',
    '/tmp/worlds2-live-gameplay-4096-8192-20261005.json',
    '/tmp/worlds2-live-gameplay-2048-32768-20261005.json',
    '/tmp/worlds2-live-gameplay-2048-32768-fixed-stream-1-20261005.json',
    '/tmp/worlds2-live-gameplay-2048-32768-fixed-stream-2-20261005.json',
    '/tmp/worlds2-live-gameplay-2048-32768-fixed-stream-3-20261005.json',
    '/tmp/worlds2-live-gameplay-2048-32768-fixed-stream-4-20261005.json',
    '/tmp/worlds2-live-gameplay-4096-32768-fixed-stream-6-20261005.json',
    '/tmp/worlds2-live-gameplay-4096-32768-fixed-stream-7-20261005.json'
];
// The first 4096-token replay timed out during setup before it could write a
// report; reserve its entire estimated request cost in subsequent runs.
const unrecordedBootReservation = 0.023;
const freshBudgetPath = option('fresh-budget-file') || '/tmp/worlds2-rpg-live-budget-20261005.json';
const freshBudgetCeiling = Number(option('fresh-budget-ceiling') || 1.80);
if (freshBudget && (!Number.isFinite(freshBudgetCeiling) || freshBudgetCeiling <= 0 || freshBudgetCeiling > 2)) {
    throw new Error('Invalid fresh playtest budget ceiling.');
}
const priorConservativeSpend = freshBudget
    ? (fs.existsSync(freshBudgetPath) ? Number(JSON.parse(fs.readFileSync(freshBudgetPath, 'utf8')).reserved) || 0 : 0)
    : priorReportPaths.reduce((total, file) => {
    if (!fs.existsSync(file)) return total;
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isFinite(previous.conservativeSpend)) throw new Error(`Invalid prior playtest budget record: ${file}`);
    return total + previous.conservativeSpend;
}, unrecordedBootReservation);
// Keep each explicitly authorized live pass in its own persisted budget bucket.
const maxConservativeSpend = Math.max(0, (freshBudget ? freshBudgetCeiling : 1.50) - priorConservativeSpend);
const reportTag = (process.argv.find(x => x.startsWith('--tag='))?.split('=')[1] || 'fixed-stream')
    .replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
const reportPath = `/tmp/worlds2-live-gameplay-${maxOutputTokens}-${contextTokens}-${reportTag}-20261005.json`;
const screenshotPath = `/tmp/worlds2-live-gameplay-${maxOutputTokens}-${contextTokens}-${reportTag}-20261005.png`;
const rl = readline.createInterface({ input: process.stdin, terminal: false });
if (process.stdin.isTTY) {
    try { childProcess.execFileSync('stty', ['-echo'], { stdio: 'inherit' }); } catch {}
}

const say = value => process.stdout.write(`PLAYTEST ${JSON.stringify(value)}\n`);
const trim = (value, n = 5000) => String(value ?? '').slice(0, n);
let browser;
let page;
let worldId = '';
let calls = 0;
let conservativeSpend = 0;
const provider = [];
const turns = [];
const pageErrors = [];
const lifeSeedWarnings = [];
let blockedProviderCalls = 0;
let key = '';

function checkoutSource(route) {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return route.fulfill({ status: 404, body: '' });
    }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
}

async function routeRequest(route) {
    const url = new URL(route.request().url());
    if (url.hostname !== 'openrouter.ai' || url.pathname !== '/api/v1/chat/completions') {
        return checkoutSource(route);
    }
    let request;
    const body = route.request().postData() || '';
    try { request = JSON.parse(body); }
    catch { throw new Error('Worlds sent malformed provider JSON.'); }
    const systemText = (request.messages || []).filter(message => message.role === 'system')
        .map(message => String(message.content || '')).join('\n');
    const worldsRequest = systemText.includes('[ENGINE MANDATE: CANONICAL TURN COMMIT]')
        || systemText.includes('world_turn_receipt')
        || systemText.includes('[WORLD TURN RECEIPT REPAIR]')
        || systemText.includes('Generate 4-10 people');
    if (!worldsRequest) {
        blockedProviderCalls++;
        say({ event: 'blocked-unrelated-provider-call' });
        return route.fulfill({ status: 403, contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'This isolated playtest only permits Worlds model requests.' } }) });
    }
    const maxTokens = Number(request.max_tokens || 2048);
    if (request.model !== model) throw new Error(`Unexpected model: ${request.model}`);
    if (++calls > 40 || Buffer.byteLength(body, 'utf8') > 250_000 || maxTokens > 8000) {
        throw new Error('Live playtest request/call/token guard reached.');
    }
    // Bytes overcount ordinary text tokens; the 8x multiplier also reserves
    // the complete requested output. Stop below the user's $2 ceiling.
    const preflight = 8 * ((Buffer.byteLength(body, 'utf8') * price.input + maxTokens * price.output) / 1_000_000);
    if (conservativeSpend + preflight > maxConservativeSpend) {
        throw new Error('Live playtest budget guard reached.');
    }
    conservativeSpend += preflight;
    if (freshBudget) fs.writeFileSync(freshBudgetPath,
        JSON.stringify({ reserved: priorConservativeSpend + conservativeSpend, ceiling: freshBudgetCeiling }));
    const record = { status: 0, ms: null, headersMs: null, bodyCompleteMs: null, startedAt: Date.now(),
        requestBytes: Buffer.byteLength(body, 'utf8'), maxTokens,
        stream: !!request.stream, usage: null,
        requestMessages: (request.messages || []).map(message => ({
            role: message.role,
            chars: typeof message.content === 'string' ? message.content.length : JSON.stringify(message.content || '').length,
            tail: trim(typeof message.content === 'string' ? message.content.slice(-350) : '', 350)
        })),
        responseTail: '' };
    provider.push(record);
    // Continue the browser's request so SSE bytes arrive as they are emitted.
    // Buffering them in route.fulfill caused a false 45-second idle timeout.
    return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${key}` } });
}

async function snapshot() {
    return page.evaluate(async id => {
        const inst = state.worldInstances[id];
        const sess = inst?.sessions?.find(item => item.id === inst.activeSessionId);
        if (!sess) return { error: 'No active World timeline' };
        const world = state.worlds.find(item => item.id === id);
        const last = sess.history.at(-1);
        const current = world?.locations?.find(location => location.id === sess.playerLocation);
        const persisted = await HordeDB.get(`worldInstance:${id}`);
        return {
            view: state.view, world: world?.name, model: world?.model,
            lifeSeedSource: sess.lifeSeed?.source || '',
            lifeSeedPeople: (sess.lifeSeed?.people || []).map(person => ({
                name: person.name, relationship: person.relationship, homeLocationId: person.homeLocationId,
                location: sess.entityStates?.[person.id]?.location || ''
            })),
            timelineId: sess.id, turnCount: sess.turnCount, historyLength: sess.history.length,
            lastRole: last?.role, lastText: String(last?.text || '').slice(0, 7000),
            lastTurnDurationMs: Number(last?.turnDurationMs) || 0,
            lastStateSource: last?.stateSource || '', lastCallAudit: last?.callAudit || null,
            locationId: sess.playerLocation, location: current?.name || '',
            clock: sess.worldClock || null, inventory: (sess.inventory || []).slice(0, 25),
            playerStats: sess.playerStats || {}, playerState: sess.playerState || {},
            equipment: sess.equipment || {}, conditions: (sess.conditions || []).slice(0, 10),
            consequences: (sess.consequences || []).slice(-10),
            scheduledEvents: (sess.scheduledEvents || []).slice(-12).map(event => ({
                id: event.id, title: event.title, status: event.status, urgent: event.urgent,
                dueTurn: event.dueTurn, dueMinute: event.dueMinute,
                locationId: event.locationId, conditionOnTrigger: event.conditionOnTrigger
            })),
            locationConditions: (sess.locationStates?.[sess.playerLocation]?.conditions || []).map(item => item.label),
            locationConditionsById: Object.fromEntries(Object.entries(sess.locationStates || {})
                .filter(([, location]) => Array.isArray(location?.conditions) && location.conditions.length)
                .slice(0, 30).map(([id, location]) => [id, location.conditions.map(item => item.label)])),
            urgentBanner: document.getElementById('world-urgent-stakes')?.textContent || '',
            recentWorldNews: (sess.worldNews || []).slice(-5).map(item => ({
                text: item.text, playerVisible: item.playerVisible, playerWitnessed: item.playerWitnessed
            })),
            pendingChecks: (sess.pendingChecks || []).slice(0, 3),
            quests: (sess.quests || []).slice(0, 10).map(q => ({ id: q.id, title: q.title, status: q.status,
                progress: q.progress, objectives: (q.objectives || []).map(o => ({ id: o.id, text: o.text, current: o.current, required: o.required, status: o.status })) })),
            npcStates: Object.fromEntries(Object.entries(sess.entityStates || {}).slice(0, 20).map(([k,v]) => [k, {
                location: v?.location || '', followingPlayer: v?.followingPlayer === true
            }])),
            unlockedExits: sess.unlockedExits || {},
            visibleExits: [...document.querySelectorAll('#world-exits-list button')].map(button => ({
                text: button.textContent?.trim() || '', disabled: button.disabled
            })),
            receipts: sess.worldTurnReceipts?.length || 0,
            latestEvents: (sess.turnEvents || []).slice(-8).map(e => ({ type: e.type, actor_id: e.actor_id,
                target_id: e.target_id, turn: e.turn, committed: e.committed })),
            modelAttempts: sess.worldModelAttempts?.length || 0,
            auditRejected: (sess.lastTurnAudit?.rejected || []).slice(-12),
            deadlineCorrections: (sess.lastTurnAudit?.deadline_corrections || []).slice(-6),
            receipt: sess.worldTurnReceipts?.at(-1)?.receipt || null,
            persisted: !!persisted,
            persistedLocation: persisted?.sessions?.find(item => item.id === sess.id)?.playerLocation || '',
            persistedHistoryLength: persisted?.sessions?.find(item => item.id === sess.id)?.history?.length || 0,
            renderedMessages: document.querySelector('#world-messages-container')?.children.length || 0
        };
    }, worldId);
}

async function boot() {
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ acceptDownloads: true });
    await context.route('**/*', routeRequest);
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'warning' && /Timeline life model generation failed/i.test(message.text())) {
            lifeSeedWarnings.push(trim(message.text(), 500));
        }
    });
    page.on('response', async response => {
        if (!response.url().startsWith('https://openrouter.ai/api/v1/chat/completions')) return;
        const record = provider.find(item => !item.status);
        if (!record) return;
        record.status = response.status();
        markResponseHeaders(record);
        try {
            const body = await response.body();
            const source = body.toString('utf8');
            record.responseTail = trim(source.slice(-1800), 1800);
            if (!record.stream) {
                const parsed = JSON.parse(source);
                record.usage = parsed.usage || null;
                record.output = { content: trim(parsed.choices?.[0]?.message?.content || '', 14000),
                    toolCalls: (parsed.choices?.[0]?.message?.tool_calls || []).map(call => ({
                        name: call.function?.name || '', arguments: trim(call.function?.arguments || '', 14000)
                    })) };
            }
            else {
                const events = source.split('\n').filter(line => line.startsWith('data: '));
                const calls = new Map();
                let content = '';
                for (const event of events) {
                    try {
                        const delta = JSON.parse(event.slice(6)).choices?.[0]?.delta || {};
                        content += typeof delta.content === 'string' ? delta.content : '';
                        for (const call of delta.tool_calls || []) {
                            const index = call.index || 0;
                            if (!calls.has(index)) calls.set(index, { name: '', arguments: '' });
                            const item = calls.get(index);
                            item.name += call.function?.name || '';
                            item.arguments += call.function?.arguments || '';
                        }
                    } catch {}
                }
                record.output = { content: trim(content, 9000), toolCalls: [...calls.values()].map(call => ({
                    name: call.name, arguments: trim(call.arguments, 14000)
                })) };
                for (const event of events.reverse()) {
                    try { const usage = JSON.parse(event.slice(6)).usage; if (usage) { record.usage = usage; break; } } catch {}
                }
            }
        } catch (error) { record.responseTail = trim(error.message, 300); }
        finally { markResponseComplete(record); }
    });
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
    await page.evaluate(liveModel => {
        clearInterval(companionAgencyTimer);
        clearInterval(companionAlwaysOnTimer);
        state.globalSettings.apiProvider = 'openrouter';
        state.globalSettings.defaultModel = liveModel;
        state.globalSettings.structuredModel = liveModel;
        state.apiKey = 'test-key-held-outside-browser';
        switchView('worlds');
    }, model);
    say({ event: 'import-ready', ui: await page.evaluate(() => ({
        view: state.view, buttonWired: typeof document.getElementById('import-world-btn')?.onclick === 'function'
    })) });
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.evaluate(() => document.getElementById('import-world-btn').click())
    ]);
    await chooser.setFiles(worldPath);
    await page.waitForFunction(name => state.worlds.some(w => w.name === name), worldName, { timeout: 30000 });
    const interruptedBySettings = await page.locator('#modal-overlay').isVisible();
    if (interruptedBySettings) await page.locator('#close-modal-btn').click();
    say({ event: 'imported', interruptedBySettings, worldCount: await page.evaluate(() => state.worlds.length) });
    worldId = await page.evaluate(name => [...state.worlds].reverse().find(w => w.name === name)?.id || '', worldName);
    const card = page.locator('#world-grid .char-card').filter({ hasText: worldName }).last();
    await card.locator('.edit-world-btn').click();
    await page.locator('.world-studio-tab[data-tab="w-ai"]').click();
    await page.locator('#w-studio-model').fill(model);
    await page.locator('#w-agent-model').fill(model);
    await page.locator('#w-studio-max-tokens').fill(String(maxOutputTokens));
    await page.locator('#w-studio-context-size').fill(String(contextTokens));
    await page.locator('#save-world-btn').click();
    await page.waitForFunction(id => state.worlds.find(w => w.id === id)?.model === 'google/gemma-4-31b-it', worldId);
    await page.evaluate(() => { switchView('worlds'); renderWorlds(); });
    await page.locator('#world-grid .char-card').filter({ hasText: worldName }).last().locator('.enter-world-btn').click();
    await page.locator('#world-session-zero-overlay').waitFor({ state: 'visible', timeout: 30000 });
    const origins = await page.locator('.session-origin-card').allTextContents();
    await page.locator('.session-origin-card').filter({ hasText: originName }).click();
    await page.locator('#sz-begin-btn').click();
    await page.locator('#world-session-zero-overlay').waitFor({ state: 'hidden', timeout: 180000 });
    say({ event: 'ready', model, maxOutputTokens, contextTokens, worldId, origins: origins.map(x => trim(x.replace(/\s+/g, ' '), 180)),
        opening: await snapshot(), calls, conservativeSpend, priorConservativeSpend, maxConservativeSpend,
        lifeSeedWarnings });
}

async function action(text) {
    const before = await snapshot();
    const started = Date.now();
    const firstCall = provider.length;
    await page.locator('#world-user-input').fill(text);
    await page.locator('#world-send-btn').click();
    let timeout = '';
    try {
        await page.waitForFunction(({ id, count }) => {
            const inst = state.worldInstances[id];
            const sess = inst?.sessions?.find(item => item.id === inst.activeSessionId);
            return !!sess && sess.history.length > count && sess.history.at(-1)?.role === 'dm' && !worldTurnInProgress;
        }, { id: worldId, count: before.historyLength }, { timeout: 180000 });
    } catch (error) { timeout = trim(error.message, 300); }
    const after = await snapshot();
    const wallMs = Date.now() - started;
    const result = { event: 'turn', action: text, ms: wallMs,
        before: { locationId: before.locationId, persistedLocation: before.persistedLocation,
            historyLength: before.historyLength, receipts: before.receipts, turnCount: before.turnCount,
            receiptId: before.receipt?.turn_id || '' },
        timing: !timeout && after.historyLength > before.historyLength
            ? summarizeTurnTiming(wallMs, after.lastCallAudit) : null,
        newProviderCalls: provider.slice(firstCall), after, timeout,
        pageErrors: pageErrors.slice(-3), conservativeSpend };
    turns.push(result);
    say(result);
}

async function travel(to) {
    const before = await snapshot();
    const started = Date.now();
    const firstCall = provider.length;
    const button = page.locator('#world-exits-list button').filter({ hasText: to }).first();
    if (!await button.count() || !await button.isEnabled()) {
        const result = { event: 'travel-blocked', to, ms: Date.now() - started,
            after: await snapshot(), reason: await button.count() ? 'disabled_exit' : 'missing_exit',
            newProviderCalls: [], pageErrors: pageErrors.slice(-3), conservativeSpend };
        turns.push(result);
        return say(result);
    }
    await button.click();
    let timeout = '';
    try {
        await page.waitForFunction(({ id, count }) => {
            const inst = state.worldInstances[id];
            const sess = inst?.sessions?.find(item => item.id === inst.activeSessionId);
            return !!sess && sess.history.length > count && sess.history.at(-1)?.role === 'dm' && !worldTurnInProgress;
        }, { id: worldId, count: before.historyLength }, { timeout: 180000 });
    } catch (error) { timeout = trim(error.message, 300); }
    const after = await snapshot();
    const wallMs = Date.now() - started;
    const result = { event: 'travel', to, ms: wallMs,
        before: { locationId: before.locationId, persistedLocation: before.persistedLocation,
            historyLength: before.historyLength, receipts: before.receipts, turnCount: before.turnCount,
            receiptId: before.receipt?.turn_id || '' },
        timing: !timeout && after.historyLength > before.historyLength
            ? summarizeTurnTiming(wallMs, after.lastCallAudit) : null,
        newProviderCalls: provider.slice(firstCall), after, timeout,
        pageErrors: pageErrors.slice(-3), conservativeSpend };
    turns.push(result);
    say(result);
}

async function check(command) {
    const before = await snapshot();
    const started = Date.now();
    const firstCall = provider.length;
    await page.locator('#world-roll-btn').click();
    await page.locator('#world-check-modal').waitFor({ state: 'visible' });
    if (await page.locator('#world-check-label').isEnabled()) {
        await page.locator('#world-check-label').fill(trim(command.label || 'Player check', 120));
        await page.locator('#world-check-stat').selectOption(command.stat || '');
        await page.locator('#world-check-difficulty').fill(String(command.difficulty || 11));
    }
    await page.locator('#confirm-world-check').click();
    let timeout = '';
    try {
        await page.waitForFunction(({ id, count }) => {
            const inst = state.worldInstances[id];
            const sess = inst?.sessions?.find(item => item.id === inst.activeSessionId);
            return !!sess && sess.history.length > count && sess.history.at(-1)?.role === 'dm' && !worldTurnInProgress;
        }, { id: worldId, count: before.historyLength }, { timeout: 180000 });
    } catch (error) { timeout = trim(error.message, 300); }
    const after = await snapshot();
    const wallMs = Date.now() - started;
    const result = { event: 'check', command, ms: wallMs,
        timing: !timeout && after.historyLength > before.historyLength
            ? summarizeTurnTiming(wallMs, after.lastCallAudit) : null,
        newProviderCalls: provider.slice(firstCall), after, timeout,
        pageErrors: pageErrors.slice(-3), conservativeSpend };
    turns.push(result);
    say(result);
}

// A bounded one-scene API probe when the remaining authorized budget cannot
// cover a full route. This changes only the disposable playtest profile.
async function stageGate() {
    const staged = await page.evaluate(async id => {
        const instance = state.worldInstances[id];
        const session = instance?.sessions?.find(item => item.id === instance.activeSessionId);
        if (!session || session.turnCount > 1 || session.history.length > 1) {
            throw new Error('Gate staging requires a fresh playtest timeline.');
        }
        session.playerLocation = 'gate';
        session.inventory.push(globalThis.HordeRpgMechanics.normalizeItem({
            name: 'torn satchel strap', type: 'custom', quantity: 1
        }));
        session.history[0] = { ...session.history[0], location: 'gate',
            text: 'You stand before the locked watchtower gate with a torn satchel strap in your pack. The cellar is beyond the gate; you have no tower key.' };
        renderWorldPlayState();
        await saveWorldsState({ worldId: id });
        return { locationId: session.playerLocation, inventory: session.inventory.map(item => item.name) };
    }, worldId);
    const result = { event: 'staged-gate-test-fixture', staged, after: await snapshot() };
    turns.push(result);
    say(result);
}

async function stageCellar() {
    const staged = await page.evaluate(async id => {
        const instance = state.worldInstances[id];
        const session = instance?.sessions?.find(item => item.id === instance.activeSessionId);
        if (!session || session.turnCount > 1 || session.history.length > 1) {
            throw new Error('Cellar staging requires a fresh playtest timeline.');
        }
        session.playerLocation = 'cellar';
        for (const actorId of ['tomas', 'sel']) {
            if (!session.entityStates?.[actorId]) throw new Error(`Missing test actor: ${actorId}`);
            session.entityStates[actorId].location = 'cellar';
            session.entityStates[actorId].pinnedUntilTurn = 10;
        }
        session.entityStates.tomas.currentActivity = 'bound to a support beam with ropes';
        session.entityStates.sel.currentActivity = 'holding the sealed spring valve';
        session.history[0] = { ...session.history[0], location: 'cellar',
            text: 'You reach the Tower Cellar. Tomas Reed is bound to a support beam with ropes. Sel Ardent is holding the sealed spring valve nearby.' };
        renderWorldPlayState();
        await saveWorldsState({ worldId: id });
        return { locationId: session.playerLocation,
            tomasActivity: session.entityStates.tomas.currentActivity,
            selActivity: session.entityStates.sel.currentActivity };
    }, worldId);
    const result = { event: 'staged-cellar-test-fixture', staged, after: await snapshot() };
    turns.push(result);
    say(result);
}

async function handle(command) {
    if (command.op === 'act') return action(trim(command.text, 3000));
    if (command.op === 'travel') return travel(trim(command.to, 160));
    if (command.op === 'check') return check(command);
    if (command.op === 'stage-gate') return stageGate();
    if (command.op === 'stage-cellar') return stageCellar();
    if (command.op === 'status') return say({ event: 'status', state: await snapshot(), calls, conservativeSpend, pageErrors });
    if (command.op === 'reload') {
        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        await page.evaluate(id => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'test-key-held-outside-browser';
            document.getElementById('close-modal-btn')?.click();
            enterWorld(id);
        }, worldId);
        if (await page.locator('#modal-overlay').isVisible()) await page.locator('#close-modal-btn').click();
        return say({ event: 'reload', state: await snapshot(), calls, conservativeSpend, pageErrors });
    }
    if (command.op === 'screenshot') {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        return say({ event: 'screenshot', path: screenshotPath });
    }
    if (command.op === 'quit') {
        const report = { model, maxOutputTokens, contextTokens, worldId, calls, priorConservativeSpend, maxConservativeSpend,
            conservativeSpend, provider, turns, pageErrors, lifeSeedWarnings, blockedProviderCalls,
            final: await snapshot() };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        say({ event: 'done', reportPath, calls, conservativeSpend, turnCount: turns.length, pageErrors });
        await browser.close();
        rl.close();
        return;
    }
    throw new Error('Unknown playtest command.');
}

rl.once('line', async line => {
    key = line.trim();
    if (!/^sk-or-v1-[a-z0-9]+$/i.test(key)) {
        say({ event: 'error', message: 'Expected an OpenRouter key on the first line.' });
        process.exitCode = 1;
        rl.close();
        return;
    }
    try { await boot(); }
    catch (error) {
        const bootState = page ? await page.evaluate(() => ({
            setupVisible: !document.getElementById('world-session-zero-overlay')?.classList.contains('hidden'),
            saveStatus: document.querySelector('#sz-save-status')?.textContent || '',
            lifeSeedStatus: document.querySelector('#sz-life-seed-status')?.textContent || '',
            view: state.view
        })).catch(() => null) : null;
        const report = { model, maxOutputTokens, contextTokens, worldId, calls,
            priorConservativeSpend, maxConservativeSpend, conservativeSpend,
            provider, turns, pageErrors, lifeSeedWarnings, blockedProviderCalls,
            bootError: trim(error.message), bootState };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        say({ event: 'boot-error', message: trim(error.message), calls, conservativeSpend, pageErrors, bootState, reportPath });
        await browser?.close();
        process.exitCode = 1;
        rl.close();
        return;
    }
    let chain = Promise.resolve();
    rl.on('line', input => {
        chain = chain.then(async () => handle(JSON.parse(input))).catch(error => {
            say({ event: 'command-error', message: trim(error.message, 500), calls, conservativeSpend, pageErrors });
        });
    });
});
