'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const handler = source.slice(source.indexOf('async function handleChatImageGeneration('), source.indexOf('// --- Chat View Logic ---'));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
    let id = 0, saveCount = 0, persistCount = 0;
    const origin = { id: 'origin', messages: [...(options.messages || [])] };
    const other = { id: 'other', messages: [] };
    let current = origin;
    const pending = options.pending || [];
    const otherPending = [{ kind: 'image', previewUrl: 'blob:other', file: { name: 'other.png' } }];
    const input = { value: 'A castle on a hill', style: {} };
    const character = { id: 'character', name: 'Ari', chatCapabilities: { imageModel: 'fixture/image' } };
    const calls = { requests: [], assetWrites: [], deleted: [], errors: [], renders: [], placeholders: [], revoked: [] };
    const context = {
        document: { getElementById: name => name === 'user-input' ? input : button },
        chatRuntimeCapabilities: () => ({ imageGeneration: true, imageProvider: 'openrouter' }),
        chatPendingForCurrentSession: () => context.chatPendingAttachments.get(current.id) || [],
        chatPendingAttachments: new Map([[origin.id, pending], [other.id, otherPending]]),
        chatImageModeBySession: new Map([[origin.id, true], [other.id, true]]),
        chatInteractionKey: () => current.id, getCurrentSession: () => current,
        newChatMemoryId: () => String(++id), AbortController, Image: function Image() {},
        URL: { revokeObjectURL: value => calls.revoked.push(value) },
        normalizeChatCreatorCapabilities: value => value, companionImageModelFallback: () => 'fallback/image',
        persistChatAttachment: async item => {
            persistCount++;
            if (options.persist) return options.persist(item, persistCount);
            return { id: `reference-${persistCount}`, kind: item.kind, name: item.file.name };
        },
        chatAttachmentBlob: async item => options.referenceBlob === null ? null : { type: 'image/png', id: item.id },
        blobToDataUrl: async () => png,
        saveState: async () => { saveCount++; if (options.save) return options.save(saveCount); },
        renderChat: () => calls.renders.push(current.id),
        appendMessageUI: () => { calls.placeholders.push(current.id); return { closest: () => ({ remove() {} }) }; },
        requestCompanionPhoto: async (body, provider) => {
            calls.requests.push({ body: structuredClone(body), provider });
            if (options.request) return options.request(body, provider);
            return png;
        },
        stabilizeGeneratedImageSource: async value => value,
        loadGeneratedImage: async (_image, value) => { assert.equal(value, png); return value; },
        dataUrlToBlob: () => ({ type: 'image/png', size: 68 }),
        HordeDB: { set: async (key, value) => { calls.assetWrites.push({ key, value }); if (options.assetError) throw options.assetError; } },
        deleteChatMessageAssets: async message => calls.deleted.push(...message.attachments.map(item => item.id)),
        humanizeApiError: error => error.message, showToast: (text, level) => calls.errors.push({ text, level }),
        updateChatSendButton: () => { if (!context.generationController) button.disabled = !input.value.trim(); },
        generationController: null
    };
    const button = { disabled: false, classList: { add() {}, remove() {} } };
    vm.createContext(context);
    vm.runInContext(handler, context);
    return {
        context, origin, other, input, character, calls, pending, otherPending, button,
        start: () => context.handleChatImageGeneration(character, origin),
        navigate: () => { current = other; input.value = 'Destination draft'; },
        saves: () => saveCount
    };
}
const reference = name => ({ kind: 'image', previewUrl: `blob:${name}`, file: { name } });

(async () => {
    let scenarios = 0;
    // Initial persistence must hold the generation lock and a navigation must not submit a paid request.
    {
        const barrier = deferred();
        const f = fixture({ pending: [reference('first.png')], save: count => count === 1 ? barrier.promise : undefined });
        const run = f.start();
        await tick();
        assert.ok(f.context.generationController);
        await f.start();
        assert.equal(f.origin.messages.length, 1, 'A duplicate direct image invocation must not add a turn');
        f.navigate(); barrier.resolve(); await run;
        assert.equal(f.calls.requests.length, 0);
        assert.equal(f.input.value, 'Destination draft');
        assert.equal(f.context.chatPendingAttachments.get('other'), f.otherPending);
        assert.equal(f.context.chatImageModeBySession.get('other'), true);
        assert.equal(f.calls.placeholders.length, 0);
        assert.equal(f.origin.messages[0].content, 'A castle on a hill');
        assert.equal(f.origin.messages[0].attachments.length, 1);
        scenarios++;
    }
    // An already submitted request finishes in its original chat without replacing another draft or image mode.
    {
        const barrier = deferred();
        const f = fixture({ request: () => barrier.promise });
        const run = f.start(); await tick();
        assert.equal(f.calls.requests.length, 1);
        assert.equal(f.button.disabled, true, 'Submitted paid image requests cannot offer a misleading stop/resubmit button');
        f.navigate();
        f.character.id = 'different'; f.character.name = 'Changed'; f.character.chatCapabilities.imageModel = 'changed/image';
        barrier.resolve(png); await run;
        assert.equal(f.input.value, 'Destination draft');
        assert.equal(f.other.messages.length, 0);
        assert.equal(f.origin.messages[1].charId, 'character');
        assert.equal(f.calls.requests[0].body.model, 'fixture/image');
        assert.match(f.calls.requests[0].body.prompt, /Ari/);
        assert.equal(f.context.chatImageModeBySession.get('origin'), false);
        assert.equal(f.context.chatImageModeBySession.get('other'), true);
        assert.ok(f.calls.renders.every(key => key === 'origin'));
        scenarios++;
    }
    // A final chat save error must retain the completed image and must not restore the paid prompt for resubmission.
    {
        const f = fixture({ save: count => { if (count === 2) throw Error('Quota exceeded'); } });
        await f.start();
        assert.equal(f.origin.messages.length, 2);
        assert.equal(f.origin.messages[1].generatedImage, true);
        assert.equal(f.calls.assetWrites.length, 1);
        assert.equal(f.input.value, '');
        assert.equal(f.context.chatImageModeBySession.get('origin'), false);
        assert.equal(f.calls.requests.length, 1);
        assert.equal(f.calls.deleted.length, 0);
        assert.match(f.calls.errors[0].text, /Image created, but the chat could not be saved/);
        assert.ok(f.calls.errors.every(error => !/Image generation failed/.test(error.text)));
        scenarios++;
    }
    // Separate-asset storage errors preserve a decodable embedded copy in the chat and backup JSON.
    {
        const f = fixture({ assetError: Error('Asset store full') });
        await f.start();
        assert.equal(f.origin.messages[1].attachments[0].url, png);
        assert.equal(f.origin.messages[1].attachments[0].id, undefined);
        assert.match(JSON.stringify(f.origin), /data:image\/png/);
        assert.equal(f.saves(), 2);
        assert.equal(f.calls.requests.length, 1);
        assert.equal(f.calls.deleted.length, 0);
        assert.match(f.calls.errors[0].text, /embedded copy was saved/);
        scenarios++;
    }
    // Partial attachment persistence failure cleans only newly created assets and retains the previous image prompt.
    {
        const previous = { role: 'user', imageGeneration: true, content: 'Old image prompt', attachments: [{ id: 'old' }] };
        const drafts = [reference('first.png'), reference('second.png')];
        const f = fixture({ messages: [previous], pending: drafts, persist: (item, count) => {
            if (count === 2) throw Error('Reference storage failed');
            return { id: 'new-reference', kind: 'image' };
        } });
        await f.start();
        assert.equal(f.origin.messages.length, 1);
        assert.equal(f.origin.messages[0], previous);
        assert.deepEqual(f.calls.deleted, ['new-reference']);
        assert.equal(f.context.chatPendingAttachments.get('origin'), drafts);
        assert.equal(f.calls.revoked.length, 0);
        assert.equal(f.input.value, 'A castle on a hill');
        assert.equal(f.calls.requests.length, 0);
        scenarios++;
    }
    // A first chat save failure restores the exact draft and live previews without generating or deleting unrelated turns.
    {
        const drafts = [reference('reference.png')];
        const f = fixture({ pending: drafts, save: count => { if (count === 1) throw Error('Initial save failed'); } });
        f.input.value = '  A castle on a hill  ';
        await f.start();
        assert.equal(f.origin.messages.length, 0);
        assert.equal(f.input.value, '  A castle on a hill  ');
        assert.equal(f.context.chatPendingAttachments.get('origin')[0], drafts[0]);
        assert.deepEqual(f.calls.deleted, ['reference-1']);
        assert.equal(f.calls.revoked.length, 0);
        assert.equal(f.calls.requests.length, 0);
        scenarios++;
    }
    // Provider failures after navigation preserve the original submitted prompt/reference, without mutating the destination.
    {
        const barrier = deferred();
        const f = fixture({ pending: [reference('reference.png')], request: () => barrier.promise });
        const run = f.start(); await tick(); f.navigate(); barrier.reject(Error('Provider offline')); await run;
        assert.equal(f.input.value, 'Destination draft');
        assert.equal(f.origin.messages.length, 1);
        assert.equal(f.origin.messages[0].attachments[0].id, 'reference-1');
        assert.equal(f.calls.deleted.length, 0);
        assert.equal(f.context.chatPendingAttachments.get('other'), f.otherPending);
        assert.equal(f.context.chatImageModeBySession.get('other'), true);
        assert.ok(f.calls.renders.every(key => key === 'origin'));
        scenarios++;
    }
    // Missing reference pixels fail before a paid request instead of silently generating without the reference.
    {
        const f = fixture({ pending: [reference('reference.png')], referenceBlob: null });
        await f.start();
        assert.equal(f.calls.requests.length, 0);
        assert.equal(f.origin.messages.length, 0);
        assert.equal(f.input.value, 'A castle on a hill');
        assert.match(f.calls.errors[0].text, /reference image could not be loaded/);
        scenarios++;
    }
    // Stop during persistence releases the lock and restores the draft without creating a provider job.
    {
        const barrier = deferred();
        const f = fixture({ save: count => count === 1 ? barrier.promise : undefined });
        const run = f.start(); await tick(); f.context.generationController.abort(); barrier.resolve(); await run;
        assert.equal(f.calls.requests.length, 0);
        assert.equal(f.origin.messages.length, 0);
        assert.equal(f.input.value, 'A castle on a hill');
        assert.equal(f.context.generationController, null);
        assert.equal(f.calls.errors[0].level, 'info');
        assert.match(f.calls.errors[0].text, /stopped before submission/);
        scenarios++;
    }
    // New typing and attachment additions while an old request is pending belong to the next draft.
    {
        const barrier = deferred();
        const drafts = [reference('first.png')];
        const next = reference('next.png');
        const f = fixture({ pending: drafts, save: count => count === 1 ? barrier.promise : undefined,
            request: () => { throw Error('Provider offline'); } });
        const run = f.start(); await tick(); f.input.value = 'Next draft';
        f.context.chatPendingAttachments.get('origin').push(next); barrier.resolve(); await run;
        assert.equal(f.input.value, 'Next draft');
        assert.equal(f.origin.messages.length, 1, 'The original prompt remains in the chat when another draft occupies the composer');
        assert.equal(f.origin.messages[0].content, 'A castle on a hill');
        assert.equal(f.origin.messages[0].attachments[0].id, 'reference-1');
        assert.deepEqual(Array.from(f.context.chatPendingAttachments.get('origin')), [next]);
        assert.deepEqual(f.calls.revoked, ['blob:first.png']);
        assert.equal(f.calls.requests.length, 1);
        scenarios++;
    }
    console.log(`PASS ${scenarios} chat image transaction release regressions: navigation, locks, paid media durability, exact rollback, cancellation, references, and concurrent drafts`);
})().catch(error => { console.error(error); process.exitCode = 1; });
