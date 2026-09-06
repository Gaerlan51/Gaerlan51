"""The realtime board, and the hub that pushes it.

The dashboard opens a WebSocket and gets a fresh board on every scan. Polling
``GET /api/dashboard/board`` returns exactly the same payload, so a browser or
network that will not hold a socket open degrades to a 10-second refresh with no
loss of function.
"""

from __future__ import annotations

import asyncio
import sqlite3
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from . import store
from .timerules import business_date, shift_start_local

IN = "in"
OUT = "out"
NOT_IN = "not_in"
ABSENT_LATE = "late_missing"   # scheduled, past start + grace, still no scan
REST = "rest_day"


class Hub:
    """Fan-out to connected dashboards. One lock, no third-party broker."""

    def __init__(self) -> None:
        self._clients: set[Any] = set()
        self._lock = asyncio.Lock()

    async def join(self, websocket: Any) -> None:
        async with self._lock:
            self._clients.add(websocket)

    async def leave(self, websocket: Any) -> None:
        async with self._lock:
            self._clients.discard(websocket)

    @property
    def size(self) -> int:
        return len(self._clients)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            clients = list(self._clients)
        dead = []
        for client in clients:
            try:
                await client.send_json(message)
            except Exception:
                dead.append(client)
        if dead:
            async with self._lock:
                for client in dead:
                    self._clients.discard(client)


def build_board(
    conn: sqlite3.Connection,
    tz: ZoneInfo,
    *,
    now: datetime | None = None,
    employee_ids: list[int] | None = None,
) -> dict:
    """Who is in, who is late, and what needs a human — as of this instant."""
    now = now or store.now_utc()
    today = business_date(now, tz)
    allowed = set(employee_ids) if employee_ids is not None else None

    people = []
    counts = {IN: 0, OUT: 0, NOT_IN: 0, ABSENT_LATE: 0, REST: 0}
    for employee in store.list_employees(conn, status="active"):
        if allowed is not None and employee["id"] not in allowed:
            continue
        shift = store.shift_for(conn, employee)
        rows = store.logs_for_day(conn, employee["id"], today)
        open_row = store.open_entry(conn, employee["id"])
        first_in = next((r for r in rows if r["entry_type"] == "time_in"), None)
        last_out = next((r for r in reversed(rows) if r["entry_type"] == "time_out"), None)

        scheduled = shift.is_workday(today)
        if open_row is not None and open_row["business_date"] == today.isoformat():
            state = IN
        elif last_out is not None:
            state = OUT
        elif not scheduled:
            state = REST
        else:
            due = shift_start_local(today, shift, tz) + timedelta(minutes=shift.grace_minutes)
            state = ABSENT_LATE if now > due else NOT_IN
        counts[state] += 1

        late_by = 0
        if first_in is not None and scheduled:
            due = shift_start_local(today, shift, tz) + timedelta(minutes=shift.grace_minutes)
            late_by = max(0, int((store.parse_iso(first_in["recorded_at"]) - due).total_seconds() // 60))
        elif state == ABSENT_LATE:
            due = shift_start_local(today, shift, tz) + timedelta(minutes=shift.grace_minutes)
            late_by = max(0, int((now - due).total_seconds() // 60))

        flags = sorted({f for r in rows for f in (r["flag_reasons"] or "").split(",") if f})
        people.append({
            "employee_id": employee["id"],
            "employee_number": employee["employee_number"],
            "name": employee["full_name"],
            "department": employee["department"],
            "shift": shift.name,
            "state": state,
            "time_in": _local(first_in, tz),
            "time_out": _local(last_out, tz),
            "late_minutes": late_by,
            "flags": flags,
        })

    people.sort(key=lambda p: (p["state"] != IN, p["department"], p["name"]))
    return {
        "generated_at": now.astimezone(tz).isoformat(),
        "business_date": today.isoformat(),
        "counts": counts,
        "people": people,
        "anomalies": anomalies(conn, tz, now=now, employee_ids=employee_ids),
    }


def _local(row: sqlite3.Row | None, tz: ZoneInfo) -> str | None:
    if row is None:
        return None
    return store.parse_iso(row["recorded_at"]).astimezone(tz).strftime("%H:%M")


def anomalies(
    conn: sqlite3.Connection,
    tz: ZoneInfo,
    *,
    now: datetime | None = None,
    employee_ids: list[int] | None = None,
    days: int = 7,
) -> list[dict]:
    """Flagged scans and unclosed days from the last week, newest first."""
    now = now or store.now_utc()
    today = business_date(now, tz)
    since = today - timedelta(days=days)
    allowed = set(employee_ids) if employee_ids is not None else None

    out: list[dict] = []
    for row in store.flagged_logs(conn, since=since, limit=200):
        if allowed is not None and row["employee_id"] not in allowed:
            continue
        out.append({
            "kind": "flagged_scan",
            "log_id": row["id"],
            "employee_id": row["employee_id"],
            "employee": row["full_name"],
            "employee_number": row["employee_number"],
            "business_date": row["business_date"],
            "entry_type": row["entry_type"],
            "at": store.parse_iso(row["recorded_at"]).astimezone(tz).strftime("%Y-%m-%d %H:%M"),
            "reasons": [f for f in (row["flag_reasons"] or "").split(",") if f],
            "distance_m": round(row["distance_m"], 1) if row["distance_m"] is not None else None,
            "has_photo": bool(row["photo_path"]),
        })

    unclosed = conn.execute(
        """
        SELECT l.*, e.full_name, e.employee_number
        FROM dtr_logs l JOIN employees e ON e.id = l.employee_id
        WHERE l.entry_type = 'time_in' AND l.superseded_by_id IS NULL AND l.voided_at IS NULL
          AND l.business_date BETWEEN ? AND ?
          AND NOT EXISTS (
              SELECT 1 FROM dtr_logs o
              WHERE o.employee_id = l.employee_id AND o.business_date = l.business_date
                AND o.entry_type = 'time_out' AND o.superseded_by_id IS NULL AND o.voided_at IS NULL
          )
        ORDER BY l.business_date DESC
        """,
        (since.isoformat(), (today - timedelta(days=1)).isoformat()),
    )
    for row in unclosed:
        if allowed is not None and row["employee_id"] not in allowed:
            continue
        out.append({
            "kind": "missing_time_out",
            "log_id": row["id"],
            "employee_id": row["employee_id"],
            "employee": row["full_name"],
            "employee_number": row["employee_number"],
            "business_date": row["business_date"],
            "entry_type": row["entry_type"],
            "at": store.parse_iso(row["recorded_at"]).astimezone(tz).strftime("%Y-%m-%d %H:%M"),
            "reasons": ["missing_time_out"],
            "distance_m": None,
            "has_photo": False,
        })

    out.sort(key=lambda a: a["at"], reverse=True)
    return out
