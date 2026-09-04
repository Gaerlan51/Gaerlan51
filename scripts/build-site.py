#!/usr/bin/env python3
"""Inline the site's CSS and JS into standalone single-file pages.

`web/` is the source: two HTML pages sharing one stylesheet and one script.
This produces self-contained copies you can drop on any host, and (with
--artifact) the head-less shape the Artifact publisher expects.

    python3 scripts/build-site.py                 # -> web/dist/*.html
    python3 scripts/build-site.py --artifact DIR  # -> DIR/*.html, no <head>
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
PAGES = ["index.html", "login.html"]

LINK = re.compile(r'[ \t]*<link rel="stylesheet" href="assets/site\.css">\n')
SCRIPT = re.compile(r'[ \t]*<script src="assets/site\.js"></script>\n')


def inline(page: str) -> str:
    html = (WEB / page).read_text(encoding="utf-8")
    css = (WEB / "assets" / "site.css").read_text(encoding="utf-8")
    html = LINK.sub(f"<style>\n{css}\n</style>\n", html, count=1)
    if SCRIPT.search(html):
        js = (WEB / "assets" / "site.js").read_text(encoding="utf-8")
        html = SCRIPT.sub(f"<script>\n{js}\n</script>\n", html, count=1)
    return html


def strip_document_shell(html: str) -> str:
    """The Artifact publisher supplies <!doctype>, <head> and <body> itself."""
    head = re.search(r"<head>(.*?)</head>", html, re.S)
    body = re.search(r"<body>(.*?)</body>", html, re.S)
    if not head or not body:
        raise SystemExit("expected a <head> and <body> to strip")
    keep = [
        line for line in head.group(1).splitlines()
        # charset and viewport are already in the wrapper's head; the rest travels.
        if line.strip() and not re.search(r'<meta (charset|name="viewport")', line)
    ]
    return "\n".join(keep) + "\n" + body.group(1).strip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", metavar="DIR", help="emit head-less pages for publishing")
    args = parser.parse_args()

    out = Path(args.artifact) if args.artifact else WEB / "dist"
    out.mkdir(parents=True, exist_ok=True)

    for page in PAGES:
        html = inline(page)
        if args.artifact:
            html = strip_document_shell(html)
            # Relative page links only work as separate files, not separate artifacts.
            html = html.replace('href="./login.html"', 'href="#signin"')
            html = html.replace('href="./index.html"', 'href="#top"')
        target = out / page
        target.write_text(html, encoding="utf-8")
        print(f"{target.relative_to(ROOT) if out.is_relative_to(ROOT) else target}  {len(html):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
