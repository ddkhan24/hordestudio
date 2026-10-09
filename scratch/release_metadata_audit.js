/** Release identity and real update-check behavior, without network or storage. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { app, functionSource } = require('./app_source');
const root = path.resolve(__dirname, '..');
const version = app.match(/const HORDE_STUDIO_VERSION = '([^']+)'/)[1];
const released = app.match(/const HORDE_STUDIO_RELEASED_AT = '([^']+)'/)[1];
const builder = fs.readFileSync(path.join(root, 'scripts/build-portable.sh'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const defaultVersion = builder.match(/VERSION="\$\{1:-([^}]+)\}"/)[1];
assert.equal(version, defaultVersion, 'portable target and in-app identity must agree');
assert(readme.includes(`/releases/tag/v${version})`), 'download must point to the in-app version');
assert(Number.isFinite(Date.parse(released)), 'the build date must be parseable');

(async () => {
    const notices = [], cache = new Map();
    let remoteTag = 'v' + version, fetches = 0;
    const context = vm.createContext({
        Date, Number, String, Array, Math,
        HORDE_STUDIO_VERSION: version, HORDE_STUDIO_RELEASED_AT: released,
        HORDE_STUDIO_RELEASE_API: 'https://offline.test/releases/latest',
        HORDE_STUDIO_RELEASES_URL: 'https://github.com/ddkhan24/hordestudio/releases/latest',
        localStorage: { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value) },
        fetch: async () => { fetches++; return { ok: true, json: async () => ({ tag_name: remoteTag,
            html_url: 'https://github.com/ddkhan24/hordestudio/releases/tag/' + remoteTag }) }; },
        showAppUpdateNotice: release => notices.push(release.tag_name)
    });
    vm.runInContext(['numericVersionParts', 'compareAppVersions', 'checkForAppUpdate']
        .map(functionSource).join('\n'), context);
    await context.checkForAppUpdate();
    assert.deepEqual(notices, [], 'a fresh release response must not advertise this installed build as an update');
    await context.checkForAppUpdate();
    assert.equal(fetches, 1, 'fresh cached release metadata must not refetch');
    assert.deepEqual(notices, [], 'cached current version must not prompt an update');
    cache.clear();
    const parts = version.split('.').map(Number); parts[parts.length - 1]++;
    remoteTag = 'v' + parts.join('.');
    await context.checkForAppUpdate();
    assert.deepEqual(notices, [remoteTag], 'a newer patch release must still prompt');
    console.log('PASS: release identity agrees across app, builder and download; current/cache versions stay quiet and newer patches prompt');
})().catch(error => { console.error(error); process.exitCode = 1; });
