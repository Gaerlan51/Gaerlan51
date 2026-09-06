"""Settings.

``config/dtr.toml`` is committed and holds nothing secret. ``config/dtr.local.toml``
overlays it key by key and is gitignored, matching the pattern the ops toolkit
already uses for prices. Environment variables (``DTR_*``) win over both, so a
container deploy needs no files at all.

The signing secret is never committed. If none is configured, one is generated
once into ``data/dtr/secret.key`` (mode 0600) so a fresh clone runs without setup.
"""

from __future__ import annotations

import os
import secrets
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import DtrError

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = REPO_ROOT / "config" / "dtr.toml"
LOCAL_CONFIG = REPO_ROOT / "config" / "dtr.local.toml"


class ConfigError(DtrError):
    pass


def _merge(base: dict, overlay: dict) -> dict:
    out = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def _load_toml(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except tomllib.TOMLDecodeError as exc:  # pragma: no cover - operator typo
        raise ConfigError(f"{path}: {exc}") from exc


@dataclass(frozen=True)
class Settings:
    """Everything the app needs to boot.

    Defaults follow the Philippines: Asia/Manila for the business day, and a
    three-year retention floor for employment records under the Labor Code.
    Neither is legal advice — see specs/dtr-spec.md.
    """

    data_dir: Path = REPO_ROOT / "data" / "dtr"
    db_path: Path | None = None
    photo_dir: Path | None = None
    secret_key: str = ""

    timezone: str = "Asia/Manila"
    organisation: str = "Your Company"
    base_url: str = "http://localhost:8000"

    # Retention: the floor below which purge_expired() refuses to delete.
    retention_days: int = 1095
    photo_retention_days: int = 90

    # Scan policy.
    max_gps_accuracy_m: float = 100.0
    max_fix_age_seconds: int = 90
    duplicate_scan_seconds: int = 60
    min_shift_seconds: int = 60

    # Session lifetimes, in minutes. Admin sessions are deliberately shorter.
    employee_session_minutes: int = 60 * 24 * 14
    admin_session_minutes: int = 60 * 8

    # Selfie capture ships built but disabled; each location opts in.
    photo_capture_available: bool = True
    consent_version: str = "2026-01-PH-DPA"

    _tz: ZoneInfo = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        try:
            object.__setattr__(self, "_tz", ZoneInfo(self.timezone))
        except ZoneInfoNotFoundError as exc:
            raise ConfigError(f"unknown timezone {self.timezone!r}") from exc
        if self.db_path is None:
            object.__setattr__(self, "db_path", self.data_dir / "dtr.db")
        if self.photo_dir is None:
            object.__setattr__(self, "photo_dir", self.data_dir / "photos")
        if self.retention_days < 1095:
            raise ConfigError(
                "retention_days below 1095 (3 years); PH employment records must be "
                "kept at least that long. Raise it, or change the law first."
            )

    @property
    def tz(self) -> ZoneInfo:
        return self._tz

    @property
    def poster_problem(self) -> str | None:
        """Why a printed poster would not work, or None if it would.

        Two ways to print a poster that cannot possibly be scanned, both silent
        until an employee is standing at the door with a phone:

        * ``base_url`` on localhost — to a phone, "localhost" is the phone, so
          the QR opens nothing at all;
        * ``base_url`` on plain http — browsers withhold geolocation from an
          insecure origin (localhost aside), so the scan can never complete.

        Both are configuration, not code, so the system says so where the poster
        is printed rather than letting somebody find out at the entrance.
        """
        parsed = urlsplit(self.base_url)
        host = (parsed.hostname or "").lower()
        if host in {"", "localhost", "127.0.0.1", "::1", "0.0.0.0"}:
            return (
                "This poster points at localhost. On a phone that means the phone itself, "
                "so scanning it opens nothing. Set DTR_BASE_URL to the address staff reach "
                "this system on, then reprint."
            )
        if parsed.scheme != "https":
            return (
                "This poster points at a plain http address. Browsers only give a page your "
                "location over https, so the scan will never finish. Serve this over https, "
                "then reprint."
            )
        return None

    @property
    def poster_ready(self) -> bool:
        return self.poster_problem is None


_TRUE = {"1", "true", "yes", "on"}


def _env_overrides() -> dict:
    mapping = {
        "DTR_DATA_DIR": ("data_dir", Path),
        "DTR_DB_PATH": ("db_path", Path),
        "DTR_SECRET_KEY": ("secret_key", str),
        "DTR_TIMEZONE": ("timezone", str),
        "DTR_ORGANISATION": ("organisation", str),
        "DTR_BASE_URL": ("base_url", str),
        "DTR_RETENTION_DAYS": ("retention_days", int),
        "DTR_MAX_GPS_ACCURACY_M": ("max_gps_accuracy_m", float),
        "DTR_MAX_FIX_AGE_SECONDS": ("max_fix_age_seconds", int),
        "DTR_PHOTO_CAPTURE_AVAILABLE": ("photo_capture_available", lambda v: v.lower() in _TRUE),
    }
    out: dict = {}
    for env_name, (key, cast) in mapping.items():
        raw = os.environ.get(env_name)
        if raw is not None and raw != "":
            out[key] = cast(raw)
    return out


def _ensure_secret(data_dir: Path) -> str:
    key_file = data_dir / "secret.key"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    data_dir.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_urlsafe(48)
    key_file.write_text(secret + "\n", encoding="utf-8")
    key_file.chmod(0o600)
    return secret


def load_settings(config_path: Path | None = None, *, create_secret: bool = True) -> Settings:
    raw = _merge(_load_toml(config_path or DEFAULT_CONFIG), _load_toml(LOCAL_CONFIG))
    flat: dict = {}
    for section in ("app", "scan", "security", "retention"):
        flat.update(raw.get(section, {}))
    flat.update(_env_overrides())

    known = {f.name for f in Settings.__dataclass_fields__.values() if f.init}
    unknown = set(flat) - known
    if unknown:
        raise ConfigError(f"unknown setting(s): {', '.join(sorted(unknown))}")
    for key in ("data_dir", "db_path", "photo_dir"):
        if key in flat and flat[key] is not None:
            flat[key] = Path(flat[key])

    settings = Settings(**flat)
    if not settings.secret_key and create_secret:
        settings = Settings(**{**flat, "secret_key": _ensure_secret(settings.data_dir)})
    return settings
