/**
 * Regression checks for GitHub issue #13: idle Virtual Human agency polling
 * must not continuously rewrite media-heavy application state.
 *
 * Run with: node scratch/persistence_hotfix_audit.js
 */
const assert = require('node:assert/strict');
const { app, functionSource } = require('./app_source.js');

const agency = functionSource('processCompanionAgency');
const save = functionSource('saveState');
const persist = functionSource('persistStateSnapshot');
const life = functionSource('advanceCompanionLife');
const social = functionSource('advanceCompanionSocialWorld');
const deleteWorld = functionSource('deleteWorld');

assert(agency && save && persist && life && social && deleteWorld, 'hotfix functions must remain extractable');
assert(!/dynamicsBefore|emotionsBefore/.test(agency),
    'clock-derived mood decay must not force a full persistence transaction');
assert(/if \(!companion\.lifeProfile\?\.initializedAt\) return null/.test(life),
    'uninitialized fallback life must remain write-free');
assert(/if \(changed\) runtime\.lastSimulatedAt = nowMs/.test(life),
    'life advancement markers must be conditional on a canonical change');
assert(/if \(changed\) world\.lastAdvancedAt = nowMs/.test(social),
    'supporting-cast advancement markers must be conditional on a canonical change');
assert(/saveStateInFlight/.test(save) && /saveStateQueued/.test(save),
    'saveState must coalesce overlapping full-state writes');
assert(/await persistStateSnapshot\(\)/.test(save),
    'coalesced saves must still commit the latest state snapshot');
assert(/const savingWorldMedia = worldMediaDirty/.test(persist),
    'world media dirtiness must be captured per persistence pass');
assert(/const HORDE_STUDIO_VERSION = '\d+\.\d+\.\d+'/.test(app),
    'the release must retain a parseable semantic version');
assert(/lastPersistedWorldManifests[\s\S]*filter\(world => world\?\.id !== deletedWorldId\)/.test(deleteWorld),
    'explicit World deletion must not be reclassified as an interrupted save');
assert(/delete state\.worldRecoverySnapshots\[deletedWorldId\]/.test(deleteWorld),
    'explicit World deletion must remove its recovery snapshot');

console.log('✓ idle agency persistence and overlapping-save protections are present');
