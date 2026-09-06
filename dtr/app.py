"""FastAPI application factory."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import DtrError, __version__, auth, db, live
from .api import deps, routes_admin, routes_auth, routes_employee
from .config import Settings, load_settings

WEB_ROOT = Path(__file__).resolve().parent / "web"

# Everything the pages need is served from this origin, so the policy can be
# strict. No CDN, no inline event handlers, no eval.
CSP = (
    "default-src 'self'; "
    "img-src 'self' data: blob:; "
    "media-src 'self' blob:; "
    "style-src 'self'; "
    "script-src 'self'; "
    "connect-src 'self' ws: wss:; "
    "frame-ancestors 'none'; "
    "base-uri 'none'; "
    "form-action 'self'"
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        connection = db.connect(settings.db_path)
        db.init_db(connection)
        connection.close()
        application.state.settings = settings
        application.state.db = deps.Database(settings.db_path)
        application.state.hub = live.Hub()
        yield
        application.state.db.close()

    app = FastAPI(
        title="DTR",
        version=__version__,
        description="QR clock-in with a server-authoritative clock.",
        lifespan=lifespan,
    )
    app.state.settings = settings

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("Content-Security-Policy", CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Permissions-Policy", "geolocation=(self), camera=(self)")
        if settings.base_url.startswith("https://"):
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    @app.exception_handler(DtrError)
    async def domain_error(request: Request, exc: DtrError):
        error = deps.http_error(exc)
        return JSONResponse({"detail": error.detail}, status_code=error.status_code)

    app.include_router(routes_auth.router)
    app.include_router(routes_employee.router)
    app.include_router(routes_admin.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "version": __version__, "timezone": settings.timezone}

    @app.get("/api/config")
    def public_config() -> dict:
        """What the front-ends need before anyone signs in."""
        return {
            "organisation": settings.organisation,
            "timezone": settings.timezone,
            "photo_capture_available": settings.photo_capture_available,
            "consent_version": settings.consent_version,
            "max_gps_accuracy_m": settings.max_gps_accuracy_m,
        }

    @app.websocket("/api/ws/board")
    async def board_socket(websocket: WebSocket) -> None:
        """Live dashboard feed.

        Authenticated by the admin cookie like every other dashboard route — a
        PWA session cannot open it. Clients that cannot hold a socket poll
        /api/admin/board instead and see exactly the same payload.
        """
        connection = websocket.app.state.db.conn
        try:
            viewer, scope = auth.resolve(connection, websocket.cookies.get(deps.ADMIN_COOKIE))
            if scope != auth.ADMIN:
                raise DtrError("wrong session")
            auth.require_role(viewer, "supervisor")
        except DtrError:
            await websocket.close(code=4401)
            return

        await websocket.accept()
        hub: live.Hub = websocket.app.state.hub
        await hub.join(websocket)
        scoped = auth.visible_employee_ids(connection, viewer)
        try:
            await websocket.send_json({
                "type": "board",
                "board": live.build_board(connection, settings.tz, employee_ids=scoped),
            })
            while True:
                # Any inbound message is a refresh request; a ping keeps proxies
                # from closing an idle socket.
                await websocket.receive_text()
                await websocket.send_json({
                    "type": "board",
                    "board": live.build_board(connection, settings.tz, employee_ids=scoped),
                })
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            await hub.leave(websocket)

    @app.get("/")
    def root() -> RedirectResponse:
        return RedirectResponse("/app/")

    @app.get("/app/")
    @app.get("/app")
    def employee_app() -> FileResponse:
        return FileResponse(WEB_ROOT / "app" / "index.html")

    @app.get("/admin/")
    @app.get("/admin")
    def admin_app() -> FileResponse:
        return FileResponse(WEB_ROOT / "admin" / "index.html")

    @app.get("/manifest.webmanifest")
    def manifest() -> FileResponse:
        return FileResponse(WEB_ROOT / "app" / "manifest.webmanifest",
                            media_type="application/manifest+json")

    @app.get("/sw.js")
    def service_worker() -> FileResponse:
        # Served from the root so its scope covers the whole origin.
        return FileResponse(WEB_ROOT / "app" / "sw.js", media_type="text/javascript")

    app.mount("/static", StaticFiles(directory=WEB_ROOT), name="static")
    return app


app = None  # populated by `python -m dtr serve`
