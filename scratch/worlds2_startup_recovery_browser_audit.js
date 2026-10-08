/** A damaged World shard must leave a usable full-backup recovery path. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
globalThis.HordeHumanPackage = require('../human-package.js');
const Archive = require('../large-archive.js');

function serve(context) {
    return context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'worlds2-startup-recovery.test') return route.abort();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return route.fulfill({ status: 404, body: '' });
        }
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
    });
}

async function ready(page) {
    await page.goto('https://worlds2-startup-recovery.test/');
    await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
    await page.evaluate(async () => {
        clearInterval(companionAgencyTimer);
        clearInterval(companionAlwaysOnTimer);
        await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
    });
}

function fixtureWorld(id, name) {
    return { id, name, intro: '', startLocationId: 'room',
        locations: [{ id: 'room', name: 'Room', description: 'A quiet room.', exits: [] }],
        entities: [], mediaAssets: [] };
}

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const cleanWorld = fixtureWorld('restored_world', 'Restored World');
        const backup = await Archive.pack({
            _format: 'horde-studio-backup', _version: 1, _exportedAt: new Date().toISOString(),
            vh2Checkpoints: [], globalSettings: {}, characters: [], chats: {}, chatContinuities: {},
            activeSessionId: {}, personas: [], activePersonaId: null, rooms: [], systemPresets: [],
            regexScripts: [], worlds: [cleanWorld], worldRecoverySnapshots: {},
            worldInstances: { [cleanWorld.id]: { activeSessionId: 'restored_timeline', sessions: [{
                id: 'restored_timeline', name: 'Saved timeline', playerLocation: 'room',
                history: [{ id: 'saved_scene', role: 'dm', text: 'This scene survived the backup.' }]
            }] } }, activeWorldId: cleanWorld.id,
            videoWorlds: [], videoWorldSessions: {}, activeVideoWorldId: null,
            companions: [], companionThreads: {}, companionTimelines: {}, activeCompanionId: null,
            companionVideoAssets: {}, chatAssets: {}
        }, 'full-backup');
        const backupBytes = Buffer.from(await backup.arrayBuffer());
        assert.equal(backupBytes.subarray(0, 4).toString('hex'), '504b0304');

        const damagedContext = await browser.newContext({ acceptDownloads: true });
        await serve(damagedContext);
        const damaged = await damagedContext.newPage();
        await ready(damaged);
        const corruptWorld = fixtureWorld('corrupt_world', 'Corrupt World');
        const before = await damaged.evaluate(async world => {
            state.worlds = [world];
            state.worldInstances = { [world.id]: { activeSessionId: 'corrupt_timeline', sessions: [{
                id: 'corrupt_timeline', name: 'Broken timeline', playerLocation: 'room',
                history: [{ id: 'broken_scene', role: 'dm', text: 'The old scene.' }]
            }] } };
            state.activeWorldId = world.id;
            await saveState({ allWorldInstances: true });
            const oldRevision = await HordeDB.get('stateRevision');
            await new Promise((resolve, reject) => {
                const tx = HordeDB.db.transaction('state', 'readwrite');
                tx.objectStore('state').put({ $hordeWorldShard: 'gzip-json-v1',
                    blob: new Blob(['not a gzip stream']) }, `worldInstance:${world.id}`);
                tx.oncomplete = resolve;
                tx.onerror = tx.onabort = () => reject(tx.error);
            });
            return oldRevision;
        }, corruptWorld);
        await damaged.reload();
        await damaged.waitForSelector('#startup-recovery-screen', { state: 'visible', timeout: 30000 });
        assert.equal(await damaged.getByRole('button', { name: 'Choose full backup to restore' }).isVisible(), true);
        const onFailure = await damaged.evaluate(async () => ({
            revision: await HordeDB.get('stateRevision'),
            index: await HordeDB.get('worldInstanceIndex'),
            stillDamaged: !!document.getElementById('startup-recovery-screen')
        }));
        assert.equal(onFailure.revision, before, 'failed startup must not save over the damaged installation');
        assert.deepEqual(onFailure.index, ['corrupt_world']);
        assert.equal(onFailure.stillDamaged, true);

        await damaged.locator('#startup-recovery-screen input[type=file]').setInputFiles({
            name: 'clean.hordebackup', mimeType: 'application/zip', buffer: backupBytes
        });
        await damaged.waitForFunction(() => !document.getElementById('confirm-modal-overlay').classList.contains('hidden'),
            { timeout: 30000 });
        await damaged.locator('#confirm-ok-btn').click();
        await damaged.waitForFunction(() => !document.getElementById('startup-recovery-screen')
            && typeof state !== 'undefined'
            && state.worldInstances?.restored_world?.sessions?.length === 1, { timeout: 30000 });
        const recovered = await damaged.evaluate(async () => ({
            index: await HordeDB.get('worldInstanceIndex'),
            worldNames: state.worlds.map(world => world.name),
            scene: (await HordeDB.get('worldInstance:restored_world'))?.sessions?.[0]?.history?.[0]?.text,
            recoveryOpen: !!document.getElementById('startup-recovery-screen')
        }));
        assert.deepEqual(recovered.index, ['restored_world']);
        assert(recovered.worldNames.includes('Restored World'));
        assert(!recovered.worldNames.includes('Corrupt World'));
        assert.equal(recovered.scene, 'This scene survived the backup.');
        assert.equal(recovered.recoveryOpen, false);
        console.log('PASS: damaged World shard leaves data untouched and a full backup restores a working installation');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
