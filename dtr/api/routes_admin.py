"""The dashboard's API: live board, people, locations, approvals, reports, audit."""

from __future__ import annotations

import io
from datetime import date, timedelta
from pathlib import Path

import segno
from fastapi import APIRouter, Form, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse

from .. import DtrError, audit, auth, corrections, live, reports, security, store
from ..timerules import business_date
from . import deps

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _scope(request, viewer) -> list[int] | None:
    return auth.visible_employee_ids(request.app.state.db.conn, viewer) if viewer["role"] != "admin" else None


def _dates(start: str | None, end: str | None, tz) -> tuple[date, date]:
    today = business_date(store.now_utc(), tz)
    try:
        first = date.fromisoformat(start) if start else today - timedelta(days=13)
        last = date.fromisoformat(end) if end else today
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "dates must be YYYY-MM-DD") from exc
    if last < first:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "the end date is before the start date")
    if (last - first).days > 366:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "keep the range under a year")
    return first, last


# ------------------------------------------------------------- live board


@router.get("/board")
def board(request: Request, viewer=deps.StaffDep) -> dict:
    settings = deps.get_settings(request)
    return live.build_board(deps.get_conn(request), settings.tz, employee_ids=_scope(request, viewer))


# --------------------------------------------------------------- reports


@router.get("/report")
def report(
    request: Request,
    start: str | None = None,
    end: str | None = None,
    department: str | None = None,
    employee_id: int | None = None,
    viewer=deps.StaffDep,
) -> dict:
    settings = deps.get_settings(request)
    conn = deps.get_conn(request)
    first, last = _dates(start, end, settings.tz)
    allowed = _scope(request, viewer)
    ids = [employee_id] if employee_id else allowed
    if employee_id and allowed is not None and employee_id not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "that employee is not on your team")

    records = reports.build_records(conn, start=first, end=last, tz=settings.tz,
                                    employee_ids=ids, department=department)
    totals = reports.totals_by_employee(records)
    names = {r.employee_id: (r.employee_number, r.employee_name, r.department) for r in records}
    return {
        "start": first.isoformat(),
        "end": last.isoformat(),
        "rows": reports.as_dicts(records, settings.tz),
        "totals": [
            {
                "employee_id": eid,
                "employee_number": names[eid][0],
                "name": names[eid][1],
                "department": names[eid][2],
                "worked_hours": t.worked_hours,
                "days_present": t.days_present,
                "days_absent": t.days_absent,
                "days_incomplete": t.days_incomplete,
                "late_minutes": t.late_minutes,
                "undertime_minutes": t.undertime_minutes,
                "overtime_minutes": t.overtime_minutes,
            }
            for eid, t in sorted(totals.items(), key=lambda kv: names[kv[0]][1])
        ],
    }


@router.get("/report.csv")
def report_csv(
    request: Request,
    start: str | None = None,
    end: str | None = None,
    department: str | None = None,
    employee_id: int | None = None,
    viewer=deps.StaffDep,
) -> StreamingResponse:
    """The same filtered view as /report, as a file payroll can open directly."""
    settings = deps.get_settings(request)
    conn = deps.get_conn(request)
    first, last = _dates(start, end, settings.tz)
    allowed = _scope(request, viewer)
    ids = [employee_id] if employee_id else allowed
    records = reports.build_records(conn, start=first, end=last, tz=settings.tz,
                                    employee_ids=ids, department=department)
    audit.record(conn, entity_type="report", entity_id=f"{first}..{last}", action="export",
                 changed_by_id=viewer["id"], new_value={"rows": len(records), "department": department},
                 ip_address=deps.client_ip(request))
    body = reports.to_csv(records, settings.tz)
    filename = f"dtr-{first.isoformat()}-to-{last.isoformat()}.csv"
    return StreamingResponse(
        io.StringIO(body),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ------------------------------------------------------------ corrections


@router.get("/corrections")
def list_corrections(request: Request, viewer=deps.StaffDep) -> list[dict]:
    conn = deps.get_conn(request)
    rows = corrections.pending(conn, employee_ids=_scope(request, viewer))
    settings = deps.get_settings(request)
    out = []
    for r in rows:
        original = None
        if r["dtr_log_id"]:
            log = conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (r["dtr_log_id"],)).fetchone()
            if log:
                original = {
                    "id": log["id"],
                    "entry_type": log["entry_type"],
                    "at": store.parse_iso(log["recorded_at"]).astimezone(settings.tz).strftime("%Y-%m-%d %H:%M"),
                }
        out.append({
            "id": r["id"],
            "employee_id": r["employee_id"],
            "employee": r["full_name"],
            "employee_number": r["employee_number"],
            "department": r["department"],
            "type": r["request_type"],
            "business_date": r["business_date"],
            "requested_entry_type": r["requested_entry_type"],
            "requested_at": r["requested_at"],
            "reason": r["reason"],
            "original": original,
            "created_at": r["created_at"],
        })
    return out


@router.post("/corrections/{request_id}/approve")
def approve_correction(
    request: Request,
    request_id: int,
    note: str = Form(default=""),
    override_time: str | None = Form(default=None),
    viewer=deps.StaffDep,
) -> dict:
    settings = deps.get_settings(request)
    conn = deps.get_conn(request)
    allowed = _scope(request, viewer)
    row = corrections.get(conn, request_id)
    if allowed is not None and row["employee_id"] not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "that request is not from your team")
    try:
        log_id = corrections.approve(conn, request_id, reviewer_id=viewer["id"], tz=settings.tz,
                                     note=note, override_time=override_time or None)
    except DtrError as exc:
        raise deps.http_error(exc) from exc
    return {"ok": True, "resulting_log_id": log_id}


@router.post("/corrections/{request_id}/reject")
def reject_correction(
    request: Request, request_id: int, note: str = Form(...), viewer=deps.StaffDep
) -> dict:
    conn = deps.get_conn(request)
    allowed = _scope(request, viewer)
    row = corrections.get(conn, request_id)
    if allowed is not None and row["employee_id"] not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "that request is not from your team")
    try:
        corrections.reject(conn, request_id, reviewer_id=viewer["id"], note=note)
    except DtrError as exc:
        raise deps.http_error(exc) from exc
    return {"ok": True}


# --------------------------------------------------------------- people


@router.get("/employees")
def list_employees(request: Request, viewer=deps.StaffDep) -> list[dict]:
    conn = deps.get_conn(request)
    allowed = _scope(request, viewer)
    out = []
    for e in store.list_employees(conn, status=None):
        if allowed is not None and e["id"] not in allowed:
            continue
        out.append({
            "id": e["id"],
            "employee_number": e["employee_number"],
            "name": e["full_name"],
            "email": e["email"],
            "department": e["department"],
            "role": e["role"],
            "shift_id": e["shift_id"],
            "supervisor_id": e["supervisor_id"],
            "status": e["status"],
            "device_bound": bool(e["registered_device_id"]),
            "consent_location": bool(e["consent_location_at"]),
            "consent_photo": bool(e["consent_photo_at"]),
        })
    return out


@router.post("/employees")
def create_employee(
    request: Request,
    employee_number: str = Form(...),
    full_name: str = Form(...),
    password: str = Form(...),
    department: str = Form(default=""),
    email: str | None = Form(default=None),
    role: str = Form(default="employee"),
    shift_id: int | None = Form(default=None),
    supervisor_id: int | None = Form(default=None),
    viewer=deps.AdminDep,
) -> dict:
    conn = deps.get_conn(request)
    if role not in ("employee", "supervisor", "admin"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown role")
    if store.find_employee_by_number(conn, employee_number):
        raise HTTPException(status.HTTP_409_CONFLICT, "that employee number is taken")
    try:
        password_hash = security.hash_password(password)
    except DtrError as exc:
        raise deps.http_error(exc) from exc
    now = store.iso(store.now_utc())
    cursor = conn.execute(
        "INSERT INTO employees (employee_number, full_name, email, department, role, supervisor_id, "
        "shift_id, password_hash, must_change_password, status, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)",
        (employee_number.strip(), full_name.strip(), email or None, department.strip(), role,
         supervisor_id, shift_id, password_hash, now, now),
    )
    new_id = int(cursor.lastrowid)
    audit.record(conn, entity_type="employee", entity_id=new_id, action=audit.CREATE,
                 changed_by_id=viewer["id"],
                 new_value={"employee_number": employee_number, "name": full_name, "role": role},
                 ip_address=deps.client_ip(request))
    return {"ok": True, "id": new_id}


@router.post("/employees/{employee_id}")
def update_employee(
    request: Request,
    employee_id: int,
    department: str | None = Form(default=None),
    role: str | None = Form(default=None),
    shift_id: int | None = Form(default=None),
    supervisor_id: int | None = Form(default=None),
    status_value: str | None = Form(default=None, alias="status"),
    viewer=deps.AdminDep,
) -> dict:
    conn = deps.get_conn(request)
    before = store.get_employee(conn, employee_id)
    fields = {"department": department, "role": role, "shift_id": shift_id,
              "supervisor_id": supervisor_id, "status": status_value}
    changes = {k: v for k, v in fields.items() if v is not None and v != before[k]}
    if not changes:
        return {"ok": True, "changed": []}
    assignments = ", ".join(f"{k} = ?" for k in changes)
    conn.execute(
        f"UPDATE employees SET {assignments}, updated_at = ? WHERE id = ?",
        [*changes.values(), store.iso(store.now_utc()), employee_id],
    )
    if changes.get("status") == "inactive":
        auth.revoke_all(conn, employee_id)
    audit.record(conn, entity_type="employee", entity_id=employee_id, action=audit.UPDATE,
                 changed_by_id=viewer["id"],
                 old_value={k: before[k] for k in changes}, new_value=changes,
                 ip_address=deps.client_ip(request))
    return {"ok": True, "changed": sorted(changes)}


@router.post("/employees/{employee_id}/reset-device")
def reset_device(
    request: Request, employee_id: int, reason: str = Form(...), viewer=deps.AdminDep
) -> dict:
    """Unbind the phone — the next scan claims a new one. Always audited."""
    conn = deps.get_conn(request)
    before = store.get_employee(conn, employee_id)
    conn.execute(
        "UPDATE employees SET registered_device_id = NULL, device_bound_at = NULL, updated_at = ? WHERE id = ?",
        (store.iso(store.now_utc()), employee_id),
    )
    audit.record(conn, entity_type="employee", entity_id=employee_id, action=audit.RESET_DEVICE,
                 changed_by_id=viewer["id"], old_value={"device_id": before["registered_device_id"]},
                 new_value={"device_id": None}, reason=reason, ip_address=deps.client_ip(request))
    return {"ok": True}


@router.post("/employees/{employee_id}/password")
def admin_set_password(
    request: Request, employee_id: int, password: str = Form(...), viewer=deps.AdminDep
) -> dict:
    conn = deps.get_conn(request)
    try:
        auth.set_password(conn, employee_id, password, changed_by_id=viewer["id"], reason="admin reset")
    except DtrError as exc:
        raise deps.http_error(exc) from exc
    return {"ok": True, "note": "The employee must change this at next sign-in."}


# --------------------------------------------------------------- shifts


@router.get("/shifts")
def list_shifts(request: Request, viewer=deps.StaffDep) -> list[dict]:
    rows = deps.get_conn(request).execute("SELECT * FROM shifts ORDER BY name")
    return [dict(r) for r in rows]


@router.post("/shifts")
def create_shift(
    request: Request,
    name: str = Form(...),
    start_time: str = Form(...),
    end_time: str = Form(...),
    grace_minutes: int = Form(default=0),
    break_minutes: int = Form(default=60),
    break_after_minutes: int = Form(default=300),
    workdays: str = Form(default="1111100"),
    viewer=deps.AdminDep,
) -> dict:
    from ..timerules import parse_hhmm
    conn = deps.get_conn(request)
    try:
        parse_hhmm(start_time)
        parse_hhmm(end_time)
    except DtrError as exc:
        raise deps.http_error(exc) from exc
    if len(workdays) != 7 or set(workdays) - {"0", "1"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "workdays must be 7 characters of 0 or 1, Monday first")
    cursor = conn.execute(
        "INSERT INTO shifts (name, start_time, end_time, grace_minutes, break_minutes, "
        "break_after_minutes, workdays, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (name, start_time, end_time, grace_minutes, break_minutes, break_after_minutes,
         workdays, store.iso(store.now_utc())),
    )
    return {"ok": True, "id": int(cursor.lastrowid)}


# ------------------------------------------------------------- locations


def _location_payload(request: Request, row) -> str:
    settings = deps.get_settings(request)
    return security.build_payload(row["qr_code_id"], settings.secret_key)


@router.get("/locations")
def list_locations(request: Request, viewer=deps.StaffDep) -> list[dict]:
    conn = deps.get_conn(request)
    settings = deps.get_settings(request)
    return [
        {
            "id": r["id"], "name": r["name"], "latitude": r["latitude"], "longitude": r["longitude"],
            "radius_m": r["radius_m"], "code": r["qr_code_id"], "require_photo": bool(r["require_photo"]),
            "max_accuracy_m": r["max_accuracy_m"], "status": r["status"],
            "scan_url": f"{settings.base_url.rstrip('/')}/app/#c={_location_payload(request, r)}",
        }
        for r in store.list_locations(conn)
    ]


@router.post("/locations")
def create_location(
    request: Request,
    name: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    radius_m: float = Form(default=75),
    max_accuracy_m: float = Form(default=100),
    require_photo: bool = Form(default=False),
    viewer=deps.AdminDep,
) -> dict:
    conn = deps.get_conn(request)
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "those coordinates are not a real place")
    if radius_m < 20:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "a radius under 20 m will reject honest scans; consumer GPS is not that good")
    now = store.iso(store.now_utc())
    code = security.new_location_code()
    cursor = conn.execute(
        "INSERT INTO locations (name, latitude, longitude, radius_m, qr_code_id, qr_issued_at, "
        "require_photo, max_accuracy_m, status, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
        (name.strip(), latitude, longitude, radius_m, code, now,
         1 if require_photo else 0, max_accuracy_m, now, now),
    )
    new_id = int(cursor.lastrowid)
    audit.record(conn, entity_type="location", entity_id=new_id, action=audit.CREATE,
                 changed_by_id=viewer["id"],
                 new_value={"name": name, "radius_m": radius_m, "require_photo": require_photo},
                 ip_address=deps.client_ip(request))
    return {"ok": True, "id": new_id, "code": code}


@router.post("/locations/{location_id}")
def update_location(
    request: Request,
    location_id: int,
    radius_m: float | None = Form(default=None),
    max_accuracy_m: float | None = Form(default=None),
    require_photo: bool | None = Form(default=None),
    status_value: str | None = Form(default=None, alias="status"),
    rotate_code: bool = Form(default=False),
    viewer=deps.AdminDep,
) -> dict:
    conn = deps.get_conn(request)
    before = conn.execute("SELECT * FROM locations WHERE id = ?", (location_id,)).fetchone()
    if before is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such location")
    changes: dict = {}
    if radius_m is not None:
        changes["radius_m"] = radius_m
    if max_accuracy_m is not None:
        changes["max_accuracy_m"] = max_accuracy_m
    if require_photo is not None:
        changes["require_photo"] = 1 if require_photo else 0
    if status_value in ("active", "inactive"):
        changes["status"] = status_value
    if rotate_code:
        # Reprint the poster: the old one stops working immediately.
        changes["qr_code_id"] = security.new_location_code()
        changes["qr_issued_at"] = store.iso(store.now_utc())
    if not changes:
        return {"ok": True, "changed": []}
    assignments = ", ".join(f"{k} = ?" for k in changes)
    conn.execute(
        f"UPDATE locations SET {assignments}, updated_at = ? WHERE id = ?",
        [*changes.values(), store.iso(store.now_utc()), location_id],
    )
    audit.record(conn, entity_type="location", entity_id=location_id, action=audit.UPDATE,
                 changed_by_id=viewer["id"], old_value={k: before[k] for k in changes},
                 new_value=changes, ip_address=deps.client_ip(request))
    return {"ok": True, "changed": sorted(changes)}


@router.get("/locations/{location_id}/qr.svg")
def location_qr(request: Request, location_id: int, viewer=deps.StaffDep) -> Response:
    conn = deps.get_conn(request)
    row = conn.execute("SELECT * FROM locations WHERE id = ?", (location_id,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such location")
    settings = deps.get_settings(request)
    url = f"{settings.base_url.rstrip('/')}/app/#c={_location_payload(request, row)}"
    buffer = io.BytesIO()
    # Error correction H: the poster will get scuffed, rained on and taped over.
    # Pure black, not the interface's near-black: this is ink on paper feeding a
    # phone camera, and contrast is the only aesthetic that matters.
    segno.make(url, error="h").save(buffer, kind="svg", scale=8, border=2, dark="#000000")
    return Response(buffer.getvalue(), media_type="image/svg+xml")


# ------------------------------------------------------------ audit trail


@router.get("/audit")
def audit_trail(
    request: Request,
    entity_type: str | None = None,
    entity_id: str | None = None,
    limit: int = 200,
    viewer=deps.AdminDep,
) -> list[dict]:
    conn = deps.get_conn(request)
    sql = "SELECT a.*, e.full_name AS actor FROM audit_log a LEFT JOIN employees e ON e.id = a.changed_by_id WHERE 1 = 1"
    params: list = []
    if entity_type:
        sql += " AND a.entity_type = ?"
        params.append(entity_type)
    if entity_id:
        sql += " AND a.entity_id = ?"
        params.append(entity_id)
    rows = conn.execute(sql + " ORDER BY a.id DESC LIMIT ?", [*params, max(1, min(limit, 1000))])
    return [
        {
            "id": r["id"], "entity_type": r["entity_type"], "entity_id": r["entity_id"],
            "action": r["action"], "actor": r["actor"], "old_value": r["old_value"],
            "new_value": r["new_value"], "reason": r["reason"], "at": r["recorded_at"],
        }
        for r in rows
    ]


@router.get("/logs/{log_id}/photo")
def log_photo(request: Request, log_id: int, viewer=deps.StaffDep) -> FileResponse:
    """Serve a scan photo. Looking at one is itself an auditable act."""
    conn = deps.get_conn(request)
    settings = deps.get_settings(request)
    row = conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (log_id,)).fetchone()
    if row is None or not row["photo_path"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no photo for that entry")
    allowed = _scope(request, viewer)
    if allowed is not None and row["employee_id"] not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "that entry is not from your team")
    path = Path(settings.photo_dir) / row["photo_path"]
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "that photo has been deleted under the retention policy")
    audit.record(conn, entity_type="dtr_log", entity_id=log_id, action="view_photo",
                 changed_by_id=viewer["id"], ip_address=deps.client_ip(request))
    return FileResponse(path, media_type="image/jpeg" if path.suffix == ".jpg" else "image/png")
