"""Distance and geofence decisions.

The chosen anti-manipulation mechanism is a static poster plus a geofence, so
this module carries the weight the rotating token would otherwise carry. It is
deliberately conservative about GPS:

* a fix with no accuracy figure is not a fix;
* a fix wider than the location's tolerance is refused, not accepted-and-flagged
  — a 2 km accuracy circle "containing" the office proves nothing;
* a stale fix is refused, because a cached position is what a phone hands back
  when it is nowhere near the office;
* between those two, a reading that is outside the radius but inside its own
  error bars is recorded and flagged for a human, never silently dropped.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = radians(lat1), radians(lat2)
    dp = p2 - p1
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))


@dataclass(frozen=True)
class Fix:
    """What the browser's Geolocation API gave us."""

    latitude: float | None
    longitude: float | None
    accuracy_m: float | None
    age_seconds: float | None = None


@dataclass(frozen=True)
class GeofenceVerdict:
    accepted: bool
    distance_m: float | None
    code: str = ""
    message: str = ""
    flags: tuple[str, ...] = ()


def check_fence(
    fix: Fix,
    *,
    latitude: float,
    longitude: float,
    radius_m: float,
    max_accuracy_m: float,
    max_fix_age_seconds: float,
) -> GeofenceVerdict:
    if fix.latitude is None or fix.longitude is None:
        return GeofenceVerdict(
            False,
            None,
            "location_required",
            "Location is off. Turn it on and try again — the scan needs it to "
            "prove you are at the workplace.",
        )
    if not (-90 <= fix.latitude <= 90 and -180 <= fix.longitude <= 180):
        return GeofenceVerdict(False, None, "location_invalid", "That location reading is not a real place.")
    if fix.accuracy_m is None or fix.accuracy_m <= 0:
        return GeofenceVerdict(
            False, None, "accuracy_unknown", "Your phone did not report how accurate its location is."
        )
    if fix.accuracy_m > max_accuracy_m:
        return GeofenceVerdict(
            False,
            None,
            "accuracy_too_low",
            f"Your location is only accurate to about {fix.accuracy_m:.0f} m. "
            f"Step outside or near a window and try again.",
        )
    if fix.age_seconds is not None and fix.age_seconds > max_fix_age_seconds:
        return GeofenceVerdict(
            False,
            None,
            "fix_stale",
            "Your phone gave a saved location rather than a fresh one. Try again in a moment.",
        )

    distance = haversine_m(fix.latitude, fix.longitude, latitude, longitude)
    if distance - fix.accuracy_m > radius_m:
        return GeofenceVerdict(
            False,
            distance,
            "outside_geofence",
            f"You are about {distance:.0f} m from the workplace. Scans only work on site.",
        )
    flags: tuple[str, ...] = ()
    if distance > radius_m:
        # Inside the error bars but outside the fence: recorded, and a human looks.
        flags = ("edge_of_geofence",)
    return GeofenceVerdict(True, distance, flags=flags)
