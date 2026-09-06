"""Browser tests.

These cover what the Python suite structurally cannot: the page itself. The
unit tests exercise the API the page calls, so a scan that never leaves the
browser — a listener that was never wired, a screen that never appears — passes
every one of them. That is not hypothetical; it is how the hashchange bug in
`dtr/web/app/app.js` reached a commit.

They are skipped unless Playwright and a browser are installed, so
`python -m unittest discover` stays green on a bare Python 3.11:

    .venv/bin/pip install playwright && .venv/bin/playwright install chromium
"""
