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
const saveWorld = functionSource('saveWorld');
const verifyWorldPersisted = functionSource('verifyWorldPersisted');
const loadState = functionSource('loadState');

assert(agency && save && persist && life && social && deleteWorld && saveWorld && verifyWorldPersisted && loadState,
    'hotfix functions must remain extractable');
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
assert(/await verifyWorldPersisted\(w\)/.test(saveWorld),
    'World Save must verify the committed manifest before reporting success');
assert(/HordeDB\.get\('worlds'\)/.test(verifyWorldPersisted),
    'World save verification must read the manifest back from IndexedDB');
const legacyStart = loadState.indexOf('if (hasOldData)');
const legacyEnd = loadState.indexOf('} else {', legacyStart);
const legacyBranch = loadState.slice(legacyStart, legacyEnd);
assert(!/await saveState\(\)/.test(legacyBranch),
    'legacy migration must not overwrite unloaded modern Worlds with startup defaults');
assert(/return loadState\(\)/.test(legacyBranch),
    'legacy migration must re-enter the normal IndexedDB loader');

console.log('✓ idle agency persistence and overlapping-save protections are present');
