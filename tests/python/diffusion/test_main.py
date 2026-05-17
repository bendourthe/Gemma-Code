"""Tests for the diffusion sidecar JSON-RPC dispatcher.

The dispatcher is exercised end-to-end via stdin/stdout without
spawning a real process: tests call `main.dispatch` directly with
hand-crafted lines and capture stdout.
"""

from __future__ import annotations

import io
import json

import pytest

from runtimes.diffusion import main


def call(line: str, handlers: dict, capsys: pytest.CaptureFixture[str]) -> dict:
    main.dispatch(line, handlers)
    captured = capsys.readouterr()
    out = captured.out.strip().splitlines()[-1]
    return json.loads(out)


def test_health_returns_well_formed_response(capsys: pytest.CaptureFixture[str]):
    handlers = main.build_handlers()
    payload = call(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "health"}), handlers, capsys)
    assert payload["id"] == 1
    assert payload["result"]["ok"] is True
    assert "torch" in payload["result"]
    assert "cuda" in payload["result"]
    assert "device" in payload["result"]


def test_version_returns_runtime_and_protocol(capsys: pytest.CaptureFixture[str]):
    handlers = main.build_handlers()
    payload = call(json.dumps({"jsonrpc": "2.0", "id": 7, "method": "version"}), handlers, capsys)
    assert payload["id"] == 7
    assert payload["result"]["name"] == "nexus-diffusion-runtime"
    assert payload["result"]["protocol"] == "1"


def test_unknown_method_yields_method_not_found(capsys: pytest.CaptureFixture[str]):
    handlers = main.build_handlers()
    payload = call(
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "no-such-method"}), handlers, capsys
    )
    assert payload["error"]["code"] == main.METHOD_NOT_FOUND


def test_parse_error_for_malformed_json(capsys: pytest.CaptureFixture[str]):
    handlers = main.build_handlers()
    main.dispatch("{not-json", handlers)
    captured = capsys.readouterr()
    out = json.loads(captured.out.strip().splitlines()[-1])
    assert out["error"]["code"] == main.PARSE_ERROR


def test_invalid_request_for_missing_method(capsys: pytest.CaptureFixture[str]):
    handlers = main.build_handlers()
    main.dispatch(json.dumps({"jsonrpc": "2.0", "id": 3}), handlers)
    captured = capsys.readouterr()
    out = json.loads(captured.out.strip().splitlines()[-1])
    assert out["error"]["code"] == main.INVALID_REQUEST


def test_invalid_params(capsys: pytest.CaptureFixture[str]):
    handlers = main.build_handlers()
    main.dispatch(
        json.dumps({"jsonrpc": "2.0", "id": 4, "method": "health", "params": "not-an-object"}),
        handlers,
    )
    captured = capsys.readouterr()
    out = json.loads(captured.out.strip().splitlines()[-1])
    assert out["error"]["code"] == main.INVALID_REQUEST


def test_handler_exception_yields_internal_error(capsys: pytest.CaptureFixture[str]):
    def boom(_params):
        raise RuntimeError("kaboom")

    handlers = {"boom": boom}
    main.dispatch(json.dumps({"jsonrpc": "2.0", "id": 5, "method": "boom"}), handlers)
    captured = capsys.readouterr()
    out = json.loads(captured.out.strip().splitlines()[-1])
    assert out["error"]["code"] == main.INTERNAL_ERROR
    assert "kaboom" in out["error"]["message"]


def test_main_reads_stdin_and_writes_stdout(monkeypatch, capsys: pytest.CaptureFixture[str]):
    monkeypatch.setattr(
        "sys.stdin",
        io.StringIO(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "version"}) + "\n"),
    )
    rc = main.main()
    assert rc == 0
    captured = capsys.readouterr()
    body = json.loads(captured.out.strip())
    assert body["id"] == 1
    assert body["result"]["name"] == "nexus-diffusion-runtime"
