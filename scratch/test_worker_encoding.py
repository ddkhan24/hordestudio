"""Worker pipe regression tests, including legacy Windows locale behavior.

Run with: python3 -m unittest discover -s scratch -p test_worker_encoding.py
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from virtual_humans.backend.vh2_runtime import KERNEL_VERSION, WorldService


class WorkerEncodingTests(unittest.TestCase):
    def run_kernel(self, stdout, stderr=b"", status=0):
        # A Python fixture stands in for Node so the test needs no Node install.
        # It writes raw bytes, independently of the OS and Python IO locale.
        with tempfile.TemporaryDirectory() as folder:
            worker = Path(folder) / "virtual_humans/engine/vh2-kernel-worker.js"
            worker.parent.mkdir(parents=True)
            worker.write_text(
                "import sys\n"
                f"sys.stdout.buffer.write({stdout!r})\n"
                f"sys.stderr.buffer.write({stderr!r})\n"
                f"sys.exit({status})\n", encoding="utf-8")
            service = WorldService.__new__(WorldService)
            service.node = sys.executable
            service.app_dir = Path(folder)
            service.kernel_sources = (str(worker.relative_to(folder)),)
            service.source_fingerprint = service.kernel_fingerprint()
            # Match the fallback that caused Windows worker-reader failures.
            real_run = subprocess.run

            def windows_locale_run(*args, **kwargs):
                kwargs.setdefault("encoding", "cp1252")
                return real_run(*args, **kwargs)

            with patch.object(subprocess, "run", side_effect=windows_locale_run):
                return service.kernel({"text": "旅行 🐉"})

    def test_unicode_json_survives_legacy_windows_locale(self):
        expected = {"kernelVersion": KERNEL_VERSION, "text": "旅行 🐉 café"}
        result = self.run_kernel(json.dumps(expected, ensure_ascii=False).encode("utf-8"))
        self.assertEqual(result, expected)

    def test_malformed_diagnostics_do_not_hide_worker_failure(self):
        with self.assertRaisesRegex(RuntimeError, "VH2 kernel failed: café.*") as error:
            self.run_kernel(b"", "café".encode("utf-8") + b"\xff", status=1)
        self.assertIn("\ufffd", str(error.exception))


if __name__ == "__main__":
    unittest.main()
