"""The journeys a person actually takes, driven in a real browser.

Each of these would pass every Python test in the suite while being broken on
screen, which is the point of having them.
"""

from __future__ import annotations

import unittest

from .support import (
    DEMO_PASSWORD, OFFICE_LAT, OFFICE_LNG, LiveServer, launch_chromium, playwright_or_none,
)

PLAYWRIGHT, SKIP_REASON = playwright_or_none()
PHONE = {"width": 390, "height": 844}
DESK = {"width": 1280, "height": 900}


@unittest.skipIf(PLAYWRIGHT is None, SKIP_REASON)
class BrowserFlowTests(unittest.TestCase):
    """One server and one browser for the class; a fresh context per test.

    Tests share the server, so each uses its own employee rather than relying
    on the order they run in.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = LiveServer()
        cls.people = {
            "on_site": "2001", "off_site": "2002", "already_open": "2003",
            "issued": "2004", "watched": "2005", "corrector": "2006",
        }
        for index, number in enumerate(cls.people.values(), start=1):
            cls.server.add_employee(number, f"Tester {index}",
                                    must_change_password=number == cls.people["issued"])
        cls.server.add_employee("2100", "Admin Person", role="admin")
        cls._playwright = PLAYWRIGHT().start()
        try:
            cls.browser = launch_chromium(cls._playwright)
        except Exception as exc:  # no usable browser binary
            cls._playwright.stop()
            cls.server.stop()
            raise unittest.SkipTest(f"no chromium available: {exc}") from exc

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls._playwright.stop()
        cls.server.stop()

    # ------------------------------------------------------------ helpers

    def phone_at(self, latitude=OFFICE_LAT, longitude=OFFICE_LNG, accuracy=12):
        context = self.browser.new_context(
            viewport=PHONE,
            geolocation={"latitude": latitude, "longitude": longitude, "accuracy": accuracy},
            permissions=["geolocation"],
        )
        self.addCleanup(context.close)
        page = context.new_page()
        self.fail_on_page_error(page)
        return page

    def desktop(self):
        context = self.browser.new_context(viewport=DESK)
        self.addCleanup(context.close)
        page = context.new_page()
        self.fail_on_page_error(page)
        return page

    def fail_on_page_error(self, page) -> None:
        """An uncaught exception in the page is a test failure, not a warning."""
        errors: list[str] = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        self.addCleanup(lambda: self.assertEqual(errors, [], "the page threw"))

    def sign_in(self, page, number, password=DEMO_PASSWORD):
        page.goto(f"{self.server.base_url}/app/")
        page.wait_for_selector("#view-login:not(.hidden)")
        page.fill("#login-number", number)
        page.fill("#login-password", password)
        page.click("#login-form button[type=submit]")

    def accept_consent_if_shown(self, page) -> None:
        page.wait_for_timeout(700)
        if page.is_visible("#consent-accept"):
            page.click("#consent-accept")

    def scan_in_a_new_window(self, page):
        """What the phone's camera app does: open the poster URL fresh.

        Deliberately a new page rather than page.goto() on the existing one.
        Navigating to a URL that differs only by fragment does not reload the
        document, so doing it in place would test the hashchange path instead
        of the cold load and neither would be covered on its own.
        """
        opened = page.context.new_page()
        self.fail_on_page_error(opened)
        opened.goto(self.server.scan_url)
        return opened

    # ------------------------------------------------------------- scanning

    def test_a_scan_at_the_office_is_recorded(self):
        page = self.phone_at()
        self.sign_in(page, self.people["on_site"])
        self.accept_consent_if_shown(page)
        page.wait_for_selector("#view-home:not(.hidden)", timeout=10_000)

        scanned = self.scan_in_a_new_window(page)
        scanned.wait_for_selector("#view-result:not(.hidden)", timeout=15_000)
        self.assertIn("Timed in", scanned.inner_text("#result-kind"))
        self.assertRegex(scanned.inner_text("#result-time").strip(), r"^\d{2}:\d{2}:\d{2}$")
        self.assertIn("Office", scanned.inner_text("#result-detail"))

    def test_scanning_while_the_app_is_already_open_still_works(self):
        """The regression that shipped once.

        Clocking out means scanning the poster with the app already on screen.
        The browser then changes the fragment and focuses the window without
        reloading, so nothing re-reads the payload unless something listens for
        it. When this broke, every unit test still passed.
        """
        page = self.phone_at()
        self.sign_in(page, self.people["already_open"])
        self.accept_consent_if_shown(page)
        page.wait_for_selector("#view-home:not(.hidden)", timeout=10_000)

        # Same document, fragment only: no navigation, no reload.
        page.evaluate("url => { window.location.hash = new URL(url).hash; }", self.server.scan_url)
        page.wait_for_selector("#view-result:not(.hidden)", timeout=15_000)
        self.assertIn("Timed in", page.inner_text("#result-kind"))

    def test_a_scan_from_off_site_is_refused_and_says_how_far(self):
        page = self.phone_at(latitude=OFFICE_LAT + 0.02)
        self.sign_in(page, self.people["off_site"])
        self.accept_consent_if_shown(page)
        page.wait_for_selector("#view-home:not(.hidden)", timeout=10_000)

        scanned = self.scan_in_a_new_window(page)
        scanned.wait_for_selector("#banner:not(.hidden)", timeout=15_000)
        self.assertIn("from the workplace", scanned.inner_text("#banner"))
        self.assertFalse(scanned.is_visible("#view-result"))

    # -------------------------------------------------------------- gates

    def test_an_issued_password_blocks_the_app_until_it_is_changed(self):
        page = self.phone_at()
        self.sign_in(page, self.people["issued"])
        page.wait_for_selector("#view-password:not(.hidden)", timeout=10_000)
        self.assertFalse(page.is_visible("#view-home"))

        page.fill("#pw-current", DEMO_PASSWORD)
        page.fill("#pw-new", "one-only-i-know")
        page.fill("#pw-again", "one-only-i-know")
        page.click("#password-form button[type=submit]")

        # Changing it signs you out everywhere, on purpose.
        page.wait_for_selector("#view-login:not(.hidden)", timeout=10_000)
        self.sign_in(page, self.people["issued"], "one-only-i-know")
        self.accept_consent_if_shown(page)
        page.wait_for_selector("#view-home:not(.hidden)", timeout=10_000)

    def test_the_consent_notice_comes_before_any_scan(self):
        number = "2200"
        self.server.add_employee(number, "Unconsented Person", consent=False)
        page = self.phone_at()
        self.sign_in(page, number)
        page.wait_for_selector("#view-consent:not(.hidden)", timeout=10_000)
        self.assertIn("location", page.inner_text("#consent-body").lower())
        self.assertFalse(page.is_visible("#view-home"))

    # ---------------------------------------------------------- dashboard

    def test_a_scan_reaches_the_dashboard(self):
        phone = self.phone_at()
        self.sign_in(phone, self.people["watched"])
        self.accept_consent_if_shown(phone)
        phone.wait_for_selector("#view-home:not(.hidden)", timeout=10_000)
        scanned = self.scan_in_a_new_window(phone)
        scanned.wait_for_selector("#view-result:not(.hidden)", timeout=15_000)

        desk = self.desktop()
        desk.goto(f"{self.server.base_url}/admin/")
        desk.fill("#login-number", "2100")
        desk.fill("#login-password", DEMO_PASSWORD)
        desk.click("#login-form button[type=submit]")
        desk.wait_for_selector("#view-main:not(.hidden)", timeout=15_000)
        desk.wait_for_selector("#board-grid .person", timeout=15_000)

        # The visible presence grid...
        board = desk.inner_text("#board-grid")
        self.assertIn("Tester 5", board)
        # ...and the table that shadows it for a screen reader.
        rows = desk.eval_on_selector_all("#board-body tr", "els => els.map(e => e.innerText)")
        self.assertTrue(any("Tester 5" in row and "Clocked in" in row for row in rows))

    def test_the_dashboard_refuses_an_employee_password(self):
        desk = self.desktop()
        desk.goto(f"{self.server.base_url}/admin/")
        desk.fill("#login-number", self.people["on_site"])
        desk.fill("#login-password", DEMO_PASSWORD)
        desk.click("#login-form button[type=submit]")
        desk.wait_for_selector("#banner:not(.hidden)", timeout=10_000)
        self.assertFalse(desk.is_visible("#view-main"))

    def test_an_admin_can_create_a_shift_and_assign_it(self):
        """Without this the dashboard could only pick shifts, never make one,
        so a fresh deployment left everyone on the hard-coded default."""
        desk = self.desktop()
        desk.goto(f"{self.server.base_url}/admin/")
        desk.fill("#login-number", "2100")
        desk.fill("#login-password", DEMO_PASSWORD)
        desk.click("#login-form button[type=submit]")
        desk.wait_for_selector("#view-main:not(.hidden)", timeout=15_000)
        desk.click('nav.sections button[data-section="people"]')
        desk.wait_for_selector("#shift-form", timeout=10_000)

        desk.fill("#s-name", "Weekend cover")
        desk.fill("#s-start", "10:00")
        desk.fill("#s-end", "18:00")
        desk.uncheck("#s-day-0")
        desk.check("#s-day-5")
        desk.click("#shift-form button[type=submit]")
        desk.wait_for_timeout(1200)

        self.assertIn("Weekend cover", desk.inner_text("#shift-list"))
        # Days reset to the Monday-to-Friday default, not to nothing.
        self.assertEqual([desk.is_checked(f"#s-day-{i}") for i in range(7)],
                         [True, True, True, True, True, False, False])
        # And it is immediately assignable to a person.
        options = desk.eval_on_selector_all("#p-shift option", "els => els.map(e => e.textContent)")
        self.assertTrue(any("Weekend cover" in text for text in options))

    # -------------------------------------------------------- corrections

    def test_an_employee_can_ask_for_a_correction(self):
        page = self.phone_at()
        self.sign_in(page, self.people["corrector"])
        self.accept_consent_if_shown(page)
        page.wait_for_selector("#view-home:not(.hidden)", timeout=10_000)

        page.click("#tab-history")
        page.wait_for_timeout(800)
        page.fill("#corr-date", "2026-09-07")
        page.select_option("#corr-type", "add_missing")
        page.select_option("#corr-entry", "time_out")
        page.fill("#corr-time", "17:00")
        page.fill("#corr-reason", "My phone battery died before I left, so it was never recorded.")
        page.click("#correction-form button[type=submit]")

        page.wait_for_selector("#panel-requests:not(.hidden)", timeout=10_000)
        page.wait_for_timeout(600)
        listed = page.inner_text("#requests-list")
        self.assertIn("battery died", listed)          # it is the request we filed
        self.assertIn("Waiting", listed)                # and nobody has decided it yet
        self.assertEqual(page.eval_on_selector_all(
            "#requests-list .chip.warning", "els => els.length"), 1)


if __name__ == "__main__":
    unittest.main()
