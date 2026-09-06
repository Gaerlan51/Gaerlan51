"""The notices employees see before any location or photo is captured.

Written against the Data Privacy Act of 2012 (RA 10173) and its IRR: state the
purpose, the specific data, who sees it, how long it is kept, and the right to
access and correct it. This is a starting draft, not legal advice — have your
counsel or DPO review it before rollout, and record the version they approved
in ``consent_version``.
"""

from __future__ import annotations

from .config import Settings

LOCATION_TITLE = "Location notice"
PHOTO_TITLE = "Photo notice"


def location_notice(settings: Settings) -> str:
    years = settings.retention_days // 365
    return (
        f"To clock in and out, {settings.organisation} records your phone's location at the "
        "moment you scan, together with the time recorded by our server.\n\n"
        "What is collected: your latitude, longitude, and the accuracy your phone reports, "
        "only at the instant you press Scan. Your location is not tracked at any other time, "
        "and the app cannot see where you are when it is closed.\n\n"
        "Why: to confirm that a scan was made at the workplace, so that time records are "
        "accurate and cannot be made on someone else's behalf.\n\n"
        f"Who can see it: your supervisor and HR. Records are kept for {years} years to meet "
        "the retention period for employment records, then deleted.\n\n"
        "Your rights: you may view your own records at any time in this app, and ask for a "
        "correction if something is wrong. Under the Data Privacy Act of 2012 you may also "
        "request access to, or correction of, your personal data held by us.\n\n"
        "If you do not agree, you cannot clock in by QR scan. Speak to HR about an alternative."
    )


def photo_notice(settings: Settings) -> str:
    days = settings.photo_retention_days
    return (
        f"At some workplaces, {settings.organisation} also records a photo from your phone's "
        "front camera when you scan.\n\n"
        "What is collected: one still photo at the moment you scan. No video, no continuous "
        "camera access.\n\n"
        "Why: to confirm that the person scanning is the person the record belongs to.\n\n"
        f"Who can see it: your supervisor and HR, attached to that one time record. Photos are "
        f"deleted after {days} days; the time record itself remains.\n\n"
        "This is not facial recognition. No biometric template is created and no automated "
        "matching is performed — a person looks at the photo only if a record is questioned.\n\n"
        "If you do not agree, tell HR: they can turn photo capture off for your workplace or "
        "arrange another way for you to clock in."
    )


def notices(settings: Settings) -> dict:
    return {
        "version": settings.consent_version,
        "location": {"title": LOCATION_TITLE, "body": location_notice(settings)},
        "photo": {"title": PHOTO_TITLE, "body": photo_notice(settings)},
    }
