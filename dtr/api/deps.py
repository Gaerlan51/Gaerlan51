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


def current_employee(request: Request):
    """A signed-in employee on the PWA. Never enough for an admin route."""
    return _session(request, EMPLOYEE_COOKIE, auth.EMPLOYEE)


def current_staff(request: Request):
    """A supervisor or admin holding a dashboard session."""
    employee = _session(request, ADMIN_COOKIE, auth.ADMIN)
    try:
        auth.require_role(employee, "supervisor")
    except PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return employee


def current_admin(request: Request):
    employee = _session(request, ADMIN_COOKIE, auth.ADMIN)
    try:
        auth.require_role(employee, "admin")
    except PermissionDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return employee


StaffDep = Depends(current_staff)
AdminDep = Depends(current_admin)
EmployeeDep = Depends(current_employee)


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
