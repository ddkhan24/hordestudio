/* Horde Studio Internet room relay.
 * The relay coordinates public room state only. Provider keys and hidden canon
 * remain in the host browser. Deploy this Worker to your own Cloudflare account.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS }
});
const cleanName = (value, fallback = 'Player') => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 48) || fallback;
const token = (bytes = 24) => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const roomCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const data = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(data, value => alphabet[value % alphabet.length]).join('');
};
const rollDice = expression => {
  const match = String(expression || '').trim().toLowerCase().match(/^(\d{0,2})d(\d{1,4})(?:\s*([+-])\s*(\d+))?$/);
  if (!match) throw new Error('Use dice notation such as d20, 2d6+3, or 4d10-1.');
  const count = Math.max(1, Math.min(Number(match[1] || 1), 40));
  const sides = Math.max(2, Math.min(Number(match[2]), 1000));
  const modifier = (match[3] === '-' ? -1 : 1) * Number(match[4] || 0); const dice = [];
  for (let index = 0; index < count; index++) {
    const bytes = crypto.getRandomValues(new Uint32Array(1)); dice.push(1 + (bytes[0] % sides));
  }
  return { expression: `${count}d${sides}${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''}`,
    dice, modifier, total: dice.reduce((sum, value) => sum + value, 0) + modifier };
};
const sheetCheckBonus = (sheet, attribute, skill, base = 0) => {
  let bonus = Number(base || 0) + Number(sheet?.attributes?.[attribute] || 0) + Number(sheet?.skills?.[skill] || 0);
  const active = [...(sheet?.effects || []), ...(sheet?.conditions || []).filter(entry => entry && typeof entry === 'object')];
  for (const entry of active) bonus += Number(entry?.modifiers?.checks || 0) + Number(entry?.modifiers?.attributes?.[attribute] || 0) + Number(entry?.modifiers?.skills?.[skill] || 0);
  const items = sheet?.inventory || [];
  for (const itemId of Object.values(sheet?.equipment || {}).filter(Boolean)) {
    const entry = items.find(item => item?.id === itemId);
    bonus += Number(entry?.modifiers?.checks || 0) + Number(entry?.modifiers?.attributes?.[attribute] || 0) + Number(entry?.modifiers?.skills?.[skill] || 0);
  }
  return bonus;
};
const safePersona = value => {
  const input = value && typeof value === 'object' ? value : {};
  return {
    name: cleanName(input.name, ''), pronouns: String(input.pronouns || '').slice(0, 60),
    appearance: String(input.appearance || '').slice(0, 500),
    publicIdentity: String(input.publicIdentity || '').slice(0, 500),
    reputation: String(input.reputation || '').slice(0, 500), color: String(input.color || '').slice(0, 24)
  };
};
const safePublic = (value, depth = 0) => {
  if (depth > 7) return null;
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return value.slice(0, 12000);
  if (Array.isArray(value)) return value.slice(0, 500).map(item => safePublic(item, depth + 1));
  if (typeof value === 'object') {
    const blocked = new Set(['apikey', 'api_key', 'token', 'playertoken', 'invitetoken', 'authorization', 'password', 'secret']);
    return Object.fromEntries(Object.entries(value).slice(0, 500)
      .filter(([key]) => !blocked.has(String(key).toLowerCase().replace(/-/g, '_')))
      .map(([key, item]) => [String(key).slice(0, 100), safePublic(item, depth + 1)]));
  }
  return String(value).slice(0, 1000);
};
const safeSheet = value => {
  const source = value && typeof value === 'object' ? value : {};
  const allowed = ['schemaVersion', 'characterId', 'name', 'pronouns', 'archetype', 'ancestry', 'background', 'portrait', 'publicIdentity', 'reputation',
    'appearance', 'level', 'xp', 'advancement', 'attributes', 'skills', 'resources', 'defenses', 'conditions',
    'effects', 'inventory', 'equipment', 'abilities', 'perks', 'currencies', 'notes', 'location', 'status', 'revision'];
  const result = Object.fromEntries(allowed.filter(key => key in source).map(key => [key, safePublic(source[key])]));
  result.name = cleanName(source.name, 'Adventurer'); result.portrait = String(source.portrait || '').slice(0, 750000);
  return result;
};
const remapActor = (value, previous, current) => {
  if (Array.isArray(value)) return value.map(item => remapActor(item, previous, current));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key === previous ? current : key, remapActor(item, previous, current)]));
  return typeof value === 'string' && value === previous ? current : value;
};
const pruneInitiative = (snapshot, players) => {
  const game = snapshot.gameState || {}, valid = new Set([...players, ...Object.keys(game.npcs || {})]);
  for (const encounter of Array.isArray(game.encounters) ? game.encounters : []) {
    if (!encounter || !Array.isArray(encounter.initiative)) continue;
    const turn = Math.max(0, Number(encounter.turn) || 0), actor = encounter.initiative[turn];
    encounter.initiative = encounter.initiative.filter(id => valid.has(id));
    const index = encounter.initiative.indexOf(actor);
    encounter.turn = index >= 0 ? index : Math.min(turn, Math.max(0, encounter.initiative.length - 1));
  }
};
const safeGameState = value => {
  const source = value && typeof value === 'object' ? value : {};
  const allowed = ['schemaVersion', 'revision', 'phase', 'scene', 'rules', 'npcs', 'encounters', 'quests', 'clocks',
    'sharedInventory', 'journal', 'rolls', 'transactions', 'lastReceiptId', 'updatedAt'];
  const result = Object.fromEntries(allowed.filter(key => key in source).map(key => [key, safePublic(source[key])]));
  result.characters = Object.fromEntries(Object.entries(source.characters || {}).slice(0, 40)
    .map(([playerId, sheet]) => [String(playerId).slice(0, 100), safeSheet(sheet)]));
  result.rolls = (result.rolls || []).slice(-200); result.transactions = (result.transactions || []).slice(-500);
  return result;
};
const safeSnapshot = value => {
  const input = value && typeof value === 'object' ? value : {};
  const type = input.experienceType === 'chat' ? 'chat' : 'world';
  const rawHud = input.hud && typeof input.hud === 'object' ? input.hud : {};
  const rawLocation = rawHud.location && typeof rawHud.location === 'object' ? rawHud.location : {};
  const hud = {
    location: { name: String(rawLocation.name || input.location || 'Unknown').slice(0, 160),
      description: String(rawLocation.description || '').slice(0, 1200) },
    clock: String(rawHud.clock || '').slice(0, 160), period: String(rawHud.period || '').slice(0, 80),
    weather: String(rawHud.weather || '').slice(0, 160), outfit: String(rawHud.outfit || '').slice(0, 1200),
    ledger: String(rawHud.ledger || '').slice(0, 6000),
    inventory: (Array.isArray(rawHud.inventory) ? rawHud.inventory : []).slice(0, 80).map(item => String(item).slice(0, 160)),
    present: (Array.isArray(rawHud.present) ? rawHud.present : []).slice(0, 40).map(item => String(item).slice(0, 160)),
    stats: (Array.isArray(rawHud.stats) ? rawHud.stats : []).slice(0, 30).filter(row => row && typeof row === 'object').map(row => ({
      id: String(row.id || row.name || '').slice(0, 80), name: String(row.name || row.id || 'Stat').slice(0, 80),
      value: Number(row.value) || 0, min: Number(row.min) || 0, max: Number(row.max) || 0,
      color: String(row.color || '#E63946').slice(0, 24)
    })),
    quests: (Array.isArray(rawHud.quests) ? rawHud.quests : []).slice(0, 20).filter(row => row && typeof row === 'object').map(row => ({
      title: String(row.title || 'Quest').slice(0, 160), status: String(row.status || 'active').slice(0, 40)
    }))
  };
  const rawMeta = input.campaignMeta && typeof input.campaignMeta === 'object' ? input.campaignMeta : {};
  const rawSystem = rawMeta.system && typeof rawMeta.system === 'object' ? rawMeta.system : {};
  const campaignMeta = {
    id: String(rawMeta.id || '').slice(0, 100),
    name: String(rawMeta.name || input.experienceName || input.worldName || 'Shared campaign').slice(0, 120),
    system: { id: String(rawSystem.id || 'custom').slice(0, 60), name: String(rawSystem.name || 'Custom / system agnostic').slice(0, 120),
      resolution: String(rawSystem.resolution || 'Host adjudication').slice(0, 500), initiative: String(rawSystem.initiative || 'Round robin').slice(0, 120),
      die: String(rawSystem.die || rawSystem.dice || '').slice(0, 120), mode: String(rawSystem.mode || 'roll-over').slice(0, 40),
      target: Number(rawSystem.target) || 10,
      explode: Boolean(rawSystem.explode),
      progression: rawSystem.progression && typeof rawSystem.progression === 'object' ? {
        kind: String(rawSystem.progression.kind || 'xp').slice(0, 40), maxLevel: Math.max(1, Math.min(1000, Number(rawSystem.progression.maxLevel) || 20)),
        base: Math.max(1, Number(rawSystem.progression.base) || 100), curve: Math.max(0.1, Math.min(10, Number(rawSystem.progression.curve) || 1.4))
      } : { kind: String(rawSystem.progression || 'xp').slice(0, 40), maxLevel: 20, base: 100, curve: 1.4 },
      attributes: (Array.isArray(rawSystem.attributes) ? rawSystem.attributes : []).slice(0, 40).map(row => typeof row === 'string' ? String(row).slice(0, 80) : ({ id: String(row?.id || row?.name || '').slice(0, 60), name: String(row?.name || row?.id || '').slice(0, 80), base: Number(row?.base) || 0 })),
      skills: (Array.isArray(rawSystem.skills) ? rawSystem.skills : []).slice(0, 100).map(row => typeof row === 'string' ? String(row).slice(0, 80) : ({ id: String(row?.id || row?.name || '').slice(0, 60), name: String(row?.name || row?.id || '').slice(0, 80), attribute: String(row?.attribute || '').slice(0, 60), base: Number(row?.base) || 0 })),
      resources: (Array.isArray(rawSystem.resources) ? rawSystem.resources : []).slice(0, 40).map(row => ({ id: String(row?.id || '').slice(0, 60), name: String(row?.name || row?.id || '').slice(0, 80), min: Number(row?.min) || 0, max: Number(row?.max) || 0 })),
      slots: (Array.isArray(rawSystem.slots) ? rawSystem.slots : []).slice(0, 30).map(value => String(value).slice(0, 60)),
      rulesText: String(rawSystem.rulesText || '').slice(0, 4000) }
  };
  const result = {
    experienceType: type,
    experienceName: String(input.experienceName || input.worldName || 'Shared Session').slice(0, 120),
    worldName: String(input.experienceName || input.worldName || 'Shared Session').slice(0, 120),
    sessionName: String(input.sessionName || 'Shared Timeline').slice(0, 120),
    location: String(input.location || 'Unknown').slice(0, 160),
    turn: Math.max(0, Math.min(Number(input.turn) || 0, 1_000_000_000)),
    hud, campaignMeta, gameState: safeGameState(input.gameState),
    history: (Array.isArray(input.history) ? input.history : []).slice(-120).map(row => ({
      role: ['dm', 'user', 'system'].includes(row?.role) ? row.role : 'system',
      text: String(row?.text || '').slice(0, 12000), name: cleanName(row?.name, ''),
      ...(row?.rollId ? { rollId: String(row.rollId).slice(0, 100) } : {})
    })).filter(row => row.text)
  };
  for (const field of ['campaignStart', 'turnCheckpoint']) {
    const checkpoint = input[field];
    if (!checkpoint || typeof checkpoint !== 'object' || !checkpoint.gameState || typeof checkpoint.gameState !== 'object') continue;
    const core = safeSnapshot(Object.fromEntries(['history', 'hud', 'location', 'turn', 'gameState']
      .filter(key => key in checkpoint).map(key => [key, checkpoint[key]])));
    const cleaned = { history: core.history, turn: core.turn, gameState: core.gameState };
    for (const key of ['hud', 'location']) if (key in checkpoint) cleaned[key] = core[key];
    if (field === 'turnCheckpoint') {
      cleaned.historyLength = Math.max(0, Math.min(Number(checkpoint.historyLength) || 0, 120));
      cleaned.roomRoundNumber = Math.max(1, Math.min(Number(checkpoint.roomRoundNumber) || 1, 1_000_000_000));
      cleaned.submissions = (Array.isArray(checkpoint.submissions) ? checkpoint.submissions : []).slice(0, 12)
        .filter(row => row && typeof row === 'object' && row.submitted && row.text)
        .map(row => ({ playerId: String(row.playerId || '').slice(0, 100), name: cleanName(row.name, ''),
          submitted: true, text: String(row.text).slice(0, 2000) }));
    }
    result[field] = cleaned;
  }
  return result;
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      const code = roomCode();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const target = new URL('https://room/internal/create'); target.searchParams.set('code', code);
      const response = await stub.fetch(new Request(target, request));
      const payload = await response.json();
      return json({ ...payload, roomCode: code });
    }
    if (parts[0] === 'api' && parts[1] === 'rooms' && parts[2]) {
      const code = parts[2].toUpperCase();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const suffix = parts[3] || '';
      const target = new URL(request.url);
      target.hostname = 'room'; target.pathname = `/internal/${suffix}`;
      const response = await stub.fetch(new Request(target, request));
      const headers = new Headers(response.headers);
      Object.entries(CORS).forEach(([key, value]) => headers.set(key, value));
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.pathname === '/health') return json({ ok: true, service: 'Horde Studio Internet Rooms', protocol: 2 });
    return json({ error: 'Not found.' }, 404);
  }
};

export class HordeRoom {
  constructor(state) {
    this.state = state;
    this.room = null;
    this.pending = Promise.resolve();
    this.ready = this.state.blockConcurrencyWhile(async () => {
      this.room = await this.loadRoom();
    });
  }
  exclusive(work) {
    // Reading request bodies and awaiting storage can yield to another event.
    // Keep a create/join/commit transaction intact across those awaits.
    const operation = this.pending.then(work);
    this.pending = operation.catch(() => {});
    return operation;
  }
  async loadRoom() {
    const stored = await this.state.storage.get('room');
    if (!stored || stored.format !== 'horde-room-chunks-v1') return stored || null;
    if (!Number.isInteger(stored.count) || stored.count < 1 || stored.count > 1024
      || !Number.isInteger(stored.bytes) || stored.bytes < 1 || stored.bytes > 64 * 1024 * 1024) {
      throw new Error('Saved room manifest is damaged.');
    }
    const bytes = new Uint8Array(stored.bytes); let offset = 0;
    for (let index = 0; index < stored.count; index++) {
      const chunk = await this.state.storage.get(`room-chunk-${index}`);
      if (!(chunk instanceof Uint8Array) || offset + chunk.length > bytes.length) throw new Error('Saved room chunk is damaged.');
      bytes.set(chunk, offset); offset += chunk.length;
    }
    if (offset !== bytes.length) throw new Error('Saved room is incomplete.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  async save() {
    // A full room with portraits exceeds the single-value limit. Chunk UTF-8
    // bytes below the legacy 128 KiB limit and publish the manifest atomically.
    // https://developers.cloudflare.com/durable-objects/platform/limits/
    const bytes = new TextEncoder().encode(JSON.stringify(this.room));
    try {
      if (bytes.length > 64 * 1024 * 1024) throw new Error('Room exceeds the 64 MB storage limit. Reduce portrait sizes or campaign notes.');
      const size = 100 * 1024, count = Math.max(1, Math.ceil(bytes.length / size));
      await this.state.storage.transaction(async storage => {
        const previous = await storage.get('room');
        for (let start = 0; start < count; start += 128) {
          const entries = Object.fromEntries(Array.from({ length: Math.min(128, count - start) }, (_, index) => {
            const chunk = start + index;
            return [`room-chunk-${chunk}`, bytes.slice(chunk * size, (chunk + 1) * size)];
          }));
          await storage.put(entries);
        }
        for (let index = count; index < (previous?.format === 'horde-room-chunks-v1' ? previous.count : 0); index++) {
          await storage.delete(`room-chunk-${index}`);
        }
        await storage.put('room', { format: 'horde-room-chunks-v1', count, bytes: bytes.length });
      });
    } catch (error) {
      this.room = await this.loadRoom();
      throw error;
    }
  }
  players() { return Object.values(this.room?.players || {}).sort((a, b) => a.joinedAt - b.joinedAt); }
  advance() {
    const next = this.players().find(player => !this.room.round.submissions[player.id]);
    this.room.round.activePlayerId = next?.id || '';
    this.room.round.status = next ? 'collecting' : 'ready';
  }
  authenticate(data) {
    if (!this.room || Date.now() > this.room.expiresAt || data.inviteToken !== this.room.inviteToken) throw new Error('Room invite expired.');
    const player = Object.hasOwn(this.room.players, data.playerId) ? this.room.players[data.playerId] : null;
    if (!player || data.playerToken !== player.token) throw new Error('Player authentication failed.');
    player.lastSeen = Date.now();
    return player;
  }
  publishSnapshot(value) {
    const snapshot = safeSnapshot(value);
    for (const field of ['campaignStart', 'turnCheckpoint']) {
      if (field in this.room.snapshot) snapshot[field] = structuredClone(this.room.snapshot[field]);
      else delete snapshot[field];
    }
    const characters = snapshot.gameState.characters;
    for (const player of this.players()) {
      if (Object.hasOwn(characters, player.id)) player.sheet = safeSheet(characters[player.id]);
      characters[player.id] = structuredClone(player.sheet);
    }
    pruneInitiative(snapshot, this.players().map(player => player.id));
    this.room.snapshot = snapshot;
  }
  visibleSheet(sheet, playerId, viewer) {
    const visible = structuredClone(sheet);
    if (!viewer.isHost && playerId !== viewer.id) delete visible.notes;
    return visible;
  }
  visibleGameState(game, viewer) {
    const visible = structuredClone(game);
    for (const [playerId, sheet] of Object.entries(visible.characters || {})) {
      visible.characters[playerId] = this.visibleSheet(sheet, playerId, viewer);
    }
    if (!viewer.isHost) {
      for (const field of ['journal', 'clocks', 'rolls']) {
        if (Array.isArray(visible[field])) visible[field] = visible[field]
          .filter(row => !row || typeof row !== 'object' || (row.visibility || 'public') === 'public');
      }
      visible.transactions = [];
      for (const npc of Object.values(visible.npcs || {})) if (npc && typeof npc === 'object') delete npc.notes;
    }
    return visible;
  }
  publicState(viewer) {
    const submissions = this.room.round.submissions;
    const proposal = this.room.proposal;
    const snapshot = structuredClone(this.room.snapshot);
    snapshot.gameState = this.visibleGameState(snapshot.gameState || {}, viewer);
    for (const field of ['campaignStart', 'turnCheckpoint']) {
      if (snapshot[field]) snapshot[field].gameState = this.visibleGameState(snapshot[field].gameState || {}, viewer);
    }
    return {
      ok: true, roomCode: this.room.code, experienceType: this.room.experienceType,
      experienceName: this.room.experienceName, worldName: this.room.experienceName,
      sessionName: this.room.sessionName, revision: this.room.revision,
      isHost: viewer.isHost, hostPlayerId: this.room.hostPlayerId,
      permissions: viewer.isHost ? ['submit', 'vote', 'commit', 'resolve', 'close', 'sheet', 'roll', 'gm'] : ['submit', 'vote', 'sheet', 'roll'],
      players: this.players().map(player => ({ id: player.id, name: player.name,
        persona: player.persona, sheet: this.visibleSheet(player.sheet || {}, player.id, viewer), isHost: player.isHost, online: Date.now() - player.lastSeen < 45000 })),
      round: { number: this.room.round.number, status: this.room.round.status,
        activePlayerId: this.room.round.activePlayerId,
        submissions: this.players().map(player => ({ playerId: player.id, name: player.name,
          submitted: !!submissions[player.id], ...(viewer.isHost && submissions[player.id] ? { text: submissions[player.id].text } : {}) })) },
      proposal: proposal ? { id: proposal.id, type: proposal.type, label: proposal.label,
        status: proposal.status, yes: Object.values(proposal.votes).filter(Boolean).length,
        no: Object.values(proposal.votes).filter(value => !value).length,
        myVote: proposal.votes[viewer.id] } : null,
      snapshot
    };
  }
  broadcast() {
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(JSON.stringify({ event: 'room-updated', revision: this.room.revision })); } catch (_) {}
    }
  }
  tally() {
    const proposal = this.room.proposal;
    if (!proposal || proposal.status !== 'open') return;
    const votes = Object.values(proposal.votes);
    const majority = Math.floor(this.players().length / 2) + 1;
    if (votes.filter(Boolean).length >= majority) proposal.status = 'approved';
    else if (votes.filter(value => !value).length >= majority || votes.length >= this.players().length) proposal.status = 'rejected';
  }
  fetch(request) { return this.exclusive(() => this.handleFetch(request)); }
  async handleFetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === '/internal/create') {
      if (this.room) return json({ error: 'Room already exists.' }, 409);
      const body = await request.json(); const now = Date.now();
      const hostId = `player_${token(8)}`; const hostToken = token(); const inviteToken = token();
      const snap = safeSnapshot(body.snapshot);
      this.room = { code: String(url.searchParams.get('code') || body.roomCode || ''), inviteToken,
        experienceType: body.experienceType === 'chat' ? 'chat' : 'world',
        experienceName: cleanName(body.experienceName || body.worldName, snap.experienceName),
        sessionName: cleanName(body.sessionName, 'Shared Timeline'), hostPlayerId: hostId,
        createdAt: now, updatedAt: now, expiresAt: now + 86400000, revision: 1,
        players: { [hostId]: { id: hostId, token: hostToken, name: cleanName(body.displayName, 'Host'),
          persona: safePersona(body.persona), sheet: safeSheet(body.sheet), isHost: true, joinedAt: now, lastSeen: now } },
        round: { number: 1, status: 'collecting', submissions: {}, activePlayerId: hostId },
        proposal: null, snapshot: snap };
      this.room.snapshot.gameState ||= {}; this.room.snapshot.gameState.characters ||= {};
      this.room.snapshot.gameState.characters[hostId] = this.room.players[hostId].sheet;
      const resumedId = String(body.resumeCharacterId || '').slice(0, 100);
      if (resumedId && resumedId !== hostId) {
        this.room.snapshot = remapActor(this.room.snapshot, resumedId, hostId);
        this.room.snapshot.gameState.characters[hostId] = structuredClone(this.room.players[hostId].sheet);
      }
      pruneInitiative(this.room.snapshot, [hostId]);
      if (this.room.snapshot.campaignStart) {
        if (!Object.hasOwn(this.room.snapshot.campaignStart.gameState.characters, hostId)) {
          this.room.snapshot.campaignStart.gameState.characters[hostId] = structuredClone(this.room.players[hostId].sheet);
        }
      }
      await this.save(); await this.state.storage.setAlarm(this.room.expiresAt);
      return json({ ok: true, inviteToken, hostPlayerId: hostId, playerToken: hostToken });
    }
    if (url.pathname === '/internal/join' && request.method === 'POST') {
      if (!this.room || Date.now() > this.room.expiresAt) return json({ error: 'Room expired.' }, 410);
      const body = await request.json();
      if (body.inviteToken !== this.room.inviteToken) return json({ error: 'Invalid invite.' }, 403);
      if (this.players().length >= 12) return json({ error: 'Room is full.' }, 409);
      const now = Date.now(); const id = `player_${token(8)}`; const playerToken = token();
      this.room.players[id] = { id, token: playerToken, name: cleanName(body.displayName),
        persona: safePersona(body.persona), sheet: safeSheet(body.sheet), isHost: false, joinedAt: now, lastSeen: now };
      this.room.snapshot.gameState ||= {}; this.room.snapshot.gameState.characters ||= {};
      this.room.snapshot.gameState.characters[id] = this.room.players[id].sheet;
      if (this.room.snapshot.campaignStart && this.room.round.number === 1 && !this.room.snapshot.turnCheckpoint) {
        this.room.snapshot.campaignStart.gameState.characters[id] = structuredClone(this.room.players[id].sheet);
      }
      this.advance();
      this.room.revision++; await this.save(); this.broadcast();
      return json({ ok: true, playerId: id, playerToken });
    }
    if (url.pathname === '/internal/socket') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket required.' }, 426);
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return json({ error: 'Not found.' }, 404);
  }
  webSocketMessage(socket, message) { return this.exclusive(() => this.handleWebSocketMessage(socket, message)); }
  async handleWebSocketMessage(socket, message) {
    let data;
    try { data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); }
    catch (_) { return socket.send(JSON.stringify({ ok: false, error: 'Malformed message.' })); }
    const reply = (value, ok = true) => socket.send(JSON.stringify({ id: data.id, ok, ...(ok ? { data: value } : { error: value }) }));
    try {
      if (data.command === 'authenticate') {
        const player = this.authenticate(data); socket.serializeAttachment({ playerId: player.id });
        await this.save(); return reply(this.publicState(player));
      }
      const attachment = socket.deserializeAttachment();
      const player = this.authenticate({ ...data, playerId: attachment?.playerId });
      const body = data.payload || {};
      if (data.command === 'state' || data.command === 'heartbeat') return reply(this.publicState(player));
      if (data.command === 'submit') {
        if (this.room.round.status !== 'collecting' || this.room.round.activePlayerId !== player.id) throw new Error('Wait for your turn.');
        const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
        if (!text) throw new Error('Enter an action.');
        this.room.round.submissions[player.id] = { text, at: Date.now() }; this.advance();
      } else if (data.command === 'commit') {
        if (!player.isHost) throw new Error('Only the host can commit.');
        if (('expectedRevision' in body && body.expectedRevision !== this.room.revision)
          || ('expectedRoundNumber' in body && body.expectedRoundNumber !== this.room.round.number)) {
          throw new Error('The party changed while this turn was resolving. Refresh the room before retrying.');
        }
        if (this.room.round.status !== 'ready') throw new Error('Every player must submit first.');
        const previous = this.room.snapshot;
        const checkpoint = { history: structuredClone(previous.history), historyLength: previous.history.length,
          turn: previous.turn, gameState: structuredClone(previous.gameState), roomRoundNumber: this.room.round.number,
          submissions: Object.entries(this.room.round.submissions).map(([playerId, action]) => ({ playerId,
            name: this.room.players[playerId].name, submitted: true, text: action.text })) };
        for (const key of ['hud', 'location']) if (key in previous) checkpoint[key] = structuredClone(previous[key]);
        this.publishSnapshot(body.snapshot); this.room.snapshot.turnCheckpoint = checkpoint;
        this.room.round = { number: this.room.round.number + 1, status: 'collecting', submissions: {}, activePlayerId: this.players()[0].id };
        this.room.proposal = null;
      } else if (data.command === 'propose') {
        if (!['reroll', 'reset'].includes(body.type)) throw new Error('Unsupported vote.');
        if (this.room.proposal?.status === 'open') throw new Error('Finish the current vote first.');
        this.room.proposal = { id: `vote_${token(8)}`, type: body.type, label: String(body.label || body.type).slice(0, 120), status: 'open', votes: { [player.id]: true } }; this.tally();
      } else if (data.command === 'vote') {
        if (!this.room.proposal || this.room.proposal.id !== body.proposalId || this.room.proposal.status !== 'open') throw new Error('Vote is no longer active.');
        this.room.proposal.votes[player.id] = body.approve === true; this.tally();
      } else if (data.command === 'resolve') {
        if (!player.isHost || this.room.proposal?.status !== 'approved') throw new Error('Only the host can apply an approved vote.');
        if (('expectedRevision' in body && body.expectedRevision !== this.room.revision)
          || ('proposalId' in body && body.proposalId !== this.room.proposal.id)) throw new Error('The party or vote changed. Refresh the room before applying this decision.');
        const field = this.room.proposal.type === 'reroll' ? 'turnCheckpoint' : 'campaignStart';
        const checkpoint = this.room.snapshot[field];
        if (!checkpoint?.gameState) throw new Error('This campaign has no saved checkpoint for that decision. Start a new campaign to enable it.');
        const restored = { ...this.room.snapshot, ...structuredClone(checkpoint) };
        for (const key of ['historyLength', 'roomRoundNumber', 'submissions']) delete restored[key];
        this.publishSnapshot(restored); delete this.room.snapshot.turnCheckpoint;
        if (this.room.proposal.type === 'reroll') {
          this.room.round = { number: checkpoint.roomRoundNumber, status: 'ready', activePlayerId: '',
            submissions: Object.fromEntries(checkpoint.submissions.filter(row => Object.hasOwn(this.room.players, row.playerId))
              .map(row => [row.playerId, { text: row.text, at: Date.now() }])) };
          this.advance();
        } else {
          this.room.round = { number: 1, status: 'collecting', submissions: {}, activePlayerId: this.players()[0].id };
          for (const key of ['hud', 'location']) if (!(key in checkpoint)) delete this.room.snapshot[key];
        }
        this.room.proposal.status = 'applied';
      } else if (data.command === 'sheet') {
        const targetId = String(body.targetPlayerId || player.id);
        if (targetId !== player.id && !player.isHost) throw new Error("Only the host can edit another party member's sheet.");
        const target = Object.hasOwn(this.room.players, targetId) ? this.room.players[targetId] : null;
        if (!target) throw new Error('Party member not found.');
        target.sheet = safeSheet(body.sheet); this.room.snapshot.gameState ||= {}; this.room.snapshot.gameState.characters ||= {};
        this.room.snapshot.gameState.characters[targetId] = target.sheet;
      } else if (data.command === 'roll') {
        const sheet = player.sheet || {};
        const attribute = String(body.attribute || ''), skill = String(body.skill || '');
        const bonus = sheetCheckBonus(sheet, attribute, skill, body.bonus);
        const rules = this.room.snapshot?.gameState?.rules || {};
        let diceExpression = body.dice || rules.die || 'd20';
        if (rules.mode === 'success-pool' && !body.dice) {
          const sides = Number(String(rules.die || 'd6').match(/d(\d+)/i)?.[1] || 6);
          diceExpression = `${Math.max(1, Math.min(Math.floor(bonus), 40))}d${Math.max(2, Math.min(sides, 1000))}`;
        }
        const rolled = rollDice(diceExpression);
        let explosions = 0; const parsed = rolled.expression.match(/^(\d+)d(\d+)/);
        if (rules.explode && Number(parsed?.[1]) === 1) {
          const sides = Number(parsed[2]); let last = rolled.dice[rolled.dice.length - 1];
          while (last === sides && explosions < 10) { const bytes = crypto.getRandomValues(new Uint32Array(1)); last = 1 + (bytes[0] % sides); rolled.dice.push(last); rolled.total += last; explosions++; }
        }
        const difficulty = Number(body.difficulty || rules.target || 10); const result = { id: `roll_${token(8)}`, at: Date.now(), ...rolled,
          bonus, total: rolled.total + bonus, difficulty,
          label: String(body.label || 'Check').slice(0, 120), playerId: player.id, attribute: attribute.slice(0, 80),
          skill: skill.slice(0, 80), visibility: 'public' };
        if (explosions) result.explosions = explosions;
        if (rules.mode === 'success-pool') { result.poolSize = rolled.dice.length; result.total = rolled.dice.reduce((sum, value) => sum + value, 0); result.successes = rolled.dice.filter(value => value >= difficulty).length; result.success = result.successes >= Number(body.required || 1); }
        else if (rules.mode === 'bands') result.outcome = result.total >= 10 ? 'strong' : result.total >= 7 ? 'mixed' : 'complication';
        else { result.success = result.total >= difficulty;
          if (Number(parsed?.[1]) === 1 && Number(parsed?.[2]) === 20) { result.critical = rolled.dice[0] === 20; result.fumble = rolled.dice[0] === 1; if (result.critical) result.success = true; if (result.fumble) result.success = false; }
        }
        this.room.snapshot.gameState ||= {}; this.room.snapshot.gameState.rolls ||= [];
        this.room.snapshot.gameState.rolls.push(result); this.room.snapshot.gameState.rolls = this.room.snapshot.gameState.rolls.slice(-200);
        const rollText = rules.mode === 'success-pool'
          ? `${player.name} — ${result.label}: ${result.poolSize} dice [${result.dice.join(', ')}] · ${result.successes} successes · ${result.success ? 'SUCCESS' : 'FAILURE'}`
          : `${player.name} — ${result.label}: ${result.expression} [${result.dice.join(', ')}] + ${bonus} = ${result.total} · ${result.outcome || (result.success ? 'SUCCESS' : 'FAILURE')}`;
        this.room.snapshot.history ||= []; this.room.snapshot.history.push({ role: 'system', name: 'DICE', rollId: result.id, text: rollText });
        this.room.snapshot.history = this.room.snapshot.history.slice(-120);
      } else if (data.command === 'gm') {
        if (!player.isHost) throw new Error('Only the host can publish authoritative campaign state.');
        if ('expectedRevision' in body && body.expectedRevision !== this.room.revision) throw new Error('The party changed while editing. Refresh the room before retrying.');
        this.publishSnapshot(body.snapshot);
      } else if (data.command === 'close') {
        if (!player.isHost) throw new Error('Only the host can close the room.');
        await this.state.storage.deleteAll(); this.room = null; reply({ ok: true });
        for (const peer of this.state.getWebSockets()) try { peer.close(1000, 'Room closed'); } catch (_) {}
        return;
      } else throw new Error('Unknown command.');
      this.room.updatedAt = Date.now(); this.room.revision++; await this.save(); this.broadcast();
      return reply({ ok: true, revision: this.room.revision });
    } catch (error) { return reply(error.message || 'Room request failed.', false); }
  }
  async webSocketClose() {}
  async webSocketError() {}
  alarm() { return this.exclusive(() => this.expire()); }
  async expire() {
    this.room = null; await this.state.storage.deleteAll();
    for (const socket of this.state.getWebSockets()) try { socket.close(1000, 'Room expired'); } catch (_) {}
  }
}
