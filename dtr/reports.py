"""Turning logs into the rows payroll actually needs.

One employee-day per row, every figure derived from the pair of live log rows
for that day. The CSV is deliberately flat and boring: it is meant to be opened
in Excel and read by a person who has never seen this system.
"""

from __future__ import annotations

import csv
import io
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from zoneinfo import ZoneInfo

from . import store
from .timerules import (
    ABSENT, DayRecord, INCOMPLETE, LATE, Shift, date_range, summarise_day,
)

CSV_COLUMNS = [
    "employee_number", "name", "department", "date", "weekday", "shift",
    "time_in", "time_out", "worked_hours", "late_minutes",
    "undertime_minutes", "overtime_minutes", "break_deducted_minutes",
    "status", "flags",
]


@dataclass
class Totals:
    days_present: int = 0
    days_absent: int = 0
    days_incomplete: int = 0
    worked_minutes: int = 0
    late_minutes: int = 0
    undertime_minutes: int = 0
    overtime_minutes: int = 0

    @property
    def worked_hours(self) -> float:
        return round(self.worked_minutes / 60, 2)


def build_records(
    conn: sqlite3.Connection,
    *,
    start: date,
    end: date,
    tz: ZoneInfo,
    employee_ids: list[int] | None = None,
    department: str | None = None,
) -> list[DayRecord]:
    employees = [
        e for e in store.list_employees(conn, status=None, department=department)
        if employee_ids is None or e["id"] in set(employee_ids)
    ]
    if not employees:
        return []

    logs = store.logs_between(conn, start, end, employee_ids=[e["id"] for e in employees])
    by_key: dict[tuple[int, str], list[sqlite3.Row]] = defaultdict(list)
    for row in logs:
        by_key[(row["employee_id"], row["business_date"])].append(row)

    shifts: dict[int, Shift] = {e["id"]: store.shift_for(conn, e) for e in employees}
    records: list[DayRecord] = []
    for employee in employees:
        shift = shifts[employee["id"]]
        for day in date_range(start, end):
            rows = by_key.get((employee["id"], day.isoformat()), [])
            time_in = next((store.parse_iso(r["recorded_at"]) for r in rows if r["entry_type"] == "time_in"), None)
            time_out = next(
                (store.parse_iso(r["recorded_at"]) for r in reversed(rows) if r["entry_type"] == "time_out"), None
            )
            flags = tuple(sorted({f for r in rows for f in (r["flag_reasons"] or "").split(",") if f}))
            records.append(
                summarise_day(
                    employee_id=employee["id"],
                    employee_number=employee["employee_number"],
                    employee_name=employee["full_name"],
                    department=employee["department"],
                    day=day,
                    shift=shift,
                    tz=tz,
                    time_in=time_in,
                    time_out=time_out,
                    flags=flags,
                )
            )
    return records


def totals_by_employee(records: list[DayRecord]) -> dict[int, Totals]:
    out: dict[int, Totals] = defaultdict(Totals)
    for record in records:
        totals = out[record.employee_id]
        totals.worked_minutes += record.worked_minutes
        totals.late_minutes += record.late_minutes
        totals.undertime_minutes += record.undertime_minutes
        totals.overtime_minutes += record.overtime_minutes
        if record.status == ABSENT:
            totals.days_absent += 1
        elif record.status == INCOMPLETE:
            totals.days_incomplete += 1
        elif record.time_in is not None:
            totals.days_present += 1
    return dict(out)


def _local(moment, tz: ZoneInfo) -> str:
    return moment.astimezone(tz).strftime("%H:%M") if moment else ""


def to_csv(records: list[DayRecord], tz: ZoneInfo) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for r in records:
        writer.writerow([
            r.employee_number, r.employee_name, r.department, r.day.isoformat(),
            r.day.strftime("%a"), r.shift_name,
            _local(r.time_in, tz), _local(r.time_out, tz), f"{r.worked_hours:.2f}",
            r.late_minutes, r.undertime_minutes, r.overtime_minutes, r.break_deducted,
            r.status, " ".join(r.flags),
        ])
    return buffer.getvalue()


def as_dicts(records: list[DayRecord], tz: ZoneInfo) -> list[dict]:
    return [
        {
            "employee_id": r.employee_id,
            "employee_number": r.employee_number,
            "name": r.employee_name,
            "department": r.department,
            "date": r.day.isoformat(),
            "shift": r.shift_name,
            "time_in": r.time_in.astimezone(tz).isoformat() if r.time_in else None,
            "time_out": r.time_out.astimezone(tz).isoformat() if r.time_out else None,
            "worked_hours": r.worked_hours,
            "late_minutes": r.late_minutes,
            "undertime_minutes": r.undertime_minutes,
            "overtime_minutes": r.overtime_minutes,
            "break_deducted_minutes": r.break_deducted,
            "status": r.status,
            "flags": list(r.flags),
        }
        for r in records
    ]
