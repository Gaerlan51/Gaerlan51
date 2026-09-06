"""Queries. Thin, explicit SQL — no ORM to hide what touches the log table."""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timezone
from typing import Iterable

from . import NotFound
from .timerules import DEFAULT_SHIFT, Shift


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def parse_iso(text: str | None) -> datetime | None:
    if not text:
        return None
    moment = datetime.fromisoformat(text)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


# ------------------------------------------------------------- employees


def get_employee(conn: sqlite3.Connection, employee_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM employees WHERE id = ?", (employee_id,)).fetchone()
    if row is None:
        raise NotFound(f"no employee with id {employee_id}")
    return row


def find_employee_by_number(conn: sqlite3.Connection, number: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM employees WHERE employee_number = ? COLLATE NOCASE", (number.strip(),)
    ).fetchone()


def list_employees(
    conn: sqlite3.Connection, *, status: str | None = "active", department: str | None = None
) -> list[sqlite3.Row]:
    sql = "SELECT * FROM employees WHERE 1 = 1"
    params: list = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    if department:
        sql += " AND department = ?"
        params.append(department)
    return list(conn.execute(sql + " ORDER BY full_name", params))


def shift_for(conn: sqlite3.Connection, employee: sqlite3.Row) -> Shift:
    if employee["shift_id"] is None:
        return DEFAULT_SHIFT
    row = conn.execute("SELECT * FROM shifts WHERE id = ?", (employee["shift_id"],)).fetchone()
    return Shift.from_row(row) if row else DEFAULT_SHIFT


def team_of(conn: sqlite3.Connection, supervisor_id: int) -> list[int]:
    rows = conn.execute(
        "SELECT id FROM employees WHERE supervisor_id = ? AND status = 'active'", (supervisor_id,)
    )
    return [r["id"] for r in rows]


# -------------------------------------------------------------- locations


def get_location_by_code(conn: sqlite3.Connection, code: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM locations WHERE qr_code_id = ?", (code,)).fetchone()


def list_locations(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return list(conn.execute("SELECT * FROM locations ORDER BY name"))


# ------------------------------------------------------------------- logs


# A log row stops counting when it is replaced by a correction or voided.
# It is never deleted, so both states stay visible in the audit view.
LIVE_LOG = "superseded_by_id IS NULL AND voided_at IS NULL"


def last_log(conn: sqlite3.Connection, employee_id: int) -> sqlite3.Row | None:
    return conn.execute(
        f"SELECT * FROM dtr_logs WHERE employee_id = ? AND {LIVE_LOG} "
        "ORDER BY recorded_at DESC, id DESC LIMIT 1",
        (employee_id,),
    ).fetchone()


def open_entry(conn: sqlite3.Connection, employee_id: int) -> sqlite3.Row | None:
    """The time-in that has no matching time-out, if any.

    This is the "one active session per employee" rule: while it returns a row,
    the next scan can only be a time-out.
    """
    last = last_log(conn, employee_id)
    if last is not None and last["entry_type"] == "time_in":
        return last
    return None


def logs_for_day(conn: sqlite3.Connection, employee_id: int, day: date) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            f"SELECT * FROM dtr_logs WHERE employee_id = ? AND business_date = ? AND {LIVE_LOG} "
            "ORDER BY recorded_at, id",
            (employee_id, day.isoformat()),
        )
    )


def logs_between(
    conn: sqlite3.Connection,
    start: date,
    end: date,
    *,
    employee_ids: Iterable[int] | None = None,
    include_superseded: bool = False,
) -> list[sqlite3.Row]:
    sql = (
        "SELECT l.*, e.employee_number, e.full_name, e.department "
        "FROM dtr_logs l JOIN employees e ON e.id = l.employee_id "
        "WHERE l.business_date BETWEEN ? AND ?"
    )
    params: list = [start.isoformat(), end.isoformat()]
    if not include_superseded:
        sql += " AND l.superseded_by_id IS NULL AND l.voided_at IS NULL"
    ids = list(employee_ids) if employee_ids is not None else None
    if ids is not None:
        if not ids:
            return []
        sql += f" AND l.employee_id IN ({','.join('?' * len(ids))})"
        params.extend(ids)
    return list(conn.execute(sql + " ORDER BY l.employee_id, l.recorded_at, l.id", params))


def insert_log(
    conn: sqlite3.Connection,
    *,
    employee_id: int,
    entry_type: str,
    recorded_at: datetime,
    business_date: date,
    location_id: int | None = None,
    device_id: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    accuracy_m: float | None = None,
    distance_m: float | None = None,
    photo_path: str | None = None,
    flags: Iterable[str] = (),
    source: str = "scan",
    created_by_id: int | None = None,
) -> int:
    flag_list = sorted(set(flags))
    cursor = conn.execute(
        """
        INSERT INTO dtr_logs
            (employee_id, entry_type, recorded_at, business_date, location_id, device_id,
             latitude, longitude, accuracy_m, distance_m, photo_path, flagged, flag_reasons,
             source, created_by_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            employee_id,
            entry_type,
            iso(recorded_at),
            business_date.isoformat(),
            location_id,
            device_id,
            latitude,
            longitude,
            accuracy_m,
            distance_m,
            photo_path,
            1 if flag_list else 0,
            ",".join(flag_list),
            source,
            created_by_id,
            iso(now_utc()),
        ),
    )
    return int(cursor.lastrowid)


def flagged_logs(conn: sqlite3.Connection, *, since: date | None = None, limit: int = 100):
    sql = """
        SELECT l.*, e.employee_number, e.full_name, e.department
        FROM dtr_logs l JOIN employees e ON e.id = l.employee_id
        WHERE l.flagged = 1 AND l.superseded_by_id IS NULL AND l.voided_at IS NULL
    """
    params: list = []
    if since:
        sql += " AND l.business_date >= ?"
        params.append(since.isoformat())
    return list(conn.execute(sql + " ORDER BY l.recorded_at DESC LIMIT ?", [*params, limit]))
