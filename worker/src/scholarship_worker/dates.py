"""Rule-based date finder for English and Filipino announcements.

Used to check the language model: a date the model extracted must also be
found by these rules in the evidence text it quoted.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

MONTHS = {
    # English
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4, "apr": 4,
    "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9, "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
    # Filipino
    "enero": 1, "pebrero": 2, "marso": 3, "abril": 4, "mayo": 5, "hunyo": 6, "hulyo": 7,
    "agosto": 8, "setyembre": 9, "septiyembre": 9, "oktubre": 10, "nobyembre": 11, "disyembre": 12,
}
_MONTH = r"(?P<{name}>" + "|".join(sorted(MONTHS, key=len, reverse=True)) + r")\.?"
_DAY = r"(?P<{name}>[0-3]?\d)(?:st|nd|rd|th)?"
_YEAR = r"(?P<{name}>20\d{{2}})"


def _p(template: str, **names: str) -> str:
    out = template
    for key, kind in names.items():
        part = {"m": _MONTH, "d": _DAY, "y": _YEAR}[kind].replace("{name}", key)
        if kind == "y":
            part = part.replace("{{", "{").replace("}}", "}")
        out = out.replace("{" + key + "}", part)
    return out


# Order matters: longer forms first so "November 1-30, 2026" is not read as two partial dates.
PATTERNS = [
    ("month_day_day_year", re.compile(_p(r"\b{m1}\s+{d1}\s*[-–—]\s*{d2},?\s+{y1}\b", m1="m", d1="d", d2="d", y1="y"), re.I)),
    ("month_day_year", re.compile(_p(r"\b{m1}\s+{d1},?\s+{y1}\b", m1="m", d1="d", y1="y"), re.I)),
    ("day_month_year", re.compile(_p(r"\b{d1}\s+(?:ng\s+)?{m1},?\s+{y1}\b", d1="d", m1="m", y1="y"), re.I)),
    ("iso", re.compile(r"\b(?P<y1>20\d{2})-(?P<mo>[01]?\d)-(?P<d1>[0-3]?\d)\b")),
    ("slash", re.compile(r"\b(?P<a>[01]?\d)/(?P<b>[0-3]?\d)/(?P<y1>20\d{2})\b")),
    ("month_day", re.compile(_p(r"\b{m1}\s+{d1}\b(?!\s*,?\s*20\d{{2}})".replace("{{2}}", "{2}"), m1="m", d1="d"), re.I)),
]


@dataclass(frozen=True)
class DateMention:
    month: int
    day: int
    year: int | None  # None when the text gives no year
    start: int
    end: int
    ambiguous: bool = False  # e.g. 03/04/2027 could be March 4 or April 3

    def to_date(self) -> date | None:
        if self.year is None:
            return None
        try:
            return date(self.year, self.month, self.day)
        except ValueError:
            return None


def _valid(year: int | None, month: int, day: int) -> bool:
    try:
        date(year or 2024, month, day)  # 2024 is a leap year, so Feb 29 without a year passes
        return True
    except ValueError:
        return False


def find_dates(text: str) -> list[DateMention]:
    found: list[DateMention] = []
    taken: list[tuple[int, int]] = []

    def free(a: int, b: int) -> bool:
        return all(b <= s or a >= e for s, e in taken)

    for kind, pattern in PATTERNS:
        for m in pattern.finditer(text):
            if not free(m.start(), m.end()):
                continue
            g = m.groupdict()
            mentions: list[DateMention] = []
            if kind == "month_day_day_year":
                month, year = MONTHS[g["m1"].lower()], int(g["y1"])
                d1, d2 = int(g["d1"]), int(g["d2"])
                split = m.start() + m.group(0).index("-") if "-" in m.group(0) else m.end()
                if _valid(year, month, d1) and _valid(year, month, d2):
                    mentions = [
                        DateMention(month, d1, year, m.start(), split),
                        DateMention(month, d2, year, split, m.end()),
                    ]
            elif kind in ("month_day_year", "day_month_year"):
                month, day, year = MONTHS[g["m1"].lower()], int(g["d1"]), int(g["y1"])
                if _valid(year, month, day):
                    mentions = [DateMention(month, day, year, m.start(), m.end())]
            elif kind == "iso":
                year, month, day = int(g["y1"]), int(g["mo"]), int(g["d1"])
                if _valid(year, month, day):
                    mentions = [DateMention(month, day, year, m.start(), m.end())]
            elif kind == "slash":
                # Philippine usage is month first; flag it when the other reading is also a real date.
                a, b, year = int(g["a"]), int(g["b"]), int(g["y1"])
                if _valid(year, a, b):
                    mentions = [DateMention(a, b, year, m.start(), m.end(), ambiguous=(a != b and a <= 12 and b <= 12))]
            elif kind == "month_day":
                month, day = MONTHS[g["m1"].lower()], int(g["d1"])
                if g["m1"].lower() == "may" and not re.match(r"may\s+\d", m.group(0), re.I):
                    continue
                if _valid(None, month, day):
                    mentions = [DateMention(month, day, None, m.start(), m.end())]
            if mentions:
                found.extend(mentions)
                taken.append((m.start(), m.end()))

    return sorted(found, key=lambda d: d.start)


_RANGE_LINK = re.compile(r"^\s*(?:,\s*)?(?:to|until|till|through|thru|up to|[-–—]|hanggang(?:\s+sa)?)\s*$", re.I)


def find_range(text: str) -> tuple[DateMention, DateMention] | None:
    """The first 'X to Y' pair in the text, in the order written."""
    mentions = find_dates(text)
    for first, second in zip(mentions, mentions[1:]):
        between = text[first.end:second.start]
        if first.end == second.start or _RANGE_LINK.match(between):
            return first, second
    return None
