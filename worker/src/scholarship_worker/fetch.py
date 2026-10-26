"""Polite HTTP fetching.

Rules from the technical plan:
- honor robots.txt (5xx or unreachable robots.txt = do not crawl, like major search engines)
- identify the bot with a contact address (Settings.user_agent)
- at least `per_host_delay_s` seconds between requests to the same host
- conditional GET with ETag / Last-Modified so unchanged pages cost almost nothing
- refuse private, loopback and link-local addresses (submitted links are untrusted)
- cap download size and accept only the content types the pipeline can read
"""

from __future__ import annotations

import ipaddress
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, field
from typing import Callable

ALLOWED_TYPES = {
    "text/html": "html",
    "application/xhtml+xml": "html",
    "text/plain": "text",
    "application/pdf": "pdf",
    "image/png": "image",
    "image/jpeg": "image",
}
MAX_BYTES = 15 * 1024 * 1024
TIMEOUT_S = 30


class FetchError(Exception):
    """A fetch that did not produce a document.

    permanent=True means retrying will not help (404, robots disallow, bad URL);
    otherwise the pipeline retries with backoff.
    """

    def __init__(self, message: str, *, permanent: bool, status: int | None = None, reason: str = "error"):
        super().__init__(message)
        self.permanent = permanent
        self.status = status
        self.reason = reason


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int
    not_modified: bool = False
    content_type: str | None = None
    kind: str | None = None  # html | text | pdf | image
    body: bytes = b""
    etag: str | None = None
    last_modified: str | None = None


def _is_public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        addr = ipaddress.ip_address(info[4][0].split("%")[0])
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        ):
            return False
    return True


def check_url(url: str, *, allow_private: bool = False) -> urllib.parse.SplitResult:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise FetchError(f"unsupported URL scheme: {parts.scheme or 'none'}", permanent=True, reason="bad_url")
    if not parts.hostname:
        raise FetchError("URL has no host", permanent=True, reason="bad_url")
    if parts.username or parts.password:
        raise FetchError("URLs with credentials are not fetched", permanent=True, reason="bad_url")
    if not allow_private and not _is_public_host(parts.hostname):
        raise FetchError("host is not a public internet address", permanent=True, reason="private_address")
    return parts


class _SafeRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, allow_private: bool):
        super().__init__()
        self.allow_private = allow_private

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl, allow_private=self.allow_private)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@dataclass
class PoliteFetcher:
    user_agent: str
    per_host_delay_s: float = 5.0
    allow_private: bool = False  # tests only
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    _last_request: dict[str, float] = field(default_factory=dict)
    _robots: dict[str, urllib.robotparser.RobotFileParser | None] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._opener = urllib.request.build_opener(_SafeRedirects(self.allow_private))

    # ------------------------------------------------------------- internals

    def _wait_turn(self, host: str) -> None:
        last = self._last_request.get(host)
        if last is not None:
            remaining = self.per_host_delay_s - (self.clock() - last)
            if remaining > 0:
                self.sleep(remaining)
        self._last_request[host] = self.clock()

    def _request(self, url: str, headers: dict[str, str]):
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, **headers})
        return self._opener.open(req, timeout=TIMEOUT_S)

    def _robots_for(self, parts: urllib.parse.SplitResult) -> urllib.robotparser.RobotFileParser | None:
        """Returns a parser, or None when the whole host must not be crawled."""
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin in self._robots:
            return self._robots[origin]

        parser = urllib.robotparser.RobotFileParser()
        robots_url = origin + "/robots.txt"
        self._wait_turn(parts.netloc)
        try:
            with self._request(robots_url, {"Accept": "text/plain"}) as resp:
                text = resp.read(512 * 1024).decode("utf-8", errors="replace")
            parser.parse(text.splitlines())
        except urllib.error.HTTPError as exc:
            exc.close()
            if exc.code in (401, 403):
                parser = None
            elif 400 <= exc.code < 500:
                parser.parse([])  # no robots.txt: everything allowed
            else:
                parser = None
        except (urllib.error.URLError, OSError, ValueError):
            parser = None
        self._robots[origin] = parser
        return parser

    # ------------------------------------------------------------- public

    def allowed(self, url: str) -> bool:
        parts = check_url(url, allow_private=self.allow_private)
        robots = self._robots_for(parts)
        return robots is not None and robots.can_fetch(self.user_agent, url)

    def fetch(self, url: str, *, etag: str | None = None, last_modified: str | None = None) -> FetchResult:
        parts = check_url(url, allow_private=self.allow_private)
        robots = self._robots_for(parts)
        if robots is None:
            raise FetchError("robots.txt could not be read or forbids all access", permanent=False, reason="robots_unavailable")
        if not robots.can_fetch(self.user_agent, url):
            raise FetchError("robots.txt disallows this page", permanent=True, reason="robots_disallowed")

        headers = {"Accept": "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.8,image/*;q=0.5"}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

        self._wait_turn(parts.netloc)
        try:
            resp = self._request(url, headers)
        except urllib.error.HTTPError as exc:
            exc.close()
            if exc.code == 304:
                return FetchResult(url=url, final_url=url, status=304, not_modified=True, etag=etag, last_modified=last_modified)
            permanent = exc.code in (400, 401, 403, 404, 410, 451)
            raise FetchError(f"HTTP {exc.code}", permanent=permanent, status=exc.code, reason="http_error") from None
        except FetchError:
            raise
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise FetchError(f"network error: {exc}", permanent=False, reason="network") from None

        with resp:
            raw_type = resp.headers.get_content_type()
            kind = ALLOWED_TYPES.get(raw_type)
            if kind is None:
                raise FetchError(f"unsupported content type {raw_type}", permanent=True, status=resp.status, reason="content_type")
            length = resp.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > MAX_BYTES:
                raise FetchError("document is too large", permanent=True, status=resp.status, reason="too_large")
            body = resp.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise FetchError("document is too large", permanent=True, status=resp.status, reason="too_large")
            return FetchResult(
                url=url,
                final_url=resp.geturl(),
                status=resp.status,
                content_type=raw_type,
                kind=kind,
                body=body,
                etag=resp.headers.get("ETag"),
                last_modified=resp.headers.get("Last-Modified"),
            )
