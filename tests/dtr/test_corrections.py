"""Corrections: the only path that changes a day, and what it leaves behind."""

from __future__ import annotations

import unittest
from datetime import date
from zoneinfo import ZoneInfo

from dtr import PermissionDenied, corrections, store
from dtr.corrections import CorrectionError
from dtr.scan import ScanRequest, register_scan

from .support import Fixture, manila
from .test_scan import at_office

TZ = ZoneInfo("Asia/Manila")


class CorrectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.close)
        self.employee = self.fx.add_employee("1001", "Ana Reyes")
        self.boss = self.fx.add_employee("1000", "Bea Lim", role="admin")
        self.log_id = register_scan(
            self.fx.conn, self.fx.settings, self.employee,
            ScanRequest(self.fx.payload, "phone-a", at_office()),
            now=manila(2026, 9, 7, 9, 40),
        ).log_id

    def file_amendment(self, **overrides) -> int:
        kwargs = dict(
            employee_id=self.employee["id"],
            request_type=corrections.AMEND,
            business_date=date(2026, 9, 7),
            reason="The queue at the gate meant I scanned half an hour after I started.",
            dtr_log_id=self.log_id,
            requested_entry_type="time_in",
            requested_at="2026-09-07 08:05",
        )
        kwargs.update(overrides)
        return corrections.submit(self.fx.conn, **kwargs)

    # ------------------------------------------------------------ filing

    def test_a_reason_is_required(self):
        with self.assertRaises(CorrectionError):
            self.file_amendment(reason="typo")

    def test_you_cannot_file_against_someone_elses_entry(self):
        other = self.fx.add_employee("1002", "Cy Tan")
        with self.assertRaises(PermissionDenied):
            self.file_amendment(employee_id=other["id"])

    def test_a_second_pending_request_for_the_same_entry_is_refused(self):
        self.file_amendment()
        with self.assertRaises(CorrectionError):
            self.file_amendment()

    # --------------------------------------------------------- approving

    def test_approval_appends_and_never_rewrites(self):
        request_id = self.file_amendment()
        new_id = corrections.approve(self.fx.conn, request_id, reviewer_id=self.boss["id"], tz=TZ,
                                     note="Confirmed with the gate log.")
        original = self.fx.conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (self.log_id,)).fetchone()
        replacement = self.fx.conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (new_id,)).fetchone()

        # The original row is still there, unchanged, and points at its successor.
        self.assertEqual(store.parse_iso(original["recorded_at"]), manila(2026, 9, 7, 9, 40))
        self.assertEqual(original["superseded_by_id"], new_id)
        self.assertEqual(original["source"], "scan")
        # The replacement carries the approved time and says plainly where it came from.
        self.assertEqual(store.parse_iso(replacement["recorded_at"]), manila(2026, 9, 7, 8, 5))
        self.assertEqual(replacement["source"], "admin_correction")
        self.assertEqual(replacement["created_by_id"], self.boss["id"])

    def test_only_the_replacement_counts_afterwards(self):
        request_id = self.file_amendment()
        corrections.approve(self.fx.conn, request_id, reviewer_id=self.boss["id"], tz=TZ)
        live = store.logs_for_day(self.fx.conn, self.employee["id"], date(2026, 9, 7))
        self.assertEqual([row["source"] for row in live], ["admin_correction"])

    def test_approval_is_written_to_the_audit_trail_with_both_values(self):
        request_id = self.file_amendment()
        corrections.approve(self.fx.conn, request_id, reviewer_id=self.boss["id"], tz=TZ, note="Checked CCTV.")
        row = self.fx.conn.execute(
            "SELECT * FROM audit_log WHERE action = 'approve' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        # The trail keeps UTC; 09:40 Manila is 01:40Z.
        self.assertIn("2026-09-07T01:40", row["old_value"])
        self.assertIn("2026-09-07 08:05", row["new_value"])
        self.assertEqual(row["changed_by_id"], self.boss["id"])
        self.assertEqual(row["reason"], "Checked CCTV.")

    def test_nobody_approves_their_own_request(self):
        request_id = self.file_amendment()
        with self.assertRaises(PermissionDenied):
            corrections.approve(self.fx.conn, request_id, reviewer_id=self.employee["id"], tz=TZ)

    def test_a_request_cannot_be_approved_twice(self):
        request_id = self.file_amendment()
        corrections.approve(self.fx.conn, request_id, reviewer_id=self.boss["id"], tz=TZ)
        with self.assertRaises(CorrectionError):
            corrections.approve(self.fx.conn, request_id, reviewer_id=self.boss["id"], tz=TZ)

    def test_an_approver_may_set_a_different_time_from_the_one_asked_for(self):
        request_id = self.file_amendment()
        new_id = corrections.approve(self.fx.conn, request_id, reviewer_id=self.boss["id"], tz=TZ,
                                     override_time="2026-09-07 08:30", note="Gate log says 08:30.")
        row = self.fx.conn.execute("SELECT recorded_at FROM dtr_logs WHERE id = ?", (new_id,)).fetchone()
        self.assertEqual(store.parse_iso(row["recorded_at"]), manila(2026, 9, 7, 8, 30))

    # ------------------------------------------------------------- voids

    def test_a_void_keeps_the_row_and_stops_it_counting(self):
        request_id = corrections.submit(
            self.fx.conn, employee_id=self.employee["id"], request_type=corrections.VOID,
            business_date=date(2026, 9, 7), dtr_log_id=self.log_id,
            reason="This scan was a mistake; I was covering the desk, not starting a shift.",
        )
        corrections.approve(self.fx.conn, request_id, reviewer_id=self.boss["id"], tz=TZ, note="Agreed.")
        row = self.fx.conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (self.log_id,)).fetchone()
        self.assertIsNotNone(row)
        self.assertIsNotNone(row["voided_at"])
        self.assertEqual(store.logs_for_day(self.fx.conn, self.employee["id"], date(2026, 9, 7)), [])

    # --------------------------------------------------------- rejecting

    def test_rejection_needs_a_note_the_employee_will_read(self):
        request_id = self.file_amendment()
        with self.assertRaises(CorrectionError):
            corrections.reject(self.fx.conn, request_id, reviewer_id=self.boss["id"], note="  ")
        corrections.reject(self.fx.conn, request_id, reviewer_id=self.boss["id"],
                           note="The gate log shows 09:40. Speak to me if you disagree.")
        row = corrections.get(self.fx.conn, request_id)
        self.assertEqual(row["status"], "rejected")
        self.assertIn("gate log", row["review_note"])

    def test_rejection_changes_no_time_record(self):
        request_id = self.file_amendment()
        corrections.reject(self.fx.conn, request_id, reviewer_id=self.boss["id"], note="Not supported.")
        row = self.fx.conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (self.log_id,)).fetchone()
        self.assertEqual(store.parse_iso(row["recorded_at"]), manila(2026, 9, 7, 9, 40))
        self.assertIsNone(row["superseded_by_id"])


if __name__ == "__main__":
    unittest.main()
