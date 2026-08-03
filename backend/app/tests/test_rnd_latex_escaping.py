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
