import tempfile
import unittest
from datetime import date
from pathlib import Path

from ops.tracker import (
    Row,
    TrackerError,
    can_transition,
    display_status,
    make_id,
    next_statuses,
    normalise_status,
    read_rows,
    write_rows,
)


class IdTests(unittest.TestCase):
    def test_surname_and_year_month(self):
        self.assertEqual(make_id("Test Student A", date(2026, 9, 4)), "a-2609")

    def test_multiword_surname_uses_the_last_token(self):
        self.assertEqual(make_id("Maria Dela Cruz", date(2026, 1, 31)), "cruz-2601")

    def test_collision_gets_a_suffix(self):
        existing = {"cruz-2609"}
        self.assertEqual(make_id("Ana Cruz", date(2026, 9, 4), existing), "cruz-2609-2")

    def test_repeated_collisions_keep_counting(self):
        existing = {"cruz-2609", "cruz-2609-2", "cruz-2609-3"}
        self.assertEqual(make_id("Ana Cruz", date(2026, 9, 4), existing), "cruz-2609-4")

    def test_nameless_input_still_yields_an_id(self):
        self.assertEqual(make_id("???", date(2026, 9, 4)), "client-2609")


class TransitionTests(unittest.TestCase):
    def test_forward_move_allowed(self):
        self.assertTrue(can_transition("scoping", "quoted"))

    def test_skipping_forward_allowed(self):
        self.assertTrue(can_transition("quoted", "in-progress"))

    def test_one_step_back_allowed(self):
        self.assertTrue(can_transition("quoted", "scoping"))

    def test_two_steps_back_rejected(self):
        self.assertFalse(can_transition("in-progress", "scoping"))

    def test_lost_reachable_from_anywhere(self):
        for status in ("new-inquiry", "quoted", "in-progress", "delivered"):
            self.assertTrue(can_transition(status, "closed-lost"))

    def test_nothing_comes_back_from_lost(self):
        self.assertFalse(can_transition("closed-lost", "scoping"))

    def test_legal_values_are_offered_for_the_error_message(self):
        self.assertIn("quoted", next_statuses("scoping"))

    def test_display_form(self):
        self.assertEqual(display_status("awaiting-payment"), "Awaiting Payment")

    def test_normalise_accepts_display_form(self):
        self.assertEqual(normalise_status("Awaiting Payment"), "awaiting-payment")

    def test_unknown_status_rejected(self):
        with self.assertRaises(TrackerError):
            normalise_status("ghosted")


class CsvTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "clients.csv"

    def tearDown(self):
        self._tmp.cleanup()

    def test_missing_file_reads_as_empty(self):
        self.assertEqual(read_rows(self.path), [])

    def test_round_trip_survives_commas_quotes_and_newlines(self):
        nasty = 'Wants "SEM", not ANOVA; 3 IVs, 1 DV\nsecond line\tafter a tab'
        row = Row(
            id="a-2609",
            name="Test Student A",
            school="Sample University",
            thesis_topic="Effect of X on Y, revisited",
            service_requested="analysis",
            notes=nasty,
        )
        write_rows([row], self.path)
        back = read_rows(self.path)
        self.assertEqual(len(back), 1)
        self.assertEqual(back[0].notes, nasty)
        self.assertEqual(back[0].thesis_topic, "Effect of X on Y, revisited")
        self.assertEqual(back[0].id, "a-2609")

    def test_backslash_in_notes_survives(self):
        row = Row(id="a-2609", name="Test Student A", notes=r"path C:\data\raw.sav")
        write_rows([row], self.path)
        self.assertEqual(read_rows(self.path)[0].notes, r"path C:\data\raw.sav")

    def test_rewrite_backs_up_the_previous_file(self):
        write_rows([Row(id="a-2609", name="Test Student A")], self.path)
        write_rows([Row(id="b-2609", name="Test Student B")], self.path)
        backups = list((self.path.parent / ".backups").glob("clients-*.csv"))
        self.assertEqual(len(backups), 1)

    def test_bad_date_is_reported_not_swallowed(self):
        row = Row(id="a-2609", name="Test Student A", deadline="next Tuesday")
        with self.assertRaises(TrackerError):
            row.deadline_date
