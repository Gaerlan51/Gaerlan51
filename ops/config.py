"""Service menu, prices, and payment details.

`config/services.toml` is committed with placeholder prices. `config/services.local.toml`
overlays it key by key and is gitignored, because this is a public repo.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import DEFAULT_CONFIG, OpsError

PLACEHOLDER = "[FILL IN]"


class ConfigError(OpsError):
    pass


class PriceNotSetError(OpsError):
    """Raised instead of guessing. See spec constraint 4."""


class PaymentDetailsNotSetError(OpsError):
    """Raised instead of guessing. See spec constraint 5."""


def _unset(value) -> bool:
    return value is None or (isinstance(value, str) and (not value.strip() or PLACEHOLDER in value))


def _money(value, where: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError) as exc:
        raise ConfigError(f"{where}: {value!r} is not a number") from exc


@dataclass(frozen=True)
class Service:
    id: str
    name: str
    includes: str = ""
    turnaround_days: tuple[int, int] = (0, 0)
    price: Decimal = Decimal(0)
    price_note: str = ""
    price_per_extra_test: Decimal = Decimal(0)

    @property
    def price_is_set(self) -> bool:
        return self.price > 0

    @property
    def turnaround_display(self) -> str:
        lo, hi = self.turnaround_days
        return f"{lo}–{hi} days" if lo != hi else f"{lo} days"


@dataclass(frozen=True)
class Payment:
    method: str = "GCash"
    account_name: str = ""
    account_number: str = ""
    qr_image: str = ""
    instructions: str = ""

    @property
    def is_set(self) -> bool:
        return not _unset(self.account_number) and not _unset(self.account_name)

    def rendered_instructions(self) -> str:
        """The line that goes on an invoice. Refuses rather than guessing an account."""
        if not self.is_set:
            raise PaymentDetailsNotSetError(
                "[GCASH DETAILS NOT SET] — fill in [payment] account_name and account_number "
                "in config/services.local.toml before sending an invoice."
            )
        return self.instructions.format(
            account_number=self.account_number,
            account_name=self.account_name,
            method=self.method,
        )


@dataclass(frozen=True)
class Meta:
    currency: str = "PHP"
    business_name: str = ""
    quote_valid_days: int = 14
    payment_terms_days: int = 7


@dataclass(frozen=True)
class Rush:
    enabled: bool = True
    multiplier: Decimal = Decimal(1)
    note: str = ""


@dataclass(frozen=True)
class Followups:
    """Timing rules for `ops status`. Overridable via [followups] in the config."""

    quote_followup_days: int = 3
    payment_gentle_days: int = 3
    payment_firm_days: int = 7
    checkin_silence_days: int = 10
    delivery_followup_days: int = 2
    deadline_risk_days: int = 3


@dataclass(frozen=True)
class Config:
    meta: Meta = field(default_factory=Meta)
    payment: Payment = field(default_factory=Payment)
    rush: Rush = field(default_factory=Rush)
    followups: Followups = field(default_factory=Followups)
    services: tuple[Service, ...] = ()
    source_paths: tuple[Path, ...] = ()

    def service(self, service_id: str) -> Service:
        for svc in self.services:
            if svc.id == service_id:
                return svc
        known = ", ".join(s.id for s in self.services)
        raise ConfigError(f"unknown service {service_id!r}. Known services: {known}")


def _read_toml(path: Path) -> dict:
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{path}: invalid TOML — {exc}") from exc


def _overlay(base: dict, over: dict) -> dict:
    """Key-by-key overlay. `service` entries merge on `id`; others merge by key."""
    merged = dict(base)
    for key, value in over.items():
        if key == "service":
            merged["service"] = _overlay_services(base.get("service", []), value)
        elif isinstance(value, dict) and isinstance(base.get(key), dict):
            merged[key] = {**base[key], **value}
        else:
            merged[key] = value
    return merged


def _overlay_services(base: list, over: list) -> list:
    by_id = {entry.get("id"): dict(entry) for entry in base}
    order = [entry.get("id") for entry in base]
    for entry in over:
        sid = entry.get("id")
        if sid is None:
            raise ConfigError("a [[service]] entry in the local config has no id")
        if sid in by_id:
            by_id[sid].update(entry)
        else:
            by_id[sid] = dict(entry)
            order.append(sid)
    return [by_id[sid] for sid in order]


def _build_services(raw: list) -> tuple[Service, ...]:
    services: list[Service] = []
    seen: set[str] = set()
    for entry in raw:
        sid = entry.get("id")
        if not sid:
            raise ConfigError("a [[service]] entry has no id")
        if sid in seen:
            raise ConfigError(f"duplicate service id {sid!r}")
        seen.add(sid)

        turnaround = entry.get("turnaround_days", [0, 0])
        if not isinstance(turnaround, list) or len(turnaround) != 2:
            raise ConfigError(f"service {sid!r}: turnaround_days must be [min, max]")
        lo, hi = int(turnaround[0]), int(turnaround[1])
        if lo > hi:
            raise ConfigError(f"service {sid!r}: turnaround_days min ({lo}) is above max ({hi})")

        services.append(
            Service(
                id=sid,
                name=entry.get("name", sid),
                includes=entry.get("includes", ""),
                turnaround_days=(lo, hi),
                price=_money(entry.get("price", 0), f"service {sid!r} price"),
                price_note=entry.get("price_note", ""),
                price_per_extra_test=_money(
                    entry.get("price_per_extra_test", 0), f"service {sid!r} price_per_extra_test"
                ),
            )
        )
    return tuple(services)


def load_config(path: Path | None = None, local_path: Path | None = None) -> Config:
    path = Path(path) if path else DEFAULT_CONFIG
    if not path.exists():
        raise ConfigError(f"no config at {path}. Expected the committed services.toml.")

    local_path = Path(local_path) if local_path else path.with_name("services.local.toml")
    raw = _read_toml(path)
    sources = [path]
    if local_path.exists():
        raw = _overlay(raw, _read_toml(local_path))
        sources.append(local_path)

    meta_raw = raw.get("meta", {})
    business_name = meta_raw.get("business_name", "")
    meta = Meta(
        currency=meta_raw.get("currency", "PHP"),
        business_name="" if _unset(business_name) else business_name,
        quote_valid_days=int(meta_raw.get("quote_valid_days", 14)),
        payment_terms_days=int(meta_raw.get("payment_terms_days", 7)),
    )

    pay_raw = raw.get("payment", {})
    payment = Payment(
        method=pay_raw.get("method", "GCash"),
        account_name=pay_raw.get("account_name", ""),
        account_number=pay_raw.get("account_number", ""),
        qr_image=pay_raw.get("qr_image", ""),
        instructions=pay_raw.get("instructions", ""),
    )

    rush_raw = raw.get("rush", {})
    multiplier = _money(rush_raw.get("multiplier", 1), "rush.multiplier")
    if multiplier < 1:
        raise ConfigError(f"rush.multiplier is {multiplier}; a rush cannot cost less than standard")
    rush = Rush(
        enabled=bool(rush_raw.get("enabled", True)),
        multiplier=multiplier,
        note=rush_raw.get("note", ""),
    )

    fu_raw = raw.get("followups", {})
    followups = Followups(
        **{k: int(v) for k, v in fu_raw.items() if k in Followups.__dataclass_fields__}
    )

    return Config(
        meta=meta,
        payment=payment,
        rush=rush,
        followups=followups,
        services=_build_services(raw.get("service", [])),
        source_paths=tuple(sources),
    )
