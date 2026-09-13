# Social simulation architecture audit — 12 September 2026

**Status:** This document records the pre-repair audit. The subsequent implementation and its verified scope are documented in [social-simulation-implementation-20260912.md](social-simulation-implementation-20260912.md). The original findings below are retained as evidence, not a claim that those defects remain unfixed.

This is a read-only audit of the current source and offline test fixtures. No live timeline, server, provider or character was modified. It does not certify the whole engine or claim psychological realism. File references describe the inspected implementation; concurrent changes should be checked against these findings.

## Assessment

There is a useful simulation underneath the interface: independent supporting people have needs, money, vehicles, real route traversal, remembered experiences and reciprocal social appraisals. Main-character free time can produce competing intentions instead of a flexible schedule block. Offline simulations demonstrate different histories across seeds and reproducibility after restart.

The requested connected social life is not complete. Existing modules can produce parts of an evening, but cannot organically execute the full chain “Jordan invites Ashlyn to a party, Ashlyn meets someone, changes companions, goes elsewhere with them, and later returns home.” The largest gap is coordination between participants and consequences of partial participation, rather than a missing prose-generation model.

The canonical plan store is already `c.vh2Plans.plans`. Building another party or social-life controller would repeat the ownership problem. Extend its lifecycle and the existing movement/decision authorities.

## What works, and where the boundary is

| Capability | Current working path | Hard limit |
| --- | --- | --- |
| Supporting people occupy space | `vh2-people-engine.js`: `route`, `depart`, `tick`, `availableAt` enforce saved routes, elapsed travel, funds and vehicle location. | Low-fidelity action set: rest, sleep, eat, leisure, obligations and meetings. It is not a second fully expressive human mind. |
| Needs and self-directed free time | `vh2-geography-engine.js:18` drops flexible schedule blocks when geography is enabled. `propose` creates food, recovery, interests, exercise, contact and venue opportunities; `vh-activity-engine.js:304` can pause an intention for another. | Candidate kinds, utilities and consequences remain programmed. Open-ended language about an activity does not create new executable behavior. Fixed commitments and sleep still constrain choices. |
| NPC friendships and small groups | `vh2-network-engine.js`: `advance`, `updateBond`, `advancePlans` use actual overlap, asymmetric appraisals, repeated meetings and independent willingness. Plans can counterpropose a mutually reachable venue. | Only `vh2People.actors` participate. The main character is outside this actor set. Automatic peer plans have two or three members, reuse a previously shared place and require earned mutual friendship. |
| Main-character invitations | `vh2-agency-engine.js:23–32` can invite a recently encountered known person and nearby known companions. `vh2-plans-engine.js` creates an executable contact goal. | The autonomous invitation is to the current place, ten minutes later. There is no remote NPC-to-main invitation into a new party or a general join-existing-plan action. |
| Meeting strangers | `vh2-population-engine.js:6` waits for public-place overlap, then makes separate seeded approach/response decisions. Successful introductions become persistent acquaintances, with no instant friendship or phone access. | Strangers must already be authored residents or configured actors. Eligible places must have `encounterScope:'nearby'`; homes are excluded. An introduced resident without a home actor becomes spatially unplaced on following ticks. |
| Calling family/friends | `vh2-geography-engine.js:83` proposes a 12-minute `Call <name>` contact goal during a known contact window. `vh-simulation-core.js:2178` records completion and reduces the main character's social need. | This is an abstract contact activity. It does not reserve the counterpart's attention, run a reciprocal call session, establish dialogue facts or earn shared-plan relationship credit. |
| Leaving or changing plans | Main activity selection can pause goals; peer actors can leave a meeting for hunger, obligations or selected stress/boredom conditions (`vh2-people-engine.js:116`). | No general membership leave/join/revise command. Shared plans demand all participants together. Main-linked NPC meetings lack the peer early-departure rules, creating inconsistent freedom. A destination change is not a negotiated group transition. |
| Going to a public event | `vh2-geography-engine.js:113–120` turns a noticed, located calendar event into a normal competing leisure goal; requires route and confirmed access where tickets are required. | The event goal represents up to 30 minutes at its location. It does not assemble a group, model the match/party internally, or establish host/guest attendance beyond the location action. |
| Photos/social posts from life | `vh2-agency-engine.js` evaluates encounter, arrival and completed-activity facts for capture/share decisions. | This audit verifies the social trigger path only, not live image/video delivery. The group event needs to exist first; caption generation cannot supply missing attendance or interactions. |
| Returning home | Normal needs and reachable home goals can lead home. `vh2-episodes-engine.js` supports authored overnight opportunities with an outward/return itinerary. | A normal geographic outing has a single destination stop (`vh2-geography-engine.js:141`), not a general “finish evening / return or stay over” intention. Overnight opportunities do not implement host negotiation. |
| Romance and private adult intimacy | `vh2-relationship-lifecycle.js` can progress configured adult pairings from repeated mutual experience to dating/partnership. Controls exist in `vh2-horde-integration.js` social progression/personal preferences panels. | No executable mutual private-intimacy proposal/outcome. Default progression requires ten meetings over thirty days to date; an existing dating/partner relationship blocks another pairing. Personal preference text is expression guidance, not action configuration. Internal desire/self-regulation in `vh-simulation-core.js:1125,1221` is not evidence of an encounter with another person. |
| Hosting a party | A place, activity label and invitation can be authored using existing primitives. | No host event lifecycle, guest admission, capacity, preparation, invitation propagation or participant-based closing condition was found. A label saying “party” supplies none of those mechanics. |
| Illness, fatigue and work | Main/NPC needs include hunger, energy and stress. Supporting obligations can pay income and expenses; geography constrains actions. | `healthRoutine` is profile prose. No dedicated illness onset, symptoms, recovery or care-action state was found in the inspected kernel. Supporting work remains authored obligation windows, not general job-task cooperation. |

## Proven integration defects

### P1 — Private peer plans leak into the main character's expression context

`vh2_runtime.py:701` serializes the last twelve records from the canonical plan store as `sharedPlans` without filtering `scope`, main-character membership or knowledge. It then removes `scope` and `people`, hiding the distinction from the model. `observedPeerMeetings` at line 694 is correctly separate, but does not protect this second path. `vh2_conversation.py:85` includes `sharedPlans` in conversation context.

Offline reproduction: insert a private peer-only plan into a copied state, leave `observedPeerMeetings` empty, and call `WorldService.expression_context`. Its private label, place and acceptance state still appear in `sharedPlans`. No database mutation or provider call is needed to reproduce it.

Fix: context should expose only plans the main character is a party to and knows about. Peer observations must come through recorded observations/disclosures, not the raw plan store. Retain participant identities for legitimate shared plans. Add a service-context negative test with an unseen peer plan.

### P1 — Meeting a new resident leaves them spatially unplaced

`vh2-population-engine.js:32–33` creates an introduced resident's temporary position and legacy availability row. `vh2-kernel-worker.js:67` clears positions without an independent actor. `vh2_people.py:25` cannot prepare an actor without a known home, and the population authoring contract supplies only the public meeting place. The population loop skips residents already introduced.

Offline reproduction through the existing population service fixture: after a successful introduction, subsequent ticks preserve the acquaintance but return `hasActor:false`, `placeId:''`, `positionSource:'unplaced'`, and setup reason “Choose a home and starting place.” The existing service test passes because it checks remembered introduction, not continuing physical participation.

Fix: establish the resident's persistent spatial model before/when they become eligible to participate. Support a bounded resident actor with a known current anchor and unknown home, or generate a complete resident life during local-world setup. Do not invent a private home from the public encounter, and do not keep a second legacy movement owner.

### P1 — Group completion ignores additional participants' relationships

`vh2-social-bonds.js:31` processes only `plan.personId === p.id`. It ignores other main-linked participants in `plan.people`. A completed plan with main, Sam and Jordan produces Sam `meetings:1, warmth:0.8`, Jordan `meetings:0, warmth:0` in an offline probe. Contact exchange/romance progression downstream also loses that additional-participant evidence.

Fix: use recorded participant overlap and interaction evidence to update every relevant directional pair. Do not simply credit every invited ID: declined, absent or already-departed guests must receive no invented shared experience.

### P2 — Shared storage still has inconsistent membership/ownership checks

`vh2-network-engine.js:58` (`busyPlan`) checks only `personId`, missing additional shared-plan members and peer-plan membership. Conversely `vh2-agency-engine.js:23` suppresses main invitations whenever *any* plan is active, even a private peer plan. `vh2-episodes-engine.js:8` likewise treats any overlapping plan as a main-character commitment. These contradict each other: some unrelated commitments block the main character while some real NPC commitments are ignored.

Fix: one participant-aware conflict predicate over canonical plans, used everywhere. Filter by membership and known participation status before making a plan affect a person's intentions.

### P2 — Location words can create unchosen drinking

`vh-simulation-core.js:1139` treats words including “bar”, “club” and “party” in location/activity text as alcohol context. At line 1210 that context directly raises intoxication at the configured intake rate. Being present does not establish choosing or consuming a drink.

Fix: only an explicit simulated consumption action should increase intoxication; venue context can make that action feasible or appealing. This matters before adding parties and private interactions because inferred intoxication changes inhibition without a recorded choice.

## Smallest coherent extension

1. **Repair the boundaries first.** Fix plan knowledge filtering, participant conflict checks, resident continuity and group-earned evidence. These are correctness repairs to existing authorities, not new features.
2. **Give canonical plans one participant lifecycle.** Extend existing records with initiator, proposed activity, optional end/window, participant response and arrival/departure intervals, and revision/counterproposal events. Permit partial attendance. Both primary-character goals and NPC decisions consume this record through adapters to their existing needs/route engines; never create a duplicate main-character actor.
3. **Connect invitations and remote contact.** NPC plans can offer an invitation to the main character; the main decision engine can accept, decline, counterpropose or join later. A call is a coordinated attention action with both participants' acceptance/availability, elapsed participation and remembered outcome. Dialogue remains expression of committed facts.
4. **Compose social occasions from existing activities.** A party, sports outing or dinner is an activity definition with host/venue/access/participants and optional preparation/closure. Actual participants create opportunities to talk, meet a resident, change companions or propose another destination. Follow-up travel and return-home/stay decisions use the existing route and activity authorities.
5. **Add non-graphic adult private interaction as an optional joint action.** Require established adulthood, current mutual willingness, actual co-location/privacy and the ability to decline or stop. Record a generic private outcome and relationship/needs consequences. Relationship styles should be explicit simulation policies rather than one universal exclusivity rule. Preference prose and generated media cannot commit the outcome.
6. **Extend current needs with health and grounded consumption.** Conditions should modify fatigue, comfort, obligations and care choices over time. Eating/drinking/resting must be actual actions with recorded effects. This fits the existing needs/decision structure.

## Verification performed and limits

Passed existing offline Node suites: `vh2_people_audit.js`, `vh2_plans_audit.js`, `vh2_agency_audit.js`, `vh2_population_audit.js`, `vh2_social_bonds_audit.js`, `vh2_group_network_audit.js`. Passed all three `vh2_population_service_audit.py` tests.

`vh2_network_multiweek_audit.js` passed eight 14-day, three-NPC simulations. Across seeds it recorded 111–122 encounters and 2–6 completed plans per run. This demonstrates bounded peer networking and variation under its configured shared-home/park fixture, not an organic city or the requested main-character social chain. Some other tests inject completed plans or mature friendships, so their passes cannot certify end-to-end emergence.

Additional read-only probes reproduced all three P1 defects above. No test in this audit established the complete Friday-night or football-outing scenario.

Before claiming that capability, add integrated seeded scenarios covering remote invitation, partial acceptance, actual travel, stranger continuity, individual early departure, companion/destination change, privacy of unseen events, pair-specific relationship evidence, and return/stay decisions. Assert physical and knowledge invariants plus variation across runs; do not assert that every seed must follow one authored story. Keep restart/replay and bulk-versus-minute equivalence checks.
