# Shared calendar and daily life

Implemented and checked on 12 September 2026. This extends the existing canonical life, activity, plan and event owners. It does not establish consciousness or psychological equivalence.

## Personal calendar

The Calendar button sits beside Life settings in the active life. It opens a month view with a day agenda and upcoming dates. Personal dates, recurring commitments, authored term breaks and available public iCalendar listings share this view. The calendar uses the character's current local date, including their travel timezone.

Birthdays, anniversaries, milestones, holidays and other important dates can be added or edited, repeated yearly or saved once, given notes and a reminder lead time. Ordinary entries can be deleted. Birthdays can be hidden and restored without generating a replacement date. Changes use the existing atomic life-proposal command and reject stale concurrent edits while retaining the user's draft.

The AI builder accepts and reviews personalCalendar alongside the rest of the character's life. Supplied dates are preserved. Missing fictional birthdays receive persistent, editable month-and-day assumptions, explicitly labelled as suggested. Birth years, ages, relatives, marriages and anniversary histories are not inferred from these dates. Known supporting people receive birthdays; unintroduced residents' private information is not exposed. New known people receive their own stable date when added to the canonical social circle.

Whole-person creation checks every supported executable setup section, including exploration, personal preferences, finance/currency and the calendar. It checks birthdays for the entire known cast, supporting people's appearance, age, independent home and explicit commitments, and activity capabilities for every place. Explicitly empty commitments, possessions, private permissions or a social circle remain valid where appropriate. Focused model replies containing only new sections now parse correctly. Missing or malformed sections trigger bounded completion (at most six additional calls); unresolved sections remain visible and block Apply. They are not silently defaulted into a supposedly complete character. Malformed arrays and null rows produce gaps instead of crashing the checker. Model quality, verified coordinates and actual reference image generation remain separate from structural completeness.

The calendar supplies upcoming and recent dates, all known birthdays, and active reminders to chat and the daily adviser. A long calendar does not displace a birthday or an active reminder from this context. February 29 is observed on February 28 in non-leap years. A known date is not proof that a party, gift, call, post, attendance or relationship event happened. Numerical ages remain authored separately; the calendar does not infer birth years or silently change age.

## Daily direction and concrete activities

The optional daily adviser is one bounded text-provider review every 24 hours, using both wall and simulation clocks. It waits for automatic catch-up, shares the configured provider allowance, persists its reservation and cannot replay missed paid reviews after restart. A failed or unknown review does not automatically retry or stop ordinary life.

The adviser receives authored circumstances, current local calendar, current intentions, finances, personal boundaries, recorded experiences, public expression, noticed reactions and sourced world claims. It may offer a tentative direction, preferences for existing places/activities, and up to three bounded solo tasks during flexible windows. The existing activity engine decides whether and when to attempt them. Actual access, travel, needs, commitments and participants still govern outcomes. Advice cannot teleport people, spend money, create a relationship, establish academic success or claim a completed story.

Short soft classes now become concrete optional focus goals at their actual venue. The exact obsolete all-day campus placeholder is retired when detailed class blocks exist, so it cannot shadow the more specific activities. Explicit term start/end dates and breaks are shared by attendance, travel deadlines and supporting-person commitments. Finishing a term does not imply graduation.

The story pacing setting adjusts invitations, existing interests and occasional bounded fictional public-place closures, with recovery time. It does not impose romance, trauma, catastrophe or mandatory dramatic outcomes. Unassisted mode adds no story opportunities. The builder also now carries personal preferences and currency through their existing owners, preserving financial history and separate public/private expression.

## Activation and retained data

The update was first applied to a SQLite copy and replayed exactly. A stopped-service backup preceded activation on port 43127. Kernel `vh2-foundation-1:4fc92353346544c7` is active. Aslyn remains running; Brielle remains paused; the merged archive is untouched. Activation preserved messages, memories, photos, clips, references, rooms, balance, position and journey. Subsequent live checks confirmed media/reference retention and exact room definitions, current frontend source bytes, no extra adviser job and a running-life lag below two minutes.

Aslyn has 10 birthday entries (self and 9 known people); Brielle has 9 (self and 8 known people). Their dates are fictional assumptions where none were supplied. Aslyn's three authored course sessions received the verified Fall 2026 Session C term dates and breaks from the [official ASU calendar](https://registrar.asu.edu/academic-calendar). Its public iCalendar feed successfully imported 29 upcoming entries. It reports 26 unsupported or incomplete entries rather than inventing their timing. These are publisher listings, not attendance records.

Aslyn's additional authoring repair was tested over four simulated hours on a copy before activation. It removed 19 exact generic routine placeholders, retaining authored classes and personal commitments. Six optional activities expand her existing eight choices: brief psychology review, English coursework, exploring majors, easy home exercise, a call to Tammy and a catch-up with Cody. These fit existing biography and compete through ordinary agency; they do not claim an assignment or call happened. Missing family contact windows are supplied. Campus food/leisure capabilities follow its existing food-court description; established home access is explicit. Legacy homes also retain adviser access through canonical residence when newer access metadata is absent, while other private homes remain restricted.

Two editable assumptions bring Aslyn's calendar to 12 dates: October 14 for the already established relationship with Colton (unknown origin year), and December 4 as a personal reminder to think about next term. The latter is not an official registration deadline. The repair does not create a sister or any new relative. The reviewed repair is in `scripts/repair-aslyn-life-20260912.py`; all live mutations used versioned canonical commands and exact replay checks.

Bundled Jane/Ashlyn auto-installers and the executable legacy wildcard deck were removed. Existing saved characters, historical ledger records, media directories and export files were retained so saved references remain usable.

## Verification and remaining limitation

- 76/76 engine suites passed after the calendar integration and legacy-home access regression.
- 10 personal-calendar service tests passed: persistence/replay, recurrence, leap days, local midnight, hidden reminders, deletion, atomic invalid-input rejection, concurrent edits, new known people and busy-calendar awareness.
- 13 daily-adviser service tests passed, including durable reservations, budgets, stale-result rejection, restart/unknown outcomes, typed suggestions, diverse authored settings, failed-candidate isolation and terminal-status restoration after catch-up.
- 26 complete-builder/lifestyle test executions and 22 dialogue tests passed.
- Real Chrome with an isolated service passed brief → builder → review → blueprint save → life startup, calendar edits, add/delete/hide/restore, policy persistence, term breaks, omitted-section repair, incomplete-review blocking, malformed-output handling, the six-call completion limit and desktop/390px layouts. Provider output in this suite is a fixture and all external browser requests are blocked.
- The 112-character-day story stress run and 33-character-day diverse-setting matrix passed their mechanism, bounds and replay checks. These do not validate cultural authenticity or every model's narrative quality.
- Portable dependency closure, isolated boot, advance and replay passed. No release artifact was published.

The first live daily-adviser call returned a draft that failed validation. The original failure handler retained only the generic ValueError, so the exact invalid field cannot be recovered from that attempt. The handler is now tested to retain bounded rejected JSON locally with a specific static validation reason, without feeding it into memories or executable advice.

The user subsequently approved one exact-context diagnostic to OpenRouter’s `google/gemma-4-31b-it`, capped at 1,200 output tokens and using the existing allowance. It succeeded: the response passed validation, was saved as tentative direction with three optional intentions, appeared in chat context and survived exact event replay on a copied database. Live status is reviewed; the normal daily cooldown remains. Only one diagnostic call was made. This verifies the live integration for that response, not every possible model output.

No image or video was deliberately generated for these tests. Existing authorized background policies were preserved. This remains a bounded person simulation: arbitrary group vacations, open-ended novel actions, cultural/clinical realism and unconstrained world events are not certified by these checks.
