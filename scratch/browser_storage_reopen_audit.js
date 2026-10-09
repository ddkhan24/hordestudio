'use strict';

// Regression for an IndexedDB handle that closes while Horde Studio remains
// open. All cases use disposable browser profiles and an isolated test origin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('./app_source.js');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const packageSource = fs.readFileSync(path.join(__dirname, '../human-package.js'), 'utf8');
const archiveSource = fs.readFileSync(path.join(__dirname, '../large-archive.js'), 'utf8');
const vhIntegration = fs.readFileSync(path.join(__dirname, '../virtual_humans/frontend/vh2-horde-integration.js'), 'utf8');
const storageStart = app.indexOf('const HordeDB = {');
assert(storageStart !== -1, 'HordeDB source was not found');
const storageEnd = app.indexOf('\n};', storageStart);
assert(storageEnd !== -1, 'HordeDB source was not terminated');
const storageSource = app.slice(storageStart, storageEnd + 3);
const backupUiStart = app.indexOf('function redactGlobalSettingsCredentials(settings) {');
const backupUiEnd = app.indexOf('function hasUnsettledCompanionWork()', backupUiStart);
assert(backupUiStart !== -1 && backupUiEnd !== -1, 'Storage recovery UI source was not found');
const backupUiSource = app.slice(backupUiStart, backupUiEnd);
const vhSaveStart = app.indexOf('async function saveVirtualHumansState(options = {}) {');
const vhSaveEnd = app.indexOf('function saveCompanionTemplatesState()', vhSaveStart);
assert(vhSaveStart !== -1 && vhSaveEnd !== -1, 'Virtual Human save source was not found');
const vhSaveSource = app.slice(vhSaveStart, vhSaveEnd);
const purgeStart = app.indexOf('function purgeAllData() {');
const purgeEnd = app.indexOf('function showGlobalSettings()', purgeStart);
assert(purgeStart !== -1 && purgeEnd !== -1, 'Purge source was not found');
const purgeSource = app.slice(purgeStart, purgeEnd);
const vhEnqueueStart = vhIntegration.indexOf('const vh2EnqueueLocks=new Map();');
const vhEnqueueEnd = vhIntegration.indexOf('async function vh2Poll(', vhEnqueueStart);
const vhReconcileStart = vhIntegration.indexOf('function vh2MessageMatchesConversation(');
const vhReconcileEnd = vhIntegration.indexOf('function vh2ImageStudioFingerprint(', vhReconcileStart);
assert(vhEnqueueStart !== -1 && vhEnqueueEnd !== -1 && vhReconcileStart !== -1 && vhReconcileEnd !== -1,
    'VH2 enqueue or message-reconciliation source was not found');
const vhEnqueueSource = vhIntegration.slice(vhEnqueueStart, vhEnqueueEnd);
const vhReconcileSource = vhIntegration.slice(vhReconcileStart, vhReconcileEnd);
const origin = 'https://horde-storage-reopen.test/';
const source = `const DB_NAME = 'HordeStorageReopenAudit';
    const DB_VERSION = 2;
    const STORE_NAME = 'state';
    ${storageSource}
    window.storage = HordeDB;
    window.storageFailureReports = [];
    window.showStorageFailureBanner = error => storageFailureReports.push(error.message);
    window.clearStorageFailureBanner = () => {};`;
const uiSource = `
    function safeJsonClone(value) { return JSON.parse(JSON.stringify(value)); }
    function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
    const state = {
        globalSettings: { localApiKey: 'must-not-export' },
        characters: [{ id: 'unsaved-character', name: 'Work in memory' }],
        chats: { draft: [{ role: 'user', text: 'Unsaved conversation turn' }] },
        chatContinuities: {}, activeSessionId: null, personas: [], activePersonaId: null,
        rooms: [], theme: 'dark', systemPresets: [], regexScripts: [], worlds: [],
        worldInstances: {}, worldRecoverySnapshots: {}, activeWorldId: null,
        videoWorlds: [], videoWorldSessions: {}, activeVideoWorldId: null,
        companions: [], companionThreads: {},
        companionTimelines: { test: { sessions: [{ vh2: {
            hostId: 'private-server', running: true, autoReplies: true,
            outbox: [{ id: 'pending' }]
        } }] } }, activeCompanionId: null
    };
    function persistCompanionRuntime() {}
    let HordeLargeArchive = { pack: async payload => {
        window.capturedEmergencyPayload = payload;
        return new Blob([JSON.stringify(payload)], { type: 'application/json' });
    } };
    window.toastEvents = [];
    function showToast(message, type) { toastEvents.push({ message, type }); }
    let saveStateQueued = true, saveStateInFlight = null;
    let worldSaveQueued = false, worldSaveInFlight = null;
    let virtualHumanSaveScope = null, virtualHumanSaveInFlight = null;
    async function saveState() {
        await storage.setMultiple({ chats: state.chats, characters: state.characters });
        saveStateQueued = false;
    }
    async function saveWorldsState() { throw Error('Unexpected Worlds save'); }
    async function saveVirtualHumansState() { throw Error('Unexpected Virtual Human save'); }
    ${backupUiSource}
    HTMLAnchorElement.prototype.click = function () {
        window.emergencyDownload = { name: this.download, href: this.href };
    };
`;
const vhUiSource = `
    const timeline = { id: 'vh-storage-failure', vh2: { worldId: 'fixture-world', outbox: [] }, messages: [] };
    window.timeline = timeline;
    state.view = 'companionChat';
    state.companionTimelines = { test: { sessions: [timeline] } };
    saveStateQueued = false;
    virtualHumanSaveScope = 0;
    document.body.insertAdjacentHTML('beforeend', '<div id="fixture-thread"></div>');
    function normalizeCompanionMessage(raw) { return { ...raw }; }
    function getActiveCompanionTimeline() { return timeline; }
    function renderCompanionThread() {
        document.getElementById('fixture-thread').textContent = timeline.messages.map(message => message.text).join('\\n');
    }
    window.vhRequestPaths = [];
    async function vh2Request(_timeline, path) {
        vhRequestPaths.push(path);
        if (path.startsWith('/vh2/projection?')) return { revision: 1 };
        if (path === '/vh2/command' && window.injectTerminalCommandFailure) {
            storage.db.close();
            window.originalOpenBeforeTerminal = indexedDB.open;
            indexedDB.open = () => { throw new DOMException('Second write failed', 'UnknownError'); };
            const error = Error('Invalid command');
            error.status = 400;
            throw error;
        }
        return { worldId: 'fixture-world' };
    }
    saveVirtualHumansState = async () => {
        virtualHumanSaveScope = 2;
        await storage.setMultiple({ companionTimelines: state.companionTimelines });
        virtualHumanSaveScope = 0;
    };
    ${vhEnqueueSource}
    ${vhReconcileSource}
`;

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        async function isolatedCase(run) {
            const context = await browser.newContext();
            await context.route(`${origin}**`, route => route.fulfill({
                contentType: 'text/html', body: '<!doctype html><title>Storage reopen audit</title>'
            }));
            async function rawPage() {
                const page = await context.newPage();
                await page.goto(origin);
                return page;
            }
            async function client() {
                const page = await rawPage();
                await page.addScriptTag({ content: packageSource });
                await page.addScriptTag({ content: source });
                await page.evaluate(() => storage.init());
                return page;
            }
            try { await run(client, rawPage); }
            finally { await context.close(); }
        }

        await isolatedCase(async (client, rawPage) => {
            const seed = await rawPage();
            await seed.evaluate(async () => {
                const db = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('HordeStorageReopenAudit', 1);
                    request.onupgradeneeded = () => request.result.createObjectStore('state');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction('state', 'readwrite');
                    const store = transaction.objectStore('state');
                    store.put(7, 'stateRevision');
                    store.put({ name: 'Legacy project', turns: [1, 2] }, 'project');
                    store.put({ human: { sessions: [{ messages: [{ text: 'Saved in v1' }] }] } },
                        'companionTimelines');
                    transaction.oncomplete = resolve;
                    transaction.onerror = transaction.onabort = () => reject(transaction.error);
                });
                db.close();
            });
            const upgraded = await client();
            const result = await upgraded.evaluate(async () => {
                const identity = storage.identity;
                const before = {
                    version: storage.db.version, revision: storage.revision,
                    project: await storage.get('project'),
                    timeline: await storage.get('companionTimelines')
                };
                storage.db.close();
                const recovered = await storage.get('project');
                await storage.setMultiple({ project: { ...recovered, turns: [1, 2, 3] } });
                return { identity, before, recovered, recoveredIdentity: storage.identity,
                    finalRevision: storage.revision };
            });
            assert.equal(result.before.version, 2);
            assert.equal(result.before.revision, 7);
            assert.equal(typeof result.identity, 'string');
            assert(result.identity.length > 0);
            assert.deepEqual(result.before.project, { name: 'Legacy project', turns: [1, 2] });
            assert.equal(result.before.timeline.human.sessions[0].messages[0].text, 'Saved in v1');
            assert.deepEqual(result.recovered, result.before.project);
            assert.equal(result.recoveredIdentity, result.identity);
            assert.equal(result.finalRevision, 8);
            const secondPage = await client();
            assert.deepEqual(await secondPage.evaluate(() => storage.get('project')),
                { name: 'Legacy project', turns: [1, 2, 3] });
            console.log('PASS: v1 data upgrades to v2 with identity and survives later forced-close recovery');
        });

        await isolatedCase(async client => {
            const page = await client();
            const result = await page.evaluate(async () => {
                await storage.setMultiple({ project: { name: 'Keep my work', turns: [1] } });
                const oldHandle = storage.db;
                oldHandle.close(); // Simulate a closed handle, not HordeDB.close().
                const before = await storage.get('project');
                await storage.setMultiple({ project: { ...before, turns: [1, 2] } });
                return { before, reopened: storage.db !== oldHandle, revision: storage.revision };
            });
            assert.deepEqual(result.before, { name: 'Keep my work', turns: [1] });
            assert.equal(result.reopened, true);
            assert.equal(result.revision, 2);
            const secondPage = await client();
            assert.deepEqual(await secondPage.evaluate(() => storage.get('project')),
                { name: 'Keep my work', turns: [1, 2] });
            console.log('PASS: closed handle reopens for reads and writes; a fresh tab sees durable work');
        });

        await isolatedCase(async client => {
            const page = await client();
            const result = await page.evaluate(async () => {
                await storage.setMultiple({ project: { name: 'Saved before outage' } });
                const unsavedInMemory = { name: 'Still held in memory' };
                storage.db.close();
                const originalOpen = indexedDB.open;
                indexedDB.open = () => { throw new DOMException('Browser storage unavailable', 'UnknownError'); };
                let failure;
                try { await storage.setMultiple({ project: unsavedInMemory }); }
                catch (error) { failure = { name: error.name, message: error.message }; }
                finally { indexedDB.open = originalOpen; }
                const retained = unsavedInMemory.name;
                await storage.setMultiple({ project: unsavedInMemory });
                return { failure, retained, failureReports: storageFailureReports.length,
                    recovered: storage.storageError === null };
            });
            assert.equal(result.failure?.name, 'UnknownError');
            assert.equal(result.retained, 'Still held in memory');
            assert(result.failureReports >= 1, 'A failed reconnect must surface a storage warning');
            assert.equal(result.recovered, true);
            const secondPage = await client();
            assert.deepEqual(await secondPage.evaluate(() => storage.get('project')),
                { name: 'Still held in memory' });
            console.log('PASS: failed reopen warns without losing memory; later retry saves durably');
        });

        await isolatedCase(async client => {
            const page = await client();
            await page.addScriptTag({ content: uiSource });
            const result = await page.evaluate(async () => {
                saveStateQueued = false;
                storage.db.close();
                const originalOpen = indexedDB.open;
                indexedDB.open = () => { throw new DOMException('Cache write unavailable', 'UnknownError'); };
                let failure;
                try { await storage.set('embedding_cache', { unsaved: 'cache work' }); }
                catch (error) { failure = error.name; }
                finally { indexedDB.open = originalOpen; }
                await storage.ensureOpen();
                await new Promise(resolve => setTimeout(resolve, 0));
                return { failure, unresolved: storage.unresolvedWriteFailure,
                    saved: await storage.get('embedding_cache'),
                    banner: document.getElementById('storage-failure-banner')?.innerText };
            });
            assert.equal(result.failure, 'UnknownError');
            assert.equal(result.unresolved, true);
            assert.equal(result.saved, undefined);
            assert.match(result.banner, /previous write failed/i);
            const banner = page.locator('#storage-failure-banner');
            await banner.getByRole('button', { name: 'Retry saving' }).click();
            assert.equal(await banner.count(), 1, 'Retry cannot dismiss an unreplayed direct write');
            assert.equal(await page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }), true, 'Unresolved write warning must guard against accidental tab close');
            console.log('PASS: failed direct write keeps warning visible after successful reopen and empty retry');
        });

        await isolatedCase(async client => {
            const page = await client();
            await page.addScriptTag({ content: uiSource });
            await page.addScriptTag({ content: vhSaveSource });
            const result = await page.evaluate(async () => {
                state.companionTimelines.test.sessions[0].messages = [
                    { role: 'user', text: 'Do not lose this VH turn' }
                ];
                const originalSet = storage.setMultiple.bind(storage);
                let writes = 0;
                storage.setMultiple = async (...args) => { writes++; return originalSet(...args); };
                const older = Promise.reject(Error('Older full save failed'));
                older.catch(() => {});
                saveStateInFlight = older;
                let failure;
                try { await saveVirtualHumansState(); }
                catch (error) { failure = error.message; }
                const scopeAfterFailure = virtualHumanSaveScope;
                const inFlightAfterFailure = virtualHumanSaveInFlight;
                const writesAfterFailure = writes;
                saveStateInFlight = null;
                await saveVirtualHumansState();
                storage.setMultiple = originalSet;
                return { failure, scopeAfterFailure, inFlightAfterFailure,
                    writesAfterFailure, writesAfterRetry: writes,
                    finalScope: virtualHumanSaveScope };
            });
            assert.deepEqual(result, { failure: 'Older full save failed', scopeAfterFailure: 2,
                inFlightAfterFailure: null, writesAfterFailure: 0, writesAfterRetry: 1, finalScope: 0 });
            const secondPage = await client();
            const saved = await secondPage.evaluate(() => storage.get('companionTimelines'));
            assert.equal(saved.test.sessions[0].messages[0].text, 'Do not lose this VH turn');
            console.log('PASS: failed overlapping full save preserves VH retry scope and later persists the turn');
        });

        await isolatedCase(async client => {
            const page = await client();
            await page.addScriptTag({ content: uiSource });
            await page.addScriptTag({ content: archiveSource });
            await page.evaluate(() => { HordeLargeArchive = window.HordeLargeArchive; });
            await page.evaluate(async () => {
                await storage.setMultiple({ chats: { draft: [] } });
                storage.db.close();
                const originalOpen = indexedDB.open;
                indexedDB.open = () => { throw new DOMException('Storage is unavailable', 'UnknownError'); };
                try { await storage.setMultiple({ chats: state.chats }); }
                catch { /* The persistent warning is asserted below. */ }
                finally { indexedDB.open = originalOpen; }
            });
            const banner = page.locator('#storage-failure-banner');
            assert.equal(await banner.count(), 1);
            assert.equal(await banner.getAttribute('role'), 'alert');
            assert.match(await banner.innerText(), /saving is paused.*keep this tab open/is);
            assert.match(await banner.innerText(), /may omit separately stored media/i);
            await banner.getByRole('button', { name: 'Export emergency memory copy' }).click();
            await page.waitForFunction(() => !!window.emergencyDownload);
            const exported = await page.evaluate(async () => ({
                payload: await window.HordeLargeArchive.unpack(
                    await (await fetch(emergencyDownload.href)).blob(), 'full-backup'),
                name: emergencyDownload.name
            }));
            assert.match(exported.name, /EMERGENCY_memory_.*\.hordebackup$/);
            assert.equal(exported.payload._format, 'horde-studio-backup');
            assert.equal(exported.payload._emergencyMemoryOnly.omittedChatAssets, true);
            assert.equal(exported.payload._emergencyMemoryOnly.omittedVirtualHumanServiceLives, true);
            assert.equal(exported.payload.globalSettings.localApiKey, undefined);
            assert.equal(exported.payload.chats.draft[0].text, 'Unsaved conversation turn');
            assert.equal(exported.payload.companionTimelines.test.sessions[0].vh2.hostId, undefined);
            assert.equal(exported.payload.companionTimelines.test.sessions[0].vh2.running, false);
            assert.equal(await banner.count(), 1, 'Export must not dismiss the save-failure warning');
            await banner.getByRole('button', { name: 'Retry saving' }).click();
            await page.waitForFunction(() => saveStateQueued === false);
            assert.equal(await banner.count(), 1,
                'A previously failed direct write must remain visible after queued state is saved');
            const secondPage = await client();
            assert.deepEqual(await secondPage.evaluate(() => storage.get('chats')),
                { draft: [{ role: 'user', text: 'Unsaved conversation turn' }] });
            console.log('PASS: real emergency archive, manual queued-save retry, and unresolved-write warning');
        });

        await isolatedCase(async client => {
            const page = await client();
            await page.addScriptTag({ content: uiSource });
            await page.addScriptTag({ content: archiveSource });
            await page.evaluate(() => {
                HordeLargeArchive = window.HordeLargeArchive;
                state.chats.draft[0].text = 'Text when export began';
                window.packGate = new Promise(resolve => { window.releasePack = resolve; });
                const originalPack = HordeLargeArchive.pack;
                HordeLargeArchive.pack = async (...args) => {
                    window.archivePackStarted = true;
                    await window.packGate;
                    return originalPack(...args);
                };
                window.exportTask = exportEmergencyMemoryBackup();
            });
            await page.waitForFunction(() => window.archivePackStarted === true);
            await page.evaluate(() => {
                state.chats.draft[0].text = 'Text added while archive was pending';
                window.releasePack();
            });
            const result = await page.evaluate(async () => {
                await window.exportTask;
                const blob = await (await fetch(emergencyDownload.href)).blob();
                const archive = await window.HordeLargeArchive.unpack(blob, 'full-backup');
                return { archived: archive.chats.draft[0].text,
                    live: state.chats.draft[0].text, format: archive._format };
            });
            assert.deepEqual(result, { archived: 'Text when export began',
                live: 'Text added while archive was pending', format: 'horde-studio-backup' });
            console.log('PASS: delayed emergency archive keeps a coherent pre-mutation memory snapshot');
        });

        await isolatedCase(async client => {
            const page = await client();
            await page.addScriptTag({ content: uiSource });
            await page.evaluate(async () => {
                await storage.setMultiple({ chats: { draft: [] } });
                const originalSave = saveState;
                window.saveGate = new Promise(resolve => { window.releaseQueuedSave = resolve; });
                saveState = async () => {
                    window.queuedSaveStarted = true;
                    await window.saveGate;
                    return originalSave();
                };
                const closedHandle = storage.db;
                closedHandle.close();
                showStorageFailureBanner(Error('Browser closed the storage connection'));
                // IDBDatabase.close() does not dispatch close; synthesize the
                // browser's unexpected-close callback after making it unusable.
                closedHandle.onclose(new Event('close'));
            });
            await page.waitForFunction(() => window.queuedSaveStarted === true);
            const warning = page.locator('#storage-failure-banner');
            assert.equal(await warning.count(), 1, 'Reopening alone must not clear the warning');
            assert.equal(await page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }), true, 'Pending recovery save must guard against accidental tab close');
            assert.deepEqual(await page.evaluate(() => storage.get('chats')), { draft: [] });
            await page.evaluate(() => window.releaseQueuedSave());
            await warning.waitFor({ state: 'detached' });
            assert.equal(await page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }), false, 'Verified save must remove the tab-close warning');
            const secondPage = await client();
            assert.deepEqual(await secondPage.evaluate(() => storage.get('chats')),
                { draft: [{ role: 'user', text: 'Unsaved conversation turn' }] });
            console.log('PASS: browser close callback reopens proactively; warning clears only after queued write commits');
        });

        await isolatedCase(async client => {
            const page = await client();
            await page.addScriptTag({ content: uiSource });
            await page.evaluate(async () => {
                saveStateQueued = false;
                await storage.setMultiple({ project: { name: 'Saved before stale handle' } });
                window.staleHandle = storage.db;
                staleHandle.close();
                // close() leaves storage.db pointing at the closing handle and
                // does not dispatch onclose. An open-ref check is insufficient.
                showStorageFailureBanner(Error('Verify the storage connection'));
            });
            const warning = page.locator('#storage-failure-banner');
            assert.equal(await warning.count(), 1);
            await warning.getByRole('button', { name: 'Retry saving' }).click();
            await warning.waitFor({ state: 'detached' });
            const result = await page.evaluate(async () => ({
                reopened: storage.db !== staleHandle,
                project: await storage.get('project'),
                unloadGuard: (() => {
                    const event = new Event('beforeunload', { cancelable: true });
                    window.dispatchEvent(event);
                    return event.defaultPrevented;
                })()
            }));
            assert.deepEqual(result, { reopened: true,
                project: { name: 'Saved before stale handle' }, unloadGuard: false });
            console.log('PASS: Retry verifies a real transaction on a newly opened DB before clearing warning');
        });

        await isolatedCase(async client => {
            const page = await client();
            await page.addScriptTag({ content: uiSource });
            await page.addScriptTag({ content: vhUiSource });
            const result = await page.evaluate(async () => {
                storage.db.close();
                const originalOpen = indexedDB.open;
                indexedDB.open = () => { throw new DOMException('VH save unavailable', 'UnknownError'); };
                let failure;
                try { await vh2Enqueue(timeline, 'receive_message', { text: 'Keep my unsent message' }); }
                catch (error) { failure = error.name; }
                finally { indexedDB.open = originalOpen; }
                await vh2Flush(timeline);
                vh2ReconcileProjectionMessages({}, timeline, [], new Set());
                renderCompanionThread();
                const message = timeline.messages.at(-1);
                return { failure, outbox: timeline.vh2.outbox.length,
                    text: message?.text, deliveryState: message?.deliveryState,
                    awaitingReply: message?.awaitingReply, sent: vhRequestPaths.length };
            });
            assert.deepEqual(result, { failure: 'UnknownError', outbox: 0,
                text: 'Keep my unsent message', deliveryState: 'failed',
                awaitingReply: false, sent: 0 });
            assert.match(await page.locator('#fixture-thread').innerText(), /Keep my unsent message/);
            const banner = page.locator('#storage-failure-banner');
            assert.equal(await banner.count(), 1);
            await banner.getByRole('button', { name: 'Export emergency memory copy' }).click();
            await page.waitForFunction(() => !!window.capturedEmergencyPayload);
            const exported = await page.evaluate(() => capturedEmergencyPayload.companionTimelines.test.sessions[0].messages[0]);
            assert.equal(exported.text, 'Keep my unsent message');
            assert.equal(exported.deliveryState, 'failed');
            assert.equal(exported.awaitingReply, false);
            console.log('PASS: failed VH2 enqueue leaves visible, emergency-exportable text but no command or send');
        });

        await isolatedCase(async client => {
            const page = await client();
            await page.addScriptTag({ content: uiSource });
            await page.addScriptTag({ content: vhUiSource });
            const result = await page.evaluate(async () => {
                await vh2Enqueue(timeline, 'receive_message', { text: 'Provider rejects this turn' });
                window.injectTerminalCommandFailure = true;
                let failure;
                try { await vh2Flush(timeline); }
                catch (error) { failure = error.name; }
                finally { indexedDB.open = window.originalOpenBeforeTerminal; }
                await vh2Flush(timeline); // Removed terminal command must not send again.
                return { failure, outbox: timeline.vh2.outbox.length,
                    deliveryState: timeline.messages[0].deliveryState,
                    awaitingReply: timeline.messages[0].awaitingReply,
                    commandCalls: vhRequestPaths.filter(path => path === '/vh2/command').length };
            });
            assert.deepEqual(result, { failure: 'UnknownError', outbox: 0,
                deliveryState: 'failed', awaitingReply: false, commandCalls: 1 });
            const banner = page.locator('#storage-failure-banner');
            assert.equal(await banner.count(), 1);
            assert.match(await banner.innerText(), /saving is paused.*keep this tab open/is);
            await banner.getByRole('button', { name: 'Retry saving' }).click();
            await page.waitForFunction(() => virtualHumanSaveScope === 0);
            assert.equal(await banner.count(), 1,
                'A failed second write must remain visible after retrying the queued VH snapshot');
            const secondPage = await client();
            const saved = await secondPage.evaluate(() => storage.get('companionTimelines'));
            assert.equal(saved.test.sessions[0].messages[0].deliveryState, 'failed');
            assert.equal(saved.test.sessions[0].vh2.outbox.length, 0);
            console.log('PASS: failed terminal-command second write keeps warning until retry saves failed receipt');
        });

        await isolatedCase(async client => {
            const page = await client();
            const result = await page.evaluate(async () => {
                await storage.setMultiple({ project: { turns: [1] } });
                const oldHandle = storage.db;
                // close() leaves this already-started transaction valid, but
                // rejects any new transaction on the same connection.
                const transaction = oldHandle.transaction('state', 'readwrite');
                const complete = new Promise((resolve, reject) => {
                    transaction.oncomplete = resolve;
                    transaction.onerror = transaction.onabort = () => reject(transaction.error);
                });
                transaction.objectStore('state').put('survives-close', 'probe');
                oldHandle.close();
                await complete;
                let openCalls = 0;
                const originalOpen = indexedDB.open;
                indexedDB.open = function (...args) {
                    openCalls++;
                    return originalOpen.apply(this, args);
                };
                let project, probe;
                try {
                    [project, probe] = await Promise.all([
                        storage.get('project'), storage.get('probe')
                    ]);
                    await Promise.all([
                        storage.setMultiple({ project: { turns: [1, 2] } }),
                        storage.setMultiple({ note: 'queued after close' })
                    ]);
                } finally {
                    indexedDB.open = originalOpen;
                }
                return { project, probe, reopened: storage.db !== oldHandle,
                    finalRevision: storage.revision, openCalls };
            });
            assert.deepEqual(result, {
                project: { turns: [1] }, probe: 'survives-close',
                reopened: true, finalRevision: 3, openCalls: 1
            });
            const secondPage = await client();
            assert.deepEqual(await secondPage.evaluate(async () => ({
                project: await storage.get('project'), note: await storage.get('note'),
                probe: await storage.get('probe')
            })), { project: { turns: [1, 2] }, note: 'queued after close', probe: 'survives-close' });
            console.log('PASS: close during a transaction preserves its commit and concurrent callers share recovery');
        });

        await isolatedCase(async client => {
            const page = await client();
            const result = await page.evaluate(async () => {
                await storage.setMultiple({ project: { name: 'Original' } });
                const oldRevision = storage.revision;
                const unsavedInMemory = { name: 'Do not overwrite a replacement database' };
                storage.db.close();
                await new Promise((resolve, reject) => {
                    const request = indexedDB.deleteDatabase('HordeStorageReopenAudit');
                    request.onsuccess = resolve;
                    request.onerror = () => reject(request.error);
                    request.onblocked = () => reject(new Error('Old connection blocked deletion'));
                });
                // Reuse the old revision deliberately. Revision comparison
                // alone cannot distinguish this new database from the lost one.
                const replacement = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('HordeStorageReopenAudit', 2);
                    request.onupgradeneeded = () => request.result.createObjectStore('state');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                await new Promise((resolve, reject) => {
                    const transaction = replacement.transaction('state', 'readwrite');
                    transaction.objectStore('state').put(oldRevision, 'stateRevision');
                    transaction.oncomplete = resolve;
                    transaction.onerror = transaction.onabort = () => reject(transaction.error);
                });
                replacement.close();
                let failure;
                try { await storage.setMultiple({ project: unsavedInMemory }); }
                catch (error) { failure = { code: error.code, name: error.name }; }
                const check = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('HordeStorageReopenAudit', 2);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                const persisted = await new Promise((resolve, reject) => {
                    const transaction = check.transaction('state', 'readonly');
                    const request = transaction.objectStore('state').get('project');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                check.close();
                return { failure, conflicted: storage.conflicted,
                    memory: unsavedInMemory.name, persisted };
            });
            assert.equal(result.failure?.code, 'STATE_CONFLICT');
            assert.equal(result.conflicted, true);
            assert.equal(result.memory, 'Do not overwrite a replacement database');
            assert.equal(result.persisted, undefined);
            console.log('PASS: deleted/recreated DB with matching revision cannot absorb unsaved memory');
        });

        await isolatedCase(async client => {
            const page = await client();
            const result = await page.evaluate(async () => {
                await storage.setMultiple({ project: { name: 'Original' } });
                storage.db.close();
                await new Promise((resolve, reject) => {
                    const request = indexedDB.deleteDatabase('HordeStorageReopenAudit');
                    request.onsuccess = resolve;
                    request.onerror = () => reject(request.error);
                    request.onblocked = () => reject(new Error('Old connection blocked deletion'));
                });
                const before = (await indexedDB.databases()).some(db => db.name === 'HordeStorageReopenAudit');
                let failure;
                try { await storage.setMultiple({ project: { name: 'Unsaved memory' } }); }
                catch (error) { failure = { code: error.code, message: error.message }; }
                const after = (await indexedDB.databases()).some(db => db.name === 'HordeStorageReopenAudit');
                return { before, after, failure, conflicted: storage.conflicted };
            });
            assert.equal(result.before, false);
            assert.equal(result.failure?.code, 'STATE_CONFLICT');
            assert.equal(result.conflicted, true);
            assert.equal(result.after, false, 'Recovery must not silently recreate a missing database');
            console.log('PASS: missing DB is not silently recreated by recovery');
        });

        await isolatedCase(async client => {
            const first = await client();
            const stale = await client();
            await first.evaluate(() => storage.setMultiple({ project: { owner: 'first' } }));
            const outcome = await stale.evaluate(async () => {
                storage.db.close();
                try { await storage.setMultiple({ project: { owner: 'stale' } }); }
                catch (error) { return { code: error.code, conflicted: storage.conflicted }; }
                return { code: 'SAVED' };
            });
            assert.deepEqual(outcome, { code: 'STATE_CONFLICT', conflicted: true });
            assert.deepEqual(await first.evaluate(() => storage.get('project')), { owner: 'first' });
            console.log('PASS: reconnect does not bypass cross-tab revision conflicts');
        });

        await isolatedCase(async client => {
            const purging = await client();
            const blocker = await client();
            await purging.addScriptTag({ content: uiSource });
            await purging.addScriptTag({ content: `
                window.chatTurnInProgress = false;
                window.generationController = null;
                window.worldTurnInProgress = false;
                window.worldMutationInProgress = false;
                function hasUnsettledCompanionWork() { return false; }
                function showConfirmModal(_title, _message, confirmed) {
                    window.purgeTask = Promise.resolve().then(confirmed);
                }
                ${purgeSource}
            ` });
            await blocker.evaluate(() => {
                localStorage.setItem('purge-marker', 'must-survive-until-success');
                // Hold the old connection open after deleteDatabase sends its
                // versionchange request, so deletion enters the blocked state.
                storage.db.onversionchange = () => { window.purgeBlockedOtherTab = true; };
            });
            await purging.evaluate(() => purgeAllData());
            await purging.waitForFunction(() => document.getElementById('storage-failure-banner')
                ?.textContent.includes('Data deletion is waiting'));
            assert.equal(await blocker.evaluate(() => localStorage.getItem('purge-marker')),
                'must-survive-until-success');
            assert.equal(await purging.evaluate(() => toastEvents.some(event => /Purge failed/.test(event.message))), false);
            await blocker.evaluate(() => storage.db.close());
            await blocker.waitForFunction(() => localStorage.getItem('purge-marker') === null);
            const dbExists = await blocker.evaluate(async () => (await indexedDB.databases())
                .some(db => db.name === 'HordeStorageReopenAudit'));
            assert.equal(dbExists, false);
            console.log('PASS: blocked purge stays pending; local data clears only after actual database deletion');
        });
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
