/** Offline replay of the malformed live pickup receipt; never calls a paid API. */
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
            if (url.hostname !== 'world-pickup-replay.test') return route.abort();
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
        await page.goto('https://world-pickup-replay.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = {
                id: 'world_pickup_receipt_replay', name: 'Pickup Receipt Replay',
                model: 'offline/model', contextSize: 32768, maxTokens: 2048,
                dmPrompt: 'A flooded marsh causeway.', intro: '', startLocationId: 'causeway',
                locations: [{ id: 'causeway', name: 'Marsh Causeway', description: 'Wet shale.', exits: [] }],
                entities: [], kernel: { enabled: true, memoryMode: 'ledger', repairMode: 'adaptive', sceneDrafts: false }, // Recorded legacy receipt.
                hudConfig: { showClock: false, showQuests: false, showLedger: true, stats: [] },
                gameRules: { profileId: 'adventure', modules: {
                    stats: false, health: false, conditions: false, inventory: true,
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
            sess.inventory = [];
            sess.history.push({ id: 'opening', role: 'dm', text: 'The causeway is slick with rain.', location: 'causeway' });
            switchView('worldPlay');
            renderWorldPlayState();
            const input = 'I carefully pick the torn leather satchel strap off the shale and inspect it for initials, blood, or any clue, then put it in my pack. I stay on the causeway.';
            const narrative = 'You crouch low, the wet shale pressing into your knees. The leather strap is stiff and brine-soaked, clinging to the stone with a stubborn, tacky grip. As you pry it loose, you notice a dark, rusty stain blooming across the brown hide—dried blood, old enough to have turned the color of oxidized iron.\n\nHolding the strap up to the dim light, you find a small, embossed mark near the edge: a stylized "T" entwined with a reed, the official mark of the local courier guild. There are no names written on the leather, but the way the strap was ripped suggests a sudden, violent force, as if something had snagged the bag and jerked it away from the wearer.\n\nYou fold the piece of evidence and tuck it securely into your pack. Standing back up, you remain centered on the narrow stone path.';
            // Exact malformed structured shapes returned by the live model and
            // its repair call, with incidental prose shortened above.
            const main = {
                entity_updates: [{ activity: 'exploring', conditions: [], entity_id: 'player', interacting_with: [], location_id: 'causeway', outfit: 'Standard attire' }],
                events: [{ action: 'investigate', actor_id: 'player', evidence: "blood-stained courier strap with 'T' mark", item: 'torn leather strap', label: 'Inspect satchel strap', status: 'completed', type: 'interaction' }],
                inventory_add: [{ actor_id: 'player', item: 'torn leather strap' }],
                ledger_update: 'Player recovered a blood-stained courier strap from the Marsh Causeway.',
                scene: { player_location_changed: false, player_location_id: 'causeway', present_character_ids: [] }
            };
            const malformedRepair = {
                scene: { player_location_id: 'causeway', player_location_changed: false, present_character_ids: [] },
                events: [], entity_updates: [],
                state_updates: { inventory_added: [{ item: 'torn leather satchel strap', description: "A brine-soaked leather strap with a rusty blood stain and an embossed 'T' entwined with a reed (Courier Guild mark)." }] },
                summary: "The player recovers a blood-stained leather strap bearing the Courier Guild's mark from the shale and adds it to their pack while remaining on the causeway."
            };
            const receiptContext = { playerStartLocationId: 'causeway', playerInput: input, narrativeText: narrative };
            const accepted = validateWorldTurnReceipt(world, sess, main, receiptContext);
            const unsupportedRepair = validateWorldTurnReceipt(world, sess, malformedRepair, receiptContext);
            const omittedPickup = validateWorldTurnReceipt(world, sess, {
                scene: main.scene, events: [], entity_updates: [], state_updates: {}
            }, receiptContext);
            const negatives = [
                { label: 'unscoped', receipt: { ...main, inventory_add: ['torn leather strap'] }, context: receiptContext },
                { label: 'wrong_actor', receipt: { ...main, inventory_add: [{ actor_id: 'mara', item: 'torn leather strap' }] }, context: receiptContext },
                { label: 'no_intent', receipt: main, context: { ...receiptContext, playerInput: 'I inspect the strap but leave it on the shale.' } },
                { label: 'failed_action', receipt: main, context: { ...receiptContext, narrativeText: 'You try to pick up the leather strap but it slips from your hand and remains on the shale.' } },
                { label: 'offered_not_taken', receipt: main, context: { ...receiptContext, narrativeText: 'Mara holds out the leather strap to you, but you leave it in her hand.' } },
                { label: 'refused_item', receipt: main, context: { ...receiptContext,
                    playerInput: 'I refuse to take the torn leather strap and leave it with Mara.',
                    narrativeText: 'The leather strap rests in Mara’s hands. You tuck it into your pack.' } },
                { label: 'unrelated_breath', receipt: main, context: { ...receiptContext, narrativeText: 'You take a deep breath. The leather strap still lies on the shale.' } },
                { label: 'third_party_pickup', receipt: main, context: { ...receiptContext, narrativeText: 'You watch Mara tuck the leather strap into her pack.' } },
                { label: 'different_item', receipt: { ...main, inventory_add: [{ actor_id: 'player', item: 'silver ring' }] }, context: receiptContext }
            ].map(sample => ({ label: sample.label,
                validation: validateWorldTurnReceipt(world, sess, sample.receipt, sample.context) }));
            let repairCalls = 0;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                if (body.messages?.some(message => String(message.content).includes('[AUTHORITATIVE COMMITTED TURN]')))
                    return new Response(JSON.stringify({ choices: [{ message: { content: narrative } }] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (body.stream) {
                    const chunk = { choices: [{ delta: { content: narrative, tool_calls: [{ index: 0,
                        id: 'live-replay-tool', type: 'function', function: {
                            name: 'commit_world_turn', arguments: JSON.stringify({ ...main,
                                action_resolution: { kind: 'physical', status: 'resolved', outcome: narrative } })
                        } }] }, finish_reason: 'tool_calls' }] };
                    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
                        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
                }
                repairCalls++;
                return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(malformedRepair) } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            const last = [...sess.history].reverse().find(message => message.role === 'dm');
            return {
                acceptedReasons: accepted.rejectedEvents.map(event => event.reason),
                acceptedInventoryEvents: accepted.acceptedEvents.filter(event => event.type === 'inventory').map(event => ({ actor: event.actor_id, action: event.action, item: event.item })),
                repairReasons: unsupportedRepair.rejectedEvents.map(event => event.reason),
                omittedReasons: omittedPickup.rejectedEvents.map(event => event.reason),
                negatives: negatives.map(sample => ({ label: sample.label,
                    reasons: sample.validation.rejectedEvents.map(event => event.reason),
                    acceptedInventory: sample.validation.acceptedEvents.some(event => event.type === 'inventory') })),
                source: last?.stateSource, text: last?.text,
                inventory: (sess.inventory || []).map(item => String(item?.name || item)),
                ledger: String(last?.ledgerEntry || sess.ledger || ''),
                consequences: (sess.consequences || []).map(item => ({ type: item?.type,
                    status: item?.status || '' })),
                repairCalls, rejected: sess.lastTurnAudit?.rejected || []
            };
        });
        assert.deepEqual(result.acceptedReasons, []);
        assert.deepEqual(result.acceptedInventoryEvents, [{ actor: 'player', action: 'add', item: 'torn leather strap' }]);
        assert(result.repairReasons.includes('unsupported_state_update'));
        assert(result.omittedReasons.includes('uncommitted_item_pickup'),
            'a no-op receipt cannot canonize a completed pickup claimed only in prose');
        for (const sample of result.negatives) {
            assert(sample.reasons.includes('unscoped_actor_mutation'), `${sample.label} was not rejected`);
            assert.equal(sample.acceptedInventory, false, `${sample.label} added an item without corroboration`);
        }
        assert.equal(result.source, 'tool_call');
        assert(result.inventory.includes('torn leather strap'));
        assert.match(result.ledger, /recovered a blood-stained courier strap/i,
            'the verified pickup must still persist its chronicle entry');
        assert.equal(result.consequences.some(item => item.type === 'inventory'
            && item.status !== 'resolved'), false,
        'a routine inventory pickup must not linger as an active story consequence');
        assert.equal(result.repairCalls, 0, 'the corroborated main receipt must not waste a repair call');
        assert.deepEqual(result.rejected, []);
        assert.deepEqual(errors, []);
        console.log('PASS: live malformed pickup replay commits once; unscoped or uncorroborated pickups stay rejected');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
