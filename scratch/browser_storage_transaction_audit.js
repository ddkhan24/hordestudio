const assert = require('node:assert/strict');
const { app } = require('./app_source.js');
const packageSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '../human-package.js'), 'utf8');
const storageStart = app.indexOf('const HordeDB = {');
const storageSource = app.slice(storageStart, app.indexOf('\n};', storageStart) + 3);
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        // Entirely isolated origin/profile: no user's app or browser data.
        await context.route('https://horde-storage.test/**', route => route.fulfill({
            contentType: 'text/html', body: '<!doctype html><title>Storage audit</title>'
        }));
        const source = `const DB_NAME = 'HordeStorageAudit'; const DB_VERSION = 1; const STORE_NAME = 'state';
            ${storageSource}
            window.storage = HordeDB;`;
        async function client() {
            const page = await context.newPage();
            await page.goto('https://horde-storage.test/');
            await page.addScriptTag({ content: packageSource });
            await page.addScriptTag({ content: source });
            await page.evaluate(() => storage.init());
            return page;
        }
        const a = await client();
        const b = await client();
        await a.evaluate(() => storage.setMultiple({ worlds: ['A'], worldInstances: { a: 1 } }));
        const conflict = await b.evaluate(async () => {
            try { await storage.setMultiple({ worlds: ['B'], worldInstances: { b: 1 } }); }
            catch (error) { return { code: error.code, conflicted: storage.conflicted }; }
        });
        assert.deepEqual(conflict, { code: 'STATE_CONFLICT', conflicted: true });
        assert.deepEqual(await a.evaluate(() => storage.get('worlds')), ['A']);
        assert.deepEqual(await a.evaluate(() => storage.get('worldInstances')), { a: 1 });
        console.log('PASS: a stale tab cannot partially or wholly overwrite another tab');

        await a.evaluate(() => Promise.all([
            storage.setMultiple({ worlds: ['A2'] }),
            storage.setMultiple({ worlds: ['A3'] })
        ]));
        assert.deepEqual(await a.evaluate(() => storage.get('worlds')), ['A3']);
        assert.equal(await a.evaluate(() => storage.revision), 3);
        console.log('PASS: overlapping writes in one tab serialize without a false conflict');

        const cloneError = await a.evaluate(async () => {
            try { await storage.setMultiple({ worlds: ['bad'], unserializable: () => {} }); }
            catch (error) { return error.name; }
        });
        assert.equal(cloneError, 'DataCloneError');
        assert.deepEqual(await a.evaluate(() => storage.get('worlds')), ['A3']);
        assert.equal(await a.evaluate(() => storage.revision), 3);
        console.log('PASS: cloning failure rolls back every record and leaves the revision unchanged');

        const c = await client();
        const outcomes = await Promise.all([a, c].map((page, index) => page.evaluate(async index => {
            try { await storage.set('worldInstances', { winner: index }); return 'saved'; }
            catch (error) { return error.code; }
        }, index)));
        assert.deepEqual(outcomes.sort(), ['STATE_CONFLICT', 'saved']);
        assert.equal(await c.evaluate(() => storage.get('stateRevision')), 4);
        console.log('PASS: racing clients have exactly one canonical writer');

        const d = await client();
        const mediaResult = await d.evaluate(async () => {
            const media = 'data:image/png;base64,' + 'A'.repeat(2 * 1024 * 1024);
            const record = { messages: Array.from({length: 400}, (_, i) => ({id: 'm'+i, text: 'Preserve '+i, turnSnapshot: {photo: media}})), attachment: new Blob(['fixture video'], {type:'video/mp4'}) };
            const saving = storage.setMultiple({ companionTimelines: record });
            record.messages[0].text = 'Later edit';
            await saving;
            const restored = await storage.get('companionTimelines');
            if(restored.messages.some((m,i)=>m.id!=='m'+i||m.text!=='Preserve '+i||m.turnSnapshot.photo!==media))throw Error('History changed during storage');
            if(!(restored.attachment instanceof Blob)||await restored.attachment.text()!=='fixture video')throw Error('Blob attachment changed');
            const raw = await new Promise((resolve,reject)=>{const r=storage.db.transaction('state').objectStore('state').get('companionTimelines');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
            if(raw.strings.length!==1||!(raw.strings[0] instanceof Blob))throw Error('Repeated media was not stored once');
            await storage.prefetch(['companionTimelines']);
            const priorRevision=storage.revision;
            try{await storage.setMultiple({companionTimelines:{messages:[],photo:media},bad:()=>{}});throw Error('Expected clone failure');}
            catch(error){if(error.name!=='DataCloneError')throw error;}
            const afterFailure=await storage.get('companionTimelines');
            if(afterFailure.messages.length!==400||storage.revision!==priorRevision)throw Error('Failed transaction poisoned cache or revision');
            await storage.prefetch(['companionTimelines']);
            const prefetched=await storage.get('companionTimelines');
            if(prefetched.messages[399].turnSnapshot.photo!==media)throw Error('Startup prefetch failed to hydrate media');
            const shaped={$hordeStorage:'media-strings-v1',marker:'user field',strings:['ordinary'],data:{$hordeAsset:'unchanged',photo:media}};
            await storage.setMultiple({shaped});
            const shape=await storage.get('shaped');
            if(shape.marker!=='user field'||shape.strings[0]!=='ordinary'||shape.data.photo!==media)throw Error('A user object was mistaken for a media envelope');
            return {messages:restored.messages.length,logicalMediaCharacters:media.length*400,storedMediaBlobs:raw.strings.length,storedMediaBytes:raw.strings[0].size};
        });
        assert.equal(mediaResult.messages,400);assert.equal(mediaResult.storedMediaBlobs,1);
        console.log('PASS: >800MB logical snapshot media persists losslessly once; Blob, prefetch, shaped-object and rollback checks passed', mediaResult);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
