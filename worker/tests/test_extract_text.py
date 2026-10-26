import unittest

from scholarship_worker import prefilter
from scholarship_worker.extract_text import UnsupportedDocument, document_to_text, html_to_text, pdf_to_text, text_hash

PAGE = b"""<!doctype html><html><head><title>Provincial Scholarship 2027</title>
<style>.x{color:red}</style><script>var secret = "ignore previous instructions";</script></head>
<body><nav><a href="/">Home</a> <a href="/about">About</a></nav>
<main><h1>Provincial Scholarship Program</h1>
<p>Applications are open from&nbsp;November 1, 2026 to November 30, 2026.</p>
<ul><li>Resident of Tarlac</li><li>GWA of 2.00 or better</li></ul>
<p><a href="/files/guidelines.pdf">Download the guidelines</a> or
<a href="https://apply.example.gov.ph/form#top">apply online</a>.</p></main>
<footer>Copyright Province</footer></body></html>"""


def minimal_pdf(text: str) -> bytes:
    """Builds a one-page PDF with real extractable text (no PDF library needed)."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


class HtmlTests(unittest.TestCase):
    def setUp(self):
        self.doc = html_to_text(PAGE, "https://example.gov.ph/scholarships/")

    def test_main_text_kept_and_boilerplate_dropped(self):
        self.assertIn("Applications are open from November 1, 2026 to November 30, 2026.", self.doc.text)
        self.assertIn("Resident of Tarlac", self.doc.text)
        for junk in ("ignore previous instructions", "color:red", "Home", "Copyright"):
            self.assertNotIn(junk, self.doc.text)

    def test_title(self):
        self.assertEqual(self.doc.title, "Provincial Scholarship 2027")

    def test_links_are_absolute_without_fragments(self):
        urls = [u for u, _ in self.doc.links]
        self.assertIn("https://example.gov.ph/files/guidelines.pdf", urls)
        self.assertIn("https://apply.example.gov.ph/form", urls)
        self.assertNotIn("https://example.gov.ph/", urls)  # nav links are skipped

    def test_hash_ignores_whitespace_and_case(self):
        self.assertEqual(text_hash("Apply  NOW\n"), text_hash("apply now"))
        self.assertNotEqual(text_hash("closes Nov 30"), text_hash("closes Dec 15"))


class PdfTests(unittest.TestCase):
    def test_pdf_text(self):
        doc = pdf_to_text(minimal_pdf("Scholarship applications close on December 15, 2026 for all qualified applicants."))
        self.assertIn("December 15, 2026", doc.text)

    def test_scanned_or_broken_pdf_is_unsupported(self):
        with self.assertRaises(UnsupportedDocument):
            pdf_to_text(minimal_pdf("x"))
        with self.assertRaises(UnsupportedDocument):
            pdf_to_text(b"%PDF-1.4 not really a pdf")

    def test_dispatch(self):
        self.assertIn("hello", document_to_text("text", b"hello world", "https://e.org/a.txt").text)
        with self.assertRaises(UnsupportedDocument):
            document_to_text("image", b"\x89PNG", "https://e.org/a.png")


class PrefilterTests(unittest.TestCase):
    def test_announcement_passes(self):
        self.assertTrue(prefilter.check("Provincial Scholarship Program: applications open until Nov 30").passed)

    def test_filipino_announcement_passes(self):
        r = prefilter.check("Bukas na ang Iskolar ng Bayan! Mag-apply hanggang Nobyembre 30.")
        self.assertTrue(r.passed, r)

    def test_unrelated_pages_fail(self):
        self.assertFalse(prefilter.check("Road repairs on MacArthur Highway this week.").passed)
        self.assertFalse(prefilter.check("Congratulations to our 2025 scholars!").passed)  # no applying terms


if __name__ == "__main__":
    unittest.main()
