# Believable human life: assessment and implementation target

12 September 2026. This is the **pre-implementation baseline**, retained to explain the findings and intended scope. The later [implementation and verification report](realism-delivery-20260912.md) records what was delivered and its remaining limits. This assessment combines independent architecture, procedural simulation and UX audits with direct inspection of emotions/chat; it is not psychological validation.

## Verdict

The requested scenarios are feasible targets for this engine, but current VH does not execute them reliably end to end. Persistent needs, locations, routes, decisions, social bonds, memory, media capture and chat already provide foundations. The missing work is causal integration: people independently proposing, accepting, revising and remembering shared activities. Adding narration or another simulation runtime would conceal the problem.

There is no defensible promise of being indistinguishable from real people. The target should be long-term behavioral consistency, convincing variation, observable consequences and measured limits. All simulators contain programmed rules. Emergence means those rules combine to produce outcomes that were not individually scripted.

## Scenario coverage

| Scenario | Current evidence | Required extension |
|---|---|---|
| Bored Friday -> Jordan invites -> party -> new person -> private visit | Needs, small peer plans, introductions and routes exist separately. Peer invitations exclude the main character; the full chain is absent. | Main-inclusive invitations, persistent social events, individual participation and departure, durable new people, mutually accepted adult private visits. |
| Football with friends, photographs, posts, home | Event feeds, attendance candidates, photos and posts exist with prerequisites. A listing does not establish attendance. | Group arrival/individual participation, recorded moments, per-person memories/bonds, independent departure and journey home. Treat ASU/UCLA as a hypothetical fixture unless a real fixture is verified. |
| Lonely -> invite someone over | Invitations after an encounter exist; a general remote invitation driven by loneliness is not established. | Social intention selects whom and why; communication reaches that person; they choose accept/refuse/counter using their own circumstances and access. Loneliness is not automatic attraction or consent. |
| Make new friends | Introductions to authored residents and earned peer friendship exist. | Introduced contacts must become durable spatial participants with usable residences/knowledge and future availability. Do not respawn them as strangers. |
| Host a house party | No complete event-hosting lifecycle found. | Host/home permission, invitations, capacity, preparation, arrivals, activities, noise/household effects, departures and cleanup in the existing plan/event model. |
| Work out at home | A generic exercise candidate exists. | Preferences, equipment, duration and fatigue effects; optional routines rather than required calendar blocks. |
| Swim because it is hot | Pools can map to generic exercise/leisure; weather influences some choices. | Swimming-specific opportunity, temperature relevance, opening/access, swimwear, travel and actual activity outcomes. |
| Become ill | Fatigue and sleep are represented; a persistent illness lifecycle was not found. | Bounded fictional illness episodes with onset, symptoms, duration, recovery and interrupted obligations. Avoid unsupported diagnostic or medical claims. |

## Confirmed regressions to repair first

1. Private peer plans are serialized into `sharedPlans` in `vh2_runtime.py:expression_context` even when `observedPeerMeetings` is empty. Character knowledge must be filtered by participation or an actual communication/observation.
2. A completed main-character group plan credits only the primary invitee's bond; other attendees do not receive equivalent participation evidence.
3. An introduced resident can become a known contact but lose spatial placement on subsequent ticks because independent home/life setup was not established.
4. The peer-plan inspector reads the obsolete network plan array although canonical plans moved to `vh2Plans.plans`. The advanced exploration panel also contains outdated expectations/projections.
5. The AI world builder omits important social/population policies, leaving executable participation behind advanced manual controls.
6. Some plan eligibility checks treat unrelated peer plans as blockers for the main person, while non-primary participants can be missed by commitment checks. These checks must use the actual participant set.

Existing test suites passing does not invalidate these findings: independent probes exposed gaps between modules that individual tests do not cover. The architecture auditor ran seven Node suites and three population service tests, including eight 14-day NPC runs. Those runs produced 2–6 completed peer plans each, but no peer invitations involving the main character.

## One causal architecture

Retain the existing event log, canonical world state, actor IDs, routes, plans, activity candidates and media workers. Extend them rather than creating parallel engines.

1. **Physical constraints:** place/room, time, transport, access, possessions, money, fatigue and capacity determine feasible actions.
2. **Personal perspective:** each actor receives only what they observed, were told or inferred. The author's inspector may see world truth; chat must not.
3. **Motives:** unmet needs, preferences, relationships, obligations, habit, curiosity and remembered experiences influence candidate choices. Rest or declining an invitation remain legitimate.
4. **Social intentions:** an invitation or proposal becomes a persisted interaction. Each participant responds independently. Attendance is not teleportation and acceptance is not completion.
5. **Flexible plans:** track invited/accepted/en-route/present/left for each participant. Someone may split from a group, change destination, cancel, or stay longer. Changes produce observable consequences for those affected.
6. **Appraisal and memory:** compare what happened with expectations and personal goals. Save the event separately from each person's interpretation; let later information revise that interpretation.
7. **Expression:** chat, calls, social posts and images use the same lived record. A generated image does not establish an event, relationship or location by itself.

Procedural generation should create opportunities and persistent people with constraints, not schedule mandatory drama. Public listings, informal invitations, hosted events, neighborhood activities and ordinary household opportunities should all enter the existing candidate system with clear provenance. Generation is lazy: establish background entities as needed, persist them, and give them realistic knowledge/access. Use a cheaper background approximation for distant people and detailed simulation when they matter, while preserving state continuity.

Use LLMs for ambiguous interpretation, novel proposals and speech. Use deterministic execution for time, movement, resources, eligibility and irreversible state changes. Persist accepted LLM proposals so replay never calls the model to invent a different past. Render media separately from life progression so a generation failure cannot freeze a person.

## Emotional realism and chat

The current code has eight emotion dimensions, felt/expressed/toward-player vectors, mood valence/arousal/dominance, delayed reactions, differing decay rates, regulation/rumination settings, need changes, bounded conversational appraisals and relationship evidence. These are useful ingredients, not a validated human mind. Current experience learning mostly scores physical/action outcomes; reflection largely aggregates place preferences.

Extend appraisal around goal relevance, expected versus actual outcome, responsibility, perceived control, relationship history and uncertainty. Emotional change should affect attention, action selection, disclosure and memory, not merely phrasing. Preserve distinctions: friendliness is not trust; loneliness is not sexual interest; attraction is not consent. Personal interpretations can be mistaken and later corrected. Do not hard-code guilt, jealousy or regret as inevitable outcomes.

Chat already receives needs, emotions, relationships, experiences, own posts and noticed reactions. It should remain an expression of the same actor. Conversational proposals must enter validated commands, not directly rewrite the world through prose. If asked about last night, the answer should reflect what happened, what she remembers and what she wants to disclose; if she is in transit, tired or occupied, reply timing and content should reflect that. Unknown private information must stay unknown.

## UI and AI setup

Keep Life, Relationships and Social directly reachable. One autonomy sheet should expose capabilities and missing prerequisites instead of overlapping switches. The Life view shows current place, activity and known company. Relationships shows recent consequential interactions with an expandable author-only evidence view. Media progress belongs to media controls, never fabricated chat messages.

An AI world draft should establish core relationships, recurring people, residences, accessible venues, interests, relevant household facilities and ordinary commitments together. Only ask users for consequential preferences or unresolved facts. Treat fictional geography/access assumptions as authored simulation data. Exact routes or real event dates still need actual evidence.

## Delivery and verification order

1. Repair the confirmed integration defects, with boundary tests.
2. Build a Friday-night vertical slice using existing plans: independent invitation, travel, event attendance, acquaintance, optional plan split, private visit or refusal, separate journeys home, per-person memory and next-day chat.
3. Generalize event hosting, informal opportunities and durable population expansion. Add football/outing/media integration tests.
4. Expand appraisal, health episodes and circumstance-specific home activities. Evaluate across different personalities and resources.
5. Consolidate UI and builder coverage around verified capabilities.

Validation must include many seeds and multi-day traces, not a script that forces a successful party. Test plausible branches: stay home, invitation declined, insufficient money, friend goes separately, leave early, illness, no phone access and provider outage. Require no teleportation, duplicate actors, private-knowledge leaks, free resources, duplicated media, or forgotten attendance. Verify restart/replay equivalence and immutable media captures.

Measure behavioral diversity, repetition, goal completion/interruption, relationship change provenance, perceived realism, chat contradictions and memory accuracy. Use blinded human review for believability. Do not call invariant tests proof of human psychology.

## Wardrobe correction delivered separately

Restored Aslyn's original mixed-garment mode. Missing colors on procedural clothing are assigned once at an actual outfit change from a detected positive palette clause, with a varied fallback if none is established. Explicit colors, authored/purchased garments and reference-backed clothing remain unchanged. Names persist with the garment and a source mapping prevents duplicate generation. The LLM wardrobe builder is instructed to specify colors; no extra LLM request is required for the local fallback. Tests cover stability, variety, references, duplication and replay. Ten lifestyle service tests, twelve image-prompt tests and the connected-world/reload audits passed, alongside dedicated color tests. Existing photographs retain their frozen outfit.

## Research grounding

- [Generative Agents, Park et al. (2023)](https://arxiv.org/abs/2304.03442): memory, retrieval and reflection supported more believable behavior in the authors' sandbox, including invitation diffusion. This is evidence for an architecture, not proof of indistinguishability.
- [Concordia, Google DeepMind](https://github.com/google-deepmind/concordia): agents propose actions while an environment adjudicates outcomes. Borrow the separation, keeping our canonical execution system.
- [Humanoid Agents, Wang et al. (2023)](https://arxiv.org/abs/2310.05418): combines basic needs, emotion and relationship closeness to influence activity and dialogue.
- [EMA, Marsella and Gratch (2009)](https://ict.usc.edu/pubs/EMA-%20A%20process%20model%20of%20appraisal%20dynamics.pdf): appraisal operates on the agent's interpretation of its relationship to the environment, with changing interpretation producing emotional dynamics. This informs a proposed design, not validated numeric parameters for our engine.

Independent reports: [Architecture](social-simulation-audit-20260912.md), [Procedural simulation](procedural-realism-audit-20260912.md), [UX](realism-ux-audit-20260912.md).
