/** Browser-level manual gate check: fail, succeed, save, reload, rollback. No API. */
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
            if (url.hostname !== 'world-manual-gate.test') return route.abort();
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
        await page.goto('https://world-manual-gate.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined'
            && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async source => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = structuredClone(source);
            world.id = 'world_manual_gate_fixture';
            world.startLocationId = 'gate';
            world.gameRules.dice = { resolution: 'player', sides: 20,
                defaultDifficulty: 11, criticals: true, modifierMode: 'none' };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const session = prepareCurrentWorldSession();
            session.setupComplete = true;
            session.playerLocation = 'gate';
            session.inventory = [];
            session.pendingChecks = [];
            session.pendingCheck = null;
            session.history.push({ id: 'opening', role: 'dm', text: 'A locked gate.', location: 'gate' });
            switchView('worldPlay');
            document.getElementById('modal-overlay')?.classList.add('hidden');
            renderWorldPlayState();
            const gate = world.locations.find(location => location.id === 'gate');
            const edge = gate.exits.find(exit => exit.targetLocationId === 'cellar');
            const originalExecute = executeWorldTurn;
            const originalRoll = rollSecureDie;
            executeWorldTurn = async () => {};
            const check = async roll => {
                rollSecureDie = () => roll;
                openWorldCheckModal();
                document.getElementById('world-check-label').value = 'Pick the watchtower gate lock';
                document.getElementById('world-check-stat').value = 'wits';
                document.getElementById('world-check-difficulty').value = '11';
                renderWorldCheckPreview();
                const preview = document.getElementById('world-check-preview').textContent;
                await resolveWorldCheckFromModal();
                return { preview, opened: worldExitRequirement(session, edge, 'gate').ok,
                    pending: session.pendingChecks.length,
                    history: session.checkHistory.slice(-1),
                    persisted: await HordeDB.get(`worldInstance:${world.id}`) };
            };
            const failed = await check(1);
            // The next player action is a new turn, not a reroll of the same
            // immutable check slot.
            session.turnCount++;
            const succeeded = await check(20);
            renderWorldPlayState();
            const exitButton = [...document.querySelectorAll('#world-exits-list button')]
                .find(item => item.textContent.includes('Tower Cellar'));
            const afterSuccess = {
                open: worldExitRequirement(session, edge, 'gate').ok,
                route: findWorldTravelPath(world, 'gate', 'cellar', { session }),
                disabled: exitButton?.disabled,
                savedOpen: succeeded.persisted?.sessions?.[0]?.unlockedExits?.['gate::cellar'] === true,
                message: session.history.at(-1)?.text || ''
            };
            const snapshot = captureWorldTurnState(world, session);
            session.unlockedExits = {};
            restoreWorldTurnState(world, session, snapshot);
            const rollbackRestored = worldExitRequirement(session, edge, 'gate').ok;
            executeWorldTurn = originalExecute;
            rollSecureDie = originalRoll;
            return {
                failed: { opened: failed.opened, preview: failed.preview,
                    roll: failed.history[0]?.roll,
                    savedOpen: failed.persisted?.sessions?.[0]?.unlockedExits?.['gate::cellar'] === true },
                succeeded: { roll: succeeded.history[0]?.roll, ...afterSuccess },
                rollbackRestored
            };
        }, fixture);
        assert.equal(result.failed.opened, false, 'a failed manual check cannot unlock');
        assert.equal(result.failed.savedOpen, false);
        assert.match(result.failed.preview, /On success.*Tower Cellar.*On failure.*locked/i);
        assert.equal(result.succeeded.open, true, 'a successful manual lock check opens the authored gate');
        assert.deepEqual(result.succeeded.route, ['gate', 'cellar']);
        assert.equal(result.succeeded.disabled, false);
        assert.equal(result.succeeded.savedOpen, true, 'the unlock persists in the saved instance');
        assert.match(result.succeeded.message, /gate.*cellar.*unlocked/i);
        assert.equal(result.rollbackRestored, true);
        assert.deepEqual(errors, []);
        console.log('PASS: manual gate check failure, success, UI route, save/reload and rollback');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
