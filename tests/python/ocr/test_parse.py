"""v1.16.0 Phase 3 (adoption item A5) -- the `parse` job handler.

Covers the request envelope, engine selection, the per-page progress stream (the
repo's first real producer of runtime notifications), and every error code the
sidecar renders a specific message for.
"""

from __future__ import annotations

import base64
import io

import pytest

from runtimes.ocr.parse import engine_health, run_parse

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"payload" * 4
PNG_B64 = base64.b64encode(PNG_BYTES).decode("ascii")


def make_pdf(pages: int = 3) -> str:
    pypdfium2 = pytest.importorskip("pypdfium2")
    pdf = pypdfium2.PdfDocument.new()
    for _ in range(pages):
        pdf.new_page(200, 200)
    buffer = io.BytesIO()
    pdf.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def call(request: dict, job_id: str = "job-1") -> tuple[dict, list[dict]]:
    events: list[dict] = []
    result = run_parse({"jobId": job_id, "request": request}, emit=events.append)
    return result, events


class TestEnvelope:
    def test_requires_a_job_id(self):
        result = run_parse({"request": {}}, emit=lambda _e: None)
        assert result["ok"] is False
        assert result["error"] == "invalid-job-id"

    def test_rejects_a_non_string_job_id(self):
        result = run_parse({"jobId": 7, "request": {}}, emit=lambda _e: None)
        assert result["error"] == "invalid-job-id"

    def test_requires_a_request_object(self):
        result = run_parse({"jobId": "j"}, emit=lambda _e: None)
        assert result["error"] == "invalid-params"

    def test_echoes_the_job_id_on_failure(self):
        result = run_parse({"jobId": "j9", "request": {}}, emit=lambda _e: None)
        assert result["jobId"] == "j9"


class TestStubEngine:
    def test_parses_a_single_image(self):
        result, _events = call({"documentBase64": PNG_B64, "engine": "stub"})
        assert result["ok"] is True
        assert result["engine"] == "stub"
        assert result["pageCount"] == 1
        assert "page 1" in result["text"]

    def test_emits_one_progress_event_per_page(self):
        result, events = call({"documentBase64": make_pdf(3), "engine": "stub", "dpi": 72})
        assert result["pageCount"] == 3
        progress = [(e["page"], e["totalPages"]) for e in events if e["kind"] == "progress"]
        assert progress == [(1, 3), (2, 3), (3, 3)]

    def test_progress_events_carry_the_job_id_and_stage(self):
        _result, events = call({"documentBase64": PNG_B64, "engine": "stub"}, job_id="jx")
        assert events[0]["jobId"] == "jx"
        assert events[0]["stage"] == "ocr"
        # A notification carries no `id` -- that is what makes it a notification.
        assert "id" not in events[0]

    def test_returns_per_page_records(self):
        result, _events = call({"documentBase64": make_pdf(2), "engine": "stub", "dpi": 72})
        assert [p["index"] for p in result["pages"]] == [0, 1]

    def test_honours_max_pages(self):
        result, _events = call(
            {"documentBase64": make_pdf(5), "engine": "stub", "dpi": 72, "maxPages": 2}
        )
        assert result["pageCount"] == 2

    def test_rejects_a_non_integer_max_pages(self):
        result, _events = call({"documentBase64": PNG_B64, "engine": "stub", "maxPages": "2"})
        assert result["error"] == "invalid-params"


class TestEngineSelection:
    def test_defaults_to_the_portable_engine(self):
        # No engine given -> rapidocr, which works on every host. Without the
        # model installed it reports that specifically, proving the default.
        result, _events = call({"documentBase64": PNG_B64})
        assert result["ok"] is False
        assert result["error"] in {"model-not-installed", "engine-unavailable"}

    def test_rejects_an_unknown_engine(self):
        result, _events = call({"documentBase64": PNG_B64, "engine": "nope"})
        assert result["error"] == "invalid-params"

    def test_rejects_a_non_string_engine(self):
        result, _events = call({"documentBase64": PNG_B64, "engine": 3})
        assert result["error"] == "invalid-params"

    def test_reports_a_missing_model_rather_than_crashing(self):
        result, _events = call(
            {"documentBase64": PNG_B64, "engine": "rapidocr", "modelDir": "/nonexistent-dir"}
        )
        assert result["ok"] is False
        assert result["error"] in {"model-not-installed", "engine-unavailable"}
        assert "install" in result["message"].lower() or "not installed" in result["message"].lower()

    def test_unlimited_ocr_is_unavailable_without_cuda(self):
        result, _events = call(
            {
                "documentBase64": PNG_B64,
                "engine": "unlimited-ocr",
                "modelDir": "/nonexistent-dir",
            }
        )
        assert result["ok"] is False
        # Either "not installed" or "needs an NVIDIA GPU" -- both are clean,
        # explained states rather than a crash.
        assert result["error"] in {
            "model-not-installed",
            "engine-unavailable",
            "unavailable-on-host",
        }


class TestBadInput:
    def test_rejects_bad_base64(self):
        result, _events = call({"documentBase64": "!!!", "engine": "stub"})
        assert result["error"] == "invalid-params"

    def test_rejects_a_corrupt_pdf(self):
        corrupt = base64.b64encode(b"%PDF-1.7 not a pdf").decode("ascii")
        result, _events = call({"documentBase64": corrupt, "engine": "stub"})
        assert result["error"] == "unsupported-media"

    def test_a_failure_never_raises(self):
        # The contract is a RESULT envelope with a code, never an exception --
        # the sidecar renders a specific message from the code.
        result, _events = call({"documentBase64": "", "engine": "stub"})
        assert result["ok"] is False


class TestEngineHealth:
    def test_reports_every_engine_with_a_reason(self):
        health = engine_health()
        assert set(health) == {"rapidocr", "unlimited-ocr"}
        for entry in health.values():
            assert isinstance(entry["available"], bool)
            assert isinstance(entry["reason"], str) and entry["reason"]
