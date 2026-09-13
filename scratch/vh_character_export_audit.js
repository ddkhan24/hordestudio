// Exercise real character archive export, restore, hydration and a second export.
// Media bytes are synthetic; no provider or live character data is used.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext } = require('./app_source');

async function roundTrip(kind) {
    const assets = new Map();
    const videoBytes = Object.fromEntries(['local_seed', 'bundled_seed', 'remote_seed'].map(id => [id, Buffer.from(`synthetic archive video bytes: ${id}`)]));
    const video = id => new Blob([videoBytes[id]], { type: 'video/mp4' });
    assets.set('companionVideoAsset:local_seed', video('local_seed'));
    const context = {
        console, Blob, Uint8Array, atob,
        FileReader: class {
            readAsDataURL(blob) {
                blob.arrayBuffer().then(bytes => {
                    this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
                    this.onload();
                }).catch(error => { this.error = error; this.onerror(); });
            }
        },
        fetch: async source => {
            assert(['assets/bundled/test/seed.mp4', 'https://media.example.test/seed.mp4'].includes(source));
            return { ok: true, blob: async () => video(source.startsWith('assets/') ? 'bundled_seed' : 'remote_seed') };
        },
        HordeDB: { get: async key => assets.get(key), set: async (key, value) => assets.set(key, value) },
        state: { globalSettings: {}, personas: [], companions: [], companionThreads: {}, companionTimelines: {} }
    };
    buildContext(vm, ['normalizeCompanion', 'freshCompanionRuntime', 'normalizeCompanionTimeline',
        'buildCompanionArchivePayload', 'restoreCompanionArchive', 'hydrateCompanionArchiveMedia'], context);
    const photo = 'data:image/png;base64,iVBORw0KGgo=';
    const personality = 'Context and contradictions matter. '.repeat(100) + 'The final motivation survives. 🌿';
    const source = context.normalizeCompanion({ id: 'export_source', name: 'Archive fixture',
        personality,
        startingSocialPosts: [{ id: 'seed_post', kind: 'photo', text: 'An authored day out', photo, seedAgeDays: 3 }],
        startingVideoClips: [
            { id: 'bundled_seed', status: 'ready', bundledSrc: 'assets/bundled/test/seed.mp4' },
            { id: 'local_seed', status: 'ready', assetId: 'local_seed' },
            { id: 'remote_seed', status: 'ready', outputUrl: 'https://media.example.test/seed.mp4' },
            { id: 'draft_seed', status: 'draft', assetId: 'local_seed' },
            { id: 'empty_seed', status: 'ready' }
        ]
    });
    assert.equal(source.startingVideoClips.length, 3, 'all supported ready starter sources survive normalization');
    assert.equal(source.personality, personality, 'full authored personality survives normalization');
    const timeline = context.normalizeCompanionTimeline({ id: 'source_timeline', runtime: context.freshCompanionRuntime(source, 10000) }, source);
    context.applyCompanionRuntime(source, timeline.runtime);
    context.state.companions = [source];
    context.state.companionTimelines[source.id] = { activeSessionId: timeline.id, sessions: [timeline] };
    context.state.companionThreads[source.id] = [];

    for (let generation = 0; generation < 2; generation++) {
        const current = generation ? context.state.companions[0] : source;
        const payload = await context.buildCompanionArchivePayload(current, kind, 20000 + generation);
        assert.equal(payload.companion.startingSocialPosts[0].photo, photo);
        assert.equal(payload.companion.startingVideoClips.length, 3);
        assert.equal(payload.media.videos.length, 3);
        assert.equal(payload._mediaWarnings, undefined);
        assert(payload.companion.startingVideoClips.every(job => job.archiveMediaId && !job.assetId && !job.bundledSrc && !job.outputUrl));
        const restored = context.restoreCompanionArchive(JSON.parse(JSON.stringify(payload)), 30000 + generation);
        assert.equal(restored.startingVideoClips.length, 3, 'embedded starter clip entries survive import before hydration');
        await context.hydrateCompanionArchiveMedia(restored, payload.media);
        const saved = context.normalizeCompanion(JSON.parse(JSON.stringify(restored)));
        assert.equal(saved.startingVideoClips.length, 3, 'hydrated starters survive save/reload');
        assert.equal(saved.videoJobs.length, 3);
        assert.equal(saved.personality, personality, 'full personality survives archive import and reload');
        assert.equal(saved.startingSocialPosts[0].photo, photo);
        assert.equal(saved.socialPosts[0].text, 'An authored day out');
        for (const job of saved.startingVideoClips) {
            const blob = assets.get(`companionVideoAsset:${job.assetId}`);
            assert(blob instanceof Blob);
            assert.deepEqual(Buffer.from(await blob.arrayBuffer()), videoBytes[job.id], 'each clip retains its own bytes');
        }
    }
    console.log(`PASS ${kind}: starter posts, photos and 3 clip sources survive two export/import cycles`);
}

(async () => {
    await roundTrip('character-template');
    await roundTrip('portable-human');
})().catch(error => { console.error(error); process.exitCode = 1; });
