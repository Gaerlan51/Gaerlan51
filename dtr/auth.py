"""Sessions and roles.

Employee sessions and admin sessions are separate credentials even for the same
person: signing in on the PWA to clock in never grants the dashboard. An admin
who wants the dashboard signs in again on the web app and gets a session with a
shorter life.

Failed sign-ins are counted from the audit log, so a lockout survives a restart
and leaves a trail.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from . import PermissionDenied
from . import audit, security, store
from .config import Settings

EMPLOYEE = "employee"
ADMIN = "admin"

MAX_FAILURES = 8
LOCKOUT_MINUTES = 15

ROLE_RANK = {"employee": 0, "supervisor": 1, "admin": 2}


class LoginFailed(PermissionDenied):
    pass


def _recent_failures(conn: sqlite3.Connection, employee_number: str, *, now: datetime) -> int:
    since = (now - timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'login' AND entity_id = ? "
        "AND action = ? AND recorded_at >= ?",
        (employee_number.strip().upper(), audit.LOGIN_FAILED, since),
    ).fetchone()
    return int(row["n"])


def login(
    conn: sqlite3.Connection,
    settings: Settings,
    *,
    employee_number: str,
    password: str,
    scope: str,
    device_id: str | None = None,
    user_agent: str | None = None,
    ip_address: str | None = None,
    now: datetime | None = None,
) -> tuple[str, sqlite3.Row]:
    now = now or store.now_utc()
    key = (employee_number or "").strip().upper()

    if _recent_failures(conn, key, now=now) >= MAX_FAILURES:
        raise LoginFailed(f"too many failed attempts; try again in {LOCKOUT_MINUTES} minutes")

    employee = store.find_employee_by_number(conn, employee_number or "")
    ok = employee is not None and security.verify_password(password or "", employee["password_hash"])
    if ok and employee["status"] != "active":
        ok = False
    if ok and scope == ADMIN and employee["role"] == "employee":
        ok = False

    if not ok:
        audit.record(
            conn, entity_type="login", entity_id=key, action=audit.LOGIN_FAILED,
            changed_by_id=employee["id"] if employee else None,
            new_value={"scope": scope}, ip_address=ip_address, now=now,
        )
        # One message for every failure mode, so it never confirms who exists.
        raise LoginFailed("wrong employee number or password")

    minutes = settings.admin_session_minutes if scope == ADMIN else settings.employee_session_minutes
    token, token_hash = security.new_session_token()
    conn.execute(
        "INSERT INTO sessions (token_hash, employee_id, scope, device_id, user_agent, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            token_hash, employee["id"], scope, device_id, (user_agent or "")[:200],
            store.iso(now), store.iso(security.session_expiry(minutes, now=now)),
        ),
    )
    audit.record(
        conn, entity_type="login", entity_id=key, action=audit.LOGIN,
        changed_by_id=employee["id"], new_value={"scope": scope}, ip_address=ip_address, now=now,
    )
    return token, employee


def resolve(
    conn: sqlite3.Connection, token: str | None, *, now: datetime | None = None
) -> tuple[sqlite3.Row, str]:
    """Return ``(employee, scope)`` for a live session token."""
    if not token:
        raise PermissionDenied("sign in first")
    now = now or store.now_utc()
    row = conn.execute(
        "SELECT * FROM sessions WHERE token_hash = ?", (security.hash_session_token(token),)
    ).fetchone()
    if row is None or row["revoked_at"] is not None:
        raise PermissionDenied("sign in first")
    if store.parse_iso(row["expires_at"]) <= now:
        raise PermissionDenied("your session has expired; sign in again")
    employee = store.get_employee(conn, row["employee_id"])
    if employee["status"] != "active":
        raise PermissionDenied("your account is inactive")
    return employee, row["scope"]


def logout(conn: sqlite3.Connection, token: str) -> None:
    conn.execute(
        "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        (store.iso(store.now_utc()), security.hash_session_token(token)),
    )


def revoke_all(conn: sqlite3.Connection, employee_id: int) -> None:
    conn.execute(
        "UPDATE sessions SET revoked_at = ? WHERE employee_id = ? AND revoked_at IS NULL",
        (store.iso(store.now_utc()), employee_id),
    )


def require_role(employee: sqlite3.Row, minimum: str) -> None:
    if ROLE_RANK.get(employee["role"], 0) < ROLE_RANK[minimum]:
        raise PermissionDenied(f"this needs {minimum} access")


def set_password(
    conn: sqlite3.Connection, employee_id: int, password: str, *, changed_by_id: int, reason: str = ""
) -> None:
    conn.execute(
        "UPDATE employees SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?",
        (
            security.hash_password(password),
            0 if changed_by_id == employee_id else 1,
            store.iso(store.now_utc()),
            employee_id,
        ),
    )
    revoke_all(conn, employee_id)
    audit.record(
        conn, entity_type="employee", entity_id=employee_id, action=audit.UPDATE,
        changed_by_id=changed_by_id, new_value={"password": "changed"}, reason=reason,
    )


def visible_employee_ids(conn: sqlite3.Connection, viewer: sqlite3.Row) -> list[int] | None:
    """``None`` means "everyone". Supervisors see themselves and their team."""
    if viewer["role"] == "admin":
        return None
    if viewer["role"] == "supervisor":
        return [viewer["id"], *store.team_of(conn, viewer["id"])]
    return [viewer["id"]]
