"""Sign in, sign out, change password."""

from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from .. import DtrError, auth, security, store
from ..config import Settings
from . import deps

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    """Form-encoded, like every other write in this API.

    Paired with a SameSite=strict cookie and a custom request header, that is
    enough to stop a cross-site form from acting as someone.
    """

    employee_number: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    device_id: str | None = Field(default=None, max_length=128)


def _set_cookie(response: Response, name: str, token: str, settings: Settings, minutes: int) -> None:
    response.set_cookie(
        name,
        token,
        max_age=minutes * 60,
        httponly=True,
        samesite="strict",
        secure=settings.base_url.startswith("https://"),
        path="/",
    )


def _profile(employee, scope: str) -> dict:
    return {
        "id": employee["id"],
        "employee_number": employee["employee_number"],
        "name": employee["full_name"],
        "department": employee["department"],
        "role": employee["role"],
        "scope": scope,
        "must_change_password": bool(employee["must_change_password"]),
        "device_bound": bool(employee["registered_device_id"]),
        "consent_location": bool(employee["consent_location_at"]),
        "consent_photo": bool(employee["consent_photo_at"]),
    }


def _login(request: Request, response: Response, body: LoginBody, scope: str, cookie: str) -> dict:
    settings: Settings = deps.get_settings(request)
    conn = deps.get_conn(request)
    try:
        token, employee = auth.login(
            conn, settings,
            employee_number=body.employee_number,
            password=body.password,
            scope=scope,
            device_id=body.device_id,
            user_agent=request.headers.get("user-agent"),
            ip_address=deps.client_ip(request),
        )
    except auth.LoginFailed as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    minutes = settings.admin_session_minutes if scope == auth.ADMIN else settings.employee_session_minutes
    _set_cookie(response, cookie, token, settings, minutes)
    return _profile(employee, scope)


@router.post("/login")
def login_employee(
    request: Request,
    response: Response,
    employee_number: str = Form(...),
    password: str = Form(...),
    device_id: str | None = Form(default=None),
) -> dict:
    body = LoginBody(employee_number=employee_number, password=password, device_id=device_id)
    return _login(request, response, body, auth.EMPLOYEE, deps.EMPLOYEE_COOKIE)


@router.post("/admin/login")
def login_admin(
    request: Request,
    response: Response,
    employee_number: str = Form(...),
    password: str = Form(...),
) -> dict:
    """A separate credential exchange, even for someone already signed in on the PWA."""
    body = LoginBody(employee_number=employee_number, password=password)
    return _login(request, response, body, auth.ADMIN, deps.ADMIN_COOKIE)


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    conn = deps.get_conn(request)
    for cookie in (deps.EMPLOYEE_COOKIE, deps.ADMIN_COOKIE):
        token = request.cookies.get(cookie)
        if token:
            auth.logout(conn, token)
        response.delete_cookie(cookie, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request, employee=deps.PendingEmployeeDep) -> dict:
    """Ungated: the front-end has to be able to read must_change_password."""
    return _profile(employee, auth.EMPLOYEE)


@router.get("/admin/me")
def admin_me(request: Request, employee=deps.PendingStaffDep) -> dict:
    return _profile(employee, auth.ADMIN)


@router.post("/password")
def change_password(
    request: Request,
    current_password: str = Form(...),
    new_password: str = Form(..., min_length=8),
    employee=deps.AnySessionDep,
) -> dict:
    """Set your own password.

    Reachable while a password change is pending — it is the one thing such an
    account may do — and from either session, so an admin who only ever opens
    the dashboard is not sent to the employee app to do it.
    """
    conn = deps.get_conn(request)
    if not security.verify_password(current_password, employee["password_hash"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "current password is wrong")
    if security.verify_password(new_password, employee["password_hash"]):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "that is the password you already have; the point is that nobody else knows the new one",
        )
    try:
        auth.set_password(conn, employee["id"], new_password,
                          changed_by_id=employee["id"], reason="self-service change")
    except DtrError as exc:
        raise deps.http_error(exc) from exc
    return {"ok": True, "note": "You have been signed out everywhere. Sign in again."}
