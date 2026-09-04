"""Quote arithmetic. Every path either returns a figure from config or refuses."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from .config import Config, PriceNotSetError, Service

FREE_TESTS = 3  # the analysis base price covers this many


def format_money(amount: Decimal | None, currency: str = "PHP") -> str:
    if amount is None:
        return "[PRICE NOT SET — ask owner]"
    quantized = Decimal(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{currency} {quantized:,.2f}"


def is_rush(deadline: date | None, today: date, service: Service) -> bool:
    """True when the client's deadline lands inside the service's normal turnaround."""
    if deadline is None:
        return False
    _, longest = service.turnaround_days
    return (deadline - today).days < longest


def quote_lines(
    service: Service,
    config: Config,
    tests: int = 0,
    rush: bool = False,
) -> list[tuple[str, Decimal]]:
    """Itemised quote. Raises rather than inventing a figure for an unpriced service."""
    if not service.price_is_set:
        raise PriceNotSetError(
            f"[PRICE NOT SET — ask owner] service {service.id!r} has no price. "
            f"Set it in config/services.local.toml, or quote this one by hand."
        )

    lines: list[tuple[str, Decimal]] = [(service.name, service.price)]

    extra = max(0, int(tests) - FREE_TESTS)
    if extra:
        if service.price_per_extra_test <= 0:
            raise PriceNotSetError(
                f"[PRICE NOT SET — ask owner] {extra} test(s) beyond the base scope, but "
                f"service {service.id!r} has no price_per_extra_test. Set it or quote by hand."
            )
        lines.append(
            (
                f"Additional analyses ({extra} beyond the {FREE_TESTS} included)",
                service.price_per_extra_test * extra,
            )
        )

    if rush and config.rush.enabled and config.rush.multiplier > 1:
        subtotal = sum((amount for _, amount in lines), Decimal(0))
        surcharge = subtotal * (config.rush.multiplier - 1)
        pct = (config.rush.multiplier - 1) * 100
        lines.append((f"Rush turnaround (+{pct.normalize()}%)", surcharge))

    return lines


def quote_total(lines: list[tuple[str, Decimal]]) -> Decimal:
    total = sum((amount for _, amount in lines), Decimal(0))
    return Decimal(total).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
