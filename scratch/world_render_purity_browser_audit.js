/** Offline browser contract: drawing World Play cannot commit campaign state. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-render.test') return route.abort();
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
        await page.goto('https://world-render.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = {
                id: 'world_render_fixture', name: 'Render Fixture', startLocationId: 'start',
                intro: '', dmPrompt: 'Keep the scene grounded.',
                gameRules: { profileId: 'adventure' },
                hudConfig: { showClock: true, showQuests: true, showInventory: true, showDays: true,
                    stats: [{ id: 'hp', name: 'Health', value: 10, min: 0, max: 10 }] },
                presentation: { enabled: true, mode: 'cinematic' }, mediaAssets: [],
                locations: [{ id: 'start', name: 'Start', description: 'A sunny room.', exits: [] }],
                entities: []
            };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const session = prepareCurrentWorldSession();
            session.setupComplete = true;
            session.history.push({ id: 'opening', role: 'dm', text: 'You arrive.', location: 'start' });
            session.quests = [{ id: 'arrival', title: 'Arrive', status: 'active',
                objectives: [{ id: 'reach', text: 'Reach Start', type: 'location', target: 'start', required: 1, current: 0, status: 'active' }],
                rewards: { items: ['Map'] } }];
            normalizeQuestState(world, session);
            session.inventory = [{ id: 'coat', name: 'Coat', slot: 'body' }];
            normalizePlayerRulesState(world, session);
            switchView('worldPlay');
            let saveCount = 0;
            let failSave = false;
            const originalSave = saveWorldsState;
            saveWorldsState = async () => {
                saveCount++;
                if (failSave) throw new Error('fixture storage failure');
            };
            try {
                const beforeWorld = JSON.stringify(world);
                const beforeSession = JSON.stringify(session);
                renderWorldPlayState();
                const first = { worldUnchanged: JSON.stringify(world) === beforeWorld,
                    sessionUnchanged: JSON.stringify(session) === beforeSession,
                    saves: saveCount, questStillActive: session.quests[0].status === 'active',
                    rewardNotGranted: !session.inventory.some(item => String(item?.name || item) === 'Map') };
                const committed = evaluateQuestProgress(world, session);
                const afterCommit = JSON.stringify(session);
                renderWorldPlayState();
                const second = { changed: committed.changed, completed: session.quests[0].status === 'completed',
                    rewardGranted: session.quests[0].rewardsGranted,
                    sessionUnchanged: JSON.stringify(session) === afterCommit, saves: saveCount };
                const equipButton = document.querySelector('#world-inventory-list .inv-chip-equip');
                if (!equipButton) throw new Error('Equipment control did not render');
                equipButton.click();
                await new Promise(resolve => setTimeout(resolve, 0));
                const equipment = { canonicalItemEquipped: session.inventory[0].equipped === true,
                    canonicalSlot: session.equipment.body === session.inventory[0].id,
                    saves: saveCount };
                failSave = true;
                document.querySelector('#world-inventory-list .inv-chip-equip').click();
                await new Promise(resolve => setTimeout(resolve, 0));
                const equipRollback = { canonicalItemEquipped: session.inventory[0].equipped === true,
                    canonicalSlot: session.equipment.body === session.inventory[0].id,
                    saves: saveCount, unlocked: !worldMutationInProgress };
                const historyMessage = { turnSnapshot: { session: { playerLocation: 'elsewhere', quests: [] } },
                    postSnapshot: { session: { playerLocation: 'start', quests: [] } } };
                const worldBeforeHistory = JSON.stringify(world);
                worldVisibleTurnChanges(world, historyMessage);
                const historyReadOnly = JSON.stringify(world) === worldBeforeHistory;
                const weatherDisplay = document.getElementById('world-weather-display');
                weatherDisplay.click();
                const selector = weatherDisplay.querySelector('select');
                selector.value = selector.options[1].value;
                selector.dispatchEvent(new Event('change'));
                await new Promise(resolve => setTimeout(resolve, 0));
                const weatherRollback = { overrideRestored: !session.weatherOverride,
                    saves: saveCount, unlocked: !worldMutationInProgress };
                return { first, second, equipment, equipRollback, historyReadOnly, weatherRollback };
            } finally {
                saveWorldsState = originalSave;
            }
        });
        assert.deepEqual(result, {
            first: { worldUnchanged: true, sessionUnchanged: true, saves: 0,
                questStillActive: true, rewardNotGranted: true },
            second: { changed: true, completed: true, rewardGranted: true,
                sessionUnchanged: true, saves: 0 },
            equipment: { canonicalItemEquipped: true, canonicalSlot: true, saves: 1 },
            equipRollback: { canonicalItemEquipped: true, canonicalSlot: true, saves: 2, unlocked: true },
            historyReadOnly: true,
            weatherRollback: { overrideRestored: true, saves: 3, unlocked: true }
        });
        assert.deepEqual(errors, []);
        console.log('PASS: World Play renders without changing canon or saving; explicit quest evaluation commits once');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
