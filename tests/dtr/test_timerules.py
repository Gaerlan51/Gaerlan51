"""Hours arithmetic. Every number here is one an employee could dispute."""

from __future__ import annotations

import unittest
from datetime import date, time
from zoneinfo import ZoneInfo

from dtr.timerules import (
    ABSENT, INCOMPLETE, LATE, PRESENT, REST_DAY, UNSCHEDULED,
    Shift, business_date, summarise_day,
)

from .support import manila

TZ = ZoneInfo("Asia/Manila")
DAY = Shift(1, "Day", time(8, 0), time(17, 0), grace_minutes=15, break_minutes=60,
            break_after_minutes=300, workdays="1111100")
NIGHT = Shift(2, "Night", time(22, 0), time(6, 0), grace_minutes=10, break_minutes=60,
              break_after_minutes=300, workdays="1111100")


def summarise(day, time_in, time_out, shift=DAY):
    return summarise_day(
        employee_id=1, employee_number="1001", employee_name="Ana Reyes", department="Ops",
        day=day, shift=shift, tz=TZ, time_in=time_in, time_out=time_out,
    )


class ShiftTests(unittest.TestCase):
    def test_a_day_shift_owes_eight_paid_hours_after_the_meal_break(self):
        self.assertEqual(DAY.span_minutes, 540)
        self.assertEqual(DAY.required_minutes, 480)
        self.assertFalse(DAY.wraps_midnight)

    def test_a_night_shift_spans_midnight_without_going_negative(self):
        self.assertTrue(NIGHT.wraps_midnight)
        self.assertEqual(NIGHT.span_minutes, 480)
        self.assertEqual(NIGHT.required_minutes, 420)

    def test_a_short_shift_keeps_its_break(self):
        short = Shift(3, "Half day", time(8, 0), time(12, 0), break_minutes=60, break_after_minutes=300)
        self.assertEqual(short.span_minutes, 240)
        self.assertEqual(short.required_minutes, 240)


class BusinessDateTests(unittest.TestCase):
    def test_a_day_shift_uses_the_local_date(self):
        self.assertEqual(business_date(manila(2026, 9, 7, 8, 2), TZ, DAY), date(2026, 9, 7))

    def test_a_late_arrival_after_midnight_still_opens_the_previous_night(self):
        self.assertEqual(business_date(manila(2026, 9, 8, 0, 30), TZ, NIGHT), date(2026, 9, 7))

    def test_the_start_of_a_night_shift_is_its_own_date(self):
        self.assertEqual(business_date(manila(2026, 9, 7, 22, 0), TZ, NIGHT), date(2026, 9, 7))

    def test_the_local_date_is_used_when_no_shift_is_known(self):
        # 23:30 UTC on the 6th is already 07:30 on the 7th in Manila.
        self.assertEqual(business_date(manila(2026, 9, 7, 7, 30), TZ), date(2026, 9, 7))


class DayRecordTests(unittest.TestCase):
    def test_a_full_ordinary_day(self):
        record = summarise(date(2026, 9, 7), manila(2026, 9, 7, 8, 0), manila(2026, 9, 7, 17, 0))
        self.assertEqual(record.status, PRESENT)
        self.assertEqual(record.worked_minutes, 480)
        self.assertEqual(record.break_deducted, 60)
        self.assertEqual((record.late_minutes, record.overtime_minutes, record.undertime_minutes), (0, 0, 0))

    def test_the_grace_period_is_not_late(self):
        record = summarise(date(2026, 9, 7), manila(2026, 9, 7, 8, 15), manila(2026, 9, 7, 17, 0))
        self.assertEqual(record.late_minutes, 0)
        self.assertEqual(record.status, PRESENT)

    def test_a_minute_past_grace_is_late(self):
        record = summarise(date(2026, 9, 7), manila(2026, 9, 7, 8, 16), manila(2026, 9, 7, 17, 0))
        self.assertEqual(record.late_minutes, 1)
        self.assertEqual(record.status, LATE)

    def test_overtime_is_paid_time_beyond_the_shift(self):
        record = summarise(date(2026, 9, 7), manila(2026, 9, 7, 8, 0), manila(2026, 9, 7, 19, 0))
        self.assertEqual(record.worked_minutes, 600)
        self.assertEqual(record.overtime_minutes, 120)

    def test_leaving_early_is_undertime(self):
        record = summarise(date(2026, 9, 7), manila(2026, 9, 7, 8, 0), manila(2026, 9, 7, 15, 0))
        self.assertEqual(record.worked_minutes, 360)
        self.assertEqual(record.undertime_minutes, 120)

    def test_a_short_visit_keeps_its_full_time(self):
        """Under five hours, no meal break is deducted."""
        record = summarise(date(2026, 9, 7), manila(2026, 9, 7, 8, 0), manila(2026, 9, 7, 11, 0))
        self.assertEqual(record.break_deducted, 0)
        self.assertEqual(record.worked_minutes, 180)

    def test_a_day_with_no_time_out_pays_nothing_until_it_is_corrected(self):
        record = summarise(date(2026, 9, 7), manila(2026, 9, 7, 8, 0), None)
        self.assertEqual(record.status, INCOMPLETE)
        self.assertEqual(record.worked_minutes, 0)

    def test_a_scheduled_day_with_no_scans_is_an_absence(self):
        record = summarise(date(2026, 9, 7), None, None)
        self.assertEqual(record.status, ABSENT)
        self.assertEqual(record.undertime_minutes, 480)

    def test_an_unscheduled_day_with_no_scans_is_a_rest_day(self):
        record = summarise(date(2026, 9, 5), None, None)  # a Saturday
        self.assertEqual(record.status, REST_DAY)
        self.assertEqual(record.undertime_minutes, 0)

    def test_working_a_rest_day_is_all_overtime_and_never_undertime(self):
        record = summarise(date(2026, 9, 5), manila(2026, 9, 5, 8, 0), manila(2026, 9, 5, 13, 0))
        self.assertEqual(record.status, UNSCHEDULED)
        self.assertEqual(record.overtime_minutes, 300)
        self.assertEqual(record.undertime_minutes, 0)

    def test_a_night_shift_is_one_row_not_two(self):
        record = summarise(date(2026, 9, 7), manila(2026, 9, 7, 22, 0), manila(2026, 9, 8, 6, 0), shift=NIGHT)
        self.assertEqual(record.day, date(2026, 9, 7))
        self.assertEqual(record.worked_minutes, 420)
        self.assertEqual(record.status, PRESENT)


if __name__ == "__main__":
    unittest.main()
