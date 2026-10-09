"""Portable runtime discovery shared by offline release tests."""
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
from functools import lru_cache


def _configured_node(root):
    configured = os.environ.get('HORDE_NODE_EXECUTABLE')
    if configured:
        return configured
    env_file = root / '.env'
    if env_file.is_file():
        for line in env_file.read_text(encoding='utf-8').splitlines():
            key, separator, value = line.partition('=')
            if separator and key.strip() == 'HORDE_NODE_EXECUTABLE':
                return value.strip().strip('"\'')
    return None


@lru_cache(maxsize=16)
def _supported_node(candidate):
    path = Path(candidate)
    if not path.is_file() or not os.access(path, os.X_OK):
        return False
    try:
        result = subprocess.run([candidate, '--version'], capture_output=True, text=True,
                                timeout=3, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return False
    match = re.fullmatch(r'v(\d+)\.\d+\.\d+', result.stdout.strip())
    return result.returncode == 0 and bool(match) and int(match.group(1)) >= 18


def node_executable(root=None):
    root = Path(root) if root is not None else Path(__file__).resolve().parents[1]
    configured = _configured_node(root)
    system = platform.system().lower()
    machine = platform.machine().lower()
    binary = 'node.exe' if system == 'windows' else 'node'
    # Match the host; a bundled macOS binary must never be selected on Linux.
    bundled = root / 'runtime' / (system + '-' + machine) / binary
    candidates = [shutil.which(configured) or configured if configured else None,
                  str(bundled), shutil.which('node')]
    if system == 'darwin':
        candidates.extend(('/opt/homebrew/bin/node', '/usr/local/bin/node',
                           str(Path.home() / '.volta/bin/node')))
    for candidate in candidates:
        if candidate and _supported_node(candidate):
            return str(candidate)
    raise RuntimeError('Node.js 18+ is required for VH2. Install it or set HORDE_NODE_EXECUTABLE in this app\'s .env, then restart Horde Studio.')
