// Headless release gate for Worlds and Virtual Humans. No provider calls.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const file of ['worlds/scene-draft.js','worlds/turn-context.js']) {
    if (spawnSync(process.execPath,['--check',file],{cwd:root,stdio:'inherit'}).status !== 0) process.exit(1);
}
const suites = [
    'release_metadata_audit', 'embedding_release_audit', 'engine_audit', 'chat_image_delivery_audit', 'chat_image_transaction_release_audit', 'chat_memory_audit', 'chat_capabilities_audit',
    'multiplayer_engine_audit', 'multiplayer_release_transaction_regression', 'multiplayer_model_deadline_regression',
    'video_worlds_audit', 'video_worlds_release_job_regression', 'vh_release_ownership_audit',
    'world_scene_draft_audit',
    'world_turn_context_audit',
    'browser_runtime_audit', 'freaky_preset_integration_audit',
    'vh2_age_engine_audit',
    'human_package_audit', 'included_human_audit', 'bundled_humans_audit',
    'vh_character_export_audit', 'vh2_environment_population_audit', 'vh_export_participants_audit',
    'vh_builder_coherence_audit', 'vh_builder_persistence_audit', 'vh_page_builder_audit', 'vh_focused_builder_audit',
    'vh2_daily_life_engine_audit', 'vh2_story_audit', 'vh2_retirement_audit', 'vh2_health_audit', 'vh2_social_participation_audit',
    'vh2_group_network_audit', 'vh2_network_audit', 'vh2_institutions_audit', 'vh2_recovery_audit', 'vh2_extended_travel_audit', 'vh2_lifestyle_engine_audit', 'vh2_exploration_audit', 'vh2_travel_audit', 'vh2_relationship_lifecycle_audit', 'vh2_people_long_horizon_audit', 'vh2_people_audit', 'vh2_population_audit', 'vh2_social_bonds_audit', 'vh2_npc_travel_audit', 'vh2_agency_audit', 'vh2_plans_audit', 'vh2_presence_audit', 'vh2_migration_fixture', 'vh2_decision_audit', 'vh2_psychology_audit', 'vh2_appraisal_audit', 'vh2_relationship_audit', 'vh2_followthrough_audit', 'vh_goal_outing_audit', 'vh_route_progress_audit',
    'vh_gap_closure_audit', 'vh_week_audit', 'vh_sleep_kernel_audit', 'vh_preparation_kernel_audit', 'vh_pressure_kernel_audit', 'vh_photo_pipeline_audit', 'vh_garment_vision_audit', 'vh_immersion_followthrough_audit', 'vh_world_systems_audit', 'vh_spatial_audit', 'vh_project_learning_audit', 'vh_motive_action_audit', 'vh_dialogue_audit', 'photo_continuity_audit', 'mcp_image_contract_audit', 'vh_social_agency_audit', 'vh_procedural_day_audit', 'vh_conversation_context_audit', 'vh_connected_system_audit', 'engine_integrity_audit', 'companion_reply_transaction_audit', 'companion_attention_audit', 'companion_activity_audit', 'companion_overhaul_audit',
    'living_world_audit', 'living_world_stress_test', 'world_urgent_deadline_regression', 'world_wait_fallback_regression', 'authored_world_audit',
    'companion_audit', 'movement_ledger_stress_test', 'world_model_client_audit', 'worlds2_model_attempt_audit', 'world_turn_transaction_audit', 'world_transaction_feedback_audit', 'world_action_resolution_audit', 'world_command_boundary_audit', 'world_agent_transaction_audit',
    'world_graph_consistency_audit', 'world_session_boundary_audit', 'gameplay_overhaul_audit', 'narrated_presence_audit', 'immersion_engine_audit',
    'world_map_stress_test', 'rules_engine_stress_test', 'world_intent_reliability_audit',
    'movement_hierarchy_audit', 'worlds2_route_escort_regression', 'worlds2_check_transaction_regression',
    'worlds2_gate_receipt_regression', 'worlds_live_timing_regression',
    'worlds_rpg_release_contract_audit', 'worlds2_inventory_consequence_regression',
    'worlds2_receipt_id_regression',
    'worlds2_restraint_recovery_variants',
    'worlds2_escort_handoff_regression',
    'worlds2_look_arrival_audit',
    'worlds2_travel_pacing_audit',
    'worlds2_urgent_wait_receipt_repair_regression',
    'worlds2_route_closure_audit',
    'worlds2_stationary_gate_regression',
    'worlds_starting_quests_audit',
    'worlds2_stacked_inventory_regression',
    'world_role_consequence_audit', 'timeline_life_seed_audit',
    'worlds2_life_seed_timeout_audit',
    'sandbox_world_audit', 'society_audit', 'companion_creation_lifecycle_audit',
    'always_on_vh_audit', 'persistence_hotfix_audit', 'world_schema_migration_audit',
    'settings_persistence_audit'
];
for (const file of ['app.js', 'large-archive.js', 'worlds/model-client.js', 'human-package.js', 'virtual_humans/engine/vh-life-schema.js', 'virtual_humans/frontend/vh-workspace.js', 'virtual_humans/frontend/vh-assistant-ui.js', 'virtual_humans/frontend/vh-page-builder.js', 'virtual_humans/frontend/vh-setup-ui.js', 'virtual_humans/engine/vh-simulation-core.js', 'virtual_humans/engine/vh-activity-engine.js', 'virtual_humans/engine/vh-conversation-engine.js', 'virtual_humans/engine/vh-world-engine.js', 'virtual_humans/engine/vh-host-worker.js', 'virtual_humans/engine/vh-cognition-engine.js', 'virtual_humans/engine/vh2-kernel-worker.js', 'virtual_humans/engine/vh2-story-engine.js', 'virtual_humans/engine/vh2-health-engine.js', 'virtual_humans/engine/vh2-presence-engine.js', 'virtual_humans/engine/vh2-plans-engine.js', 'virtual_humans/engine/vh2-agency-engine.js', 'virtual_humans/engine/vh2-npc-travel.js', 'virtual_humans/engine/vh2-social-bonds.js', 'virtual_humans/engine/vh2-population-engine.js', 'virtual_humans/engine/vh2-people-engine.js', 'virtual_humans/engine/vh2-exploration-engine.js', 'virtual_humans/engine/vh2-lifestyle-engine.js', 'virtual_humans/engine/vh2-transport-engine.js', 'virtual_humans/engine/vh2-episodes-engine.js', 'virtual_humans/engine/vh2-travel-engine.js', 'virtual_humans/engine/vh2-relationship-lifecycle.js', 'virtual_humans/engine/vh2-decision-engine.js', 'virtual_humans/engine/vh2-communication-engine.js', 'virtual_humans/frontend/vh2-dashboard.js', 'virtual_humans/engine/vh2-psychology-engine.js', 'virtual_humans/engine/vh2-followthrough-engine.js', 'virtual_humans/frontend/vh2-horde-integration.js']) {
    const syntax = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
    if (syntax.status !== 0) process.exit(1);
}
const failed = [];
for (const suite of suites) {
    const result = spawnSync(process.execPath, [`scratch/${suite}.js`], {
        cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024
    });
    if (result.status === 0) {
        console.log(`PASS ${suite}`);
    } else {
        failed.push(suite);
        console.error(`FAIL ${suite}\n${result.stdout || ''}${result.stderr || ''}${result.error || ''}`);
    }
}
console.log(`${suites.length - failed.length}/${suites.length} engine suites passed.`);
process.exitCode = failed.length ? 1 : 0;
