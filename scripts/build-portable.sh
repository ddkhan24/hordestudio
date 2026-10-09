#!/usr/bin/env sh
set -eu

VERSION="${1:-18.3.5}"
case "$VERSION" in
  ''|*[!A-Za-z0-9._-]*) echo "Version must contain only letters, digits, periods, underscores or hyphens." >&2; exit 1 ;;
esac
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUTPUT_DIR="$ROOT_DIR/dist"
OUTPUT_FILE="$OUTPUT_DIR/Horde-Studio-v${VERSION}-portable.zip"
if [ -e "$OUTPUT_FILE" ] || [ -L "$OUTPUT_FILE" ]; then
  echo "Refusing to overwrite existing archive: $OUTPUT_FILE" >&2
  exit 1
fi
BUILD_DIR=$(mktemp -d)
PACKAGE_DIR="$BUILD_DIR/Horde Studio"
APP_DIR="$PACKAGE_DIR/app"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$APP_DIR" "$OUTPUT_DIR"

for file in \
  index.html \
  app.js \
  large-archive.js \
  human-package.js \
  bundled-humans.js \
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
  if [ -L "$ROOT_DIR/$file" ]; then
    echo "Portable source files must not be symlinks: $file" >&2
    exit 1
  fi
  cp "$ROOT_DIR/$file" "$APP_DIR/"
done

# Keep runtime layout while excluding private settings, databases and build
# debris. Refuse symlinks instead of following them into another user's files.
python3 "$ROOT_DIR/scripts/portable-package.py" stage "$ROOT_DIR" "$APP_DIR"

# A portable VH2 life must run without asking the user to install Node. Stage
# checksum-pinned official executables for every supported desktop platform;
# fail the build if any runtime cannot be verified.
python3 "$ROOT_DIR/scripts/stage-node-runtimes.py" "$APP_DIR"

# Built-in humans follow the same boot path as the rest of the application.
# Retired bundled people must not be reintroduced by packaging. Never inline
# scripts (which CSP correctly blocks). Treat either missing file as a fatal
# release error rather than shipping an apparently empty Human library.

python3 "$ROOT_DIR/scripts/verify-portable-vh2.py" "$APP_DIR"

python3 "$ROOT_DIR/scripts/verify-portable-humans.py" "$APP_DIR"

# Internet multiplayer is bring-your-own relay. Ship the small auditable Worker
# source and setup guide so portable users are not dependent on this repository.

mkdir -p "$APP_DIR/docs"
cp "$ROOT_DIR/docs/multiplayer.md" "$APP_DIR/docs/"
mkdir -p "$APP_DIR/docs/vh2"
cp "$ROOT_DIR/docs/vh2/START-HERE.md" "$APP_DIR/docs/vh2/"

chmod +x "$APP_DIR/Start Horde Studio.command" "$APP_DIR/start-horde-studio.sh"
cp "$ROOT_DIR/scripts/portable/Start Horde Studio.command" "$PACKAGE_DIR/"
cp "$ROOT_DIR/scripts/portable/Start Horde Studio.bat" "$PACKAGE_DIR/"
cp "$ROOT_DIR/scripts/portable/start-horde-studio.sh" "$PACKAGE_DIR/"
cp "$ROOT_DIR/scripts/portable/START HERE.txt" "$PACKAGE_DIR/"
chmod +x "$PACKAGE_DIR/Start Horde Studio.command" "$PACKAGE_DIR/start-horde-studio.sh"
python3 "$ROOT_DIR/scripts/portable-package.py" archive "$BUILD_DIR" "$OUTPUT_FILE"

printf '%s\n' "$OUTPUT_FILE"
