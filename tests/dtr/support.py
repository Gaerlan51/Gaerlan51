"""Shared fixtures: a throwaway database, a location, and some people."""

from __future__ import annotations

import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dtr import db, security, store
from dtr.config import Settings

# Rizal Park, Manila.
OFFICE_LAT = 14.5828
OFFICE_LNG = 120.9797

# Cheap hashing: these tests create dozens of accounts and none of them are real.
TEST_ITERATIONS = 1_000


def make_settings(tmp: Path, **overrides) -> Settings:
    values = {
        "data_dir": tmp,
        "db_path": tmp / "test.db",
        "photo_dir": tmp / "photos",
        "secret_key": "test-secret-not-for-production",
        "timezone": "Asia/Manila",
        "organisation": "Test Co",
    }
    values.update(overrides)
    return Settings(**values)


class Fixture:
    """A database with one shift, one location and whoever the test asks for."""

    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.settings = make_settings(self.dir)
        self.conn = db.connect(self.settings.db_path)
        db.init_db(self.conn)
        self.now = store.iso(store.now_utc())
        self.shift_id = int(self.conn.execute(
            "INSERT INTO shifts (name, start_time, end_time, grace_minutes, break_minutes, "
            "break_after_minutes, workdays, created_at) "
            "VALUES ('Day', '08:00', '17:00', 15, 60, 300, '1111111', ?)",
            (self.now,),
        ).lastrowid)
        self.code = security.new_location_code()
        self.location_id = int(self.conn.execute(
            "INSERT INTO locations (name, latitude, longitude, radius_m, qr_code_id, qr_issued_at, "
            "require_photo, max_accuracy_m, status, created_at, updated_at) "
            "VALUES ('Office', ?, ?, 75, ?, ?, 0, 100, 'active', ?, ?)",
            (OFFICE_LAT, OFFICE_LNG, self.code, self.now, self.now, self.now),
        ).lastrowid)

    @property
    def payload(self) -> str:
        return security.build_payload(self.code, self.settings.secret_key)

    def add_employee(
        self,
        number: str = "1001",
        name: str = "Test Person",
        *,
        role: str = "employee",
        password: str = "password123",
        consent: bool = True,
        supervisor_id: int | None = None,
        shift_id: int | None = -1,
    ) -> sqlite3.Row:
        consented = self.now if consent else None
        employee_id = int(self.conn.execute(
            "INSERT INTO employees (employee_number, full_name, department, role, supervisor_id, "
            "shift_id, password_hash, must_change_password, status, consent_location_at, "
            "created_at, updated_at) VALUES (?, ?, 'Ops', ?, ?, ?, ?, 0, 'active', ?, ?, ?)",
            (number, name, role, supervisor_id,
             self.shift_id if shift_id == -1 else shift_id,
             security.hash_password(password, iterations=TEST_ITERATIONS),
             consented, self.now, self.now),
        ).lastrowid)
        return store.get_employee(self.conn, employee_id)

    def reload(self, employee) -> sqlite3.Row:
        return store.get_employee(self.conn, employee["id"])

    def set_photo_required(self, required: bool = True) -> None:
        self.conn.execute("UPDATE locations SET require_photo = ? WHERE id = ?",
                          (1 if required else 0, self.location_id))

    def close(self) -> None:
        self.conn.close()
        self._tmp.cleanup()


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def manila(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    """A Manila wall-clock time, expressed in UTC."""
    local = datetime(year, month, day, hour, minute, tzinfo=ZoneInfo("Asia/Manila"))
    return local.astimezone(timezone.utc)
