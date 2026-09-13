# Realistic life: UX and setup audit

12 September 2026 · Independent read-only review of the current source. No live actions, settings changes, provider calls, or implementation edits were made for this audit. Files may be changing in parallel; findings describe the code inspected here.

## Assessment

The interface currently makes “independent life enabled” sound broader than the behavior it enables. Movement, encounters, introductions, peer invitations, expression, posting, emotional interpretation and weather have different switches and dependencies. Some are available but difficult to find; some desired behavior does not yet have an equivalent backend system. A clearer control surface must preserve this distinction.

The engine has useful foundations: physical locations and timed travel, need-driven activity candidates, main-character invitations after encounters, small peer plans, introductions to authored residents, measured relationship changes, live weather observations, and remembered experiences. Those foundations do not establish an unrestricted Friday-night party simulation, illness, rich home activities, or psychologically validated behavior.

## Capability and reachability map

| Desired experience | What exists in the inspected engine | Current entry point and barrier | Classification |
|---|---|---|---|
| Choose something to do during free time | Geography creates local interests, rest, calls and exercise, plus reachable places. Conditions include needs, cost, knowledge and routes. | Life settings → Independent life & exploration. Routine & goals → Everyday activities still requires days and From/Until times. | Available; authoring still communicates scheduling more than preferences. |
| Exercise at home | Homes are assigned an exercise capability; sufficient energy creates a 25-minute “Work out at…” option with energy/stress effects. | No simple place capability editor or “exercise at home” preference is visible in the everyday editor. | Available in generic form; not a distinct equipment- or routine-aware exercise simulation. |
| Swim or spend time by the pool | Pool labels can infer exercise/leisure capability. The same generic exercise candidate is used. | Add a place, map/link it, then depend on capability inference. | Generic place activity exists; swimming affordances, pool access and weather-specific swimming choices are not established by this path. |
| Friends arrange an outing | Independently simulated people can form small peer plans after mutual friendship evidence, with route/availability checks and individual responses. | People → Social network opens advanced “Supporting-person network”; private encounters and group plans have separate switches and many numerical thresholds. | Optional backend exists; hidden configuration/dependency problem. |
| The main character invites friends | Spontaneous expression can create an invitation after a recorded encounter; the proposal uses the current location. | Life settings → Spontaneous expression. This combines photography and invitations under a vague name. | Available but narrow; not general remote party planning. |
| Attend a real event | Noticed calendar events can enter the same activity queue if a linked venue, route and required access are available. | Providers, feeds & events → Ticketmaster / world feeds, plus place and ticket setup. | Available with prerequisites; event attendance is not guaranteed and a listing is not admission. |
| Meet someone new | Public-place overlap with an authored resident can produce an introduction. It requires public nearby-encounter scope, availability, sustained overlap and mutual willingness. | People → Meeting new people → Local people & introductions. User must create residents, choose a place and availability window, and enable introductions. | Backend exists for authored population. Open-ended autonomous population creation is absent from this flow. |
| A party develops into an unplanned change of company or location | Plans, encounters, departures and relationship progression exist as separate mechanisms. | No author-facing party/social-event opportunity model or multistage outing view. | Full chain not established. Turning on a switch cannot supply the missing orchestration. |
| React to heat or rain | Service reads Open-Meteo at current coordinates while the life is within five minutes of real time. Weather affects transport cost and clothing. | Person → Life setup → Use live local weather and daylight. Freshness/error is not part of the small Life settings sheet. | Observation and limited consequences exist; broad weather-based activity replanning is not established. |
| Become ill and change behavior | Search across `vh*.js`, `vh*.py` and app code did not find a persistent illness, symptom or recovery model. “Health routine” is descriptive authoring context. | No illness controls found. | Missing domain behavior, not a hidden toggle. |
| Feel emotions and remember interpersonal effects | Conversation interpretation can affect emotions; experience appraisal changes mood and preference; relationship policies retain evidence and limits. | Relationship button → Feelings/Agency; tuning is in Inspector → Conversation emotions / Relationship pace / Experience and memory, while style is in Person. | Backend exists; controls and evidence are fragmented. |
| Speak naturally about an actual life | Expression context includes environment, introductions, observed meetings, purchases, own posts/interactions, experiences and recalled events. | Chat styles, emotional style, provider/model, immersion timing and active-life state are configured in different locations. | Context wiring exists; naturalness and contradiction rate require behavioral evaluation, not UI presence alone. |

Evidence: [geographic activities](</Users/razashah/Horde Studio 7.8 (with local)/vh2-geography-engine.js:69>), [capability inference](</Users/razashah/Horde Studio 7.8 (with local)/vh2_geography.py:4>), [peer plans](</Users/razashah/Horde Studio 7.8 (with local)/vh2-network-engine.js:94>), [spontaneous expression](</Users/razashah/Horde Studio 7.8 (with local)/vh2-agency-engine.js:14>), [introductions](</Users/razashah/Horde Studio 7.8 (with local)/vh2-population-engine.js:6>), [weather](</Users/razashah/Horde Studio 7.8 (with local)/vh2_weather.py:43>).

## Confirmed UX defects and architectural checks

1. **Private plans can disappear from their inspector.** The Supporting-person network panel reads `net.plans`. The network engine migrates those plans into `c.vh2Plans.plans` and deletes `network.plans`. Use the canonical projection, filtered to peer plans, with participant names and actual status. This is a stale read path, not evidence that no plans exist. See `vh2-horde-integration.js`, `vh2LifestylePanels` network block; `vh2-network-engine.js`, `ensure` and `peerPlans`.

2. **Advanced exploration still describes a removed movement contract.** Its copy says every visit includes a return route, and its last-review display reads `link.exploration.decisions`. Consolidated geography owns destination selection and movement. Replace the competing editor with one view of the canonical policy and actual geography decisions. See `vh2-horde-integration.js`, `vh2LifestylePanels` exploration block.

3. **“All three activities on” is not “all social autonomy on”.** `vhLifeActivityControls` exposes geography, expression and posting. Population introductions, private peer encounters and group invitations remain elsewhere. Show these as named subcapabilities and their real dependencies rather than implying completion with a three-count summary. See `vh-workspace.js`, `vhLifeActivityControls`; `vh2-horde-integration.js`, population/network panels.

4. **Ordinary activities look like appointments.** `vhRoutineEditor` requires a day set and exact start/end for both commitments and free-time options. It also disallows overnight windows. The everyday activity copy promises choice, but its form asks for a schedule. Use optional preferred time windows and duration ranges for hobbies, with exact times reserved for commitments. Backend compatibility must be checked before changing those fields.

5. **Current relationship inspection is available but numbers dominate.** `openCompanionSimulationDetails` offers Overview, Feelings, Agency, Activities and History, but leads with thirteen relationship meters and absolute scores. A useful first view should explain changes and cite their sources; raw meters belong in an expandable diagnostic area. The existing direct Relationship button should remain visible.

6. **Potential private-knowledge leak needs backend verification.** The expression packet includes `observedPeerMeetings`, but also builds `sharedPlans` from the complete canonical plan list without a visible scope/observation filter in the inspected comprehension. After consolidation, this can expose private peer place/time/status despite UI copy saying those plans are not automatically known. Verify and test filtering before presenting provenance as reliable. See `vh2_runtime.py`, expression context near `sharedPlans` and `observedPeerMeetings`.

7. **Weather can be enabled without being usable.** Live weather requires coordinates and near-real-time simulation, with a bounded refresh cadence. The visible checkbox does not explain a stale observation, missing coordinates, or a timeline too far behind. Show “Current”, “Using last observation”, or “Needs location/time” with a direct repair action.

## AI setup coverage and remaining manual work

The life builder can draft places, people, wardrobe, activity options, supporting-person lives, routes, rooms, references, sleep/break policy and financial setup. Person generation separately supports emotional style, regulation, rumination and reaction timing. The new “Complete people & world with AI” action explicitly requests residences, initial-position assumptions and supporting-life configuration while retaining existing IDs and history. These are substantial improvements.

However, the applied life section allowlist and `VH_ESSENTIAL_SECTIONS` do not include the private encounter network, group-plan policy, local-resident population, relationship progression policy or a real health model. Generating a complete-looking social circle therefore does not establish that these people participate, can meet strangers, or arrange group outings. The review already warns about unconfigured supporting people; extend that coverage report to executable social capabilities.

Manual setup should ask for consequential choices: where this fictional world is based, ordinary lifestyle, important relationships, boundaries and spending preferences. AI can propose fictional residences, suitable leisure places, a small resident pool, household affordances and compatible activities as one reviewable world draft. Never call invented opening hours, coordinates, private access or transport availability verified facts. Existing UI can retain these as explicit setup assumptions.

Evidence: `vh-workspace.js` → `VH_LIFE_SECTIONS`, `VH_ESSENTIAL_SECTIONS`, `vhGenerateEssentials`, `vhPeopleHome`; `app.js` → `companionLifeBuilderSystemPrompt` and focused completion prompt around line 45640; `vh-setup-ui.js` → `vhLifeSetupReport`.

## Coherent minimal interface

Keep three author tools directly reachable beside the conversation: **Life**, **Relationships**, and **Social**. Keep provider budgets and rendering progress inside Media/Settings; never inject them as character speech or user messages.

**Life** opens a full-height view with the current local time, place, actual activity and people nearby. A compact “Autonomy” button opens one settings sheet. The sheet groups existing controls into Independent activity, Social encounters & invitations, Sharing, and Live world information. Expanding a group explains exact enabled capabilities and prerequisites. Missing backend features must not be represented as switches that appear to work.

**People & places** shows every recurring person with participation status, current known position, home and unresolved dependencies. “Complete this world with AI” repairs missing setup in one draft. Place details offer clear affordances—food, rest, exercise, social use—and separate authored access from verified map facts. A room photo should not imply permission to enter the room.

**Relationships** defaults to a short recent-change timeline: what happened, the participant's tentative interpretation, what feeling changed, and whether it has persisted. A “Why?” expansion shows source events and whether the item is observed, said by someone, inferred, or an initial authored assumption. Exact values and decision traces stay behind Details. Player-visible chat only receives what the character actually knows and chooses to express.

**Everyday activities** asks “What do they enjoy?” and “Where can they do it?” A duration and optional preference window are enough for most hobbies. Fixed class/work appointments remain under Commitments. “Work out at home”, “Call family” and “Swim when suitable” must each have their real prerequisites visible; descriptions must not promise behavior the engine cannot execute.

This applies Apple's guidance to integrate feedback, reveal detail progressively and avoid redundant settings. [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback), [Settings](https://developer.apple.com/design/human-interface-guidelines/settings), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout).

## Acceptance checks before claiming realism

- Turning on social autonomy either enables each implemented subcapability or names the missing prerequisite; there is no hidden second switch.
- A saved peer plan is visible from the canonical plan store, survives reload, and does not become the main character's knowledge until observed or communicated.
- The builder's completion report distinguishes authored cast, located participants, social permissions and executable routes.
- Free-time hobbies can be authored without pretending they are fixed appointments.
- Weather status explains freshness and constraints; claiming a behavioral response requires a recorded outcome.
- Illness and complex party narratives remain labelled unsupported until their state transitions and interruption/resumption behavior are implemented and tested.
- Chat evaluation includes contradiction rate, repetition, knowledge leakage and whether feelings/actions carry consequences over subsequent turns. The existence of emotional sliders is not a realism test.
