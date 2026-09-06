"""Passwords, session tokens, and the signature on the QR poster.

Nothing here is novel and that is the point: PBKDF2-HMAC-SHA256 from the
standard library, random opaque session tokens stored only as digests, and an
HMAC over the poster code so a hand-printed QR is rejected before it reaches
the database.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from . import DtrError

# Django-style self-describing hashes, so the work factor can rise later
# without invalidating every existing password.
HASH_SCHEME = "pbkdf2_sha256"
PBKDF2_ITERATIONS = 600_000

# Unambiguous alphabet: no I, L, O, 0 or 1, because this code is also printed
# under the QR for people to type when a camera will not focus.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 12
SIGNATURE_LENGTH = 16


class AuthError(DtrError):
    pass


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# --------------------------------------------------------------- passwords


def hash_password(password: str, *, iterations: int = PBKDF2_ITERATIONS) -> str:
    if len(password) < 8:
        raise AuthError("password must be at least 8 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{HASH_SCHEME}${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, iterations, salt, digest = encoded.split("$")
        if scheme != HASH_SCHEME:
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), _unb64(salt), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, _unb64(digest))


# ---------------------------------------------------------------- sessions


def new_session_token() -> tuple[str, str]:
    """Return ``(token, token_hash)``. Only the hash is ever stored."""
    token = secrets.token_urlsafe(32)
    return token, hash_session_token(token)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_expiry(minutes: int, *, now: datetime | None = None) -> datetime:
    return (now or datetime.now(timezone.utc)) + timedelta(minutes=minutes)


# -------------------------------------------------------------- QR posters


def new_location_code() -> str:
    """A random poster code, e.g. ``H7KQ-2M9P-XRTB``."""
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    return "-".join(raw[i : i + 4] for i in range(0, CODE_LENGTH, 4))


def normalise_code(code: str) -> str:
    """Accept what a tired person types: lower case, spaces, missing dashes."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", code or "").upper()
    if len(cleaned) != CODE_LENGTH or any(ch not in CODE_ALPHABET for ch in cleaned):
        raise AuthError("that does not look like a location code")
    return "-".join(cleaned[i : i + 4] for i in range(0, CODE_LENGTH, 4))


def sign_code(code: str, secret: str) -> str:
    mac = hmac.new(secret.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).digest()
    return _b64(mac)[:SIGNATURE_LENGTH]


def build_payload(code: str, secret: str) -> str:
    """The string encoded in the printed QR: ``CODE.signature``."""
    return f"{code}.{sign_code(code, secret)}"


def parse_payload(payload: str, secret: str) -> str:
    """Return the location code from a scanned payload, or raise.

    Also accepts a bare code so that the typed fallback and the scanned URL
    share one code path; a bare code carries no signature and is verified by
    the database lookup alone.
    """
    text = (payload or "").strip()
    if "://" in text:  # an in-app scan hands us the whole URL from the poster
        found = re.search(r"[?#&]c=([^&#]+)", text)
        if not found:
            raise AuthError("that QR code is not a workplace poster")
        text = found.group(1)
    if "." not in text:
        return normalise_code(text)
    code, _, signature = text.partition(".")
    code = normalise_code(code)
    if not hmac.compare_digest(signature, sign_code(code, secret)):
        raise AuthError("this QR code was not issued by this system")
    return code
