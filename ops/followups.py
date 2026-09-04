"""What needs attention today.

Pure functions over rows plus an explicit `today`, so the rules can be tested
without pinning the system clock. Formatting lives in the status command.
"""

from __future__ import annotations

from datetime import date

from .config import Followups
from .tracker import Row

Finding = tuple[Row, str]

QUIET_STATUSES = {"scoping", "quoted", "awaiting-payment"}
OPEN_STATUSES = set(
    ["new-inquiry", "scoping", "quoted", "awaiting-payment", "in-progress", "delivered", "follow-up"]
)


def _open(rows: list[Row]) -> list[Row]:
    return [r for r in rows if r.status in OPEN_STATUSES]


def _days(a: date, b: date) -> int:
    return (a - b).days


def overdue_followups(rows: list[Row], today: date) -> list[Finding]:
    out = []
    for row in _open(rows):
        due = row.next_followup_date
        if due and due < today:
            late = _days(today, due)
            out.append((row, f"follow-up was due {due:%b %d} ({late}d ago)"))
    return sorted(out, key=lambda f: f[0].next_followup_date or today)


def due_today(rows: list[Row], today: date) -> list[Finding]:
    return [
        (row, "follow-up due today")
        for row in _open(rows)
        if row.next_followup_date == today
    ]


def unpaid_past_terms(
    rows: list[Row], today: date, invoiced_on: dict[str, date], terms_days: int
) -> list[Finding]:
    out = []
    for row in _open(rows):
        if row.payment_status not in ("invoiced", "partial"):
            continue
        sent = invoiced_on.get(row.id)
        if not sent:
            continue
        age = _days(today, sent)
        if age > terms_days:
            out.append((row, f"invoiced {age}d ago, terms are {terms_days}d — unpaid"))
    return sorted(out, key=lambda f: invoiced_on[f[0].id])


def deadline_risk(rows: list[Row], today: date, within_days: int) -> list[Finding]:
    out = []
    for row in rows:
        if row.status != "in-progress":
            continue
        due = row.deadline_date
        if not due:
            continue
        left = _days(due, today)
        if left < 0:
            out.append((row, f"client deadline passed {abs(left)}d ago ({due:%b %d})"))
        elif left <= within_days:
            out.append((row, f"client deadline in {left}d ({due:%b %d})"))
    return sorted(out, key=lambda f: f[0].deadline_date or today)


def gone_quiet(
    rows: list[Row], today: date, last_change: dict[str, date], silence_days: int
) -> list[Finding]:
    out = []
    for row in rows:
        if row.status not in QUIET_STATUSES:
            continue
        since = last_change.get(row.id) or row.date_inquired_date
        if not since:
            continue
        age = _days(today, since)
        if age >= silence_days:
            out.append((row, f"no movement in {age}d (still {row.status})"))
    return sorted(out, key=lambda f: f[1], reverse=True)


def collect(
    rows: list[Row],
    today: date,
    invoiced_on: dict[str, date],
    last_change: dict[str, date],
    rules: Followups,
    terms_days: int,
) -> list[tuple[str, list[Finding]]]:
    """Every section `ops status` prints, in the order it prints them."""
    return [
        ("Overdue follow-ups", overdue_followups(rows, today)),
        ("Due today", due_today(rows, today)),
        ("Unpaid past terms", unpaid_past_terms(rows, today, invoiced_on, terms_days)),
        ("Deadline risk", deadline_risk(rows, today, rules.deadline_risk_days)),
        ("Gone quiet", gone_quiet(rows, today, last_change, rules.checkin_silence_days)),
    ]
