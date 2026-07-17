"""Process-liveness check (v1.11.0 Phase 7, T704).

Split out from :mod:`single_instance` so the crash-detection / resume logic can
import it without pulling in Qt. Pure stdlib; the ``win32`` branch is guarded by
``sys.platform`` so mypy narrows it correctly on every host.
"""

from __future__ import annotations

import os
import sys


def pid_alive(pid: int) -> bool:
    """Return True when a process with `pid` is currently running."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        process_query = 0x1000  # PROCESS_QUERY_LIMITED_INFORMATION
        still_active = 259  # STILL_ACTIVE
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(process_query, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            if kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return bool(code.value == still_active)
            return True
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Exists but owned by another user -- still "alive" for our purposes.
        return True
    return True
