"""Offline HTTPS trust and actionable certificate diagnostics."""
import ast
import os
from pathlib import Path
import ssl
import sys
import types
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import Mock, patch


def functions():
    source = Path(__file__).resolve().parents[1] / 'horde_mcp_bridge.py'
    tree = ast.parse(source.read_text())
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in {'bridge_tls_context', 'bridge_urlopen'}]
    namespace = {'ssl': ssl, 'os': os, 'urllib': urllib}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)
    return namespace


class TLS(unittest.TestCase):
    def setUp(self):
        self.g = functions()

    def test_system_trust_and_installed_certifi_are_combined(self):
        context = Mock()
        with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, {'certifi': types.SimpleNamespace(where=lambda: '/trusted/certifi.pem')}), patch.object(ssl, 'create_default_context', return_value=context):
            self.assertIs(self.g['bridge_tls_context'](), context)
        context.load_verify_locations.assert_called_once_with(cafile='/trusted/certifi.pem')

    def test_explicit_ca_bundle_is_loaded_and_invalid_bundle_fails_closed(self):
        context = Mock()
        context.load_verify_locations.side_effect = OSError('not found')
        with patch.dict(os.environ, {'HORDE_CA_BUNDLE': '/trusted/company.pem'}), patch.object(ssl, 'create_default_context', return_value=context):
            with self.assertRaisesRegex(RuntimeError, 'HORDE_CA_BUNDLE'):
                self.g['bridge_tls_context']()
        context.load_verify_locations.assert_called_once_with(cafile='/trusted/company.pem')

    def test_missing_certifi_keeps_system_verification(self):
        context = ssl.create_default_context()
        with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, {'certifi': None}), patch.object(ssl, 'create_default_context', return_value=context):
            self.assertIs(self.g['bridge_tls_context'](), context)
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_issuer_failure_points_to_trust_configuration(self):
        failure = ssl.SSLCertVerificationError(1, 'unable to get local issuer certificate')
        failure.verify_code = 20
        self.g['bridge_tls_context'] = Mock()
        with patch.object(urllib.request, 'urlopen', side_effect=failure):
            with self.assertRaisesRegex(RuntimeError, 'HORDE_CA_BUNDLE') as caught:
                self.g['bridge_urlopen']('https://mcp.magnific.com')
        self.assertNotIn('expired', str(caught.exception))

    def test_https_uses_verified_context_and_http_does_not_build_one(self):
        context = ssl.create_default_context()
        self.g['bridge_tls_context'] = Mock(return_value=context)
        with patch.object(urllib.request, 'urlopen') as call:
            self.g['bridge_urlopen']('https://example.invalid', timeout=3)
            self.assertIs(call.call_args.kwargs['context'], context)
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.g['bridge_urlopen']('http://127.0.0.1', timeout=3)
            self.assertNotIn('context', call.call_args.kwargs)
        self.g['bridge_tls_context'].assert_called_once()

    def test_expired_certificate_explains_provider_repair_without_leaking_query(self):
        failure = ssl.SSLCertVerificationError(1, 'certificate has expired')
        failure.verify_code = 10
        self.g['bridge_tls_context'] = Mock()
        with patch.object(urllib.request, 'urlopen', side_effect=urllib.error.URLError(failure)):
            with self.assertRaisesRegex(RuntimeError, 'must renew') as caught:
                self.g['bridge_urlopen']('https://mcp.magnific.com/?token=SECRET')
        self.assertIn('mcp.magnific.com', str(caught.exception))
        self.assertNotIn('SECRET', str(caught.exception))
        self.assertIn('verification remains enabled', str(caught.exception))

    def test_windows_help_names_the_windows_launcher(self):
        html = (Path(__file__).resolve().parents[1] / 'index.html').read_text()
        self.assertIn('<code>Start Horde Studio.bat</code> on Windows', html)


if __name__ == '__main__':
    unittest.main(verbosity=2)
