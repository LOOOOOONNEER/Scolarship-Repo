"""Turns fetched documents into clean text the pre-filter and extractor can read.

Text from pages is untrusted data. It is never executed, never used to build
SQL, and is passed to the language model only as quoted material.
"""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
import urllib.parse
from dataclasses import dataclass, field
from html.parser import HTMLParser

SKIP_TAGS = {"script", "style", "noscript", "svg", "template", "iframe", "head", "nav", "footer", "form", "button", "select"}
BLOCK_TAGS = {
    "p", "div", "section", "article", "main", "aside", "header", "br", "li", "ul", "ol", "table", "tr",
    "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dd", "dt", "figcaption",
}
VOID_TAGS = {"br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"}
MAX_TEXT_CHARS = 200_000


class UnsupportedDocument(Exception):
    pass


@dataclass
class ExtractedText:
    text: str
    title: str | None = None
    links: list[tuple[str, str]] = field(default_factory=list)  # (absolute url, anchor text)

    @property
    def content_hash(self) -> str:
        return text_hash(self.text)


def normalize_space(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace(" ", " ")
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in text.splitlines()]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def text_hash(text: str) -> str:
    """Hash of the cleaned text, so cosmetic HTML changes don't count as changes."""
    canonical = re.sub(r"\s+", " ", text).strip().lower()
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class _HTMLText(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.parts: list[str] = []
        self.skip_depth = 0
        self.in_title = False
        self.title_parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._anchor: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            if tag not in VOID_TAGS:
                self.skip_depth += 1
            if tag == "head":
                return
            return
        if tag == "title":
            self.in_title = True
        if self.skip_depth:
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "a":
            href = dict(attrs).get("href")
            if href and not href.startswith(("#", "javascript:", "mailto:", "tel:")):
                self._href = urllib.parse.urljoin(self.base_url, href.strip())
                self._anchor = []

    def handle_startendtag(self, tag, attrs):
        if tag in BLOCK_TAGS and not self.skip_depth:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and tag not in VOID_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if tag == "title":
            self.in_title = False
        if self.skip_depth:
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "a" and self._href:
            self.links.append((self._href, normalize_space(" ".join(self._anchor))))
            self._href = None

    def handle_data(self, data):
        if self.in_title:
            self.title_parts.append(data)
            return
        if self.skip_depth:
            return
        self.parts.append(data)
        if self._href:
            self._anchor.append(data)


def html_to_text(body: bytes, base_url: str, charset: str | None = None) -> ExtractedText:
    html = body.decode(charset or _sniff_charset(body), errors="replace")
    parser = _HTMLText(base_url)
    parser.feed(html)
    parser.close()
    text = normalize_space("".join(parser.parts))[:MAX_TEXT_CHARS]
    title = normalize_space(" ".join(parser.title_parts)) or None
    seen: set[str] = set()
    links = []
    for url, anchor in parser.links:
        url = urllib.parse.urldefrag(url)[0]
        if url.startswith(("http://", "https://")) and url not in seen:
            seen.add(url)
            links.append((url, anchor))
    return ExtractedText(text=text, title=title, links=links)


def _sniff_charset(body: bytes) -> str:
    m = re.search(rb"<meta[^>]+charset=[\"']?([A-Za-z0-9_-]+)", body[:4096], re.I)
    if m:
        name = m.group(1).decode("ascii", errors="ignore")
        try:
            "".encode(name)
            return name
        except LookupError:
            pass
    return "utf-8"


def pdf_to_text(body: bytes, max_pages: int = 40) -> ExtractedText:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - pypdf is a declared dependency
        raise UnsupportedDocument("pypdf is not installed") from exc
    try:
        reader = PdfReader(io.BytesIO(body))
        pages = [(page.extract_text() or "") for page in reader.pages[:max_pages]]
    except Exception as exc:  # malformed PDFs raise many different errors
        raise UnsupportedDocument(f"could not read PDF: {type(exc).__name__}") from None
    text = normalize_space("\n\n".join(pages))[:MAX_TEXT_CHARS]
    if len(text) < 40:
        # Probably a scanned PDF. OCR for scans and poster images arrives with submissions in a later step.
        raise UnsupportedDocument("PDF has no extractable text (likely scanned)")
    title = None
    try:
        title = (reader.metadata or {}).get("/Title")
    except Exception:
        pass
    return ExtractedText(text=text, title=str(title) if title else None)


def document_to_text(kind: str, body: bytes, url: str, content_type_header: str | None = None) -> ExtractedText:
    if kind == "html":
        charset = None
        if content_type_header and "charset=" in content_type_header:
            charset = content_type_header.split("charset=")[-1].split(";")[0].strip()
        return html_to_text(body, url, charset)
    if kind == "text":
        return ExtractedText(text=normalize_space(body.decode("utf-8", errors="replace"))[:MAX_TEXT_CHARS])
    if kind == "pdf":
        return pdf_to_text(body)
    raise UnsupportedDocument(f"no text extractor for {kind}")
