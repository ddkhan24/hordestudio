'use strict';

// Playwright emits `response` when headers arrive. A streaming model can then
// spend tens of seconds producing its body, so headers must not be presented
// as the completed API-call duration.
function markResponseHeaders(record, at = Date.now()) {
    record.headersMs = Math.max(0, at - record.startedAt);
    return record;
}

function markResponseComplete(record, at = Date.now()) {
    record.ms = Math.max(0, at - record.startedAt);
    record.bodyCompleteMs = record.ms;
    return record;
}

function summarizeTurnTiming(wallMs, callAudit) {
    const calls = Array.isArray(callAudit?.calls) ? callAudit.calls : [];
    const modelMs = calls.reduce((sum, call) => sum + Math.max(0, Number(call.durationMs) || 0), 0);
    return { wallMs, modelMs, otherMs: Math.max(0, wallMs - modelMs) };
}

module.exports = { markResponseHeaders, markResponseComplete, summarizeTurnTiming };
