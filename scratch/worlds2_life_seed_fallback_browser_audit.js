/** A failed life-seed model must not invent modern contacts or a home for a fantasy outsider. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/worlds2-rpg-live.horde_world'), 'utf8'));
const worldId = 'fantasy_life_seed_fallback_fixture';

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'worlds-life-seed-fallback.test') return route.abort();
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
        await page.goto('https://worlds-life-seed-fallback.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        await page.evaluate(async world => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            document.getElementById('modal-overlay')?.classList.add('hidden');
            world.id = 'fantasy_life_seed_fallback_fixture';
            state.worlds.push(world);
            state.activeWorldId = world.id;
            state.personas = [];
            state.activePersonaId = null;
            state.worldInstances[world.id] = { activeSessionId: '', sessions: [] };
            window.__lifeSeedModelCalls = 0;
            window.requestTimelineLifePlan = async () => {
                window.__lifeSeedModelCalls++;
                throw new Error('Simulated provider failure');
            };
            window.executeWorldTurn = async () => {};
            await createNewWorldSession();
        }, fixture);
        assert.equal(await page.locator('#world-session-zero-overlay').isVisible(), true);
        assert.equal(await page.locator('.session-origin-card.selected strong').textContent(), 'The Ranger');
        assert.match(await page.locator('#sz-life-seed-status').textContent(), /no model request or provider credits/i);
        await page.locator('#sz-begin-btn').click();
        await page.waitForFunction(() => getCurrentWorldSession()?.lifeSeed?.initialized === true, { timeout: 30000 });
        const first = await page.evaluate(async id => {
            await saveWorldsState();
            const world = state.worlds.find(item => item.id === id);
            const sess = getCurrentWorldSession();
            return {
                sessionId: sess.id,
                source: sess.lifeSeed.source,
                people: sess.lifeSeed.people,
                homeId: sess.lifeSeed.homeLocationId,
                playerHomeId: sess.playerIdentity.homeLocationId,
                modelCalls: window.__lifeSeedModelCalls,
                locations: world.locations.map(location => location.name),
                persisted: (await HordeDB.get(`worldInstance:${id}`))?.sessions?.find(item => item.id === sess.id)?.lifeSeed
            };
        }, worldId);
        assert.equal(first.source, 'deterministic_origin');
        assert.equal(first.modelCalls, 0, 'a no-Persona outsider still spent provider credits on life setup');
        assert.deepEqual(first.people, []);
        assert.equal(first.homeId, '');
        assert.equal(first.playerHomeId, '');
        assert(!first.locations.some(name => /Home$/.test(name)), 'fallback created an unverified family home');
        assert.equal(first.persisted?.people?.length, 0);
        assert.equal(first.persisted?.homeLocationId, '');

        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const afterReload = await page.evaluate(id => {
            const world = state.worlds.find(item => item.id === id);
            const sess = state.worldInstances[id]?.sessions?.[0];
            return {
                sessionId: sess?.id,
                source: sess?.lifeSeed?.source,
                people: sess?.lifeSeed?.people,
                homeId: sess?.lifeSeed?.homeLocationId,
                playerHomeId: sess?.playerIdentity?.homeLocationId,
                locations: world?.locations?.map(location => location.name)
            };
        }, worldId);
        assert.equal(afterReload.sessionId, first.sessionId);
        assert.equal(afterReload.source, 'deterministic_origin');
        assert.deepEqual(afterReload.people, []);
        assert.equal(afterReload.homeId, '');
        assert.equal(afterReload.playerHomeId, '');
        assert.deepEqual(afterReload.locations, first.locations);

        // An explicitly authored bond is canon even when the fallback wisely
        // declines to manufacture additional friends or a residence.
        await page.evaluate(async id => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = state.worlds.find(item => item.id === id);
            world.startingLives[0].startingRelationships = [
                { npcId: 'mara', label: 'former guide', disposition: 72 }
            ];
            state.activeWorldId = id;
            window.__lifeSeedModelCalls = 0;
            window.requestTimelineLifePlan = async () => {
                window.__lifeSeedModelCalls++;
                throw new Error('Simulated provider failure');
            };
            window.executeWorldTurn = async () => {};
            await createNewWorldSession();
        }, worldId);
        await page.locator('#sz-begin-btn').click();
        await page.waitForFunction(() => getCurrentWorldSession()?.lifeSeed?.initialized === true, { timeout: 30000 });
        const authored = await page.evaluate(async () => {
            await saveWorldsState();
            const sess = getCurrentWorldSession();
            return { id: sess.id, source: sess.lifeSeed.source, modelCalls: window.__lifeSeedModelCalls,
                homeId: sess.lifeSeed.homeLocationId, people: sess.lifeSeed.people,
                selected: sess.playerIdentity.authoredRelationships };
        });
        assert.equal(authored.source, 'deterministic_fallback');
        assert.equal(authored.modelCalls, 1, 'an authored relationship should retain its configured model seed path');
        assert.equal(authored.homeId, '');
        assert.equal(authored.people.length, 1);
        assert.equal(authored.people[0].name, 'Mara Venn');
        assert.equal(authored.people[0].relationship, 'former guide');
        assert.equal(authored.selected[0].npcId, 'mara');
        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const authoredReload = await page.evaluate(({ id, worldId }) =>
            state.worldInstances[worldId]?.sessions?.find(sess => sess.id === id)?.lifeSeed?.people,
        { id: authored.id, worldId });
        assert.equal(authoredReload?.length, 1);
        assert.equal(authoredReload[0].relationship, 'former guide');
        assert.deepEqual(errors, []);
        console.log('PASS fantasy outsider fallback and authored bond survive first-run setup, storage and reload');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
