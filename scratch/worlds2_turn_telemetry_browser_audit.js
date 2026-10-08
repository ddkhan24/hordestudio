/** Offline end-to-end World turn with mocked chat-completions responses. */
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
            if (url.hostname !== 'worlds2-telemetry.test') return route.abort();
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
        await page.goto('https://worlds2-telemetry.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = { id: 'telemetry_fixture', name: 'Telemetry Fixture', model: 'fixture/model',
                dmPrompt: 'Narrate the scene.', intro: '', startLocationId: 'room',
                locations: [{ id: 'room', name: 'Room', description: 'A quiet room.', exits: [] }],
                entities: [], hudConfig: { showClock: true, showQuests: false, showLedger: true, stats: [] },
                kernel: { enabled: true, memoryMode: 'ledger', resolveFirst: false, sceneDrafts: false } };
            state.worlds = [world];
            state.worldInstances = { telemetry_fixture: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.history.push({ id: 'opening', role: 'dm', text: 'You enter the room.', location: 'room' });
            switchView('worldPlay');
            renderWorldPlayState();
            const receipt = { summary: 'No lasting world change.',
                scene: { player_location_id: 'room', player_location_changed: false, present_character_ids: [] },
                events: [], entity_updates: [], state_updates: {} };
            const reply = `The lamp hums softly.\n<world_turn_receipt>${JSON.stringify(receipt)}</world_turn_receipt>`;
            let modelCalls = 0;
            let mode = 'inline';
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                modelCalls++;
                const body = JSON.parse(options.body || '{}');
                if (mode === 'failed') return new Response('provider unavailable', { status: 503 });
                if (mode === 'streamBreak' && body.stream) {
                    return new Response(new ReadableStream({ start(controller) { controller.error(new Error('stream interrupted')); } }),
                        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                if (mode === 'toolFallback' && body.tools) return new Response('tool use not supported', { status: 400 });
                if (body.stream) {
                    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: mode === 'empty' ? '' : mode === 'repair' ? 'The door stays shut.' : reply }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 51, completion_tokens: 18, total_tokens: 69 } })}\n\ndata: [DONE]\n\n`;
                    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                const content = mode === 'empty' && Number(body.max_tokens) >= 1500
                    ? 'The lights flicker, then settle.' : JSON.stringify(receipt);
                return new Response(JSON.stringify({ choices: [{ message: { content } }],
                    usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 } }),
                { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            document.getElementById('world-user-input').value = 'I wait and listen.';
            await executeWorldTurn();
            const firstDm = [...sess.history].reverse().find(message => message.role === 'dm');
            mode = 'repair';
            document.getElementById('world-user-input').value = 'I leave the room.';
            await executeWorldTurn();
            const secondDm = [...sess.history].reverse().find(message => message.role === 'dm');
            mode = 'toolFallback';
            document.getElementById('world-user-input').value = 'I speak quietly.';
            await executeWorldTurn();
            const thirdDm = [...sess.history].reverse().find(message => message.role === 'dm');
            mode = 'empty';
            document.getElementById('world-user-input').value = 'I knock on the wall.';
            await executeWorldTurn();
            const dm = [...sess.history].reverse().find(message => message.role === 'dm');
            const persisted = (await HordeDB.get('worldInstance:telemetry_fixture'))?.sessions?.[0]?.history?.at(-1)?.callAudit || null;
            const firstSnapshotCompacted = firstDm.snapshotCompacted === true && !firstDm.versionSnapshots;
            // Mirror deleting the later user turn: restore its DM's pre-turn
            // state, trim the tail, then reroll the formerly compacted scene.
            const laterTurnIndex = sess.history.findIndex(message => message.role === 'user' && message.text === 'I leave the room.');
            restoreWorldTurnState(world, sess, secondDm.turnSnapshot);
            sess.history.splice(laterTurnIndex);
            sess.auditMarker = 'original-post-state';
            firstDm.location = 'old-take-room';
            firstDm.witnesses = ['old-take-witness'];
            firstDm.worldAudit = { ...firstDm.worldAudit, rejected: 42 };
            firstDm.stateSource = 'old-take-state';
            renderWorldPlayState();
            mode = 'toolFallback';
            await executeWorldTurn(true);
            const reroll = {
                versions: firstDm.versions.length,
                snapshots: firstDm.versionSnapshots?.length,
                originalMarker: firstDm.versionSnapshots?.[0]?.session?.auditMarker,
                latestCalls: firstDm.callAudit?.calls?.map(call => call.kind),
                originalCalls: firstDm.versionCallAudits?.[0]?.calls?.map(call => call.kind),
                alternateCalls: firstDm.versionCallAudits?.[1]?.calls?.map(call => call.kind),
                latestLocation: firstDm.location,
                latestWitnesses: firstDm.witnesses,
                latestRejections: firstDm.worldAudit?.rejected,
                latestStateSource: firstDm.stateSource
            };
            const priorTakeButton = [...document.querySelectorAll('#world-messages-container .prev-ver')].at(-1);
            if (priorTakeButton) await priorTakeButton.onclick();
            reroll.selectedVersionAfterSwitch = firstDm.currentVersion;
            reroll.selectedCallsAfterSwitch = firstDm.callAudit?.calls?.map(call => call.kind);
            reroll.selectedLocationAfterSwitch = firstDm.location;
            reroll.selectedWitnessesAfterSwitch = firstDm.witnesses;
            reroll.selectedRejectionsAfterSwitch = firstDm.worldAudit?.rejected;
            reroll.selectedStateSourceAfterSwitch = firstDm.stateSource;
            const savedReroll = (await HordeDB.get('worldInstance:telemetry_fixture'))?.sessions?.[0]?.history
                ?.find(message => message.id === firstDm.id);
            reroll.savedTakes = savedReroll?.versionCallAudits?.length;
            reroll.savedSelection = savedReroll?.currentVersion;
            mode = 'failed';
            document.getElementById('world-user-input').value = 'I try again.';
            await executeWorldTurn();
            const failure = {
                count: sess.worldCallDiagnostics?.length || 0,
                status: sess.worldCallDiagnostics?.at(-1)?.calls?.[0]?.status,
                inSnapshot: Object.hasOwn(captureWorldTurnState(world, sess).session, 'worldCallDiagnostics'),
                persisted: (await HordeDB.get('worldInstance:telemetry_fixture'))?.sessions?.[0]?.worldCallDiagnostics?.at(-1)?.calls?.[0]?.status
            };
            mode = 'streamBreak';
            document.getElementById('world-user-input').value = 'I retry after the stream breaks.';
            await executeWorldTurn();
            failure.interruptedStatus = sess.worldCallDiagnostics?.at(-1)?.calls?.[0]?.status;
            failure.interruptedCount = sess.worldCallDiagnostics?.length;
            failure.streamingBubbleRemoved = !document.querySelector('#world-messages-container .msg-dm .msg-text:empty');
            setWorldStatusTab('director');
            renderWorldDirectorPanel(world, sess);
            const modelLedger = {
                attempts: sess.worldModelAttempts?.length || 0,
                total: sess.worldModelTotals?.attempts || 0,
                failed: sess.worldModelAttempts?.some(item => item.status === 503 && item.outcome === 'http_error'),
                interrupted: sess.worldModelAttempts?.some(item => item.status === 200 && item.outcome === 'stream_error'),
                inSnapshot: Object.hasOwn(captureWorldTurnState(world, sess).session, 'worldModelAttempts'),
                persisted: (await HordeDB.get('worldInstance:telemetry_fixture'))?.sessions?.[0]?.worldModelTotals?.attempts,
                summary: document.getElementById('world-director-model-summary')?.textContent || '',
                details: document.getElementById('world-director-model-attempts')?.textContent || ''
            };
            window.fetch = realFetch;
            return { modelCalls, firstText: firstDm?.text || '', firstAudit: firstDm?.callAudit || null,
                secondText: secondDm?.text || '', secondAudit: secondDm?.callAudit || null,
                thirdText: thirdDm?.text || '', thirdAudit: thirdDm?.callAudit || null,
                fourthText: dm?.text || '', fourthAudit: dm?.callAudit || null,
                persisted, firstSnapshotCompacted, reroll, failure, modelLedger };
        });
        assert(result.modelCalls >= 8, 'normal, repair, fallback and empty-reply rescue requests should occur');
        assert(result.firstText.includes('The lamp hums softly.'), 'the first World turn should complete');
        assert(result.secondText.includes('The door stays shut.'), 'the repaired World turn should complete');
        assert.equal(result.firstAudit.calls[0].kind, 'main');
        assert.equal(result.firstAudit.calls[0].status, 200);
        assert.equal(result.firstAudit.calls[0].usage.input, 51);
        assert.equal(result.firstAudit.calls[0].usage.output, 18);
        assert(result.firstAudit.calls[0].durationMs >= 0);
        assert(result.secondAudit.calls.some(call => call.kind === 'receiptRepair' && call.usage?.total === 35));
        assert(result.secondAudit.receiptRepair >= 1);
        assert(result.thirdText.includes('The lamp hums softly.'));
        assert.equal(result.thirdAudit.providerFallback, 1);
        assert(result.thirdAudit.calls.some(call => call.kind === 'main' && call.status === 400));
        assert(result.thirdAudit.calls.some(call => call.kind === 'providerFallback' && call.status === 200));
        assert(result.fourthText.includes('The lights flicker, then settle.'));
        assert.equal(result.fourthAudit.narrativeRescue, 1);
        assert(result.fourthAudit.calls.some(call => call.kind === 'narrativeRescue' && call.usage?.total === 35));
        assert(result.persisted.calls.some(call => call.kind === 'narrativeRescue' && call.usage?.total === 35));
        assert.equal(result.firstSnapshotCompacted, true);
        assert.equal(result.reroll.versions, 2);
        assert.equal(result.reroll.snapshots, 2);
        assert.equal(result.reroll.originalMarker, 'original-post-state');
        assert(result.reroll.latestCalls.includes('providerFallback'), JSON.stringify(result.reroll));
        assert.deepEqual(result.reroll.originalCalls, ['main']);
        assert(result.reroll.alternateCalls.includes('providerFallback'));
        assert.equal(result.reroll.latestLocation, 'room');
        assert.deepEqual(result.reroll.latestWitnesses, []);
        assert.notEqual(result.reroll.latestRejections, 42);
        assert.notEqual(result.reroll.latestStateSource, 'old-take-state');
        assert.equal(result.reroll.selectedVersionAfterSwitch, 0);
        assert.deepEqual(result.reroll.selectedCallsAfterSwitch, ['main']);
        assert.equal(result.reroll.selectedLocationAfterSwitch, 'old-take-room');
        assert.deepEqual(result.reroll.selectedWitnessesAfterSwitch, ['old-take-witness']);
        assert.equal(result.reroll.selectedRejectionsAfterSwitch, 42);
        assert.equal(result.reroll.selectedStateSourceAfterSwitch, 'old-take-state');
        assert.equal(result.reroll.savedTakes, 2);
        assert.equal(result.reroll.savedSelection, 0);
        assert.equal(result.failure.count, 1);
        assert.equal(result.failure.status, 503);
        assert.equal(result.failure.persisted, 503);
        assert.equal(result.failure.inSnapshot, false);
        assert.equal(result.failure.interruptedStatus, 200);
        assert.equal(result.failure.interruptedCount, 2);
        assert.equal(result.failure.streamingBubbleRemoved, true);
        assert(result.modelLedger.attempts >= result.modelCalls, JSON.stringify(result.modelLedger));
        assert.equal(result.modelLedger.total, result.modelLedger.attempts);
        assert.equal(result.modelLedger.failed, true);
        assert.equal(result.modelLedger.interrupted, true);
        assert.equal(result.modelLedger.inSnapshot, false);
        assert.equal(result.modelLedger.persisted, result.modelLedger.total);
        assert(result.modelLedger.summary.includes('unknown cost'));
        assert(result.modelLedger.details.includes('stream_error'));
        assert.deepEqual(errors, []);
        console.log(`PASS: mocked World turns persist main, repair, fallback and empty-reply rescue diagnostics (${result.modelCalls} model endpoint calls across 4 completed turns, 1 reroll, 2 failed turns)`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
