(function () {
    'use strict';

    // Explanations live in one registry so dynamically-rendered controls and
    // static Studio fields speak the same language. Existing title attributes
    // and nearby form hints remain valid sources and are upgraded automatically.
    const HELP_BY_ID = Object.freeze({
        'sidebar-home-btn': 'Return to Chat Library without deleting or resetting the current conversation.',
        'labs-modal-btn': 'Configure optional tiny local models that classify narrow signals. Labs never replaces your main roleplay model.',
        'global-settings-btn': 'Configure providers, API keys, local servers, image engines, MCP connections, memory and global behavior.',
        'context-meter': 'Shows how much of the selected model’s context window this conversation currently occupies.',
        'roll-dice-btn': 'Roll the chat’s configured die. In Worlds, use the World Roll button so the authoritative rules engine can consume a pending check.',
        'continue-chat-btn': 'Ask the character to continue naturally without adding a user message.',
        'impersonate-btn': 'Ask the model to draft a possible next message for your active Persona. You can edit it before sending.',
        'toggle-headers-btn': 'Show or hide technical message metadata such as model, timing and token information.',
        'summarize-chat-btn': 'Compress older conversation history into a durable summary to preserve context and reduce token usage.',
        'open-vector-memory-btn': 'Inspect memories retrieved for this session, search them, and test similarity matching.',
        'reroll-chat-btn': 'Generate another version of the last assistant turn while retaining prior takes for navigation.',
        'toggle-chat-hud-btn': 'Show or hide optional status meters configured for this character.',
        'download-chat-btn': 'Download a portable transcript of the active conversation.',
        'clear-history-btn': 'Permanently clear this conversation’s message history after confirmation.',
        'open-in-studio-btn': 'Open the active character in Character Studio without ending this conversation.',

        'world-context-meter-wrap': 'Shows how much of the World model’s context window the compiled scene packet currently occupies.',
        'world-roll-btn': 'Resolve the pending authoritative check using this World’s configured dice rules. If no check is pending, opens a manual roll.',
        'world-continue-btn': 'Advance the scene without a new player action. The clock and living-world systems may still progress.',
        'world-session-zero-btn': 'Review the timeline’s Persona, Starting Life and story preferences. Existing canonical history is not silently rewritten.',
        'world-map-btn': 'Open the interactive canonical map. Routes come from authored world connections, not narrative guesses.',
        'world-reroll-btn': 'Regenerate the latest DM response and restore the turn snapshot before applying the replacement.',
        'world-toggle-headers-btn': 'Show or hide technical metadata attached to World messages.',
        'world-presentation-btn': 'Switch between Classic reading mode and the World’s optional visual presentation.',
        'world-system-btn': 'Inject a one-time system instruction into the next World turn. Use carefully; it has high priority.',
        'world-summarize-btn': 'Create a compact summary of older World history while retaining canonical engine state.',
        'world-open-vector-memory-btn': 'Inspect semantic memories available to the current World timeline.',
        'world-download-btn': 'Download the current World transcript. This does not export the complete editable World package.',
        'world-clear-btn': 'Clear this timeline’s play history after confirmation. The authored World remains installed.',
        'world-hud-toggle': 'Show or hide the clock, location, stats, inventory, quests and other canonical state panels.',
        'w-hud-adjust-time-btn': 'Manually move the canonical World clock forward or backward. NPC schedules recalculate from the new time.',

        'w-visual-enabled': 'Enable backgrounds, portraits, colored dialogue cards and other presentation assets for this World. Simulation rules are unchanged.',
        'w-visual-player-override': 'Allow players to return to Classic view for accessibility or performance. Disable to enforce the creator’s recommended presentation.',
        'w-visual-mode': 'Choose the presentation layout recommended when this World opens. Classic remains the safest text-first mode.',
        'w-visual-art-style': 'A short style label added to generated visual prompts to keep World artwork coherent.',
        'w-visual-art-direction': 'The shared visual bible for generated locations and portraits: medium, palette, era, framing, costume and exclusions.',
        'w-visual-map-skin-generate': 'Generate a decorative map texture using this World’s image provider. It never changes routes or location data.',
        'w-visual-image-provider': 'Select only the provider used for this World’s generated artwork. The DM text model can remain on another provider.',
        'w-visual-image-model': 'Image model used for World map skins, locations and portraits. Compatibility is read from the selected provider when available.',
        'w-visual-background-dim': 'Darken location artwork behind text. Higher values improve readability but hide more of the image.',
        'w-visual-panel-opacity': 'Set narrative-card opacity. Higher values improve contrast; lower values reveal more background artwork.',
        'w-sandbox-enabled': 'Enable persistent sandbox simulation systems such as factions, growth, conflict, law and seasons.',
        'w-sandbox-politics': 'Allow factions and political relationships to change as consequences accumulate.',
        'w-sandbox-conflict': 'Allow off-screen conflicts and pressure to evolve between turns.',
        'w-sandbox-law': 'Track legal status, authority, crime and institutional consequences when the World defines them.',
        'w-sandbox-seasons': 'Advance seasons from the canonical World calendar.',
        'w-sandbox-growth': 'Allow the World to register newly established locations, people and institutions as play expands.',
        'w-sandbox-scale': 'Controls how broadly background simulation looks beyond the player’s immediate scene.',
        'w-kernel-enabled': 'Compile a compact authoritative scene packet each turn instead of resending the entire World.',
        'w-kernel-location-limit': 'Maximum number of relevant locations included in a normal scene packet. Current, adjacent and named places are prioritized.',
        'w-kernel-memory-mode': 'Controls when semantic memories are retrieved for the DM prompt.',
        'w-kernel-repair-mode': 'Controls if and when a secondary repair pass may correct malformed structured updates.',
        'w-kernel-compact-tools': 'Use smaller tool descriptions to reduce prompt cost while preserving the same canonical operations.',
        'w-agent-enabled': 'Allow optional background World evolution between foreground turns. This may make additional model calls.',
        'w-agent-interval': 'Number of player turns between background World Agent passes.',
        'w-agent-model': 'Optional cheaper model for background World evolution. Blank uses the World’s DM model.',
        'w-studio-reasoning': 'Request provider-supported reasoning for the DM. It can improve planning but increases latency and token use.',
        'w-studio-reasoning-effort': 'How much provider-supported reasoning effort to request when reasoning is enabled.',
        'w-studio-context-size': 'Maximum conversation context sent to the DM. Larger values preserve more text but may cost more.',
        'w-rules-profile': 'Choose a starting bundle of optional mechanics. You can still customize every module below.',
        'w-rules-vital-stat': 'Stat treated as health or vitality by defeat rules. Leave blank if the World has no health system.',
        'w-rules-zero-hp-mode': 'What canonical state is applied when the vital stat reaches zero.',
        'w-dice-resolution': 'Choose whether checks are disabled, automatically resolved, or paused for the player to roll.',
        'w-dice-sides': 'Default die used for World checks, such as d20 or d6.',
        'w-dice-modifier-mode': 'Controls how character stats contribute to authoritative check totals.',
        'w-dice-default-difficulty': 'Default target number when a requested check does not specify one.',
        'w-dice-criticals': 'Enable natural critical success and failure rules for the highest and lowest die faces.',
        'run-world-audit-btn': 'Run optional Structure, People and Society reviews. Proposed changes remain pending until you approve them.',
        'w-builder-generate-btn': 'Ask the selected builder model to turn your description into a complete editable World draft.',
        'w-builder-apply-btn': 'Replace the current editable World fields with the reviewed builder result.',
        'w-builder-merge-btn': 'Merge missing or new builder material into the current World without replacing populated fields.',

        'studio-advanced-mode': 'Free Form exposes one complete system prompt. Structured Mode separates identity, personality and scenario into guided fields.',
        'studio-model': 'Text model used by this character. It can differ from models used by Worlds and Virtual Humans.',
        'studio-system-preset': 'Apply modular behavioral instructions without replacing the character’s authored identity.',
        'studio-reasoning': 'Request provider-supported reasoning before the character replies. This may use more tokens.',
        'studio-include-reasoning': 'Show provider-returned reasoning text in chat. Leave off for immersion and privacy.',
        'studio-context-size': 'Maximum recent conversation context available to the character model.',
        'studio-chat-hud-enabled': 'Enable optional private status text and meters beside this normal chat.',
        'studio-chat-hud-controller': 'Traditional uses the main response format; Labs can use a configured local model for narrow meter classification.',
        'summarize-memory-btn': 'Ask the configured summarizer to create a concise durable memory from current conversation context.',
        'studio-authors-note': 'High-priority guidance injected near the end of the prompt to steer the current writing style or situation.',
        'studio-authors-note-depth': 'How many messages back the Author’s Note is inserted. Zero places it nearest the newest prompt.',
        'studio-authors-note-freq': 'How often the Author’s Note is injected. One means every response.',

        'cs-photo-input': 'Profile photo shown in Horde Studio. It is not sent to an image model as an identity reference.',
        'cs-reference-input': 'Generation reference sent to compatible image models to preserve this human’s appearance.',
        'cs-sleep-archetype': 'Seeds sleep and wake timing used by real-time availability, delayed replies and autonomous life simulation.',
        'cs-regulation-profile': 'Controls how strongly events move live stress and anger. It changes simulation sensitivity without replacing the authored personality.',
        'cs-conflict-recovery': 'Controls how quickly anger decays and how long a genuine cool-off may last after conflict.',
        'cs-alcohol-pattern': 'Allows established drinking activities to affect intoxication and restraint. None prevents schedule-based alcohol effects; it never makes them drink by itself.',
        'cs-emotion-expression': 'Controls how closely visible behavior reflects private feelings. Guarded, masked and performative humans can feel strongly without saying so directly.',
        'cs-rumination-style': 'Controls how long anger, sadness and disgust tend to linger after meaningful events. It does not manufacture grievances or override new evidence.',
        'cs-reaction-timing': 'Controls whether emotional consequences arrive immediately, variably, or after private processing. Delayed reactions remain attached to their original trigger.',
        'cs-emotional-granularity': 'Controls how finely the Human distinguishes mixed feelings. Contradictory allows opposing feelings to coexist; it does not mean random or unstable behavior.',
        'cs-libido-enabled': 'Opt into an adult-only private desire simulation. It is unavailable without an explicit age of 18 or older and remains off for existing characters.',
        'cs-libido-baseline': 'Sets typical libido pressure. This does not create attraction, trust, consent or automatic sexual behavior.',
        'cs-desire-pattern': 'Spontaneous desire can arise on its own; responsive desire grows mainly from relevant context; mixed allows both.',
        'cs-sexual-confidence': 'Controls how readily private desire becomes visible communication. It does not change boundaries.',
        'cs-sexual-risk': 'Controls how strongly desire and lowered restraint can produce impulsive decisions that may later feel awkward or regrettable.',
        'cs-sexual-initiative': 'Permit high desire and impulse to influence autonomous outreach when general initiative is enabled. Normal silence limits, boundaries and media permissions still apply.',
        'cs-intimacy-boundaries': 'Author hard limits, preferences, privacy expectations and contexts this person will not initiate. These remain authoritative even at high arousal.',
        'cs-custom-location-mode': 'Use a fictional or unlisted home location instead of selecting a real place from search.',
        'cs-timezone': 'IANA timezone used for their clock, sleep, schedule and awareness of when messages arrived.',
        'cs-relationship-start': 'Initial relationship state for a new timeline. It may improve, deteriorate or transform through play.',
        'cs-initiative-mode': 'Controls how readily this human starts conversations, follows up or sends something without being prompted.',
        'cs-always-on-enabled': 'Opt this human into the local background runtime. It has no effect unless the global Always-on master switch is enabled and the launcher remains running.',
        'cs-web-access': 'Allow this human to search the internet for current links, memes or videos when the runtime supports it.',
        'cs-private-life': 'Allow off-screen routines, obligations, friends and events to progress between conversations.',
        'cs-initialize-life-btn': 'Generate an editable life scaffold—schedule, places, relationships, wardrobe and wildcard events—using the selected builder model.',
        'cs-start-life-manual-btn': 'Create the same editable life structure without making an LLM call.',
        'cs-use-global-model': 'Use the default text provider and model from Settings. Image and voice providers remain independent.',
        'cs-text-provider': 'Provider used only for this human’s text replies and cognition.',
        'cs-text-model': 'Text model used for messages, calls and autonomous decisions. This does not select the image or TTS model.',
        'cs-model-reasoning': 'Request provider-supported reasoning for complex human decisions. It may increase latency and cost.',
        'cs-photo-style': 'Prompt style appended to photos this human sends. It does not alter their profile image.',
        'cs-photo-capture-policy': 'Controls whether camera perspective is chosen from context or forced to a particular style.',
        'cs-allow-photos': 'Permit this human to consider sending generated photos. Disabling removes the capability and prevents image costs.',
        'cs-allow-voice-notes': 'Permit generated voice notes. Disabling removes the capability and prevents TTS costs.',
        'cs-image-source': 'Provider or local engine used only for this human’s generated photos.',
        'cs-image-model': 'Image model used for photos. Reference-image support and accepted parameters depend on the selected provider endpoint.',
        'cs-photo-test-use-reference': 'Send the generation reference with this test. Disable to distinguish provider reference filtering from ordinary image generation.',
        'cs-photo-reference-fallback': 'If a provider rejects the identity reference, optionally retry without it. The fallback may reduce visual identity consistency.',
        'cs-tts-mode': 'Choose browser speech, your active cloud provider, or a dedicated local OpenAI-compatible speech server. Text, image and voice providers remain independent.',
        'cs-tts-model': 'Model used only for voice notes and calls. Changing an image or text model will not change the voice.',
        'cs-tts-response-format': 'Audio container requested from the provider. Horde Studio normalizes or decodes supported formats when possible.',
        'cs-builder-model': 'Model used to turn your notes into an editable Virtual Human. It does not become their chat model automatically.',

        'global-api-provider': 'Default provider for text models. Choose Custom API for any OpenAI-compatible service. Individual Worlds and Virtual Humans may override text, image and voice independently.',
        'global-nanogpt-key': 'NanoGPT key used only when NanoGPT is selected for text, images or neural speech. It does not replace your OpenRouter or GPTProto key.',
        'test-nanogpt-conn-btn': 'Verify this NanoGPT key and load its live model catalog without changing your current default provider.',
        'global-nvidia-key': 'NVIDIA API key used for the hosted NIM text catalog and chat completions. Image and voice providers stay independent.',
        'test-nvidia-conn-btn': 'Verify the NVIDIA NIM key against NVIDIA’s live OpenAI-compatible model catalog.',
        'global-bedrock-key': 'Amazon Bedrock API key for its OpenAI-compatible Mantle endpoint. Do not enter IAM access-key or secret-key credentials.',
        'global-bedrock-region': 'AWS region used only when no account-specific Mantle Base URL is supplied.',
        'global-bedrock-base-url': 'Optional complete account-specific Bedrock Mantle base URL. This overrides the URL derived from AWS Region.',
        'global-custom-provider-name': 'A friendly label shown anywhere this custom text provider is selected.',
        'global-custom-base-url': 'Complete OpenAI-compatible API base URL, usually ending in /v1. Horde Studio appends /models and /chat/completions.',
        'global-custom-api-key': 'Optional bearer token for the custom provider. It follows Remember Keys and is never exported.',
        'global-custom-headers': 'Optional JSON object of additional request headers. Treat these as secrets: they follow Remember Keys and are excluded from exports.',
        'test-custom-conn-btn': 'Calls BASE_URL/models with the current key and headers without saving them first.',
        'test-bedrock-conn-btn': 'Verify the Bedrock API key and region by loading that region’s compatible model catalog.',
        'remember-api-key': 'Persist API keys in this browser profile. Keys are never included in Horde exports or backups.',
        'global-local-generation-timeout': 'Maximum idle time for a local World generation. The timer resets whenever data arrives; zero disables automatic cancellation.',
        'global-embedding-url': 'Optional separate OpenAI-compatible server used only for vector embeddings. Leave blank to use the active text provider.',
        'global-embedding-key': 'Optional bearer token for the separate embedding server. It is excluded from backups and exports.',
        'global-embedding-model': 'Embedding model sent to the dedicated embedding server or, when no separate URL is set, the active text provider.',
        'test-embedding-conn-btn': 'Send one real embedding request and verify that the server returns a usable vector.',
        'global-local-tts-url': 'Dedicated OpenAI-compatible local speech base URL, normally ending in /v1. This does not change the text provider.',
        'global-local-tts-key': 'Optional bearer token for the local speech server. Most loopback VibeVoice-style servers do not require one.',
        'test-local-tts-btn': 'Check the local speech server catalog. Generate a preview in Virtual Human Studio to verify audio decoding end to end.',
        'global-mcp-bridge-url': 'Local Horde bridge used to reach configured MCP image providers without exposing OAuth tokens to the page.',
        'global-companion-always-on': 'Master switch for optional Virtual Human agency after the browser closes. The local launcher must stay running and provider calls may cost credits.',
        'global-always-on-daily-limit': 'Hard maximum number of background text-model calls the launcher may make per local calendar day.',
        'global-always-on-minimum-minutes': 'Minimum cooldown between background model calls for one Virtual Human. Higher values reduce cost and message frequency.',
        'always-on-stop-btn': 'Immediately disables background agency and removes provider credentials from the launcher’s memory.',
        'pause-all-agency-btn': 'Emergency control for proactive behavior. Pausing stops autonomous messages, social posts, life beats and launcher generation, but you can still message a Virtual Human and receive direct replies.',
        'global-local-image-url': 'Base URL for an OpenAI-compatible local image server.',
        'global-comfy-profile': 'Saved ComfyUI workflow and node mapping. Switch profiles without replacing other workflows.',
        'global-comfy-url': 'Address of ComfyUI on this computer or a private LAN IP. Remote ComfyUI must listen on the LAN (commonly with --listen 0.0.0.0) and expose port 8188 through its firewall.',
        'global-comfy-workflow': 'ComfyUI API workflow JSON. Browser-exported UI workflow JSON is not always compatible.',
        'global-comfy-prompt-node': 'Node ID receiving Horde Studio’s generated positive prompt.',
        'global-comfy-reference-node': 'Optional LoadImage node ID receiving an identity reference.',

        'labs-enabled': 'Master switch for optional local cognition. Off preserves normal Horde Studio behavior exactly.',
        'labs-base-url': 'Loopback OpenAI-compatible endpoint for Ollama, LM Studio, llama.cpp or KoboldCpp.',
        'labs-model-search': 'Tiny local model used only for bounded classification tasks, never for primary roleplay prose.',
        'labs-embedded-device': 'Automatic prefers WebGPU and falls back to CPU/WASM. Force a backend only when troubleshooting compatibility.',
        'labs-policy-chat': 'Choose how local cognition may participate in ordinary Chat Library conversations.',
        'labs-policy-worlds': 'Choose how the local World Sensor may classify actor, intent, destination, clothing and completion state.',
        'labs-policy-humans': 'Choose how local cognition may interpret subtext for Virtual Humans.',
        'labs-budget': 'Hourly local-call ceiling and prompt/output size preset. It limits device work, not cloud-provider spending.',
        'labs-diagnostics-enabled': 'Keep timing, validity and task results without storing the original prompt text.',
        'labs-clear-diagnostics-btn': 'Delete the local Labs trust-dashboard history. This does not change models or policies.',
        'labs-guide-send-btn': 'Send this question to Pip. Horde Studio facts come directly from the built-in handbook so a tiny model cannot distort them.',
        'pip-clear-chat-btn': 'Clear Pip’s messages in this tab and restore his welcome message. This does not remove the Tiny Brain or any Horde Studio data.',
        'pip-sidebar-btn': 'Open Pip, the always-available private guide. Pip answers from built-in Horde Studio notes and can optionally polish them with your local Tiny Brain.'
    });

    const VALUE_HELP = Object.freeze({
        'labs-policy-chat': {
            off: 'Off: Chat never calls the local cognition model.',
            shadow: 'Shadow: runs classifications privately for diagnostics, but does not use their results.',
            assist: 'Assist: validated classifications may become private hints for the main model; they never become canonical state.'
        },
        'labs-policy-worlds': {
            off: 'Off: Worlds use only deterministic parsing and the main DM model.',
            shadow: 'Shadow: runs the World Sensor and records validity, but its result cannot affect the turn.',
            assist: 'Assist: a validated World Sensor result may clarify actor, intent, destination or clothing before deterministic validation.',
            audit: 'Audit: currently uses the same guarded hints as Assist while retaining the most detailed trust diagnostics. Local output is still non-canonical.'
        },
        'labs-policy-humans': {
            off: 'Off: Virtual Humans never call the local cognition model.',
            shadow: 'Shadow: measures local classifications without using them in replies.',
            assist: 'Assist: validated social signals may subtly guide the main model without exposing scores or creating facts.'
        },
        'w-dice-resolution': {
            off: 'Disabled: the World does not create authoritative dice checks.',
            automatic: 'Automatic: the engine resolves requested checks immediately and supplies the result to the DM.',
            player: 'Player roll: the DM pauses at a requested check and the Roll button resolves it.'
        },
        'cs-photo-capture-policy': {
            auto: 'Context aware: chooses front camera, mirror, timer, group or photographer based on who and what is actually present.',
            selfie: 'Prefer a front-camera selfie when plausible.',
            mirror: 'Prefer a mirror selfie when a mirror is available.',
            third_person: 'Prefer a photo taken by another present person when plausible.'
        }
    });

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    let tooltip;
    let activeTarget;
    let describedTarget;
    let oldDescribedBy;

    function valueHelp(element) {
        return VALUE_HELP[element?.id]?.[element.value] || '';
    }

    function nearbyHint(element) {
        const parent = element.closest('label, article, .form-section, .settings-group, .setting-group, .form-grid > div');
        const hint = parent?.querySelector('.form-hint, small');
        const text = clean(hint?.textContent);
        return text && text.length <= 420 ? text : '';
    }

    function explanationFor(element) {
        return valueHelp(element)
            || HELP_BY_ID[element.id]
            || clean(element.getAttribute('data-help'))
            || clean(element.getAttribute('title'))
            || nearbyHint(element);
    }

    function enhanceElement(element) {
        if (!(element instanceof Element)) return;
        const explanation = explanationFor(element);
        if (!explanation) return;
        element.dataset.help = explanation;
        if (element.hasAttribute('title')) element.removeAttribute('title');
        if (!element.getAttribute('aria-label') && !clean(element.textContent)
            && ['BUTTON', 'A', 'SUMMARY'].includes(element.tagName)) {
            element.setAttribute('aria-label', explanation.split(/[.!?]/)[0]);
        }
        let label = element.labels?.[0]
            || (element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null)
            || element.closest('label');
        if (!label) {
            const siblings = [...(element.parentElement?.children || [])];
            const position = siblings.indexOf(element);
            label = siblings.slice(0, position).reverse()
                .find(candidate => candidate.matches?.('label, .form-label')) || null;
        }
        if (label && label !== element) label.dataset.help = explanation;
    }

    function enhance(root = document) {
        if (root instanceof Element) enhanceElement(root);
        const selector = '[data-help], [title], button, a, summary, select, input, textarea, .form-label';
        root.querySelectorAll?.(selector).forEach(enhanceElement);
    }

    function position(target, pointer) {
        if (!tooltip || tooltip.hidden) return;
        const rect = target.getBoundingClientRect();
        const box = tooltip.getBoundingClientRect();
        const gap = 10;
        let left = pointer?.clientX != null ? pointer.clientX + 14 : rect.left + Math.min(rect.width / 2, 80);
        let top = pointer?.clientY != null ? pointer.clientY + 18 : rect.bottom + gap;
        if (left + box.width > innerWidth - 10) left = innerWidth - box.width - 10;
        if (left < 10) left = 10;
        if (top + box.height > innerHeight - 10) top = Math.max(10, rect.top - box.height - gap);
        tooltip.style.left = `${Math.round(left)}px`;
        tooltip.style.top = `${Math.round(top)}px`;
    }

    function show(target, event) {
        if (!target?.dataset?.help) return;
        activeTarget = target;
        tooltip.textContent = target.dataset.help;
        tooltip.hidden = false;
        tooltip.classList.add('visible');
        if (event?.type === 'focusin') {
            describedTarget = target;
            oldDescribedBy = target.getAttribute('aria-describedby');
            target.setAttribute('aria-describedby', [oldDescribedBy, tooltip.id].filter(Boolean).join(' '));
        }
        requestAnimationFrame(() => position(target, event));
    }

    function hide(target) {
        if (target && activeTarget !== target) return;
        tooltip.hidden = true;
        tooltip.classList.remove('visible');
        if (describedTarget) {
            if (oldDescribedBy) describedTarget.setAttribute('aria-describedby', oldDescribedBy);
            else describedTarget.removeAttribute('aria-describedby');
        }
        activeTarget = describedTarget = null;
        oldDescribedBy = null;
    }

    function start() {
        tooltip = document.createElement('div');
        tooltip.id = 'horde-context-tooltip';
        tooltip.className = 'horde-context-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.hidden = true;
        document.body.appendChild(tooltip);
        enhance();

        const enter = event => {
            const target = event.target.closest?.('[data-help]');
            if (target) show(target, event);
        };
        const leave = event => {
            const target = event.target.closest?.('[data-help]');
            if (target && !target.contains(event.relatedTarget)) hide(target);
        };
        // mouseover is the compatibility path for older Safari/WebViews;
        // pointerover keeps pen and modern pointer devices equally capable.
        document.addEventListener('mouseover', enter, true);
        document.addEventListener('pointerover', enter, true);
        document.addEventListener('pointermove', event => {
            if (activeTarget && !tooltip.hidden) position(activeTarget, event);
        });
        document.addEventListener('mouseout', leave, true);
        document.addEventListener('pointerout', leave, true);
        document.addEventListener('focusin', event => {
            const target = event.target.closest?.('[data-help]');
            if (target) show(target, event);
        }, true);
        document.addEventListener('focusout', event => hide(event.target.closest?.('[data-help]')), true);
        document.addEventListener('change', event => {
            if (!event.target?.matches?.('select')) return;
            enhanceElement(event.target);
            if (activeTarget === event.target) show(event.target, event);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') hide();
        });

        new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) enhance(node);
        }))).observe(document.body, { childList: true, subtree: true });
    }

    window.HordeHelp = Object.freeze({ enhance, explanationFor, registrySize: Object.keys(HELP_BY_ID).length });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
