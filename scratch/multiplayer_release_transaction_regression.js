'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runtime() {
    const entries = new Map();
    const elements = new Map();
    const storage = { getItem: key => entries.get(key) || null,
        setItem: (key, value) => entries.set(key, String(value)), removeItem: key => entries.delete(key) };
    const context = { console, Date, Math, Set, Map, Object, Array, String, Number, RegExp,
        URL, URLSearchParams, AbortController, TextEncoder, TextDecoder,
        setTimeout, clearTimeout, setInterval, clearInterval,
        localStorage: storage, sessionStorage: storage,
        location: { search: '', hash: '', protocol: 'http:', origin: 'http://audit.invalid' },
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '',
                disabled: false, classList: { toggle() {}, add() {}, remove() {} },
                setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
            return elements.get(id);
        } }, showToast() {} };
    context.window = context;
    vm.createContext(context);
    for (const file of ['rpg-mechanics.js', 'multiplayer-engine.js'])
        vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    // Expose closure internals only in the isolated fixture; production API is unchanged.
    const source = fs.readFileSync('multiplayer.js', 'utf8').replace('window.HordeMultiplayer = {',
        'window.HordeMultiplayer = { __audit: { party, commit, applyDecision, renderSession, socketCommand, connectSocket, hostCharacter, remapHostedCharacter, completePartyStructured, setHooks: value => { hooks = value; } },');
    vm.runInContext(source, context, { filename: 'multiplayer.js' });
    const Engine = context.HordeMultiplayerEngine;
    const rules = Engine.pack('d20');
    const gameState = Engine.createState(rules, { location: 'Keep' });
    gameState.characters.p1 = Engine.createSheet(rules, { name: 'Mara' });
    const snapshot = { history: [{ role: 'dm', text: 'The gate is open.' }], turn: 0, gameState };
    const campaign = { id: 'audit', name: 'Audit', system: rules, snapshot: Engine.clone(snapshot),
        gameState: Engine.clone(gameState), players: [{ id: 'p1', name: 'Mara', sheet: Engine.clone(gameState.characters.p1) }] };
    const current = { experienceType: 'world', revision: 1, snapshot, players: Engine.clone(campaign.players),
        round: { number: 1, status: 'ready', submissions: [{ playerId: 'p1', name: 'Mara', submitted: true, text: 'I defend.' }] } };
    const audit = context.HordeMultiplayer.__audit;
    Object.assign(audit.party, { mode: 'host', playerId: 'p1', roomCode: 'TEST', campaign, state: current });
    return { context, Engine, audit, current, campaign, storage };
}

async function main() {
    {
        const { Engine, campaign } = runtime();
        campaign.gameState.characters.p1.resources.hp.value = 4;
        campaign.gameState.characters.p1.inventory.push(Engine.item({ id: 'key', name: 'Key' }));
        const migrated = Engine.migrateCampaign(campaign);
        assert.equal(migrated.gameState.characters.p1.resources.hp.value, 4,
            'migration must preserve canonical HP over stale player metadata');
        assert.equal(migrated.players[0].sheet.inventory[0].name, 'Key');
        assert.equal(Engine.migrateCampaign(JSON.parse(JSON.stringify(migrated))).gameState.characters.p1.resources.hp.value, 4,
            'reopening a saved campaign must preserve the committed sheet');
        const snapshotOnly = Engine.clone(migrated);
        delete snapshotOnly.gameState;
        snapshotOnly.players[0].sheet.resources.hp.value = 12;
        assert.equal(Engine.migrateCampaign(snapshotOnly).gameState.characters.p1.resources.hp.value, 4,
            'snapshot-only legacy campaigns must retain canonical state during migration');
        const legacy = { system: campaign.system, snapshot: {}, players: [{ id: 'legacy', name: 'Legacy', sheet: { name: 'Legacy', level: 3 } }] };
        assert.equal(Engine.migrateCampaign(legacy).gameState.characters.legacy.level, 3,
            'legacy campaigns without canonical sheets still import player metadata');
    }
    {
        const { audit, current, campaign } = runtime();
        current.snapshot.gameState.characters.p1.resources.hp.value = 2;
        audit.renderSession(current, new Map(), false, false);
        assert.equal(campaign.gameState.characters.p1.resources.hp.value, 2,
            'rendering stale roster metadata must not heal canonical damage');
    }
    {
        const { audit, current, campaign, Engine, storage } = runtime();
        const before = JSON.stringify(current.snapshot);
        storage.setItem('horde_multiplayer_campaigns_v1', JSON.stringify([campaign]));
        const savedBefore = storage.getItem('horde_multiplayer_campaigns_v1');
        audit.setHooks({ executeTurn: async () => ({ text: 'Mara takes a hit.', receipt: { operations: [
            { type: 'resource', playerId: 'p1', resource: 'hp', delta: -3 }
        ] } }), bridgeRequest: async () => { throw new Error('Network unavailable'); } });
        await audit.commit();
        assert.equal(JSON.stringify(current.snapshot), before,
            'a failed relay commit must leave the canonical snapshot and transcript untouched');
        assert.equal(storage.getItem('horde_multiplayer_campaigns_v1'), savedBefore,
            'a failed relay commit must not autosave an uncommitted turn');
        assert.equal(campaign.gameState.characters.p1.resources.hp.value, 12);
        assert.equal(audit.party.committing, false);
    }
    {
        const { audit, current, Engine } = runtime();
        let calls = 0;
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        audit.setHooks({ executeTurn: async () => { calls++; await pending; return { text: 'Mara takes a hit.', receipt: {
            operations: [{ type: 'resource', playerId: 'p1', resource: 'hp', delta: -3 }] } }; },
            bridgeRequest: async (path, options) => {
                if (path === '/multiplayer/commit') {
                    current.snapshot = Engine.clone(options.body.snapshot);
                    current.round.status = 'collecting'; current.round.number++;
                    current.revision++; return {};
                }
                return Engine.clone(current);
            } });
        const first = audit.commit();
        await Promise.resolve(); await Promise.resolve();
        const second = audit.commit();
        await Promise.resolve(); await Promise.resolve();
        assert.equal(calls, 1, 'overlapping commit controls must generate only one paid host turn');
        release();
        await Promise.all([first, second]);
        assert.equal(audit.party.campaign.gameState.characters.p1.resources.hp.value, 9);
        assert.equal(audit.party.state.snapshot.gameState.characters.p1.resources.hp.value, 9);
        assert.equal(audit.party.state.snapshot.history.filter(item => item.role === 'dm').length, 2);
        assert.equal(audit.party.state.snapshot.turn, 1);
    }
    {
        const { audit, current, campaign, Engine } = runtime();
        current.snapshot.campaignStart = { history: Engine.clone(current.snapshot.history), turn: 0,
            gameState: Engine.clone(current.snapshot.gameState) };
        let calls = 0;
        audit.setHooks({ executeTurn: async () => ({ text: `Turn ${++calls}`, receipt: { operations: [
            { type: 'resource', playerId: 'p1', resource: 'hp', delta: calls === 1 ? -3 : -6 },
            { type: 'inventory-add', playerId: 'p1', item: { id: 'gem', name: 'Gem' } },
            { type: 'clock', clockId: 'alarm', name: 'Alarm', delta: 1 }
        ] } }), bridgeRequest: async (path, options) => {
            if (path === '/multiplayer/commit') {
                current.snapshot = Engine.clone(options.body.snapshot);
                current.round.status = 'collecting'; current.round.number++;
                current.revision++; return {};
            }
            if (path === '/multiplayer/resolve') {
                const checkpoint = current.snapshot.turnCheckpoint;
                current.snapshot = Engine.clone(options.body.snapshot);
                if (current.proposal.type === 'reroll') current.round = {
                    number: checkpoint.roomRoundNumber, status: 'ready', submissions: Engine.clone(checkpoint.submissions)
                };
                else current.round = { number: 1, status: 'collecting', submissions: [] };
                current.proposal.status = 'applied'; current.revision++; return {};
            }
            return Engine.clone(current);
        } });
        await audit.commit();
        assert.equal(current.snapshot.gameState.characters.p1.resources.hp.value, 9);
        assert.equal(current.snapshot.turnCheckpoint.gameState.characters.p1.resources.hp.value, 12);
        assert.equal(current.snapshot.turnCheckpoint.history.length, 1);
        audit.party.state = current;
        current.proposal = { id: 'reroll', type: 'reroll', status: 'approved' };
        await audit.applyDecision();
        assert.equal(calls, 2, 'approved reroll must regenerate the original submitted actions');
        assert.equal(current.snapshot.gameState.characters.p1.resources.hp.value, 6,
            'rerolled damage must start from the preturn mechanical state');
        assert.equal(current.snapshot.gameState.characters.p1.inventory[0].quantity, 1,
            'rerolls must not duplicate prior rewards');
        assert.equal(current.snapshot.gameState.clocks[0].value, 1);
        assert.equal(current.snapshot.turn, 1);
        assert.equal(current.snapshot.history.filter(item => item.role === 'dm').length, 2);
        audit.party.state = current;
        current.proposal = { id: 'reset', type: 'reset', status: 'approved' };
        await audit.applyDecision();
        assert.equal(current.snapshot.gameState.characters.p1.resources.hp.value, 12);
        assert.equal(current.snapshot.gameState.characters.p1.inventory.length, 0);
        assert.equal(current.snapshot.gameState.clocks.length, 0);
        assert.equal(current.snapshot.history.length, 1);
        assert.equal(current.snapshot.turn, 0);
        assert.equal(calls, 2, 'reset must restore the initial campaign without generating a turn');
        assert.throws(() => Engine.restoreDecision({ history: [], gameState: campaign.gameState }, 'reset'),
            /no saved starting state/, 'legacy reset must fail visibly when the original baseline is unavailable');
        assert.throws(() => Engine.restoreDecision({ history: [] }, 'reroll'), /rollback checkpoint/);
    }
    {
        const { audit, context, current, Engine } = runtime();
        class FakeSocket {
            static OPEN = 1;
            constructor() { this.readyState = 0; this.sent = []; FakeSocket.last = this; }
            send(value) {
                if (this.failSend) throw new Error('Socket closed during send');
                this.sent.push(JSON.parse(value));
            }
            close() { this.readyState = 3; this.onclose?.(); }
        }
        context.WebSocket = FakeSocket;
        Object.assign(audit.party, { transport: 'online', relayUrl: 'https://relay.invalid' });
        const connected = audit.connectSocket();
        const socket = FakeSocket.last;
        socket.readyState = FakeSocket.OPEN; socket.onopen();
        const pendingCommand = audit.socketCommand('state');
        await Promise.resolve(); await Promise.resolve();
        assert.equal(socket.sent.length, 1, 'an OPEN but unauthenticated socket must not send room commands');
        socket.onmessage({ data: JSON.stringify({ id: socket.sent[0].id, ok: true, data: Engine.clone(current) }) });
        await connected;
        await Promise.resolve(); await Promise.resolve();
        assert.equal(socket.sent.length, 2);
        socket.onmessage({ data: JSON.stringify({ id: socket.sent[1].id, ok: true, data: { revision: 1 } }) });
        assert.equal((await pendingCommand).revision, 1);
        socket.failSend = true;
        await assert.rejects(audit.socketCommand('state'), /Socket closed during send/);
        assert.equal(audit.party.pending.size, 0, 'send failures must clean up pending requests immediately');
        socket.failSend = false;
        const disconnected = audit.socketCommand('state');
        await Promise.resolve(); await Promise.resolve();
        audit.party.mode = 'off';
        socket.close();
        await assert.rejects(disconnected, /connection closed before/);
        assert.equal(audit.party.pending.size, 0);
    }
    {
        const { Engine } = runtime();
        const rules = Engine.pack('custom');
        const state = Engine.createState(rules);
        state.characters.p1 = Engine.createSheet(rules);
        state.characters.p1.level = 19;
        const applied = Engine.applyReceiptRecovering(state, { advanceRound: false, operations: [
            { type: 'xp', playerId: 'p1', delta: 1000 },
            { type: 'currency', playerId: 'p1', key: 'gold', delta: 'invalid' },
            { type: 'resource', playerId: 'p1', resource: 'health', set: 7 },
            { type: 'condition-add', playerId: 'p1', name: 'Permanent scar', timing: 'permanent', duration: 1 }
        ] });
        assert.equal(applied.state.characters.p1.level, 20);
        assert.equal(applied.state.characters.p1.advancement, 1,
            'capped milestone advancement must award only the levels actually gained');
        assert.equal(applied.rejected.length, 1, 'malformed numerical proposals must be rejected instead of storing NaN');
        assert.equal(applied.state.characters.p1.resources.health.value, 7);
        assert.equal(Object.keys(applied.state.characters.p1.currencies).length, 0);
        const next = Engine.applyReceipt(applied.state, { operations: [] }).state;
        assert.ok(next.characters.p1.conditions.some(condition => condition.name === 'Permanent scar'),
            'permanent conditions must survive resolved rounds regardless of legacy finite duration');
        const clean = Engine.effect({ modifiers: { checks: 'invalid', attributes: { Might: 'invalid' } } });
        assert.equal(clean.modifiers.checks, 0);
        assert.equal(Object.keys(clean.modifiers.attributes).length, 0);
    }
    {
        const { audit, context, current, Engine } = runtime();
        let release;
        const result = new Promise(resolve => { release = resolve; });
        audit.setHooks({ bridgeRequest: async () => result });
        const oldPoll = context.HordeMultiplayer.poll();
        const newer = Engine.clone(current); newer.revision = 5;
        audit.party.state = newer; audit.party.committing = true;
        release(Engine.clone(current)); await oldPoll;
        assert.equal(audit.party.state, newer, 'a poll that started before a turn must not publish over the transaction');
        audit.party.committing = false;
        await context.HordeMultiplayer.poll();
        assert.equal(audit.party.state.revision, 5, 'late poll responses must not roll canonical room revision backwards');
    }
    {
        const { audit } = runtime();
        let calls = 0;
        audit.setHooks({ executeTurn: async () => { calls++; return { text: 'The action resolves.', receipt: { operations: [],
            checks: [{ playerId: 'p1', dice: 'd2', difficulty: 1, visibility: 'gm' }] } }; },
            bridgeRequest: async path => {
                if (path === '/multiplayer/commit') return { ok: true, roundNumber: 2, revision: 2 };
                throw new Error('Follow-up state unavailable');
            } });
        await audit.commit();
        assert.equal(audit.party.state.round.status, 'collecting',
            'an accepted turn must not remain retryable when only its follow-up fetch fails');
        await audit.commit();
        assert.equal(calls, 1, 'lost state refresh must not spend another paid turn on an already committed round');
        assert.ok(!audit.party.state.snapshot.history.some(row => row.name === 'DICE'),
            'GM-only rolls must not be copied into the public transcript');
    }
    {
        const { audit, campaign, Engine } = runtime();
        campaign.snapshot.campaignStart = { history: [], turn: 0, gameState: Engine.clone(campaign.gameState) };
        campaign.gameState.characters.p1.resources.hp.value = 4;
        campaign.gameState.characters.p1.level = 5;
        campaign.gameState.characters.p1.inventory.push(Engine.item({ id: 'gem', name: 'Gem' }));
        campaign.gameState.encounters = [{ initiative: ['p1', 'wolf'] }];
        campaign.snapshot.turnCheckpoint = { gameState: Engine.clone(campaign.gameState), submissions: [{ playerId: 'p1', text: 'Defend' }] };
        const resumed = audit.hostCharacter(campaign, {}, 'Host', true);
        assert.equal(resumed.sheet.resources.hp.value, 4, 'reopening a campaign must preserve the saved host character');
        assert.equal(resumed.sheet.level, 5);
        assert.equal(resumed.sheet.inventory[0].name, 'Gem');
        assert.equal(resumed.resumeCharacterId, 'p1');
        audit.remapHostedCharacter(campaign, resumed.resumeCharacterId, 'new_host');
        assert.equal(campaign.gameState.characters.p1, undefined);
        assert.equal(campaign.gameState.characters.new_host.resources.hp.value, 4);
        assert.equal(campaign.snapshot.campaignStart.gameState.characters.new_host.resources.hp.value, 12,
            'reopening must retain the original reset baseline');
        assert.equal(campaign.gameState.encounters[0].initiative[0], 'new_host');
        assert.equal(campaign.snapshot.turnCheckpoint.submissions[0].playerId, 'new_host');
    }
    {
        const { audit, context } = runtime();
        let signal;
        context.HordeLabsNeedle = { completeStructured: (_, received) => { signal = received; return new Promise(() => {}); } };
        await assert.rejects(audit.completePartyStructured({ name: 'review' }, 15), /party review timed out/,
            'an unresponsive TinyBrain worker must not freeze multiplayer resolution');
        assert.equal(signal.aborted, true);
    }
    console.log('multiplayer_release_transaction_regression: ok');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
