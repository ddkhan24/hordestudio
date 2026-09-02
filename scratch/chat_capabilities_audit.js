/**
 * Capability-aware Chat regression audit.
 * Run with: node scratch/chat_capabilities_audit.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

[
    'studio-chat-image-upload', 'studio-chat-pdf-upload', 'studio-chat-audio-upload',
    'studio-chat-video-upload', 'studio-chat-web-search', 'studio-chat-image-generation'
].forEach(id => assert(html.includes(`id="${id}"`), `missing creator opt-in control: ${id}`));

[
    'chat-attachment-tray', 'chat-capability-bar', 'chat-attach-btn', 'chat-web-btn',
    'chat-image-mode-btn', 'chat-image-input', 'chat-pdf-input', 'chat-audio-input', 'chat-video-input'
].forEach(id => assert(html.includes(`id="${id}"`), `missing player capability control: ${id}`));

assert(/imageUpload:\s*value\.imageUpload === true/.test(app), 'image input is not opt-in by default');
assert(/webSearch:\s*value\.webSearch === true/.test(app), 'web search is not opt-in by default');
assert(/imageGeneration:\s*value\.imageGeneration === true/.test(app), 'image generation is not opt-in by default');
assert(/creator\.imageUpload && inputs\.has\('image'\)/.test(app), 'image upload is not gated by creator and model');
assert(/creator\.webSearch && provider === 'openrouter'/.test(app), 'web search is not gated by creator and provider');
assert(/creator\.imageGeneration && providerHasCredentials/.test(app), 'image generation is not gated by creator and credentials');
assert(/tools = \[COMPANION_WEB_SEARCH_TOOL\]/.test(app), 'enabled Chat web search never reaches the request');
assert(/content: await chatProviderContent\(m, content\)/.test(app), 'attachments never reach model context');
assert(/HordeDB\.set\(`chatAsset:\$\{id\}`/.test(app), 'attachments are not persisted locally');
assert(/chatAssets/.test(app) && /Backup Chat asset/.test(app), 'attachment backup/restore validation is missing');
assert(/character\.chatCapabilities = normalizeChatCreatorCapabilities/.test(app), 'legacy characters do not migrate to explicit capability settings');
assert(/\.chat-capability-bar/.test(css) && /\.chat-message-media/.test(css), 'capability composer/media styles are missing');

console.log('✓ optional creator capabilities, runtime gating, media persistence, and Chat tools passed');
