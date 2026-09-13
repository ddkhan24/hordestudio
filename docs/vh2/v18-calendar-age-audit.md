# Version 18 calendar and age audit

The original personal calendar intentionally generated editable birthday reminders without inferring birth years or changing authored ages. This protected character templates, but meant a person could pass birthdays indefinitely while their reported age remained fixed. Private-visit and romantic settings also contained separately confirmed ages, so incrementing every age field would either invalidate existing permissions or fabricate a new authorization.

## Implemented contract

The existing calendar owner now keeps bounded `vh2Calendar.ages` records in the active life. Each record identifies the birth date, provenance, original authored age, reference date, current age and local date of calculation. Authored character and supporting-person ages remain unchanged.

- A full birthday date (`YYYY-MM-DD`) establishes the date of birth. Explicitly authored fictional dates retain fictional provenance.
- An established, authored month/day plus an integer authored age may infer one mathematically consistent birth year. The year is anchored once and marked `inferred_birth_year`.
- A suggested fictional month/day, unknown age or inconsistent leap-day/age combination does not infer a year. The authored age remains the fallback.
- Only the main person and already-known supporting people are considered. Unknown population members do not receive invented birth dates.
- Full birthday dates are validated against the active life date and a supported age range of 0–130 years. Invalid or future birth dates cannot be saved as ordinary birthdays.

Local midnight participates in the existing simulation wake boundary. Main-person calculations use the calendar's current timezone; supporting people use their configured local timezone. February 29 celebrations may still be observed on February 28, while chronological age changes on March 1 in non-leap years. This conservative simulation convention does not claim to implement jurisdiction-specific legal age rules.

Derived age reaches dialogue identity, reference/image prompts and the existing adult eligibility checks. Previously confirmed adult permissions remain unchanged across a birthday. A changed birth date that indicates a person has not reached adulthood cannot be overridden by an older permission age. No birthday automatically grants consent, changes a relationship or publishes anything.

The AI person builder accepts an optional supplied date of birth and writes it into the existing personal calendar. It does not create another stored DOB field. The life builder preserves established full birth dates and is instructed not to calculate missing years itself. The calendar UI displays derived age and whether a birth year was inferred or came from a saved birth date.

## Ashlyn release overlay

[The prepared overlay](../../scripts/aslyn-v18-calendar.json) gives all ten existing birthday month/day entries explicit fictional birth years that match the declared ages on 2026-09-13. It preserves their dates, authored ages and fictional source. Every entry includes the requested note: “Authored release-template DOB based on existing birthday and age as of 2026-09-13; not a real-person fact.”

Preparing this file did not modify the bundled character or a live life. The release owner applies it after validation. Full portable lives preserve their calendar age records; clean templates keep their authored starting ages and explicit calendar dates without importing private lived history.

## Verification

- 18 calendar tests passed, covering birthday midnight, February 29, year boundaries, remote timezones, unknown people, hidden reminders, inconsistent dates, inference persistence, service restart and exact replay.
- 51 surrounding service tests passed across shared plans, relationships, media, references, builder setup and conversation quality.
- The age/builder JavaScript regression passed: authored ages remain unchanged, supplied DOB enters the calendar, invalid/future dates reject, and underage DOB evidence cannot be bypassed through stale adult permissions.
- The full engine gate passed: **85/85 suites**.
- `git diff --check` passed.

These checks validate calendar continuity and eligibility mechanics. They do not establish consciousness, biological aging, mortality, automatic life-stage development or universal human realism.
