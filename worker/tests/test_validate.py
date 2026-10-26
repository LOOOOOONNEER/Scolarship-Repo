import unittest
from datetime import datetime, timezone

from scholarship_worker.validate import normalize_academic_year, status_from_text, suggest_rules, validate_offering

SOURCE = """Provincial Scholarship Program, Academic Year 2026-2027
The Provincial Government of Tarlac announces the Provincial Scholarship Program.
Applications are open from November 1, 2026 to November 30, 2026.
Benefits: PHP 10,000 per semester for tuition and books.
Qualifications:
Bona fide resident of Tarlac for at least 3 years
General weighted average of 2.00 or better
Combined annual household income not exceeding PHP 250,000
Applicants will undergo an interview.
Apply online at https://scholarship.tarlac.example.gov.ph/apply
Requirements: Certificate of Residency, Report Card"""
URL = "https://tarlac.example.gov.ph/news/scholarship"
RETRIEVED = datetime(2026, 11, 10, 2, 0, tzinfo=timezone.utc)
LINKS = ["https://scholarship.tarlac.example.gov.ph/apply", "https://forms.gle/abc123"]


def ev(value, evidence):
    return {"value": value, "evidence": evidence}


def good_extraction(**overrides):
    data = {
        "program_name": ev("Provincial Scholarship Program", "Provincial Scholarship Program"),
        "provider_name": ev("Provincial Government of Tarlac", "The Provincial Government of Tarlac announces"),
        "academic_year": ev("2026-2027", "Academic Year 2026-2027"),
        "opens_on": ev("2026-11-01", "Applications are open from November 1, 2026 to November 30, 2026."),
        "closes_on": ev("2026-11-30", "Applications are open from November 1, 2026 to November 30, 2026."),
        "rolling_admission": ev(None, None),
        "status_text": ev(None, None),
        "benefits": ev("PHP 10,000 per semester", "Benefits: PHP 10,000 per semester for tuition and books."),
        "apply_url": ev("https://scholarship.tarlac.example.gov.ph/apply", "Apply online at https://scholarship.tarlac.example.gov.ph/apply"),
        "eligibility": [
            {"text": "Bona fide resident of Tarlac for at least 3 years", "kind": "criterion",
             "evidence": "Bona fide resident of Tarlac for at least 3 years"},
            {"text": "GWA of 2.00 or better", "kind": "criterion", "evidence": "General weighted average of 2.00 or better"},
            {"text": "Household income not exceeding PHP 250,000", "kind": "criterion",
             "evidence": "Combined annual household income not exceeding PHP 250,000"},
            {"text": "Interview", "kind": "also_required", "evidence": "Applicants will undergo an interview."},
        ],
        "required_documents": [{"text": "Certificate of Residency", "evidence": "Certificate of Residency"}],
    }
    data.update(overrides)
    return data


def run(data, **kw):
    return validate_offering(data, source_text=SOURCE, source_url=URL, retrieved_at=RETRIEVED,
                             page_links=LINKS, source_tier=1, **kw)


def result_of(v, name):
    return next(c for c in v.fields if c.field_name == name)


class ValidateTests(unittest.TestCase):
    def test_clean_extraction_passes(self):
        v = run(good_extraction())
        self.assertFalse(v.blocking, v.flags)
        self.assertEqual(v.normalized["opens_on"], "2026-11-01")
        self.assertEqual(v.normalized["closes_on"], "2026-11-30")
        self.assertEqual(v.normalized["academic_year"], "2026-2027")
        self.assertEqual(v.suggested_status, "open_unconfirmed")  # a reviewer verifies before it is "open, verified"
        self.assertGreater(v.confidence, 0.7)
        self.assertEqual(len(v.normalized["eligibility"]), 4)

    def test_swapped_dates_with_correct_evidence_are_caught(self):
        v = run(good_extraction(
            opens_on=ev("2026-11-30", "Applications are open from November 1, 2026 to November 30, 2026."),
            closes_on=ev("2026-11-01", "Applications are open from November 1, 2026 to November 30, 2026."),
        ))
        self.assertTrue(v.blocking)
        self.assertNotIn("opens_on", v.normalized)
        self.assertNotIn("closes_on", v.normalized)
        self.assertIn("swapped", result_of(v, "closes_on").validation_notes)

    def test_date_that_disagrees_with_its_evidence_fails(self):
        v = run(good_extraction(closes_on=ev("2026-12-15", "Applications are open from November 1, 2026 to November 30, 2026.")))
        self.assertEqual(result_of(v, "closes_on").validation_result, "fail")
        self.assertNotIn("closes_on", v.normalized)
        self.assertIn("missing: closing date (or rolling admission)", v.flags)

    def test_invented_evidence_is_dropped(self):
        v = run(good_extraction(benefits=ev("PHP 50,000 per year", "Benefits: PHP 50,000 per year")))
        self.assertEqual(result_of(v, "benefits").validation_result, "fail")
        self.assertNotIn("benefits", v.normalized)

    def test_apply_link_must_be_on_the_page(self):
        v = run(good_extraction(apply_url=ev("https://evil.example.com/form", "Apply online at https://scholarship.tarlac.example.gov.ph/apply")))
        self.assertEqual(result_of(v, "apply_url").validation_result, "fail")
        self.assertNotIn("apply_url", v.normalized)

    def test_third_party_form_is_a_warning(self):
        v = run(good_extraction(apply_url=ev("https://forms.gle/abc123", "Apply online at https://scholarship.tarlac.example.gov.ph/apply")))
        self.assertEqual(result_of(v, "apply_url").validation_result, "warn")

    def test_past_deadline_suggests_closed(self):
        v = validate_offering(good_extraction(), source_text=SOURCE, source_url=URL,
                              retrieved_at=datetime(2026, 12, 5, tzinfo=timezone.utc), page_links=LINKS)
        self.assertEqual(v.suggested_status, "closed")

    def test_future_opening_suggests_upcoming(self):
        v = validate_offering(good_extraction(), source_text=SOURCE, source_url=URL,
                              retrieved_at=datetime(2026, 10, 20, tzinfo=timezone.utc), page_links=LINKS)
        self.assertEqual(v.suggested_status, "upcoming")

    def test_missing_year_is_a_warning_not_a_pass(self):
        src = SOURCE + "\nLate applications accepted until December 5."
        v = validate_offering(good_extraction(closes_on=ev("2026-12-05", "Late applications accepted until December 5.")),
                              source_text=src, source_url=URL, retrieved_at=RETRIEVED, page_links=LINKS)
        self.assertEqual(result_of(v, "closes_on").validation_result, "warn")

    def test_suggested_rules(self):
        rules = run(good_extraction()).suggested_rules
        by_field = {r["field"]: r for r in rules}
        self.assertEqual(by_field["residence_province_id"]["province"], "Tarlac")
        self.assertEqual((by_field["grade"]["value"], by_field["grade"]["grade_scale"]), (2.0, "ph_1_to_5"))
        self.assertEqual(by_field["income"]["value"], 250000)
        self.assertTrue(all("note" in r for r in rules))

    def test_wrong_academic_year(self):
        v = run(good_extraction(academic_year=ev("2025-2026", "Academic Year 2026-2027")))
        self.assertEqual(result_of(v, "academic_year").validation_result, "fail")


class HelperTests(unittest.TestCase):
    def test_academic_year_forms(self):
        self.assertEqual(normalize_academic_year("A.Y. 2026–2027"), "2026-2027")
        self.assertEqual(normalize_academic_year("SY 2026-27"), "2026-2027")
        self.assertIsNone(normalize_academic_year("2026-2028"))
        self.assertIsNone(normalize_academic_year("next year"))

    def test_status_words(self):
        self.assertEqual(status_from_text("Applications are now closed."), "closed")
        self.assertEqual(status_from_text("The program is suspended until further notice."), "suspended")
        self.assertEqual(status_from_text("Bukas na ang aplikasyon!"), "open")
        self.assertEqual(status_from_text("Deadline extended to Dec 5"), "open")
        self.assertIsNone(status_from_text("Read the guidelines."))

    def test_percent_grade_rule(self):
        [rule] = suggest_rules([{"text": "General average of at least 85%"}])
        self.assertEqual((rule["operator"], rule["value"], rule["grade_scale"]), ("gte", 85.0, "percent"))


if __name__ == "__main__":
    unittest.main()
