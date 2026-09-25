'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const ROOT = path.resolve(__dirname, '..');
const PYTHON = process.env.HORDE_PYTHON_EXECUTABLE || 'python3';
const TOKEN = 'onboarding-audit-' + 'd'.repeat(40);
const SCREENSHOT_DIR = process.env.HORDE_AUDIT_SCREENSHOT_DIR || '';

async function capture(page, name) {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

async function capturePanel(locator, name) {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await locator.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

function startStudio() {
    const child = spawn(PYTHON, ['scratch/vh2_browser_server.py'], {
        cwd: ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
        child.stdout.once('data', data => resolve({ child, base: `http://127.0.0.1:${Number(String(data).trim())}` }));
        child.stderr.on('data', data => process.stderr.write(data));
        child.once('exit', code => reject(Error(`Studio fixture exited during startup (${code}).`)));
    });
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function startPrivateHost(origin, directory) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(PYTHON, ['-u', 'horde_mcp_bridge.py'], {
        cwd: ROOT,
        env: {
            ...process.env,
            HORDE_CONFIG_DIR: directory,
            HORDE_SERVER_LISTEN_HOST: '127.0.0.1',
            HORDE_SERVER_HOST: '127.0.0.1',
            HORDE_SERVER_PORT: String(port),
            HORDE_VH2_REMOTE_MODE: '1',
            HORDE_VH2_ACCESS_TOKEN: TOKEN,
            HORDE_VH2_ALLOWED_ORIGINS: origin,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', data => process.stderr.write(data));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw Error(`Private host exited during startup (${child.exitCode}).`);
        try {
            const response = await fetch(base + '/health', {
                headers: { Authorization: `Bearer ${TOKEN}`, Origin: origin },
            });
            if (response.ok) return { child, base };
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    child.kill();
    throw Error('Private host did not become ready.');
}

async function remoteJson(base, pathname, origin) {
    const response = await fetch(base + pathname, {
        headers: { Authorization: `Bearer ${TOKEN}`, Origin: origin },
    });
    const body = await response.text();
    if (!response.ok) throw Error(`Remote ${pathname} failed: ${response.status} ${body}`);
    return JSON.parse(body);
}

async function waitRemote(base, pathname, predicate, origin, timeout = 20000) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        last = await remoteJson(base, pathname, origin);
        if (predicate(last)) return last;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Timed out waiting for private-host state: ${JSON.stringify(last)}`);
}

async function openHosting(page) {
    const entry = page.getByRole('button', { name: 'Always-on private server', exact: true });
    if (await entry.count() && await entry.first().isVisible()) await entry.first().click();
    else await page.evaluate(() => vhWorkspaceSelect('recovery'));
    const hosting = page.locator('.vh-private-hosting').last();
    await hosting.waitFor({ state: 'attached' });
    await hosting.evaluate(node => {
        const details = node.closest('details');
        if (details) details.open = true;
    });
    await hosting.waitFor({ state: 'visible' });
    return hosting;
}

async function expectNoHorizontalOverflow(page, hosting, label) {
    const metrics = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
    }));
    assert(metrics.documentWidth <= metrics.viewport + 1, `${label}: document must not overflow horizontally (${metrics.documentWidth} > ${metrics.viewport})`);
    const hostMetrics = await hosting.evaluate(node => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
    assert(hostMetrics.scrollWidth <= hostMetrics.clientWidth + 1, `${label}: hosting panel must not overflow horizontally`);
}

async function main() {
    let studio;
    let remote;
    let browser;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vh2-cloud-onboarding-'));
    const requests = [];
    try {
        studio = await startStudio();
        remote = await startPrivateHost(studio.base, temporary);
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            if (request.url().startsWith(remote.base)) requests.push({ method: request.method(), url: request.url() });
        });
        await page.route('**/*', route => {
            const url = route.request().url();
            return url.startsWith(studio.base) || url.startsWith(remote.base) || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        await page.goto(studio.base + '/index.html');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        await page.evaluate(base => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            mcpBridgeBase = () => base;
            state.apiKey = 'ONBOARDING_TEST_KEY';
            Object.assign(state.globalSettings, { apiProvider: 'openrouter', defaultModel: 'cloud-onboarding-fixture' });
            const companion = normalizeCompanion({
                id: 'cloud-onboarding-alex',
                name: 'Alex Rowan',
                age: 31,
                personality: 'Restless, observant, and independent.',
                textProvider: 'openrouter',
                model: 'cloud-onboarding-fixture',
                locationMode: 'custom',
                timezoneOffsetMinutes: 0,
                lifeProfile: {
                    initializedAt: 1788764400000,
                    places: [{ id: 'home', label: 'Apartment', kind: 'home' }],
                    weeklySchedule: [],
                    socialCircle: [],
                    sleepPolicy: { enabled: false },
                },
            });
            state.companions = [companion];
            state.companionTimelines = {};
            state.companionThreads = {};
            state.activeCompanionId = companion.id;
            ensureCompanionTimelineStore(companion.id);
            hideGlobalSettings();
            vhOpenWorkspace('overview');
        }, studio.base);
        await page.locator('[data-start-persistent]').click();
        await page.waitForFunction(() => getActiveCompanionTimeline('cloud-onboarding-alex')?.vh2?.running === true);
        const worldId = await page.evaluate(() => getActiveCompanionTimeline('cloud-onboarding-alex').vh2.worldId);

        let hosting = await openHosting(page);
        const copy = await hosting.innerText();
        assert.match(copy, /keep this life running when this computer is off/i, 'lead with the user outcome, not storage plumbing');
        assert.match(copy, /private (?:VH2 )?server you control/i, 'state who owns the destination');
        assert.match(copy, /Horde(?: Studio)? does not (?:sell|provide|operate|host)/i, 'state that Horde is not the cloud host');
        assert.match(copy, /(?:moves?|becomes?) (?:the )?(?:only )?(?:active|primary|running)/i, 'explain that the runtime moves rather than merely backing up');
        assert.match(copy, /(?:pauses?.*(?:recovery )?mirror|(?:paused|recovery) (?:local )?(?:copy|mirror|backup)|local (?:copy|mirror|backup).*(?:paused|recovery))/i, 'explain the paused local recovery copy');
        assert.match(copy, /conversation|memory|timeline/i, 'summarize meaningful life data that moves');
        assert.match(copy, /Railway/i, 'name the recommended novice host instead of asking the user to choose infrastructure');
        assert.match(copy, /\$5\/month/i, 'set a concrete cost expectation');
        assert.match(copy, /free services.*sleep|free host.*sleep/i, 'explain why an always-on life has no trusted free recommendation');
        assert.doesNotMatch(copy, /HORDE_VH2_|openssl|docker compose|ports 80\/443|Caddy/i, 'do not dump infrastructure details before the user chooses an advanced path');

        const heading = hosting.getByRole('heading', { name: /keep this life running when this computer is off/i });
        assert.equal(await heading.count(), 1, 'the outcome is a real semantic heading');
        assert.equal(await hosting.locator('.vh-cloud-host-card').count(), 3, 'offer one recommended path, existing-server connection, and advanced self-hosting');

        const progress = hosting.locator('.vh-cloud-progress');
        assert.equal(await progress.getByRole('listitem').count(), 3, 'wizard exposes three compact, ordered stages');
        assert.equal(await hosting.getAttribute('data-cloud-step'), '1', 'wizard opens on preparation instead of dumping every field');
        assert.equal(await progress.locator('[aria-current="step"]').innerText(), 'Choose host');
        assert.equal(await hosting.locator('.vh-cloud-step:visible').count(), 1, 'only the current wizard step is visible');
        assert.equal(await hosting.getByLabel(/server (?:address|url)|cloud url/i).isVisible(), false, 'connection plumbing stays out of the first decision');
        await capturePanel(hosting, '01-prepare-panel-desktop');

        await hosting.getByRole('button', { name: /use my own linux server/i }).click();
        const advanced = hosting.locator('[data-cloud-host-guide]');
        assert.match(await advanced.innerText(), /complete Horde Studio repository/i, 'advanced guide defines exactly what must be copied');
        assert.match(await advanced.innerText(), /Dockerfile.*compose\.yaml.*Caddyfile.*\.env\.example/is, 'advanced guide names every deployment-specific file');
        assert.match(await advanced.innerText(), /domain alone cannot host|domain is only an address/i, 'advanced guide distinguishes the address from the running service');
        const advancedLink = advanced.getByRole('link', { name: /advanced server guide/i });
        assert.match(await advancedLink.getAttribute('href'), /deploy\/vh2-self-host/i);

        await hosting.getByRole('button', { name: /set up with railway/i }).click();
        const railway = hosting.locator('[data-cloud-host-guide]');
        const railwayCopy = await railway.innerText();
        assert.match(railwayCopy, /no terminal, custom domain, Docker commands or port configuration/i, 'recommended path states what the novice does not need');
        assert.match(railwayCopy, /New Project.*Deploy from GitHub repo/is, 'name the exact first Railway controls');
        assert.match(railwayCopy, /Variables.*Raw Editor/is, 'name the exact variables controls');
        assert.match(railwayCopy, /Volume.*\/data/is, 'explain how and why to add durable storage');
        assert.match(railwayCopy, /Networking.*Generate Domain/is, 'explain where the server address comes from');
        const config = await railway.getByLabel('Railway configuration').inputValue();
        assert.match(config, /RAILWAY_DOCKERFILE_PATH=\/deploy\/vh2-self-host\/Dockerfile/);
        assert.match(config, /RAILWAY_RUN_UID=0/, 'Railway can write to the attached root-owned volume');
        assert.match(config, new RegExp(`HORDE_VH2_ALLOWED_ORIGINS=${studio.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        const generatedKey = config.match(/HORDE_VH2_ACCESS_TOKEN=([a-f0-9]+)/)?.[1];
        assert.match(generatedKey || '', /^[a-f0-9]{64}$/, 'Studio generates a strong private key instead of asking a novice to run openssl');

        await page.setViewportSize({ width: 390, height: 844 });
        await expectNoHorizontalOverflow(page, hosting, 'mobile prepare');
        const setupCards = await hosting.locator('.vh-cloud-railway-steps > li').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
        assert(setupCards.length === 4 && setupCards[1] > setupCards[0], 'server setup cards become one readable column on mobile');
        const prepareScroll = await page.locator('.vh-workspace-main').evaluate(node => {
            const before = node.scrollTop;
            node.scrollTop = node.scrollHeight;
            const result = { before, after: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight };
            node.scrollTop = 0;
            return result;
        });
        assert(prepareScroll.scrollHeight <= prepareScroll.clientHeight || prepareScroll.after > prepareScroll.before,
            `mobile Prepare step must remain scrollable: ${JSON.stringify(prepareScroll)}`);
        await capturePanel(hosting, '01b-prepare-panel-mobile');
        await page.setViewportSize({ width: 1440, height: 1000 });

        await hosting.getByRole('button', { name: 'I have my Railway address', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.vh-private-hosting')?.dataset.cloudStep === '2');

        const url = hosting.getByLabel(/server (?:address|url)|cloud url/i);
        const token = hosting.getByLabel(/private server key/i);
        assert.equal(await url.count(), 1, 'server address has an accessible label');
        assert.equal(await token.count(), 1, 'private key has an accessible label');
        assert.equal(await token.getAttribute('type'), 'password', 'access token is visually protected');
        assert.equal(await token.inputValue(), generatedKey, 'guided setup carries the generated private key into Connect');
        for (const field of [url, token]) {
            const describedBy = await field.getAttribute('aria-describedby');
            assert(describedBy, 'connection fields must be associated with their explanation');
            assert.equal(await page.locator(`#${describedBy}`).count(), 1, 'aria-describedby points to existing help text');
        }
        assert.match(await url.locator('xpath=following-sibling::*[1]').innerText(), /Railway.*generated public domain/i, 'URL help points to the exact Railway output');
        assert.match(await token.locator('xpath=following-sibling::*[1]').innerText(), /created during host setup/i, 'token help points back to the guided setup key');

        const test = hosting.getByRole('button', { name: /test (?:private )?(?:server|connection)/i });
        const move = hosting.locator('button').filter({ hasText: /^Move running life to private server$/i });
        assert.equal(await test.count(), 1, 'connection test has a single clear action');
        assert.equal(await move.count(), 1, 'runtime transfer has a single explicit action');
        assert.equal(await move.isDisabled(), true, 'move is gated until the exact connection is verified');

        const desktopBox = await hosting.boundingBox();
        assert(desktopBox && desktopBox.height < 1050, `desktop onboarding should be compact enough to scan (height ${desktopBox?.height})`);
        await expectNoHorizontalOverflow(page, hosting, 'desktop');
        await capturePanel(hosting, '02-connect-panel-desktop');

        await url.fill(remote.base);
        await token.fill(TOKEN);
        assert.equal(await move.isDisabled(), true, 'credentials alone do not unlock transfer');
        await page.evaluate(() => {
            const verify = vh2VerifyPrivateHost;
            vh2VerifyPrivateHost = async (...args) => {
                await new Promise(resolve => setTimeout(resolve, 250));
                return verify(...args);
            };
        });
        await test.click();
        await page.waitForFunction(() => /testing.*nothing.*upload/i.test(document.querySelector('.vh-private-hosting [role=status]')?.textContent || ''));
        assert.equal(await test.isDisabled(), true, 'test action exposes a busy state instead of looking frozen');
        await page.waitForFunction(() => [...document.querySelectorAll('.vh-private-hosting [role=status]')].some(node => /connected|ready/i.test(node.textContent || '')));
        assert.equal(await move.isEnabled(), true, 'successful test unlocks transfer');
        assert.equal(await hosting.getAttribute('data-cloud-step'), '3', 'successful verification advances to a separate review step');
        assert.equal(await hosting.locator('.vh-cloud-transfer').isVisible(), true, 'review makes the transfer boundary visible before commitment');
        await capturePanel(hosting, '03-review-panel-desktop');
        assert.equal(requests.some(request => request.url.includes('/vh2/restore')), false, 'testing the connection does not upload the life');
        assert.equal(await page.evaluate(secret => JSON.stringify(state.globalSettings).includes(secret), TOKEN), false, 'testing does not persist the token');

        await hosting.getByRole('button', { name: 'Edit connection', exact: true }).click();
        await url.fill(remote.base + '/');
        assert.equal(await move.isDisabled(), true, 'editing a verified connection immediately revokes transfer approval');
        const statusAfterEdit = await hosting.locator('[role=status]').innerText();
        assert.match(statusAfterEdit, /test.*again|verify.*again|connection changed/i, 'the revoked state tells the user how to recover');
        await url.fill(remote.base);
        await test.click();
        await page.waitForFunction(() => [...document.querySelectorAll('.vh-private-hosting [role=status]')].some(node => /connected|ready/i.test(node.textContent || '')));
        assert.equal(await move.isEnabled(), true);

        await page.setViewportSize({ width: 390, height: 844 });
        await expectNoHorizontalOverflow(page, hosting, 'mobile');
        const workspaceScroll = await page.locator('.vh-workspace-main').evaluate(node => {
            const before = node.scrollTop;
            node.scrollTop = node.scrollHeight;
            const result = { before, after: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight };
            node.scrollTop = 0;
            return result;
        });
        assert(workspaceScroll.scrollHeight <= workspaceScroll.clientHeight || workspaceScroll.after > workspaceScroll.before,
            `mobile workspace must remain scrollable: ${JSON.stringify(workspaceScroll)}`);
        await capturePanel(hosting, '04-review-panel-mobile');
        const controlSizes = await hosting.locator('button:visible, input:visible').evaluateAll(nodes => nodes.map(node => {
            const style = getComputedStyle(node);
            return {
                label: node.getAttribute('aria-label') || node.textContent || node.getAttribute('placeholder') || node.tagName,
                height: node.getBoundingClientRect().height,
                cssHeight: style.height,
                minHeight: style.minHeight,
                boxSizing: style.boxSizing,
                paddingBlock: `${style.paddingBlockStart} ${style.paddingBlockEnd}`,
                transform: style.transform,
            };
        }));
        for (const control of controlSizes) assert(control.height >= 43.5, `mobile target is at least 44px tall: ${JSON.stringify(control)}`);

        await page.setViewportSize({ width: 1440, height: 1000 });
        page.once('dialog', async dialog => {
            assert.match(dialog.message(), /active|primary|running/i, 'confirmation describes the runtime switch');
            assert.match(dialog.message(), /paused|recovery|local/i, 'confirmation describes the local safety copy');
            await dialog.accept();
        });
        await move.click();
        await page.waitForFunction(() => !!getActiveCompanionTimeline('cloud-onboarding-alex').vh2.hostId, null, { timeout: 20000 });
        const remoteLife = await waitRemote(remote.base, `/vh2/projection?worldId=${encodeURIComponent(worldId)}`, projection => projection.state.running === true, studio.base);
        const localLife = await (await fetch(studio.base + `/vh2/projection?worldId=${encodeURIComponent(worldId)}`)).json();
        assert.equal(remoteLife.worldId, worldId, 'transfer preserves the canonical life identity');
        assert.equal(remoteLife.state.running, true, 'private server becomes the running primary');
        assert.equal(localLife.state.running, false, 'local source is paused after the move');

        await page.waitForFunction(() => /private server is primary/i.test(document.querySelector('.vh-private-hosting')?.textContent || ''), null, { timeout: 20000 });
        hosting = page.locator('.vh-private-hosting').last();
        await hosting.waitFor({ state: 'visible' });
        const hostedCopy = await hosting.innerText();
        assert.match(hostedCopy, /running.*private (?:cloud|server)|private (?:cloud|server).*running/i, 'connected state clearly identifies where the life runs');
        assert.match(hostedCopy, /local (?:mirror|recovery|backup)/i, 'connected state exposes local recovery health');
        assert.equal(await hosting.getByRole('button', { name: /switch back to this computer/i }).count(), 1, 'return-home path remains discoverable');
        await expectNoHorizontalOverflow(page, hosting, 'connected desktop');
        await capturePanel(hosting, '05-connected-panel-desktop');

        assert.deepEqual(errors, [], 'onboarding and transfer produce no browser exceptions');
        console.log(JSON.stringify({
            passed: true,
            checks: 64,
            worldId,
            surfaces: ['desktop onboarding', 'mobile onboarding', 'verified-connection gate', 'cloud-primary transfer', 'connected recovery state'],
        }, null, 2));
    } finally {
        if (browser) await browser.close();
        studio?.child.kill();
        remote?.child.kill();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
