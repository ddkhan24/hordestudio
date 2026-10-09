#!/usr/bin/env python3
"""Stage public runtime trees and write a reproducible portable ZIP safely."""
import argparse
import datetime
import os
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile

TREES = ('world-packs', 'worlds', 'virtual_humans', 'assets/bundled',
         'assets/worlds', 'multiplayer-relay', 'deploy/vh2-self-host')
PRIVATE_NAMES = {'.env', '.git', '.venv', 'venv', 'node_modules', '.wrangler',
                 'mcp-auth.json', 'always-on-queue.json', 'storage-state.json', 'cookies.json'}
NOISE_NAMES = {'__pycache__', '.DS_Store', '__MACOSX'}


def excluded(name):
    return (name in PRIVATE_NAMES or name in NOISE_NAMES or name.endswith(('.pyc', '.pyo', '.sqlite',
            '.sqlite-wal', '.sqlite-shm', '.db', '.log')) or
            name.startswith('.env.') and name != '.env.example')


def stage_tree(source, destination):
    """Never follow filesystem links or copy runtime state into a public bundle."""
    source, destination = Path(source), Path(destination)
    if source.is_symlink():
        raise ValueError(f'Portable source tree must not be a symlink: {source}')
    for directory, folders, files in os.walk(source, followlinks=False):
        folders[:] = [name for name in folders if not excluded(name)]
        for name in folders + [name for name in files if not excluded(name)]:
            path = Path(directory) / name
            if path.is_symlink():
                raise ValueError(f'Portable runtime assets must not be symlinks: {path}')
    shutil.copytree(source, destination,
                    ignore=lambda directory, names: [name for name in names if excluded(name)])


def stage_trees(source, app):
    source, app = Path(source), Path(app)
    for name in TREES:
        tree = source / name
        if not tree.exists() and name == 'assets/worlds':
            continue
        stage_tree(tree, app / name)


def write_archive(source, output, epoch=None):
    source, output = Path(source).resolve(), Path(output).resolve()
    root = source / 'Horde Studio'
    if not root.is_dir() or root.is_symlink():
        raise ValueError('Portable staging must contain a real Horde Studio directory.')
    if output.exists() or output.is_symlink():
        raise FileExistsError(f'Refusing to overwrite existing archive: {output}')
    # Reproducible builds use one UTC timestamp and normalized POSIX modes.
    # SOURCE_DATE_EPOCH can select the release timestamp; 1980 is ZIP's minimum.
    epoch = int(os.environ.get('SOURCE_DATE_EPOCH', '315532800')) if epoch is None else int(epoch)
    stamp = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc)
    if not 1980 <= stamp.year <= 2107:
        raise ValueError('SOURCE_DATE_EPOCH must be a supported ZIP date (1980–2107).')
    timestamp = (stamp.year, stamp.month, stamp.day, stamp.hour, stamp.minute, stamp.second - stamp.second % 2)
    paths = sorted(root.rglob('*'))
    for path in paths:
        if path.is_symlink() or any(excluded(part) for part in path.relative_to(source).parts):
            raise ValueError(f'Non-public runtime file in portable staging: {path}')
        if not (path.is_dir() or path.is_file()):
            raise ValueError(f'Unsupported portable asset: {path}')
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.horde-package-', suffix='.zip', dir=output.parent)
    os.close(descriptor)
    pending = Path(temporary)
    try:
        with zipfile.ZipFile(pending, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in paths:
                if not path.is_file():
                    continue
                entry = zipfile.ZipInfo(path.relative_to(source).as_posix(), timestamp)
                entry.create_system = 3
                executable = path.name == 'node' or path.suffix in {'.command', '.sh'}
                entry.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                with path.open('rb') as input_file, archive.open(entry, 'w', force_zip64=True) as output_file:
                    shutil.copyfileobj(input_file, output_file, 1024 * 1024)
        # An atomic no-overwrite link also protects simultaneous release builds.
        os.link(pending, output)
        output.chmod(0o644)
    finally:
        pending.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('stage', 'archive'):
        command = commands.add_parser(name)
        command.add_argument('source', type=Path)
        command.add_argument('destination', type=Path)
    args = parser.parse_args()
    if args.command == 'stage':
        stage_trees(args.source, args.destination)
    else:
        write_archive(args.source, args.destination)


if __name__ == '__main__':
    main()
