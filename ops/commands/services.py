"""`ops services` — the resolved menu, and the table to attach to the Claude Project."""

from __future__ import annotations

from ..money import format_money
from ._common import load, today


def register(subparsers, parent):
    p = subparsers.add_parser("services", parents=[parent], help="show the service menu")
    p.add_argument("--markdown", action="store_true", help="emit the table for the Claude Project")
    p.set_defaults(func=run)


def _price(service, config) -> str:
    if not service.price_is_set:
        return "**[PRICE NOT SET]**"
    out = format_money(service.price, config.meta.currency)
    if service.price_per_extra_test > 0:
        out += f" (+{format_money(service.price_per_extra_test, config.meta.currency)}/extra test)"
    return out


def run(args) -> int:
    config, _ = load(args)
    now = today(args)

    if not args.markdown:
        print(f"config: {', '.join(str(p) for p in config.source_paths)}\n")
        for svc in config.services:
            print(f"{svc.id:<18} {svc.name}")
            print(f"{'':<18} {_price(svc, config)} · {svc.turnaround_display}")
            if svc.price_note:
                print(f"{'':<18} {svc.price_note}")
            print()
        rush = config.rush
        print(f"rush: {'on' if rush.enabled else 'off'} ×{rush.multiplier.normalize()}")
        print(f"payment: {'set' if config.payment.is_set else '**[GCASH DETAILS NOT SET]**'}")
        unset = [s.id for s in config.services if not s.price_is_set]
        if unset:
            print(f"\n{len(unset)} service(s) with no price: {', '.join(unset)}")
            print("Fill these in config/services.local.toml, or quote them by hand.")
        return 0

    print(f"## Services and prices\n")
    print(f"_Generated {now:%d %B %Y} from {config.source_paths[-1].name}. "
          f"Prices in {config.meta.currency}._\n")
    print("| Service | What's included | Turnaround | Price |")
    print("|---|---|---|---|")
    for svc in config.services:
        print(f"| {svc.name} | {svc.includes} | {svc.turnaround_display} | {_price(svc, config)} |")
    if config.rush.enabled and config.rush.multiplier > 1:
        pct = (config.rush.multiplier - 1) * 100
        print(f"\n_Rush turnaround adds {pct.normalize()}% — {config.rush.note}_")
    print("\n_If a price above reads [PRICE NOT SET], ask the owner for the figure. Never estimate one._")
    return 0
