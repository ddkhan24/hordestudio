"""Offline checks for portable reproducibility and exclusion of local state."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/portable-package.py'
SPEC = importlib.util.spec_from_file_location('portable_package', SCRIPT)
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class PortableReleaseAudit(unittest.TestCase):
    def test_runtime_staging_excludes_private_state_and_keeps_public_env_template(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / 'source', Path(directory) / 'staged'
            source.mkdir()
            for name in ('public.js', '.env.example', '.env', '.env.local', 'mcp-auth.json',
                         'always-on-queue.json', 'life.sqlite', 'life.sqlite-wal', '.DS_Store'):
                (source / name).write_text('fixture')
            for name in ('node_modules', '.wrangler', '__pycache__', '.git'):
                folder = source / name; folder.mkdir(); (folder / 'private.json').write_text('fixture')
            package.stage_tree(source, target)
            self.assertEqual({path.name for path in target.iterdir()}, {'public.js', '.env.example'})

    def test_runtime_staging_rejects_links_outside_the_source_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'source'; source.mkdir()
            (root / 'private.txt').write_text('fixture')
            (source / 'linked.js').symlink_to(root / 'private.txt')
            with self.assertRaisesRegex(ValueError, 'symlinks'):
                package.stage_tree(source, root / 'staged')
            self.assertFalse((root / 'staged').exists())

    def test_zip_is_reproducible_across_mtimes_and_preserves_launcher_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); staging = root / 'staging'; app = staging / 'Horde Studio/app'; app.mkdir(parents=True)
            (app / 'script.js').write_text('console.log("旅行 🐉");', encoding='utf-8')
            launcher = app.parent / 'Start Horde Studio.command'; launcher.write_text('#!/bin/sh\nexit 0\n')
            runtime = app / 'runtime/linux-x86_64/node'; runtime.parent.mkdir(parents=True); runtime.write_bytes(b'node fixture')
            first, second = root / 'first.zip', root / 'second.zip'
            package.write_archive(staging, first, epoch=315532800)
            for path in (launcher, runtime, app / 'script.js'):
                os.utime(path, (1800000000, 1800000000)); path.chmod(0o600)
            package.write_archive(staging, second, epoch=315532800)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertIsNone(archive.testzip())
                for name in ('Horde Studio/Start Horde Studio.command', 'Horde Studio/app/runtime/linux-x86_64/node'):
                    self.assertEqual(stat.S_IMODE(archive.getinfo(name).external_attr >> 16), 0o755)
                self.assertEqual(stat.S_IMODE(archive.getinfo('Horde Studio/app/script.js').external_attr >> 16), 0o644)

    def test_archive_refuses_private_files_links_and_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); staging = root / 'staging'; app = staging / 'Horde Studio/app'; app.mkdir(parents=True)
            output = root / 'package.zip'; secret = app / '.env'; secret.write_text('fixture')
            with self.assertRaisesRegex(ValueError, 'Non-public'):
                package.write_archive(staging, output)
            self.assertFalse(output.exists()); secret.unlink()
            (app / 'code.js').write_text('fixture')
            link = app / 'linked.js'; link.symlink_to(app / 'code.js')
            with self.assertRaisesRegex(ValueError, 'Non-public'):
                package.write_archive(staging, output)
            link.unlink(); package.write_archive(staging, output)
            before = output.read_bytes()
            with self.assertRaises(FileExistsError): package.write_archive(staging, output)
            self.assertEqual(before, output.read_bytes())
            self.assertEqual(list(root.glob('.horde-package-*.zip')), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
