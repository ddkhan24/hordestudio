#!/usr/bin/env sh
set -eu
PACKAGE_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$PACKAGE_DIR/app"
# Keep a user-created environment at the easy-to-find package root working.
if [ -x "$PACKAGE_DIR/.venv/bin/python" ]; then
    exec "$PACKAGE_DIR/.venv/bin/python" horde_mcp_bridge.py --open
fi
exec ./start-horde-studio.sh
