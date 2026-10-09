/* Horde Studio Multiplayer Engine
 * Deterministic, system-agnostic campaign state. The language models propose;
 * this module validates, resolves and commits. No provider is authoritative.
 */
(function () {
    'use strict';

    const VERSION = 3;
    const Shared = window.HordeRpgMechanics;
    if (!Shared) throw new Error('rpg-mechanics.js must load before multiplayer-engine.js');
    const clone = value => JSON.parse(JSON.stringify(value ?? null));
    const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
    const id = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    const text = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

    const PACKS = Object.freeze({
        custom: {
            id: 'custom', name: 'Custom / system agnostic', die: 'd20', mode: 'roll-over', target: 10,
            attributes: ['Might', 'Agility', 'Mind', 'Presence'], skills: ['Athletics', 'Notice', 'Influence', 'Survival'],
            resources: [{ id: 'health', name: 'Health', max: 10, emptyStatus: 'Incapacitated' }, { id: 'resolve', name: 'Resolve', max: 6 }],
            slots: ['body', 'hands', 'accessory'], progression: { kind: 'milestone', maxLevel: 20 },
            resolution: 'Roll a d20 plus attribute and skill against a difficulty.', initiative: 'Flexible rounds'
        },
        d20: {
            id: 'd20', name: 'D20 fantasy', die: 'd20', mode: 'roll-over', target: 10,
            attributes: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'],
            skills: ['Acrobatics', 'Arcana', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Persuasion', 'Stealth', 'Survival'],
            resources: [{ id: 'hp', name: 'HP', max: 12, emptyStatus: 'Unconscious' }, { id: 'armor', name: 'Armor', max: 10 }, { id: 'focus', name: 'Focus', max: 3 }],
            slots: ['head', 'body', 'main-hand', 'off-hand', 'accessory'], progression: { kind: 'xp', maxLevel: 20, base: 300, curve: 1.45 },
            resolution: 'Roll d20 + attribute + skill versus difficulty. Natural 20/1 are critical.', initiative: 'Initiative or flexible rounds'
        },
        'cyberpunk-d10': {
            id: 'cyberpunk-d10', name: 'Cyberpunk D10', die: 'd10', mode: 'roll-over', target: 13, explode: true,
            attributes: ['Intelligence', 'Reflexes', 'Dexterity', 'Technique', 'Cool', 'Will', 'Luck', 'Movement', 'Body', 'Empathy'],
            skills: ['Athletics', 'Brawling', 'Concentration', 'Conversation', 'Cybertech', 'Evasion', 'Handgun', 'Perception', 'Persuasion', 'Stealth', 'Streetwise', 'Weapons Tech'],
            resources: [{ id: 'hp', name: 'HP', max: 35, emptyStatus: 'Mortally wounded' }, { id: 'armor', name: 'Armor SP', max: 11 }, { id: 'humanity', name: 'Humanity', max: 50 }, { id: 'luck', name: 'Luck', max: 5 }],
            slots: ['head', 'body', 'weapon-1', 'weapon-2', 'cyberware', 'quickslot'], progression: { kind: 'points', maxLevel: 10 },
            resolution: 'Roll d10 + stat + skill versus difficulty; critical dice explode.', initiative: 'Reflexes + d10 initiative'
        },
        'dice-pool': {
            id: 'dice-pool', name: 'Dice pool', die: 'd6', mode: 'success-pool', target: 5,
            attributes: ['Body', 'Finesse', 'Intellect', 'Heart'], skills: ['Fight', 'Move', 'Know', 'Notice', 'Survive', 'Sway'],
            resources: [{ id: 'health', name: 'Health', max: 6, emptyStatus: 'Incapacitated' }, { id: 'stress', name: 'Stress', max: 6, fullStatus: 'Overwhelmed' }, { id: 'momentum', name: 'Momentum', max: 3 }],
            slots: ['worn', 'held', 'utility'], progression: { kind: 'milestone', maxLevel: 12 },
            resolution: 'Roll a pool of d6; every die at or above 5 is a success.', initiative: 'Spotlight order'
        },
        narrative: {
            id: 'narrative', name: 'Narrative / fiction first', die: '2d6', mode: 'bands', target: 7,
            attributes: ['Force', 'Grace', 'Reason', 'Heart'], skills: ['Act', 'Connect', 'Investigate', 'Resist'],
            resources: [{ id: 'harm', name: 'Harm', max: 5, inverse: true, fullStatus: 'Taken out' }, { id: 'drive', name: 'Drive', max: 5 }],
            slots: ['signature', 'worn', 'carried'], progression: { kind: 'milestone', maxLevel: 10 },
            resolution: 'Roll 2d6 plus a trait: 10+ strong hit, 7–9 mixed result, 6- complication.', initiative: 'Conversation spotlight'
        }
    });

    function pack(packId, custom = {}) {
        const base = PACKS[packId] || PACKS.custom;
        return { ...clone(base), ...clone(custom), id: base.id,
            mechanicsMode: Shared.mode(custom.mechanicsMode ?? base.mechanicsMode, base.id === 'narrative' ? 'light' : 'full'),
            attributes: [...(custom.attributes || base.attributes)], skills: [...(custom.skills || base.skills)],
            resources: clone(custom.resources || base.resources), slots: [...(custom.slots || base.slots)] };
    }

    function resourceMap(definitions) {
        return Object.fromEntries((definitions || []).map(def => [def.id, {
            id: def.id, name: def.name, value: Number(def.start ?? def.max), max: Number(def.max || 10), min: Number(def.min || 0), inverse: !!def.inverse,
            emptyStatus: text(def.emptyStatus, 100), fullStatus: text(def.fullStatus, 100)
        }]));
    }

    function syncResourceStatuses(sheet) {
        const resources = Object.values(sheet.resources || {});
        const automaticNames = new Set(resources.flatMap(resource => [resource.emptyStatus, resource.fullStatus]).filter(Boolean));
        sheet.conditions = (sheet.conditions || []).filter(entry => !automaticNames.has(entry?.name || entry));
        const active = [];
        resources.forEach(resource => {
            const statusName = resource.emptyStatus && resource.value <= resource.min ? resource.emptyStatus
                : resource.fullStatus && resource.value >= resource.max ? resource.fullStatus : '';
            if (!statusName) return;
            active.push(statusName);
            sheet.conditions.push(effect({ name: statusName, kind: 'condition', duration: -1, timing: 'permanent', description: `Automatically derived from ${resource.name}.` }));
        });
        if (active.length) sheet.status = active[0];
        else if (automaticNames.has(sheet.status)) sheet.status = 'ready';
        else sheet.status ||= 'ready';
    }

    function createSheet(rules, persona = {}, name = 'Adventurer') {
        const system = pack(rules?.id, rules);
        return {
            schemaVersion: VERSION, characterId: id('pc'), name: text(persona.name || name, 80), pronouns: text(persona.pronouns, 60),
            archetype: text(persona.archetype || persona.class || '', 100), ancestry: text(persona.ancestry || '', 100), background: text(persona.background || '', 500),
            portrait: text(persona.image || persona.avatar || '', 2000000), publicIdentity: text(persona.publicIdentity, 700),
            reputation: text(persona.reputation, 700), appearance: text(persona.appearance, 1000),
            level: 1, xp: 0, advancement: 0, attributes: Object.fromEntries(system.attributes.map(key => [key, 0])),
            skills: Object.fromEntries(system.skills.map(key => [key, 0])), resources: resourceMap(system.resources),
            defenses: {}, conditions: [], effects: [], inventory: [], equipment: Object.fromEntries(system.slots.map(slot => [slot, null])),
            abilities: [], perks: [], currencies: {}, notes: '', location: '', status: 'ready', revision: 1
        };
    }

    function createState(rules, snapshot = {}) {
        return {
            schemaVersion: VERSION, revision: 1, phase: 'free-play', scene: {
                name: text(snapshot?.hud?.location?.name || snapshot.location || 'Opening scene', 160),
                description: text(snapshot?.hud?.location?.description || '', 1600), locationId: '', regionId: '', round: 1,
                clock: text(snapshot?.hud?.clock, 120), weather: text(snapshot?.hud?.weather, 120)
            }, rules: pack(rules?.id, rules), characters: {}, npcs: {}, encounters: [], quests: clone(snapshot?.hud?.quests || []),
            clocks: [], sharedInventory: [], journal: [], rolls: [], transactions: [], lastReceiptId: '', updatedAt: Date.now()
        };
    }

    function migrateCampaign(campaign) {
        if (!campaign || typeof campaign !== 'object') return campaign;
        campaign.system = pack(campaign.system?.id, campaign.system);
        campaign.snapshot ||= {};
        campaign.gameState ||= clone(campaign.snapshot.gameState) || createState(campaign.system, campaign.snapshot);
        campaign.gameState.rules = pack(campaign.system.id, campaign.gameState.rules || campaign.system);
        campaign.gameState.characters ||= {};
        campaign.gameState.npcs ||= {};
        campaign.gameState.quests ||= [];
        campaign.gameState.journal ||= [];
        campaign.gameState.sharedInventory ||= [];
        campaign.gameState.transactions ||= [];
        campaign.gameState.rolls ||= [];
        campaign.gameState.clocks ||= [];
        campaign.gameState.encounters ||= [];
        campaign.gameState.schemaVersion = VERSION;
        (campaign.players || []).forEach(player => {
            // The game state is canonical. Roster sheets may be an older room
            // snapshot, especially immediately after a committed turn or reload.
            // Only use them to seed characters absent from legacy campaigns.
            player.sheet = normalizeSheet(campaign.gameState.characters[player.id] || player.sheet,
                campaign.system, player.persona, player.name);
            campaign.gameState.characters[player.id] = clone(player.sheet);
        });
        campaign.snapshot.gameState = clone(campaign.gameState);
        return campaign;
    }

    function normalizeSheet(sheet, rules, persona, name) {
        const created = createSheet(rules, persona, name);
        if (!sheet || typeof sheet !== 'object') return created;
        sheet = clone(sheet);
        const merged = { ...created, ...sheet };
        merged.resources = { ...created.resources, ...(sheet.resources || {}) };
        merged.attributes = { ...created.attributes, ...(sheet.attributes || {}) };
        merged.skills = { ...created.skills, ...(sheet.skills || {}) };
        merged.equipment = { ...created.equipment, ...(sheet.equipment || {}) };
        merged.conditions = Array.isArray(sheet.conditions) ? sheet.conditions : [];
        merged.effects = Array.isArray(sheet.effects) ? sheet.effects : [];
        merged.inventory = Shared.normalizeInventory(sheet.inventory);
        const validIds = new Set(merged.inventory.map(entry => entry.id));
        Object.keys(merged.equipment).forEach(slot => {
            if (merged.equipment[slot] && !validIds.has(merged.equipment[slot])) merged.equipment[slot] = null;
        });
        return merged;
    }

    function parseDice(expression) {
        const match = String(expression || '').trim().toLowerCase().match(/^(\d{0,2})d(\d{1,4})(?:\s*([+-])\s*(\d+))?$/);
        if (!match) throw new Error('Use dice notation such as d20, 2d6+3, or 4d10-1.');
        return { count: clamp(Number(match[1] || 1), 1, 40), sides: clamp(Number(match[2]), 2, 1000), modifier: (match[3] === '-' ? -1 : 1) * Number(match[4] || 0) };
    }

    function roll(expression, options = {}) {
        const parsed = parseDice(expression); const dice = [];
        for (let index = 0; index < parsed.count; index++) dice.push(1 + Math.floor(Math.random() * parsed.sides));
        const total = dice.reduce((sum, value) => sum + value, 0) + parsed.modifier;
        return { id: id('roll'), at: Date.now(), expression: `${parsed.count}d${parsed.sides}${parsed.modifier ? (parsed.modifier > 0 ? '+' : '') + parsed.modifier : ''}`,
            dice, modifier: parsed.modifier, total, label: text(options.label || 'Roll', 120), playerId: text(options.playerId, 100), visibility: options.visibility === 'gm' ? 'gm' : 'public' };
    }

    function check(state, playerId, spec = {}) {
        if (Shared.mode(state?.rules?.mechanicsMode) === 'off') throw new Error('Mechanical checks are disabled for this campaign.');
        const sheet = state.characters[playerId] || state.npcs?.[playerId]; if (!sheet) throw new Error('Character sheet not found.');
        const rules = state.rules; const attribute = Number(sheet.attributes?.[spec.attribute] || 0); const skill = Number(sheet.skills?.[spec.skill] || 0);
        const activeEffects = [...(sheet.effects || []), ...(sheet.conditions || []).filter(entry => typeof entry === 'object')];
        const effectBonus = activeEffects.reduce((sum, entry) => {
            const stacks = clamp(entry.stacks || 1, 1, 99);
            return sum + stacks * (Number(entry.modifiers?.checks || 0)
                + Number(entry.modifiers?.attributes?.[spec.attribute] || 0) + Number(entry.modifiers?.skills?.[spec.skill] || 0));
        }, 0);
        const gear = Shared.combinedModifiers(Shared.equippedItems(sheet));
        const equipmentBonus = Number(gear.checks || 0)
            + Number(gear.attributes?.[spec.attribute] || 0) + Number(gear.skills?.[spec.skill] || 0);
        const bonus = Number(spec.bonus || 0) + attribute + skill + effectBonus + equipmentBonus;
        let expression = spec.dice || rules.die || 'd20';
        if (rules.mode === 'success-pool' && !spec.dice) {
            const die = parseDice(rules.die || 'd6');
            const poolSize = clamp(Math.max(1, bonus), 1, 40);
            expression = `${poolSize}d${die.sides}`;
        }
        const result = roll(expression, { playerId, label: spec.label || `${spec.skill || spec.attribute || 'Action'} check`, visibility: spec.visibility });
        const parsedExpression = parseDice(expression);
        if (rules.explode && parsedExpression.count === 1) {
            result.explosions = 0;
            let last = result.dice[result.dice.length - 1];
            while (last === parsedExpression.sides && result.explosions < 10) {
                last = 1 + Math.floor(Math.random() * parsedExpression.sides);
                result.dice.push(last); result.total += last; result.explosions++;
            }
        }
        result.attribute = spec.attribute || ''; result.skill = spec.skill || ''; result.bonus = bonus;
        result.effectBonus = effectBonus; result.equipmentBonus = equipmentBonus; result.total += bonus;
        const difficulty = Number(spec.difficulty ?? rules.target ?? 10); result.difficulty = difficulty;
        if (rules.mode === 'success-pool') {
            result.poolSize = result.dice.length; result.total = result.dice.reduce((sum, value) => sum + value, 0);
            result.successes = result.dice.filter(value => value >= difficulty).length; result.success = result.successes >= Number(spec.required || 1);
        }
        else if (rules.mode === 'bands') result.outcome = result.total >= 10 ? 'strong' : result.total >= 7 ? 'mixed' : 'complication';
        else {
            result.success = result.total >= difficulty;
            if (parsedExpression.count === 1 && parsedExpression.sides === 20) {
                result.critical = result.dice[0] === 20; result.fumble = result.dice[0] === 1;
                if (result.critical) result.success = true; if (result.fumble) result.success = false;
            }
        }
        state.rolls.push(result); state.rolls = state.rolls.slice(-200); return result;
    }

    function item(value) {
        return Shared.normalizeItem(value);
    }

    function effect(value) {
        return { id: text(value?.id, 100) || id('fx'), name: text(value?.name || 'Effect', 100), kind: ['buff', 'debuff', 'condition'].includes(value?.kind) ? value.kind : 'condition',
            description: text(value?.description, 500), stacks: clamp(value?.stacks || 1, 1, 99), duration: clamp(value?.duration ?? -1, -1, 9999),
            timing: ['turn', 'round', 'scene', 'permanent'].includes(value?.timing) ? value.timing : 'round', modifiers: Shared.modifiers(value?.modifiers || {}) };
    }

    function levelThreshold(rules, level) {
        const progression = rules.progression || {};
        return progression.kind === 'xp' ? Math.round((progression.base || 100) * Math.pow(Math.max(1, level), progression.curve || 1.4)) : 1;
    }

    function applyOperation(state, operation) {
        const op = operation || {}; const sheet = state.characters[op.playerId] || state.npcs?.[op.playerId];
        const mechanicsEnabled = Shared.mode(state?.rules?.mechanicsMode) !== 'off';
        const mechanicalTypes = new Set(['resource', 'attribute', 'skill', 'defense', 'effect-add', 'effect-remove', 'condition-add',
            'condition-remove', 'equip', 'unequip', 'xp', 'advancement-spend', 'encounter-start', 'encounter-end', 'initiative', 'initiative-next']);
        // Off is a reversible pause. Inventory, story, locations and journals keep
        // working, while numerical mutations are ignored and retained data is not erased.
        if (!mechanicsEnabled && mechanicalTypes.has(op.type)) return;
        for (const key of ['set', 'delta', 'max', 'quantity', 'cost', 'round']) {
            if (op[key] !== undefined && !Number.isFinite(Number(op[key]))) throw new Error(`Invalid numerical state operation ${key}.`);
        }
        if (!['scene', 'clock', 'quest', 'journal', 'shared-inventory-add', 'shared-inventory-remove', 'encounter-start', 'encounter-end', 'initiative', 'initiative-next', 'npc-add', 'npc-remove'].includes(op.type) && !sheet) throw new Error(`Unknown character ${op.playerId}.`);
        switch (op.type) {
            case 'resource': { const res = sheet.resources?.[op.resource]; if (!res) throw new Error(`Unknown resource ${op.resource}.`); res.value = clamp(op.set ?? (res.value + Number(op.delta || 0)), res.min ?? 0, res.max); syncResourceStatuses(sheet); break; }
            case 'attribute': if (!(op.key in sheet.attributes)) throw new Error(`Unknown attribute ${op.key}.`); else sheet.attributes[op.key] = clamp(op.set ?? (sheet.attributes[op.key] + Number(op.delta || 0)), -20, 100); break;
            case 'skill': if (!(op.key in sheet.skills)) throw new Error(`Unknown skill ${op.key}.`); else sheet.skills[op.key] = clamp(op.set ?? (sheet.skills[op.key] + Number(op.delta || 0)), -20, 100); break;
            case 'defense': sheet.defenses[text(op.key, 80)] = clamp(op.set ?? (Number(sheet.defenses?.[op.key] || 0) + Number(op.delta || 0)), -100, 10000); break;
            case 'currency': sheet.currencies[text(op.key, 80)] = Math.max(0, Number(op.set ?? (Number(sheet.currencies?.[op.key] || 0) + Number(op.delta || 0)))); break;
            case 'effect-add': { const incoming = effect(op.effect); const existing = sheet.effects.find(entry => entry.name?.toLowerCase() === incoming.name.toLowerCase() && entry.kind === incoming.kind);
                if (existing) { existing.stacks = clamp(Number(existing.stacks || 1) + Number(incoming.stacks || 1), 1, 99); existing.duration = existing.duration < 0 || incoming.duration < 0 ? -1 : Math.max(existing.duration, incoming.duration); existing.modifiers = {
                    ...(existing.modifiers || {}), ...(incoming.modifiers || {}),
                    attributes: { ...(existing.modifiers?.attributes || {}), ...(incoming.modifiers?.attributes || {}) },
                    skills: { ...(existing.modifiers?.skills || {}), ...(incoming.modifiers?.skills || {}) }
                }; if (incoming.description) existing.description = incoming.description; }
                else sheet.effects.push(incoming); break; }
            case 'effect-remove': sheet.effects = sheet.effects.filter(entry => entry.id !== op.effectId && entry.name.toLowerCase() !== text(op.name).toLowerCase()); break;
            case 'condition-add': if (!sheet.conditions.some(entry => (entry.name || entry).toLowerCase() === text(op.name).toLowerCase())) sheet.conditions.push(effect({ ...op, kind: 'condition' })); break;
            case 'condition-remove': sheet.conditions = sheet.conditions.filter(entry => (entry.name || entry).toLowerCase() !== text(op.name).toLowerCase()); break;
            case 'inventory-add': { const incoming = item(op.item); const existing = sheet.inventory.find(entry => entry.id === incoming.id || (entry.name.toLowerCase() === incoming.name.toLowerCase() && !entry.equipped)); if (existing) existing.quantity = clamp(Number(existing.quantity || 0) + incoming.quantity, 0, 9999); else sheet.inventory.push(incoming); break; }
            case 'inventory-remove': { const found = sheet.inventory.find(entry => entry.id === op.itemId || entry.name.toLowerCase() === text(op.name).toLowerCase()); if (found) { found.quantity -= clamp(op.quantity || found.quantity, 1, 9999); if (found.quantity <= 0) sheet.inventory = sheet.inventory.filter(entry => entry !== found); } break; }
            case 'shared-inventory-add': { const incoming = item(op.item); const existing = state.sharedInventory.find(entry => entry.id === incoming.id || entry.name.toLowerCase() === incoming.name.toLowerCase()); if (existing) existing.quantity = clamp(Number(existing.quantity || 0) + incoming.quantity, 0, 9999); else state.sharedInventory.push(incoming); break; }
            case 'shared-inventory-remove': { const found = state.sharedInventory.find(entry => entry.id === op.itemId || entry.name.toLowerCase() === text(op.name).toLowerCase()); if (found) { found.quantity -= clamp(op.quantity || found.quantity, 1, 9999); if (found.quantity <= 0) state.sharedInventory = state.sharedInventory.filter(entry => entry !== found); } break; }
            case 'equip': { const found = sheet.inventory.find(entry => entry.id === op.itemId); if (!found) throw new Error('Item is not in inventory.');
                const validation = Shared.validateEquip(sheet, found, op.slot); if (!validation.ok) throw new Error(validation.reason);
                const slot = validation.slot; const prior = sheet.equipment[slot]; if (prior) { const old = sheet.inventory.find(entry => entry.id === prior); if (old) old.equipped = false; }
                sheet.equipment[slot] = found.id; found.equipped = true; found.slot = slot; break; }
            case 'unequip': { const prior = sheet.equipment[op.slot]; const found = sheet.inventory.find(entry => entry.id === prior); if (found) found.equipped = false; sheet.equipment[op.slot] = null; break; }
            case 'xp': { const gain = Number(op.delta || 0); const progression = state.rules.progression || {};
                if (progression.kind === 'points') sheet.advancement = Math.max(0, sheet.advancement + gain);
                else if (progression.kind === 'milestone') { if (gain > 0 && sheet.level < (progression.maxLevel || 20)) { const levels = Math.min((progression.maxLevel || 20) - sheet.level, Math.max(1, Math.floor(gain))); sheet.level += levels; sheet.advancement += levels; } }
                else { sheet.xp = Math.max(0, sheet.xp + gain); while (sheet.level < (progression.maxLevel || 20) && sheet.xp >= levelThreshold(state.rules, sheet.level)) { sheet.xp -= levelThreshold(state.rules, sheet.level); sheet.level++; sheet.advancement++; } } break; }
            case 'advancement-spend': { const cost = clamp(op.cost || 1, 1, 100); if (sheet.advancement < cost) throw new Error('Not enough advancement points.');
                const group = op.group === 'attribute' ? 'attributes' : 'skills'; if (!(op.key in sheet[group])) throw new Error(`Unknown ${op.group || 'skill'} ${op.key}.`);
                sheet[group][op.key] = clamp(sheet[group][op.key] + Number(op.delta || 1), -20, 100); sheet.advancement -= cost; break; }
            case 'location': sheet.location = text(op.location, 160); break;
            case 'scene': state.scene = { ...state.scene, ...(op.patch || {}) }; break;
            case 'clock': { let clock = state.clocks.find(entry => entry.id === op.clockId || entry.name === op.name); if (!clock) { clock = { id: op.clockId || id('clock'), name: text(op.name || 'Clock', 100), value: 0, max: clamp(op.max || 6, 1, 100), visibility: op.visibility || 'public' }; state.clocks.push(clock); } clock.value = clamp(op.set ?? clock.value + Number(op.delta || 0), 0, clock.max); break; }
            case 'quest': { let quest = state.quests.find(entry => entry.id === op.questId || (op.title && entry.title === op.title));
                if (!quest) { quest = { id: op.questId || id('quest'), title: text(op.title || 'Quest', 160), status: 'active', description: '' }; state.quests.push(quest); }
                if (op.title) quest.title = text(op.title, 160); if (op.status) quest.status = text(op.status, 40); if (op.description) quest.description = text(op.description, 800); break; }
            case 'journal': state.journal.push({ id: id('note'), at: Date.now(), text: text(op.text, 2000), visibility: op.visibility || 'public' }); break;
            case 'npc-add': { const npcId = text(op.npcId, 100) || id('npc'); const npc = normalizeSheet(op.sheet, state.rules, {}, op.name || 'NPC'); npc.characterId = npcId;
                npc.status = text(op.status || 'active', 40); state.npcs[npcId] = npc; break; }
            case 'npc-remove': delete state.npcs[text(op.npcId, 100)]; break;
            case 'encounter-start': state.encounters = [{ id: op.id || id('encounter'), name: text(op.name || 'Encounter', 140),
                status: 'active', round: 1, turn: 0, initiative: Array.isArray(op.initiative) ? op.initiative.filter(actorId => state.characters[actorId] || state.npcs[actorId]).slice(0, 80) : [], notes: text(op.notes, 1200), startedAt: Date.now() }]; state.phase = 'encounter'; break;
            case 'encounter-end': if (state.encounters[0]) state.encounters[0].status = 'complete'; state.phase = 'free-play'; break;
            case 'initiative': { const encounter = state.encounters.find(entry => entry.status === 'active'); if (!encounter) throw new Error('No active encounter.');
                encounter.initiative = Array.isArray(op.order) ? op.order.filter(actorId => state.characters[actorId] || state.npcs[actorId]).slice(0, 80) : [];
                encounter.turn = 0; encounter.round = Math.max(1, Number(op.round || encounter.round || 1)); break; }
            case 'initiative-next': { const encounter = state.encounters.find(entry => entry.status === 'active'); if (!encounter) throw new Error('No active encounter.');
                if (encounter.initiative.length) { encounter.turn = (Number(encounter.turn || 0) + 1) % encounter.initiative.length; if (encounter.turn === 0) encounter.round = Number(encounter.round || 1) + 1; } break; }
            default: throw new Error(`Unsupported state operation ${op.type}.`);
        }
        if (sheet) sheet.revision = Number(sheet.revision || 0) + 1;
    }

    function tickEffects(state) {
        [...Object.values(state.characters || {}), ...Object.values(state.npcs || {})].forEach(sheet => {
            sheet.effects = (sheet.effects || []).filter(entry => {
                if (entry.timing === 'permanent' || entry.duration < 0) return true;
                entry.duration -= 1; return entry.duration > 0;
            });
            sheet.conditions = (sheet.conditions || []).filter(entry => typeof entry === 'string' || entry.timing === 'permanent' || entry.duration < 0 || --entry.duration > 0);
        });
    }

    function applyReceipt(state, receipt, actor = 'host') {
        const next = clone(state); const expected = Number(receipt?.baseRevision ?? state.revision);
        if (expected !== Number(state.revision)) throw new Error(`Stale turn receipt: expected revision ${state.revision}, received ${expected}.`);
        const operations = Array.isArray(receipt?.operations) ? receipt.operations.slice(0, 100) : [];
        // Checks use the state that existed during the declared action. Existing
        // round effects then expire, and newly established consequences begin at
        // their full duration instead of losing a round immediately.
        (receipt?.checks || []).slice(0, 30).forEach(spec => check(next, spec.playerId, spec));
        // Mechanical maintenance is tied to an actual resolved turn.  Sheet edits,
        // campaign setup and GM corrections must not consume buffs or advance time.
        if (receipt?.advanceRound !== false) {
            if (Shared.mode(next.rules?.mechanicsMode || 'full') !== 'off') tickEffects(next);
            next.scene.round = Number(next.scene.round || 0) + 1;
        }
        operations.forEach(op => applyOperation(next, op));
        next.revision++; next.updatedAt = Date.now();
        const transaction = { id: text(receipt?.id, 100) || id('tx'), at: Date.now(), actor, baseRevision: state.revision, revision: next.revision,
            summary: text(receipt?.summary || receipt?.narration || 'Turn resolved', 500), operations: clone(operations), checks: clone(receipt?.checks || []) };
        next.transactions.push(transaction); next.transactions = next.transactions.slice(-500); next.lastReceiptId = transaction.id;
        return { state: next, transaction };
    }

    function applyReceiptRecovering(state, receipt, actor = 'host') {
        const accepted = [], rejected = [];
        (Array.isArray(receipt?.operations) ? receipt.operations : []).slice(0, 100).forEach(operation => {
            const probe = clone(state);
            try { accepted.forEach(entry => applyOperation(probe, entry)); applyOperation(probe, operation); accepted.push(operation); }
            catch (error) { rejected.push({ operation: clone(operation), reason: error.message }); }
        });
        const checkAccepted = [], checkRejected = [];
        (Array.isArray(receipt?.checks) ? receipt.checks : []).slice(0, 30).forEach(spec => {
            const probe = clone(state);
            // Checks are resolved against the pre-transaction state in applyReceipt.
            // Validate against that same state so a model cannot create a stat/NPC and
            // use it retroactively in the check that supposedly preceded the change.
            try { check(probe, spec.playerId, spec); checkAccepted.push(spec); }
            catch (error) { checkRejected.push({ check: clone(spec), reason: error.message }); }
        });
        const applied = applyReceipt(state, { ...receipt, operations: accepted, checks: checkAccepted }, actor);
        applied.rejected = [...rejected, ...checkRejected];
        return applied;
    }

    function promptState(state, players) {
        const characters = (players || []).map(player => {
            const sheet = state.characters[player.id]; if (!sheet) return null;
            const resources = Object.values(sheet.resources || {}).map(r => `${r.name} ${r.value}/${r.max}`).join(', ');
            const equipment = Object.entries(sheet.equipment || {}).filter(([, value]) => value).map(([slot, value]) => `${slot}:${sheet.inventory.find(i => i.id === value)?.name || value}`).join(', ');
            return `${player.id} | ${player.name} | Level ${sheet.level} (${sheet.xp} XP; ${sheet.advancement} advancement) | ${resources || 'no resources'} | status: ${sheet.status || 'ready'} | effects: ${[...(sheet.conditions || []), ...(sheet.effects || [])].map(e => e.name || e).join(', ') || 'none'} | equipped: ${equipment || 'none'} | inventory: ${(sheet.inventory || []).map(i => `${i.name} x${i.quantity || 1}`).join(', ') || 'empty'} | location: ${sheet.location || state.scene.name}`;
        }).filter(Boolean).join('\n');
        const npcs = Object.entries(state.npcs || {}).map(([npcId, sheet]) => `${npcId} | ${sheet.name} | ${Object.values(sheet.resources || {}).map(r => `${r.name} ${r.value}/${r.max}`).join(', ')} | effects: ${(sheet.effects || []).map(e => e.name).join(', ') || 'none'}`).join('\n');
        const encounter = (state.encounters || []).find(entry => entry.status === 'active');
        return `AUTHORITATIVE CAMPAIGN STATE (revision ${state.revision})\nScene: ${state.scene.name} — ${state.scene.description}\nRules: ${state.rules.name}; mechanics ${Shared.mode(state.rules.mechanicsMode)}; ${state.rules.resolution}\nCharacters:\n${characters}\nNPCs / adversaries:\n${npcs || 'none'}\nEncounter: ${encounter ? `${encounter.name}; round ${encounter.round}; active ${encounter.initiative[encounter.turn] || 'unset'}; order ${encounter.initiative.join(', ') || 'unset'}` : 'none'}\nQuests: ${(state.quests || []).map(q => `${q.title} [${q.status}]`).join(', ') || 'none'}\nClocks: ${(state.clocks || []).map(c => `${c.name} ${c.value}/${c.max}`).join(', ') || 'none'}\nShared inventory: ${(state.sharedInventory || []).map(i => `${i.name} x${i.quantity || 1}`).join(', ') || 'empty'}`;
    }

    function restoreDecision(snapshot, decision) {
        const next = clone(snapshot || {});
        if (decision === 'reroll') {
            const checkpoint = next.turnCheckpoint;
            if (!checkpoint || !checkpoint.gameState || !Array.isArray(next.history)
                || (!Array.isArray(checkpoint.history) && (!Number.isInteger(checkpoint.historyLength)
                    || checkpoint.historyLength < 0 || checkpoint.historyLength >= next.history.length))
                || !Number.isFinite(checkpoint.turn)
                || !Array.isArray(checkpoint.submissions) || !checkpoint.submissions.length) {
                throw new Error('This turn has no complete rollback checkpoint. It cannot be rerolled safely.');
            }
            next.gameState = clone(checkpoint.gameState);
            next.history = Array.isArray(checkpoint.history) ? clone(checkpoint.history)
                : next.history.slice(0, checkpoint.historyLength);
            next.turn = checkpoint.turn;
            for (const key of ['hud', 'location']) if (Object.prototype.hasOwnProperty.call(checkpoint, key)) next[key] = clone(checkpoint[key]);
        } else if (decision === 'reset') {
            const start = next.campaignStart;
            if (!start || !start.gameState || !Array.isArray(start.history) || !Number.isFinite(start.turn)) {
                throw new Error('This legacy campaign has no saved starting state. It cannot be reset safely.');
            }
            next.gameState = clone(start.gameState);
            next.history = clone(start.history);
            next.turn = start.turn;
            for (const key of ['hud', 'location']) {
                if (Object.prototype.hasOwnProperty.call(start, key)) next[key] = clone(start[key]);
                else delete next[key];
            }
        } else throw new Error('Unsupported campaign decision.');
        delete next.turnCheckpoint;
        delete next.lastReferee;
        return next;
    }

    function receiptSchema() {
        return { type: 'object', required: ['narration', 'summary', 'operations', 'checks'], properties: {
            narration: { type: 'string' }, summary: { type: 'string' }, operations: { type: 'array', items: { type: 'object' } }, checks: { type: 'array', items: { type: 'object' } }
        } };
    }

    window.HordeMultiplayerEngine = Object.freeze({ VERSION, PACKS, pack, createSheet, createState, migrateCampaign, normalizeSheet,
        parseDice, roll, check, item, effect, applyOperation, applyReceipt, applyReceiptRecovering, promptState, restoreDecision, receiptSchema, levelThreshold, clone });
})();
