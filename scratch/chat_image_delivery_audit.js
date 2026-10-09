'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const handler = source.slice(source.indexOf('async function handleChatImageGeneration('), source.indexOf('// --- Chat View Logic ---'));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

async function scenario(result, decodeFailure = false) {
    let id = 0;
    const input = { value: 'A castle on a hill', style: {} };
    const button = { classList: { add() {}, remove() {} } };
    const saved = [], requests = [], errors = [], decoded = [];
    const session = { messages: [] };
    const context = {
        document: { getElementById: name => name === 'user-input' ? input : button },
        chatRuntimeCapabilities: () => ({ imageGeneration: true, imageProvider: 'openrouter' }),
        chatPendingForCurrentSession: () => [], newChatMemoryId: () => String(++id),
        chatPendingAttachments: new Map(), chatImageModeBySession: new Map(),
        chatInteractionKey: () => 'session', getCurrentSession: () => session, saveState: async () => {}, renderChat() {},
        AbortController, Image: function Image() {},
        appendMessageUI: () => ({ closest: () => ({ remove() {} }) }),
        normalizeChatCreatorCapabilities: value => value,
        companionImageModelFallback: () => 'fallback/image',
        requestCompanionPhoto: async (body, provider) => { requests.push({ body, provider }); return result; },
        stabilizeGeneratedImageSource: async value => value,
        loadGeneratedImage: async (_image, value) => {
            decoded.push(value);
            if (decodeFailure || value !== png) throw Error('The provider returned no decodable image.');
            return value;
        },
        dataUrlToBlob: () => ({ type: 'image/png', size: 68 }),
        HordeDB: { set: async (key, value) => saved.push({ key, value }) },
        deleteChatMessageAssets: async () => {}, updateChatSendButton() {},
        humanizeApiError: error => error.message, showToast: text => errors.push(text),
        generationController: null
    };
    vm.createContext(context);
    vm.runInContext(handler, context);
    await context.handleChatImageGeneration({ id: 'character', name: 'Ari', chatCapabilities: { imageModel: 'fixture/image' } }, session);
    return { session, input, saved, requests, errors, decoded };
}

(async () => {
    const integration = fs.readFileSync(require('node:path').join(__dirname, '../virtual_humans/frontend/vh2-horde-integration.js'), 'utf8');
    const presentation = integration.slice(integration.indexOf('function vh2ImageJobPresentation('), integration.indexOf('function vh2ImageBudgetText('));
    const ui = {};
    vm.createContext(ui);
    vm.runInContext(presentation, ui);
    const failure = ui.vh2ImageJobPresentation({status:'submitted'}, {status:'failed',error:'The provider returned text. No photo was delivered.'});
    assert.equal(failure.state, 'failed');
    assert.match(failure.detail, /No photo was delivered/);
    assert.equal(ui.vh2ImageJobPresentation({status:'captured'}, null).state, 'waiting');
    const good = await scenario(png);
    assert.equal(good.requests.length, 1);
    assert.equal(good.requests[0].provider, 'openrouter');
    assert.equal(good.requests[0].body.model, 'fixture/image');
    assert.match(good.requests[0].body.prompt, /A castle on a hill/);
    assert.equal(good.decoded.length, 1);
    assert.equal(good.saved.length, 1);
    assert.equal(good.session.messages[1].generatedImage, true);
    assert.equal(good.session.messages[1].attachments[0].mime, 'image/png');
    for (const result of ['Portrait prompt only, no image', png]) {
        const failed = await scenario(result, true);
        assert.equal(failed.saved.length, 0);
        assert.equal(failed.session.messages.length, 0);
        assert.equal(failed.input.value, 'A castle on a hill');
        assert.match(failed.errors[0], /Image generation failed:.*no decodable image/);
        assert.equal(failed.requests.length, 1, 'Failed output must not automatically resubmit');
    }
    console.log('PASS Chat Library image request, decoded attachment persistence, prompt-only/corrupt output rejection, draft restoration, and no resubmission');
})().catch(error => { console.error(error); process.exitCode = 1; });
