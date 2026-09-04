import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from ops.config import ConfigError, load_config

BASE = """
[meta]
currency = "PHP"
payment_terms_days = 7

[[service]]
id = "methodology"
name = "Methodology consult"
includes = "Design and test selection"
turnaround_days = [2, 4]
price = 0

[[service]]
id = "analysis"
name = "Data analysis"
includes = "Run and explain"
turnaround_days = [5, 10]
price = 0
price_per_extra_test = 0

[rush]
enabled = true
multiplier = 1.0
"""


def write(tmp: Path, name: str, text: str) -> Path:
    path = tmp / name
    path.write_text(text, encoding="utf-8")
    return path


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.base = write(self.tmp, "services.toml", BASE)

    def tearDown(self):
        self._tmp.cleanup()

    def test_loads_committed_file_alone(self):
        config = load_config(self.base)
        self.assertEqual([s.id for s in config.services], ["methodology", "analysis"])
        self.assertFalse(config.service("analysis").price_is_set)

    def test_local_overlay_replaces_one_key_and_leaves_the_rest(self):
        write(
            self.tmp,
            "services.local.toml",
            """
            [[service]]
            id = "analysis"
            price = 4500
            """,
        )
        config = load_config(self.base)
        analysis = config.service("analysis")
        self.assertEqual(analysis.price, Decimal("4500"))
        # untouched keys survive the overlay
        self.assertEqual(analysis.name, "Data analysis")
        self.assertEqual(analysis.turnaround_days, (5, 10))
        self.assertEqual(analysis.includes, "Run and explain")
        # other services survive too
        self.assertFalse(config.service("methodology").price_is_set)

    def test_local_overlay_can_add_a_service(self):
        write(
            self.tmp,
            "services.local.toml",
            """
            [[service]]
            id = "coaching"
            name = "Defense coaching"
            turnaround_days = [1, 1]
            price = 1500
            """,
        )
        config = load_config(self.base)
        self.assertEqual(config.service("coaching").price, Decimal("1500"))

    def test_duplicate_service_id_rejected(self):
        bad = write(self.tmp, "dup.toml", BASE + '\n[[service]]\nid = "analysis"\nprice = 1\n')
        with self.assertRaises(ConfigError):
            load_config(bad)

    def test_backwards_turnaround_rejected(self):
        bad = write(
            self.tmp, "bad.toml", '[[service]]\nid = "x"\nturnaround_days = [9, 2]\nprice = 1\n'
        )
        with self.assertRaises(ConfigError):
            load_config(bad)

    def test_rush_multiplier_below_one_rejected(self):
        bad = write(self.tmp, "cheap.toml", "[rush]\nmultiplier = 0.8\n")
        with self.assertRaises(ConfigError):
            load_config(bad)

    def test_unknown_service_names_the_known_ones(self):
        config = load_config(self.base)
        with self.assertRaises(ConfigError) as ctx:
            config.service("astrology")
        self.assertIn("methodology", str(ctx.exception))
