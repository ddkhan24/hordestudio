# Version 18 release privacy audit

Checked on 2026-09-13. This audit covers the bundled character and the reviewed release dependency/staging scope. Final portable archives must still be built from that scope and checked. Runtime was frozen for this final source/privacy scan. Browser storage behavior and the final portable archive are verified by separate release checks.

## Starting character

The default character starts with no prior player contact and no established player relationship, both in the profile and its saved setup expression. It contains authored biography, personality, world setup and intended starter media. It does not contain private chat sessions, conversation messages, learned relationship state, service-world archives, runtime memories or the publisher's provider credentials.

The 28 starter social posts omit per-player likes, comments and reactions. The two gallery images, five clips and 62 references remain intentional character media. Importing the character does not import the publisher's private conversations.

Generation settings inherit the importing user's providers. The bundle uses the generic image-provider path and clears publisher-selected reference/video providers, MCP image tools and arguments, model IDs, provider tags and options. Saved setup overrides do not restore those publisher settings.

## Source comparison

The original portable export was inspected in memory. Nineteen distinct private conversation strings with at least 40 characters and seven words, plus 39 conversation/message/world identifiers, were compared against every selected text file. Short generic utterances were excluded from the text fingerprint comparison to avoid incidental matches. No private text or identifiers remained in the final selected files. No source-export credentials were present to compare; the independent credential-pattern scan found only six synthetic test constants and one documentation-link false positive.

No original source archive, database, live-repair baseline, diagnostic directory or private source-export filename is selected for release. The source archive's hash appears only as intentional build provenance in the bundled inventory. No private home-directory path occurs in application runtime files.

## Identifier cleanup

The audit found an inherited source-world namespace inside authored garment IDs and the life seed. It contained no conversation text, but retained unnecessary linkage to the original private life. The bundle builder now replaces that namespace with the stable bundled-character namespace, updates the corresponding item/reference links, and sets a clean authored life seed. It changes ID fields only; prose and media remain unchanged. Existing live worlds are unaffected.

The rebuilt character changed exactly 40 ID/seed fields: 13 item IDs, 13 possession IDs, 13 garment reference links and the seed. All 15 item/possession links and 13 garment references remained valid. Every one of the 98 media files in the inventory retained its verified bytes.

Four regressions cover matching links, input preservation, deterministic/idempotent behavior, collision rejection and preservation of unrelated IDs, prose and media paths. A further 56 real isolated photo captures checked all 22 authored places and six rooms in both camera modes. All selected the correct bundled reference bytes, preserved state across restart/replay and created zero provider jobs. The manual frontend reference preparation also passed all 14 newly illustrated places.

## Evidence and limits

The local diagnostic receipts are retained under `scratch/v18-release-results/` and excluded from release staging: `release-privacy-audit.json`, `namespace-bundle-verification.json`, `location-reference-capture-results.json` and `location-reference-frontend-results.json`. The reproducible namespace regression is `scratch/v18_bundle_privacy_audit.py`.

The final frozen source scan covered 339 selected text files. The bundled character verified by this final privacy and inventory check has SHA256 `4c7f5a517f0be5013875291fe029ffcdf8031269bd2b00f055bbda419bc5df94`. The reference-selection tests used the identical media and ID links before the final provider-default cleanup; that cleanup changed configuration only. A subsequent change to the bundle or release scope requires rerunning the relevant check. This audit does not certify image-provider availability, the separate large-package storage repair, or human-equivalent simulation realism.
