"""Logging that cannot leak secrets or personal data.

The worker never handles student data, but scraped pages contain names, phone
numbers and email addresses of provider staff, and connection strings contain
passwords. Every log record passes through RedactingFilter.
"""

from __future__ import annotations

import logging
import re
import sys

_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # passwords inside connection strings: postgresql://user:secret@host
    (re.compile(r"(postgres(?:ql)?://[^:/\s]+:)[^@\s]+(@)"), r"\1[redacted]\2"),
    (re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*\S+"), r"\1=[redacted]"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[email]"),
    # Philippine mobile numbers: 09xx xxx xxxx, +63 9xx xxx xxxx
    (re.compile(r"(?:\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b"), "[phone]"),
    # any other long digit run (IDs, account numbers)
    (re.compile(r"\b\d{10,}\b"), "[number]"),
]


def redact(text: str) -> str:
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        record.msg = redact(message)
        record.args = ()
        if record.exc_info and not record.exc_text:
            record.exc_text = redact(logging.Formatter().formatException(record.exc_info))
            record.exc_info = None
        elif record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(RedactingFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
