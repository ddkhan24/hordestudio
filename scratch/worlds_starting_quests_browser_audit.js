/** World Studio starting-quest editor round trip; no provider calls. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'worlds-starting-quests.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, body: '' });
            }
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://worlds-starting-quests.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        await page.evaluate(world => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            world.id = 'starting_quest_ui_fixture';
            world.name = 'Starting Quest UI Fixture';
            world.startingQuests = [];
            state.worlds.push(world);
            openWorldStudio(world.id);
            document.querySelector('.world-studio-tab[data-tab="w-hud"]').click();
            // Fresh-profile first-run Settings is unrelated to this editor.
            document.getElementById('modal-overlay')?.classList.add('hidden');
        }, fixture);

        await page.locator('#add-world-starting-quest-btn').click();
        const card = page.locator('.world-starting-quest-card').first();
        assert.equal(await page.evaluate(() => saveWorld()), false,
            'an empty objective must block saving instead of exporting a ghost quest');
        await card.locator('.world-starting-quest-title').fill('Reach the tower cellar');
        await card.locator('.world-starting-quest-giver').fill('Mara');
        await card.locator('.world-starting-quest-description').fill('Track the courier through the causeway.');
        await card.locator('.world-starting-quest-objective-text').fill('Enter the cellar');
        await card.locator('.world-starting-quest-objective-type').selectOption('location');
        await card.locator('.world-starting-quest-objective-target').fill('cellar');
        await card.locator('.world-starting-quest-add-objective').click();
        assert.equal(await card.locator('.world-starting-quest-objective').count(), 2);
        await card.locator('.world-starting-quest-objective-delete').last().click();
        assert.equal(await card.locator('.world-starting-quest-objective').count(), 1);
        assert.equal(await card.locator('.world-starting-quest-objective-target').inputValue(), 'cellar');
        await card.locator('.world-starting-quest-reward-items').fill('tower token');
        await card.locator('.world-starting-quest-reward-stats').fill('silver +5');
        assert.equal(await page.evaluate(() => saveWorld()), false,
            'malformed reward lines must not be silently discarded');
        await card.locator('.world-starting-quest-reward-stats').fill('silver: 5');
        const saved = await page.evaluate(() => saveWorld());
        assert.equal(saved, true);
        const authored = await page.evaluate(async () => {
            const current = state.worlds.find(world => world.id === 'starting_quest_ui_fixture');
            const stored = (await HordeDB.get('worlds')).find(world => world.id === current.id);
            return { current: current.startingQuests, stored: stored?.startingQuests };
        });
        assert.equal(authored.current[0].title, 'Reach the tower cellar');
        assert.equal(authored.current[0].objectives[0].type, 'location');
        assert.equal(authored.current[0].objectives[0].target, 'cellar');
        assert.deepEqual(authored.current[0].rewards.items, ['tower token']);
        assert.equal(authored.current[0].rewards.stats.silver, 5);
        assert.deepEqual(authored.stored, authored.current);
        await page.screenshot({ path: '/tmp/worlds-starting-quest-studio.png', fullPage: false });

        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        await page.waitForFunction(() => state.worlds.some(world => world.id === 'starting_quest_ui_fixture'), { timeout: 30000 });
        const reloaded = await page.evaluate(() => {
            const world = state.worlds.find(item => item.id === 'starting_quest_ui_fixture');
            openWorldStudio(world.id);
            document.querySelector('.world-studio-tab[data-tab="w-hud"]').click();
            return world.startingQuests;
        });
        assert.equal(reloaded[0].title, 'Reach the tower cellar');
        assert.equal(await page.locator('.world-starting-quest-title').inputValue(), 'Reach the tower cellar');
        assert.equal(await page.locator('.world-starting-quest-objective-target').inputValue(), 'cellar');
        await page.setViewportSize({ width: 800, height: 900 });
        const responsive = await page.evaluate(() => {
            const card = document.querySelector('.world-starting-quest-card');
            const row = card.querySelector('.world-starting-quest-objective');
            return { cardOverflow: card.scrollWidth - card.clientWidth,
                rowOverflow: row.scrollWidth - row.clientWidth };
        });
        assert(responsive.cardOverflow <= 2 && responsive.rowOverflow <= 2,
            `quest authoring overflowed at 800px: ${JSON.stringify(responsive)}`);
        await page.setViewportSize({ width: 1365, height: 900 });
        await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'starting_quest_ui_fixture');
            state.activeWorldId = world.id;
            state.worldInstances[world.id] = { activeSessionId: '', sessions: [] };
            window.__questAuditInitCalls = 0;
            window.executeWorldTurn = async () => { window.__questAuditInitCalls++; };
            document.getElementById('modal-overlay')?.classList.add('hidden');
            await createNewWorldSession();
        });
        await page.locator('#sz-skip-btn').click();
        await page.waitForFunction(() => getCurrentWorldSession()?.startingQuestsSeeded === true, { timeout: 30000 });
        await page.waitForFunction(() => window.__questAuditInitCalls === 1, { timeout: 30000 });
        const firstSession = await page.evaluate(() => {
            const sess = getCurrentWorldSession();
            return { id: sess.id, quests: sess.quests, inventory: sess.inventory,
                stats: sess.playerStats, initCalls: window.__questAuditInitCalls };
        });
        assert.equal(firstSession.quests.length, 1);
        assert.equal(firstSession.quests[0].status, 'active');
        assert.equal(firstSession.quests[0].objectives[0].current, 0);
        assert.equal(firstSession.quests[0].rewardsGranted, false);
        assert(!firstSession.inventory.some(item => (typeof item === 'string' ? item : item.name) === 'tower token'));
        assert.equal(firstSession.initCalls, 1);
        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const persistedSession = await page.evaluate(id => {
            const inst = state.worldInstances.starting_quest_ui_fixture;
            const sess = inst?.sessions?.find(item => item.id === id);
            return { seeded: sess?.startingQuestsSeeded, count: sess?.quests?.length,
                status: sess?.quests?.[0]?.status, rewardsGranted: sess?.quests?.[0]?.rewardsGranted };
        }, firstSession.id);
        assert.deepEqual(persistedSession, { seeded: true, count: 1, status: 'active', rewardsGranted: false });
        assert.deepEqual(errors, []);
        console.log('PASS World Studio starting quest authoring, new-timeline setup, storage and reload');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
