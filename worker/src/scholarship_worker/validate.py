"""Rule-based checks on what the language model extracted.

An evidence snippet proves the text exists, not that it was read correctly, so
every important value is checked by rules before a reviewer sees it:

- evidence must appear in the source text; a value without evidence is dropped
- dates are re-read from the evidence by dates.py and must agree with the model
- open/close order, "X to Y" ranges, academic-year consistency
- apply links: real URL, present on the page, on the provider's domain or flagged
- grade, income and province mentions become suggested rules, marked for review
- status wording sets a suggested application status

Nothing here publishes anything. It produces evidence rows, flags and a
confidence score for the review queue.
"""

from __future__ import annotations

import re
import unicodedata
import urllib.parse
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from typing import Any

from scholarship_worker.dates import find_dates, find_range

REGION3_PROVINCES = ["Aurora", "Bataan", "Bulacan", "Nueva Ecija", "Pampanga", "Tarlac", "Zambales"]
DATE_FIELDS = ("opens_on", "closes_on")
TEXT_FIELDS = ("program_name", "provider_name", "academic_year", "benefits", "status_text", "apply_url")


@dataclass
class FieldCheck:
    field_name: str
    extracted_value: str | None
    parsed_value: Any
    evidence_text: str | None
    evidence_found: bool
    validation_result: str  # pass | warn | fail
    validation_notes: str | None = None


@dataclass
class OfferingValidation:
    fields: list[FieldCheck]
    flags: list[str]
    normalized: dict[str, Any]
    suggested_status: str
    suggested_rules: list[dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0

    @property
    def blocking(self) -> bool:
        return any(f.validation_result == "fail" for f in self.fields)

    def to_payload(self) -> dict[str, Any]:
        return {
            "normalized": self.normalized,
            "suggested_status": self.suggested_status,
            "suggested_rules": self.suggested_rules,
            "flags": self.flags,
        }


# --------------------------------------------------------------------- helpers

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_QUOTES).replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip().lower()


def evidence_in_source(evidence: str | None, source_norm: str) -> bool:
    if not evidence or len(evidence.strip()) < 3:
        return False
    return _norm(evidence) in source_norm


def normalize_academic_year(value: str | None) -> str | None:
    if not value:
        return None
    m = re.search(r"(20\d{2})\s*[-–—/]\s*(20\d{2}|\d{2})\b", value)
    if not m:
        return None
    start = int(m.group(1))
    end_raw = m.group(2)
    end = int(end_raw) if len(end_raw) == 4 else (start // 100) * 100 + int(end_raw)
    if end != start + 1:
        return None
    return f"{start}-{end}"


def _host(url: str) -> str | None:
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return parts.hostname.lower()


def _on_domain(host: str, domains: list[str]) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains if d)


def _parse_iso(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


STATUS_WORDS = [
    ("suspended", re.compile(r"\b(suspend(?:ed)?|cancel(?:l)?ed|postponed|on hold|ipinagpaliban|kanselado)\b", re.I)),
    ("closed", re.compile(r"\b(closed|no longer accepting|deadline (?:has )?passed|sarado na|tapos na)\b", re.I)),
    ("upcoming", re.compile(r"\b(will open|opening soon|coming soon|to be announced|abangan)\b", re.I)),
    ("open", re.compile(r"\b(now open|open(?:s)? (?:until|from)|accepting|ongoing|extended|bukas na|tumatanggap)\b", re.I)),
]


def status_from_text(text: str | None) -> str | None:
    if not text:
        return None
    for status, pattern in STATUS_WORDS:
        if pattern.search(text):
            return status
    return None


# --------------------------------------------------------------------- suggested rules

_GRADE = re.compile(
    r"\b(?:gwa|general (?:weighted )?average|grade(?: point)? average|average grade|final grade)\b[^.\n]{0,40}?"
    r"(?P<num>\d{1,3}(?:\.\d{1,2})?)\s*(?P<pct>%)?",
    re.I,
)
_INCOME = re.compile(
    r"income[^.\n]{0,60}?(?:₱|php|p)\s?(?P<amt>\d{1,3}(?:,\d{3})+|\d{4,7})(?:\.\d{2})?",
    re.I,
)


def suggest_rules(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Structured rule suggestions from eligibility text. Always marked for review."""
    out: list[dict[str, Any]] = []
    for item in items:
        text = item.get("text") or ""
        for province in REGION3_PROVINCES:
            if re.search(rf"\b{re.escape(province)}\b", text, re.I) and re.search(r"resident|residing|nakatira|bona ?fide", text, re.I):
                out.append({"field": "residence_province_id", "operator": "eq", "province": province,
                            "description": text, "note": "province from the eligibility text"})
        m = _GRADE.search(text)
        if m:
            num = float(m.group("num"))
            if 1.0 <= num <= 5.0 and not m.group("pct"):
                out.append({"field": "grade", "operator": "lte", "value": num, "grade_scale": "ph_1_to_5",
                            "description": text, "note": "scale inferred from the number; confirm the school's scale"})
            elif 65 <= num <= 100:
                out.append({"field": "grade", "operator": "gte", "value": num, "grade_scale": "percent",
                            "description": text, "note": "scale inferred from the number; confirm the school's scale"})
        m = _INCOME.search(text)
        if m:
            amount = int(m.group("amt").replace(",", ""))
            out.append({"field": "income", "operator": "income_max_php", "value": amount, "description": text,
                        "note": "confirm whether the amount is annual or monthly household income"})
    return out


# --------------------------------------------------------------------- main entry

def validate_offering(
    extracted: dict[str, Any],
    *,
    source_text: str,
    source_url: str,
    retrieved_at: datetime,
    page_links: list[str] | None = None,
    provider_domains: list[str] | None = None,
    source_tier: int = 3,
) -> OfferingValidation:
    source_norm = _norm(source_text)
    checks: list[FieldCheck] = []
    flags: list[str] = []
    normalized: dict[str, Any] = {}
    today = retrieved_at.date()

    def item(name: str) -> tuple[Any, str | None]:
        raw = extracted.get(name) or {}
        if not isinstance(raw, dict):
            return None, None
        return raw.get("value"), raw.get("evidence")

    def add(name, value, parsed, evidence, found, result, notes=None):
        checks.append(FieldCheck(name, None if value is None else str(value), parsed, evidence, found, result, notes))
        if result == "fail":
            flags.append(f"{name}: {notes}")

    # -- plain text fields
    for name in ("program_name", "provider_name", "benefits", "status_text"):
        value, evidence = item(name)
        if value in (None, ""):
            continue
        found = evidence_in_source(evidence, source_norm)
        if found:
            normalized[name] = str(value).strip()
            add(name, value, value, evidence, True, "pass")
        else:
            add(name, value, None, evidence, False, "fail", "supporting text not found in the source; value dropped")

    # -- academic year
    value, evidence = item("academic_year")
    if value:
        found = evidence_in_source(evidence, source_norm)
        ay = normalize_academic_year(str(value))
        if not found:
            add("academic_year", value, None, evidence, False, "fail", "supporting text not found in the source; value dropped")
        elif ay is None:
            add("academic_year", value, None, evidence, True, "fail", "not a valid academic year such as 2026-2027")
        elif normalize_academic_year(evidence or "") not in (ay, None):
            add("academic_year", value, ay, evidence, True, "fail", "differs from the year written in the evidence")
        else:
            normalized["academic_year"] = ay
            add("academic_year", value, ay, evidence, True, "pass")

    # -- dates: the model's value must be re-found by the rule parser in its own evidence
    parsed_dates: dict[str, date] = {}
    for name in DATE_FIELDS:
        value, evidence = item(name)
        if not value:
            continue
        model_date = _parse_iso(value)
        found = evidence_in_source(evidence, source_norm)
        if model_date is None:
            add(name, value, None, evidence, found, "fail", "not a valid date")
            continue
        if not found:
            add(name, value, None, evidence, False, "fail", "supporting text not found in the source; value dropped")
            continue
        mentions = find_dates(evidence or "")
        exact = [m for m in mentions if m.to_date() == model_date]
        yearless = [m for m in mentions if m.year is None and (m.month, m.day) == (model_date.month, model_date.day)]
        if exact:
            notes = "written as an ambiguous numeric date; confirm the month" if any(m.ambiguous for m in exact) else None
            parsed_dates[name] = model_date
            add(name, value, model_date.isoformat(), evidence, True, "warn" if notes else "pass", notes)
        elif yearless:
            parsed_dates[name] = model_date
            add(name, value, model_date.isoformat(), evidence, True, "warn", "the source gives no year; the year was inferred")
        else:
            add(name, value, None, evidence, True, "fail",
                "the date in the evidence does not match the extracted date" if mentions else "no date found in the evidence")

    opens, closes = parsed_dates.get("opens_on"), parsed_dates.get("closes_on")

    # A shared "X to Y" evidence must have X as the opening and Y as the closing date.
    _, open_ev = item("opens_on")
    _, close_ev = item("closes_on")
    for ev in {open_ev, close_ev} - {None}:
        rng = find_range(ev)
        if rng and opens and closes:
            first, second = rng
            if (first.month, first.day) == (closes.month, closes.day) and (second.month, second.day) == (opens.month, opens.day):
                for name in DATE_FIELDS:
                    _fail_field(checks, flags, name, "opening and closing dates are swapped compared with the source")
                parsed_dates.clear()
                opens = closes = None
                break

    if opens and closes and opens > closes:
        for name in DATE_FIELDS:
            _fail_field(checks, flags, name, "opening date is after the closing date")
        opens = closes = None

    if opens:
        normalized["opens_on"] = opens.isoformat()
    if closes:
        normalized["closes_on"] = closes.isoformat()
        ay = normalized.get("academic_year")
        if ay:
            start = int(ay[:4])
            if not (start - 1 <= closes.year <= start + 1):
                flags.append(f"closes_on: {closes.isoformat()} is far from academic year {ay}")

    rolling_value, rolling_ev = item("rolling_admission")
    if rolling_value is True:
        if evidence_in_source(rolling_ev, source_norm):
            normalized["rolling_admission"] = True
            add("rolling_admission", True, True, rolling_ev, True, "pass")
        else:
            add("rolling_admission", True, None, rolling_ev, False, "fail", "supporting text not found in the source; value dropped")

    # -- apply link
    value, evidence = item("apply_url")
    if value:
        url = str(value).strip()
        host = _host(url)
        links = set(page_links or [])
        source_host = _host(source_url) or ""
        domains = [d.lower() for d in (provider_domains or [])] + [source_host]
        on_page = url in links or _norm(url) in source_norm
        if host is None:
            add("apply_url", value, None, evidence, on_page, "fail", "not a valid web address")
        elif not on_page:
            add("apply_url", value, None, evidence, False, "fail", "this link does not appear on the source page; value dropped")
        elif _on_domain(host, domains):
            normalized["apply_url"] = url
            add("apply_url", value, url, evidence, True, "pass")
        else:
            normalized["apply_url"] = url
            add("apply_url", value, url, evidence, True, "warn",
                f"link goes to {host}, not the provider's own site; confirm it is the official form")

    # -- eligibility and required documents
    eligibility: list[dict[str, Any]] = []
    raw_items = extracted.get("eligibility") or []
    for idx, raw in enumerate(raw_items if isinstance(raw_items, list) else []):
        if not isinstance(raw, dict) or not raw.get("text"):
            continue
        kind = raw.get("kind") if raw.get("kind") in ("criterion", "also_required") else "criterion"
        found = evidence_in_source(raw.get("evidence"), source_norm)
        name = f"eligibility[{idx}]"
        if found:
            eligibility.append({"text": str(raw["text"]).strip(), "kind": kind, "evidence": raw.get("evidence")})
            add(name, raw["text"], kind, raw.get("evidence"), True, "pass")
        else:
            add(name, raw["text"], None, raw.get("evidence"), False, "fail", "supporting text not found in the source; item dropped")
    normalized["eligibility"] = eligibility

    documents = []
    for raw in extracted.get("required_documents") or []:
        if isinstance(raw, dict) and raw.get("text") and evidence_in_source(raw.get("evidence"), source_norm):
            documents.append(str(raw["text"]).strip())
    normalized["required_documents"] = documents

    # -- suggested status: dates and wording, never "verified" (a reviewer does that)
    worded = status_from_text(normalized.get("status_text"))
    if worded == "suspended":
        suggested = "suspended"
    elif worded == "closed" or (closes and closes < today):
        suggested = "closed"
    elif opens and opens > today:
        suggested = "upcoming"
    elif worded == "upcoming":
        suggested = "upcoming"
    elif closes or normalized.get("rolling_admission") or worded == "open":
        suggested = "open_unconfirmed"
    else:
        suggested = "unknown"
    if closes and closes < today and worded == "open":
        flags.append("status: the page says open but the closing date has passed; check for an extension")

    # -- required for publishing
    if "program_name" not in normalized:
        flags.append("missing: program name")
    if "closes_on" not in normalized and not normalized.get("rolling_admission"):
        flags.append("missing: closing date (or rolling admission)")
    if "apply_url" not in normalized:
        flags.append("missing: official application link")

    rules = suggest_rules(eligibility)

    # -- confidence
    base = {1: 0.45, 2: 0.4, 3: 0.2, 4: 0.15}.get(source_tier, 0.15)
    source_host = _host(source_url) or ""
    official = source_host.endswith((".gov.ph", ".edu.ph")) or _on_domain(source_host, provider_domains or [])
    present = sum(1 for k in ("program_name", "apply_url") if k in normalized) + (
        1 if ("closes_on" in normalized or normalized.get("rolling_admission")) else 0
    )
    passed = sum(1 for c in checks if c.validation_result == "pass")
    failed = sum(1 for c in checks if c.validation_result == "fail")
    score = base + (0.1 if official else 0) + 0.05 * present + (0.25 * passed / len(checks) if checks else 0) - 0.1 * failed
    confidence = round(max(0.0, min(1.0, score)), 3)

    return OfferingValidation(
        fields=checks,
        flags=flags,
        normalized=normalized,
        suggested_status=suggested,
        suggested_rules=rules,
        confidence=confidence,
    )


def _fail_field(checks: list[FieldCheck], flags: list[str], name: str, note: str) -> None:
    for c in checks:
        if c.field_name == name:
            c.validation_result = "fail"
            c.parsed_value = None
            c.validation_notes = note
    flags.append(f"{name}: {note}")


def checks_as_rows(checks: list[FieldCheck]) -> list[dict[str, Any]]:
    return [asdict(c) for c in checks]
