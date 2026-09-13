# Canonical social participation — implementation and verification

The implementation extends `c.vh2Plans.plans`, the existing activity goals, participant actors and route engines. It does not add a parallel party, call or private-visit state store. Existing shared-plan APIs, IDs, past plans and ledger history remain usable.

## Delivered behavior

- Main and supporting characters can seek company from their social need and personality, send remote invitations, independently accept/refuse, or propose a reachable alternative. These are procedural decisions, not generated chat messages attributed to the user.
- Accepted participants reserve actual time in their own actor/activity runtime. A call uses the same plan with `modality:'call'`; each person stays at their own location. Busy actors can refuse or miss a window. Ordinary leisure can be reconsidered once when an accepted commitment needs attention.
- Remote contact windows use the recipient's actual local timezone. Calls check supporting-person obligations and main fixed commitments; actual sleep defers invitation decisions. Six explicit timezone, work and sleep cases cover this boundary in the participation audit.
- Informal home gatherings require the resident host. Hosts can forward invitations to established NPC friends the main character has not met. Unknown guests remain durable actors, travel normally, and can be introduced during actual shared social time. Merely labelling a room as a party does not create attendance.
- Noticed calendar events with established location and any required admission can become coordinated `event_outing` plans. The coordinated goal replaces the competing generic solo event goal. Actual started/completed events retain attendee and source identities for the existing media/appraisal pipeline.
- Additional guests can refuse without cancelling two willing participants. Attendance records and pairwise shared minutes distinguish invitations, real participation and departures. Every qualifying main-person pair earns its own relationship evidence; absent guests receive none. Group plans can continue after an individual leaves.
- Known adults can propose an ordinary private visit from personality defaults when private visits are enabled. Access requires the resident's participation, and both people decide individually. Per-person overrides can block visits or replace defaults. No manual whitelist is required for an ordinary visit with a newly introduced adult.
- A private follow-up creates a normal plan, uses actual route lead time, records participants leaving the original group, and travels to the host's home. Private time remains non-graphic. An intimate outcome additionally requires an explicit intimate-outcome option, separate current individual decisions, continued eligibility/privacy and completed participation. Early withdrawal cannot become a completed intimate outcome.
- Hosted/event/private outings create a normal return intention, which still requires a valid route and can yield to other needs. The integrated scenario verifies an actual completed return, not just existence of the intention.

## Ownership and privacy repairs

`vh2-plans-engine.js` exports common participant membership, conflict, departure and attendance helpers. Episode planning and peer-network conflicts now use participant membership. Unrelated peer plans no longer block the main character, and non-primary group members' real commitments are no longer overlooked.

`vh2_plans.visible_shared_plans` filters unrelated peer plans from expression context. A character who left sees their departure and own participation, not later private outcomes. Structured `observerIds` distinguish shared-world truth from what a participant can remember. Main-world memory, psychological appraisal and media consumers filter those observers. A person's own refusal remains observable even though they are not attending.

Shared attendance now requires the NPC's reserved plan action, including historical interval evidence. Being available beside someone while doing unrelated leisure is insufficient. Main activity progress and NPC presence intervals are integrated over service tick intervals, so five-minute service updates do not fabricate or undercount participation.

## Configuration contract

`configure_social_plans` accepts `policy` with:

```json
{
  "enabled": true,
  "remoteInvitations": true,
  "hostedEvents": true,
  "privateVisits": false,
  "invitationCooldownMinutes": 360,
  "socialNeedThreshold": 55,
  "maxGuests": 5,
  "privateVisitInterest": 35
}
```

`privateVisitPermissions` is an optional complete replacement list of per-person overrides: `{personId, personAge, enabled, selfWillingness, otherWillingness, allowIntimacy}`. Omitting a person's override restores personality defaults; sending `[]` clears all overrides. Recorded ages must agree; minors and unknown ages do not qualify. Family visits cannot enable intimate outcomes.

The state includes `privateVisitDefaults` explaining the effective ordinary-visit defaults. `privateVisits` does not itself permit intimate outcomes. The AI setup path uses the same policy validator; staged proposal merging belongs to the existing lifestyle setup contract.

Existing `propose_plan` remains supported. New optional fields are `modality`, `activityKind`, `hostId`, `initiatorId` and `parentPlanId`. New commands `respond_plan` and `leave_plan` affect the main character's participation; supporting people retain ownership of their responses. Missing end times receive a bounded consideration window, which does not force anyone to remain until its end.

## Verification

- `scratch/vh2_social_participation_audit.js` exercises actual kernel movement and activity execution: group participation, a refusing guest, individual departure, all-attendee bonds, reciprocal calls, adult/private gates, withdrawal, return-home execution, event outings and restart determinism. Twelve invitation seeds produce differing completed, declined, active and missed plans.
- Its connected party scenario succeeds at seed 9: an NPC hosts, invites an established friend unknown to the main character, the guest actually attends, the two are introduced, independently agree to private time, leave the original group, travel to the guest's home and complete a return-home action. Ordinary personality defaults suffice; no per-person whitelist is injected for the new contact. The outcome is `private_time`, not an assumed sexual encounter.
- `scratch/vh2_social_plan_service_audit.py` covers ten configuration, atomic validation, privacy, observer/memory, ownership, missing-end and restart/replay cases.
- `scratch/vh2_plans_service_audit.py` retains the original three service lifecycle/replay/restart cases.
- Existing plans, agency, social-bonds and group-network audits pass. Eight 14-day, three-NPC network simulations complete with varied encounter/plan counts. Their small synthetic world is a stress fixture, not evidence that every city or personality has been validated.

## Practical limits

This is still a bounded procedural simulation. Activity kinds, willingness rules, needs effects and consideration windows are authored engine mechanics. Participants do not have unrestricted human reasoning, and this work does not establish consciousness or clinical psychological realism.

Invitations, friend-forwarding and private follow-ups remain conditional; no seed is required to act out a fixed story. Named strangers require a durable resident/actor in the local world. Ordinary visits need adult ages and known homes; intimate outcomes require their additional option and current decisions. The party is an informal group activity, not a detailed crowd, ticketing or venue-capacity simulation. Calls establish elapsed reciprocal contact, not exact invented dialogue. Live provider rendering and production timeline activation are separate from these offline social-system tests.
