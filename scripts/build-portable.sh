#!/usr/bin/env sh
set -eu

VERSION="${1:-18.0.1}"
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BUILD_DIR=$(mktemp -d)
APP_DIR="$BUILD_DIR/Horde Studio"
OUTPUT_DIR="$ROOT_DIR/dist"
OUTPUT_FILE="$OUTPUT_DIR/Horde-Studio-v${VERSION}-portable.zip"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$APP_DIR" "$OUTPUT_DIR"

for file in \
  index.html \
  app.js \
  human-package.js \
  bundled-humans.js \
  vh-life-schema.js \
  vh-workspace.js \
  vh-assistant-ui.js \
  vh-setup-ui.js \
  vh-workspace.css \
  vh-world-engine.js \
  vh-activity-engine.js \
  vh-conversation-engine.js \
  vh-simulation-core.js \
  vh-host-worker.js \
  vh2-health-engine.js vh2-kernel-worker.js vh2-geography-engine.js vh2_geography.py vh2_world_packs.py \
  vh2-presence-engine.js \
  vh2-plans-engine.js \
  vh2-agency-engine.js \
  vh2-npc-travel.js \
  vh2-social-bonds.js \
  vh2-population-engine.js \
  vh2_population.py \
  vh2-institutions-engine.js \
  vh2-network-engine.js \
  vh2-people-engine.js \
  vh2_people.py \
  vh2-relationship-lifecycle.js \
  vh2_relationships.py \
  vh2_assets.py \
  vh2_flights.py \
  vh2_ticketmaster.py \
  vh2_life_controls.py vh2_controls.py vh2_attachments.py vh2_clips.py vh2_calls.py vh2_profile.py vh2_weather.py vh2_social_worker.py vh2-profile-fields.json \
  vh2_open_airports.py \
  vh2_feeds.py \
  vh2_live_data.py \
  vh2_gtfs.py \
  vh2_feed_discovery.py \
  vh_maps_budget.py \
  vh2_realtime.py \
  vh2_calendar.py \
  vh2_workers.py \
  vh2_image_adapters.py \
  vh2_player.py \
  vh2_history.py \
  vh2_visual.py \
  vh2_commerce.py \
  vh2_transport.py \
  vh2-transport-engine.js \
  vh2_episodes.py \
  vh2-episodes-engine.js \
  vh2_lifestyle.py \
  vh2-lifestyle-engine.js \
  vh2_exploration.py \
  vh2-exploration-engine.js \
  vh2_travel.py \
  vh2-travel-engine.js \
  vh2_gifts.py \
  vh2-psychology-engine.js \
  vh2-followthrough-engine.js \
  vh2-decision-engine.js vh2-communication-engine.js \
  vh2_runtime.py \
  vh2_media.py \
  vh2_social.py \
  vh2_plans.py \
  vh2_agency.py \
  vh2_library.py \
  vh2_backup.py \
  vh2_transcript.py \
  vh2_dialogue.py \
  vh2_conversation.py \
  vh2_conversations.py \
  vh2_provider.py \
  vh2_migration.py \
  vh2_entities.py \
  vh2_story.py vh2-story-engine.js vh2-story-policy.json \
  vh2-vh1-fields.json \
  vh2.html \
  vh2-dashboard.js \
  vh2-horde-integration.js \
  video-worlds.js \
  style.css \
  presets.js \
  boot-diagnostics.js \
  labs-embedded.js \
  labs-embedded-worker.js \
  labs-needle.js \
  labs-needle-worker.js \
  labs-core.js \
  labs-tasks.js \
  labs-guide.js \
  labs-ui.js \
  help-system.js \
  rpg-mechanics.js \
  multiplayer-engine.js \
  multiplayer.js \
  policy-panic-world.js \
  favicon.svg \
  horde_mcp_bridge.py \
  README.md \
  THIRD_PARTY_NOTICES.md \
  MCP_SETUP.md \
  "Start Horde Studio.command" \
  "Start Horde Studio.bat" \
  start-horde-studio.sh
do
  cp "$ROOT_DIR/$file" "$APP_DIR/"
done

cp -R "$ROOT_DIR/world-packs" "$APP_DIR/"

# Built-in humans follow the same boot path as the rest of the application.
# Retired bundled people must not be reintroduced by packaging. Never inline
# scripts (which CSP correctly blocks). Treat either missing file as a fatal
# release error rather than shipping an apparently empty Human library.

python3 "$ROOT_DIR/scripts/verify-portable-vh2.py" "$APP_DIR"

# Bundled Virtual Humans and Worlds can reference normalized media by relative
# path. Keep those runtime assets portable without shipping heavy marketing or
# development artwork in the application archive.
if [ -d "$ROOT_DIR/assets/bundled" ]; then
  mkdir -p "$APP_DIR/assets"
  cp -R "$ROOT_DIR/assets/bundled" "$APP_DIR/assets/"
fi

python3 "$ROOT_DIR/scripts/verify-portable-humans.py" "$APP_DIR"

# Internet multiplayer is bring-your-own relay. Ship the small auditable Worker
# source and setup guide so portable users are not dependent on this repository.

mkdir -p "$APP_DIR/docs"
cp "$ROOT_DIR/docs/multiplayer.md" "$APP_DIR/docs/"
mkdir -p "$APP_DIR/docs/vh2"
cp "$ROOT_DIR/docs/vh2/START-HERE.md" "$APP_DIR/docs/vh2/"
cp -R "$ROOT_DIR/multiplayer-relay" "$APP_DIR/"

chmod +x "$APP_DIR/Start Horde Studio.command" "$APP_DIR/start-horde-studio.sh"
rm -f "$OUTPUT_FILE"

if command -v zip >/dev/null 2>&1; then
  (cd "$BUILD_DIR" && zip -9 -q -r "$OUTPUT_FILE" "Horde Studio")
else
  python3 - "$BUILD_DIR" "$OUTPUT_FILE" <<'PY'
import pathlib
import sys
import zipfile

source = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted((source / "Horde Studio").rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(source))
PY
fi

printf '%s\n' "$OUTPUT_FILE"
