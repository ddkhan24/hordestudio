"""Portable runtime discovery shared by offline release tests."""
import os
from pathlib import Path
import platform
import shutil


def node_executable(root=None):
    root = Path(root) if root is not None else Path(__file__).resolve().parents[1]
    configured = os.environ.get('HORDE_NODE_EXECUTABLE')
    if configured:
        found = shutil.which(configured)
        if found:
            return found
        raise RuntimeError('HORDE_NODE_EXECUTABLE must identify an executable Node.js binary.')
    system = platform.system().lower()
    machine = platform.machine().lower()
    binary = 'node.exe' if system == 'windows' else 'node'
    # Match the host; a bundled macOS binary must never be selected on Linux.
    bundled = root / 'runtime' / (system + '-' + machine) / binary
    if bundled.is_file() and os.access(bundled, os.X_OK):
        return str(bundled)
    found = shutil.which('node')
    if found:
        return found
    raise RuntimeError('Node.js 18+ is required: install it on PATH or set HORDE_NODE_EXECUTABLE.')
