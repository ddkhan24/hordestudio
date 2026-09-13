/* Pure request and conversation state utilities, shared with the local host. */
(function (root, factory) {
    const engine = factory();
    if (typeof module === 'object' && module.exports) module.exports = engine;
    else root.VHConversationEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const clone = value => JSON.parse(JSON.stringify(value));
    const text = (value, max = 400) => String(value || '').trim().slice(0, max);
    function stripPrivateChannels(raw) {
        let value=String(raw||'');
        // Paired private spans can be removed while preserving a final answer.
        value=value.replace(/<(?:(?:think|analysis|thought))>[\s\S]*?<\/(?:think|analysis|thought)>/gi,'');
        value=value.replace(/<\|channel>\s*(?:thought|analysis)\s*[\s\S]*?(?:<channel\|>|<\|channel>\s*final\s*(?:<\|message>|<channel\|>)?)/gi,'');
        value=value.replace(/<\|(?:channel|im_sep)\|>\s*(?:analysis|thought)[\s\S]*?(?=<\|(?:channel|im_sep)\|>\s*final)/gi,'');
        // An unclosed private section is withheld, never exposed as chat.
        value=value.replace(/<(?:think|analysis|thought)>[\s\S]*$/gi,'')
            .replace(/<\|(?:channel>|channel\|>|im_sep\|>)\s*(?:analysis|thought)[\s\S]*$/gi,'');
        return value.replace(/<\|(?:channel|im_sep)\|>\s*final\s*(?:<\|im_sep\|>|<\|message>|<\|im_start\|>)?/gi,'')
            .replace(/<\|channel>\s*final\s*/gi,'').replace(/<channel\|>|<\|(?:im_end|fim_suffix|message)\|?>/gi,'').trim();
    }
    function normalize(raw = {}) {
        raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        return { choices: (Array.isArray(raw.choices) ? raw.choices : []).slice(-12).filter(item => item && typeof item === 'object').map(item => ({sourceMessageId:text(item.sourceMessageId,100),motiveId:text(item.motiveId,140),action:text(item.action,40),outcome:text(item.outcome,240),at:Math.max(0,Number(item.at)||0)})), reaction: normalizeReaction(raw.reaction), topic: text(raw.topic), openQuestion: text(raw.openQuestion, 600),
            sourceMessageId: text(raw.sourceMessageId, 100), intention: text(raw.intention),
            status: ['active', 'paused', 'closed'].includes(raw.status) ? raw.status : 'active',
            resumeReason: text(raw.resumeReason), resumeAfter: Math.max(0, Number(raw.resumeAfter) || 0),
            updatedAt: Math.max(0, Number(raw.updatedAt) || 0) };
    }
    function update(previous, raw, now) {
        const prior = normalize(previous);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prior;
        const next = { ...prior };
        for (const key of ['topic', 'openQuestion', 'sourceMessageId', 'intention', 'resumeReason']) {
            if (typeof raw[key] === 'string') next[key] = raw[key];
        }
        if (['active', 'paused', 'closed'].includes(raw.status)) next.status = raw.status;
        if (Number.isFinite(raw.resumeAfter)) next.resumeAfter = Math.max(now, Math.min(now + 7 * 86400000, raw.resumeAfter));
        if (next.status === 'closed') { next.openQuestion = ''; next.resumeAfter = 0; next.resumeReason = ''; }
        return normalize({ ...next, updatedAt: Math.max(prior.updatedAt, now) });
    }
    function normalizeReaction(raw) {
        if (!raw || typeof raw !== 'object' || !text(raw.summary) || !text(raw.evidence)) return null;
        return { engagement: Math.max(0, Math.min(100, Number(raw.engagement) || 0)), summary: text(raw.summary, 300), evidence: text(raw.evidence, 240),
            sourceMessageId: text(raw.sourceMessageId, 100),
            createdAt: Math.max(0, Number(raw.createdAt) || 0),
            expiresAt: Math.max(0, Number(raw.expiresAt) || 0) };
    }
    function receive(previous, raw, messages, now) {
        const next = update(previous, raw, now);
        const reaction = raw?.reaction;
        if (!reaction || typeof reaction !== 'object') return next;
        // A temporary impression is an interpretation, never a new fact or a
        // second mood adjustment. Its evidence must be in perceived input.
        const evidence = text(reaction.evidence, 240);
        const summary = text(reaction.summary, 300);
        const canonical = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const quote = canonical(evidence);
        if (quote.length < 4 || !summary) return next;
        const source = [...messages].reverse().find(message => message.role === 'user'
            && !message.invalidated && Number(message.timestamp || 0) <= now
            && (!message.awaitingReply || (message.readAt > 0 && message.readAt <= now))
            && canonical(message.text).includes(quote));
        if (!source?.id) return next;
        // Repeating identical input cannot keep an impression alive forever.
        if (next.reaction && canonical(next.reaction.evidence) === quote) return next;
        const minutes = Math.max(5, Math.min(360, Number(reaction.lingerMinutes) || 60));
        next.reaction = { engagement: Math.max(0, Math.min(100, Number(reaction.engagement) || 0)), summary, evidence, sourceMessageId: source.id,
            createdAt: now, expiresAt: now + minutes * 60000 };
        return next;
    }
    function reactionContext(conversation, now) {
        const reaction = normalize(conversation).reaction;
        if (!reaction || reaction.createdAt > now || reaction.expiresAt <= now) return null;
        return { ...reaction, salience: Math.round(100 * Math.max(0, Math.min(1,
            (reaction.expiresAt - now) / Math.max(1, reaction.expiresAt - reaction.createdAt)))) };
    }
    function handoffBrief(handoff){
        return `Your ongoing conversation is about to be interrupted by ${handoff.activity}. You may finish the current thought and give a brief natural sign-off; silence is also an option. Do not invent having already left or fallen asleep. ${handoff.endsAt>handoff.at?`The activity is expected to end around ${new Date(handoff.endsAt).toISOString()}; any return estimate is tentative.`:'No return time is established; do not invent one.'}`;
    }
    function physicalBrief(companion={},compact=false){
        const d=companion.humanDynamics||{},s=d.sleep;
        if(!s)return '';
        if(compact)return `Body: ${s.stage.replaceAll('_',' ')}, hunger ${Math.round(d.hunger||0)}, irritability ${Math.round(s.irritability)}. Let fatigue affect brevity/patience, not trust. Wind-down permits goodnight; invent no return time.`;
        return `PHYSICAL STATE: ${s.stage.replaceAll('_',' ')}; sleep pressure ${Math.round(s.pressure)}/100; sleep debt ${Math.round(s.debtHours*10)/10} hours; hunger ${Math.round(d.hunger||0)}/100; physical irritability ${Math.round(s.irritability)}/100. Fatigue can shorten replies, reduce focus or make patience thinner; hunger can add irritability. Express this according to personality, not on every turn. These are bodily feelings, not anger at the player, reduced trust or evidence of rejection. When winding down, you may finish the exchange and say goodnight; waking means groggy, not instantly refreshed. Never fabricate a sleep event or promise an exact return time.`;
    }
    function receptiveness(companion, situation = {}) {
        const dynamics = companion.humanDynamics || {};
        const reasons = [];
        if (situation.availability && situation.availability !== 'available') reasons.push(situation.availability);
        if(dynamics.sleep&&dynamics.sleep.stage!=='awake')reasons.push(dynamics.sleep.stage.replaceAll('_',' '));
        if (Number(dynamics.energy) < 30) reasons.push('tired');
        if (Number(dynamics.stress) > 65) reasons.push('under stress');
        if (Number(dynamics.cooldownUntil) > Number(situation.now || 0)) reasons.push('taking time to regulate');
        if (situation.withNames?.length) reasons.push('with other people');
        const active = companion.lifeRuntime?.activities?.goals?.find(goal => goal.status === 'active');
        if (active) reasons.push(`occupied with ${text(active.label, 120)}`);
        return { bandwidth: situation.availability === 'asleep' ? 'unavailable' : reasons.length ? 'divided' : 'room to engage',
            reasons, rule: 'Bandwidth describes circumstances, not affection or willingness. Respect specific boundaries; let the actual exchange determine interest. Do not recite these factors in every reply.' };
    }
    function hasAffect(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
        return Object.entries(raw).some(([key, value]) => key.endsWith('_change') && Number.isFinite(value))
            || (typeof raw.mood_label === 'string' && raw.mood_label.trim().length > 0)
            || ['emotion_changes', 'toward_player_emotions'].some(key => raw[key] && typeof raw[key] === 'object'
                && Object.values(raw[key]).some(Number.isFinite));
    }
    // Conservative estimate, not a claim to reproduce every provider tokenizer.
    // Media has explicit overhead; never charge a base64 string as text tokens.
    function tokens(value) {
        if (typeof value !== 'string') value = JSON.stringify(value || '');
        let units = 0;
        for (const char of value) units += char.codePointAt(0) > 127 ? 3 : 1;
        return Math.ceil(units / 3);
    }
    function messageTokens(message) {
        if (!Array.isArray(message.content)) return 8 + tokens(message.content);
        return 8 + message.content.reduce((sum, part) => sum + (part.type === 'text' ? tokens(part.text)
            : part.type === 'image_url' ? 1600 : 3000), 0);
    }
    function compactSchema(value) {
        if (Array.isArray(value)) return value.map(compactSchema);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => !['description', 'examples', 'title'].includes(key))
            .map(([key, item]) => [key, compactSchema(item)]));
    }
    function fitRequest(raw, options = {}) {
        const body = clone(raw);
        const context = Math.max(1024, Number(options.contextSize) || 8192);
        const margin = Math.max(64, Math.ceil(context * 0.05));
        const requestedOutput = Math.max(64, Number(body.max_tokens) || 1000);
        body.max_tokens = Math.min(requestedOutput, context - margin - 64);
        body.messages ||= [];
        const originalCount = body.messages.length;
        const tail = Math.max(2, Number(options.tailMessages) || 2);
        let compacted = false;
        const inputTokens = () => body.messages.reduce((sum, message) => sum + messageTokens(message), 0)
            + (body.tools?.length ? tokens(body.tools) + 16 : 0);
        const fits = () => inputTokens() + body.max_tokens + margin <= context;
        if (!fits() && body.tools?.length) body.tools = compactSchema(body.tools);
        if (!fits() && options.compactSystem && body.messages[0]?.role === 'system') {
            body.messages[0].content = options.compactSystem;
            compacted = true;
        }
        // Retain the final exchange together. An answer without the question
        // that immediately precedes it is not a usable conversation buffer.
        while (!fits() && body.messages.length > 3) {
            const index = body.messages.findIndex((message, i) => i > 0 && i < body.messages.length - tail && message.role !== 'system');
            if (index < 0) break;
            body.messages.splice(index, 1);
        }
        if (!fits()) body.max_tokens = Math.max(64, Math.min(body.max_tokens, context - margin - inputTokens()));
        if (!fits()) {
            const error = new Error('This model context is too small for the current profile, tools and latest exchange. Increase the context size or shorten the message. Your pending message has been kept.');
            error.code = 'VH_CONTEXT_TOO_SMALL';
            throw error;
        }
        return { body, audit: { contextSize: context, estimatedInputTokens: inputTokens(),
            outputReserve: body.max_tokens, margin, omittedMessages: originalCount - body.messages.length,
            compacted, estimator: 'conservative-text-and-media' } };
    }
    function decisionContext(companion, messages, now, situation = {}) {
        const conversation = normalize(companion.continuityRuntime?.conversation);
        const perceived = (messages || []).filter(m => m?.role === 'user' && !m.invalidated && Number(m.timestamp || 0) <= now
            && (!m.awaitingReply || (m.readAt > 0 && m.readAt <= now)));
        const latest = perceived.at(-1);
        const candidates = [];
        const add = (id, want, evidence) => candidates.push({id,want,evidence});
        if (latest) add('respond', 'Address what this person is asking or sharing', `Read message ${latest.id}`);
        const dynamics = companion.humanDynamics || {};
        const activity = companion.lifeRuntime?.activities?.goals?.find(g => g.status === 'active');
        const unavailable = ['asleep','private'].includes(situation.availability) || Number(dynamics.cooldownUntil) > now;
        if (unavailable) add('space','Protect the current need for space',situation.availability || 'Active cooldown');
        if (Number(dynamics.energy) < 30) add('rest','Conserve energy', 'Low energy in the life simulation');
        if (Number(dynamics.socialNeed) >= 50 && !unavailable) add('company','Have some company', 'Unmet social need in the life simulation');
        if (activity) add(`activity:${activity.id}`, 'Keep making progress on the current activity', text(activity.label,180));
        for (const promise of (companion.commitments || []).filter(p=>p.status==='pending' && Number(p.dueAt)>0 && p.dueAt<=now+3600000).slice(0,2)) {
            add(`promise:${promise.id}`, 'Follow through on an actual promise', text(promise.text,180));
        }
        for (const project of (companion.lifeRuntime?.activities?.projects || []).filter(p=>p.progressMs<p.targetMs && companion.lifeProfile?.activityOptions?.some(o=>o.id===p.id && o.projectMinutes>0)).slice(0,3)) add(`project:${project.id}`, 'Make progress on a continuing project', `${text(project.label,120)}: ${Math.ceil((project.targetMs-project.progressMs)/60000)} planned work minutes remain`);
        const impression = reactionContext(conversation,now);
        if (impression?.engagement > 0 && !unavailable) add('interest','Stay with this exchange',impression.summary);
        const canMakeTime = !unavailable && situation.source === 'activity' && !!activity && activity.kind !== 'contact'
            && Number(dynamics.energy) >= 30;
        return {activityReason:activity&&companion.lifeRuntime.activities.decision?.goalId===activity.id?companion.lifeRuntime.activities.decision.reason:'',candidates,sourceMessageId:latest?.id || '',canMakeTime,
            recentChoices:conversation.choices.slice(-3),
            expression:companion.emotionExpression || 'guarded'};
    }
    function decisionBrief(context) {
        return `PRIVATE CONVERSATIONAL CHOICE:
Grounded possible motives: ${JSON.stringify(context.candidates)}.
${context.activityReason?`The ongoing activity was selected for ${context.activityReason}. This explains existing behavior; do not recite it or invent completion.`:''}
Choose what matters in this exchange using the authored personality and actual message. These are possibilities, not a rotation, diagnosis or requirement to announce a motive. Being tired need not become rejection; wanting company need not become flirting.
Let that purpose shape a direct response in the person's voice. Leave most internal state unspoken. Do not invent an event, reason for leaving or promise to create texture.
A voluntary short pause of the active solo task is ${context.canMakeTime ? 'available' : 'unavailable'}. If the visible reply actually chooses to make time and that fits a listed motive, optionally report conversation.choice with motiveId, action=make_time and an exact evidence quote from the latest perceived player message. Otherwise use action=none or omit choice. Keep promises in the existing commitments receipt; planning and preparing are not completion.
Recent enacted choices: ${JSON.stringify(context.recentChoices)}. These are remembered actions, not personality labels or instructions to repeat them.`;
    }
    function enactChoice(companion, raw, messages, now, situation, activityEngine) {
        if (!raw || typeof raw !== 'object' || !['none','make_time'].includes(raw.action)) return null;
        const context = decisionContext(companion,messages,now,situation);
        const conversation = normalize(companion.continuityRuntime?.conversation);
        const source = (messages || []).find(m=>m.id===context.sourceMessageId);
        const canonical = value => String(value || '').toLowerCase().replace(/\s+/g,' ').trim();
        const evidence = canonical(raw.evidence);
        if (!source || evidence.length < 4 || !canonical(source.text).includes(evidence)
            || !context.candidates.some(item=>item.id===raw.motiveId)
            || conversation.choices.some(item=>item.sourceMessageId===source.id)) return null;
        let outcome = 'Conversational choice only; no life action.';
        if (raw.action === 'make_time') {
            if (!context.canMakeTime || !activityEngine) return null;
            const duration = Math.min(120000,Math.max(15000,String(source.text || '').length*180 + 15000));
            if (!activityEngine.reserveAttention(companion.lifeRuntime.activities,now,`choice:${source.id}`,duration)) return null;
            outcome = 'Paused the active solo task to make time for this exchange; progress is preserved.';
        }
        const receipt = {sourceMessageId:source.id,motiveId:text(raw.motiveId,140),action:raw.action,outcome,at:now};
        conversation.choices.push(receipt);
        companion.continuityRuntime.conversation = normalize(conversation);
        return receipt;
    }
    function dialogueTurns(messages, now = Date.now()) {
        const turns = [];
        for (const message of (Array.isArray(messages) ? messages : []).slice(-100)) {
            if (message?.role !== 'companion' || message.invalidated || message.pending
                || (message.type && message.type !== 'text') || Number(message.timestamp) > now) continue;
            const content = String(message.text || '').trim();
            if (!content) continue;
            const key = message.responseGroupId || message.id || `turn-${turns.length}`;
            if (turns.at(-1)?.key === key) turns.at(-1).text += ' ' + content;
            else turns.push({key, text:content});
        }
        return turns.slice(-12);
    }
    function dialoguePhrases(value) {
        const words = String(value || '').toLowerCase().replace(/[’]/g, "'").match(/[\p{L}\p{N}']+/gu) || [];
        const phrases = new Set();
        for (let length = 4; length <= 8; length++) {
            for (let i = 0; i + length <= Math.min(words.length, 350); i++) phrases.add(words.slice(i,i+length).join(' '));
        }
        return phrases;
    }
    function dialoguePatterns(messages, now = Date.now()) {
        const turns = dialogueTurns(messages, now);
        const counts = new Map();
        for (const turn of turns) for (const phrase of dialoguePhrases(turn.text)) counts.set(phrase,(counts.get(phrase)||0)+1);
        const phrases = [...counts].filter(([,count]) => count >= 2)
            .sort((a,b) => b[1]-a[1] || b[0].length-a[0].length);
        const selected = [];
        for (const [phrase,count] of phrases) {
            if (selected.some(item => item.phrase.includes(phrase))) continue;
            selected.push({phrase,count});
            if (selected.length === 4) break;
        }
        return {turnCount:turns.length, recurring:selected};
    }
    function relationshipGrounding(companion = {}, messages = [], now = Date.now()) {
        const visible=messages.filter(m=>!m.invalidated&&Number(m.timestamp||0)<=now&&['user','companion'].includes(m.role)&&(!m.awaitingReply||(m.readAt>0&&m.readAt<=now)));
        const players=visible.filter(m=>m.role==='user');
        const days=new Set(players.map(m=>Math.floor(Number(m.timestamp||0)/86400000))).size;
        return `RELATIONSHIP EVIDENCE (overrides voice examples and sentiment labels):
Connection: ${text(companion.connectionType||'unspecified',80)}; known before: ${Math.max(0,Number(companion.knownBeforeDays)||0)} days. Authored history: ${text(companion.relationshipContext,600)||'None supplied'}.
Perceived transcript: ${players.length} player messages across ${days} UTC calendar days; missing older history is unknown.
Style specifies wording, not evidence of attachment. Attraction and enjoyment now do not establish trust, commitment or mutual feelings. A playful stranger can flirt without acting like a partner. Preserve authored partners without imposing a mandatory slow courtship.
A first occurrence stays a first occurrence. Shared habits, “again”, or “love it when you do that” require earlier supporting events; the current event alone is insufficient. Your own unsupported claims are not corroboration. Off-screen longing requires recorded context, not a stock opener. React to this moment when that is all you know.
Only new relevant evidence merits lasting relationship changes. Enjoyment can shift mood without raising trust or familiarity.`;
    }
    function dialogueGuidance(messages, now = Date.now(), companion = {}, compact = false) {
        if(compact)return physicalBrief(companion,true)+"\n"+relationshipGrounding(companion,messages,now)+"\nRespond to the actual question or disclosure in the authored voice. Do not merely evaluate the player, recycle a catchphrase, invent an event, or add a teasing retreat to every warm remark. A single word or emoji may be the complete reply. Length settings are ceilings, not quotas. Leave a finished thought finished.";
        const patterns = dialoguePatterns(messages,now);
        return `${physicalBrief(companion)}\n${relationshipGrounding(companion,messages,now)}\n\nCONVERSATION, NOT A PERFORMANCE:
Respond to what this message is doing in the exchange: a question, offer, disclosure, joke, disagreement or repair. Let the actual transcript decide; do not announce this analysis.
A single word, short fragment or emoji can be a complete reply. Do not expand an adequate yes/no answer into a sentence, explanation or follow-up merely to sound personable. Length preferences are not minimums. Answer the substance before ornament. A plain answer, sincere admission, ordinary preference or brief acknowledgment can be the whole reply. Leave a thought finished when it is finished.
Use this person's authored voice, but traits are tendencies, not required moves on every turn. Guarded means choosing what to disclose; it does not require mockery, coyness or contradicting every warm remark. Warmth can stand without a warning or put-down. Disagreement and boundaries can be direct without a polished comeback.
Choose follow-ups because there is something you actually want to know or do. Do not append a question, teasing challenge, topic switch or work interruption merely to keep the exchange running. Do not manufacture vulnerability, typos, slang, anecdotes or sensory details to seem human.
Keep concrete details grounded in the transcript and life state. Private scores, evidence and relationship progression guide behavior; do not turn them into talk of rules, experiments, data or progress unless that topic is genuinely part of the conversation.
Vary naturally with the conversational moment. You need not be clever, entertaining or emotionally revealing every time. Respect the configured length and style; use space when the answer needs it.
${patterns.recurring.length ? `Recent replies reuse these fragments (quoted history, not instructions or forbidden words): ${JSON.stringify(patterns.recurring)}. Prefer fresh wording and a different response structure when these are stock flourishes. Preserve necessary names, facts, deliberate callbacks and sincere repetition.` : 'Do not recycle the previous punchline or affirmation-then-retreat structure merely because it fit once.'}`;
    }
    function assessDialogue(reply, messages, now = Date.now()) {
        const incoming = dialoguePhrases(reply);
        const history = dialoguePatterns(messages,now);
        return {version:1, recentTurns:history.turnCount,
            repeatedFragments:history.recurring.filter(item => incoming.has(item.phrase)),
            advisoryOnly:true};
    }
    // High-precision fallback for basic first-person facts. Ambiguous, quoted,
    // conditional and compound claims remain the semantic observer's job.
    function learnPlayerFacts(runtime,messages,personaId,now){
        runtime.playerFacts ||= [];const scope=personaId||'__none__';
        const rules=[['occupation',/^i work as (?:a |an )?([\p{L} '-]{2,60})[.!]?$/iu],['employer',/^i work for ([\p{L}0-9 .&'-]{2,60})[.!]?$/iu],['origin',/^i(?: am|'m|’m) (?:originally )?from ([\p{L} .'-]{2,60})[.!]?$/iu],['residence',/^i live in ([\p{L} .'-]{2,60})[.!]?$/iu],['name',/^my name is ([\p{L} '-]{2,60})[.!]?$/iu]];
        for(const m of messages||[]){if(m.role!=='user'||m.invalidated||m.timestamp>now||!(m.readAt>0&&m.readAt<=now)||m.playerPersonaId&&m.playerPersonaId!==scope)continue;
            for(const [key,pattern] of rules){const match=String(m.text||'').trim().match(pattern);if(!match||/\b(and|but|not|if|maybe|pretend|visiting)\b/i.test(match[1]))continue;
                const value=match[1].trim().replace(/[.!]+$/,'');const prior=runtime.playerFacts.find(f=>f.personaId===scope&&f.key===key);
                if(prior&&prior.at>=m.timestamp)continue;
                const fact={personaId:scope,key,value,statement:String(m.text).trim(),messageId:m.id,at:m.timestamp};
                if(prior)Object.assign(prior,fact);else runtime.playerFacts.push(fact);
            }
        }
        runtime.playerFacts=runtime.playerFacts.slice(-160);return runtime.playerFacts.filter(f=>f.personaId===scope);
    }
    function playerFactsBrief(runtime,personaId){const facts=(runtime?.playerFacts||[]).filter(f=>f.personaId===(personaId||'__none__'));
        return facts.length?'REMEMBERED PLAYER DETAILS (their direct statements; retain across days, do not ask again without a reason):\n'+facts.map(f=>`${f.key}: ${f.value}`).join('\n'):'';
    }
    return { handoffBrief, physicalBrief, stripPrivateChannels, relationshipGrounding, learnPlayerFacts, playerFactsBrief, decisionContext, decisionBrief, enactChoice, dialogueTurns, dialoguePatterns, dialogueGuidance, assessDialogue, normalize, update, receive, reactionContext, receptiveness, hasAffect, tokens, messageTokens, fitRequest };
});
