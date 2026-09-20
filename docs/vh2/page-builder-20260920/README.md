# VH2 page-by-page authoring and portable layout

This rework targets **Virtual Humans 2.0**. It does not change the Chat Library character builder or the World builder.

## User flow

The new-character entry opens the Person field picker instead of launching a complete person-and-world build. Person, Writing style, Personality, Social media, Photo direction, and Video style each have an AI draft control. The picker initially selects empty fields (and the generic new-character name), allows explicit replacements, makes a small plain-text request per selected field, and retains successful results when another field fails. Retry targets one field. Stopping generation retains completed drafts in the open review dialog.

Review text is editable and validated before copying into the editor. Users select which drafts to keep, then save through the existing character/template/current-life destination. Generation does not modify settings, start a life, or request images/video. A changed character, life, or authored field blocks stale application. Provider errors stay attached to the affected field. No paid provider request was needed for acceptance testing.

Core authoring pages remain visible; life and media pages are grouped under Optional pages. Profile/reference uploads and advanced simulation/vocabulary controls are collapsed. Life navigation groups optional possessions, media, and settings. Life setup starts with a section choice instead of a complete-world request; the larger builder remains an advanced option.

## Portable layout

```
Horde Studio/
  Start Horde Studio.bat
  Start Horde Studio.command
  start-horde-studio.sh
  START HERE.txt
  app/
```

The repository layout is unchanged. Packaging moves the existing runtime tree intact into app/, keeping internal imports and asset paths stable. Root launchers route into it. Existing ZIPs cannot be overwritten by the build script. Native Windows execution still needs testing; Windows routing is statically checked and POSIX routing is exercised from paths containing spaces.

## Validation

- 214 existing companion checks passed.
- Page-builder unit checks cover bounded requests, credential exclusion from prompts, whitelisted application, response validation, and changed-character/field/life protection.
- Browser checks exercise the actual served application with mock provider responses: field selection, failure and retry, review, real save/reload, untouched existing fields, cancellation, and mobile layout. See browser-results.json and screenshots.
- Packaging checks extract the actual archive, check its root layout and relative references, exercise launchers, boot/advance/replay a fresh VH2 timeline, and start the packaged HTTP handler with isolated configuration.

## Remaining boundaries

This change reduces generation scope and adds field-level recovery; it does not certify every third-party model. The separate VH2 daily-limit policy/accounting issue, scheduling behaviour, and reported Magnific TLS failure are not resolved by this authoring change. Native Windows and live paid-provider testing were not performed. Existing full-world generation still uses its larger structured workflow when explicitly selected.
