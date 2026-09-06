"""What the PWA calls: scan, own history, own corrections, consent."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status

from .. import DtrError, consent as consent_text, corrections, store
from ..geo import Fix
from ..scan import MAX_PHOTO_BYTES, ScanRequest, register_scan
from ..timerules import business_date, shift_start_local
from . import deps

router = APIRouter(prefix="/api", tags=["employee"])


@router.get("/consent")
def consent_notices(request: Request) -> dict:
    return consent_text.notices(deps.get_settings(request))


@router.post("/consent")
def accept_consent(request: Request, kind: str = Form(...), employee=deps.EmployeeDep) -> dict:
    """Consent is recorded with its version, so a later reword needs a fresh yes."""
    if kind not in ("location", "photo"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown notice")
    settings = deps.get_settings(request)
    conn = deps.get_conn(request)
    column = "consent_location_at" if kind == "location" else "consent_photo_at"
    now = store.iso(store.now_utc())
    conn.execute(
        f"UPDATE employees SET {column} = ?, consent_version = ?, updated_at = ? WHERE id = ?",
        (now, settings.consent_version, now, employee["id"]),
    )
    from .. import audit
    audit.record(conn, entity_type="employee", entity_id=employee["id"], action="consent",
                 changed_by_id=employee["id"],
                 new_value={"notice": kind, "version": settings.consent_version},
                 ip_address=deps.client_ip(request))
    return {"ok": True, "kind": kind, "version": settings.consent_version}


@router.post("/scan")
async def scan(
    request: Request,
    payload: str = Form(...),
    device_id: str = Form(...),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    accuracy_m: float | None = Form(default=None),
    fix_age_seconds: float | None = Form(default=None),
    photo: UploadFile | None = File(default=None),
    employee=deps.EmployeeDep,
) -> dict:
    """Record a punch.

    Note the absence of a timestamp field. There is no way for a client to tell
    this endpoint what time it is; the server reads its own clock inside
    :func:`register_scan`.
    """
    settings = deps.get_settings(request)
    conn = deps.get_conn(request)
    blob = None
    if photo is not None:
        blob = await photo.read(MAX_PHOTO_BYTES + 1)
    scan_request = ScanRequest(
        payload=payload,
        device_id=device_id,
        fix=Fix(latitude, longitude, accuracy_m, fix_age_seconds),
        photo=blob,
        ip_address=deps.client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    try:
        result = register_scan(conn, settings, employee, scan_request)
    except DtrError as exc:
        raise deps.http_error(exc) from exc

    payload_out = {
        "log_id": result.log_id,
        "entry_type": result.entry_type,
        "recorded_at": result.recorded_at.astimezone(settings.tz).isoformat(),
        "local_time": result.recorded_at.astimezone(settings.tz).strftime("%H:%M:%S"),
        "business_date": result.business_date.isoformat(),
        "location": result.location_name,
        "employee": result.employee_name,
        "distance_m": round(result.distance_m, 1) if result.distance_m is not None else None,
        "flags": list(result.flags),
        "notes": result.notes,
    }
    hub = request.app.state.hub
    await hub.broadcast({"type": "scan", "scan": payload_out})
    return payload_out


@router.get("/my/status")
def my_status(request: Request, employee=deps.EmployeeDep) -> dict:
    """Enough for the app to say where you stand, not just whether you are in."""
    settings = deps.get_settings(request)
    conn = deps.get_conn(request)
    open_row = store.open_entry(conn, employee["id"])
    last = store.last_log(conn, employee["id"])
    shift = store.shift_for(conn, employee)
    today = business_date(store.now_utc(), settings.tz, shift)

    late_minutes = 0
    if open_row is not None and shift.is_workday(today):
        due = shift_start_local(today, shift, settings.tz) + timedelta(minutes=shift.grace_minutes)
        started = store.parse_iso(open_row["recorded_at"])
        late_minutes = max(0, int((started - due).total_seconds() // 60))

    return {
        "clocked_in": open_row is not None,
        "next_action": "time_out" if open_row is not None else "time_in",
        "since": store.parse_iso(open_row["recorded_at"]).astimezone(settings.tz).isoformat()
        if open_row else None,
        "late_minutes": late_minutes,
        "business_date": today.isoformat(),
        "scheduled_today": shift.is_workday(today),
        "shift": {
            "name": shift.name,
            "start_time": shift.start_time.strftime("%H:%M"),
            "end_time": shift.end_time.strftime("%H:%M"),
            "required_minutes": shift.required_minutes,
        },
        "last_scan": {
            "entry_type": last["entry_type"],
            "at": store.parse_iso(last["recorded_at"]).astimezone(settings.tz).strftime("%Y-%m-%d %H:%M"),
        } if last else None,
    }


@router.get("/my/logs")
def my_logs(request: Request, days: int = 30, employee=deps.EmployeeDep) -> dict:
    """Read-only, always. There is no PUT or DELETE for an employee anywhere."""
    settings = deps.get_settings(request)
    conn = deps.get_conn(request)
    days = max(1, min(days, 120))
    end = business_date(store.now_utc(), settings.tz)
    start = end - timedelta(days=days - 1)
    # Don't open someone's record with a wall of absences from before their
    # first day, or from before this system existed.
    first = conn.execute(
        "SELECT MIN(business_date) AS d FROM dtr_logs WHERE employee_id = ? "
        "AND superseded_by_id IS NULL AND voided_at IS NULL",
        (employee["id"],),
    ).fetchone()["d"]
    if first:
        start = max(start, date.fromisoformat(first))
    from .. import reports
    records = reports.build_records(conn, start=start, end=end, tz=settings.tz, employee_ids=[employee["id"]])
    rows = store.logs_between(conn, start, end, employee_ids=[employee["id"]])
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": reports.as_dicts([r for r in records if r.time_in or r.status != "rest_day"], settings.tz),
        "entries": [
            {
                "id": r["id"],
                "entry_type": r["entry_type"],
                "business_date": r["business_date"],
                "at": store.parse_iso(r["recorded_at"]).astimezone(settings.tz).strftime("%Y-%m-%d %H:%M"),
                "source": r["source"],
                "flags": [f for f in (r["flag_reasons"] or "").split(",") if f],
            }
            for r in rows
        ],
    }


@router.get("/my/corrections")
def my_corrections(request: Request, employee=deps.EmployeeDep) -> list[dict]:
    conn = deps.get_conn(request)
    rows = conn.execute(
        "SELECT * FROM correction_requests WHERE employee_id = ? ORDER BY id DESC LIMIT 50",
        (employee["id"],),
    )
    return [
        {
            "id": r["id"],
            "type": r["request_type"],
            "business_date": r["business_date"],
            "requested_entry_type": r["requested_entry_type"],
            "requested_at": r["requested_at"],
            "reason": r["reason"],
            "status": r["status"],
            "review_note": r["review_note"],
        }
        for r in rows
    ]


@router.post("/my/corrections")
def submit_correction(
    request: Request,
    request_type: str = Form(...),
    business_date_str: str = Form(..., alias="business_date"),
    reason: str = Form(...),
    dtr_log_id: int | None = Form(default=None),
    requested_entry_type: str | None = Form(default=None),
    requested_at: str | None = Form(default=None),
    employee=deps.EmployeeDep,
) -> dict:
    conn = deps.get_conn(request)
    try:
        day = date.fromisoformat(business_date_str)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "give the date as YYYY-MM-DD") from exc
    try:
        request_id = corrections.submit(
            conn,
            employee_id=employee["id"],
            request_type=request_type,
            business_date=day,
            reason=reason,
            dtr_log_id=dtr_log_id,
            requested_entry_type=requested_entry_type,
            requested_at=requested_at,
        )
    except DtrError as exc:
        raise deps.http_error(exc) from exc
    return {"ok": True, "id": request_id, "status": "pending"}
