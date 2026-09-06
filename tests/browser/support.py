"""A real server and a real browser, for the length of one test class."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Rizal Park, Manila — the same coordinate the demo seed uses.
OFFICE_LAT = 14.582800
OFFICE_LNG = 120.979700

DEMO_PASSWORD = "password123"
TEST_ITERATIONS = 1_000  # throwaway accounts; no reason to burn 600k rounds


def playwright_or_none():
    """Return the Playwright entry point, or None with a reason to skip.

    Both halves are needed: Playwright to drive the browser, and the web layer
    for there to be a server to drive.
    """
    try:
        import fastapi  # noqa: F401
    except ImportError:
        return None, "the web layer is not installed (pip install -r dtr/requirements.txt)"
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None, "playwright is not installed (pip install playwright && playwright install chromium)"
    return sync_playwright, ""


def launch_chromium(playwright):
    """Launch the browser Playwright knows about, or the one this image ships.

    A managed environment may carry a Chromium build that does not match the
    revision this Playwright expects, so fall back to it by path rather than
    failing the whole tier.
    """
    try:
        return playwright.chromium.launch()
    except Exception:
        fallback = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")) / "chromium"
        if not fallback.exists():
            raise
        return playwright.chromium.launch(executable_path=str(fallback))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LiveServer:
    """`python -m dtr serve` on a scratch database, torn down afterwards."""

    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.port = free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.env = {
            **os.environ,
            "DTR_DATA_DIR": str(self.dir),
            "DTR_BASE_URL": self.base_url,
            "DTR_ORGANISATION": "Test Co",
        }
        self._build_database()
        self.process = subprocess.Popen(
            [sys.executable, "-m", "dtr", "serve", "--port", str(self.port), "--log-level", "warning"],
            cwd=str(REPO_ROOT), env=self.env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        self._wait_until_up()

    def _settings(self):
        # Import inside, so a missing FastAPI skips rather than breaks collection.
        for key, value in self.env.items():
            os.environ[key] = value
        from dtr.config import load_settings
        return load_settings()

    def _build_database(self) -> None:
        from dtr import db, security, store
        settings = self._settings()
        conn = db.connect(settings.db_path)
        db.init_db(conn)
        now = store.iso(store.now_utc())
        conn.execute(
            "INSERT INTO shifts (name, start_time, end_time, grace_minutes, break_minutes, "
            "break_after_minutes, workdays, created_at) "
            "VALUES ('Day', '08:00', '17:00', 15, 60, 300, '1111111', ?)", (now,))
        self.code = security.new_location_code()
        conn.execute(
            "INSERT INTO locations (name, latitude, longitude, radius_m, qr_code_id, qr_issued_at, "
            "require_photo, max_accuracy_m, status, created_at, updated_at) "
            "VALUES ('Office', ?, ?, 75, ?, ?, 0, 100, 'active', ?, ?)",
            (OFFICE_LAT, OFFICE_LNG, self.code, now, now, now))
        self.payload = security.build_payload(self.code, settings.secret_key)
        self.scan_url = f"{self.base_url}/app/#c={self.payload}"
        self._conn = conn
        self._settings_cache = settings

    def add_employee(self, number, name, *, role="employee", consent=True,
                     must_change_password=False, password=DEMO_PASSWORD) -> int:
        from dtr import security, store
        now = store.iso(store.now_utc())
        cursor = self._conn.execute(
            "INSERT INTO employees (employee_number, full_name, department, role, shift_id, "
            "password_hash, must_change_password, status, consent_location_at, created_at, updated_at) "
            "VALUES (?, ?, 'Ops', ?, 1, ?, ?, 'active', ?, ?, ?)",
            (number, name, role, security.hash_password(password, iterations=TEST_ITERATIONS),
             1 if must_change_password else 0, now if consent else None, now, now))
        return int(cursor.lastrowid)

    def _wait_until_up(self, timeout: float = 30.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"server exited early:\n{self.process.stdout.read()}")
            try:
                with urllib.request.urlopen(f"{self.base_url}/api/health", timeout=1):
                    return
            except (urllib.error.URLError, OSError):
                time.sleep(0.2)
        raise RuntimeError("server did not come up in time")

    def stop(self) -> None:
        self.process.terminate()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        if self.process.stdout is not None:
            self.process.stdout.close()
        self._conn.close()
        self._tmp.cleanup()
