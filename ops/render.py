"""Template rendering that fails loudly rather than sending `${amount_due}` to a client.

That is the highest-consequence bug available in this codebase, so every path out of
here is checked twice: once by string.Template, once by scanning the result.
"""

from __future__ import annotations

import re
import string
from pathlib import Path

from . import OpsError, TEMPLATE_DIR

LEFTOVER = re.compile(r"\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*")


class UnfilledPlaceholderError(OpsError):
    pass


def render(template: str, mapping: dict) -> str:
    blank = sorted(k for k, v in mapping.items() if v is None or str(v).strip() == "")
    if blank:
        raise UnfilledPlaceholderError(
            "refusing to render — no value for: " + ", ".join(blank)
        )
    try:
        out = string.Template(template).substitute(mapping)
    except KeyError as exc:
        raise UnfilledPlaceholderError(
            f"refusing to render — template needs {exc.args[0]!r}, which was not supplied"
        ) from exc
    except ValueError as exc:
        raise UnfilledPlaceholderError(f"malformed template: {exc}") from exc

    leftover = LEFTOVER.search(out)
    if leftover:
        raise UnfilledPlaceholderError(
            f"refusing to render — unfilled placeholder {leftover.group(0)!r} survived substitution"
        )
    return out


def render_file(name: str, mapping: dict, template_dir: Path | None = None) -> str:
    path = (Path(template_dir) if template_dir else TEMPLATE_DIR) / name
    if not path.exists():
        raise OpsError(f"missing template {path}")
    return render(path.read_text(encoding="utf-8"), mapping)
