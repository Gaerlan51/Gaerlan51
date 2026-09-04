"""End-to-end command behaviour. Fictional clients only — see spec constraint 3."""

import io
import contextlib
import tempfile
import unittest
from pathlib import Path

from ops.__main__ import main
from ops.tracker import read_rows

BASE_CONFIG = """
[meta]
currency = "PHP"
business_name = "Test Consulting"
quote_valid_days = 14
payment_terms_days = 7

[[service]]
id = "analysis"
name = "Data analysis"
includes = "Run and explain the analysis"
turnaround_days = [5, 10]
price = 4000
price_per_extra_test = 500

[[service]]
id = "full_package"
name = "Full statistical package"
includes = "Everything"
turnaround_days = [10, 21]
price = 0

[rush]
enabled = true
multiplier = 1.25
"""


class CliCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.config = self.tmp / "services.toml"
        self.config.write_text(BASE_CONFIG, encoding="utf-8")
        self.tracker = self.tmp / "clients.csv"
        self.history = self.tmp / "history.csv"
        self.out = self.tmp / "out"

    def tearDown(self):
        self._tmp.cleanup()

    def run_ops(self, *argv, today="2026-09-04"):
        """Returns (exit_code, stdout+stderr)."""
        args = [
            argv[0],
            "--tracker", str(self.tracker),
            "--config", str(self.config),
            "--history", str(self.history),
            "--out-dir", str(self.out),
            "--today", today,
            *argv[1:],
        ]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = main(args)
        return code, buf.getvalue()

    def add_client(self, service="analysis", **extra):
        argv = ["add", "--name", "Test Student A", "--school", "Sample University",
                "--service-requested", service]
        for key, value in extra.items():
            argv += [f"--{key.replace('_', '-')}", value]
        code, out = self.run_ops(*argv)
        self.assertEqual(code, 0, out)
        return read_rows(self.tracker)[-1].id


class EmptyStateTests(CliCase):
    def test_status_without_a_tracker_guides_and_exits_zero(self):
        code, out = self.run_ops("status")
        self.assertEqual(code, 0)
        self.assertIn("no tracker yet", out)

    def test_list_without_a_tracker_guides_and_exits_zero(self):
        code, out = self.run_ops("list")
        self.assertEqual(code, 0)
        self.assertIn("no tracker yet", out)


class QuoteTests(CliCase):
    def test_unset_price_refuses_and_exits_non_zero(self):
        rid = self.add_client(service="full_package")
        code, out = self.run_ops("quote", rid)
        self.assertEqual(code, 1)
        self.assertIn("PRICE NOT SET", out)

    def test_dry_run_does_not_touch_the_tracker(self):
        rid = self.add_client(deadline="2026-12-01")
        code, out = self.run_ops("quote", rid)
        self.assertEqual(code, 0, out)
        self.assertIn("PHP 4,000.00", out)
        self.assertIn("not saved", out)
        self.assertEqual(read_rows(self.tracker)[0].quoted_price, "")

    def test_commit_writes_price_and_moves_status(self):
        rid = self.add_client(deadline="2026-12-01")
        code, out = self.run_ops("quote", rid, "--commit")
        self.assertEqual(code, 0, out)
        row = read_rows(self.tracker)[0]
        self.assertEqual(row.quoted_price, "4000.00")
        self.assertEqual(row.status, "quoted")
        self.assertEqual(row.next_followup, "2026-09-07")

    def test_near_deadline_is_priced_as_rush_automatically(self):
        rid = self.add_client(deadline="2026-09-09")
        code, out = self.run_ops("quote", rid)
        self.assertEqual(code, 0, out)
        self.assertIn("Rush", out)
        self.assertIn("PHP 5,000.00", out)

    def test_no_rush_flag_overrides_the_deadline(self):
        rid = self.add_client(deadline="2026-09-09")
        code, out = self.run_ops("quote", rid, "--no-rush")
        self.assertEqual(code, 0, out)
        self.assertNotIn("Rush", out)
        self.assertIn("PHP 4,000.00", out)

    def test_quote_document_is_written_to_the_out_dir(self):
        rid = self.add_client(deadline="2026-12-01")
        self.run_ops("quote", rid)
        self.assertTrue((self.out / f"{rid}-quote-2026-09-04.md").exists())


class InvoiceTests(CliCase):
    def test_invoice_needs_a_price_first(self):
        rid = self.add_client()
        code, out = self.run_ops("invoice", rid)
        self.assertEqual(code, 1)
        self.assertIn("PRICE NOT SET", out)

    def test_invoice_carries_the_due_date_and_marks_the_client_invoiced(self):
        rid = self.add_client(deadline="2026-12-01")
        self.run_ops("quote", rid, "--commit")
        code, out = self.run_ops("invoice", rid, "--commit")
        self.assertEqual(code, 0, out)
        self.assertIn("11 September 2026", out)
        self.assertEqual(read_rows(self.tracker)[0].payment_status, "invoiced")

    def test_invoice_leaves_an_unmissable_slot_for_payment_instructions(self):
        # How to pay is written by hand per invoice, never stored or generated.
        rid = self.add_client(deadline="2026-12-01")
        self.run_ops("quote", rid, "--commit")
        code, out = self.run_ops("invoice", rid)
        self.assertEqual(code, 0, out)
        self.assertIn("ADD YOUR PAYMENT INSTRUCTIONS HERE", out)
        self.assertNotIn("GCash", out)


class ReminderTests(CliCase):
    def _invoiced(self):
        rid = self.add_client(deadline="2026-12-01")
        self.run_ops("quote", rid, "--commit")
        self.run_ops("invoice", rid, "--commit")
        return rid

    def test_payment_reminder_without_a_tone_prints_both(self):
        rid = self._invoiced()
        code, out = self.run_ops("remind", rid, "--kind", "payment", today="2026-09-12")
        self.assertEqual(code, 0, out)
        self.assertIn("### Gentle", out)
        self.assertIn("### Firm", out)
        self.assertIn("don't send both", out)

    def test_payment_reminder_with_a_tone_prints_one(self):
        rid = self._invoiced()
        code, out = self.run_ops("remind", rid, "--kind", "payment", "--tone", "gentle")
        self.assertEqual(code, 0, out)
        self.assertIn("### Gentle", out)
        self.assertNotIn("### Firm", out)

    def test_payment_reminder_needs_an_invoice_date(self):
        rid = self.add_client()
        code, out = self.run_ops("remind", rid, "--kind", "payment")
        self.assertEqual(code, 1)
        self.assertIn("no invoice date", out)

    def test_consult_reminder_needs_the_date(self):
        rid = self.add_client()
        code, out = self.run_ops("remind", rid, "--kind", "consult")
        self.assertEqual(code, 1)
        self.assertIn("--on", out)

    def test_invoice_date_in_the_reminder_follows_the_today_override(self):
        rid = self.add_client(deadline="2026-12-01")
        self.run_ops("quote", rid, "--commit")
        self.run_ops("invoice", rid, "--commit", today="2026-09-05")
        code, out = self.run_ops("remind", rid, "--kind", "payment", "--tone", "firm",
                                 today="2026-09-15")
        self.assertEqual(code, 0, out)
        self.assertIn("05 September", out)
        self.assertIn("10 days", out)

    def test_delivery_reminder_offers_a_walkthrough(self):
        rid = self.add_client()
        code, out = self.run_ops("remind", rid, "--kind", "delivery")
        self.assertEqual(code, 0, out)
        self.assertIn("walkthrough", out)


class StatusMoveTests(CliCase):
    def test_illegal_jump_is_rejected_and_names_the_legal_moves(self):
        rid = self.add_client()
        self.run_ops("set-status", rid, "delivered")
        code, out = self.run_ops("set-status", rid, "scoping")
        self.assertEqual(code, 1)
        self.assertIn("not a legal move", out)
        self.assertIn("Legal next values", out)
        self.assertEqual(read_rows(self.tracker)[0].status, "delivered")

    def test_force_allows_the_jump(self):
        rid = self.add_client()
        self.run_ops("set-status", rid, "delivered")
        code, out = self.run_ops("set-status", rid, "scoping", "--force")
        self.assertEqual(code, 0, out)
        self.assertEqual(read_rows(self.tracker)[0].status, "scoping")

    def test_unknown_status_rejected(self):
        rid = self.add_client()
        code, out = self.run_ops("set-status", rid, "ghosted")
        self.assertEqual(code, 1)
        self.assertIn("unknown status", out)

    def test_set_validates_payment_status(self):
        rid = self.add_client()
        code, out = self.run_ops("set", rid, "payment_status", "vibes")
        self.assertEqual(code, 1)
        self.assertIn("payment_status must be", out)


class ReportTests(CliCase):
    def test_scaffold_carries_the_integrity_footer_and_no_numbers(self):
        rid = self.add_client()
        code, out = self.run_ops("report", rid)
        self.assertEqual(code, 0, out)
        self.assertIn("academic integrity policies remain the student's", out)
        self.assertIn("Assumptions Checked", out)
        self.assertIn("never report a number you didn't compute", out)


class StatusDashboardTests(CliCase):
    def test_overdue_client_is_surfaced_with_a_count(self):
        rid = self.add_client()
        self.run_ops("set", rid, "next_followup", "2026-08-20")
        code, out = self.run_ops("status")
        self.assertEqual(code, 0, out)
        self.assertIn("Overdue follow-ups", out)
        self.assertIn(rid, out)
        self.assertIn("1 need attention, 1 tracked.", out)

    def test_quiet_day_says_so_and_still_exits_zero(self):
        self.add_client()
        code, out = self.run_ops("status", today="2026-09-05")
        self.assertEqual(code, 0)
        self.assertIn("nothing needs attention", out)


class IntakeTests(CliCase):
    def test_labelled_intake_is_parsed(self):
        intake = self.tmp / "inquiry.txt"
        intake.write_text(
            "Name: Test Student B\n"
            "School: Sample University\n"
            "Thesis title: Effect of X on Y\n"
            "Deadline: 2026-11-30\n"
            "Service: analysis\n",
            encoding="utf-8",
        )
        code, out = self.run_ops("add", "--from-intake", str(intake))
        self.assertEqual(code, 0, out)
        row = read_rows(self.tracker)[0]
        self.assertEqual(row.name, "Test Student B")
        self.assertEqual(row.thesis_topic, "Effect of X on Y")
        self.assertEqual(row.deadline, "2026-11-30")
        self.assertEqual(row.id, "b-2609")

    def test_unparseable_deadline_is_kept_as_a_note_not_guessed(self):
        intake = self.tmp / "inquiry.txt"
        intake.write_text(
            "Name: Test Student C\nService: analysis\nDeadline: before the defense\n",
            encoding="utf-8",
        )
        code, out = self.run_ops("add", "--from-intake", str(intake))
        self.assertEqual(code, 0, out)
        row = read_rows(self.tracker)[0]
        self.assertEqual(row.deadline, "")
        self.assertIn("before the defense", row.notes)


class ServicesTests(CliCase):
    def test_markdown_table_flags_unpriced_services_loudly(self):
        code, out = self.run_ops("services", "--markdown")
        self.assertEqual(code, 0, out)
        self.assertIn("| Data analysis |", out)
        self.assertIn("[PRICE NOT SET]", out)
        self.assertIn("Never estimate one", out)
