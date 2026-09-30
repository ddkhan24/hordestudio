'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png'};
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    fs.createReadStream(file).pipe(response);
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(launchOptions);
    try {
        const page = await browser.newPage({viewport:{width:1280,height:900}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.address().port}/`)
            ? route.continue() : route.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => typeof buildContext === 'function' && typeof renderFreakyPresetMessage === 'function');
        const audit = await page.evaluate(async () => {
            const latest = getAllPresets().find(p => p.id === FREAKY_FRANKENSTEIN_5_4_ID);
            if (!latest) throw Error('FF5.4 not in live preset list');
            const starterWorld = STARTER_WORLDS.find(world => world.id === 'world_aldenmere');
            if (starterWorld?.activePresetId !== latest.id) throw Error('new starter world still defaults to FF4');
            const worldMacros = createFreakyPresetMacroState(starterWorld);
            const byId = new Map(latest.data.prompts.map(prompt => [prompt.identifier, prompt]));
            const worldModules = latest.data.prompt_order[0].order
                .filter(entry => entry.enabled)
                .map(entry => byId.get(entry.identifier))
                .filter(prompt => prompt && !prompt.marker && !skipFreakyWorldMechanic(latest, prompt))
                .map(prompt => expandFreakyPresetMacros(prompt.content || '', worldMacros))
                .join('\n');
            if (!worldModules.includes('<npc_voice>') || worldModules.includes('<internal_states_module>'))
                throw Error('FF5 world adapter lost prose or duplicated state ownership');
            if (/<(?:system_state|header_instructions|adult_mode|combat|formatting_constraints|professional_legality)\b/i.test(worldModules))
                throw Error('World received FF5 rules that conflict with its engine or scenario');
            const worldEstimateDelta = estimateWorldPromptTokens(starterWorld, latest)
                - estimateWorldPromptTokens(starterWorld, null);
            if (worldEstimateDelta <= 0 || worldEstimateDelta > Math.ceil(worldModules.length / 3.2) + 100)
                throw Error('World context estimate still counts FF5 modules that are not sent');
            const character = {
                id:'ff54-audit-character', name:'Ash', prompt:'Ash is an adult detective in a rainy town.',
                personality:'Observant, stubborn and private.', scenario:'An empty railway station.',
                activePresetId:latest.id, contextSize:32768, maxTokens:4096, model:'fixture',
                memory:[], lorebook:[], authorsNote:'', hideTopLines:0, hideBottomLines:0
            };
            state.characters.push(character);
            state.activeCharId = character.id;
            state.activeRoomId = null;
            const stateBlock = '<!-- GFX_START --><internal_states><details><summary>INTERNAL STATES</summary><details><summary>NPC AGENDAS</summary>Ash plans to visit the pier.</details></details></internal_states><!-- GFX_END -->';
            const messages = [
                {role:'user',content:'What happened at the station?'},
                {role:'assistant',content:'She reads a sign. '+stateBlock},
                {role:'user',content:'And now?'}
            ];
            state.chats[character.id] = [{id:'ff54-session',name:'Audit',messages}];
            state.activeSessionId[character.id] = 'ff54-session';
            const prepared = await buildContext(character, character, messages, '');
            const combined = prepared.map(message => message.content).join('\n');
            const specialMacro = /\{\{(?:setvar|getvar|addvar|incvar|roll|maxContext|maxResponse)(?:::|\}\})/i;
            if (specialMacro.test(combined)) throw Error('Live prompt has unresolved FF5 macros');
            if (!combined.includes('<internal_states_module>') || !combined.includes('Ash plans to visit the pier.'))
                throw Error('Live FF5 prompt lost internal-state creation or continuity');
            if (!combined.includes('adult detective') || !combined.includes('An empty railway station.'))
                throw Error('Character card markers were lost');
            if (!prepared.some(message => message.role === 'user' && message.content.includes('DND TASK SIM')))
                throw Error('Depth-injected FF5 mechanics were lost');
            updatePresetCompatibilityHint(latest.id);
            updatePresetCompatibilityHint(latest.id, true);
            if (!document.querySelector('#preset-compatibility-hint').textContent.includes('Internal States')
                || !document.querySelector('#w-preset-compatibility-hint').textContent.includes('Horde’s World engine'))
                throw Error('FF5 scope is not explained in the Studio UI');
            state.editingWorld = starterWorld;
            renderPresetEditor('world');
            const engineOwnedControls = document.querySelectorAll('.preset-block-editor[data-engine-owned="true"] input:disabled').length;
            if (engineOwnedControls < 8) throw Error('World duplicate mechanics are editable despite being bypassed');
            const human = normalizeCompanion({id:'ff-scope-human', name:'Mara', age:29,
                personality:'A private, practical mechanic.', createdAt:Date.now() - 86400000});
            const humanPrompt = buildCompanionMessages(human, [
                {id:'vh-user', role:'user', type:'text', text:'How is your day?', timestamp:Date.now(), readAt:Date.now()}
            ], Date.now(), {performanceOnly:true, experience:{realTimeLife:false}});
            const humanText = JSON.stringify(humanPrompt);
            if (/Freaky Frankenstein|<internal_states_module>|<npc_voice>|<adult_mode>/i.test(humanText))
                throw Error('Character/World preset leaked into a Virtual Human request');
            renderChat();
            const transcript = document.querySelector('#messages-container');
            if (!transcript?.querySelector('.ff-internal-states')) throw Error('Internal states are not visible as disclosures');
            if (transcript.querySelectorAll('.ff-details').length < 2) throw Error('Nested FF5 state sections were flattened');
            return {
                presets:getAllPresets().map(p=>p.name), worldModules:worldModules.length, worldEstimateDelta,
                messages:prepared.length,
                systemChars:prepared[0].content.length,
                stateSections:transcript.querySelectorAll('.ff-details').length,
                engineOwnedControls,
                humanPromptIsolated:true,
                historyStateCount:prepared.filter(m=>m.role==='assistant'&&m.content.includes('<internal_states>')).length
            };
        });
        assert.equal(audit.historyStateCount, 1);
        const turn = await page.evaluate(async () => {
            const originalFetch = window.fetch;
            const originalHud = updateChatHudFromTurn;
            const originalConsolidate = consolidateSessionEpisodicMemory;
            let request = null;
            updateChatHudFromTurn = async () => {};
            consolidateSessionEpisodicMemory = async () => {};
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:43219/v1';
            const reply = '<gold:measured>"Meet me at the pier."</gold:measured>\n'
                + '<!-- GFX_START --><internal_states><details><summary>INTERNAL STATES</summary>'
                + '<details><summary>NPC AGENDAS</summary>Ash heads to the pier.</details>'
                + '</details></internal_states><!-- GFX_END -->';
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions')) return originalFetch(url, options);
                request = JSON.parse(options.body);
                const payload = `data: ${JSON.stringify({choices:[{delta:{content:reply},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`;
                return new Response(new ReadableStream({start(controller) {
                    controller.enqueue(new TextEncoder().encode(payload)); controller.close();
                }}), {status:200, headers:{'Content-Type':'text/event-stream'}});
            };
            try {
                document.querySelector('#user-input').value = 'What happens next?';
                await handleChat();
                const messages = getCurrentSession().messages;
                const last = messages.at(-1);
                if (last.role !== 'assistant' || !last.content.includes('<internal_states>'))
                    throw Error('Mocked provider turn did not save FF5 state');
                if (!document.querySelector('#messages-container .ff-color-gold'))
                    throw Error('Mocked provider dialogue was not styled');
                if (!document.querySelector('#messages-container .ff-internal-states'))
                    throw Error('Mocked provider state was not rendered');
                if (!request?.messages?.some(message => message.content.includes('<internal_states_module>')))
                    throw Error('Provider did not receive FF5 state instructions');
                return {savedMessages:messages.length, providerMessages:request.messages.length, styledDialogue:true};
            } finally {
                window.fetch = originalFetch;
                updateChatHudFromTurn = originalHud;
                consolidateSessionEpisodicMemory = originalConsolidate;
            }
        });
        const longChat = await page.evaluate(() => {
            const session = getCurrentSession();
            const original = session.messages;
            const stateBlock = '<!-- GFX_START --><internal_states><details><summary>INTERNAL STATES</summary>'
                + '<details><summary>NPC AGENDAS</summary>Ash walks to the pier.</details>'
                + '</details></internal_states><!-- GFX_END -->';
            session.messages = Array.from({length:340}, (_, index) => ({
                id:`ff-stress-${index}`, role:index % 2 ? 'assistant' : 'user',
                content:index % 2 ? `<teal>"Turn ${index}."</teal> ${stateBlock}` : `Continue ${index}.`
            }));
            const start = performance.now();
            renderChat();
            const elapsedMs = Math.round(performance.now() - start);
            const rendered = document.querySelectorAll('#messages-container .message').length;
            session.messages = original;
            renderChat();
            return {elapsedMs, rendered};
        });
        assert.equal(longChat.rendered, 340);
        assert(longChat.elapsedMs < 8000, `long FF5 transcript took ${longChat.elapsedMs}ms to render`);
        assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
        console.log('PASS live browser FF5.4 preset selection, prompt assembly, macros, depth injections, state continuity, nested rendering, mocked provider turn, and long transcript', audit, turn, longChat);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
