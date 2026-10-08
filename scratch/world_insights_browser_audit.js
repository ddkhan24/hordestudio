const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(process.env.HORDE_WORLD_INSIGHTS_ROOT || path.resolve(__dirname, '..'));

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-insights.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
            }
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-insights.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });

        const result = await page.evaluate(() => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = { id: 'insight_fixture', name: 'Insight Fixture', startLocationId: 'home',
                locations: [
                    { id: 'home', name: 'Home', description: 'Starting place.', exits: [] },
                    { id: 'market', name: 'Market', description: 'A market.', exits: [] },
                    { id: 'hidden', name: 'Secret Hideout', description: 'Not known to the player.', exits: [] }
                ],
                entities: [
                    { id: 'ada', type: 'npc', name: 'Ada', startLocation: 'home', description: 'A friend.' },
                    { id: 'bob', type: 'npc', name: 'Bob', startLocation: 'market', description: 'A merchant.' },
                    { id: 'unmet', type: 'npc', name: 'Unmet Secret', startLocation: 'hidden' }
                ],
                hudConfig: { startTimeHours: 8, stats: [], showClock: true, showQuests: true, showLedger: true } };
            const history = [];
            for (let i = 0; i < 320; i++) {
                history.push({ id: `u${i}`, role: 'user', text: `Player message ${i}`, location: 'home' });
                history.push({ id: `d${i}`, role: 'dm', text: `Scene number ${i}. Bob talks to Ada.`,
                    location: i === 0 ? 'market' : 'home', witnesses: i === 0 ? ['bob'] : ['ada'],
                    ledgerEntry: i === 0 ? 'Bob sold a map at the market.' : undefined,
                    worldAudit: i === 319 ? { turn: 320, accepted: 2, rejected: 1 } : undefined,
                    callAudit: i === 319 ? { foregroundTotal: 1, calls: [{ kind: 'main', model: 'fixture/model',
                        status: 200, durationMs: 5000, usage: { input: 101, output: 20, total: 121 } }] } : undefined,
                    stateSource: 'tool_call' });
            }
            const sess = { id: 'insight_timeline', name: 'Test', playerLocation: 'home', turnCount: 320,
                history, worldStateVersion: 320,
                worldTurnReceipts: [{ turn: 320, audit: { turn: 320, source: 'tool_call', world_state_version: 320,
                    accepted: 1, rejected: [{ type: 'movement', reason: 'missing_evidence', detail: 'No witness or route was supplied.' }] } }],
                turnEvents: [
                    { turn: 320, type: 'discovery', evidence: 'The player found a map.', committed: true },
                    { turn: 320, type: 'relationship', actor_id: 'ada', target_id: 'player',
                        evidence: 'She accepted the apology.', witnessed_by: ['player'], committed: true },
                    { turn: 320, type: 'relationship', actor_id: 'bob', target_id: 'ada',
                        evidence: 'A secret bargain.', witnessed_by: ['bob'], committed: true }
                ],
                entityStates: {
                    ada: { location: 'home', status: 'alive', goal: 'A private goal', disposition: 87 },
                    bob: { location: 'hidden', status: 'alive' },
                    unmet: { location: 'hidden', status: 'alive' }
                }, playerStats: {}, inventory: [], quests: [] };
            state.worlds = [world];
            state.worldInstances = { insight_fixture: { activeSessionId: sess.id, sessions: [sess] } };
            state.activeWorldId = world.id;
            document.getElementById('modal-overlay')?.classList.add('hidden');
            switchView('worldPlay');
            renderWorldPlayState();
            const container = document.getElementById('world-messages-container');
            const boundedInitial = container.querySelectorAll('[data-world-message-id]').length === 160
                && !!container.querySelector('[data-world-window-action="older"]');
            const initialFirstId = container.querySelector('[data-world-message-id]')?.dataset.worldMessageId;
            container.querySelector('[data-world-window-action="older"]')?.click();
            const olderLoaded = container.querySelectorAll('[data-world-message-id]').length <= 240
                && container.querySelector('[data-world-message-id]')?.dataset.worldMessageId !== initialFirstId
                && !!container.querySelector('[data-world-window-action="latest"]');
            container.querySelector('[data-world-window-action="latest"]')?.click();
            const latestRestored = container.querySelectorAll('[data-world-message-id]').length === 160
                && container.lastElementChild?.dataset.worldMessageId === 'd319';
            const first = container.children[0];
            const last = container.lastElementChild;
            container.scrollTop = Math.floor(container.scrollHeight / 2);
            const beforeScroll = container.scrollTop;
            const start = performance.now();
            renderWorldPlayState();
            const repeatMs = performance.now() - start;
            const stableNodes = first === container.children[0] && last === container.lastElementChild;
            const stableScroll = Math.abs(container.scrollTop - beforeScroll) < 2;
            const honestStorySize = document.getElementById('world-context-label').textContent.includes('tokens')
                && document.getElementById('world-context-label').title.includes('not billed usage');
            sess.history.push({ id: 'd320', role: 'dm', text: 'The next scene arrives.', location: 'home', witnesses: ['ada'] });
            renderWorldPlayState();
            // A reader intentionally above the bottom stays anchored; the new
            // scene must be reachable via Jump to latest, not forced onscreen.
            const appended = sess.history.at(-1)?.id === 'd320'
                && (container.lastElementChild?.dataset.worldMessageId === 'd320'
                    || !!container.querySelector('[data-world-window-action="latest"]'));
            const preservedAfterAppend = first === container.children[0] && Math.abs(container.scrollTop - beforeScroll) < 2;
            container.querySelector('[data-world-window-action="latest"]')?.click();
            const preRerollNode = container.lastElementChild;
            const lastMessage = sess.history[sess.history.length - 1];
            lastMessage.versions = ['The next scene arrives.', 'A different scene arrives.'];
            lastMessage.currentVersion = 1;
            lastMessage.text = lastMessage.versions[1];
            lastMessage.turnSnapshot = { session: { playerLocation: 'market', quests: [], revealedSecrets: [] } };
            lastMessage.postSnapshot = { session: { playerLocation: 'home',
                quests: [{ id: 'first_quest', title: 'Find the map', status: 'active' }], revealedSecrets: [] } };
            renderWorldPlayState();
            const rerollUpdated = container.lastElementChild !== preRerollNode
                && container.lastElementChild.textContent.includes('A different scene arrives.')
                && !!container.lastElementChild.querySelector('.reroll-nav')
                && first === container.children[0];
            setWorldStatusTab('people');
            const peopleText = document.getElementById('world-people-list').textContent;
            const bobCard = [...document.querySelectorAll('#world-people-list .world-insight-card')]
                .find(card => card.dataset.personId === 'bob');
            const peopleSafe = peopleText.includes('Ada') && peopleText.includes('Bob')
                && !peopleText.includes('Unmet Secret') && !peopleText.includes('Secret Hideout')
                && bobCard?.textContent.includes('Last seen at Market');
            openNpcDossier('ada');
            const directorDetails = document.querySelector('#npc-dossier-content .world-director-details');
            const privateByDefault = directorDetails && !directorDetails.open
                && document.getElementById('dossier-goal').getBoundingClientRect().height === 0;
            directorDetails.open = true;
            const controlsRetained = document.getElementById('dossier-goal').value === 'A private goal';
            document.getElementById('npc-dossier-overlay').classList.add('hidden');
            bobCard?.click();
            const jumped = container.querySelector('.world-message-highlight')?.dataset.worldMessageId === 'd0';
            setWorldStatusTab('history');
            const historyCount = document.getElementById('world-history-count').textContent;
            const publicChanges = document.querySelector('#world-history-list .world-insight-card')?.textContent.includes('Moved to Home')
                && document.querySelector('#world-history-list .world-insight-card')?.textContent.includes('Quest started: Find the map');
            const relationshipEvidence = document.getElementById('world-history-list').textContent.includes('Ada and you: She accepted the apology.')
                && !document.getElementById('world-history-list').textContent.includes('A secret bargain.');
            document.getElementById('world-history-older').click();
            const paged = document.getElementById('world-history-page').textContent === 'Page 2 of 17';
            setWorldStatusTab('director');
            const director = document.getElementById('world-director-receipts').textContent;
            const minds = document.getElementById('world-director-minds').textContent;
            const directorExplains = director.includes('1 committed') && director.includes('No witness or route was supplied.')
                && director.includes('The player found a map.') && director.includes('101 input')
                && director.includes('fixture/model') && minds.includes('A private goal');
            const snapshot = (place, payload = '') => ({ schema: 3,
                session: { playerLocation: place, quests: [], revealedSecrets: [], payload },
                world: { dynamicEntities: [], dynamicLocations: [] } });
            const compactHistory = Array.from({ length: 5 }, (_, index) => ({
                id: `compact_${index}`, role: 'dm', text: `Scene ${index}`, versions: [`Scene ${index}`],
                turnSnapshot: snapshot('market'), versionSnapshots: [snapshot('home', 'x'.repeat(100000))]
            }));
            compactHistory[2].versions.push('Alternate take');
            compactHistory[2].versionSnapshots.push(snapshot('market', 'y'.repeat(100000)));
            compactHistory[0].worldAudit = { turn: 320, version: 320 };
            const compactSession = { history: compactHistory, turnEvents: [{
                turn: 320, world_state_version: 320, type: 'relationship', committed: true,
                actor_id: 'ada', target_id: 'player', witnessed_by: ['player'],
                evidence: 'She accepted the apology.'
            }] };
            const beforeBytes = JSON.stringify(compactSession).length;
            const compactedCount = compactWorldHistorySnapshots(world, compactSession, { keepRecent: 2 });
            const compactVisible = worldVisibleTurnChanges(world, compactHistory[0]).includes('Moved to Home');
            compactSession.turnEvents = [];
            const evidenceRetained = worldVisibleTurnChanges(world, compactHistory[0])
                .includes('Ada and you: She accepted the apology.');
            const alternatePreserved = compactHistory[2].versionSnapshots.length === 2;
            const bytesSaved = beforeBytes - JSON.stringify(compactSession).length;
            ensureWorldRerollBaseSnapshot(compactHistory[0], snapshot('home'));
            const oldRerollRecovered = compactHistory[0].versionSnapshots[0].session.playerLocation === 'home';
            const snapshotCompaction = compactedCount === 2 && compactVisible && evidenceRetained && alternatePreserved
                && bytesSaved > 150000 && oldRerollRecovered;
            const oldSessionMessage = container.children[0];
            const other = { ...sess, id: 'other_timeline', name: 'Other', history: [
                { id: 'other-dm', role: 'dm', text: 'A different timeline.', location: 'home', witnesses: [] }
            ] };
            state.worldInstances.insight_fixture.sessions.push(other);
            state.worldInstances.insight_fixture.activeSessionId = other.id;
            renderWorldPlayState();
            const isolated = container.children.length === 1
                && container.firstElementChild !== oldSessionMessage
                && container.firstElementChild.dataset.worldMessageId === 'other-dm';
            return { boundedInitial, olderLoaded, latestRestored, stableNodes, stableScroll, honestStorySize, appended, preservedAfterAppend, rerollUpdated, peopleSafe, privateByDefault, controlsRetained, jumped, publicChanges, relationshipEvidence, directorExplains, snapshotCompaction,
                historyCount, paged, isolated, repeatMs };
        });
        for (const key of ['boundedInitial', 'olderLoaded', 'latestRestored', 'stableNodes', 'stableScroll', 'honestStorySize', 'appended', 'preservedAfterAppend', 'rerollUpdated',
            'peopleSafe', 'privateByDefault', 'controlsRetained', 'jumped', 'publicChanges', 'relationshipEvidence', 'directorExplains', 'snapshotCompaction', 'paged', 'isolated']) assert.equal(result[key], true, key);
        assert.equal(result.historyCount, '321');
        assert.deepEqual(errors, []);
        if (process.env.HORDE_WORLD_INSIGHTS_DIRECTOR_SCREENSHOT) {
            await page.evaluate(() => {
                state.worldInstances.insight_fixture.activeSessionId = 'insight_timeline';
                renderWorldPlayState();
                setWorldStatusTab('director');
            });
            await page.screenshot({ path: process.env.HORDE_WORLD_INSIGHTS_DIRECTOR_SCREENSHOT });
        }
        const desktopControls = await page.evaluate(() => {
            const button = document.getElementById('world-more-btn');
            const actions = document.getElementById('world-more-actions');
            const timelineButton = document.getElementById('world-timeline-btn');
            const timelineActions = document.getElementById('world-timeline-actions');
            const sidebar = document.querySelector('#world-play-view .world-status-col');
            const timelineInitiallyHidden = getComputedStyle(timelineActions).display === 'none';
            timelineButton.click();
            const timelineOpened = getComputedStyle(timelineActions).display !== 'none'
                && timelineButton.getAttribute('aria-expanded') === 'true';
            timelineActions.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const timelineClosedEscape = getComputedStyle(timelineActions).display === 'none'
                && timelineButton.getAttribute('aria-expanded') === 'false' && document.activeElement === timelineButton;
            const initiallyHidden = getComputedStyle(actions).display === 'none';
            button.click();
            const opened = getComputedStyle(actions).display !== 'none' && button.getAttribute('aria-expanded') === 'true';
            document.getElementById('world-messages-container').click();
            const closedOutside = getComputedStyle(actions).display === 'none' && button.getAttribute('aria-expanded') === 'false';
            button.click();
            actions.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const closedEscape = getComputedStyle(actions).display === 'none'
                && button.getAttribute('aria-expanded') === 'false' && document.activeElement === button;
            document.getElementById('world-hud-toggle').click();
            const hiddenHud = getComputedStyle(sidebar).display === 'none';
            document.getElementById('world-hud-toggle').click();
            return { timelineInitiallyHidden, timelineOpened, timelineClosedEscape, initiallyHidden, opened, closedOutside, closedEscape, hiddenHud, restoredHud: getComputedStyle(sidebar).display !== 'none' };
        });
        assert.deepEqual(desktopControls, { timelineInitiallyHidden: true, timelineOpened: true, timelineClosedEscape: true,
            initiallyHidden: true, opened: true, closedOutside: true, closedEscape: true, hiddenHud: true, restoredHud: true });
        if (process.env.HORDE_WORLD_INSIGHTS_DESKTOP_SCREENSHOT) {
            await page.screenshot({ path: process.env.HORDE_WORLD_INSIGHTS_DESKTOP_SCREENSHOT });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        const mobileHud = await page.evaluate(() => {
            enterWorld('insight_fixture');
            const sidebar = document.querySelector('#world-play-view .world-status-col');
            const button = document.getElementById('world-hud-toggle');
            const startsCollapsed = getComputedStyle(sidebar).display === 'none'
                && button.getAttribute('aria-expanded') === 'false';
            button.click();
            return { startsCollapsed, opens: getComputedStyle(sidebar).display !== 'none'
                && button.getAttribute('aria-expanded') === 'true' };
        });
        assert.deepEqual(mobileHud, { startsCollapsed: true, opens: true });
        await page.locator('[data-world-status-tab="people"]').click();
        const mobile = await page.evaluate(() => {
            const sidebar = document.querySelector('#world-play-view .world-status-col');
            const buttons = [...document.querySelectorAll('.world-status-tabs button')];
            return {
                tab: sidebar.dataset.tab,
                visible: buttons.every(button => {
                    const rect = button.getBoundingClientRect();
                    return rect.width >= 40 && rect.left >= 0 && rect.right <= innerWidth;
                }),
                searchFits: document.getElementById('world-people-search').getBoundingClientRect().right <= innerWidth,
                timelineFits: document.getElementById('world-timeline-btn').getBoundingClientRect().right <= innerWidth
            };
        });
        assert.deepEqual(mobile, { tab: 'people', visible: true, searchFits: true, timelineFits: true });
        if (process.env.HORDE_WORLD_INSIGHTS_MOBILE_SCREENSHOT) {
            await page.screenshot({ path: process.env.HORDE_WORLD_INSIGHTS_MOBILE_SCREENSHOT });
        }
        const guestPrivacy = await page.evaluate(() => {
            state.worldInstances.insight_fixture.activeSessionId = 'insight_timeline';
            renderWorldPlayState();
            setWorldStatusTab('director');
            const hadPrivateGoal = document.getElementById('world-director-minds').textContent.includes('A private goal');
            applyMultiplayerSnapshot({}, { worldName: 'Shared World', hud: {}, history: [] }, 'world');
            const view = document.getElementById('world-play-view');
            const directorButton = document.querySelector('[data-world-status-tab="director"]');
            setWorldStatusTab('director');
            return {
                hadPrivateGoal,
                guestMode: view.classList.contains('multiplayer-guest-view'),
                safeTab: document.querySelector('.world-status-col').dataset.tab === 'now',
                directorTabHidden: getComputedStyle(directorButton).display === 'none',
                timelineSelectorHidden: getComputedStyle(document.querySelector('.world-toolbar-primary .session-selector-wrap')).display === 'none',
                contextMeterHidden: getComputedStyle(document.getElementById('world-context-meter-wrap')).display === 'none',
                privateGoalCleared: !document.getElementById('world-director-minds').textContent.includes('A private goal'),
                peopleCleared: document.getElementById('world-people-list').textContent === ''
            };
        });
        assert.deepEqual(guestPrivacy, {
            hadPrivateGoal: true, guestMode: true, safeTab: true, directorTabHidden: true,
            timelineSelectorHidden: true, contextMeterHidden: true,
            privateGoalCleared: true, peopleCleared: true
        }, 'guest snapshots must redact private Director state');
        await page.setViewportSize({ width: 1280, height: 800 });
        const desktopGuestPrivacy = await page.evaluate(() => ({
            timelineSelectorHidden: getComputedStyle(document.querySelector('.world-toolbar-primary .session-selector-wrap')).display === 'none',
            contextMeterHidden: getComputedStyle(document.getElementById('world-context-meter-wrap')).display === 'none',
            directorTabHidden: getComputedStyle(document.querySelector('[data-world-status-tab="director"]')).display === 'none'
        }));
        assert.deepEqual(desktopGuestPrivacy, {
            timelineSelectorHidden: true, contextMeterHidden: true, directorTabHidden: true
        }, 'desktop guest view must hide host-only controls');
        if (process.env.HORDE_WORLD_INSIGHTS_SCREENSHOT) {
            await page.screenshot({ path: process.env.HORDE_WORLD_INSIGHTS_SCREENSHOT });
        }
        console.log(`PASS: Worlds insights, private cast, history pagination and 641-message transcript reconciliation (${result.repeatMs.toFixed(1)}ms repeat render)`);
        console.log('PASS: Worlds insight navigation and search remain usable at 390px');
        console.log('PASS: Shared-world guest view redacts private Director state');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
