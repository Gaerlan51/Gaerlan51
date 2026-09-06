"""Demo data, so a fresh clone has something to look at.

Fictional people only. The passwords here are obviously fake and the command
refuses to run against a database that already holds real scans.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from . import security, store
from .config import Settings

DEMO_PASSWORD = "changeme123"

SHIFTS = [
    ("Day 08:00–17:00", "08:00", "17:00", 15, 60, 300, "1111100"),
    ("Early 06:00–15:00", "06:00", "15:00", 10, 60, 300, "1111110"),
    ("Night 22:00–06:00", "22:00", "06:00", 10, 60, 300, "1111100"),
]

PEOPLE = [
    ("1001", "Aurora Villanueva", "HR", "admin", None, 0),
    ("1002", "Emil Bautista", "Operations", "supervisor", None, 0),
    ("1003", "Marites Ocampo", "Operations", "employee", "1002", 0),
    ("1004", "Rene Alcantara", "Operations", "employee", "1002", 0),
    ("1005", "Joy Dimaculangan", "Front desk", "employee", "1002", 1),
    ("1006", "Karl Espino", "Warehouse", "employee", "1002", 2),
]

# Rizal Park, Manila — a real, public, easily recognised coordinate.
LOCATION = ("Main entrance", 14.582800, 120.979700, 75.0)


def seed(conn: sqlite3.Connection, settings: Settings, *, force: bool = False) -> dict:
    scans = conn.execute("SELECT COUNT(*) AS n FROM dtr_logs WHERE source = 'scan'").fetchone()["n"]
    if scans and not force:
        raise RuntimeError(f"this database already holds {scans} scans; refusing to seed over them")

    now = store.iso(store.now_utc())
    shift_ids = []
    for name, start, end, grace, brk, brk_after, days in SHIFTS:
        existing = conn.execute("SELECT id FROM shifts WHERE name = ?", (name,)).fetchone()
        if existing:
            shift_ids.append(existing["id"])
            continue
        cursor = conn.execute(
            "INSERT INTO shifts (name, start_time, end_time, grace_minutes, break_minutes, "
            "break_after_minutes, workdays, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (name, start, end, grace, brk, brk_after, days, now),
        )
        shift_ids.append(int(cursor.lastrowid))

    # A low work factor here only: these are throwaway demo accounts.
    password_hash = security.hash_password(DEMO_PASSWORD, iterations=50_000)
    by_number: dict[str, int] = {}
    for number, name, department, role, supervisor, shift_index in PEOPLE:
        if store.find_employee_by_number(conn, number):
            continue
        cursor = conn.execute(
            # must_change_password stays 0 here, and only here. Real accounts —
            # created from the dashboard or reset by an admin — carry 1, and the
            # API refuses every route until the holder picks their own. Demo
            # accounts are meant to be signed into repeatedly with the password
            # printed on screen, so they skip it.
            "INSERT INTO employees (employee_number, full_name, department, role, shift_id, "
            "password_hash, must_change_password, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)",
            (number, name, department, role, shift_ids[shift_index], password_hash, now, now),
        )
        by_number[number] = int(cursor.lastrowid)
    for number, _, _, _, supervisor, _ in PEOPLE:
        if supervisor and number in by_number:
            conn.execute(
                "UPDATE employees SET supervisor_id = (SELECT id FROM employees WHERE employee_number = ?) "
                "WHERE employee_number = ?",
                (supervisor, number),
            )

    name, latitude, longitude, radius = LOCATION
    location = conn.execute("SELECT * FROM locations WHERE name = ?", (name,)).fetchone()
    if location is None:
        code = security.new_location_code()
        conn.execute(
            "INSERT INTO locations (name, latitude, longitude, radius_m, qr_code_id, qr_issued_at, "
            "require_photo, max_accuracy_m, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 0, 100, 'active', ?, ?)",
            (name, latitude, longitude, radius, code, now, now, now),
        )
    else:
        code = location["qr_code_id"]

    return {
        "password": DEMO_PASSWORD,
        "location_code": code,
        "payload": security.build_payload(code, settings.secret_key),
        "employees": len(PEOPLE),
    }
