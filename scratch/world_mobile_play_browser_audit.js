/** Mobile Worlds play controls, place context and exit actions remain usable without sideways scrolling. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
    'worlds2-rpg-live.horde_world'), 'utf8'));

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-mobile-play.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)]
                || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-mobile-play.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined'
            && !!companionAgencyTimer, { timeout: 30000 });
        await page.evaluate(source => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = structuredClone(source);
            world.id = 'world_mobile_play_fixture';
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const session = prepareCurrentWorldSession();
            session.setupComplete = true;
            session.playerLocation = 'square';
            session.history.push({ id: 'opening', role: 'dm',
                text: 'The village square is tense.', location: 'square' });
            document.getElementById('modal-overlay')?.classList.add('hidden');
            enterWorld(world.id);
        }, fixture);

        const measure = async width => {
            await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
            return page.evaluate(() => {
                const inViewport = element => {
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return style.display !== 'none' && rect.width >= 40
                        && rect.left >= -1 && rect.right <= innerWidth + 1
                        && rect.top >= 0 && rect.bottom <= innerHeight;
                };
                const controls = ['world-map-btn', 'world-reroll-btn', 'world-more-btn',
                    'world-hud-toggle', 'world-exit-btn'];
                const toolbar = document.querySelector('.world-toolbar-secondary');
                const context = document.querySelector('.world-mobile-context');
                const mobileExits = [...document.querySelectorAll('#world-mobile-exits-list button')];
                return {
                    controlsVisible: controls.every(id => inViewport(document.getElementById(id))),
                    toolbarNoOverflow: toolbar.scrollWidth <= toolbar.clientWidth + 1,
                    headerNoOverflow: document.querySelector('#world-play-view .chat-header').scrollWidth
                        <= document.querySelector('#world-play-view .chat-header').clientWidth + 1,
                    placeVisible: inViewport(context) && document.getElementById('world-mobile-loc-name').textContent === 'Village Square',
                    exitCount: mobileExits.length,
                    exitsVisible: mobileExits.every(inViewport),
                    infoCollapsed: document.getElementById('world-status-panel').classList.contains('is-collapsed'),
                    composerVisible: inViewport(document.getElementById('world-send-btn')),
                    appRailHidden: getComputedStyle(document.querySelector('#app > .sidebar')).display === 'none',
                    buttonWidths: controls.map(id => [id, Math.round(document.getElementById(id).getBoundingClientRect().width)])
                };
            });
        };
        for (const width of [390, 320]) {
            const layout = await measure(width);
            if (process.env.HORDE_WORLD_MOBILE_SCREENSHOT_PREFIX) {
                await page.screenshot({ path: `${process.env.HORDE_WORLD_MOBILE_SCREENSHOT_PREFIX}-${width}.png` });
            }
            assert.equal(layout.controlsVisible, true, `${width}px controls: ${JSON.stringify(layout)}`);
            assert.equal(layout.toolbarNoOverflow, true, `${width}px secondary toolbar scrolls sideways`);
            assert.equal(layout.headerNoOverflow, true, `${width}px header scrolls sideways`);
            assert.equal(layout.placeVisible, true, `${width}px current place is not visible`);
            assert.equal(layout.exitCount, 2, `${width}px exits are absent`);
            assert.equal(layout.exitsVisible, true, `${width}px exits are clipped`);
            assert.equal(layout.infoCollapsed, true, `${width}px full info panel should start collapsed`);
            assert.equal(layout.composerVisible, true, `${width}px composer is clipped`);
            assert.equal(layout.appRailHidden, true, `${width}px app rail still consumes play space`);
            await page.locator('#world-more-btn').click();
            if (process.env.HORDE_WORLD_MOBILE_DEBUG) console.log('MORE', width, await page.evaluate(() => {
                const menu = document.getElementById('world-more-actions');
                const rect = menu.getBoundingClientRect();
                const style = getComputedStyle(menu);
                const x = rect.left + 24;
                const y = rect.top + 20;
                return { rect: [rect.left, rect.top, rect.width, rect.height],
                    background: style.backgroundColor, opacity: style.opacity, zIndex: style.zIndex,
                    hit: document.elementFromPoint(x, y)?.id || document.elementFromPoint(x, y)?.className };
            }));
            if (process.env.HORDE_WORLD_MOBILE_SCREENSHOT_PREFIX) {
                await page.screenshot({ path: `${process.env.HORDE_WORLD_MOBILE_SCREENSHOT_PREFIX}-${width}-more.png` });
            }
            assert.equal(await page.locator('#world-more-actions').isVisible(), true,
                `${width}px More menu did not open`);
            assert.equal(await page.locator('#world-toggle-headers-btn').isVisible(), true,
                `${width}px More actions were clipped`);
            for (const id of ['world-roll-btn', 'world-continue-btn', 'world-session-zero-btn']) {
                assert.equal(await page.locator(`#world-more-actions #${id}`).isVisible(), true,
                    `${width}px ${id} was not moved into More`);
            }
            await page.locator('#world-clear-btn').scrollIntoViewIfNeeded();
            const lastActionFits = await page.locator('#world-clear-btn').evaluate(button => {
                const rect = button.getBoundingClientRect();
                return rect.top >= 0 && rect.bottom <= innerHeight;
            });
            assert.equal(lastActionFits, true, `${width}px the end of More is not reachable`);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#world-more-actions').isVisible(), false);
            await page.locator('#world-map-btn').click();
            assert.equal(await page.locator('#map-modal').isVisible(), true,
                `${width}px Map did not open`);
            await page.locator('#close-map-modal').click();
        }
        await page.evaluate(() => { executeWorldTurn = async () => renderWorldPlayState(); });
        await page.locator('#world-mobile-exits-list button').filter({ hasText: 'Marsh Causeway' }).click();
        await page.waitForFunction(() => getCurrentWorldSession()?.playerLocation === 'causeway',
            { timeout: 10000 });
        await page.waitForFunction(() => document.getElementById('world-mobile-loc-name').textContent === 'Marsh Causeway',
            { timeout: 10000 });
        assert.equal(await page.locator('#world-mobile-loc-name').textContent(), 'Marsh Causeway');
        assert.equal(await page.locator('#world-mobile-exits-list button').count(), 2);
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.waitForFunction(() => document.getElementById('world-roll-btn')?.parentElement
            ?.classList.contains('world-toolbar-secondary'), { timeout: 5000 });
        const restoredDesktopTools = await page.evaluate(() =>
            ['world-roll-btn', 'world-continue-btn', 'world-session-zero-btn'].every(id =>
                document.getElementById(id).parentElement?.classList.contains('world-toolbar-secondary'))
            && getComputedStyle(document.querySelector('.world-mobile-context')).display === 'none');
        assert.equal(restoredDesktopTools, true, 'resizing to desktop did not restore the direct tools');
        assert.deepEqual(errors, []);
        console.log('PASS: Worlds play controls, location, travel exits, Map and More work at 390px and 320px without a sideways toolbar');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
