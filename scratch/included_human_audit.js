const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const bundleContext = { globalThis: {} };
vm.createContext(bundleContext);
vm.runInContext(fs.readFileSync('ashlyn-reynolds-human.js', 'utf8'), bundleContext);
vm.runInContext(fs.readFileSync('jane-harlow-human.js', 'utf8'), bundleContext);

const bundles = bundleContext.globalThis.HORDE_INCLUDED_HUMANS;
assert.equal(Array.isArray(bundles), true);
assert.equal(bundles.length, 2);
assert.deepEqual(Array.from(bundles, bundle => bundle.bundledId), [
    'ashlyn-reynolds-v1',
    'jane-harlow-v1'
]);

const appContext = { console };
buildContext(vm, [
    'validateCompanionArchiveData', 'normalizeCompanion',
    'livingClamp', 'livingId', 'isPlainObject', 'safeJsonClone',
    'requirePlainObject', 'requireString', 'requireSafeId', 'requireArray'
], appContext);

const archive = appContext.validateCompanionArchiveData(bundles[0]);
const ash = appContext.normalizeCompanion({
    ...archive.companion,
    bundledId: bundles[0].bundledId
});

assert.equal(ash.name, 'Ashlyn “Ash” Reynolds');
assert.equal(ash.bundledId, 'ashlyn-reynolds-v1');
assert.equal(ash.lifeProfile.weeklySchedule.length, 31);
assert.equal(ash.lifeProfile.wildcardDeck.length, 18);
assert(ash.profilePhoto.startsWith('data:image/jpeg;base64,'));
assert(ash.basePhoto.startsWith('data:image/jpeg;base64,'));
assert.equal(ash.allowVideoClips, true);
assert.equal(ash.startingVideoClips.length, 2);
assert.deepEqual(Array.from(ash.startingVideoClips, clip => clip.bundledSrc), [
    'assets/bundled/ashlyn-media/16.mp4',
    'assets/bundled/ashlyn-media/17.mp4'
]);
for (const clip of ash.startingVideoClips) {
    assert(fs.existsSync(clip.bundledSrc));
    assert.equal(fs.readFileSync(clip.bundledSrc).subarray(4, 8).toString('ascii'), 'ftyp');
}

const janeBundle = bundles[1];
const janeArchive = appContext.validateCompanionArchiveData(janeBundle);
const jane = appContext.normalizeCompanion({
    ...janeArchive.companion,
    bundledId: janeBundle.bundledId
});
assert.equal(jane.name, 'Jane Harlow');
assert.equal(jane.bundledId, 'jane-harlow-v1');
assert.equal(jane.lifeProfile.places.length, 9);
assert.equal(jane.lifeProfile.socialCircle.length, 8);
assert(jane.lifeProfile.weeklySchedule.length > 0);
assert(jane.profilePhoto.startsWith('data:image/jpeg;base64,'));
assert(jane.basePhoto.startsWith('data:image/jpeg;base64,'));
assert.deepEqual(Array.from(jane.memory.longTerm), []);
assert.deepEqual(Array.from(jane.lifeEvents), []);
assert.equal(jane.usage.textTurns, 0);

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /ashlyn-reynolds-human\.js\?v=20260814-ashlyn-clips-v1/);
assert.match(html, /jane-harlow-human\.js\?v=20260814-bundled-humans-v1/);
assert(html.indexOf('ashlyn-reynolds-human.js') < html.indexOf('app.js?v='));
assert(html.indexOf('jane-harlow-human.js') < html.indexOf('app.js?v='));

const source = fs.readFileSync('app.js', 'utf8');
const portableBuilder = fs.readFileSync('scripts/build-portable.sh', 'utf8');
const localBridge = fs.readFileSync('horde_mcp_bridge.py', 'utf8');
assert.match(source, /const HORDE_STUDIO_VERSION = '17\.1\.0'/);
assert.match(portableBuilder, /VERSION="\$\{1:-17\.1\.0\}"/);
assert.match(portableBuilder, /cp -R "\$ROOT_DIR\/assets\/bundled"/);
assert.match(portableBuilder, /ashlyn-reynolds-human\.js/);
assert.match(portableBuilder, /jane-harlow-human\.js/);
assert.match(portableBuilder, /verify-portable-humans\.py/);
assert.match(localBridge, /"\/ashlyn-reynolds-human\.js": \("ashlyn-reynolds-human\.js", "text\/javascript"\)/);
assert.match(localBridge, /"\/jane-harlow-human\.js": \("jane-harlow-human\.js", "text\/javascript"\)/);
assert.match(source, /includedHumanReceipts/);
assert.match(source, /const reseedEmptyLibrary = state\.companions\.length === 0/);
assert.match(source, /companion\.bundledId = bundleId/);
assert.match(source, /companion\?\.name === candidateName/);
assert.match(source, /function renderIncludedHumansCatalog\(\)/);
assert.match(source, /function installIncludedHuman\(bundleId\)/);

// Release integrity must cover the complete portable application directory,
// including the same boot tags and first-class files a browser receives.
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-human-package-'));
const packagedIndex = path.join(tempDirectory, 'index.html');
fs.copyFileSync('index.html', packagedIndex);
fs.copyFileSync('ashlyn-reynolds-human.js', path.join(tempDirectory, 'ashlyn-reynolds-human.js'));
fs.copyFileSync('jane-harlow-human.js', path.join(tempDirectory, 'jane-harlow-human.js'));
childProcess.execFileSync('python3', [
    'scripts/verify-portable-humans.py', tempDirectory
]);
const packagedHtml = fs.readFileSync(packagedIndex, 'utf8');
assert.match(packagedHtml, /src="ashlyn-reynolds-human\.js/);
assert.match(packagedHtml, /src="jane-harlow-human\.js/);
assert.doesNotMatch(packagedHtml, /data-horde-bundled-human=/);
fs.rmSync(tempDirectory, { recursive: true, force: true });

console.log('PASS included Virtual Human audit');
