"""Every file format can be uploaded; on the way out a file can be shown or saved,
but a page / script / program never runs in the browser."""
import pytest
from starlette.datastructures import MutableHeaders

from app.middleware.file_safety import harden_file_response
from app.utils.sharepoint import validate_upload_metadata


def _h(content_type: str, disposition: str | None = None) -> MutableHeaders:
    h = MutableHeaders()
    h["content-type"] = content_type
    if disposition:
        h["content-disposition"] = disposition
    return h


@pytest.mark.parametrize("name", ["note.txt", "page.html", "drawing.svg", "run.bat", "tool.ps1", "macro.vbs", "app.hta", "x.js"])
def test_text_pages_and_scripts_are_served_as_plain_text(name):
    h = _h("text/html;charset=utf-8", f'inline; filename="{name}"')
    assert harden_file_response("/api/v1/crm/documents/1/download", h) is True
    assert h["content-type"] == "text/plain; charset=utf-8"


@pytest.mark.parametrize("name", ["setup.exe", "lib.dll", "noext", "weird.abc"])
def test_programs_and_unknown_files_are_download_only(name):
    h = _h("application/x+xml", f'inline; filename="{name}"')
    harden_file_response("/api/v1/x/1/content", h)
    assert h["content-type"] == "application/octet-stream"
    assert h["content-disposition"].startswith("attachment")


def test_viewable_office_and_cad_files_keep_a_safe_type():
    h = _h("text/html", 'inline; filename="photo.JPG"')
    harden_file_response("/api/v1/x/1/content", h)
    assert h["content-type"] == "image/jpeg"
    h = _h("text/html", 'inline; filename="offer.docx"')
    harden_file_response("/api/v1/x/1/content", h)
    assert h["content-type"].startswith("application/vnd.openxmlformats")
    assert h["content-disposition"].startswith("attachment")
    h = _h("text/html", 'inline; filename="bracket.SLDPRT"')
    harden_file_response("/api/v1/x/1/content", h)
    assert h["content-type"] == "application/sldworks"


def test_json_untouched_and_generated_html_never_rendered():
    h = _h("application/json")
    assert harden_file_response("/api/v1/users/me", h) is False
    assert h["content-type"] == "application/json"
    h = _h("text/html")
    harden_file_response("/api/v1/something", h)
    assert h["content-type"] == "application/octet-stream"
    h = _h("image/svg+xml")
    harden_file_response("/api/v1/maintenance/assets/3/qr.svg", h)
    assert h["content-type"] == "image/svg+xml"


@pytest.mark.parametrize("name,ctype", [
    ("drawing.pdf", "application/pdf"),
    ("photo.jpeg", "image/jpeg"),
    ("site video.mov", "video/quicktime"),
    ("BOM.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("notes.txt", "text/plain; charset=utf-8"),
    ("page.html", "text/html;charset=utf-8"),
    ("plate.dxf", "application/octet-stream"),
    ("bracket.sldprt", "application/octet-stream"),
    ("tool.exe", "application/x-msdownload"),
])
def test_every_format_can_be_uploaded(name, ctype):
    assert validate_upload_metadata(name, 100, ctype)
