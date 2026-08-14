"""v1.16.0 Phase 3 (adoption item A5) -- JSON-RPC dispatcher + device gating.

Mirrors `tests/python/diffusion/test_main.py`: drive `dispatch()` directly and
read the emitted line from `capsys`, so no subprocess is spawned.
"""

from __future__ import annotations

import base64
import json

import pytest

from runtimes.ocr import device, main

PNG_B64 = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 32).decode("ascii")


def call(payload: dict, handlers: dict, capsys: pytest.CaptureFixture[str]) -> dict:
    main.dispatch(json.dumps(payload), handlers)
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


@pytest.fixture()
def handlers() -> dict:
    return main.build_handlers()


class TestDispatcher:
    def test_registers_the_expected_methods(self, handlers):
        assert sorted(handlers) == ["health", "parse", "version"]

    def test_version_is_well_formed(self, handlers, capsys):
        payload = call({"jsonrpc": "2.0", "id": 1, "method": "version"}, handlers, capsys)
        assert payload["result"]["name"] == "nexus-ocr-runtime"
        assert payload["result"]["protocol"] == "1"

    def test_health_answers_without_any_engine_dependency(self, handlers, capsys):
        payload = call({"jsonrpc": "2.0", "id": 2, "method": "health"}, handlers, capsys)
        result = payload["result"]
        assert result["ok"] is True
        assert "engines" in result
        assert "platform" in result

    def test_unknown_method_is_method_not_found(self, handlers, capsys):
        payload = call({"jsonrpc": "2.0", "id": 3, "method": "nope"}, handlers, capsys)
        assert payload["error"]["code"] == main.METHOD_NOT_FOUND

    def test_malformed_json_is_a_parse_error(self, handlers, capsys):
        main.dispatch("{not json", handlers)
        payload = json.loads(capsys.readouterr().out.strip())
        assert payload["error"]["code"] == main.PARSE_ERROR

    def test_a_non_object_request_is_invalid(self, handlers, capsys):
        main.dispatch("[1,2,3]", handlers)
        payload = json.loads(capsys.readouterr().out.strip())
        assert payload["error"]["code"] == main.INVALID_REQUEST

    def test_a_non_string_method_is_invalid(self, handlers, capsys):
        payload = call({"jsonrpc": "2.0", "id": 4, "method": 7}, handlers, capsys)
        assert payload["error"]["code"] == main.INVALID_REQUEST

    def test_non_object_params_are_invalid(self, handlers, capsys):
        payload = call(
            {"jsonrpc": "2.0", "id": 5, "method": "health", "params": []}, handlers, capsys
        )
        assert payload["error"]["code"] == main.INVALID_REQUEST

    def test_parse_round_trips_through_the_dispatcher(self, handlers, capsys):
        payload = call(
            {
                "jsonrpc": "2.0",
                "id": 6,
                "method": "parse",
                "params": {
                    "jobId": "j1",
                    "request": {"documentBase64": PNG_B64, "engine": "stub"},
                },
            },
            handlers,
            capsys,
        )
        # The progress notification precedes the reply; `call` reads the LAST
        # line, which is the JSON-RPC result.
        assert payload["result"]["ok"] is True
        assert payload["result"]["engine"] == "stub"

    def test_a_failed_parse_is_a_result_not_a_jsonrpc_error(self, handlers, capsys):
        payload = call(
            {
                "jsonrpc": "2.0",
                "id": 7,
                "method": "parse",
                "params": {"jobId": "j2", "request": {"documentBase64": "!!!"}},
            },
            handlers,
            capsys,
        )
        assert "error" not in payload
        assert payload["result"]["ok"] is False
        assert payload["result"]["error"] == "invalid-params"


class TestDeviceGating:
    def _info(self, **over) -> device.DeviceInfo:
        base = {
            "torch_version": "2.5.0",
            "cuda_version": "12.4",
            "device_name": "NVIDIA RTX 4090",
            "vram_total_gb": 24.0,
            "vram_free_gb": 20.0,
            "platform_system": "Linux",
            "platform_machine": "x86_64",
        }
        base.update(over)
        return device.DeviceInfo(**base)

    def test_detect_never_raises_and_reports_the_platform(self):
        info = device.detect()
        assert info.platform_system
        assert info.platform_machine

    def test_no_torch_means_the_vlm_is_unavailable(self):
        result = device.unlimited_ocr_availability(self._info(torch_version="absent"))
        assert result.available is False
        assert "PyTorch" in result.reason

    def test_no_cuda_points_the_user_at_the_portable_model(self):
        result = device.unlimited_ocr_availability(
            self._info(cuda_version="absent", platform_system="Darwin", platform_machine="arm64")
        )
        assert result.available is False
        assert "NVIDIA-only" in result.reason
        assert "RapidOCR" in result.reason
        # The message names the host so a Mac user understands why.
        assert "Darwin/arm64" in result.reason

    def test_too_little_vram_is_a_distinct_reason(self):
        result = device.unlimited_ocr_availability(self._info(vram_total_gb=6.0))
        assert result.available is False
        assert "VRAM" in result.reason
        assert "6.0" in result.reason

    def test_a_capable_cuda_host_is_available(self):
        result = device.unlimited_ocr_availability(
            self._info(), module_present=lambda _n: True
        )
        assert result.available is True

    def test_a_missing_dependency_is_reported_only_once_hardware_is_fine(self):
        result = device.unlimited_ocr_availability(
            self._info(), module_present=lambda _n: False
        )
        assert result.available is False
        assert "transformers" in result.reason

    def test_hardware_outranks_a_missing_dependency(self):
        # No GPU AND no transformers: the user must hear about the GPU, because
        # installing transformers would not make this model usable.
        result = device.unlimited_ocr_availability(
            self._info(cuda_version="absent"), module_present=lambda _n: False
        )
        assert "NVIDIA-only" in result.reason
        assert "transformers" not in result.reason

    def test_the_vram_gate_matches_the_catalog_entry(self):
        # Guards against the runtime and catalog.json drifting apart.
        assert device.UNLIMITED_OCR_REQUIRED_VRAM_GB == 12.0

    def test_engine_availability_covers_both_engines(self):
        result = device.engine_availability(self._info())
        assert set(result) == {"rapidocr", "unlimited-ocr"}
