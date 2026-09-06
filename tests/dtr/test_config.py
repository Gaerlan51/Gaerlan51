"""Settings, and the checks that stop a poster being printed that cannot work."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from dtr.config import ConfigError, Settings


def settings(**overrides) -> Settings:
    base = {"data_dir": Path(tempfile.gettempdir()) / "dtr-test", "secret_key": "k"}
    base.update(overrides)
    return Settings(**base)


class RetentionTests(unittest.TestCase):
    def test_a_retention_window_under_three_years_is_refused(self):
        with self.assertRaises(ConfigError):
            settings(retention_days=365)

    def test_three_years_is_accepted(self):
        self.assertEqual(settings(retention_days=1095).retention_days, 1095)

    def test_an_unknown_timezone_is_refused(self):
        with self.assertRaises(ConfigError):
            settings(timezone="Mars/Olympus_Mons")


class PosterReadinessTests(unittest.TestCase):
    """A poster is printed once and lives on a wall. Both of these failures are
    invisible until an employee is standing at the door with a phone."""

    def test_localhost_cannot_work_because_a_phone_is_its_own_localhost(self):
        problem = settings(base_url="http://localhost:8000").poster_problem
        self.assertIsNotNone(problem)
        self.assertIn("localhost", problem)

    def test_the_loopback_address_is_the_same_trap(self):
        for url in ("http://127.0.0.1:8000", "http://[::1]:8000", "http://0.0.0.0:8000"):
            with self.subTest(url=url):
                self.assertIsNotNone(settings(base_url=url).poster_problem)

    def test_a_lan_address_over_plain_http_still_cannot_scan(self):
        """Reachable from the phone, but browsers withhold location from it."""
        problem = settings(base_url="http://192.168.1.20:8000").poster_problem
        self.assertIsNotNone(problem)
        self.assertIn("https", problem)

    def test_a_named_host_over_plain_http_is_no_better(self):
        self.assertIsNotNone(settings(base_url="http://dtr.example.com").poster_problem)

    def test_https_on_a_real_host_is_ready(self):
        ready = settings(base_url="https://my-dtr.fly.dev")
        self.assertIsNone(ready.poster_problem)
        self.assertTrue(ready.poster_ready)

    def test_the_default_configuration_is_not_poster_ready(self):
        """The shipped default is for local development, and says so."""
        self.assertFalse(settings().poster_ready)


if __name__ == "__main__":
    unittest.main()
