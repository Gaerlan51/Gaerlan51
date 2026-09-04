#!/usr/bin/env python3
"""Serve the site locally the way Vercel serves it.

    python3 scripts/serve.py          # http://localhost:8000
    python3 scripts/serve.py 3000     # another port

Opening web/index.html straight off disk mostly works, but it is not what a
visitor gets: file:// resolves paths differently and never exercises the clean
URLs. This mirrors vercel.json — `/` serves index.html, `/login` serves
login.html — so what you see here is what the deployed site does.

Ctrl-C to stop.
"""

from __future__ import annotations

import functools
import http.server
import os
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    """cleanUrls: an extensionless path falls back to its .html file."""

    def do_GET(self):  # noqa: N802 - stdlib naming
        path = self.path.split("?")[0].split("#")[0]
        if path == "/":
            self.path = "/index.html"
        elif "." not in os.path.basename(path):
            candidate = ROOT / (path.lstrip("/") + ".html")
            if candidate.is_file():
                self.path = path.rstrip("/") + ".html"
        return super().do_GET()

    def end_headers(self):
        # Editing CSS and getting a stale page back wastes more time than it saves.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    if not ROOT.is_dir():
        print(f"error: no site at {ROOT}", file=sys.stderr)
        return 1

    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(ROOT))) as httpd:
            print(f"Serving {ROOT} at http://localhost:{port}")
            print(f"  home     http://localhost:{port}/")
            print(f"  sign-in  http://localhost:{port}/login")
            print("Ctrl-C to stop.")
            httpd.serve_forever()
    except OSError as exc:
        print(f"error: cannot bind port {port} — {exc}", file=sys.stderr)
        print(f"Something else is using it. Try: python3 scripts/serve.py {port + 1}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
