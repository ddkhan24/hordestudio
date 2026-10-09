'use strict';
// Explicit archive-only gate: no developer library, config, or browser profile.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

async function main() {
    const args = process.argv.slice(2);
    if (!args[0] || args.length > 3 || (args.length > 1 && args[1] !== '--output'))
        throw Error('Usage: node scratch/portable_browser_release_audit.js ARCHIVE [--output REPORT.json]');
    const archive = path.resolve(args[0]);
    const output = args[2] && path.resolve(args[2]);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'horde portable browser '));
    const server = spawn(process.env.PYTHON || 'python3', [path.join(__dirname, 'portable_browser_server.py'), archive, temporary],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    let context, serverError = '';
    server.stderr.on('data', chunk => { serverError += String(chunk); });
    try {
        const fixture = await new Promise((resolve, reject) => {
            let buffer = '';
            const timeout = setTimeout(() => reject(Error('Packaged server startup timed out.\n' + serverError)), 60000);
            server.stdout.on('data', chunk => {
                buffer += String(chunk);
                if (buffer.includes('\n')) {
                    clearTimeout(timeout);
                    try { resolve(JSON.parse(buffer.split('\n')[0])); } catch (error) { reject(error); }
                }
            });
            server.once('error', error => { clearTimeout(timeout); reject(error); });
            server.once('exit', code => { clearTimeout(timeout); reject(Error('Packaged fixture exited ' + code + '\n' + serverError)); });
        });
        const base = 'http://127.0.0.1:' + fixture.port;
        context = await chromium.launchPersistentContext(path.join(temporary, 'chrome-profile'), {
            ...launchOptions, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block',
            args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run']
        });
        const deniedExternal = [], pageErrors = [], failedLocalResponses = [];
        await context.route('**/*', route => {
            const url = route.request().url();
            if (url.startsWith('blob:') || url.startsWith('data:') || new URL(url).origin === base)
                return route.continue();
            deniedExternal.push(url);
            return route.abort('blockedbyclient');
        });
        await context.addInitScript(() => {
            window.__portableCspViolations = [];
            addEventListener('securitypolicyviolation', event => window.__portableCspViolations.push({
                directive: event.effectiveDirective, blockedURI: event.blockedURI
            }));
        });
        const page = context.pages()[0] || await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('response', response => {
            if (response.url().startsWith(base) && response.status() >= 400)
                failedLocalResponses.push({ url: response.url().slice(base.length), status: response.status() });
        });
        const boot = await page.goto(base + '/index.html', { waitUntil: 'load' });
        assert.equal(boot.status(), 200);
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, null, { timeout: 45000 });
        const installed = await page.evaluate(async humans => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            hideGlobalSettings();
            if (mcpBridgeBase() !== location.origin) throw Error('Fresh app did not discover the packaged bridge port.');
            await installBundledHumans();
            const count = state.companions.length;
            await installBundledHumans();
            if (state.companions.length !== count) throw Error('Bundled installation was not idempotent.');
            return humans.map(entry => {
                const companion = state.companions.find(value => value.bundledId === entry.id);
                if (!companion) throw Error('Missing bundled human: ' + entry.id);
                if ((state.companionTimelines?.[companion.id]?.sessions || []).some(value => value.messages?.length || value.vh2?.worldId)
                    || (state.companionThreads?.[companion.id] || []).length) throw Error('Bundled human contains a saved chat or life.');
                if (companion.priorContact !== 'never_spoken' || companion.knownBeforeDays !== 0
                    || companion.startingRelationship !== 0 || companion.relationshipContext) throw Error('Bundled human contains a player relationship.');
                return { id: entry.id, characterId: companion.id, posts: companion.startingSocialPosts.length,
                    refs: companion.startingReferences.length, gallery: companion.startingGallery.length,
                    clips: companion.startingVideoClips.length,
                    sources: companion.startingVideoClips.map(value => value.bundledSrc) };
            });
        }, fixture.humans);
        for (let index = 0; index < installed.length; index++) {
            const { sources, ...actual } = installed[index];
            assert.deepEqual(actual, fixture.humans[index]);
        }
        const navigation = [];
        for (const mode of ['library', 'companions', 'worlds', 'videoWorlds', 'multiplayer', 'pip']) {
            await page.locator('.nav-item[data-view="' + mode + '"]').click();
            await page.waitForFunction(mode => state.view === mode && views[mode] && !views[mode].classList.contains('hidden'), mode);
            const panel = await page.evaluate(mode => {
                const rect = views[mode].getBoundingClientRect();
                return { mode, width: rect.width, height: rect.height, textLength: views[mode].textContent.trim().length,
                    activeNavigation: document.querySelector('.nav-item.active')?.dataset.view };
            }, mode);
            assert(panel.width > 0 && panel.height > 0 && panel.textLength > 0, 'Main mode failed to render: ' + mode);
            assert.equal(panel.activeNavigation, mode);
            navigation.push(panel);
        }
        const ranges = [];
        for (const human of installed) for (const source of human.sources) {
            const url = new URL(source, base);
            assert.equal(url.origin, base, 'Bundled video refers to an external host.');
            const response = await page.request.get(url.href, { headers: { Range: 'bytes=0-1023' } });
            assert.equal(response.status(), 206, 'Bundled video range request failed.');
            assert.match(response.headers()['content-range'] || '', /^bytes 0-1023\//);
            assert.equal((await response.body()).length, 1024);
            ranges.push({ source, contentRange: response.headers()['content-range'] });
        }
        const statusResponse = await page.request.get(base + '/__portable_audit/status');
        const isolation = await statusResponse.json();
        assert.deepEqual(isolation, { deniedNetwork: [], deniedPosts: [], workersStarted: false, alwaysOnThreadAlive: false });
        const cspViolations = await page.evaluate(() => window.__portableCspViolations);
        assert.deepEqual(pageErrors, [], 'Packaged page raised JavaScript errors.');
        assert.deepEqual(cspViolations, [], 'Packaged app violated its CSP.');
        assert.deepEqual(failedLocalResponses, [], 'Packaged local resources/API requests failed.');
        const report = { archive, archiveSha256: fixture.archiveSha256, nodeVersion: fixture.nodeVersion,
            nativeNode: fixture.nativeNode, kernelVersion: fixture.kernelVersion,
            installed, navigation, ranges, isolation, deniedExternal: [...new Set(deniedExternal)],
            pageErrors, cspViolations, failedLocalResponses };
        if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
        console.log(JSON.stringify(report, null, 2));
    } finally {
        await context?.close();
        if (server.exitCode === null) {
            await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000).unref(); });
        }
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
