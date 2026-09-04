"""`ops add` — put a new inquiry in the tracker."""

from __future__ import annotations

import re
import sys
from datetime import timedelta

from ..tracker import (
    COLUMNS,
    PAYMENT_STATUSES,
    STAGES,
    Row,
    make_id,
    append_history,
    parse_date,
    read_rows,
    write_rows,
)
from .. import OpsError
from ._common import load, stamp, today

FIELD_FLAGS = [c for c in COLUMNS if c != "id"]
REQUIRED = ["name", "service_requested"]

LABELS = {
    "name": ["name", "full name", "student name"],
    "school": ["school", "university", "program", "course"],
    "thesis_topic": ["thesis", "thesis title", "topic", "title", "study"],
    "stage": ["stage", "status of thesis"],
    "service_requested": ["service", "needs", "asking for", "request"],
    "deadline": ["deadline", "due", "defense date", "submission"],
    "notes": ["notes", "contact", "email", "number", "messenger"],
}


def register(subparsers, parent):
    p = subparsers.add_parser("add", parents=[parent], help="add a new inquiry")
    for flag in FIELD_FLAGS:
        p.add_argument(f"--{flag.replace('_', '-')}", dest=flag, default=None)
    p.add_argument("--from-intake", dest="intake", help="file with a pasted inquiry to parse")
    p.set_defaults(func=run)


def parse_intake(text: str) -> dict:
    """Best-effort: labelled lines only. Whatever it misses gets prompted for."""
    found: dict[str, str] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        label, _, value = line.partition(":")
        label = re.sub(r"[^a-z ]", "", label.strip().lower()).strip()
        value = value.strip()
        if not value:
            continue
        for field, aliases in LABELS.items():
            if field in found:
                continue
            if any(label == alias or label.startswith(alias) for alias in aliases):
                found[field] = value
                break
    if "stage" in found:
        slug = found["stage"].lower().replace(" ", "_")
        found["stage"] = slug if slug in STAGES else ""
        if not found["stage"]:
            del found["stage"]
    if "deadline" in found:
        try:
            parse_date(found["deadline"])
        except Exception:
            found["notes"] = (found.get("notes", "") + f"\ndeadline as given: {found['deadline']}").strip()
            del found["deadline"]
    return found


def _ask(field: str) -> str:
    if not sys.stdin.isatty():
        raise OpsError(
            f"{field} is required and stdin is not a terminal. "
            f"Pass --{field.replace('_', '-')}."
        )
    return input(f"{field.replace('_', ' ')}: ").strip()


def run(args) -> int:
    config, rows = load(args)
    now = today(args)

    values = {f: (getattr(args, f, None) or "") for f in FIELD_FLAGS}
    if args.intake:
        parsed = parse_intake(open(args.intake, encoding="utf-8").read())
        for field, value in parsed.items():
            if not values.get(field):
                values[field] = value
        print("Parsed from intake:")
        for field, value in sorted(parsed.items()):
            print(f"  {field}: {value}")
        print()

    for field in REQUIRED:
        while not values[field]:
            values[field] = _ask(field)

    known = {s.id for s in config.services} | {"other"}
    if values["service_requested"] not in known:
        print(
            f"note: service {values['service_requested']!r} is not in the config "
            f"({', '.join(sorted(known))}). Stored as-is; quoting it will need a manual price.",
        )

    values["date_inquired"] = values["date_inquired"] or now.isoformat()
    values["status"] = values["status"] or "new-inquiry"
    values["payment_status"] = values["payment_status"] or "unbilled"
    values["next_followup"] = values["next_followup"] or (now + timedelta(days=2)).isoformat()
    if values["stage"] and values["stage"] not in STAGES:
        raise OpsError(f"stage must be one of {', '.join(STAGES)}")
    if values["payment_status"] not in PAYMENT_STATUSES:
        raise OpsError(f"payment_status must be one of {', '.join(PAYMENT_STATUSES)}")

    row = Row(id=make_id(values["name"], now, {r.id for r in rows}), **values)
    rows.append(row)
    write_rows(rows, getattr(args, "tracker", None))
    append_history(row.id, "status", "", row.status, getattr(args, "history", None), stamp(args))

    print(f"added {row.id} — {row.name} ({row.service_requested}), follow up {row.next_followup}")
    return 0
