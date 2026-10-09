/** A stale VH life must offer a working, discoverable live-clock catch-up action. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const host = 'vh2-live-clock-catchup.test';
function serve(context) {
    return context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== host) return route.abort();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return route.fulfill({ status: 404, body: '' });
        }
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
    });
}

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await serve(context);
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`https://${host}/`);
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const companion = normalizeCompanion({ id: 'clock-audit-human', name: 'Clock Audit Human', age: 29 });
            state.companions = [companion];
            state.activeCompanionId = companion.id;
            state.companionTimelines = {};
            state.companionThreads = {};
            ensureCompanionTimelineStore(companion.id);
            const timeline = getActiveCompanionTimeline(companion.id);
            timeline.vh2 = {
                worldId: 'clock-audit-life', revision: 1, running: true,
                simAt: Date.now() - 12090 * 60000,
                outbox: [], signals: { sources: [], signals: [] }, travelPlaces: []
            };
            window.clockAuditCommands = [];
            window.clockAuditPollOptions = [];
            window.clockAuditCompleteImmediately = true;
            window.clockAuditServerSimAt = null;
            window.clockAuditStatusExtra = {};
            vhUiCommand = async (selectedTimeline, type, body) => {
                window.clockAuditCommands.push({ selectedTimeline: selectedTimeline.id, type, body });
                if (type === 'catch_up_life') {
                    selectedTimeline.vh2.running = true;
                    if (window.clockAuditCompleteImmediately) selectedTimeline.vh2.simAt = Date.now();
                }
                return { worldId: selectedTimeline.vh2.worldId };
            };
            vh2Request = async (selectedTimeline, endpoint) => endpoint === '/vh2/status'
                ? { serverNow: Date.now(), ...window.clockAuditStatusExtra, worlds: [{
                    worldId: selectedTimeline.vh2.worldId,
                    simAt: window.clockAuditServerSimAt ?? selectedTimeline.vh2.simAt,
                    running: selectedTimeline.vh2.running
                }] }
                : { hasKey: false, enabled: false, dailyLimit: 20, usedToday: 0 };
            vh2Poll = async (_companion, _timeline, options) => { window.clockAuditPollOptions.push(options || {}); };
            hideGlobalSettings();
            switchView('vhWorkspace');
            vhArrangeWorkspace(companion, timeline);
        });

        const overview = page.locator('#vh-workspace-overview');
        const catchUp = overview.locator('[data-catch-up-life]');
        assert.equal(await catchUp.isVisible(), true, 'stale life must show catch-up in Life Overview');
        assert.equal(await catchUp.getAttribute('type'), 'button');
        assert.match(await catchUp.textContent(), /Catch up to current time/i);
        await catchUp.click();
        await page.waitForFunction(() => window.clockAuditCommands.length === 1);
        assert.deepEqual(await page.evaluate(() => window.clockAuditCommands.map(command => command.type)), ['catch_up_life'],
            'one click must submit exactly one confirmed catch-up command');
        try { await catchUp.waitFor({ state: 'hidden', timeout: 3000 }); }
        catch {
            const detail = await page.evaluate(() => ({
                view: state.view,
                simAt: getActiveCompanionTimeline('clock-audit-human').vh2.simAt,
                status: document.querySelector('#vh-workspace-overview .vh-clock-catchup [role=status]')?.textContent,
                toasts: [...document.querySelectorAll('.toast')].map(item => item.textContent),
                errors: window.clockAuditCommands
            }));
            throw Error('catch-up did not refresh Overview: ' + JSON.stringify(detail));
        }

        await page.evaluate(() => {
            const companion = getCompanion('clock-audit-human');
            const timeline = getActiveCompanionTimeline(companion.id);
            window.clockAuditCompleteImmediately = false;
            window.clockAuditServerSimAt = Date.now() - 12090 * 60000;
            timeline.vh2.simAt = window.clockAuditServerSimAt;
            // This is the real cached workspace path: controls have not changed,
            // only the service clock. It must still reveal the catch-up action.
            vhRenderWorkspace();
        });
        assert.equal(await catchUp.isVisible(), true, 'a life with a remaining backlog keeps the catch-up panel');
        await catchUp.click();
        await page.waitForFunction(() => window.clockAuditCommands.length === 2);
        await page.waitForFunction(() => document.querySelector('#vh-workspace-overview .vh-clock-catchup [role=status]')
            ?.textContent.includes('Refresh progress'));
        await page.evaluate(() => { window.clockAuditServerSimAt = Date.now() - 2 * 1440 * 60000; });
        await overview.locator('[data-refresh-clock]').click();
        await page.waitForFunction(() => document.querySelector('#vh-workspace-overview .vh-clock-catchup [role=status]')
            ?.textContent.includes('Still 2 days'));
        assert.match(await overview.locator('.vh-clock-catchup strong').textContent(), /Life is 2 days(?: \d+ minutes?)? behind real time/);
        assert.equal(await page.evaluate(() => window.clockAuditCommands.length), 2,
            'refreshing progress must not submit another catch-up command');

        await page.evaluate(() => {
            const companion = getCompanion('clock-audit-human');
            getActiveCompanionTimeline(companion.id).vh2.simAt = Date.now() - 12090 * 60000;
            return vhTicketmasterSetup(companion);
        });
        const dialog = page.getByRole('dialog', { name: 'Ticketmaster events' });
        const ticketmasterCatchUp = dialog.getByRole('button', { name: 'Catch up to current time' });
        assert.equal(await ticketmasterCatchUp.isVisible(), true, 'Ticketmaster setup must offer the same action');
        await ticketmasterCatchUp.click();
        await page.waitForFunction(() => window.clockAuditCommands.length === 3);
        assert.deepEqual(await page.evaluate(() => window.clockAuditCommands.map(command => command.type)),
            ['catch_up_life', 'catch_up_life', 'catch_up_life'], 'Ticketmaster setup must invoke the defined catch-up handler');
        await dialog.getByRole('button', { name: 'Close' }).click();

        await page.evaluate(() => {
            const companion = getCompanion('clock-audit-human');
            const timeline = getActiveCompanionTimeline(companion.id);
            window.clockAuditServerSimAt = null;
            timeline.vh2.simAt = Date.now() + 30 * 60000;
            vhRenderWorkspace();
        });
        assert.equal(await catchUp.count(), 0, 'a future life must not offer a rewind action in Life Overview');
        await page.evaluate(() => vhTicketmasterSetup(getCompanion('clock-audit-human')));
        const aheadDialog = page.getByRole('dialog', { name: 'Ticketmaster events' });
        assert.equal(await aheadDialog.getByRole('button', { name: 'Catch up to current time' }).count(), 0,
            'Ticketmaster setup must not offer a rewind action');
        await aheadDialog.getByRole('button', { name: 'Close' }).click();
        await page.evaluate(() => {
            const companion = getCompanion('clock-audit-human');
            getActiveCompanionTimeline(companion.id).vh2.simAt = undefined;
            window.clockAuditServerSimAt = Date.now() - 12090 * 60000;
            vhRenderWorkspace();
        });
        assert.equal(await overview.getByRole('button', { name: 'Check life clock' }).isVisible(), true,
            'an unsynced clock must offer a read-only check instead of hiding all clock controls');
        await overview.getByRole('button', { name: 'Check life clock' }).click();
        await catchUp.waitFor({ state: 'visible' });
        await page.evaluate(() => {
            window.clockAuditStatusExtra = { lastError: 'Simulation tick failed', dialogueError: '',
                dialogueDiagnostic: { state: 'healthy', consecutiveFailures: 0, lastFailure: null, lastRecoveredAt: null } };
            vhOpenLifeStatus(getCompanion('clock-audit-human'));
        });
        const lifeStatus = page.getByRole('dialog', { name: 'Life status' });
        await lifeStatus.locator('[data-maintenance]').getByText(/life simulation worker reported a separate issue/i).waitFor();
        assert.doesNotMatch(await lifeStatus.locator('[data-maintenance]').innerText(), /reply worker is recovering/i,
            'a simulation tick error must not be mislabeled as a reply worker outage');
        await page.evaluate(() => {
            window.clockAuditStatusExtra = { lastError: '', dialogueError: 'Reply worker cannot access local life storage.',
                dialogueDiagnostic: { state: 'recovering', consecutiveFailures: 2, lastRecoveredAt: null,
                    lastFailure: { category: 'storage', stage: 'prepare_reply', at: Date.now(), worldId: 'clock-audit-life' } } };
        });
        await lifeStatus.getByRole('button', { name: 'Refresh status' }).click();
        await lifeStatus.locator('[data-maintenance]').getByText(/local life-storage access while preparing a reply/i).waitFor();
        assert.equal(await page.evaluate(() => window.clockAuditPollOptions.at(-1)?.readOnly), true,
            'checking status must not flush queued paid work');
        assert.equal(await lifeStatus.getByRole('button', { name: 'Check reply attempts' }).isVisible(), true,
            'worker errors must offer a safe next action');
        assert.doesNotMatch(await lifeStatus.locator('[data-maintenance]').innerText(), /saved message remains/i,
            'storage failures must not claim delivery or durability that has not been verified');
        await lifeStatus.getByRole('button', { name: 'Check reply attempts' }).click();
        await page.getByRole('dialog', { name: 'Reply details' }).waitFor();
        await page.getByRole('dialog', { name: 'Reply details' }).getByRole('button', { name: 'Close' }).click();
        await page.evaluate(() => {
            const companion = getCompanion('clock-audit-human');
            getActiveCompanionTimeline(companion.id).vh2.replyJob = { id: 'failed-audit-job', status: 'failed', reason: 'Provider rejected the request.' };
            vhOpenLifeStatus(companion);
        });
        const failedStatus = page.getByRole('dialog', { name: 'Life status' });
        await failedStatus.getByRole('button', { name: 'Review retry' }).click();
        await page.getByRole('button', { name: 'Retry reply using configured model' }).waitFor();
        assert.equal(await page.evaluate(() => window.clockAuditCommands.filter(command => command.type === 'queue_dialogue').length), 0,
            'opening recovery must not submit another paid reply');
        await page.evaluate(() => {
            const companion = getCompanion('clock-audit-human');
            getActiveCompanionTimeline(companion.id).vh2.replyJob = { id: 'unknown-audit-job', status: 'unknown', reason: 'Provider outcome uncertain.' };
            vhRenderWorkspace();
            vhRenderSystemStatus(companion);
        });
        assert.equal(await page.getByRole('button', { name: 'Retry reply using configured model' }).count(), 0,
            'an uncertain provider submission must not offer blind retry');
        assert.match(await page.locator('#vh-chat-system nav').innerText(), /Inspect attempt/,
            'the chat error should point to the uncertain attempt, not a generic fix');
        assert.equal(await page.evaluate(() => window.clockAuditCommands.filter(command => command.type === 'queue_dialogue').length), 0,
            'inspecting the uncertain attempt must not create a paid request');
        assert.deepEqual(pageErrors, [], 'catch-up controls must not throw browser errors');
        console.log('PASS: cached catch-up, unknown clock checks, diagnostic actions, and safe reply recovery');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
