/** Explicit impassable conditions block entry, not ordinary hazards or escape. */
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
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-route-closure.test') return route.abort();
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
        await page.goto('https://world-route-closure.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer,
            { timeout: 30000 });
        const result = await page.evaluate(async source => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = structuredClone(source);
            world.id = 'world_route_closure_fixture';
            world.startLocationId = 'square';
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.playerLocation = 'square';
            sess.pendingChecks = [];
            sess.pendingCheck = null;
            sess.history.push({ id: 'opening', role: 'dm', text: 'You stand by the village well.', location: 'square' });
            switchView('worldPlay');
            document.getElementById('modal-overlay')?.classList.add('hidden');
            const causeway = world.locations.find(location => location.id === 'causeway');
            const square = world.locations.find(location => location.id === 'square');
            const exit = square.exits.find(item => item.targetLocationId === 'causeway');
            const getButton = (id, text) => [...document.querySelectorAll(`#${id} button`)]
                .find(button => button.textContent.includes(text));

            sess.locationStates.causeway.conditions = [{ id: 'rain', label: 'Flooded' }];
            renderWorldPlayState();
            const wetOnly = {
                blocked: !!worldLocationTravelBlock(sess, causeway.id),
                desktopDisabled: getButton('world-exits-list', 'Marsh Causeway')?.disabled,
                mobileDisabled: getButton('world-mobile-exits-list', 'Marsh Causeway')?.disabled,
                path: findWorldTravelPath(world, 'square', 'causeway', { session: sess })
            };

            sess.locationStates.causeway.conditions.push({ id: 'closure', label: 'Impassable' });
            renderWorldPlayState();
            const closedButton = getButton('world-exits-list', 'Marsh Causeway');
            const blocked = {
                desktopDisabled: closedButton?.disabled,
                mobileDisabled: getButton('world-mobile-exits-list', 'Marsh Causeway')?.disabled,
                label: closedButton?.textContent,
                title: closedButton?.title,
                path: findWorldTravelPath(world, 'square', 'causeway', { session: sess }),
                throughPath: findWorldTravelPath(world, 'square', 'gate', { session: sess }),
                receiptCount: sess.worldTurnReceipts?.length || 0,
                historyCount: sess.history.length
            };
            const denied = movePlayerAlongWorldPath(world, sess, causeway, { exit });
            const deniedClick = await travelThroughWorldExit(world, sess, exit);
            const afterDenial = {
                location: sess.playerLocation,
                receiptCount: sess.worldTurnReceipts?.length || 0,
                historyCount: sess.history.length
            };
            const typed = applyUserDirectedMovement(world, sess, 'I walk to Marsh Causeway.');

            // Imported or structured condition metadata must survive normalizing.
            sess.locationStates.causeway.conditions = [{ id: 'custom', label: 'Crumbling masonry', blocksTravel: true }];
            normalizeLivingWorldState(world, sess);
            const explicitFlag = {
                stored: sess.locationStates.causeway.conditions[0]?.blocksTravel,
                blocked: !!worldLocationTravelBlock(sess, causeway.id)
            };
            // A trapped player can still leave the closed location. Alternate
            // routes must also remain available when one path is impassable.
            sess.playerLocation = 'causeway';
            renderWorldPlayState();
            const escape = {
                path: findWorldTravelPath(world, 'causeway', 'square', { session: sess }),
                buttonDisabled: getButton('world-exits-list', 'Village Square')?.disabled
            };
            sess.playerLocation = 'square';
            square.exits.push({ text: 'to Watchtower Gate', targetLocationId: 'gate', travelTime: 50 });
            const detour = findWorldTravelPath(world, 'square', 'gate', { session: sess });
            sess.locationStates.causeway.conditions = [{ id: 'rain', label: 'Flooded' }];
            renderWorldPlayState();
            const reopened = getButton('world-exits-list', 'Marsh Causeway')?.disabled;
            return { wetOnly, blocked, denied, deniedClick, afterDenial, typed,
                explicitFlag, escape, detour, reopened, finalLocation: sess.playerLocation };
        }, fixture);
        assert.deepEqual(result.wetOnly, {
            blocked: false, desktopDisabled: false, mobileDisabled: false,
            path: ['square', 'causeway']
        });
        assert.equal(result.blocked.desktopDisabled, true);
        assert.equal(result.blocked.mobileDisabled, true);
        assert.match(result.blocked.label, /route closed: Impassable/i);
        assert.match(result.blocked.title, /Marsh Causeway is impassable/i);
        assert.equal(result.blocked.path, null);
        assert.equal(result.blocked.throughPath, null);
        assert.equal(result.denied.reason, 'impassable_destination');
        assert.equal(result.deniedClick.reason, 'impassable_destination');
        assert.deepEqual(result.afterDenial, {
            location: 'square', receiptCount: result.blocked.receiptCount,
            historyCount: result.blocked.historyCount
        });
        assert.equal(result.typed, '');
        assert.deepEqual(result.explicitFlag, { stored: true, blocked: true });
        assert.deepEqual(result.escape, { path: ['causeway', 'square'], buttonDisabled: false });
        assert.deepEqual(result.detour, ['square', 'gate']);
        assert.equal(result.reopened, false);
        assert.equal(result.finalLocation, 'square');
        assert.deepEqual(errors, []);
        console.log('PASS: impassable routes block desktop/mobile entry, keep escape/detours and reopen; flooded alone remains passable');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
