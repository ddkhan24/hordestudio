#!/usr/bin/env python3
"""Offline contract checks for the Horde Studio localhost MCP bridge."""

import base64
import errno
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import horde_mcp_bridge as bridge


class McpBridgeAudit(unittest.TestCase):
    @mock.patch.object(bridge, "safe_fal_url")
    @mock.patch.object(bridge, "json_request")
    def test_fal_content_policy_errors_are_typed_and_do_not_echo_inputs(self, request, _safe):
        request.return_value = (422, {}, {"detail": [
            {"loc": ["body", "prompt"], "msg": "flagged", "type": "content_policy_violation", "input": "SECRET PROMPT"},
            {"loc": ["body", "image_url"], "msg": "flagged", "type": "content_policy_violation", "input": "SECRET IMAGE"},
        ]})
        with self.assertRaises(bridge.FalRequestError) as caught:
            bridge.fal_json_request("https://queue.fal.run/test", "key")
        self.assertEqual(caught.exception.error_type, "content_policy_violation")
        self.assertEqual(caught.exception.fields, ["image_url", "prompt"])
        self.assertNotIn("SECRET", str(caught.exception))

    @mock.patch.object(bridge, "generate_fal_video", return_value={"mediaId": "a" * 32, "mediaUrl": "/video-world-media/test.mp4"})
    def test_fal_video_jobs_complete_outside_the_request(self, generate):
        submitted = bridge.submit_fal_video_job({"apiKey": "test:key", "prompt": "A scene"})
        deadline = bridge.time.monotonic() + 1
        job = submitted
        while bridge.time.monotonic() < deadline and job["status"] not in {"completed", "failed"}:
            job = bridge.get_fal_video_job(submitted["jobId"])
            bridge.time.sleep(0.01)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["result"]["mediaId"], "a" * 32)
        self.assertEqual(generate.call_args.args[0]["latencyMode"], "queue")

    @mock.patch.object(bridge, "download_fal_video", return_value=(Path("/tmp/shot.mp4"), 4096))
    @mock.patch.object(bridge.time, "sleep")
    @mock.patch.object(bridge, "fal_json_request")
    def test_h3_max_opening_submits_t2v_and_downloads_result(self, request, _sleep, download):
        request.side_effect = [
            {"request_id": "req-1", "status_url": "https://queue.fal.run/status/req-1",
             "response_url": "https://queue.fal.run/result/req-1"},
            {"status": "COMPLETED"},
            {"video": {"url": "https://v3b.fal.media/files/shot.mp4"},
             "timings": {"inference": 2.5}},
        ]
        result = bridge.generate_fal_video({
            "apiKey": "test:key", "prompt": "A train crosses the ice.",
            "duration": 5, "resolution": "480P", "aspectRatio": "16:9", "seed": 42,
        })
        submit_url = request.call_args_list[0].args[0]
        submit_payload = request.call_args_list[0].kwargs["payload"]
        self.assertEqual(submit_url, "https://queue.fal.run/minimax/h3-max/text-to-video")
        self.assertEqual(submit_payload["aspect_ratio"], "16:9")
        self.assertEqual(submit_payload["prompt_expansion_mode"], "balanced")
        self.assertTrue(submit_payload["enable_safety_checker"])
        self.assertEqual(result["requestId"], "req-1")
        self.assertEqual(result["bytes"], 4096)
        download.assert_called_once()

    @mock.patch.object(bridge, "download_fal_video", return_value=(Path("/tmp/shot.mp4"), 4096))
    @mock.patch.object(bridge.time, "sleep")
    @mock.patch.object(bridge, "fal_json_request")
    def test_h3_max_can_disable_its_documented_safety_checker(self, request, _sleep, _download):
        request.side_effect = [
            {"request_id": "req-safe", "status_url": "https://queue.fal.run/status/req-safe",
             "response_url": "https://queue.fal.run/result/req-safe"},
            {"status": "COMPLETED"},
            {"video": {"url": "https://v3b.fal.media/files/shot.mp4"}},
        ]
        bridge.generate_fal_video({"apiKey": "test:key", "prompt": "A scene", "resolution": "480P",
                                   "enableSafetyChecker": False})
        self.assertFalse(request.call_args_list[0].kwargs["payload"]["enable_safety_checker"])

    @mock.patch.object(bridge, "download_fal_video", return_value=(Path("/tmp/shot.mp4"), 8192))
    @mock.patch.object(bridge.time, "sleep")
    @mock.patch.object(bridge, "fal_json_request")
    def test_h3_max_continuation_uses_i2v_and_disables_expansion(self, request, _sleep, _download):
        request.side_effect = [
            {"request_id": "req-2", "status_url": "https://queue.fal.run/status/req-2",
             "response_url": "https://queue.fal.run/result/req-2"},
            {"status": "COMPLETED"},
            {"video": {"url": "https://v3b.fal.media/files/shot.mp4"}},
        ]
        frame = "data:image/jpeg;base64," + base64.b64encode(b"frame").decode()
        bridge.generate_fal_video({
            "apiKey": "test:key", "prompt": "Continue the shot.", "imageDataUrl": frame,
            "duration": 10, "resolution": "768P", "aspectRatio": "16:9", "seed": 7,
        })
        submit_url = request.call_args_list[0].args[0]
        submit_payload = request.call_args_list[0].kwargs["payload"]
        self.assertEqual(submit_url, "https://queue.fal.run/minimax/h3-max/image-to-video")
        self.assertEqual(submit_payload["image_url"], frame)
        self.assertEqual(submit_payload["prompt_expansion_mode"], "disabled")
        self.assertNotIn("aspect_ratio", submit_payload)

    @mock.patch.object(bridge, "download_fal_video", return_value=(Path("/tmp/shot.mp4"), 8192))
    @mock.patch.object(bridge.time, "sleep")
    @mock.patch.object(bridge, "fal_json_request")
    def test_h3_policy_failure_falls_back_to_wan_3_with_same_frame(self, request, _sleep, _download):
        request.side_effect = [
            bridge.FalRequestError("blocked", status=422, error_type="content_policy_violation", fields=["prompt"]),
            {"request_id": "wan-1", "status_url": "https://queue.fal.run/status/wan-1",
             "response_url": "https://queue.fal.run/result/wan-1"},
            {"status": "COMPLETED"},
            {"video": {"url": "https://v3b.fal.media/files/wan.mp4"}},
        ]
        frame = "data:image/jpeg;base64," + base64.b64encode(b"frame").decode()
        result = bridge.generate_fal_video({
            "apiKey": "test:key", "prompt": "Continue coherently.", "imageDataUrl": frame,
            "models": ["minimax/h3-max", "alibaba/wan-3.0"],
            "duration": 5, "resolution": "480P", "aspectRatio": "16:9",
        })
        self.assertEqual(request.call_args_list[1].args[0], "https://queue.fal.run/alibaba/wan-3.0/image-to-video")
        self.assertEqual(request.call_args_list[1].kwargs["payload"]["start_image_url"], frame)
        self.assertTrue(request.call_args_list[1].kwargs["payload"]["enable_safety_checker"])
        self.assertEqual(result["model"], "alibaba/wan-3.0/image-to-video")
        self.assertEqual([attempt["status"] for attempt in result["attempts"]], ["failed", "completed"])

    @mock.patch.object(bridge, "download_fal_video", return_value=(Path("/tmp/shot.mp4"), 8192))
    @mock.patch.object(bridge.time, "sleep")
    @mock.patch.object(bridge, "fal_json_request")
    def test_h3_and_wan_policy_failures_reach_ltx_with_same_frame(self, request, _sleep, _download):
        request.side_effect = [
            bridge.FalRequestError("h3 blocked", status=422, error_type="content_policy_violation", fields=["prompt"]),
            bridge.FalRequestError("wan blocked", status=422, error_type="content_policy_violation", fields=["prompt"]),
            {"request_id": "ltx-2", "status_url": "https://queue.fal.run/status/ltx-2",
             "response_url": "https://queue.fal.run/result/ltx-2"},
            {"status": "COMPLETED"},
            {"video": {"url": "https://v3b.fal.media/files/ltx.mp4"}},
        ]
        frame = "data:image/jpeg;base64," + base64.b64encode(b"frame").decode()
        result = bridge.generate_fal_video({
            "apiKey": "test:key", "prompt": "Continue coherently.", "imageDataUrl": frame,
            "models": ["minimax/h3-max", "alibaba/wan-3.0", "fal-ai/ltx-2.3/fast"],
            "duration": 5, "resolution": "480P", "aspectRatio": "16:9",
        })
        self.assertEqual(request.call_args_list[2].args[0], "https://queue.fal.run/fal-ai/ltx-2.3/image-to-video/fast")
        self.assertEqual(request.call_args_list[2].kwargs["payload"]["image_url"], frame)
        self.assertEqual(result["model"], "fal-ai/ltx-2.3/image-to-video/fast")
        self.assertEqual([attempt["status"] for attempt in result["attempts"]], ["failed", "failed", "completed"])

    @mock.patch.object(bridge, "download_fal_video", return_value=(Path("/tmp/shot.mp4"), 8192))
    @mock.patch.object(bridge.time, "sleep")
    @mock.patch.object(bridge, "fal_json_request")
    def test_wan_forwards_disabled_optional_safety_checker(self, request, _sleep, _download):
        request.side_effect = [
            {"request_id": "wan-safe", "status_url": "https://queue.fal.run/status/wan-safe",
             "response_url": "https://queue.fal.run/result/wan-safe"},
            {"status": "COMPLETED"},
            {"video": {"url": "https://v3b.fal.media/files/wan.mp4"}},
        ]
        bridge.generate_fal_video({
            "apiKey": "test:key", "prompt": "A scene.", "models": ["alibaba/wan-3.0"],
            "duration": 5, "resolution": "480P", "aspectRatio": "16:9",
            "enableSafetyChecker": False,
        })
        payload = request.call_args_list[0].kwargs["payload"]
        self.assertFalse(payload["enable_safety_checker"])
        self.assertFalse(payload["enable_prompt_expansion"])

    @mock.patch.object(bridge, "download_fal_video", return_value=(Path("/tmp/shot.mp4"), 8192))
    @mock.patch.object(bridge.time, "sleep")
    @mock.patch.object(bridge, "fal_json_request")
    def test_ltx_fast_maps_horde_duration_and_generates_audio(self, request, _sleep, _download):
        request.side_effect = [
            {"request_id": "ltx-1", "status_url": "https://queue.fal.run/status/ltx-1",
             "response_url": "https://queue.fal.run/result/ltx-1"},
            {"status": "COMPLETED"},
            {"video": {"url": "https://v3b.fal.media/files/ltx.mp4"}},
        ]
        result = bridge.generate_fal_video({
            "apiKey": "test:key", "prompt": "A scene with speech.",
            "models": ["fal-ai/ltx-2.3/fast"], "duration": 5,
            "resolution": "480P", "aspectRatio": "16:9",
        })
        self.assertEqual(request.call_args_list[0].args[0], "https://queue.fal.run/fal-ai/ltx-2.3/text-to-video/fast")
        self.assertEqual(request.call_args_list[0].kwargs["payload"]["duration"], "6")
        self.assertTrue(request.call_args_list[0].kwargs["payload"]["generate_audio"])
        self.assertEqual(result["duration"], 6)

    @mock.patch.object(bridge, "download_image", return_value="data:image/jpeg;base64,result")
    @mock.patch.object(bridge, "safe_fal_url")
    @mock.patch.object(bridge, "fal_json_request")
    def test_fal_image_generation_returns_portable_data(self, request, safe, download):
        request.return_value = {"images": [{"url": "https://v3b.fal.media/files/image.jpg"}]}
        result = bridge.generate_fal_image({
            "apiKey": "test:key", "prompt": "A portrait", "model": "fal-ai/flux/schnell",
            "aspectRatio": "1:1",
        })
        self.assertEqual(result["image"], "data:image/jpeg;base64,result")
        self.assertEqual(request.call_args.args[0], "https://fal.run/fal-ai/flux/schnell")
        safe.assert_called_once_with("https://v3b.fal.media/files/image.jpg", media=True)
        download.assert_called_once()

    @mock.patch.object(bridge, "download_image", return_value="data:image/jpeg;base64,result")
    @mock.patch.object(bridge, "safe_fal_url")
    @mock.patch.object(bridge, "fal_json_request")
    def test_nano_banana_composes_multiple_reference_images(self, request, _safe, _download):
        request.return_value = {"images": [{"url": "https://v3b.fal.media/files/anchor.jpg"}]}
        reference = "data:image/jpeg;base64,YQ=="
        bridge.generate_fal_image({
            "apiKey": "test:key", "prompt": "Compose Image 1 and Image 2",
            "model": "fal-ai/nano-banana-2/edit", "aspectRatio": "16:9",
            "imageDataUrls": [reference, reference],
        })
        payload = request.call_args.kwargs["payload"]
        self.assertEqual(payload["image_urls"], [reference, reference])
        self.assertEqual(payload["resolution"], "1K")
        self.assertEqual(payload["aspect_ratio"], "16:9")

    def test_h3_and_wan_support_native_multi_reference_video(self):
        reference = "data:image/jpeg;base64,YQ=="
        endpoint, payload, _, _ = bridge._fal_video_request(
            "minimax/h3-max", {}, "Image 1 is Ada", "", [reference], 10, "480P", "16:9", 7)
        self.assertEqual(endpoint, "minimax/h3-max/reference-to-video")
        self.assertEqual(payload["reference_image_urls"], [reference])
        endpoint, payload, _, _ = bridge._fal_video_request(
            "alibaba/wan-3.0", {}, "Image 1 is Ada", "", [reference], 5, "768P", "16:9", 7)
        self.assertEqual(endpoint, "alibaba/wan-3.0/reference-to-video")
        self.assertEqual(payload["reference_image_urls"], [reference])

    def test_fal_input_contract_rejects_invalid_resolution_and_frame(self):
        with self.assertRaises(ValueError):
            bridge.generate_fal_video({"apiKey": "x", "prompt": "shot", "resolution": "4K"})
        with self.assertRaises(ValueError):
            bridge.generate_fal_video({
                "apiKey": "x", "prompt": "shot", "resolution": "480P",
                "imageDataUrl": "https://untrusted.example/frame.jpg",
            })

    def test_bundled_companion_media_is_public_and_present(self):
        media_roots = dict(bridge.STATIC_MEDIA_ROOTS)
        self.assertIn("/assets/bundled/", media_roots)
        ashlyn = media_roots["/assets/bundled/"] / "ashlyn-media"
        self.assertTrue((ashlyn / "01.jpg").is_file())
        self.assertTrue((ashlyn / "16.mp4").is_file())
        self.assertNotIn("/assets/bundled/ashlyn-social/", media_roots)

    def test_launcher_serves_every_labs_runtime_asset(self):
        expected = {
            "/labs-embedded.js",
            "/labs-embedded-worker.js",
            "/labs-needle.js",
            "/labs-needle-worker.js",
            "/labs-core.js",
            "/labs-tasks.js",
            "/labs-ui.js",
        }
        self.assertTrue(expected.issubset(bridge.STATIC_FILES))
        for path in expected:
            filename, content_type = bridge.STATIC_FILES[path]
            self.assertEqual(content_type, "text/javascript")
            self.assertTrue((bridge.APP_DIR / filename).is_file())

    @mock.patch.object(bridge, "http_request")
    @mock.patch.object(bridge, "ThreadingHTTPServer")
    def test_relaunch_reuses_an_existing_horde_bridge(self, server, request):
        server.side_effect = OSError(errno.EADDRINUSE, "busy")
        request.return_value = (
            200,
            {"Content-Type": "application/json"},
            json.dumps({
                "service": "Horde Studio MCP Bridge",
                "build": bridge.BRIDGE_BUILD,
                "appInstance": bridge.APP_INSTANCE_ID,
            }).encode(),
        )
        with mock.patch.object(sys, "argv", ["horde_mcp_bridge.py"]):
            bridge.main()

    @mock.patch.object(bridge, "http_request")
    @mock.patch.object(bridge, "ThreadingHTTPServer")
    def test_relaunch_refuses_an_unrelated_service_on_the_port(self, server, request):
        server.side_effect = OSError(errno.EADDRINUSE, "busy")
        request.return_value = (
            200,
            {"Content-Type": "application/json"},
            json.dumps({"service": "Something Else"}).encode(),
        )
        with mock.patch.object(sys, "argv", ["horde_mcp_bridge.py"]):
            with self.assertRaises(RuntimeError):
                bridge.main()

    @mock.patch.object(bridge, "http_request")
    @mock.patch.object(bridge, "ThreadingHTTPServer")
    def test_relaunch_replaces_an_old_horde_bridge_on_the_same_storage_origin(self, server, request):
        replacement = mock.Mock()
        server.side_effect = [OSError(errno.EADDRINUSE, "busy"), replacement]
        request.side_effect = [
            (
                200,
                {"Content-Type": "application/json"},
                json.dumps({
                    "service": "Horde Studio MCP Bridge",
                    "build": "older-build",
                    "appInstance": "older-copy",
                }).encode(),
            ),
            (200, {"Content-Type": "application/json"}, b'{"ok":true}'),
        ]
        with mock.patch.object(sys, "argv", ["horde_mcp_bridge.py"]):
            bridge.main()
        self.assertEqual(server.call_count, 2)
        shutdown = request.call_args_list[1]
        self.assertTrue(shutdown.args[0].endswith('/shutdown'))
        self.assertEqual(shutdown.kwargs.get('method'), 'POST')
        replacement.serve_forever.assert_called_once()

    def test_local_image_urls_are_restricted_to_the_local_network(self):
        self.assertEqual(
            bridge.loopback_base_url("http://localhost:8188/", 8188),
            "http://localhost:8188",
        )
        self.assertEqual(
            bridge.loopback_base_url("http://192.168.1.42:8188/", 8188),
            "http://192.168.1.42:8188",
        )
        self.assertEqual(
            bridge.loopback_base_url("http://[fd12:3456::42]:8188/", 8188),
            "http://[fd12:3456::42]:8188",
        )
        with self.assertRaises(ValueError):
            bridge.loopback_base_url("https://example.com/v1", 7860)
        with self.assertRaises(ValueError):
            bridge.loopback_base_url("https://8.8.8.8:8188", 8188)
        with self.assertRaises(ValueError):
            bridge.loopback_base_url("http://169.254.169.254:8188", 8188)

    @mock.patch.object(bridge.socket, "getaddrinfo")
    def test_generated_media_proxy_is_https_global_and_provider_scoped(self, lookup):
        lookup.return_value = [(2, 1, 6, "", ("93.184.216.34", 443))]
        self.assertEqual(
            bridge.safe_remote_image_url("https://cdn.gptproto.com/jobs/output.png?sig=1"),
            "https://cdn.gptproto.com/jobs/output.png?sig=1",
        )
        with self.assertRaises(ValueError):
            bridge.safe_remote_image_url("https://untrusted.example/output.png")
        with self.assertRaises(ValueError):
            bridge.safe_remote_image_url("http://gptproto.com/output.png")

    @mock.patch.object(bridge.socket, "getaddrinfo")
    def test_generated_media_proxy_rejects_private_dns_results(self, lookup):
        lookup.return_value = [(2, 1, 6, "", ("127.0.0.1", 443))]
        with self.assertRaises(ValueError):
            bridge.safe_remote_image_url("https://gptproto.com/output.png")

    def test_workflow_mapping_prefers_positive_prompt(self):
        workflow = {
            "1": {
                "class_type": "CLIPTextEncode",
                "_meta": {"title": "Negative Prompt"},
                "inputs": {"text": "bad"},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "_meta": {"title": "Positive Prompt"},
                "inputs": {"text": "old"},
            },
        }
        node, field = bridge.detect_workflow_input(
            workflow, {"CLIPTextEncode"}, ["text"]
        )
        self.assertEqual((node, field), ("2", "text"))
        self.assertTrue(bridge.set_workflow_input(workflow, node, field, "new"))
        self.assertEqual(workflow["2"]["inputs"]["text"], "new")

    @mock.patch.object(bridge, "download_image", return_value="data:image/png;base64,result")
    @mock.patch.object(bridge.time, "sleep")
    @mock.patch.object(bridge, "json_request")
    def test_comfy_generation_queues_polls_and_fetches_output(
        self, request, _sleep, download
    ):
        def response(url, method="GET", headers=None, payload=None, timeout=120):
            if url.endswith("/prompt"):
                self.assertEqual(payload["prompt"]["2"]["inputs"]["text"], "new scene")
                return 200, {}, {"prompt_id": "job-1"}
            if "/history/job-1" in url:
                return 200, {}, {
                    "job-1": {
                        "outputs": {
                            "9": {
                                "images": [{
                                    "filename": "out.png",
                                    "subfolder": "",
                                    "type": "output",
                                }]
                            }
                        }
                    }
                }
            raise AssertionError(url)

        request.side_effect = response
        result = bridge.comfy_generate({
            "baseUrl": "http://127.0.0.1:8188",
            "prompt": "new scene",
            "workflow": {
                "2": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {"text": "old"},
                }
            },
        })
        self.assertEqual(result, "data:image/png;base64,result")
        self.assertIn("/view?", download.call_args.args[0])

    @mock.patch.object(bridge, "json_request")
    def test_openai_compatible_local_image_accepts_base64(self, request):
        request.return_value = 200, {}, {
            "data": [{"b64_json": base64.b64encode(b"image").decode()}]
        }
        result = bridge.openai_local_generate({
            "baseUrl": "http://127.0.0.1:7860/v1",
            "path": "/images/generations",
            "payload": {"model": "local-model", "prompt": "portrait"},
        })
        self.assertTrue(result.startswith("data:image/png;base64,"))
        self.assertEqual(
            request.call_args.args[0],
            "http://127.0.0.1:7860/v1/images/generations",
        )

    def test_www_authenticate_resource_metadata(self):
        value = 'Bearer realm="mcp", resource_metadata="https://example.test/meta"'
        self.assertEqual(bridge.parse_www_authenticate(value), "https://example.test/meta")

    def test_well_known_candidates_keep_mcp_path(self):
        candidates = bridge.well_known_candidates(
            "https://provider.test/mcp", "oauth-protected-resource"
        )
        self.assertIn(
            "https://provider.test/.well-known/oauth-protected-resource/mcp",
            candidates,
        )

    def test_json_and_sse_mcp_responses(self):
        payload = {"jsonrpc": "2.0", "id": 9, "result": {"tools": []}}
        self.assertEqual(
            bridge.parse_mcp_body(
                {"Content-Type": "application/json"}, json.dumps(payload).encode(), 9
            ),
            {"tools": []},
        )
        sse = (
            b'event: message\n'
            b'data: {"jsonrpc":"2.0","id":9,"result":{"tools":[{"name":"image"}]}}\n\n'
        )
        result = bridge.parse_mcp_body(
            {"content-type": "text/event-stream"}, sse, 9
        )
        self.assertEqual(result["tools"][0]["name"], "image")

    def test_embedded_image_wins_without_network_download(self):
        raw = base64.b64encode(b"fake-png").decode()
        image, source = bridge.result_image({
            "content": [
                {"type": "text", "text": "Docs: https://provider.test/docs"},
                {"type": "image", "mimeType": "image/png", "data": raw},
            ]
        })
        self.assertEqual(source, "embedded")
        self.assertEqual(image, f"data:image/png;base64,{raw}")

    @mock.patch.object(bridge, "http_request")
    def test_result_image_skips_non_image_links(self, request):
        def response(url, *args, **kwargs):
            if url.endswith("/docs"):
                return 200, {"Content-Type": "text/html"}, b"<html>docs</html>"
            return 200, {"Content-Type": "image/jpeg"}, b"jpeg"

        request.side_effect = response
        image, source = bridge.result_image({
            "content": [{
                "type": "text",
                "text": "Docs https://provider.test/docs image https://cdn.test/output",
            }]
        })
        self.assertEqual(source, "https://cdn.test/output")
        self.assertTrue(image.startswith("data:image/jpeg;base64,"))

    def test_auth_store_is_owner_only_and_disconnect_removes_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            auth_file = Path(directory) / "mcp-auth.json"
            with mock.patch.object(bridge, "CONFIG_DIR", Path(directory)), \
                    mock.patch.object(bridge, "AUTH_FILE", auth_file):
                bridge.update_provider_record("higgsfield", {
                    "tokens": {"access_token": "secret"}
                })
                self.assertEqual(
                    auth_file.stat().st_mode & 0o777,
                    0o600,
                )
                bridge.update_provider_record("higgsfield", None)
                self.assertNotIn(
                    "higgsfield",
                    bridge.load_store().get("providers", {}),
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
