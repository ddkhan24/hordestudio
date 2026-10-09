#!/usr/bin/env python3
"""Serve an extracted portable release using only temporary, worker-free state."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import signal
import socket
import stat
import subprocess
import sys
import threading
import zipfile


def archive_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def extract(archive_path, directory):
    with zipfile.ZipFile(archive_path) as archive:
        seen = set()
        for entry in archive.infolist():
            name = entry.filename
            target = (directory / name).resolve()
            if name in seen or not target.is_relative_to(directory.resolve()):
                raise ValueError('Duplicate or unsafe archive path: ' + name)
            if stat.S_IFMT(entry.external_attr >> 16) == stat.S_IFLNK:
                raise ValueError('Symlinks are not allowed: ' + name)
            seen.add(name)
        archive.extractall(directory)
        for entry in archive.infolist():
            mode = entry.external_attr >> 16
            if mode:
                (directory / entry.filename).chmod(mode & 0o777)
    app = directory / 'Horde Studio' / 'app'
    if not (app / 'horde_mcp_bridge.py').is_file():
        raise ValueError('Portable package does not contain the application bridge.')
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('temporary', type=Path)
    args = parser.parse_args()
    temporary = args.temporary.resolve()
    app = extract(args.archive.resolve(), temporary / 'extracted')
    config = temporary / 'isolated-config'
    config.mkdir()
    # Do not inherit the developer's provider configuration or Node override.
    for key in list(os.environ):
        if key.startswith(('HORDE_', 'HOTAPI_', 'FAL_', 'OPENAI_', 'OPENROUTER_')):
            os.environ.pop(key)
    os.environ.update(HORDE_CONFIG_DIR=str(config), XDG_CONFIG_HOME=str(config),
                      APPDATA=str(config), PYTHONDONTWRITEBYTECODE='1')
    Path.home = classmethod(lambda cls: config)

    denied_network = []
    original_connect = socket.socket.connect
    original_getaddrinfo = socket.getaddrinfo

    def loopback(host):
        if host == 'localhost':
            return True
        try:
            return ipaddress.ip_address(str(host).strip('[]')).is_loopback
        except ValueError:
            return False

    def guarded_connect(connection, address):
        if connection.family in (socket.AF_INET, socket.AF_INET6) and not loopback(address[0]):
            denied_network.append(str(address[0]))
            raise RuntimeError('Portable audit blocks external connections.')
        return original_connect(connection, address)

    def guarded_getaddrinfo(host, *args, **kwargs):
        if not loopback(host):
            denied_network.append(str(host))
            raise RuntimeError('Portable audit blocks external DNS.')
        return original_getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = guarded_connect
    socket.getaddrinfo = guarded_getaddrinfo
    # Import the actual packaged bridge, preventing its optional watcher from
    # starting. The VH service is constructed but its worker start is forbidden.
    original_start = threading.Thread.start

    def guarded_start(thread):
        if thread.name == 'horde-always-on':
            return None
        return original_start(thread)

    threading.Thread.start = guarded_start
    sys.path.insert(0, str(app))
    import horde_mcp_bridge as bridge
    from virtual_humans.backend.vh2_runtime import WorldService
    threading.Thread.start = original_start
    bridge.always_on_runtime._stop.set()
    native_node = app / 'runtime' / (platform.system().lower() + '-' + platform.machine().lower()) / (
        'node.exe' if os.name == 'nt' else 'node')
    expected = (app / 'runtime/node-version.txt').read_text().strip()
    version = subprocess.run([str(native_node), '--version'], check=True,
                             capture_output=True, text=True, timeout=15).stdout.strip()
    if version != expected or bridge.always_on_runtime._node_path() != str(native_node):
        raise AssertionError('Packaged native Node version/discovery mismatch.')
    request = dict(create=True, name='Portable browser fixture', entityId='portable-browser-fixture',
                   now=1789030800000, deferAdvance=True)
    kernel = subprocess.run([str(native_node), str(app / 'virtual_humans/engine/vh2-kernel-worker.js')],
                            input=json.dumps(request), check=True, capture_output=True,
                            text=True, timeout=45)
    result = json.loads(kernel.stdout)
    if result['companion']['name'] != request['name'] or not result['kernelVersion']:
        raise AssertionError('Packaged kernel fixture failed.')
    service = WorldService(config / 'service.sqlite', str(native_node), app)
    def forbidden_start(*args, **kwargs):
        raise RuntimeError('Portable browser audit forbids provider workers.')
    service.start = forbidden_start
    bridge.vh2_service = service
    denied_posts = []

    class Handler(bridge.BridgeHandler):
        def do_GET(self):
            if self.path == '/__portable_audit/status':
                return self.respond(200, dict(deniedNetwork=denied_network, deniedPosts=denied_posts,
                    workersStarted=bool(service._thread or service._dialogue_thread or service._worker_pool),
                    alwaysOnThreadAlive=bridge.always_on_runtime._thread.is_alive()))
            return super().do_GET()

        def do_POST(self):
            # Fresh startup only reads/acknowledges its empty handoff queue.
            if self.path not in ('/always-on/events', '/always-on/ack', '/always-on/sync',
                                 '/always-on/stop', '/always-on/pause'):
                denied_posts.append(self.path)
                return self.respond(403, {'error': 'Generation is disabled in the portable browser audit.'})
            return super().do_POST()

        def log_message(self, *args):
            pass

    catalog = json.loads((app / 'assets/bundled/humans.json').read_text())
    humans = []
    for entry in catalog['humans']:
        inventory = json.loads((app / entry['path']).with_name('inventory.json').read_text())
        humans.append(dict(id=entry['id'], characterId=entry['characterId'],
            posts=inventory['posts'], refs=inventory['references'],
            gallery=inventory['galleryPhotos'], clips=inventory['clips']))
    server = bridge.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    bridge.ALLOWED_ORIGINS.add('http://127.0.0.1:' + str(server.server_port))
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    print(json.dumps(dict(port=server.server_port, nativeNode=str(native_node.relative_to(app)),
        nodeVersion=version, kernelVersion=result['kernelVersion'], humans=humans,
        archiveSha256=archive_digest(args.archive))), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        service.close()


if __name__ == '__main__':
    main()
