from __future__ import annotations

from datetime import date, datetime, time
from pathlib import Path

from .. import OUT_DIR
from ..config import Config, load_config
from ..tracker import Row, find, read_rows


def load(args) -> tuple[Config, list[Row]]:
    return load_config(getattr(args, "config", None)), read_rows(getattr(args, "tracker", None))


def load_one(args) -> tuple[Config, list[Row], Row]:
    config, rows = load(args)
    return config, rows, find(rows, args.id)


def today(args) -> date:
    """`--today` exists so the owner (and the tests) can see tomorrow's dashboard."""
    override = getattr(args, "today", None)
    if override:
        return date.fromisoformat(override)
    return date.today()


def stamp(args) -> datetime:
    """Timestamp for history entries, pinned to --today when it is given."""
    override = getattr(args, "today", None)
    if override:
        return datetime.combine(date.fromisoformat(override), time(9, 0))
    return datetime.now()


def write_doc(row_id: str, kind: str, text: str, when: date, out_dir: Path | None = None) -> Path:
    out = Path(out_dir) if out_dir else OUT_DIR
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{row_id}-{kind}-{when:%Y-%m-%d}.md"
    path.write_text(text, encoding="utf-8")
    return path


def emit(row_id: str, kind: str, text: str, when: date, args) -> None:
    path = write_doc(row_id, kind, text, when, getattr(args, "out_dir", None))
    print(text)
    print(f"\n--- saved to {path} ---")


def business_name(config: Config) -> str:
    return config.meta.business_name or "[BUSINESS NAME NOT SET]"
