"""End-to-end over HTTP, including the two-session rule and the CSV export."""

from __future__ import annotations

import csv
import io
import unittest

try:
    from fastapi.testclient import TestClient
    HAVE_FASTAPI = True
except ImportError:  # the core rules are tested without the web layer
    HAVE_FASTAPI = False

from .support import OFFICE_LAT, OFFICE_LNG, Fixture

GOOD_FIX = {"latitude": OFFICE_LAT, "longitude": OFFICE_LNG, "accuracy_m": 10, "fix_age_seconds": 2}


@unittest.skipUnless(HAVE_FASTAPI, "fastapi is not installed")
class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        from dtr.app import create_app

        self.fx = Fixture()
        self.addCleanup(self.fx.close)
        self.employee = self.fx.add_employee("1003", "Ana Reyes", password="password123")
        self.admin = self.fx.add_employee("1001", "Bea Lim", role="admin", password="password123")
        self.newcomer = self.fx.add_employee("1004", "Cy Tan", consent=False, password="password123")
        # Two accounts still holding the password someone else chose for them.
        self.issued = self.fx.add_employee("1005", "Dee Ramos", password="issued-by-hr",
                                           must_change_password=True)
        self.issued_admin = self.fx.add_employee("1006", "Eve Santos", role="admin",
                                                 password="issued-by-hr", must_change_password=True)
        self.fx.conn.close()  # from here on the app opens its own connections

        self.client = TestClient(create_app(self.fx.settings))
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.conn = self.client.app.state.db.conn

    # ------------------------------------------------------------ helpers

    def sign_in(self, number="1003", password="password123", admin=False):
        path = "/api/auth/admin/login" if admin else "/api/auth/login"
        data = {"employee_number": number, "password": password}
        if not admin:
            data["device_id"] = "phone-a"
        return self.client.post(path, data=data)

    def scan(self, **overrides):
        data = {"payload": self.fx.payload, "device_id": "phone-a", **GOOD_FIX}
        data.update(overrides)
        return self.client.post("/api/scan", data=data)

    # ------------------------------------------------------------- basics

    def test_the_health_and_config_endpoints_need_no_session(self):
        self.assertEqual(self.client.get("/api/health").json()["ok"], True)
        self.assertEqual(self.client.get("/api/config").json()["organisation"], "Test Co")

    def test_scanning_without_signing_in_is_refused(self):
        self.assertEqual(self.scan().status_code, 401)

    def test_a_wrong_password_says_nothing_about_who_exists(self):
        missing = self.sign_in("9999", "whatever12")
        wrong = self.sign_in("1003", "wrongpassword")
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(missing.json()["detail"], wrong.json()["detail"])

    # ------------------------------------------------- two separate sessions

    def test_an_employee_session_cannot_reach_the_dashboard(self):
        self.sign_in("1001")           # the admin, but signing in as an employee
        self.assertEqual(self.client.get("/api/admin/board").status_code, 401)

    def test_a_plain_employee_cannot_open_a_dashboard_session_at_all(self):
        self.assertEqual(self.sign_in("1003", admin=True).status_code, 401)

    def test_an_admin_signs_in_twice_to_hold_both(self):
        self.sign_in("1001")
        self.sign_in("1001", admin=True)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)
        self.assertEqual(self.client.get("/api/admin/board").status_code, 200)

    # --------------------------------------------------------------- scan

    def test_the_first_scan_is_a_time_in_and_an_instant_repeat_is_a_double_tap(self):
        self.sign_in()
        first = self.scan()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["entry_type"], "time_in")
        self.assertEqual(self.scan().json()["detail"]["code"], "duplicate_scan")

    def test_a_scan_from_off_site_is_refused_with_a_reason_the_app_can_use(self):
        self.sign_in()
        response = self.scan(latitude=OFFICE_LAT + 0.05)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "outside_geofence")

    def test_an_employee_who_has_not_consented_is_told_to_read_the_notice(self):
        self.sign_in("1004")
        self.assertEqual(self.scan().json()["detail"]["code"], "consent_required")

    def test_accepting_the_notice_unblocks_scanning(self):
        self.conn.execute("UPDATE employees SET consent_location_at = NULL WHERE employee_number = '1003'")
        self.sign_in()
        self.assertEqual(self.scan().json()["detail"]["code"], "consent_required")
        self.assertEqual(self.client.post("/api/consent", data={"kind": "location"}).status_code, 200)
        self.assertEqual(self.scan().status_code, 200)

    # ------------------------------------------------ employees cannot edit

    def test_there_is_no_endpoint_for_an_employee_to_change_a_record(self):
        self.sign_in()
        log_id = self.scan().json()["log_id"]
        for method in ("put", "patch", "delete"):
            with self.subTest(method=method):
                response = getattr(self.client, method)(f"/api/my/logs/{log_id}")
                self.assertIn(response.status_code, (404, 405))

    def test_an_employee_reads_their_own_record(self):
        self.sign_in()
        self.scan()
        body = self.client.get("/api/my/logs?days=7").json()
        self.assertEqual(len(body["entries"]), 1)
        self.assertEqual(body["entries"][0]["entry_type"], "time_in")

    # ---------------------------------------------------------- dashboard

    def test_the_board_and_the_socket_payload_agree(self):
        self.sign_in()
        self.scan()
        self.sign_in("1001", admin=True)
        board = self.client.get("/api/admin/board").json()
        self.assertEqual(board["counts"]["in"], 1)
        with self.client.websocket_connect("/api/ws/board") as socket:
            message = socket.receive_json()
        self.assertEqual(message["type"], "board")
        self.assertEqual(message["board"]["counts"]["in"], board["counts"]["in"])

    def test_the_socket_refuses_an_employee_session(self):
        self.sign_in()
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/api/ws/board"):
                pass

    def test_the_csv_export_is_openable_and_covers_the_range(self):
        self.sign_in()
        self.scan()
        self.sign_in("1001", admin=True)
        response = self.client.get("/api/admin/report.csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response.headers["content-disposition"])
        rows = list(csv.DictReader(io.StringIO(response.text)))
        self.assertIn("worked_hours", rows[0])
        self.assertTrue(any(row["employee_number"] == "1003" for row in rows))

    def test_exporting_is_itself_recorded(self):
        self.sign_in("1001", admin=True)
        self.client.get("/api/admin/report.csv")
        row = self.conn.execute(
            "SELECT * FROM audit_log WHERE entity_type = 'report' ORDER BY id DESC"
        ).fetchone()
        self.assertEqual(row["action"], "export")

    def test_a_qr_poster_renders_as_svg(self):
        self.sign_in("1001", admin=True)
        response = self.client.get(f"/api/admin/locations/{self.fx.location_id}/qr.svg")
        self.assertEqual(response.headers["content-type"], "image/svg+xml")
        self.assertIn(b"<svg", response.content)

    # ------------------------------- a handed-out password is not a credential

    def test_an_issued_password_signs_in_but_cannot_scan(self):
        self.assertEqual(self.sign_in("1005", "issued-by-hr").status_code, 200)
        response = self.scan()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "password_change_required")

    def test_an_issued_password_cannot_read_a_record_either(self):
        self.sign_in("1005", "issued-by-hr")
        for path in ("/api/my/logs", "/api/my/status", "/api/my/corrections"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 403)

    def test_an_issued_password_cannot_open_the_dashboard(self):
        self.assertEqual(self.sign_in("1006", "issued-by-hr", admin=True).status_code, 200)
        for path in ("/api/admin/board", "/api/admin/employees", "/api/admin/report.csv"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()["detail"]["code"], "password_change_required")

    def test_an_issued_password_cannot_open_the_live_socket(self):
        self.sign_in("1006", "issued-by-hr", admin=True)
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/api/ws/board"):
                pass

    def test_the_front_end_can_still_ask_who_it_is(self):
        """Otherwise it has no way to know why everything else is refused."""
        self.sign_in("1005", "issued-by-hr")
        body = self.client.get("/api/auth/me").json()
        self.assertTrue(body["must_change_password"])

    def test_setting_your_own_password_lifts_the_block(self):
        self.sign_in("1005", "issued-by-hr")
        response = self.client.post("/api/auth/password", data={
            "current_password": "issued-by-hr", "new_password": "one-only-i-know",
        })
        self.assertEqual(response.status_code, 200)
        # The change signs you out everywhere, on purpose.
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.sign_in("1005", "one-only-i-know").status_code, 200)
        self.assertEqual(self.scan().status_code, 200)

    def test_an_admin_can_do_it_without_opening_the_employee_app(self):
        self.sign_in("1006", "issued-by-hr", admin=True)
        response = self.client.post("/api/auth/password", data={
            "current_password": "issued-by-hr", "new_password": "one-only-i-know",
        })
        self.assertEqual(response.status_code, 200)
        self.sign_in("1006", "one-only-i-know", admin=True)
        self.assertEqual(self.client.get("/api/admin/board").status_code, 200)

    def test_keeping_the_issued_password_is_refused(self):
        self.sign_in("1005", "issued-by-hr")
        response = self.client.post("/api/auth/password", data={
            "current_password": "issued-by-hr", "new_password": "issued-by-hr",
        })
        self.assertEqual(response.status_code, 400)

    def test_the_wrong_current_password_changes_nothing(self):
        self.sign_in("1005", "issued-by-hr")
        response = self.client.post("/api/auth/password", data={
            "current_password": "guessing", "new_password": "one-only-i-know",
        })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.sign_in("1005", "issued-by-hr").status_code, 200)

    def test_an_admin_reset_puts_the_block_back(self):
        self.sign_in("1001", admin=True)
        target = self.conn.execute("SELECT id FROM employees WHERE employee_number = '1003'").fetchone()["id"]
        response = self.client.post(f"/api/admin/employees/{target}/password",
                                    data={"password": "temporary-one"})
        self.assertEqual(response.status_code, 200)
        self.sign_in("1003", "temporary-one")
        self.assertEqual(self.scan().status_code, 403)

    # ------------------------------------------------------- housekeeping

    def test_signing_out_kills_both_sessions(self):
        self.sign_in()
        self.sign_in("1001", admin=True)
        self.client.post("/api/auth/logout")
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/api/admin/board").status_code, 401)

    def test_the_pages_are_served_with_a_strict_policy(self):
        response = self.client.get("/app/")
        self.assertEqual(response.status_code, 200)
        policy = response.headers["content-security-policy"]
        self.assertIn("default-src 'self'", policy)
        self.assertNotIn("unsafe-inline", policy)
        self.assertEqual(response.headers["x-frame-options"], "DENY")


if __name__ == "__main__":
    unittest.main()
