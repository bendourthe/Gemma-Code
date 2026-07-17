"""Background continuation (v1.11.0 Phase 7, D4).

The install engine already runs in a QThread and emits a rich signal surface
(step + per-model telemetry). This package makes that surface *survive the
window*: it persists progress to a state file (:mod:`state_store`), lets the UI
detach to a system-tray icon (:mod:`tray`) and reattach (:mod:`single_instance`),
and turns a crashed / interrupted run into a resume-or-restart decision on the
next launch (:mod:`resume`, :mod:`startup`).

Everything here is deliberately split into Qt-free logic (state, resume, startup
decisions, tooltip formatting, process liveness) and a thin Qt wiring layer
(the local-socket server, the tray icon), so the decision logic is unit-testable
without a display and the Qt glue stays small.
"""

from __future__ import annotations
