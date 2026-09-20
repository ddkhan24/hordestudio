# Virtual Human complex-character end-to-end verification

**Date:** 20 September 2026
**Verdict:** **Passed.** The repaired creation path and persistent simulation completed the full complex-character scenario with no failed checks or unresolved findings.

## Final result

- **33/33 checks passed**; 0 findings and 0 critical findings.
- 28,800 deterministic five-minute ticks across 100 simulated days.
- Zero billed provider calls; dialogue used a local deterministic fixture.
- No existing user character or save was modified.

The test deliberately restored the two inputs that had exposed creation-order defects: spontaneous goal travel was enabled and the new life received a $720 starting balance while using a VH-first opening.

## Character under test

“Mara Vale” is an intentionally difficult fixture rather than a normal-person happy path:

- adult, 29, with a VH-first opening;
- five body/access modules: manual wheelchair, lower-body paralysis, chronic pain, Deaf/signing communication and an adapted vehicle;
- IQ anchor 145 with uneven social inference and executive function;
- possessive fixation, stalking, volatile attachment, compulsive checking, compulsive pornography use and an adult honorific cue;
- seven places, three independently simulated supporting people, ten optional activities, schedules, travel, finances, health, psychology, relationship and story policies;
- a deliberately impossible stair-running option and inaccessible walking-route conflict.

Identity, body/access, cognition, mind, adult settings and opener were authored through the real creator UI, saved, reloaded and transferred into the persistent service.

## Verified repairs

- Creation remains paused until reviewed setup is committed, so the character cannot begin travelling during setup.
- The authored opening is inserted after starting resources, exactly once.
- A shared 64-field transfer contract preserves embodiment, cognition, mind and adult-desire settings.
- Hard body/access feasibility removes impossible actions and travel modes from the choice set.
- Urgent sleep and food pre-empt optional actions.
- Optional outings retain an affordable route home; essential food/sleep travel can use explicit recorded debt rather than teleporting or silently starving.
- Supporting people can eat at home and record essential-meal debt when necessary.
- Completed contact activities update directional social-bond experience.
- Unpaid expenses are visible, manually payable and receive a creator-tunable share of new income (25% by default); repayments are recorded in the ledger.

## 100-day evidence

- 757.6 total sleep hours (about 7.6 hours/day).
- 0 hours of continuous critical hunger.
- 0 selections of the impossible stair-running activity.
- Five mechanical pressure effects observed: suspicion, jealousy, fixation, arousal and compulsion.
- Four distinct places visited.
- 2,268 completed activities and 8,942 recorded decisions.
- 32,426 supporting-person events and 60 social-bond events.
- 193 retained debt-repayment ledger entries at the end of the run.
- All numerical, position and deterministic-replay invariants passed.
- All bounded collections stayed at or below their caps.

The fixture still ends with unpaid expenses because its authored spending and attendance produce an insolvent life. That is now an explicit simulated outcome with survival safeguards, UI visibility, manual settlement and automatic income-based repayment—not an engine dead end.

## Artifacts

- `results.json` — machine-readable checks, findings, daily summaries and final state.
- `persistent-chat.png` — browser evidence for VH-first contact and the persistent reply.
- `scratch/vh_complex_100_day_e2e_audit.js` — reproducible, destructive-fixture-only audit harness.
