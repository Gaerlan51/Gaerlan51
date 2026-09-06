"""Distance and the geofence decision."""

from __future__ import annotations

import unittest

from dtr.geo import Fix, check_fence, haversine_m

from .support import OFFICE_LAT, OFFICE_LNG

FENCE = dict(latitude=OFFICE_LAT, longitude=OFFICE_LNG, radius_m=75,
             max_accuracy_m=100, max_fix_age_seconds=90)


class HaversineTests(unittest.TestCase):
    def test_the_same_point_is_no_distance_at_all(self):
        self.assertEqual(haversine_m(OFFICE_LAT, OFFICE_LNG, OFFICE_LAT, OFFICE_LNG), 0.0)

    def test_a_degree_of_latitude_is_about_111_km(self):
        self.assertAlmostEqual(haversine_m(0, 0, 1, 0) / 1000, 111.19, places=1)

    def test_it_is_symmetric(self):
        there = haversine_m(14.5, 120.9, 14.6, 121.0)
        back = haversine_m(14.6, 121.0, 14.5, 120.9)
        self.assertAlmostEqual(there, back, places=6)


class FenceTests(unittest.TestCase):
    def check(self, fix):
        return check_fence(fix, **FENCE)

    def test_standing_on_the_marker_is_accepted(self):
        verdict = self.check(Fix(OFFICE_LAT, OFFICE_LNG, 8, 1))
        self.assertTrue(verdict.accepted)
        self.assertEqual(verdict.flags, ())

    def test_a_kilometre_away_is_refused(self):
        verdict = self.check(Fix(OFFICE_LAT + 0.009, OFFICE_LNG, 10, 1))
        self.assertFalse(verdict.accepted)
        self.assertEqual(verdict.code, "outside_geofence")
        self.assertGreater(verdict.distance_m, 900)

    def test_just_outside_but_within_the_error_circle_is_accepted_and_flagged(self):
        verdict = self.check(Fix(OFFICE_LAT + 0.0008, OFFICE_LNG, 40, 1))
        self.assertTrue(verdict.accepted)
        self.assertIn("edge_of_geofence", verdict.flags)

    def test_a_wide_error_circle_is_not_a_free_pass(self):
        """A 2 km accuracy circle 'containing' the office proves nothing."""
        verdict = self.check(Fix(OFFICE_LAT + 0.01, OFFICE_LNG, 2000, 1))
        self.assertFalse(verdict.accepted)
        self.assertEqual(verdict.code, "accuracy_too_low")

    def test_a_missing_accuracy_figure_is_not_a_fix(self):
        self.assertEqual(self.check(Fix(OFFICE_LAT, OFFICE_LNG, None, 1)).code, "accuracy_unknown")
        self.assertEqual(self.check(Fix(OFFICE_LAT, OFFICE_LNG, 0, 1)).code, "accuracy_unknown")

    def test_a_stale_fix_is_refused(self):
        self.assertEqual(self.check(Fix(OFFICE_LAT, OFFICE_LNG, 10, 3600)).code, "fix_stale")

    def test_no_coordinates_at_all_is_refused(self):
        self.assertEqual(self.check(Fix(None, None, 10, 1)).code, "location_required")

    def test_impossible_coordinates_are_refused(self):
        self.assertEqual(self.check(Fix(999, 999, 10, 1)).code, "location_invalid")

    def test_an_unknown_fix_age_is_allowed(self):
        """Some browsers report no timestamp; the other checks still apply."""
        self.assertTrue(self.check(Fix(OFFICE_LAT, OFFICE_LNG, 10, None)).accepted)


if __name__ == "__main__":
    unittest.main()
