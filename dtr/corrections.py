"""Correction requests — the only route by which a recorded day can change.

Employees have no edit path at all. They file a request describing what they
believe happened and why; a supervisor or admin approves or rejects it. Approval
never rewrites the original row. It appends a new one marked
``source='admin_correction'`` and points the original at it.

That gives the one honest exception to "the timestamp is always the server's
clock": a corrected row carries the time a human approved, and the ``source``
column plus the audit trail say so plainly, so nobody can mistake a corrected
entry for a scanned one.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime
from zoneinfo import ZoneInfo

from . import DtrError, NotFound, PermissionDenied
from . import audit, store

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"
CANCELLED = "cancelled"

AMEND = "amend"
ADD_MISSING = "add_missing"
VOID = "void"

MAX_REASON = 500


class CorrectionError(DtrError):
    pass


def parse_local(text: str, tz: ZoneInfo) -> datetime:
    """Read 'YYYY-MM-DD HH:MM' as a local wall clock and return it in UTC."""
    cleaned = (text or "").strip().replace("T", " ")
    try:
        naive = datetime.strptime(cleaned[:16], "%Y-%m-%d %H:%M")
    except ValueError as exc:
        raise CorrectionError("give the time as YYYY-MM-DD HH:MM") from exc
    return naive.replace(tzinfo=tz)


def submit(
    conn: sqlite3.Connection,
    *,
    employee_id: int,
    request_type: str,
    business_date: date,
    reason: str,
    dtr_log_id: int | None = None,
    requested_entry_type: str | None = None,
    requested_at: str | None = None,
) -> int:
    if request_type not in (AMEND, ADD_MISSING, VOID):
        raise CorrectionError(f"unknown correction type {request_type!r}")
    reason = (reason or "").strip()
    if len(reason) < 10:
        raise CorrectionError("give a reason of at least 10 characters — an approver has to judge it")
    if len(reason) > MAX_REASON:
        raise CorrectionError(f"keep the reason under {MAX_REASON} characters")

    if request_type in (AMEND, VOID):
        if dtr_log_id is None:
            raise CorrectionError("say which entry this is about")
        row = conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (dtr_log_id,)).fetchone()
        if row is None:
            raise NotFound("no such entry")
        if row["employee_id"] != employee_id:
            raise PermissionDenied("that entry belongs to someone else")
        if row["superseded_by_id"] is not None or row["voided_at"] is not None:
            raise CorrectionError("that entry has already been corrected")
    if request_type in (AMEND, ADD_MISSING):
        if not requested_at:
            raise CorrectionError("say what the time should be")
        if requested_entry_type not in ("time_in", "time_out"):
            raise CorrectionError("say whether this is a time in or a time out")

    duplicate = conn.execute(
        "SELECT id FROM correction_requests WHERE employee_id = ? AND business_date = ? "
        "AND status = 'pending' AND COALESCE(dtr_log_id, -1) = COALESCE(?, -1)",
        (employee_id, business_date.isoformat(), dtr_log_id),
    ).fetchone()
    if duplicate:
        raise CorrectionError(f"request #{duplicate['id']} for that day is already waiting for review")

    cursor = conn.execute(
        """
        INSERT INTO correction_requests
            (employee_id, dtr_log_id, request_type, requested_entry_type, requested_at,
             business_date, reason, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """,
        (
            employee_id, dtr_log_id, request_type, requested_entry_type, requested_at,
            business_date.isoformat(), reason, store.iso(store.now_utc()),
        ),
    )
    request_id = int(cursor.lastrowid)
    audit.record(
        conn, entity_type="correction_request", entity_id=request_id, action=audit.CREATE,
        changed_by_id=employee_id,
        new_value={"type": request_type, "business_date": business_date.isoformat(),
                   "requested_at": requested_at, "dtr_log_id": dtr_log_id},
        reason=reason,
    )
    return request_id


def get(conn: sqlite3.Connection, request_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM correction_requests WHERE id = ?", (request_id,)).fetchone()
    if row is None:
        raise NotFound(f"no correction request #{request_id}")
    return row


def pending(conn: sqlite3.Connection, *, employee_ids: list[int] | None = None) -> list[sqlite3.Row]:
    sql = (
        "SELECT c.*, e.employee_number, e.full_name, e.department "
        "FROM correction_requests c JOIN employees e ON e.id = c.employee_id "
        "WHERE c.status = 'pending'"
    )
    params: list = []
    if employee_ids is not None:
        if not employee_ids:
            return []
        sql += f" AND c.employee_id IN ({','.join('?' * len(employee_ids))})"
        params.extend(employee_ids)
    return list(conn.execute(sql + " ORDER BY c.created_at", params))


def approve(
    conn: sqlite3.Connection,
    request_id: int,
    *,
    reviewer_id: int,
    tz: ZoneInfo,
    note: str = "",
    override_time: str | None = None,
) -> int | None:
    """Apply a correction. Returns the id of the log row it created, if any."""
    request = get(conn, request_id)
    if request["status"] != PENDING:
        raise CorrectionError(f"request #{request_id} was already {request['status']}")
    if request["employee_id"] == reviewer_id:
        raise PermissionDenied("you cannot approve your own correction request")

    now = store.now_utc()
    resulting_id: int | None = None
    old_row = None
    if request["dtr_log_id"] is not None:
        old_row = conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (request["dtr_log_id"],)).fetchone()
        if old_row is None:
            raise NotFound("the entry this request refers to has gone")
        if old_row["superseded_by_id"] is not None or old_row["voided_at"] is not None:
            raise CorrectionError("that entry was already corrected by someone else")

    if request["request_type"] == VOID:
        conn.execute(
            "UPDATE dtr_logs SET voided_at = ?, voided_by_id = ? WHERE id = ?",
            (store.iso(now), reviewer_id, old_row["id"]),
        )
    else:
        corrected = parse_local(override_time or request["requested_at"], tz)
        entry_type = request["requested_entry_type"]
        day = date.fromisoformat(request["business_date"])
        source_row = old_row
        resulting_id = store.insert_log(
            conn,
            employee_id=request["employee_id"],
            entry_type=entry_type,
            recorded_at=corrected,
            business_date=day,
            location_id=source_row["location_id"] if source_row else None,
            device_id=None,
            latitude=None,
            longitude=None,
            accuracy_m=None,
            distance_m=None,
            photo_path=None,
            flags=(),
            source="admin_correction",
            created_by_id=reviewer_id,
        )
        if old_row is not None:
            conn.execute("UPDATE dtr_logs SET superseded_by_id = ? WHERE id = ?", (resulting_id, old_row["id"]))

    conn.execute(
        "UPDATE correction_requests SET status = 'approved', reviewed_by_id = ?, reviewed_at = ?, "
        "review_note = ?, resulting_log_id = ? WHERE id = ?",
        (reviewer_id, store.iso(now), note, resulting_id, request_id),
    )
    audit.record(
        conn, entity_type="dtr_log", entity_id=old_row["id"] if old_row else resulting_id,
        action=audit.APPROVE, changed_by_id=reviewer_id,
        old_value=_snapshot(old_row),
        new_value={"correction_request": request_id, "resulting_log_id": resulting_id,
                   "type": request["request_type"], "time": override_time or request["requested_at"]},
        reason=note or request["reason"],
    )
    return resulting_id


def reject(conn: sqlite3.Connection, request_id: int, *, reviewer_id: int, note: str) -> None:
    request = get(conn, request_id)
    if request["status"] != PENDING:
        raise CorrectionError(f"request #{request_id} was already {request['status']}")
    if not (note or "").strip():
        raise CorrectionError("say why it was rejected — the employee gets to see this")
    conn.execute(
        "UPDATE correction_requests SET status = 'rejected', reviewed_by_id = ?, reviewed_at = ?, "
        "review_note = ? WHERE id = ?",
        (reviewer_id, store.iso(store.now_utc()), note.strip(), request_id),
    )
    audit.record(
        conn, entity_type="correction_request", entity_id=request_id, action=audit.REJECT,
        changed_by_id=reviewer_id, old_value={"status": PENDING}, new_value={"status": REJECTED},
        reason=note.strip(),
    )


def _snapshot(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "entry_type": row["entry_type"],
        "recorded_at": row["recorded_at"],
        "business_date": row["business_date"],
        "source": row["source"],
    }
