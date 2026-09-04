"""The tracker: a CSV of clients, its schema, its legal status moves, and its history.

`data/` is gitignored — this repo is public and these rows are personal data about
identifiable students. Nothing here may write a client record anywhere else.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, fields
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import DEFAULT_HISTORY, DEFAULT_TRACKER, OpsError

BACKUPS_KEPT = 20

STATUS_FLOW = [
    "new-inquiry",
    "scoping",
    "quoted",
    "awaiting-payment",
    "in-progress",
    "delivered",
    "follow-up",
    "closed-won",
]
CLOSED_LOST = "closed-lost"
STATUSES = STATUS_FLOW + [CLOSED_LOST]

STATUS_DISPLAY = {
    "new-inquiry": "New Inquiry",
    "scoping": "Scoping",
    "quoted": "Quoted",
    "awaiting-payment": "Awaiting Payment",
    "in-progress": "In Progress",
    "delivered": "Delivered",
    "follow-up": "Follow-up",
    "closed-won": "Closed-Won",
    "closed-lost": "Closed-Lost",
}

STAGES = ["proposal", "data_collected", "defense_ready"]
PAYMENT_STATUSES = ["unbilled", "invoiced", "partial", "paid", "written_off"]

COLUMNS = [
    "id",
    "date_inquired",
    "name",
    "school",
    "thesis_topic",
    "stage",
    "service_requested",
    "deadline",
    "status",
    "quoted_price",
    "payment_status",
    "next_followup",
    "notes",
]


class TrackerError(OpsError):
    pass


def display_status(status: str) -> str:
    return STATUS_DISPLAY.get(status, status)


def normalise_status(value: str) -> str:
    slug = value.strip().lower().replace(" ", "-").replace("_", "-")
    if slug not in STATUSES:
        raise TrackerError(f"unknown status {value!r}. Known: {', '.join(STATUSES)}")
    return slug


def next_statuses(status: str) -> list[str]:
    """Legal moves: forward along the flow, one step back, or lost at any point."""
    if status == CLOSED_LOST:
        return [CLOSED_LOST]
    idx = STATUS_FLOW.index(status)
    ahead = STATUS_FLOW[idx + 1 :]
    back = [STATUS_FLOW[idx - 1]] if idx > 0 else []
    return back + ahead + [CLOSED_LOST]


def can_transition(old: str, new: str) -> bool:
    if old == new:
        return True
    if new == CLOSED_LOST:
        return True
    if old == CLOSED_LOST:
        return False
    return new in next_statuses(old)


def parse_date(value: str | None) -> date | None:
    if not value or not str(value).strip():
        return None
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise TrackerError(f"{value!r} is not a date — use YYYY-MM-DD") from exc


def parse_money(value: str | None) -> Decimal | None:
    if value is None or not str(value).strip():
        return None
    try:
        return Decimal(str(value).replace(",", "").strip())
    except InvalidOperation as exc:
        raise TrackerError(f"{value!r} is not a number") from exc


@dataclass
class Row:
    id: str = ""
    date_inquired: str = ""
    name: str = ""
    school: str = ""
    thesis_topic: str = ""
    stage: str = ""
    service_requested: str = ""
    deadline: str = ""
    status: str = "new-inquiry"
    quoted_price: str = ""
    payment_status: str = "unbilled"
    next_followup: str = ""
    notes: str = ""

    @property
    def first_name(self) -> str:
        return self.name.strip().split(" ")[0] if self.name.strip() else ""

    @property
    def deadline_date(self) -> date | None:
        return parse_date(self.deadline)

    @property
    def next_followup_date(self) -> date | None:
        return parse_date(self.next_followup)

    @property
    def date_inquired_date(self) -> date | None:
        return parse_date(self.date_inquired)

    @property
    def price(self) -> Decimal | None:
        return parse_money(self.quoted_price)

    def to_dict(self) -> dict:
        out = {f.name: getattr(self, f.name) for f in fields(self)}
        out["notes"] = out["notes"].replace("\\", "\\\\").replace("\n", "\\n")
        return out

    @classmethod
    def from_dict(cls, data: dict) -> "Row":
        clean = {k: (data.get(k) or "").strip() for k in COLUMNS}
        clean["notes"] = _unescape(data.get("notes") or "")
        return cls(**clean)


def _unescape(value: str) -> str:
    out, i = [], 0
    while i < len(value):
        if value[i] == "\\" and i + 1 < len(value):
            nxt = value[i + 1]
            if nxt == "n":
                out.append("\n")
                i += 2
                continue
            if nxt == "\\":
                out.append("\\")
                i += 2
                continue
        out.append(value[i])
        i += 1
    return "".join(out)


def make_id(name: str, when: date, existing: set[str] | None = None) -> str:
    existing = existing or set()
    parts = [p for p in re.split(r"[^A-Za-z]+", name) if p]
    surname = (parts[-1] if parts else "client").lower()
    base = f"{surname}-{when:%y%m}"
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


def read_rows(path: Path | None = None) -> list[Row]:
    path = Path(path) if path else DEFAULT_TRACKER
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return [Row.from_dict(r) for r in csv.DictReader(handle)]


def find(rows: list[Row], row_id: str) -> Row:
    for row in rows:
        if row.id == row_id:
            return row
    raise TrackerError(f"no client with id {row_id!r}. Run `ops list` to see ids.")


def _backup(path: Path) -> None:
    if not path.exists():
        return
    backups = path.parent / ".backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    (backups / f"{path.stem}-{stamp}.csv").write_bytes(path.read_bytes())
    old = sorted(backups.glob(f"{path.stem}-*.csv"))
    for stale in old[:-BACKUPS_KEPT]:
        stale.unlink()


def write_rows(rows: list[Row], path: Path | None = None) -> None:
    path = Path(path) if path else DEFAULT_TRACKER
    path.parent.mkdir(parents=True, exist_ok=True)
    _backup(path)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_dict())


HISTORY_COLUMNS = ["id", "timestamp", "field", "old", "new"]


def append_history(
    row_id: str,
    field: str,
    old: str,
    new: str,
    path: Path | None = None,
    stamp: datetime | None = None,
) -> None:
    path = Path(path) if path else DEFAULT_HISTORY
    path.parent.mkdir(parents=True, exist_ok=True)
    fresh = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=HISTORY_COLUMNS, quoting=csv.QUOTE_MINIMAL)
        if fresh:
            writer.writeheader()
        writer.writerow(
            {
                "id": row_id,
                "timestamp": (stamp or datetime.now()).isoformat(timespec="seconds"),
                "field": field,
                "old": old,
                "new": new,
            }
        )


def read_history(path: Path | None = None) -> list[dict]:
    path = Path(path) if path else DEFAULT_HISTORY
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _event_dates(history: list[dict], field: str, new_value: str | None = None) -> dict[str, date]:
    """Latest date per client on which `field` changed (optionally to `new_value`)."""
    out: dict[str, date] = {}
    for event in history:
        if event.get("field") != field:
            continue
        if new_value is not None and event.get("new") != new_value:
            continue
        try:
            when = datetime.fromisoformat(event["timestamp"]).date()
        except (ValueError, KeyError):
            continue
        rid = event.get("id", "")
        if rid not in out or when > out[rid]:
            out[rid] = when
    return out


def invoice_dates(history: list[dict]) -> dict[str, date]:
    return _event_dates(history, "payment_status", "invoiced")


def last_status_change(history: list[dict]) -> dict[str, date]:
    return _event_dates(history, "status")
