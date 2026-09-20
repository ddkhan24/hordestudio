# Virtual Humans feedback rework — 20 September 2026

> This is the original assessment. See [implementation and verification results](vh2/feedback-fixes-20260920.md) for the completed work and remaining verification limits.

## Objective

Let a new user create a character, save it without losing text, and reach a working first conversation before configuring optional life systems. Reduce the number of concepts users must understand to accomplish that task.

This document separates source inspection from user reports. It is a design proposal and acceptance checklist, not a claim that every reported problem has been reproduced or fixed.

## Evidence and scope

| Finding | Evidence status | Current work |
| --- | --- | --- |
| Appearance can be silently shortened to 800 characters. | Verified by source inspection: `app.js` character normalization slices appearance to 800; `index.html` appearance textarea does not disclose that limit. | A separate implementation is underway to preserve appearance text. Persistence and export/import still need verification. |
| Setup presents life configuration before the first conversation. | Verified by source inspection: `vhStudioSetupOverview` in `vh-workspace.js` presents Person, AI connection, Life setup, Start their life, then opens Life. | First-chat overview is being implemented using the existing `open-companion-chat-btn` handler. No new runtime mode is in scope. |
| Navigation exposes overlapping authoring and simulation destinations. | Verified by source inspection: nine companion studio tabs in `index.html`, twelve `VH_WORKSPACE_SECTIONS`, and an additional primary bar in `vh-workspace.js`. | Primary Chat / Person / Life navigation is being implemented. Consolidation of every underlying page is future scope. |
| Windows subprocess readers crash while decoding output. | Reported with a concrete Python 3.11 cp1252 exception. This UX review did not reproduce it on Windows. | A separate encoding fix is underway; do not claim Windows validation until exercised there. |
| Generators fail or time out, character becomes unavailable for excessive periods, daily limits trigger unexpectedly, toggles disappear, exports/imports fail, and chat-style content disappears. | User-reported. This review has not reproduced these failures or established their causes. | Requires focused reproduction and diagnostic evidence. |
| Magnific bridge connection fails with an expired-certificate error and Windows instructions name a macOS launcher. | User-reported. Connection failure is not independently reproduced in this review. | Investigate certificate chain and platform-specific instructions separately. |

Relevant source locations at the time of review: `index.html:2240` (studio tabs), `index.html:2338` (appearance), `index.html:2710` (life-builder framing), `app.js:35503` (appearance normalization), `vh-workspace.js:20` (save destinations), `vh-workspace.js:53` (life sections), `vh-workspace.js:512` (place and room editor), and `vh-workspace.js:968` (setup overview). Line numbers may move during implementation.

## Proposed navigation tree

```text
Virtual Humans
├─ Your characters
└─ Create character
   └─ Name, character brief, opening situation → Start conversation

Selected character
├─ Chat                         default destination
├─ Person
│  ├─ Identity & personality
│  ├─ Writing style & examples
│  └─ Appearance & references
├─ Life                         explicit Off / Paused / Running state
│  ├─ Overview
│  ├─ Places → Rooms
│  ├─ People
│  └─ Routines & activities
└─ Settings                     secondary menu
   ├─ AI connection & usage
   ├─ Optional features        photos, voice, gifts, money, social feed
   └─ Data & troubleshooting
```

Chat / Person / Life is the immediate navigation change. Moving all existing panels into this final tree is future scope. Keep specialist tools accessible while the migration happens; do not remove capabilities just to simplify the first screen.

## First-conversation journey

1. Enter a name and a short character brief. Offer an opening situation as optional context.
2. Select the existing AI connection and model. Clearly identify missing configuration before the user sends a message.
3. Save and open Chat through the existing supported chat handler. Life drafting must not appear to be a prerequisite in the setup overview.
4. Send a message. Show a meaningful pending state, then the reply or an actionable error. Preserve the message on failure.
5. Offer life configuration as an optional next step after conversation is available.

The immediate frontend work changes setup guidance and navigation. It does not by itself prove that every provider works or remove simulation-dependent runtime behavior. Do not promise immediate replies while an existing delivery policy can defer them.

## Prioritized acceptance criteria

### P0 — Trust and a usable first conversation

- A newly created character can reach Chat from the overview without first completing the life builder. The action saves via the supported path and does not create a second chat implementation.
- Chat, Person, and Life are consistently named and reachable from their corresponding surfaces; the active destination is identified accessibly.
- Appearance text longer than 800 characters survives save and reload exactly. Any genuine storage or provider limit is disclosed before applying it; no silent shortening is acceptable. Verify export/import separately before calling that round trip fixed.
- Failed saves retain the draft and distinguish saved local content from an unconfirmed active-life update. A success message must not hide a partial failure.
- First-send failure presents the operation that failed and a recovery action. The message remains available for retry. No failure is represented merely as character inactivity.
- Windows subprocess output containing characters outside cp1252 is decoded without reader-thread failure; validation records the environment actually exercised.

The first three criteria are the main immediate frontend/data targets. Save semantics and reply recovery require additional implementation or verification; they are not implied by the navigation changes.

### P1 — Explain and recover from blocked actions

- If a reply is waiting on availability, show the actual reason and next actionable step. Do not invent an expected reply time when none is known.
- Daily limits show enabled state, scope, consumed amount and reset basis beside the blocking message. Disabled life features must not silently activate an unrelated cap.
- A failed generation retains completed fields and the user's brief. Retry the failed stage instead of discarding the full draft; validate provider support rather than assuming that a model accepts a large structured response.
- Every toggle is visible, keyboard-operable, labeled, and reflects persisted state after reload.
- Import/export errors explain what was rejected and how to recover. Exported data should be inspectable and editing support explicit; a portable archive must not masquerade as editable plain JSON.
- Life status exposes Pause, Resume and a clearly described reset/restart action. Destructive effects and preserved history must be explained before reset.

These are future functional work pending reproduction and implementation.

### P2 — Consolidate authoring and optional systems

- Places are the only top-level location concept; rooms belong to places. Reference images attach to those same entities instead of creating an unrelated location list.
- Editing restrictions have an explanation beside the affected action and a supported route to edit safely. Remove unused placeholder places without forcing an undocumented restart.
- A minimal or asocial character can omit supporting people, wardrobe expansion, social feeds and complex schedules. Optional systems do not become completion requirements.
- The builder follows the user's scenario rather than automatically imposing a contemporary everyday-life premise. Scenario presets are a proposal, not currently implemented functionality.
- Reduce repeated status chips, competing headings and duplicate entry points. Each screen has one dominant task and optional details use progressive disclosure.
- Portable distribution presents clear platform launchers at the top level, with supporting files grouped behind them. Verify relocated paths before shipping.

## Release evidence

Record the checks actually completed alongside the final change: appearance save/reload, existing-character compatibility, first-chat navigation, basic keyboard access, and any Windows execution. Keep unresolved reported failures listed separately. A calmer interface is useful, but it is not evidence that generation, imports, runtime scheduling, or provider connectivity have been repaired.

## Implemented first pass and verification

- Appearance normalization preserves the full authored value. All 214 companion audit checks pass, including a >5,000-character Unicode appearance through normalization and template export/import.
- The setup overview leads to Chat through the existing save handler without requiring the life builder. Chat / Person / Life navigation is present on all three surfaces.
- Native checkbox and radio appearance is restored for controls using the shared form-input class.
- Four production JavaScript worker subprocess calls use explicit UTF-8 decoding and replacement for malformed diagnostics. Two actual subprocess regression tests pass under a simulated cp1252 default; native Windows testing remains outstanding.
- The isolated browser regression passes for chat without life setup, navigation, staying in the editor after a failed save, checkbox interaction and mobile overflow. Screenshots are in `vh2/feedback-rework-20260920/`.
- Additional source inspection confirmed dialogue limits inherit Always On settings even when disabled (`vh2-horde-integration.js:75`). Submission accounting (`vh2_dialogue.py:320`), displayed provider usage (`vh2_provider.py:66`), social-worker checks (`vh2_social_worker.py:94`) and life-adviser checks (`vh2_story.py:182`) all count the shared dialogue usage table without provider-scope filtering. These paths need a coordinated accounting and foreground/background policy change, preserving immutable provider snapshot/version semantics and legacy unscoped jobs. No daily-limit repair is included in this patch.

The evidence table above records the initial review. These results supersede its “underway” status for this first pass. This is not a completed redesign or a provider reliability certification.
