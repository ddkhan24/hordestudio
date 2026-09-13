const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        // Serve the real app without a server, provider traffic, or user data.
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'horde-engine.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
            }
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            let body = fs.readFileSync(file);
            if (url.pathname === '/scratch/fixtures/retired-vh-editors.js') {
                // The current normalizer intentionally strips the retired
                // wildcard deck. Display an empty historical fixture section
                // without recreating its data or removed behavior.
                body = body.toString('utf8')
                    .replace('life.wildcardDeck.length', '(life.wildcardDeck || []).length')
                    .replace('life.wildcardDeck.map', '(life.wildcardDeck || []).map');
            }
            return route.fulfill({ contentType: mime, body });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://horde-engine.test/');
        const ready = async () => {
            await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
            // Preserve historical data regression coverage without shipping retired UI.
            await page.addScriptTag({url:'https://horde-engine.test/scratch/fixtures/retired-vh-editors.js'});
            await page.evaluate(()=>{if(!document.getElementById('cs-life-editor')){const editor=document.createElement('div');editor.id='cs-life-editor';editor.className='vh-life-editor hidden';document.querySelector('#tab-cs-life .form-body').append(editor);}});
        };
        await ready();
        assert.deepEqual(errors, []);
        console.log('PASS: full application initializes with revision-checked storage');
        // Model the local settings service outside the browser. Its responses
        // expose configuration status only, never a provider credential.
        let mockMapsKey = '', mockOrsKey = '', mockMapsProvider = 'google';
        const mapsSettingsWrites = [];
        await page.exposeFunction('fixtureMapsSettings', (options = {}) => {
            const body = options.body || {};
            if (options.method === 'POST') mapsSettingsWrites.push(body);
            if (body.remove) mockMapsKey = '';
            else if (body.googleKey) mockMapsKey = body.googleKey;
            if (body.removeOrs) mockOrsKey = '';
            else if (body.orsKey) mockOrsKey = body.orsKey;
            if (body.provider) mockMapsProvider = body.provider;
            return { configured: !!mockMapsKey, source: mockMapsKey ? 'settings' : 'none',
                provider: mockMapsProvider, orsConfigured: !!mockOrsKey,
                orsSource: mockOrsKey ? 'settings' : 'none' };
        });
        await page.evaluate(() => {
            window.originalMapsSettingsBridge = mcpBridgeRequest;
            mcpBridgeRequest = (path, options = {}) => path === '/maps/settings'
                ? window.fixtureMapsSettings(options) : window.originalMapsSettingsBridge(path, options);
            showGlobalSettings(); activateSettingsSection('accounts');
        });
        await page.locator('#maps-settings-card summary').click();
        await page.getByRole('button', { name: 'Manage Maps & places', exact: true }).click();
        const mapsDialog = page.getByRole('dialog', { name: 'Maps & places', exact: true });
        const provider = mapsDialog.getByLabel('Search & routing provider');
        const mapsKey = mapsDialog.locator('input[name="key"]');
        const mapsStatus = mapsDialog.getByRole('status');
        const saveConnection = mapsDialog.getByRole('button', { name: 'Save connection', exact: true });
        const removeConnection = mapsDialog.getByRole('button', { name: 'Remove selected provider’s saved key', exact: true });
        const assertKeysAbsentFromBrowserState = async () => assert.equal(await page.evaluate(() => {
            const browserState = JSON.stringify([state, Object.entries(localStorage), Object.entries(sessionStorage)]);
            return ['synthetic_maps_key', 'synthetic_ors_key'].some(key => browserState.includes(key));
        }), false);

        await provider.selectOption('google');
        await mapsKey.fill('synthetic_maps_key');
        await saveConnection.click();
        await mapsStatus.filter({ hasText: 'Google Maps connection saved.' }).waitFor();
        assert.equal(mockMapsKey, 'synthetic_maps_key');
        assert.equal(await mapsKey.inputValue(), '');
        assert.match(await mapsDialog.locator('[data-summary]').textContent(), /Google Maps · key saved/);
        await assertKeysAbsentFromBrowserState();
        await removeConnection.click();
        await mapsStatus.filter({ hasText: 'Saved key removed.' }).waitFor();
        assert.equal(mockMapsKey, '');
        assert.match(await mapsDialog.locator('[data-summary]').textContent(), /Google Maps · key needed/);

        await provider.selectOption('openrouteservice');
        await mapsKey.fill('synthetic_ors_key');
        await saveConnection.click();
        await mapsStatus.filter({ hasText: 'openrouteservice connection saved.' }).waitFor();
        assert.equal(mockOrsKey, 'synthetic_ors_key');
        assert.equal(mockMapsProvider, 'openrouteservice');
        assert.equal(await provider.inputValue(), 'openrouteservice');
        assert.equal(await mapsKey.inputValue(), '');
        assert.match(await mapsDialog.locator('[data-summary]').textContent(), /openrouteservice · key saved/);
        await assertKeysAbsentFromBrowserState();
        await removeConnection.click();
        await mapsStatus.filter({ hasText: 'Saved key removed.' }).waitFor();
        assert.equal(mockOrsKey, '');
        assert.match(await mapsDialog.locator('[data-summary]').textContent(), /openrouteservice · key needed/);
        assert.deepEqual(mapsSettingsWrites, [
            { provider: 'google', googleKey: 'synthetic_maps_key' }, { remove: true },
            { provider: 'openrouteservice', orsKey: 'synthetic_ors_key' }, { removeOrs: true }
        ]);
        await mapsDialog.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(() => {
            hideGlobalSettings(); mcpBridgeRequest = window.originalMapsSettingsBridge;
            delete window.originalMapsSettingsBridge;
        });
        console.log('PASS: Maps settings save and remove through bridge without persisting the key in browser state');

        const fixture = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = { id: 'browser_fixture', name: 'Browser Fixture', startLocationId: 'a',
                locations: [
                    { id: 'a', name: 'Home', description: 'Home.', exits: [{ text: 'to Work', targetLocationId: 'b', travelTime: 15 }] },
                    { id: 'b', name: 'Work', description: 'Work.', exits: [] }
                ], entities: [{ id: 'ada', type: 'npc', name: 'Ada', startLocation: 'a',
                    schedule: [{ time: '08:00', locationId: 'b', activity: 'working' }] }],
                hudConfig: { enableSchedules: true, timeStep: 5, startTimeHours: 8, stats: [] } };
            const sess = { id: 'fixture_timeline', name: 'Test', playerLocation: 'a', turnCount: 1,
                history: [{ role: 'system', text: 'Fixture started.' }], entityStates: { ada: { location: 'a' } },
                playerStats: {}, pendingChecks: [{ id: 'check', label: 'Blocked', difficulty: 10 }] };
            state.worlds = [world];
            state.worldInstances = { browser_fixture: { activeSessionId: sess.id, sessions: [sess] } };
            state.activeWorldId = world.id;
            renderWorldPlayState();
            document.querySelector('#world-exits-list button').click();
            const blockedLocation = sess.playerLocation;
            sess.pendingChecks = [];
            delete sess.pendingCheck;
            syncNPCSchedules(world, sess);
            renderWorldPlayState();
            openNpcDossier('ada');
            const travellingLabel = document.getElementById('npc-dossier-content').textContent.includes('Travelling to Work');
            await saveState();
            return { blockedLocation, travellingLabel, position: sess.entityStates.ada.location,
                arrival: sess.entityStates.ada.journey?.arrivalMinute, conflict: HordeDB.conflicted };
        });
        assert.deepEqual(fixture, { blockedLocation: 'a', travellingLabel: true, position: null, arrival: 495, conflict: false });
        console.log('PASS: real exit handler respects pending checks; dossier renders a timed journey');
        const proposals = await page.evaluate(() => {
            const world = safeJsonClone(state.worlds.find(w => w.id === 'browser_fixture'));
            const sess = safeJsonClone(getCurrentWorldSession());
            world.locations.push({ id: 'island', name: 'Island', exits: [] });
            world.entities.push({ id: 'bob', name: 'Bob', type: 'npc', startLocation: 'a' });
            sess.entityStates.bob = { location: 'a' };
            const blocked = processStructuredActions({ npc_moves: [{ npc_id: 'bob', target_location_id: 'island', movement_mode: 'teleport' }] }, world, sess);
            const stayed = sess.entityStates.bob.location;
            processStructuredActions({ npc_moves: [{ npc_id: 'bob', target_location_id: 'b' }] }, world, sess);
            const receipt = {
                scene: { player_location_id: 'a', player_location_changed: false, present_character_ids: [] },
                events: [{ type: 'movement', status: 'completed', actor_id: 'bob', from_location_id: 'a', to_location_id: 'b' }],
                entity_updates: [], state_updates: {}
            };
            const early = validateWorldTurnReceipt(world, sess, receipt);
            receipt.events.push({ type: 'time', status: 'completed', minutes_elapsed: 15 });
            const due = validateWorldTurnReceipt(world, sess, receipt);
            return { blocked: blocked.moduleRejections.some(item => item.reason === 'unreachable_npc_destination'), stayed,
                inTransit: sess.entityStates.bob.location === null && !!sess.entityStates.bob.journey,
                earlyRejected: early.rejectedEvents.some(item => item.reason === 'actor_in_transit'),
                arrivalAccepted: due.acceptedEvents.some(item => item.type === 'movement' && item.actor_id === 'bob') };
        });
        assert.deepEqual(proposals, { blocked: true, stayed: 'a', inTransit: true, earlyRejected: true, arrivalAccepted: true });
        console.log('PASS: background proposals use routes/journeys and canonical receipts cannot finish travel early');

        await page.reload();
        await ready();
        const restored = await page.evaluate(() => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.activeWorldId = 'browser_fixture';
            const sess = getCurrentWorldSession();
            const world = state.worlds.find(item => item.id === state.activeWorldId);
            const before = { position: sess.entityStates.ada.location, arrival: sess.entityStates.ada.journey?.arrivalMinute };
            sess.turnCount = 4;
            syncNPCSchedules(world, sess);
            const container = document.createElement('div');
            document.body.appendChild(container);
            renderSemanticWorldMap(container, worldForSession(world, sess), { currentLocationId: 'a' });
            return { before, after: sess.entityStates.ada.location, renderedMap: !!container.querySelector('svg'),
                oneWay: buildSemanticWorldGraph(world).edges[0].isOneWay, conflict: HordeDB.conflicted };
        });
        assert.deepEqual(restored, { before: { position: null, arrival: 495 }, after: 'b', renderedMap: true, oneWay: true, conflict: false });
        assert.deepEqual(errors, []);
        console.log('PASS: journey survives real IndexedDB reload and map rendering agrees with directed travel');
        const attentionFixture = await page.evaluate(async () => {
            const now = Date.now();
            state.globalSettings.companionAgencyPaused = true;
            const companion = normalizeCompanion({ id: 'attention_fixture', name: 'Ada',
                humanDynamics: { energy: 90, stress: 10, lastUpdated: now },
                lifeRuntime: { temporarySituation: { activity: 'working', availability: 'busy',
                    startedAt: now - 60000, endsAt: now + 3600000 } } });
            state.companions = [companion];
            const timeline = getActiveCompanionTimeline(companion.id);
            timeline.experience = { realTimeLife: true, replyDelays: true, allowNoReply: true, silenceConsequences: false };
            const message = normalizeCompanionMessage({ id: 'attention_message', role: 'user', text: 'How was your day?',
                deliveryState: 'sent', timestamp: now, awaitingReply: true });
            const plan = companionResponsePlan(companion, message, now, timeline.experience);
            Object.assign(message, { deliveredAt: plan.deliveredAt, readAt: plan.readAt,
                replyDueAt: plan.replyDueAt, attention: plan.attention });
            timeline.messages.push(message);
            await processCompanionAgency(plan.attention.nextCheckAt);
            persistCompanionRuntime(companion);
            await saveState();
            return { stage: message.attention.stage, read: message.deliveryState,
                due: message.replyDueAt, pending: message.awaitingReply };
        });
        assert.deepEqual(attentionFixture, { stage: 'deferred', read: 'read', due: 0, pending: true });
        await page.reload();
        await ready();
        const attentionRestored = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const companion = getCompanion('attention_fixture');
            const timeline = getActiveCompanionTimeline(companion.id);
            const message = timeline.messages.find(item => item.id === 'attention_message');
            const restoredStage = message.attention.stage;
            const at = Math.max(Date.now(), message.attention.lastEvaluatedAt) + 1000;
            companion.lifeRuntime.temporarySituation = { activity: 'relaxing', availability: 'available',
                startedAt: at - 1, endsAt: at + 3600000 };
            companion.humanDynamics.energy = 90; companion.humanDynamics.stress = 10;
            await processCompanionAgency(at);
            const resumedStage = message.attention.stage;
            await processCompanionAgency(message.attention.lastEvaluatedAt + 1000);
            return { restoredStage, resumedStage, finalStage: message.attention.stage,
                ready: message.replyDueAt > 0, trace: message.attention.trace.length,
                modelReplies: timeline.messages.filter(item => item.role === 'companion').length };
        });
        assert.equal(attentionRestored.restoredStage, 'deferred');
        assert.equal(attentionRestored.resumedStage, 'ready');
        assert.equal(attentionRestored.finalStage, 'ready');
        assert.equal(attentionRestored.ready, true);
        assert(attentionRestored.trace <= 8);
        assert.equal(attentionRestored.modelReplies, 0);
        assert.deepEqual(errors, []);
        console.log('PASS: real VH agency persists a read/deferred message and resumes attention after reload and activity change');
        const bridgeGuard = await page.evaluate(async () => {
            const companion = getCompanion('attention_fixture');
            const timeline = getActiveCompanionTimeline(companion.id);
            companion.alwaysOnEnabled = true;
            const originalCredentials = providerHasCredentials;
            const originalBridge = mcpBridgeRequest;
            let manifest;
            let acknowledged = [];
            try {
                providerHasCredentials = () => true;
                manifest = companionAlwaysOnManifest(companion);
                providerHasCredentials = originalCredentials;
                state.globalSettings.companionAlwaysOnEnabled = true;
                mcpBridgeRequest = async (path, options) => {
                    if (path === '/always-on/events') return { events: [{ id: 'stale_bridge', humanId: companion.id,
                        timelineId: timeline.id, kind: 'message', text: 'A stale answer', createdAt: Date.now() }] };
                    if (path === '/always-on/ack') acknowledged = options.body.eventIds;
                    return {};
                };
                await importCompanionAlwaysOnEvents();
                return { enabled: manifest.messagesEnabled && !!manifest.simulation?.companion, stillPending: timeline.messages[0].awaitingReply,
                    inserted: timeline.messages.some(item => item.id === 'stale_bridge'), acknowledged };
            } finally {
                providerHasCredentials = originalCredentials;
                mcpBridgeRequest = originalBridge;
            }
        });
        assert.deepEqual(bridgeGuard, { enabled: true, stillPending: true, inserted: false, acknowledged: ['stale_bridge'] });
        assert.deepEqual(errors, []);
        console.log('PASS: always-on cannot bypass or consume a browser-owned attention job');
        const busyRecovery = await page.evaluate(async () => {
            const c = getCompanion('attention_fixture');
            const timeline = getActiveCompanionTimeline(c.id);
            const at = Date.now() + 2 * 3600000;
            const message = normalizeCompanionMessage({ id: 'stalled_inbox', role: 'user', text: 'Are you around?',
                timestamp: at - 3600000, deliveredAt: at - 3600000, readAt: at - 3500000,
                deliveryState: 'read', awaitingReply: true, attention: { version: 1, stage: 'deferred',
                    noticedAt: at - 3500000, nextCheckAt: at - 1, reason: 'Waiting for attention.', trace: [] } });
            timeline.messages.splice(0, timeline.messages.length, message);
            c.lifeRuntime.temporarySituation = { activity: 'working all afternoon', availability: 'busy',
                startedAt: at - 2 * 3600000, endsAt: at + 5 * 3600000 };
            c.humanDynamics.energy = 80; c.humanDynamics.stress = 15; c.humanDynamics.lastUpdated = at;
            state.globalSettings.companionAlwaysOnEnabled = false;
            const originalCredentials = providerHasCredentials, originalSend = sendCompanionMessage;
            let requests = 0;
            try {
                providerHasCredentials = () => true;
                sendCompanionMessage = async (person, thread, text, time, options) => {
                    requests++;
                    options.replyBatch.forEach(item => { item.awaitingReply = false; item.replyDueAt = 0; item.attention.stage = 'answered'; });
                    return {};
                };
                await processCompanionAgency(at);
                const stage = message.attention.stage;
                await processCompanionAgency(message.attention.lastEvaluatedAt + 1000);
                await processCompanionAgency(at + 5 * 60000);
                return { stage, requests, pending: message.awaitingReply };
            } finally { providerHasCredentials = originalCredentials; sendCompanionMessage = originalSend; }
        });
        assert.deepEqual(busyRecovery, { stage: 'answered', requests: 1, pending: false });
        console.log('PASS: an existing stalled inbox reaches the reply request exactly once during a busy routine');

        await page.evaluate(async () => {
            const c = getCompanion('attention_fixture');
            state.personas = [{ id: 'old_profile', name: 'Old profile', text: 'Old identity' },
                { id: 'new_profile', name: 'New profile', text: 'CURRENT_PROFILE_MARKER' }];
            state.activePersonaId = 'old_profile';
            state.activeCompanionId = c.id;
            renderCompanionThread();
            const picker = document.getElementById('cc-persona-select');
            picker.value = 'new_profile';
            await picker.onchange();
        });
        await page.reload();
        await ready();
        const profile = await page.evaluate(() => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const c = getCompanion('attention_fixture');
            state.activeCompanionId = c.id;
            renderCompanionThread();
            const packet = buildCompanionContextPacket(c, getCompanionThread(c.id), Date.now());
            return { selection: document.getElementById('cc-persona-select').value,
                global: state.activePersonaId, prompt: packet.connection.player };
        });
        assert.equal(profile.selection, 'new_profile');
        assert.equal(profile.global, 'old_profile');
        assert(profile.prompt.includes('CURRENT_PROFILE_MARKER'));
        await page.evaluate(async()=>{const c=getCompanion('attention_fixture'),now=Date.now(),timeline=getActiveCompanionTimeline(c.id);timeline.messages.push(normalizeCompanionMessage({id:'remember_london',role:'user',text:"I'm from London",timestamp:now-1000,readAt:now-500,deliveryState:'read'}));buildCompanionContextPacket(c,timeline.messages,now);renderCompanionPersonaSelector(c);document.querySelector('[data-chat-profile]').value='CURRENT_PROFILE_MARKER: local profile only';await document.querySelector('[data-save-chat-profile]').onclick();state.activePersonaId='old_profile';await saveState();});
        await page.reload();await ready();
        const identityMemory=await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);const c=getCompanion('attention_fixture'),packet=buildCompanionContextPacket(c,getCompanionThread(c.id),Date.now()+86400000);return {persona:companionActivePersona(c),shared:state.personas.find(p=>p.id==='new_profile').text,remembered:packet.connection.remembered};});
        assert.match(identityMemory.persona.text,/local profile only/);assert.equal(identityMemory.shared,'CURRENT_PROFILE_MARKER');assert.match(identityMemory.remembered,/London/);
        console.log('PASS: chat persona selection survives reload and overrides the old global profile in the prompt');

        const meters = await page.evaluate(() => {
            state.activeCompanionId = 'attention_fixture';
            const c = getCompanion(state.activeCompanionId);
            c.relationshipDynamics.stability = 50; c.relationshipDynamics.resentment = 0;
            openCompanionSimulationDetails();
            const rows = [...document.querySelectorAll('.companion-sim-meter')];
            const measure = name => {
                const row = rows.find(row => row.firstElementChild.textContent === name);
                const fill = row.querySelector('.companion-sim-meter-fill');
                const style = getComputedStyle(fill);
                return { width: fill.getBoundingClientRect().width, track: fill.parentElement.getBoundingClientRect().width,
                    background: style.backgroundImage, color: style.backgroundColor };
            };
            return { positive: measure('Stability'), zero: measure('Resentment') };
        });
        assert(meters.positive.width > 0 && Math.abs(meters.positive.width / meters.positive.track - 0.5) < 0.02);
        assert.notEqual(meters.positive.background, 'none');
        assert.notEqual(meters.positive.color, 'rgba(0, 0, 0, 0)');
        assert.equal(meters.zero.width, 0);
        await page.locator('#companion-simulation-content').screenshot({ path: '/tmp/vh-meter-proof.png' });
        console.log('PASS: rendered VH meters visibly fill positive values and leave zero empty');
        await page.locator('[data-sim-tab="activities"]').click();
        await page.locator('#vh-activity-kind').selectOption('recovery');
        await page.locator('#vh-add-activity').click();
        await page.waitForFunction(() => getCompanion('attention_fixture').lifeRuntime.activities.goals.length === 1);
        const activityStart = await page.evaluate(async () => {
            const c = getCompanion('attention_fixture'), at = Date.now();
            c.lifeRuntime.temporarySituation = { activity: 'free time', availability: 'available', startedAt: at - 1000, endsAt: at + 3600000 };
            const activity = c.lifeRuntime.activities;
            activity.lastAdvancedAt = at;
            activity.goals[0].createdAt = at;
            advanceCompanionActivities(c, at + 15 * 60000);
            const progress = activity.goals[0].steps[0].progressMs;
            c.lifeRuntime.temporarySituation = { activity: 'a private appointment', availability: 'private',
                startedAt: at + 15 * 60000, endsAt: at + 25 * 60000 };
            advanceCompanionActivities(c, at + 25 * 60000);
            persistCompanionRuntime(c); await saveState();
            return { at, progress, status: activity.goals[0].status };
        });
        assert.equal(activityStart.progress, 15 * 60000); assert.equal(activityStart.status, 'paused');
        await page.reload(); await ready();
        const completedActivity = await page.evaluate(async ({ at }) => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const c = getCompanion('attention_fixture');
            const activity = c.lifeRuntime.activities;
            const restored = activity.goals[0].steps[0].progressMs;
            c.humanDynamics.energy = 40; c.humanDynamics.stress = 30;
            c.lifeRuntime.temporarySituation = { activity: 'free again', availability: 'available',
                startedAt: at + 25 * 60000, endsAt: at + 60 * 60000 };
            advanceCompanionActivities(c, at + 30 * 60000);
            advanceCompanionActivities(c, at + 30 * 60000);
            return { restored, status: activity.goals[0].status, energy: c.humanDynamics.energy,
                events: c.lifeEvents.filter(event => event.id === activity.goals[0].id + ':completed:done').length,
                memories: c.continuityRuntime.episodes.filter(event => event.id === activity.goals[0].id + ':completed:done').length };
        }, activityStart);
        assert.deepEqual(completedActivity, { restored: 15 * 60000, status: 'completed', energy: 58, events: 1, memories: 1 });
        assert.deepEqual(errors, []);
        console.log('PASS: goal UI, interruption, real save/reload, resumption, energy consequence and memory commit run end to end');
        const socialDrafts = await page.evaluate(async () => {
            const c = getCompanion('attention_fixture');
            hideGlobalSettings();
            document.getElementById('companion-simulation-overlay').classList.add('hidden');
            openCompanionStudio(c.id); switchView('companionStudio'); activateCompanionStudioTab('cs-social');
            document.getElementById('cs-social-add-status').click();
            document.getElementById('cs-social-add-photo').click();
            const cards = document.querySelectorAll('#cs-social-seed-list [data-social-seed-id]');
            const kinds = c.startingSocialPosts.slice(-2).map(post => post.kind);
            activateCompanionStudioTab('cs-chat-style');
            const habits = document.getElementById('cs-conversation-style');
            habits.value = 'STYLE_MARKER: offer a specific opinion and follow through on plans';
            habits.dispatchEvent(new Event('input', { bubbles: true }));
            const examples = document.getElementById('cs-chat-examples');
            examples.value = 'EXAMPLE_MARKER: cafe first. adventures later';
            examples.dispatchEvent(new Event('input', { bubbles: true }));
            document.getElementById('cs-chat-length').value = 'brief';
            document.getElementById('cs-chat-length').dispatchEvent(new Event('change', { bubbles: true }));
            commitCompanionStudioForm(); await saveState();
            return { count: cards.length, kinds, styleVisible: !document.getElementById('tab-cs-chat-style').classList.contains('hidden') };
        });
        assert(socialDrafts.count >= 2);
        assert.deepEqual(socialDrafts.kinds, ['status', 'photo']);
        assert(socialDrafts.styleVisible);
        await page.waitForTimeout(500); // Finish the Settings close animation before visual capture.
        await page.screenshot({ path: '/tmp/vh-chat-style-proof.png', fullPage: false });
        await page.reload(); await ready();
        const reloadedStyle = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const c = getCompanion('attention_fixture');
            return { drafts: c.startingSocialPosts.slice(-2).map(post => post.kind), length: c.chatLength,
                prompt: buildCompanionPerformancePrompt(c, [], Date.now()) };
        });
        assert.deepEqual(reloadedStyle.drafts, ['status', 'photo']);
        assert.equal(reloadedStyle.length, 'brief');
        assert(reloadedStyle.prompt.includes('STYLE_MARKER') && reloadedStyle.prompt.includes('EXAMPLE_MARKER'));
        assert.deepEqual(errors, []);
        console.log('PASS: both social add buttons create persistent drafts; Chat style controls persist and reach the speaking prompt');
        const importedBackground = await page.evaluate(async () => {
            const c = getCompanion('attention_fixture');
            c.separatedCognition = false;
            const store = ensureCompanionTimelineStore(c.id);
            const activeMood = c.mood.valence;
            const seed = captureCompanionRuntime(c); seed.mood.valence = -20;
            const inactive = normalizeCompanionTimeline({ id: 'background_b', messages: [
                { id: 'offline_user', role: 'user', type: 'text', text: 'Cafe?', timestamp: Date.now()-1000,
                    awaitingReply: true, attention: { stage: 'deferred' } }], runtime: seed }, c);
            store.sessions.push(inactive);
            const simulation = safeJsonClone(c);
            simulation.mood.valence = 25;
            simulation.continuityRuntime.revision = seed.continuityRuntime.revision + 1;
            const event = { id: 'offline_result', humanId: c.id, timelineId: inactive.id, kind: 'message', text: 'Which cafe?',
                createdAt: Date.now(), stateRevision: seed.continuityRuntime.revision,
                baseMessageIds: ['offline_user'], consumedMessageIds: ['offline_user'], simulation: { companion: simulation } };
            const originalBridge = mcpBridgeRequest;
            const originalSave = saveState;
            let fail = true; let ack = 0;
            state.globalSettings.companionAlwaysOnEnabled = true;
            mcpBridgeRequest = async (path) => path === '/always-on/events' ? { events: [event] } : (ack++, {});
            try {
                saveState = async () => { if (fail) throw new Error('Synthetic disk failure'); return originalSave(); };
                let rejected = false;
                try { await importCompanionAlwaysOnEvents(); } catch (_) { rejected = true; }
                const rollback = rejected && store.sessions.find(t => t.id === inactive.id).messages.length === 1 && ack === 0;
                fail = false;
                await importCompanionAlwaysOnEvents();
                await importCompanionAlwaysOnEvents();
                const restored = store.sessions.find(t => t.id === inactive.id);
                const result = restored.messages.find(m => m.id === event.id);
                const state = { rollback, activeUntouched: c.mood.valence === activeMood,
                    inactiveMood: restored.runtime.mood.valence, priorMood: result.turnSnapshot.runtime.mood.valence,
                    copies: restored.messages.filter(m => m.id === event.id).length,
                    consumed: !restored.messages[0].awaitingReply };
                event.id = 'stale_new_result';
                restored.messages.push(normalizeCompanionMessage({ id: 'new_input', role: 'user', text: 'Wait', timestamp: Date.now() }));
                await importCompanionAlwaysOnEvents();
                state.staleRejected = !restored.messages.some(m => m.id === event.id);
                return state;
            } finally {
                mcpBridgeRequest = originalBridge; saveState = originalSave;
                state.globalSettings.companionAlwaysOnEnabled = false;
            }
        });
        assert.deepEqual(importedBackground, { rollback: true, activeUntouched: true, inactiveMood: 25,
            priorMood: -20, copies: 1, consumed: true, staleRejected: true });
        assert.deepEqual(errors, []);
        console.log('PASS: background imports isolate inactive timelines, roll back failed saves, deduplicate and reject superseded snapshots');





        await page.evaluate(() => {
            const c = getCompanion('attention_fixture');
            hideGlobalSettings();
            document.getElementById('companion-simulation-overlay').classList.add('hidden');
            c.lifeProfile.initializedAt = Date.now();
            c.lifeProfile.places = [normalizeCompanionLifePlace({id:'geo_home',label:'Test home',kind:'home',googlePlaceId:'synthetic_home'})];
            c.lifeProfile.socialCircle = [normalizeCompanionSocialPerson({id:'jo',name:'Jo',role:'friend'})];
            openCompanionStudio(c.id); switchView('companionStudio'); activateCompanionStudioTab('cs-life');
            renderCompanionLifeEditor(c);
        });
        await page.locator('[data-life-add="opportunity"]').click();
        const option = page.locator('[data-life-opportunity]').last();
        await option.locator('[data-field="label"]').fill('Discuss the draft');
        await option.locator('[data-field="kind"]').selectOption('contact');
        await option.locator('[data-field="participantId"]').selectOption('jo');
        await page.locator('[data-life-add="opportunity"]').click();
        const projectOption=page.locator('[data-life-opportunity]').last();
        await projectOption.locator('[data-field="label"]').fill('Write a short story');
        await projectOption.locator('[data-field="projectMinutes"]').fill('240');
        await projectOption.locator('[data-field="learnFromOutcomes"]').check();
        await page.locator('details').filter({has:page.locator('[data-life-add="contact-window"]')}).evaluate(el => { el.open = true; });
        await page.locator('[data-life-add="contact-window"]').click();
        await page.locator('details').filter({has:page.locator('[data-life-add="place"]')}).evaluate(el=>{el.open=true;});
        await page.locator('[data-life-add="place"]').click();
        await page.locator('details').filter({has:page.locator('[data-life-add="place"]')}).evaluate(el=>{el.open=true;});
        const geoRow=page.locator('[data-life-place]').last();
        await geoRow.locator('[data-field="label"]').fill('Test gym');
        await page.evaluate(()=>{ window.testOriginalMaps=mcpBridgeRequest; mcpBridgeRequest=async(path,options)=>path==='/maps/search'?{places:[{id:'synthetic_gym',displayName:{text:'Synthetic Gym'},formattedAddress:'Test city'}]}:path==='/maps/route'?{routes:[{duration:'900s',distanceMeters:1200}]}:window.testOriginalMaps(path,options); });
        await geoRow.locator('[data-map-query]').fill('Gym in test city');
        await geoRow.locator('[data-map-search]').click();
        await geoRow.locator('[data-map-results] button').click();
        assert.equal(await geoRow.locator('[data-field="googlePlaceId"]').inputValue(),'synthetic_gym');
        await page.evaluate(()=>{mcpBridgeRequest=async(path,options)=>path==='/maps/search'?{provider:'openrouteservice',attribution:'openrouteservice / OpenStreetMap contributors',places:[{id:'osm:venue:1',displayName:{text:'Synthetic Gym'},formattedAddress:'Test city',coordinates:[8.7,49.5]}]}:path==='/maps/route'?{provider:'openrouteservice',attribution:'openrouteservice',routes:[{duration:'900s',distanceMeters:1200}]}:window.testOriginalMaps(path,options);});
        await geoRow.locator('[data-map-search]').click();
        await geoRow.locator('[data-map-results] button').click();
        assert.equal(await geoRow.locator('[data-field="googlePlaceId"]').inputValue(),'');
        assert.equal(await geoRow.locator('[data-field="longitude"]').inputValue(),'8.7');
        await page.locator('[data-life-place]').first().locator('[data-field="longitude"]').fill('8.6');
        await page.locator('[data-life-place]').first().locator('[data-field="latitude"]').fill('49.4');

        await geoRow.locator('[data-home-route]').click();
        await page.waitForFunction(()=>[...document.querySelectorAll('[data-home-route-status]')].at(-1)?.textContent.includes('15 minutes'));
        assert.equal(await geoRow.locator('[data-field="travelMinutesFromHome"]').inputValue(),'15');
        await geoRow.locator('[data-field="travelMode"]').selectOption('BICYCLE');
        await page.waitForFunction(()=>[...document.querySelectorAll('[data-home-route-status]')].at(-1)?.textContent.includes('BICYCLE · 15 minutes'));
        const placeIds=await page.locator('[data-route-to] option').evaluateAll(options=>options.map(o=>o.value));
        await page.locator('[data-route-from]').selectOption(placeIds[0]);
        await page.locator('[data-route-to]').selectOption(placeIds[placeIds.length-1]);
        await page.locator('[data-route-preview]').click();
        assert.match(await page.locator('[data-route-result]').textContent(),/15 minutes/);
        assert.equal(await page.locator('[data-route-minutes]').inputValue(),'15');
        await page.locator('[data-route-minutes]').fill('18');
        await page.locator('[data-route-add]').click();
        await page.evaluate(()=>{mcpBridgeRequest=window.testOriginalMaps;delete window.testOriginalMaps;});
        await page.locator('#cs-life-editor-save').click();
        await page.waitForFunction(() => document.getElementById('cs-life-editor').classList.contains('hidden'));
        await page.reload(); await ready();
        const savedPlanner = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const c=getCompanion('attention_fixture');
            return { geo:c.lifeProfile.places.find(p=>p.label==='Test gym'),legs:c.lifeProfile.travelLegs, project:c.lifeProfile.activityOptions.find(item=>item.label==='Write a short story'), option:c.lifeProfile.activityOptions.find(item=>item.label==='Discuss the draft'), person:c.lifeProfile.socialCircle.find(item=>item.id==='jo') };
        });
        assert.equal(savedPlanner.geo.googlePlaceId,'');assert.deepEqual(savedPlanner.geo.mapCoordinates,[8.7,49.5]); assert.equal(savedPlanner.legs.at(-1).minutes,18);assert.equal(savedPlanner.legs.at(-1).source,'Manual override');assert.equal(savedPlanner.geo.travelMode,'BICYCLE');assert(savedPlanner.legs.some(l=>l.from===savedPlanner.geo.id&&l.mode==='BICYCLE'&&l.minutes===15&&l.source==='openrouteservice'));
        assert.equal(savedPlanner.project.projectMinutes,240); assert.equal(savedPlanner.project.learnFromOutcomes,true);
        assert.equal(savedPlanner.option.kind,'contact'); assert.equal(savedPlanner.option.participantId,'jo');
        assert.deepEqual(savedPlanner.person.contactWindows,[{days:[1,2,3,4,5],startMinute:1080,endMinute:1200}]);
        assert.deepEqual(errors, []);
        console.log('PASS: daily opportunity and supporting-person availability editor saves and survives reload');
        await page.evaluate(()=>{hideGlobalSettings();const c=getCompanion('attention_fixture');openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-life');renderCompanionLegacyWorldSystems(c,document.getElementById('cs-world-systems'));document.querySelectorAll('#cs-world-systems details').forEach(el=>el.open=true);});
        await page.locator('[data-world-field="transport.goalTravel"]').check();
        await page.waitForFunction(()=>getCompanion('attention_fixture').lifeProfile.world.transport.goalTravel===true);
        await page.locator('[data-world-field="transport.maxOutingMinutes"]').fill('90');
        await page.locator('[data-world-field="transport.maxOutingMinutes"]').press('Tab');
        await page.waitForFunction(()=>getCompanion('attention_fixture').lifeProfile.world.transport.maxOutingMinutes===90);
        await page.evaluate(()=>renderCompanionLegacyWorldSystems(getCompanion('attention_fixture'),document.getElementById('cs-world-systems')));
        assert(await page.locator('[data-world-field="transport.goalTravel"]').isChecked());
        assert.equal(await page.locator('[data-world-field="transport.maxOutingMinutes"]').inputValue(),'90');
        await page.locator('[data-world-field="transport.goalTravel"]').uncheck();
        console.log('PASS: unscheduled outing settings use the existing VH editor and survive rerender');
        await page.evaluate(()=>{
            const c=getCompanion('attention_fixture');window.savedRouteTestWorld=JSON.parse(JSON.stringify(c.lifeRuntime.world));
            const now=c.lifeRuntime.lastSimulatedAt;
            c.lifeRuntime.world.journey={id:'route-ui-test',from:'home',to:'park',toLabel:'Park',mode:'WALK',departedAt:now-300000,arrivesAt:now+300000,geometry:[[0,51],[0,51.01],[.01,51.01]]};
            renderCompanionLegacyWorldSystems(c,document.getElementById('cs-world-systems'));
        });
        assert.equal(await page.locator('[data-vh-travel-progress] progress').getAttribute('value'),'0.5');
        assert.match(await page.locator('[data-vh-travel-progress]').textContent(),/Position follows the saved route/);
        await page.evaluate(()=>{const c=getCompanion('attention_fixture');delete c.lifeRuntime.world.journey.geometry;renderCompanionLegacyWorldSystems(c,document.getElementById('cs-world-systems'));});
        assert.match(await page.locator('[data-vh-travel-progress]').textContent(),/Time estimate only/);
        await page.evaluate(()=>{const c=getCompanion('attention_fixture');c.lifeRuntime.world=window.savedRouteTestWorld;delete window.savedRouteTestWorld;renderCompanionLegacyWorldSystems(c,document.getElementById('cs-world-systems'));});
        console.log('PASS: existing VH transport panel renders route progress and explicit geometry fallback');


        await page.locator('[data-world-field="gifts.enabled"]').check();
        await page.locator('[data-world-field="gifts.mailAllowed"]').check();
        await page.locator('[data-world-field="gifts.cashAllowed"]').check();
        await page.locator('[data-world-field="gifts.minTrust"]').fill('-100');
        await page.locator('[data-world-field="gifts.deliveryHours"]').fill('0');
        await page.locator('[data-world-field="closet.mode"]').selectOption('items');
        for(const [name,category,owned] of [['White shirt','top',true],['Blue trousers','bottom',true],['Gift hoodie','top',false]]){
            const priorItems=await page.locator('[data-world-item]').count();
            await page.locator('[data-item-add]').click();
            await page.waitForFunction(count=>document.querySelectorAll('[data-world-item]').length===count,priorItems+1);
            await page.evaluate(()=>document.querySelectorAll('#cs-world-systems details').forEach(el=>el.open=true));
            const item=page.locator('[data-world-item]').last();
            await item.locator('[data-item-field="name"]').fill(name);
            await item.locator('[data-item-field="category"]').selectOption(category);
            await item.locator('[data-item-field="owned"]').setChecked(owned);
            await item.locator('[data-item-field="tags"]').fill('cozy, casual');
            await item.locator('[data-item-field="tags"]').blur();
            await page.waitForFunction(name=>getCompanion('attention_fixture').lifeProfile.world.items.some(i=>i.name===name),name,{timeout:3000}).catch(async error=>{console.log('World item state',await page.evaluate(()=>getCompanion('attention_fixture').lifeProfile.world.items.map(i=>({id:i.id,name:i.name}))));throw error;});
        }
        const uploadItem=page.locator('[data-world-item]').last();
        await uploadItem.locator('[data-item-upload]').setInputFiles({name:'hoodie.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
        await page.waitForFunction(()=>getCompanion('attention_fixture').lifeProfile.world.items.at(-1).photo);
        await page.evaluate(()=>{state.globalSettings.localBaseUrl='http://127.0.0.1:11434/v1';window.originalVisionFetch=fetch;window.visionCalls=0;fetch=async(url,...args)=>{if(String(url)==='http://127.0.0.1:11434/v1/chat/completions'){window.visionCalls++;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({category:'top',tags:['cozy','fitness'],warmth:2})}}]})};}return window.originalVisionFetch(url,...args);};});
        await page.locator('[data-vision-model]').fill('offline-vision-fixture');
        await page.locator('[data-world-item]').last().locator('[data-item-tag]').click();
        await page.waitForFunction(()=>getCompanion('attention_fixture').lifeProfile.world.items.at(-1).tags.includes('fitness'));
        assert.equal(await page.evaluate(()=>window.visionCalls),1);
        await page.evaluate(()=>{state.apiKey='offline-openrouter-key';window.remoteVisionCalls=0;fetch=async(url,options)=>{if(String(url)==='https://openrouter.ai/api/v1/chat/completions'){const body=JSON.parse(options.body);if(options.headers.Authorization!=='Bearer offline-openrouter-key'||body.model!=='fixture/vision'||!body.messages[0].content[1].image_url.url.startsWith('data:image/'))throw Error('Incorrect remote vision request');window.remoteVisionCalls++;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({category:'top',tags:['cozy','remote-verified'],warmth:2})}}]})};}if(String(url)==='https://openrouter.ai/api/v1/models')return {ok:true,json:async()=>({data:[{id:'fixture/vision',name:'Fixture vision',architecture:{input_modalities:['text','image'],output_modalities:['text']}},{id:'fixture/text',architecture:{input_modalities:['text'],output_modalities:['text']}}]})};return window.originalVisionFetch(url,options);};});
        await page.locator('[data-vision-provider]').selectOption('openrouter');
        await page.locator('[data-vision-models]').click();
        assert.equal(await page.locator('#vh-garment-vision-models option').count(),1);
        await page.locator('[data-vision-model]').fill('fixture/vision');
        await page.locator('[data-world-item]').last().locator('[data-item-tag]').click();
        await page.waitForFunction(()=>getCompanion('attention_fixture').lifeProfile.world.items.at(-1).tags.includes('remote-verified'));
        assert.equal(await page.evaluate(()=>window.remoteVisionCalls),1);
        await page.locator('[data-vision-provider]').selectOption('local');
        await page.waitForFunction(()=>document.querySelector('[data-vision-model]')?.value==='offline-vision-fixture'&&!document.querySelector('[data-vision-provider]').disabled);
        assert.equal(await page.locator('[data-vision-model]').inputValue(),'offline-vision-fixture');
        await page.locator('[data-vision-provider]').selectOption('openrouter');
        await page.evaluate(()=>{fetch=window.originalVisionFetch;delete window.originalVisionFetch;delete window.visionCalls;});
        await page.evaluate(()=>activateCompanionStudioTab('cs-chat-style'));
        await page.locator('[data-voice="vocabulary"]').fill('hiya; fair enough; honestly');
        await page.locator('[data-voice="vocabulary"]').blur();
        await page.evaluate(async()=>{await saveState();});
        await page.reload();await ready();
        const worldSaved=await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);const c=getCompanion('attention_fixture');return c.lifeProfile.world;});
        assert.equal(worldSaved.vision.provider,'openrouter');assert.equal(worldSaved.vision.openrouterModel,'fixture/vision');assert.equal(worldSaved.items.length,3);assert.equal(worldSaved.gifts.minTrust,-100);assert.equal(worldSaved.closet.mode,'items');assert.equal(worldSaved.voice.vocabulary,'hiya; fair enough; honestly');
        await page.evaluate(()=>{hideGlobalSettings();const c=getCompanion('attention_fixture');openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-life');renderCompanionLifeEditor(c);c.lifeProfile.world.voice.fillers='a concurrent voice edit';c.lifeProfile.places.push(normalizeCompanionLifePlace({id:'concurrent-room',label:'New room',photo:c.lifeProfile.world.items[2].photo}));});
        await page.locator('#cs-life-editor-save').click();
        await page.waitForFunction(()=>document.getElementById('cs-life-editor').classList.contains('hidden'));
        assert(await page.evaluate(()=>{const c=getCompanion('attention_fixture');return c.lifeProfile.world.voice.fillers==='a concurrent voice edit'&&!!c.lifeProfile.places.find(p=>p.id==='concurrent-room')?.photo;}));

        await page.evaluate(()=>{hideGlobalSettings();const c=getCompanion('attention_fixture');state.activeCompanionId=c.id;switchView('companionChat');renderCompanionThread();document.getElementById('cc-gift-open').click();});
        await page.screenshot({path:'/tmp/vh-gifts-panel.png'});
        await page.locator('[data-gift-mode="cash"]').click();
        assert(await page.locator('[data-gift-item-label]').isHidden());
        assert(await page.locator('[data-gift-upload-label]').isHidden());
        assert.equal(await page.locator('[data-offer-gift]').textContent(),'Send money');
        await page.setViewportSize({width:390,height:844});
        assert(await page.locator('#cc-gift-dialog').evaluate(el=>el.getBoundingClientRect().left>=0&&el.getBoundingClientRect().right<=innerWidth));
        await page.screenshot({path:'/tmp/vh-cash-mobile.png'});
        await page.setViewportSize({width:1280,height:720});
        await page.locator('[data-gift-mode="item"]').click();
        await page.locator(`[data-select-gift="${worldSaved.items[2].id}"]`).click();
        await page.evaluate(()=>{const c=getCompanion('attention_fixture'),now=Date.now();c.lifeProfile.world.transport.enabled=true;c.lifeRuntime.world.placeId=c.lifeProfile.places.find(p=>p.kind==='home').id;c.lifeProfile.weeklySchedule=[];c.lifeProfile.world.gifts.openingMinutes=1;c.lifeRuntime.temporarySituation={activity:'relaxing at home',availability:'available',placeId:c.lifeRuntime.world.placeId,startedAt:now-60000,endsAt:now+3600000};});
        await page.locator('[data-offer-gift]').click();
        await page.evaluate(async()=>{const c=getCompanion('attention_fixture');advanceCompanionWorld(c,Date.now()+181000);await saveState();renderCompanionLifeActions(c);});
        const giftReceived=await page.evaluate(()=>{const c=getCompanion('attention_fixture');return {gifts:c.lifeRuntime.world.gifts,inventory:c.lifeRuntime.world.inventory,brief:companionChatStyleDescription(c)};});
        assert.equal(giftReceived.gifts[0].status,'received');assert(giftReceived.inventory.includes(worldSaved.items[2].id));assert.match(giftReceived.brief,/Opened Gift hoodie/);
        await page.evaluate(()=>{const c=getCompanion('attention_fixture');c.lifeProfile.world.frame={mode:'dating',acceptRequests:true,requestMinutes:0};c.lifeRuntime.world.connection={state:'none'};renderCompanionLifeActions(c);});
        await page.locator('[data-connect]').click();
        await page.evaluate(()=>{const c=getCompanion('attention_fixture');advanceCompanionWorld(c,Date.now()+241000);renderCompanionLifeActions(c);});
        assert(await page.evaluate(()=>VHWorldEngine.connected(getCompanion('attention_fixture'))));
        await page.locator('#cc-gift-close').click();
        await page.evaluate(async()=>{const c=getCompanion('attention_fixture');c.lifeProfile.world=VHWorldEngine.config();c.lifeRuntime.world=VHWorldEngine.runtime();await saveState();});
        assert.deepEqual(errors,[]);
        console.log('PASS: closet, gift delivery, individual vocabulary and dating connection controls run end to end and survive reload');

        await page.evaluate(async () => {
            const c=getCompanion('attention_fixture');
            hideGlobalSettings(); state.activeCompanionId=c.id;
            c.socialFeedEnabled=true;
            c.socialPosts=[normalizeCompanionSocialPost({id:'failed-photo',kind:'photo',text:'Tea break',scene:'Tea on a table',generationError:'Synthetic image error',visibility:'public'})];
            generateCompanionPhoto=async()=> 'synthetic';
            loadGeneratedImage=async()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
            switchView('companionChat'); companionSocialTab='gallery';
            companionSocialPanelVisibility.set(companionSocialPanelKey(c),true);
            renderCompanionSocialPanel(c);
        });
        await page.locator('[data-retry-social-photo="failed-photo"]').waitFor({state:'visible'});
        assert((await page.locator('#companion-social-content').innerText()).includes('Synthetic image error'));
        await page.locator('[data-retry-social-photo="failed-photo"]').click();
        await page.waitForFunction(()=>getCompanion('attention_fixture').socialPosts[0].photo && !getCompanion('attention_fixture').socialPosts[0].pending);
        assert.equal(await page.locator('[data-open-social-photo="failed-photo"]').count(),1);
        assert.equal(await page.locator('[data-retry-social-photo="failed-photo"]').count(),0);
        assert.deepEqual(errors, []);
        console.log('PASS: failed Gallery photos remain visible and retry into a displayed image with mocked generation');
        const mcpUI = await page.evaluate(() => {
            const c = getCompanion('attention_fixture');
            openCompanionStudio(c.id); switchView('companionStudio');
            c.imageSource = 'higgsfield'; c.mcpImageTool = 'generate_image'; c.mcpImageArguments = {};
            companionMcpToolCatalog.higgsfield = [{name:'generate_image', _models:[{id:'fixture-model',name:'Fixture model',parameters:[]}], inputSchema:{properties:{params:{type:'object',required:['model'],properties:{model:{type:'string'},prompt:{type:'string'},medias:{type:'array'},brandKitId:{type:'string'}}}}}}];
            renderCompanionMcpToolSchema(c);
            const input = document.getElementById('cs-mcp-arg-model');
            input.value = 'fixture-model'; input.dispatchEvent(new Event('change', {bubbles:true}));
            const advanced = document.querySelector('#cs-mcp-schema-controls details');
            return {model:c.mcpImageArguments.model, choices:document.querySelectorAll('#cs-mcp-arg-model-options option').length,
                advanced:!!advanced && !advanced.open && !!advanced.querySelector('[data-mcp-argument="brandKitId"]'),
                request:companionMcpGenerationArguments({...c,basePhoto:''}, 'Tea').args};
        });
        assert.equal(mcpUI.model,'fixture-model'); assert.equal(mcpUI.choices,1); assert(mcpUI.advanced);
        assert.equal(mcpUI.request.params.model,'fixture-model');
        assert.deepEqual(errors, []);
        console.log('PASS: MCP searchable model control, collapsed advanced options and nested request mapping');
        const magnificUI = await page.evaluate(fixture => {
            const c = getCompanion('attention_fixture');
            c.imageSource='magnific'; c.mcpImageTool='images_generate'; c.mcpImageArguments={};
            companionMcpToolCatalog.magnific=[{...fixture.tool,_models:companionMagnificModels(fixture.catalog)}];
            updateCompanionImageSourceUI(c); renderCompanionMcpToolResults(c); renderCompanionMcpToolSchema(c);
            activateCompanionStudioTab('cs-voice');
            const input=document.getElementById('cs-mcp-arg-mode');
            const visible=!input.closest('details');
            input.value='imagen-nano-banana-2-flash'; input.dispatchEvent(new Event('change',{bubbles:true}));
            const args=companionMcpGenerationArguments({...c,basePhoto:'data:image/png;base64,aGVsbG8='},'Tea').args;
            return {visible,choices:document.querySelectorAll('#cs-mcp-arg-mode-options option').length,mode:args.mode,reference:args.references[0].type};
        }, JSON.parse(fs.readFileSync(path.join(root,'scratch/fixtures/magnific-image-contract.json'),'utf8')));
        assert(magnificUI.visible); assert.equal(magnificUI.choices,48);
        assert.equal(magnificUI.mode,'imagen-nano-banana-2-flash'); assert.equal(magnificUI.reference,'image');
        assert.deepEqual(errors,[]);
        console.log('PASS: actual Magnific catalog renders 48 model choices, mode remains visible and selection reaches the reference request');
        await page.evaluate(() => {
            const c=getCompanion('attention_fixture');
            c.startingSocialPosts=Array.from({length:7},(_,i)=>normalizeCompanionSocialPost({id:`starter-${i}`,kind:'photo',scene:'Earlier tea break',text:'Tea'}));
            renderCompanionSocialStudio(c); activateCompanionStudioTab('cs-social');
            generateCompanionPhoto=async()=> 'synthetic';
            loadGeneratedImage=async()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
        });
        await page.locator('#cs-social-generate-photos').click();
        await page.waitForFunction(()=>!document.getElementById('cs-social-generate-photos').disabled && document.getElementById('cs-social-seed-status').textContent.includes('7 of 7 photos imported'));
        assert.equal(await page.locator('#cs-social-seed-list img').count(),7);
        await page.evaluate(async()=>{
            const c=getCompanion('attention_fixture');
            c.photoLocations=[];c.lifeProfile.places=[normalizeCompanionLifePlace({id:'bedroom-fixture',label:'Bedroom',referenceDisabled:true})];renderCompanionPhotoLocations(c);
            document.getElementById('cs-photo-location-picker').value='bedroom-fixture';
            await document.getElementById('cs-photo-location-add').onclick();
            const description=document.querySelector('[data-place-description]');description.value='Oak headboard, blue walls';description.dispatchEvent(new Event('input'));
            document.querySelector('[data-place-generate]').click();
        });
        await page.waitForFunction(()=>getCompanion('attention_fixture').lifeProfile.places[0]?.photo);
        await page.evaluate(()=>saveState());
        await page.reload();await ready();
        const restoredPhotos=await page.evaluate(()=>{
            clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);
            const c=getCompanion('attention_fixture');
            return {count:c.startingSocialPosts.filter(p=>p.photo&&!p.pending).length,place:c.lifeProfile.places[0]};
        });
        assert.equal(restoredPhotos.count,7);assert.equal(restoredPhotos.place.label,'Bedroom');assert(restoredPhotos.place.photo);
        assert.deepEqual(errors,[]);
        console.log('PASS: seven starter photos import through real button, completion clears, generated place reference and images survive reload');
        await page.evaluate(()=>{const c=getCompanion('attention_fixture');openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-life');renderCompanionPhotoLocations(c);});
        await page.evaluate(()=>document.getElementById('close-modal-btn').click());
        await page.evaluate(()=>vhBlueprintPlaces(getCompanion('attention_fixture')));
        await page.locator('[data-place-role]').evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
        await page.locator('[data-place-role]').selectOption('bedroom');
        await page.locator('[data-place-remove]').click();
        await page.waitForFunction(()=>getCompanion('attention_fixture').lifeProfile.places[0].referenceDisabled&&document.querySelectorAll('[data-photo-location]').length===0);
        await page.evaluate(()=>saveState());
        await page.reload();await ready();
        assert(await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);const c=getCompanion('attention_fixture');return !c.lifeProfile.places[0].photo&&c.lifeProfile.places[0].referenceDisabled&&c.lifeProfile.places[0].referenceRole==='bedroom';}));
        await page.evaluate(()=>{hideGlobalSettings();const c=getCompanion('attention_fixture');openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-life');renderCompanionPhotoLocations(c);});
        assert.equal(await page.locator('[data-photo-location]').count(),0);
        await page.evaluate(async()=>{document.getElementById('cs-photo-location-picker').value='bedroom-fixture';await document.getElementById('cs-photo-location-add').onclick();});
        assert.equal(await page.locator('[data-photo-location="bedroom-fixture"]').count(),1);
        assert.equal(await page.locator('[data-place-label]').count(),0);
        console.log('PASS: removing a fixed-room reference survives reload and relinking uses its saved location ID');
        await page.evaluate(()=>renderCompanionLegacyWorldSystems(getCompanion('attention_fixture'),document.getElementById('cs-world-systems')));
        await page.locator('[data-kernel="needWeight"]').evaluate(el=>el.closest('details').open=true);
        await page.locator('[data-kernel="needWeight"]').fill('1.7');
        await page.locator('[data-kernel="needWeight"]').evaluate(el=>el.closest('details').setAttribute('data-kernel-panel',''));
        await page.locator('[data-kernel-panel]').screenshot({path:'/tmp/vh-life-kernel-controls.png'});
        await page.locator('[data-kernel="needWeight"]').dispatchEvent('change');
        await page.evaluate(()=>saveState());await page.reload();await ready();
        assert.equal(await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);return getCompanion('attention_fixture').lifeProfile.decisionPolicy.needWeight;}),1.7);
        console.log('PASS: life decision controls persist through real browser reload');

        const photoSequence=await page.evaluate(async()=>{
            const c=getCompanion('attention_fixture'),timeline=getActiveCompanionTimeline(c.id),now=Date.now(),room=c.lifeProfile.places[0];
            room.referenceDisabled=false;room.photo=c.startingSocialPosts[0].photo;c.currentOutfit='Blue silk dress';c.photoDirection='Tilted candid framing';c.lifeRuntime.world.transportEnabled=false;c.lifeRuntime.temporarySituation={activity:'relaxing',availability:'available',placeId:room.id,placeLabel:room.label,outfit:'Blue silk dress',startedAt:now-1000,endsAt:now+600000};
            const requests=[];generateCompanionPhoto=async(person,scene,options)=>{requests.push({previous:options.previousPhoto?.id||'',refs:companionPhotoReferences(person,scene,options),prompt:buildCompanionPhotoPrompt(person,scene,options)});return room.photo;};loadGeneratedImage=async(image,source)=>source;
            const one=normalizeCompanionMessage({id:'continuity-one',role:'companion',type:'photo',scene:'Bedroom, blue silk dress',pending:true,timestamp:now,photoContext:companionPhotoSnapshot(c,'Bedroom, blue silk dress',now)}),two=normalizeCompanionMessage({id:'continuity-two',role:'companion',type:'photo',scene:'Another angle, shorts',pending:true,timestamp:now+1000,photoContext:companionPhotoSnapshot(c,'Another bedroom angle',now+1000)});
            timeline.messages.push(one,two);await Promise.all([resolveCompanionPendingPhoto(c,one),resolveCompanionPendingPhoto(c,two),resolveCompanionPendingPhoto(c,two)]);return {requests,one:one.photo,two:two.photo,parent:two.photoContext.previousPhotoId};
        });
        assert.equal(photoSequence.requests.length,2);assert.equal(photoSequence.parent,'continuity-one');assert(photoSequence.requests[1].refs.includes(photoSequence.one));assert.match(photoSequence.requests[1].prompt,/exact same garments/);assert.match(photoSequence.requests[1].prompt,/Tilted candid framing/);
        console.log('PASS: queued follow-up photos use the completed previous image and retain dress continuity without duplicate generation');
        await page.evaluate(()=>{hideGlobalSettings();const c=getCompanion('attention_fixture');c.lifeProfile.activityOptions=[...c.lifeProfile.activityOptions,{id:'prep-ui',label:'Pack notes',kind:'preparation'}];c.lifeProfile.weeklySchedule.push({id:'prep-class',activity:'Class',days:[2],startMinute:600,endMinute:660,placeId:c.lifeProfile.places[0].id});c.lifeProfile=normalizeCompanionLifeProfile(c.lifeProfile);openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-life');renderCompanionLifeEditor(c);document.querySelector('[data-life-add="supply"]').click();});
        await page.locator('[data-supply-label]').evaluate(el=>el.closest('details').open=true);
        await page.locator('[data-supply-label]').fill('Packed notes');await page.locator('[data-supply-quantity]').fill('2');
        const supplyId=await page.locator('[data-supply-row]').getAttribute('data-supply-row');
        await page.locator('[data-life-opportunity]').last().locator('[data-supply-produces]').evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
        await page.locator('[data-life-opportunity]').last().locator('[data-supply-produces]').fill('1');
        await page.locator('[data-life-schedule]').last().locator('[data-supply-departure]').evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
        await page.locator('[data-life-schedule]').last().locator('[data-supply-departure]').fill('1');
        await page.locator('#cs-life-editor-save').click();await page.waitForFunction(()=>document.getElementById('cs-life-editor').classList.contains('hidden'));await page.reload();await ready();
        const supplies=await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);const c=getCompanion('attention_fixture');return {catalog:c.lifeProfile.supplies,action:c.lifeProfile.activityOptions.find(x=>x.id==='prep-ui'),appointment:c.lifeProfile.weeklySchedule.find(x=>x.id==='prep-class')};});
        assert.equal(supplies.catalog[0].label,'Packed notes');assert.equal(supplies.catalog[0].quantity,2);assert.equal(supplies.action.produces[supplyId],1);assert.equal(supplies.appointment.departureCosts[supplyId],1);
        console.log('PASS: supply catalog, linked activity outputs and departure requirements survive editor save and reload');
        await page.evaluate(()=>{hideGlobalSettings();const c=getCompanion('attention_fixture');openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-life');renderCompanionLifeEditor(c);});
        await page.locator('[data-add-preparation]').evaluate(el=>el.closest('details').open=true);
        await page.locator('[data-preparation-template]').selectOption('prep-class');await page.locator('[data-add-preparation]').click();
        await page.locator('[data-add-preparation]').evaluate(el=>el.closest('details').open=true);
        await page.locator('[data-add-preparation]').evaluate(el=>el.closest('details').setAttribute('data-preparation-panel',''));
        await page.locator('[data-preparation-panel]').screenshot({path:'/tmp/vh-preparation-panel.png'});
        await page.locator('#cs-life-editor-save').click();await page.waitForFunction(()=>document.getElementById('cs-life-editor').classList.contains('hidden'));
        assert(await page.evaluate(()=>{const c=getCompanion('attention_fixture'),supply=c.lifeProfile.supplies.find(x=>x.id.startsWith('ready_'));return supply?.quantity===0&&c.lifeProfile.weeklySchedule.find(b=>b.id==='prep-class').departureCosts[supply.id]===1&&c.lifeProfile.activityOptions.some(o=>o.produces[supply.id]===1&&o.durationMinutes===10);}));
        console.log('PASS: linked preparation template creates an editable action and an unfulfilled departure requirement');
        await page.evaluate(()=>{hideGlobalSettings();const c=getCompanion('attention_fixture');openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-life');});
        await page.evaluate(()=>renderCompanionLegacyWorldSystems(getCompanion('attention_fixture'),document.getElementById('cs-world-systems')));
        await page.locator('[data-sleep-setting="windDownMinutes"]').evaluate(el=>el.closest('details').open=true);
        await page.locator('[data-sleep-setting="windDownMinutes"]').fill('17');
        await page.locator('[data-sleep-setting="windDownMinutes"]').dispatchEvent('change');
        await page.locator('[data-sleep-setting="windDownMinutes"]').evaluate(el=>el.closest('details').setAttribute('data-sleep-panel',''));
        await page.locator('[data-sleep-panel]').screenshot({path:'/tmp/vh-sleep-panel.png'});
        await page.reload();await ready();
        assert.equal(await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);return getCompanion('attention_fixture').lifeProfile.sleepPolicy.windDownMinutes;}),17);
        console.log('PASS: sleep controls save and survive browser reload');
        await page.evaluate(()=>{hideGlobalSettings();const c=getCompanion('attention_fixture');openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-life');});
        await page.evaluate(()=>renderCompanionLegacyWorldSystems(getCompanion('attention_fixture'),document.getElementById('cs-world-systems')));
        await page.locator('[data-break-setting="intervalMinutes"]').evaluate(el=>el.closest('details').open=true);
        await page.locator('[data-break-setting="intervalMinutes"]').fill('150');await page.locator('[data-break-setting="intervalMinutes"]').dispatchEvent('change');
        await page.locator('[data-break-setting="foodAvailable"]').uncheck();
        await page.locator('[data-break-setting="intervalMinutes"]').evaluate(el=>el.closest('details').setAttribute('data-break-panel',''));
        await page.locator('[data-break-panel]').screenshot({path:'/tmp/vh-break-controls.png'});
        await page.locator('[data-kernel="personalityWeight"]').evaluate(el=>el.closest('details').open=true);
        await page.locator('[data-kernel="personalityWeight"]').fill('2');await page.locator('[data-kernel="personalityWeight"]').dispatchEvent('change');
        await page.evaluate(()=>renderCompanionLifeEditor(getCompanion('attention_fixture')));
        await page.locator('[data-break-allowed]').first().evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
        await page.locator('[data-break-allowed]').first().uncheck();await page.locator('#cs-life-editor-save').click();await page.waitForFunction(()=>document.getElementById('cs-life-editor').classList.contains('hidden'));
        await page.reload();await ready();
        const gapSettings=await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);const c=getCompanion('attention_fixture');return {breaks:c.lifeProfile.breakPolicy,allowed:c.lifeProfile.weeklySchedule[0].breakAllowed,personality:c.lifeProfile.decisionPolicy.personalityWeight};});
        assert.equal(gapSettings.breaks.intervalMinutes,150);assert.equal(gapSettings.breaks.foodAvailable,false);assert.equal(gapSettings.allowed,false);assert.equal(gapSettings.personality,2);
        console.log('PASS: break policy, food access, appointment opt-out and personality influence persist through save/reload');






    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
