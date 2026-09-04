"""`ops report` — scaffold a Statistical Consultation Report.

This command produces an empty structure only. It must never generate results,
numbers, or interpretation: those come from the owner's actual analysis of the
client's actual data.
"""

from __future__ import annotations

from ..render import render_file
from ._common import emit, load_one, today

PLACEHOLDER_RQ = "_(paste the client's research questions or hypotheses here)_"


def register(subparsers, parent):
    p = subparsers.add_parser("report", parents=[parent], help="scaffold a consultation report")
    p.add_argument("id")
    p.set_defaults(func=run)


def run(args) -> int:
    _, _, row = load_one(args)
    now = today(args)
    text = render_file(
        "report-skeleton.md",
        {
            "client_name": row.name,
            "date": f"{now:%d %B %Y}",
            "research_questions": row.notes.strip() or PLACEHOLDER_RQ,
        },
    )
    emit(row.id, "report", text, now, args)
    print("scaffold only — fill in from your actual analysis; never report a number you didn't compute")
    return 0
