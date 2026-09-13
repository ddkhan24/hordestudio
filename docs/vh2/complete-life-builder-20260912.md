# Complete life builder — implementation and verification

The existing Create from notes button now builds a person **and the executable world** from one brief. It uses the selected character text connection for three phases—person design, executable life and coherence review—then presents one review. It creates no photos, videos, external messages, or live-provider jobs while drafting.

The draft includes physical appearance and conversational voice; places, rooms, wardrobe, props and reference slots; supporting people with independent homes, resources, local clocks, real work/class obligations and routes; needs-based autonomy; encounters, invitations, hosting, new fictional residents; household activities such as cooking/exercise and explicitly accessible swimming; health, emotional learning and relationship development. The model receives supported structured schemas and is instructed to derive behavior values from each person's authored traits.

The review leads with the proposed life, human-readable behavior summaries and reviewable assumptions. Supporting-person work/class obligations can be edited inline in that same review: activity, saved place, weekdays, local start/end time and flexibility; invalid obligations block applying until corrected. Missing homes, invalid policies and map positioning are distinguished from image generation. Section choices and exact details remain in this review. A new character saves the full blueprint and then starts through the existing persistent-life bootstrap. Active-life changes use the existing atomic `apply_life_proposal` command and preserve recorded events, positions and balances. New-life funds and possessions are initial proposals; later edits cannot replenish resources or conjure new owned items.

The saved service setup is extracted back into the authoring model, including every policy, supporting-person timezone, public/local population and prop descriptions. Reopening or generating a later draft therefore starts from the active life. Explicitly disabled settings are preserved unless the brief asks to change them.

Life settings exposes independent choices, expression, social posting, supporting-person interactions, friend plans, new introductions, invitations/hosting, weather and health in one modal. Its direct links lead to places/household, people, AI fine tuning and private-visit boundaries. Ordinary adult visits can follow personality and current interest; per-person custom rules or vetoes are optional and can be removed to restore defaults. Intimate outcomes remain separate and are not enabled by ordinary visits.

The old exploration inspector now reads the canonical geographic choices and links to these controls. The peer-plan inspector reads the canonical `vh2Plans.plans` projection instead of the retired network list.

## Reliability

- The original policy-only completion parser rejected new policy sections. It now recognizes all supported sections.
- Full drafts request a suitable output budget. Truncated output can recover through bounded focused section requests; invalid required policy shapes receive one bounded repair attempt. Unresolved sections remain visible and can be filled again.
- Draft cancellation retains existing saved state. A changed active life invalidates the draft target.
- Save updates the Studio form and header, avoiding a later stale form save reverting the generated person.
- Starting/retrying uses the current persistent-life bootstrap and receipt state. Successful start navigates to the actual Life view.
- Shared `vh-life-schema.js` is explicitly served, cache-busted, copied into portable builds and included in the dependency and syntax checks.

## Verification

`scratch/vh_complete_life_builder_browser_audit.js` runs the real app in Chrome with three mocked text completions and an isolated real VH2 service/database. The test enters one brief through the real builder button, reviews assumptions, saves, starts a persistent life, and checks that personality, behavior policies, independent supporting people, inline-edited work commitments, three fictional residents, public swimming, props and initial funds actually reached the engine. It verifies no photos/clips were generated, the saved header, actual Life navigation, service extraction, an immediate persisted social toggle, policy-only parsing and bounded invalid-policy recovery. It exercises desktop and 390px review/settings layouts with actions scrolled into view.

Additional regressions: 213 companion/parser checks; 8 command receipt scenarios; readiness classification; photo review queue/version, saved image provider and inherited reference model; setup auditor/repair and six-room recovery; 6 settings persistence checks; portable dependency closure.

This verifies integration and saved configuration using deterministic text fixtures, not the creative quality or schema compliance of every external model. Real map coordinates, image/video references and provider credentials still need their actual sources. No live character was edited by these browser tests.

## Map binding correction

A map selection now carries its provider ID and position together. Google uses the returned `location` latitude/longitude; OpenStreetMap-based results use their coordinates and clear an unrelated Google ID. If a result has no position, the old pin is explicitly cleared. Users can choose coordinate-only positioning in the place editor, which removes the old Google routing binding. `scratch/vh_map_selection_browser_audit.js` verifies all four cases through actual review/save controls and the isolated service.

World setup now recognizes an already applied region, preselects its saved bindings and offers **Update region links** in the existing flow. First imports use the normal command; an existing immutable region uses explicit refresh. Reapplying it preserves the original import record and does not append duplicate walking routes. `scratch/vh_world_pack_refresh_browser_audit.js` verifies first import, rebind and repeat through the real browser controls and isolated service. The older world-library/mobile regression also passes.

## Supporting-person ownership corrections

People → Life & location includes an inline **Correct vehicle ownership** disclosure. It shows saved car/bicycle ownership and requires the authored fact being restored. This explicit setup correction cannot be confused with an in-world purchase, and it is unavailable while the person is travelling. The ordinary personality/AI draft flow still cannot silently change existing ownership.

`scratch/vh_person_vehicle_correction_browser_audit.js` opens the real People control, submits the explicit correction, verifies ownership after reopening, and checks that the newly recorded car is at the person's existing place while their location, journey and budget remain unchanged. The browser test and visual inspection cover a 390px viewport. Both new regressions use temporary databases and no live providers or character edits.


## Meaning and coherence update

The builder now receives a shared guide to the existing engine, not just field names. It explains motives versus opportunities, needs and reachable places, real obligations versus flexible activities, independent participants and their clocks, money and supplies, learning and emotional tendencies, public versus private expression, references, and bounded life advice. No second simulation authority was added.

The person phase produces a compact `lifeDesign` with the situation, facts from the brief, a few wants linked to opportunities and friction, social structure, ordinary texture and unsupported requests. This stays in the draft/review. It is not a memory, runtime rule, guarantee or recorded event. Profile generation receives existing authored identity and known places/people; explicit absences and the original brief outrank model proposals. A person with only a name is no longer accepted: missing core identity/motive fields get one completion attempt, then an actionable failure with the brief retained.

The life and focused-completion phases now receive the complete supported personality handoff, including relationship style, player connection, emotional expression, rumination, timing, preferences and public writing style. They use one filtered authoring snapshot rather than duplicated setup plus raw internal world defaults. The current local date/active-life clock is included for meaningful term dates and reminders. No provider credentials or raw runtime state enter that dossier.

Removed conflicting instructions to create 4–10 friends even for an isolated brief, fill every narrative field exhaustively, and emit an unsupported supplies section. The schema examples are explicitly illustrations, including their dates, currency and numbers. Unknown traits may remain moderate; distinction must follow evidence rather than artificially maximizing differences. Public writing style and posting boundaries now survive the person → blueprint → active-life path, independently of private texting style.

One bounded coherence pass audits the entire draft against the original brief and supported mechanics, mentally considering an ordinary day and a free day. It can propose complete corrected sections, preserving valid details and IDs. It cannot submit assets, execute events or inject runtime state. Invalid corrections are discarded with the original draft retained. Mechanically contradictory settings, contact activities without people/windows, meals without food capability, hourly income without paid work, and generic schedule placeholders are checked in code and remain actionable in the same review. Subjective model concerns are shown as concerns, not presented as scientific judgments. A failed review is visible and can be retried with **Check consistency with AI**.

Normal whole-person creation now uses three text calls. An incomplete person has at most one extra identity pass; missing life sections share the existing six-call completion ceiling. The coherence pass does not silently loop. No image/video generation is triggered. Existing provider choices and spending settings are preserved.

### Final evidence

- Existing 76 engine suites passed; the new `vh_builder_coherence_audit` also passed and is now part of the gate (77 suites on future full runs).
- Final isolated Chrome workflow passed the three phases, deliberately broken hourly income repaired into a reviewed daily-income assumption, personality/design handoff, concrete swimming choice, public-writing persistence, saved-life startup, malformed corrections, runtime injection rejection, partial person failure and bounded completion. Desktop and 390px layouts were checked.
- Input-contract tests cover three different authored lives, explicit absent relationships, deliberate solitude, complete emotional/relationship context, no raw runtime leakage and provider-neutral structured response parsing. These are mechanism tests, not a claim that every LLM generates equally good characters.
- 26 complete-builder service tests and 13 daily-adviser service tests passed; portable dependency closure and isolated boot/advance/replay passed.
- The separately approved live OpenRouter adviser diagnostic succeeded with `google/gemma-4-31b-it` and a 1,200-output-token ceiling. One call was made. The result was saved as tentative direction with three optional intentions, exposed in chat context, and verified by exact event replay on a copied database. No intention was labelled completed by the diagnostic.

These changes pass the scoped release checks. No release artifact was published, and creative quality across arbitrary providers/models is not certified by fixture-based builder tests.
