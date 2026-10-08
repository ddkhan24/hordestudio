/** Upgrade a real v1 combined World record, including an interrupted write. */
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
            if (url.hostname !== 'worlds2-migration.test') return route.abort();
            if (url.pathname === '/preseed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>v1 seed</title>' });
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://worlds2-migration.test/preseed');
        await page.evaluate(async () => {
            const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('HordeStudioDB', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('state');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            await new Promise((resolve, reject) => {
                const tx = db.transaction('state', 'readwrite');
                const store = tx.objectStore('state');
                store.put(0, 'stateRevision');
                store.put([{ id: 'legacy_a', name: 'Legacy A', locations: [{ id: 'room', name: 'Room', exits: [] }], entities: [] },
                    { id: 'legacy_b', name: 'Legacy B', locations: [{ id: 'room', name: 'Room', exits: [] }], entities: [] }], 'worlds');
                store.put({
                    legacy_a: { activeSessionId: 'timeline_a', sessions: [{ id: 'timeline_a', name: 'A', playerLocation: 'room', history: [{ id: 'a1', role: 'dm', text: 'A legacy scene.' }] }] },
                    legacy_b: { activeSessionId: 'timeline_b', sessions: [{ id: 'timeline_b', name: 'B', playerLocation: 'room', history: [{ id: 'b1', role: 'dm', text: 'Another legacy scene.' }] }] }
                }, 'worldInstances');
                store.put('legacy_a', 'activeWorldId');
                tx.oncomplete = resolve;
                tx.onerror = tx.onabort = () => reject(tx.error);
            });
            db.close();
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://worlds2-migration.test/');
        await page.waitForFunction(() => state.worldInstances?.legacy_a?.sessions?.[0]?.history?.length === 1, { timeout: 30000 });
        await page.waitForFunction(() => !saveStateInFlight && !worldSaveInFlight, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const openedV2 = HordeDB.db.version === 2;
            const migratedOnStartup = Array.isArray(await HordeDB.get('worldInstanceIndex'));
            // Startup may perform a legitimate full-state save for bundled
            // defaults, migrating v1 immediately. Recreate legacy storage in
            // this isolated test DB to exercise an interrupted migration.
            await HordeDB.setMultiple({ worldInstances: safeJsonClone(state.worldInstances) });
            await HordeDB.delete('worldInstanceIndex');
            persistedWorldInstanceIds = null;
            const legacyBefore = await HordeDB.get('worldInstances');
            // A BigInt is neither JSON serializable (compressed shards) nor
            // cloneable by the legacy JSON backup path. A function would be
            // silently dropped by JSON.stringify, so it cannot exercise an
            // interrupted migration across both storage formats.
            state.worldInstances.legacy_b.bad = 1n;
            let failed = false;
            try { await saveWorldsState(); } catch { failed = true; }
            delete state.worldInstances.legacy_b.bad;
            const legacyAfterFailure = await HordeDB.get('worldInstances');
            const noIndexAfterFailure = (await HordeDB.get('worldInstanceIndex')) == null;
            await saveWorldsState();
            const index = await HordeDB.get('worldInstanceIndex');
            const shardA = await HordeDB.get('worldInstance:legacy_a');
            const shardB = await HordeDB.get('worldInstance:legacy_b');
            const clearedLegacy = Object.keys(await HordeDB.get('worldInstances') || {}).length === 0;
            const olderBuildBlocked = await new Promise(resolve => {
                const request = indexedDB.open('HordeStudioDB', 1);
                request.onsuccess = () => { request.result.close(); resolve(false); };
                request.onerror = () => resolve(request.error?.name === 'VersionError');
            });
            return { openedV2, migratedOnStartup, failed, legacyIntact: legacyBefore.legacy_b.sessions[0].history[0].text
                    === legacyAfterFailure.legacy_b.sessions[0].history[0].text,
                noIndexAfterFailure, index, clearedLegacy, olderBuildBlocked,
                shardA: shardA?.sessions?.[0]?.history?.[0]?.text,
                shardB: shardB?.sessions?.[0]?.history?.[0]?.text };
        });
        if (!result.failed) console.error('Migration failure diagnostic:', result);
        assert.equal(result.openedV2, true);
        assert.equal(result.migratedOnStartup, true);
        assert.equal(result.failed, true);
        assert.equal(result.legacyIntact, true);
        assert.equal(result.noIndexAfterFailure, true);
        assert.deepEqual(result.index, ['legacy_a', 'legacy_b']);
        assert.equal(result.clearedLegacy, true);
        assert.equal(result.olderBuildBlocked, true);
        assert.equal(result.shardA, 'A legacy scene.');
        assert.equal(result.shardB, 'Another legacy scene.');
        await page.waitForFunction(() => !saveStateInFlight && !worldSaveInFlight, { timeout: 30000 });
        const lowSpace = await page.evaluate(async () => {
            await HordeDB.setMultiple({ worldInstances: safeJsonClone(state.worldInstances) });
            await HordeDB.delete('worldInstanceIndex');
            persistedWorldInstanceIds = null;
            worldMigrationDeferred = false;
            const original = HordeDB.setMultiple.bind(HordeDB);
            let migrationAttempts = 0;
            HordeDB.setMultiple = async records => {
                if (Object.hasOwn(records, 'worldInstanceIndex')) {
                    migrationAttempts++;
                    throw Object.assign(new Error('Not enough space for both copies'), { name: 'QuotaExceededError' });
                }
                return original(records);
            };
            try {
                state.worldInstances.legacy_b.sessions[0].history.push({ id: 'low_1', role: 'user', text: 'First low-space turn.' });
                await saveWorldsState();
                state.worldInstances.legacy_b.sessions[0].history.push({ id: 'low_2', role: 'dm', text: 'Second low-space turn.' });
                await saveWorldsState();
                return {
                    migrationAttempts,
                    deferred: worldMigrationDeferred,
                    noPartialIndex: (await HordeDB.get('worldInstanceIndex')) == null,
                    legacyTurns: (await HordeDB.get('worldInstances'))?.legacy_b?.sessions?.[0]?.history?.length
                };
            } finally { HordeDB.setMultiple = original; }
        });
        assert.deepEqual(lowSpace, { migrationAttempts: 1, deferred: true, noPartialIndex: true, legacyTurns: 3 });
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.legacy_b?.sessions?.[0]?.history?.length === 3, { timeout: 30000 });
        assert.deepEqual(errors, []);
        console.log('PASS: v1 Worlds migrate atomically; failed or low-space upgrade preserves turns, reload restores both, downgrade is blocked');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
