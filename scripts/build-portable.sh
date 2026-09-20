#!/usr/bin/env sh
set -eu

VERSION="${1:-18.1.0}"
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BUILD_DIR=$(mktemp -d)
PACKAGE_DIR="$BUILD_DIR/Horde Studio"
APP_DIR="$PACKAGE_DIR/app"
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

# Keep the real source tree layout; never flatten modules or ship bytecode.
python3 - "$ROOT_DIR" "$APP_DIR" <<'PY'
import pathlib, shutil, sys
source, destination = map(pathlib.Path, sys.argv[1:])
shutil.copytree(source / "virtual_humans", destination / "virtual_humans",
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"))
PY

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
cp "$ROOT_DIR/scripts/portable/Start Horde Studio.command" "$PACKAGE_DIR/"
cp "$ROOT_DIR/scripts/portable/Start Horde Studio.bat" "$PACKAGE_DIR/"
cp "$ROOT_DIR/scripts/portable/start-horde-studio.sh" "$PACKAGE_DIR/"
cp "$ROOT_DIR/scripts/portable/START HERE.txt" "$PACKAGE_DIR/"
chmod +x "$PACKAGE_DIR/Start Horde Studio.command" "$PACKAGE_DIR/start-horde-studio.sh"
if [ -e "$OUTPUT_FILE" ]; then
  echo "Refusing to overwrite existing archive: $OUTPUT_FILE" >&2
  exit 1
fi

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
