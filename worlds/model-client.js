/* One HTTP boundary for foreground Worlds turns and background simulation.
 * The caller owns model policy and the state transaction; this module owns
 * transport, JSON decoding, and a single outcome vocabulary. */
(function (root) {
'use strict';

function clockNow() {
    return root.performance?.now ? root.performance.now() : Date.now();
}

function attempt(outcome, response, startedAt, now, data = null) {
    return {
        outcome,
        status: response?.status || 0,
        durationMs: Math.max(0, now() - startedAt),
        usage: data?.usage || null
    };
}

function abortReason(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error('World model request stopped.');
    error.name = 'AbortError';
    return error;
}

// Some OpenAI-compatible servers send HTTP 200 and then never finish the JSON
// body. Fetch abort normally rejects response.text(), but it is not reliable
// for every browser/proxy combination. Settle our own await on abort as well.
function awaitAbortable(operation, signal) {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (!signal) {
        try { return Promise.resolve(operation()); }
        catch (error) { return Promise.reject(error); }
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (done, value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            done(value);
        };
        const onAbort = () => finish(reject, abortReason(signal));
        signal.addEventListener('abort', onAbort, { once: true });
        let pending;
        try { pending = operation(); }
        catch (error) { finish(reject, error); return; }
        Promise.resolve(pending).then(
            value => finish(resolve, value), error => finish(reject, error));
    });
}

async function json({ url, body, init = {}, fetcher = root.fetch, now = clockNow,
    onSettled = null, timeoutMs = 0 }) {
    if (typeof fetcher !== 'function') throw new Error('World model transport is unavailable.');
    const startedAt = now();
    let response = null;
    let data = null;
    let outcome = 'network_error';
    const deadline = Number(timeoutMs);
    const bounded = Number.isFinite(deadline) && deadline > 0;
    const externalSignal = init.signal;
    const controller = bounded ? new AbortController() : null;
    let timeoutId = null;
    let forwardAbort = null;
    if (controller) {
        forwardAbort = () => controller.abort(abortReason(externalSignal));
        if (externalSignal?.aborted) forwardAbort();
        else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
        timeoutId = setTimeout(() => {
            const error = new Error(`World model response did not complete within ${Math.round(deadline / 1000)}s.`);
            error.name = 'TimeoutError';
            error.code = 'WORLD_MODEL_TIMEOUT';
            controller.abort(error);
        }, deadline);
    }
    const requestInit = controller ? { ...init, signal: controller.signal } : init;
    try {
        response = await awaitAbortable(() => fetcher(url,
            { ...requestInit, body: JSON.stringify(body) }), requestInit.signal);
        let raw;
        try { raw = await awaitAbortable(() => response.text(), requestInit.signal); }
        catch (error) { outcome = 'body_error'; throw error; }
        try { data = raw ? JSON.parse(raw) : {}; }
        catch (_) {
            outcome = 'invalid_json';
            if (response.ok) {
                const error = new Error('The model provider returned invalid JSON. Retry this turn or choose another model.');
                error.code = 'WORLD_MODEL_INVALID_JSON';
                throw error;
            }
            data = {};
        }
        if (response.ok) {
            try { data = decodeCompletionBody(raw); }
            catch (error) {
                outcome = error.code === 'WORLD_MODEL_PROVIDER_ERROR' ? 'provider_error' : 'empty_completion';
                throw error;
            }
        }
        if (outcome !== 'invalid_json') outcome = response.ok ? 'ok' : 'http_error';
        return { response, data };
    } catch (error) {
        if (error?.code === 'WORLD_MODEL_TIMEOUT') outcome = 'timeout';
        else if (error?.name === 'AbortError') outcome = 'aborted';
        else if (response && outcome === 'network_error') outcome = 'body_error';
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (externalSignal && forwardAbort) externalSignal.removeEventListener('abort', forwardAbort);
        // Diagnostics must never replace a valid model reply or hide the
        // provider's original failure.
        if (onSettled) {
            try { onSettled(attempt(outcome, response, startedAt, now, data)); }
            catch (error) { root.console?.warn?.('World model diagnostics failed:', error?.message || error); }
        }
    }
}

async function stream({ url, body, init = {}, fetcher = root.fetch, now = clockNow, onFailure = null }) {
    if (typeof fetcher !== 'function') throw new Error('World model transport is unavailable.');
    const startedAt = now();
    try {
        const response = await awaitAbortable(() => fetcher(url,
            { ...init, body: JSON.stringify(body) }), init.signal);
        return { response, startedAt };
    } catch (error) {
        if (onFailure) {
            try { onFailure(attempt(error?.name === 'AbortError' ? 'aborted' : 'network_error', null, startedAt, now)); }
            catch (diagnosticError) { root.console?.warn?.('World model diagnostics failed:', diagnosticError?.message || diagnosticError); }
        }
        throw error;
    }
}

function decodeCompletionBody(raw) {
    let data;
    try { data = JSON.parse(String(raw || '').trim()); }
    catch (_) {
        const error = new Error('The model provider returned neither streaming events nor a valid JSON chat completion. Retry or choose another model.');
        error.code = 'WORLD_MODEL_INVALID_COMPLETION';
        throw error;
    }
    if (data?.error) {
        const error = new Error(String(data.error?.message || data.error || 'Model provider error.'));
        error.code = 'WORLD_MODEL_PROVIDER_ERROR';
        throw error;
    }
    if (!Array.isArray(data?.choices) || !data.choices.length
        || !data.choices.some(choice => choice && (choice.message || choice.delta))) {
        const error = new Error('The model provider returned no chat-completion choices. Retry or choose another model.');
        error.code = 'WORLD_MODEL_EMPTY_COMPLETION';
        throw error;
    }
    return data;
}

root.HordeWorldModelClient = {
    json, stream, decodeCompletionBody,
    runAbortable: awaitAbortable,
    readText: (response, signal) => awaitAbortable(() => response.text(), signal),
    readChunk: (reader, signal) => awaitAbortable(() => reader.read(), signal)
};
if (typeof module !== 'undefined') module.exports = root.HordeWorldModelClient;
})(globalThis);
