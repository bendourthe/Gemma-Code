"""v2.4.4 Phase 5 (T021) -- the JSON-RPC reader must survive a running job.

Field screenshot 4b: starting a Wan clip froze the shell. `dispatch` ran each
handler to completion inline, so a CUDA job held the stdin loop for its whole
duration and every later request -- `health`, a cancel, anything -- queued
behind it. The runtime was working and indistinguishable from hung.

These tests drive `main.serve` with a fake slow handler rather than a real
pipeline, so they assert the concurrency contract without needing a GPU.
"""

from __future__ import annotations

import json
import threading
import time

import pytest

from runtimes.diffusion import main


def _lines(captured: str) -> list[dict]:
    return [json.loads(line) for line in captured.strip().splitlines() if line.strip()]


def _request(req_id, method: str, params: dict | None = None) -> str:
    payload = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        payload["params"] = params
    return json.dumps(payload) + "\n"


def test_health_answers_while_a_job_is_in_flight(capsys: pytest.CaptureFixture[str]):
    started = threading.Event()
    release = threading.Event()
    answered_during_job: list[bool] = []

    def slow_job(_params):
        started.set()
        release.wait(timeout=5)
        return {"ok": True}

    handlers = main.build_handlers()
    handlers["txt2img"] = slow_job

    def stream():
        yield _request(1, "txt2img", {"jobId": "job-1"})
        assert started.wait(timeout=5)
        yield _request(2, "health")
        deadline = time.monotonic() + 5
        seen = False
        while time.monotonic() < deadline and not seen:
            for payload in _lines(capsys.readouterr().out):
                if payload.get("id") == 2 and "result" in payload:
                    seen = True
            time.sleep(0.01)
        answered_during_job.append(seen)
        release.set()

    main.serve(stream(), handlers)

    # This is the whole point: the control plane stayed answerable while the
    # job was still inside its handler.
    assert answered_during_job == [True]


def test_control_methods_stay_on_the_reader_thread():
    # health and version are microsecond lookups and are how a caller asks
    # whether the runtime is alive, so they must never be queued behind work.
    assert "health" in main.CONTROL_METHODS
    assert "version" in main.CONTROL_METHODS
    assert "txt2img" not in main.CONTROL_METHODS
    assert "video_text2video" not in main.CONTROL_METHODS


def test_heartbeat_emits_progress_notifications_until_done(
    capsys: pytest.CaptureFixture[str],
):
    done = threading.Event()
    beat = threading.Thread(
        target=main.heartbeat_while,
        args=("job-7", "video_text2video", done),
        kwargs={"interval": 0.01},
        daemon=True,
    )
    beat.start()
    time.sleep(0.08)
    done.set()
    beat.join(timeout=2)

    notifications = [
        payload
        for payload in _lines(capsys.readouterr().out)
        if payload.get("method") == "progress"
    ]
    assert notifications, "a long job must say something before it completes"
    first = notifications[0]
    # A notification, not a response: no `id`, so nothing is waiting on it.
    assert "id" not in first
    assert first["params"]["kind"] == "progress"
    assert first["params"]["jobId"] == "job-7"
    assert first["params"]["method"] == "video_text2video"
    assert first["params"]["elapsedS"] > 0


def test_heartbeat_stops_when_the_job_finishes(capsys: pytest.CaptureFixture[str]):
    done = threading.Event()
    beat = threading.Thread(
        target=main.heartbeat_while,
        args=("job-8", "txt2img", done),
        kwargs={"interval": 0.01},
        daemon=True,
    )
    beat.start()
    done.set()
    beat.join(timeout=2)
    assert not beat.is_alive()


def test_malformed_lines_still_produce_the_same_parse_error(
    capsys: pytest.CaptureFixture[str],
):
    # Unparseable input has no method to route on, so it stays on the inline
    # path and keeps the error envelope it has always returned.
    main.serve(iter(["{not json\n"]), main.build_handlers())
    payload = _lines(capsys.readouterr().out)[-1]
    assert payload["error"]["code"] == main.PARSE_ERROR


def test_serve_waits_for_accepted_work_when_stdin_closes(
    capsys: pytest.CaptureFixture[str],
):
    finished = threading.Event()

    def slow_job(_params):
        time.sleep(0.05)
        finished.set()
        return {"ok": True}

    handlers = main.build_handlers()
    handlers["txt2img"] = slow_job

    main.serve(iter([_request(1, "txt2img", {"jobId": "job-9"})]), handlers)

    # A job the caller is still waiting on must not be truncated just because
    # the reader reached end of input.
    assert finished.is_set()
    ids = [payload.get("id") for payload in _lines(capsys.readouterr().out)]
    assert 1 in ids
