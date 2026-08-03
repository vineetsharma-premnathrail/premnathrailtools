import re

# Shared by every RnD tool that renders user-supplied text (doc_no, made_by,
# checked_by, approved_by, doc_date, material_type, ...) into a .tex template
# before shelling out to pdflatex/xelatex/lualatex. Any such field MUST be
# passed through this before being added to the Jinja2 render context —
# otherwise a value like `\input{/app/.env}` is interpreted by the LaTeX
# compiler as a real file-inclusion directive, not literal text, and its
# contents end up embedded in the PDF that gets returned to the requester.
def escape_latex(s: str) -> str:
    """Escape special LaTeX characters."""
    mapping = {
        '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#', '_': r'\_',
        '{': r'\{', '}': r'\}', '~': r'\textasciitilde{}',
        '^': r'\textasciicircum{}', '\\': r'\textbackslash{}', ';': r'\;', ':': r'\:',
    }
    return re.sub(r'[&%$#_{}~^;:\\]', lambda m: mapping.get(m.group(0), ""), s)
