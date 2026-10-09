/** Ordinary Chat release regressions. Actual app + IndexedDB; fixture transport only. */
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
            if (url.hostname !== 'chat-release.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '{}' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        page.on('console', message => { if (message.text().startsWith('RELEASE CHECK:')) console.log(message.text()); });
        const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto('https://chat-release.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            labsProposal = async () => null;
            HordeVectorMemory.search = async () => [];
            consolidateSessionEpisodicMemory = async () => {};
            updateChatHudFromTurn = async () => {};
            const checks = [], encoder = new TextEncoder(), realSave = saveState, realPersist = persistStateSnapshot, realFetch = window.fetch;
            const input = document.getElementById('user-input');
            const ok = (condition, name) => { if (!condition) throw Error(name); checks.push(name); console.log('RELEASE CHECK: ' + name); };
            const json = content => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
            const event = (content, finish_reason = null) => 'data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason }] }) + '\n';
            const stream = text => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
            const until = async condition => { for (let n = 0; n < 200 && !condition(); n++) await new Promise(resolve => setTimeout(resolve, 5)); if (!condition()) throw Error('Fixture did not reach awaited boundary'); };
            let a, b, calls, requests;
            const fixture = () => {
                saveState = realSave; persistStateSnapshot = realPersist; HordeVectorMemory.search = async () => [];
                a = { id: 'sa', name: 'A', ledger: 'A_SECRET belongs to Alice.', messages: [] };
                b = { id: 'sb', name: 'B', ledger: 'B_SECRET belongs to Bob.', messages: [] };
                state.characters = ['a', 'b'].map(id => ({ id, name: id === 'a' ? 'Alice' : 'Bob', model: 'fixture/' + id,
                    prompt: id.toUpperCase() + '_PROMPT for {{user}}. Latest: {{lastUserMessage}}', contextSize: 32768, maxTokens: 2048, intro: '' }));
                state.personas = [{ id: 'pa', name: 'Persona A', text: 'PERSONA_A' }, { id: 'pb', name: 'Persona B', text: 'PERSONA_B' }];
                state.activePersonaId = 'pa'; state.activeCharId = 'a'; state.activeRoomId = null;
                state.chats = { a: [a], b: [b] }; state.activeSessionId = { a: 'sa', b: 'sb' }; state.chatContinuities = {};
                chatPendingAttachments.clear(); chatWebSearchBySession.clear(); chatImageModeBySession.clear();
                state.globalSettings.apiProvider = 'openrouter'; state.globalSettings.slopStripper = false; state.apiKey = 'offline';
                calls = 0; requests = []; input.value = ''; switchView('chat'); renderChat();
            };
            const transport = responder => { window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++; requests.push(JSON.parse(options.body)); return responder(options);
            }; };

            const tail = await readChatProviderReply(stream(event('Final EOF').trimEnd()), new AbortController().signal);
            ok(tail.content === 'Final EOF', 'final SSE line without newline is read');
            let cancelled = 0;
            const open = new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(event('Done') + 'data: [DONE]\n')); }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
            const done = await readChatProviderReply(open, new AbortController().signal);
            ok(done.content === 'Done' && cancelled === 1, '[DONE] closes a provider stream that leaves its socket open');
            const fallback = await readChatProviderReply(new Response(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'JSON fallback' }], annotations: [{ url_citation: { url: 'https://example.test/source', title: 'Source' } }] } }] })), new AbortController().signal);
            ok(fallback.content === 'JSON fallback' && fallback.citations.length === 1, 'JSON fallback, content arrays and citations survive');
            for (const response of [stream('data: {"error":{"message":"quota exhausted"}}\n'), stream('data: {broken}\n'), json('')]) {
                let rejected = false; try { await readChatProviderReply(response, new AbortController().signal); } catch (_) { rejected = true; }
                ok(rejected, 'provider error, malformed event or empty completion fails visibly');
            }

            fixture(); transport(() => stream('data: {"error":{"message":"quota exhausted"}}\n')); input.value = 'Keep my draft'; await handleChat();
            ok(a.messages.length === 0 && input.value === 'Keep my draft' && !chatTurnInProgress && !generationController, 'stream errors restore the draft and release the send lock');
            fixture(); transport(() => json('')); input.value = 'Empty reply retry'; await handleChat();
            ok(a.messages.length === 0 && input.value === 'Empty reply retry', 'empty replies are never saved as successful answers');

            fixture(); let rejectFetch;
            transport(() => new Promise((_, reject) => { rejectFetch = reject; })); input.value = 'Original submitted draft';
            const failing = handleChat(); await until(() => !!rejectFetch); input.value = 'New draft during reply'; rejectFetch(Error('Fixture offline')); await failing;
            ok(a.messages.length === 1 && a.messages[0].content === 'Original submitted draft' && input.value === 'New draft during reply', 'provider failure retains the submitted message without overwriting a newer draft');

            fixture(); transport(() => json('Must not submit')); persistStateSnapshot = async () => { throw new DOMException('Initial quota failure', 'QuotaExceededError'); };
            input.value = 'Initial saved draft'; await handleChat(); persistStateSnapshot = realPersist; await realSave();
            ok(calls === 0 && a.messages.length === 1 && a.messages[0].content === 'Initial saved draft' && !chatTurnInProgress && (await HordeDB.get('chats')).a[0].messages.length === 1, 'initial storage failure keeps the draft in its timeline and submits no provider call');

            fixture(); const original = { id: 'selected-take', role: 'assistant', charId: 'a', content: 'Selected first', versions: ['Selected first', 'Unselected second'], currentVersion: 0,
                versionLedgerEntries: ['Selected promise.', 'Other promise.'], ledgerEntry: 'Selected promise.', citations: [{ url: 'https://example.test/original', title: 'Original' }], customMetadata: 'preserve' };
            a.messages = [{ id: 'u', role: 'user', content: 'Try again' }, original]; a.ledger = 'Selected promise.';
            const before = JSON.stringify(original); transport(() => stream('data: {"error":{"message":"reroll denied"}}\n')); await handleChat(true);
            ok(a.messages.length === 2 && JSON.stringify(a.messages.at(-1)) === before && a.ledger.includes('Selected promise.'), 'failed reroll restores the selected take with its identity, citations and metadata');

            fixture(); transport(() => json('Saved reply.\n[MEMORY]: Alice promises to return the key.')); input.value = 'Promise'; await handleChat();
            const stored = await HordeDB.get('chats');
            ok(a.messages.at(-1).content === 'Saved reply.' && stored.a[0].messages.at(-1).content === 'Saved reply.' && a.ledger.includes('Alice promises'), 'JSON replies and hidden chronicle entries persist to IndexedDB');

            fixture(); let resolveFetch; transport(() => new Promise(resolve => { resolveFetch = resolve; })); input.value = 'One'; const first = handleChat(); await until(() => !!resolveFetch);
            const confirmModal = showConfirmModal; let confirming;
            showConfirmModal = (_title, _message, callback) => { confirming = callback(); };
            document.getElementById('clear-history-btn').onclick(); await confirming;
            ok(state.chats.a[0] === a && a.messages.length === 1, 'history clear cannot detach a timeline held by an in-flight reply');
            purgeAllData(); await confirming; showConfirmModal = confirmModal;
            ok(!HordeDB.closedIntentionally && state.chats.a[0] === a, 'data purge cannot discard active generation or close its database');
            let blockedBackup = false; try { await exportFullBackup(); } catch (error) { blockedBackup = /still running/.test(error.message); }
            ok(blockedBackup, 'full backup cannot capture an incomplete chat transaction');
            input.value = 'Second draft'; await handleChat(); resolveFetch(json('Only one reply')); await first;
            ok(calls === 1 && a.messages.length === 2 && input.value === 'Second draft', 'concurrent sends start one provider request and preserve the next draft');

            fixture(); const realAttachment = persistChatAttachment; let releaseAttachment;
            state.characters[0].chatCapabilities = { imageUpload: true }; state.characters[0].modelInputModalities = ['text', 'image'];
            const oldAttachment = { kind: 'image', file: new File(['original'], 'original.png', { type: 'image/png' }) };
            const nextAttachment = { kind: 'image', file: new File(['next'], 'next.png', { type: 'image/png' }) };
            chatPendingAttachments.set(a.id, [oldAttachment]);
            persistChatAttachment = async item => { await new Promise(resolve => { releaseAttachment = resolve; }); return { kind: 'image', url: 'data:image/png;base64,aQ==', name: item.file.name }; };
            transport(() => json('Media reply')); input.value = 'Original media turn'; const mediaTurn = handleChat(); await until(() => !!releaseAttachment);
            input.value = 'New composer draft'; chatPendingAttachments.get(a.id).push(nextAttachment); releaseAttachment(); await mediaTurn; persistChatAttachment = realAttachment;
            ok(input.value === 'New composer draft' && chatPendingAttachments.get(a.id).length === 1 && chatPendingAttachments.get(a.id)[0] === nextAttachment && a.messages.length === 2, 'attachment storage consumes only the submitted draft and preserves newer text and attachments');

            fixture(); let releaseSave, saveStarted = false;
            saveState = async (...args) => { saveStarted = true; await new Promise(resolve => { releaseSave = resolve; }); return realSave(...args); };
            transport(() => json('Should not run')); input.value = 'Saved before navigating'; const saving = handleChat(); await until(() => saveStarted);
            state.activeCharId = 'b'; state.activePersonaId = 'pb'; renderChat(); input.value = 'B draft'; releaseSave(); await saving;
            ok(calls === 0 && a.messages.length === 1 && b.messages.length === 0 && input.value === 'B draft', 'navigation during the initial save cannot use the next character or consume its draft');

            fixture(); let reply; transport(() => new Promise(resolve => { reply = resolve; })); input.value = 'A question'; const pending = handleChat(); await until(() => !!reply);
            state.activeCharId = 'b'; state.activePersonaId = 'pb'; renderChat(); input.value = 'B untouched'; reply(json('A answer.\n[MEMORY]: Alice owns the blue key.')); await pending;
            ok(requests[0].model === 'fixture/a' && a.messages.at(-1).content === 'A answer.' && a.ledger.includes('blue key') && b.messages.length === 0 && !b.ledger.includes('blue key') && input.value === 'B untouched'
                && state.chatContinuities[a.continuityId].records.some(memory => memory.text.includes('blue key') && memory.personaId === 'pa'), 'navigation during a response keeps reply, chronicle and memory provenance on the originating timeline');

            fixture(); let releaseMemory, memoryStarted = false; state.characters[0].memory = [{ text: 'A biography' }];
            HordeVectorMemory.search = async () => { if (!memoryStarted) { memoryStarted = true; await new Promise(resolve => { releaseMemory = resolve; }); } return []; };
            transport(() => json('Correct origin')); input.value = 'Original prompt'; const recalling = handleChat(); await until(() => memoryStarted);
            state.activeCharId = 'b'; state.activePersonaId = 'pb'; renderChat(); releaseMemory(); await recalling;
            const prompt = JSON.stringify(requests[0].messages);
            ok(prompt.includes('A_SECRET') && prompt.includes('PERSONA_A') && prompt.includes('Persona A') && !prompt.includes('B_SECRET') && !prompt.includes('PERSONA_B'), 'memory lookup and macro expansion retain the original session and persona after navigation');

            fixture(); let writes = 0; transport(() => json('Complete despite quota')); input.value = 'Save safely';
            persistStateSnapshot = async (...args) => { if (++writes === 2) throw new DOMException('Fixture disk full', 'QuotaExceededError'); return realPersist(...args); };
            await handleChat(); persistStateSnapshot = realPersist; await realSave();
            ok(a.messages.length === 2 && a.messages.at(-1).content === 'Complete despite quota' && (await HordeDB.get('chats')).a[0].messages.length === 2, 'storage failure preserves the complete reply for retry without duplicating or restoring another take');

            fixture(); transport(() => new Promise(() => {})); const nativeTimeout = window.setTimeout;
            window.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms === 120000 ? 20 : ms, ...args);
            input.value = 'Timeout draft'; await handleChat(); window.setTimeout = nativeTimeout;
            ok(input.value === 'Timeout draft' && a.messages.length === 0 && !generationController && !chatTurnInProgress, 'a hung provider settles at the request deadline without losing its draft');

            fixture(); state.characters[0].memory = [{ text: 'Pending vector lookup' }]; HordeVectorMemory.search = async () => new Promise(() => {});
            transport(() => json('Must not call')); window.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms === 120000 ? 20 : ms, ...args);
            input.value = 'Memory timeout draft'; await handleChat(); window.setTimeout = nativeTimeout;
            ok(calls === 0 && a.messages.length === 0 && input.value === 'Memory timeout draft' && !generationController && !chatTurnInProgress, 'a stuck context lookup settles at the deadline before submitting a chat request');

            fixture(); transport(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(event('Visible partial.\n[MEMORY]: Secret incomplete promise.\n<horde_status>{"private":true}</horde_status>'))); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
            input.value = 'Stop this'; const stopping = handleChat(); await until(() => document.getElementById('messages-container').textContent.includes('Visible partial.'));
            generationController.abort(); await stopping;
            ok(a.messages.at(-1).content === 'Visible partial.' && !a.ledger.includes('Secret incomplete'), 'stopped replies retain visible prose without partial chronicle or private HUD directives');
            return { checks, passed: checks.length };
        });
        assert.equal(result.passed, 24); assert.deepEqual(pageErrors, []);
        console.log(JSON.stringify(result, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
