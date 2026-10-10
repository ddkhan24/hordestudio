#!/usr/bin/env python3
"""Extract a portable ZIP and verify its layout, references, and launch routing."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import stat
import sys
import tempfile
import zipfile
from urllib.parse import unquote


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--node', type=Path)
    args = parser.parse_args()
    scripts = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix='horde portable smoke ') as folder:
        with zipfile.ZipFile(args.archive) as archive:
            assert archive.testzip() is None, 'Portable ZIP is damaged'
            names = [entry.filename for entry in archive.infolist()]
            assert len(names) == len(set(names)), 'Portable ZIP contains duplicate paths'
            for entry in archive.infolist():
                path = Path(folder) / entry.filename
                assert path.resolve().is_relative_to(Path(folder).resolve()), entry.filename
                assert stat.S_IFMT(entry.external_attr >> 16) != stat.S_IFLNK, entry.filename
                assert not any(part in {'.env', '.git', '.venv', '__pycache__', '.DS_Store', '.wrangler',
                    'node_modules', 'mcp-auth.json', 'always-on-queue.json', 'storage-state.json', 'cookies.json'}
                    or part.startswith('.env.') and part != '.env.example'
                    or part.endswith(('.pyc', '.pyo', '.sqlite', '.sqlite-wal', '.sqlite-shm', '.db', '.log'))
                    for part in Path(entry.filename).parts), entry.filename
            archive.extractall(folder)
            for entry in archive.infolist():
                mode = entry.external_attr >> 16
                if mode:
                    (Path(folder) / entry.filename).chmod(mode)
        root = Path(folder) / 'Horde Studio'
        app = root / 'app'
        assert {p.name for p in root.iterdir()} == {
            'app', 'START HERE.txt', 'Start Horde Studio.command',
            'Start Horde Studio.bat', 'start-horde-studio.sh'}
        for name in ('horde-handbook.js', 'horde-manual.js', 'pip-assistant.js', 'pip-knowledge.js', 'horde-support.css'):
            assert (app / name).is_file(), f'Missing support resource: {name}'
        handbook = (app / 'horde-handbook.js').read_text()
        topics = json.loads(handbook.split('Object.freeze(', 1)[1].rsplit(');', 1)[0])['pages']
        for topic in topics:
            if topic.get('image'):
                assert (app / topic['image']).is_file(), f'Missing manual screenshot: {topic["image"]}'
        self_host = app / 'deploy/vh2-self-host'
        assert {name for name in ('Dockerfile','compose.yaml','Caddyfile','.env.example','README.md')
                if not (self_host / name).is_file()} == set(), 'Private VH2 deployment kit is incomplete'
        for html in app.rglob('*.html'):
            for reference in re.findall(r'(?:src|href)=["\']([^"\']+)', html.read_text()):
                reference = reference.split('?', 1)[0].split('#', 1)[0]
                if reference and not reference.startswith(('http:', 'https:', 'data:', 'mailto:', '//')):
                    target = app / unquote(reference).lstrip('/') if reference.startswith('/') else html.parent / unquote(reference)
                    assert target.is_file(), (str(html.relative_to(app)), reference)
        for checker in ('verify-portable-vh2.py', 'verify-portable-humans.py'):
            command = [sys.executable, str(scripts / checker), str(app)]
            subprocess.run(command, check=True, timeout=90)
            if args.node and checker == 'verify-portable-vh2.py':
                subprocess.run(command + ['--node', str(args.node.resolve())], check=True, timeout=90)
        # Check both root and app-local virtual environments and both POSIX
        # launchers from a directory with spaces, without opening a browser.
        if os.name != 'nt':
            for location in (root, app):
                interpreter = location / '.venv/bin/python'
                interpreter.parent.mkdir(parents=True)
                interpreter.write_text('#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n')
                interpreter.chmod(0o755)
                for launcher in ('start-horde-studio.sh', 'Start Horde Studio.command'):
                    result = subprocess.run([str(root / launcher)], cwd=folder,
                        check=True, capture_output=True, text=True, encoding='utf-8', timeout=10)
                    assert result.stdout.splitlines() == [str(app), 'horde_mcp_bridge.py', '--open']
                interpreter.unlink()
        windows = (root / 'Start Horde Studio.bat').read_text()
        assert 'cd /d "%~dp0app"' in windows
        assert 'call "Start Horde Studio.bat"' in windows
        assert '"%~dp0.venv\\Scripts\\python.exe"' in windows
        print('Portable root layout, HTML references, and launcher routing passed.')
        # Boot the actual packaged HTTP handler with fresh config and an OS-
        # assigned port: no user's saved state, browser, or running service.
        code = '''
import os, pathlib, sys, threading, urllib.request
isolated = pathlib.Path(sys.argv[1])
pathlib.Path.home = classmethod(lambda cls: isolated)
os.environ['XDG_CONFIG_HOME'] = str(isolated)
os.environ['APPDATA'] = str(isolated)
os.environ['HORDE_CONFIG_DIR'] = str(isolated)
import horde_mcp_bridge as bridge
server = bridge.ThreadingHTTPServer(('127.0.0.1', 0), bridge.BridgeHandler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    for path, expected in [('/', b'<!DOCTYPE html>'), ('/app.js', b''),
                           ('/large-archive.js', b'HordeLargeArchive'),
                           ('/worlds/model-client.js', b'HordeWorldModelClient'),
                           ('/worlds/scene-draft.js', b'HordeWorldSceneDraft'),
                           ('/worlds/turn-context.js', b'HordeWorldTurnContext'),
                           ('/virtual_humans/frontend/vh-page-builder.js', b'vhOpenPageBuilder'),
                           ('/health', b'Horde Studio')]:
        with opener.open('http://127.0.0.1:%s%s' % (server.server_port, path), timeout=10) as response:
            body = response.read()
            assert response.status == 200 and body and expected.lower() in body.lower(), path
    print('Packaged bridge HTTP boot, page, JavaScript, and health passed.')
finally:
    server.shutdown()
    server.server_close()
'''
        subprocess.run([sys.executable, '-c', code, str(Path(folder) / 'isolated-config')],
                       cwd=app, check=True, timeout=30)


if __name__ == '__main__':
    main()
