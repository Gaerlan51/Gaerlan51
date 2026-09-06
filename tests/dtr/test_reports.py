"""Reports: what the payroll clerk actually receives."""

from __future__ import annotations

import csv
import io
import unittest
from datetime import date

from dtr import reports, store
from dtr.scan import ScanRequest, register_scan

from .support import Fixture, manila
from .test_scan import at_office


class ReportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.close)
        self.employee = self.fx.add_employee("1001", "Ana Reyes")
        self.tz = self.fx.settings.tz

    def punch(self, when):
        return register_scan(
            self.fx.conn, self.fx.settings, self.fx.reload(self.employee),
            ScanRequest(self.fx.payload, "phone-a", at_office()), now=when,
        )

    def worked_day(self, day, start=(8, 0), finish=(17, 0)):
        self.punch(manila(2026, 9, day, *start))
        self.punch(manila(2026, 9, day, *finish))

    def build(self, first=7, last=11):
        return reports.build_records(
            self.fx.conn, start=date(2026, 9, first), end=date(2026, 9, last),
            tz=self.tz, employee_ids=[self.employee["id"]],
        )

    def test_every_day_in_the_range_gets_a_row(self):
        self.worked_day(7)
        records = self.build()
        self.assertEqual(len(records), 5)
        self.assertEqual([r.day.day for r in records], [7, 8, 9, 10, 11])

    def test_a_worked_day_carries_its_hours_and_a_blank_day_is_an_absence(self):
        self.worked_day(7, finish=(17, 30))
        records = {r.day.day: r for r in self.build()}
        self.assertEqual(records[7].worked_minutes, 510)
        self.assertEqual(records[7].overtime_minutes, 30)
        self.assertEqual(records[8].status, "absent")

    def test_flags_from_the_scan_reach_the_report(self):
        self.punch(manila(2026, 9, 7, 8, 0))
        register_scan(
            self.fx.conn, self.fx.settings, self.fx.reload(self.employee),
            ScanRequest(self.fx.payload, "a-borrowed-phone", at_office()),
            now=manila(2026, 9, 7, 17, 0),
        )
        record = {r.day.day: r for r in self.build()}[7]
        self.assertIn("unrecognised_device", record.flags)

    def test_totals_add_up_across_the_range(self):
        self.worked_day(7)
        self.worked_day(8, start=(8, 45))
        totals = reports.totals_by_employee(self.build())[self.employee["id"]]
        self.assertEqual(totals.days_present, 2)
        self.assertEqual(totals.days_absent, 3)
        self.assertEqual(totals.late_minutes, 30)  # 08:45 against 08:00 plus 15 grace
        self.assertEqual(totals.worked_hours, 15.25)

    def test_the_csv_has_a_header_and_one_row_per_employee_day(self):
        self.worked_day(7)
        body = reports.to_csv(self.build(), self.tz)
        rows = list(csv.DictReader(io.StringIO(body)))
        self.assertEqual(len(rows), 5)
        self.assertEqual(list(rows[0]), reports.CSV_COLUMNS)

    def test_the_csv_shows_local_times_not_utc(self):
        self.worked_day(7)
        rows = list(csv.DictReader(io.StringIO(reports.to_csv(self.build(), self.tz))))
        worked = next(row for row in rows if row["date"] == "2026-09-07")
        self.assertEqual(worked["time_in"], "08:00")
        self.assertEqual(worked["time_out"], "17:00")
        self.assertEqual(worked["worked_hours"], "8.00")

    def test_a_corrected_day_reports_the_corrected_time(self):
        from zoneinfo import ZoneInfo
        from dtr import corrections
        boss = self.fx.add_employee("1000", "Bea Lim", role="admin")
        result = self.punch(manila(2026, 9, 7, 9, 40))
        self.punch(manila(2026, 9, 7, 17, 0))
        request_id = corrections.submit(
            self.fx.conn, employee_id=self.employee["id"], request_type=corrections.AMEND,
            business_date=date(2026, 9, 7), dtr_log_id=result.log_id,
            requested_entry_type="time_in", requested_at="2026-09-07 08:00",
            reason="I started at eight; the poster was blocked by a delivery van.",
        )
        corrections.approve(self.fx.conn, request_id, reviewer_id=boss["id"],
                            tz=ZoneInfo("Asia/Manila"), note="Confirmed.")
        record = {r.day.day: r for r in self.build()}[7]
        self.assertEqual(record.time_in.astimezone(self.tz).strftime("%H:%M"), "08:00")
        self.assertEqual(record.worked_minutes, 480)


if __name__ == "__main__":
    unittest.main()
