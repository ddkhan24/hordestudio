# Social profile update — 13 September 2026

## Root cause and repair

Starter post IDs were derived from both the world ID and source ID. Life consolidation kept the original post IDs. Applying the profile in the destination life then calculated different IDs, creating duplicate publications with the same `sourceId`.

Imports now resolve the stable starter source across both the active projection and paginated media history. Updating a starter changes its caption/image in place, preserving interactions and the historical date. Reusing identical image bytes retains the existing asset. Withdrawn posts stay withdrawn.

Startup and import repair consolidate exact source-identity duplicates. Comments and per-persona reactions are retained; redundant records become non-public aliases to the surviving post. Existing links to those aliases resolve to the surviving post. Original media bytes and append-only history are retained. No deduplication based solely on similar captions or matching-looking images is performed.

An offline copy of the actual saved life contained ten duplicate starter posts: seven image posts and three text posts. Repair reduced published posts from 31 to 21. All non-social state remained identical, and exact event replay passed. Paused merged archives were untouched.

## Interface

Full-height social drawer, understated tabs, compact profile header, avatar-led post headers, full-width uncropped media, consistent like/comment controls, collapsible comments, a full-size image viewer, and profile tools separated from the feed. Technical posting diagnostics are grouped in Posting activity. Comment drafts, caret and keyboard focus survive refreshes. Saved gallery ideas remain free and visible separately from generated media.

## Verification

35 service tests passed, covering starter updates, duplicate cleanup, interactions, withdrawal, asset reuse, library pagination and shared personas. 78 existing engine suites passed. Browser tests passed for the redesigned feed on desktop/mobile, repeated imports, comments/likes, image viewing, media proportions, draft focus, and prior chat/clip/export/gallery flows. All browser providers and media are offline fixtures.

## Live activation

Restarted on the original port 43127 with user approval. The live repair consolidated all ten duplicate posts in the active life, leaving 21 published posts. Its event changed only `social.posts`. The life remains running with 141 places, 6 rooms and 51 references; no worker error was reported. The paused archive remains unchanged.

Backup: `/private/tmp/vh-before-social-profile-20260913.sqlite`. Verification: `/private/tmp/vh-social-profile-live-verification.json`. Desktop and mobile previews use offline illustration fixtures: `/private/tmp/vh-social-profile-desktop.png`, `/private/tmp/vh-social-profile-mobile.png`.
