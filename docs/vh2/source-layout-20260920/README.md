# Actual VH source-tree cleanup

The earlier packaging-only change hid loose files inside `app/`. This change reorganizes the implementation itself.

91 existing root files were relocated:

| Folder | Existing files | Contents |
| --- | ---: | --- |
| `virtual_humans/frontend/` | 8 | Editor/workspace, builders, browser integration, CSS, developer dashboard |
| `virtual_humans/engine/` | 32 | JavaScript simulation engines, Node workers, JSON schemas/policies |
| `virtual_humans/backend/` | 51 | Python services, persistence, providers and supporting systems |

Python package initializers and a source-layout README were added. No VH source copies or import shims remain at the root. The main application shell and server launcher remain there.

## Wiring

- Browser HTML loads nested asset URLs. The developer dashboard's links work from its nested location.
- The local bridge explicitly serves those public assets; old URLs alias the same relocated files for cached pages.
- Python services use package imports, including dynamic imports.
- Node workers retain sibling-relative engine imports. Python invokes workers from their new paths.
- Backend JSON readers locate the sibling engine folder.
- Runtime fingerprint inputs use relocated paths in the original order. The engine fingerprint remains `3dc9f2c29a09eda0`, matching the pre-move tracked sources. No simulation logic was changed for this move.
- Packaging preserves `app/virtual_humans/{frontend,engine,backend}` and excludes bytecode caches.
- Active test and developer utility references were migrated; historical archived output directories were not rewritten.

## Validation

The integrated page-builder browser test passed against the relocated local server. All backend modules import, nested static route targets exist, and a temporary-database world can invoke the relocated Node worker. The packaging verifier checks recursive dependencies, no root VH shims, extracted HTML references, launchers, timeline boot/advance/replay, and actual packaged HTTP startup.

The reorganization does not address unrelated simulation policy or provider failures. Native Windows execution still needs platform validation; Windows launcher routing is checked statically.

## Completed checks

- JavaScript engine gate: 85 of 86 suites passed initially. The remaining cache-key consistency check exposed a mismatched help asset version from the preceding UI work; the key was aligned and all six settings-persistence checks passed on rerun.
- Python foundation: 11 tests passed.
- Python Horde integration: 8 tests passed.
- Worker UTF-8 regression: 2 tests passed.
- Image-preview regression: 4 tests passed after migrating its dynamic import.
- All active Python test/developer utility sources parse.
- Integrated VH2 page-builder browser acceptance passed with the relocated application.

Release artifact: `dist/Horde-Studio-v18.1.0-portable.zip` (269,349,845 bytes). Extracted-package verification passed, including nested HTML/asset references, absence of loose VH root files, launcher routing, isolated timeline boot/advance/replay, and HTTP startup serving the nested page-builder asset.
