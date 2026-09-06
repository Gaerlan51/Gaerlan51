"""The append-only guarantees, tested the way an attacker would probe them:
with direct SQL, not through the application.
"""

from __future__ import annotations

import sqlite3
import unittest
from datetime import timedelta

from dtr import db, store
from dtr.db import IMMUTABLE_LOG_COLUMNS
from dtr.scan import ScanRequest, register_scan

from .support import OFFICE_LAT, OFFICE_LNG, Fixture, manila
from .test_scan import at_office


class ImmutabilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.close)
        self.employee = self.fx.add_employee()
        self.log_id = register_scan(
            self.fx.conn, self.fx.settings, self.employee,
            ScanRequest(self.fx.payload, "phone-a", at_office()),
            now=manila(2026, 9, 7, 8, 0),
        ).log_id

    def test_a_time_record_cannot_be_deleted(self):
        with self.assertRaises(sqlite3.IntegrityError) as caught:
            self.fx.conn.execute("DELETE FROM dtr_logs WHERE id = ?", (self.log_id,))
        self.assertIn("append-only", str(caught.exception))

    def test_no_factual_column_of_a_time_record_can_be_changed(self):
        row = self.fx.conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (self.log_id,)).fetchone()
        substitutes = {
            "employee_id": 999, "entry_type": "time_out", "recorded_at": "2020-01-01T00:00:00+00:00",
            "business_date": "2020-01-01", "location_id": 999, "device_id": "someone-else",
            "latitude": 0.0, "longitude": 0.0, "accuracy_m": 1.0, "distance_m": 1.0,
            "photo_path": "elsewhere.jpg", "source": "admin_correction", "created_by_id": 999,
            "created_at": "2020-01-01T00:00:00+00:00",
        }
        self.assertEqual(set(substitutes), set(IMMUTABLE_LOG_COLUMNS))
        for column, value in substitutes.items():
            with self.subTest(column=column):
                self.assertNotEqual(row[column], value, "the test value must differ from the real one")
                with self.assertRaises(sqlite3.IntegrityError):
                    self.fx.conn.execute(
                        f"UPDATE dtr_logs SET {column} = ? WHERE id = ?", (value, self.log_id)
                    )

    def test_the_correction_pointers_are_the_only_mutable_columns(self):
        self.fx.conn.execute("UPDATE dtr_logs SET superseded_by_id = NULL WHERE id = ?", (self.log_id,))
        self.fx.conn.execute("UPDATE dtr_logs SET voided_at = NULL WHERE id = ?", (self.log_id,))
        self.fx.conn.execute("UPDATE dtr_logs SET flagged = 1 WHERE id = ?", (self.log_id,))

    def test_the_audit_log_cannot_be_edited_or_deleted(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.fx.conn.execute("DELETE FROM audit_log")
        with self.assertRaises(sqlite3.IntegrityError):
            self.fx.conn.execute("UPDATE audit_log SET reason = 'nothing happened'")

    # ------------------------------------------------------------- purging

    def test_retention_purging_is_the_one_way_out_and_it_has_a_floor(self):
        with self.assertRaises(db.StorageError):
            db.purge_expired(self.fx.conn, retention_days=30)

    def test_purging_removes_only_records_past_the_window(self):
        old = manila(2020, 1, 2, 8, 0)
        store.insert_log(
            self.fx.conn, employee_id=self.employee["id"], entry_type="time_in",
            recorded_at=old, business_date=old.date(), location_id=self.fx.location_id,
        )
        self.assertEqual(self.count(), 2)
        result = db.purge_expired(self.fx.conn, retention_days=1095, now=manila(2026, 9, 7, 12, 0))
        self.assertEqual(result["dtr_logs"], 1)
        self.assertEqual(self.count(), 1)

    def test_the_delete_gate_is_shut_again_afterwards(self):
        db.purge_expired(self.fx.conn, retention_days=1095, now=manila(2026, 9, 7, 12, 0))
        self.assertEqual(
            self.fx.conn.execute("SELECT enabled FROM guards WHERE name = 'purge'").fetchone()["enabled"], 0
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.fx.conn.execute("DELETE FROM dtr_logs WHERE id = ?", (self.log_id,))

    def photo_scan(self, when):
        """A scan that actually carries a photo, on its own fresh employee."""
        from dtr.scan import ScanRequest, register_scan
        self.fx.set_photo_required()
        subject = self.fx.add_employee(f"20{when.day:02d}", "Photo Subject")
        self.fx.conn.execute("UPDATE employees SET consent_photo_at = ? WHERE id = ?",
                             (self.fx.now, subject["id"]))
        return register_scan(
            self.fx.conn, self.fx.settings, self.fx.reload(subject),
            ScanRequest(self.fx.payload, "phone-b", at_office(), photo=b"\xff\xd8\xff" + b"x" * 64),
            now=when,
        )

    def test_photos_age_out_before_the_records_they_belong_to(self):
        scan = self.photo_scan(manila(2026, 1, 2, 8, 0))
        row = self.fx.conn.execute("SELECT photo_path FROM dtr_logs WHERE id = ?",
                                   (scan.log_id,)).fetchone()
        image = self.fx.settings.photo_dir / row["photo_path"]
        self.assertTrue(image.is_file())

        result = db.purge_photos(self.fx.conn, photo_dir=self.fx.settings.photo_dir,
                                 retention_days=90, now=manila(2026, 9, 7, 0, 0))
        self.assertEqual(result["photos"], 1)
        self.assertFalse(image.exists())

        # The time record itself survives, with the link cleared.
        after = self.fx.conn.execute("SELECT * FROM dtr_logs WHERE id = ?", (scan.log_id,)).fetchone()
        self.assertIsNotNone(after)
        self.assertIsNone(after["photo_path"])

    def test_a_recent_photo_is_left_alone(self):
        scan = self.photo_scan(manila(2026, 9, 1, 8, 0))
        db.purge_photos(self.fx.conn, photo_dir=self.fx.settings.photo_dir,
                        retention_days=90, now=manila(2026, 9, 7, 0, 0))
        row = self.fx.conn.execute("SELECT photo_path FROM dtr_logs WHERE id = ?",
                                   (scan.log_id,)).fetchone()
        self.assertIsNotNone(row["photo_path"])

    def test_a_photo_link_cannot_be_swapped_for_another(self):
        """The retention carve-out allows clearing to NULL, never repointing."""
        scan = self.photo_scan(manila(2026, 1, 2, 8, 0))
        self.fx.conn.execute("UPDATE guards SET enabled = 1 WHERE name = 'purge'")
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                self.fx.conn.execute(
                    "UPDATE dtr_logs SET photo_path = 'someone-elses-face.jpg' WHERE id = ?",
                    (scan.log_id,),
                )
        finally:
            self.fx.conn.execute("UPDATE guards SET enabled = 0 WHERE name = 'purge'")

    def test_a_photo_link_cannot_be_cleared_outside_a_purge(self):
        scan = self.photo_scan(manila(2026, 1, 2, 8, 0))
        with self.assertRaises(sqlite3.IntegrityError):
            self.fx.conn.execute("UPDATE dtr_logs SET photo_path = NULL WHERE id = ?", (scan.log_id,))

    def count(self) -> int:
        return self.fx.conn.execute("SELECT COUNT(*) AS n FROM dtr_logs").fetchone()["n"]


if __name__ == "__main__":
    unittest.main()
