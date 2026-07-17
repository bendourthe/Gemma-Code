"""v1.11.0 Phase 7 (T703/T705) -- single-instance reattach handshake."""

from __future__ import annotations

from nexus_installer.background.single_instance import (
    SingleInstanceServer,
    signal_running_instance,
)


class TestReattachHandshake:
    def test_second_launch_signals_primary_to_show(self, qt_app: object) -> None:
        key = "nexus-installer-phase7-test-show"
        server = SingleInstanceServer(key)
        assert server.listening is True
        fired: list[bool] = []
        server.show_requested.connect(lambda: fired.append(True))
        try:
            # A "second launch" connects to the listening primary...
            assert signal_running_instance(key, timeout_ms=1000) is True
            # ...and the primary emits show_requested once the event loop turns.
            for _ in range(50):
                qt_app.processEvents()  # type: ignore[attr-defined]
                if fired:
                    break
            assert fired == [True]
        finally:
            server.close()

    def test_no_primary_returns_false(self, qt_app: object) -> None:
        assert (
            signal_running_instance(
                "nexus-installer-phase7-absent-key", timeout_ms=200
            )
            is False
        )

    def test_closed_primary_no_longer_answers(self, qt_app: object) -> None:
        key = "nexus-installer-phase7-test-closed"
        server = SingleInstanceServer(key)
        assert server.listening is True
        server.close()
        assert signal_running_instance(key, timeout_ms=200) is False
