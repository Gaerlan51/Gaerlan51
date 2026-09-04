"""Local ops toolkit for a solo statistics consulting practice.

Offline, stdlib-only. Tracks clients, prices work from a single config, and
renders documents the owner reads, edits, and sends by hand. It never sends
anything and never invents a number.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_TRACKER = REPO_ROOT / "data" / "clients.csv"
DEFAULT_HISTORY = REPO_ROOT / "data" / "history.csv"
DEFAULT_CONFIG = REPO_ROOT / "config" / "services.toml"
TEMPLATE_DIR = REPO_ROOT / "templates"
OUT_DIR = REPO_ROOT / "out"


class OpsError(Exception):
    """Anything the owner did or configured wrong. Printed, not traced."""
