"""Passwords, session tokens and the poster signature."""

from __future__ import annotations

import unittest

from dtr.security import (
    AuthError, build_payload, hash_password, hash_session_token, new_location_code,
    new_session_token, normalise_code, parse_payload, verify_password,
)

SECRET = "test-secret"


class PasswordTests(unittest.TestCase):
    def test_a_password_verifies_against_its_own_hash(self):
        encoded = hash_password("correct horse", iterations=1000)
        self.assertTrue(verify_password("correct horse", encoded))
        self.assertFalse(verify_password("Correct horse", encoded))

    def test_two_hashes_of_one_password_differ(self):
        self.assertNotEqual(hash_password("same input", iterations=1000),
                            hash_password("same input", iterations=1000))

    def test_the_work_factor_is_recorded_so_it_can_be_raised_later(self):
        encoded = hash_password("whatever12", iterations=1234)
        self.assertEqual(encoded.split("$")[1], "1234")
        self.assertTrue(verify_password("whatever12", encoded))

    def test_a_short_password_is_refused(self):
        with self.assertRaises(AuthError):
            hash_password("short")

    def test_rubbish_in_the_hash_column_fails_closed(self):
        for bad in ("", "$$$", "md5$1$x$y", "pbkdf2_sha256$notanumber$x$y"):
            self.assertFalse(verify_password("anything", bad))


class SessionTokenTests(unittest.TestCase):
    def test_only_the_digest_is_meant_for_storage(self):
        token, digest = new_session_token()
        self.assertNotEqual(token, digest)
        self.assertEqual(hash_session_token(token), digest)
        self.assertEqual(len(digest), 64)


class PosterCodeTests(unittest.TestCase):
    def test_codes_avoid_the_characters_people_mistype(self):
        for _ in range(50):
            code = new_location_code()
            self.assertEqual(len(code), 14)
            self.assertFalse(set("ILO01") & set(code.replace("-", "")))

    def test_a_signed_payload_round_trips(self):
        code = new_location_code()
        self.assertEqual(parse_payload(build_payload(code, SECRET), SECRET), code)

    def test_a_payload_signed_with_another_key_is_refused(self):
        payload = build_payload(new_location_code(), "someone elses key")
        with self.assertRaises(AuthError):
            parse_payload(payload, SECRET)

    def test_the_whole_scanned_url_is_accepted(self):
        code = new_location_code()
        payload = build_payload(code, SECRET)
        self.assertEqual(parse_payload(f"https://dtr.example/app/#c={payload}", SECRET), code)

    def test_a_typed_code_is_forgiving_about_case_and_spacing(self):
        code = new_location_code()
        typed = code.lower().replace("-", " ")
        self.assertEqual(parse_payload(typed, SECRET), code)
        self.assertEqual(normalise_code(code.replace("-", "")), code)

    def test_nonsense_is_refused(self):
        for bad in ("", "hello", "AAAA-BBBB", "IIII-LLLL-OOOO"):
            with self.subTest(bad=bad), self.assertRaises(AuthError):
                parse_payload(bad, SECRET)


if __name__ == "__main__":
    unittest.main()
