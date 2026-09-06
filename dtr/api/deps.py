"""Shared FastAPI plumbing: the connection pool, cookies, and role gates."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from fastapi import Depends, HTTPException, Request, status

from .. import DtrError, NotFound, PermissionDenied, ScanRejected
from .. import auth, db
from ..config import Settings

EMPLOYEE_COOKIE = "dtr_session"
ADMIN_COOKIE = "dtr_admin"


class Database:
    """One SQLite connection per thread.

    FastAPI runs synchronous endpoints in a worker thread pool, and sharing a
    single connection across those threads invites 'database is locked' under
    WAL. A connection per thread is the boring, correct answer at this scale.
    """

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._local = threading.local()

    @property
    def conn(self) -> sqlite3.Connection:
        existing = getattr(self._local, "conn", None)
        if existing is None:
            existing = db.connect(self.path)
            self._local.conn = existing
        return existing

    def close(self) -> None:
        existing = getattr(self._local, "conn", None)
        if existing is not None:
            existing.close()
            self._local.conn = None


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_conn(request: Request) -> sqlite3.Connection:
    return request.app.state.db.conn


def _session(request: Request, cookie: str, expected_scope: str):
    conn = get_conn(request)
    try:
        employee, scope = auth.resolve(conn, request.cookies.get(cookie))
    except PermissionDenied as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    if scope != expected_scope:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong session for this area")
    return employee


def _require_own_password(employee) -> None:
    """A handed-out password is not yet a credential.

    Until the holder has chosen their own, the account can do nothing but say
    who it is and set one. Enforced here rather than in the front-end, because a
    front-end check is a suggestion — the whole point of the flag is that the
    person who issued the password must not be able to act as the account.
    """
    if employee["must_change_password"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "password_change_required",
             "message": "Choose your own password before you carry on."},
        )


def signed_in_employee(request: Request):
    """A PWA session, pending password change or not. Only /me and /password."""
    return _session(request, EMPLOYEE_COOKIE, auth.EMPLOYEE)


def signed_in_staff(request: Request):
    """A dashboard session, pending password change or not."""
    employee = _session(request, ADMIN_COOKIE, auth.ADMIN)
    try:
        auth.require_role(employee, "supervisor")
    except PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return employee


def any_session(request: Request):
    """Whichever session the caller holds.

    Only the password-change endpoint uses this: someone who holds just a
    dashboard session must be able to set their password without first signing
    in to an employee app they may never otherwise open.
    """
    conn = get_conn(request)
    for cookie, expected in ((EMPLOYEE_COOKIE, auth.EMPLOYEE), (ADMIN_COOKIE, auth.ADMIN)):
        token = request.cookies.get(cookie)
        if not token:
            continue
        try:
            employee, scope = auth.resolve(conn, token)
        except PermissionDenied:
            continue
        if scope == expected:
            return employee
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sign in first")


def current_employee(request: Request):
    """A signed-in employee on the PWA. Never enough for an admin route."""
    employee = signed_in_employee(request)
    _require_own_password(employee)
    return employee


def current_staff(request: Request):
    """A supervisor or admin holding a dashboard session."""
    employee = signed_in_staff(request)
    _require_own_password(employee)
    return employee


def current_admin(request: Request):
    employee = _session(request, ADMIN_COOKIE, auth.ADMIN)
    try:
        auth.require_role(employee, "admin")
    except PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    _require_own_password(employee)
    return employee


StaffDep = Depends(current_staff)
AdminDep = Depends(current_admin)
EmployeeDep = Depends(current_employee)
PendingEmployeeDep = Depends(signed_in_employee)
PendingStaffDep = Depends(signed_in_staff)
AnySessionDep = Depends(any_session)


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def http_error(exc: DtrError) -> HTTPException:
    if isinstance(exc, ScanRejected):
        return HTTPException(status.HTTP_409_CONFLICT, {"code": exc.code, "message": exc.message, **exc.detail})
    if isinstance(exc, PermissionDenied):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    if isinstance(exc, NotFound):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
