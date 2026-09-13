# Saved coordinates, route ownership and weather — bounded repair

The source audit found no longitude/latitude inversion in the current `upsert_place` command: it correctly stores `[longitude, latitude]`. The historical live database does not retain enough command input attribution to prove which UI action originally copied the bad coordinates. Repeated wrong pins are evidence of bad saved data, not proof of a particular click or parser error.

Three reproducible defects were repaired:

- `horde_mcp_bridge.google_maps_request('search')` omitted `places.location` from the field mask. Search now returns the listing's coordinates. The frontend map-selection repair separately applies the returned listing identity and coordinates together, or clears the previous pin when no location is supplied.
- `vh2_lifestyle.command('upsert_place')` and reviewed `apply_life_proposal` place merges retained routes after an endpoint changed. They now share `invalidate_changed_place_routes`. A new Google listing without coordinates clears stale coordinates in either path. Current main and supporting-person journey endpoints cannot move mid-journey; a label-only edit or identical coordinate save remains allowed by `upsert_place`.
- `vh2_geography.command('import_world_pack')` could bind a map point to a saved place with different coordinates and append routes for the wrong point. A discrepancy over 150 metres now rejects the binding; filling an unknown position uses the same journey guard and invalidation helper. Authored places retain their own capabilities when linked to a pack point.

Invalidation removes only incident future route records whose geometry does not establish that the corrected endpoint already matches. Unrelated routes and already-correct geometry survive. Source labels alone are not endpoint provenance. Future actor legs are discarded from the next actual arrival; a main itinerary with an unaffected current leg cancels at its actual arrival, while an unstarted remaining route becomes blocked for existing recovery. Completed trips, presence history, event history and frozen photo references are not rewritten.

Current-place corrections clear the cached weather observation, its attempt cache and the immediate location projection. An asynchronous weather response for the old point cannot import after correction. A Google-linked home with unknown coordinates no longer falls back to an unrelated broad profile location.

## Repair and refresh contract

Use the existing command envelope (`schemaVersion`, `key`, `worldId`, `expectedRevision`) and `type:'upsert_place'`, with `place:{id,label,kind,longitude,latitude,googlePlaceId}`. An explicit coordinate-only anchor can set `googlePlaceId:''`. Commands remain atomic and replayable. Correct affected endpoints after actual journeys finish; history remains intact.

The result's canonical state contains `companion.vh2Geography.lastRouteInvalidation`: changed place IDs, removed route count, up to 100 removed endpoint/source summaries, future route IDs cleared, and whether weather was invalidated.

An existing immutable pack can be reapplied through the same command:

```json
{
  "type": "import_world_pack",
  "packId": "existing-library-content-id",
  "refresh": true,
  "bindings": {"existing-pack-point-id": "existing-saved-place-id"}
}
```

Supplying the exact `pack` object instead of `packId` is also supported. No fabricated pack IDs are needed. `GET /vh2/world-packs?id=<library-id>` reads the immutable content.

Refresh merges the saved bindings; binding a different map point to the same saved place replaces its prior binding. It retains the original import date, known-place history and existing authored metadata. Only this pack's proven route records are replaced. Exact immutable geometry supports legacy receipts that did not store bindings; unrelated geometry remains. New receipts retain a content hash and bindings, and reject changes to the immutable pack content. Repeating a refresh adds no duplicate routes. `lastPackRefresh` reports removed/installed route counts, bindings and cleared future route IDs.

This refresh cannot manufacture a walking connection for a place outside the pack. The 150-metre endpoint tolerance covers an entrance/snap discrepancy; a more distant anchor needs the correct pack point or real additional route data. Legacy geometry-free routes with no recoverable binding provenance cannot safely be attributed to a particular pack solely by its provider label.

## Verification

- `scratch/vh2_coordinate_edit_audit.py`: 11 tests covering atomic endpoint guards, builder parity, coordinate identity changes, geometry preservation, future-route invalidation, weather projection, replay and frozen-history preservation.
- `scratch/vh2_geography_service_audit.py`: 9 tests including binding mismatch, unknown-coordinate fill, canonical refresh, repeated-refresh idempotence, legacy receipts, immutable-content and current-journey guards, authored metadata and unrelated-route preservation.
- `scratch/vh_maps_bridge_audit.py`: 11 tests, including the search location field mask and returned coordinate payload.
- `scratch/vh2_weather_audit.py`: 4 tests, including an actual pending old-location result rejected after correction and a new-location result imported.
- The original lifestyle service suite (10 tests) and local Tempe pack routing audit pass. The Tempe audit uses the checked-in pack and mocked service fixture; it performs no live map lookup.

The separate social repair now evaluates remote contact windows in the recipient's local timezone, passes calls through supporting-person commitment checks, rejects conflicting main fixed commitments, and defers decisions during actual sleep. The full social participation/12-seed/connected-party audit plus six timezone/work/sleep cases and the 10+3 social service tests pass.

No live server, live database or external provider calls were made by this audit agent. Production anchor verification and activation are separate work. These tests establish the bounded paths above, not certification of every engine feature or geographical dataset.
