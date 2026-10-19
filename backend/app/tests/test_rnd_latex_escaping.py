"""Regression coverage for the LaTeX-injection fix in the RnD PDF tools
(hydraulic, spline, braking) — free-text metadata fields (doc_no, made_by,
checked_by, approved_by, doc_date, material_type) must never reach a .tex
template unescaped, since that template is compiled by a real LaTeX engine
and could otherwise be abused for server-side file disclosure via \\input."""
from app.modules.rnd.tools.latex_utils import escape_latex
from app.modules.rnd.tools.braking.units import escape_latex as braking_escape_latex


def test_escape_latex_neutralizes_input_directive():
    escaped = escape_latex(r"\input{/app/.env}")
    assert "\\input{" not in escaped
    assert r"\textbackslash{}" in escaped
    assert r"\{" in escaped and r"\}" in escaped


def test_escape_latex_neutralizes_include_and_write18():
    for payload in (r"\include{/etc/passwd}", r"\write18{cat /app/.env}"):
        escaped = escape_latex(payload)
        assert "\\include{" not in escaped
        assert "\\write18{" not in escaped


def test_braking_module_reexports_the_shared_escape_latex():
    # braking/service.py imports `escape_latex` from `.units` — confirm that
    # still resolves to the single shared implementation, not a duplicate.
    assert braking_escape_latex is escape_latex


def test_escape_latex_keeps_colons_and_semicolons():
    # `\:` / `\;` are math-spacing commands — escaping these made the
    # characters vanish from generated PDFs ("Doc: RD-01" -> "Doc RD-01").
    escaped = escape_latex("Doc: RD-01; Rev: A")
    assert escaped == "Doc: RD-01; Rev: A"
    assert r"\:" not in escaped and r"\;" not in escaped


def test_escape_latex_still_escapes_every_special_character():
    assert escape_latex("&%$#_{}") == r"\&\%\$\#\_\{\}"
    assert escape_latex("~") == r"\textasciitilde{}"
    assert escape_latex("^") == r"\textasciicircum{}"
    assert escape_latex("\\") == r"\textbackslash{}"


def test_escape_latex_blocks_injection_mixed_with_colons():
    escaped = escape_latex(r"Note: \input{/app/.env}; \def\x{1}")
    assert "\input{" not in escaped
    assert "\def" not in escaped
    assert escaped.startswith("Note: ")
    # every backslash in the output must belong to an escape sequence we emitted
    assert escaped.count(r"\textbackslash{}") == 3
