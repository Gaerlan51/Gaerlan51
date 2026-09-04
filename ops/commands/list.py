"""`ops list` — the tracker as a table."""

from __future__ import annotations

from ..tracker import display_status
from ._common import load, today

HEADERS = ["id", "name", "service", "status", "payment", "deadline", "next f/u"]


def register(subparsers, parent):
    p = subparsers.add_parser("list", parents=[parent], help="list tracked clients")
    p.add_argument("--status")
    p.add_argument("--payment-status", dest="payment_status")
    p.add_argument("--overdue", action="store_true", help="only rows whose follow-up has passed")
    p.set_defaults(func=run)


def run(args) -> int:
    _, rows = load(args)
    now = today(args)
    if not rows:
        print("no tracker yet — run `ops add` to record your first inquiry")
        return 0

    if args.status:
        wanted = args.status.strip().lower().replace(" ", "-")
        rows = [r for r in rows if r.status == wanted]
    if args.payment_status:
        rows = [r for r in rows if r.payment_status == args.payment_status]
    if args.overdue:
        rows = [r for r in rows if r.next_followup_date and r.next_followup_date < now]

    if not rows:
        print("nothing matches")
        return 0

    far = now.replace(year=now.year + 50)
    rows.sort(key=lambda r: (r.next_followup_date or far, r.deadline_date or far))

    table = [HEADERS] + [
        [
            r.id,
            r.name,
            r.service_requested,
            display_status(r.status),
            r.payment_status,
            r.deadline or "—",
            r.next_followup or "—",
        ]
        for r in rows
    ]
    widths = [max(len(str(row[i])) for row in table) for i in range(len(HEADERS))]
    for n, line in enumerate(table):
        print("  ".join(str(cell).ljust(widths[i]) for i, cell in enumerate(line)).rstrip())
        if n == 0:
            print("  ".join("-" * w for w in widths))
    print(f"\n{len(rows)} shown")
    return 0
