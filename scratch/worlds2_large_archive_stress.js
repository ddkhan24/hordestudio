/** Optional high-memory gate: a real >512 MB ZIP package remains importable. */
'use strict';
const assert = require('node:assert/strict');
globalThis.HordeHumanPackage = require('../human-package.js');
const Archive = require('../large-archive.js');

(async () => {
    const mebibyte = new Uint8Array(1024 * 1024);
    mebibyte.fill(0x5a);
    const media = new Blob(Array(513).fill(mebibyte), { type: 'video/mp4' });
    assert(media.size > 512 * 1024 * 1024);
    const packageFile = await Archive.pack({ _format: 'stress-fixture', media }, 'world-campaign');
    assert(packageFile.size > 512 * 1024 * 1024);
    const restored = await Archive.unpack(packageFile, 'world-campaign');
    assert.equal(restored.media.size, media.size);
    assert.equal(restored.media.type, 'video/mp4');
    const first = new Uint8Array(await restored.media.slice(0, 4).arrayBuffer());
    const last = new Uint8Array(await restored.media.slice(-4).arrayBuffer());
    assert.deepEqual([...first], [0x5a, 0x5a, 0x5a, 0x5a]);
    assert.deepEqual([...last], [0x5a, 0x5a, 0x5a, 0x5a]);
    console.log(`PASS: ${(packageFile.size / 1024 / 1024).toFixed(1)} MiB archive packed, CRC-verified, and restored`);
})().catch(error => { console.error(error); process.exitCode = 1; });
