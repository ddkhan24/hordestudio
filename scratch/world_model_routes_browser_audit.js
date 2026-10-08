/** Offline browser coverage for World life, studio, and scheduler model routes. */
'use strict';
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
            if (url.hostname !== 'world-model-routes.test') return route.abort();
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
        await page.goto('https://world-model-routes.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline-model-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const world = { id: 'model_routes', name: 'Model Routes', model: 'fixture/model',
                locations: [{ id: 'start', name: 'Start', description: 'A house.' }],
                entities: [], groups: [], startingLives: [] };
            const npc = { id: 'npc', name: 'Ari', type: 'npc', goal: 'Study the town', description: 'A student.' };
            const calls = [];
            const realFetch = fetch;
            fetch = async (url, init) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, init);
                const body = JSON.parse(init.body);
                calls.push({ maxTokens: body.max_tokens, responseFormat: !!body.response_format });
                if (body.max_tokens === 6500) return new Response(JSON.stringify({ choices: [{ message: {
                    content: JSON.stringify({ people: [{ id: 'friend', name: 'Ari', relationship_to_player: 'friend' }] })
                } }] }), { status: 200 });
                if (body.max_tokens === 900) return new Response(JSON.stringify({ choices: [{ message: {
                    content: JSON.stringify({ schedule: [{ time: '09:00', locationId: 'start', activity: 'studying' }] })
                } }] }), { status: 200 });
                if (body.max_tokens === 4321 && body.response_format) {
                    return new Response(JSON.stringify({ error: { message: 'response_format unsupported' } }), { status: 400 });
                }
                if (body.max_tokens === 4321) return new Response(JSON.stringify({ choices: [{ message: {
                    content: JSON.stringify({ operations: [] })
                } }] }), { status: 200 });
                throw new Error(`Unexpected World model call ${body.max_tokens}`);
            };
            try {
                const life = await requestTimelineLifePlan(world, { playerLocation: 'start' },
                    { name: 'Player', text: 'Has a friend.' }, { name: 'Local', startLocationId: 'start' });
                const schedule = await generateNpcSchedule(npc, world);
                const architect = await worldArchitectJSON(world, 'fixture/model',
                    [{ role: 'user', content: 'Return empty operations.' }], 4321, 'operations');
                return { lifePeople: life.people.length, schedule,
                    scheduleLocation: npc.schedule[0]?.locationId,
                    architectOperations: architect.operations.length, calls };
            } finally { fetch = realFetch; }
        });
        assert.equal(result.lifePeople, 1);
        assert.equal(result.schedule, true);
        assert.equal(result.scheduleLocation, 'start');
        assert.equal(result.architectOperations, 0);
        assert.deepEqual(result.calls.map(call => call.maxTokens), [6500, 900, 4321, 4321]);
        assert.equal(result.calls[2].responseFormat, true);
        assert.equal(result.calls[3].responseFormat, false);
        assert.deepEqual(errors, []);
        console.log('PASS: World life, schedule and Studio requests share transport; unsupported JSON mode falls back');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
