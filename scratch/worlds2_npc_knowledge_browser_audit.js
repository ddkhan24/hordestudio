/** Offline replay of a hosted model leaking an absent NPC's hidden location. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'scratch/fixtures/worlds2-rpg-live.horde_world'), 'utf8'));

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-npc-knowledge.test') return route.abort();
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
        await page.goto('https://world-npc-knowledge.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async originalFixture => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = structuredClone(originalFixture);
            world.model = 'offline/model';
            world.contextSize = 32768;
            world.maxTokens = 2048;
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.playerLocation = 'square';
            sess.entityStates.iven.location = 'square';
            sess.history = [{ id: 'opening', role: 'dm',
                text: 'Captain Iven waits beside the well.', location: 'square' }];
            switchView('worldPlay');
            renderWorldPlayState();
            const input = 'I tell Iven Mara saw Tomas take the brass key east three days ago. I ask if he will arrange a search at first light if I am not back by then. I do not leave the square.';
            const hostedLine = 'Captain Iven: "First light, then. If you are not back by then, I will pull together a party. I will not risk my men tonight, but I will not leave a citizen to rot in that cellar if he is still breathing."';
            const directClaims = worldUnprovenNpcWhereaboutsClaims(world, sess, hostedLine, input);
            const directRedaction = worldRedactUnprovenNpcWhereabouts(world, sess, hostedLine, input);
            const repeatedLeak = worldRedactUnprovenNpcWhereabouts(world, sess,
                'Captain Iven: "Tomas is in that cellar. The courier is inside the Tower Cellar."', input);
            const hypothetical = worldUnprovenNpcWhereaboutsClaims(world, sess,
                'Captain Iven: "If Tomas might be in that cellar, we should search it at first light."', input);
            const modalFate = worldUnprovenNpcWhereaboutsClaims(world, sess,
                'Captain Iven: "He could rot in that cellar before we arrive."', input);
            const routeOnly = worldUnprovenNpcWhereaboutsClaims(world, sess,
                'Captain Iven: "We should search the tower cellar at first light."', input);
            const narratedTruth = worldUnprovenNpcWhereaboutsClaims(world, sess,
                'The DM knows Tomas is in the Tower Cellar. Captain Iven: "I will search the tower."', input);
            const told = structuredClone(sess);
            told.history.push({ id: 'told', role: 'user', witnesses: ['iven'],
                text: 'I tell Iven I saw Tomas inside the Tower Cellar.' });
            const heard = worldUnprovenNpcWhereaboutsClaims(world, told,
                'Captain Iven: "Tomas is inside the Tower Cellar, if your report is accurate."', input);
            const authored = structuredClone(world);
            authored.entities.find(npc => npc.id === 'iven').persona += ' Knows Tomas is in the Tower Cellar from a witness report.';
            const knows = worldUnprovenNpcWhereaboutsClaims(authored, sess,
                'Captain Iven: "Tomas is in the Tower Cellar."', input);
            const suspected = structuredClone(sess);
            suspected.entityStates.iven.observations = [{ text: 'Tomas may be in the Tower Cellar.',
                sourceType: 'suspected', contradicted: false }];
            const suspicionPromoted = worldUnprovenNpcWhereaboutsClaims(world, suspected,
                'Captain Iven: "Tomas is in the Tower Cellar."', input);
            const observationCases = ['believed', 'witnessed', 'told'].map(sourceType => {
                const variant = structuredClone(sess);
                variant.entityStates.iven.observations = [{ text: 'Tomas is in the Tower Cellar.', sourceType }];
                return { sourceType, claims: worldUnprovenNpcWhereaboutsClaims(world, variant,
                    'Captain Iven: "Tomas is in the Tower Cellar."', input).length };
            });
            const contradicted = structuredClone(sess);
            contradicted.entityStates.iven.observations = [{ text: 'Tomas is in the Tower Cellar.',
                sourceType: 'witnessed', contradicted: true }];
            const contradictedClaim = worldUnprovenNpcWhereaboutsClaims(world, contradicted,
                'Captain Iven: "Tomas is in the Tower Cellar."', input);

            let prompt = '';
            let provisionalLeak = false;
            const observer = new MutationObserver(() => {
                if (/citizen to rot in that cellar/i.test(document.getElementById('world-messages-container')?.textContent || ''))
                    provisionalLeak = true;
            });
            observer.observe(document.getElementById('world-messages-container'), { childList: true, subtree: true, characterData: true });
            const receipt = {
                scene: { player_location_id: 'square', player_location_changed: false,
                    present_character_ids: ['iven'] },
                events: [{ type: 'interaction', actor_id: 'iven', status: 'completed',
                    action: 'agreement', participants: ['player', 'iven'],
                    evidence: 'Captain Iven agreed to search at first light if the ranger had not returned.' }],
                entity_updates: [{ entity_id: 'iven', location_id: 'square',
                    activity: 'speaking with the ranger', interacting_with: ['player'] }],
                state_updates: { world_events: [{ id: 'search_at_first_light',
                    title: 'Search Party Departure', urgent: true, status: 'scheduled', due_in_turns: 12 }],
                    npc_observations: [{ npc_id: 'iven', source_type: 'witnessed',
                        observation: 'Iven knows Tomas is in Tower Cellar.' }] }
            };
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
                prompt = (body.messages || []).filter(message => message.role === 'system')
                    .map(message => message.content).join('\n');
                const chunk = { choices: [{ delta: { content: hostedLine, tool_calls: [{ index: 0,
                    id: 'knowledge-replay-tool', type: 'function', function: {
                        name: 'commit_world_turn', arguments: JSON.stringify(receipt)
                    } }] }, finish_reason: 'tool_calls' }] };
                return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
                    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            observer.disconnect();
            const last = [...sess.history].reverse().find(message => message.role === 'dm');
            return {
                directClaims: directClaims.map(claim => claim.reason),
                directRedaction: directRedaction.text,
                repeatedLeak: { text: repeatedLeak.text, count: repeatedLeak.claims.length },
                hypothetical: hypothetical.length, modalFate: modalFate.length, routeOnly: routeOnly.length,
                narratedTruth: narratedTruth.length, heard: heard.length, knows: knows.length,
                suspicionPromoted: suspicionPromoted.length, observationCases,
                contradictedClaim: contradictedClaim.length,
                prompt, provisionalLeak, lastText: last?.text || '',
                stateSource: sess.lastTurnStateSource,
                scheduled: sess.scheduledEvents?.find(event => event.id === 'search_at_first_light')?.status || '',
                redactions: sess.lastTurnAudit?.knowledgeRedactions || [],
                knowledgeDrops: sess.lastTurnAudit?.knowledgeDrops || 0,
                observations: sess.entityStates.iven?.observations || [],
                rejected: sess.lastTurnAudit?.rejected || []
            };
        }, fixture);
        assert.deepEqual(result.directClaims, ['npc_unproven_absent_whereabouts']);
        assert.match(result.directRedaction, /pull together a party/);
        assert.doesNotMatch(result.directRedaction, /citizen to rot in that cellar/i);
        assert.equal(result.repeatedLeak.count, 2);
        assert.doesNotMatch(result.repeatedLeak.text, /\b(?:in that cellar|inside the Tower Cellar)\b/i);
        assert.equal(result.hypothetical, 0, 'an explicitly framed guess remains playable');
        assert.equal(result.modalFate, 1, 'uncertain fate is not evidence for a specific hidden room');
        assert.equal(result.routeOnly, 0, 'suggesting a search route is not secret knowledge');
        assert.equal(result.narratedTruth, 0, 'the guard targets NPC speech, not DM narration');
        assert.equal(result.heard, 0, 'a fact told to the NPC has provenance');
        assert.equal(result.knows, 0, 'authored NPC knowledge is respected');
        assert.equal(result.suspicionPromoted, 1, 'a suspicion cannot become unhedged knowledge');
        assert.deepEqual(result.observationCases, [
            { sourceType: 'believed', claims: 1 },
            { sourceType: 'witnessed', claims: 0 },
            { sourceType: 'told', claims: 0 }
        ]);
        assert.equal(result.contradictedClaim, 1, 'a contradicted observation cannot authorize a claim');
        assert.match(result.prompt, /\[NPC PERSPECTIVE: Captain Iven\]/);
        assert.match(result.prompt, /Absent people relevant to this scene: [^\n]*Tomas Reed/);
        assert.match(result.prompt, /DM-only\. They are NOT witness reports/);
        assert.equal(result.provisionalLeak, false, 'hidden knowledge must not flash during streaming');
        assert.equal(result.stateSource, 'tool_call');
        assert.equal(result.scheduled, 'scheduled');
        assert.match(result.lastText, /pull together a party/,
            'the player must still see the conditional agreement that was committed');
        assert.doesNotMatch(result.lastText, /citizen to rot in that cellar/i);
        assert.deepEqual(result.redactions, [{ reason: 'npc_unproven_absent_whereabouts' }]);
        assert.equal(result.knowledgeDrops, 1, 'the same leak must not become permanent NPC knowledge');
        assert.equal(result.observations.some(item => /Tomas is in Tower Cellar/i.test(item.text || '')), false);
        assert.deepEqual(result.rejected, []);
        assert.deepEqual(errors, []);
        console.log('PASS: absent NPC whereabouts stay provenance-bound without hiding a committed search agreement');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
