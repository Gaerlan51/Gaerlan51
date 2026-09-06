"""The audit trail.

Every write that a person could later dispute goes through :func:`record`.
Values are stored as JSON so a diff can be rendered without guessing types.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

CREATE = "create"
UPDATE = "update"
APPROVE = "approve"
REJECT = "reject"
LOGIN = "login"
LOGIN_FAILED = "login_failed"
BIND_DEVICE = "bind_device"
RESET_DEVICE = "reset_device"
SCAN_REJECTED = "scan_rejected"
PURGE = "purge"


def _dump(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, default=str, sort_keys=True)


def record(
    conn: sqlite3.Connection,
    *,
    entity_type: str,
    entity_id: str | int,
    action: str,
    changed_by_id: int | None = None,
    old_value: Any = None,
    new_value: Any = None,
    reason: str = "",
    ip_address: str | None = None,
    now: datetime | None = None,
) -> int:
    cursor = conn.execute(
        """
        INSERT INTO audit_log
            (entity_type, entity_id, action, changed_by_id,
             old_value, new_value, reason, ip_address, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entity_type,
            str(entity_id),
            action,
            changed_by_id,
            _dump(old_value),
            _dump(new_value),
            reason,
            ip_address,
            (now or datetime.now(timezone.utc)).isoformat(),
        ),
    )
    return int(cursor.lastrowid)


def for_entity(conn: sqlite3.Connection, entity_type: str, entity_id: str | int) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC",
            (entity_type, str(entity_id)),
        )
    )
