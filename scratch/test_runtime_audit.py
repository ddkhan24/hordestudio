"""Platform discovery tests: no platform-specific binaries are executed."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from test_runtime import node_executable


class RuntimeDiscovery(unittest.TestCase):
    def test_bundled_runtime_only_matches_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = root / 'runtime/darwin-arm64/node'
            binary.parent.mkdir(parents=True)
            binary.write_text('fixture')
            binary.chmod(0o755)
            with patch.dict(os.environ, {}, clear=True), patch('test_runtime.platform.system', return_value='Darwin'), patch('test_runtime.platform.machine', return_value='arm64'), patch('test_runtime.shutil.which', return_value='/fixture/path/node'), patch('test_runtime._supported_node', return_value=True):
                self.assertEqual(node_executable(root), str(binary))
            with patch.dict(os.environ, {}, clear=True), patch('test_runtime.platform.system', return_value='Linux'), patch('test_runtime.platform.machine', return_value='x86_64'), patch('test_runtime.shutil.which', return_value='/fixture/path/node'), patch('test_runtime._supported_node', side_effect=lambda candidate: candidate == '/fixture/path/node'):
                self.assertEqual(node_executable(root), '/fixture/path/node')

    def test_explicit_runtime_wins(self):
        with patch.dict(os.environ, {'HORDE_NODE_EXECUTABLE': 'test-node'}, clear=True), patch('test_runtime.shutil.which', return_value='/fixture/test-node') as which, patch('test_runtime._supported_node', return_value=True):
            self.assertEqual(node_executable('/fixture'), '/fixture/test-node')
            which.assert_any_call('test-node')

    def test_source_checkout_env_and_macos_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / '.env').write_text('HORDE_NODE_EXECUTABLE="/fixture/configured-node"\n')
            with patch.dict(os.environ, {}, clear=True), patch('test_runtime.platform.system', return_value='Darwin'), patch('test_runtime.shutil.which', return_value=None), patch('test_runtime._supported_node', side_effect=lambda candidate: candidate == '/fixture/configured-node'):
                self.assertEqual(node_executable(root), '/fixture/configured-node')
            (root / '.env').unlink()
            with patch.dict(os.environ, {}, clear=True), patch('test_runtime.platform.system', return_value='Darwin'), patch('test_runtime.shutil.which', return_value=None), patch('test_runtime._supported_node', side_effect=lambda candidate: candidate == '/opt/homebrew/bin/node'):
                self.assertEqual(node_executable(root), '/opt/homebrew/bin/node')

    def test_rejects_old_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / 'node'
            binary.write_text('fixture')
            binary.chmod(0o755)
            from test_runtime import _supported_node
            _supported_node.cache_clear()
            with patch('test_runtime.subprocess.run', return_value=subprocess.CompletedProcess([], 0, 'v16.20.0\n', '')):
                self.assertFalse(_supported_node(str(binary)))
            _supported_node.cache_clear()
            with patch('test_runtime.subprocess.run', return_value=subprocess.CompletedProcess([], 0, 'v24.21.0\n', '')):
                self.assertTrue(_supported_node(str(binary)))
            _supported_node.cache_clear()

    def test_missing_runtime_is_actionable(self):
        with patch.dict(os.environ, {}, clear=True), patch('test_runtime.shutil.which', return_value=None), patch('test_runtime._supported_node', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'Node.js 18'):
                node_executable('/fixture/nonexistent')
        with patch.dict(os.environ, {'HORDE_NODE_EXECUTABLE': 'unavailable'}, clear=True), patch('test_runtime.shutil.which', return_value=None), patch('test_runtime._supported_node', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'HORDE_NODE_EXECUTABLE'):
                node_executable('/fixture/nonexistent')


if __name__ == '__main__':
    unittest.main()
