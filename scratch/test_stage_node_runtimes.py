"""Offline checks for staging pinned Node.js binaries into portable packages."""

from dataclasses import replace
import hashlib
import importlib.util
import io
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/stage-node-runtimes.py"
SPEC = importlib.util.spec_from_file_location("stage_node_runtimes", SCRIPT)
stage = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = stage
SPEC.loader.exec_module(stage)


def archive_bytes(archive, *, missing_node=False, missing_license=False, symlink_node=False):
    members = []
    if not missing_node:
        members.append((archive.member, f"binary:{archive.platform}".encode(), symlink_node))
    if not missing_license:
        members.append((f"{archive.prefix}/LICENSE", b"Node.js test license", False))
    members.append((f"{archive.prefix}/not-packaged.txt", b"extra", False))
    output = io.BytesIO()
    if archive.filename.endswith(".zip"):
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name, contents, symlink in members:
                member = zipfile.ZipInfo(name)
                member.create_system = 3
                member.external_attr = ((stat.S_IFLNK if symlink else stat.S_IFREG) | 0o755) << 16
                bundle.writestr(member, contents)
    else:
        with tarfile.open(fileobj=output, mode="w:xz") as bundle:
            for name, contents, symlink in members:
                member = tarfile.TarInfo(name)
                if symlink:
                    member.type = tarfile.SYMTYPE
                    member.linkname = "../outside"
                else:
                    member.size = len(contents)
                    member.mode = 0o755
                bundle.addfile(member, None if symlink else io.BytesIO(contents))
    return output.getvalue()


def fixture(archives, **options):
    payloads = {archive.url: archive_bytes(archive, **options) for archive in archives}
    specs = tuple(replace(archive, sha256=hashlib.sha256(payloads[archive.url]).hexdigest())
                  for archive in archives)

    def opener(url, timeout):
        assert timeout > 0
        return io.BytesIO(payloads[url])

    return specs, opener


class StageNodeRuntimesTests(unittest.TestCase):
    def test_stages_only_six_verified_executables_and_one_license(self):
        specs, opener = fixture(stage.ARCHIVES)
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "app"
            app.mkdir()
            target = stage.stage_node_runtimes(app, specs, opener)
            expected = {Path(archive.platform) / archive.executable for archive in specs}
            expected.update((Path("LICENSE"), Path("node-version.txt")))
            self.assertEqual({path.relative_to(target) for path in target.rglob("*") if path.is_file()}, expected)
            self.assertEqual((target / "LICENSE").read_bytes(), b"Node.js test license")
            self.assertEqual((target / "node-version.txt").read_text(), "v24.21.0\n")
            for archive in specs:
                binary = target / archive.platform / archive.executable
                self.assertEqual(binary.read_bytes(), f"binary:{archive.platform}".encode())
                if sys.platform != "win32":
                    self.assertTrue(binary.stat().st_mode & stat.S_IXUSR)

    def test_checksum_mismatch_aborts_without_partial_runtime(self):
        specs, opener = fixture(stage.ARCHIVES[:2])
        specs = (specs[0], replace(specs[1], sha256="0" * 64))
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "app"
            app.mkdir()
            with self.assertRaisesRegex(stage.StageError, "SHA256 mismatch"):
                stage.stage_node_runtimes(app, specs, opener)
            self.assertEqual(list(app.iterdir()), [])

    def test_missing_executable_or_license_aborts(self):
        for options, message in (({"missing_node": True}, "Extraction failed"),
                                 ({"missing_license": True}, "Extraction failed")):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                app = Path(directory) / "app"
                app.mkdir()
                specs, opener = fixture(stage.ARCHIVES[:1], **options)
                with self.assertRaisesRegex(stage.StageError, message):
                    stage.stage_node_runtimes(app, specs, opener)
                self.assertEqual(list(app.iterdir()), [])

    def test_symlink_executable_rejected_in_tar_and_zip(self):
        for archive in (stage.ARCHIVES[0], stage.ARCHIVES[-1]):
            with self.subTest(archive=archive.filename), tempfile.TemporaryDirectory() as directory:
                app = Path(directory) / "app"
                app.mkdir()
                specs, opener = fixture((archive,), symlink_node=True)
                with self.assertRaisesRegex(stage.StageError, "Expected regular file"):
                    stage.stage_node_runtimes(app, specs, opener)
                self.assertEqual(list(app.iterdir()), [])

    def test_download_failure_aborts_without_partial_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "app"
            app.mkdir()

            def offline(url, timeout):
                raise OSError("offline")

            with self.assertRaisesRegex(stage.StageError, "Download failed"):
                stage.stage_node_runtimes(app, stage.ARCHIVES[:1], offline)
            self.assertEqual(list(app.iterdir()), [])

    def test_verified_archive_cache_supports_offline_builds(self):
        specs, opener = fixture(stage.ARCHIVES[:2])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "cache"
            first = root / "first"
            first.mkdir()
            stage.stage_node_runtimes(first, specs, opener, cache_dir=cache)
            self.assertEqual({path.name for path in cache.iterdir()}, {archive.filename for archive in specs})
            second = root / "second"
            second.mkdir()

            def offline(url, timeout):
                raise AssertionError("cache hit attempted a network request")

            stage.stage_node_runtimes(second, specs, offline, cache_dir=cache)
            self.assertEqual((second / "runtime/node-version.txt").read_text(), "v24.21.0\n")

    def test_corrupt_cached_archive_is_rejected(self):
        specs, opener = fixture(stage.ARCHIVES[:1])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "app"
            app.mkdir()
            cache = root / "cache"
            cache.mkdir()
            (cache / specs[0].filename).write_bytes(b"corrupt")
            with self.assertRaisesRegex(stage.StageError, "SHA256 mismatch for cached"):
                stage.stage_node_runtimes(app, specs, opener, cache_dir=cache)
            self.assertEqual(list(app.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
