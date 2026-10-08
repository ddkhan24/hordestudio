/** Offline compatibility matrix for OpenAI-style Worlds completion transports. */
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
            if (url.hostname !== 'world-provider-compat.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, body: '' });
            }
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto('https://world-provider-compat.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const outcome = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const receipt = {
                summary: 'The room remains quiet.',
                scene: { player_location_id: 'hall', player_location_changed: false, present_character_ids: [] },
                events: [], entity_updates: [], state_updates: {}
            };
            const world = {
                id: 'provider_compat_fixture', name: 'Provider Compatibility Fixture',
                model: 'fixture/model', contextSize: 32768, maxTokens: 1024,
                dmPrompt: 'A quiet room.', intro: '', startLocationId: 'hall',
                locations: [{ id: 'hall', name: 'Hall', description: 'A quiet room.', exits: [] }],
                entities: [], kernel: { enabled: true, memoryMode: 'ledger', repairMode: 'adaptive' },
                hudConfig: { showClock: false, showQuests: false, showLedger: false, stats: [] },
                gameRules: { profileId: 'adventure', modules: {
                    stats: false, health: false, conditions: false, inventory: false,
                    checks: false, commerce: false, quests: false, relationships: false,
                    schedules: false, livingWorld: false
                } }
            };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.history.push({ id: 'opening', role: 'dm', text: 'The hall is quiet.', location: 'hall' });
            switchView('worldPlay');
            renderWorldPlayState();
            const initialLength = sess.history.length;
            let phase = '';
            const calls = [];
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                calls.push({ phase, stream: body.stream, hasTools: !!body.tools });
                if (!body.stream) throw new Error(`Unexpected secondary completion in ${phase}`);
                const completion = (content, withTool = false) => ({
                    choices: [{ message: { content,
                        ...(withTool ? { tool_calls: [{ index: 0, id: 'receipt-' + phase,
                            type: 'function', function: { name: 'commit_world_turn', arguments: JSON.stringify(receipt) } }] } : {}) },
                        finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 }
                });
                const inline = prose => `${prose}\n<world_turn_receipt>${JSON.stringify(receipt)}</world_turn_receipt>`;
                if (phase === 'sse_tool' || phase === 'sse_inline') {
                    const content = phase === 'sse_tool' ? 'The room is quiet.' : inline('The candle burns.');
                    const delta = { content };
                    if (phase === 'sse_tool') delta.tool_calls = completion('', true).choices[0].message.tool_calls;
                    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                if (phase === 'json_tool' || phase === 'json_tool_local') return new Response(JSON.stringify(completion('The stones are still.', true)),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (phase === 'json_inline') return new Response(JSON.stringify(completion(inline('The air is clear.'))),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (phase === 'malformed') return new Response('{"choices":[',
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (phase === 'malformed_sse') return new Response('data: not-json\n\ndata: [DONE]\n\n',
                    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                if (phase === 'empty') return new Response('{"choices":[]}',
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (phase === 'sse_provider_error') return new Response('data: {"error":{"message":"quota exceeded"}}\n\n',
                    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                if (phase === 'http_error') return new Response('{"error":{"message":"unsupported model"}}',
                    { status: 400, headers: { 'Content-Type': 'application/json' } });
                if (phase === 'tool_unsupported' || phase === 'tool_unsupported_local') {
                    if (body.tools) return new Response('{"error":{"message":"tool_choice is not supported"}}',
                        { status: 400, headers: { 'Content-Type': 'application/json' } });
                    return new Response(JSON.stringify(completion(inline('The quiet continues.'))),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (phase === 'auth_error') return new Response('{"error":{"message":"tools require authorization"}}',
                    { status: 401, headers: { 'Content-Type': 'application/json' } });
                if (phase === 'stalled_body') return new Response(new ReadableStream({ start() {} }),
                    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                throw new Error('Unrecognized phase');
            };
            const run = async (name, input) => {
                phase = name;
                state.globalSettings.apiProvider = name.endsWith('_local') ? 'local' : 'openrouter';
                if (name.endsWith('_local')) state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
                document.getElementById('world-user-input').value = input;
                const before = sess.history.length;
                const running = executeWorldTurn();
                if (name === 'stalled_body') {
                    setTimeout(() => worldGenController?.abort(), 30);
                    await Promise.race([running, new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('stalled stream did not release the turn')), 2000))]);
                } else await running;
                const dm = sess.history.slice(before).filter(message => message.role === 'dm').at(-1);
                return { before, after: sess.history.length,
                    source: dm?.stateSource || '', text: dm?.text || '',
                    input: document.getElementById('world-user-input').value,
                    turnBusy: worldTurnInProgress,
                    toast: document.querySelector('#toast-container .toast:last-child')?.textContent || '' };
            };
            const result = {
                sseTool: await run('sse_tool', 'I look around.'),
                sseInline: await run('sse_inline', 'I inspect the candle.'),
                jsonTool: await run('json_tool', 'I inspect the stones.'),
                jsonInline: await run('json_inline', 'I breathe.'),
                jsonToolLocal: await run('json_tool_local', 'I inspect the stones again.'),
                toolUnsupported: await run('tool_unsupported', 'I listen to the room.'),
                toolUnsupportedLocal: await run('tool_unsupported_local', 'I listen locally.'),
                malformed: await run('malformed', 'I listen.'),
                malformedSse: await run('malformed_sse', 'I watch the doorway.'),
                empty: await run('empty', 'I wait here.'),
                sseProviderError: await run('sse_provider_error', 'I inspect the ceiling.'),
                httpError: await run('http_error', 'I ask for news.'),
                authError: await run('auth_error', 'I ask the door.'),
                stalled: await run('stalled_body', 'I examine the wall.'),
                calls, initialLength
            };
            return result;
        });
        assert.equal(outcome.sseTool.source, 'tool_call');
        assert.equal(outcome.sseTool.text, 'The room is quiet.');
        assert.equal(outcome.sseInline.source, 'inline_rescue');
        assert.equal(outcome.sseInline.text, 'The candle burns.');
        assert.equal(outcome.jsonTool.source, 'tool_call');
        assert.equal(outcome.jsonTool.text, 'The stones are still.');
        assert.equal(outcome.jsonInline.source, 'inline_rescue');
        assert.equal(outcome.jsonInline.text, 'The air is clear.');
        assert.equal(outcome.jsonToolLocal.source, 'tool_call');
        assert.equal(outcome.jsonToolLocal.text, 'The stones are still.');
        assert.equal(outcome.toolUnsupported.source, 'inline_rescue');
        assert.equal(outcome.toolUnsupported.text, 'The quiet continues.');
        assert.equal(outcome.toolUnsupportedLocal.source, 'inline_rescue');
        assert.equal(outcome.toolUnsupportedLocal.text, 'The quiet continues.');
        for (const [label, item] of Object.entries({ malformed: outcome.malformed,
            malformedSse: outcome.malformedSse, empty: outcome.empty,
            sseProviderError: outcome.sseProviderError, httpError: outcome.httpError,
            authError: outcome.authError, stalled: outcome.stalled })) {
            assert.equal(item.after, item.before, `${label} must not add an unverified DM message`);
            assert(item.input, `${label} must preserve the unsent player action`);
            assert.equal(item.turnBusy, false, `${label} must unlock the composer`);
            assert(item.toast, `${label} must display a failure notice`);
        }
        assert.match(outcome.malformed.toast, /neither streaming events nor a valid JSON/i);
        assert.match(outcome.malformedSse.toast, /no chat-completion choice/i);
        assert.match(outcome.empty.toast, /no chat-completion choices/i);
        assert.match(outcome.sseProviderError.toast, /quota exceeded/i);
        assert.match(outcome.httpError.toast, /unsupported model/i);
        assert.match(outcome.authError.toast, /authorization/i);
        assert.match(outcome.stalled.toast, /stopped/i);
        assert.equal(outcome.calls.length, 16, 'only unsupported-tools 400s may trigger a second request');
        assert(outcome.calls.every(call => call.stream));
        assert.equal(outcome.calls.filter(call => !call.hasTools).length, 2);
        assert.deepEqual(outcome.calls.filter(call => call.phase === 'tool_unsupported').map(call => call.hasTools),
            [true, false]);
        assert.deepEqual(outcome.calls.filter(call => call.phase === 'tool_unsupported_local').map(call => call.hasTools),
            [true, false]);
        assert.deepEqual(pageErrors, []);
        console.log('PASS: Worlds provider matrix: SSE tool/inline, JSON tool/inline, unsupported-tool fallback, malformed/empty/HTTP, stalled abort');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
