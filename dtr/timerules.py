"""Shifts, the business day, and the hours arithmetic behind every report.

Pure functions over plain values: no database, no clock of its own. That keeps
the payroll numbers testable, which matters more here than anywhere else in the
system — an employee who disputes a figure is entitled to an explanation, and
"the computer said so" is not one.

Breaks are not scanned (decided at build time). Instead each shift carries an
unpaid ``break_minutes`` that is deducted once the day passes
``break_after_minutes`` — 300 by default, matching the Labor Code's meal period
for work of more than five hours.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from . import DtrError

MINUTES_PER_DAY = 24 * 60

PRESENT = "present"
LATE = "late"
ABSENT = "absent"
INCOMPLETE = "incomplete"   # clocked in, never clocked out
REST_DAY = "rest_day"
UNSCHEDULED = "unscheduled"  # worked on a day they were not rostered


class ScheduleError(DtrError):
    pass


def parse_hhmm(text: str) -> time:
    try:
        hour, _, minute = text.partition(":")
        return time(int(hour), int(minute))
    except (ValueError, AttributeError) as exc:
        raise ScheduleError(f"{text!r} is not a time of day like '08:30'") from exc


def minutes_of_day(value: time) -> int:
    return value.hour * 60 + value.minute


@dataclass(frozen=True)
class Shift:
    id: int | None
    name: str
    start_time: time
    end_time: time
    grace_minutes: int = 0
    break_minutes: int = 60
    break_after_minutes: int = 300
    workdays: str = "1111100"  # Monday first

    @classmethod
    def from_row(cls, row) -> "Shift":
        return cls(
            id=row["id"],
            name=row["name"],
            start_time=parse_hhmm(row["start_time"]),
            end_time=parse_hhmm(row["end_time"]),
            grace_minutes=row["grace_minutes"],
            break_minutes=row["break_minutes"],
            break_after_minutes=row["break_after_minutes"],
            workdays=row["workdays"],
        )

    @property
    def wraps_midnight(self) -> bool:
        return minutes_of_day(self.end_time) <= minutes_of_day(self.start_time)

    @property
    def span_minutes(self) -> int:
        span = minutes_of_day(self.end_time) - minutes_of_day(self.start_time)
        return span + MINUTES_PER_DAY if span <= 0 else span

    @property
    def required_minutes(self) -> int:
        """Paid minutes a full day owes, after the unpaid break."""
        span = self.span_minutes
        return span - self.break_minutes if span > self.break_after_minutes else span

    def is_workday(self, day: date) -> bool:
        flags = self.workdays.ljust(7, "0")
        return flags[day.weekday()] == "1"


DEFAULT_SHIFT = Shift(None, "Default 8-5", time(8, 0), time(17, 0))


# ------------------------------------------------------------ business day


def to_local(moment: datetime, tz: ZoneInfo) -> datetime:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(tz)


def business_date(moment: datetime, tz: ZoneInfo, shift: Shift | None = None) -> date:
    """Which working day a *time-in* belongs to.

    For a day shift this is simply the local date. For a shift that wraps
    midnight, a punch before the shift's end time still belongs to the day
    before — otherwise someone arriving at 00:30 for a 22:00–06:00 shift would
    open a second day.

    A time-out never calls this: it inherits the business date of the time-in
    it closes, so overtime past the end of a night shift stays on one row.
    """
    local = to_local(moment, tz)
    if shift is not None and shift.wraps_midnight:
        if minutes_of_day(local.time()) < minutes_of_day(shift.end_time):
            return (local - timedelta(days=1)).date()
    return local.date()


def shift_start_local(day: date, shift: Shift, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, shift.start_time, tzinfo=tz)


# ------------------------------------------------------------- day records


@dataclass(frozen=True)
class DayRecord:
    employee_id: int
    employee_number: str
    employee_name: str
    department: str
    day: date
    shift_name: str
    time_in: datetime | None
    time_out: datetime | None
    worked_minutes: int
    late_minutes: int
    undertime_minutes: int
    overtime_minutes: int
    break_deducted: int
    status: str
    flags: tuple[str, ...] = ()

    @property
    def worked_hours(self) -> float:
        return round(self.worked_minutes / 60, 2)


def summarise_day(
    *,
    employee_id: int,
    employee_number: str,
    employee_name: str,
    department: str,
    day: date,
    shift: Shift,
    tz: ZoneInfo,
    time_in: datetime | None,
    time_out: datetime | None,
    flags: tuple[str, ...] = (),
) -> DayRecord:
    """Turn one day's pair of scans into the numbers payroll needs."""
    scheduled = shift.is_workday(day)

    if time_in is None:
        status = REST_DAY if not scheduled else ABSENT
        return DayRecord(
            employee_id, employee_number, employee_name, department, day, shift.name,
            None, None, 0, 0, shift.required_minutes if scheduled else 0, 0, 0, status, flags,
        )

    local_in = to_local(time_in, tz)
    late = 0
    if scheduled:
        due = shift_start_local(day, shift, tz) + timedelta(minutes=shift.grace_minutes)
        late = max(0, int((local_in - due).total_seconds() // 60))

    if time_out is None:
        status = INCOMPLETE
        return DayRecord(
            employee_id, employee_number, employee_name, department, day, shift.name,
            time_in, None, 0, late, 0, 0, 0, status, flags,
        )

    raw = max(0, int((time_out - time_in).total_seconds() // 60))
    deducted = shift.break_minutes if raw > shift.break_after_minutes else 0
    worked = max(0, raw - deducted)

    if not scheduled:
        status = UNSCHEDULED
        undertime, overtime = 0, worked
    else:
        undertime = max(0, shift.required_minutes - worked)
        overtime = max(0, worked - shift.required_minutes)
        status = LATE if late > 0 else PRESENT

    return DayRecord(
        employee_id, employee_number, employee_name, department, day, shift.name,
        time_in, time_out, worked, late, undertime, overtime, deducted, status, flags,
    )


def date_range(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)
