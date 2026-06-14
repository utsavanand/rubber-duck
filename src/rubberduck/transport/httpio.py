"""HTTP/1.1 wire primitives for the server: parse a request line and headers,
read a body, and write text/JSON/SSE/file responses over an asyncio stream.

Split out of server.py so the routing and handler logic isn't interleaved with
byte-level framing. Stateless functions — no dependency on the Server instance.
"""

import asyncio
import json
from pathlib import Path
from typing import Any

from rubberduck.core.eventbus import Event

SELF_PROBE_HEADER = "X-Rubberduck"
KEEPALIVE_SECONDS = 15

_REASON = {
    200: "OK",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    500: "Internal Server Error",
}

_CONTENT_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ico": "image/x-icon",
}


def parse_request_line(line: bytes) -> tuple[str, str]:
    """Return (method, path) from a request line, or ('', '') if malformed."""
    parts = line.decode("latin-1").split()
    if len(parts) < 2:
        return "", ""
    return parts[0], parts[1]


async def read_headers(reader: asyncio.StreamReader) -> dict[str, str]:
    """Read headers up to the blank line. Names are lower-cased for lookup."""
    headers: dict[str, str] = {}
    while True:
        line = await reader.readline()
        if line in (b"\r\n", b"\n", b""):
            break
        name, _, value = line.decode("latin-1").partition(":")
        headers[name.strip().lower()] = value.strip()
    return headers


async def read_body(reader: asyncio.StreamReader, headers: dict[str, str]) -> bytes:
    """Read exactly Content-Length bytes (empty when absent or zero)."""
    length = int(headers.get("content-length", "0") or "0")
    return await reader.readexactly(length) if length else b""


def sse_frame(event: Event) -> bytes:
    return f"data: {json.dumps(event)}\n\n".encode()


def write_sse(writer: asyncio.StreamWriter, event: Event) -> None:
    writer.write(sse_frame(event))


async def write_response(
    writer: asyncio.StreamWriter,
    status: int,
    text: str,
    extra_headers: dict[str, str] | None = None,
    content_type: str = "text/plain",
) -> None:
    body = text.encode()
    head = f"HTTP/1.1 {status} {_REASON.get(status, 'OK')}\r\n"
    head += f"Content-Length: {len(body)}\r\nContent-Type: {content_type}\r\n"
    for name, value in (extra_headers or {}).items():
        head += f"{name}: {value}\r\n"
    head += "Connection: close\r\n\r\n"
    writer.write(head.encode() + body)
    await writer.drain()


async def write_json(writer: asyncio.StreamWriter, status: int, payload: Any) -> None:
    body = json.dumps(payload).encode()
    head = (
        f"HTTP/1.1 {status} {_REASON.get(status, 'OK')}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Content-Type: application/json\r\n"
        "Connection: close\r\n\r\n"
    )
    writer.write(head.encode() + body)
    await writer.drain()


async def write_file(writer: asyncio.StreamWriter, path: Path) -> None:
    body = path.read_bytes()
    ctype = _CONTENT_TYPES.get(path.suffix, "application/octet-stream")
    # index.html must always be revalidated, else browsers serve a stale HTML
    # that points at an old bundle hash and never picks up new builds. The
    # content-hashed assets under /assets/ are immutable — cache them hard.
    cache = "no-cache" if path.suffix == ".html" else "public, max-age=31536000, immutable"
    head = (
        f"HTTP/1.1 200 OK\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Content-Type: {ctype}\r\n"
        f"Cache-Control: {cache}\r\n"
        f"{SELF_PROBE_HEADER}: 1\r\n"
        "Connection: close\r\n\r\n"
    )
    writer.write(head.encode() + body)
    await writer.drain()


def dashboard_dir() -> Path | None:
    """Locate the built dashboard. Prefer the copy bundled in the installed
    package (src/rubberduck/dashboard); fall back to the dev build at web/dist
    so a repo checkout serves the freshly-built UI.

    This file lives at src/rubberduck/transport/httpio.py, so the package root
    is two parents up and the repo root is four."""
    pkg_root = Path(__file__).resolve().parents[1]  # src/rubberduck/
    packaged = pkg_root / "dashboard"
    if (packaged / "index.html").is_file():
        return packaged
    dev = pkg_root.parents[1] / "web" / "dist"  # repo/web/dist
    return dev if (dev / "index.html").is_file() else None
