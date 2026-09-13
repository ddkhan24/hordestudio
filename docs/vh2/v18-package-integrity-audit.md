# Version 18 package integrity audit

The character package now keeps clip files and saved life archives binary through export, import and service restore. Saved lives no longer become one large base64 JSON request during import. The original JSON/base64 restore interface remains available for older clients.

## Corrected defects

- The ZIP writer could produce files that its reader rejected: its entry limit was higher, and the metadata limit counted JavaScript characters while import counted UTF-8 bytes. Both boundaries now agree. Multibyte metadata has an explicit regression.
- The ZIP reader accepted mismatched local and central filenames or methods. It now checks these headers, sizes, checksums, directory counts and overlapping entries, and rejects duplicate or unsafe paths. Standard Python DEFLATE archives, streamed data descriptors and comments remain compatible.
- The package test wrote into `/private/tmp`, which is absent on ordinary Linux CI hosts. It now uses the operating system's temporary directory. The browser package test uses configurable Playwright and browser locations.
- The portable build still copied the retired `Ashlyn Reynolds.horde_human` file. That payload is removed from the build list and rejected by the packaged-human verifier.
- A saved life could export up to 256 MiB compressed, then fail import because its base64 representation exceeded the 256 MiB JSON request limit. The new binary restore upload uses a small `restore.json` manifest and separate STORE ZIP entries. Export, client preflight, upload parsing and restore agree on a 256 MiB combined compressed-life limit; ZIP/manifest overhead receives its own bounded allowance.
- The uncompressed backup limit did not leave space for the integrity envelope added by export. Restore now includes the fixed envelope allowance; a lowered-limit regression verifies the exact payload boundary.

## Restore contract

The browser sends an `application/zip` request to the existing character-restore endpoint. The local bridge writes the bounded upload to a temporary file, parses only the expected manifest and `lives/<index>.gz` entries, and passes binary archives to the existing atomic restore transaction. It never extracts ZIP paths onto disk. Python 3.9 compatibility is covered by the browser test on the local runtime.

The receipt fingerprint hashes archive bytes with the character and import IDs. The same content sent through old base64 or new binary transport resolves to the same new receipt. Existing old receipt hashes remain recoverable through incremental hashing of their canonical legacy representation. A conflicting package under an existing import ID still fails. A malformed second life rolls back an already processed first life and the receipt together.

A character-template package remains distinct from a portable saved life. The binary upload does not enable jobs or resume a restored life. Existing identity remapping, paused restore, privacy and provider-credential exclusion remain owned by the original restore path.

## Verification

- Package unit regression passed: separate media, deduplication, corruption, header consistency, matching limits, UTF-8 metadata, binary life upload and Python ZIP interoperability.
- Custom temporary-directory run passed, and Python `zipfile` independently read the JavaScript-exported package with valid CRCs.
- Character-template and portable-human media tests each passed two export/import cycles across three clip source types.
- 19 backup and conversation service tests passed, including binary/legacy receipt equivalence, old receipt recovery, lowered byte limits, all-or-nothing restore and payload-envelope boundaries.
- The real browser/isolated-service ZIP test passed with a starter clip, photo, reference and saved life. It explicitly fails if a life Blob is converted back to base64 or the restore request is not binary. The restored character has a separate life with its expected post and reference.
- The complete engine regression passed: 83 of 83 suites, including character creation, life simulation, persistence and schema migration.

These fixtures do not independently certify the final full-size Ashlyn bundle. Final release verification must use the shipped artifact, check every media file and exercise fresh default installation and upgrade behavior.

## Remaining release workflow concern

The manually dispatched `package-current-release.yml` workflow selects the latest tag but originally built the checked-out branch rather than checking out that tag. The release owner should ensure it builds the selected tag before attaching an artifact to that release. This audit did not alter release workflows or publish any artifacts.
