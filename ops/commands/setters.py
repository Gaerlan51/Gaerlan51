"""`ops set-status` and `ops set` — validated writes, each recorded in history."""

from __future__ import annotations

from ..tracker import (
    COLUMNS,
    PAYMENT_STATUSES,
    STAGES,
    append_history,
    can_transition,
    display_status,
    next_statuses,
    normalise_status,
    write_rows,
)
from ..config import ConfigError
from ._common import load_one, stamp, today

EDITABLE = [c for c in COLUMNS if c != "id"]


def register(subparsers, parent):
    p = subparsers.add_parser("set-status", parents=[parent], help="move a client's status")
    p.add_argument("id")
    p.add_argument("status")
    p.add_argument("--force", action="store_true", help="allow an out-of-order move")
    p.set_defaults(func=run_status)

    q = subparsers.add_parser("set", parents=[parent], help="set any tracker field")
    q.add_argument("id")
    q.add_argument("field", choices=EDITABLE)
    q.add_argument("value")
    q.set_defaults(func=run_set)


def run_status(args) -> int:
    _, rows, row = load_one(args)
    new = normalise_status(args.status)
    old = row.status
    if not can_transition(old, new) and not args.force:
        legal = ", ".join(display_status(s) for s in next_statuses(old))
        raise ConfigError(
            f"{display_status(old)} → {display_status(new)} is not a legal move.\n"
            f"Legal next values: {legal}. Use --force if this really happened."
        )
    row.status = new
    append_history(row.id, "status", old, new, getattr(args, "history", None), stamp(args))
    write_rows(rows, getattr(args, "tracker", None))
    print(f"{row.id}: {display_status(old)} → {display_status(new)}")
    return 0


def run_set(args) -> int:
    _, rows, row = load_one(args)
    if args.field == "status":
        return run_status(args)
    if args.field == "stage" and args.value not in STAGES:
        raise ConfigError(f"stage must be one of {', '.join(STAGES)}")
    if args.field == "payment_status" and args.value not in PAYMENT_STATUSES:
        raise ConfigError(f"payment_status must be one of {', '.join(PAYMENT_STATUSES)}")

    old = getattr(row, args.field)
    setattr(row, args.field, args.value)
    append_history(
        row.id, args.field, old, args.value, getattr(args, "history", None), stamp(args)
    )
    write_rows(rows, getattr(args, "tracker", None))
    print(f"{row.id}: {args.field} {old!r} → {args.value!r}")
    return 0
