"""`ops status` — the morning dashboard. Always exits 0: "you have work" is not an error."""

from __future__ import annotations

from ..followups import collect
from ..tracker import invoice_dates, last_status_change, read_history
from ._common import load, today


def register(subparsers, parent):
    p = subparsers.add_parser("status", parents=[parent], help="what needs attention today")
    p.set_defaults(func=run)


def run(args) -> int:
    config, rows = load(args)
    now = today(args)

    if not rows:
        print("no tracker yet — run `ops add` to record your first inquiry")
        return 0

    history = read_history(getattr(args, "history", None))
    sections = collect(
        rows,
        now,
        invoice_dates(history),
        last_status_change(history),
        config.followups,
        config.meta.payment_terms_days,
    )

    flagged: set[str] = set()
    print(f"Status for {now:%A, %d %b %Y}\n")
    for title, findings in sections:
        if not findings:
            continue
        print(f"{title}")
        for row, reason in findings:
            flagged.add(row.id)
            print(f"  {row.id:<16} {row.name:<24} {reason}")
        print()

    if not flagged:
        print("nothing needs attention today\n")
    print(f"{len(flagged)} need attention, {len(rows)} tracked.")
    return 0
