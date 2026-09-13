# Complete character setup and connected life simulation

12 September 2026. This report records implementation and verification following the [baseline assessment](realism-plan-20260912.md). This is a bounded procedural simulation, not evidence of human consciousness or psychological equivalence.

## Delivered

The existing canonical world, actors, activity selection, plans, routes, event log and media workers now carry the connected behavior. No second simulation controller was added.

- Main and supporting people can seek company, invite each other, refuse or counter, travel to a gathering, meet an established friend of a friend, leave independently, accept an ordinary private follow-up and travel home. Private outcomes stay outside an uninvolved character's knowledge. Actual attendance, rather than an invitation alone, supplies relationship evidence.
- Informal hosted gatherings and noticed public events use the same plan system. Calls reserve both participants' attention while respecting their location, local clock, sleep and obligations. New residents keep their own identities, homes, needs and positions after introduction.
- Geography and actual access constrain food, leisure and exercise choices. Heat can make an accessible pool attractive; home exercise is an available choice. Persistent fictional illness episodes can change energy, stress and recovery. These are intentionally bounded authored models.
- Psychological appraisal now receives relevant social anticipation and outcomes. Chat, social expression and memories consume the character's own lived perspective. Knowing someone does not reveal their private activities or symptoms.
- Wardrobe colors remain conservative: explicit colors and reference-backed garments are preserved. Missing procedural colors receive stable variety. The AI builder specifies colors without requiring an extra generation request.

The connected party regression includes an NPC host, a previously unknown guest, actual attendance and introduction, independent agreement to private time, travel to the guest's home, separation from the original group and a completed return. This verifies a possible branch, not an obligatory story. Ordinary private visits use personality defaults; intimate outcomes additionally require their separate setting and current decisions. Detailed crowd behavior, party cleanup and unrestricted novel human action remain outside this implementation.

## One-brief builder and controls

Use **Create from notes** to generate the person and executable life from one brief, then review and save the complete draft. The same review exposes assumptions and editable supporting-person work/class obligations. Starting the character applies the reviewed setup through the canonical persistent-life service.

The generated setup covers appearance, voice, wardrobe colors, rooms, possessions and reference slots; supporting people, homes, budgets, local clocks and obligations; venues and route assumptions; autonomy, social interaction, invitations, hosting, resident generation, health and emotional/relationship settings. Values are derived from authored personality. Later changes preserve history and cannot refill an established person's starting funds or conjure new owned items.

**Life settings** provides directly reachable controls for autonomy, spontaneous expression, posting, supporting people, invitations, introductions, hosting, weather and health. Private-visit defaults and per-person overrides are accessible there. **People → Life & location → Correct vehicle ownership** repairs an authored setup mistake, with a reason, without treating it as a purchase or changing funds or presence.

Map selections now save the provider ID and coordinates together. Coordinate-only positioning clears an unrelated Google binding. Updating a map region reuses its canonical imported pack and saved bindings instead of duplicating it. Changed coordinates invalidate only affected unverified future routes, preserve historical captures, and require journey completion before moving an occupied endpoint.

## Saved-life repair

Google Maps searches explicitly approved by the user returned matching saved place IDs for Norte Town Lake Apartments, ASU Tempe campus and Mill Avenue. The previous pins around Baja California were inconsistent with the saved Tempe walking map. The verified points are now available for the apartment, its pool, campus and social district. Short entrance connections are authored duration estimates; they do not claim Google street geometry.

Before activation, the exact repair was applied to a private SQLite backup. The copied life retained all **41 photo records, 2 clip records, 51 reference assets, 6 rooms**, existing social posts, chat, memories, funds and current positions. The configured copy has **13 spatial actors**, including **4 fictional adult residents**, **141 places**, **1,514 route records**, and **17 supporting-person work/class obligation rows**.

Known contacts' missing homes and obligations are authored simulation assumptions derived from their existing biographies. New local homes are explicitly fictional positions near the installed public walking network, not claims about real private residences. Remote Georgia households remain a separate topology with America/New_York clocks; no intercity walking connection was invented. Existing main/Jordan/Priya balances are preserved. New known contacts start with zero simulated funds; fictional resident initial budgets use the existing generator defaults. Jordan's car flag is corrected to match the Honda Civic already in her biography and car entry.

The staged copy advanced four simulated hours: Aslyn left the pool, reached DRNK Coffee + Tea, returned home and slept at local nighttime. The final state matched exact event-log replay. The advanced copy is a test only; it is not substituted for the live history.

The exact repair was then applied to the stopped live service through canonical commands, after a second SQLite backup. Kernel `vh2-foundation-1:289231997b88cb1f` is active on the existing port 43127. Aslyn resumed through checkpointed elapsed-time catch-up; Brielle remained paused and the merged archive was left intact. The live clock returned within two minutes of current time. Fresh Open-Meteo weather at the current Tempe position and a successful Ticketmaster refresh were verified, with no simulation worker error. Updated frontend files returned HTTP 200 and matched source byte for byte. After resume, the original photo, clip and reference identities remained present and all six room definitions remained exactly unchanged.

## Verification

- **73/73 engine suites passed** in the final engine gate.
- **26 complete-builder/lifestyle test executions passed**; the count includes inherited baseline cases. These cover executable proposals, atomic failure, resource preservation, work attendance/pay, persistent prop descriptions, health context and replay.
- **5 supporting-person service cases passed**, including explicit vehicle correction without funds or presence changes.
- Social participation tests include 12 invitation seeds, connected party/private-follow-up and group-event cases, six timezone/work/sleep cases, ten social-plan service cases and three original plan service lifecycle cases.
- Procedural checks include 100 exploration seeds, 100 paired personality/introduction seeds, eight 14-day network runs and prior 24-by-28-day actor runs. Small synthetic worlds do not validate every city or personality.
- Health and appraisal checks cover recovery, opt-out, bounds, idempotency, restart/replay and private-perspective isolation. Coordinate, geography, Google Maps, weather and lifestyle boundary suites passed.
- Real Chrome tests use the actual UI and an isolated service to cover brief → review → save → start, immediate settings persistence, supporting obligations, vehicle correction, map selection, and desktop/390px layouts. Text completions are deterministic fixtures; this does not claim every external model always returns a complete valid draft.
- Portable dependency closure, isolated boot, advance and replay passed. This checks required runtime files; no release archive was published.

No paid image/video render was submitted as a test. Existing frozen references were preserved, but live output quality for every external renderer was not revalidated. See [social implementation](social-simulation-implementation-20260912.md), [builder implementation](complete-life-builder-20260912.md), and [coordinate audit](coordinate-save-audit-20260912.md) for detailed contracts and boundaries.
