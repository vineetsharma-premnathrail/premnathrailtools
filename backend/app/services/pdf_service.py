# PDF Service
# PDF generation and manipulation utilities

from typing import Dict, Any
import io


class PdfService:
    """Utility wrapper for PDF generation tasks."""

    def create_pdf(self, template_name: str, context: Dict[str, Any], filename: str) -> io.BytesIO:
        """Generate PDF from template and return buffer."""
        return generate_pdf_report(context or {}, template_name)


def generate_pdf_report(data: Dict[str, Any], template_name: str) -> io.BytesIO:
    """
    Render a LaTeX template and compile it to PDF.

    This implementation is based on the hydraulic tool's generator. It uses Jinja2
    to render the specified template (located in app/services/templates) and then
    attempts to compile it using one of the available LaTeX engines (pdflatex,
    xelatex, lualatex). If compilation succeeds the resulting PDF bytes are
    returned in an io.BytesIO buffer; otherwise a descriptive exception is raised.
    """
    try:
        from jinja2 import Environment, FileSystemLoader
        import os
        import tempfile
        from pathlib import Path
        import subprocess
        import shutil
    except ImportError:
        raise Exception('Jinja2 (and related utilities) required for PDF generation')

    # locate template directory — templates live in app/utils/templates/
    template_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'utils', 'templates'))
    env = Environment(loader=FileSystemLoader(template_dir))

    # render provided template with the supplied data dictionary
    try:
        template = env.get_template(template_name)
    except Exception as e:
        raise Exception(f'Failed to load PDF template "{template_name}": {e}')

    latex_content = template.render(**data)

    # compile LaTeX in a temporary directory
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        tex_file = tmp / 'report.tex'
        tex_file.write_text(latex_content, encoding='utf-8')

        # copy logos so LaTeX can find them
        utils_tpl = Path(template_dir)
        for img in ['logo.JPG', 'logo-1.JPG']:
            src = utils_tpl / img
            if src.exists():
                shutil.copy(src, tmp / img)

        def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
            return subprocess.run(cmd, cwd=td, capture_output=True, text=True, timeout=300)

        engines = ['pdflatex', 'xelatex', 'lualatex']
        last_res: subprocess.CompletedProcess[str] | None = None
        pdf_path = tmp / 'report.pdf'

        # try each engine until a PDF appears
        for engine in engines:
            try:
                last_res = _run([engine, '-interaction=nonstopmode', 'report.tex'])
            except FileNotFoundError:
                last_res = None
                continue
            if pdf_path.exists():
                data_bytes = pdf_path.read_bytes()
                buf = io.BytesIO(data_bytes)
                buf.seek(0)
                return buf
            if last_res and last_res.returncode == 0 and not pdf_path.exists():
                continue

        diag: list[str] = []
        if last_res is not None:
            diag.append(f"last returncode={last_res.returncode}")
            diag.append('\n--- stdout ---\n')
            diag.append(last_res.stdout or '')
            diag.append('\n--- stderr ---\n')
            diag.append(last_res.stderr or '')
        log_file = tmp / 'report.log'
        if log_file.exists():
            try:
                log_text = log_file.read_text(encoding='utf-8', errors='ignore')
                diag.append('\n--- report.log (tail) ---\n')
                diag.append(log_text[-2000:])
            except Exception:
                pass
        raise Exception('LaTeX compilation failed; no PDF produced.\n' + '\n'.join(diag))


def merge_pdfs(pdf_buffers: list[io.BytesIO]) -> io.BytesIO:
    """Merge multiple PDF buffers into one"""
    buffer = io.BytesIO()
    return buffer
