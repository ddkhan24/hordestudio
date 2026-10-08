/** Actual application turn path with scripted provider responses, no API spend. */
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
            if (url.hostname !== 'scene-draft.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://scene-draft.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async provider => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = provider;
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const world = { id: 'scene_draft_fixture', name: 'Office', model: 'fixture/model',
                contextSize: 32768, maxTokens: 2048, dmPrompt: 'An examiner waits in the office.', intro: '',
                startLocationId: 'office', locations: [{ id: 'office', name: 'Office', exits: ['to Hall'] },
                    { id: 'hall', name: 'Hall', exits: ['to Office'] }],
                entities: [{ id: 'denton', name: 'Denton', type: 'npc', startLocation: 'office', persona: 'Manager' },
                    { id: 'examiner', name: 'Examiner', type: 'npc', startLocation: 'office', persona: 'Auditor' }],
                kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true },
                hudConfig: { startTimeHours: 8, startTimeMinutes: 57, timeStep: 5 } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            for (const id of ['denton', 'examiner']) sess.entityStates[id].location = 'office';
            sess.history.push({ id: 'opening', role: 'dm', text: 'Denton and the examiner wait beside you.', location: 'office' });
            switchView('worldPlay'); renderWorldPlayState();
            let phase = 'establish';
            let calls = 0;
            let contract = null;
            let checkCall = 0;
            let secretCall = 0;
            const input = 'I alert Denton and ask the deadline.';
            const answer = 'Examiner: “The files are due by 5 PM today.”';
            const draft = { protocol: 'scene_draft_v2', narrative: `Denton hears that the examiner has arrived.\n\n${answer}`,
                actions: [{ request: 'I alert Denton ', kind: 'speech', status: 'resolved', response: 'Denton hears that the examiner has arrived.' },
                    { request: 'and ask the deadline.', kind: 'question', status: 'answered', response: answer }],
                events: [], effects: {}, speech: [{ speaker: 'player', listeners: ['denton'], statement: 'Denton hears that the examiner has arrived.' }],
                commitments: [{ id: 'audit_due', title: 'Reserve files', description: 'Produce the reserve files.', day: 1,
                    minute_of_day: 1020, location_id: 'office', status: 'scheduled', reschedule: false, evidence: answer }] };
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const body = JSON.parse(options.body);
                if(phase==='malformed_transport' && body.stream && body.tools) {
                    const bad={tool_calls:[{id:'bad',index:0,type:'function',function:{name:'commit_world_turn',arguments:'{"protocol": <broken function tokens>'}}]};
                    return new Response(`data: ${JSON.stringify({choices:[{delta:bad,finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
                }
                if(phase==='malformed_transport' && !body.stream && body.tools) throw Error('Syntax failure retried broken function channel');
                if(phase==='json_transport' && body.tools) throw Error('Successful plain JSON transport was not remembered');
                contract = body.tools?.find(tool => tool.function.name === 'commit_world_turn')?.function.parameters || contract;
                let proposal = structuredClone(draft);
                if (phase === 'check') {
                    checkCall++;
                    if (!body.tools) return new Response(JSON.stringify({choices:[{message:{content:sess.checkHistory.at(-1).narrativeOutcome}}]}),{headers:{'Content-Type':'application/json'}});
                    proposal = { protocol:'scene_draft_v2', narrative:'The label reads Audit. You inspect the jammed drawer; the careful search is uncertain.',
                        actions:[{request:'What does the label say? ',kind:'question',status:'answered',response:'The label reads Audit.'},
                            {request:'I inspect the jammed drawer.',kind:'physical',status:'pending_check',response:'You inspect the jammed drawer; the careful search is uncertain.'}],
                        events:[{type:'observation',actor_id:'player',status:'completed',evidence:'The label reads Audit.',observation:'The label reads Audit.'}], effects:{checks:[{id:'drawer_search',label:'Search the drawer',stat_id:'wits',difficulty:5,
                            success_text:'The careful search reveals the audit stamp.',failure_text:'The drawer stays jammed.',on_success:{},on_failure:{}}]},speech:[],commitments:[] };
                }
                if (phase === 'secret') {
                    secretCall++;
                    if (secretCall === 1) {
                        const message={tool_calls:[{id:'secret-call',index:0,type:'function',function:{name:'investigate_secret',arguments:'{"label":"hidden_note"}'}}]};
                        return new Response(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
                    }
                    if (!JSON.stringify(body.messages).includes('The code is violet.')) throw Error('Verified secret missing from draft continuation');
                    proposal={protocol:'scene_draft_v2',narrative:'The hidden note reads: “The code is violet.”',
                        actions:[{request:'I examine the hidden note.',kind:'observation',status:'resolved',response:'The hidden note reads: “The code is violet.”'}],
                        events:[],effects:{ledger_update:'The hidden note reveals the code is violet.'},speech:[],commitments:[]};
                }
                if (phase === 'wait') proposal = { protocol: 'scene_draft_v2',
                    narrative: 'You wait eight hours without delivering the files.',
                    actions: [{ request: 'I wait eight hours.', kind: 'wait', status: 'resolved', response: 'You wait eight hours without delivering the files.' }],
                    events: [{ type: 'time', actor_id: 'player', status: 'completed', minutes_elapsed: 480,
                        evidence: 'You wait eight hours without delivering the files.' }], effects: {}, speech: [], commitments: [] };
                if (phase === 'wait_resolve') proposal = {protocol:'scene_draft_v2',
                    narrative:'You wait twenty minutes. The delivery deadline passes; you record the missed delivery in the audit log.',
                    actions:[{request:'I wait twenty minutes.',kind:'wait',status:'resolved',response:'You wait twenty minutes.'}],
                    events:[{type:'time',actor_id:'player',status:'completed',minutes_elapsed:20,evidence:'You wait twenty minutes.'},
                        {type:'interaction',actor_id:'player',status:'completed',action:'records missed delivery',evidence:'you record the missed delivery in the audit log.'}],
                    effects:{ledger_update:'The delivery was missed and logged.'},speech:[],commitments:[],
                    resolutions:[{id:'same_turn_deadline',event_index:1,response:'you record the missed delivery in the audit log.'}]};
                if (phase === 'resolve') proposal = { protocol: 'scene_draft_v2',
                    narrative: 'Examiner: “I record a failure to produce the files and open a formal audit.”',
                    actions: [{ request: 'What is the consequence?', kind: 'question', status: 'answered',
                        response: 'I record a failure to produce the files and open a formal audit.' }],
                    events: [{ type: 'interaction', actor_id: 'examiner', status: 'completed',
                        action: 'records failure to produce files', evidence: 'I record a failure to produce the files and open a formal audit.' }],
                    effects: { ledger_update: 'The examiner recorded a failure to produce the files and opened a formal audit.' },
                    speech: [], commitments: [], resolutions: [{ id: 'audit_due', event_index: 0,
                        response: 'I record a failure to produce the files and open a formal audit.' }] };
                if (phase === 'move') proposal = { protocol: 'scene_draft_v2', narrative: 'You reach the hall.',
                    actions: [{ request: 'I go to the hall.', kind: 'travel', status: 'resolved', response: 'You reach the hall.' }],
                    events: [{ type: 'movement', actor_id: 'player', status: 'completed', from_location_id: 'office',
                        to_location_id: 'hall', movement_mode: 'voluntary', evidence: 'You reach the hall.' }],
                    effects: {}, speech: [], commitments: [] };
                if (phase === 'save_failure') proposal = { protocol: 'scene_draft_v2', narrative: 'You take the brass key.',
                    actions: [{ request: 'I take the brass key.', kind: 'physical', status: 'resolved', response: 'You take the brass key.' }],
                    events: [{ type: 'inventory', actor_id: 'player', status: 'completed', action: 'add',
                        item: 'brass key', evidence: 'You take the brass key.' }], effects: {}, speech: [], commitments: [] };
                if (phase === 'invalid') proposal.commitments[0].minute_of_day = 1022;
                if(['malformed_transport','json_transport'].includes(phase)) proposal={protocol:'scene_draft_v2',
                    narrative:'The doorway remains clear.',actions:[{request:'I check the doorway.',kind:'observation',status:'resolved',response:'The doorway remains clear.'}],
                    events:[],effects:{},speech:[],commitments:[]};
                if (phase === 'invalid_arrival') proposal = { protocol:'scene_draft_v2',
                    narrative:'Denton steals all the files and leaves forever.', actions:[], events:[],
                    effects:{unsupported:true},speech:[],commitments:[] };
                if (phase === 'repair') {
                    if (body.stream) proposal.effects = { unsupported: true };
                }
                // Exercise the published linked-passage contract, not merely
                // the older quote-based compiler compatibility path.
                const passages = [{ id: 'scene', text: proposal.narrative }];
                proposal.narrative = passages;
                proposal.actions = proposal.actions.map(({response, ...a}) => ({...a,response_id:'scene'}));
                proposal.events = proposal.events.map(({evidence, ...e}) => ({...e,passage_id:'scene'}));
                proposal.speech = proposal.speech.map(({statement, ...s}) => ({...s,passage_id:'scene'}));
                proposal.commitments = proposal.commitments.map(({evidence, ...c}) => ({...c,passage_id:'scene'}));
                if (proposal.resolutions) proposal.resolutions = proposal.resolutions.map(({response, ...r}) => ({...r,passage_id:'scene'}));
                const message = { tool_calls: [{ id: `call-${calls}`, type: 'function', index: 0,
                    function: { name: 'commit_world_turn', arguments: JSON.stringify(proposal) } }] };
                if(phase==='json_transport') return new Response(`data: ${JSON.stringify({choices:[{delta:{content:JSON.stringify(proposal)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
                return body.stream
                    ? new Response(`data: ${JSON.stringify({ choices: [{ delta: message, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
                        { headers: { 'Content-Type': 'text/event-stream' } })
                    : new Response(JSON.stringify({ choices: [{ message: body.tools ? message : {content:JSON.stringify(proposal)} }] }), { headers: { 'Content-Type': 'application/json' } });
            };
            const run = async () => {
                document.getElementById('world-user-input').value = phase === 'wait' ? 'I wait eight hours.'
                    : phase === 'check' ? 'What does the label say? I inspect the jammed drawer.'
                    : phase === 'secret' ? 'I examine the hidden note.'
                    : phase === 'wait_resolve' ? 'I wait twenty minutes.'
                    : ['malformed_transport','json_transport'].includes(phase) ? 'I check the doorway.'
                    : phase === 'resolve' ? 'What is the consequence?'
                    : phase === 'move' ? 'I go to the hall.'
                    : phase === 'save_failure' ? 'I take the brass key.' : input;
                await executeWorldTurn();
                return { text: sess.history.at(-1)?.text, audit: safeJsonClone(sess.lastTurnAudit),
                    due: sess.scheduledEvents.find(event => event.id === 'audit_due')?.dueMinute,
                    observations: safeJsonClone(sess.entityStates.denton.observations),
                    location: sess.playerLocation, inventory: safeJsonClone(sess.inventory), calls };
            };
            const first = await run();
            const second = await run();
            phase = 'repair'; const repaired = await run();
            phase = 'invalid'; const invalid = await run();
            phase = 'wait'; const waited = await run();
            phase = 'resolve'; const resolved = await run();
            phase = 'move'; const moved = await run();
            const beforeFailedSave = safeJsonClone(sess.inventory);
            const realSave = saveWorldsState;
            saveWorldsState = async () => { throw new Error('Injected storage failure'); };
            phase = 'save_failure'; const failedSave = await run();
            saveWorldsState = realSave;
            world.hudConfig.stats=[{id:'wits',name:'Wits',value:4,min:0,max:10,roll:{enabled:true,mode:'direct'}}];
            world.gameRules={profileId:'adventure',modules:{checks:true,stats:true},dice:{resolution:'automatic',sides:20,defaultDifficulty:5}};
            const realRoll=rollSecureDie;rollSecureDie=()=>20;
            phase='check';const checked=await run();rollSecureDie=realRoll;
            world.locations.find(l=>l.id==='hall').secrets=[{label:'hidden_note',hint:'A folded note in the frame.',truth:'The code is violet.'}];
            phase='secret';const discovered=await run();
            sess.scheduledEvents.push({id:'same_turn_deadline',title:'Delivery',status:'scheduled',urgent:true,
                sourceReceiptId:'test_setup',locationId:'hall',dueMinute:getWorldTimeData(world,sess).currentTotalMinutes+10});
            const beforeSameTurnTime=getWorldTimeData(world,sess).currentTotalMinutes;
            phase='wait_resolve';const sameTurn=await run();
            const sameTurnElapsed=getWorldTimeData(world,sess).currentTotalMinutes-beforeSameTurnTime;
            const sameTurnEvent=safeJsonClone(sess.scheduledEvents.find(e=>e.id==='same_turn_deadline'));
            phase='invalid_arrival';const arrivalStart=calls;
            await executeWorldTurn('look');
            const invalidArrival={calls:calls-arrivalStart,text:sess.history.at(-1)?.text,source:sess.history.at(-1)?.stateSource};
            let transport=null;
            if(provider==='openrouter') {
                phase='malformed_transport';const start=calls;const repair=await run();
                phase='json_transport';const recovered=await run();
                transport={repair,recovered,calls:calls-start};
            }
            normalizeLivingWorldState(world, sess);
            await saveWorldsState();
            const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions?.find(item => item.id === sess.id);
            window.fetch = realFetch;
            return { first, second, repaired, invalid, waited, resolved, moved, failedSave, beforeFailedSave, contract,
                checked,discovered,sameTurn,sameTurnEvent,sameTurnElapsed,invalidArrival,transport,checkCall,secretCall,secrets:saved.revealedSecrets,checks:saved.checkHistory,
                resolution: saved?.scheduledEvents?.find(event => event.id === 'audit_due')?.sceneResolution,
                pending: (saved?.consequences || []).filter(item => item.type === 'deadline' && item.state !== 'resolved'),
                savedDue: saved?.scheduledEvents?.find(event => event.id === 'audit_due')?.dueMinute };
        }, process.argv.includes('--local') ? 'local' : 'openrouter');
        assert.equal(result.first.calls, 1, JSON.stringify(result.first));
        assert.equal(result.first.audit.protocol, 'scene_draft_v2', JSON.stringify(result.first));
        assert.equal(result.first.due, 1020);
        assert.match(result.first.text, /5 PM/);
        assert(result.first.observations.some(obs => /examiner has arrived/.test(obs.text)));
        assert.equal(result.second.calls, 2, 'restatement needs one call');
        assert.equal(result.second.due, 1020);
        assert.equal(result.repaired.calls, 4, 'one draft and one correction, no narrator');
        assert.equal(result.repaired.audit.protocol, 'scene_draft_v2');
        assert.equal(result.invalid.calls, 6, 'invalid correction must stop after one retry');
        assert.equal(result.invalid.due, 1020, 'rejected draft cannot drift deadline');
        assert.equal(result.savedDue, 1020);
        assert.equal(result.waited.calls, 7, JSON.stringify(result.waited));
        assert.equal(result.resolved.calls, 8, JSON.stringify(result.resolved));
        assert.match(result.resolution, /formal audit/);
        assert.equal(result.pending.length, 0, 'observed consequence closes deadline task');
        assert.equal(result.moved.location, 'hall', JSON.stringify(result.moved));
        assert.equal(result.moved.calls, 9);
        assert.deepEqual(result.failedSave.inventory, result.beforeFailedSave,
            'unsaved scene must roll back its item transfer');
        assert(!result.contract.properties.scene, 'engine computes ending scene');
        assert(result.checked.text.includes(result.checks[0].narrativeOutcome),'prose must honor the actual roll, including failure');
        assert.equal(result.checkCall,2,'a check needs a draft and one resolved-result narration');
        assert.equal(result.checks.length,1,'the check resolves exactly once');
        assert.match(result.discovered.text,/code is violet/);
        assert.equal(result.secretCall,2,'secret lookup plus completed draft, no redundant narrator');
        assert(result.secrets.includes('hidden_note'));
        assert.equal(result.sameTurn.audit.protocol,'scene_draft_v2',JSON.stringify(result.sameTurn));
        assert.equal(result.sameTurnEvent.status,'triggered');
        assert.match(result.sameTurnEvent.sceneResolution,/missed delivery/);
        assert.equal(result.sameTurnElapsed,20,'declared scene duration must not gain an extra implicit turn step');
        assert.equal(result.invalidArrival.calls,2,'rejected arrival gets one correction, never an unverified narrator');
        assert.equal(result.invalidArrival.source,'frozen_no_receipt');
        assert(!result.invalidArrival.text.includes('steals all the files'));
        if(result.transport){assert.equal(result.transport.calls,3);assert.match(result.transport.repair.text,/doorway remains clear/);
            assert.match(result.transport.recovered.text,/doorway remains clear/);}
        const closeSettings = page.getByRole('button', { name: 'Close settings', exact: true });
        if (await closeSettings.isVisible()) await closeSettings.click();
        const inspector = page.locator('.world-turn-changes').first();
        assert(await inspector.count(), 'committed changes must be inspectable');
        await inspector.locator('summary').click();
        assert.match(await inspector.innerText(), /Denton|Reserve files/);
        const correctionCheck = await page.evaluate(async () => {
            const world = state.worlds.find(w => w.id === state.activeWorldId), sess = getCurrentWorldSession();
            const before = sess.playerLocation, version = sess.worldStateVersion;
            const save = saveWorldsState;
            saveWorldsState = async () => { throw new Error('Correction disk failure'); };
            let error = '';
            try { await correctWorldState(world,sess,{actor:'player',location:'office',minute:600,reason:'Fix mistaken arrival'}); }
            catch(e) { error=e.message; }
            finally { saveWorldsState=save; }
            return { before, after:sess.playerLocation, version, afterVersion:sess.worldStateVersion, error };
        });
        assert.equal(correctionCheck.before, correctionCheck.after);
        assert.equal(correctionCheck.version, correctionCheck.afterVersion);
        assert.match(correctionCheck.error, /disk failure/);
        await page.setViewportSize({width:390,height:844});
        await page.locator('#world-timeline-btn').click();
        await page.locator('#world-correct-state-btn').click();
        const dialogBounds=await page.locator('#world-state-correction').boundingBox();
        assert(dialogBounds.x>=0&&dialogBounds.x+dialogBounds.width<=391,'correction dialog fits mobile width');
        await page.locator('#correction-location').selectOption('office');
        await page.locator('#correction-day').fill('2');
        await page.locator('#correction-time').fill('10:00');
        await page.locator('#correction-reason').fill('The player remained in the office.');
        await page.getByRole('button',{name:'Save correction',exact:true}).click();
        await page.waitForFunction(() => !document.getElementById('world-state-correction'));
        const corrected = await page.evaluate(async () => {
            const s=getCurrentWorldSession();
            const saved=(await HordeDB.get(`worldInstance:${state.activeWorldId}`)).sessions.find(x=>x.id===s.id);
            return {location:saved.playerLocation,time:saved.worldClock.absoluteMinutes, corrections:saved.stateCorrections.length,
                memories:saved.history.filter(m=>m.sceneMemory).length};
        });
        assert.equal(corrected.location,'office'); assert.equal(corrected.time,2040);
        assert.equal(corrected.corrections,1); assert(corrected.memories>0);
        assert.deepEqual(errors, []);
        console.log('PASS scene draft application path: one-call scenes, remembered speech, stable deadlines, bounded repair, persistence');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
