"""v2.0.0 Phase 1 -- audio runtime JSON-RPC dispatcher.

health/version never import faster-whisper or Kokoro. transcribe/speak in
stub mode (NEXUS_AUDIO_STUB=1) return canned payloads with no weights.

Named uniquely (`test_audio_runtime.py`) so pytest's default import mode
does not collide with `tests/python/ocr/test_main.py`.
"""

from __future__ import annotations

import json

import pytest

from runtimes.audio import main


def call(payload: dict, handlers: dict, capsys: pytest.CaptureFixture[str]) -> dict:
    main.dispatch(json.dumps(payload), handlers)
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


@pytest.fixture()
def handlers() -> dict:
    return main.build_handlers()


class TestDispatcher:
    def test_registers_the_expected_methods(self, handlers):
        assert sorted(handlers) == ["health", "speak", "transcribe", "version"]

    def test_version_is_well_formed(self, handlers, capsys):
        payload = call({"jsonrpc": "2.0", "id": 1, "method": "version"}, handlers, capsys)
        assert payload["result"]["name"] == "nexus-audio-runtime"
        assert payload["result"]["protocol"] == "1"

    def test_health_answers_without_engine_deps(self, handlers, capsys):
        payload = call({"jsonrpc": "2.0", "id": 2, "method": "health"}, handlers, capsys)
        result = payload["result"]
        assert result["ok"] is True
        assert "stt" in result
        assert "tts" in result
        assert "available" in result["stt"]

    def test_unknown_method_is_method_not_found(self, handlers, capsys):
        payload = call({"jsonrpc": "2.0", "id": 3, "method": "nope"}, handlers, capsys)
        assert payload["error"]["code"] == main.METHOD_NOT_FOUND

    def test_stub_transcribe_and_speak(self, handlers, capsys, monkeypatch):
        monkeypatch.setenv("NEXUS_AUDIO_STUB", "1")
        transcribed = call(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "transcribe",
                "params": {"audioBase64": "AAAA"},
            },
            handlers,
            capsys,
        )
        assert transcribed["result"]["transcript"] == "stub transcript"
        spoken = call(
            {
                "jsonrpc": "2.0",
                "id": 5,
                "method": "speak",
                "params": {"text": "hello"},
            },
            handlers,
            capsys,
        )
        assert spoken["result"]["mimeType"] == "audio/wav"
        assert len(spoken["result"]["audioBase64"]) > 8

    def test_transcribe_requires_payload(self, handlers, capsys, monkeypatch):
        monkeypatch.setenv("NEXUS_AUDIO_STUB", "1")
        payload = call(
            {"jsonrpc": "2.0", "id": 6, "method": "transcribe", "params": {}},
            handlers,
            capsys,
        )
        assert payload["error"]["code"] == main.INTERNAL_ERROR
