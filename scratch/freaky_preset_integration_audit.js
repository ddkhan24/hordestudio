'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ Math });
vm.runInContext(fs.readFileSync(path.join(root, 'presets.js'), 'utf8'), context);
const evaluate = (expression, variables = {}) => {
    Object.assign(context, variables);
    return vm.runInContext(expression, context);
};
const presets = evaluate('DEFAULT_SYSTEM_PRESETS');
const oldPreset = presets.find(item => item.id === 'freaky_frankenstein_4_max');
const latest = presets.find(item => item.id === 'freaky_frankenstein_5_4');
assert(oldPreset, 'existing chats/worlds must retain their FF4 preset');
assert(latest, 'FF5.4 must be bundled');
assert.equal(latest.data.prompts.length, 63);
assert.equal(latest.data.extensions.regex_scripts.length, 25);
assert.equal(latest.data.prompt_order[0].order.length, 56);

const byId = new Map(latest.data.prompts.map(prompt => [prompt.identifier, prompt]));
const enabled = latest.data.prompt_order[0].order
    .filter(entry => entry.enabled && byId.get(entry.identifier)?.enabled !== false)
    .map(entry => byId.get(entry.identifier));
assert(enabled.some(prompt => /Internal States 💾/.test(prompt.name)), 'internal states were dropped');
assert(enabled.some(prompt => /BOLT Chain of Thought/.test(prompt.name)), 'BOLT was dropped');
assert(enabled.some(prompt => /Pop in Graphics/.test(prompt.name)), 'graphics were dropped');
assert(enabled.some(prompt => /Colored Dialogue 2.0/.test(prompt.name)), 'dialogue color was dropped');
assert(enabled.some(prompt => /Relationships RPG/.test(prompt.name)), 'relationship simulation was dropped');

const state = evaluate('createFreakyPresetMacroState({contextSize:32768,maxTokens:4096})');
state.random = () => 0;
for (const prompt of enabled) {
    if (prompt.marker) continue;
    const resolved = evaluate('expandFreakyPresetMacros(auditPrompt, auditState)', {
        auditPrompt: prompt.content || prompt.prompt || '', auditState: state
    });
    assert(!/\{\{(?:setvar|getvar|addvar|incvar|roll|maxContext|maxResponse)(?:::|\}\})/i.test(resolved),
        `unresolved functional macro in ${prompt.name}`);
}
assert(Object.keys(state.vars).length >= 10, 'FF5 module variables were not set');
assert.match(state.vars.dndTemplate, /DND TASK SIM/);
assert.match(state.vars.gmNotebookTemplate, /GM'S NOTEBOOK/);
assert.equal(evaluate('expandFreakyPresetMacros("{{setvar::nested::A {{roll::1d20}} B}}{{getvar::nested}}", auditState)', {auditState: state}), 'A 1 B');

const sample = '<!-- GFX_START --><internal_states><details><summary>INTERNAL STATES</summary>'
    + '<details><summary>NPC AGENDAS</summary><b>Ash</b> plans tonight.</details>'
    + '</details></internal_states><!-- GFX_END -->';
const rendered = evaluate('renderFreakyPresetMessage(auditSample)', {auditSample: sample});
assert.match(rendered, /ff-internal-states/);
assert.equal((rendered.match(/<details\b/g) || []).length, 2, 'nested sections were flattened');
assert.equal((rendered.match(/<\/details>/g) || []).length, 2, 'nested sections were not closed');
assert.match(rendered, /NPC AGENDAS/);
assert.match(rendered, /ff-theme-master/);
assert.match(rendered, /ff-theme-teal/);
const styled = evaluate('renderFreakyPresetMessage(auditSample)', {
    auditSample: '<gold:shout>"Stop!"</gold:shout> <img src=x onerror=alert(1)>'
});
assert.match(styled, /ff-color-gold ff-tone-shout/);
assert(!styled.includes('<img'), 'model-authored HTML executed');
assert(styled.includes('&lt;img'), 'unknown markup was not safely escaped');
const graphic = evaluate('renderFreakyPresetMessage(auditSample)', {
    auditSample: '<!-- GFX_START --><div style="font-family:monospace; background:#0a0a0a"><div>ACCESS GRANTED</div></div><!-- GFX_END -->'
});
assert.match(graphic, /ff-gfx-sheet ff-gfx-terminal/);
assert.equal((graphic.match(/ff-gfx-sheet/g) || []).length, 1, 'nested graphics should not become nested cards');
const relationship = evaluate('renderFreakyPresetMessage(auditSample)', {
    auditSample: '<details><summary>BONDS</summary>- <b>Ash</b> ↔ <b>Sam</b> | BOND: -4 | SPARKS: 3 | GRUDGE: 2</details>'
});
assert.match(relationship, /ff-relationship-card/);
assert.match(relationship, /Bond: -4/);
const hiddenThoughts = evaluate('renderFreakyPresetMessage(auditSample)', {
    auditSample: 'Think through the scene\n[Time] 7 PM\nThen she enters.'
});
assert.match(hiddenThoughts, /<summary>💭 Thoughts<\/summary>/);
const repairedSummary = evaluate('renderFreakyPresetMessage(auditSample)', {
    auditSample:'<details><summary>INTERNAL STATES\n<details><summary>NPC AGENDAS</summary>Plan</details></details>'
});
assert.match(repairedSummary, /<summary>INTERNAL STATES<\/summary><br><details/);
assert(!evaluate('prepareFreakyPresetHistory(auditSample, true)', {
    auditSample: 'Think through the scene\n[Time] 7 PM\nThen she enters.'
}).includes('Think through the scene'));

const story = 'She reads <!-- GFX_START --><div style="color:red">The gate opens at dawn.<br>Bring a key.</div><!-- GFX_END -->'
    + sample;
const recent = evaluate('prepareFreakyPresetHistory(auditSample, true)', {auditSample: story});
assert.match(recent, /The gate opens at dawn/);
assert.match(recent, /<internal_states>/);
const older = evaluate('prepareFreakyPresetHistory(auditSample, false)', {auditSample: story});
assert.match(older, /The gate opens at dawn/);
assert(!older.includes('<internal_states>'), 'old state snapshots bloat context');

for (const prompt of enabled.filter(item => /DND Simulator|Relationships RPG|Internal States|Chain of Thought/i.test(item.name))) {
    assert(evaluate('skipFreakyWorldMechanic(auditPreset, auditPrompt)', {auditPreset: latest, auditPrompt: prompt}),
        `world-native mechanics must own ${prompt.name}`);
}
for (const prompt of enabled.filter(item => /Main Prompt|Time and Place|Freaky Mode|Total Output Length|Spectacle Combat|Icebreaker Test/i.test(item.name))) {
    assert(evaluate('skipFreakyWorldMechanic(auditPreset, auditPrompt)', {auditPreset: latest, auditPrompt: prompt}),
        `world response and safety contracts must not be replaced by ${prompt.name}`);
}
assert(!evaluate('skipFreakyWorldMechanic(auditPreset, auditPrompt)',
    {auditPreset: latest, auditPrompt: enabled.find(item => /NPC Voice/.test(item.name))}),
    'world adaptation must retain FF writing quality');

const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(source.indexOf('presets.js') < source.indexOf('app.js'));
console.log('PASS FF5.4 bundle, modules, macros, internal states, safe rendering, continuity, world isolation, and script order');
