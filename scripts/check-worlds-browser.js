/** Mock-provider Worlds browser release checks; no paid API calls. */
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const suites = [
    'world_scene_draft_browser_audit',
    'world_hosted_replay_audit',
    'world_check_outcome_contract_browser_audit',
    'worlds2_life_seed_fallback_browser_audit',
    'worlds2_resolve_first_browser_audit',
    'worlds2_provider_response_browser_audit',
    'worlds2_narrated_check_browser_audit',
    'worlds2_receipt_boundary_browser_audit',
    'worlds2_atomic_turn_persistence_browser_audit',
    'worlds2_dawn_wait_receipt_browser_audit',
    'worlds2_turn_telemetry_browser_audit'
];
let passed = 0;
for (const suite of suites) {
    const run = spawnSync(process.execPath, [path.join(root, 'scratch', `${suite}.js`)], {
        cwd: root, env: process.env, encoding: 'utf8', timeout: 120000
    });
    if (run.status === 0) {
        passed++;
        process.stdout.write(`PASS ${suite}\n`);
    } else {
        process.stderr.write(`FAIL ${suite}\n${run.stdout || ''}${run.stderr || ''}\n`);
    }
}
const local = spawnSync(process.execPath, [path.join(root,'scratch/world_scene_draft_browser_audit.js'),'--local'], {
    cwd:root,env:process.env,encoding:'utf8',timeout:120000
});
if(local.status===0){passed++;process.stdout.write('PASS world_scene_draft_local_provider\n');}
else process.stderr.write(`FAIL world_scene_draft_local_provider\n${local.stdout||''}${local.stderr||''}\n`);
process.stdout.write(`${passed}/${suites.length+1} Worlds browser suites passed.\n`);
if (passed !== suites.length+1) process.exitCode = 1;
