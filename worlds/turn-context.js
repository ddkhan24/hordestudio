/* Pure context selection. No providers, persistence, or state mutation. */
(function(root) {
'use strict';
function history(options) {
    const messages = [];
    let remaining = options.budget, latestStateKept = false, count = 0;
    for (let i = options.start; i >= 0 && count < 160; i--) {
        const m = options.history[i];
        // Failed UI notices and their abandoned requests are not story canon.
        // Keep the current action, but do not teach the narrator to roleplay
        // previous repair errors or answer an abandoned request again.
        if (m.stateSource === 'frozen_no_receipt') continue;
        if (i !== options.start && m.role === 'user'
            && options.history[i + 1]?.stateSource === 'frozen_no_receipt') continue;
        let content = options.text(m);
        if (!content) continue;
        const current = i === options.start && m.role === 'user';
        if (m.role === 'dm' && options.prepare) {
            const hasState = /<internal_states\b/i.test(content);
            content = options.prepare(content, !latestStateKept);
            if (hasState) latestStateKept = true;
        }
        if (!content) continue;
        if (!current && m.location && m.location !== options.location) {
            const name = options.locations.find(location => location.id === m.location)?.name;
            content = `[DISTANT EVENT (HIDDEN FROM PRESENT NPCs)]: ${name ? `[Loc: ${name}] ` : ''}${content}`;
        }
        const tokens = Math.ceil((content.length + 48) / 3.2);
        if (remaining - tokens <= 0) {
            if (current) throw new Error('The current player action exceeds this World’s context budget. Shorten the action or increase World Context Size. No model request was sent.');
            break;
        }
        const role = m.role === 'dm' ? 'assistant' : 'user';
        if (messages[0]?.role === role) messages[0].content = content + '\n\n' + messages[0].content;
        else messages.unshift({ role, content });
        remaining -= tokens;
        count++;
    }
    for (const injection of options.injections || []) {
        messages.splice(Math.max(0, messages.length - (injection.depth || 0)), 0,
            { role: injection.role || 'system', content: injection.content });
    }
    return messages;
}

// Extractive scene memory: reuse accepted statements, never ask a second model
// to reinterpret state. Records live on the originating take, not in a second
// mutable archive, so rerolls/deletion cannot leave orphaned canon behind.
function sceneMemory(draft, receiptId, location, turn) {
    const records = [];
    for (const event of draft.receipt.events || []) {
        if (event.status !== 'completed' || !event.evidence) continue;
        records.push({ kind: event.source_type === 'told' ? 'testimony' : 'event',
            actor: event.actor_id, text: String(event.evidence).slice(0, 700) });
    }
    for (const speech of draft.speech || []) records.push({ kind: 'testimony', actor: speech.speaker,
        listeners: speech.listeners, text: String(speech.statement).slice(0, 700) });
    if (draft.receipt.state_updates.ledger_update) records.push({ kind: 'chronicle',
        text: String(draft.receipt.state_updates.ledger_update).slice(0, 700) });
    const unique = [...new Map(records.map(r => [`${r.kind}:${r.actor || ''}:${r.text}`, r])).values()].slice(0, 12);
    return { receiptId, location, turn, records: unique };
}
function recall(history, query, location, limit = 4500) {
    const terms = [...new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].slice(0, 30);
    const candidates = [];
    // Recent prose is already in the normal context. Recall older source-linked
    // scenes by relevance without bloating every request or copying snapshots.
    for (const [index, message] of history.entries()) {
        const memory = message.sceneMemory;
        if (!memory?.records?.length || !message.id) continue;
        const text = JSON.stringify(memory.records);
        const score = terms.reduce((n, term) => n + (text.toLowerCase().includes(term) ? 1 : 0), 0)
            + (memory.location === location ? 1 : 0);
        if (score) candidates.push({ score, index, text: JSON.stringify({ sourceMessageId: message.id,
            receiptId: memory.receiptId, turn: memory.turn, location: memory.location, records: memory.records }) });
    }
    let used = 0;
    return candidates.sort((a,b) => b.score - a.score || b.index - a.index).slice(0, 8)
        .filter(item => { if (used + item.text.length > limit) return false; used += item.text.length; return true; })
        .sort((a,b) => a.index - b.index).map(item => item.text).join('\n');
}
root.HordeWorldTurnContext = { history, sceneMemory, recall };
if (typeof module !== 'undefined') module.exports = root.HordeWorldTurnContext;
})(globalThis);
