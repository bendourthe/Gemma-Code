"""Single-instance reattach handshake (v1.11.0 Phase 7, T703).

A second launch of the installer connects to the first's :class:`QLocalServer`
and asks it to raise its window, then exits -- so relaunching never starts a
duplicate install; it reattaches to the live one. The pure process-liveness
helper lives in :mod:`nexus_installer.background.process` so crash-detection can
use it without importing Qt; this module owns the Qt local-socket wiring.
"""

from __future__ import annotations

from PyQt5.QtCore import QObject, pyqtSignal
from PyQt5.QtNetwork import QLocalServer, QLocalSocket

from nexus_installer.background.process import pid_alive

__all__ = [
    "SHOW_MESSAGE",
    "SingleInstanceServer",
    "pid_alive",
    "signal_running_instance",
]

#: Message the secondary process sends to ask the primary to show its window.
SHOW_MESSAGE = "SHOW"


def signal_running_instance(
    key: str, *, message: str = SHOW_MESSAGE, timeout_ms: int = 500
) -> bool:
    """Try to hand off to an already-running instance listening on `key`.

    Returns True when a primary was found and the show request was delivered
    (the caller should then exit); False when no primary is listening (the
    caller should become the primary).
    """
    socket = QLocalSocket()
    socket.connectToServer(key)
    if not socket.waitForConnected(timeout_ms):
        return False
    socket.write((message + "\n").encode("utf-8"))
    socket.flush()
    socket.waitForBytesWritten(timeout_ms)
    socket.disconnectFromServer()
    return True


class SingleInstanceServer(QObject):
    """Primary-process listener: emits :data:`show_requested` when a second
    launch asks to reattach (T703)."""

    show_requested = pyqtSignal()

    def __init__(self, key: str, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._key = key
        self._server = QLocalServer(self)
        # Clear a stale socket file left by a crashed primary so listen() works.
        QLocalServer.removeServer(key)
        self._listening = self._server.listen(key)
        self._server.newConnection.connect(self._on_new_connection)

    @property
    def listening(self) -> bool:
        return self._listening

    def _on_new_connection(self) -> None:
        conn = self._server.nextPendingConnection()
        if conn is None:
            return
        # We only need the fact of the connection; the message is advisory.
        self.show_requested.emit()
        conn.disconnectFromServer()

    def close(self) -> None:
        self._server.close()
