"""The scan pipeline: everything that has to be true before a time is recorded.

This is the anti-manipulation core. The checks run in a deliberate order —
cheapest and most private first, so a phone that is nowhere near the office is
turned away before any photo is stored.

    1. is this poster ours?                (HMAC, then a database lookup)
    2. is the location and the person active?
    3. has the employee consented to location capture?
    4. is the phone actually here?          (fresh, tight GPS inside the fence)
    5. is this the same phone as last time? (device binding — flag, not block)
    6. is this a real punch or a double-tap?
    7. in or out, and is yesterday still hanging open?
    8. a photo, if this location asks for one

Only then is a row written, stamped with the *server's* clock. No client-supplied
timestamp reaches the database on any path through this module.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from . import ScanRejected
from . import audit, security, store
from .config import Settings
from .geo import Fix, check_fence
from .timerules import business_date

TIME_IN = "time_in"
TIME_OUT = "time_out"

# Flags are advisory: the punch is recorded, and a human decides.
FLAG_UNRECOGNISED_DEVICE = "unrecognised_device"
FLAG_EDGE_OF_GEOFENCE = "edge_of_geofence"
FLAG_MISSING_TIME_OUT = "missing_time_out"
FLAG_LONG_SHIFT = "improbably_long_shift"
FLAG_NO_PHOTO = "photo_missing"

PHOTO_MAGIC = {b"\xff\xd8\xff": ".jpg", b"\x89PNG\r\n\x1a\n": ".png"}
MAX_PHOTO_BYTES = 3 * 1024 * 1024
LONG_SHIFT_HOURS = 16


@dataclass
class ScanRequest:
    """What the phone sends. Note what is *not* here: a timestamp."""

    payload: str
    device_id: str
    fix: Fix
    photo: bytes | None = None
    ip_address: str | None = None
    user_agent: str | None = None


@dataclass
class ScanResult:
    log_id: int
    entry_type: str
    recorded_at: datetime
    business_date: date
    location_name: str
    employee_id: int
    employee_name: str
    distance_m: float | None
    flags: tuple[str, ...] = ()
    notes: list[str] = field(default_factory=list)

    @property
    def flagged(self) -> bool:
        return bool(self.flags)


def _store_photo(settings: Settings, photo: bytes, when: datetime) -> str:
    if len(photo) > MAX_PHOTO_BYTES:
        raise ScanRejected("photo_too_large", "That photo is too large. Try again.")
    suffix = next((ext for magic, ext in PHOTO_MAGIC.items() if photo.startswith(magic)), None)
    if suffix is None:
        raise ScanRejected("photo_invalid", "That file is not a photo.")
    relative = Path(f"{when:%Y/%m}") / f"{uuid.uuid4().hex}{suffix}"
    target = Path(settings.photo_dir) / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(photo)
    target.chmod(0o600)
    return str(relative)


def _reject(conn, employee_id, code, message, /, **detail) -> ScanRejected:
    """Every refusal is logged. A pattern of refusals is itself evidence.

    The first four arguments are positional-only so that a detail key may be
    called ``code`` or ``message`` without colliding with them.
    """
    audit.record(
        conn,
        entity_type="scan",
        entity_id=employee_id,
        action=audit.SCAN_REJECTED,
        changed_by_id=employee_id,
        new_value={"code": code, **detail},
        reason=message,
    )
    return ScanRejected(code, message, **detail)


def register_scan(
    conn: sqlite3.Connection,
    settings: Settings,
    employee: sqlite3.Row,
    request: ScanRequest,
    *,
    now: datetime | None = None,
) -> ScanResult:
    """Record one punch, or raise :class:`ScanRejected` explaining why not."""
    # The server's clock, read once, used everywhere below.
    now = now or store.now_utc()
    employee_id = employee["id"]
    flags: set[str] = set()
    notes: list[str] = []

    # 1. Is this poster ours?
    try:
        code = security.parse_payload(request.payload, settings.secret_key)
    except security.AuthError as exc:
        raise _reject(conn, employee_id, "qr_invalid", str(exc), payload_length=len(request.payload or ""))

    location = store.get_location_by_code(conn, code)
    if location is None:
        raise _reject(conn, employee_id, "qr_unknown", "That code does not belong to any workplace.", code=code)

    # 2. Both ends active?
    if location["status"] != "active":
        raise _reject(conn, employee_id, "location_inactive",
                      f"{location['name']} is not accepting scans.", location=location["name"])
    if employee["status"] != "active":
        raise _reject(conn, employee_id, "employee_inactive",
                      "Your account is inactive. Speak to HR.")

    # 3. Consent, before any location data is stored.
    if not employee["consent_location_at"]:
        raise _reject(conn, employee_id, "consent_required",
                      "Please read and accept the location notice before your first scan.")

    # 4. Is the phone here?
    verdict = check_fence(
        request.fix,
        latitude=location["latitude"],
        longitude=location["longitude"],
        radius_m=location["radius_m"],
        max_accuracy_m=min(location["max_accuracy_m"], settings.max_gps_accuracy_m),
        max_fix_age_seconds=settings.max_fix_age_seconds,
    )
    if not verdict.accepted:
        raise _reject(conn, employee_id, verdict.code, verdict.message,
                      distance_m=verdict.distance_m, location=location["name"])
    flags.update(verdict.flags)

    # 5. Device binding. First scan claims the phone; a different phone later is
    #    recorded and flagged, never silently accepted and never blocked — a
    #    blocked employee with a broken phone is a payroll dispute.
    device_id = (request.device_id or "").strip()[:128]
    if not device_id:
        raise _reject(conn, employee_id, "device_unknown", "This browser could not identify itself. Reopen the app.")
    if not employee["registered_device_id"]:
        conn.execute(
            "UPDATE employees SET registered_device_id = ?, device_bound_at = ?, updated_at = ? WHERE id = ?",
            (device_id, store.iso(now), store.iso(now), employee_id),
        )
        audit.record(conn, entity_type="employee", entity_id=employee_id, action=audit.BIND_DEVICE,
                     changed_by_id=employee_id, new_value={"device_id": device_id},
                     reason="first scan from this device")
        notes.append("This phone is now registered to your account.")
    elif employee["registered_device_id"] != device_id:
        flags.add(FLAG_UNRECOGNISED_DEVICE)
        notes.append("Recorded from an unrecognised device — your supervisor will review it.")

    # 6. Double-tap guard — and a check that time is still moving forwards.
    last = store.last_log(conn, employee_id)
    if last is not None:
        since = (now - store.parse_iso(last["recorded_at"])).total_seconds()
        if since < 0:
            # The server clock has stepped backwards (a bad NTP correction, a
            # restored snapshot). Recording now would put this punch before one
            # already written. Refuse, and make the refusal loud in the trail:
            # it is an operations problem, not the employee's.
            raise _reject(conn, employee_id, "clock_out_of_order",
                          "The system clock is being corrected. Try again in a minute, "
                          "and tell your supervisor if it keeps happening.",
                          seconds_behind=int(-since))
        if since < settings.duplicate_scan_seconds:
            raise _reject(conn, employee_id, "duplicate_scan",
                          f"You already scanned {int(since)} seconds ago.",
                          seconds_since=int(since), last_entry_type=last["entry_type"])

    # 7. In or out — derived from state, never asked of the client.
    open_row = store.open_entry(conn, employee_id)
    today = business_date(now, settings.tz, store.shift_for(conn, employee))
    if open_row is None:
        entry_type = TIME_IN
        day = today
    else:
        opened_at = store.parse_iso(open_row["recorded_at"])
        stale = open_row["business_date"] < today.isoformat()
        if stale and (now - opened_at) > timedelta(hours=LONG_SHIFT_HOURS):
            # Yesterday was never closed. Don't fabricate a time-out and don't
            # lock the employee out: open a fresh day and raise the anomaly.
            entry_type = TIME_IN
            day = today
            flags.add(FLAG_MISSING_TIME_OUT)
            notes.append(
                f"Your time-out for {open_row['business_date']} is missing. "
                "Submit a correction request so it can be fixed."
            )
        else:
            entry_type = TIME_OUT
            day = date.fromisoformat(open_row["business_date"])  # inherit the day it opened
            if (now - opened_at) > timedelta(hours=LONG_SHIFT_HOURS):
                flags.add(FLAG_LONG_SHIFT)

    # 8. Photo, only where the location asks for it.
    photo_path = None
    if location["require_photo"] and settings.photo_capture_available:
        if not employee["consent_photo_at"]:
            raise _reject(conn, employee_id, "photo_consent_required",
                          "This workplace records a photo at scan time. Please accept the notice first.")
        if not request.photo:
            raise _reject(conn, employee_id, "photo_required",
                          "This workplace needs a photo with each scan. Allow camera access and try again.")
        photo_path = _store_photo(settings, request.photo, now)
    elif request.photo:
        notes.append("Photo discarded: this workplace does not collect them.")

    log_id = store.insert_log(
        conn,
        employee_id=employee_id,
        entry_type=entry_type,
        recorded_at=now,
        business_date=day,
        location_id=location["id"],
        device_id=device_id,
        latitude=request.fix.latitude,
        longitude=request.fix.longitude,
        accuracy_m=request.fix.accuracy_m,
        distance_m=verdict.distance_m,
        photo_path=photo_path,
        flags=flags,
        source="scan",
        created_by_id=employee_id,
    )
    audit.record(
        conn,
        entity_type="dtr_log",
        entity_id=log_id,
        action=audit.CREATE,
        changed_by_id=employee_id,
        new_value={
            "entry_type": entry_type,
            "recorded_at": store.iso(now),
            "business_date": day.isoformat(),
            "location": location["name"],
            "distance_m": round(verdict.distance_m or 0, 1),
            "flags": sorted(flags),
        },
        reason="qr scan",
        ip_address=request.ip_address,
    )
    return ScanResult(
        log_id=log_id,
        entry_type=entry_type,
        recorded_at=now,
        business_date=day,
        location_name=location["name"],
        employee_id=employee_id,
        employee_name=employee["full_name"],
        distance_m=verdict.distance_m,
        flags=tuple(sorted(flags)),
        notes=notes,
    )
