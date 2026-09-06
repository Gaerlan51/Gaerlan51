"""`python -m dtr` — the whole operational surface.

    python -m dtr init                 create the database
    python -m dtr seed                 add demo people and a location
    python -m dtr serve                run the app
    python -m dtr admin NUMBER NAME    create the first real admin
    python -m dtr poster CODE          write a printable poster
    python -m dtr purge                delete records past the retention floor

Errors an operator can fix print as one line, not a traceback — the same
convention the ops toolkit in this repo uses.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import DtrError, __version__, audit, db, security, store
from .config import load_settings


def cmd_init(args) -> int:
    settings = load_settings()
    conn = db.connect(settings.db_path)
    db.init_db(conn)
    print(f"database ready at {settings.db_path}")
    print(f"timezone {settings.timezone}, retention {settings.retention_days} days")
    return 0


def cmd_seed(args) -> int:
    from .seed import seed
    settings = load_settings()
    conn = db.connect(settings.db_path)
    db.init_db(conn)
    try:
        result = seed(conn, settings, force=args.force)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"seeded {result['employees']} demo employees; every password is {result['password']!r}")
    print("(demo accounts skip the forced password change that real ones get)")
    print(f"location code {result['location_code']}")
    print(f"scan URL      {settings.base_url.rstrip('/')}/app/#c={result['payload']}")
    print("sign in to the dashboard as 1001, to the employee app as 1003.")
    return 0


def cmd_admin(args) -> int:
    import getpass
    settings = load_settings()
    conn = db.connect(settings.db_path)
    db.init_db(conn)
    if store.find_employee_by_number(conn, args.employee_number):
        print(f"error: employee number {args.employee_number} already exists", file=sys.stderr)
        return 1
    password = args.password or getpass.getpass("password: ")
    now = store.iso(store.now_utc())
    cursor = conn.execute(
        "INSERT INTO employees (employee_number, full_name, department, role, password_hash, "
        "must_change_password, status, created_at, updated_at) "
        "VALUES (?, ?, 'HR', 'admin', ?, 0, 'active', ?, ?)",
        (args.employee_number, args.full_name, security.hash_password(password), now, now),
    )
    audit.record(conn, entity_type="employee", entity_id=int(cursor.lastrowid), action=audit.CREATE,
                 reason="created from the command line")
    print(f"admin {args.full_name} ({args.employee_number}) created")
    return 0


def cmd_poster(args) -> int:
    import segno
    settings = load_settings()
    conn = db.connect(settings.db_path, create=False)
    code = security.normalise_code(args.code)
    location = store.get_location_by_code(conn, code)
    if location is None:
        print(f"error: no location with code {code}", file=sys.stderr)
        return 1
    payload = security.build_payload(code, settings.secret_key)
    url = f"{settings.base_url.rstrip('/')}/app/#c={payload}"
    target = Path(args.out or f"poster-{code}.svg")
    segno.make(url, error="h").save(str(target), scale=10, border=2, dark="#111827")
    print(f"wrote {target}")
    print(f"print it with the code {code} in large type underneath, so a phone that")
    print("will not scan can still be used to type it in.")
    return 0


def cmd_purge(args) -> int:
    settings = load_settings()
    conn = db.connect(settings.db_path, create=False)
    if not args.yes:
        print(f"this deletes time records older than {settings.retention_days} days. "
              "re-run with --yes to do it.")
        return 1
    photos = db.purge_photos(conn, photo_dir=settings.photo_dir,
                             retention_days=settings.photo_retention_days)
    result = db.purge_expired(conn, retention_days=settings.retention_days)
    audit.record(conn, entity_type="dtr_log", entity_id="*", action=audit.PURGE,
                 new_value={**result, **photos},
                 reason=f"retention {settings.retention_days} days, "
                        f"photos {settings.photo_retention_days} days")
    print(f"deleted {result['dtr_logs']} records recorded before {result['cutoff']}")
    print(f"deleted {photos['photos']} scan photos taken before {photos['cutoff']}")
    return 0


def cmd_serve(args) -> int:
    import uvicorn
    from .app import create_app
    settings = load_settings()
    print(f"employee app  {settings.base_url.rstrip('/')}/app/")
    print(f"dashboard     {settings.base_url.rstrip('/')}/admin/")
    uvicorn.run(create_app(settings), host=args.host, port=args.port, log_level=args.log_level)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dtr",
        description="Daily Time Record — QR clock-in with a server-authoritative clock.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init", help="create the database").set_defaults(func=cmd_init)

    seed_parser = subparsers.add_parser("seed", help="add demo people and a location")
    seed_parser.add_argument("--force", action="store_true", help="seed even if real scans exist")
    seed_parser.set_defaults(func=cmd_seed)

    admin_parser = subparsers.add_parser("admin", help="create an admin account")
    admin_parser.add_argument("employee_number")
    admin_parser.add_argument("full_name")
    admin_parser.add_argument("--password", help="prompted for if omitted")
    admin_parser.set_defaults(func=cmd_admin)

    poster_parser = subparsers.add_parser("poster", help="write a printable QR poster")
    poster_parser.add_argument("code", help="the location code, e.g. ABCD-EFGH-JKLM")
    poster_parser.add_argument("--out", help="output SVG path")
    poster_parser.set_defaults(func=cmd_poster)

    purge_parser = subparsers.add_parser("purge", help="delete records past the retention floor")
    purge_parser.add_argument("--yes", action="store_true")
    purge_parser.set_defaults(func=cmd_purge)

    serve_parser = subparsers.add_parser("serve", help="run the web app")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8000)
    serve_parser.add_argument("--log-level", default="info")
    serve_parser.set_defaults(func=cmd_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except DtrError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
