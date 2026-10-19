"""Compare two versions of a .docx: which lines of text were added/removed,
how many images were added/removed, and which amounts changed.

Used to show "what was edited in Word" next to a system-generated document,
so people can see the edits without opening the file — and get warned when
a number (price, total, qty) was changed in the document instead of in the
system record it was generated from.
"""

from __future__ import annotations

import difflib
import io
import re
import zipfile

from docx import Document
from docx.oxml.ns import qn

# "47,214.16", "4,85,000.00", "1200.5" — amount-like tokens with decimals or
# thousands separators. Plain small integers (S.No, "2 weeks") are ignored so
# the warning stays about money/quantities that matter.
_AMOUNT = re.compile(r"(?<![\w.])\d{1,3}(?:,\d{2,3})+(?:\.\d+)?(?![\w])|(?<![\w.,])\d+\.\d{1,2}(?![\w])")
MAX_LINES = 60


def _lines(docx_bytes: bytes) -> list[str]:
    """Body text in reading order: each paragraph is a line, each table row a
    line ("cell | cell | …"). Header/footer (letterhead) is ignored."""
    doc = Document(io.BytesIO(docx_bytes))
    out: list[str] = []
    for block in doc.element.body.iterchildren():
        if block.tag == qn("w:p"):
            text = "".join(t.text or "" for t in block.iter(qn("w:t"))).strip()
            if text:
                out.append(text)
        elif block.tag == qn("w:tbl"):
            for row in block.iter(qn("w:tr")):
                cells = []
                for cell in row.iter(qn("w:tc")):
                    cells.append(" ".join("".join(t.text or "" for t in p.iter(qn("w:t"))).strip() for p in cell.iter(qn("w:p"))).strip())
                text = " | ".join(c for c in cells if c)
                if text:
                    out.append(text)
    return out


def _image_count(docx_bytes: bytes) -> int:
    """Images placed in the document body (not the letterhead banners)."""
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as z:
        try:
            body = z.read("word/document.xml")
        except KeyError:
            return 0
    return body.count(b"<a:blip ")


def compare_docx(old: bytes, new: bytes) -> dict:
    old_lines, new_lines = _lines(old), _lines(new)
    changes: list[dict] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=old_lines, b=new_lines, autojunk=False).get_opcodes():
        if tag == "replace" and (i2 - i1) == (j2 - j1):
            # Same number of lines swapped one-for-one: an edited line, shown as old → new.
            changes += [{"type": "changed", "old": a, "new": b} for a, b in zip(old_lines[i1:i2], new_lines[j1:j2])]
            continue
        if tag in ("replace", "delete"):
            changes += [{"type": "removed", "text": t} for t in old_lines[i1:i2]]
        if tag in ("replace", "insert"):
            changes += [{"type": "added", "text": t} for t in new_lines[j1:j2]]

    old_amounts = set(_AMOUNT.findall("\n".join(old_lines)))
    new_amounts = set(_AMOUNT.findall("\n".join(new_lines)))
    images_old, images_new = _image_count(old), _image_count(new)
    return {
        "changed": bool(changes) or images_old != images_new,
        "change_count": len(changes),
        "lines": changes[:MAX_LINES],
        "truncated": len(changes) > MAX_LINES,
        "images_added": max(images_new - images_old, 0),
        "images_removed": max(images_old - images_new, 0),
        "amounts_removed": sorted(old_amounts - new_amounts),
        "amounts_added": sorted(new_amounts - old_amounts),
    }
