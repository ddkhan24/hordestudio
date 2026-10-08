/** Offline browser check for scoped World writes and serialized revisions. */
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
            if (url.hostname !== 'worlds2-persistence.test') return route.abort();
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
        await page.goto('https://worlds2-persistence.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const initial = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const sentinel = [{ id: 'unrelated_chat', title: 'Keep this chat' }];
            await HordeDB.setMultiple({ chats: sentinel });
            state.chats = [];
            state.worlds.push({ id: 'worlds2_scoped_fixture', name: 'Scoped World', mediaAssets: [], locations: [], entities: [] });
            state.worldInstances.worlds2_scoped_fixture = { activeSessionId: 'timeline', sessions: [{ id: 'timeline', name: 'Timeline', history: [] }] };
            state.worlds.push({ id: 'worlds2_inactive_fixture', name: 'Inactive World', mediaAssets: [], locations: [], entities: [] });
            state.worldInstances.worlds2_inactive_fixture = { activeSessionId: 'other_timeline', sessions: [{ id: 'other_timeline', name: 'Other', history: [] }] };
            state.activeWorldId = 'worlds2_scoped_fixture';
            await saveWorldsState();
            const migrated = (await HordeDB.get('worldInstanceIndex'))?.length === 2
                && Object.keys(await HordeDB.get('worldInstances') || {}).length === 0
                && (await HordeDB.get('worldInstance:worlds2_inactive_fixture'))?.sessions?.length === 1;
            const untouched = (await HordeDB.get('chats'))?.[0]?.id === 'unrelated_chat';
            const realSetMultiple = HordeDB.setMultiple.bind(HordeDB);
            const scopedWrites = [];
            HordeDB.setMultiple = async records => {
                scopedWrites.push(Object.keys(records));
                return realSetMultiple(records);
            };
            state.worldInstances.worlds2_scoped_fixture.sessions[0].history.push({ id: 'turn_1', role: 'dm', text: 'First scene.' });
            const first = saveWorldsState();
            state.worldInstances.worlds2_scoped_fixture.sessions[0].history.push({ id: 'turn_2', role: 'user', text: 'Second turn.' });
            const second = saveWorldsState();
            await Promise.all([first, second]);
            const stored = await HordeDB.get('worldInstance:worlds2_scoped_fixture');
            const turns = stored.sessions[0].history.length;
            const activeOnly = scopedWrites.length > 0 && scopedWrites.every(keys =>
                keys.includes('worldInstance:worlds2_scoped_fixture')
                && !keys.includes('worldInstance:worlds2_inactive_fixture')
                && !keys.includes('worldInstances'));
            scopedWrites.length = 0;
            await saveState();
            const ordinarySaveAvoidsTimelineClones = scopedWrites.length > 0 && scopedWrites.every(keys =>
                !keys.some(key => key.startsWith('worldInstance:')) && !keys.includes('worldInstances'));
            scopedWrites.length = 0;
            await saveState({ allWorldInstances: true });
            const explicitFullFlushIncludesBoth = scopedWrites.some(keys =>
                keys.includes('worldInstance:worlds2_scoped_fixture')
                && keys.includes('worldInstance:worlds2_inactive_fixture'));
            scopedWrites.length = 0;
            state.worldInstances.worlds2_inactive_fixture.sessions[0].history.push({
                id: 'background_inactive', role: 'dm', text: 'An off-screen event finished after switching worlds.'
            });
            await saveWorldsState({ worldId: 'worlds2_inactive_fixture' });
            const inactiveBackgroundSaveIsTargeted = scopedWrites.some(keys =>
                keys.includes('worldInstance:worlds2_inactive_fixture')
                && !keys.includes('worldInstance:worlds2_scoped_fixture'))
                && scopedWrites.every(keys => !keys.includes('worldInstance:worlds2_scoped_fixture'));
            const activeWorld = state.worlds.find(world => world.id === 'worlds2_scoped_fixture');
            activeWorld.mediaAssets = [{ id: 'uncloneable-media-fixture', data: 1n }];
            await saveWorldsState();
            const mediaExcludedBeforeClone = (await HordeDB.get('worlds'))
                .find(world => world.id === activeWorld.id)?.mediaAssets?.length === 0;
            activeWorld.mediaAssets = [];
            const receiptWorld = { id: 'receipt_fixture', entities: [], locations: [] };
            const receiptSession = { id: 'receipt_timeline', name: 'Receipt timeline', history: [],
                worldStateVersion: 120,
                worldTurnReceipts: Array.from({ length: 120 }, (_, index) => ({
                    receipt: { turn_id: `receipt_${index + 1}`, note: 'x'.repeat(120) },
                    audit: { world_state_version: index + 1 }
                })) };
            const receiptSnapshot = captureWorldTurnState(receiptWorld, receiptSession);
            receiptSession.worldStateVersion = 121;
            receiptSession.worldTurnReceipts.push({ receipt: { turn_id: 'future' }, audit: { world_state_version: 121 } });
            restoreWorldTurnState(receiptWorld, receiptSession, receiptSnapshot);
            const receiptsRestoreWithoutCopyingHistory = receiptSnapshot.schema === 5
                && !Object.hasOwn(receiptSnapshot.session, 'worldTurnReceipts')
                && JSON.stringify(receiptSnapshot).length < 3000
                && receiptSession.worldTurnReceipts.length === 120
                && receiptSession.worldTurnReceipts.at(-1)?.receipt?.turn_id === 'receipt_120'
                && !receiptSession.worldTurnReceipts.some(item => item.receipt.turn_id === 'future');
            HordeDB.setMultiple = realSetMultiple;
            const makeSnapshot = marker => ({ schema: 3,
                session: { playerLocation: '', quests: [], revealedSecrets: [], marker: marker.repeat(60000) },
                world: { dynamicEntities: [], dynamicLocations: [] } });
            const session = state.worldInstances.worlds2_scoped_fixture.sessions[0];
            for (let index = 0; index < 5; index++) {
                session.history.push({ id: `snapshot_${index}`, role: 'dm', text: `Scene ${index}`,
                    versions: [`Scene ${index}`], currentVersion: 0,
                    turnSnapshot: makeSnapshot('a'), versionSnapshots: [makeSnapshot('b')] });
            }
            session.history[4].versions.push('Alternate scene');
            session.history[4].versionSnapshots.push(makeSnapshot('c'));
            const beforeBytes = JSON.stringify(session).length;
            const compacted = compactWorldHistorySnapshots(state.worlds.find(world => world.id === 'worlds2_scoped_fixture'), session, { keepRecent: 2 });
            await saveWorldsState();
            const rawShard = await new Promise((resolve, reject) => {
                const tx = HordeDB.db.transaction('state', 'readonly');
                const request = tx.objectStore('state').get('worldInstance:worlds2_scoped_fixture');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            return { untouched, migrated, activeOnly, ordinarySaveAvoidsTimelineClones,
                explicitFullFlushIncludesBoth, inactiveBackgroundSaveIsTargeted, mediaExcludedBeforeClone,
                receiptsRestoreWithoutCopyingHistory,
                compressedShard: rawShard?.$hordeWorldShard === 'gzip-json-v1'
                    && rawShard.blob instanceof Blob
                    && rawShard.blob.size < JSON.stringify(state.worldInstances.worlds2_scoped_fixture).length / 4,
                turns, compacted, bytesSaved: beforeBytes - JSON.stringify(session).length };
        });
        assert.equal(initial.untouched, true);
        assert.equal(initial.migrated, true);
        assert.equal(initial.activeOnly, true);
        assert.equal(initial.ordinarySaveAvoidsTimelineClones, true);
        assert.equal(initial.explicitFullFlushIncludesBoth, true);
        assert.equal(initial.inactiveBackgroundSaveIsTargeted, true);
        assert.equal(initial.mediaExcludedBeforeClone, true);
        assert.equal(initial.receiptsRestoreWithoutCopyingHistory, true);
        assert.equal(initial.compressedShard, true);
        assert.equal(initial.turns, 2);
        assert.equal(initial.compacted, 2);
        assert(initial.bytesSaved > 100000);
        await page.reload();
        await page.waitForFunction(() => state.activeWorldId === 'worlds2_scoped_fixture'
            && state.worldInstances?.worlds2_scoped_fixture?.sessions?.length, { timeout: 30000 });
        const reloaded = await page.evaluate(() => ({
            world: state.worlds.some(world => world.id === 'worlds2_scoped_fixture'),
            otherWorld: state.worldInstances?.worlds2_inactive_fixture?.sessions?.[0]?.history?.[0]?.id === 'background_inactive',
            turns: state.worldInstances.worlds2_scoped_fixture.sessions[0].history.length,
            compacted: state.worldInstances.worlds2_scoped_fixture.sessions[0].history[2].snapshotCompacted === true,
            alternateKept: state.worldInstances.worlds2_scoped_fixture.sessions[0].history[4].versionSnapshots.length === 2
        }));
        assert.deepEqual(reloaded, { world: true, otherWorld: true, turns: 7, compacted: true, alternateKept: true });
        // A one-time bundled-world upgrade repairs opening-scene presence.
        // Its timeline can be inactive, so the upgrade receipt and the repaired
        // shard must commit together; otherwise a reload permanently skips it.
        const bundledWorldId = await page.evaluate(async () => {
            const candidate = (globalThis.HORDE_INCLUDED_WORLDS || [])
                .find(world => world.bundledId === 'policy-panic-v4');
            const installed = state.worlds.find(world => world.id === candidate?.id);
            if (!candidate || !installed) throw new Error('Policy Panic bundle was not installed');
            installed.bundledId = 'policy-panic-v3';
            state.globalSettings.includedWorldReceipts = (state.globalSettings.includedWorldReceipts || [])
                .filter(receipt => receipt !== 'policy-panic-v4');
            state.worldInstances[installed.id] = {
                activeSessionId: 'inactive_opening_scene',
                sessions: [{
                    id: 'inactive_opening_scene', playerLocation: 'loc_reception', turnCount: 1,
                    entityStates: { npc_gloria: { location: 'loc_bullpen' } },
                    history: [{ id: 'opening', role: 'dm',
                        text: 'Gloria Bell stands beside you at the reception desk.' }]
                }]
            };
            state.activeWorldId = 'worlds2_scoped_fixture';
            await saveState({ allWorldInstances: true });
            return installed.id;
        });
        await page.reload();
        await page.waitForFunction(id => state.worlds.find(world => world.id === id)?.bundledId === 'policy-panic-v4',
            bundledWorldId, { timeout: 30000 });
        await page.waitForFunction(async id => !saveStateInFlight && !worldSaveInFlight
            && (await HordeDB.get(`worldInstance:${id}`))?.sessions?.[0]?.entityStates?.npc_gloria?.location === 'loc_reception',
            bundledWorldId, { timeout: 30000 });
        const upgradedInactive = await page.evaluate(async id => ({
            activeWorldId: state.activeWorldId,
            liveLocation: state.worldInstances?.[id]?.sessions?.[0]?.entityStates?.npc_gloria?.location,
            savedLocation: (await HordeDB.get(`worldInstance:${id}`))?.sessions?.[0]?.entityStates?.npc_gloria?.location,
            receipt: state.globalSettings.includedWorldReceipts?.includes('policy-panic-v4')
        }), bundledWorldId);
        assert.deepEqual(upgradedInactive, {
            activeWorldId: 'worlds2_scoped_fixture', liveLocation: 'loc_reception',
            savedLocation: 'loc_reception', receipt: true
        });
        await page.reload();
        await page.waitForFunction(id => state.worldInstances?.[id]?.sessions?.[0]?.entityStates?.npc_gloria?.location === 'loc_reception',
            bundledWorldId, { timeout: 30000 });
        assert.deepEqual(errors, []);
        console.log('PASS: scoped World saves, compacted history, and inactive bundled-world migration survive reload');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
