/* Model proposals have no write authority. Compile them into engine receipts.
 * Pure module: no DOM, storage, network, clock reads, or model calls. */
(function (root) {
'use strict';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = v => JSON.parse(JSON.stringify(v));
const kinds = ['physical', 'speech', 'question', 'observation', 'travel', 'wait', 'other'];
const statuses = ['resolved', 'answered', 'attempted', 'pending_check', 'blocked', 'needs_clarification'];
const text = (description, maxLength = 2000) => ({ type: 'string', description, maxLength });
const list = items => ({ type: 'array', items, maxItems: 32 });
const shape = (properties, required = Object.keys(properties)) =>
    ({ type: 'object', properties, required, additionalProperties: false });

function schema(legacy) {
    const excluded = new Set(['summary', 'scene', 'events', 'entity_updates', 'state_updates',
        'action_resolution', 'npc_observations', 'world_events']);
    const effects = copy(Object.fromEntries(Object.entries(legacy).filter(([key]) => !excluded.has(key))));
    if (effects.checks?.items?.properties) {
        effects.checks.description = 'Request one engine-resolved check. Put all lasting consequences in typed on_success/on_failure operations. Do not provide success_text/failure_text or branch ledger prose. The engine derives the outcome from applied state changes.';
        const fields = effects.checks.items.properties;
        delete fields.success_text;
        delete fields.failure_text;
        for (const branch of ['on_success','on_failure']) if (fields[branch]) {
            if (fields[branch].properties) for (const key of ['ledger_update','memory_write']) delete fields[branch].properties[key];
            fields[branch].description = 'Typed lasting consequences for this branch. Equipment loss needs inventory_remove; a blocked route needs location_state_updates; an opened gate needs exit_unlocks. No free-form ledger or outcome prose. Use {} for no lasting change.';
        }
    }
    if (effects.npc_introduced?.items) {
        effects.npc_introduced.items.required = ['id', 'name', 'persona'];
        effects.npc_introduced.items.additionalProperties = false;
        effects.npc_introduced.items.properties.id.description = 'New stable actor ID used in speech/events, e.g. npc_examiner. Required for named or role-identified speakers not already registered.';
    }
    if (effects.location_introduced?.items) {
        effects.location_introduced.items.required = ['id', 'name', 'connects_to'];
        effects.location_introduced.items.additionalProperties = false;
        effects.location_introduced.items.properties.connects_to.description = 'Exact existing location ID to connect to. Do not introduce locations merely mentioned in speech.';
    }
    const passage = text('ID of the narrative passage that evidences this entry. Reference it; do not repeat its text.', 80);
    const events = copy(legacy.events);
    if (events?.items?.properties) {
        delete events.items.properties.evidence;
        events.items.properties.passage_id = passage;
        events.items.required = [...new Set([...(events.items.required || []).filter(k => k !== 'evidence'), 'actor_id', 'passage_id'])];
        if (events.items.properties.action) events.items.properties.action.description =
            'Required for inventory events: add/gain/take or remove/lose/consume/give/drop. Other events may describe the action. Never record an offered-but-unaccepted item as gained.';
    }
    return shape({
        protocol: { type: 'string', enum: ['scene_draft_v2'] },
        narrative: { type: 'array', minItems: 1, maxItems: 16,
            description: 'The complete player-facing scene in ordered passages. Write each passage once and reference its ID below. For a pending check stop before its outcome.',
            items: shape({ id: text('Unique passage ID, e.g. p1', 80), text: text('One paragraph of player-facing narrative or dialogue.', 4000) }) },
        actions: list(shape({
            request: text('Exact contiguous excerpt of the player input. In order, requests must cover the complete input; split compound actions where useful.'),
            kind: { type: 'string', enum: kinds },
            status: { type: 'string', enum: statuses },
            response_id: { ...passage, description: 'Passage that RESPONDS to this request: the answer, refusal, result or check setup. Not a passage merely repeating the player’s question.' }
        })),
        events,
        effects: shape(effects, []),
        speech: list(shape({
            speaker: text('Exact present NPC ID or player', 120),
            listeners: list(text('Exact present listener ID or player', 120)),
            passage_id: passage
        })),
        commitments: list(shape({
            id: text('Stable event ID; reuse to acknowledge an existing commitment', 80),
            title: text('Player-facing commitment', 120),
            description: text('What is due and why', 500),
            day: { type: 'integer', minimum: 1, description: 'Absolute world day, starting at 1. Never a relative duration.' },
            minute_of_day: { type: 'integer', minimum: 0, maximum: 1439, description: '24-hour time: 17:00 is 1020.' },
            location_id: text('Registered location ID', 120),
            status: { type: 'string', enum: ['scheduled', 'cancelled'] },
            reschedule: { type: 'boolean', description: 'True only for an explicitly agreed change, not when repeating a deadline.' },
            passage_id: passage
        }, ['id','title','day','minute_of_day','location_id','status','passage_id'])),
        resolutions: list(shape({
            id: text('ID of a reached commitment being resolved', 80),
            passage_id: passage,
            event_index: { type: 'integer', minimum: 0, description: 'Index of its completed, evidenced event in events. Declare any lasting mechanical changes in effects as well.' }
        }))
    }, ['protocol', 'narrative', 'actions', 'events', 'effects', 'speech', 'commitments']);
}

function isDraft(value) { return object(value) && value.protocol === 'scene_draft_v2'; }
function decode(value) {
    if (object(value)) return value;
    let source = String(value).trim();
    // An exact enclosing Markdown fence is a transport wrapper, not prose to
    // recover. Never scan for braces or repair malformed JSON inside it.
    if (source.endsWith('```')) {
        if (source.startsWith('```json\n')) source = source.slice(8, -3).trim();
        else if (source.startsWith('```\n')) source = source.slice(4, -3).trim();
    }
    if (source.startsWith('<world_turn_receipt>') && source.endsWith('</world_turn_receipt>'))
        source = source.slice('<world_turn_receipt>'.length, -'</world_turn_receipt>'.length).trim();
    try { const result = JSON.parse(source); return object(result) ? result : null; }
    catch { return null; }
}

// Migration adapter for engine-owned instructions, not a parser for model prose.
// Keep one protocol authoritative while the legacy replay path is supported.
function alignInstructions(value) {
    return value
        .replace('Even when nothing changes, submit the ending scene checksum with empty events and entity updates for the on-screen cast.',
            'Submit narrative, actions, events, effects, speech and commitments as scene_draft_v2, including when nothing changes. The engine derives the ending scene; never supply a checksum or entity_updates.')
        .replace('and give the complete ending cast in scene.present_character_ids',
            'only; the engine computes the ending cast')
        .replace('entity_updates reports what each on-screen person is wearing now.',
            'Do not add entity_updates; outfit events carry the changes.')
        .replace('and in state_updates.time_skip_minutes when applicable', 'without also duplicating elapsed time in effects')
        .replaceAll('Put prose-only possible consequences in success_text/failure_text at the check root, NEVER in on_success.summary or on_failure.summary.',
            'All lasting check consequences require typed on_success/on_failure operations. Omit success_text/failure_text: the engine derives the outcome from the applied state delta. Never use branch ledger prose as a substitute for a mechanical change.')
        .replaceAll('state_updates.', 'effects.');
}

function compile(draft, context) {
    const errors = [];
    const fail = (path, reason, explanation = '') => errors.push({ type: 'scene_draft', reason,
        detail: explanation ? `${path}: ${explanation}` : path });
    if (!isDraft(draft)) return { ok: false, errors: [{ reason: 'invalid_scene_protocol' }] };
    draft = copy(draft);
    // Some compatible providers flatten explicitly named effect fields at the
    // root. This is a structural adapter, never a prose inference: relocate only
    // enabled, known fields, reject conflicting duplicates, and validate every
    // proposed mutation through the same reducer below. Unknown fields stay
    // errors rather than being silently discarded.
    if (object(draft.effects)) for (const key of context.effectKeys || []) {
        if (['npc_observations', 'world_events'].includes(key)
            || !Object.prototype.hasOwnProperty.call(draft, key)) continue;
        if (Object.prototype.hasOwnProperty.call(draft.effects, key)
            && JSON.stringify(draft.effects[key]) !== JSON.stringify(draft[key]))
            fail(`effects.${key}`, 'conflicting_effect_placement');
        else draft.effects[key] = draft[key];
        delete draft[key];
    }
    // IDs bind mechanics to the exact prose that will be shown. No fuzzy text
    // matching, quote duplication, or model-generated end-state checksum.
    if (Array.isArray(draft.narrative)) {
        const passages = new Map();
        if (!draft.narrative.length || draft.narrative.length > 16) fail('narrative', 'invalid_passages');
        for (const p of draft.narrative) {
            if (!object(p) || typeof p.id !== 'string' || !p.id.trim() || p.id.length > 80
                || passages.has(p.id) || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 4000)
                fail('narrative', 'invalid_passage');
            else passages.set(p.id, p.text.trim());
        }
        const bind = (items, source, target, path) => {
            if (!Array.isArray(items)) return;
            items.forEach((item, i) => {
                if (!object(item) || !passages.has(item[source])) { fail(`${path}.${i}`, 'unknown_passage_id'); return; }
                item[target] = passages.get(item[source]);
                delete item[source];
            });
        };
        bind(draft.actions, 'response_id', 'response', 'actions');
        bind(draft.events, 'passage_id', 'evidence', 'events');
        bind(draft.speech, 'passage_id', 'statement', 'speech');
        bind(draft.commitments, 'passage_id', 'evidence', 'commitments');
        bind(draft.resolutions, 'passage_id', 'response', 'resolutions');
        draft.narrative = [...passages.values()].join('\n\n');
        if (errors.length) return { ok: false, errors };
    }
    const allowed = new Set(['protocol', 'narrative', 'actions', 'events', 'effects', 'speech', 'commitments', 'resolutions']);
    Object.keys(draft).forEach(key => { if (!allowed.has(key)) fail(key, 'unsupported_draft_field'); });
    const narrative = typeof draft.narrative === 'string' ? draft.narrative.trim() : '';
    if (!narrative || narrative.length > 16000) fail('narrative', 'invalid_scene_narrative');
    for (const key of ['actions', 'events', 'speech', 'commitments']) {
        if (!Array.isArray(draft[key]) || draft[key].length > 32) fail(key, 'invalid_draft_list');
    }
    if (!object(draft.effects)) fail('effects', 'invalid_draft_effects');
    if (draft.resolutions !== undefined && (!Array.isArray(draft.resolutions) || draft.resolutions.length > 32))
        fail('resolutions', 'invalid_draft_list');
    if (errors.length) return { ok: false, errors };
    const effects = copy(draft.effects);
    const effectKeys = new Set(context.effectKeys || []);
    Object.keys(effects).forEach(key => {
        if (!effectKeys.has(key) || ['npc_observations', 'world_events'].includes(key)) fail(`effects.${key}`, 'unsupported_draft_effect');
    });
    const actions = draft.actions;
    const compact = value => String(value || '').replace(/[\s,]+/g, '');
    if (compact(actions.map(action => action?.request || '').join('')) !== compact(context.input))
        fail('actions', 'incomplete_player_request_coverage');
    if (String(context.input || '').trim() && !actions.length) fail('actions', 'missing_player_response');
    actions.forEach((action, index) => {
        if (!object(action) || !kinds.includes(action.kind) || !statuses.includes(action.status)) {
            fail(`actions.${index}`, 'invalid_action_disposition'); return;
        }
        if (typeof action.response !== 'string' || action.response.trim().length < 8
            || !narrative.includes(action.response.trim())) fail(`actions.${index}.response`, 'response_missing_from_scene');
    });
    const checks = Array.isArray(effects.checks) ? effects.checks : [];
    // A speculative attempt's ledger sentence is presentation, not a lasting
    // check consequence. The source-linked scene retains the attempt; the
    // selected typed branch is the only source of its mechanical outcome.
    if (checks.length) delete effects.ledger_update;
    for (const [i, check] of checks.entries()) {
        if (!object(check)) continue;
        // Model-authored branch prose is never a state authority. Compatibility
        // fields are discarded; the engine renders the actual selected delta.
        delete check.success_text;
        delete check.failure_text;
        for (const branch of ['on_success','on_failure']) {
            if (object(check[branch]) && ['ledger_update','memory_write'].some(key => key in check[branch]))
                fail(`effects.checks.${i}.${branch}`, 'untyped_check_consequence',
                    'Use typed inventory, route, condition, quest or relationship changes, not ledger_update/memory_write. Use {} if nothing lasting changes.');
        }
        check.outcome_contract = 'state_delta_v1';
    }
    const pendingActions = actions.filter(action => action?.status === 'pending_check');
    if (checks.length && (checks.length !== 1 || !pendingActions.length
        || new Set(pendingActions.map(action => action.response)).size !== 1))
        fail('actions', 'check_requires_one_pending_action',
            'One check may cover multiple clauses only when they reference the same pending-attempt passage. Independent attempts require separate turns.');
    if (pendingActions.length && checks.length !== 1)
        fail('effects.checks', 'pending_action_requires_check');
    const locations = new Set(context.locations || []);
    const introductions = effects.location_introduced || [];
    if (Array.isArray(introductions)) introductions.forEach((location, index) => {
        if (!location?.id || !locations.has(location.connects_to || location.parent_location_id))
            fail(`effects.location_introduced.${index}`, 'location_requires_registered_connection');
        else {
            locations.add(location.id);
            // The existing graph reducer consumes connects_to. Preserve the
            // explicit parent connection rather than falling back elsewhere.
            if (!location.connects_to) location.connects_to = location.parent_location_id;
        }
    });
    if (Array.isArray(effects.quests_update)) effects.quests_update.forEach((quest, qi) => {
        (Array.isArray(quest?.objectives) ? quest.objectives : []).forEach((objective, oi) => {
            if (objective?.type === 'location' && !locations.has(objective.target))
                fail(`effects.quests_update.${qi}.objectives.${oi}`, 'unknown_quest_location');
        });
    });
    const present = new Set(['player', ...(context.present || [])]);
    if (Array.isArray(effects.npc_introduced)) effects.npc_introduced.forEach(npc => { if (npc?.id) present.add(npc.id); });
    const events = copy(draft.events);
    // A precise vocabulary alias, not an inferred event from prose. Both mean
    // a spoken interaction; the domain reducer still validates actor/status.
    for (const event of events) if (event?.type === 'speech') event.type = 'dialogue';
    const neutralEventKeys = new Set(['id','actor_id','status','action','target_id',
        'evidence','witnessed_by','visibility']);
    const timeEventKeys = new Set([...neutralEventKeys,'cause','minutes_elapsed']);
    for (const event of events) if (object(event) && !event.type
        && Number.isInteger(event.minutes_elapsed) && event.minutes_elapsed > 0
        && Object.keys(event).every(key => timeEventKeys.has(key))) event.type = 'time';
    for (const event of events) if (object(event) && !event.type
        && Object.keys(event).every(key => neutralEventKeys.has(key))) {
        // An otherwise explicit narrative annotation has no state operation
        // to infer. Record it as a neutral event. Never guess a missing type
        // for a movement, item, time, condition or other mechanical payload.
        event.type = 'other';
    }
    draft.speech.forEach((speech, index) => {
        const listeners = speech?.listeners;
        if (!object(speech) || !present.has(speech.speaker) || !Array.isArray(listeners)
            || !listeners.length || listeners.length > 32 || listeners.some(id => !present.has(id))
            || typeof speech.statement !== 'string' || !speech.statement.trim()
            || !narrative.includes(speech.statement)) {
            fail(`speech.${index}`, 'invalid_witnessed_speech'); return;
        }
        for (const listener of new Set(listeners)) {
            if (listener === 'player' || listener === speech.speaker) continue;
            events.push({ type: 'observation', actor_id: listener, status: 'completed',
                observation: speech.statement, source_type: 'told', source_npc_id: speech.speaker,
                confidence: 1, visibility: 'private', allowed_to_share: true,
                witnessed_by: [listener], evidence: speech.statement });
        }
    });
    const commitments = [];
    const ids = new Set();
    draft.commitments.forEach((rawItem, index) => {
        const item = object(rawItem) ? { ...rawItem,
            description: rawItem.description ?? String(rawItem.evidence || rawItem.title || '').slice(0,500),
            reschedule: rawItem.reschedule ?? false } : rawItem;
        const path = `commitments.${index}`;
        if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 80
            || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120
            || typeof item.description !== 'string' || item.description.length > 500
            || ids.has(item.id) || !Number.isInteger(item.day) || item.day < 1
            || !Number.isInteger(item.minute_of_day) || item.minute_of_day < 0 || item.minute_of_day > 1439
            || !locations.has(item.location_id) || !['scheduled', 'cancelled'].includes(item.status)
            || typeof item.reschedule !== 'boolean' || !item.evidence || !narrative.includes(item.evidence)) {
            fail(path, 'invalid_commitment'); return;
        }
        ids.add(item.id);
        const dueMinute = (item.day - 1) * 1440 + item.minute_of_day;
        const previous = (context.commitments || []).find(event => event.id === item.id);
        if (previous && !item.reschedule && previous.dueMinute !== dueMinute)
            fail(path, 'commitment_time_changed_without_reschedule',
                `Existing ${item.id} is day ${Math.floor(previous.dueMinute / 1440) + 1}, minute_of_day ${previous.dueMinute % 1440}. Omit unchanged commitments. Do not recalculate or shift the deadline.`);
        if ((!previous || item.reschedule) && item.status === 'scheduled' && dueMinute <= context.now)
            fail(path, 'new_commitment_in_past');
        if (previous && previous.status !== 'scheduled' && item.status === 'scheduled' && !item.reschedule)
            fail(path, 'resolved_commitment_rearmed');
        commitments.push({ ...copy(item), dueMinute });
    });
    if (commitments.length) effects.world_events = commitments.map(item => ({
        id: item.id, title: item.title, description: item.description,
        status: item.status, urgent: true, location_id: item.location_id,
        // Exact engine-owned timestamp is applied by the adapter, never read
        // from model-provided legacy state fields.
        due_in_minutes: Math.max(1, item.dueMinute - context.now)
    }));
    const resolutions = [];
    const proposedElapsed = Math.max(0, Number(effects.time_skip_minutes) || 0,
        ...events.filter(event => event.type === 'time' && event.status === 'completed')
            .map(event => Number(event.minutes_elapsed) || 0));
    for (const [index, resolution] of (draft.resolutions || []).entries()) {
        const previous = (context.commitments || []).find(event => event.id === resolution?.id);
        const event = Number.isInteger(resolution?.event_index) ? events[resolution.event_index] : null;
        // A wait can reach the deadline and witness its consequence in this
        // very scene. The elapsed-time operation still has to pass the reducer;
        // do not force a second turn just because the pre-turn timer is scheduled.
        const reached = previous?.status === 'triggered' || previous?.status === 'scheduled'
            && Number.isFinite(previous.dueMinute) && proposedElapsed > 0
            && previous.dueMinute <= context.now + proposedElapsed;
        if (!previous || !reached || previous.sceneResolution
            || (previous.locationId && previous.locationId !== context.location)
            || typeof resolution.response !== 'string' || !resolution.response.trim()
            || !narrative.includes(resolution.response) || event?.status !== 'completed'
            || event.type === 'time'
            || typeof event.evidence !== 'string' || !event.evidence.trim() || !narrative.includes(event.evidence)
            || !(event.evidence.includes(resolution.response) || resolution.response.includes(event.evidence))
            || resolutions.some(item => item.id === resolution.id)) {
            fail(`resolutions.${index}`, 'unverified_commitment_resolution'); continue;
        }
        resolutions.push(copy(resolution));
    }
    for (const event of context.commitments || []) {
        if (event.sourceReceiptId && event.status === 'triggered' && !event.sceneResolution
            && (!event.locationId || event.locationId === context.location)
            && !resolutions.some(item => item.id === event.id)) fail(`resolutions.${event.id}`, 'reached_commitment_needs_scene_resolution');
    }
    if (events.length > 100) fail('speech', 'too_many_compiled_events');
    if (errors.length) return { ok: false, errors };
    const first = actions[0];
    return { ok: true, narrative, actions: copy(actions), speech: copy(draft.speech), commitments, resolutions,
        receipt: {
            summary: actions.map(action => action.response).join(' ').slice(0, 300),
            action_resolution: first ? { kind: first.kind, status: first.status, outcome: first.response } : null,
            scene: { player_location_id: context.location,
                player_location_changed: context.location !== context.playerStart,
                present_character_ids: [...(context.present || [])] },
            events, entity_updates: [], state_updates: effects
        }
    };
}

root.HordeWorldSceneDraft = { schema, compile, isDraft, decode, alignInstructions };
if (typeof module !== 'undefined') module.exports = root.HordeWorldSceneDraft;
})(globalThis);
