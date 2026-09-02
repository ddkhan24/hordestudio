/* Horde Studio Multiplayer — host-authoritative shared Chat and World play. */
(function () {
    'use strict';

    const party = {
        mode: 'off', roomCode: '', inviteToken: '', inviteUrl: '', playerId: '',
        playerToken: '', state: null, pollTimer: null, busy: false, context: null,
        campaign: null, activePanel: 'scene', resumeCampaign: false,
        committing: false,
        transport: 'lan', relayUrl: '', socket: null, socketReady: null,
        reconnectTimer: null, reconnectAttempt: 0, pending: new Map()
    };
    let hooks = {};
    const SESSION_KEY = 'horde_multiplayer_session_v3';
    const CAMPAIGN_KEY = 'horde_multiplayer_campaigns_v1';
    const RELAY_KEY = 'horde_multiplayer_relay_url';

    const Engine = window.HordeMultiplayerEngine;
    if (!Engine) throw new Error('multiplayer-engine.js must load before multiplayer.js');
    const RULE_PRESETS = Engine.PACKS;
    const Mechanics = window.HordeRpgMechanics;

    function campaignList() {
        try { const parsed = JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || '[]'); return Array.isArray(parsed) ? parsed.map(Engine.migrateCampaign) : []; }
        catch (_) { return []; }
    }

    function saveCampaign(campaign) {
        if (!campaign?.id) return;
        campaign.updatedAt = Date.now();
        const list = campaignList();
        const index = list.findIndex(item => item.id === campaign.id);
        if (index >= 0) list[index] = campaign; else list.unshift(campaign);
        try { localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(list.slice(0, 40))); }
        catch (error) { window.showToast?.(`Campaign autosave failed: ${error.message}`, 'error'); }
    }

    function newCampaign(template, presetId, name, hostName) {
        const preset = RULE_PRESETS[presetId] || RULE_PRESETS.custom;
        const now = Date.now();
        const initial = JSON.parse(JSON.stringify(template?.snapshot || {}));
        if (!Array.isArray(initial.history)) initial.history = [];
        if (template?.opening && !initial.history.length) initial.history.push({ role: 'dm', text: template.opening });
        const campaign = {
            id: `mp_${now}_${Math.random().toString(36).slice(2, 9)}`, name: String(name || template?.source?.name || 'Shared campaign').slice(0, 80),
            createdAt: now, updatedAt: now, source: template?.source || null,
            provider: template?.provider || '', model: template?.model || '', systemPrompt: template?.systemPrompt || '',
            system: Engine.pack(preset.id, { ...preset, rulesText: '' }),
            snapshot: initial, players: []
        };
        campaign.gameState = Engine.createState(campaign.system, initial);
        campaign.snapshot.campaignMeta = { id: campaign.id, name: campaign.name, system: campaign.system };
        campaign.snapshot.gameState = Engine.clone(campaign.gameState);
        return campaign;
    }

    function emptySheet(persona = {}, name = 'Adventurer', rules = party.campaign?.system || RULE_PRESETS.custom) {
        return Engine.createSheet(rules, persona, name);
    }

    function sheetFromSource(campaign, persona = {}, name = 'Adventurer') {
        const sheet = emptySheet(persona, name, campaign.system); const hud = campaign.snapshot?.hud || {};
        (hud.stats || []).forEach(stat => {
            const resourceId = String(stat.id || stat.name || 'stat').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
            if (!resourceId) return;
            sheet.resources[resourceId] = { id: resourceId, name: String(stat.name || stat.id || 'Stat').slice(0, 80),
                value: Number(stat.value || 0), min: Number(stat.min || 0), max: Number(stat.max || Math.max(1, stat.value || 10)),
                color: String(stat.color || '#E63946').slice(0, 24) };
        });
        sheet.inventory = (hud.inventory || []).map((entry, index) => ({ id: `legacy_${Date.now()}_${index}`,
            name: String(entry?.name || entry || 'Item').slice(0, 120), quantity: Number(entry?.quantity || 1),
            description: String(entry?.description || '').slice(0, 600), tags: ['imported'], equipped: false, modifiers: {} }));
        const outfit = String(hud.outfit || '').trim();
        if (outfit) { sheet.notes = `Imported outfit: ${outfit}`; sheet.inventory.unshift({ id: `outfit_${Date.now()}`,
            name: outfit.slice(0, 120), quantity: 1, description: 'Outfit imported from the source timeline.', tags: ['outfit', 'imported'], equipped: true, slot: 'body', modifiers: {} });
            if ('body' in sheet.equipment) sheet.equipment.body = sheet.inventory[0].id; }
        sheet.location = String(campaign.snapshot?.location || hud.location?.name || campaign.gameState.scene?.name || '').slice(0, 160);
        if (hud.ledger) sheet.notes += `${sheet.notes ? '\n' : ''}Imported ledger: ${String(hud.ledger).slice(0, 2400)}`;
        return sheet;
    }

    const listInput = id => String(byId(id)?.value || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 60);
    function applyAuthoredSystem(system) {
        const attributes = listInput('world-party-attributes'); const skills = listInput('world-party-skills');
        const slots = listInput('world-party-slots').map(value => value.toLowerCase().replace(/\s+/g, '-'));
        const resources = String(byId('world-party-resources')?.value || '').split('\n').map(line => {
            const [rawName, rawMax] = line.split(':'); const name = rawName?.trim(); if (!name) return null;
            const max = Math.max(1, Math.min(100000, Number(rawMax) || 10));
            return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60), name: name.slice(0, 80), max };
        }).filter(entry => entry?.id).slice(0, 30);
        const die = String(byId('world-party-die')?.value || '').trim(); const target = Number(byId('world-party-target')?.value || 0);
        const progressionKind = byId('world-party-progression')?.value;
        const mechanicsMode = byId('world-party-mechanics-mode')?.value || system.mechanicsMode || 'full';
        return Engine.pack(system.id, { ...system, ...(attributes.length ? { attributes } : {}), ...(skills.length ? { skills } : {}),
            ...(slots.length ? { slots } : {}), ...(resources.length ? { resources } : {}), ...(die ? { die } : {}),
            ...(target > 0 ? { target } : {}), mechanicsMode,
            progression: { ...(system.progression || {}), ...(progressionKind ? { kind: progressionKind } : {}) } });
    }

    function hydrateSystemEditor(system) {
        const rules = Engine.pack(system?.id || 'custom', system || {});
        const set = (id, value) => { if (byId(id)) byId(id).value = value ?? ''; };
        set('world-party-attributes', (rules.attributes || []).join(', '));
        set('world-party-skills', (rules.skills || []).join(', '));
        set('world-party-resources', (rules.resources || []).map(resource => `${resource.name}:${resource.max}`).join('\n'));
        set('world-party-slots', (rules.slots || []).join(', '));
        set('world-party-die', rules.die || 'd20'); set('world-party-target', rules.target || 10);
        set('world-party-progression', rules.progression?.kind || 'xp');
        set('world-party-mechanics-mode', rules.mechanicsMode || (rules.id === 'narrative' ? 'light' : 'full'));
    }

    const byId = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));

    function auth(extra = {}) {
        return { roomCode: party.roomCode, inviteToken: party.inviteToken,
            playerId: party.playerId, playerToken: party.playerToken, ...extra };
    }

    function isGuestOrigin() {
        return new URLSearchParams(location.search).has('multiplayer') && /^https?:$/.test(location.protocol);
    }

    function normalizeRelay(value) {
        let raw = String(value || '').trim().replace(/\/$/, '');
        if (!raw) return '';
        if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
        const url = new URL(raw);
        if (!/^https?:$/.test(url.protocol)) throw new Error('Relay URL must use HTTPS.');
        return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`;
    }

    function encodeInvite(details) {
        const bytes = new TextEncoder().encode(JSON.stringify(details));
        let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return `HS1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
    }

    function decodeInvite(value) {
        const raw = String(value || '').trim();
        if (!raw.startsWith('HS1.')) return null;
        const encoded = raw.slice(4).replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(encoded + '='.repeat((4 - encoded.length % 4) % 4));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        return { transport: 'online', relayUrl: normalizeRelay(parsed.relay),
            roomCode: String(parsed.roomCode || '').toUpperCase(), inviteToken: String(parsed.inviteToken || '') };
    }

    async function relayFetch(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${party.relayUrl}${path}`, { method: 'POST',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `Relay request failed (${response.status}).`);
            return data;
        } finally { clearTimeout(timer); }
    }

    function socketUrl() {
        const relay = new URL(party.relayUrl);
        relay.protocol = relay.protocol === 'https:' ? 'wss:' : 'ws:';
        relay.pathname = `${relay.pathname.replace(/\/$/, '')}/api/rooms/${party.roomCode}/socket`;
        return relay.toString();
    }

    function socketCommand(command, payload = {}, timeoutMs = 12000) {
        return new Promise(async (resolve, reject) => {
            try { await connectSocket(); } catch (error) { reject(error); return; }
            const id = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const timer = setTimeout(() => { party.pending.delete(id); reject(new Error('Internet room timed out.')); }, timeoutMs);
            party.pending.set(id, { resolve, reject, timer });
            party.socket.send(JSON.stringify({ id, command, inviteToken: party.inviteToken,
                playerId: party.playerId, playerToken: party.playerToken, payload }));
        });
    }

    function connectSocket() {
        if (party.transport !== 'online') return Promise.resolve();
        if (party.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
        if (party.socketReady) return party.socketReady;
        party.socketReady = new Promise((resolve, reject) => {
            let settled = false;
            const socket = new WebSocket(socketUrl()); party.socket = socket;
            const fail = message => { if (!settled) { settled = true; reject(new Error(message)); } };
            socket.onopen = () => {
                const id = `auth_${Date.now()}`;
                const timer = setTimeout(() => fail('Relay authentication timed out.'), 10000);
                party.pending.set(id, { resolve: data => { clearTimeout(timer); settled = true; party.state = data;
                    party.reconnectAttempt = 0; render(); resolve(); }, reject: error => { clearTimeout(timer); fail(error.message); }, timer });
                socket.send(JSON.stringify({ id, command: 'authenticate', inviteToken: party.inviteToken,
                    playerId: party.playerId, playerToken: party.playerToken }));
            };
            socket.onmessage = event => {
                let message; try { message = JSON.parse(event.data); } catch (_) { return; }
                if (message.event === 'room-updated') { void poll(); return; }
                const pending = party.pending.get(message.id); if (!pending) return;
                clearTimeout(pending.timer); party.pending.delete(message.id);
                message.ok ? pending.resolve(message.data) : pending.reject(new Error(message.error || 'Relay request failed.'));
            };
            socket.onerror = () => fail('Could not connect to the online room server. Check its address and try again.');
            socket.onclose = () => {
                party.socket = null; party.socketReady = null;
                if (!settled) fail('Relay connection closed.');
                if (party.mode !== 'off' && party.transport === 'online') scheduleReconnect();
            };
        }).finally(() => { party.socketReady = null; });
        return party.socketReady;
    }

    function scheduleReconnect() {
        clearTimeout(party.reconnectTimer);
        const delay = Math.min(15000, 700 * (2 ** Math.min(5, party.reconnectAttempt++)));
        if (byId('world-party-action-status')) byId('world-party-action-status').textContent = `Reconnecting in ${Math.ceil(delay / 1000)}s…`;
        party.reconnectTimer = setTimeout(() => connectSocket().then(poll).catch(scheduleReconnect), delay);
    }

    async function request(path, body = {}) {
        if (party.transport === 'online' && party.mode !== 'off') {
            const commands = { '/multiplayer/state': 'state', '/multiplayer/submit': 'submit',
                '/multiplayer/commit': 'commit', '/multiplayer/propose': 'propose',
                '/multiplayer/vote': 'vote', '/multiplayer/resolve': 'resolve', '/multiplayer/close': 'close',
                '/multiplayer/sheet': 'sheet', '/multiplayer/roll': 'roll', '/multiplayer/gm': 'gm' };
            const command = commands[path];
            if (!command) throw new Error('Unsupported Internet room request.');
            return socketCommand(command, body);
        }
        if (!isGuestOrigin()) return hooks.bridgeRequest(path, { method: 'POST', body, timeoutMs: 12000 });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(location.origin + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body), signal: controller.signal
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `Multiplayer request failed (${response.status}).`);
            return data;
        } finally { clearTimeout(timer); }
    }

    function setMode(mode, credentials = {}) {
        party.mode = mode;
        Object.assign(party, credentials);
        if (mode === 'off') {
            clearInterval(party.pollTimer);
            clearTimeout(party.reconnectTimer);
            try { party.socket?.close(1000, 'Leaving room'); } catch (_) {}
            party.socket = null;
            party.pollTimer = null;
            party.state = null;
            sessionStorage.removeItem(SESSION_KEY);
            hooks.leaveSession?.();
        } else {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                mode, roomCode: party.roomCode, inviteToken: party.inviteToken,
                inviteUrl: party.inviteUrl, playerId: party.playerId,
                playerToken: party.playerToken, context: party.context,
                transport: party.transport, relayUrl: party.relayUrl,
                campaignId: party.campaign?.id || ''
            }));
            hooks.enterSession?.();
        }
    }

    function open(context = null) {
        if (context) party.context = context;
        if (party.mode !== 'off') {
            close();
            render();
            return;
        }
        if (!party.context && party.mode === 'off') party.context = hooks.currentContext?.() || null;
        const overlay = byId('world-multiplayer-overlay');
        overlay?.classList.remove('hidden');
        overlay?.setAttribute('aria-hidden', 'false');
        byId('world-party-start')?.classList.remove('hidden');
        byId('world-party-room')?.classList.add('hidden');
        const type = party.context?.type || party.state?.experienceType || 'world';
        if (byId('world-party-title')) byId('world-party-title').textContent = 'Create Multiplayer Campaign';
        if (byId('world-party-host-heading')) byId('world-party-host-heading').textContent = party.resumeCampaign ? 'Reopen this campaign' : `Create from this ${type === 'chat' ? 'Chat' : 'World'}`;
        if (byId('world-party-subtitle')) byId('world-party-subtitle').textContent = 'An independent online tabletop save with its own party, rules and history.';
    }

    function close() {
        const overlay = byId('world-multiplayer-overlay');
        overlay?.classList.add('hidden');
        overlay?.setAttribute('aria-hidden', 'true');
    }

    async function host() {
        const context = party.context || hooks.currentContext?.();
        if (!context && !party.campaign) return window.showToast?.('Choose a template or saved multiplayer campaign before hosting.', 'error');
        const button = byId('world-party-host-btn');
        button.disabled = true;
        const transport = party.transport === 'online' ? 'online' : 'lan';
        button.textContent = transport === 'online' ? 'Creating Internet room…' : 'Starting secure LAN room…';
        try {
            const hostName = byId('world-party-host-name').value || 'Host';
            if (!party.resumeCampaign || !party.campaign) {
                const template = hooks.campaignTemplate?.(party.context);
                if (!template) throw new Error('Could not copy that source into a multiplayer campaign.');
                party.campaign = newCampaign(template, byId('world-party-rules-preset')?.value || 'custom',
                    byId('world-party-campaign-name')?.value || party.context.name, hostName);
                party.campaign.system.rulesText = String(byId('world-party-custom-rules')?.value || '').slice(0, 8000);
            } else {
                party.campaign.name = String(byId('world-party-campaign-name')?.value || party.campaign.name).slice(0, 80);
                party.campaign.system = { ...(RULE_PRESETS[byId('world-party-rules-preset')?.value] || party.campaign.system), rulesText: String(byId('world-party-custom-rules')?.value || party.campaign.system?.rulesText || '').slice(0, 8000) };
                party.campaign.snapshot.campaignMeta = { id: party.campaign.id, name: party.campaign.name, system: party.campaign.system };
            }
            party.campaign.system = applyAuthoredSystem(party.campaign.system);
            party.campaign.gameState.rules = Engine.clone(party.campaign.system);
            party.campaign.snapshot.campaignMeta = { id: party.campaign.id, name: party.campaign.name, system: party.campaign.system };
            party.campaign.snapshot.gameState = Engine.clone(party.campaign.gameState);
            saveCampaign(party.campaign);
            const persona = hooks.currentPersona?.() || {};
            const hostSheet = sheetFromSource(party.campaign, persona, hostName);
            const payload = {
                    experienceType: party.campaign.source?.type || party.context?.type || 'world', experienceName: party.campaign.name,
                    worldName: party.campaign.name, sessionName: party.campaign.name,
                    displayName: hostName,
                    persona, sheet: hostSheet, snapshot: party.campaign.snapshot
            };
            let result;
            if (transport === 'online') {
                party.relayUrl = normalizeRelay(byId('world-party-relay-url')?.value || party.relayUrl);
                if (!party.relayUrl) throw new Error('Enter your online room server address. Use “How to set one up free” if you do not have one yet.');
                localStorage.setItem(RELAY_KEY, party.relayUrl);
                result = await relayFetch('/api/rooms', payload);
                party.roomCode = result.roomCode; party.inviteToken = result.inviteToken;
                party.playerId = result.hostPlayerId; party.playerToken = result.playerToken;
                result.inviteUrl = encodeInvite({ relay: party.relayUrl, roomCode: result.roomCode, inviteToken: result.inviteToken });
            } else result = await hooks.bridgeRequest('/multiplayer/rooms', { method: 'POST', timeoutMs: 12000, body: payload });
            party.campaign.players = [{ id: result.hostPlayerId, name: hostName, persona, sheet: hostSheet }];
            party.campaign.gameState.characters[result.hostPlayerId] = Engine.clone(hostSheet);
            party.campaign.snapshot.gameState = Engine.clone(party.campaign.gameState);
            saveCampaign(party.campaign);
            setMode('host', { roomCode: result.roomCode, inviteToken: result.inviteToken,
                inviteUrl: result.inviteUrl, playerId: result.hostPlayerId, playerToken: result.playerToken,
                transport, relayUrl: party.relayUrl });
            close();
            startPolling();
            window.showToast?.(`${party.campaign.name} is live ${transport === 'online' ? 'on the Internet' : 'on your local network'}. The original single-player save is untouched.`, 'success');
        } catch (error) { window.showToast?.(`Could not host: ${error.message}`, 'error'); }
        finally { button.disabled = false; button.textContent = party.transport === 'online' ? 'Create Internet room' : 'Create LAN room'; }
    }

    function inviteFromLocation() {
        return new URLSearchParams(location.hash.replace(/^#/, '')).get('invite') || '';
    }

    async function join() {
        const raw = String(byId('world-party-room-code').value || '').trim();
        let decoded = null; try { decoded = decodeInvite(raw); } catch (_) {}
        const roomCode = decoded?.roomCode || raw.toUpperCase();
        const inviteToken = decoded?.inviteToken || inviteFromLocation() || sessionStorage.getItem(`horde_party_invite_${roomCode}`) || '';
        if (!roomCode || !inviteToken) return window.showToast?.('Use the complete invite link from the host.', 'error');
        const button = byId('world-party-join-btn');
        button.disabled = true;
        try {
            let result;
            if (decoded) {
                party.transport = 'online'; party.relayUrl = decoded.relayUrl;
                const persona = hooks.currentPersona?.() || {};
                result = await relayFetch(`/api/rooms/${roomCode}/join`, { roomCode, inviteToken,
                    displayName: byId('world-party-join-name').value || 'Player', persona,
                    sheet: emptySheet(persona, byId('world-party-join-name').value || 'Player', party.state?.snapshot?.gameState?.rules) });
            } else result = await request('/multiplayer/join', { roomCode, inviteToken,
                displayName: byId('world-party-join-name').value || 'Player', persona: hooks.currentPersona?.(),
                sheet: emptySheet(hooks.currentPersona?.(), byId('world-party-join-name').value || 'Player') });
            sessionStorage.setItem(`horde_party_invite_${roomCode}`, inviteToken);
            setMode('guest', { roomCode, inviteToken, playerId: result.playerId, playerToken: result.playerToken,
                transport: decoded ? 'online' : 'lan', relayUrl: decoded?.relayUrl || '' });
            close();
            startPolling();
        } catch (error) { window.showToast?.(`Could not join: ${error.message}`, 'error'); }
        finally { button.disabled = false; }
    }

    async function poll() {
        if (party.mode === 'off' || party.busy || party.committing) return;
        party.busy = true;
        try {
            party.state = await request('/multiplayer/state', auth());
            if (!party.context) party.context = {
                type: party.state?.experienceType || 'world',
                name: party.state?.experienceName || party.state?.worldName || 'Shared session'
            };
            const synchronized = campaignForRender(party.state);
            if (Number(synchronized.lastRoomRevision || -1) !== Number(party.state.revision || 0)) {
                synchronized.snapshot = Engine.clone(party.state.snapshot || synchronized.snapshot || {});
                synchronized.gameState = Engine.clone(synchronized.snapshot.gameState || synchronized.gameState);
                synchronized.players = (party.state.players || []).map(player => ({ ...player,
                    sheet: synchronized.gameState?.characters?.[player.id] || player.sheet }));
                synchronized.lastRoomRevision = Number(party.state.revision || 0); saveCampaign(synchronized);
            }
            render();
        } catch (error) {
            if (byId('world-party-action-status')) byId('world-party-action-status').textContent = `Disconnected · ${error.message}`;
        } finally { party.busy = false; }
    }

    function startPolling() {
        clearInterval(party.pollTimer);
        void poll();
        party.pollTimer = setInterval(poll, party.transport === 'online' ? 20000 : 1800);
    }

    function initials(name) {
        return String(name || '?').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    }

    function voteMarkup(proposal) {
        if (!proposal || proposal.status === 'applied') return '';
        const canVote = proposal.status === 'open' && proposal.myVote == null;
        const canApply = party.mode === 'host' && proposal.status === 'approved';
        return `<div class="party-vote-inline"><strong>Vote · ${escape(proposal.label)}</strong><p>${proposal.yes} yes · ${proposal.no} no · ${escape(proposal.status)}</p><div>${canVote ? '<button class="btn btn-primary btn-small" data-party-vote="yes">Yes</button><button class="btn btn-ghost btn-small" data-party-vote="no">No</button>' : ''}${canApply ? '<button class="btn btn-primary btn-small" data-party-apply>Apply approved decision</button>' : ''}</div></div>`;
    }

    function campaignForRender(current) {
        if (party.campaign) return Engine.migrateCampaign(party.campaign);
        const restoredId = (() => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}').campaignId; } catch (_) { return ''; } })();
        party.campaign = campaignList().find(item => item.id === restoredId) || {
            id: `guest_${party.roomCode}`, name: current.experienceName || current.worldName || 'Shared campaign',
            source: { type: current.experienceType || 'world' }, system: current.snapshot?.campaignMeta?.system || { ...RULE_PRESETS.custom },
            snapshot: current.snapshot || {}, players: []
        };
        if (current.snapshot?.campaignMeta?.name) party.campaign.name = current.snapshot.campaignMeta.name;
        if (current.snapshot?.gameState?.rules) party.campaign.system = Engine.clone(current.snapshot.gameState.rules);
        if (current.snapshot?.gameState) party.campaign.gameState = Engine.clone(current.snapshot.gameState);
        return Engine.migrateCampaign(party.campaign);
    }

    function renderTranscript(history) {
        const container = byId('mp-session-transcript');
        if (!container) return;
        container.innerHTML = (history || []).map(item => `<article class="mp-message ${item.role === 'dm' ? 'gm' : 'player'}"><small>${item.role === 'dm' ? 'GAME MASTER' : item.name ? escape(item.name) : 'PARTY'}</small><div>${escape(item.text).replace(/\n/g, '<br>')}</div></article>`).join('')
            || '<div class="mp-empty"><strong>The table is ready.</strong><span>Submit the first round when everyone has joined.</span></div>';
        container.scrollTop = container.scrollHeight;
    }

    function effectLabel(entry) {
        if (typeof entry === 'string') return entry;
        const modifier = Number(entry?.modifiers?.checks || 0);
        const duration = Number(entry?.duration ?? -1);
        return [entry?.name || 'Effect', modifier ? `${modifier > 0 ? '+' : ''}${modifier} checks` : '', duration < 0 ? 'persistent' : `${duration} rd`]
            .filter(Boolean).join(' · ');
    }

    function renderSidePanel(campaign, current) {
        const panel = byId('mp-session-panel');
        if (!panel) return;
        const hud = current.snapshot?.hud || campaign.snapshot?.hud || {};
        const game = current.snapshot?.gameState || campaign.gameState || {};
        if (party.activePanel === 'character') {
            const sheet = game.characters?.[party.playerId] || campaign.players?.find(p => p.id === party.playerId)?.sheet || emptySheet();
            const resources = Object.values(sheet.resources || {}).map(resource => `<div class="mp-resource"><div><span>${escape(resource.name)}</span><strong>${escape(resource.value)} / ${escape(resource.max)}</strong></div><div><i style="width:${Math.max(0, Math.min(100, (Number(resource.value) - Number(resource.min || 0)) / Math.max(1, Number(resource.max) - Number(resource.min || 0)) * 100))}%"></i></div></div>`).join('');
            const effects = [...(sheet.conditions || []), ...(sheet.effects || [])].map(effectLabel).filter(Boolean).map(name => `<span class="mp-effect-chip">${escape(name)}</span>`).join('');
            const equipped = Object.entries(sheet.equipment || {}).map(([slot, itemId]) => `<li><span>${escape(slot)}</span><strong>${escape(sheet.inventory?.find(item => item.id === itemId)?.name || 'Empty')}</strong></li>`).join('');
            const inventory = (sheet.inventory || []).slice(0, 12).map(item => `<li><span>${escape(item.name || item)}</span><strong>${escape(item.quantity || 1)}</strong></li>`).join('');
            const threshold = Engine.levelThreshold(campaign.system, Number(sheet.level || 1));
            const progression = campaign.system?.progression === 'milestone'
                ? `${escape(sheet.advancement || 0)} advancement` : `${escape(sheet.xp || 0)} / ${escape(threshold)} XP`;
            const defenses = Object.entries(sheet.defenses || {}).map(([name, value]) => `<li><span>${escape(name)}</span><strong>${escape(value)}</strong></li>`).join('');
            const currencies = Object.entries(sheet.currencies || {}).map(([name, value]) => `<li><span>${escape(name)}</span><strong>${escape(value)}</strong></li>`).join('');
            panel.innerHTML = `<section class="mp-character-summary"><div><span>${escape(initials(sheet.name))}</span><div><h3>${escape(sheet.name)}</h3><p>Level ${escape(sheet.level || 1)} · ${escape(sheet.status || 'ready')}</p></div></div><button class="btn btn-ghost btn-small" data-mp-open-sheet="${escape(party.playerId)}">Open sheet</button></section><section class="mp-info-card"><span>PROGRESSION</span><p>${progression}</p></section>${resources ? `<section class="mp-info-card"><span>RESOURCES</span>${resources}</section>` : ''}${defenses || currencies ? `<section class="mp-info-card"><span>DEFENSES &amp; CURRENCY</span><ul class="mp-slot-list">${defenses}${currencies}</ul></section>` : ''}<section class="mp-info-card"><span>STATUS EFFECTS</span><div class="mp-effect-list">${effects || '<small>None</small>'}</div></section><section class="mp-info-card"><span>LOADOUT & OUTFIT</span><ul class="mp-slot-list">${equipped || '<li>Nothing equipped</li>'}</ul></section><section class="mp-info-card"><span>INVENTORY</span><ul class="mp-slot-list">${inventory || '<li>Empty</li>'}</ul></section>`;
            panel.querySelector('[data-mp-open-sheet]')?.addEventListener('click', event => openCharacterSheet(event.currentTarget.dataset.mpOpenSheet));
        } else if (party.activePanel === 'rules') {
            panel.innerHTML = `<section class="mp-info-card"><span>RULE SYSTEM</span><h3>${escape(campaign.system?.name || 'Custom / system agnostic')}</h3><p>${escape(campaign.system?.resolution || 'Host adjudication')}</p></section><section class="mp-info-card"><span>INITIATIVE</span><p>${escape(campaign.system?.initiative || 'Round robin')}</p></section><section class="mp-info-card"><span>DICE</span><p>${escape(campaign.system?.die || campaign.system?.dice || 'No required dice')}</p></section><p class="mp-rail-note">Rules belong to this campaign. Horde Studio does not assume fantasy, D20, modern technology, or a single protagonist.</p>`;
        } else if (party.activePanel === 'log') {
            panel.innerHTML = `<section class="mp-info-card"><span>ROOM</span><h3>${escape(party.transport === 'online' ? 'Internet room' : 'LAN room')}</h3><p>${escape(party.roomCode)}</p></section><section class="mp-info-card"><span>AUTHORITY</span><p>The host owns the model connection and canonical campaign save.</p></section>`;
        } else {
            const stats = (hud.stats || []).map(stat => `<div class="mp-meter"><span>${escape(stat.name)}</span><strong>${escape(stat.value)}</strong></div>`).join('');
            const clocks = (game.clocks || []).map(clock => `<div class="mp-clock"><span>${escape(clock.name)}</span><div><i style="width:${Math.max(0, Math.min(100, Number(clock.value || 0) / Math.max(1, Number(clock.max || 1)) * 100))}%"></i></div><strong>${escape(clock.value)}/${escape(clock.max)}</strong></div>`).join('');
            const quests = (game.quests || []).filter(q => q.status !== 'complete').slice(0, 6).map(q => `<li><strong>${escape(q.title)}</strong><small>${escape(q.status || 'active')}</small></li>`).join('');
            const encounter = (game.encounters || []).find(entry => entry.status === 'active');
            const actorName = actorId => current.players?.find(player => player.id === actorId)?.name || game.npcs?.[actorId]?.name || actorId;
            const initiative = (encounter?.initiative || []).map((actorId, index) => `<li><span>${index + 1}. ${escape(actorName(actorId))}</span>${index === Number(encounter.turn || 0) ? '<strong>ACTIVE</strong>' : ''}</li>`).join('');
            const npcs = Object.entries(game.npcs || {}).map(([npcId, npc]) => `<li><span>${escape(npc.name)}</span><strong>${escape(Object.values(npc.resources || {})[0]?.value ?? (npc.status || 'active'))}</strong></li>`).join('');
            const shared = (game.sharedInventory || []).map(item => `<li><span>${escape(item.name)}</span><strong>${escape(item.quantity || 1)}</strong></li>`).join('');
            panel.innerHTML = `<section class="mp-info-card"><span>CURRENT SCENE</span><h3>${escape(game.scene?.name || hud.location?.name || current.snapshot?.location || 'Unestablished')}</h3><p>${escape(game.scene?.description || hud.location?.description || 'The facilitator will establish the scene in play.')}</p></section>${encounter ? `<section class="mp-info-card mp-encounter-card"><span>ACTIVE ENCOUNTER</span><h3>${escape(encounter.name)}</h3><p>Round ${escape(encounter.round || 1)} · ${escape((encounter.initiative || []).length ? 'Initiative established' : 'Flexible spotlight')}</p>${initiative ? `<ul class="mp-slot-list">${initiative}</ul>` : ''}</section>` : ''}${npcs ? `<section class="mp-info-card"><span>NPCS &amp; ADVERSARIES</span><ul class="mp-slot-list">${npcs}</ul></section>` : ''}${shared ? `<section class="mp-info-card"><span>PARTY INVENTORY</span><ul class="mp-slot-list">${shared}</ul></section>` : ''}${game.scene?.clock || hud.clock ? `<section class="mp-info-card"><span>TIME</span><p>${escape(game.scene?.clock || hud.clock)}${game.scene?.weather || hud.weather ? ` · ${escape(game.scene?.weather || hud.weather)}` : ''}</p></section>` : ''}${clocks ? `<section class="mp-info-card"><span>CAMPAIGN CLOCKS</span>${clocks}</section>` : ''}${quests ? `<section class="mp-info-card"><span>QUESTS</span><ul class="mp-quest-list">${quests}</ul></section>` : ''}${stats ? `<section class="mp-info-card legacy"><span>SOURCE-WORLD METERS</span>${stats}</section>` : ''}`;
        }
    }

    function renderSession(current, submissions, myTurn, mineSubmitted) {
        hooks.enterSession?.();
        const campaign = campaignForRender(current);
        campaign.snapshot = current.snapshot || campaign.snapshot || {};
        campaign.gameState = campaign.snapshot.gameState || campaign.gameState || Engine.createState(campaign.system, campaign.snapshot);
        campaign.players = (current.players || []).map(player => {
            const sheet = player.sheet || campaign.gameState.characters?.[player.id] || emptySheet(player.persona, player.name, campaign.system);
            campaign.gameState.characters[player.id] = Engine.normalizeSheet(sheet, campaign.system, player.persona, player.name);
            return { ...player, sheet: campaign.gameState.characters[player.id] };
        });
        campaign.snapshot.gameState = Engine.clone(campaign.gameState);
        if (party.mode === 'host') saveCampaign(campaign);
        byId('mp-session-title').textContent = campaign.name;
        byId('mp-session-system').textContent = (campaign.system?.name || 'Custom').toUpperCase();
        byId('mp-session-subtitle').textContent = `${party.mode === 'host' ? 'Hosting' : 'Joined'} · ${party.transport === 'online' ? 'Internet' : 'LAN'} · ${current.players.length} player${current.players.length === 1 ? '' : 's'}`;
        byId('mp-session-invite')?.classList.toggle('hidden', party.mode !== 'host');
        byId('mp-session-gm')?.classList.toggle('hidden', party.mode !== 'host');
        byId('mp-session-player-count').textContent = `${current.players.length} player${current.players.length === 1 ? '' : 's'}`;
        byId('mp-session-round').textContent = `Round ${current.round.number}`;
        const diceButton = byId('mp-session-dice');
        if (diceButton) {
            const mechanicsOff = Mechanics.mode(campaign.system?.mechanicsMode || 'full') === 'off';
            diceButton.classList.toggle('mechanics-off', mechanicsOff);
            diceButton.setAttribute('aria-disabled', mechanicsOff ? 'true' : 'false');
            diceButton.title = mechanicsOff ? 'Mechanical checks are off. The host can re-enable them in the GM Console.' : `Roll using ${campaign.system?.name || 'this campaign'} rules`;
        }
        byId('mp-session-roster').innerHTML = current.players.map((player, index) => {
            const active = current.round.activePlayerId === player.id;
            const submitted = !!submissions.get(player.id)?.submitted;
            const sheet = campaign.gameState.characters[player.id] || {};
            const primary = Object.values(sheet.resources || {})[0];
            return `<button class="mp-roster-player${active ? ' active' : ''}" type="button" data-player-id="${escape(player.id)}"><span>${escape(initials(player.name))}</span><span><strong>${escape(sheet.name || player.name)}${player.isHost ? ' ♛' : ''}</strong><small>Lv ${escape(sheet.level || 1)}${primary ? ` · ${escape(primary.name)} ${escape(primary.value)}/${escape(primary.max)}` : ''}</small><em>${submitted ? 'Ready' : active ? 'Taking turn' : player.online ? 'Waiting' : 'Offline'}</em></span></button>`;
        }).join('');
        byId('mp-session-roster').querySelectorAll('[data-player-id]').forEach(button => button.addEventListener('click', () => openCharacterSheet(button.dataset.playerId)));
        renderTranscript(campaign.snapshot.history || []);
        renderSidePanel(campaign, current);
        const input = byId('mp-session-input');
        const submitButton = byId('mp-session-submit');
        const allowed = myTurn && !mineSubmitted;
        input.disabled = !allowed;
        submitButton.disabled = !allowed || !String(input.value || '').trim();
        input.placeholder = mineSubmitted ? 'Your turn is submitted. Waiting for the party…' : myTurn ? 'Describe what your character does…' : 'Waiting for the current player…';
        byId('mp-session-turn-status').textContent = mineSubmitted ? 'Submitted · waiting for party' : myTurn ? 'Your turn' : current.round.status === 'ready' ? 'Round ready' : 'Waiting';
        const commitButton = byId('mp-session-commit');
        commitButton.classList.toggle('hidden', !(party.mode === 'host' && current.round.status === 'ready'));
        commitButton.textContent = current.experienceType === 'chat' ? 'Create shared reply' : 'Resolve round';
        const rerollButton = byId('mp-session-reroll');
        if (rerollButton) rerollButton.disabled = !(campaign.snapshot.history || []).some(item => item.role === 'dm');
        const voteBox = byId('mp-session-vote');
        const voteHtml = voteMarkup(current.proposal);
        voteBox.innerHTML = voteHtml;
        voteBox.classList.toggle('hidden', !voteHtml);
        voteBox.querySelector('[data-party-vote="yes"]')?.addEventListener('click', () => vote(true));
        voteBox.querySelector('[data-party-vote="no"]')?.addEventListener('click', () => vote(false));
        voteBox.querySelector('[data-party-apply]')?.addEventListener('click', applyDecision);
    }

    async function copyInvite() {
        try { await navigator.clipboard.writeText(party.inviteUrl); window.showToast?.('Invite link copied.', 'success'); }
        catch (_) { window.showToast?.('Copy the invite shown in Party details.', 'info'); }
    }

    function render() {
        const current = party.state;
        if (!current || party.mode === 'off') return;
        close();
        const type = current.experienceType || party.context?.type || 'world';
        if (!party.context) party.context = { type, name: current.experienceName || current.worldName };
        const submissions = new Map((current.round?.submissions || []).map(item => [item.playerId, item]));
        const mineSubmitted = !!submissions.get(party.playerId)?.submitted;
        const myTurn = current.round?.status === 'collecting' && current.round?.activePlayerId === party.playerId;
        renderSession(current, submissions, myTurn, mineSubmitted);
    }

    async function submit(text) {
        const action = String(text || '').trim();
        if (!action) return;
        try {
            await request('/multiplayer/submit', auth({ text: action }));
            if (byId('mp-session-input')) byId('mp-session-input').value = '';
            await poll();
        } catch (error) { window.showToast?.(error.message, 'error'); }
    }

    async function tinyBrainReferee(actions, campaign) {
        if (typeof window.HordeLabsNeedle?.completeStructured !== 'function') return { checks: [], diagnostics: ['TinyBrain 2 unavailable; deterministic validation remained active.'] };
        const game = campaign.gameState; const checks = []; const diagnostics = [];
        const players = party.state?.players || [];
        for (const action of actions.slice(0, 12)) {
            const player = players.find(entry => entry.id === action.playerId); const sheet = game.characters?.[action.playerId];
            if (!player || !sheet) continue;
            const tools = [{ name: 'request_check', description: 'Use only when the declared action has meaningful uncertainty, danger, resistance, or stakes. Do not request checks for ordinary automatic actions.', parameters: { type: 'object', properties: {
                attribute: { type: 'string', enum: ['', ...Object.keys(sheet.attributes || {})] }, skill: { type: 'string', enum: ['', ...Object.keys(sheet.skills || {})] },
                difficulty: { type: 'number', minimum: 2, maximum: 40 }, label: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }
            }, required: ['attribute', 'skill', 'difficulty', 'label', 'confidence'] } },
            { name: 'automatic_action', description: 'Use when the action is ordinary, safe, uncontested, impossible without further context, or should simply enter the fiction without a roll.', parameters: { type: 'object', properties: { reason: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['reason', 'confidence'] } }];
            try {
                const result = await window.HordeLabsNeedle.completeStructured({ name: 'multiplayer_referee',
                    description: 'Classify whether this tabletop action needs a mechanical check. Never narrate or invent consequences.', tools,
                    systemFacts: `Rules ${game.rules.name}. Base difficulty ${game.rules.target || 10}.`,
                    input: `Player ${action.playerId} (${player.name}) declares: ${action.text}\nCurrent resources: ${Object.values(sheet.resources || {}).map(r => `${r.name} ${r.value}/${r.max}`).join(', ')}\nEffects: ${(sheet.effects || []).map(e => e.name).join(', ') || 'none'}`, maxTokens: 96 });
                if (result.matched && result.candidate?._needleTool === 'request_check' && Number(result.confidence || result.candidate.confidence || 0) >= .57) {
                    checks.push({ playerId: action.playerId, attribute: result.candidate.attribute || '', skill: result.candidate.skill || '',
                        difficulty: Number(result.candidate.difficulty || game.rules.target || 10), label: textValue(result.candidate.label || 'Action check', 120) });
                }
                diagnostics.push(`${player.name}: ${result.candidate?._needleTool || 'no match'} (${Number(result.confidence || 0).toFixed(2)})`);
            } catch (error) { diagnostics.push(`${player.name}: referee fallback · ${error.message}`); }
        }
        return { checks, diagnostics };
    }

    async function tinyBrainStateManager(result, campaign) {
        const proposed = Array.isArray(result?.receipt?.operations) ? result.receipt.operations.slice(0, 40) : [];
        if (typeof window.HordeLabsNeedle?.completeStructured !== 'function') return {
            operations: proposed, diagnostics: ['TinyBrain 2 state review unavailable; deterministic validators reviewed the host receipt.'] };
        const tool = { name: 'commit_state_review', description: 'Review proposed tabletop state updates against the narration and authoritative state. Keep only changes directly established in the fiction. Add only an obvious omitted mechanical change. Never narrate.',
            parameters: { type: 'object', properties: {
                acceptedIndexes: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 39 } },
                additions: { type: 'array', maxItems: 8, items: { type: 'object', properties: {
                    type: { type: 'string', enum: ['resource', 'attribute', 'skill', 'defense', 'currency', 'effect-add', 'effect-remove', 'condition-add', 'condition-remove', 'inventory-add', 'inventory-remove', 'shared-inventory-add', 'shared-inventory-remove', 'equip', 'unequip', 'xp', 'advancement-spend', 'location', 'scene', 'clock', 'quest', 'journal', 'encounter-start', 'encounter-end', 'initiative', 'initiative-next'] },
                    playerId: { type: 'string' }, resource: { type: 'string' }, delta: { type: 'number' }, name: { type: 'string' },
                    key: { type: 'string' }, set: { type: 'number' }, modifier: { type: 'number' }, kind: { type: 'string', enum: ['buff', 'debuff', 'condition'] },
                    duration: { type: 'number' }, location: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, summary: { type: 'string' },
                    description: { type: 'string' }, visibility: { type: 'string', enum: ['public', 'private', 'gm'] },
                    itemId: { type: 'string' }, slot: { type: 'string' }, quantity: { type: 'number' }, cost: { type: 'number' },
                    group: { type: 'string', enum: ['attribute', 'skill'] }, clockId: { type: 'string' }, questId: { type: 'string' },
                    npcId: { type: 'string' }, effectId: { type: 'string' }, max: { type: 'number' }, order: { type: 'array', items: { type: 'string' } }
                }, required: ['type'] } }, confidence: { type: 'number', minimum: 0, maximum: 1 }, note: { type: 'string' }
            }, required: ['acceptedIndexes', 'additions', 'confidence', 'note'] } };
        try {
            const resultState = await window.HordeLabsNeedle.completeStructured({ name: 'multiplayer_state_manager', tools: [tool],
                systemFacts: `Canonical revision ${campaign.gameState.revision}. Valid player IDs: ${Object.keys(campaign.gameState.characters || {}).join(', ')}.`,
                input: `${Engine.promptState(campaign.gameState, campaign.players).slice(0, 2400)}\nNARRATION: ${String(result.text || '').slice(0, 1200)}\nPROPOSED: ${JSON.stringify(proposed).slice(0, 1600)}`,
                maxTokens: 384 });
            const candidate = resultState.candidate || {}; const confidence = Number(resultState.confidence || candidate.confidence || 0);
            if (!resultState.matched || candidate._needleTool !== 'commit_state_review' || confidence < .52) return {
                operations: proposed, diagnostics: [`TinyBrain 2 state review abstained (${confidence.toFixed(2)}); deterministic validators used the host receipt.`] };
            const indexes = new Set((candidate.acceptedIndexes || []).map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < proposed.length));
            const additions = (Array.isArray(candidate.additions) ? candidate.additions.slice(0, 8) : []).map(operation => {
                if (operation.type === 'effect-add') return { ...operation, effect: { name: operation.name || 'Effect',
                    kind: operation.kind || (Number(operation.modifier || operation.delta || 0) < 0 ? 'debuff' : 'buff'), duration: Number(operation.duration ?? -1), timing: 'round', modifiers: { checks: Number(operation.modifier || 0) } } };
                if (operation.type === 'inventory-add') return { ...operation, item: { name: operation.name || 'Item', quantity: 1 } };
                if (operation.type === 'shared-inventory-add') return { ...operation, item: { name: operation.name || 'Item', quantity: Number(operation.quantity || 1) } };
                if (operation.type === 'scene') return { ...operation, patch: { name: operation.name || campaign.gameState.scene.name } };
                if (operation.type === 'journal') return { ...operation, text: operation.summary || operation.name || '' };
                if (operation.type === 'initiative') return { ...operation, order: Array.isArray(operation.order) ? operation.order : [] };
                return operation;
            });
            return { operations: [...proposed.filter((_, index) => indexes.has(index)), ...additions],
                diagnostics: [`TinyBrain 2 state manager accepted ${indexes.size}/${proposed.length} proposed changes and added ${additions.length} (${confidence.toFixed(2)}).`, textValue(candidate.note, 240)] };
        } catch (error) { return { operations: proposed, diagnostics: [`TinyBrain 2 state manager fallback · ${error.message}`] }; }
    }

    async function commit() {
        const current = party.state;
        if (party.mode !== 'host' || current?.round?.status !== 'ready') return;
        const actions = current.round.submissions.filter(item => item.submitted && item.text);
        if (!actions.length) return;
        const button = byId('mp-session-commit');
        button.disabled = true;
        party.committing = true;
        const type = current.experienceType || party.context?.type || 'world';
        button.textContent = type === 'chat' ? 'Chat is composing the shared reply…' : 'World is resolving the party turn…';
        const roster = (current.players || []).map(player => {
            const persona = player.persona || {};
            const identity = [persona.pronouns, persona.publicIdentity, persona.reputation].filter(Boolean).join('; ');
            return `- ${player.name}${identity ? ` (${identity})` : ''}`;
        }).join('\n');
        const prompt = type === 'chat'
            ? `[MULTIPLAYER CHAT — ROUND ${current.round.number}. These are distinct participants. Never merge their identities, write one participant's action as another's, or ignore a message.\nPARTICIPANTS:\n${roster}]\n${actions.map(item => `${item.name}: ${item.text}`).join('\n')}`
            : `[WORLD PARTY — ROUND ${current.round.number}. Resolve every participant as a distinct party member. Never merge identities or silently discard an action. If actions conflict, narrate the conflict fairly. This release uses one shared canonical scene/location; do not teleport individual players elsewhere unless the whole party travels or the narration explicitly establishes a split.\nPARTICIPANTS:\n${roster}]\n${actions.map(item => `${item.name}: ${item.text}`).join('\n')}`;
        try {
            // Work on a detached transaction. Background room polling renders
            // the last committed server snapshot; it must never overwrite the
            // newly generated narration while TinyBrain/state validation runs.
            // That race advanced the round but published a stale transcript.
            const campaign = Engine.migrateCampaign(Engine.clone(campaignForRender(current)));
            campaign.gameState = current.snapshot?.gameState || campaign.gameState || Engine.createState(campaign.system, current.snapshot);
            campaign.players = (current.players || []).map(player => ({ ...player,
                sheet: campaign.gameState.characters?.[player.id] || player.sheet || emptySheet(player.persona, player.name, campaign.system) }));
            const referee = await tinyBrainReferee(actions, campaign);
            // Resolve uncertainty before prose is generated.  The narrator receives
            // binding roll outcomes; it never gets to invent success after the fact.
            const preResolvedChecks = [];
            referee.checks.forEach(spec => {
                try { preResolvedChecks.push(Engine.check(campaign.gameState, spec.playerId, spec)); }
                catch (error) { referee.diagnostics.push(`Check rejected: ${error.message}`); }
            });
            const rollBrief = preResolvedChecks.length ? `\n\n[BINDING MECHANICAL RESULTS — narrate these outcomes exactly; do not reroll or reverse them]\n${preResolvedChecks.map(roll => {
                const outcome = roll.outcome || (roll.success == null ? 'resolved' : roll.success ? 'success' : 'failure');
                const math = roll.poolSize ? `${roll.successes} successes from ${roll.poolSize} dice (threshold ${roll.difficulty})`
                    : `${roll.expression} [${roll.dice.join(', ')}]${roll.bonus ? ` + ${roll.bonus}` : ''} = ${roll.total} vs ${roll.difficulty}`;
                return `${roll.playerId}: ${roll.label} · ${math} · ${String(outcome).toUpperCase()}`;
            }).join('\n')}` : '';
            const result = await hooks.executeTurn?.(campaign, prompt + rollBrief);
            if (!result?.text) throw new Error('The host model did not complete the turn. The round remains ready to retry.');
            campaign.snapshot = current.snapshot || campaign.snapshot || {};
            if (!Array.isArray(campaign.snapshot.history)) campaign.snapshot.history = [];
            actions.forEach(item => campaign.snapshot.history.push({ role: 'user', name: item.name, text: item.text }));
            campaign.snapshot.history.push({ role: 'dm', text: result.text });
            campaign.snapshot.turn = Number(campaign.snapshot.turn || 0) + 1;
            // If TinyBrain was unavailable the host model may still propose a check;
            // it is recorded after narration as a fallback. Normal Labs play is fully
            // pre-resolved and therefore must not roll the same check twice.
            const proposedChecks = preResolvedChecks.length ? [] : (result.receipt?.checks || []);
            const stateReview = await tinyBrainStateManager(result, campaign);
            const applied = Engine.applyReceiptRecovering(campaign.gameState, {
                id: `turn_${current.round.number}_${Date.now()}`, baseRevision: campaign.gameState.revision,
                narration: result.text, summary: result.receipt?.summary || `Round ${current.round.number} resolved`,
                operations: stateReview.operations, checks: proposedChecks
            }, party.playerId);
            campaign.gameState = applied.state;
            campaign.snapshot.gameState = Engine.clone(applied.state);
            const knownRolls = new Set(campaign.snapshot.history.filter(item => item.rollId).map(item => item.rollId));
                campaign.gameState.rolls.filter(roll => !knownRolls.has(roll.id)).forEach(roll => {
                    const outcome = roll.outcome || (roll.success == null ? '' : roll.success ? 'SUCCESS' : 'FAILURE');
                    const math = roll.poolSize ? `${roll.successes} successes from ${roll.poolSize} dice [${roll.dice.join(', ')}]`
                        : `${roll.expression} [${roll.dice.join(', ')}]${roll.bonus ? ` + ${roll.bonus}` : ''} = ${roll.total}`;
                    campaign.snapshot.history.push({ role: 'system', name: 'DICE', rollId: roll.id,
                    text: `${roll.label}: ${math}${outcome ? ` · ${outcome}` : ''}` });
            });
            campaign.snapshot.lastReferee = { at: Date.now(), diagnostics: [...referee.diagnostics, ...stateReview.diagnostics].filter(Boolean).slice(-16), transactionId: applied.transaction.id };
            if (applied.rejected?.length) {
                campaign.snapshot.lastReferee.rejected = applied.rejected.slice(0, 20);
                campaign.snapshot.history.push({ role: 'system', name: 'STATE GUARD',
                    text: `${applied.rejected.length} malformed state update${applied.rejected.length === 1 ? '' : 's'} rejected; valid changes were committed safely.` });
            }
            saveCampaign(campaign);
            await request('/multiplayer/commit', auth({ snapshot: campaign.snapshot }));
            // Publish the completed local transaction before rendering again,
            // then fetch the canonical relay copy while normal polling remains
            // paused. This makes a one-player test follow the same path as a
            // full LAN/Internet party.
            party.campaign = campaign;
            party.state = await request('/multiplayer/state', auth());
            campaign.snapshot = Engine.clone(party.state.snapshot || campaign.snapshot);
            campaign.gameState = Engine.clone(campaign.snapshot.gameState || campaign.gameState);
            campaign.lastRoomRevision = Number(party.state.revision || 0);
            saveCampaign(campaign);
            render();
            window.showToast?.(`Party ${type === 'chat' ? 'reply' : 'turn'} committed with one host model call.`, 'success');
        } catch (error) { window.showToast?.(error.message, 'error'); }
        finally { party.committing = false; button.disabled = false; button.textContent = 'Resolve round'; }
    }

    async function propose(type, label) {
        try {
            await request('/multiplayer/propose', auth({ type, label }));
            await poll();
        } catch (error) { window.showToast?.(error.message, 'error'); }
    }

    async function vote(approve) {
        const proposal = party.state?.proposal;
        if (!proposal) return;
        try {
            await request('/multiplayer/vote', auth({ proposalId: proposal.id, approve }));
            await poll();
        } catch (error) { window.showToast?.(error.message, 'error'); }
    }

    function renderVote(proposal) {
        const box = byId('world-party-vote');
        if (!proposal || proposal.status === 'applied') {
            box.classList.add('hidden'); box.innerHTML = ''; return;
        }
        box.classList.remove('hidden');
        const canVote = proposal.status === 'open' && proposal.myVote == null;
        const canApply = party.mode === 'host' && proposal.status === 'approved';
        box.innerHTML = `<strong>Vote · ${escape(proposal.label)}</strong><p>${proposal.yes} yes · ${proposal.no} no · ${escape(proposal.status)}</p><div class="world-party-vote-actions">${canVote ? '<button class="btn btn-primary btn-small" data-party-vote="yes">Vote yes</button><button class="btn btn-ghost btn-small" data-party-vote="no">Vote no</button>' : ''}${canApply ? '<button class="btn btn-primary btn-small" data-party-apply>Apply approved decision</button>' : ''}</div>`;
        box.querySelector('[data-party-vote="yes"]')?.addEventListener('click', () => vote(true));
        box.querySelector('[data-party-vote="no"]')?.addEventListener('click', () => vote(false));
        box.querySelector('[data-party-apply]')?.addEventListener('click', applyDecision);
    }

    async function applyDecision() {
        const proposal = party.state?.proposal;
        if (party.mode !== 'host' || proposal?.status !== 'approved') return;
        try {
            const campaign = campaignForRender(party.state);
            const history = campaign.snapshot?.history || [];
            if (proposal.type === 'reroll') {
                const lastDm = [...history].reverse().findIndex(item => item.role === 'dm');
                if (lastDm >= 0) history.splice(history.length - 1 - lastDm, 1);
            } else if (proposal.type === 'reset') {
                campaign.snapshot.history = [];
                campaign.snapshot.turn = 0;
            }
            saveCampaign(campaign);
            await request('/multiplayer/resolve', auth({ snapshot: campaign.snapshot }));
            await poll();
        } catch (error) { window.showToast?.(error.message, 'error'); }
    }

    async function end() {
        const wasHost = party.mode === 'host';
        if (wasHost) {
            try { await request('/multiplayer/close', auth()); } catch (_) {}
        }
        setMode('off', { roomCode: '', inviteToken: '', inviteUrl: '', playerId: '', playerToken: '' });
        close();
        window.showToast?.(wasHost ? 'Multiplayer room ended. Your local timeline remains on this device.' : 'You left the multiplayer room.', 'info');
    }

    async function updateMySheet(sheet, targetPlayerId = party.playerId) {
        try {
            const normalized = Engine.normalizeSheet(sheet, campaignForRender(party.state).system,
                party.state?.players?.find(player => player.id === targetPlayerId)?.persona, sheet.name);
            await request('/multiplayer/sheet', auth({ sheet: normalized, targetPlayerId }));
            await poll();
            window.showToast?.('Character sheet synchronized.', 'success');
        } catch (error) { window.showToast?.(`Sheet not saved: ${error.message}`, 'error'); }
    }

    function numberInputs(record, group, calculated = null) {
        return Object.entries(record || {}).map(([key, value]) => {
            const numeric = typeof value === 'object' ? value.value : value;
            const max = typeof value === 'object' ? value.max : 100;
            const calculatedValue = calculated?.[key];
            const effective = calculatedValue && typeof calculatedValue === 'object' ? calculatedValue.value : calculatedValue;
            const difference = Number(effective) - Number(numeric || 0);
            const gear = Number.isFinite(difference) && difference !== 0 ? `<strong class="mp-effective-value">Effective ${escape(effective)} (${difference > 0 ? '+' : ''}${escape(difference)} gear)</strong>` : '';
            return `<label class="mp-sheet-field"><span>${escape(typeof value === 'object' ? value.name : key)}</span><input class="form-input" type="number" data-sheet-group="${group}" data-sheet-key="${escape(key)}" value="${escape(numeric)}" min="-100" max="${escape(max || 100)}">${gear}${typeof value === 'object' ? `<small>Base maximum ${escape(max)}</small>` : ''}</label>`;
        }).join('');
    }

    function modifierLines(item) {
        const lines = [];
        if (item.modifiers?.checks) lines.push(`checks=${item.modifiers.checks}`);
        if (item.modifiers?.damage) lines.push(`damage=${item.modifiers.damage}`);
        ['attributes', 'skills', 'stats', 'defenses', 'resources'].forEach(group => Object.entries(item.modifiers?.[group] || {})
            .forEach(([key, value]) => lines.push(`${group}:${key}=${value}`)));
        return lines.join('\n');
    }

    function parseModifierLines(raw) {
        const result = Mechanics.modifiers({});
        String(raw || '').split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
            const match = line.match(/^(?:(attributes|skills|stats|defenses|resources):)?([^=]+)=(-?\d+(?:\.\d+)?)$/i);
            if (!match) return;
            const group = String(match[1] || '').toLowerCase(); const key = match[2].trim(); const value = Number(match[3]);
            if (group) result[group][key] = value;
            else if (key === 'checks' || key === 'damage' || key === 'armor') result[key] = value;
        });
        return result;
    }

    function openItemEditor(playerId, draftSheet, itemValue = null) {
        const item = Mechanics.normalizeItem(itemValue || { name: 'New item' });
        let overlay = byId('mp-item-overlay');
        if (!overlay) { overlay = document.createElement('div'); overlay.id = 'mp-item-overlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
        overlay.innerHTML = `<div class="modal mp-item-modal"><header><div><span class="vh-eyebrow">EQUIPMENT & ITEM</span><h2>${itemValue ? 'Edit item' : 'Create item'}</h2><p>One portable item schema powers checks in Worlds and Multiplayer.</p></div><button class="labs-close-btn" data-item-close>✕</button></header><div class="mp-item-editor-grid">
            <label><span>Name</span><input class="form-input" data-item-name value="${escape(item.name)}"></label>
            <label><span>Type</span><select class="form-input" data-item-type>${Mechanics.TYPES.map(type => `<option${type === item.type ? ' selected' : ''}>${escape(type)}</option>`).join('')}</select></label>
            <label><span>Quantity</span><input class="form-input" data-item-quantity type="number" min="1" value="${escape(item.quantity)}"></label>
            <label><span>Equipment slot</span><select class="form-input" data-item-slot><option value="">Not equipped</option>${Object.keys(draftSheet.equipment || {}).map(slot => `<option value="${escape(slot)}"${slot === item.slot ? ' selected' : ''}>${escape(slot)}</option>`).join('')}</select></label>
            <label><span>Damage / dice</span><input class="form-input" data-item-damage value="${escape(item.damage)}" placeholder="1d8+2"></label>
            <label><span>Damage type</span><input class="form-input" data-item-damage-type value="${escape(item.damageType)}" placeholder="slashing, thermal…"></label>
            <label><span>Armor</span><input class="form-input" data-item-armor type="number" value="${escape(item.armor)}"></label>
            <label><span>Value</span><input class="form-input" data-item-value type="number" min="0" value="${escape(item.value)}"></label>
            <label><span>Weight</span><input class="form-input" data-item-weight type="number" min="0" step="0.1" value="${escape(item.weight)}"></label>
            <label><span>Rarity</span><input class="form-input" data-item-rarity value="${escape(item.rarity)}"></label>
            <label><span>Charges</span><div class="mp-inline-fields"><input class="form-input" data-item-charges type="number" min="0" value="${escape(item.charges)}"><input class="form-input" data-item-max-charges type="number" min="0" value="${escape(item.maxCharges)}" placeholder="max"></div></label>
            <label><span>Durability</span><div class="mp-inline-fields"><input class="form-input" data-item-durability type="number" min="0" value="${escape(item.durability)}"><input class="form-input" data-item-max-durability type="number" min="0" value="${escape(item.maxDurability)}" placeholder="max"></div></label>
            <label class="mp-item-wide"><span>Description</span><textarea class="form-textarea" data-item-description rows="3">${escape(item.description)}</textarea></label>
            <label class="mp-item-wide"><span>Mechanical bonuses · one per line</span><textarea class="form-textarea" data-item-modifiers rows="6" placeholder="checks=1&#10;attributes:Strength=2&#10;skills:Stealth=1&#10;resources:HP=5">${escape(modifierLines(item))}</textarea><small>Use checks=, damage=, attributes:Name=, skills:Name=, stats:Name=, defenses:Name= or resources:Name=.</small></label>
            <label class="mp-item-wide"><span>Requirements</span><div class="mp-inline-fields"><input class="form-input" data-item-level type="number" min="0" value="${escape(item.requirements?.level || 0)}" placeholder="level"><input class="form-input" data-item-requirement-text value="${escape(item.requirements?.text || '')}" placeholder="Other requirement"></div></label>
        </div><footer><button class="btn btn-ghost" data-item-cancel>Cancel</button><button class="btn btn-primary" data-item-save>Save item</button></footer></div>`;
        overlay.classList.remove('hidden');
        const close = () => overlay.classList.add('hidden');
        overlay.querySelector('[data-item-close]').onclick = close; overlay.querySelector('[data-item-cancel]').onclick = close;
        overlay.querySelector('[data-item-save]').onclick = () => {
            const read = selector => overlay.querySelector(selector)?.value;
            const saved = Mechanics.normalizeItem({ ...item, name: read('[data-item-name]'), type: read('[data-item-type]'), quantity: Number(read('[data-item-quantity]')),
                slot: read('[data-item-slot]'), damage: read('[data-item-damage]'), damageType: read('[data-item-damage-type]'), armor: Number(read('[data-item-armor]')),
                value: Number(read('[data-item-value]')), weight: Number(read('[data-item-weight]')), rarity: read('[data-item-rarity]'),
                charges: Number(read('[data-item-charges]')), maxCharges: Number(read('[data-item-max-charges]')), durability: Number(read('[data-item-durability]')),
                maxDurability: Number(read('[data-item-max-durability]')), description: read('[data-item-description]'), modifiers: parseModifierLines(read('[data-item-modifiers]')),
                requirements: { ...item.requirements, level: Number(read('[data-item-level]')), text: read('[data-item-requirement-text]') } });
            if (!saved.name) return window.showToast?.('Give the item a name.', 'error');
            const index = draftSheet.inventory.findIndex(entry => entry.id === item.id);
            if (index >= 0) draftSheet.inventory[index] = saved; else draftSheet.inventory.push(saved);
            close(); openCharacterSheet(playerId, draftSheet);
        };
    }

    function openCharacterSheet(playerId = party.playerId, draftSheet = null) {
        const current = party.state; if (!current) return;
        const campaign = campaignForRender(current); const player = current.players.find(entry => entry.id === playerId);
        const source = player?.sheet || campaign.gameState?.characters?.[playerId]; if (!player || !source) return;
        const editable = playerId === party.playerId || party.mode === 'host'; const sheet = Engine.clone(draftSheet || source);
        const mechanicsMode = Mechanics.mode(campaign.system?.mechanicsMode || 'full');
        const calculated = Mechanics.calculatedSheet(sheet, mechanicsMode).calculated;
        let overlay = byId('mp-character-overlay');
        if (!overlay) { overlay = document.createElement('div'); overlay.id = 'mp-character-overlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
        const effects = [...(sheet.conditions || []), ...(sheet.effects || [])].map(entry => typeof entry === 'string' ? entry : entry.name).filter(Boolean).join(', ');
        sheet.inventory = Mechanics.normalizeInventory(sheet.inventory);
        const inventoryCards = sheet.inventory.map(item => `<article class="mp-item-card" data-sheet-item="${escape(item.id)}"><div><span>${escape(item.type)}</span><h4>${escape(item.name)}${item.quantity > 1 ? ` ×${escape(item.quantity)}` : ''}</h4><p>${escape(item.description || Mechanics.describeModifiers(item) || 'No description')}</p><small>${escape([item.damage && `Damage ${item.damage}`, item.armor && `Armor ${item.armor}`, Mechanics.describeModifiers(item)].filter(Boolean).join(' · ') || 'Narrative item')}</small></div>${editable ? '<button class="btn btn-ghost btn-small" data-sheet-item-edit>Edit</button><button class="btn btn-ghost btn-small" data-sheet-item-delete>Remove</button>' : ''}</article>`).join('');
        overlay.innerHTML = `<div class="modal mp-character-modal" role="dialog" aria-modal="true"><header><div><span class="vh-eyebrow">PLAYER CHARACTER</span><h2>${escape(sheet.name || player.name)}</h2><p>${escape(campaign.system.name)} · Level ${escape(sheet.level)}</p></div><button class="labs-close-btn" data-sheet-close type="button">✕</button></header><nav class="mp-sheet-tabs"><button class="active" data-sheet-tab="vitals">Vitals</button><button data-sheet-tab="skills">Skills</button><button data-sheet-tab="gear">Gear</button><button data-sheet-tab="story">Identity</button></nav><div class="mp-character-body">
            <section data-sheet-pane="vitals"><div class="mp-mechanics-banner"><div><span>MECHANICS ${escape(mechanicsMode.toUpperCase())}</span><p>${mechanicsMode === 'off' ? 'Base values are shown. Gear bonuses, checks, progression and effects are paused without deleting them.' : 'Effective values include equipped gear. Edit the base values below; bonuses remain attached to items.'}</p></div></div><h3>Resources & progression</h3><div class="mp-sheet-grid">${numberInputs(sheet.resources, 'resources', calculated.resources)}${numberInputs({ level: sheet.level, xp: sheet.xp, advancement: sheet.advancement }, 'root')}</div><h3>Defenses</h3><div class="mp-sheet-grid">${numberInputs(sheet.defenses, 'defenses', calculated.defenses)}</div><h3>Currencies</h3><div class="mp-sheet-grid">${numberInputs(sheet.currencies, 'currencies')}</div><label><span>Status effects, buffs and debuffs</span><textarea class="form-textarea" data-sheet-effects rows="3" placeholder="Blessed, poisoned, inspired…">${escape(effects)}</textarea><small>Durations and mechanical modifiers are preserved when the name remains unchanged. The GM console manages detailed effects.</small></label></section>
            <section class="hidden" data-sheet-pane="skills"><div class="mp-mechanics-banner"><div><span>BASE BUILD + EQUIPMENT</span><p>${mechanicsMode === 'off' ? 'Mechanical bonuses are paused.' : 'A visible Effective value appears wherever equipped gear changes this build.'}</p></div></div><h3>Attributes</h3><div class="mp-sheet-grid">${numberInputs(sheet.attributes, 'attributes', calculated.attributes)}</div><h3>Skills</h3><div class="mp-sheet-grid">${numberInputs(sheet.skills, 'skills', calculated.skills)}</div></section>
            <section class="hidden" data-sheet-pane="gear"><div class="mp-mechanics-banner"><div><span>MECHANICS ${escape(String(campaign.system.mechanicsMode || 'full').toUpperCase())}</span><p>${campaign.system.mechanicsMode === 'off' ? 'Items remain saved, but checks, effects and gear bonuses are paused.' : 'Equipped items contribute their authored bonuses to validated checks.'}</p></div>${editable ? '<button class="btn btn-ghost btn-small" data-sheet-add-item>+ Add item</button>' : ''}</div><div class="mp-loadout-grid">${Object.entries(sheet.equipment || {}).map(([slot, itemId]) => `<label><span>${escape(slot)}</span><select class="form-input" data-sheet-slot="${escape(slot)}"><option value="">Empty</option>${(sheet.inventory || []).filter(entry => !entry.slot || entry.slot === slot || entry.id === itemId).map(entry => `<option value="${escape(entry.id)}"${entry.id === itemId ? ' selected' : ''}>${escape(entry.name)}</option>`).join('')}</select></label>`).join('')}</div><div class="mp-item-card-grid">${inventoryCards || '<div class="mp-empty-items">No items yet. Add weapons, armor, clothing, tools or narrative possessions.</div>'}</div></section>
            <section class="hidden" data-sheet-pane="story"><div class="mp-sheet-grid"><label><span>Character name</span><input class="form-input" data-sheet-name value="${escape(sheet.name)}"></label><label><span>Class / archetype</span><input class="form-input" data-sheet-archetype value="${escape(sheet.archetype || '')}" placeholder="Street samurai, wizard, investigator…"></label><label><span>Ancestry / origin</span><input class="form-input" data-sheet-ancestry value="${escape(sheet.ancestry || '')}"></label></div><label><span>Background</span><textarea class="form-textarea" data-sheet-background rows="3">${escape(sheet.background || '')}</textarea></label><label><span>Public identity</span><textarea class="form-textarea" data-sheet-identity rows="3">${escape(sheet.publicIdentity)}</textarea></label><label><span>Appearance & outfit</span><textarea class="form-textarea" data-sheet-appearance rows="3">${escape(sheet.appearance)}</textarea></label><label><span>Reputation</span><textarea class="form-textarea" data-sheet-reputation rows="3">${escape(sheet.reputation)}</textarea></label><div class="mp-sheet-grid"><label><span>Abilities · one per line</span><textarea class="form-textarea" data-sheet-abilities rows="5">${escape((sheet.abilities || []).join('\n'))}</textarea></label><label><span>Perks / feats · one per line</span><textarea class="form-textarea" data-sheet-perks rows="5">${escape((sheet.perks || []).join('\n'))}</textarea></label></div><label><span>Private notes</span><textarea class="form-textarea" data-sheet-notes rows="4">${escape(editable ? sheet.notes : 'Private')}</textarea></label></section>
            </div><footer>${editable ? '<button class="btn btn-primary" data-sheet-save type="button">Save & sync sheet</button>' : '<span>Read-only public character sheet</span>'}</footer></div>`;
        overlay.classList.remove('hidden');
        if (!editable) overlay.querySelectorAll('input,textarea,select').forEach(element => element.disabled = true);
        overlay.querySelector('[data-sheet-close]').onclick = () => overlay.classList.add('hidden');
        overlay.querySelectorAll('[data-sheet-tab]').forEach(button => button.onclick = () => {
            overlay.querySelectorAll('[data-sheet-tab]').forEach(item => item.classList.toggle('active', item === button));
            overlay.querySelectorAll('[data-sheet-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.sheetPane !== button.dataset.sheetTab));
        });
        overlay.querySelector('[data-sheet-add-item]')?.addEventListener('click', () => openItemEditor(playerId, sheet));
        overlay.querySelectorAll('[data-sheet-item]').forEach(card => {
            const id = card.dataset.sheetItem;
            card.querySelector('[data-sheet-item-edit]')?.addEventListener('click', () => openItemEditor(playerId, sheet, sheet.inventory.find(item => item.id === id)));
            card.querySelector('[data-sheet-item-delete]')?.addEventListener('click', () => {
                sheet.inventory = sheet.inventory.filter(item => item.id !== id);
                Object.keys(sheet.equipment || {}).forEach(slot => { if (sheet.equipment[slot] === id) sheet.equipment[slot] = null; });
                openCharacterSheet(playerId, sheet);
            });
        });
        overlay.querySelector('[data-sheet-save]')?.addEventListener('click', async () => {
            try {
            overlay.querySelectorAll('[data-sheet-group]').forEach(input => {
                const group = input.dataset.sheetGroup; const key = input.dataset.sheetKey; const value = Number(input.value) || 0;
                if (group === 'root') sheet[key] = value;
                else if (group === 'resources' && sheet.resources[key]) sheet.resources[key].value = value;
                else { sheet[group] ||= {}; sheet[group][key] = value; }
            });
            sheet.name = textValue(overlay.querySelector('[data-sheet-name]')?.value || sheet.name, 80);
            sheet.archetype = textValue(overlay.querySelector('[data-sheet-archetype]')?.value, 100);
            sheet.ancestry = textValue(overlay.querySelector('[data-sheet-ancestry]')?.value, 100);
            sheet.background = textValue(overlay.querySelector('[data-sheet-background]')?.value, 500);
            sheet.publicIdentity = textValue(overlay.querySelector('[data-sheet-identity]')?.value, 700);
            sheet.appearance = textValue(overlay.querySelector('[data-sheet-appearance]')?.value, 1000);
            sheet.reputation = textValue(overlay.querySelector('[data-sheet-reputation]')?.value, 700);
            sheet.notes = textValue(overlay.querySelector('[data-sheet-notes]')?.value, 3000);
            sheet.abilities = textValue(overlay.querySelector('[data-sheet-abilities]')?.value, 3000).split('\n').map(value => value.trim()).filter(Boolean).slice(0, 60);
            sheet.perks = textValue(overlay.querySelector('[data-sheet-perks]')?.value, 3000).split('\n').map(value => value.trim()).filter(Boolean).slice(0, 60);
            const originalEffects = [...(sheet.conditions || []), ...(sheet.effects || [])].filter(entry => entry && typeof entry === 'object');
            const editedEffectNames = textValue(overlay.querySelector('[data-sheet-effects]')?.value, 1000).split(',').map(name => name.trim()).filter(Boolean);
            sheet.effects = editedEffectNames.map(name => Engine.clone(originalEffects.find(entry => entry.name?.toLowerCase() === name.toLowerCase())
                || { name, kind: 'condition', duration: -1, timing: 'permanent', modifiers: {} }));
            sheet.conditions = [];
            overlay.querySelectorAll('[data-sheet-slot]').forEach(select => {
                const priorId = sheet.equipment[select.dataset.sheetSlot]; const nextId = select.value || null;
                if (priorId) { const prior = sheet.inventory.find(item => item.id === priorId); if (prior) prior.equipped = false; }
                if (nextId) {
                    const next = sheet.inventory.find(item => item.id === nextId); const validation = Mechanics.validateEquip(sheet, next, select.dataset.sheetSlot);
                    if (!validation.ok) throw new Error(validation.reason); next.equipped = true; next.slot = select.dataset.sheetSlot;
                }
                sheet.equipment[select.dataset.sheetSlot] = nextId;
            });
            await updateMySheet(sheet, playerId); overlay.classList.add('hidden');
            } catch (error) {
                window.showToast?.(error?.message || 'Could not save this character sheet.', 'error');
            }
        });
    }

    const textValue = (value, max) => String(value || '').trim().slice(0, max);

    function openDice() {
        const mechanicsMode = campaignForRender(party.state)?.system?.mechanicsMode || 'full';
        if (mechanicsMode === 'off') return window.showToast?.('Mechanical checks are off. The host can re-enable them from the GM Console.', 'info');
        let overlay = byId('mp-dice-overlay');
        if (!overlay) { overlay = document.createElement('div'); overlay.id = 'mp-dice-overlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
        const campaign = campaignForRender(party.state); const sheet = campaign.gameState.characters?.[party.playerId] || emptySheet();
        const pooled = campaign.system.mode === 'success-pool';
        overlay.innerHTML = `<div class="modal mp-dice-modal"><header><div><span class="vh-eyebrow">DICE TRAY</span><h2>Make a roll</h2><p>Every roll is synchronized and recorded in the campaign log.</p></div><button class="labs-close-btn" data-dice-close>✕</button></header><div class="mp-dice-body"><label><span>Dice</span><input class="form-input" data-dice-expression value="${pooled ? '' : escape(campaign.system.die || 'd20')}" placeholder="${pooled ? 'Automatic pool from attribute + skill' : 'd20'}"><small>${pooled ? 'Leave blank to build the pool from your selected attribute, skill, gear and effects.' : 'Override the campaign die only for a special roll.'}</small></label><label><span>Label</span><input class="form-input" data-dice-label placeholder="Stealth check"></label><label><span>Attribute</span><select class="form-input" data-dice-attribute><option value="">None</option>${Object.keys(sheet.attributes || {}).map(key => `<option>${escape(key)}</option>`).join('')}</select></label><label><span>Skill</span><select class="form-input" data-dice-skill><option value="">None</option>${Object.keys(sheet.skills || {}).map(key => `<option>${escape(key)}</option>`).join('')}</select></label><label><span>Difficulty</span><input class="form-input" type="number" data-dice-difficulty value="${escape(campaign.system.target || 10)}"></label><button class="btn btn-primary" data-dice-roll>Roll publicly</button></div></div>`;
        overlay.classList.remove('hidden'); overlay.querySelector('[data-dice-close]').onclick = () => overlay.classList.add('hidden');
        overlay.querySelector('[data-dice-roll]').onclick = async () => {
            const spec = { dice: overlay.querySelector('[data-dice-expression]').value, label: overlay.querySelector('[data-dice-label]').value,
                attribute: overlay.querySelector('[data-dice-attribute]').value, skill: overlay.querySelector('[data-dice-skill]').value,
                difficulty: Number(overlay.querySelector('[data-dice-difficulty]').value) };
            try { await request('/multiplayer/roll', auth(spec)); overlay.classList.add('hidden'); await poll(); }
            catch (error) { window.showToast?.(error.message, 'error'); }
        };
    }

    function openGmConsole() {
        if (party.mode !== 'host') return;
        const campaign = campaignForRender(party.state); let overlay = byId('mp-gm-overlay');
        if (!overlay) { overlay = document.createElement('div'); overlay.id = 'mp-gm-overlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
        const encounter = (campaign.gameState.encounters || []).find(entry => entry.status === 'active');
        overlay.innerHTML = `<div class="modal mp-gm-modal"><header><div><span class="vh-eyebrow">HOST AUTHORITY</span><h2>GM Console</h2><p>Manual changes use the same validated transaction engine as AI turns.</p></div><button class="labs-close-btn" data-gm-close>✕</button></header><div class="mp-gm-body"><h3 class="mp-gm-wide">Character</h3><label><span>Target character</span><select class="form-input" data-gm-player>${(party.state.players || []).map(player => `<option value="${escape(player.id)}">${escape(player.name)}</option>`).join('')}${Object.entries(campaign.gameState.npcs || {}).map(([npcId,npc]) => `<option value="${escape(npcId)}">NPC · ${escape(npc.name)}</option>`).join('')}</select></label><label><span>Resource</span><select class="form-input" data-gm-resource>${Object.values(campaign.gameState.characters?.[party.state.players?.[0]?.id]?.resources || {}).map(resource => `<option value="${escape(resource.id)}">${escape(resource.name)}</option>`).join('')}</select></label><label><span>Change (+ heal / − damage)</span><input class="form-input" type="number" data-gm-delta value="0"></label><label><span>Currency key and change</span><div class="mp-inline-fields"><input class="form-input" data-gm-currency placeholder="Gold, credits…"><input class="form-input" type="number" data-gm-currency-delta value="0"></div></label><label><span>Add buff, debuff or condition</span><input class="form-input" data-gm-effect placeholder="Poisoned, inspired, bleeding…"></label><label><span>Effect kind</span><select class="form-input" data-gm-effect-kind><option value="condition">Condition</option><option value="buff">Buff</option><option value="debuff">Debuff</option></select></label><label><span>Check modifier</span><input class="form-input" type="number" data-gm-modifier value="0"></label><label><span>Duration in rounds (-1 permanent)</span><input class="form-input" type="number" data-gm-duration value="-1"></label><label><span>XP / advancement award</span><input class="form-input" type="number" data-gm-xp value="0"></label><h3 class="mp-gm-wide">Encounter & cast</h3><label><span>Encounter</span><select class="form-input" data-gm-encounter><option value="none">No encounter change</option>${encounter ? '<option value="end">End active encounter</option>' : '<option value="start">Start an encounter</option>'}</select></label><label><span>Encounter name</span><input class="form-input" data-gm-encounter-name placeholder="Ambush at Blackwater Bridge"></label><label><span>Create NPC / adversary</span><input class="form-input" data-gm-npc-name placeholder="Goblin scout, corporate guard…"></label><label><span>NPC archetype</span><input class="form-input" data-gm-npc-archetype placeholder="Skirmisher, fixer, rival…"></label><h3 class="mp-gm-wide">Campaign state</h3><label><span>Scene / party location</span><input class="form-input" data-gm-scene placeholder="Blackwater Bridge"></label><label><span>Add to party inventory</span><div class="mp-inline-fields"><input class="form-input" data-gm-shared-item placeholder="Rope, medkit…"><input class="form-input" type="number" min="1" data-gm-shared-qty value="1"></div></label><label><span>Clock and progress</span><div class="mp-inline-fields"><input class="form-input" data-gm-clock placeholder="Alarm"><input class="form-input" type="number" data-gm-clock-delta value="0"></div></label><label><span>Clock maximum</span><input class="form-input" type="number" min="1" data-gm-clock-max value="6"></label><label><span>Quest / objective</span><input class="form-input" data-gm-quest placeholder="Open the sealed gate"></label><label><span>Quest status</span><select class="form-input" data-gm-quest-status><option value="active">Active</option><option value="complete">Complete</option><option value="failed">Failed</option><option value="paused">Paused</option></select></label><label class="mp-gm-wide"><span>Transaction note</span><input class="form-input" data-gm-note placeholder="Goblin blade deals 4 damage"></label><button class="btn btn-primary" data-gm-apply>Commit state change</button></div></div>`;
        overlay.classList.remove('hidden');
        overlay.querySelector('.mp-gm-body')?.insertAdjacentHTML('afterbegin', `<h3 class="mp-gm-wide">Campaign mechanics</h3><label class="mp-gm-wide"><span>Mechanical depth</span><select class="form-input" data-gm-mechanics-mode><option value="off"${campaign.system.mechanicsMode === 'off' ? ' selected' : ''}>Off · preserve data, pause mechanics</option><option value="light"${campaign.system.mechanicsMode === 'light' ? ' selected' : ''}>Light · sheets, checks and equipment</option><option value="full"${campaign.system.mechanicsMode === 'full' ? ' selected' : ''}>Full · progression, effects and requirements</option></select><small>Change this at any time. Character builds and items are never deleted.</small></label>`);
        overlay.querySelector('[data-gm-close]').onclick = () => overlay.classList.add('hidden');
        if (encounter) overlay.querySelector('[data-gm-encounter] option[value="end"]')?.insertAdjacentHTML('beforebegin', '<option value="next">Advance initiative</option>');
        overlay.querySelector('[data-gm-player]').onchange = event => {
            const resources = campaign.gameState.characters?.[event.target.value]?.resources || campaign.gameState.npcs?.[event.target.value]?.resources || {};
            overlay.querySelector('[data-gm-resource]').innerHTML = Object.values(resources).map(r => `<option value="${escape(r.id)}">${escape(r.name)}</option>`).join('');
        };
        overlay.querySelector('[data-gm-apply]').onclick = async () => {
            const playerId = overlay.querySelector('[data-gm-player]').value; const operations = [];
            const nextMechanicsMode = Mechanics.mode(overlay.querySelector('[data-gm-mechanics-mode]')?.value, 'full');
            const modeChanged = nextMechanicsMode !== campaign.system.mechanicsMode;
            const resource = overlay.querySelector('[data-gm-resource]').value; const delta = Number(overlay.querySelector('[data-gm-delta]').value || 0);
            const effectName = overlay.querySelector('[data-gm-effect]').value.trim();
            if (resource && delta) operations.push({ type: 'resource', playerId, resource, delta });
            const currencyKey = overlay.querySelector('[data-gm-currency]').value.trim(); const currencyDelta = Number(overlay.querySelector('[data-gm-currency-delta]').value || 0);
            if (currencyKey && currencyDelta) operations.push({ type: 'currency', playerId, key: currencyKey, delta: currencyDelta });
            if (effectName) operations.push({ type: 'effect-add', playerId, effect: { name: effectName,
                kind: overlay.querySelector('[data-gm-effect-kind]').value, duration: Number(overlay.querySelector('[data-gm-duration]').value), timing: 'round',
                modifiers: { checks: Number(overlay.querySelector('[data-gm-modifier]').value || 0) } } });
            const xp = Number(overlay.querySelector('[data-gm-xp]').value || 0); if (xp) operations.push({ type: 'xp', playerId, delta: xp });
            const npcName = overlay.querySelector('[data-gm-npc-name]').value.trim();
            if (npcName) operations.push({ type: 'npc-add', name: npcName, sheet: { name: npcName, archetype: overlay.querySelector('[data-gm-npc-archetype]').value.trim() } });
            const encounterChange = overlay.querySelector('[data-gm-encounter]').value;
            if (encounterChange === 'start') operations.push({ type: 'encounter-start', name: overlay.querySelector('[data-gm-encounter-name]').value || 'Encounter', initiative: [...Object.keys(campaign.gameState.characters || {}), ...Object.keys(campaign.gameState.npcs || {})] });
            if (encounterChange === 'next') operations.push({ type: 'initiative-next' });
            if (encounterChange === 'end') operations.push({ type: 'encounter-end' });
            const sceneName = overlay.querySelector('[data-gm-scene]').value.trim();
            if (sceneName) operations.push({ type: 'scene', patch: { name: sceneName } });
            const sharedItem = overlay.querySelector('[data-gm-shared-item]').value.trim();
            if (sharedItem) operations.push({ type: 'shared-inventory-add', item: { name: sharedItem, quantity: Math.max(1, Number(overlay.querySelector('[data-gm-shared-qty]').value || 1)) } });
            const clockName = overlay.querySelector('[data-gm-clock]').value.trim(); const clockDelta = Number(overlay.querySelector('[data-gm-clock-delta]').value || 0);
            if (clockName && clockDelta) operations.push({ type: 'clock', name: clockName, delta: clockDelta, max: Math.max(1, Number(overlay.querySelector('[data-gm-clock-max]').value || 6)) });
            const questTitle = overlay.querySelector('[data-gm-quest]').value.trim();
            if (questTitle) operations.push({ type: 'quest', title: questTitle, status: overlay.querySelector('[data-gm-quest-status]').value });
            try {
                if (!operations.length && !modeChanged) throw new Error('Choose at least one change.');
                campaign.system.mechanicsMode = nextMechanicsMode;
                campaign.gameState.rules.mechanicsMode = nextMechanicsMode;
                const applied = Engine.applyReceiptRecovering(campaign.gameState, { baseRevision: campaign.gameState.revision, operations, checks: [], advanceRound: false, summary: overlay.querySelector('[data-gm-note]').value || 'GM state change' }, party.playerId);
                campaign.gameState = applied.state; campaign.snapshot.gameState = Engine.clone(applied.state); saveCampaign(campaign);
                await request('/multiplayer/gm', auth({ snapshot: campaign.snapshot })); overlay.classList.add('hidden'); await poll();
            } catch (error) { window.showToast?.(error.message, 'error'); }
        };
    }

    function selectTransport(value) {
        party.transport = value === 'online' ? 'online' : 'lan';
        document.querySelectorAll('[data-party-transport]').forEach(button => button.classList.toggle('active', button.dataset.partyTransport === party.transport));
        byId('world-party-relay-wrap')?.classList.toggle('hidden', party.transport !== 'online');
        if (byId('world-party-host-btn')) byId('world-party-host-btn').textContent = party.transport === 'online' ? 'Create Internet room' : 'Create LAN room';
        if (party.transport === 'online' && byId('world-party-relay-url')) byId('world-party-relay-url').value = party.relayUrl || localStorage.getItem(RELAY_KEY) || '';
    }

    function prepare(context, options = {}) {
        if (party.mode !== 'off') return render();
        party.resumeCampaign = false;
        party.campaign = null;
        party.context = context || hooks.currentContext?.() || null;
        if (options.transport) selectTransport(options.transport);
        if (options.relayUrl) { party.relayUrl = options.relayUrl; if (byId('world-party-relay-url')) byId('world-party-relay-url').value = options.relayUrl; }
        if (byId('world-party-campaign-name')) byId('world-party-campaign-name').value = party.context?.name || '';
        if (byId('world-party-custom-rules')) byId('world-party-custom-rules').value = '';
        hydrateSystemEditor(RULE_PRESETS[byId('world-party-rules-preset')?.value || 'custom']);
        const persona = hooks.currentPersona?.();
        if (byId('world-party-host-persona')) byId('world-party-host-persona').innerHTML = persona?.name
            ? `<span>Joining as</span><strong>${escape(persona.name)}</strong><small>${escape(persona.publicIdentity || persona.pronouns || 'Current persona')}</small>`
            : '<span>No active persona</span><small>Your display name will identify you in this room.</small>';
        open(party.context);
    }

    function prepareCampaign(campaignId, options = {}) {
        if (party.mode !== 'off') return render();
        const campaign = campaignList().find(item => item.id === campaignId);
        if (!campaign) return window.showToast?.('That multiplayer campaign could not be found.', 'error');
        party.campaign = campaign;
        party.context = campaign.source || { type: 'world', name: campaign.name };
        party.resumeCampaign = true;
        if (options.transport) selectTransport(options.transport);
        if (options.relayUrl) party.relayUrl = options.relayUrl;
        if (byId('world-party-campaign-name')) byId('world-party-campaign-name').value = campaign.name;
        if (byId('world-party-rules-preset')) byId('world-party-rules-preset').value = RULE_PRESETS[campaign.system?.id] ? campaign.system.id : 'custom';
        if (byId('world-party-custom-rules')) byId('world-party-custom-rules').value = campaign.system?.rulesText || '';
        hydrateSystemEditor(campaign.system);
        open(party.context);
    }

    async function joinInvite(invite, displayName = 'Player') {
        const raw = String(invite || '').trim();
        if (!raw) return window.showToast?.('Paste the complete invite link.', 'error');
        let online = null; try { online = decodeInvite(raw); } catch (_) {}
        if (online) {
            party.transport = 'online'; party.relayUrl = online.relayUrl;
            byId('world-party-room-code').value = raw;
            byId('world-party-join-name').value = displayName || 'Player';
            open(); await join(); return;
        }
        let parsed;
        try { parsed = new URL(raw); }
        catch (_) { return window.showToast?.('That does not look like a complete invite link.', 'error'); }
        const roomCode = String(parsed.searchParams.get('multiplayer') || '').trim().toUpperCase();
        const inviteToken = new URLSearchParams(parsed.hash.replace(/^#/, '')).get('invite') || '';
        if (!roomCode || !inviteToken) return window.showToast?.('The invite link is missing its room code or private token.', 'error');
        if (parsed.origin !== location.origin) {
            location.assign(raw);
            return;
        }
        byId('world-party-room-code').value = roomCode;
        byId('world-party-join-name').value = displayName || 'Player';
        sessionStorage.setItem(`horde_party_invite_${roomCode}`, inviteToken);
        open();
        await join();
    }

    function openPartyManager() {
        const current = party.state;
        if (!current) return;
        let overlay = byId('mp-party-manager-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mp-party-manager-overlay';
            overlay.className = 'modal-overlay mp-party-manager-overlay';
            document.body.appendChild(overlay);
        }
        const campaign = campaignForRender(current);
        overlay.innerHTML = `<div class="modal mp-party-manager" role="dialog" aria-modal="true" aria-label="Party manager">
            <header><div><span class="vh-eyebrow">CAMPAIGN PARTY</span><h2>${escape(campaign.name)}</h2><p>Every player has an independent identity and character sheet.</p></div><button class="labs-close-btn" data-mp-party-close type="button">✕</button></header>
            <div class="mp-party-manager-body">${(current.players || []).map(player => {
                const persona = player.persona || {};
                const sheet = player.sheet || emptySheet();
                const conditions = [...(sheet.conditions || []), ...(sheet.effects || [])].map(entry => typeof entry === 'string' ? entry : entry.name).filter(Boolean).join(', ');
                const inventory = (sheet.inventory || []).map(entry => entry.name || entry).join(', ');
                const resources = Object.values(sheet.resources || {}).map(resource => `${resource.name} ${resource.value}/${resource.max}`).join(' · ');
                return `<article class="mp-party-sheet" data-mp-view-sheet="${escape(player.id)}"><div class="mp-party-sheet-head"><span>${escape(initials(sheet.name || player.name))}</span><div><h3>${escape(sheet.name || player.name)}${player.isHost ? ' ♛' : ''}</h3><p>Level ${escape(sheet.level || 1)} · ${escape(persona.publicIdentity || persona.pronouns || 'Identity not supplied')}</p></div><small>${player.online ? 'ONLINE' : 'OFFLINE'}</small></div><dl><div><dt>Resources</dt><dd>${escape(resources || 'Not configured')}</dd></div><div><dt>Appearance</dt><dd>${escape(sheet.appearance || persona.appearance || 'Not shared')}</dd></div><div><dt>Reputation</dt><dd>${escape(sheet.reputation || persona.reputation || 'Not established')}</dd></div><div><dt>Effects</dt><dd>${escape(conditions || 'None')}</dd></div><div><dt>Inventory</dt><dd>${escape(inventory || 'Empty')}</dd></div></dl><button class="btn btn-ghost btn-small" type="button">View full sheet</button></article>`;
            }).join('')}</div>
            <footer><p>${party.mode === 'host' ? 'Host controls room authority and the model connection. Rules-changing actions require a party vote.' : 'You can inspect public party information. The host controls room authority and the model connection.'}</p></footer>
        </div>`;
        overlay.classList.remove('hidden');
        overlay.querySelectorAll('[data-mp-view-sheet]').forEach(card => card.querySelector('button').onclick = () => { overlay.classList.add('hidden'); openCharacterSheet(card.dataset.mpViewSheet); });
        overlay.querySelector('[data-mp-party-close]').onclick = () => overlay.classList.add('hidden');
        overlay.onclick = event => { if (event.target === overlay) overlay.classList.add('hidden'); };
    }

    function setup(options = {}) {
        hooks = options;
        byId('world-party-close-btn').onclick = close;
        byId('world-party-host-btn').onclick = host;
        byId('world-party-join-btn').onclick = join;
        byId('world-party-submit-btn').onclick = () => submit(byId('world-party-action').value);
        byId('world-party-commit-btn').onclick = commit;
        byId('world-party-end-btn').onclick = end;
        byId('world-party-copy-btn').onclick = copyInvite;
        byId('mp-session-input')?.addEventListener('input', event => {
            const submitted = (party.state?.round?.submissions || []).some(item => item.playerId === party.playerId && item.submitted);
            byId('mp-session-submit').disabled = !String(event.target.value || '').trim() || !party.state
                || submitted || party.state.round?.activePlayerId !== party.playerId;
        });
        byId('mp-session-submit')?.addEventListener('click', () => submit(byId('mp-session-input')?.value));
        byId('mp-session-input')?.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(event.currentTarget.value); }
        });
        byId('mp-session-commit')?.addEventListener('click', commit);
        byId('mp-session-invite')?.addEventListener('click', copyInvite);
        byId('mp-session-reroll')?.addEventListener('click', () => propose('reroll', 'Reroll the last facilitator response'));
        byId('mp-session-leave')?.addEventListener('click', end);
        byId('mp-session-back')?.addEventListener('click', end);
        byId('mp-session-party')?.addEventListener('click', openPartyManager);
        byId('mp-session-campaign')?.addEventListener('click', () => document.querySelector('.mp-session-layout')?.classList.toggle('mp-show-campaign'));
        byId('mp-session-dice')?.addEventListener('click', openDice);
        byId('mp-session-gm')?.addEventListener('click', openGmConsole);
        document.querySelectorAll('[data-mp-panel]').forEach(button => button.addEventListener('click', () => {
            party.activePanel = button.dataset.mpPanel || 'scene';
            document.querySelectorAll('[data-mp-panel]').forEach(item => item.classList.toggle('active', item === button));
            if (party.state) renderSidePanel(campaignForRender(party.state), party.state);
        }));
        document.querySelectorAll('[data-party-transport]').forEach(button => button.onclick = () => selectTransport(button.dataset.partyTransport));
        byId('world-party-rules-preset')?.addEventListener('change', event => hydrateSystemEditor(RULE_PRESETS[event.target.value] || RULE_PRESETS.custom));
        party.relayUrl = localStorage.getItem(RELAY_KEY) || '';
        selectTransport('lan');
        byId('world-multiplayer-overlay').addEventListener('click', event => {
            if (event.target.id === 'world-multiplayer-overlay') close();
        });
        const invitedRoom = String(new URLSearchParams(location.search).get('multiplayer') || '').toUpperCase();
        let restored = null;
        try { restored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) {}
        if (restored?.roomCode && restored?.playerId && restored?.playerToken) {
            party.campaign = campaignList().find(item => item.id === restored.campaignId) || null;
            setMode(restored.mode === 'host' ? 'host' : 'guest', restored);
            startPolling();
        }
        if (invitedRoom && party.mode === 'off') {
            byId('world-party-room-code').value = invitedRoom;
            setTimeout(open, 100);
        }
    }

    window.HordeMultiplayer = {
        setup, open, prepare, prepareCampaign, joinInvite, submit, propose, poll, selectTransport,
        campaigns: campaignList,
        context: () => party.context,
        isHosting: () => party.mode === 'host',
        isActive: () => party.mode !== 'off',
        isMyTurn: () => party.state?.round?.activePlayerId === party.playerId
            && party.state?.round?.status === 'collecting'
    };
})();
