import unittest
from datetime import date

from ops.config import Followups
from ops.followups import (
    deadline_risk,
    due_today,
    gone_quiet,
    overdue_followups,
    unpaid_past_terms,
)
from ops.tracker import Row

TODAY = date(2026, 9, 4)
RULES = Followups()


def row(**kw) -> Row:
    base = dict(id="a-2609", name="Test Student A", status="scoping")
    base.update(kw)
    return Row(**base)


class FollowupTests(unittest.TestCase):
    def test_overdue_flagged_with_how_late(self):
        found = overdue_followups([row(next_followup="2026-09-01")], TODAY)
        self.assertEqual(len(found), 1)
        self.assertIn("3d ago", found[0][1])

    def test_future_followup_not_flagged(self):
        self.assertEqual(overdue_followups([row(next_followup="2026-09-09")], TODAY), [])

    def test_closed_clients_never_surface(self):
        stale = row(next_followup="2026-01-01", status="closed-lost")
        self.assertEqual(overdue_followups([stale], TODAY), [])
        self.assertEqual(gone_quiet([stale], TODAY, {}, 10), [])

    def test_due_today_is_its_own_section(self):
        self.assertEqual(len(due_today([row(next_followup="2026-09-04")], TODAY)), 1)

    def test_unpaid_past_terms_uses_the_invoice_date(self):
        client = row(payment_status="invoiced")
        found = unpaid_past_terms([client], TODAY, {"a-2609": date(2026, 8, 25)}, 7)
        self.assertEqual(len(found), 1)
        self.assertIn("10d ago", found[0][1])

    def test_invoice_inside_terms_not_flagged(self):
        client = row(payment_status="invoiced")
        self.assertEqual(unpaid_past_terms([client], TODAY, {"a-2609": date(2026, 9, 1)}, 7), [])

    def test_paid_client_not_flagged(self):
        client = row(payment_status="paid")
        self.assertEqual(unpaid_past_terms([client], TODAY, {"a-2609": date(2026, 1, 1)}, 7), [])

    def test_deadline_risk_only_covers_work_in_progress(self):
        soon = row(status="in-progress", deadline="2026-09-06")
        self.assertEqual(len(deadline_risk([soon], TODAY, 3)), 1)
        idle = row(status="quoted", deadline="2026-09-06")
        self.assertEqual(deadline_risk([idle], TODAY, 3), [])

    def test_passed_deadline_reads_as_passed(self):
        late = row(status="in-progress", deadline="2026-09-01")
        self.assertIn("passed", deadline_risk([late], TODAY, 3)[0][1])

    def test_distant_deadline_not_flagged(self):
        far = row(status="in-progress", deadline="2026-12-01")
        self.assertEqual(deadline_risk([far], TODAY, 3), [])

    def test_silence_measured_from_last_status_change(self):
        client = row(status="quoted", date_inquired="2026-01-01")
        found = gone_quiet([client], TODAY, {"a-2609": date(2026, 8, 20)}, 10)
        self.assertIn("15d", found[0][1])

    def test_silence_falls_back_to_date_inquired(self):
        client = row(status="quoted", date_inquired="2026-08-01")
        self.assertEqual(len(gone_quiet([client], TODAY, {}, 10)), 1)

    def test_recent_movement_is_quiet_enough(self):
        client = row(status="quoted", date_inquired="2026-09-01")
        self.assertEqual(gone_quiet([client], TODAY, {}, 10), [])

    def test_in_progress_is_not_gone_quiet(self):
        client = row(status="in-progress", date_inquired="2026-01-01")
        self.assertEqual(gone_quiet([client], TODAY, {}, 10), [])

    def test_rules_come_from_config_defaults(self):
        self.assertEqual(RULES.payment_firm_days, 7)
        self.assertEqual(RULES.checkin_silence_days, 10)
