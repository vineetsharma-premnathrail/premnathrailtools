"""Quotation Terms & Conditions written in the rich-text editor (2026-11-18).

One editor replaces Quote Conditions / Payment Terms / Notes on the quotation form:
the user writes or pastes the terms in their own format (paragraphs, numbered
clauses, bullet points, bold / italic) and the whole text is saved with the
quotation as HTML in `crm_quotations.terms_html`.

Two jobs, both stdlib only (html.parser):
  * sanitize_terms_html - keep only the formatting tags the editor makes, drop
    every attribute, script/style content and anything else (the HTML is shown
    on the page and printed, so it is never trusted as sent);
  * terms_blocks - the sanitized HTML as a flat list of printable blocks
    (paragraph or list item, with its number / bullet and bold / italic runs)
    that the PDF and Word builders render the same way.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from html import escape
from html.parser import HTMLParser

MAX_TERMS_CHARS = 60_000

_INLINE = {"b": "b", "strong": "b", "i": "i", "em": "i", "u": "u"}
_BLOCK = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6"}
_LIST = {"ul", "ol"}
_DROP_CONTENT = {"script", "style", "head", "title", "iframe", "object", "noscript", "template"}


class _Sanitizer(HTMLParser):
    """Rebuilds the HTML from allowed tags only, without any attribute."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in _DROP_CONTENT:
            self.skip += 1
            return
        if self.skip:
            return
        if tag == "br":
            self.out.append("<br>")
            return
        name = _INLINE.get(tag) or ("p" if tag in _BLOCK else tag if tag in _LIST or tag == "li" else None)
        if name is None:
            return
        self.out.append(f"<{name}>")
        self.stack.append(name)

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and not self.skip:
            self.out.append("<br>")

    def handle_endtag(self, tag):
        if tag in _DROP_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        name = _INLINE.get(tag) or ("p" if tag in _BLOCK else tag if tag in _LIST or tag == "li" else None)
        if name is None or name not in self.stack:
            return
        while self.stack:  # close everything opened inside it too
            top = self.stack.pop()
            self.out.append(f"</{top}>")
            if top == name:
                break

    def handle_data(self, data):
        if not self.skip:
            self.out.append(escape(data, quote=False))

    def result(self) -> str:
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")
        return "".join(self.out)


def sanitize_terms_html(html: str | None) -> str | None:
    """Allowed formatting only; None when nothing readable is left."""
    if html is None:
        return None
    if len(html) > MAX_TERMS_CHARS:
        raise ValueError(f"Terms & Conditions are {len(html):,} characters long - keep them within {MAX_TERMS_CHARS:,} "
                         "(attach a separate document for very long terms).")
    s = _Sanitizer()
    s.feed(html)
    s.close()
    clean = s.result().strip()
    return clean if terms_plain_text(clean).strip() else None


@dataclass
class TermsBlock:
    kind: str                       # "p" | "li"
    marker: str = ""                # "1." / "a." / "•" for a list item
    level: int = 0                  # list nesting depth (0 = top list)
    runs: list[tuple[str, bool, bool, bool]] = field(default_factory=list)  # (text, bold, italic, underline)

    @property
    def text(self) -> str:
        return "".join(r[0] for r in self.runs)


def _marker(kind: str, n: int, level: int) -> str:
    if kind == "ul":
        return "•" if level % 2 == 0 else "–"  # both exist in the PDF's built-in Helvetica
    if level % 2 == 1:  # nested numbered list: a. b. c.
        letters, k = "", n
        while k > 0:
            k, r = divmod(k - 1, 26)
            letters = chr(97 + r) + letters
        return f"{letters}."
    return f"{n}."


class _Blocks(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[TermsBlock] = []
        self.lists: list[list] = []  # [kind, counter]
        self.fmt = {"b": 0, "i": 0, "u": 0}
        self.cur: TermsBlock | None = None

    def _block(self) -> TermsBlock:
        if self.cur is None:
            self.cur = TermsBlock("p")
            self.blocks.append(self.cur)
        return self.cur

    def _end(self) -> None:
        self.cur = None

    def handle_starttag(self, tag, attrs):
        if tag in _INLINE:
            self.fmt[_INLINE[tag]] += 1
        elif tag in _LIST:
            self._end()
            self.lists.append([tag, 0])
        elif tag == "li":
            self._end()
            kind, level = (self.lists[-1][0], len(self.lists) - 1) if self.lists else ("ul", 0)
            if self.lists:
                self.lists[-1][1] += 1
            n = self.lists[-1][1] if self.lists else 1
            self.cur = TermsBlock("li", _marker(kind, n, level), level)
            self.blocks.append(self.cur)
        elif tag == "br":
            self._block().runs.append(("\n", False, False, False))
        elif tag == "p":
            self._end()

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in _INLINE:
            self.fmt[_INLINE[tag]] = max(0, self.fmt[_INLINE[tag]] - 1)
        elif tag in _LIST:
            self._end()
            if self.lists:
                self.lists.pop()
        elif tag in ("li", "p"):
            self._end()

    def handle_data(self, data):
        if not data.strip() and self.cur is None:
            return
        self._block().runs.append((data, self.fmt["b"] > 0, self.fmt["i"] > 0, self.fmt["u"] > 0))


def terms_blocks(html: str | None) -> list[TermsBlock]:
    """Printable blocks of the (re-sanitized) terms; empty blocks dropped."""
    clean = sanitize_terms_html(html) if html else None
    if not clean:
        return []
    p = _Blocks()
    p.feed(clean)
    p.close()
    out = []
    for b in p.blocks:
        # Trim edge whitespace / line breaks of the block while keeping inner formatting.
        while b.runs and not b.runs[0][0].strip():
            b.runs.pop(0)
        while b.runs and not b.runs[-1][0].strip():
            b.runs.pop()
        if b.runs:
            first, last = b.runs[0], b.runs[-1]
            b.runs[0] = (first[0].lstrip(), *first[1:])
            b.runs[-1] = (b.runs[-1][0].rstrip(), *b.runs[-1][1:]) if len(b.runs) > 1 else (b.runs[0][0].rstrip(), *last[1:])
            out.append(b)
    return out


def terms_plain_text(html: str | None) -> str:
    """Plain text of the terms (search, change history, checks)."""
    if not html:
        return ""

    class _T(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.parts: list[str] = []

        def handle_data(self, d):
            self.parts.append(d)

    t = _T()
    t.feed(html)
    t.close()
    return " ".join(" ".join(t.parts).split())
