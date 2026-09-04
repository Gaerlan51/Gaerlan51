"""`ops quote` — price a job from the config, or refuse."""

from __future__ import annotations

from datetime import timedelta

from ..money import format_money, is_rush, quote_lines, quote_total
from ..render import render_file
from ..tracker import append_history, can_transition, write_rows
from ._common import business_name, emit, load_one, stamp, today


def register(subparsers, parent):
    p = subparsers.add_parser("quote", parents=[parent], help="draft a quotation")
    p.add_argument("id")
    p.add_argument("--service", help="override the tracked service_requested")
    p.add_argument("--tests", type=int, default=0, help="number of analyses in scope")
    rush = p.add_mutually_exclusive_group()
    rush.add_argument("--rush", dest="rush", action="store_true", default=None)
    rush.add_argument("--no-rush", dest="rush", action="store_false")
    p.add_argument("--commit", action="store_true", help="save the figure to the tracker")
    p.set_defaults(func=run)


def run(args) -> int:
    config, rows, row = load_one(args)
    now = today(args)
    service = config.service(args.service or row.service_requested)

    rush = args.rush if args.rush is not None else is_rush(row.deadline_date, now, service)
    lines = quote_lines(service, config, tests=args.tests, rush=rush)
    total = quote_total(lines)

    text = render_file(
        "quote.md",
        {
            "business_name": business_name(config),
            "client_name": row.name,
            "first_name": row.first_name,
            "date": f"{now:%d %B %Y}",
            "valid_until": f"{now + timedelta(days=config.meta.quote_valid_days):%d %B %Y}",
            "service_name": service.name,
            "service_includes": service.includes,
            "turnaround": service.turnaround_display,
            "fee_lines": "\n".join(
                f"- {label} — {format_money(amount, config.meta.currency)}" for label, amount in lines
            ),
            "total": format_money(total, config.meta.currency),
        },
    )
    emit(row.id, "quote", text, now, args)

    if not args.commit:
        print("not saved; re-run with --commit to write the price and move status to Quoted")
        return 0

    old_price, old_status = row.quoted_price, row.status
    row.quoted_price = str(total)
    append_history(
        row.id, "quoted_price", old_price, row.quoted_price, getattr(args, "history", None), stamp(args)
    )
    if can_transition(old_status, "quoted"):
        row.status = "quoted"
        append_history(
            row.id, "status", old_status, "quoted", getattr(args, "history", None), stamp(args)
        )
    else:
        print(f"note: left status at {old_status} — moving back to quoted is not a legal transition")
    row.next_followup = (now + timedelta(days=config.followups.quote_followup_days)).isoformat()
    write_rows(rows, getattr(args, "tracker", None))
    print(f"saved: {row.id} quoted at {format_money(total, config.meta.currency)}, "
          f"follow up {row.next_followup}")
    return 0
