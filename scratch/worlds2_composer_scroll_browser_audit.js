/** Browser regression: reading a long World transcript and composing a turn must not jump or submit twice. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-composer-scroll.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-composer-scroll.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined'
            && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline-browser-fixture';
            const world = { id: 'world_composer_scroll', name: 'Long Transcript',
                model: 'fixture/offline', dmPrompt: 'Narrate.', intro: '', startLocationId: 'room',
                locations: [{ id: 'room', name: 'Room', description: 'A quiet room.', exits: [] }],
                entities: [], hudConfig: { stats: [] }, gameRules: { profileId: 'pure_narrative' },
                kernel: { enabled: true, memoryMode: 'ledger' }, worldAgent: { enabled: false },
                presentation: { enabled: true, mode: 'cinematic' }, mediaAssets: [] };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const session = prepareCurrentWorldSession();
            session.setupComplete = true;
            for (let index = 0; index < 300; index++) session.history.push({
                id: `history_${index}`, role: index % 2 ? 'user' : 'dm',
                text: `History ${index}: the same long room remains familiar and unchanged. `.repeat(3),
                location: 'room'
            });
            document.getElementById('modal-overlay')?.classList.add('hidden');
            switchView('worldPlay');
            renderWorldPlayState();
            const container = document.getElementById('world-messages-container');
            const initialRendered = container.querySelectorAll('[data-world-message-id]').length;
            container.scrollTop = container.scrollHeight - container.clientHeight - 30;
            const scrollBefore = container.scrollTop;
            container.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, bubbles: true }));
            renderWorldPlayState();
            const nearBottomScrollAfter = container.scrollTop;
            const followedAfterWheel = worldMessageWindow.followLatest;
            const anchor = [...container.children].find(node => node.dataset.worldMessageId
                && node.getBoundingClientRect().bottom > container.getBoundingClientRect().top);
            const anchorId = anchor?.dataset.worldMessageId;
            const anchorTop = anchor?.getBoundingClientRect().top;
            session.history.push({ id: 'background_300', role: 'dm',
                text: 'A background notice arrives while you read.', location: 'room' });
            renderWorldPlayState();
            const stillAnchored = [...container.children].find(node => node.dataset.worldMessageId === anchorId);
            const anchoredDelta = stillAnchored ? Math.abs(stillAnchored.getBoundingClientRect().top - anchorTop) : Infinity;
            const latestAvailable = !!container.querySelector('[data-world-window-action="latest"]');
            container.querySelector('[data-world-window-action="latest"]')?.click();
            const latestVisible = !!container.querySelector('[data-world-message-id="background_300"]');
            const atLatest = container.scrollHeight - container.scrollTop - container.clientHeight < 4;
            container.scrollTop = container.scrollHeight - container.clientHeight - 30;
            container.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, bubbles: true }));
            container.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }));
            container.scrollTop = container.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, 0));
            const resumedByUserScroll = worldMessageWindow.followLatest && !worldMessageWindow.manualBrowse;
            const oldWindowOpened = jumpToWorldMessage('history_20')
                && worldMessageWindow.end < session.history.length;

            let modelCalls = 0;
            const nativeFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return nativeFetch(url, options);
                modelCalls++;
                await new Promise(resolve => setTimeout(resolve, 20));
                const receipt = { summary: 'No lasting change.',
                    scene: { player_location_id: 'room', player_location_changed: false,
                        present_character_ids: [] },
                    events: [], entity_updates: [], state_updates: {} };
                if (!JSON.parse(options.body || '{}').stream) return new Response(JSON.stringify({
                    choices: [{ message: { content: JSON.stringify(receipt) } }]
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                const text = `The room stays quiet.\n<world_turn_receipt>${JSON.stringify(receipt)}</world_turn_receipt>`;
                return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
            };
            const input = document.getElementById('world-user-input');
            input.value = 'Unfinished composition';
            input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', isComposing: true, bubbles: true, cancelable: true
            }));
            const compositionBlocked = !worldTurnInProgress
                && input.value === 'Unfinished composition' && modelCalls === 0;
            const safariCompositionEnter = new KeyboardEvent('keydown', {
                key: 'Enter', bubbles: true, cancelable: true
            });
            Object.defineProperty(safariCompositionEnter, 'keyCode', { value: 229 });
            input.dispatchEvent(safariCompositionEnter);
            const safariCompositionBlocked = !worldTurnInProgress
                && input.value === 'Unfinished composition' && modelCalls === 0;
            input.value = 'One deliberate action';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            const stopLabel = document.getElementById('world-send-btn').getAttribute('aria-label');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            const repeatedEnter = new KeyboardEvent('keydown', {
                key: 'Enter', repeat: true, bubbles: true, cancelable: true
            });
            input.dispatchEvent(repeatedEnter);
            const repeatedEnterPrevented = repeatedEnter.defaultPrevented;
            const start = performance.now();
            while (worldTurnInProgress && performance.now() - start < 15000) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            const userActions = session.history.filter(message => message.role === 'user'
                && message.text === 'One deliberate action').length;
            const latestScene = session.history.at(-1)?.role === 'dm'
                && session.history.at(-1)?.text?.includes('room stays quiet');
            const submittedTurnVisible = !![...container.querySelectorAll('[data-world-message-id]')]
                .find(node => node.dataset.worldMessageId === session.history.at(-1)?.id);
            const submittedTurnAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 4;
            const sendLabel = document.getElementById('world-send-btn').getAttribute('aria-label');
            return { initialRendered, scrollBefore, nearBottomScrollAfter,
                followedAfterWheel, anchoredDelta, latestAvailable, latestVisible, atLatest,
                resumedByUserScroll, oldWindowOpened, compositionBlocked, safariCompositionBlocked,
                repeatedEnterPrevented, userActions, latestScene, submittedTurnVisible, submittedTurnAtBottom,
                modelCalls, stopLabel, sendLabel,
                turnUnlocked: !worldTurnInProgress };
        });
        assert(result.initialRendered <= 240, `unbounded transcript: ${JSON.stringify(result)}`);
        assert(Math.abs(result.nearBottomScrollAfter - result.scrollBefore) <= 3,
            `reader was snapped to the bottom: ${JSON.stringify(result)}`);
        assert.equal(result.followedAfterWheel, false, 'deliberate upward wheel must detach live follow');
        assert(result.anchoredDelta <= 3, `background scene moved the reading anchor: ${JSON.stringify(result)}`);
        assert.equal(result.latestAvailable, true);
        assert.equal(result.latestVisible, true);
        assert.equal(result.atLatest, true);
        assert.equal(result.resumedByUserScroll, true, 'returning to the bottom should restore live follow');
        assert.equal(result.oldWindowOpened, true, 'could not open older transcript history');
        assert.equal(result.compositionBlocked, true, 'IME Enter submitted an unfinished action');
        assert.equal(result.safariCompositionBlocked, true, 'Safari IME Enter submitted an unfinished action');
        assert.equal(result.repeatedEnterPrevented, true, 'key repeat inserted a stray newline during generation');
        assert.equal(result.userActions, 1, `one Enter action committed ${result.userActions} times`);
        assert.equal(result.latestScene, true);
        assert.equal(result.submittedTurnVisible, true, 'submitting while reading history did not show the new turn');
        assert.equal(result.submittedTurnAtBottom, true, 'submitting while reading history did not return to latest');
        assert.equal(result.stopLabel, 'Stop generation');
        assert.equal(result.sendLabel, 'Send message');
        assert.equal(result.turnUnlocked, true);
        assert.deepEqual(errors, []);
        console.log(`PASS: World transcript stays anchored and bounded; IME and repeated Enter do not submit duplicate turns (${result.modelCalls} offline calls)`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
