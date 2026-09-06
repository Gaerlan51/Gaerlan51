#!/usr/bin/env python3
"""Generate the PWA icons.

Pure standard library — no Pillow, no design tool, no binary blob committed
without a way to regenerate it. Run from the repo root:

    python3 scripts/make-dtr-icons.py
"""

from __future__ import annotations

import struct
import zlib
from math import atan2, cos, pi, sin, sqrt
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "dtr" / "web" / "app" / "icons"

BLUE = (29, 78, 216)
WHITE = (255, 255, 255)
DEEP = (12, 21, 48)


def write_png(path: Path, size: int, pixels: list[list[tuple[int, int, int]]]) -> None:
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def blend(under, over, alpha: float):
    return tuple(round(u + (o - u) * max(0.0, min(1.0, alpha))) for u, o in zip(under, over))


def render(size: int, *, maskable: bool) -> list[list[tuple[int, int, int]]]:
    """A clock face on a rounded square: a dial, a tick ring, and two hands."""
    centre = (size - 1) / 2
    # Maskable icons lose their corners to the platform's mask, so shrink the art.
    art = size * (0.62 if maskable else 0.78)
    corner = size * 0.22
    dial = art / 2
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            # Rounded-square background.
            dx = max(abs(x - centre) - (size / 2 - corner), 0)
            dy = max(abs(y - centre) - (size / 2 - corner), 0)
            edge = corner - sqrt(dx * dx + dy * dy)
            colour = blend(DEEP, BLUE, edge) if maskable else BLUE
            if edge < 0:
                row.append(DEEP if maskable else DEEP)
                continue

            r = sqrt((x - centre) ** 2 + (y - centre) ** 2)
            if r <= dial:
                colour = blend(colour, WHITE, (dial - r) * 1.5)
                # Tick ring just inside the rim.
                ring = dial * 0.86
                if abs(r - ring) < dial * 0.055:
                    angle = atan2(y - centre, x - centre)
                    if (angle % (pi / 6)) < 0.16:
                        colour = blend(colour, BLUE, 1.0)
                # Hands at 10:10, the way every clock is photographed.
                # Screen angles: y grows downward, so -pi/2 points at twelve.
                minute_hand = -pi / 2 + pi / 3      # pointing at two
                hour_hand = -pi / 2 - pi / 3        # pointing at ten
                for length, thickness, hand in ((0.62, 0.042, minute_hand), (0.45, 0.058, hour_hand)):
                    hx, hy = cos(hand), sin(hand)
                    along = (x - centre) * hx + (y - centre) * hy
                    across = abs(-(x - centre) * hy + (y - centre) * hx)
                    if 0 <= along <= dial * length and across <= dial * thickness:
                        colour = blend(colour, BLUE, 1.0)
                if r < dial * 0.075:
                    colour = BLUE
            row.append(colour)
        rows.append(row)
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size, maskable, name in ((192, False, "icon-192.png"),
                                 (512, False, "icon-512.png"),
                                 (512, True, "icon-512-maskable.png")):
        write_png(OUT / name, size, render(size, maskable=maskable))
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
