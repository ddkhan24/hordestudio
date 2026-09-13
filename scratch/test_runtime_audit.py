"""Platform discovery tests: no platform-specific binaries are executed."""
import os
from pathlib import Path
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
            with patch.dict(os.environ, {}, clear=True), patch('test_runtime.platform.system', return_value='Darwin'), patch('test_runtime.platform.machine', return_value='arm64'), patch('test_runtime.shutil.which', return_value='/fixture/path/node'):
                self.assertEqual(node_executable(root), str(binary))
            with patch.dict(os.environ, {}, clear=True), patch('test_runtime.platform.system', return_value='Linux'), patch('test_runtime.platform.machine', return_value='x86_64'), patch('test_runtime.shutil.which', return_value='/fixture/path/node'):
                self.assertEqual(node_executable(root), '/fixture/path/node')

    def test_explicit_runtime_wins(self):
        with patch.dict(os.environ, {'HORDE_NODE_EXECUTABLE': 'test-node'}, clear=True), patch('test_runtime.shutil.which', return_value='/fixture/test-node') as which:
            self.assertEqual(node_executable('/fixture'), '/fixture/test-node')
            which.assert_called_once_with('test-node')

    def test_missing_runtime_is_actionable(self):
        with patch.dict(os.environ, {}, clear=True), patch('test_runtime.shutil.which', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'Node.js 18'):
                node_executable('/fixture/nonexistent')
        with patch.dict(os.environ, {'HORDE_NODE_EXECUTABLE': 'unavailable'}, clear=True), patch('test_runtime.shutil.which', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'HORDE_NODE_EXECUTABLE'):
                node_executable('/fixture/nonexistent')


if __name__ == '__main__':
    unittest.main()
