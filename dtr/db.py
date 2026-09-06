"""SQLite storage.

Two rules are enforced by the database itself rather than by application code,
because application code is exactly what an attacker with a shell would bypass:

1. rows in ``dtr_logs`` and ``audit_log`` can never be deleted;
2. the factual columns of a ``dtr_logs`` row can never be updated.

A correction therefore never rewrites history. It appends a new log row and
points the old one at it via ``superseded_by_id`` — the only mutable column.

The one exception is retention purging, which must be able to delete records
older than the statutory floor. It is gated on the ``purge`` row in ``guards``,
which :func:`purge_expired` flips for the duration of a single transaction.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

from . import DtrError

SCHEMA_VERSION = 1

# Columns of dtr_logs that no UPDATE may ever change.
IMMUTABLE_LOG_COLUMNS = (
    "employee_id",
    "entry_type",
    "recorded_at",
    "business_date",
    "location_id",
    "device_id",
    "latitude",
    "longitude",
    "accuracy_m",
    "distance_m",
    "photo_path",
    "source",
    "created_by_id",
    "created_at",
)

_FROZEN = [c for c in IMMUTABLE_LOG_COLUMNS if c != "photo_path"]

# photo_path is frozen like the rest, with one carve-out: retention may clear it
# to NULL once the photo itself has been deleted from disk. The carve-out is as
# narrow as it can be — only to NULL, and only while the purge gate is open.
_PHOTO_GUARD = (
    "(OLD.photo_path IS NOT NEW.photo_path AND NOT ("
    "NEW.photo_path IS NULL AND "
    "COALESCE((SELECT enabled FROM guards WHERE name = 'purge'), 0) = 1))"
)

_IMMUTABLE_GUARD = " OR ".join([*(f"OLD.{c} IS NOT NEW.{c}" for c in _FROZEN), _PHOTO_GUARD])

SCHEMA = f"""
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Deletion gate. Flipped only by purge_expired(), inside one transaction.
CREATE TABLE IF NOT EXISTS guards (
    name    TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shifts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL UNIQUE,
    start_time     TEXT    NOT NULL,              -- 'HH:MM' local
    end_time       TEXT    NOT NULL,              -- 'HH:MM' local; may wrap midnight
    grace_minutes  INTEGER NOT NULL DEFAULT 0,
    break_minutes  INTEGER NOT NULL DEFAULT 60,   -- unpaid, deducted automatically
    break_after_minutes INTEGER NOT NULL DEFAULT 300,  -- only deducted past this (PH Art. 85)
    workdays       TEXT    NOT NULL DEFAULT '1111100',  -- Mon..Sun
    created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_number      TEXT    NOT NULL UNIQUE,
    full_name            TEXT    NOT NULL,
    email                TEXT    UNIQUE,
    department           TEXT    NOT NULL DEFAULT '',
    role                 TEXT    NOT NULL DEFAULT 'employee'
                                 CHECK (role IN ('employee', 'supervisor', 'admin')),
    supervisor_id        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    shift_id             INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
    password_hash        TEXT    NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    registered_device_id TEXT,
    device_bound_at      TEXT,
    status               TEXT    NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'inactive')),
    consent_location_at  TEXT,
    consent_photo_at     TEXT,
    consent_version      TEXT,
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_supervisor ON employees(supervisor_id);

CREATE TABLE IF NOT EXISTS locations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL UNIQUE,
    latitude      REAL    NOT NULL,
    longitude     REAL    NOT NULL,
    radius_m      REAL    NOT NULL DEFAULT 75,
    qr_code_id    TEXT    NOT NULL UNIQUE,   -- public half of the poster payload
    qr_issued_at  TEXT    NOT NULL,
    require_photo INTEGER NOT NULL DEFAULT 0,
    max_accuracy_m REAL   NOT NULL DEFAULT 100,
    status        TEXT    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'inactive')),
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS dtr_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id     INTEGER NOT NULL REFERENCES employees(id),
    entry_type      TEXT    NOT NULL CHECK (entry_type IN ('time_in', 'time_out')),
    -- Server clock at the moment the request was accepted. UTC, ISO-8601.
    recorded_at     TEXT    NOT NULL,
    business_date   TEXT    NOT NULL,        -- local date the entry belongs to
    location_id     INTEGER REFERENCES locations(id),
    device_id       TEXT,
    latitude        REAL,
    longitude       REAL,
    accuracy_m      REAL,
    distance_m      REAL,
    photo_path      TEXT,
    flagged         INTEGER NOT NULL DEFAULT 0,
    flag_reasons    TEXT    NOT NULL DEFAULT '',   -- comma-separated codes
    source          TEXT    NOT NULL DEFAULT 'scan'
                            CHECK (source IN ('scan', 'admin_correction')),
    created_by_id   INTEGER REFERENCES employees(id),
    -- The three mutable columns. Everything above is frozen by a trigger.
    superseded_by_id INTEGER REFERENCES dtr_logs(id),
    voided_at       TEXT,
    voided_by_id    INTEGER REFERENCES employees(id),
    created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_employee_date ON dtr_logs(employee_id, business_date);
CREATE INDEX IF NOT EXISTS idx_logs_recorded ON dtr_logs(recorded_at);
CREATE INDEX IF NOT EXISTS idx_logs_flagged ON dtr_logs(flagged) WHERE flagged = 1;
CREATE INDEX IF NOT EXISTS idx_logs_open ON dtr_logs(employee_id, entry_type, superseded_by_id, voided_at);

CREATE TABLE IF NOT EXISTS correction_requests (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id          INTEGER NOT NULL REFERENCES employees(id),
    dtr_log_id           INTEGER REFERENCES dtr_logs(id),
    request_type         TEXT    NOT NULL
                                 CHECK (request_type IN ('amend', 'add_missing', 'void')),
    requested_entry_type TEXT    CHECK (requested_entry_type IN ('time_in', 'time_out')),
    requested_at         TEXT,               -- local 'YYYY-MM-DD HH:MM' the employee claims
    business_date        TEXT    NOT NULL,
    reason               TEXT    NOT NULL,
    status               TEXT    NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by_id       INTEGER REFERENCES employees(id),
    reviewed_at          TEXT,
    review_note          TEXT,
    resulting_log_id     INTEGER REFERENCES dtr_logs(id),
    created_at           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON correction_requests(status);
CREATE INDEX IF NOT EXISTS idx_corrections_employee ON correction_requests(employee_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT    NOT NULL,
    entity_id     TEXT    NOT NULL,
    action        TEXT    NOT NULL,
    changed_by_id INTEGER REFERENCES employees(id),
    old_value     TEXT,      -- JSON
    new_value     TEXT,      -- JSON
    reason        TEXT    NOT NULL DEFAULT '',
    ip_address    TEXT,
    recorded_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_recorded ON audit_log(recorded_at);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT    PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    -- 'employee' sessions come from the PWA and can never reach admin routes.
    scope       TEXT    NOT NULL CHECK (scope IN ('employee', 'admin')),
    device_id   TEXT,
    user_agent  TEXT,
    created_at  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_employee ON sessions(employee_id);

-- ---------------------------------------------------------------- guarantees

CREATE TRIGGER IF NOT EXISTS dtr_logs_no_delete
BEFORE DELETE ON dtr_logs
WHEN COALESCE((SELECT enabled FROM guards WHERE name = 'purge'), 0) = 0
BEGIN
    SELECT RAISE(ABORT, 'dtr_logs is append-only: rows cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS dtr_logs_immutable
BEFORE UPDATE ON dtr_logs
FOR EACH ROW
WHEN {_IMMUTABLE_GUARD}
BEGIN
    SELECT RAISE(ABORT, 'dtr_logs is append-only: record a correction instead');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
WHEN COALESCE((SELECT enabled FROM guards WHERE name = 'purge'), 0) = 0
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be edited');
END;
"""


class StorageError(DtrError):
    pass


def connect(db_path: Path | str, *, create: bool = True) -> sqlite3.Connection:
    path = Path(db_path)
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
    elif not path.exists():
        raise StorageError(f"no database at {path}; run `python -m dtr init`")
    fresh = not path.exists()
    conn = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)
    if fresh and path.exists():
        # Employment records and location traces. Not world-readable.
        path.chmod(0o600)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.execute("INSERT OR IGNORE INTO guards (name, enabled) VALUES ('purge', 0)")
    conn.execute(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """A real transaction. ``isolation_level=None`` means we drive BEGIN ourselves."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except Exception:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def purge_expired(conn: sqlite3.Connection, *, retention_days: int, now: datetime | None = None) -> dict:
    """Delete records older than the retention floor.

    The only code path allowed to delete from the append-only tables, and the
    only one that touches the ``purge`` guard. Audit rows describing a purged
    log are kept: they are the proof that the record existed and was aged out.
    """
    if retention_days < 1095:
        raise StorageError("refusing to purge with a retention window under 3 years")
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=retention_days)).isoformat()
    with transaction(conn):
        conn.execute("UPDATE guards SET enabled = 1 WHERE name = 'purge'")
        try:
            logs = conn.execute("DELETE FROM dtr_logs WHERE recorded_at < ?", (cutoff,)).rowcount
        finally:
            conn.execute("UPDATE guards SET enabled = 0 WHERE name = 'purge'")
    return {"dtr_logs": logs, "cutoff": cutoff}


def purge_photos(
    conn: sqlite3.Connection,
    *,
    photo_dir: Path | str,
    retention_days: int,
    now: datetime | None = None,
) -> dict:
    """Delete scan photos past their own, shorter retention window.

    The consent notice promises this happens, so it has to actually happen. The
    time record survives; only the image goes, and its ``photo_path`` is cleared
    so the dashboard offers a plain explanation instead of a broken link.
    """
    if retention_days < 1:
        raise StorageError("photo retention must be at least a day")
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=retention_days)).isoformat()
    root = Path(photo_dir)
    rows = list(conn.execute(
        "SELECT id, photo_path FROM dtr_logs WHERE photo_path IS NOT NULL AND recorded_at < ?",
        (cutoff,),
    ))
    removed = 0
    with transaction(conn):
        conn.execute("UPDATE guards SET enabled = 1 WHERE name = 'purge'")
        try:
            for row in rows:
                (root / row["photo_path"]).unlink(missing_ok=True)
                conn.execute("UPDATE dtr_logs SET photo_path = NULL WHERE id = ?", (row["id"],))
                removed += 1
        finally:
            conn.execute("UPDATE guards SET enabled = 0 WHERE name = 'purge'")
    return {"photos": removed, "cutoff": cutoff}
