"""Daily Time Record — QR clock-in with a server-authoritative clock.

Design decisions that the rest of this package assumes (see specs/dtr-spec.md):

* the QR poster is **static**; a scan is authenticated by the phone's GPS
  falling inside the location's geofence, not by the code being secret;
* the recorded time is **always** the server's clock — no client-supplied
  timestamp is ever written to ``dtr_logs``;
* employees never edit a log, only request a correction an admin approves;
* ``dtr_logs`` and ``audit_log`` are append-only, enforced in SQLite itself.
"""

from __future__ import annotations

__version__ = "1.0.0"


class DtrError(Exception):
    """Something the operator can fix. Rendered as one line, not a traceback."""


class ScanRejected(DtrError):
    """A scan the server refuses to record.

    ``code`` is a stable machine-readable string the PWA maps to a message;
    ``detail`` carries the numbers a supervisor needs to judge the case. Both
    leading arguments are positional-only, so a detail key may be called
    ``code`` or ``message`` without colliding with them.
    """

    def __init__(self, code: str, message: str, /, **detail: object) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


class PermissionDenied(DtrError):
    pass


class NotFound(DtrError):
    pass
