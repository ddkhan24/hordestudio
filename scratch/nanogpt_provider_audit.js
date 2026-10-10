const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const help = fs.readFileSync(path.join(root, 'help-system.js'), 'utf8');

const checks = [
    ['NanoGPT is selectable as the global text provider', /option value="nanogpt"[^>]*>[^<]*NanoGPT/.test(html)],
    ['NanoGPT is selectable independently for Virtual Human photos', /id="cs-image-source"[\s\S]*?option value="nanogpt"/.test(html)],
    ['NanoGPT is selectable independently for Virtual Human text', /id="cs-text-provider"[\s\S]*?option value="nanogpt"/.test(html)],
    ['NanoGPT is selectable independently for World artwork', /id="w-visual-image-provider"[\s\S]*?option value="nanogpt"/.test(html)],
    ['CSP permits NanoGPT and user-configured HTTPS API calls', /connect-src[^">]*https:/.test(html) && /https:\/\/nano-gpt\.com/.test(app)],
    ['NanoGPT API key has dedicated storage and auth', /nanogptApiKey/.test(app) && /horde_nanogpt_api_key/.test(app)],
    ['NanoGPT connection test authenticates with a live completion', /testNanoGPTBtn[\s\S]*?\/chat\/completions[\s\S]*?max_tokens:\s*2/.test(app)],
    ['Verified NanoGPT key becomes active for the browser session', /applyNanoGPTApiKeyForSession\(key\)/.test(app)],
    ['NanoGPT invalid-session errors explain the public catalog false positive', /provider === 'nanogpt'[\s\S]*?invalid session[\s\S]*?model catalog is public/i.test(app)],
    ['Text catalog uses the documented API v1 route', /nano-gpt\.com\/api\/v1/.test(app) && /modality === 'text' \? '\/models\?detailed=true'/.test(app)],
    ['Image catalog uses the detailed image-model route', /\/image-models\?detailed=true/.test(app)],
    ['Audio catalog uses the detailed audio-model route', /\/audio-models\?detailed=true/.test(app)],
    ['Images use NanoGPT’s documented non-api generation route', /nano-gpt\.com\/v1\/images\/generations/.test(app)],
    ['Local references are sent without requiring public hosting', /body\.imageDataUrl = references\[0\]/.test(app)],
    ['Multi-reference NanoGPT models use the plural data-URL field', /body\.imageDataUrls = references/.test(app)],
    ['Image results request portable inline base64', /response_format: 'b64_json'/.test(app)],
    ['NanoGPT speech has a safe catalog fallback', /NANOGPT_TTS_MODEL_FALLBACK[\s\S]*?Kokoro-82m/.test(app)],
    ['NanoGPT speech exposes its documented browser formats', /nanoGPTSpeech \? \['mp3', 'wav', 'ogg', 'opus', 'aac', 'flac'\]/.test(app)],
    ['NanoGPT settings controls have contextual help', /global-nanogpt-key/.test(help) && /test-nanogpt-conn-btn/.test(help)]
];

let failed = 0;
for (const [label, okay] of checks) {
    if (!okay) failed += 1;
    console.log(`${okay ? 'PASS' : 'FAIL'}: ${label}`);
}
if (failed) {
    console.error(`\nNanoGPT audit failed: ${failed} check${failed === 1 ? '' : 's'}.`);
    process.exit(1);
}
console.log(`\nNanoGPT provider audit passed (${checks.length} checks).`);
