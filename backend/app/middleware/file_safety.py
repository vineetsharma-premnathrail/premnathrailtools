"""Uploaded files must never run as a program in the user's browser.

Download routes return the bytes of a file someone uploaded. If the response
said `text/html` (or xml / svg / javascript), a browser that opens it — or a
blob made from it — would run any script inside, on the portal's own address.
The uploader chooses that type, so it cannot be trusted.

`harden_file_response` runs on every /api response (OWASP middleware) and, for
anything that is not JSON, decides the type from the file's EXTENSION:
  - viewable and harmless (pdf, photos, video, plain text) -> that exact type,
    text always as `text/plain` so a .txt only ever shows its text;
  - web pages, code and scripts (html, svg, js, bat, ps1, py, ...) -> `text/plain`:
    their text is shown, nothing runs;
  - office / archive / other known business files -> their type, as a download;
  - anything else (programs like .exe, unknown formats) -> `application/octet-stream`
    + `attachment`, so it can only be saved, never rendered or run by the browser.
Uploads of every format are allowed (owner decision 2026-11-12); this is the guard.
"""
from __future__ import annotations

import re
from urllib.parse import unquote

# Shown in the browser (tab, <img>, <video>, PDF viewer). None of these can run script.
INLINE_SAFE: dict[str, str] = {
    "pdf": "application/pdf",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "jfif": "image/jpeg",
    "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp",
    "mp4": "video/mp4", "m4v": "video/mp4", "webm": "video/webm", "mov": "video/quicktime",
    "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg",
    "txt": "text/plain; charset=utf-8", "log": "text/plain; charset=utf-8",
    "csv": "text/csv; charset=utf-8",
}

# Web pages, code and scripts: served as PLAIN TEXT, so opening one shows its
# text and nothing in it can run. (The portal's popup viewer can still draw an
# HTML page in a script-free sandbox and an SVG as a picture.)
TEXT_VIEW_EXTENSIONS = {
    "html", "htm", "xhtml", "shtml", "xht", "mht", "mhtml", "xml", "xsl", "xslt", "svg",
    "js", "mjs", "cjs", "jse", "ts", "tsx", "jsx", "json", "css", "md", "py", "php", "asp", "aspx", "jsp",
    "bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "wsf", "wsh", "hta", "sh", "reg", "sql",
    "ini", "cfg", "conf", "yaml", "yml", "toml", "properties", "nc", "gcode", "tap", "iges", "igs",
}
INLINE_SAFE.update({ext: "text/plain; charset=utf-8" for ext in TEXT_VIEW_EXTENSIONS})

# Opened by a desktop app after download; never rendered by the browser.
DOWNLOAD_ONLY: dict[str, str] = {
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "zip": "application/zip", "rar": "application/vnd.rar", "7z": "application/x-7z-compressed",
    "dwg": "application/acad", "dxf": "application/dxf", "step": "application/step", "stp": "application/step",
    "stl": "model/stl", "sldprt": "application/sldworks", "sldasm": "application/sldworks", "slddrw": "application/sldworks",
    "ipt": "application/octet-stream", "iam": "application/octet-stream", "idw": "application/octet-stream",
    "heic": "image/heic", "heif": "image/heif", "tif": "image/tiff", "tiff": "image/tiff",
    "avi": "video/x-msvideo", "mkv": "video/x-matroska",
}

# Non-JSON API bodies without a file name that are fine as they are (exports, generated files).
_SAFE_BASE_TYPES = (
    "application/json", "application/problem+json", "text/plain", "text/csv", "text/event-stream",
    "application/pdf", "application/octet-stream", "application/zip",
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
)
_SAFE_BASE_PREFIXES = ("video/", "audio/", "application/vnd.", "application/msword")

_FILENAME_STAR = re.compile(r"filename\*\s*=\s*[^']*'[^']*'([^;]+)", re.I)
_FILENAME = re.compile(r'filename\s*=\s*"?([^";]+)"?', re.I)

OCTET = "application/octet-stream"


def _filename(disposition: str | None) -> str | None:
    if not disposition:
        return None
    m = _FILENAME_STAR.search(disposition)
    if m:
        return unquote(m.group(1).strip())
    m = _FILENAME.search(disposition)
    return m.group(1).strip() if m else None


def _ext(name: str) -> str:
    name = name.strip().rstrip(".").lower()
    return name.rsplit(".", 1)[-1] if "." in name else ""


def _force_download(headers, filename: str | None) -> None:
    headers["content-type"] = OCTET
    safe_name = (filename or "file").replace('"', "").replace("\\", "")
    headers["content-disposition"] = f'attachment; filename="{safe_name}"'


def harden_file_response(path: str, headers) -> bool:
    """Fix the type of a file response in place. Returns True when the response
    is a file (not JSON), so the caller can add a sandbox CSP."""
    content_type = headers.get("content-type") or ""
    base = content_type.split(";", 1)[0].strip().lower()
    disposition = headers.get("content-disposition")
    filename = _filename(disposition)

    if not filename and base in ("application/json", "application/problem+json", ""):
        return False  # normal API reply / empty body

    if filename:
        ext = _ext(filename)
        if ext in INLINE_SAFE:
            headers["content-type"] = INLINE_SAFE[ext]
        elif ext in DOWNLOAD_ONLY:
            headers["content-type"] = DOWNLOAD_ONLY[ext]
            if disposition and disposition.strip().lower().startswith("inline"):
                headers["content-disposition"] = "attachment" + disposition.strip()[len("inline"):]
        else:
            _force_download(headers, filename)
        return True

    # No file name: generated content. Keep known-harmless types; never let
    # html / xml / svg / script through — except our own server-drawn QR codes.
    if base == "image/svg+xml" and path.endswith("/qr.svg"):
        return True
    if base in _SAFE_BASE_TYPES or base.startswith(_SAFE_BASE_PREFIXES):
        if base.startswith("text/"):
            headers["content-type"] = f"{base}; charset=utf-8"
        return True
    _force_download(headers, None)
    return True
