import logging
import unittest

from scholarship_worker.logsafe import RedactingFilter, redact


class RedactTests(unittest.TestCase):
    def test_connection_string_password(self):
        out = redact("connecting to postgresql://discovery_worker.abc:s3cr3t@db.example.com:5432/postgres")
        self.assertNotIn("s3cr3t", out)
        self.assertIn("postgresql://discovery_worker.abc:[redacted]@db.example.com", out)

    def test_key_value_secrets(self):
        out = redact("api_key=AIzaSyFAKE token: abc123 password=hunter2")
        for secret in ("AIzaSyFAKE", "abc123", "hunter2"):
            self.assertNotIn(secret, out)

    def test_email(self):
        self.assertEqual(redact("contact scholarship.office@example.gov.ph today"), "contact [email] today")

    def test_ph_mobile_numbers(self):
        for number in ("09171234567", "0917 123 4567", "+63 917 123 4567".replace(" ", "", 1), "+639171234567"):
            self.assertNotIn("1234567", redact(f"call {number}"), number)

    def test_long_digit_runs(self):
        self.assertEqual(redact("ref 123456789012"), "ref [number]")

    def test_keeps_ordinary_text(self):
        text = "heartbeat: 12 active sources, 3 stale, closes 2027-03-31"
        self.assertEqual(redact(text), text)


class FilterTests(unittest.TestCase):
    def test_filter_redacts_formatted_args(self):
        record = logging.LogRecord("t", logging.INFO, __file__, 1, "fetched %s from %s", ("a page", "x@y.org"), None)
        RedactingFilter().filter(record)
        self.assertEqual(record.getMessage(), "fetched a page from [email]")

    def test_filter_redacts_exceptions(self):
        try:
            raise ValueError("bad password=hunter2")
        except ValueError:
            import sys

            record = logging.LogRecord("t", logging.ERROR, __file__, 1, "failed", (), sys.exc_info())
        RedactingFilter().filter(record)
        self.assertNotIn("hunter2", record.exc_text)


if __name__ == "__main__":
    unittest.main()
