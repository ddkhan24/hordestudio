# Procedural life and social realism audit

Date: 2026-09-12. Scope: the current VH2 code and provider-free temporary-fixture tests. This audit did not change runtime code, restart a service, edit a live life, or submit paid media jobs.

## Finding

VH2 has a persistent spatial simulation with independently moving supporting people, constrained travel, needs, resources, small shared plans, and evidence-linked memory. It does **not yet execute the complete social-life scenarios described by the user**. The largest gaps are missing transitions between these existing capabilities: introducing a person does not necessarily make them a durable spatial actor; group experiences do not affect all attendees; loneliness does not lead to a remote invitation; and events do not become coordinated outings or hosted parties.

This calls for extending the existing participant, plan, activity, event, and memory paths. Another autonomous controller or schedule store would make the ownership problem worse.

“Organic” here should mean choices with alternatives, independent participation, physical consequences, learned preferences, and reproducible causes. The current tests establish some of these mechanics. They do not establish human psychological validity, general freedom, or consciousness.

## Scenario coverage

| User scenario | What executes now | Missing transition / verdict |
| --- | --- | --- |
| Friday: bored, Jordan suggests a party, they go, meet someone, choose a private visit, Jordan is left behind | Configured people travel independently; small plans have independent acceptance; public co-presence can introduce an authored resident; needs can interrupt an outing. | No complete party invitation/hosting/guest lifecycle, main joining a peer invitation, multi-stop group outing, adult private-visit agreement/access, or interpretation of leaving a friend behind. **Not an implemented end-to-end scenario.** |
| Saturday: football with friends, photos, social posts, return | Known calendar events can propose a visit to a saved reachable place; group meetings use actual co-presence; lived events can create photo opportunities and posts. | No shared game attendance session, group continuation/return plan, admission confirmation workflow, or event-specific group photography. These pieces are not a tested football-day chain. |
| Lonely at home: invite a friend somewhere | A high social need can propose calling a known person during contact hours. Existing encounters can trigger an invitation at the current place. | No loneliness-to-remote-invitation-to-shared-destination chain. The abstract call does not reserve and simulate a reciprocal supporting-person call session. |
| Meet someone and develop a new friendship | An authored resident may approach after sustained public co-presence. Configured people accrue repeated-meeting evidence; friendship changes over days. | Newly introduced people without an explicitly configured life become unplaced on the next kernel pass. Continuous generation of new residents is absent. |
| Throw a party | A small group plan can occupy a saved place. | No host, guest list, invitation rights, capacity, preparation/resources, admission, or guest arrival/departure lifecycle. A three-person meeting is not a house-party system. |
| Work out; swim because it is hot | Reachable exercise-capable places and local exercise proposals exist. Weather can influence wardrobe. | Pool metadata can produce a generic workout; no thermal discomfort/cooling motive or swimming-specific activity/access causes the choice. |

## Confirmed defects and high-priority gaps

### P1 — Introduction can create a contact without a continuing physical life

`vh2-population-engine.js:7` handles authored residents. A successful introduction creates a social-circle entry and, for a resident without an actor, a routine/temporary spatial entry. It does not materialize a `vh2People.actors` record with a home and starting position. `vh2_people.py:5` prepares known people but correctly refuses to invent missing placement. `vh2-kernel-worker.js:67` then clears positions for people without an actor.

This was reproduced using the real temporary-service fixture in `scratch/vh2_population_service_audit.py`, after its introduction path completed:

```json
{
  "introduced": "Sam",
  "actorExists": false,
  "setup": {
    "status": "needs_location",
    "reason": "Choose a home and starting place."
  },
  "spatialRecord": {
    "placeId": "",
    "availability": "unknown",
    "activity": "Life setup incomplete",
    "positionSource": "unplaced"
  }
}
```

The existing population tests pass because they verify introduction, privacy, validation, and persistence of the contact. They do not assert that the introduced person remains a moving actor. Residents explicitly configured through `configure_person_life` can already have a proper spatial life; the automatic promotion is the missing transition.

**Acceptance:** every resident eligible for a physical introduction must either already have a valid actor or be atomically materialized through an explicitly enabled fictional-population policy. After introduction, 48 hours of ticks and a restart must retain one stable person ID, actor, home, current position or journey, and reachable choices. No invented real-world resident or falsely verified address. If geography cannot support a life, report the missing world setup before presenting that resident as independently living.

### P1 — A completed group experience updates only the primary person's relationship

Shared plans store all participants in `plan.people`, but `vh2-social-bonds.js:34` processes a completed plan only when `plan.personId === person.id`. A direct module probe of one completed plan containing the main character, Jo, and Lee produced:

```json
{"sameCompletedGroupPlan":{"Jo":1,"Lee":0}}
```

Jo was the primary `personId`; Lee attended the same plan but received no meeting evidence. `vh2-plans-engine.js:12` also emits a singular person ID for the generic shared-plan event. This prevents coherent group friendship and consequences.

`vh2-network-engine.js:54` similarly checks conflicting plans by singular `personId`; membership-only participants and peer plans are not fully represented in that predicate. This second issue is a static finding and still needs a complete conflict regression case.

**Acceptance:** attendance intervals, departures, and outcomes belong to every actual participant. Process each eligible participant's experience exactly once, with independent appraisal. Do not give absent invitees meeting credit. No participant may accept overlapping required attendance merely because they are an extra group member. A late or early departure must preserve the shared minutes that actually happened.

### P1 — Social initiative is too narrow to produce the requested life

`vh2-agency-engine.js:22` creates a main-character invitation only from an existing encounter, at the current place, for a short future window. The main character does not independently select a friend and send a remote invitation because of loneliness or boredom.

`vh2-geography-engine.js:83` can propose a contact goal when a contact window is open. Completion in `vh-simulation-core.js` records an abstract call/conversation and lowers the main character's social need. It is not a reciprocal call session with the other actor's availability, attention, response, or memory. `vh2_calls.py` concerns the player-facing call path and does not fill that supporting-person gap.

Peer plans in `vh2-network-engine.js` are real, independently accepted, and spatially attended, but primarily cover pairs and a possible mutually familiar third member. The main character can observe a peer meeting without autonomously joining a peer invitation.

**Acceptance:** loneliness may propose a call, invitation, solo activity, or no contact, using known relationships and current constraints. A contacted person can accept, decline, suggest another time/place, or fail to respond. Accepted plans travel through the same plan store and actor movement authority. A failed attempt creates a truthful explanation and another feasible choice, not indefinite idle time or fabricated contact.

### P1 — Events and private social choices lack executable activity contracts

`vh2_feeds.py`, `vh2_ticketmaster.py`, and `vh2_calendar.py` provide observed event facts. `vh2-geography-engine.js` can turn a known, near-future calendar item at a saved reachable place into a generic visit, normally at most 30 minutes. An event listing is not attendance, ticket ownership, or a coordinated outing. Venue mappings remain necessary; source data does not itself create a valid visited location or admission.

There is no party host/guest/resource/capacity lifecycle in these paths. `vh2-episodes-engine.js` supports authored multi-stop travel opportunities with constraints and a return, but does not generate a local party or coordinate the proposed social chain.

`vh2-relationship-lifecycle.js` supports gradual friendship, dating, partnership, and strain. Its explicit adult romantic policy is not a private-visit agreement. No action records a mutually chosen adult private visit, permission to enter, withdrawal, an exit route, or a friend's interpretation of being left behind. Attraction, relationship labels, biography, and appearance must not silently stand in for those choices. The requested non-graphic private-visit scenario can be simulated through independent decisions and consequences without narrating explicit sexual content.

**Acceptance:** represent an event instance, host where applicable, venue access, participants, invitations, actual attendance, and member exits in the existing plan/activity model. Private entry requires recorded permission; either participant may change their mind and leave. Missing age/adult status cannot be inferred from a description. Friendship consequences use what someone observed or was told, and distinguish an explained departure from an assumed rejection.

## Existing systems worth preserving

### One movement authority, actual routes, and resources

`vh2-people-engine.js` gives configured people independent needs and actions. Saved routes, travel time, mobility ownership, budget, and obligations constrain movement; people are not simultaneously present at origin and destination. A vehicle stays where it was left. Income depends on actual attendance at a paid obligation. Early departure and interruption exist. The main geographic path similarly routes to food before eating and charges once.

The actor action vocabulary remains small: rest, sleep, eat, leisure, obligation, meeting, and peer meeting. Supporting people have less detailed needs/resources than the main character and no equivalent explicit loneliness variable. More types of meaningful activity and reciprocal interactions are needed, but should reuse these constraints.

`vh2-kernel-worker.js` is the canonical ordering point. `vh2-network-engine.js:7` already migrates old network plans into `vh2Plans.plans` and deletes the separate store. Keep that ownership model. Do not restore legacy browser agency as a second simulation writer.

### Evidence-linked memory, with limited interpretation

`vh2-psychology-engine.js` records actual completed/interrupted experiences and derives bounded place preferences from recent evidence. Participant-private memories stay private. The main character's recall in `vh2_runtime.py` is bounded lexical/place retrieval; it is not a general associative social memory system. Current reflections mostly summarize place-linked numeric outcomes, not a reasoned understanding of group intentions, apologies, changed expectations, or conflicted loyalties.

`vh2_social.py:99` records the character noticing their own published posts and player reactions/comments, with provenance. Unseen notifications do not instantly become knowledge. Starter history does not falsely become shared player experience. This is a useful foundation for active social awareness.

Supporting-person feed awareness and reciprocal comments are not comparably integrated. `app.js` contains a legacy `planCompanionSupportingPeople` path for NPC messages/comments, but the VH2 branch of `processCompanionAgency` exits to `vh2Poll` before reaching it. Its existence is not evidence that VH2 is executing it. Port needed semantics into canonical VH2 events rather than enabling that old writer.

### Media materializes a recorded moment; it should not drive reality

`vh2_agency.py` freezes a capture context in the same life transaction; delayed rendering should preserve the original place, people, clothing, and references. `vh2-agency-engine.js` derives opportunities from recorded arrivals, encounters, and completed activities/plans. `vh2_social_worker.py` writes or skips posts from source events and recorded captures.

The current autonomous capture template is always a front-camera selfie (`vh2-agency-engine.js:46`). It does not choose a group photo, view of a match, environmental image, or photo taken by a friend. Those require typed capture opportunities that preserve who was there, who took the picture, and which approved references were available.

`vh2_clips.py:26` creates an author render request without a fake player message. It tracks model/settings, scene place/zone, jobs, and later reference manifests. A direct recorded-event-to-optional-video opportunity with the same immutable truth contract was not established by this audit. Full browser-closure durability for all video providers was not tested here. Do not treat a generated image/video as proof that the depicted action occurred in the simulation.

## Recommended implementation order within the existing runtime

1. **Complete actor materialization and group bookkeeping.** Fix introduced residents becoming unplaced, membership-aware conflict checks, and attendance-based experience for every participant. These are correctness prerequisites.
2. **Add reciprocal social proposals to existing plans.** One proposal carries initiator, participants, purpose, known place, proposed window, resources/access, source evidence, and decision reason. Use per-person responses, attendance intervals, and exits. Support remote calls, invitations, and peer-to-main offers through this path.
3. **Add activity and event definitions.** A workout, swimming session, public game, gathering, hosted party, or adult private visit supplies preconditions, costs, capacity/access, needs effects, interruption rules, and possible continuation. It proposes existing actions; it does not own a new clock, location, or schedule.
4. **Introduce procedural world seeding with explicit provenance.** Extend builder-authored `places`, `peopleLives`, routes, rooms, and references into a bounded regional fictional-population/event policy. Keep verified map facts separate from invented residents, interiors, and social occasions. Materialize a stable actor when background population enters the simulation's causal scope. Reuse shared geographic data across characters.
5. **Feed outcomes into each participant's memory.** Use observed attendance, conversations, departures, explanations, and reactions. Preserve different beliefs and incomplete knowledge. Apply source-linked reflection to future choice without turning every negative outcome into rejection or every warm interaction into romance.
6. **Add diverse optional media opportunities.** Freeze the lived event first. The character may choose to capture/share; automatic or manually funded rendering later fills that opportunity. Provider success/failure changes the media record, not the physical life, attendance, or consent history.

## Priority acceptance and stress tests

These are proposed tests, not claims of implemented coverage. Use the real `WorldService` command/tick path and one shared kernel, with temporary storage, deterministic seeds, and fake text/media providers.

### Release-blocking correctness cases

| Priority | Fixture | Required assertion |
| --- | --- | --- |
| P0 | Introduce an eligible previously unknown resident; tick 48 hours; restart | One stable actor survives, with valid home/current location or journey; no unplaced introduced contact. |
| P0 | Three-person plan; one declines, one arrives late, one leaves early | Per-person response and attendance are truthful; outcomes/memories occur once for actual attendees; no credit for an absent invitee. |
| P0 | The same actor is an extra member of one plan and invited to another | No overlapping committed attendance, including peer/shared plan combinations. |
| P0 | Travel, restart midway, arrival, purchase, action completion, duplicate command | No teleportation, duplicate vehicle, duplicate spending, duplicate completion, or lost action. |
| P0 | Private visit proposed; decline, withdraw, absent permission, unknown age | No private-entry/consent fact invented; independent exit remains possible; biography or a render prompt cannot override it. |
| P0 | Group event completes while browser/provider is offline | Life advances; a recorded media opportunity retains immutable source/participant/reference provenance; later import cannot rewrite attendance. |

### Multi-day scenario tests

Run 32–64 seeds over 14–28 days in shared worlds of 8–24 actors, with routes, homes, workplaces, food, leisure, and enabled policies. Include restarts and coarse-versus-fine tick batching. Test at least:

- Friday gathering: invitation, independent RSVP, travel, public introduction, optional continuation, friend departure, truthful later recall. The private-visit branch is optional and must include declines and withdrawals across controlled willingness fixtures.
- Saturday game: event observed, admission known/unknown, friends accept/decline, travel, actual attendance, optional group image/post, leaving early, and a later next destination or return. A listed event alone must never create attendance history.
- Loneliness at home: known person reachable/unreachable, contact accepted/declined, call/outing/solo alternative, needs and obligations changing during the attempt.
- New friendship: repeated encounters across days, divergent individual impressions, contact exchange, missed meeting with and without an explanation, memory-supported later choice.
- Host a gathering: insufficient money/food/capacity, guest permission, overlapping plans, host cancellation, guest arrival and staggered departure.
- Heat and activity: hot versus mild weather with the same seed and available pool/gym/café; cooling/swimming only if supported by known access and actor capability; fatigue, thirst, price, and opening hours can change the choice.

Do not assert that every seed must follow the desired story. Assert that feasible branches are reachable, refusals and alternatives remain possible, and the recorded reason matches the branch. No numerical success rate should be advertised as evidence of psychological realism.

### Invariants and useful measurements

Zero tolerance: simultaneous incompatible presence; arrival before route time; actions at inaccessible places; negative spendable funds without an explicit debt model; duplicate people/plan authorities; group attendance without presence; memories of unseen private events; unsupported consent/admission; repeated side effects after replay; media completion rewriting world truth.

Measure introduction-to-actor conversion, time with no feasible action versus unexplained idle time, starvation of urgent needs, repeated failed goals, reachable alternative counts, plan completion/decline/miss/departure distribution, per-member relationship updates, encounter-to-friendship progression, route distance/time, invitation response latency, memory provenance completeness, bounded log/storage growth, and text/media budget use.

Compare saved checkpoints and continuation hashes for fine ticks, batched ticks, and restart. Retain seed, preconditions, candidate choices, rejection reasons, source event IDs, and resource deltas for every failing trace. Separate behavioral plausibility review by humans from mechanical pass/fail assertions.

## Cost-conscious use of AI

Keep minute-by-minute needs, routes, resources, feasibility, and attendance deterministic and provider-free. Use text generation at meaningful decision boundaries: initial fictional-world seeding, proposing a small number of social options, an actual conversation, or interpreting a bounded bundle of recent experiences. Validate proposals against canonical world facts before committing them.

Use one bounded interaction proposal rather than separate unbounded chats for every participant every tick; each participant still gets an independent decision constrained by their own state. Cache reusable place descriptions and regional data. Reflect once per meaningful batch/day, with source IDs and a short memory budget. Model unavailability should postpone expressive detail, not stop physical life or fabricate an interaction.

Keep automatic image/video spending separate from physical simulation and text reasoning. Manual rendering is an explicit funded action, not a reason to reopen autonomous budgets or re-run old life events. Reuse frozen references and successful outputs; a failed provider job must not cause another unbounded purchase loop.

## Verification performed in this audit

| Executed command / probe | Result | Practical limit |
| --- | --- | --- |
| `runtime/darwin-arm64/node scratch/vh2_network_multiweek_audit.js` | PASS: 8 seeds × 14 days; 3 configured actors; 111–122 encounters and 2–6 completed peer plans per seed. | A small authored graph; not campus-scale party realism. |
| `runtime/darwin-arm64/node scratch/vh2_multiweek_acceptance.js` | PASS: 24 supporting-person runs × 28 days; needs, work, routes/resources, choice variation, restart. | Does not cover the requested complete social scenarios. |
| `runtime/darwin-arm64/node scratch/vh2_group_network_audit.js` | PASS: directional NPC appraisal, three-person plans, travel, missed meetings, observation boundaries, batching. | Does not catch primary-only main/group relationship updates. |
| `runtime/darwin-arm64/node scratch/vh2_geography_audit.js` | PASS: food travel, charge once, eat after arrival, remain at destination, exclude closed/unaffordable/unknown choices, soft schedules, restart. | Contact/exercise proposals do not prove reciprocal calls or heat-driven swimming. |
| `python3 scratch/vh2_social_awareness_audit.py` with temporary bytecode cache | PASS: 10 tests, including retained/noticed social reactions, comments, deduplication, persistence. | Primarily main-character/player social awareness. |
| `python3 scratch/vh2_population_service_audit.py` with temporary bytecode cache | PASS: 3 tests for resident validation, privacy, introduction persistence. | Follow-up probe exposes the missing spatial actor. |
| Temporary-service introduction follow-up probe | Confirmed introduced contact has no actor and becomes unplaced. | Reproduces the ordinary unconfigured resident path, not explicitly configured residents. |
| Direct completed-group social-bonds probe | Confirmed primary Jo gets one meeting; extra attendee Lee gets zero. | Small deterministic integration probe; needs a permanent full-service regression. |

The green mechanical tests are useful. The two reproduced gaps and the missing scenario transitions explain why those tests can pass while the user's lived experience remains incomplete.

## Implementation follow-up (same-day changes, pending live activation)

The population/spatial owner has now implemented durable actor creation from explicit or authorized fictional residences, stable seeded adult residents, real overlap introductions including actual hosted-event attendance, private-home access guards, home exercise, accessible pool travel/payment/cooling, and local clocks for remote actors. Main/NPC calls and group choices use the canonical plan integration implemented by the architecture owner.

Verification: the new `scratch/vh2_spatial_opportunities_service_audit.py` covers 12 service/replay cases. Eleven behavior cases passed together in an 81.5-second stable-source run; the remaining timezone case required a fixture setup correction to use `configure_place_context`, then passed separately. Coverage includes 48-hour persistence after introduction, a 24-hour four-resident run, zero fake timetable presence, actor identity merges, main/NPC workouts and swimming, entry payment and cooling, inaccessible/unaffordable/closed pools, private homes, actor-local sleep/day ledger, invalid-zone rollback, and restarts. Existing independent-person 24 × 28-day and peer-network 8 × 14-day stress suites passed earlier in the implementation; mechanical route/batching tests remain green after the local-clock change.

The obsolete exploration test was retargeted to the single canonical planner, retaining meaningful variation and physical-event assertions: 100 seeds produced three choices, 57 noticed source items, zero mild-weather swims and 97 hot-weather swims. It also checks unseen/cancelled events, shared event ownership, destination-local opening hours, open-ended event departures, return travel, commitments, and on-site need relief. The updated population test retains 100 paired personality seeds: 61 outgoing versus 15 guarded introductions.

These changes make additional branches executable. They do not retroactively configure every live person's home, verify private addresses, invent wages or possessions, or prove psychological realism. The separate read-only Aslyn world proposal identifies missing setup and inconsistent existing coordinates for the main agent to review before applying.
