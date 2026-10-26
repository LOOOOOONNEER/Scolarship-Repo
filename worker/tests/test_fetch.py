"""Fetcher tests against a local HTTP server (no internet needed)."""

import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from scholarship_worker.fetch import FetchError, PoliteFetcher, check_url

PAGES = {
    "/robots.txt": (200, "text/plain", b"User-agent: *\nDisallow: /private/\n"),
    "/scholarships": (200, "text/html; charset=utf-8", b"<html><body><h1>Scholarships</h1></body></html>"),
    "/bulletin.pdf": (200, "application/pdf", b"%PDF-1.4 fake"),
    "/private/page": (200, "text/html", b"secret"),
    "/video": (200, "video/mp4", b"..."),
    "/gone": (404, "text/html", b"not found"),
    "/busy": (503, "text/html", b"try later"),
    "/redirect-out": (302, "text/html", b""),
}


class Handler(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        Handler.requests.append((self.path, dict(self.headers)))
        if self.path == "/scholarships" and self.headers.get("If-None-Match") == '"v1"':
            self.send_response(304)
            self.end_headers()
            return
        status, ctype, body = PAGES.get(self.path, (404, "text/html", b"no"))
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        if self.path == "/scholarships":
            self.send_header("ETag", '"v1"')
            self.send_header("Last-Modified", "Mon, 26 Oct 2026 00:00:00 GMT")
        if self.path == "/redirect-out":
            self.send_header("Location", "ftp://example.org/file")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class FetcherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Handler.requests.clear()
        self.sleeps = []
        self.fetcher = PoliteFetcher(
            user_agent="ScholarshipFinderBot/test (+admin@example.org)",
            per_host_delay_s=5,
            allow_private=True,
            sleep=self.sleeps.append,
        )

    def test_fetches_html_with_validators_and_user_agent(self):
        r = self.fetcher.fetch(self.base + "/scholarships")
        self.assertEqual(r.kind, "html")
        self.assertIn(b"Scholarships", r.body)
        self.assertEqual(r.etag, '"v1"')
        page_headers = [h for p, h in Handler.requests if p == "/scholarships"][0]
        self.assertIn("ScholarshipFinderBot", page_headers["User-Agent"])

    def test_conditional_get_returns_not_modified(self):
        r = self.fetcher.fetch(self.base + "/scholarships", etag='"v1"')
        self.assertTrue(r.not_modified)
        self.assertEqual(r.status, 304)

    def test_waits_between_requests_to_the_same_host(self):
        self.fetcher.fetch(self.base + "/scholarships")  # robots.txt then the page
        self.assertTrue(self.sleeps and all(s > 4 for s in self.sleeps), self.sleeps)

    def test_robots_txt_is_fetched_once_and_honored(self):
        with self.assertRaises(FetchError) as ctx:
            self.fetcher.fetch(self.base + "/private/page")
        self.assertEqual(ctx.exception.reason, "robots_disallowed")
        self.assertTrue(ctx.exception.permanent)
        self.fetcher.fetch(self.base + "/scholarships")
        self.assertEqual(sum(1 for p, _ in Handler.requests if p == "/robots.txt"), 1)
        self.assertFalse(any(p == "/private/page" for p, _ in Handler.requests))

    def test_pdf_is_accepted(self):
        self.assertEqual(self.fetcher.fetch(self.base + "/bulletin.pdf").kind, "pdf")

    def test_unsupported_type_is_refused(self):
        with self.assertRaises(FetchError) as ctx:
            self.fetcher.fetch(self.base + "/video")
        self.assertEqual(ctx.exception.reason, "content_type")

    def test_404_is_permanent_and_503_is_retryable(self):
        with self.assertRaises(FetchError) as ctx:
            self.fetcher.fetch(self.base + "/gone")
        self.assertTrue(ctx.exception.permanent)
        with self.assertRaises(FetchError) as ctx:
            self.fetcher.fetch(self.base + "/busy")
        self.assertFalse(ctx.exception.permanent)

    def test_redirect_to_unsupported_scheme_is_refused(self):
        with self.assertRaises(FetchError) as ctx:
            self.fetcher.fetch(self.base + "/redirect-out")
        self.assertEqual(ctx.exception.reason, "bad_url")


class UrlCheckTests(unittest.TestCase):
    def test_private_and_loopback_hosts_are_refused(self):
        for url in ("http://127.0.0.1/x", "http://localhost/x", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest"):
            with self.assertRaises(FetchError, msg=url) as ctx:
                check_url(url)
            self.assertEqual(ctx.exception.reason, "private_address")

    def test_bad_schemes_and_credentials_are_refused(self):
        for url in ("file:///etc/passwd", "ftp://example.org/", "javascript:alert(1)", "https://user:pw@example.org/"):
            with self.assertRaises(FetchError, msg=url):
                check_url(url)


if __name__ == "__main__":
    unittest.main()
