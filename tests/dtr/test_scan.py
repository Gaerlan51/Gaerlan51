"""The scan pipeline — every rule that stands between a phone and a time record."""

from __future__ import annotations

import unittest
from datetime import timedelta

from dtr import ScanRejected, store
from dtr.geo import Fix
from dtr.scan import (
    FLAG_MISSING_TIME_OUT, FLAG_UNRECOGNISED_DEVICE, ScanRequest, register_scan,
)

from .support import OFFICE_LAT, OFFICE_LNG, Fixture, manila


def at_office(accuracy: float = 10.0, age: float = 2.0) -> Fix:
    return Fix(OFFICE_LAT, OFFICE_LNG, accuracy, age)


class ScanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.close)
        self.employee = self.fx.add_employee("1001", "Ana Reyes")

    def scan(self, *, fix=None, device="phone-a", when=None, photo=None, employee=None, payload=None):
        request = ScanRequest(
            payload=payload if payload is not None else self.fx.payload,
            device_id=device,
            fix=fix or at_office(),
            photo=photo,
        )
        return register_scan(
            self.fx.conn, self.fx.settings,
            employee or self.fx.reload(self.employee), request,
            now=when,
        )

    # --------------------------------------------------------- happy path

    def test_first_scan_is_a_time_in_and_binds_the_phone(self):
        result = self.scan(when=manila(2026, 9, 7, 8, 2))
        self.assertEqual(result.entry_type, "time_in")
        self.assertEqual(result.business_date.isoformat(), "2026-09-07")
        self.assertFalse(result.flagged)
        self.assertEqual(self.fx.reload(self.employee)["registered_device_id"], "phone-a")

    def test_second_scan_is_a_time_out_on_the_same_business_date(self):
        self.scan(when=manila(2026, 9, 7, 8, 0))
        result = self.scan(when=manila(2026, 9, 7, 17, 5))
        self.assertEqual(result.entry_type, "time_out")
        self.assertEqual(result.business_date.isoformat(), "2026-09-07")

    # ------------------------------------------ the server owns the clock

    def test_the_client_cannot_supply_a_time(self):
        """ScanRequest has no timestamp field at all, and the row uses the server's."""
        self.assertNotIn("timestamp", ScanRequest.__dataclass_fields__)
        moment = manila(2026, 9, 7, 8, 30)
        result = self.scan(when=moment)
        row = self.fx.conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (result.log_id,)).fetchone()
        self.assertEqual(store.parse_iso(row["recorded_at"]), moment)

    # ------------------------------------------------------- the geofence

    def test_a_scan_from_far_away_is_refused(self):
        far = Fix(OFFICE_LAT + 0.02, OFFICE_LNG, 10.0, 2.0)
        with self.assertRaises(ScanRejected) as caught:
            self.scan(fix=far)
        self.assertEqual(caught.exception.code, "outside_geofence")
        self.assertEqual(self.count_logs(), 0)

    def test_a_vague_fix_is_refused_rather_than_flagged(self):
        with self.assertRaises(ScanRejected) as caught:
            self.scan(fix=at_office(accuracy=2000))
        self.assertEqual(caught.exception.code, "accuracy_too_low")

    def test_a_cached_fix_is_refused(self):
        with self.assertRaises(ScanRejected) as caught:
            self.scan(fix=at_office(age=600))
        self.assertEqual(caught.exception.code, "fix_stale")

    def test_no_location_at_all_is_refused(self):
        with self.assertRaises(ScanRejected) as caught:
            self.scan(fix=Fix(None, None, None))
        self.assertEqual(caught.exception.code, "location_required")

    def test_just_outside_the_fence_but_within_error_is_recorded_and_flagged(self):
        # ~85 m away with a 30 m accuracy circle: inside the error bars.
        nudged = Fix(OFFICE_LAT + 0.00077, OFFICE_LNG, 30.0, 2.0)
        result = self.scan(fix=nudged)
        self.assertIn("edge_of_geofence", result.flags)
        self.assertEqual(self.count_logs(), 1)

    # ---------------------------------------------------------- the poster

    def test_a_forged_qr_is_refused(self):
        with self.assertRaises(ScanRejected) as caught:
            self.scan(payload="ABCD-EFGH-JKLM.0000000000000000")
        self.assertEqual(caught.exception.code, "qr_invalid")

    def test_a_signed_code_for_no_known_location_is_refused(self):
        from dtr import security
        orphan = security.build_payload(security.new_location_code(), self.fx.settings.secret_key)
        with self.assertRaises(ScanRejected) as caught:
            self.scan(payload=orphan)
        self.assertEqual(caught.exception.code, "qr_unknown")

    def test_an_inactive_location_stops_accepting_scans(self):
        self.fx.conn.execute("UPDATE locations SET status = 'inactive'")
        with self.assertRaises(ScanRejected) as caught:
            self.scan()
        self.assertEqual(caught.exception.code, "location_inactive")

    # ----------------------------------------------------- device binding

    def test_a_different_phone_is_recorded_but_flagged(self):
        self.scan(when=manila(2026, 9, 7, 8, 0), device="phone-a")
        result = self.scan(when=manila(2026, 9, 7, 17, 0), device="phone-b")
        self.assertIn(FLAG_UNRECOGNISED_DEVICE, result.flags)
        self.assertEqual(self.count_logs(), 2)

    def test_a_flagged_scan_is_never_silently_dropped(self):
        """Blocking an employee over a new phone creates a payroll dispute."""
        self.scan(when=manila(2026, 9, 7, 8, 0), device="phone-a")
        result = self.scan(when=manila(2026, 9, 7, 17, 0), device="phone-b")
        row = self.fx.conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (result.log_id,)).fetchone()
        self.assertEqual(row["flagged"], 1)
        self.assertIn(FLAG_UNRECOGNISED_DEVICE, row["flag_reasons"])

    # ---------------------------------------------------------- one session

    def test_a_double_tap_is_refused(self):
        self.scan(when=manila(2026, 9, 7, 8, 0))
        with self.assertRaises(ScanRejected) as caught:
            self.scan(when=manila(2026, 9, 7, 8, 0) + timedelta(seconds=20))
        self.assertEqual(caught.exception.code, "duplicate_scan")

    def test_a_backwards_clock_step_is_refused_with_a_sane_message(self):
        """A bad NTP correction must not read as 'you scanned -21427200 seconds ago'."""
        self.scan(when=manila(2026, 9, 7, 8, 0))
        with self.assertRaises(ScanRejected) as caught:
            self.scan(when=manila(2026, 9, 7, 7, 0))
        self.assertEqual(caught.exception.code, "clock_out_of_order")
        self.assertEqual(caught.exception.detail["seconds_behind"], 3600)
        self.assertEqual(self.count_logs(), 1)

    def test_you_cannot_open_two_days_at_once(self):
        self.scan(when=manila(2026, 9, 7, 8, 0))
        second = self.scan(when=manila(2026, 9, 7, 12, 0))
        self.assertEqual(second.entry_type, "time_out")
        third = self.scan(when=manila(2026, 9, 7, 13, 0))
        self.assertEqual(third.entry_type, "time_in")

    def test_yesterdays_missing_time_out_opens_a_new_day_and_raises_a_flag(self):
        self.scan(when=manila(2026, 9, 7, 8, 0))
        result = self.scan(when=manila(2026, 9, 8, 8, 0))
        self.assertEqual(result.entry_type, "time_in")
        self.assertEqual(result.business_date.isoformat(), "2026-09-08")
        self.assertIn(FLAG_MISSING_TIME_OUT, result.flags)
        self.assertTrue(any("2026-09-07" in note for note in result.notes))

    # -------------------------------------------------------- consent gate

    def test_a_scan_before_consent_is_refused(self):
        newcomer = self.fx.add_employee("1002", "Ben Cruz", consent=False)
        with self.assertRaises(ScanRejected) as caught:
            self.scan(employee=newcomer)
        self.assertEqual(caught.exception.code, "consent_required")
        self.assertEqual(self.count_logs(), 0)

    # --------------------------------------------------------------- photo

    def test_a_photo_location_refuses_a_scan_without_one(self):
        self.fx.set_photo_required()
        self.fx.conn.execute("UPDATE employees SET consent_photo_at = ?", (self.fx.now,))
        with self.assertRaises(ScanRejected) as caught:
            self.scan()
        self.assertEqual(caught.exception.code, "photo_required")

    def test_a_photo_location_refuses_before_the_photo_notice_is_accepted(self):
        self.fx.set_photo_required()
        with self.assertRaises(ScanRejected) as caught:
            self.scan(photo=b"\xff\xd8\xff" + b"x" * 100)
        self.assertEqual(caught.exception.code, "photo_consent_required")

    def test_a_photo_is_stored_and_linked_when_the_location_asks_for_one(self):
        self.fx.set_photo_required()
        self.fx.conn.execute("UPDATE employees SET consent_photo_at = ?", (self.fx.now,))
        result = self.scan(photo=b"\xff\xd8\xff" + b"x" * 100)
        row = self.fx.conn.execute("SELECT photo_path FROM dtr_logs WHERE id = ?", (result.log_id,)).fetchone()
        self.assertTrue(row["photo_path"])
        self.assertTrue((self.fx.settings.photo_dir / row["photo_path"]).is_file())

    def test_something_that_is_not_an_image_is_refused(self):
        self.fx.set_photo_required()
        self.fx.conn.execute("UPDATE employees SET consent_photo_at = ?", (self.fx.now,))
        with self.assertRaises(ScanRejected) as caught:
            self.scan(photo=b"#!/bin/sh\nrm -rf /\n")
        self.assertEqual(caught.exception.code, "photo_invalid")

    def test_a_photo_sent_to_a_location_that_does_not_want_one_is_discarded(self):
        result = self.scan(photo=b"\xff\xd8\xff" + b"x" * 100)
        row = self.fx.conn.execute("SELECT photo_path FROM dtr_logs WHERE id = ?", (result.log_id,)).fetchone()
        self.assertIsNone(row["photo_path"])
        self.assertTrue(any("discarded" in note for note in result.notes))

    # -------------------------------------------------------------- audit

    def test_every_refusal_leaves_a_trace(self):
        with self.assertRaises(ScanRejected):
            self.scan(fix=Fix(OFFICE_LAT + 0.05, OFFICE_LNG, 10.0, 2.0))
        rows = self.fx.conn.execute(
            "SELECT * FROM audit_log WHERE action = 'scan_rejected'"
        ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertIn("outside_geofence", rows[0]["new_value"])

    def count_logs(self) -> int:
        return self.fx.conn.execute("SELECT COUNT(*) AS n FROM dtr_logs").fetchone()["n"]


if __name__ == "__main__":
    unittest.main()
