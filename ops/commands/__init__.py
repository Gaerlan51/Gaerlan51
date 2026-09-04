"""Subcommands. Each module exposes `register(subparsers, parent)` and `run(args)`."""

from . import add, invoice, list as list_cmd, remind, report, services, setters, status

MODULES = [add, list_cmd, status, quote_placeholder] if False else None  # see __main__
