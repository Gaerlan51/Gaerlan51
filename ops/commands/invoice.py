"""`ops invoice` — a payment request built from the tracked quote and the config."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from ..config import PriceNotSetError
from ..money import format_money
from ..render import render_file
from ..tracker import append_history, parse_money, write_rows
from ._common import business_name, emit, load_one, stamp, today


def register(subparsers, parent):
    p = subparsers.add_parser("invoice", parents=[parent], help="draft an invoice")
    p.add_argument("id")
    p.add_argument("--amount", help="override the tracked quoted price")
    p.add_argument("--commit", action="store_true", help="mark the client invoiced")
    p.set_defaults(func=run)


def run(args) -> int:
    config, rows, row = load_one(args)
    now = today(args)

    amount: Decimal | None = parse_money(args.amount) if args.amount else row.price
    if amount is None or amount <= 0:
        raise PriceNotSetError(
            f"[PRICE NOT SET — ask owner] {row.id} has no quoted price. "
            f"Run `ops quote {row.id} --commit` first, or pass --amount."
        )

    service_name = row.service_requested
    includes = ""
    try:
        service = config.service(row.service_requested)
        service_name, includes = service.name, service.includes
    except Exception:
        includes = "As agreed."

    due = now + timedelta(days=config.meta.payment_terms_days)
    text = render_file(
        "invoice.md",
        {
            "business_name": business_name(config),
            "client_name": row.name,
            "service_name": service_name,
            "service_includes": includes or "As agreed.",
            "date": f"{now:%d %B %Y}",
            "due_date": f"{due:%d %B %Y}",
            "amount_due": format_money(amount, config.meta.currency),
            "payment_instructions": config.payment.rendered_instructions(),
        },
    )
    emit(row.id, "invoice", text, now, args)

    if not args.commit:
        print("not saved; re-run with --commit to mark this client invoiced")
        return 0

    old = row.payment_status
    row.payment_status = "invoiced"
    row.quoted_price = str(amount)
    row.next_followup = (now + timedelta(days=config.followups.payment_gentle_days)).isoformat()
    append_history(
        row.id, "payment_status", old, "invoiced", getattr(args, "history", None), stamp(args)
    )
    write_rows(rows, getattr(args, "tracker", None))
    print(f"saved: {row.id} invoiced {format_money(amount, config.meta.currency)}, due {due}")
    return 0
