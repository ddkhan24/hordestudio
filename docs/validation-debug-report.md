# Validation debugging report (27 October 2026)

## A. Executive summary

The isolated clone preserves the three earlier fixes (projected NPC movement, unknown clothing, and regex presentation/audit separation). This follow-up also corrects action-proof and reroll defects, a repair-budget edge case, and a narrow `missing_outfit` false rejection. The real browser pipeline and a local Ollama model were exercised. The developer-reported aggregate failure percentages remain unverified; measurements and their limits appear in section J.

## B. Repository and environment

| Item | Value |
|---|---|
| Source | `https://github.com/ddkhan24/hordestudio` |
| Test environment | Isolated local clone of `ddkhan24/hordestudio` |
| Branch and base commit | `main`, `3d32ca3bfd95ffbb0e746a0448762407e442123f` |
| OS | Windows, PowerShell |
| Node | `v24.11.1` |
| Python | Unavailable: the Python launcher could not access its runtime index (error `0x00002F99`) |
| Browser | Playwright and Chrome installed locally |
| Inference | Local Ollama OpenAI-compatible endpoint `http://127.0.0.1:11434/v1`; `ministral-3:14b`; no model download or paid service |

The source fixes were developed in an isolated clone of the upstream repository. The existing project installation and the fork's `main` branch were not changed.

## C. Architecture and root causes

The UI handles user input in `app.js`. `executeWorldTurn` interprets local intent, calls a model, decodes `scene_draft_v2`/`scene_draft_v3` through `worlds/scene-draft.js`, compiles linked actions and effect capabilities through `worlds/effect-registry.js`, validates a receipt, commits canonical changes, then stores the final turn. Legacy receipts still pass through `validateWorldTurnReceipt` and `commitWorldTurnReceipt`. Rerolls restore a turn snapshot before generation. A rejected generation is expected to restore the saved snapshot. User regex rules are applied to prompt-facing user text and to output prose, after structured draft parsing.

### Confirmed defects

1. **`actor_origin_mismatch` on a valid second NPC leg.** In `validateWorldTurnReceipt`, `projectedLocations` was updated after the first accepted movement, but the next NPC movement still read `npcState.location` for its origin and access check. A receipt moving Rowena `square → chapel → square` therefore rejected leg two as `square ≠ chapel`. The fix uses the projected origin for same-place checks, access and route validation, and the accepted event's `from_location_id`. A deliberately wrong second origin (`inn`) still fails.
2. **Unknown clothing state became `Undressed.`** `applyPlayerOutfitIntent` treated removal of a named garment from an empty/unspecified outfit as removal of the final known garment. With input `I take off my coat.` and `sess.outfit === ''`, it returned `{from:'',to:'Undressed.',mode:'remove',item:'coat'}`. The fix leaves the unspecified state unchanged. An explicit undress command and removal from a known outfit retain their existing behavior.
3. **Regex display text contaminated narrative auditing.** In the final World output path, `applyRegexScripts` ran before `detectNarratedPresence` and related audit scanners. A display rule `Rowena → Maera` turned `Rowena stands beside you` (Rowena is present) into an apparent claim about absent Maera and generated `uncommitted_npc_presence_claim`. The fix audits the scrubbed model narrative and applies display transformations only to displayed/saved presentation text. It does not give regex substitutions authority over structured events or canonical state.

### Findings from the first investigation, superseded by follow-up in section J

- **`uncommitted_player_action`:** `worldActionResolutionFailures` deliberately requires a completed player event, a check, a precommitted action, or a verified local interaction for resolved physical actions. `scene-draft.js` verifies action coverage and linked IDs. Missing proof in model output is a valid rejection. The available deterministic audits did not reproduce an erroneous rejection for a valid complete action.
- **`truncated_receipt`:** `transportFailureReason` maps provider `finish_reason === 'length'` to this reason. Repair code increases its output budget and retries a scene draft. The budget audit passed, but no actual truncated provider stream was reproduced, so transport and repair success rates remain unknown.
- **NPC presence apart from regex:** `detectNarratedPresence` skips an NPC whose saved location equals the player's. Other false positives need a specific raw response and saved world to diagnose. Unsupported arrivals remain rejected or require independent structured checksum and prose evidence in the legacy recovery path.
- **`missing_outfit`:** This validator reason is produced when a completed outfit event lacks a resulting outfit string. That remains a valid rejection. The separate clothing-intent bug above produced an incorrect state without this reason.
- **Regex imports:** The in-app manager stores `regexScripts` and handles enabled state, target, flags and ordered replacements. No dedicated SillyTavern regex-script import path was found in `app.js`; character-card and preset import are separate. Import compatibility was not measured.
- **Rerolls:** Snapshot restoration and transaction guards were inspected and their existing source-extracted audit passed. Repeated live rerolls and persistence after process reload were not exercised.

## D. Implemented changes

| File | Change |
|---|---|
| `app.js` | Validate multi-leg NPC travel against projected locations; retain unknown outfit on garment removal; separate model narrative audit text from regex-altered presentation. |
| `scratch/immersion_engine_audit.js` | Regression cases for three repeated NPC route attempts, wrong-origin rejection and three repeated regex false-presence attempts. |
| `scratch/world_intent_reliability_audit.js` | Three repeated attempts to remove a garment from unspecified outfit state. |
| `docs/validation-debug-report.md` | This evidence and limitation report. |

## E. Reproduction and detailed results

These fixtures exercise real source-extracted application functions in Node's VM, with the existing audit harness stubbing UI, model and storage dependencies. They are deterministic regression tests, **not** live model inference or complete browser turns. All three positive regressions failed before their source fix and passed afterwards.

| Case | Initial state and input | Expected canonical result | Original result | Corrected result |
|---|---|---|---|---|
| NPC route (3 identical attempts) | Rowena at `square`; mapped `square ↔ chapel`; receipt events `square → chapel`, then `chapel → square`; `time_skip_minutes:120` | Both movements accepted; Rowena ends at `square` | Second event rejected: `{"reason":"actor_origin_mismatch","detail":"square ≠ chapel"}` (3/3) | Two accepted events; second `from_location_id:'chapel'`; committed Rowena location `square` (3/3) |
| Invalid route control | Same fixture, second event falsely declares `inn → square` | Reject second event | Rejected | Rejected as `actor_origin_mismatch`; only first leg accepted |
| Garment removal (3 identical attempts) | `outfit:''`; input `I take off my coat.` | Outfit remains unspecified | Invented `Undressed.` (3/3) | No update; `outfit:''` (3/3) |
| Regex false presence (3 identical attempts) | Rowena at `square`, Maera at `inn`; raw prose `Rowena stands beside you in the square.`; enabled AI display regex `Rowena → Maera` | No canonical Maera arrival; model narrative audit has no presence conflict | Display text was audited and identified Maera, yielding a false `uncommitted_npc_presence_claim` (3/3 path replay) | Raw narrative is audited; display remains transformed; canonical Maera location remains `inn` (3/3 source and scanner replay) |

The regex case's old/new pipeline ordering is checked against the application source; the scanner and replacement are executed with the real source-extracted functions. It is not a full `executeWorldTurn` browser run. The NPC route test also calls `commitWorldTurnReceipt` with the audit harness's `processStructuredActions` stub, checking the final entity location. No model responses were generated in these cases; the table's receipts are controlled test proposals.

## F. First investigation's before/after comparison (follow-up in J)

The counts below apply **only to the fixed deterministic fixtures**, not to ordinary response or reroll rates. Nine positive attempts used identical inputs and initial states before and after. Before: 9/9 failed their stated expectations; after: 9/9 passed. The invalid-origin control remained rejected.

| Error | Before | After | Status | Evidence |
|---|---:|---:|---|---|
| False `actor_origin_mismatch` on second leg | 3/3 | 0/3 | Fixed for fixture | `scratch/immersion_engine_audit.js` |
| Unknown outfit asserted as undressed | 3/3 | 0/3 | Fixed for fixture | `scratch/world_intent_reliability_audit.js` |
| Regex-induced false NPC presence | 3/3 | 0/3 | Fixed for fixture | `scratch/immersion_engine_audit.js` |
| `uncommitted_player_action` | Not measured | Not measured | Follow-up in J | Initial action-resolution audit only |
| `truncated_receipt` | Not measured | Not measured | Follow-up in J | Initial budget audit only |
| `missing_outfit` validator reason | Not measured | Not measured | Follow-up in J | Initial empty result rejected |
| Reroll failures | Not measured | Not measured | Follow-up in J | Initial transaction source audit only |

No general invalid-action rate, schema failure rate, repair success rate, persistent inconsistency rate or ordinary response acceptance percentage can be inferred from these tests. Accepted/rejected event evidence in the route fixture: before one accepted and one rejected; after two accepted and zero rejected. The invalid-origin control after the fix remains one accepted and one rejected. No schema or truncation failures occurred in these controlled cases.

## G. First investigation's regression commands (browser follow-up in J)

| Command | Result |
|---|---|
| `node scratch/immersion_engine_audit.js` | 17 checks passed after fixes; new route and regex checks failed before their respective fixes |
| `node scratch/world_intent_reliability_audit.js` | 19 checks passed after fixes; unknown-outfit check failed before fix |
| `node scratch/world_scene_draft_audit.js` | Passed |
| `node scratch/world_action_resolution_audit.js` | Passed |
| `node scratch/world_receipt_repair_budget_audit.js` | Passed |
| `node scratch/worlds2_route_escort_regression.js` | Passed |
| `node scratch/worlds2_look_arrival_audit.js` | Passed |
| `node scratch/world_turn_transaction_audit.js` | Passed |
| `node --check app.js` | Passed |
| `node scratch/worlds2_resolve_first_browser_audit.js` | Initially could not run: `Cannot find module 'playwright'`; installed and passed in follow-up |
| `python --version` | Could not run: Python launcher error `0x00002F99` |

## H. Earlier investigation's limits (updated in section J)

The first investigation had no live inference or browser results. Those were added in section J. Source-extracted Node tests remain narrower than the browser tests. Regex import compatibility, all flag variants and script persistence across reload remain untested.

## I. Earlier recommendation (implemented in section J)

The requested browser dependencies were installed only in the isolated clone, and browser plus local-model replays were performed below. Incomplete physical actions, unsupported NPC movement and unsupported empty outfit events still reject.

## J. Follow-up implementation and browser verification

### Test setup and evidence files

The follow-up uses the unchanged upstream base commit shown above plus the earlier three fixes. Playwright runs the actual `index.html` and `app.js` in Chrome. The live harness at `scratch/world_live_reliability_audit.js` serves those local files through a browser route on the Ollama origin, so the application's real `/v1/chat/completions` calls reach the already installed local model. Its 30 normal turns all start from the same snapshot, with five requests rotated six times: wave to Linda, show Linda a held letter, remove a blue coat, ask Linda how she is, and nod while asking her to wait. The world has Linda in a hall, Marc in a kitchen, Ena in a garden, connected exits, an item, player inventory and a known outfit. The harness records raw HTTP requests, SSE responses, final turn source, validation audit and post-turn state locally. The interrupted intermediate run it has **26**, not 30, attempts and must not be treated as a full baseline.

The live configuration is `ministral-3:14b`, temperature `0.2` (reroll jitter at most `0.05`), context `32768`, requested output `3072`, top-p `1`, supported parameters `temperature/max_tokens/top_p`, JSON-schema response transport, and a local Ollama OpenAI-compatible endpoint. The configured context is a client-side budget; Ollama's effective server context was not independently proven. A repair may request up to `6144` output tokens. No model download or paid API was used. The fixture lacks explicit door locks, relationship values and seeded memories; existing browser regressions cover several state transitions, but the live frequency applies only to this fixture and model.

### P0: valid player actions rejected

**Root cause.** `worlds/scene-draft.js` initially identified a verified local physical interaction only when the entire request had a single action. A compound gesture plus speech could therefore reach `worlds/linked-world-actions.js` as a resolved physical action without a durable event, and the action proof rejected it (`unverified_action_success`/`uncommitted_player_action`). The linked executor also captured `HordeWorldSceneDraft` when its script loaded, before `scene-draft.js` initialized; its local proof path was therefore unavailable in real browser order. In live responses, the model often marked an explicitly completed wave `pending_check` with no check, or mislabeled it as speech. Those proposals failed `pending_action_requires_check` or `invalid_check_shape` although the linked passage showed a completed harmless gesture. Some model proposals genuinely invent effects, such as transferring a letter when the player only shows it; they must remain rejected.

**Correction.** `scene-draft.js` now marks each individually covered, harmless local interaction as verified in a compound request when its passage and effects are consistent. It narrowly normalizes an unsupported `pending_check` to resolved only when the request is a known local interaction, the linked passage expressly depicts completion, and there is no lasting effect or contradictory event. `linked-world-actions.js` resolves the scene-draft API at execution time and rechecks the local proof against the current working cast and inventory. `app.js` now tells the model that an ordinary gesture, showing a held item, or conversation needs no check when completed; a true pending check needs a real check effect. It explicitly says that showing an item does not transfer possession. It did **not** remove action coverage or commit validation.

**Exact regression.** `scratch/world_linked_hardening_audit.js` includes `I tap the desk and wave to the guide.` with two linked passages, and `I wave and ask Guide to wait.` with one physical and one speech action. The former failed before the compound proof change; the latter had `unverified_action_success` before the linked execution correction and now succeeds with the same actor and player location. Three repeated `I wave.` proposals with `pending_check`, no check, and completed passage failed before normalization and now resolve. Negative controls still reject an unperformed wave and `I open the locked door.` without a valid check/effect. A forged `verifiedLocalInteraction` flag and wrong passage IDs remain rejected. Live accepted turns retain Linda in the hall and the player's inventory/outfit unless an exact typed effect changes them.

**Raw live example.** The model's first wave response began with `{"protocol":"scene_draft_v3","narrative":[{"id":"wave_linda","text":"You raise your hand ..."}],"actions":[{"kind":"physical","status":"resolved","response_id":"wave_linda","action_id":"wave_linda","request":"I wave to Linda." ...}]}`. The main request used `"model":"ministral-3:14b","temperature":0.2,"max_tokens":3072,"stream":true,"response_format":{"type":"json_schema"...}`. An early failed response supplied `action_effects.event_emit:[{"id":"wave_linda","type":"player_interaction"}]`; its repair omitted the required action request, and validation rejected it. A successful coat response supplied `action_effects.outfit_set:[{"actor_id":"player","outfit":"linen shirt"}]`; the canonical outfit became `linen shirt`, with letter inventory and NPC positions unchanged. Full raw streams and requests are in the evidence JSON files.

For `I show Linda the letter.`, one rejected raw action was `{"kind":"speech","status":"answered","response_id":"show_letter_to_linda","action_id":"show_letter_to_linda","request":"I show Linda the letter.","action_effects":{"event_emit":[{"id":"linda_receives_letter","type":"item_transfer"}]}}`. The passage described Linda taking the letter even though the player only showed it. The repair request was nonstreaming with `"max_tokens":6144`; its candidate still asserted the unsupported transfer and failed `missing_declared_field`. The canonical letter remained with the player. This is a model-proposal failure; accepting it would corrupt inventory.

### P0: reroll reliability

**Root causes.** The reroll prompt in `app.js` told the model to change actions, even though the user action and preturn state must be replayed. The engine sent a random `seed` regardless of provider support, producing HTTP 400 on providers that reject unknown parameters. In `worlds/linked-world-actions.js`, elapsed minutes were compared with the selected take's post-state instead of the restored working preturn state, so a five-minute reroll could report zero minutes. These are independent of the existing transaction rollback and receipt validation.

**Correction and regression.** The prompt now asks for the same player action from the restored state and only a different plausible narration/outcome. `seed` is sent only when `world.supportedParams` lists it. Linked elapsed minutes are measured against the working state's initial clock. The scripted provider in `scratch/worlds2_turn_telemetry_browser_audit.js` rejects a `seed`; before the fix the reroll failed at HTTP 400, after it reaches the provider without that parameter. The source-extracted five-minute reroll test failed `0 !== 5` before the fix and passes with `5` after it. `scratch/world_reroll_sequence_browser_audit.js` exercises normal success → failed HTTP 503 reroll → successful reroll → save → reload in the real browser. The failure leaves the original DM turn, letter, known outfit, hall location and version unchanged; the successful reroll replaces the prose, stores two takes, and persists one canonical outcome after reload. `scratch/world_linked_turn_browser_audit.js` additionally checks typed clothing effects, rollback, reload and compound actions. Live reroll results are summarized below.

### P1: truncated receipt

**Root cause.** `worldReceiptRepairOutputLimit` in `app.js` allowed a 256-token minimum even when the repair prompt consumed the available context. That generated a doomed repair request instead of a useful diagnostic. The initial V3 schema is large (measured `16348` characters in `scratch/world_latency_audit.js`), so schema and history budget matter. `worlds/scene-draft.js` already distinguishes provider `finish_reason:"length"` as `truncated_receipt`; incomplete JSON is never committed.

**Correction and regression.** The repair budget now returns zero when no output room remains. `executeWorldTurn` skips a repair call below 512 available tokens and reports `insufficient_repair_context`, preserving the original state. `scratch/world_receipt_repair_budget_audit.js` had a failing near-limit case (`6000` context, `16000` prompt characters: before `256`, after `0`), and verifies an expanded ordinary repair budget (`4096` initial → `8192` desired, subject to provider/context caps). `scratch/worlds2_turn_telemetry_browser_audit.js` now streams `The hall is quiet.\n<world_turn_receipt>{"scene":` with `finish_reason:"length"`; the application requests a corrected receipt and commits only after receiving a complete valid proposal. Existing provider response browser tests exercise interrupted streams, malformed responses, empty outputs and HTTP errors. No live `truncated_receipt` occurred in the measured sample; the precise real-model incidence therefore remains undetermined beyond that sample.

### P1: missing outfit

**Root cause.** `validateWorldTurnReceipt` rejected a player outfit event with an empty `outfit` even when `applyPlayerOutfitIntent` had already committed the exact resulting outfit from the player's own input earlier in the same transaction. That is a false rejection of an incomplete model echo when an authoritative result already exists. An empty NPC outfit event or an unsupported player event remains genuinely incomplete. The earlier unknown-clothing fix is preserved. A second confirmed intent gap was `I undress completely.`: the detector did not recognize that explicit final state.

**Correction and regression.** `app.js` passes `precommittedOutfit` into receipt validation and fills an empty player outfit echo only when it exactly matches the current committed outfit. Otherwise `missing_outfit` remains. The player-intent detector now recognizes explicit `I undress`/`I strip` statements, including `completely`, while attempt/negation filters still apply. The scene-draft field guide directs the model to use exact known remaining clothing, an explicit undressed state, or unknown/partial state without inventing garments. `scratch/immersion_engine_audit.js` repeats the verified echo three times, accepts two different NPC outfits in one receipt, and confirms that unsupported empty player and NPC outfit events still reject. `scratch/world_intent_reliability_audit.js` tests coat addition/removal, a replacement outfit, the last known garment, explicit undressing and unknown original clothing. The real linked browser test commits a red coat, rejects a failed candidate without changing it, then commits a green coat and survives reload. In the live 30-turn fixture, successful coat-removal turns commit `linen shirt` from `linen shirt, blue coat`; the model must supply or the engine must already know that exact result.

### Measurements and limitations

The following measurement table comes from local raw evidence after all 30 normal and 30 reroll attempts. Scripted counts describe deterministic browser fixtures; they are **not** LLM reliability estimates. A failure may be a genuinely invalid model proposal rather than an engine defect. The intermediate 26-turn baseline preceded the last action-instruction changes and is not a comparison with pristine upstream. Different random generations also limit causal inference. The complete run wrote all 60 outcomes; its Chrome cleanup stalled after the final result, so the harness process was stopped manually. The JSON output was complete before that cleanup step.

| Metric | Intermediate live baseline | Follow-up live run | Scripted / state-integrity evidence |
|---|---:|---:|---|
| Valid player actions accepted | 8 / 26 (30.8%) | 24 / 30 (80.0%) | Compound gesture and speech, completed wave and typed outfit now pass |
| `uncommitted_player_action` | N/A (errors not counted by exact reason) | N/A (errors not counted by exact reason) | Before/after deterministic failing examples above |
| Successful rerolls | N/A | 29 / 30 (96.7%) | 1/1 scripted success after a 503 failure |
| Failed rerolls | N/A | 1 / 30 (3.3%) | 503 failure preserved original state; live failed take also retained its original |
| `truncated_receipt` | 0 provider `finish_reason:length` in 46 calls | 0 in 74 calls | One scripted truncated stream repaired; near-limit budget fixed |
| `missing_outfit` | N/A (validation reasons not recorded per attempt) | N/A (validation reasons not recorded per attempt) | 3/3 verified empty echoes accepted; unsupported events rejected |
| Successful receipt repairs | 2 normal turns | 4 normal turns plus 2 rerolls | Scripted length-finished stream repaired |
| Incorrect world-state commits | 0 observed in captured failed attempts | 0/6 failed normal turns; 0/30 rerolls with cast, inventory or outfit drift | 0 in focused rollback/reload cases |
| Save/reload failures | N/A | N/A | 0/1 focused sequence; linked clothing browser continuation passed |

**Remaining limitations.** The 30+30 live run covers one local model and one five-input fixture. It cannot establish the reported percentages, nor prove reliability for every world, model, long context, door lock, NPC relationship, memory or schedule. The model sometimes invents a possession transfer for a mere show action, mismatches passage IDs, or adds unsupported events; validation correctly rejects those proposals. The explicit show-item instruction and explicit-undress detector were added after the live browser page had loaded; their effect on model acceptance is not included in that live frequency. The browser tests include actual application routing and IndexedDB persistence, while the source-extracted tests isolate validator logic. No incomplete structured action is intentionally committed.

The 30 rerolls each restored the same successful wave take before generation. The single failed reroll left one version and the original text; the other 29 stored a second take. All 30 ended with Linda in the hall, Marc in the kitchen, Ena in the garden, the letter in player inventory and `linen shirt, blue coat` as the player outfit. Six failed normal turns retained world-state version `0`, the original outfit, cast, inventory and opening history. The live harness did not export exact per-failure validation codes or reload each take; the scripted sequence verifies persistence after both failure and success. The prompt length estimate is approximate and provider-specific. The measured improvement is encouraging for this fixture, but remaining show-item failures and unsupported model proposals mean ordinary action reliability is still imperfect.

### Commands rerun after the final source edits

`node --check app.js`; `node scratch/world_linked_hardening_audit.js`; `node scratch/world_intent_reliability_audit.js` (20 checks); `node scratch/immersion_engine_audit.js` (19 checks); `node scratch/world_receipt_repair_budget_audit.js`; `node scratch/world_scene_draft_audit.js`; `node scratch/world_action_resolution_audit.js`; `node scratch/world_turn_transaction_audit.js`; and `git diff --check` all passed in the source clone. With `HORDE_BROWSER_EXECUTABLE` set to the local Chrome executable, `worlds2_resolve_first_browser_audit.js`, `worlds2_provider_response_browser_audit.js`, `worlds2_atomic_turn_persistence_browser_audit.js`, `worlds2_receipt_boundary_browser_audit.js`, `world_scene_draft_browser_audit.js`, `worlds2_turn_telemetry_browser_audit.js`, `world_linked_turn_browser_audit.js` and the new `world_reroll_sequence_browser_audit.js` passed. `world_latency_browser_audit.js` had previously stalled and was stopped; its source-extracted counterpart passed.
