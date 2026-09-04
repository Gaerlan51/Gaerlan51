import unittest
from datetime import date
from decimal import Decimal

from ops.config import Config, Meta, PriceNotSetError, Rush, Service
from ops.money import format_money, is_rush, quote_lines, quote_total

ANALYSIS = Service(
    id="analysis",
    name="Data analysis",
    turnaround_days=(5, 10),
    price=Decimal("4000"),
    price_per_extra_test=Decimal("500"),
)
UNPRICED = Service(id="full_package", name="Full package", turnaround_days=(10, 21))

CONFIG = Config(meta=Meta(currency="PHP"), rush=Rush(enabled=True, multiplier=Decimal("1.25")))


class MoneyTests(unittest.TestCase):
    def test_unset_price_refuses_rather_than_estimating(self):
        with self.assertRaises(PriceNotSetError) as ctx:
            quote_lines(UNPRICED, CONFIG)
        self.assertIn("PRICE NOT SET", str(ctx.exception))

    def test_format_of_missing_amount_is_loud(self):
        self.assertIn("PRICE NOT SET", format_money(None))

    def test_base_price_alone(self):
        self.assertEqual(quote_total(quote_lines(ANALYSIS, CONFIG)), Decimal("4000.00"))

    def test_three_tests_carry_no_surcharge(self):
        self.assertEqual(quote_total(quote_lines(ANALYSIS, CONFIG, tests=3)), Decimal("4000.00"))

    def test_fourth_test_adds_exactly_one_increment(self):
        lines = quote_lines(ANALYSIS, CONFIG, tests=4)
        self.assertEqual(quote_total(lines), Decimal("4500.00"))
        self.assertIn("1 beyond", lines[-1][0])

    def test_extra_tests_without_a_configured_rate_refuse(self):
        service = Service(id="a", name="A", price=Decimal("100"))
        with self.assertRaises(PriceNotSetError):
            quote_lines(service, CONFIG, tests=5)

    def test_rush_multiplier_applies_to_the_subtotal(self):
        self.assertEqual(
            quote_total(quote_lines(ANALYSIS, CONFIG, tests=4, rush=True)), Decimal("5625.00")
        )

    def test_rush_ignored_when_disabled_in_config(self):
        config = Config(rush=Rush(enabled=False, multiplier=Decimal("1.25")))
        self.assertEqual(quote_total(quote_lines(ANALYSIS, config, rush=True)), Decimal("4000.00"))

    def test_deadline_inside_turnaround_is_rush(self):
        today = date(2026, 9, 4)
        self.assertTrue(is_rush(date(2026, 9, 10), today, ANALYSIS))  # 6 days out, 10-day job

    def test_deadline_outside_turnaround_is_not_rush(self):
        today = date(2026, 9, 4)
        self.assertFalse(is_rush(date(2026, 10, 30), today, ANALYSIS))

    def test_no_deadline_is_not_rush(self):
        self.assertFalse(is_rush(None, date(2026, 9, 4), ANALYSIS))
