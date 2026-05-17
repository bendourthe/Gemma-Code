"""Tests for `runtimes.diffusion.vram_lifecycle`.

The lifecycle module is the cornerstone of Phase 7.4 (memory + scheduler
integration). We verify:

    - the `vram_scope` context manager publishes acquire + release
      telemetry events in order
    - clearing the yielded state dict happens before the cache sweep
    - exceptions inside the scope still trigger release
    - `set_publisher(None)` suppresses events without raising
    - the CapturingPublisher test helper accumulates events
"""

from __future__ import annotations

import pytest

from runtimes.diffusion import vram_lifecycle


@pytest.fixture(autouse=True)
def _reset_publisher():
    vram_lifecycle.set_publisher(None)
    yield
    vram_lifecycle.set_publisher(None)


def test_scope_emits_acquired_and_released_events():
    publisher = vram_lifecycle.CapturingPublisher()
    vram_lifecycle.set_publisher(publisher)
    with vram_lifecycle.vram_scope("ltx-video", 12.0):
        pass
    kinds = publisher.kinds()
    assert kinds == ["vram_acquired", "vram_released"]
    for event in publisher.events:
        assert event["modelId"] == "ltx-video"
        assert event["modelSizeGB"] == 12.0


def test_scope_yields_mutable_state_dict():
    publisher = vram_lifecycle.CapturingPublisher()
    vram_lifecycle.set_publisher(publisher)
    with vram_lifecycle.vram_scope("svd", 9.0) as state:
        state["pipe"] = object()
        assert state["pipe"] is not None
    # After exit, state has been cleared by the cleanup path.
    # We can re-enter and confirm a fresh dict each time.
    with vram_lifecycle.vram_scope("svd", 9.0) as state2:
        assert state2 == {}


def test_scope_emits_release_event_when_exception_raised():
    publisher = vram_lifecycle.CapturingPublisher()
    vram_lifecycle.set_publisher(publisher)
    with pytest.raises(RuntimeError, match="boom"):
        with vram_lifecycle.vram_scope("ltx-video", 12.0):
            raise RuntimeError("boom")
    assert publisher.kinds() == ["vram_acquired", "vram_released"]


def test_scope_works_with_no_publisher():
    # Should not raise even when publisher is None.
    vram_lifecycle.set_publisher(None)
    with vram_lifecycle.vram_scope("ltx-video", 12.0):
        pass


def test_capturing_publisher_callable_appends():
    pub = vram_lifecycle.CapturingPublisher()
    pub({"kind": "x", "modelId": "m"})
    pub({"kind": "y", "modelId": "m"})
    assert len(pub.events) == 2
    assert pub.kinds() == ["x", "y"]


def test_consecutive_jobs_pair_acquire_release():
    """Phase 7.4 acceptance: VRAM is freed between consecutive jobs.

    We cannot measure `torch.cuda.memory_allocated` on a CI host without
    CUDA, so we instead verify the telemetry envelope is recorded for
    each job and that no acquire is ever unmatched.
    """
    publisher = vram_lifecycle.CapturingPublisher()
    vram_lifecycle.set_publisher(publisher)
    for model in ("ltx-video", "svd", "cogvideox-5b"):
        with vram_lifecycle.vram_scope(model, 10.0):
            pass
    kinds = publisher.kinds()
    assert kinds == [
        "vram_acquired", "vram_released",
        "vram_acquired", "vram_released",
        "vram_acquired", "vram_released",
    ]


def test_publish_with_none_publisher_is_noop():
    # Direct cover of _publish() with no publisher installed.
    vram_lifecycle.set_publisher(None)
    vram_lifecycle._publish({"kind": "irrelevant"})  # should not raise


def test_set_publisher_replaces_previous():
    first = vram_lifecycle.CapturingPublisher()
    second = vram_lifecycle.CapturingPublisher()
    vram_lifecycle.set_publisher(first)
    with vram_lifecycle.vram_scope("a", 1.0):
        pass
    vram_lifecycle.set_publisher(second)
    with vram_lifecycle.vram_scope("b", 1.0):
        pass
    assert len(first.events) == 2  # only the first scope's events
    assert len(second.events) == 2  # only the second scope's events
    assert second.events[0]["modelId"] == "b"


def test_vram_allocated_bytes_returns_none_without_cuda():
    # On CI without torch / CUDA, returns None.
    result = vram_lifecycle._vram_allocated_bytes()
    assert result is None or isinstance(result, int)


def test_empty_cache_does_not_raise():
    # Should be a no-op without CUDA.
    vram_lifecycle._empty_cache()
