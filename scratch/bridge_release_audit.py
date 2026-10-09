"""Offline regressions for credential races, origin parsing, and request limits."""
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import horde_mcp_bridge as bridge


class BridgeReleaseAudit(unittest.TestCase):
    def test_concurrent_provider_updates_do_not_lose_saved_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = bridge.load_store

            def slow_read():
                value = original()
                time.sleep(0.02)
                return value

            with mock.patch.object(bridge, 'CONFIG_DIR', root), mock.patch.object(bridge, 'AUTH_FILE', root / 'auth.json'), \
                    mock.patch.object(bridge, 'load_store', side_effect=slow_read):
                start = threading.Barrier(8)
                failures = []

                def update(index):
                    try:
                        start.wait(5)
                        bridge.update_provider_record('higgsfield', {f'field{index}': index})
                    except Exception as error:
                        failures.append(error)

                threads = [threading.Thread(target=update, args=(index,)) for index in range(8)]
                for thread in threads: thread.start()
                for thread in threads: thread.join(10)
                self.assertFalse(any(thread.is_alive() for thread in threads))
                self.assertEqual(failures, [])
                self.assertEqual(bridge.provider_record('higgsfield'), {f'field{index}': index for index in range(8)})

    def test_parallel_requests_share_a_single_rotating_token_refresh(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with mock.patch.object(bridge, 'CONFIG_DIR', root), mock.patch.object(bridge, 'AUTH_FILE', root / 'auth.json'):
                bridge.update_provider_record('higgsfield', {'client': {'client_id': 'fixture'},
                    'oauthMetadata': {'token_endpoint': 'https://fixture.invalid/oauth'},
                    'tokens': {'access_token': 'expired', 'expires_at': 0, 'refresh_token': 'single-use'}})
                started = threading.Barrier(6)
                results = []

                def request(*args, **kwargs):
                    time.sleep(0.03)
                    return 200, {}, json.dumps({'access_token': 'fresh', 'refresh_token': 'rotated', 'expires_in': 3600}).encode()

                def refresh():
                    started.wait(5)
                    try: results.append(bridge.refresh_access_token('higgsfield'))
                    except Exception as error: results.append(error)

                with mock.patch.object(bridge, 'http_request', side_effect=request) as post:
                    threads = [threading.Thread(target=refresh) for _ in range(6)]
                    for thread in threads: thread.start()
                    for thread in threads: thread.join(10)
                    self.assertEqual(results, ['fresh'] * 6)
                    self.assertEqual(post.call_count, 1)

    def test_disconnect_during_refresh_cannot_restore_provider_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with mock.patch.object(bridge, 'CONFIG_DIR', root), mock.patch.object(bridge, 'AUTH_FILE', root / 'auth.json'):
                bridge.update_provider_record('higgsfield', {'client': {'client_id': 'fixture'},
                    'oauthMetadata': {'token_endpoint': 'https://fixture.invalid/oauth'},
                    'tokens': {'access_token': 'expired', 'expires_at': 0, 'refresh_token': 'old'}})

                def disconnect(*args, **kwargs):
                    bridge.update_provider_record('higgsfield', None)
                    return 200, {}, b'{"access_token":"fresh"}'

                with mock.patch.object(bridge, 'http_request', side_effect=disconnect):
                    with self.assertRaisesRegex(PermissionError, 'connection changed'):
                        bridge.refresh_access_token('higgsfield')
                self.assertEqual(bridge.provider_record('higgsfield'), {})

    def test_parallel_connects_share_one_registered_oauth_client(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            discovery = {'metadata': {'authorization_endpoint': 'https://fixture.invalid/authorize'},
                'authorizationServer': 'https://fixture.invalid', 'resource': 'https://fixture.invalid/mcp'}
            with mock.patch.object(bridge, 'CONFIG_DIR', root), mock.patch.object(bridge, 'AUTH_FILE', root / 'auth.json'), \
                    mock.patch.object(bridge, 'pending_auth', {}), \
                    mock.patch.object(bridge, 'discover_oauth', return_value=discovery), \
                    mock.patch.object(bridge, 'register_client', side_effect=lambda metadata: (time.sleep(0.03) or {'client_id': 'shared-client'})) as register:
                start = threading.Barrier(4); results = []

                def connect():
                    start.wait(5)
                    try: results.append(bridge.begin_oauth('higgsfield'))
                    except Exception as error: results.append(error)

                threads = [threading.Thread(target=connect) for _ in range(4)]
                for thread in threads: thread.start()
                for thread in threads: thread.join(10)
                self.assertEqual(len(results), 4)
                self.assertTrue(all(isinstance(url, str) and 'client_id=shared-client' in url for url in results))
                self.assertEqual(register.call_count, 1)
                self.assertEqual(len(bridge.pending_auth), 4)

    def test_lan_origins_must_be_numeric_private_addresses(self):
        handler = bridge.BridgeHandler.__new__(bridge.BridgeHandler)
        with mock.patch.object(bridge, 'REMOTE_VH2_MODE', False):
            for origin in ('http://10.attacker.example', 'http://192.168.attacker.example',
                           'http://172.16.attacker.example', 'http://203.0.113.1', 'ftp://localhost',
                           'http://user:password@localhost'):
                handler.headers = {'Origin': origin}
                self.assertFalse(handler.origin_allowed(), origin)
            for origin in ('http://localhost:43127', 'http://127.0.0.1:43127', 'http://[::1]:43127',
                           'http://10.2.3.4:43127', 'http://172.31.2.3:43127', 'http://192.168.1.2:43127'):
                handler.headers = {'Origin': origin}
                self.assertTrue(handler.origin_allowed(), origin)

    def test_negative_content_lengths_are_rejected_before_reading(self):
        for handler_type in (bridge.BridgeHandler, bridge.MultiplayerHandler):
            handler = handler_type.__new__(handler_type)
            handler.headers = {'Content-Length': '-1'}
            handler.rfile = mock.Mock()
            with self.subTest(handler=handler_type.__name__), self.assertRaisesRegex(ValueError, 'negative'):
                handler.read_json()
            handler.rfile.read.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
