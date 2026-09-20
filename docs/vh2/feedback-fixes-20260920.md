# VH2 feedback fixes — implementation and verification

This records the current implementation, superseding the original design assessment. Tests use isolated worlds/browser profiles and fixture providers unless stated otherwise. No user world or provider credentials were used by the tests.

| Feedback | Implemented behavior | Evidence |
| --- | --- | --- |
| Builders overwhelm models | Page fields use individual plain-text requests. Life sections send only their requested schema. Advanced world drafting is sequential. Failed/stopped batches retain successful sections, with retry only for missing work. | Page request audit, integrated browser acceptance, focused-schema and partial-draft browser regressions. |
| Asocial/fantasy characters forced into ordinary social life | Authored premise/absence is preserved; empty cast, supporting lives and commitments are accepted. Habit text is validated as text instead of rejected as an empty collection. Core chat setup precedes optional life fields. | Focused builder audit, coherence tests, first-chat UI. This does not promise specific autonomous fictional behavior. |
| Text disappears or is silently shortened | Removed the 800-character appearance truncation and truncation of the authoring text fields. Visible counts, non-clipping paste and save validation. Repeat style apply/save/reload retain text. | Save-path real-browser regression; long Unicode normalization and archive roundtrips. |
| Invisible daily cap | Foreground/background limits and accounting are per character. Fresh foreground connections do not inherit disabled Always On caps. Legacy caps are visible and explicitly adjustable. | Budget backend and UI/browser regressions, scoped provider status, legacy migration. |
| No token/prompt/error transparency | Reply details show model, status, reported token usage, redacted prompt preview and failures. Authoring errors have a bounded session log. Save messages distinguish local failure from unconfirmed life updates. | Token receipt, redaction, backup/copy roundtrip and browser tests. |
| Cannot edit exported data | Readable editable JSON template export/import added; ZIP portable backups retained. | Actual download → manual JSON edits → file-input import; independent identity, media and history roundtrips. |
| Cannot remove locations | Remove unused places/rooms while running, with atomic dependency and stale-edit checks; historical records retained. | Lifecycle service and browser regressions; current-place, schedule and active-reference protections. |
| Dinner all day / no reply / restart hard to find | UI distinguishes occupied commitments from opportunity windows and duration; exposes availability, waiting reasons, pause/resume and history-preserving restart. | A 07:00–20:00 busy dinner fixture reached reply-ready attention and delivered an offline reply within 15 simulated minutes. The reported deadlock was not reproduced; no speculative timing rewrite was made. |
| Missing gifts/money switches | Native visible checkboxes. | Browser checks visible size, keyboard Space, acknowledged save, reload and fresh service poll for gifts, mailed gifts and money. |
| Windows worker encoding | Every worker subprocess uses UTF-8 with replacement decoding. | Offline subprocess/legacy-locale regression. Native Windows was unavailable. |
| Magnific TLS / wrong launcher | Verified trust context supports default roots, certifi and explicit CA bundle; actionable expiry/issuer errors; platform launcher instructions corrected. | Seven offline TLS tests. Live unauthenticated Magnific endpoint test succeeded in TLS and returned expected HTTP 405 on this Mac. Windows-specific chain and authenticated provider generation remain unverified. |
| Prompt instead of picture | Validate actual image bytes/pixels before successful render/delivery in VH2 and Chat Library. | Worker/media/image adapter tests and actual Chat generation-handler fixture. |
| Cluttered source/portable root | VH frontend, engine and backend modules moved into `virtual_humans/`; portable root has three launchers, START HERE and app/. | Dependency closure, extracted package HTTP/worker and launcher routing checks. |
| Clutter/no documentation | Chat/Person/Life navigation, optional pages/groups, collapsed specialist controls, per-page field explanations and practical guide. | Desktop/mobile browser acceptance and screenshots; START-HERE.md included in portable package. |

## Verification limits

Offline provider fixtures verify request routing, parsing, state transitions, retry and delivery—not response quality or support by every external model. No paid text/image generation was submitted. The original reporter's saved character and Windows machine were not available. A certificate that is actually expired on a remote server/proxy cannot be repaired in this application; verification stays enabled.

## Reproducible checks

- `node scripts/check-engine.js` — engine/authoring release suites, including focused and per-field builders.
- `node scratch/vh_page_builder_browser_audit.js` — real-browser page builder and mobile layout.
- `node scratch/vh_partial_builder_browser_audit.js` — retained partial drafts, selective retry and field validation.
- `node scratch/vh_save_paths_audit.js` — save/reload, failures/races and editable JSON UI roundtrip.
- `node scratch/vh_feedback_lifecycle_browser.js` — live setup editing and visible persistent switches.
- `node scratch/vh2_budget_browser_audit.js` — budgets and reply diagnostics.
- Python fixture suites: `vh2_budget_audit`, `vh2_backup_audit`, `test_worker_encoding`, `vh_feedback_lifecycle_audit`, `bridge_tls_audit`, image/media/worker/communication/geography suites.
- `python3 scripts/verify-portable-package.py <archive> --node <node executable>` — extracted portable artifact.

Browser tests require Playwright, Chrome and a local listening port. Python fixture discovery uses `scratch` on PYTHONPATH; set `HORDE_NODE_EXECUTABLE` when Node is not on PATH. Test fixtures use no paid provider calls.

## Final run

- **88/88 engine/authoring suites passed**, including the 214-check companion suite.
- **67/67 offline service acceptance checks passed**, covering profile creation, long-horizon simulation, dialogue, budgets, backup, geography, people, plans, presence, travel and recovery.
- **13/13 creation/chat browser suites passed**, covering scrolling and accessibility, page-scoped generation, adversarial builder recovery, opening messages, mind/body/cognition controls, save paths, lifecycle editing and budget safeguards.
- Final archive extraction passed launcher routing, dependency closure, timeline boot/advance/replay, bundled character resources, HTML references and bridge HTTP/health checks.
- Native Windows worker/launcher checks are part of the release workflow; the local run was performed on macOS.

Artifact: `dist/Horde-Studio-v18.1.0-portable.zip` (269,349,814 bytes).

SHA-256: `56f52858291a881e5900ddaebeb30ab0a8379c4e87be475e53f40543307e7e51`.

The old `ashlyn_archive_audit` relies on a retired fixture absent from this workspace. Current synthetic archive/media tests and the included Aslyn package verification passed instead; the missing retired fixture is not counted as a passing test.
