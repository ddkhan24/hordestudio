#!/usr/bin/env python3
"""Stage checksum-pinned official Node.js executables into a portable app."""

import argparse
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import shutil
import stat
import sys
import tarfile
import tempfile
from urllib.request import urlopen
import zipfile


NODE_VERSION = "v24.21.0"
RELEASE_URL = f"https://nodejs.org/download/release/{NODE_VERSION}"


class StageError(RuntimeError):
    """The runtime bundle could not be verified and staged."""


@dataclass(frozen=True)
class NodeArchive:
    platform: str
    filename: str
    sha256: str

    @property
    def url(self):
        return f"{RELEASE_URL}/{self.filename}"

    @property
    def prefix(self):
        return self.filename.removesuffix(".tar.xz").removesuffix(".zip")

    @property
    def executable(self):
        return "node.exe" if self.filename.endswith(".zip") else "node"

    @property
    def member(self):
        return f"{self.prefix}/{self.executable}" if self.executable == "node.exe" else f"{self.prefix}/bin/node"


ARCHIVES = (
    NodeArchive("darwin-arm64", "node-v24.21.0-darwin-arm64.tar.xz", "6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe"),
    NodeArchive("darwin-x86_64", "node-v24.21.0-darwin-x64.tar.xz", "0ae5a24c24bb7d015cd816c5036b3f90f2945aa872fcf54e58da054753b3a299"),
    NodeArchive("linux-x86_64", "node-v24.21.0-linux-x64.tar.xz", "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"),
    NodeArchive("linux-aarch64", "node-v24.21.0-linux-arm64.tar.xz", "6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2"),
    NodeArchive("windows-amd64", "node-v24.21.0-win-x64.zip", "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541"),
    NodeArchive("windows-arm64", "node-v24.21.0-win-arm64.zip", "8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921"),
)


def download_verified(archive, destination, opener=urlopen):
    digest = hashlib.sha256()
    try:
        with opener(archive.url, timeout=60) as response, destination.open("xb") as output:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
    except (OSError, ValueError) as error:
        raise StageError(f"Download failed for {archive.filename}: {error}") from error
    actual = digest.hexdigest()
    if actual != archive.sha256:
        raise StageError(f"SHA256 mismatch for {archive.filename}: expected {archive.sha256}, got {actual}")


def verify_cached(archive, path):
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    except OSError as error:
        raise StageError(f"Cannot read cached {archive.filename}: {error}") from error
    actual = digest.hexdigest()
    if actual != archive.sha256:
        raise StageError(f"SHA256 mismatch for cached {archive.filename}: expected {archive.sha256}, got {actual}")


def extract_verified(archive, source, destination, license_destination=None):
    """Copy only named regular members from a verified Node.js archive."""
    try:
        if archive.filename.endswith(".tar.xz"):
            with tarfile.open(source, "r:xz") as bundle:
                member = bundle.getmember(archive.member)
                if not member.isfile():
                    raise StageError(f"Expected regular file: {archive.member}")
                with bundle.extractfile(member) as input_file, destination.open("xb") as output:
                    shutil.copyfileobj(input_file, output)
                if license_destination is not None:
                    license_member = bundle.getmember(f"{archive.prefix}/LICENSE")
                    if not license_member.isfile():
                        raise StageError(f"Expected regular file: {license_member.name}")
                    with bundle.extractfile(license_member) as input_file, license_destination.open("xb") as output:
                        shutil.copyfileobj(input_file, output)
        elif archive.filename.endswith(".zip"):
            with zipfile.ZipFile(source) as bundle:
                member = bundle.getinfo(archive.member)
                mode = member.external_attr >> 16
                if member.is_dir() or stat.S_IFMT(mode) == stat.S_IFLNK:
                    raise StageError(f"Expected regular file: {archive.member}")
                with bundle.open(member) as input_file, destination.open("xb") as output:
                    shutil.copyfileobj(input_file, output)
                if license_destination is not None:
                    license_member = bundle.getinfo(f"{archive.prefix}/LICENSE")
                    mode = license_member.external_attr >> 16
                    if license_member.is_dir() or stat.S_IFMT(mode) == stat.S_IFLNK:
                        raise StageError(f"Expected regular file: {license_member.filename}")
                    with bundle.open(license_member) as input_file, license_destination.open("xb") as output:
                        shutil.copyfileobj(input_file, output)
        else:
            raise StageError(f"Unsupported Node archive format: {archive.filename}")
    except (KeyError, OSError, tarfile.TarError, zipfile.BadZipFile, EOFError) as error:
        raise StageError(f"Extraction failed for {archive.filename}: {error}") from error
    if destination.stat().st_size == 0:
        raise StageError(f"Empty Node executable in {archive.filename}")
    destination.chmod(0o755 if os.name != "nt" else 0o644)


def stage_node_runtimes(app, archives=ARCHIVES, opener=urlopen, cache_dir=None):
    app = Path(app).resolve()
    source_root = Path(__file__).resolve().parents[1]
    if not app.is_dir():
        raise StageError(f"App directory does not exist: {app}")
    if app == source_root:
        raise StageError("Refusing to stage Node runtimes into the source tree")
    target = app / "runtime"
    if target.exists() or target.is_symlink():
        raise StageError(f"Runtime destination already exists: {target}")
    if cache_dir is not None:
        cache_dir = Path(cache_dir).resolve()
        if cache_dir.is_relative_to(app):
            raise StageError("Archive cache must be outside the staged app directory")
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise StageError(f"Cannot create archive cache {cache_dir}: {error}") from error
    with tempfile.TemporaryDirectory(prefix=".node-stage-", dir=app) as temporary:
        workspace = Path(temporary)
        staged = workspace / "runtime"
        staged.mkdir()
        for index, archive in enumerate(archives):
            package = cache_dir / archive.filename if cache_dir is not None else workspace / archive.filename
            if package.exists():
                verify_cached(archive, package)
                print(f"Staging {archive.platform} from verified cache", flush=True)
            elif cache_dir is not None:
                print(f"Downloading {archive.platform} from {archive.url}", flush=True)
                with tempfile.TemporaryDirectory(prefix=".node-download-", dir=cache_dir) as download_dir:
                    pending = Path(download_dir) / archive.filename
                    download_verified(archive, pending, opener)
                    pending.replace(package)
            else:
                print(f"Downloading {archive.platform} from {archive.url}", flush=True)
                download_verified(archive, package, opener)
            output = staged / archive.platform / archive.executable
            output.parent.mkdir()
            extract_verified(archive, package, output, staged / "LICENSE" if index == 0 else None)
            if cache_dir is None:
                package.unlink()
        (staged / "node-version.txt").write_text(NODE_VERSION + "\n", encoding="utf-8")
        if target.exists() or target.is_symlink():
            raise StageError(f"Runtime destination appeared during staging: {target}")
        try:
            staged.rename(target)
        except OSError as error:
            raise StageError(f"Cannot install runtime directory {target}: {error}") from error
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="staged portable app directory")
    parser.add_argument("--archive-cache", type=Path, default=os.environ.get("HORDE_NODE_ARCHIVE_CACHE"),
                        help="directory for checksum-verified Node archives (or HORDE_NODE_ARCHIVE_CACHE)")
    args = parser.parse_args()
    try:
        stage_node_runtimes(args.app, cache_dir=args.archive_cache)
    except StageError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
