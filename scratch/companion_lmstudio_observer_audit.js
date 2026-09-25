const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source');

function response(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload),
        json: async () => payload
    };
}

function fixture(responses) {
    const requests = [];
    const ctx = {
        console: { warn() {} },
        state: { globalSettings: { defaultModel: 'qwen-local' } },
        COMPANION_OBSERVER_COMMIT_TOOL: {
            type: 'function',
            function: {
                name: 'commit_human_turn',
                parameters: {
                    type: 'object',
                    properties: { state: { type: 'object' } },
                    required: ['state']
                }
            }
        },
        COMPANION_TURN_COMMIT_TOOL: { type: 'function', function: { name: 'commit_human_turn', parameters: {} } },
        companionTextProviderId: () => 'local',
        sanitizeMessagesForProvider: messages => messages,
        applyCompanionGenerationConfig: body => body,
        companionProviderOutputBudget: () => 2048,
        companionRequestContextSize: () => 32768,
        VHConversationEngine: { fitRequest: body => ({ body }) },
        providerApiBase: () => 'http://localhost:5678/v1',
        providerAuthHeaders: () => ({}),
        providerAttributionHeaders: () => ({}),
        fetchCompanionCompletion: async (url, options) => {
            requests.push(JSON.parse(options.body));
            return responses.shift();
        },
        extractCompanionEmbeddedToolCalls: content => ({ visibleText: String(content || ''), toolCalls: [] }),
        extractCompanionToolCalls: calls => {
            const call = calls.find(item => item?.function?.name === 'commit_human_turn');
            if (!call) return {};
            return { commit: JSON.parse(call.function.arguments) };
        },
        companionVisibleReplyLimit: text => text,
        sanitizeCompanionTextReply: text => text,
        quarantineCompanionProtocolText: text => text,
        safeParseJSONRepair: raw => { try { return JSON.parse(raw); } catch (error) { return null; } },
        isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value)
    };
    vm.createContext(ctx);
    vm.runInContext(`${functionSource('companionCompletionFailure')}\n${functionSource('repairCompanionTurnCommit')}`, ctx);
    return { ctx, requests };
}

(async () => {
    const recovered = fixture([
        response(400, { error: { message: 'tool_choice object is invalid' } }),
        response(200, { choices: [{ message: { content: '{"state":{"valence_change":0}}' } }] })
    ]);
    const result = await recovered.ctx.repairCompanionTurnCommit(
        { id: 'human', model: 'qwen-local', mood: { label: 'content' } }, [], 'Hello',
        { observer: true, model: 'qwen-local' });
    assert.deepEqual(JSON.parse(JSON.stringify(result.commit)), { state: { valence_change: 0 } });
    assert.equal(recovered.requests[0].tool_choice, 'required');
    assert.equal(recovered.requests[1].response_format.type, 'json_schema');
    assert.equal(recovered.requests[1].response_format.json_schema.name, 'commit_human_turn');
    console.log('PASS: LM Studio observer retries a rejected tool request with documented JSON Schema output');

    const failed = fixture([
        response(400, { error: { message: 'tools unsupported by this model' } }),
        response(400, { error: { message: 'structured output unsupported by this model' } })
    ]);
    await assert.rejects(
        failed.ctx.repairCompanionTurnCommit(
            { id: 'human', model: 'qwen-local', mood: { label: 'content' } }, [], 'Hello',
            { observer: true, model: 'qwen-local' }),
        error => error.code === 'COMPANION_OBSERVER_HTTP_ERROR'
            && /HTTP 400/.test(error.message)
            && /tools unsupported/.test(error.message)
            && /structured output unsupported/.test(error.message)
    );
    console.log('PASS: observer failures retain both HTTP status and LM Studio response diagnostics');
})().catch(error => { console.error(error); process.exitCode = 1; });
