'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const ROOT = path.resolve(__dirname, '..');
const PYTHON = process.env.HORDE_PYTHON_EXECUTABLE || 'python3';
const SCREENSHOT_DIR = process.env.HORDE_AUDIT_SCREENSHOT_DIR || '';

async function capture(locator, name) {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await locator.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

function startStudio() {
    const child = spawn(PYTHON, ['scratch/vh2_browser_server.py'], {
        cwd: ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
        child.stdout.once('data', data => resolve({ child, base: `http://127.0.0.1:${Number(String(data).trim())}` }));
        child.stderr.on('data', data => process.stderr.write(data));
        child.once('exit', code => reject(Error(`Studio fixture exited during startup (${code}).`)));
    });
}

async function openStorage(page) {
    await page.evaluate(() => { vhOpenWorkspace('recovery'); vhRenderWorkspace(); });
    const section = page.locator('.vh-life-storage').last();
    await section.waitFor({ state: 'attached' });
    const panel = section.locator('xpath=ancestor::details[1]');
    if (!await panel.evaluate(node => node.open)) await panel.locator(':scope > summary').click();
    await section.waitFor({ state: 'visible' });
    await page.waitForFunction(() => /storage totals are current/i.test(document.querySelector('.vh-storage-status')?.textContent || ''));
    return { panel, section };
}

async function main() {
    let studio;
    let browser;
    try {
        studio = await startStudio();
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(studio.base) ? route.continue() : route.abort());
        await page.goto(studio.base + '/index.html');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const worldId = await page.evaluate(async base => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            mcpBridgeBase = () => base;
            state.apiKey = 'LOCAL_TEST_KEY';
            Object.assign(state.globalSettings, { apiProvider: 'local', localBaseUrl: base + '/test', localApiKey: 'LOCAL_TEST_KEY', defaultModel: 'browser-fixture' });
            const companion = normalizeCompanion({
                id: 'storage-ui-alex', name: 'Alex Rowan', age: 31,
                personality: 'Curious and persistent.', textProvider: 'local', model: 'browser-fixture',
                timezoneOffsetMinutes: 0,
                lifeProfile: { initializedAt: 1788764400000, places: [{ id: 'home', label: 'Apartment', kind: 'home' }], weeklySchedule: [], socialCircle: [], sleepPolicy: { enabled: false } },
            });
            state.companions = [companion];
            state.companionTimelines = {};
            state.companionThreads = {};
            state.activeCompanionId = companion.id;
            ensureCompanionTimelineStore(companion.id);
            hideGlobalSettings();
            await vh2CreateTimeline(companion);
            return getActiveCompanionTimeline(companion.id).vh2.worldId;
        }, studio.base);

        let { section } = await openStorage(page);
        const copy = await section.innerText();
        assert.match(copy, /whole service/i, 'scope is explicitly service-wide');
        assert.match(copy, /recent detail[\s\S]*priority landmarks[\s\S]*verified checkpoint/i, 'resolution model is visible in order');
        assert.match(copy, /chat transcript[\s\S]*current person and relationships[\s\S]*authored facts[\s\S]*important memories/i, 'durable human data is distinguished from engine detail');
        assert.match(copy, /ordinary dinner 100 nights ago/i, 'routine noise has a concrete novice-friendly example');
        assert.match(copy, /routine memories keep 30 days[\s\S]*notable memories keep one year/i, 'memory resolution windows are stated before maintenance');
        assert.match(copy, /compacts completed provider jobs/i, 'maintenance discloses operational job-history resolution');
        assert.notEqual(await section.locator('[data-storage-total]').innerText(), '—', 'service disk usage loads lazily');
        assert.match(await section.locator('[data-storage-files]').innerText(), /database/i, 'physical database breakdown is visible');
        assert.match(await section.locator('[data-storage-service-media]').innerText(), /frozen photo context/i, 'hidden capture snapshots are included in the storage explanation');
        assert.match(await section.locator('[data-storage-detail]').innerText(), /detailed step/i, 'retained raw detail is named accurately');
        assert.match(await section.locator('[data-storage-lifetime]').innerText(), /lifetime revision/i, 'lifetime progress stays distinct from retained rows');
        assert.match(await section.locator('[data-storage-landmark-count]').innerText(), /permanent landmark/i, 'landmark total is visible');
        assert(await section.locator('[data-storage-landmarks] > li').count() >= 1, 'important landmarks are rendered');
        const optimizeRunning = section.getByRole('button', { name: 'Optimize service storage', exact: true });
        assert.equal(await optimizeRunning.isDisabled(), true, 'maintenance is gated while this life is running');
        assert.match(await section.locator('[data-storage-pause]').innerText(), /pause this life.*every other life/i, 'pause prerequisite explains service-wide scope');
        await capture(section, 'life-service-storage-desktop');

        await page.evaluate(async () => {
            const companion = getCompanion('storage-ui-alex');
            await vhUiCommand(getActiveCompanionTimeline(companion.id), 'set_running', { running: false });
            vhOpenWorkspace('recovery');
            vhRenderWorkspace();
        });
        ({ section } = await openStorage(page));
        const optimize = section.getByRole('button', { name: 'Optimize service storage', exact: true });
        assert.equal(await optimize.isEnabled(), true, 'paused life exposes maintenance action');
        page.once('dialog', async dialog => {
            assert.match(dialog.message(), /every life on this service/i, 'confirmation repeats service scope');
            assert.match(dialog.message(), /cannot be inspected afterward/i, 'confirmation names the irreversible detail loss');
            assert.match(dialog.message(), /exact chats[\s\S]*relationships[\s\S]*authored facts[\s\S]*photos[\s\S]*important memories/i, 'confirmation names preserved durable data');
            await dialog.accept();
        });
        await optimize.click();
        await page.waitForFunction(() => /optimization complete/i.test(document.querySelector('.vh-storage-status')?.textContent || ''), null, { timeout: 30000 });
        const after = await (await fetch(studio.base + `/vh2/storage?worldId=${encodeURIComponent(worldId)}`)).json();
        assert(after.retainedEventRows <= 2, 'optimizer resolves raw history into a bounded checkpoint');
        assert.match(await section.locator('[data-storage-resolution]').innerText(), /verified checkpoint/i, 'post-maintenance UI explains the resolved state');

        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await section.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth }));
        assert(overflow.scroll <= overflow.client + 1, `storage section must not overflow on mobile: ${JSON.stringify(overflow)}`);
        const controls = await section.locator('button:visible').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
        assert(controls.every(height => height >= 43.5), 'mobile storage controls meet the 44px target');
        await capture(section, 'life-service-storage-mobile');
        assert.deepEqual(errors, [], 'storage flow produces no browser exceptions');
        console.log(JSON.stringify({ passed: true, checks: 24, worldId, retainedEventRows: after.retainedEventRows }, null, 2));
    } finally {
        if (browser) await browser.close();
        studio?.child.kill();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
