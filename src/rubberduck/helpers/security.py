"""Request-gating for the local server.

The server binds 127.0.0.1, which keeps it off the network but does NOT protect
it from the browser: any web page the user visits can issue cross-origin
requests to http://127.0.0.1:4200. The browser blocks the attacker from reading
the *responses* (no CORS headers are sent), but a "simple" cross-origin POST
still reaches the handler — so a malicious tab could drive command-executing
endpoints blind. This module closes that hole with two cheap checks:

  1. Origin/Referer: reject any cross-origin request outright.
  2. A per-install secret token, generated on first run and stored 0600 under
     ~/.rubberduck, required on every state-changing request. A blind CSRF
     cannot read the token, so it cannot forge the header.

Plus input validators for values that flow into shells, file paths, and
AppleScript.
"""

import re
import secrets
from pathlib import Path

from rubberduck.helpers import paths

TOKEN_HEADER = "x-rubberduck-token"

# Origins the dashboard is actually served from. A request whose Origin/Referer
# is none of these is cross-origin and refused.
_ALLOWED_ORIGINS = frozenset(
    f"http://{host}:{port}"
    for host in ("127.0.0.1", "localhost")
    for port in ("4200",)
)

# session_key flows into shell strings (heartbeat) and DB rows. Constrain it to
# characters that are inert in a shell and a path.
_SESSION_KEY_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
# A tty reported by a tab is injected into AppleScript; it has a fixed shape.
_TTY_RE = re.compile(r"^/dev/tty[a-z0-9]+$")
# Snapshot ids are server-minted as snap-<digits>; nothing else is valid.
_SNAPSHOT_ID_RE = re.compile(r"^snap-[0-9]+$")


def valid_session_key(key: str | None) -> bool:
    return bool(key) and _SESSION_KEY_RE.match(key or "") is not None


def valid_tty(tty: str | None) -> bool:
    return bool(tty) and _TTY_RE.match(tty or "") is not None


def valid_snapshot_id(snapshot_id: str | None) -> bool:
    return bool(snapshot_id) and _SNAPSHOT_ID_RE.match(snapshot_id or "") is not None


def new_session_key(prefix: str) -> str:
    """An unguessable session key, so the input/attach endpoints can't be
    targeted by guessing a key like `new-<timestamp>`."""
    return f"{prefix}-{secrets.token_hex(8)}"


def origin_allowed(headers: dict[str, str]) -> bool:
    """True unless the request carries a cross-origin Origin/Referer. Same-origin
    requests (and tools like curl) send no Origin, so they pass; a browser on
    another site always sends one, so it's caught."""
    origin = headers.get("origin")
    if origin is not None:
        return origin in _ALLOWED_ORIGINS
    referer = headers.get("referer")
    if referer is not None:
        return any(referer.startswith(o + "/") or referer == o for o in _ALLOWED_ORIGINS)
    return True


def load_or_create_token() -> str:
    """The per-install secret, created on first run and persisted 0600. Shared
    with the dashboard (injected into its HTML) and the hook script (via env)."""
    path = _token_path()
    if path.exists():
        return path.read_text().strip()
    token = secrets.token_urlsafe(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token)
    path.chmod(0o600)
    return token


def token_valid(headers: dict[str, str], token: str) -> bool:
    return secrets.compare_digest(headers.get(TOKEN_HEADER, ""), token)


def _token_path() -> Path:
    return paths.home() / "token"
