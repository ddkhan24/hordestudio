// Smallest check that fails if OpenRouter preset → model mapping breaks.
// Run: node scripts/check-openrouter-presets.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const fn = src.slice(src.indexOf('let openRouterPresetCache = null;'), src.indexOf('async function getOpenRouterModels() {'));
assert.ok(fn.includes('async function getOpenRouterPresetModels'), 'preset function not found in app.js');

const calls = [];
const ctx = {
    state: { apiKey: 'sk-test' },
    isPlainObject: v => v !== null && typeof v === 'object' && !Array.isArray(v),
    providerAuthHeaders: () => ({ Authorization: 'Bearer sk-test' }),
    attributionHeaders: () => ({}),
    console,
    fetch: async (url, opts) => {
        calls.push(url);
        return { ok: true, json: async () => ({ data: [
            { slug: 'email-copywriter', name: 'Email Copywriter', description: 'd' },
            { slug: '', name: 'bad' },
            'junk'
        ] }) };
    }
};
vm.createContext(ctx);
vm.runInContext(fn + '\nglobalThis.__get = getOpenRouterPresetModels;', ctx);

const models = await ctx.__get();
assert.equal(calls[0], 'https://openrouter.ai/api/v1/presets');
assert.equal(models.map(m => m.id).join(','), '@preset/email-copywriter');
assert.equal(models[0].name, 'Preset · Email Copywriter');
assert.equal(models[0].architecture.output_modalities.join(','), 'text');
await ctx.__get();
assert.equal(calls.length, 1, 'second call should hit the cache');
await ctx.__get(true);
assert.equal(calls.length, 2, 'force should refetch');

ctx.state.apiKey = '';
ctx.openRouterPresetCache = null;
assert.equal((await ctx.__get(true)).length, 0, 'no key → no request, empty list');
assert.equal(calls.length, 2);
console.log('ok: openrouter presets');
