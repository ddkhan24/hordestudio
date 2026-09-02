(function () {
    'use strict';

    const VIDEO_WORLD_VERSION = 6;
    const STORY_BLOCK_BRANCHING = 3;
    const STORY_BLOCK_DEPTHS = new Set([1, 2]);
    const DEFAULT_DIRECTOR_MODEL = 'google/gemma-4-31b-it';
    const RESOLUTIONS = new Set(['480P', '768P']);
    const DURATIONS = new Set([5, 10, 15]);
    const ASPECTS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
    const VIEWPOINTS = new Set(['third_person', 'first_person']);
    const VIDEO_RENDERERS = new Set(['minimax/h3-max', 'alibaba/wan-3.0', 'alibaba/wan-3.0-prime', 'fal-ai/ltx-2.3/fast']);
    const SPICY_VIDEO_RENDERERS = new Set(['minimax-h3-spicy', 'seedance-2.0-fast-spicy', 'seedance-2.0-spicy', 'seedance-2.5-spicy']);
    const CONTENT_ROUTES = new Set(['standard', 'standard_then_spicy', 'spicy_first']);
    const REFERENCE_STRATEGIES = new Set(['auto', 'direct', 'keyframe']);
    const REFERENCE_KEYFRAME_COST = 0.08;
    const VIDEO_RENDERER_LABELS = Object.freeze({
        'minimax/h3-max': 'H3 Max',
        'alibaba/wan-3.0': 'Wan 3.0',
        'alibaba/wan-3.0-prime': 'Wan 3.0 Prime',
        'fal-ai/ltx-2.3/fast': 'LTX-2.3 Fast'
    });
    const SPICY_RENDERER_LABELS = Object.freeze({
        'minimax-h3-spicy': 'MiniMax H3 Spicy',
        'seedance-2.0-fast-spicy': 'Seedance 2.0 Fast Spicy',
        'seedance-2.0-spicy': 'Seedance 2.0 Spicy',
        'seedance-2.5-spicy': 'Seedance 2.5 Spicy'
    });
    const VISUAL_PRESETS = [
        ['adult_2d', '2D adult animation', 'Bold adult television animation, graphic shapes, expressive acting, clean linework and limited but intentional motion.'],
        ['anime_2d', '2D anime', 'High-quality hand-drawn anime, expressive faces, cinematic composition, dynamic lighting and consistent character designs.'],
        ['claymation', 'Claymation', 'Handcrafted stop-motion clay animation, tactile sets, visible material texture and charming frame-by-frame movement.'],
        ['cinema_digital', 'High-budget film', 'Prestige live-action feature film shot on a digital cinema camera, cinematic lenses, controlled lighting and polished production design.'],
        ['sitcom_handheld', 'Handheld TV sitcom', 'Fast handheld single-camera television comedy, practical locations, natural lighting and reactive camera work.'],
        ['sitcom_stage', 'Studio sitcom', 'Multi-camera soundstage sitcom with warm set lighting, theatrical blocking and a lived-in ensemble set.'],
        ['documentary', 'Documentary', 'Observational documentary realism, available light, restrained camera movement and authentic environments.'],
        ['storybook', 'Illustrated storybook', 'Painterly illustrated storybook brought to life with layered depth, gentle movement and cohesive hand-painted design.'],
        ['retro_game', 'Retro game cinematic', 'Stylized late-1990s 3D game cinematic, deliberate low-poly forms, dramatic lighting and nostalgic texture work.'],
        ['custom', 'Custom look', 'Use the optional visual details below as the primary art direction.']
    ];
    let setupComplete = false;
    let generationToken = 0;
    let videoGenerationController = null;
    let generationClock = null;
    let generationStartedAt = 0;
    let generationPhase = '';
    const resumedVideoJobs = new Set();

    const byId = id => document.getElementById(id);
    const html = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
    const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const clamp = (value, minimum, maximum, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
    };
    const safeImage = value => /^data:image\/(?:jpeg|png|webp);base64,/i.test(String(value || ''))
        ? String(value).slice(0, 8 * 1024 * 1024) : '';

    function normalizeCharacter(source = {}) {
        return {
            id: String(source.id || uid('video_character')).slice(0, 100),
            name: String(source.name || '').trim().slice(0, 120),
            role: String(source.role || '').trim().slice(0, 240),
            personality: String(source.personality || '').trim().slice(0, 2000),
            appearance: String(source.appearance || '').trim().slice(0, 2000),
            referenceImage: safeImage(source.referenceImage)
        };
    }

    function normalizeWorld(source = {}) {
        const storedVersion = Number(source.version) || 0;
        return {
            version: VIDEO_WORLD_VERSION,
            id: String(source.id || uid('video_world')).slice(0, 100),
            name: String(source.name || 'Untitled Video Adventure').trim().slice(0, 120),
            tagline: String(source.tagline || '').trim().slice(0, 240),
            premise: String(source.premise || '').trim().slice(0, 4000),
            storyRules: String(source.storyRules || '').trim().slice(0, 4000),
            visualPreset: VISUAL_PRESETS.some(item => item[0] === source.visualPreset) ? source.visualPreset : 'cinema_digital',
            visualStyle: String(source.visualStyle || '').trim().slice(0, 4000),
            viewpoint: VIEWPOINTS.has(source.viewpoint) ? source.viewpoint : 'third_person',
            playerDescription: String(source.playerDescription || '').trim().slice(0, 3000),
            playerReferenceImage: safeImage(source.playerReferenceImage),
            characters: Array.isArray(source.characters) ? source.characters.slice(0, 40).map(normalizeCharacter).filter(item => item.name) : [],
            referenceStrategy: REFERENCE_STRATEGIES.has(source.referenceStrategy) ? source.referenceStrategy : 'auto',
            directorModel: String(source.directorModel || DEFAULT_DIRECTOR_MODEL).trim().slice(0, 500),
            // This controls only the inexpensive LLM decision tree. Video is
            // always rendered lazily along the player's chosen path.
            storyBlockDepth: STORY_BLOCK_DEPTHS.has(Number(source.storyBlockDepth)) ? Number(source.storyBlockDepth) : 1,
            openingShot: String(source.openingShot || '').trim().slice(0, 6000),
            resolution: RESOLUTIONS.has(source.resolution) ? source.resolution : '480P',
            duration: DURATIONS.has(Number(source.duration)) ? Number(source.duration) : 5,
            aspectRatio: ASPECTS.has(source.aspectRatio) ? source.aspectRatio : '16:9',
            falSafetyChecker: source.falSafetyChecker !== false,
            contentRoute: CONTENT_ROUTES.has(source.contentRoute) ? source.contentRoute : 'standard',
            rendererPrimary: VIDEO_RENDERERS.has(source.rendererPrimary) ? source.rendererPrimary : 'minimax/h3-max',
            rendererFallback: source.rendererFallback === '' ? ''
                : VIDEO_RENDERERS.has(source.rendererFallback) ? source.rendererFallback : 'alibaba/wan-3.0',
            // v3 gives existing adventures a second resilience fallback. After
            // migration, an explicitly empty selection continues to mean None.
            rendererFallback2: source.rendererFallback2 === '' && storedVersion >= 3 ? ''
                : VIDEO_RENDERERS.has(source.rendererFallback2) ? source.rendererFallback2 : 'fal-ai/ltx-2.3/fast',
            spicyRendererPrimary: SPICY_VIDEO_RENDERERS.has(source.spicyRendererPrimary) ? source.spicyRendererPrimary : 'minimax-h3-spicy',
            spicyRendererFallback: source.spicyRendererFallback === '' ? ''
                : SPICY_VIDEO_RENDERERS.has(source.spicyRendererFallback) ? source.spicyRendererFallback : 'seedance-2.0-fast-spicy',
            spicyRendererFallback2: source.spicyRendererFallback2 === '' ? ''
                : SPICY_VIDEO_RENDERERS.has(source.spicyRendererFallback2) ? source.spicyRendererFallback2 : '',
            sessionBudget: clamp(source.sessionBudget, 0.1, 10000, 5),
            createdAt: Number(source.createdAt) || Date.now(),
            updatedAt: Number(source.updatedAt) || Date.now()
        };
    }

    function normalizeShot(source = {}) {
        return {
            id: String(source.id || uid('video_shot')).slice(0, 100),
            index: Math.max(1, parseInt(source.index) || 1),
            action: String(source.action || '').slice(0, 3000),
            sceneSummary: String(source.sceneSummary || '').slice(0, 3000),
            directorPlan: source.directorPlan && typeof source.directorPlan === 'object' ? source.directorPlan : null,
            storyNodeId: String(source.storyNodeId || '').slice(0, 100),
            prepared: source.prepared === true,
            prompt: String(source.prompt || '').slice(0, 12000),
            mediaId: /^[a-f0-9]{32}$/.test(String(source.mediaId || '')) ? String(source.mediaId) : '',
            mediaPath: String(source.mediaPath || '').slice(0, 200),
            requestId: String(source.requestId || '').slice(0, 200),
            model: String(source.model || 'minimax/h3-max/text-to-video').slice(0, 200),
            provider: ['fal', 'hotapi'].includes(source.provider) ? source.provider : (String(source.model || '').includes('spicy') ? 'hotapi' : 'fal'),
            resolution: RESOLUTIONS.has(source.resolution) ? source.resolution : '480P',
            duration: DURATIONS.has(Number(source.duration)) ? Number(source.duration) : 5,
            seed: Number(source.seed) || 0,
            cost: clamp(source.cost, 0, 10000, 0),
            inferenceSeconds: clamp(source.inferenceSeconds, 0, 3600, 0),
            createdAt: Number(source.createdAt) || Date.now(),
            continuityCaptured: source.continuityCaptured === true
        };
    }

    function normalizeSession(source = {}, index = 0) {
        const shots = Array.isArray(source.shots) ? source.shots.slice(0, 5000).map(normalizeShot) : [];
        const shotIds = new Set(shots.map(shot => shot.id));
        let storyBlock = null;
        try { storyBlock = source.storyBlock ? normalizeStoryBlock(source.storyBlock) : null; }
        catch (error) { console.warn('Discarded invalid stored Video Adventure story block:', error); }
        const nodeIds = new Set(storyBlock?.nodes?.map(node => node.id) || []);
        const activeNodeId = nodeIds.has(source.activeNodeId) ? source.activeNodeId : '';
        const pathShotIds = Array.isArray(source.pathShotIds)
            ? source.pathShotIds.map(String).filter(id => shotIds.has(id)).slice(0, 500)
            : shots.filter(shot => !shot.prepared).map(shot => shot.id);
        return {
            version: VIDEO_WORLD_VERSION,
            id: String(source.id || uid('video_run')).slice(0, 100),
            name: String(source.name || `Take ${index + 1}`).trim().slice(0, 120),
            createdAt: Number(source.createdAt) || Date.now(),
            updatedAt: Number(source.updatedAt) || Date.now(),
            shots,
            storyState: source.storyState && typeof source.storyState === 'object' ? source.storyState : { facts: [], relationships: [], threads: [] },
            storyBlock,
            activeNodeId,
            visitedNodeIds: Array.isArray(source.visitedNodeIds)
                ? source.visitedNodeIds.map(String).filter(id => nodeIds.has(id)).slice(0, 500) : [],
            pathShotIds,
            directorChoices: Array.isArray(source.directorChoices) ? source.directorChoices.slice(0, 4) : [],
            playingShotId: shotIds.has(source.playingShotId) ? source.playingShotId : pathShotIds[pathShotIds.length - 1] || '',
            queuedShotId: shotIds.has(source.queuedShotId) ? source.queuedShotId : '',
            pendingDirectorPlan: source.pendingDirectorPlan && typeof source.pendingDirectorPlan === 'object' ? source.pendingDirectorPlan : null,
            pendingVideoJob: source.pendingVideoJob && typeof source.pendingVideoJob === 'object'
                ? {
                    jobId: String(source.pendingVideoJob.jobId || '').slice(0, 100),
                    action: String(source.pendingVideoJob.action || '').slice(0, 3000),
                    prompt: String(source.pendingVideoJob.prompt || '').slice(0, 12000),
                    plan: source.pendingVideoJob.plan && typeof source.pendingVideoJob.plan === 'object' ? source.pendingVideoJob.plan : null,
                    storyNodeId: String(source.pendingVideoJob.storyNodeId || '').slice(0, 100),
                    prepared: source.pendingVideoJob.prepared === true,
                    provider: source.pendingVideoJob.provider === 'hotapi' ? 'hotapi' : 'fal',
                    cost: clamp(source.pendingVideoJob.cost, 0, 10000, 0),
                    transitionFrame: safeImage(source.pendingVideoJob.transitionFrame),
                    createdAt: Number(source.pendingVideoJob.createdAt) || Date.now()
                } : null,
            transitionFrame: safeImage(source.transitionFrame),
            referenceSpend: clamp(source.referenceSpend, 0, 10000, 0),
            spent: shots.reduce((sum, shot) => sum + (Number(shot.cost) || 0), 0) + clamp(source.referenceSpend, 0, 10000, 0),
            lastFrame: /^data:image\/(?:jpeg|png|webp);base64,/i.test(String(source.lastFrame || ''))
                ? String(source.lastFrame).slice(0, 12 * 1024 * 1024) : ''
        };
    }

    function ensureState() {
        state.videoWorlds = Array.isArray(state.videoWorlds) ? state.videoWorlds.map(normalizeWorld) : [];
        state.videoWorldSessions = state.videoWorldSessions && typeof state.videoWorldSessions === 'object'
            && !Array.isArray(state.videoWorldSessions) ? state.videoWorldSessions : {};
        for (const world of state.videoWorlds) {
            const raw = state.videoWorldSessions[world.id] || {};
            const sessions = Array.isArray(raw.sessions)
                ? raw.sessions.slice(0, 1000).map((session, index) => normalizeSession(session, index)) : [];
            const activeExists = sessions.some(session => session.id === raw.activeSessionId);
            state.videoWorldSessions[world.id] = {
                activeSessionId: activeExists ? raw.activeSessionId : sessions[0]?.id || null,
                sessions
            };
        }
        if (!state.videoWorlds.some(world => world.id === state.activeVideoWorldId)) {
            state.activeVideoWorldId = state.videoWorlds[0]?.id || null;
        }
        state.editingVideoWorldId = state.videoWorlds.some(world => world.id === state.editingVideoWorldId)
            ? state.editingVideoWorldId : null;
    }

    function activeWorld() {
        return state.videoWorlds.find(world => world.id === state.activeVideoWorldId) || null;
    }

    function sessionStore(worldId) {
        const store = state.videoWorldSessions[worldId] ||= { activeSessionId: null, sessions: [] };
        if (!Array.isArray(store.sessions)) store.sessions = [];
        return store;
    }

    function activeSession(world, create = true) {
        if (!world) return null;
        const store = sessionStore(world.id);
        let session = store.sessions.find(item => item.id === store.activeSessionId);
        if (!session && create) {
            session = normalizeSession({ name: `Take ${store.sessions.length + 1}` }, store.sessions.length);
            store.sessions.unshift(session);
            store.activeSessionId = session.id;
        }
        return session || null;
    }

    function rateFor(resolution) {
        const key = resolution === '768P' ? 'falRate768' : 'falRate480';
        const fallback = resolution === '768P' ? 0.08 : 0.05;
        return clamp(state.globalSettings?.[key], 0, 100, fallback);
    }

    function rendererRate(renderer, resolution) {
        if (renderer === 'minimax-h3-spicy') return resolution === '768P' ? 0.12 : 0.08;
        if (renderer === 'seedance-2.0-fast-spicy') return resolution === '768P' ? 0.24 : 0.112;
        if (renderer === 'seedance-2.0-spicy') return resolution === '768P' ? 0.304 : 0.14;
        if (renderer === 'seedance-2.5-spicy') return resolution === '768P' ? 0.462 : 0.206;
        if (renderer === 'alibaba/wan-3.0') return resolution === '768P' ? 0.10 : 0.05;
        if (renderer === 'alibaba/wan-3.0-prime') return resolution === '768P' ? 0.14 : 0.068;
        if (renderer === 'fal-ai/ltx-2.3/fast') return 0.06;
        return rateFor(resolution);
    }

    function rendererChain(world) {
        return [world.rendererPrimary, world.rendererFallback, world.rendererFallback2]
            .filter((renderer, index, list) => VIDEO_RENDERERS.has(renderer) && list.indexOf(renderer) === index);
    }

    function referenceRendererChain(world) {
        const chain = rendererChain(world);
        return [...chain.filter(renderer => renderer === 'minimax/h3-max' || renderer === 'alibaba/wan-3.0'),
            ...chain.filter(renderer => renderer !== 'minimax/h3-max' && renderer !== 'alibaba/wan-3.0')];
    }

    function spicyRendererChain(world) {
        return [world.spicyRendererPrimary, world.spicyRendererFallback, world.spicyRendererFallback2]
            .filter((renderer, index, list) => SPICY_VIDEO_RENDERERS.has(renderer) && list.indexOf(renderer) === index);
    }

    function activeRendererChain(world) {
        if (world.contentRoute === 'spicy_first') return spicyRendererChain(world);
        if (world.contentRoute === 'standard_then_spicy') return [...rendererChain(world), ...spicyRendererChain(world)];
        return rendererChain(world);
    }

    function rendererDuration(renderer, duration) {
        const requested = clamp(duration, 1, 30, 5);
        if (renderer !== 'fal-ai/ltx-2.3/fast') return requested;
        return [6, 8, 10, 12, 14, 16, 18, 20]
            .reduce((nearest, option) => Math.abs(option - requested) < Math.abs(nearest - requested) ? option : nearest, 6);
    }

    function rendererFamily(model) {
        const value = String(model || '');
        if (SPICY_VIDEO_RENDERERS.has(value)) return value;
        if (value.includes('ltx-2.3/') && value.endsWith('/fast')) return 'fal-ai/ltx-2.3/fast';
        return Object.keys(VIDEO_RENDERER_LABELS).find(renderer => value.startsWith(renderer)) || '';
    }

    function shotCost(world) {
        return Math.max(...activeRendererChain(world).map(renderer => rendererDuration(renderer, world.duration) * rendererRate(renderer, world.resolution)));
    }

    function referenceShotCost(world) {
        return Math.max(shotCost(world), referenceRendererChain(world).includes('minimax/h3-max') ? world.duration * 0.08 : 0);
    }

    function storyBlockNodeCount(depth) {
        const safeDepth = STORY_BLOCK_DEPTHS.has(Number(depth)) ? Number(depth) : 2;
        let total = 0;
        for (let level = 0; level <= safeDepth; level++) total += STORY_BLOCK_BRANCHING ** level;
        return total;
    }

    function storyBlockCost(world) {
        return (world.storyBlockDepth + 1) * shotCost(world);
    }

    function money(value) {
        return `$${(Number(value) || 0).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.00')}`;
    }

    function mediaUrl(shot) {
        if (!shot?.mediaId) return '';
        return `${mcpBridgeBase()}/video-world-media/${encodeURIComponent(shot.mediaId)}.mp4`;
    }

    function renderLibrary() {
        ensureState();
        const grid = byId('video-world-grid');
        if (!grid) return;
        if (!state.videoWorlds.length) {
            grid.innerHTML = `<div class="video-world-empty-library"><span>🎬</span><h2>Create your first playable film</h2><p>Define the story, cast and visual language. The Director preplans a coherent decision tree, while Horde films only the path the player actually takes.</p><button class="btn btn-primary" data-video-world-create type="button">Create Video Adventure</button></div>`;
        } else {
            grid.innerHTML = state.videoWorlds.map(world => {
                const store = sessionStore(world.id);
                const shots = store.sessions.reduce((sum, session) => sum + (session.shots?.length || 0), 0);
                return `<article class="char-card video-world-card" data-video-world-id="${html(world.id)}">
                    <div class="video-world-card-art"><span>▶</span><small>${html(world.aspectRatio)} · ${html(world.resolution.replace('P', 'p'))}</small></div>
                    <div class="char-card-body"><h3>${html(world.name)}</h3><p>${html(world.tagline || world.premise || 'A playable generated film.')}</p><div class="video-world-card-meta"><span>${store.sessions.length} timeline${store.sessions.length === 1 ? '' : 's'}</span><span>${shots} shot${shots === 1 ? '' : 's'}</span></div></div>
                    <div class="char-card-actions"><button class="btn btn-primary btn-small" data-video-world-play type="button">Play</button><button class="btn btn-ghost btn-small" data-video-world-edit type="button">Edit</button></div>
                </article>`;
            }).join('');
        }
        grid.querySelectorAll('[data-video-world-create]').forEach(button => button.onclick = openNewEditor);
        grid.querySelectorAll('[data-video-world-id]').forEach(card => {
            const id = card.dataset.videoWorldId;
            card.querySelector('[data-video-world-play]').onclick = event => { event.stopPropagation(); openPlay(id); };
            card.querySelector('[data-video-world-edit]').onclick = event => { event.stopPropagation(); openEditor(id); };
        });
    }

    function editorWorld() {
        return state.videoWorlds.find(world => world.id === state.editingVideoWorldId) || null;
    }

    function selectButtonValue(containerId, value) {
        const container = byId(containerId);
        if (!container) return;
        container.dataset.value = value;
        container.querySelectorAll('[data-value]').forEach(button => {
            const active = button.dataset.value === value;
            button.classList.toggle('active', active);
            button.setAttribute('aria-checked', String(active));
        });
    }

    function renderStylePresets(selected = 'cinema_digital') {
        const container = byId('video-world-style-presets');
        container.innerHTML = VISUAL_PRESETS.map(([id, label, description]) => `<button type="button" data-value="${html(id)}" role="radio"><strong>${html(label)}</strong><small>${html(description)}</small></button>`).join('');
        container.querySelectorAll('[data-value]').forEach(button => button.onclick = () => selectButtonValue('video-world-style-presets', button.dataset.value));
        selectButtonValue('video-world-style-presets', selected);
    }

    function characterCard(character = {}) {
        const item = normalizeCharacter(character);
        return `<article class="video-world-character-card" data-character-id="${html(item.id)}">
            <div class="video-world-character-reference">${item.referenceImage ? `<img src="${html(item.referenceImage)}" alt="">` : '<span>No image</span>'}<input type="file" accept="image/png,image/jpeg,image/webp" data-character-image></div>
            <div class="video-world-character-fields"><label class="form-field"><span>Name</span><input class="form-input" data-character-name maxlength="120" value="${html(item.name)}" placeholder="Martha Cole"></label><label class="form-field"><span>Role in the story</span><input class="form-input" data-character-role maxlength="240" value="${html(item.role)}" placeholder="Ranch owner and reluctant mentor"></label><label class="form-field"><span>Personality and voice</span><textarea class="form-textarea" data-character-personality rows="2" maxlength="2000" placeholder="Guarded, dry humor; speaks plainly...">${html(item.personality)}</textarea></label><label class="form-field"><span>Consistent appearance</span><textarea class="form-textarea" data-character-appearance rows="2" maxlength="2000" placeholder="Age, face, hair, body, signature wardrobe...">${html(item.appearance)}</textarea></label></div>
            <button class="video-world-character-remove" type="button" aria-label="Remove character">×</button>
        </article>`;
    }

    function bindImageInput(input, target, onReady) {
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type) || file.size > 6 * 1024 * 1024) return showToast('Use a JPEG, PNG or WebP image smaller than 6 MB.', 'error');
            if (typeof normalizeUploadedImage === 'function') {
                try {
                    const data = safeImage(await normalizeUploadedImage(file, 1024, 0.86));
                    if (!data) throw new Error('Empty normalized image');
                    onReady(data);
                    updateEditorCost();
                    if (target.contains(input)) {
                        target.querySelectorAll('img, span').forEach(item => item.remove());
                        input.insertAdjacentHTML('beforebegin', `<img src="${html(data)}" alt="Reference preview">`);
                    } else target.innerHTML = `<img src="${html(data)}" alt="Reference preview">`;
                    return;
                } catch (error) { console.warn('Reference normalization failed; using the original image.', error); }
            }
            const reader = new FileReader();
            reader.onload = () => {
                const data = safeImage(reader.result);
                if (!data) return showToast('That image could not be read.', 'error');
                onReady(data);
                updateEditorCost();
                if (target.contains(input)) {
                    target.querySelectorAll('img, span').forEach(item => item.remove());
                    input.insertAdjacentHTML('beforebegin', `<img src="${html(data)}" alt="Reference preview">`);
                } else target.innerHTML = `<img src="${html(data)}" alt="Reference preview">`;
            };
            reader.readAsDataURL(file);
        };
    }

    function bindCharacterCard(card) {
        card.querySelector('.video-world-character-remove').onclick = () => { card.remove(); updateEditorCost(); };
        const target = card.querySelector('.video-world-character-reference');
        const input = card.querySelector('[data-character-image]');
        bindImageInput(input, target, data => { card.dataset.referenceImage = data; });
    }

    function renderCharacters(characters = []) {
        const container = byId('video-world-characters');
        container.innerHTML = characters.map(characterCard).join('');
        container.querySelectorAll('.video-world-character-card').forEach((card, index) => {
            card.dataset.referenceImage = characters[index]?.referenceImage || '';
            bindCharacterCard(card);
        });
    }

    function readCharacters() {
        return [...byId('video-world-characters').querySelectorAll('.video-world-character-card')].map(card => normalizeCharacter({
            id: card.dataset.characterId,
            name: card.querySelector('[data-character-name]').value,
            role: card.querySelector('[data-character-role]').value,
            personality: card.querySelector('[data-character-personality]').value,
            appearance: card.querySelector('[data-character-appearance]').value,
            referenceImage: card.dataset.referenceImage
        })).filter(character => character.name);
    }

    function populateEditor(world = null) {
        const value = world || normalizeWorld({ name: '', tagline: '', premise: '', visualStyle: '', openingShot: '' });
        byId('video-world-studio-title').textContent = world ? `Edit ${world.name}` : 'Create Video Adventure';
        byId('video-world-name').value = world?.name || '';
        byId('video-world-tagline').value = value.tagline;
        byId('video-world-premise').value = value.premise;
        byId('video-world-story-rules').value = value.storyRules;
        renderStylePresets(value.visualPreset);
        byId('video-world-style').value = value.visualStyle;
        selectButtonValue('video-world-viewpoint', value.viewpoint);
        byId('video-world-player-description').value = value.playerDescription;
        const playerPreview = byId('video-world-player-reference-preview');
        playerPreview.dataset.image = value.playerReferenceImage;
        playerPreview.innerHTML = value.playerReferenceImage ? `<img src="${html(value.playerReferenceImage)}" alt="Player reference preview">` : '<span>No player reference added</span>';
        renderCharacters(value.characters);
        byId('video-world-opening').value = value.openingShot;
        byId('video-world-resolution').value = value.resolution;
        byId('video-world-duration').value = String(value.duration);
        byId('video-world-aspect').value = value.aspectRatio;
        byId('video-world-safety-checker').checked = state.globalSettings?.falSafetyChecker !== false
            && value.falSafetyChecker !== false;
        byId('video-world-content-route').value = value.contentRoute;
        byId('video-world-renderer-primary').value = value.rendererPrimary;
        byId('video-world-renderer-fallback').value = value.rendererFallback === value.rendererPrimary ? '' : value.rendererFallback;
        byId('video-world-renderer-fallback-2').value = [value.rendererPrimary, value.rendererFallback].includes(value.rendererFallback2) ? '' : value.rendererFallback2;
        byId('video-world-spicy-primary').value = value.spicyRendererPrimary;
        byId('video-world-spicy-fallback').value = value.spicyRendererFallback === value.spicyRendererPrimary ? '' : value.spicyRendererFallback;
        byId('video-world-spicy-fallback-2').value = [value.spicyRendererPrimary, value.spicyRendererFallback].includes(value.spicyRendererFallback2) ? '' : value.spicyRendererFallback2;
        byId('video-world-budget').value = value.sessionBudget.toFixed(2);
        byId('video-world-director-model').value = value.directorModel || DEFAULT_DIRECTOR_MODEL;
        byId('video-world-story-depth').value = String(value.storyBlockDepth);
        byId('video-world-reference-strategy').value = value.referenceStrategy;
        byId('video-world-director-status').textContent = `Provider: ${typeof cloudProviderName === 'function' ? cloudProviderName() : state.globalSettings?.apiProvider || 'default'} · Not tested`;
        byId('delete-video-world-btn').classList.toggle('hidden', !world);
        updateEditorCost();
    }

    function openNewEditor() {
        state.editingVideoWorldId = null;
        populateEditor(null);
        switchView('videoWorldStudio');
    }

    function openEditor(id) {
        const world = state.videoWorlds.find(item => item.id === id);
        if (!world) return;
        state.editingVideoWorldId = world.id;
        populateEditor(world);
        switchView('videoWorldStudio');
    }

    function readEditor() {
        const existing = editorWorld();
        return normalizeWorld({
            ...(existing || {}),
            version: VIDEO_WORLD_VERSION,
            name: byId('video-world-name').value,
            tagline: byId('video-world-tagline').value,
            premise: byId('video-world-premise').value,
            storyRules: byId('video-world-story-rules').value,
            visualPreset: byId('video-world-style-presets').dataset.value,
            visualStyle: byId('video-world-style').value,
            viewpoint: byId('video-world-viewpoint').dataset.value,
            playerDescription: byId('video-world-player-description').value,
            playerReferenceImage: byId('video-world-player-reference-preview').dataset.image,
            characters: readCharacters(),
            openingShot: byId('video-world-opening').value,
            resolution: byId('video-world-resolution').value,
            duration: Number(byId('video-world-duration').value),
            aspectRatio: byId('video-world-aspect').value,
            falSafetyChecker: byId('video-world-safety-checker').checked,
            contentRoute: byId('video-world-content-route').value,
            rendererPrimary: byId('video-world-renderer-primary').value,
            rendererFallback: byId('video-world-renderer-fallback').value,
            rendererFallback2: byId('video-world-renderer-fallback-2').value,
            spicyRendererPrimary: byId('video-world-spicy-primary').value,
            spicyRendererFallback: byId('video-world-spicy-fallback').value,
            spicyRendererFallback2: byId('video-world-spicy-fallback-2').value,
            sessionBudget: Number(byId('video-world-budget').value),
            directorModel: byId('video-world-director-model').value,
            storyBlockDepth: Number(byId('video-world-story-depth').value),
            referenceStrategy: byId('video-world-reference-strategy').value,
            updatedAt: Date.now()
        });
    }

    function updateEditorCost() {
        const resolution = byId('video-world-resolution')?.value || '480P';
        const duration = Number(byId('video-world-duration')?.value) || 5;
        const route = CONTENT_ROUTES.has(byId('video-world-content-route')?.value) ? byId('video-world-content-route').value : 'standard';
        const primary = byId('video-world-renderer-primary')?.value || 'minimax/h3-max';
        const fallback = byId('video-world-renderer-fallback')?.value || '';
        const fallback2 = byId('video-world-renderer-fallback-2')?.value || '';
        const standardChain = [primary, fallback, fallback2].filter((item, index, list) => VIDEO_RENDERERS.has(item) && list.indexOf(item) === index);
        const spicyValues = [byId('video-world-spicy-primary')?.value || 'minimax-h3-spicy', byId('video-world-spicy-fallback')?.value || '', byId('video-world-spicy-fallback-2')?.value || ''];
        const spicyChain = spicyValues.filter((item, index, list) => SPICY_VIDEO_RENDERERS.has(item) && list.indexOf(item) === index);
        const chain = route === 'spicy_first' ? spicyChain : route === 'standard_then_spicy' ? [...standardChain, ...spicyChain] : standardChain;
        const estimates = chain.map(renderer => ({
            renderer,
            duration: rendererDuration(renderer, duration),
            cost: rendererDuration(renderer, duration) * rendererRate(renderer, resolution)
        }));
        const maximum = Math.max(...estimates.map(item => item.cost));
        const target = byId('video-world-cost-preview');
        if (target) target.innerHTML = `<span>Maximum successful shot</span><strong>${money(maximum)}</strong><small>${estimates.map(item => `${VIDEO_RENDERER_LABELS[item.renderer] || SPICY_RENDERER_LABELS[item.renderer]} ${item.duration}s ${money(item.cost)}`).join(' · ')}. Failed upstream requests can still be billable before a fallback begins.</small>`;
        const note = byId('video-world-renderer-note');
        if (note) note.textContent = route === 'standard'
            ? `Standard: Fal · ${standardChain.map(renderer => VIDEO_RENDERER_LABELS[renderer]).join(' → ')}`
            : route === 'spicy_first'
                ? `Spicy: HotAPI · ${spicyChain.map(renderer => SPICY_RENDERER_LABELS[renderer]).join(' → ')}`
                : `Smart fallback: Fal (${standardChain.map(renderer => VIDEO_RENDERER_LABELS[renderer]).join(' → ')}) then HotAPI (${spicyChain.map(renderer => SPICY_RENDERER_LABELS[renderer]).join(' → ')})`;
        const standardGroup = byId('video-world-standard-renderers');
        const spicyGroup = byId('video-world-spicy-renderers');
        standardGroup?.classList.toggle('hidden', route === 'spicy_first');
        spicyGroup?.classList.toggle('hidden', route === 'standard');
        byId('video-world-fal-safety-controls')?.classList.toggle('hidden', route === 'spicy_first');
        const routeNote = byId('video-world-content-route-note');
        if (routeNote) {
            routeNote.classList.toggle('spicy', route !== 'standard');
            routeNote.textContent = route === 'standard'
                ? 'Fastest and cheapest. Uses only the configured Fal chain and its provider safety behavior.'
                : route === 'standard_then_spicy'
                    ? 'Recommended mixed mode. Fal gets the first attempt; if the complete Fal chain rejects or fails, the original scene moves to your HotAPI spicy chain.'
                    : 'Uses HotAPI for every scene from the opening onward. This avoids switching visual families after a refusal, but preparation is slower and more expensive.';
        }
        const depth = Number(byId('video-world-story-depth')?.value) || 2;
        const plannedBeats = storyBlockNodeCount(depth);
        const pathScenes = depth + 1;
        const blockTarget = byId('video-world-block-cost-preview');
        const referenceStrategy = byId('video-world-reference-strategy')?.value || 'auto';
        const hasReferences = !!byId('video-world-player-reference-preview')?.dataset.image
            || [...(byId('video-world-characters')?.querySelectorAll('.video-world-character-card') || [])].some(card => !!card.dataset.referenceImage);
        const nativeReferences = route !== 'spicy_first' && standardChain.some(renderer => renderer === 'minimax/h3-max' || renderer === 'alibaba/wan-3.0');
        const nativeReferenceShot = standardChain.includes('minimax/h3-max') ? Math.max(maximum, duration * 0.08) : maximum;
        const keyframeLikely = hasReferences && (referenceStrategy === 'keyframe' || (referenceStrategy === 'auto' && !nativeReferences));
        const chosenPathEstimate = maximum * pathScenes
            + (hasReferences && nativeReferences && referenceStrategy !== 'keyframe' ? nativeReferenceShot - maximum : 0)
            + (keyframeLikely ? REFERENCE_KEYFRAME_COST : 0);
        const referenceNote = referenceStrategy === 'direct'
            ? 'Direct references add no separate anchor-image charge when H3 or Wan is available; native reference-video rates may differ from ordinary shots.'
            : `An identity anchor is generated only when the opening or a new cast entrance requires one; each anchor currently adds about ${money(REFERENCE_KEYFRAME_COST)}.`;
        if (blockTarget) blockTarget.innerHTML = `<span>Chosen-path estimate</span><strong>${money(chosenPathEstimate)}</strong><small>${plannedBeats} text-planned beats · only ${pathScenes} paid video${pathScenes === 1 ? '' : 's'} if one complete path is played · nothing is charged for unused branches. ${referenceNote} More new-character entrances can add more anchors. Failed upstream requests may still be billable.</small>`;
    }

    async function saveEditor() {
        const world = readEditor();
        if (!world.name || ['Untitled Video World', 'Untitled Video Adventure'].includes(world.name)) return showToast('Name your Video Adventure first.', 'error');
        if (!world.premise) return showToast('Add a premise and player role.', 'error');
        if (!world.openingShot) return showToast('Describe the opening shot.', 'error');
        if (shotCost(world) > world.sessionBudget + 0.000001) return showToast(`One video shot can cost up to ${money(shotCost(world))}, above the ${money(world.sessionBudget)} timeline limit. Raise the limit or choose a cheaper renderer, duration or resolution.`, 'error');
        const existingIndex = state.videoWorlds.findIndex(item => item.id === state.editingVideoWorldId);
        if (existingIndex >= 0) state.videoWorlds[existingIndex] = world;
        else state.videoWorlds.unshift(world);
        state.activeVideoWorldId = world.id;
        state.editingVideoWorldId = world.id;
        sessionStore(world.id);
        await saveState();
        showToast(existingIndex >= 0 ? 'Video Adventure saved.' : 'Video Adventure created.', 'success');
        openPlay(world.id);
    }

    async function testEditorDirector() {
        const button = byId('video-world-test-director');
        const status = byId('video-world-director-status');
        const world = readEditor();
        if (!world.directorModel) {
            status.textContent = 'Choose a Director model first.';
            return;
        }
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 20000);
        const startedAt = performance.now();
        button.disabled = true;
        status.textContent = 'Testing story planning…';
        try {
            const session = normalizeSession({});
            const plan = await requestStoryBlock(world, session, '', { signal: controller.signal, depth: world.storyBlockDepth });
            const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
            status.textContent = `Ready in ${elapsed}s · ${plan.nodes.length} planned scenes`;
            showToast('World Director is ready.', 'success');
        } catch (error) {
            status.textContent = controller.signal.aborted
                ? 'Timed out after 20s — choose a faster model or check the provider.'
                : `Failed: ${error.message || 'Director request failed'}`;
        } finally {
            clearTimeout(deadline);
            button.disabled = false;
        }
    }

    async function deleteEditorWorld() {
        const world = editorWorld();
        if (!world) return;
        const store = sessionStore(world.id);
        const mediaIds = store.sessions.flatMap(session => session.shots || []).map(shot => shot.mediaId).filter(Boolean);
        showConfirmModal('Delete Video Adventure', `Delete “${world.name}” and its ${mediaIds.length} locally saved clip${mediaIds.length === 1 ? '' : 's'}? This cannot be undone.`, async () => {
            generationToken++;
            state.videoWorlds = state.videoWorlds.filter(item => item.id !== world.id);
            delete state.videoWorldSessions[world.id];
            if (state.activeVideoWorldId === world.id) state.activeVideoWorldId = state.videoWorlds[0]?.id || null;
            state.editingVideoWorldId = null;
            await saveState();
            if (mediaIds.length) {
                void mcpBridgeRequest('/fal/video/delete', { method: 'POST', body: { mediaIds }, timeoutMs: 30000 }).catch(error => console.warn('Could not remove Video Adventure media:', error));
            }
            switchView('videoWorlds');
            showToast('Video Adventure deleted.', 'success');
        }, 'Delete Video Adventure', 'Cancel');
    }

    function openPlay(id) {
        const world = state.videoWorlds.find(item => item.id === id);
        if (!world) return;
        state.activeVideoWorldId = world.id;
        activeSession(world, true);
        saveState().catch(error => console.error('Could not save active Video Adventure:', error));
        renderPlay();
        switchView('videoWorldPlay');
    }

    function renderPlay() {
        const world = activeWorld();
        const session = activeSession(world, false);
        if (!world || !session) {
            switchView('videoWorlds');
            return;
        }
        byId('video-world-play-title').textContent = world.name;
        byId('video-world-play-tagline').textContent = world.tagline || world.premise;
        const store = sessionStore(world.id);
        const runSelect = byId('video-world-run-name');
        runSelect.innerHTML = store.sessions.map(item => `<option value="${html(item.id)}">${html(item.name)}</option>`).join('');
        runSelect.value = session.id;
        byId('video-world-run-spend').textContent = `${money(session.spent)} / ${money(world.sessionBudget)}`;
        const block = session.storyBlock;
        const activeNode = blockNode(session);
        const blockReady = block?.status === 'ready' && activeNode;
        const blockComplete = blockReady && activeNode.choices.length === 0;
        byId('video-world-next-cost').textContent = blockReady && !blockComplete
            ? `Next chosen video: up to ${money(shotCost(world))}`
            : `Opening video: up to ${money(shotCost(world))}`;
        byId('video-world-action-label').textContent = !blockReady ? (block ? 'Resume opening scene' : 'Begin your story') : blockComplete ? 'Planned story complete' : 'Choose your next beat';
        byId('video-world-generate').textContent = block?.status && block.status !== 'ready' ? 'Resume opening' : blockComplete ? 'Plan next story' : 'Plan & film opening';
        byId('video-world-generate').classList.toggle('hidden', blockReady && !blockComplete);
        byId('video-world-action').placeholder = blockComplete
            ? 'Optional: tell the Director where the next story plan should begin…'
            : 'Optional: add one direction before the decision tree is planned…';
        renderActionChoices(world, session);
        if (session.pendingVideoJob?.jobId) void resumeVideoJob(world, session);

        let current = session.shots.find(shot => shot.id === session.playingShotId)
            || (activeNode ? blockNodeShot(session, activeNode) : null)
            || session.shots.find(shot => shot.id === session.pathShotIds.at(-1))
            || null;
        if (current && !session.playingShotId) session.playingShotId = current.id;
        const player = byId('video-world-player');
        byId('video-world-stage').classList.toggle('has-footage', !!current);
        byId('video-world-stage-empty').classList.toggle('hidden', !!current);
        player.classList.toggle('hidden', !current);
        if (current) {
            const url = mediaUrl(current);
            if (player.dataset.mediaId !== current.mediaId) {
                player.dataset.mediaId = current.mediaId;
                if (session.transitionFrame) player.poster = session.transitionFrame;
                player.src = url;
                player.load();
                player.onloadeddata = () => {
                    player.removeAttribute('poster');
                    session.transitionFrame = '';
                };
            }
        } else {
            player.removeAttribute('src');
            player.dataset.mediaId = '';
            player.load();
        }
        const queued = session.shots.find(shot => shot.id === session.queuedShotId);
        const preloader = byId('video-world-preloader');
        if (queued && preloader.dataset.mediaId !== queued.mediaId) {
            preloader.dataset.mediaId = queued.mediaId;
            preloader.src = mediaUrl(queued);
            preloader.load();
        } else if (!queued && preloader.dataset.mediaId) {
            preloader.removeAttribute('src');
            preloader.dataset.mediaId = '';
            preloader.load();
        }

        const timeline = byId('video-world-timeline');
        const pathShots = session.pathShotIds.map(id => session.shots.find(shot => shot.id === id)).filter(Boolean);
        timeline.innerHTML = pathShots.length ? [...pathShots].reverse().map((shot, reverseIndex) => {
            const pathIndex = pathShots.length - reverseIndex;
            return `<button class="video-world-shot-card${shot.id === current?.id ? ' active' : ''}" data-video-shot-id="${html(shot.id)}" type="button">
                <span>${String(pathIndex).padStart(2, '0')}</span><div><strong>${html(pathIndex === 1 ? 'Opening shot' : shot.action || 'Planned beat')}</strong><small>${shot.duration}s · ${html(shot.resolution.replace('P', 'p'))} · ${money(shot.cost)}${shot.continuityCaptured ? ' · prepared' : ''}</small></div>
            </button>`;
        }).join('') : '<div class="video-world-empty-timeline"><strong>No footage yet</strong><span>Plan the story and film its opening scene to begin.</span></div>';
        timeline.querySelectorAll('[data-video-shot-id]').forEach(button => {
            button.onclick = () => {
                const shot = session.shots.find(item => item.id === button.dataset.videoShotId);
                if (!shot) return;
                player.dataset.mediaId = shot.mediaId;
                player.src = mediaUrl(shot);
                player.load();
                player.play().catch(() => {});
                timeline.querySelectorAll('.video-world-shot-card').forEach(card => card.classList.toggle('active', card === button));
            };
        });
    }

    function renderActionChoices(world, session) {
        const container = byId('video-world-choices');
        const input = byId('video-world-action');
        if (!container || !input) return;
        const block = session.storyBlock;
        const activeNode = blockNode(session);
        const ready = block?.status === 'ready' && activeNode;
        container.classList.toggle('hidden', !ready);
        if (!ready) {
            input.classList.remove('hidden');
            input.dataset.customAction = '';
            return;
        }
        const options = activeNode.choices || [];
        if (!options.length) {
            container.innerHTML = '<div class="video-world-choice-status"><strong>Planned story complete</strong><small>This chosen path reached the end of its current plan. Plan the next decision tree when you are ready to continue.</small></div>';
            input.classList.remove('hidden');
            input.dataset.customAction = 'true';
            return;
        }
        const selectedShotEstimate = money(shotCost(world));
        container.innerHTML = options.length
            ? options.map(option => `<button type="button" data-video-world-target="${html(option.targetId)}"><strong>${html(option.label)}</strong><small>${html(option.consequenceHint || option.action)} · renders one video up to ${selectedShotEstimate}</small></button>`).join('') + '<button type="button" class="video-world-custom-choice" data-video-world-custom>Go off-script…</button>'
            : '';
        input.classList.toggle('hidden', input.dataset.customAction !== 'true');
        container.querySelectorAll('[data-video-world-target]').forEach(button => {
            button.onclick = () => {
                input.value = '';
                input.dataset.customAction = '';
                input.classList.add('hidden');
                container.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
                queueMicrotask(() => { void choosePreparedBranch(button.dataset.videoWorldTarget); });
            };
        });
        const custom = container.querySelector('[data-video-world-custom]');
        if (custom) custom.onclick = () => {
            input.value = '';
            input.dataset.customAction = 'true';
            input.classList.remove('hidden');
            byId('video-world-generate').classList.remove('hidden');
            byId('video-world-generate').textContent = 'Plan custom path';
            container.querySelectorAll('button').forEach(item => item.classList.remove('active'));
            input.focus();
        };
    }

    function extractJson(text) {
        const cleaned = String(text || '').trim()
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        try { return JSON.parse(cleaned); } catch (_) {
            const repaired = typeof safeParseJSONRepair === 'function' ? safeParseJSONRepair(cleaned) : null;
            if (repaired && typeof repaired === 'object' && !Array.isArray(repaired)) return repaired;
            if (typeof extractJSON === 'function') {
                try {
                    const extracted = extractJSON(cleaned);
                    if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) return extracted;
                } catch (_) {}
            }
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) {}
            }
            throw new Error('The Director returned an invalid story plan.');
        }
    }

    function directorMessageText(payload) {
        const content = payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? '';
        if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('\n').trim();
        return String(content || '').trim();
    }

    async function fetchDirectorPayload(body, signal) {
        const call = requestBody => fetch(apiBase() + '/chat/completions', {
            method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json', ...attributionHeaders() },
            body: JSON.stringify(requestBody), signal
        });
        let response = await call(body);
        if (!response.ok) {
            const detail = await response.text();
            if (body.response_format && /response_format|json_object|json mode|not support|expected.*json/i.test(detail)) {
                const compatible = { ...body };
                delete compatible.response_format;
                response = await call(compatible);
                if (!response.ok) throw new Error(`World Director failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
            } else {
                throw new Error(`World Director failed (${response.status}): ${detail.slice(0, 240)}`);
            }
        }
        const raw = await response.text();
        try { return JSON.parse(raw); }
        catch (_) { throw new Error('The text provider returned a non-JSON API response. Check its base URL and model compatibility.'); }
    }

    function normalizeBeatPlan(raw = {}) {
        const names = value => Array.isArray(value)
            ? [...new Set(value.map(item => String(item || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 12)
            : [];
        return {
            sceneSummary: String(raw.sceneSummary || '').trim().slice(0, 3000),
            videoPrompt: String(raw.videoPrompt || '').trim().slice(0, 6000),
            visibleCharacters: names(raw.visibleCharacters),
            introducedCharacters: names(raw.introducedCharacters),
            dialogue: Array.isArray(raw.dialogue) ? raw.dialogue.slice(0, 6).map(line => ({ speaker: String(line?.speaker || '').slice(0, 120), line: String(line?.line || '').slice(0, 500), language: String(line?.language || 'English').slice(0, 40) })).filter(line => line.speaker && line.line) : [],
            statePatch: raw.statePatch && typeof raw.statePatch === 'object' ? raw.statePatch : {}
        };
    }

    function normalizeStoryBlock(raw = {}) {
        const requestedDepth = STORY_BLOCK_DEPTHS.has(Number(raw.depth)) ? Number(raw.depth) : 2;
        const normalized = {
            id: String(raw.id || uid('story_block')).slice(0, 100),
            title: String(raw.title || 'Story block').trim().slice(0, 160),
            summary: String(raw.summary || '').trim().slice(0, 1000),
            depth: requestedDepth,
            rootId: '',
            status: ['planned', 'preparing', 'ready', 'partial', 'failed'].includes(raw.status) ? raw.status : 'planned',
            sourceAction: String(raw.sourceAction || '').trim().slice(0, 3000),
            createdAt: Number(raw.createdAt) || Date.now(),
            nodes: []
        };
        if (Array.isArray(raw.nodes)) {
            const seen = new Set();
            normalized.nodes = raw.nodes.slice(0, 100).map((source, index) => {
                let id = String(source?.id || `node_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
                while (seen.has(id)) id = `${id}_${index + 1}`;
                seen.add(id);
                return {
                    id,
                    parentId: String(source?.parentId || '').slice(0, 100),
                    level: clamp(source?.level, 0, 10, 0),
                    inboundLabel: String(source?.inboundLabel || '').trim().slice(0, 80),
                    inboundAction: String(source?.inboundAction || '').trim().slice(0, 600),
                    inboundHint: String(source?.inboundHint || '').trim().slice(0, 180),
                    ...normalizeBeatPlan(source),
                    choices: Array.isArray(source?.choices) ? source.choices.slice(0, 3).map(choice => ({
                        label: String(choice?.label || '').trim().slice(0, 80),
                        action: String(choice?.action || '').trim().slice(0, 600),
                        consequenceHint: String(choice?.consequenceHint || '').trim().slice(0, 180),
                        targetId: String(choice?.targetId || '').slice(0, 100)
                    })).filter(choice => choice.label && choice.action && choice.targetId) : [],
                    shotId: String(source?.shotId || '').slice(0, 100),
                    referenceFrame: safeImage(source?.referenceFrame),
                    renderError: String(source?.renderError || '').slice(0, 500)
                };
            });
            const ids = new Set(normalized.nodes.map(node => node.id));
            normalized.rootId = ids.has(raw.rootId) ? raw.rootId : normalized.nodes.find(node => !node.parentId)?.id || normalized.nodes[0]?.id || '';
            normalized.nodes.forEach(node => { node.choices = node.choices.filter(choice => ids.has(choice.targetId)); });
        } else if (raw.root && typeof raw.root === 'object') {
            let counter = 0;
            const walk = (beat, level, parentId = '', inbound = {}) => {
                counter++;
                const id = `block_node_${counter}`;
                const node = {
                    id, parentId, level,
                    inboundLabel: String(inbound.label || '').trim().slice(0, 80),
                    inboundAction: String(inbound.action || '').trim().slice(0, 600),
                    inboundHint: String(inbound.consequenceHint || '').trim().slice(0, 180),
                    ...normalizeBeatPlan(beat), choices: [], shotId: '', referenceFrame: '', renderError: ''
                };
                normalized.nodes.push(node);
                if (level < requestedDepth) {
                    const choices = Array.isArray(beat?.choices) ? beat.choices.slice(0, 3) : [];
                    if (choices.length !== STORY_BLOCK_BRANCHING || choices.some(choice => !choice?.nextBeat)) {
                        throw new Error(`The Director returned an incomplete decision tree at level ${level + 1}.`);
                    }
                    node.choices = choices.map((choice, index) => {
                        const normalizedChoice = {
                            label: String(choice?.label || `Choice ${index + 1}`).trim().slice(0, 80),
                            action: String(choice?.action || '').trim().slice(0, 600),
                            consequenceHint: String(choice?.consequenceHint || '').trim().slice(0, 180)
                        };
                        if (!normalizedChoice.action) throw new Error('The Director returned a choice without a playable action.');
                        const child = walk(choice.nextBeat, level + 1, id, normalizedChoice);
                        return { ...normalizedChoice, targetId: child.id };
                    });
                }
                return node;
            };
            normalized.rootId = walk(raw.root, 0).id;
        }
        if (!normalized.rootId || !normalized.nodes.length) throw new Error('The Director returned an empty story block.');
        const expected = storyBlockNodeCount(normalized.depth);
        if (normalized.nodes.length !== expected) throw new Error(`The Director planned ${normalized.nodes.length} scenes; this block requires ${expected}.`);
        return normalized;
    }

    async function requestStoryBlock(world, session, action = '', options = {}) {
        const model = world.directorModel || DEFAULT_DIRECTOR_MODEL;
        if (!model) throw new Error('Choose a fast text model before preparing a Video Adventure.');
        const depth = STORY_BLOCK_DEPTHS.has(Number(options.depth)) ? Number(options.depth) : world.storyBlockDepth;
        const context = directorContext(world, session, action);
        context.blockDepth = depth;
        context.requiredSceneCount = storyBlockNodeCount(depth);
        context.lastVisitedScene = session.activeNodeId && session.storyBlock
            ? session.storyBlock.nodes.find(node => node.id === session.activeNodeId)?.sceneSummary || '' : '';
        const recursiveExample = depth === 1
            ? 'The root has exactly three choices. Each choice has one terminal nextBeat with choices: [].'
            : 'The root has exactly three choices. Each level-1 nextBeat has exactly three choices. Every level-2 nextBeat is terminal with choices: [].';
        const system = `You are the story architect for a playable cinematic role-playing block. Plan the COMPLETE decision tree before play; you will not be called between choices. Preserve authored canon, causality, player agency, recurring character identity, foreshadowing and payoff. Choices must be specific actions available in the current scene, produce visibly different immediate consequences, and still form one coherent short episode. Never use generic labels such as Engage, Investigate, Continue or Take action. Never place the adventure title in dialogue. Keep dialogue short enough for one ${world.duration}-second shot. For every beat, visibleCharacters must list the exact names of authored cast visibly present, and introducedCharacters must list exact authored names entering the film for the first time on that branch. Never put invented or unauthored names in either list. Return JSON only with this recursive shape: {"title":"private block label","summary":"arc summary","depth":${depth},"root":{"sceneSummary":"one sentence","videoPrompt":"under 80 words; concrete staging, acting, camera and sound","visibleCharacters":["exact authored name"],"introducedCharacters":["exact authored name"],"dialogue":[{"speaker":"name","line":"short exact line","language":"English"}],"statePatch":{"facts":[],"relationships":[],"threads":[]},"choices":[{"label":"2-7 specific words","action":"one sentence player intent","consequenceHint":"under 12 words","nextBeat":{"sceneSummary":"causal result","videoPrompt":"under 70 words","visibleCharacters":[],"introducedCharacters":[],"dialogue":[],"statePatch":{"facts":[],"relationships":[],"threads":[]},"choices":[]}}]}}. ${recursiveExample} Every nonterminal beat must have exactly three choices; terminal beats must have none. Do not use markdown.`;
        const body = {
            model, stream: false, temperature: 0.62, max_tokens: depth === 1 ? 2600 : 6500,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(context) }]
        };
        const payload = await fetchDirectorPayload(body, options.signal);
        const raw = directorMessageText(payload);
        try {
            return normalizeStoryBlock({ ...extractJson(raw), sourceAction: action, status: 'planned' });
        } catch (firstError) {
            if (!raw) throw new Error('The Director returned an empty story block.');
            setGenerationDetail('The Director returned an invalid tree. Repairing the complete block…');
            const repairBody = {
                model, stream: false, temperature: 0, max_tokens: depth === 1 ? 3000 : 7000,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: `${system}\nRepair the supplied draft. Preserve its story but satisfy the exact tree depth and scene count. Return only the corrected object.` },
                    { role: 'user', content: raw.slice(0, 48000) }]
            };
            const repaired = await fetchDirectorPayload(repairBody, options.signal);
            try { return normalizeStoryBlock({ ...extractJson(directorMessageText(repaired)), sourceAction: action, status: 'planned' }); }
            catch (_) { throw new Error(`The selected Director could not produce a valid ${storyBlockNodeCount(depth)}-scene decision tree. Choose a stronger structured-output model or use a Short block.`); }
        }
    }

    function directorContext(world, session, action) {
        const cast = (world.characters || []).map(character => ({ name: character.name, role: character.role, personality: character.personality, appearance: character.appearance, hasReferenceImage: !!character.referenceImage }));
        // Only the selected path is ever rendered or canonical. The unvisited
        // text-planned branches must not leak into the next story plan.
        const canonicalShots = session.pathShotIds?.length
            ? session.pathShotIds.map(id => session.shots.find(shot => shot.id === id)).filter(Boolean)
            : session.shots.filter(shot => shot.prepared !== true);
        const recent = canonicalShots.slice(-6).map(shot => ({ action: shot.action, scene: shot.sceneSummary || shot.directorPlan?.sceneSummary || '' }));
        return { premise: world.premise, rules: world.storyRules, player: world.playerDescription, viewpoint: world.viewpoint, cast, storyState: session.storyState, recentBeats: recent, playerChoice: action || '', openingSituation: session.shots.length ? '' : world.openingShot };
    }

    function commitDirectorState(session, plan) {
        const stateNow = session.storyState ||= { facts: [], relationships: [], threads: [] };
        for (const key of ['facts', 'relationships', 'threads']) {
            const additions = Array.isArray(plan.statePatch?.[key]) ? plan.statePatch[key].map(String).filter(Boolean) : [];
            stateNow[key] = [...new Set([...(Array.isArray(stateNow[key]) ? stateNow[key] : []), ...additions])].slice(-120);
        }
    }

    function buildPrompt(world, session, action, plan = null, referencePlan = null) {
        const preset = VISUAL_PRESETS.find(item => item[0] === world.visualPreset) || VISUAL_PRESETS[3];
        const cast = world.characters?.length ? world.characters.map(character => `${character.name} — ${character.role || 'recurring character'}. Personality/voice: ${character.personality || 'natural and distinctive'}. Fixed appearance: ${character.appearance || 'match the supplied canonical reference when available'}.`).join('\n') : 'No recurring cast has been authored yet.';
        const common = [
            `Premise and fixed canon: ${world.premise}`,
            world.storyRules ? `Story rules and tone: ${world.storyRules}` : '',
            `PLAYER ROLE: ${world.playerDescription || 'The player inhabits the protagonist and controls their decisions.'}`,
            world.viewpoint === 'first_person' ? 'VIEWPOINT: Strict first-person player point of view. The camera is the player’s eyes. Never show the player’s face or body except plausible hands, feet, reflections or shadows.' : 'VIEWPOINT: Third-person. The player character may appear on camera and must remain visually consistent.',
            `RECURRING CAST:\n${cast}`,
            `Visual style preset: ${preset[1]}. ${preset[2]}`,
            world.visualStyle ? `Additional visual direction: ${world.visualStyle}` : '',
            `Format: one continuous ${world.duration}-second shot with synchronized natural sound. No titles, captions, logos, UI, montage or hard cuts.`,
            'Adventure titles and project names are interface metadata, not story dialogue. Never make any character say or announce one.',
        ].filter(Boolean);
        if (plan?.sceneSummary) common.push(`STORY PURPOSE OF THIS BEAT: ${plan.sceneSummary}`);
        if (plan?.videoPrompt) common.push(`DIRECTOR'S SHOT PLAN: ${plan.videoPrompt}`);
        if (referencePlan?.mapped?.length) common.push(`CANONICAL IMAGE REFERENCES:\n${referencePlan.mapped.map((item, index) => `Image ${index + 1} = ${item.label}. Preserve this identity, face, hair, wardrobe silhouette and distinguishing features.`).join('\n')}\nDo not merge identities or copy one referenced person's face onto another.`);
        const dialogue = (plan?.dialogue || []).filter(line => !String(line.line || '').toLowerCase().includes(String(world.name || '').trim().toLowerCase()));
        if (dialogue.length) common.push(`Perform only this exact scripted dialogue with clear natural speech and accurate lip synchronization:\n${dialogue.map(line => `${line.speaker}: <d>[${line.language || 'English'}] ${line.line}</d>`).join('\n')}`);
        if (!session.shots.length) {
            if (!plan?.videoPrompt) common.push(`Opening shot: ${world.openingShot}`);
            if (action) common.push(`Additional opening detail: ${action}`);
        } else {
            common.push('The supplied image is the exact final frame of the previous canonical shot. Continue from it without resetting the scene, changing identities, teleporting subjects, or replacing visible clothing and objects.');
            if (!plan?.videoPrompt) common.push(`Next action or story beat: ${action}`);
            common.push('Show the consequence clearly, preserve physical continuity, and end on a stable frame suitable for continuing the film.');
        }
        return common.join('\n\n');
    }

    function rendererSafeText(value) {
        return String(value || '')
            .replace(/\b(?:very\s+large|huge|enormous)\s+(?:breasts?|boobs?|bust)\b/gi, 'distinctive formal costume')
            .replace(/\b(?:breasts?|boobs?|cleavage|busty)\b/gi, 'costume')
            .replace(/\b(?:sexy|seductive|erotic|provocative|suggestive|fetish(?:ized)?)\b/gi, 'playful romantic')
            .replace(/\b(?:nude|naked|topless|lingerie)\b/gi, 'fully clothed')
            .replace(/\s{2,}/g, ' ').trim();
    }

    function buildPolicyRestagedPrompt(world, action, plan) {
        const preset = VISUAL_PRESETS.find(item => item[0] === world.visualPreset) || VISUAL_PRESETS[3];
        const dialogue = (plan?.dialogue || [])
            .filter(line => !String(line.line || '').toLowerCase().includes(String(world.name || '').trim().toLowerCase()))
            .map(line => `${rendererSafeText(line.speaker)}: <d>[${line.language || 'English'}] ${rendererSafeText(line.line)}</d>`).join('\n');
        return [
            `PG-13 STORY CONTEXT: ${rendererSafeText(world.premise)}`,
            `PLAYER INTENT: ${rendererSafeText(action)}`,
            `SCENE: ${rendererSafeText(plan?.sceneSummary)}`,
            `SHOT PLAN: ${rendererSafeText(plan?.videoPrompt)}`,
            dialogue ? `SCRIPTED DIALOGUE:\n${dialogue}` : '',
            `VISUAL STYLE: ${preset[1]}. ${preset[2]}`,
            `Adventure titles and project names are interface metadata, not story dialogue. Never make any character say or announce one.`,
            `One continuous ${world.duration}-second scene with synchronized natural sound. All characters are adults and fully clothed. Keep the comedy non-explicit and non-sexualized. No nudity, fetish framing, explicit anatomy, sexual contact, graphic violence, titles, logos, captions or UI.`
        ].filter(Boolean).join('\n\n');
    }

    function setGenerationDetail(detail) {
        generationPhase = detail || '';
        const elapsed = generationStartedAt ? Math.floor((Date.now() - generationStartedAt) / 1000) : 0;
        byId('video-world-generating-detail').textContent = `${generationPhase}${elapsed ? ` · ${elapsed}s` : ''}`;
    }

    function setGenerating(active, detail = '') {
        const overlay = byId('video-world-generating');
        const hasFootage = !!activeSession(activeWorld(), false)?.shots?.length;
        overlay.classList.toggle('hidden', !active);
        overlay.classList.toggle('compact', active && hasFootage);
        if (active) byId('video-world-generating-title').textContent = hasFootage ? 'Filming your chosen scene…' : 'Planning and filming your opening…';
        byId('video-world-generate').disabled = active;
        byId('video-world-stage-generate').disabled = active;
        byId('video-world-new-run').disabled = active;
        byId('video-world-edit').disabled = active;
        byId('video-world-action').disabled = active;
        byId('video-world-choices').querySelectorAll('button').forEach(button => { button.disabled = active; });
        if (active) {
            generationStartedAt = Date.now();
            setGenerationDetail(detail || 'The story is planned; only the selected video scene is being rendered.');
            clearInterval(generationClock);
            generationClock = setInterval(() => setGenerationDetail(generationPhase), 1000);
        } else {
            clearInterval(generationClock);
            generationClock = null;
            generationStartedAt = 0;
            generationPhase = '';
        }
    }

    function cancelGeneration() {
        if (!videoGenerationController) return;
        const session = activeSession(activeWorld(), false);
        const jobId = session?.pendingVideoJob?.jobId;
        generationToken++;
        videoGenerationController.abort();
        videoGenerationController = null;
        if (jobId) {
            const provider = session?.pendingVideoJob?.provider === 'hotapi' ? 'hotapi' : 'fal';
            session.pendingVideoJob = null;
            void saveState();
            void mcpBridgeRequest(`/${provider}/video/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: {}, timeoutMs: 10000 })
                .catch(error => console.warn('Could not mark video job cancelled:', error));
        }
        setGenerating(false);
        showToast('Video render cancelled. Completed clips remain recoverable; the active provider may still bill work already started.', 'info');
    }

    async function captureLastFrame(url) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.muted = true;
            video.preload = 'auto';
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                video.removeAttribute('src');
                video.load();
                fn(value);
            };
            const timeout = setTimeout(() => finish(reject, new Error('Timed out reading the final video frame.')), 30000);
            video.onerror = () => finish(reject, new Error('The generated video could not be read for continuity.'));
            video.onloadedmetadata = () => {
                if (!Number.isFinite(video.duration) || video.duration <= 0) return finish(reject, new Error('The generated video has no readable duration.'));
                video.currentTime = Math.max(0, video.duration - 0.08);
            };
            video.onseeked = () => {
                try {
                    const maximumWidth = 1280;
                    const scale = Math.min(1, maximumWidth / Math.max(1, video.videoWidth));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
                    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
                    const context = canvas.getContext('2d', { alpha: false });
                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    finish(resolve, canvas.toDataURL('image/jpeg', 0.86));
                } catch (error) {
                    finish(reject, error);
                }
            };
            video.src = url;
            video.load();
        });
    }

    async function waitForVideoJob(jobId, signal, provider = 'fal') {
        const deadline = Date.now() + (provider === 'hotapi' ? 16 : 6) * 60 * 1000;
        while (Date.now() < deadline) {
            if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
            const job = await mcpBridgeRequest(`/${provider}/video/jobs/${encodeURIComponent(jobId)}`, { timeoutMs: 12000, signal });
            if (job.status === 'completed') return job.result;
            if (job.status === 'failed' || job.status === 'cancelled') {
                const error = new Error(job.error || `Video job ${job.status}.`);
                error.code = job.errorCode || '';
                error.fields = Array.isArray(job.errorFields) ? job.errorFields : [];
                throw error;
            }
            const attempt = job.currentModel ? ` ${VIDEO_RENDERER_LABELS[job.currentModel] || SPICY_RENDERER_LABELS[job.currentModel] || job.currentModel}` : '';
            const providerLabel = provider === 'hotapi' ? 'HotAPI' : 'Fal';
            setGenerationDetail(job.status === 'queued' ? `${providerLabel} accepted the shot. Waiting for a renderer…` : `${attempt.trim() || providerLabel} is filming the scripted scene…`);
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 1200);
                signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Generation cancelled.', 'AbortError')); }, { once: true });
            });
        }
        throw new Error(`Video generation exceeded ${provider === 'hotapi' ? 'sixteen' : 'six'} minutes. The job remains recoverable after reloading.`);
    }

    async function requestVideoRender(session, pending, body, signal, provider = 'fal') {
        try {
            const submitted = await mcpBridgeRequest(`/${provider}/video/jobs`, {
                method: 'POST', timeoutMs: 15000, signal, body
            });
            session.pendingVideoJob = { ...pending, provider, jobId: submitted.jobId, createdAt: Date.now() };
            await saveState();
            return await waitForVideoJob(submitted.jobId, signal, provider);
        } catch (error) {
            if (provider === 'hotapi') {
                if (/Unknown MCP provider|Unknown bridge endpoint|request failed \(404\)/i.test(error.message || '')) {
                    throw new Error('HotAPI support needs the current local bridge. Restart Horde Studio once, then retry.');
                }
                throw error;
            }
            if (!/Unknown MCP provider|Unknown bridge endpoint|request failed \(404\)/i.test(error.message || '')) throw error;
            session.pendingVideoJob = null;
            await saveState();
            if (body.enableSafetyChecker === false) {
                throw new Error('The running local bridge is from an older Horde build and cannot apply the Fal safety setting. Restart Horde Studio once, then retry.');
            }
            setGenerationDetail('The local bridge is from an older build. Using compatibility mode for this shot…');
            return mcpBridgeRequest('/fal/video/generate', {
                method: 'POST', timeoutMs: 360000, signal, body: { ...body, latencyMode: 'queue' }
            });
        }
    }

    async function requestRoutedVideoRender(world, session, pending, renderBody, signal) {
        const hotBody = {
            ...renderBody,
            apiKey: state.hotapiApiKey,
            models: spicyRendererChain(world)
        };
        if (world.contentRoute === 'spicy_first') {
            setGenerationDetail('Sending this scene directly to the HotAPI spicy chain…');
            return requestVideoRender(session, pending, hotBody, signal, 'hotapi');
        }
        try {
            return await requestVideoRender(session, pending, renderBody, signal, 'fal');
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw error;
            if (world.contentRoute !== 'standard_then_spicy') throw error;
            session.pendingVideoJob = null;
            await saveState();
            setGenerationDetail('The Fal chain could not render this scene. Trying the configured HotAPI spicy chain…');
            showToast('Standard renderers declined or failed this scene. Moving the original scene to HotAPI.', 'info');
            if (world.referenceStrategy !== 'direct' && renderBody.referenceImageDataUrls?.length) {
                try {
                    const referencePlan = referencePlanForBeat(world, session, pending.plan || {}, pending.transitionFrame || '');
                    if (!pending.plan?.referenceFrame && session.spent + shotCost(world) + REFERENCE_KEYFRAME_COST > world.sessionBudget + 0.000001) {
                        throw new Error('The identity-anchor fallback would exceed this timeline budget.');
                    }
                    hotBody.imageDataUrl = await buildReferenceKeyframe(world, session, pending.plan || {}, referencePlan, signal);
                    hotBody.referenceImageDataUrls = [];
                } catch (referenceError) {
                    console.warn('Could not compose the spicy fallback identity anchor:', referenceError);
                    hotBody.imageDataUrl = renderBody.referenceImageDataUrls.find(Boolean) || renderBody.imageDataUrl;
                    hotBody.referenceImageDataUrls = [];
                    showToast('The identity anchor could not be composed; the spicy fallback will use one primary reference.', 'info');
                }
            }
            return requestVideoRender(session, pending, hotBody, signal, 'hotapi');
        }
    }

    async function finishVideoJob(world, session, pending, result) {
        if (!result?.mediaId || session.shots.some(shot => shot.mediaId === result.mediaId)) {
            session.pendingVideoJob = null;
            await saveState();
            return null;
        }
        const plan = pending.plan || normalizeBeatPlan({ sceneSummary: pending.action, videoPrompt: pending.prompt });
        const shot = normalizeShot({
            id: uid('video_shot'), index: session.shots.length + 1,
            action: session.shots.length ? pending.action : (pending.action || world.openingShot),
            sceneSummary: plan.sceneSummary, directorPlan: plan, prompt: pending.prompt,
            storyNodeId: pending.storyNodeId || '', prepared: pending.prepared === true,
            mediaId: result.mediaId, mediaPath: result.mediaUrl, requestId: result.requestId,
            model: result.model, provider: result.provider || pending.provider || (String(result.model || '').includes('spicy') ? 'hotapi' : 'fal'),
            resolution: world.resolution, duration: Number(result.duration) || world.duration,
            seed: result.seed,
            cost: Number.isFinite(Number(result.actualCost)) && Number(result.actualCost) > 0
                ? Number(result.actualCost)
                : String(result.model || '').includes('/reference-to-video') && String(result.model || '').startsWith('minimax/h3-max')
                    ? (Number(result.duration) || world.duration) * 0.08
                    : (Number(result.duration) || world.duration) * rendererRate(rendererFamily(result.model) || world.rendererPrimary, world.resolution),
            inferenceSeconds: result.inferenceSeconds, createdAt: Date.now()
        });
        session.shots.push(shot);
        session.pendingVideoJob = null;
        if (!pending.prepared) session.transitionFrame = pending.transitionFrame || '';
        session.spent = session.shots.reduce((sum, item) => sum + item.cost, 0) + (session.referenceSpend || 0);
        session.updatedAt = Date.now();
        setGenerationDetail('Shot saved. Capturing its final continuity frame…');
        let capturedFrame = '';
        try {
            capturedFrame = await captureLastFrame(`${mcpBridgeBase()}${result.mediaUrl}`);
            shot.continuityCaptured = true;
        } catch (error) {
            shot.continuityCaptured = false;
            console.warn('Video Adventure continuity frame capture failed:', error);
        }
        if (pending.prepared && pending.storyNodeId && session.storyBlock) {
            const node = session.storyBlock.nodes.find(item => item.id === pending.storyNodeId);
            if (node) { node.shotId = shot.id; node.renderError = ''; }
            Object.defineProperty(shot, '_continuityFrame', { value: capturedFrame, configurable: true, enumerable: false });
            await saveState();
            return shot;
        }
        session.lastFrame = capturedFrame;
        const hasPlayingScene = !!session.playingShotId && session.playingShotId !== shot.id;
        if (hasPlayingScene) {
            session.queuedShotId = shot.id;
            session.pendingDirectorPlan = plan;
        } else {
            session.playingShotId = shot.id;
            commitDirectorState(session, plan);
        }
        await saveState();
        return shot;
    }

    async function resumeVideoJob(world, session) {
        const pending = session?.pendingVideoJob;
        if (!pending?.jobId || resumedVideoJobs.has(pending.jobId)) return;
        resumedVideoJobs.add(pending.jobId);
        const controller = new AbortController();
        videoGenerationController = controller;
        let recoveredNode = null;
        setGenerating(true, 'Recovering the selected video scene…');
        try {
            const result = await waitForVideoJob(pending.jobId, controller.signal, pending.provider === 'hotapi' ? 'hotapi' : 'fal');
            const shot = await finishVideoJob(world, session, pending, result);
            recoveredNode = shot && pending.storyNodeId ? blockNode(session, pending.storyNodeId) : null;
            if (shot && recoveredNode) await activateStoryNode(session, recoveredNode, shot);
            renderPlay();
            if (shot) showToast(`Recovered shot ${shot.index}.`, 'success');
        } catch (error) {
            if (error.name !== 'AbortError') {
                session.pendingVideoJob = null;
                await saveState();
                showToast(error.message || 'Could not recover the video job.', 'error');
            }
        } finally {
            resumedVideoJobs.delete(pending.jobId);
            if (videoGenerationController === controller) videoGenerationController = null;
            setGenerating(false);
        }
    }

    function blockNode(session, id = session?.activeNodeId) {
        return session?.storyBlock?.nodes?.find(node => node.id === id) || null;
    }

    function blockNodeShot(session, node) {
        return node?.shotId ? session.shots.find(shot => shot.id === node.shotId) || null : null;
    }

    async function activateStoryNode(session, node, shot) {
        if (!session || !node || !shot) return;
        if (session.storyBlock) session.storyBlock.status = 'ready';
        session.activeNodeId = node.id;
        if (!session.visitedNodeIds.includes(node.id)) {
            session.visitedNodeIds = [...session.visitedNodeIds, node.id].slice(-500);
        }
        if (session.pathShotIds.at(-1) !== shot.id) {
            session.pathShotIds = [...session.pathShotIds, shot.id].slice(-500);
        }
        session.playingShotId = shot.id;
        session.queuedShotId = '';
        session.pendingDirectorPlan = null;
        session.pendingVideoJob = null;
        commitDirectorState(session, node);
        session.updatedAt = Date.now();
        await saveState();
    }

    async function continuityFrameForShot(shot) {
        if (!shot) return '';
        try { return await captureLastFrame(mediaUrl(shot)); }
        catch (error) {
            console.warn('Could not recover a prepared continuity frame:', error);
            return '';
        }
    }

    function referencePlanForBeat(world, session, node, inputFrame = '') {
        const byName = new Map((world.characters || []).map(character => [character.name.toLowerCase(), character]));
        const exact = names => [...new Set((names || []).map(name => byName.get(String(name || '').trim().toLowerCase())).filter(Boolean))];
        const searchable = `${node.sceneSummary || ''} ${node.videoPrompt || ''} ${(node.dialogue || []).map(line => `${line.speaker} ${line.line}`).join(' ')}`.toLowerCase();
        let visible = exact(node.visibleCharacters);
        if (!visible.length) visible = (world.characters || []).filter(character => searchable.includes(character.name.toLowerCase()));
        const seen = new Set((session.pathShotIds || []).flatMap(id => {
            const plan = session.shots.find(shot => shot.id === id)?.directorPlan;
            return [...(plan?.visibleCharacters || []), ...(plan?.introducedCharacters || [])].map(name => String(name).toLowerCase());
        }));
        let introduced = exact(node.introducedCharacters);
        if (!introduced.length) introduced = visible.filter(character => !seen.has(character.name.toLowerCase()));
        const opening = !inputFrame && !(session.pathShotIds || []).length;
        let required = opening ? visible : introduced;
        if (opening && !required.length) required = (world.characters || []).filter(character => character.referenceImage);
        const mapped = [];
        if (inputFrame && introduced.length) mapped.push({ label: 'the exact final frame of the previous canonical shot', dataUrl: inputFrame, kind: 'continuity' });
        for (const character of required) {
            if (character.referenceImage) mapped.push({ label: character.name, dataUrl: character.referenceImage, kind: 'character' });
        }
        if (opening && world.viewpoint !== 'first_person' && world.playerReferenceImage) {
            mapped.unshift({ label: 'the player character', dataUrl: world.playerReferenceImage, kind: 'player' });
        }
        const bounded = [];
        let bytes = 0;
        for (const item of mapped) {
            if (bounded.length >= 4 || bytes + item.dataUrl.length > 22 * 1024 * 1024) continue;
            bounded.push(item);
            bytes += item.dataUrl.length;
        }
        return { opening, introduced: introduced.map(item => item.name), mapped: bounded };
    }

    function canUseDirectReferences(world) {
        return world.contentRoute !== 'spicy_first'
            && rendererChain(world).some(model => model === 'minimax/h3-max' || model === 'alibaba/wan-3.0');
    }

    function shouldBuildReferenceKeyframe(world, referencePlan) {
        if (!referencePlan.mapped.length) return false;
        if (world.referenceStrategy === 'keyframe') return true;
        if (world.referenceStrategy === 'direct') return false;
        return !canUseDirectReferences(world);
    }

    async function buildReferenceKeyframe(world, session, node, referencePlan, signal) {
        if (node.referenceFrame) return node.referenceFrame;
        if (!state.falApiKey) {
            showToast('Fal is needed to compose multiple references for this route. Using the strongest single reference instead.', 'info');
            return referencePlan.mapped[0]?.dataUrl || '';
        }
        setGenerationDetail(`Composing one identity anchor for ${referencePlan.opening ? 'the opening' : `new cast: ${referencePlan.introduced.join(', ')}`}…`);
        const map = referencePlan.mapped.map((item, index) => `Image ${index + 1} is ${item.label}.`).join(' ');
        const result = await mcpBridgeRequest('/fal/image/generate', {
            method: 'POST', timeoutMs: 240000, signal,
            body: {
                apiKey: state.falApiKey,
                model: 'fal-ai/nano-banana-2/edit',
                prompt: `${map} Create a single cinematic identity anchor frame for this exact story beat: ${node.videoPrompt || node.sceneSummary}. Preserve every referenced person's identity and distinguishing wardrobe. Do not merge faces or duplicate people. Match ${world.aspectRatio} composition and ${VISUAL_PRESETS.find(item => item[0] === world.visualPreset)?.[1] || 'cinematic'} style. No text, captions, logos or UI.`,
                imageDataUrls: referencePlan.mapped.map(item => item.dataUrl),
                aspectRatio: world.aspectRatio,
                enableSafetyChecker: state.globalSettings?.falSafetyChecker !== false && world.falSafetyChecker !== false
            }
        });
        const image = safeImage(typeof normalizeGeneratedImageSource === 'function' ? normalizeGeneratedImageSource(result.image) : result.image);
        if (!image) throw new Error('The reference compositor completed without a usable identity anchor.');
        node.referenceFrame = image;
        session.referenceSpend = clamp(session.referenceSpend, 0, 10000, 0) + REFERENCE_KEYFRAME_COST;
        session.spent = session.shots.reduce((sum, shot) => sum + shot.cost, 0) + session.referenceSpend;
        await saveState();
        return image;
    }

    async function renderStoryNode(world, session, node, inputFrame, progress, signal) {
        let shot = blockNodeShot(session, node);
        if (shot) {
            setGenerationDetail('Using the already-rendered selected scene…');
            return { shot, frame: node.choices.length ? await continuityFrameForShot(shot) : '' };
        }
        const action = node.inboundAction || session.storyBlock?.sourceAction || (node.level === 0 ? world.openingShot : node.sceneSummary);
        const hasCanonicalPredecessor = !!node.parentId || session.pathShotIds.length > 0;
        const promptSession = { ...session, shots: hasCanonicalPredecessor ? [{}] : [] };
        const referencePlan = referencePlanForBeat(world, session, node, inputFrame);
        let renderFrame = inputFrame || '';
        let directReferences = [];
        if (referencePlan.mapped.length) {
            if (shouldBuildReferenceKeyframe(world, referencePlan)) {
                if (!node.referenceFrame && session.spent + shotCost(world) + REFERENCE_KEYFRAME_COST > world.sessionBudget + 0.000001) {
                    throw new Error(`This scene needs a ${money(REFERENCE_KEYFRAME_COST)} identity anchor plus up to ${money(shotCost(world))} for video, exceeding the remaining timeline budget.`);
                }
                renderFrame = await buildReferenceKeyframe(world, session, node, referencePlan, signal);
            } else if (canUseDirectReferences(world)) {
                directReferences = referencePlan.mapped;
                renderFrame ||= directReferences.find(item => item.kind !== 'continuity')?.dataUrl || directReferences[0]?.dataUrl || '';
            } else {
                renderFrame ||= referencePlan.mapped.find(item => item.kind !== 'continuity')?.dataUrl || referencePlan.mapped[0]?.dataUrl || '';
            }
        }
        if (directReferences.length && session.spent + referenceShotCost(world) > world.sessionBudget + 0.000001) {
            throw new Error(`This native reference scene can cost up to ${money(referenceShotCost(world))}, exceeding the remaining timeline budget.`);
        }
        const effectiveReferencePlan = directReferences.length ? { ...referencePlan, mapped: directReferences } : null;
        const prompt = buildPrompt(world, promptSession, action, node, effectiveReferencePlan);
        const pending = {
            action, prompt, plan: node, storyNodeId: node.id, prepared: true,
            cost: shotCost(world), transitionFrame: inputFrame || ''
        };
        const renderBody = {
            apiKey: state.falApiKey, prompt, duration: world.duration, resolution: world.resolution,
            aspectRatio: world.aspectRatio, imageDataUrl: renderFrame,
            referenceImageDataUrls: directReferences.map(item => item.dataUrl),
            enableSafetyChecker: state.globalSettings?.falSafetyChecker !== false && world.falSafetyChecker !== false,
            models: directReferences.length ? referenceRendererChain(world) : rendererChain(world),
            seed: Math.floor(Math.random() * 2_000_000_000)
        };
        setGenerationDetail(progress?.opening
            ? `Filming the opening scene · ${session.storyBlock?.nodes?.length || 0} story beats were text-planned…`
            : `Filming only your selected branch · story level ${node.level + 1}…`);
        let result;
        let completedPending = pending;
        try {
            result = await requestRoutedVideoRender(world, session, pending, renderBody, signal);
        } catch (error) {
            const policyRejected = error.code === 'content_policy_violation'
                || /content_policy_violation|content checker/i.test(error.message || '');
            if (world.contentRoute !== 'standard' || !policyRejected || state.globalSettings?.falSafetyChecker === false || world.falSafetyChecker === false) throw error;
            const referenceMap = directReferences.length
                ? `\n\nCANONICAL IMAGE REFERENCES:\n${directReferences.map((item, index) => `Image ${index + 1} = ${item.label}. Preserve identity and do not merge faces.`).join('\n')}` : '';
            const safePrompt = buildPolicyRestagedPrompt(world, action, node) + referenceMap;
            const rejectedFrame = error.fields?.includes('image_url') || /image_url/i.test(error.message || '');
            setGenerationDetail('The selected scene was filtered. Restaging it once…');
            completedPending = { ...pending, prompt: safePrompt, transitionFrame: rejectedFrame ? '' : inputFrame };
            result = await requestRoutedVideoRender(world, session, completedPending, {
                ...renderBody, prompt: safePrompt, imageDataUrl: rejectedFrame ? '' : renderBody.imageDataUrl,
                referenceImageDataUrls: rejectedFrame ? [] : renderBody.referenceImageDataUrls,
                seed: Math.floor(Math.random() * 2_000_000_000)
            }, signal);
        }
        shot = await finishVideoJob(world, session, completedPending, result);
        if (!shot) shot = blockNodeShot(session, node);
        if (!shot) throw new Error('The selected scene completed without a playable media file.');
        return { shot, frame: shot._continuityFrame || (node.choices.length ? await continuityFrameForShot(shot) : '') };
    }

    async function prepareStoryBlock(options = {}) {
        const world = activeWorld();
        const session = activeSession(world, false);
        if (!world || !session) return;
        const needsFal = world.contentRoute !== 'spicy_first';
        const needsHotApi = world.contentRoute !== 'standard';
        if ((needsFal && !state.falApiKey) || (needsHotApi && !state.hotapiApiKey)) {
            const missing = [needsFal && !state.falApiKey ? 'Fal' : '', needsHotApi && !state.hotapiApiKey ? 'HotAPI' : ''].filter(Boolean).join(' and ');
            showToast(`Add your ${missing} API key${missing.includes(' and ') ? 's' : ''} in Settings → Connections first.`, 'error');
            showGlobalSettings();
            if (typeof activateSettingsSection === 'function') activateSettingsSection('accounts');
            return;
        }
        const action = byId('video-world-action').value.trim();
        const resume = options.resume === true && session.storyBlock && session.storyBlock.status !== 'ready';
        const requiredCost = shotCost(world);
        if (session.spent + requiredCost > world.sessionBudget + 0.000001) {
            return showToast(`The next selected video can cost up to ${money(requiredCost)}, exceeding the remaining timeline budget. Raise the limit, start a new timeline, or choose a cheaper renderer.`, 'error');
        }
        const token = ++generationToken;
        videoGenerationController?.abort();
        const controller = new AbortController();
        videoGenerationController = controller;
        const deadline = setTimeout(() => controller.abort(), 30 * 60 * 1000);
        setGenerating(true, resume ? 'Resuming the opening video…' : 'The Director is cheaply planning the complete text decision tree…');
        try {
            let entryFrame = '';
            const currentShot = session.shots.find(shot => shot.id === session.playingShotId);
            if (!resume && currentShot) {
                setGenerationDetail('Capturing the current ending before planning the next story…');
                entryFrame = await continuityFrameForShot(currentShot);
            }
            if (!resume) {
                session.storyBlock = await requestStoryBlock(world, session, action, {
                    depth: world.storyBlockDepth, signal: controller.signal
                });
                session.storyBlock.status = 'preparing';
                session.activeNodeId = '';
                session.visitedNodeIds = [];
                await saveState();
            } else {
                session.storyBlock.status = 'preparing';
                if (currentShot) entryFrame = await continuityFrameForShot(currentShot);
            }
            const block = session.storyBlock;
            const root = block.nodes.find(node => node.id === block.rootId);
            if (!root) throw new Error('The planned story has no opening beat.');
            const result = await renderStoryNode(world, session, root, entryFrame, { opening: true }, controller.signal);
            if (token !== generationToken) return;
            await activateStoryNode(session, root, result.shot);
            session.directorChoices = [];
            await saveState();
            byId('video-world-action').value = '';
            byId('video-world-action').dataset.customAction = '';
            renderPlay();
            byId('video-world-player').play().catch(() => {});
            showToast(`${block.nodes.length} story beats planned; only the opening video was charged.`, 'success');
        } catch (error) {
            if (session.storyBlock && session.storyBlock.status === 'preparing') session.storyBlock.status = 'partial';
            await saveState();
            if (token === generationToken && error.name !== 'AbortError') {
                console.error('Story block preparation failed:', error);
                showToast(error.message || 'Could not plan the story and film its opening.', 'error');
            }
        } finally {
            clearTimeout(deadline);
            if (videoGenerationController === controller) videoGenerationController = null;
            if (token === generationToken) { setGenerating(false); renderPlay(); }
        }
    }

    async function choosePreparedBranch(targetId) {
        const world = activeWorld();
        const session = activeSession(world, false);
        const current = blockNode(session);
        const choice = current?.choices?.find(item => item.targetId === targetId);
        const target = blockNode(session, targetId);
        if (!world || !session || !choice || !target) return showToast('That planned branch is unavailable.', 'error');
        const maximum = shotCost(world);
        if (!blockNodeShot(session, target) && session.spent + maximum > world.sessionBudget + 0.000001) {
            return showToast(`This chosen scene can cost up to ${money(maximum)}, exceeding the remaining timeline budget.`, 'error');
        }
        const token = ++generationToken;
        videoGenerationController?.abort();
        const controller = new AbortController();
        videoGenerationController = controller;
        const deadline = setTimeout(() => controller.abort(), 30 * 60 * 1000);
        setGenerating(true, `Choice locked: ${choice.label}. Filming only this branch…`);
        try {
            const currentShot = session.shots.find(shot => shot.id === session.playingShotId)
                || blockNodeShot(session, current);
            const entryFrame = currentShot ? await continuityFrameForShot(currentShot) : '';
            const result = await renderStoryNode(world, session, target, entryFrame, { opening: false }, controller.signal);
            if (token !== generationToken) return;
            await activateStoryNode(session, target, result.shot);
            renderPlay();
            byId('video-world-player').play().catch(() => {});
        } catch (error) {
            if (token === generationToken && error.name !== 'AbortError') {
                console.error('Selected Video Adventure branch failed:', error);
                showToast(error.message || 'Could not film the selected branch.', 'error');
            }
        } finally {
            clearTimeout(deadline);
            if (videoGenerationController === controller) videoGenerationController = null;
            if (token === generationToken) { setGenerating(false); renderPlay(); }
        }
    }

    function prepareFromComposer() {
        const world = activeWorld();
        const session = activeSession(world, false);
        const custom = byId('video-world-action').dataset.customAction === 'true';
        const resume = !custom && session?.storyBlock && ['planned', 'preparing', 'partial', 'failed'].includes(session.storyBlock.status);
        void prepareStoryBlock({ resume });
    }

    async function newTimeline() {
        const world = activeWorld();
        if (!world) return;
        const store = sessionStore(world.id);
        const session = normalizeSession({ name: `Take ${store.sessions.length + 1}` }, store.sessions.length);
        store.sessions.unshift(session);
        store.activeSessionId = session.id;
        generationToken++;
        videoGenerationController?.abort();
        await saveState();
        renderPlay();
        showToast('Fresh Video Adventure timeline started.', 'success');
    }

    async function renameTimeline() {
        const world = activeWorld();
        const session = activeSession(world, false);
        if (!session) return;
        const name = prompt('Timeline name', session.name);
        if (name === null) return;
        const cleaned = name.trim().slice(0, 120);
        if (!cleaned) return showToast('Timeline name cannot be empty.', 'error');
        session.name = cleaned;
        session.updatedAt = Date.now();
        await saveState();
        renderPlay();
    }

    function deleteTimeline() {
        const world = activeWorld();
        const session = activeSession(world, false);
        if (!world || !session) return;
        const mediaIds = session.shots.map(shot => shot.mediaId).filter(Boolean);
        showConfirmModal('Delete timeline', `Delete “${session.name}” and its ${mediaIds.length} saved clip${mediaIds.length === 1 ? '' : 's'}? This cannot be undone.`, async () => {
            generationToken++;
            videoGenerationController?.abort();
            videoGenerationController = null;
            setGenerating(false);
            const store = sessionStore(world.id);
            store.sessions = store.sessions.filter(item => item.id !== session.id);
            if (!store.sessions.length) store.sessions.push(normalizeSession({ name: 'Take 1' }, 0));
            store.activeSessionId = store.sessions[0].id;
            await saveState();
            renderPlay();
            if (mediaIds.length) void mcpBridgeRequest('/fal/video/delete', { method: 'POST', body: { mediaIds }, timeoutMs: 30000 })
                .catch(error => console.warn('Could not remove timeline media:', error));
            showToast('Timeline deleted.', 'success');
        }, 'Delete timeline', 'Cancel');
    }

    function setup() {
        if (setupComplete) return;
        setupComplete = true;
        ensureState();
        byId('create-video-world-btn').onclick = openNewEditor;
        byId('video-world-studio-back').onclick = () => switchView('videoWorlds');
        byId('video-world-play-back').onclick = () => switchView('videoWorlds');
        byId('save-video-world-btn').onclick = saveEditor;
        byId('delete-video-world-btn').onclick = deleteEditorWorld;
        byId('video-world-generate').onclick = prepareFromComposer;
        byId('video-world-stage-generate').onclick = prepareFromComposer;
        byId('video-world-cancel-generation').onclick = cancelGeneration;
        byId('video-world-player').onended = () => {
            // Choices are already available from the text plan. The selected
            // successor is rendered only after the player chooses it.
        };
        byId('video-world-new-run').onclick = newTimeline;
        byId('video-world-rename-run').onclick = renameTimeline;
        byId('video-world-delete-run').onclick = deleteTimeline;
        byId('video-world-test-director').onclick = testEditorDirector;
        byId('video-world-director-model').addEventListener('input', event => {
            byId('video-world-director-status').textContent = event.target.value.trim()
                ? `Selected for ${typeof cloudProviderName === 'function' ? cloudProviderName() : 'current provider'} · Not tested`
                : 'Choose a Director model.';
        });
        byId('video-world-open-ai-settings').onclick = () => {
            showGlobalSettings();
            if (typeof activateSettingsSection === 'function') activateSettingsSection('models');
        };
        byId('video-world-run-name').onchange = async event => {
            const world = activeWorld();
            if (!world) return;
            const store = sessionStore(world.id);
            if (!store.sessions.some(session => session.id === event.target.value)) return;
            store.activeSessionId = event.target.value;
            generationToken++;
            videoGenerationController?.abort();
            videoGenerationController = null;
            setGenerating(false);
            await saveState();
            renderPlay();
        };
        byId('video-world-edit').onclick = () => activeWorld() && openEditor(activeWorld().id);
        ['video-world-resolution', 'video-world-duration', 'video-world-content-route', 'video-world-reference-strategy', 'video-world-renderer-primary', 'video-world-renderer-fallback', 'video-world-renderer-fallback-2', 'video-world-spicy-primary', 'video-world-spicy-fallback', 'video-world-spicy-fallback-2', 'video-world-story-depth', 'video-world-budget']
            .forEach(id => byId(id).onchange = updateEditorCost);
        byId('video-world-viewpoint').querySelectorAll('[data-value]').forEach(button => button.onclick = () => selectButtonValue('video-world-viewpoint', button.dataset.value));
        byId('video-world-add-character').onclick = () => {
            const container = byId('video-world-characters');
            container.insertAdjacentHTML('beforeend', characterCard());
            bindCharacterCard(container.lastElementChild);
            container.lastElementChild.querySelector('[data-character-name]').focus();
        };
        bindImageInput(byId('video-world-player-reference'), byId('video-world-player-reference-preview'), data => { byId('video-world-player-reference-preview').dataset.image = data; });
        byId('video-world-player').onerror = () => showToast('This clip is missing from the local Video Adventure media folder.', 'error');
        renderLibrary();
    }

    function onView(viewName) {
        if (!setupComplete) return;
        if (viewName === 'videoWorlds') renderLibrary();
        if (viewName === 'videoWorldStudio') populateEditor(editorWorld());
        if (viewName === 'videoWorldPlay') renderPlay();
    }

    window.HordeVideoWorlds = {
        setup,
        onView,
        normalizeWorld,
        normalizeSession,
        normalizeStoryBlock,
        buildPrompt,
        shotCost,
        storyBlockCost
    };
})();
