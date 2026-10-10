(function () {
    'use strict';

    // Pip's product knowledge is deliberately shipped with Horde Studio. A
    // Tiny runtimes are useful for routing and classification, but are not a
    // product manual and must never invent one from their weights.
    const rawEntries = [
        ['identity', 'What Pip is', 'pip identity llm ai tiny guide handbook knowledge', 'Pip is Horde Studio’s support assistant. Choose its own provider and model in Assistant settings; the selected LLM generates answers grounded in the product knowledge base. Optional semantic embeddings retrieve relevant documentation. Offline knowledge mode uses no LLM. TinyBrain is an independent engine helper and does not generate or route the current Pip conversation.'],
        ['overview', 'What Horde Studio is', 'horde studio overview what app modes frontend', 'Horde Studio is a local-first frontend for three kinds of AI experience: ordinary character and group Chat, persistent Virtual Humans with time and private lives, and simulated Worlds with locations, NPCs and canonical state. Cloud or local providers generate prose and media; the browser stores authored content, sessions and settings.'],
        ['navigation', 'Main navigation', 'sidebar navigation chat library virtual human worlds pip personas customize settings labs', 'The main sidebar opens Chat Library, Virtual Human, Worlds and Pip. Personas, Customize, Labs and Settings are shared utilities. Builders live inside the section they create for, so editing a World or Human does not require a separate global builder page.'],
        ['chat_library', 'Chat Library', 'chat library cards play edit search favorite group room import character', 'Chat Library holds traditional characters and group rooms. Search and filters help find cards; Play starts or resumes a session and Edit opens that character’s Studio. Import Archive restores supported shared packages, while New Character opens the creator flow.'],
        ['chat_sessions', 'Traditional Chat sessions', 'chat session timeline new rename reroll continue memory save clear', 'A Chat can have multiple named sessions. Reroll replaces the most recent assistant turn, Continue asks the model to keep going, and Clear removes the selected session’s history after confirmation. Character authorship is separate from session history.'],
        ['character_studio', 'Character Studio', 'character studio identity prompt first message model parameters reasoning lorebook regex', 'Character Studio defines a traditional character’s identity, portrait, system prompt or structured fields, first message, model and generation controls. Advanced settings include reasoning where supported, lore and memory behavior, and optional presentation or status features.'],
        ['group_rooms', 'Group rooms', 'group room multiple characters speaker knowledge attribution', 'Group Rooms put several authored Chat characters in one conversation. The room prompt and speaker handling keep voices separate, while knowledge barriers stop one character from automatically knowing another character’s private information.'],
        ['chat_hud', 'Optional Chat HUD', 'chat hud meters status sidebar stats traditional labs', 'Traditional Chat can optionally show creator-defined status text and meters in a right sidebar. Traditional extraction reads a constrained private status block from the main reply; Labs mode can propose locally classified updates. Meter changes are bounded and validated before display.'],
        ['personas', 'Personas', 'persona player identity avatar name world chat new session', 'Personas describe who the user is in an experience and may include a name, portrait and background. World New Session Setup makes the Persona choice explicit before play, preventing a timeline from silently starting with the wrong player identity.'],
        ['providers', 'Provider separation', 'provider text image voice separate openrouter gptproto nanogpt nvidia nim aws bedrock custom base url local default', 'Text, image and voice routes are intentionally independent. Settings chooses the default text provider, while Virtual Humans can override conversation and photo providers and Worlds can choose a visual provider. Use Custom API for any OpenAI-compatible text service by entering its base URL, API key, optional headers and exact model ID.'],
        ['openrouter', 'OpenRouter', 'openrouter setup api key models text image tts', 'Add the OpenRouter key in Settings, choose OpenRouter as the default or a per-Human override, then refresh the relevant model picker. Horde Studio reads live model metadata where available and only sends supported generation controls.'],
        ['gptproto', 'GPTProto', 'gptproto setup api key image reference tts text', 'GPTProto has its own key in Settings and can be selected for text, Human photos or World artwork. Image families use different generation and reference transports, so Horde Studio chooses a compatible route from model capability data instead of sending one universal payload.'],
        ['nanogpt', 'NanoGPT', 'nanogpt nano gpt setup api key image reference tts text', 'NanoGPT has its own key and connection test in Settings. It supports text catalogs, image generation, local base64 identity references and neural speech. Selecting NanoGPT for photos does not change a Virtual Human’s explicitly selected conversation provider.'],
        ['nvidia', 'NVIDIA NIM', 'nvidia nim integrate api setup key text model provider', 'NVIDIA NIM is available as a first-class text provider. Add an NVIDIA API key in Settings, run its connection test, select NVIDIA NIM as the default or a Virtual Human override, then choose a model from the live OpenAI-compatible catalog. Image and voice routing remain independent.'],
        ['bedrock', 'Amazon Bedrock', 'amazon aws bedrock mantle region account base url api key text model provider', 'Amazon Bedrock is available through its OpenAI-compatible Mantle endpoint. In Settings, paste the account-specific Mantle Base URL when provided; otherwise Horde Studio derives the regional endpoint. Add a Bedrock API key, test the live catalog, then select or type the exact text model.'],
        ['custom_provider', 'Custom API provider', 'custom provider platform base url api key headers model openai compatible', 'Settings → Custom OpenAI-compatible provider accepts a display name, complete Base URL, bearer API key and optional JSON headers. It discovers models from BASE_URL/models and sends text to BASE_URL/chat/completions. Select a discovered model or type its exact ID. HTTPS is required except for localhost.'],
        ['local_provider', 'Local and self-hosted text', 'local provider ollama lm studio koboldcpp localhost cors offline', 'Settings → Local / Self-hosted connects to an OpenAI-compatible server such as Ollama, LM Studio or KoboldCpp. Use Horde Studio through its localhost launcher rather than file://, start the model server, enable its CORS option, enter the /v1 URL, and run Test Connection.'],
        ['image_models', 'Image model controls', 'image model catalog parameters capability resolution format reference source', 'Image model pickers load the selected provider’s live catalog. Reference readiness and fields such as size, format, seed or quality come from advertised capabilities; unsupported fields are omitted. An exact custom model ID remains available for models too new to appear in the catalog.'],
        ['comfyui', 'ComfyUI workflows', 'comfyui workflow profile local image node prompt reference bridge', 'Settings stores multiple named ComfyUI workflow profiles. Each profile keeps API-format workflow JSON plus prompt and optional LoadImage node mappings. A Virtual Human can choose ComfyUI as its photo source without moving text away from its current provider.'],
        ['mcp_images', 'MCP image providers', 'mcp higgsfield magnific oauth bridge image tool', 'Higgsfield and Magnific connect through the localhost Horde bridge. Their tool schemas are discovered live and mapped to scene prompts and references. OAuth tokens remain in the bridge process and are not written into Horde Studio exports.'],
        ['media_portability', 'Media and portability', 'media image upload normalize resize blank export backup save', 'Uploaded and generated images are normalized before storage. World presentation assets are embedded and deduplicated so portable World packages and full backups retain them. Provider URLs are stabilized when possible because temporary signed URLs can expire. API keys are never included.'],
        ['virtual_human', 'Virtual Humans', 'virtual human overview texting simulator alive relationship life time emotions plutchik anger stress energy intoxication cool off libido desire arousal adult intimacy impulse', 'Virtual Humans are texting simulations rather than ordinary roleplay bots. Each Human combines authored psychology, an evolving relationship, memories, mood, a timezone, an active-life schedule and media permissions. Their live timeline evolves bounded energy, stress, social need, restraint, contextual intoxication and a Plutchik-inspired eight-channel emotion state. An optional adult-only desire system separately models libido, momentary arousal, frustration, post-intimacy calm and expression impulse. Libido never substitutes for attraction, trust or consent, and authored boundaries remain authoritative. These states can change response timing, initiative and tone while the chat contract keeps visible messages in-character. This is behavioral simulation, not literal consciousness or medical brain chemistry.'],
        ['human_emotions', 'Virtual Human emotion architecture', 'plutchik emotion wheel joy trust fear surprise sadness disgust anger anticipation appraisal masking rumination delayed mixed feelings toward player', 'Each Human can feel joy, trust, fear, surprise, sadness, disgust, anger and anticipation at the same time. The engine first appraises what an event meant—goal impact, threat, loss, novelty, norm violation, control, social safety and responsibility—then updates general feelings and player-directed feelings separately. Authored expression style controls masking, rumination controls decay, and reaction timing permits delayed consequences. Blends such as love, remorse or optimism are descriptive labels derived from the channels, not extra meters or forced diagnoses. Private details are visible in Simulation Details, never dumped into immersive text messages.'],
        ['human_studio', 'Virtual Human Studio', 'virtual human studio builder identity relationship life ai models photos voice', 'Virtual Human Studio separates Identity, psychology and relationship authorship from AI & Models, Photos & Voice, and Active Life. The helper builder can expand rough notes, but every generated field remains editable and a Human can be authored manually without an LLM call.'],
        ['human_models', 'Virtual Human conversation model', 'virtual human text model provider thinking parameters reasoning setup', 'A Human can use the global text default or an explicit OpenRouter, GPTProto, NanoGPT, NVIDIA NIM, AWS Bedrock or local provider. Its searchable model screen exposes supported sampling and reasoning controls. Photo selection is independent from this conversation choice.'],
        ['human_relationship', 'Evolving relationships', 'relationship starting context trust warmth attraction resentment stability evolve anger conflict cool off grudge', 'The creator sets a starting relationship and context. Live timelines then track bounded trust, warmth, attraction, resentment and stability plus meaningful relationship events. Separate anger and conflict-recovery state lets a Human cool off quickly, need ordinary space, recover slowly or hold a grudge without permanently rewriting the relationship. These values can rise, fall or diverge by timeline; the model proposes changes, but the engine validates and persists them.'],
        ['human_time', 'Time, silence and ghosting', 'virtual human time timestamp 2am days silence ghost unanswered read late reply sleep', 'Messages keep exact sent, read and reply times in the Human’s timezone. With real-time immersion enabled, sleep and scheduled obligations can delay reading or replies. Long silence is summarized on return, and repeated unanswered messages make the Human pause instead of texting forever as if nothing happened.'],
        ['human_chat_controls', 'Human immersion controls', 'instant chat always replies real time no reply late reply immersion menu', 'The Human chat immersion menu controls how strict the simulation is. Full immersion respects real time, sleep, refusal and delays; Instant Chat guarantees immediate interaction; Always Replies keeps time context but removes missed-response mechanics. These are timeline-level experience choices, not hidden global requirements.'],
        ['active_life', 'Active Life', 'initialize life schedule weekly fashion friends activities wildcard manual edit autonomy health social world', 'Active Life gives a Human a deterministic weekly schedule, routines, travel, wardrobe, wildcard events and a lightweight persistent social world. Friends, family, coworkers and partners retain independent closeness, trust and tension inside each timeline without becoming full chatbots. The local kernel advances ordinary life without model calls. Autonomy Health fast-forwards 2–8 weeks to report likely spam, schedule collisions, impossible travel and call pressure; its report is advisory and never changes the human.'],
        ['human_photos', 'Virtual Human photos', 'photo selfie camera mirror group reference profile permissions ask refuse', 'Profile Image is the small UI portrait; Generation Reference is the identity image sent only to compatible models. Situation-aware camera planning chooses front-camera, mirror, timer, group or plausible third-person framing from location and company. Humans may send, refuse or initiate photos when allowed; disabling photos removes the paid tool.'],
        ['human_voice', 'Calls and voice notes', 'voice note call tts sample audio format phone explicit permission', 'Calls are explicit call sessions, so the Human is told they are speaking live rather than producing narrated TTS. Voice notes are message attachments generated with the selected neural model and voice when played. Audio formats are model-aware, and disabling voice notes removes that paid capability.'],
        ['human_timelines', 'Human timelines', 'virtual human multiple timeline switch reroll reset clear export share', 'Each Human may have multiple timelines with isolated messages, memories, mood and relationship state. Reroll replaces one logical assistant response burst, not an arbitrary number of bubbles. Sharing a Human exports authored identity and settings but excludes private lived timelines; full backup preserves them.'],
        ['worlds', 'Worlds', 'worlds overview sandbox rpg life sim persistent dm kernel', 'Worlds are persistent text simulations built from authored locations, entities, factions, lore, rules and starting lives. The language model acts as narrator, while the World Kernel owns canonical location, time, inventory, stats, quests and NPC state so prose alone cannot silently rewrite reality.'],
        ['world_studio', 'World Studio', 'world studio basics visuals locations entities factions sandbox lore author note ai config hud architect builder', 'World Studio organizes creation into Basics, Visuals, Locations, Entities, Factions, Sandbox, Global Lore, Author’s Note, AI Config, HUD & Stats, World Architect and AI Builder. Save World preserves authorship; Save & Enter World saves and opens play.'],
        ['world_sessions', 'World sessions', 'world timeline new session setup persona starting life reset reroll', 'A World can have multiple persistent timelines. New Session Setup chooses the Persona, Starting Life and opening configuration before initialization, and can be closed without committing. Reroll replays the latest turn from its pre-turn snapshot so canonical mutations are not duplicated.'],
        ['starting_lives', 'Starting Lives', 'starting life origin home family parents class role king peasant create', 'Starting Lives are creator-authored origins, not rigid classes. They may define role, social rank, home location, family context, faction, possessions, stats, duties, privileges and opening scene. New Starting Life is available in World Studio and becomes a choice during New Session Setup.'],
        ['world_movement', 'Movement and travel', 'world kernel location movement travel time exit route bathroom teleport', 'Player movement is resolved against the canonical location graph. The parser identifies the player’s completed movement, validates the destination and route, advances the clock by authored travel time, then commits the new location before narration. Movement by another character must never teleport the player.'],
        ['world_sensor', 'Micro World Sensor', 'micro world sensor tiny brain actor intent destination clothing time malformed json', 'When Labs is enabled, the Micro World Sensor can classify actor, intent, destination, completion, clothing and explicit time from messy prose. It is advisory: deterministic graph and evidence checks still decide canon. Low-confidence, unreachable or malformed output becomes a safe no-op.'],
        ['world_kernel', 'World Kernel', 'game kernel canonical state update tool call ledger location npc outfit time', 'The World Kernel builds a compact authoritative scene packet for each turn, reconciles structured state updates, and rejects impossible changes. It tracks who is where, what changed, current outfit, clock, routes, witnesses and other systems without requiring several expensive full narrative calls.'],
        ['world_npcs', 'NPC persistence and knowledge', 'npc character persistent generated schedule memory knowledge witness speaker attribution', 'Authored and safely generated NPCs receive stable IDs and entity state. Location, schedule, goals, relationships and witnessed facts persist by timeline. Perspective packets prevent knowledge teleportation, while structured speaker data is preferred over fragile quote-only parsing for presentation.'],
        ['world_dice', 'Dice and checks', 'dice roll check difficulty mechanics player roll automatic', 'World creators configure whether and how checks are requested. Player Roll stores a canonical pending check and waits for the Roll button; Automatic mode resolves immediately. The stored result—not an invented number in prose—is then given to the narrator.'],
        ['world_visuals', 'World Visual Presentation', 'world visual cinematic classic background portrait map skin opacity glass avatar color', 'Visual Presentation is an optional skin over the same simulation. Map skins decorate the semantic map; locations can have backgrounds and NPCs portraits and colors. Cinematic cards remain readable over artwork, and Classic Reader remains available when the creator permits player switching.'],
        ['world_audit', 'World Audit', 'world audit structure people society proposal approve reject clear', 'World Audit runs creator-requested Structure, People and Society passes. Results are proposals, not canon: inspect and approve useful changes, reject individual proposals, or clear the batch. The audit should never force unwanted generated material into the World.'],
        ['world_cost', 'World cost control', 'world calls expensive four calls kernel cost status update summary', 'Normal World play aims for one main narrative generation. Deterministic kernel work and optional tiny local classifiers handle state interpretation cheaply; summaries, memory or repair calls are conditional rather than mandatory every turn. Labs diagnostics show local helper activity separately from cloud spending.'],
        ['world_memory', 'World memory and ledger', 'world memory vector ledger summary canon context', 'The World Ledger stores compact canonical developments. Recent messages, relevant ledger entries and retrieved memories are assembled into bounded context, while authoritative engine state remains separate. Summaries reduce prompt size but do not override location, inventory or other canon.'],
        ['world_schedules', 'NPC schedules and living world', 'npc schedule weekly goals factions society evolve living world background', 'NPC schedules determine plausible whereabouts by clock and day. Goals, faction pressure, economy and background simulation can evolve the World between direct encounters, but player-facing canon is surfaced only through valid state and plausible discovery rather than omniscient narration.'],
        ['labs', 'Horde Labs', 'labs local cognition tiny brain shadow assist audit off optional', 'Horde Labs is an optional local cognition layer. Off makes no local calls. Shadow records private classifier results without affecting play. Assist may pass validated hints to the main model. Audit adds the fullest trust diagnostics. Tiny output never writes canonical state by itself.'],
        ['labs_models', 'Labs model sizes', 'tinybrain2 needle embedded tiny brain smollm 135m micro small tier download webgpu wasm contact gate memory continuity', 'TinyBrain 2 is the recommended embedded runtime: Cactus Needle 2, a roughly 14 MB structured tool router stored in browser cache and run through WASM. It handles narrow classifications, memory gates, continuity checks, never final prose. TinyBrain 1 keeps the older SmolLM2 135M compatibility path. Connected local models remain available for generative background tasks that Needle deliberately cannot perform.'],
        ['agency_safety', 'Agency safety and emergency pause', 'pause agency circuit breaker queue backoff spending background emergency', 'Pause agency in the main sidebar immediately stops proactive messages, social posts and background generation while preserving direct replies. The launcher keeps a crash-safe event queue on disk but never saves provider credentials there. Repeated provider failures trigger exponential backoff and an automatic circuit breaker; the daily cap bounds background calls.'],
        ['labs_install', 'Installing TinyBrain 2', 'install needle tinybrain2 embedded tiny brain refresh cached launcher file origin worker', 'Run Horde Studio through the included launcher and open its http://127.0.0.1 page; file:// pages cannot start workers. In Labs choose TinyBrain 2, press Download & install, then enable Labs and begin with Shadow policies. The official Needle runtime and model remain cached in that browser profile and are not included in backups.'],
        ['labs_diagnostics', 'Labs diagnostics', 'labs dashboard receipts malformed json failed tier capability', 'The Labs trust dashboard records task, policy, validity, acceptance and latency. A “needs small tier” receipt means the chosen micro model was intentionally prevented from attempting a harder task. Malformed JSON is rejected and should not alter canon.'],
        ['memory', 'Memory', 'memory vector embedding keyword consolidation threshold top k', 'Horde Studio keeps recent context and durable memories separately. Vector retrieval uses the configured embedding model, similarity threshold and Top-K limit; if embeddings fail, keyword retrieval remains available. Consolidation compresses older material only when buffers need it.'],
        ['reasoning', 'Reasoning and context', 'reasoning thinking context tokens max output parameters', 'Reasoning controls request provider-supported thinking and can increase latency and cost. Context size controls how much history and state is sent. Maximum output tokens includes the visible answer and may also include hidden reasoning depending on the provider.'],
        ['exports', 'Exports, imports and backups', 'export import character virtual human world backup archive timeline api key', 'Share packages contain authored content for the selected Character, Human or World. Virtual Human sharing omits private timeline history; World packages include embedded authored media. Full Backup preserves local application state and timelines. API keys are excluded from every export and backup.'],
        ['security', 'Keys and local privacy', 'api key security remember browser storage backup privacy local', 'Cloud API keys are separate by provider. With Remember Keys off they live only for the browser session; with it on they are stored in the browser’s local database on that device. Keys are never exported. Local model prompts stay on-device or on the explicitly configured local server.'],
        ['tooltips', 'Help and tooltips', 'help tooltip question mark hover focus explanation', 'Hover or keyboard-focus explained controls to open contextual help. Question-mark indicators identify guided fields, and Escape dismisses the current tooltip. Pip complements these short explanations with the deeper built-in handbook.'],
        ['troubleshooting', 'First troubleshooting steps', 'error broken refresh cache console launcher test connection troubleshoot', 'For provider failures, first use that provider’s connection test, confirm the selected model and inspect the visible error. For localhost or Embedded failures, use the launcher instead of file://. After an app update, hard-refresh once so cache-busted scripts replace older files. Avoid repeating paid image requests until the transport error is understood.']
    ];

    const entries = rawEntries.map(([id, title, keywords, text]) => ({ id, title, keywords, text }));
    const stopWords = new Set('a an and are as at be but by can did do does for from had has have how i if in into is it its me my of on or our so than that the their them then there they this to use was we what when where which who why with you your'.split(' '));
    const aliases = Object.freeze({
        bot: ['character', 'chat'], people: ['virtual', 'human'], companion: ['virtual', 'human'],
        person: ['virtual', 'human'], image: ['photo', 'visual'], picture: ['photo', 'visual'],
        voice: ['tts', 'audio'], sound: ['audio', 'tts'], map: ['world', 'location'],
        teleport: ['movement', 'location'], ghost: ['silence', 'unanswered'], relationship: ['trust', 'warmth'],
        offline: ['local', 'embedded'], brain: ['labs', 'model'], lora: ['knowledge', 'handbook'],
        embedding: ['knowledge', 'memory'], delete: ['clear'], reset: ['clear'], nano: ['nanogpt']
    });

    function stem(word) {
        return String(word || '').replace(/(?:ing|ments?|ed|es|s)$/i, '').slice(0, 40);
    }

    function words(value) {
        const base = String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
        const expanded = [];
        base.forEach(word => {
            const clean = stem(word);
            if (clean.length > 1 && !stopWords.has(clean)) expanded.push(clean);
            (aliases[word] || []).forEach(alias => expanded.push(stem(alias)));
        });
        return [...new Set(expanded)];
    }

    const indexed = entries.map(entry => ({
        ...entry,
        keywordTokens: words(entry.keywords),
        textTokens: words(`${entry.title} ${entry.text}`),
        normalized: `${entry.title} ${entry.keywords} ${entry.text}`.toLowerCase()
    }));

    function retrieve(question, limit = 5) {
        const query = words(question);
        if (!query.length) return [];
        const rawQuestion = String(question || '').toLowerCase();
        return indexed.map(entry => {
            let score = 0;
            query.forEach(token => {
                if (entry.keywordTokens.includes(token)) score += 7;
                else if (entry.textTokens.includes(token)) score += 2;
                else if (entry.keywordTokens.some(candidate => candidate.startsWith(token) || token.startsWith(candidate))) score += 3;
            });
            if (rawQuestion.includes(entry.title.toLowerCase())) score += 14;
            if (entry.id === 'overview' && /what is horde|what does horde|explain horde|tell me (?:about )?horde/.test(rawQuestion)) score += 30;
            if (entry.id === 'providers'
                && (rawQuestion.match(/\b(?:openrouter|gptproto|nanogpt|nvidia|nim|aws|bedrock|local)\b/g) || []).length >= 2) score += 28;
            return { id: entry.id, title: entry.title, text: entry.text, score };
        }).filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, Math.max(1, Math.min(8, Number(limit) || 5)));
    }

    function isProductQuestion(question) {
        const text = String(question || '').toLowerCase();
        if (/\b(?:horde studio|pip|openrouter|gptproto|nanogpt|nvidia nim|aws bedrock|comfyui|virtual human|world kernel|horde labs)\b/.test(text)) return true;
        const best = retrieve(question, 1)[0];
        return Number(best?.score || 0) >= 9;
    }

    function answer(question, limit = 3) {
        const matches = retrieve(question, limit);
        if (!matches.length) return entries.find(entry => entry.id === 'overview').text;
        const useful = matches.filter((entry, index) => index === 0 || entry.score >= matches[0].score * 0.62).slice(0, limit);
        return useful.map(entry => `${entry.title}: ${entry.text}`).join('\n\n');
    }

    // Retained for connected larger local models and diagnostics. Product UI
    // uses answer() directly so even a weak model cannot corrupt facts.
    function prompt(question, history = []) {
        const notes = retrieve(question, 4).map((entry, index) => `${index + 1}. ${entry.title}: ${entry.text}`).join('\n');
        const recent = (Array.isArray(history) ? history : []).slice(-4)
            .map(item => `${item.role === 'assistant' ? 'Pip' : 'User'}: ${String(item.text || '').slice(0, 500)}`).join('\n');
        return {
            system: 'You are Pip, a friendly local Horde Studio guide. Product facts must stay grounded in GUIDE NOTES. Never invent controls or rewrite a note into a contradictory claim. You may converse naturally outside product help. Use at most 140 words.',
            input: `GUIDE NOTES:\n${notes}\n\n${recent ? `RECENT CHAT:\n${recent}\n\n` : ''}QUESTION:\n${String(question || '').slice(0, 1200)}\n\nANSWER:`
        };
    }

    function fallback(question) {
        return answer(question, 2);
    }

    window.HordeLabsGuide = Object.freeze({
        retrieve, answer, prompt, fallback, isProductQuestion,
        entryCount: entries.length,
        handbookVersion: 3
    });
})();
