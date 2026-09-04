"""`ops remind` — reminder drafts.

For a payment reminder with no tone given, this prints BOTH variants rather than
picking one. Master prompt §6 says the owner chooses the firmness level; this is
that rule in code.
"""

from __future__ import annotations

from ..money import format_money
from ..render import render_file
from ..tracker import invoice_dates, last_status_change, parse_date, read_history
from .. import OpsError
from ._common import emit, load_one, today

KINDS = ["payment", "consult", "checkin", "delivery"]


def register(subparsers, parent):
    p = subparsers.add_parser("remind", parents=[parent], help="draft a reminder message")
    p.add_argument("id")
    p.add_argument("--kind", required=True, choices=KINDS)
    p.add_argument("--tone", choices=["gentle", "firm"], help="payment reminders only")
    p.add_argument("--on", help="consultation date (YYYY-MM-DD), for --kind consult")
    p.add_argument("--since", help="override the invoice/last-contact date")
    p.set_defaults(func=run)


def _service_label(row, config) -> str:
    try:
        return config.service(row.service_requested).name
    except Exception:
        return row.service_requested or "the work"


def _payment(row, config, now, args):
    history = read_history(getattr(args, "history", None))
    sent = parse_date(args.since) if args.since else invoice_dates(history).get(row.id)
    if not sent:
        raise OpsError(
            f"no invoice date recorded for {row.id}. "
            f"Run `ops invoice {row.id} --commit` first, or pass --since YYYY-MM-DD."
        )
    if row.price is None:
        raise OpsError(f"{row.id} has no quoted price to remind about.")

    fields = {
        "first_name": row.first_name,
        "service_name": _service_label(row, config),
        "amount_due": format_money(row.price, config.meta.currency),
        "invoice_date": f"{sent:%d %B}",
        "days_outstanding": str((now - sent).days),
    }
    tones = [args.tone] if args.tone else ["gentle", "firm"]
    parts = []
    for tone in tones:
        body = render_file(f"reminder-payment-{tone}.md", fields)
        parts.append(f"### {tone.capitalize()}\n\n{body.strip()}")
    text = "\n\n".join(parts)
    if not args.tone:
        text += "\n\n_(Two variants — pick the firmness that fits; don't send both.)_"
    return text


def run(args) -> int:
    config, _, row = load_one(args)
    now = today(args)

    if args.kind == "payment":
        text = _payment(row, config, now, args)
    elif args.kind == "consult":
        when = parse_date(args.on)
        if not when:
            raise OpsError("--kind consult needs --on YYYY-MM-DD (the consultation date)")
        text = render_file(
            "reminder-consult.md",
            {"first_name": row.first_name, "consult_date": f"{when:%A, %d %B}"},
        )
    elif args.kind == "checkin":
        history = read_history(getattr(args, "history", None))
        since = (
            parse_date(args.since)
            or last_status_change(history).get(row.id)
            or row.date_inquired_date
        )
        if not since:
            raise OpsError(f"no last-contact date for {row.id}; pass --since YYYY-MM-DD.")
        text = render_file(
            "reminder-checkin.md",
            {
                "first_name": row.first_name,
                "thesis_topic": row.thesis_topic or "thesis",
                "last_contact": f"{since:%d %B}",
            },
        )
    else:
        text = render_file("reminder-delivery.md", {"first_name": row.first_name})

    emit(row.id, f"reminder-{args.kind}", text, now, args)
    return 0
