# v18 conversation audit

The existing VH2 expression queue, attention engine and persona conversations remain the owners of conversation. This change does not introduce another chat engine or autonomous writer.

## Gaps corrected

- **Text rhythm was not executable.** Aslyn's authored voice requested short bursts, but the worker accepted one string only. A structured `reply` may now be one string or 1–4 nonempty strings. Each part becomes a real message in the same persona inbox, committed atomically from one provider job. Ordinary single-string providers remain compatible. Appraisals run once, and retries cannot duplicate delivery. A phone call remains one spoken turn.
- **Basic remembered facts expired with the inbox window.** Attention rebuilt and discarded all learned player facts on every evaluation. Existing persona-scoped facts now remain when their source moves beyond the active 200-message window. Newly perceived claims replace the same fact key, including multiple corrections with identical timestamps. Clear messages keeps this relationship memory; reset clears it.
- **Older transcript content was unreachable.** Dialogue retrieval searched only the active inbox although the durable transcript still existed. The existing transcript now supplies bounded exact quoted matches and adjacent turns, including a following correction. Search respects persona, read/delivery state, cleared history, accents and case. It creates no new memory database or model calls.
- **Turn timing and body state were missing from expression.** Dialogue now retains recorded timestamps/channel metadata, the gap preceding the pending batch, sleep stage and factors such as fatigue or divided attention. These are circumstances, not affection scores. The local calendar already supplies local time; the prompt explains how to distinguish a return later from an ongoing exchange. Timing is anchored to events so ordinary provider latency does not continuously supersede a reply.
- **Reset could break the next attention tick.** Communication now initializes a cleared continuity runtime before reading its facts.
- **Style instructions overprescribed errors.** Aslyn's template preserves her lowercase, warm, spacey and usually brief voice, but removes compulsory wrong-message responses, fixed bubble counts, constant topic pivots and empty filler. Examples explicitly demonstrate phrasing and do not establish current events. The reusable bundle overlay is `scripts/aslyn-v18-conversation.json`.

## Verification

Provider-free service scenarios exercise the actual queue, SQLite event writer, transcript and restart/replay path. The targeted regression group passed 61 tests; two additional persona/unicode scenarios brought the new texting suite to 11 passing tests. Logs: `/private/tmp/v18-conversation-full.log` and `/private/tmp/v18-texting-audit.log`.

The new suite covers bounded optional bursts, malformed-burst atomic rejection, one appraisal per provider result, original-recipient routing, one spoken call turn, re-entry timing/body context, remembered facts after 200-message compaction, same-time corrections, clear versus reset, exact older quotations, unread/draft/contact isolation, Unicode lookup and template-to-provider style wiring. It is registered in `scripts/check-vh2.py`.

## Practical limits

These are deterministic mechanics and provenance tests, not certification that every language model sounds human. Recall is bounded lexical retrieval, not unrestricted semantic memory. Basic durable facts cover the existing conservative first-person rules; ambiguous claims remain exact conversational evidence. Text bursts are delivered together from one approved response; they do not fabricate typing delays or run a second autonomous dialogue. The simulation can support the perception of a person with continuity and an independent life; this work makes no claim of subjective consciousness.

After explicit user approval, a bounded live check used the refined Aslyn template with an isolated synthetic player and life. Exactly four calls to the user's configured `google/gemma-4-31b-it` provider were made, each capped at 1,200 output tokens, with no retries. The model correctly recalled York as the player's origin and Leeds as the place of study, described the fixture's reading-on-the-couch activity at home rather than accepting a suggested campus location, and closed with “gnnn 💕” without a forced question. All four outputs delivered and the resulting synthetic life replayed exactly. A manual semantic review is recorded in `scratch/v18-release-results/live-conversation.json`.

The live model used single-string replies, including one with paragraph breaks; optional actual bubble arrays were verified by the offline tests. The initial automatic approval rejection is retained in a separate receipt, and execution occurred only after the user explicitly approved all four requests. No production transcript was sent, no live character data or provider configuration changed, and no server was restarted by this audit.

## Household continuity follow-up

The current-life compatibility path omitted `socialWorld` even though the template contained it. It is now part of the existing bounded profile contract and dialogue identity, with starting-background provenance and precedence for later recorded changes. The isolated texting suite now includes 13 tests, including persistence, no mutation of the body or relationships, rejection of malformed background text, new-profile carry-through and superseding a stale unsubmitted reply after a household edit.

The three-private-bedroom location correction is reproducible through `scripts/aslyn-v18-location-overlay.json` and its narrow helper. Four overlay tests exercise identity/geometry/media preservation, idempotence, exact-review rejection and the real atomic service command/replay. Thirteen coordinate and ten lifestyle tests cover the corrected physical endpoint guard, including main-character and supporting-person travel. Clearing an inaccurate provider Place ID at unchanged known coordinates preserves valid routes and weather; unknown or changed endpoints retain safe invalidation. No production command was executed by this follow-up. These deterministic tests do not extend the prior live-model sample into an overall realism certification.

## Authored character fields and contact provenance

The remaining `privateLife`, `routine`, `playerKnowledge`, `initialMotive`, `connectionAuthenticity` and `startingScenario` fields were meaningful authored data lost by the active-life profile contract. They are now carried through the existing shared create-profile contract and expression-save path. The same text limits apply on creation and edit (2,000 characters each for private life/routine; 1,800 for prior player knowledge; 1,600 for initial motive; 3,000 for opening scenario). Authenticity accepts the five existing editor choices.

Dialogue receives private life and routine in a separate authored-background object: unspoken worries and boundaries are not automatic disclosure, and routine is not a replacement schedule. This includes Aslyn's existing academic-warning concern without inventing a new warning event. The daily life adviser receives the same private-life, routine and household context as authored evidence, subordinate to current recorded changes.

Initial motive, authenticity, prior player knowledge and opening scenario are contact-scoped using the existing canonical-life conversation views. A second persona receives its own fields, not another contact's flirting premise or prior knowledge. Opening setup is first-exchange context until a reply is delivered, then past setup; a clear/reset generation cannot make it happen again. No authored opening is promoted into a fabricated completed event. Generic wording about a visible Instagram profile does not supply unseen photos, follower counts or post contents.

`scratch/vh2_authored_context_audit.py` exercises creation/edit bounds, persona isolation, first-opening lifecycle, stale reply invalidation, preservation of body/history/relationships, and private concern availability in the adviser without creating new events. All checks use isolated temporary worlds and provider fixtures; there were no additional live LLM calls.
