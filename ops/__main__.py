"""`python -m ops` — argparse entry point.

Errors the owner can fix (a missing price, a bad date, an illegal status move)
print as one line, not a traceback.
"""

from __future__ import annotations

import argparse
import sys

from . import DEFAULT_CONFIG, DEFAULT_HISTORY, DEFAULT_TRACKER, OpsError
from .commands import add, invoice, list as list_cmd, quote, remind, report, services, setters, status

MODULES = [add, list_cmd, status, quote, invoice, remind, report, services, setters]


def build_parser() -> argparse.ArgumentParser:
    parent = argparse.ArgumentParser(add_help=False)
    parent.add_argument("--tracker", default=str(DEFAULT_TRACKER), help="client CSV")
    parent.add_argument("--config", default=str(DEFAULT_CONFIG), help="services TOML")
    parent.add_argument("--history", default=str(DEFAULT_HISTORY), help="change log CSV")
    parent.add_argument("--out-dir", dest="out_dir", default=None, help="where documents are written")
    parent.add_argument("--today", default=None, help="pretend today is YYYY-MM-DD")

    parser = argparse.ArgumentParser(
        prog="ops",
        description="Local ops toolkit for a statistics consulting practice. "
        "Prepares documents for you to send; never sends anything itself.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for module in MODULES:
        module.register(subparsers, parent)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except OpsError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
