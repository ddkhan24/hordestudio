/* Offline Durable Object transport regressions using native Request/Response. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const load = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../multiplayer-relay/worker.js')).toString('base64')}`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function storageAPI(values = new Map(), limit = 128 * 1024) {
    const api = {
        get: async key => structuredClone(values.get(key)),
        put: async (key, value) => {
            await delay(1);
            const entries = typeof key === 'object' ? Object.entries(key) : [[key, value]];
            for (const [name, item] of entries) {
                const size = item instanceof Uint8Array ? item.byteLength : new TextEncoder().encode(JSON.stringify(item)).length;
                if (size > limit) throw new RangeError('Values cannot be larger than 131072 bytes.');
                values.set(name, structuredClone(item));
            }
        },
        delete: async key => values.delete(key), setAlarm: async () => {}, deleteAll: async () => values.clear(),
        transaction: async work => {
            const staged = new Map(structuredClone([...values]));
            const result = await work(storageAPI(staged, limit));
            values.clear(); for (const [key, value] of staged) values.set(key, value);
            return result;
        }
    };
    return api;
}

class Socket {
    attachment = null;
    messages = [];
    send(message) { this.messages.push(JSON.parse(message)); }
    serializeAttachment(value) { this.attachment = value; }
    deserializeAttachment() { return this.attachment; }
    close() {}
}
async function fixture() {
    const { HordeRoom } = await load;
    const storage = new Map();
    const state = {
        blockConcurrencyWhile: work => work(),
        storage: storageAPI(storage),
        sockets: [], getWebSockets() { return this.sockets; }
    };
    const room = new HordeRoom(state);
    const request = (route, body) => room.fetch(new Request(`https://room/internal/${route}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }));
    const created = await (await request('create?code=AUDIT1', { displayName: 'Host',
        sheet: { name: 'Host', notes: 'Host private note', attributes: { Finesse: 1 } },
        snapshot: { history: [{ role: 'dm', text: 'Opening' }], gameState: { rules: { die: 'd20' }, characters: {} },
            campaignStart: { history: [{ role: 'dm', text: 'Opening' }], turn: 0,
                gameState: { rules: { die: 'd20' }, characters: {} } } }
    })).json();
    const host = { playerId: created.hostPlayerId, playerToken: created.playerToken, inviteToken: created.inviteToken };
    const join = async (name = 'Guest') => {
        const response = await request('join', { inviteToken: host.inviteToken, displayName: name,
            sheet: { name, notes: `${name} private note`, attributes: { Finesse: 2 } } });
        const result = await response.json();
        return { playerId: result.playerId, playerToken: result.playerToken, inviteToken: host.inviteToken };
    };
    const guest = await join();
    const socketFor = async auth => {
        const socket = new Socket(); state.sockets.push(socket);
        await room.webSocketMessage(socket, JSON.stringify({ id: 'auth', command: 'authenticate', ...auth }));
        assert.equal(socket.messages.at(-1).ok, true);
        return socket;
    };
    const hostSocket = await socketFor(host), guestSocket = await socketFor(guest);
    let sequence = 0;
    const command = async (auth, name, payload = {}, socket = auth === host ? hostSocket : guestSocket) => {
        const id = `call_${++sequence}`;
        await room.webSocketMessage(socket, JSON.stringify({ id, command: name, ...auth, payload }));
        return socket.messages.findLast(message => message.id === id);
    };
    const ready = async () => {
        assert.equal((await command(host, 'submit', { text: 'Host acts' })).ok, true);
        assert.equal((await command(guest, 'submit', { text: 'Guest acts' })).ok, true);
    };
    return { room, state, request, host, guest, join, command, ready, socketFor };
}

test('committed and reset character sheets drive subsequent server rolls', async () => {
    const f = await fixture(); await f.ready();
    const snapshot = structuredClone(f.room.room.snapshot);
    snapshot.gameState.characters[f.host.playerId] = { name: 'Host', attributes: { Finesse: 7 },
        skills: { Notice: 1 }, effects: [{ modifiers: { checks: 2 } }], inventory: [{ id: 'amulet', modifiers: { checks: 3 } }], equipment: { neck: 'amulet' } };
    assert.equal((await f.command(f.host, 'commit', { snapshot })).ok, true);
    assert.equal(f.room.room.players[f.host.playerId].sheet.attributes.Finesse, 7);
    const roll = await f.command(f.host, 'roll', { dice: 'd2', attribute: 'Finesse', skill: 'Notice' });
    assert.equal(roll.ok, true); assert.equal(f.room.room.snapshot.gameState.rolls.at(-1).bonus, 13);
    await f.command(f.host, 'propose', { type: 'reset' });
    await f.command(f.guest, 'vote', { proposalId: f.room.room.proposal.id, approve: true });
    assert.equal((await f.command(f.host, 'resolve', { snapshot })).ok, true);
    assert.equal(f.room.room.players[f.host.playerId].sheet.attributes.Finesse, 1);
});

test('private character notes appear only to their owner and host', async () => {
    const f = await fixture();
    const guest = (await f.command(f.guest, 'state')).data;
    assert.equal(guest.players.find(p => p.id === f.host.playerId).sheet.notes, undefined);
    assert.equal(guest.snapshot.gameState.characters[f.host.playerId].notes, undefined);
    assert.equal(guest.snapshot.gameState.characters[f.guest.playerId].notes, 'Guest private note');
    assert.equal(guest.snapshot.campaignStart.gameState.characters[f.host.playerId].notes, undefined);
    const host = (await f.command(f.host, 'state')).data;
    assert.equal(host.snapshot.gameState.characters[f.host.playerId].notes, 'Host private note');
    assert.equal(host.snapshot.gameState.characters[f.guest.playerId].notes, 'Guest private note');
});

test('a late join reopens a ready round until the new member submits', async () => {
    const f = await fixture(); await f.ready();
    const late = await f.join('Late'); const socket = await f.socketFor(late);
    assert.equal(f.room.room.round.status, 'collecting');
    assert.equal(f.room.room.round.activePlayerId, late.playerId);
    assert.equal((await f.command(f.host, 'commit', { snapshot: f.room.room.snapshot })).ok, false);
    assert.equal((await f.command(late, 'submit', { text: 'Late acts' }, socket)).ok, true);
    assert.equal((await f.command(f.host, 'commit', { snapshot: {} })).ok, true);
    assert.equal(Object.keys(f.room.room.snapshot.gameState.characters).length, 3);
});

test('a stale host turn cannot overwrite a concurrent character edit', async () => {
    const f = await fixture(); await f.ready();
    const expectedRevision = f.room.room.revision, expectedRoundNumber = f.room.room.round.number;
    const snapshot = structuredClone(f.room.room.snapshot);
    await f.command(f.guest, 'sheet', { sheet: { name: 'Guest', attributes: { Finesse: 9 } } });
    const result = await f.command(f.host, 'commit', { snapshot, expectedRevision, expectedRoundNumber });
    assert.equal(result.ok, false); assert.match(result.error, /party changed/);
    assert.equal(f.room.room.round.status, 'ready');
    assert.equal(f.room.room.snapshot.gameState.characters[f.guest.playerId].attributes.Finesse, 9);
});

test('open votes cannot be replaced by another proposal', async () => {
    const f = await fixture(); await f.command(f.host, 'propose', { type: 'reset' });
    const id = f.room.room.proposal.id;
    const result = await f.command(f.guest, 'propose', { type: 'reroll' });
    assert.equal(result.ok, false); assert.equal(f.room.room.proposal.id, id);
});

test('deep room input is bounded and cannot bypass credential sanitization', async () => {
    const f = await fixture();
    let nested = { apiKey: 'DEEP-CREDENTIAL', secret: 'DEEP-SECRET' };
    for (let depth = 0; depth < 10; depth++) nested = { nested };
    await f.command(f.host, 'gm', { snapshot: { gameState: { npcs: { test: nested } } } });
    const state = JSON.stringify((await f.command(f.guest, 'state')).data);
    assert.doesNotMatch(state, /DEEP-CREDENTIAL|DEEP-SECRET/);
});

test('prototype names never authenticate as a player without a token', async () => {
    const f = await fixture(); const socket = new Socket();
    await f.room.webSocketMessage(socket, JSON.stringify({ id: 'proto', command: 'authenticate',
        inviteToken: f.host.inviteToken, playerId: '__proto__' }));
    assert.equal(socket.messages.at(-1).ok, false);
    assert.equal(Object.prototype.lastSeen, undefined);
});

test('concurrent create requests cannot replace a room while reading a body', async () => {
    const { HordeRoom } = await load;
    const room = new HordeRoom({ blockConcurrencyWhile: work => work(),
        storage: storageAPI(), getWebSockets: () => [] });
    const make = ms => ({ url: 'https://room/internal/create?code=RACE01',
        json: async () => { await delay(ms); return { displayName: `Host${ms}` }; } });
    const responses = await Promise.all([room.fetch(make(20)), room.fetch(make(0))]);
    assert.deepEqual(responses.map(response => response.status), [200, 409]);
    assert.equal(room.players()[0].name, 'Host20');
});

test('portrait-heavy rooms survive storage limits and Durable Object restarts', async () => {
    const f = await fixture();
    const portrait = 'data:image/png;base64,' + 'p'.repeat(740000);
    await f.command(f.host, 'sheet', { sheet: { name: 'Host', portrait, notes: '私的なメモ 🐉' } });
    await f.command(f.guest, 'sheet', { sheet: { name: 'Guest', portrait } });
    const { HordeRoom } = await load;
    const restarted = new HordeRoom(f.state); await restarted.ready;
    assert.equal(restarted.room.players[f.host.playerId].sheet.portrait, portrait);
    assert.equal(restarted.room.players[f.host.playerId].sheet.notes, '私的なメモ 🐉');
    assert.equal(restarted.room.snapshot.gameState.characters[f.guest.playerId].portrait, portrait);
    assert.equal((await f.state.storage.get('room')).format, 'horde-room-chunks-v1');
});

test('reroll restores all mechanics and original actions after history truncation', async () => {
    const f = await fixture();
    const before = Array.from({ length: 120 }, (_, index) => ({ role: 'dm', text: `Before ${index}` }));
    await f.command(f.host, 'gm', { snapshot: { history: before, turn: 8,
        gameState: { characters: { [f.host.playerId]: { name: 'Host', attributes: { Finesse: 4 } } } } } });
    await f.ready();
    await f.command(f.host, 'commit', { snapshot: { history: [...before, { role: 'dm', text: 'Damaged' }], turn: 9,
        gameState: { characters: { [f.host.playerId]: { name: 'Host', attributes: { Finesse: 1 } } } } } });
    await f.command(f.host, 'propose', { type: 'reroll' });
    await f.command(f.guest, 'vote', { proposalId: f.room.room.proposal.id, approve: true });
    const result = await f.command(f.host, 'resolve', { proposalId: f.room.room.proposal.id,
        expectedRevision: f.room.room.revision, snapshot: { turn: 999 } });
    assert.equal(result.ok, true);
    assert.equal(f.room.room.snapshot.gameState.characters[f.host.playerId].attributes.Finesse, 4);
    assert.deepEqual(f.room.room.snapshot.history.map(row => row.text), before.map(row => row.text));
    assert.equal(f.room.room.snapshot.turn, 8);
    assert.equal(f.room.room.round.status, 'ready');
    assert.equal(f.room.room.round.number, 1);
    assert.equal(f.room.room.round.submissions[f.guest.playerId].text, 'Guest acts');
    assert.equal(f.room.room.snapshot.turnCheckpoint, undefined);
});

test('failed persistence rolls back the in-memory mutation for a safe retry', async () => {
    const f = await fixture(); const previous = structuredClone(f.room.room.snapshot);
    const transaction = f.state.storage.transaction;
    f.state.storage.transaction = async () => { throw new Error('storage unavailable'); };
    const result = await f.command(f.guest, 'sheet', { sheet: { attributes: { Finesse: 999 } } });
    assert.equal(result.ok, false); assert.deepEqual(f.room.room.snapshot, previous);
    f.state.storage.transaction = transaction;
    assert.equal((await f.command(f.guest, 'sheet', { sheet: { attributes: { Finesse: 3 } } })).ok, true);
});

test('a stale GM edit cannot overwrite a newer sheet update', async () => {
    const f = await fixture(); const expectedRevision = f.room.room.revision;
    const snapshot = structuredClone(f.room.room.snapshot);
    await f.command(f.guest, 'sheet', { sheet: { attributes: { Finesse: 9 } } });
    assert.equal((await f.command(f.host, 'gm', { snapshot, expectedRevision })).ok, false);
    assert.equal(f.room.room.snapshot.gameState.characters[f.guest.playerId].attributes.Finesse, 9);
});

test('guest views redact GM journals, clocks, rolls, transactions and NPC notes in checkpoints', async () => {
    const f = await fixture();
    const gameState = { journal: [{ text: 'PUBLIC', visibility: 'public' }, { text: 'PRIVATE-JOURNAL', visibility: 'private' }],
        clocks: [{ name: 'PRIVATE-CLOCK', visibility: 'gm' }], rolls: [{ label: 'PRIVATE-ROLL', visibility: 'gm' }],
        transactions: [{ summary: 'PRIVATE-TRANSACTION', operations: [{ text: 'PRIVATE-JOURNAL' }] }],
        npcs: { npc: { name: 'Scout', notes: 'PRIVATE-NPC' } } };
    await f.command(f.host, 'gm', { snapshot: { gameState } }); await f.ready();
    await f.command(f.host, 'commit', { snapshot: { gameState } });
    const guest = JSON.stringify((await f.command(f.guest, 'state')).data);
    assert.doesNotMatch(guest, /PRIVATE-/); assert.match(guest, /PUBLIC/);
    assert.match(JSON.stringify((await f.command(f.host, 'state')).data), /PRIVATE-JOURNAL/);
});

test('reopening a saved host remaps room identities without changing current or starting HP', async () => {
    const { HordeRoom } = await load;
    const room = new HordeRoom({ blockConcurrencyWhile: work => work(), storage: storageAPI(), getWebSockets: () => [] });
    const body = { displayName: 'Reopened', resumeCharacterId: 'old-host',
        sheet: { resources: { hp: { value: 4, max: 12 } } }, snapshot: { turn: 3,
            gameState: { characters: { 'old-host': { resources: { hp: { value: 4 } } }, 'old-guest': { name: 'Archived guest' } }, encounters: [{ initiative: ['old-guest', 'old-host'], turn: 1 }] },
            campaignStart: { turn: 0, history: [{ role: 'dm', text: 'Original opening' }],
                gameState: { characters: { 'old-host': { resources: { hp: { value: 12, max: 12 } } } } } },
            turnCheckpoint: { turn: 2, gameState: { characters: { 'old-host': { resources: { hp: { value: 8 } } } } },
                roomRoundNumber: 3, submissions: [{ playerId: 'old-host', submitted: true, text: 'Acts' }] } } };
    const response = await room.fetch(new Request('https://room/internal/create?code=REOPEN', { method: 'POST', body: JSON.stringify(body) }));
    const created = await response.json(); const hostId = created.hostPlayerId;
    assert.doesNotMatch(JSON.stringify(room.room.snapshot), /old-host/);
    assert.equal(room.room.snapshot.gameState.characters[hostId].resources.hp.value, 4);
    assert.deepEqual(room.room.snapshot.gameState.encounters[0].initiative, [hostId]);
    assert.equal(room.room.snapshot.gameState.encounters[0].turn, 0);
    assert.equal(room.room.snapshot.gameState.characters['old-guest'].name, 'Archived guest');
    assert.equal(room.room.snapshot.campaignStart.gameState.characters[hostId].resources.hp.value, 12);
    assert.equal(room.room.snapshot.turnCheckpoint.submissions[0].playerId, hostId);
});
