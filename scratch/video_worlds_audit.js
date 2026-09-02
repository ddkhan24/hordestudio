const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const video = fs.readFileSync('video-worlds.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const bridge = fs.readFileSync('horde_mcp_bridge.py', 'utf8');
const portable = fs.readFileSync('scripts/build-portable.sh', 'utf8');

const runtime = { window: {}, console, Date, Math, Set, Object, Array, String, Number, RegExp };
vm.runInNewContext(video, runtime, { filename: 'video-worlds.js' });
const videoRuntime = runtime.window.HordeVideoWorlds;

let passed = 0;
function test(name, fn) {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
}

test('Video Adventures use independent state and views', () => {
    assert.match(app, /videoWorlds: \[\]/);
    assert.match(app, /videoWorldSessions: \{\}/);
    assert.match(app, /videoWorlds: document\.getElementById\('video-worlds-view'\)/);
    assert.doesNotMatch(video, /state\.worlds|state\.worldInstances|activeWorldId/);
});

test('the first draft persists definitions, sessions and active selection', () => {
    assert.match(app, /videoWorlds: state\.videoWorlds/);
    assert.match(app, /videoWorldSessions: state\.videoWorldSessions/);
    assert.match(app, /activeVideoWorldId: state\.activeVideoWorldId/);
    assert.match(video, /await saveState\(\)/);
});

test('Fal is server-routed and credentials stay out of backups', () => {
    assert.match(html, /id="global-fal-key"/);
    assert.match(video, /mcpBridgeRequest\(`\/\$\{provider\}\/video\/jobs`/);
    assert.match(bridge, /parsed_path == "\/fal\/video\/jobs"/);
    assert.doesNotMatch(app.match(/const payload = \{([\s\S]*?)\n    \};/)[1], /falApiKey/);
});

test('Fal media is selectable across Worlds and Virtual Humans', () => {
    assert.match(html, /id="w-visual-image-provider"[\s\S]*?<option value="fal">Fal<\/option>/);
    assert.match(html, /id="cs-image-source"[\s\S]*?<option value="fal">Fal<\/option>/);
    assert.match(html, /id="cs-video-provider"[\s\S]*?<option value="fal">Fal<\/option>/);
    assert.match(app, /mcpBridgeRequest\('\/fal\/image\/generate'/);
    assert.match(app, /pollCompanionFalVideoJob/);
    assert.match(bridge, /parsed_path == "\/fal\/image\/generate"/);
});

test('Video Adventures expose an ordered H3, Wan and LTX renderer chain', () => {
    assert.match(html, /id="video-world-renderer-primary"/);
    assert.match(html, /id="video-world-renderer-fallback"/);
    assert.match(video, /models: directReferences\.length \? referenceRendererChain\(world\) : rendererChain\(world\)/);
    assert.match(video, /alibaba\/wan-3\.0/);
    assert.match(video, /fal-ai\/ltx-2\.3\/fast/);
    assert.match(video, /const VIDEO_WORLD_VERSION = 6/);
    assert.match(video, /storedVersion >= 3/);
    assert.match(video, /rendererFallback2/);
    assert.match(bridge, /FAL_VIDEO_RENDERERS/);
});

test('character references are routed through native multi-reference video or one cached anchor frame', () => {
    assert.match(html, /id="video-world-reference-strategy"/);
    assert.match(html, /Smart auto · recommended/);
    assert.match(video, /visibleCharacters/);
    assert.match(video, /introducedCharacters/);
    assert.match(video, /function referencePlanForBeat/);
    assert.match(video, /referenceImageDataUrls/);
    assert.match(video, /fal-ai\/nano-banana-2\/edit/);
    assert.match(video, /node\.referenceFrame/);
    assert.match(video, /REFERENCE_KEYFRAME_COST = 0\.08/);
    assert.match(video, /nativeReferenceShot/);
    assert.match(video, /normalizeUploadedImage\(file, 1024, 0\.86\)/);
    assert.match(bridge, /if model == "minimax\/h3-max"[\s\S]*?reference-to-video/);
    assert.match(bridge, /if model == "alibaba\/wan-3\.0" and reference_image_urls/);
    assert.match(bridge, /reference_image_urls/);
    assert.match(bridge, /fal-ai\/nano-banana-2\/edit/);
});

test('Spicy mode is an explicit HotAPI route with ordered premium fallbacks', () => {
    assert.match(html, /id="global-hotapi-key"/);
    assert.match(html, /id="test-hotapi-conn-btn"/);
    assert.match(html, /id="video-world-content-route"/);
    assert.match(html, /Smart spicy fallback · Fal, then HotAPI/);
    assert.match(html, /Spicy from the start · HotAPI only/);
    assert.match(html, /id="video-world-spicy-primary"/);
    assert.match(html, /Seedance 2\.0 Fast Spicy · slower/);
    assert.match(html, /Seedance 2\.5 Spicy · slowest\/premium/);
    assert.match(video, /standard_then_spicy/);
    assert.match(video, /requestRoutedVideoRender/);
    assert.match(video, /state\.hotapiApiKey/);
    assert.match(video, /spicyRendererChain/);
    assert.match(video, /seedance-2\.5-spicy/);
    assert.match(bridge, /HOTAPI_VIDEO_RENDERERS/);
    assert.match(bridge, /submit_hotapi_video_job/);
    assert.match(bridge, /\/hotapi\/video\/jobs/);
    assert.match(bridge, /seedance-2\.5-spicy/);
    assert.match(app, /hotapiApiKey/);
    assert.match(app, /horde_hotapi_api_key/);
});

test('Fal pricing and safety defaults match the current provider contract', () => {
    assert.match(app, /falRate480: 0\.05/);
    assert.match(app, /falRate768: 0\.08/);
    assert.match(app, /migrateExpiredFalLaunchRates/);
    assert.match(app, /falPricingVersion: 2/);
    assert.match(html, /id="global-fal-safety-checker"/);
    assert.match(video, /function rendererDuration/);
    assert.match(video, /\[6, 8, 10, 12, 14, 16, 18, 20\]/);
});

test('Fal configuration is testable and expanded cards use the full modal width', () => {
    assert.match(html, /id="test-fal-conn-btn"/);
    assert.match(app, /mcpBridgeRequest\('\/fal\/video\/test'/);
    assert.match(bridge, /parsed_path == "\/fal\/video\/test"/);
    assert.match(css, /\.settings-provider-grid > \.settings-provider-card\[open\]/);
});

test('play preplans the text tree but renders only the chosen video path', () => {
    assert.match(html, /id="video-world-choices"/);
    assert.match(video, /renderActionChoices/);
    assert.match(video, /requestStoryBlock/);
    assert.match(video, /Plan the COMPLETE decision tree before play/);
    assert.match(video, /you will not be called between choices/);
    assert.match(video, /storyBlockNodeCount/);
    assert.match(video, /function normalizeStoryBlock/);
    assert.match(video, /async function prepareStoryBlock/);
    assert.match(video, /async function renderStoryNode/);
    assert.match(video, /choosePreparedBranch/);
    assert.match(video, /Next chosen video: up to/);
    assert.match(video, /storyState/);
    assert.match(video, /Never use generic labels such as Engage/);
    assert.match(video, /Perform only this exact scripted dialogue/);
    assert.match(video, /Adventure titles and project names are interface metadata/);
    assert.doesNotMatch(video, /`VIDEO ADVENTURE: \$\{(?:rendererSafeText\()?world\.name/);
    assert.match(video, /<d>\[\$\{line\.language/);
    assert.doesNotMatch(video, /\['Engage', 'Approach the most relevant person/);
    assert.match(video, /queueMicrotask\(\(\) => \{ void choosePreparedBranch/);
    assert.match(video, /session\.pathShotIds/);
    assert.match(video, /const canonicalShots = session\.pathShotIds/);
    assert.match(video, /session\.storyBlock\.status = 'preparing'/);
    assert.doesNotMatch(video, /renderBranch/);
    assert.match(video, /await renderStoryNode\(world, session, root, entryFrame/);
    assert.match(video, /await renderStoryNode\(world, session, target, entryFrame/);
    assert.match(video, /async function activateStoryNode/);
    assert.match(video, /prepared: true/);
    assert.doesNotMatch(video, /async function generateShot\(/);
    assert.doesNotMatch(video, /requestDirectorPlan|activateQueuedShot/);
    assert.match(css, /\.video-world-generating\.compact/);
    assert.match(html, /id="video-world-cancel-generation"/);
    assert.match(video, /waitForVideoJob/);
    assert.match(video, /pendingVideoJob/);
    assert.match(video, /resumeVideoJob/);
    assert.match(video, /setInterval\(\(\) => setGenerationDetail/);
    assert.match(app, /externalSignal\?\.addEventListener\('abort'/);
    assert.match(video, /targetId: child\.id/);
    assert.match(video, /const result = await waitForVideoJob/);
    assert.match(html, /id="video-world-stage-generate"/);
    assert.match(bridge, /durable_body\["latencyMode"\] = "queue"/);
    assert.match(bridge, /threading\.Thread\(target=run/);
    assert.match(bridge, /cancel_fal_video_job/);
    assert.match(video, /buildPolicyRestagedPrompt/);
    assert.match(video, /content_policy_violation/);
    assert.match(video, /Unknown MCP provider/);
    assert.match(html, /id="video-world-safety-checker"/);
    assert.match(video, /enableSafetyChecker: state\.globalSettings\?\.falSafetyChecker !== false[\s\S]*?world\.falSafetyChecker !== false/);
    assert.match(video, /safeParseJSONRepair/);
    assert.match(video, /invalid tree\. Repairing the complete block/);
    assert.match(video, /could not produce a valid/);
});

test('story-block normalization enforces a complete bounded decision tree', () => {
    const beat = depth => ({
        sceneSummary: `Level ${depth}`,
        videoPrompt: 'A playable scene with clear staging.',
        dialogue: [],
        statePatch: {},
        choices: depth > 0 ? [1, 2, 3].map(index => ({
            label: `Choice ${index}`,
            action: `Take branch ${index}`,
            consequenceHint: `Result ${index}`,
            nextBeat: beat(depth - 1)
        })) : []
    });
    const short = videoRuntime.normalizeStoryBlock({ depth: 1, root: beat(1) });
    const standard = videoRuntime.normalizeStoryBlock({ depth: 2, root: beat(2) });
    assert.equal(short.nodes.length, 4);
    assert.equal(standard.nodes.length, 13);
    assert.equal(standard.nodes[0].choices.length, 3);
    assert.throws(() => videoRuntime.normalizeStoryBlock({ depth: 1, root: { ...beat(1), choices: beat(1).choices.slice(0, 2) } }), /incomplete decision tree/);
});

test('Director and timeline controls are user-configurable', () => {
    assert.match(html, /id="video-world-director-model"/);
    assert.match(html, /id="video-world-director-model-results"/);
    assert.match(app, /inputId: 'video-world-director-model'.*providerAware: true/);
    assert.match(html, /id="video-world-test-director"/);
    assert.match(video, /const DEFAULT_DIRECTOR_MODEL = 'google\/gemma-4-31b-it'/);
    assert.match(video, /max_tokens: depth === 1 \? 2600 : 6500/);
    assert.match(html, /id="video-world-story-depth"/);
    assert.match(html, /Short · 4 planned beats/);
    assert.match(html, /Standard · 13 planned beats/);
    assert.match(html, /id="video-world-rename-run"/);
    assert.match(html, /id="video-world-delete-run"/);
    assert.match(video, /function deleteTimeline/);
});

test('authoring is story-first with accessible looks, viewpoint and a persistent cast', () => {
    assert.match(video, /const VIDEO_WORLD_VERSION = 6/);
    assert.match(video, /VISUAL_PRESETS/);
    assert.match(video, /viewpoint: VIEWPOINTS/);
    assert.match(video, /characters: Array\.isArray/);
    assert.match(html, /id="video-world-style-presets"/);
    assert.match(html, /data-value="first_person"/);
    assert.match(html, /id="video-world-player-reference"/);
    assert.match(html, /id="video-world-characters"/);
    assert.match(video, /Strict first-person player point of view/);
    assert.match(video, /RECURRING CAST/);
});

test('continuity, budget and local media are explicit contracts', () => {
    assert.match(video, /captureLastFrame/);
    assert.match(video, /session\.spent \+ requiredCost > world\.sessionBudget/);
    assert.match(video, /next selected video can cost up to/);
    assert.match(video, /function storyBlockCost/);
    assert.match(video, /\(world\.storyBlockDepth \+ 1\) \* shotCost\(world\)/);
    assert.match(html, /unused branches never become paid videos/);
    assert.match(bridge, /VIDEO_WORLD_MEDIA_DIR/);
    assert.match(bridge, /\/video-world-media\//);
});

test('portable builds ship the separate Video Adventures runtime', () => {
    assert.match(portable, /video-worlds\.js/);
    assert.match(html, /video-worlds\.js\?v=/);
    assert.match(bridge, /"\/video-worlds\.js": \("video-worlds\.js"/);
});

console.log(`\n${passed} Video Adventures checks passed.`);
