(function () {
    'use strict';

    let host = null;
    let draft = null;
    let models = [];
    let embeddedInstalled = false;
    let needleInstalled = false;
    let needleAdapterPromise = null;
    let guideBusy = false;
    let guideEpoch = 0;
    const guideHistory = [];
    const EMBEDDED_MARKER_KEY = 'horde_labs_embedded_model_v1';
    const NEEDLE_MARKER_KEY = 'horde_labs_needle2_v1';

    const FILE_RUNTIME_MESSAGE = 'Embedded Tiny Brain needs Horde Studio’s local app server. Close this file:// tab and run “Start Horde Studio” from the app folder, then install it from the http://127.0.0.1:43127 page that opens.';

    function embeddedMarker() {
        try {
            const marker = JSON.parse(localStorage.getItem(EMBEDDED_MARKER_KEY) || 'null');
            return marker?.model === 'HuggingFaceTB/SmolLM2-135M-Instruct' && marker?.dtype === 'q4';
        } catch (_) { return false; }
    }

    function setEmbeddedMarker(installed) {
        try {
            if (installed) localStorage.setItem(EMBEDDED_MARKER_KEY, JSON.stringify({
                model: 'HuggingFaceTB/SmolLM2-135M-Instruct', dtype: 'q4', installedAt: Date.now()
            }));
            else localStorage.removeItem(EMBEDDED_MARKER_KEY);
        } catch (_) {}
    }

    function needleMarker() {
        try { return JSON.parse(localStorage.getItem(NEEDLE_MARKER_KEY) || 'null')?.version === '2.0.3'; }
        catch (_) { return false; }
    }

    function setNeedleMarker(installed) {
        try {
            if (installed) localStorage.setItem(NEEDLE_MARKER_KEY, JSON.stringify({ version: '2.0.3', installedAt: Date.now() }));
            else localStorage.removeItem(NEEDLE_MARKER_KEY);
        } catch (_) {}
    }

    const byId = id => document.getElementById(id);
    const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));

    function validNeedleAdapter(adapter = window.HordeLabsNeedle) {
        return !!adapter
            && typeof adapter.install === 'function'
            && typeof adapter.status === 'function'
            && typeof adapter.remove === 'function'
            && typeof adapter.completeStructured === 'function';
    }

    function loadNeedleAdapter() {
        if (validNeedleAdapter()) return Promise.resolve(window.HordeLabsNeedle);
        if (needleAdapterPromise) return needleAdapterPromise;
        needleAdapterPromise = new Promise((resolve, reject) => {
            const finish = () => {
                if (validNeedleAdapter()) return resolve(window.HordeLabsNeedle);
                reject(new Error('TinyBrain 2 runtime adapter loaded without its required API. Download a complete current portable release.'));
            };
            const existing = document.querySelector('script[data-horde-needle-adapter]');
            if (existing) {
                existing.addEventListener('load', finish, { once: true });
                existing.addEventListener('error', () => reject(new Error('TinyBrain 2 runtime adapter could not be loaded. Download a complete current portable release.')), { once: true });
                setTimeout(finish, 0);
                return;
            }
            const script = document.createElement('script');
            script.src = new URL('labs-needle.js?v=20260822-v161', document.baseURI).href;
            script.async = true;
            script.dataset.hordeNeedleAdapter = 'true';
            script.addEventListener('load', finish, { once: true });
            script.addEventListener('error', () => reject(new Error('TinyBrain 2 runtime adapter is missing. Keep index.html, labs-needle.js, labs-needle-worker.js and the launcher together.')), { once: true });
            document.head.appendChild(script);
        }).catch(error => {
            needleAdapterPromise = null;
            throw error;
        });
        return needleAdapterPromise;
    }

    function configFromForm() {
        return window.HordeLabs.normalizeConfig({
            enabled: byId('labs-enabled').checked,
            runtime: document.querySelector('input[name="labs-runtime"]:checked')?.value || 'connected',
            baseUrl: byId('labs-base-url').value,
            apiKey: byId('labs-api-key').value,
            model: byId('labs-model-search').value,
            embeddedDevice: byId('labs-embedded-device').value,
            needleConfidence: Number(byId('labs-needle-confidence').value) / 100,
            budget: byId('labs-budget').value,
            policies: {
                chat: byId('labs-policy-chat').value,
                worlds: byId('labs-policy-worlds').value,
                humans: byId('labs-policy-humans').value
            },
            diagnosticsEnabled: byId('labs-diagnostics-enabled').checked,
            pauseWithLocalGeneration: true,
            maxBackgroundCallsPerHour: draft?.maxBackgroundCallsPerHour,
            foregroundDeadlineMs: draft?.foregroundDeadlineMs,
            backgroundDeadlineMs: draft?.backgroundDeadlineMs
        });
    }

    function fillForm(config) {
        draft = window.HordeLabs.normalizeConfig(config);
        byId('labs-enabled').checked = draft.enabled;
        byId('labs-base-url').value = draft.baseUrl;
        byId('labs-api-key').value = draft.apiKey;
        byId('labs-model-search').value = draft.model;
        byId('labs-embedded-device').value = draft.embeddedDevice;
        byId('labs-needle-confidence').value = Math.round(draft.needleConfidence * 100);
        byId('labs-needle-confidence-value').textContent = `${Math.round(draft.needleConfidence * 100)}%`;
        document.querySelectorAll('input[name="labs-runtime"]').forEach(input => { input.checked = input.value === draft.runtime; });
        byId('labs-budget').value = draft.budget;
        byId('labs-policy-chat').value = draft.policies.chat;
        byId('labs-policy-worlds').value = draft.policies.worlds;
        byId('labs-policy-humans').value = draft.policies.humans;
        byId('labs-diagnostics-enabled').checked = draft.diagnosticsEnabled;
        renderRuntime();
        renderStatus(draft);
    }

    function renderRuntime() {
        const runtime = document.querySelector('input[name="labs-runtime"]:checked')?.value || 'needle';
        const embedded = runtime === 'embedded';
        const needle = runtime === 'needle';
        ['labs-connected-setup', 'labs-connected-actions', 'labs-connected-model'].forEach(id => byId(id).classList.toggle('hidden', embedded || needle));
        byId('labs-embedded-setup').classList.toggle('hidden', !embedded);
        byId('labs-needle-setup').classList.toggle('hidden', !needle);
        document.querySelectorAll('.labs-runtime-card').forEach(card => card.classList.toggle('selected', card.querySelector('input')?.checked));
        renderStatus(configFromForm());
        if (embedded) void refreshEmbeddedStatus();
        if (needle) void refreshNeedleStatus();
    }

    function renderStatus(config = configFromForm(), connection) {
        const enabled = config.enabled;
        const embedded = config.runtime === 'embedded';
        const needle = config.runtime === 'needle';
        const configured = needle ? needleInstalled : embedded ? embeddedInstalled : !!config.model;
        const dot = byId('labs-status-dot');
        dot.className = `labs-status-dot ${enabled && configured ? 'ready' : enabled ? 'waiting' : ''}`;
        byId('labs-status-label').textContent = !enabled ? 'Local cognition is off'
            : connection?.ok ? `Connected · ${connection.latencyMs} ms`
            : configured ? (needle ? 'TinyBrain 2 is ready' : embedded ? 'Legacy Tiny Brain is ready' : 'Ready to use local cognition')
            : needle ? 'Install TinyBrain 2' : embedded ? 'Install the legacy Tiny Brain' : 'Choose a local model';
        byId('labs-status-copy').textContent = !enabled
            ? 'Normal Horde Studio behavior is unchanged.'
            : needle ? 'Needle routes structured events locally. Horde validates every proposal before it can assist.'
            : embedded ? 'Cognition stays on this device. Your main text, image and voice settings are untouched.'
            : 'Only enabled modes may call this local server. Cloud text, image and voice settings are untouched.';
        const tier = window.HordeLabs.capabilityTier(needle ? 'needle2' : embedded ? 'smollm2-135m' : config.model);
        byId('labs-tier-badge').textContent = configured ? `${tier === 'unknown' ? 'Unrated' : tier} tier` : 'No model';
        const capabilityBox = byId('labs-capability-summary');
        if (capabilityBox) {
            const capabilities = configured ? window.HordeLabs.taskCapabilities(config) : [];
            const labels = {
                world_micro_frame: 'World Sensor', social_signal: 'Social cues', status_update: 'Chat meters',
                memory_gate: 'Memory gate', event_lens: 'Multi-event lens',
                continuity_sentinel: 'Continuity audit', life_beat: 'Life beats', pip_route: 'Pip routing'
            };
            capabilityBox.innerHTML = configured ? capabilities.map(item =>
                `<span class="${item.available ? 'available' : 'unavailable'}" title="${item.available ? 'Available' : `Needs ${item.minimumTier} tier`}">${item.available ? '✓' : '—'} ${escapeHTML(labels[item.id] || item.id.replaceAll('_', ' '))}</span>`
            ).join('') : '<span class="unavailable">Choose or install a model to see its active duties.</span>';
        }
        byId('labs-sidebar-state').textContent = enabled ? (configured ? 'On' : 'Setup') : 'Off';
        byId('labs-sidebar-state').classList.toggle('active', enabled && configured);
        const pipSummary = byId('pip-labs-summary');
        if (pipSummary) pipSummary.textContent = !configured ? 'Not configured' : !enabled ? 'Ready · currently off'
            : needle ? 'TinyBrain 2 · active' : embedded ? 'Legacy brain · active' : 'Connected model · active';
        renderPipRuntime(config, configured);
        renderPolicyHelp();
    }

    function renderPipRuntime(config, configured) {
        if (window.HordePip) { window.HordePip.renderStatus(); return; }
        const badge = byId('pip-runtime-state');
        if (!badge) return;
        const embedded = config.runtime === 'embedded';
        const needle = config.runtime === 'needle';
        badge.textContent = !configured ? 'BUILT-IN ONLY'
            : needle ? 'TINYBRAIN 2 · READY'
            : embedded ? 'SMOLLM2 · READY'
            : 'LOCAL MODEL · READY';
        badge.classList.toggle('ready', configured);
        badge.title = !configured
            ? 'Pip answers product questions from the verified built-in handbook. Configure a Tiny Brain only for ordinary conversation.'
            : needle
                ? 'Pip uses TinyBrain 2 to route help and diagnostic requests. Answers remain grounded in the local handbook.'
            : embedded
                ? 'Pip uses the embedded SmolLM2 model for casual chat. Horde Studio answers still come directly from the handbook.'
                : `Pip uses ${config.model || 'the selected local model'} through ${config.baseUrl} for casual chat. Product facts stay handbook-grounded.`;
    }

    function renderPolicyHelp() {
        const copy = {
            off: 'No local call. The normal engine is unchanged.',
            shadow: 'Runs privately and records validity, but cannot affect the experience.',
            assist: 'Validated hints may help the main model; deterministic state remains authoritative.',
            audit: 'Guarded Assist behavior with the fullest trust diagnostics; still never canonical by itself.'
        };
        ['chat', 'worlds', 'humans'].forEach(mode => {
            const select = byId(`labs-policy-${mode}`);
            const output = byId(`labs-policy-${mode}-help`);
            if (select && output) output.textContent = copy[select.value] || copy.off;
        });
    }

    function embeddedOptions() {
        const preference = byId('labs-embedded-device').value;
        return {
            model: 'HuggingFaceTB/SmolLM2-135M-Instruct', dtype: 'q4',
            device: preference === 'auto' ? (navigator.gpu ? 'webgpu' : 'wasm') : preference
        };
    }

    function showNeedleState(installed, copy) {
        needleInstalled = installed;
        byId('labs-needle-state').textContent = installed ? 'Installed' : 'Not installed';
        byId('labs-needle-install-btn').classList.toggle('hidden', installed);
        byId('labs-needle-remove-btn').classList.toggle('hidden', !installed);
        if (copy) byId('labs-needle-status').textContent = copy;
        renderStatus(configFromForm());
    }

    async function refreshNeedleStatus() {
        if (location.protocol === 'file:') return showNeedleState(false, FILE_RUNTIME_MESSAGE);
        if (needleMarker()) showNeedleState(true, 'Installed. Verifying the three cached runtime assets…');
        try {
            const adapter = await loadNeedleAdapter();
            const result = await adapter.status();
            setNeedleMarker(result.cached === true);
            showNeedleState(result.cached === true, result.cached
                ? 'Ready. Needle runtime, WASM engine and 45M model are present in this browser cache.'
                : 'Install downloads approximately 14 MB of model weights plus the small WASM runtime.');
        } catch (error) {
            showNeedleState(false, `Could not inspect TinyBrain 2: ${error.message}`);
        }
    }

    async function installNeedle() {
        const button = byId('labs-needle-install-btn');
        if (location.protocol === 'file:') return showNeedleState(false, FILE_RUNTIME_MESSAGE);
        busy(button, true, 'Installing…');
        byId('labs-needle-status').textContent = 'Downloading the official Needle runtime and model…';
        try {
            const adapter = await loadNeedleAdapter();
            const result = await adapter.install({}, progress => {
                const percent = Number(progress.percent) || 0;
                byId('labs-needle-progress-fill').style.width = `${percent}%`;
                byId('labs-needle-status').textContent = `${String(progress.stage || 'downloading').replaceAll('_', ' ')}${percent ? ` · ${percent}%` : ''}`;
            });
            setNeedleMarker(true);
            byId('labs-needle-progress-fill').style.width = '100%';
            showNeedleState(true, `TinyBrain 2 ${result.version || ''} installed and loaded. Keep policies in Shadow while calibrating.`);
            host.toast?.('TinyBrain 2 installed.', 'success');
        } catch (error) {
            setNeedleMarker(false);
            showNeedleState(false, `Install failed: ${error.message}`);
            host.toast?.(`TinyBrain 2 install failed: ${error.message}`, 'error');
        } finally { busy(button, false); }
    }

    async function removeNeedle() {
        const button = byId('labs-needle-remove-btn');
        busy(button, true, 'Removing…');
        try {
            const adapter = await loadNeedleAdapter();
            await adapter.remove();
            setNeedleMarker(false);
            byId('labs-needle-progress-fill').style.width = '0%';
            showNeedleState(false, 'TinyBrain 2 runtime and model removed from this browser.');
        } catch (error) { host.toast?.(`Could not remove TinyBrain 2: ${error.message}`, 'error'); }
        finally { busy(button, false); }
    }

    function showEmbeddedState(installed, copy) {
        embeddedInstalled = installed;
        byId('labs-embedded-state').textContent = installed ? 'Installed' : 'Not installed';
        byId('labs-embedded-install-btn').classList.toggle('hidden', installed);
        byId('labs-embedded-remove-btn').classList.toggle('hidden', !installed);
        if (copy) byId('labs-install-status').textContent = copy;
        renderStatus(configFromForm());
    }

    async function refreshEmbeddedStatus() {
        if (location.protocol === 'file:') return showEmbeddedState(false, FILE_RUNTIME_MESSAGE);
        if (!window.HordeLabsEmbedded) return showEmbeddedState(false, 'This browser cannot start the embedded runtime.');
        if (embeddedMarker()) {
            showEmbeddedState(true, 'Installed. The model will load from browser cache when Labs needs it.');
        }
        try {
            const result = await window.HordeLabsEmbedded.status(embeddedOptions());
            const installed = result.cached === true || embeddedMarker();
            if (result.cached === true) setEmbeddedMarker(true);
            showEmbeddedState(installed, installed
                ? 'Ready. The downloaded model is cached in this browser and can work without an inference server.'
                : 'Nothing downloads until you press Install. The model runs only narrow Labs tasks; it does not replace your main chat model.');
        } catch (error) {
            if (!embeddedMarker()) showEmbeddedState(false, `Could not inspect the browser model cache: ${error.message}`);
        }
    }

    async function installEmbedded() {
        const button = byId('labs-embedded-install-btn');
        if (location.protocol === 'file:') {
            showEmbeddedState(false, FILE_RUNTIME_MESSAGE);
            host.toast?.('Open Horde Studio with its launcher before installing the Tiny Brain.', 'error');
            return;
        }
        busy(button, true, 'Installing…');
        byId('labs-install-status').textContent = 'Starting the on-device model download… keep Horde Studio open.';
        try {
            const result = await window.HordeLabsEmbedded.install(embeddedOptions(), progress => {
                const percent = Number(progress.percent) || 0;
                byId('labs-install-progress-fill').style.width = `${percent}%`;
                byId('labs-install-status').textContent = `${progress.status || 'Downloading'}${progress.file ? ` · ${progress.file}` : ''}${percent ? ` · ${percent}%` : ''}`;
            });
            byId('labs-install-progress-fill').style.width = '100%';
            setEmbeddedMarker(true);
            showEmbeddedState(true, `Installed and loaded with ${result.device === 'webgpu' ? 'WebGPU' : 'CPU/WASM'}. It will remain cached in this browser.`);
            host.toast?.('Embedded Tiny Brain installed.', 'success');
        } catch (error) {
            const suffix = error?.code === 'HORDE_FILE_WORKER_BLOCKED' ? '' : ' Check your connection, browser storage and WebGPU/WASM support.';
            const message = String(error?.message || error).replace(/[.\s]+$/, '');
            showEmbeddedState(false, `Install failed: ${message}.${suffix}`);
            host.toast?.(`Tiny Brain install failed: ${error.message}`, 'error');
        } finally { busy(button, false); }
    }

    async function removeEmbedded() {
        const button = byId('labs-embedded-remove-btn');
        busy(button, true, 'Removing…');
        try {
            await window.HordeLabsEmbedded.remove(embeddedOptions());
            setEmbeddedMarker(false);
            byId('labs-install-progress-fill').style.width = '0%';
            showEmbeddedState(false, 'Downloaded model removed from this browser.');
            host.toast?.('Embedded Tiny Brain removed.', 'success');
        } catch (error) { host.toast?.(`Could not remove Tiny Brain: ${error.message}`, 'error'); }
        finally { busy(button, false); }
    }

    function setModels(nextModels) {
        models = [...new Set((nextModels || []).filter(Boolean))];
        byId('labs-model-list').innerHTML = models.map(model => `<option value="${escapeHTML(model)}"></option>`).join('');
        byId('labs-model-help').textContent = models.length
            ? `${models.length} local model${models.length === 1 ? '' : 's'} found. Small instruct models are ideal for these narrow tasks.`
            : 'No models reported. You may still enter an exact local model ID.';
    }

    function diagnostics() {
        return Array.isArray(host?.getDiagnostics?.()) ? host.getDiagnostics().slice(-100) : [];
    }

    function renderDiagnostics() {
        // VERSION 2 introduced the compact Micro protocol. Hide legacy rows
        // and capability skips: the capability chips already explain which
        // tasks this model cannot run, without presenting expected skips as errors.
        const rows = diagnostics().filter(row => Number(row.version) >= 2 && !row.skipped);
        const completed = rows.filter(row => !row.skipped);
        const valid = completed.filter(row => row.valid).length;
        const accepted = completed.filter(row => row.accepted).length;
        const latencies = completed.map(row => Number(row.latencyMs)).filter(Number.isFinite).sort((a, b) => a - b);
        const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
        byId('labs-diagnostic-stats').innerHTML = [
            ['Runs', completed.length], ['Valid', completed.length ? `${Math.round(valid / completed.length * 100)}%` : '—'],
            ['Accepted', accepted], ['Median', latencies.length ? `${median} ms` : '—']
        ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
        byId('labs-diagnostic-list').innerHTML = rows.length ? rows.slice(-12).reverse().map(row => `
            <div class="labs-diagnostic-row">
                <span class="labs-result ${row.valid ? 'valid' : 'invalid'}">${row.valid ? '✓' : '×'}</span>
                <div><strong>${escapeHTML(String(row.task || 'task').replaceAll('_', ' '))}</strong><span>${escapeHTML(row.mode || '')} · ${escapeHTML(row.policy || '')} · ${Number(row.latencyMs) || 0} ms</span></div>
                <small title="${escapeHTML(row.reason || '')}">${escapeHTML(row.reason || '')}</small>
            </div>`).join('') : '<div class="labs-empty">No cognition receipts yet. Shadow mode is the safest way to collect them.</div>';
    }

    function busy(button, active, label) {
        if (!button.dataset.label) button.dataset.label = button.textContent;
        button.disabled = active;
        button.textContent = active ? label : button.dataset.label;
    }

    function appendGuideMessage(role, text) {
        const container = byId('labs-guide-messages');
        if (!container) return null;
        const row = document.createElement('div');
        row.className = `labs-guide-message ${role === 'user' ? 'user' : 'assistant'}`;
        const name = document.createElement('strong');
        name.textContent = role === 'user' ? 'You' : 'Pip';
        const body = document.createElement('p');
        body.textContent = String(text || '').trim();
        row.append(name, body);
        container.appendChild(row);
        container.scrollTop = container.scrollHeight;
        return body;
    }

    function initializeGuide() {
        if (guideHistory.length || !byId('labs-guide-messages')) return;
        const greeting = 'Hi! I’m Pip, the tiny local Horde Studio guide. Ask me how a feature works, where a setting lives, or which provider controls what.';
        guideHistory.push({ role: 'assistant', text: greeting });
        appendGuideMessage('assistant', greeting);
    }

    function clearGuideChat() {
        guideEpoch += 1;
        guideHistory.length = 0;
        const messages = byId('labs-guide-messages');
        if (messages) messages.replaceChildren();
        initializeGuide();
        const status = byId('labs-guide-status');
        if (status) status.textContent = 'Pip chat cleared. Product answers still come from the verified built-in handbook.';
        byId('labs-guide-input')?.focus();
    }

    function renderPipActions(route) {
        const box = byId('pip-response-actions');
        if (!box) return;
        const actions = [];
        if (route?.action === 'open_labs' || route?.action === 'diagnose_labs') {
            actions.push(['labs', route.action === 'diagnose_labs' ? 'Open Labs trust dashboard' : 'Configure TinyBrain 2']);
        }
        if (route?.action === 'open_settings' || route?.action === 'diagnose_provider') {
            actions.push(['settings', route.action === 'diagnose_provider' ? 'Open provider diagnostics' : 'Open Settings']);
        }
        if (route?.action === 'navigate' && route.destination) actions.push([route.destination, `Open ${route.destination}`]);
        box.innerHTML = actions.map(([action, label]) => `<button type="button" class="btn btn-ghost btn-small" data-pip-action="${escapeHTML(action)}">${escapeHTML(label)}</button>`).join('');
        box.classList.toggle('hidden', actions.length === 0);
        box.querySelectorAll('[data-pip-action]').forEach(button => button.onclick = () => performPipAction(button.dataset.pipAction));
    }

    function performPipAction(action) {
        if (action === 'labs') return open();
        host?.navigate?.(action);
    }

    async function routePipQuestion(question, config) {
        if (!config.enabled || config.runtime !== 'needle' || !needleInstalled) return null;
        try {
            const result = await window.HordeLabs.propose('pip_route', { text: String(question).slice(0, 1000) }, {
                mode: 'universal', policy: 'audit', priority: 120
            });
            return result?.accepted ? result.candidate : null;
        } catch (_) { return null; }
    }

    // Emergency core manual: Pip keeps these answers in its own runtime as
    // well as the full versioned handbook. A missing, stale or blocked
    // labs-guide.js must degrade breadth—not erase Pip's product identity.
    const CORE_GUIDE = Object.freeze([
        {
            match: /\b(?:horde studio|what (?:is|does) horde|explain horde|tell me (?:about )?horde)\b/i,
            answer: 'Horde Studio is a local-first frontend for AI roleplay and simulation. Chat Library handles traditional characters and group rooms; Virtual Humans are persistent texting simulations with time, relationships and active lives; Worlds are living sandboxes with locations, NPCs and canonical state. Text, image and voice providers can be selected independently, while your authored content and sessions stay in the browser.'
        },
        {
            match: /\b(?:provider|openrouter|gptproto|nanogpt|nvidia|\bnim\b|aws|bedrock)\b/i,
            answer: 'Settings chooses the default text provider. Virtual Humans may override their conversation and photo providers separately, and Worlds choose artwork independently from narration. OpenRouter, GPTProto, NanoGPT, NVIDIA NIM, AWS Bedrock and local OpenAI-compatible text servers are supported; media support depends on the separately selected image or voice provider.'
        },
        {
            match: /\b(?:virtual human|companion|relationship|ghost|texting)\b/i,
            answer: 'Virtual Humans are persistent texting simulations. They track their own timezone, message timing, mood, relationship, memories and active-life schedule. Depending on timeline immersion settings they may reply late, leave something on read, notice silence, initiate contact, or consider sending permitted photos and voice notes.'
        },
        {
            match: /\b(?:world|kernel|movement|travel|location|npc|dice)\b/i,
            answer: 'Worlds are persistent sandbox simulations. The narrative model writes the scene, while the World Kernel owns canonical time, location, NPC state, inventory, stats and checks. Movement is validated against authored routes so prose alone cannot teleport the player or silently rewrite canon.'
        },
        {
            match: /\b(?:labs?|tiny brain|shadow|assist|audit|micro model)\b/i,
            answer: 'Horde Labs is an optional local cognition layer. Off preserves normal behavior, Shadow observes without affecting play, Assist may pass validated hints to the main model, and Audit exposes fuller diagnostics. Tiny-model output is advisory and cannot directly overwrite canonical state.'
        },
        {
            match: /\b(?:photo|image|voice|tts|audio|comfyui|mcp)\b/i,
            answer: 'Text, images and voice are separate routes in Horde Studio. Virtual Humans can use a different provider for conversation, photos and speech; Worlds can select their own visual provider. Capability-aware requests omit unsupported image or audio parameters, and local ComfyUI or configured MCP image tools remain optional.'
        },
        {
            match: /\b(?:export|import|backup|share|portable)\b/i,
            answer: 'Share exports contain authored Characters, Virtual Humans or Worlds without API keys. Virtual Human share files omit private lived timelines, while full backups preserve local sessions and runtime state. World packages embed normalized authored media for portability.'
        }
    ]);

    function coreGuideAnswer(question) {
        return CORE_GUIDE.find(note => note.match.test(String(question || '')))?.answer
            || 'I know Horde Studio’s core features, providers and workflows, but that specific detail is not in my loaded core manual. Ask me about Chat Library, Virtual Humans, Worlds, Labs, providers, media, or exports.';
    }

    function guideFallback(question) {
        if (/\b(?:are you|what are you|you an?)\b.*\b(?:llm|language model|ai)\b/i.test(question)) {
            return 'I’m Pip, Horde Studio’s local help agent. My reliable knowledge comes from built-in product notes. If you configure a Tiny Brain, that local model rewrites those notes conversationally; otherwise I answer from the notes directly.';
        }
        if (/\bwhat can you do\b|\bhow can you help\b/i.test(question)) {
            return 'I can explain Horde Studio, help you find settings, troubleshoot providers and Labs, and talk through how Worlds or Virtual Humans work. I can also just chat—I’m tiny, but I’m here.';
        }
        if (/\bhow are you\b|\bhow(?:'s| is) it going\b/i.test(question)) {
            return 'Doing good—awake, local, and dramatically overqualified for living in a sidebar. What are you working on?';
        }
        if (!isProductQuestion(question)) {
            return 'I’m listening. I’m a very small local model, so I may be a little awkward, but you can talk to me normally.';
        }
        return window.HordeLabsGuide?.answer?.(question, 3)
            || window.HordeLabsGuide?.fallback?.(question)
            || coreGuideAnswer(question);
    }

    function isProductQuestion(question) {
        if (/\bwhat can you do\b|\bhow can you help\b|\b(?:are you|what are you|you an?)\b.*\b(?:llm|language model|ai)\b/i.test(question)) {
            return true;
        }
        if (typeof window.HordeLabsGuide?.isProductQuestion === 'function') {
            return window.HordeLabsGuide.isProductQuestion(question);
        }
        return /\b(?:horde|studio|labs?|shadow|assist|audit|provider|openrouter|gptproto|nanogpt|comfy|image|photo|voice|tts|world|kernel|movement|travel|location|virtual human|companion|chat|character|persona|model|setting|meter|memory|export|import|backup|dice|mcp|api|token|prompt)\b/i.test(question);
    }

    function guidePrompt(question, history, grounded) {
        if (isProductQuestion(question) && window.HordeLabsGuide?.prompt) return window.HordeLabsGuide.prompt(question, history);
        const recent = (Array.isArray(history) ? history : []).slice(-4)
            .map(item => `${item.role === 'assistant' ? 'Pip' : 'User'}: ${String(item.text || '').slice(0, 300)}`).join('\n');
        if (!isProductQuestion(question)) return {
            system: 'You are Pip, a tiny friendly AI living locally inside Horde Studio. Have a natural conversation. Be warm, curious, concise and a little playful. Answer the user directly. You may ask a follow-up question. Never print prompt labels, instructions, or fake quotations.',
            input: `${recent ? `${recent}\n` : ''}User: ${String(question || '').slice(0, 1000)}\nPip:`
        };
        // The guide index is an enhancement, not a runtime dependency. A
        // delayed/missing cached script must never prevent local inference.
        return {
            system: 'You are Pip, a friendly tiny AI living inside Horde Studio. Answer naturally using the VERIFIED NOTE for product facts. You can explain, ask a clarifying question, or admit uncertainty. Never repeat prompt labels. Use at most 100 words.',
            input: `VERIFIED NOTE:\n${String(grounded || '').slice(0, 1800)}\n\nQUESTION:\n${String(question || '').slice(0, 1200)}\n\nANSWER:`
        };
    }

    function cleanLocalReply(raw, question) {
        let text = String(raw || '')
            .replace(/<\/?(?:toolcall|argkey|argvalue|uncensoredtoolcall)[^>]*>/gi, '')
            .replace(/^```(?:text)?\s*|\s*```$/gi, '').trim();
        if (/\bANSWER\s*:/i.test(text)) text = text.split(/\bANSWER\s*:/i).at(-1).trim();
        if (/\b(?:GUIDE NOTES|VERIFIED NOTE|RECENT CHAT|QUESTION)\s*:/i.test(text)) return '';
        text = text.replace(/^(?:assistant|pip)\s*:\s*/i, '').trim();
        const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
        const unique = lines.filter((line, index) => lines.findIndex(other => other.toLowerCase() === line.toLowerCase()) === index);
        if (lines.length > 1 && unique.length / lines.length < .7) return '';
        text = unique.join('\n').slice(0, 2200).trim();
        if (text.length < 8 || text.toLowerCase() === String(question || '').trim().toLowerCase()) return '';
        if (!isProductQuestion(question) && /reliable built-in note|horde studio discord/i.test(text)) return '';
        return text;
    }

    function localFailureMessage(error, config) {
        const raw = String(error?.message || error || 'Unknown local inference error');
        if (config.runtime === 'connected' && /failed to fetch|networkerror|load failed/i.test(raw)) {
            return `Could not reach ${config.baseUrl}. Start your local model server, then use Configure Tiny Brain → Test connection.`;
        }
        if (config.runtime === 'connected' && /timed out/i.test(raw)) {
            return `The local model at ${config.baseUrl} did not answer in time. Confirm the server and selected model are loaded.`;
        }
        if (config.runtime === 'embedded' && location.protocol === 'file:') return FILE_RUNTIME_MESSAGE;
        return raw;
    }

    async function askGuide(questionOverride = '') {
        const input = byId('labs-guide-input');
        const question = String(questionOverride || input?.value || '').trim();
        if (!question) return;
        const config = configFromForm();
        if (input) input.value = '';
        guideHistory.push({ role: 'user', text: question });
        appendGuideMessage('user', question);
        const button = byId('labs-guide-send-btn');
        const status = byId('labs-guide-status');

        const greeting = /^(?:(?:hey|hi|hello|yo|sup)(?:\s+pip)?|(?:are you|you) there)[\s!?.,]*$/i.test(question);
        const productQuestion = !greeting && isProductQuestion(question);
        const grounded = greeting
            ? 'I’m here 👋 Ask me anything about Horde Studio—features, providers, Labs, Virtual Humans, Worlds, or where a setting lives.'
            : guideFallback(question);
        const assistantRecord = { role: 'assistant', text: grounded };
        guideHistory.push(assistantRecord);
        const replyBody = appendGuideMessage('assistant', grounded);
        renderPipActions(null);

        // Needle never writes Pip's prose. It privately routes the request to
        // a relevant, user-confirmed UI action while the handbook supplies the
        // factual answer immediately.
        if (config.runtime === 'needle') {
            const route = await routePipQuestion(question, config);
            renderPipActions(route);
            if (status && route) status.textContent = `TinyBrain 2 routed this as ${route.action.replaceAll('_', ' ')} · handbook answer remained authoritative.`;
        }

        if (greeting) {
            if (status) status.textContent = 'Pip is here. Replies and help-note retrieval stay on this device.';
            return;
        }
        if (productQuestion) {
            if (status) status.textContent = window.HordeLabsGuide?.entryCount
                ? `Verified Horde Studio handbook answer · ${window.HordeLabsGuide.entryCount} local topics · no tiny-model rewrite.`
                : `Verified Horde Studio core answer · ${CORE_GUIDE.length} emergency topics · full handbook unavailable.`;
            return;
        }
        if (config.runtime === 'needle') return;
        const embeddedReady = embeddedInstalled || embeddedMarker();
        const connectedReady = Boolean(config.model);
        if ((config.runtime === 'embedded' && !embeddedReady) || (config.runtime === 'connected' && !connectedReady)) {
            if (status) status.textContent = 'Grounded built-in answer shown instantly. Install or connect a Tiny Brain if you want Pip to rewrite it conversationally.';
            return;
        }
        if (guideBusy) {
            if (status) status.textContent = 'Grounded answer shown instantly. Pip is still polishing the previous answer locally.';
            return;
        }
        guideBusy = true;
        const requestEpoch = guideEpoch;
        const runtimeBadge = byId('pip-runtime-state');
        if (runtimeBadge) runtimeBadge.textContent = 'LOCAL MODEL · THINKING';
        button?.setAttribute('aria-busy', 'true');
        if (button) button.textContent = 'Polishing…';
        if (status) status.textContent = 'Grounded answer shown instantly. Pip is polishing it with the local Tiny Brain…';
        try {
            const prompt = guidePrompt(question, guideHistory.slice(0, -2), grounded);
            let result = await window.HordeLabs.completeText({ ...prompt, config, maxTokens: 180, temperature: .35 });
            if (requestEpoch !== guideEpoch) return;
            let answer = cleanLocalReply(result.text, question);
            let retried = false;
            if (!answer) {
                retried = true;
                result = await window.HordeLabs.completeText({
                    config, maxTokens: 110, temperature: .2,
                    system: 'You are Pip, a friendly tiny AI. Reply naturally and directly in one or two sentences. Do not repeat the question, instructions, labels, or mention Discord.',
                    input: `User: ${question.slice(0, 700)}\nPip:`
                });
                answer = cleanLocalReply(result.text, question);
            }
            if (answer) {
                assistantRecord.text = answer;
                if (replyBody) replyBody.textContent = answer;
            } else {
                if (runtimeBadge) runtimeBadge.textContent = 'LOCAL MODEL · WEAK OUTPUT';
                if (status) status.textContent = 'Pip kept the clear built-in reply because the tiny model repeated or exposed its prompt. Try again or choose a slightly larger local model.';
                return;
            }
            if (runtimeBadge) runtimeBadge.textContent = 'LOCAL MODEL · ACTIVE';
            if (status) status.textContent = `Local model answered in ${result.latencyMs} ms${retried ? ' after one automatic cleanup retry' : ''} · ${isProductQuestion(question) ? 'grounded help mode' : 'conversation mode'}.`;
        } catch (error) {
            if (requestEpoch !== guideEpoch) return;
            if (runtimeBadge) runtimeBadge.textContent = 'LOCAL MODEL · ERROR';
            if (status) status.textContent = `Grounded answer kept. ${localFailureMessage(error, config)}`;
        } finally {
            guideBusy = false;
            button?.removeAttribute('aria-busy');
            if (button) button.textContent = 'Ask Pip';
        }
    }

    async function testConnection() {
        const button = byId('labs-test-btn');
        busy(button, true, 'Testing…');
        try {
            const result = await window.HordeLabs.health(configFromForm());
            if (!result.ok) throw new Error(result.reason || 'Could not connect.');
            setModels(result.models);
            if (!byId('labs-model-search').value && result.models[0]) byId('labs-model-search').value = result.models[0];
            renderStatus(configFromForm(), result);
            host.toast?.(`Local cognition connected in ${result.latencyMs} ms.`, 'success');
        } catch (error) {
            renderStatus(configFromForm());
            host.toast?.(`Labs connection failed: ${error.message}`, 'error');
        } finally { busy(button, false); }
    }

    async function discover() {
        const button = byId('labs-discover-btn');
        busy(button, true, 'Searching…');
        try {
            window.HordeLabs.configure(configFromForm());
            const results = await window.HordeLabs.discover();
            if (!results.length) throw new Error('No compatible server answered on the common local ports.');
            const best = results[0];
            byId('labs-base-url').value = best.baseUrl;
            setModels(best.models);
            if (!byId('labs-model-search').value && best.models[0]) byId('labs-model-search').value = best.models[0];
            renderStatus(configFromForm(), best);
            host.toast?.(`Found ${results.length} local server${results.length === 1 ? '' : 's'}.`, 'success');
        } catch (error) { host.toast?.(error.message, 'error'); }
        finally { busy(button, false); }
    }

    function close() {
        if (host) renderStatus(host.getConfig());
        byId('labs-overlay').classList.add('hidden');
        byId('labs-overlay').setAttribute('aria-hidden', 'true');
    }

    function open() {
        fillForm(host.getConfig());
        if (draft.runtime === 'embedded' && embeddedMarker()) {
            showEmbeddedState(true, 'Installed. Checking the browser model cache…');
        }
        if (draft.runtime === 'needle' && needleMarker()) showNeedleState(true, 'Installed. Verifying the cached runtime…');
        renderDiagnostics();
        byId('labs-overlay').classList.remove('hidden');
        byId('labs-overlay').setAttribute('aria-hidden', 'false');
        if (draft.runtime === 'embedded') void refreshEmbeddedStatus();
        if (draft.runtime === 'needle') void refreshNeedleStatus();
    }

    function mount(options) {
        host = options;
        const savedConfig = window.HordeLabs.normalizeConfig(host.getConfig());
        // Migration for installs completed before the persistent marker
        // existed: an enabled saved Embedded configuration could only have
        // passed the previous install guard after a successful load.
        if (savedConfig.enabled && savedConfig.runtime === 'embedded') setEmbeddedMarker(true);
        fillForm(savedConfig);
        initializeGuide();
        byId('labs-close-btn').onclick = close;
        byId('labs-cancel-btn').onclick = close;
        byId('labs-test-btn').onclick = testConnection;
        byId('labs-discover-btn').onclick = discover;
        byId('labs-embedded-install-btn').onclick = installEmbedded;
        byId('labs-embedded-remove-btn').onclick = removeEmbedded;
        byId('labs-needle-install-btn').onclick = installNeedle;
        byId('labs-needle-remove-btn').onclick = removeNeedle;
        byId('labs-guide-send-btn').onclick = () => askGuide();
        byId('pip-clear-chat-btn').onclick = clearGuideChat;
        byId('labs-guide-input').addEventListener('keydown', event => {
            if (window.HordePip) return; // The independent assistant owns this composer.
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void askGuide();
            }
        });
        document.querySelectorAll('[data-guide-question]').forEach(button => {
            button.onclick = () => void askGuide(button.dataset.guideQuestion || '');
        });
        document.querySelectorAll('[data-pip-action]').forEach(button => {
            button.onclick = () => performPipAction(button.dataset.pipAction || '');
        });
        byId('labs-needle-confidence').addEventListener('input', event => {
            byId('labs-needle-confidence-value').textContent = `${event.target.value}%`;
            renderStatus(configFromForm());
        });
        document.querySelectorAll('input[name="labs-runtime"]').forEach(input => input.onchange = renderRuntime);
        byId('labs-clear-diagnostics-btn').onclick = async () => {
            await host.clearDiagnostics?.();
            renderDiagnostics();
        };
        byId('labs-save-btn').onclick = async () => {
            const next = configFromForm();
            if (next.enabled && next.runtime === 'connected' && !next.model) return host.toast?.('Choose a local cognition model before enabling Labs.', 'error');
            if (next.enabled && next.runtime === 'embedded' && !embeddedInstalled) return host.toast?.('Install the Embedded Tiny Brain before enabling it.', 'error');
            if (next.enabled && next.runtime === 'needle' && !needleInstalled) return host.toast?.('Install TinyBrain 2 before enabling Labs.', 'error');
            await host.setConfig(next);
            draft = next;
            renderStatus(next);
            close();
        };
        ['labs-enabled', 'labs-model-search', 'labs-policy-chat', 'labs-policy-worlds', 'labs-policy-humans']
            .forEach(id => byId(id).addEventListener('change', () => renderStatus(configFromForm())));
        byId('labs-model-search').addEventListener('input', () => renderStatus(configFromForm()));
        byId('labs-overlay').addEventListener('mousedown', event => {
            if (event.target === byId('labs-overlay')) close();
        });
    }

    window.HordeLabsUI = Object.freeze({ mount, open, close, renderDiagnostics, renderStatus });
})();
