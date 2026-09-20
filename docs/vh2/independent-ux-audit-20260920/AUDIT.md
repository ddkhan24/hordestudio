# Virtual Human AI Builder — Independent UI/UX Audit

Date: 2026-09-20
Scope: Virtual Human authoring fields, per-page AI drafting, credit safety, failure recovery, accessibility, responsive layout, save paths and surrounding creation navigation.

## Verdict

The audited builder originally failed basic product-coherence and credit-safety expectations. Help was detached from the fields it explained, valid actions could move off-screen, and a failed or stale request could allow later selected requests to continue. Those issues are fixed in the current build.

The current builder preserves the system's complexity while organizing it page by page. It does not reduce the human to one prompt: authors retain explicit control over identity, psychology, expression, life, media and runtime fields.

## Findings and disposition

| Severity | Finding | Disposition |
|---|---|---|
| Critical | A failed, rate-limited or stale field could allow later selected requests to continue. | Fixed. The batch stops immediately; completed drafts remain reviewable and unsent fields remain unsent. |
| High | The detached Field guide required users to map a separate definition list back to the form. | Fixed. Removed and replaced with one contextual tooltip beside each relevant field. |
| High | The Draft action could be off-screen after selecting lower fields, especially on mobile. | Fixed. Draft, Stop, Apply and Save now share one sticky stage-aware action bar. |
| High | Applying generated text did not reliably refresh counters and dependent input UI. | Fixed. Applied values dispatch the normal input event. |
| High | Several editor navigation and field actions were below the 44px touch-target floor. | Fixed across 320, 390, 768 and 1440px layouts. |
| Medium | The global help system created a second help icon beside the explicit field tooltip. | Fixed. Virtual Human field help owns those labels and renders exactly one control. |
| Medium | Every untouched builder row displayed a large “Not drafted” status block. | Fixed. Untouched rows remain quiet; status appears only after an attempt. |
| Medium | Save wording contradicted the action presented after applying drafts. | Fixed. The flow now states that changes are unsaved and offers “Save changes and close.” |
| Medium | The creation reset message referred to a retired Build action. | Fixed. It now says that field selection comes next and no request has been sent. |
| Low | Provider-specific currency cost cannot be predicted reliably before submission. | Explicit request count is shown instead: one separate text request per selected field. |

## Stress coverage

The dedicated AI-builder stress suite uses a local mocked provider and makes no paid external calls. It covers:

1. Opening without a request.
2. Exact request counting.
3. Batch stop after provider failure.
4. Isolated retry of only the failed field.
5. Counter refresh after applying a draft.
6. Rapid double activation without duplicate requests.
7. Mid-generation author edits stopping later requests.
8. Manual cancellation.
9. Rate/credit-limit failure.
10. Invalid structured model output.
11. Oversized direction preflight before transmission.
12. Disconnected-provider preflight.
13. Mobile overflow and sticky action reachability.
14. Secret-free, text-only request payloads.

## Final acceptance evidence

The permanent offline gate now includes nine suites. All pass:

- creation journey and scrolling;
- chat experience;
- accessibility and keyboard containment;
- page-builder integration;
- adversarial AI-builder stress tests;
- partial builder behavior;
- save destinations and persistence;
- feedback lifecycle;
- request-budget protections.

Machine-readable results: `final/report.json`
Builder stress results: `../ai-builder-audit-20260920/stress-results.json`

## Remaining limitation

The builder can state the exact number of requests but cannot promise a currency amount because provider pricing, model pricing and token usage are external and variable. The UI therefore favors a truthful request count over a fabricated estimate.
