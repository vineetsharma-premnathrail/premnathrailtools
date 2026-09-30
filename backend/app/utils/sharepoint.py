import io
import re
from urllib.parse import quote
from fastapi import HTTPException, UploadFile
import httpx
from app.core.config import settings
from app.auth.microsoft import get_app_graph_token


class _InMemoryUploadFile:
    """Minimal UploadFile stand-in for server-generated files (e.g. a report built
    with reportlab/python-docx) that were never part of an incoming request — only
    exposes what upload_file_to_sharepoint/_validate_uploaded_file actually touch:
    .filename, .content_type, and a seekable .file."""

    def __init__(self, filename: str, content_type: str, data: bytes):
        self.filename = filename
        self.content_type = content_type
        self.file = io.BytesIO(data)


async def upload_bytes_to_sharepoint(site_id: str, folder_path: str, filename: str, content_type: str, data: bytes) -> dict:
    """Same return shape as upload_file_to_sharepoint, for bytes generated in-process
    rather than uploaded by a browser."""
    return await upload_file_to_sharepoint(site_id, folder_path, _InMemoryUploadFile(filename, content_type, data))

GRAPH_API = "https://graph.microsoft.com/v1.0"
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2 GB practical limit
SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024  # Graph simple upload limit
CHUNK_SIZE = 10 * 1024 * 1024  # 10 MB per chunk
ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".rtf", ".odt", ".png", ".jpg", ".jpeg", ".gif",
    ".bmp", ".mp4", ".mov", ".mkv", ".avi", ".wmv", ".webm",
    # Engineering/CAD (Design module, R&D). Browsers send these as
    # application/octet-stream, so they pass on extension alone; the ones
    # with a fixed header are also signature-checked below.
    ".dwg", ".dxf", ".step", ".stp", ".iges", ".igs", ".stl", ".sldprt", ".sldasm",
    ".slddrw", ".ipt", ".iam", ".idw", ".x_t", ".zip",
}
ALLOWED_CONTENT_PREFIXES = {"image/", "video/"}
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/rtf",
    "application/vnd.oasis.opendocument.text",
    "text/plain",
    "text/csv",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/bmp",
    "video/mp4",
    "video/quicktime",
    "video/x-matroska",
    "video/x-msvideo",
    "video/x-ms-wmv",
    "video/webm",
}

# The filename extension and Content-Type header are both fully attacker-
# controlled (e.g. a script renamed to "invoice.pdf" with a spoofed
# Content-Type: application/pdf header sails past a name/header-only check).
# This maps each extension family to the real byte signature its file format
# starts with, so a mismatch between "claims to be a PDF" and "is actually a
# PDF" gets caught before the file is stored/re-served to other users.
_MAGIC_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    ".pdf": (b"%PDF-",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF87a", b"GIF89a"),
    ".bmp": (b"BM",),
    # Modern Office formats are zip containers (docx/xlsx/pptx/odt).
    ".docx": (b"PK\x03\x04",),
    ".xlsx": (b"PK\x03\x04",),
    ".pptx": (b"PK\x03\x04",),
    ".odt": (b"PK\x03\x04",),
    # Legacy Office formats are OLE compound files.
    ".doc": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    ".xls": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    ".ppt": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    ".rtf": (b"{\\rtf",),
    # AutoCAD DWG opens with its version string ("AC1015", "AC1032"…, or
    # "AC1.x"/"AC2.x" for very old releases); STEP (ISO 10303-21) files with
    # their standard header; zip archives with the PK local/empty header.
    ".dwg": (b"AC10", b"AC1.", b"AC2."),
    ".step": (b"ISO-10303-21",),
    ".stp": (b"ISO-10303-21",),
    ".zip": (b"PK\x03\x04", b"PK\x05\x06"),
}


# Fallback so a file with no extension at all (but a Content-Type claiming a
# format we do have a signature for) still gets checked, instead of silently
# skipping verification because `ext` came out empty.
_CONTENT_TYPE_TO_EXT = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/rtf": ".rtf",
    "application/vnd.oasis.opendocument.text": ".odt",
}


def _verify_magic_bytes(filename: str, content_type: str, header: bytes) -> bool:
    """True if `header` (the file's first ~16 bytes) matches the signature
    expected for `filename`'s extension. Extensions with no reliable fixed
    signature (txt/csv/video containers) are not checked here — they're still
    covered by the extension/content-type allowlist above."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    ext = f".{ext}" if ext else ""
    if not ext:
        # No extension to go on — fall back to the claimed Content-Type so an
        # extension-less upload can't skip signature verification entirely.
        ext = _CONTENT_TYPE_TO_EXT.get(content_type, "")
    signatures = _MAGIC_SIGNATURES.get(ext)
    if not signatures:
        return True
    return any(header.startswith(sig) for sig in signatures)


def sanitize_folder_name(value: str) -> str:
    value = value or ""
    value = re.sub(r'[\\/:*?"<>|]+', "-", value)
    value = value.strip()
    return value or "unknown"


def _encode_path_segment(segment: str) -> str:
    return quote(segment, safe="")


def _validate_uploaded_file(upload_file: UploadFile) -> int:
    """Reject dangerous file types (stored-XSS vectors like SVG/HTML/JS),
    enforce the size cap, and verify the file's actual byte signature matches
    its claimed extension (blocks a disguised/renamed file — e.g. a script
    saved as "invoice.pdf" — since the filename and Content-Type header are
    both fully attacker-controlled). Returns the file's byte size."""
    filename = upload_file.filename or "unnamed"
    content_type = (upload_file.content_type or "").lower()
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    ext = f".{ext}" if ext else ""

    dangerous_ext = {".svg", ".svgz", ".html", ".htm", ".xhtml", ".xml", ".js", ".mjs"}
    if ext in dangerous_ext or "svg" in content_type or content_type in ("text/html", "application/xhtml+xml"):
        raise HTTPException(status_code=400, detail=f"File type not allowed for {filename}")

    if not (
        any(content_type.startswith(prefix) for prefix in ALLOWED_CONTENT_PREFIXES)
        or content_type in ALLOWED_CONTENT_TYPES
        or ext in ALLOWED_EXTENSIONS
    ):
        raise HTTPException(status_code=400, detail=f"Unsupported file type for {filename}")

    file_obj = upload_file.file
    try:
        current_pos = file_obj.tell()
        file_obj.seek(0, 2)
        size = file_obj.tell()
        file_obj.seek(current_pos)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Unable to determine size of {filename}")

    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File {filename} exceeds the maximum supported size of {MAX_FILE_SIZE // (1024*1024)} MB")

    try:
        file_obj.seek(0)
        header = file_obj.read(16)
        file_obj.seek(current_pos)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Unable to read {filename}")

    if not _verify_magic_bytes(filename, content_type, header):
        raise HTTPException(status_code=400, detail=f"{filename} does not match its claimed file type")

    return size


async def _start_large_upload_session(site_id: str, folder_path: str, filename: str) -> str:
    encoded_path = "/".join(_encode_path_segment(p) for p in folder_path.split("/") if p)
    session_url = f"{GRAPH_API}/sites/{site_id}/drive/root:/{encoded_path}/{_encode_path_segment(filename)}:/createUploadSession"

    token = await get_app_graph_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {"item": {"@microsoft.graph.conflictBehavior": "replace"}}

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(session_url, headers=headers, json=body)

    if response.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Unable to create upload session for {filename}: {response.text}")

    upload_url = response.json().get("uploadUrl")
    if not upload_url:
        raise HTTPException(status_code=502, detail=f"Upload session response missing uploadUrl for {filename}")
    return upload_url


async def _upload_large_file(upload_url: str, upload_file: UploadFile, size: int) -> dict:
    file_obj = upload_file.file
    file_obj.seek(0)
    position = 0
    filename = sanitize_folder_name(upload_file.filename or "attachment")
    token = await get_app_graph_token()

    async with httpx.AsyncClient(timeout=3600) as client:
        while position < size:
            chunk = file_obj.read(min(CHUNK_SIZE, size - position))
            if not chunk:
                break
            start, end = position, position + len(chunk) - 1
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {start}-{end}/{size}",
            }
            response = await client.put(upload_url, headers=headers, content=chunk)
            if response.status_code not in (200, 201, 202):
                raise HTTPException(status_code=502, detail=f"SharePoint upload failed for {filename} at chunk {start}-{end}: {response.text}")
            if response.status_code in (200, 201):
                return response.json()
            position = end + 1

    raise HTTPException(status_code=502, detail=f"SharePoint upload incomplete for {filename}")


async def upload_file_to_sharepoint(site_id: str, folder_path: str, upload_file: UploadFile) -> dict:
    if not site_id:
        raise HTTPException(status_code=503, detail="SharePoint site ID is not configured")

    file_size = _validate_uploaded_file(upload_file)
    filename = sanitize_folder_name(upload_file.filename or "attachment")
    encoded_path = "/".join(_encode_path_segment(p) for p in folder_path.split("/") if p)
    token = await get_app_graph_token()

    if file_size <= SIMPLE_UPLOAD_LIMIT:
        upload_url = f"{GRAPH_API}/sites/{site_id}/drive/root:/{encoded_path}/{_encode_path_segment(filename)}:/content"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": upload_file.content_type or "application/octet-stream",
        }
        file_obj = upload_file.file
        file_obj.seek(0)
        content = file_obj.read()
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.put(upload_url, headers=headers, content=content)
        if response.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"SharePoint upload failed for {filename}: {response.text}")
        data = response.json()
    else:
        upload_session_url = await _start_large_upload_session(site_id, folder_path, filename)
        data = await _upload_large_file(upload_session_url, upload_file, file_size)

    return {
        "name": data.get("name", filename),
        "path": f"{folder_path}/{filename}",
        "webUrl": data.get("webUrl"),
        "size": file_size,
    }


async def delete_file_from_sharepoint(site_id: str, file_path: str) -> None:
    if not site_id:
        raise HTTPException(status_code=503, detail="SharePoint site ID is not configured")
    if not file_path:
        raise HTTPException(status_code=400, detail="Attachment path is missing")

    encoded_path = "/".join(_encode_path_segment(p) for p in file_path.split("/") if p)
    delete_url = f"{GRAPH_API}/sites/{site_id}/drive/root:/{encoded_path}"
    token = await get_app_graph_token()

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.delete(delete_url, headers={"Authorization": f"Bearer {token}"})

    if response.status_code not in (200, 204):
        raise HTTPException(status_code=502, detail=f"SharePoint delete failed for {file_path}: {response.text}")


async def download_file_content(site_id: str, file_path: str) -> tuple[bytes, str]:
    """Fetch a file's raw bytes via the app-only Graph token, for rendering
    natively in-app (img/pdf/video tags served from our own origin) instead of
    relying on Microsoft's Office viewer page, which refuses to be framed.
    Callers MUST run their own authorization check first — this has no
    concept of who's asking."""
    if not site_id:
        raise HTTPException(status_code=503, detail="SharePoint site ID is not configured")
    if not file_path:
        raise HTTPException(status_code=400, detail="Attachment path is missing")

    encoded_path = "/".join(_encode_path_segment(p) for p in file_path.split("/") if p)
    content_url = f"{GRAPH_API}/sites/{site_id}/drive/root:/{encoded_path}:/content"
    token = await get_app_graph_token()

    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        response = await client.get(content_url, headers={"Authorization": f"Bearer {token}"})

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Unable to download {file_path}: {response.text}")

    content_type = response.headers.get("content-type", "application/octet-stream")
    return response.content, content_type


async def get_preview_url(site_id: str, file_path: str) -> str:
    """Mint a short-lived, embeddable Microsoft preview link for a file via the
    app-only Graph token — the caller's own SharePoint permissions (or lack of
    them) never come into it, since the app itself is what talks to Graph.
    Callers MUST run their own authorization check before calling this, since
    getting a preview link back is equivalent to granting read access."""
    if not site_id:
        raise HTTPException(status_code=503, detail="SharePoint site ID is not configured")
    if not file_path:
        raise HTTPException(status_code=400, detail="Attachment path is missing")

    encoded_path = "/".join(_encode_path_segment(p) for p in file_path.split("/") if p)
    preview_url = f"{GRAPH_API}/sites/{site_id}/drive/root:/{encoded_path}:/preview"
    token = await get_app_graph_token()

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(preview_url, headers={"Authorization": f"Bearer {token}"}, json={})

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Unable to generate preview for {file_path}: {response.text}")

    get_url = response.json().get("getUrl")
    if not get_url:
        raise HTTPException(status_code=502, detail=f"Preview response missing getUrl for {file_path}")
    return get_url


def build_sharepoint_folder_path(user_name: str, project_name: str, service_request_number: str, root_folder: str | None = None) -> str:
    root = sanitize_folder_name(root_folder or settings.SHAREPOINT_FOLDER or "ERP-media")
    user_folder = sanitize_folder_name(user_name or "unknown")
    project_folder = sanitize_folder_name(project_name or "project")
    service_folder = sanitize_folder_name(service_request_number or "service-request")
    return f"{root}/{user_folder}/{project_folder}/{service_folder}"


# ---------------------------------------------------------------------------
# Direct browser -> SharePoint uploads (large files, up to 100 GB)
#
# Big files can't go through the portal: the Next.js proxy caps request
# bodies, and the API would spool the whole file to disk/memory before
# forwarding it. Instead the API opens a Graph *upload session* in the right
# folder and hands the browser its pre-authenticated uploadUrl; the browser
# PUTs the file in chunks straight to SharePoint (CORS allows it), then
# calls the module's complete-upload endpoint, which re-checks the stored
# file (folder, size, extension, real byte signature) before recording it.
# ---------------------------------------------------------------------------

DIRECT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024 * 1024  # 100 GB (SharePoint's own cap is 250 GB)
# Graph requires chunk sizes in multiples of 320 KiB; 10 MiB = 32 x 320 KiB.
DIRECT_UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024
_DANGEROUS_EXTENSIONS = {".svg", ".svgz", ".html", ".htm", ".xhtml", ".xml", ".js", ".mjs"}


def validate_upload_metadata(filename: str, size: int, content_type: str | None = None) -> str:
    """Same allow/deny rules as _validate_uploaded_file, applied to what the
    browser says it is about to upload (no bytes yet). Returns the sanitized
    file name that will be used in SharePoint."""
    name = (filename or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="The file has no name.")
    content_type = (content_type or "").lower()
    ext = f".{name.lower().rsplit('.', 1)[-1]}" if "." in name else ""
    if ext in _DANGEROUS_EXTENSIONS or "svg" in content_type or content_type in ("text/html", "application/xhtml+xml"):
        raise HTTPException(status_code=400, detail=f"{name}: this file type is not allowed (web pages and SVGs can carry scripts).")
    if not (any(content_type.startswith(p) for p in ALLOWED_CONTENT_PREFIXES) or content_type in ALLOWED_CONTENT_TYPES or ext in ALLOWED_EXTENSIONS):
        raise HTTPException(status_code=400, detail=f"{name}: unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}.")
    if size <= 0:
        raise HTTPException(status_code=400, detail=f"{name} is empty.")
    if size > DIRECT_UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"{name} is {size / 1024 ** 3:.1f} GB. The maximum is {DIRECT_UPLOAD_MAX_BYTES // 1024 ** 3} GB per file.")
    return sanitize_folder_name(name)


async def create_upload_session(site_id: str, folder_path: str, filename: str) -> dict:
    """Opens a Graph upload session for folder_path/filename. conflictBehavior
    is "rename" so a same-named file never silently overwrites an existing
    one (Graph appends " 1", " 2" ...). Returns {upload_url, expires_at}."""
    if not site_id:
        raise HTTPException(status_code=503, detail="SharePoint site ID is not configured")
    encoded_path = "/".join(_encode_path_segment(p) for p in folder_path.split("/") if p)
    url = f"{GRAPH_API}/sites/{site_id}/drive/root:/{encoded_path}/{_encode_path_segment(filename)}:/createUploadSession"
    token = await get_app_graph_token()
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json={"item": {"@microsoft.graph.conflictBehavior": "rename"}})
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"SharePoint could not start the upload for {filename}: {response.text[:300]}")
    body = response.json()
    return {"upload_url": body["uploadUrl"], "expires_at": body.get("expirationDateTime")}


async def get_drive_item(site_id: str, item_id: str) -> dict:
    token = await get_app_graph_token()
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(f"{GRAPH_API}/sites/{site_id}/drive/items/{quote(item_id, safe='')}", headers={"Authorization": f"Bearer {token}"})
    if response.status_code == 404:
        raise HTTPException(status_code=400, detail="The uploaded file was not found in SharePoint; the upload may not have finished. Try uploading it again.")
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Could not read the uploaded file from SharePoint: {response.text[:300]}")
    return response.json()


async def read_item_head(site_id: str, item_id: str, length: int = 16) -> bytes:
    """First `length` bytes of a stored file (HTTP Range), for the byte-
    signature check; never downloads the whole file."""
    token = await get_app_graph_token()
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        response = await client.get(
            f"{GRAPH_API}/sites/{site_id}/drive/items/{quote(item_id, safe='')}/content",
            headers={"Authorization": f"Bearer {token}", "Range": f"bytes=0-{length - 1}"},
        )
    if response.status_code not in (200, 206):
        raise HTTPException(status_code=502, detail=f"Could not verify the uploaded file: {response.text[:200]}")
    return response.content[:length]


async def delete_drive_item(site_id: str, item_id: str) -> None:
    token = await get_app_graph_token()
    async with httpx.AsyncClient(timeout=60) as client:
        await client.delete(f"{GRAPH_API}/sites/{site_id}/drive/items/{quote(item_id, safe='')}", headers={"Authorization": f"Bearer {token}"})


async def verify_direct_upload(site_id: str, item_id: str, folder_path: str, expected_size: int, content_type: str | None) -> dict:
    """Checks a browser-uploaded file really is what the upload session was
    opened for: in the promised folder, the promised size, an allowed type,
    and bytes that match its extension. Deletes it from SharePoint and 400s
    otherwise. Returns {name, path, webUrl, size, item_id}."""
    item = await get_drive_item(site_id, item_id)
    name = item.get("name") or ""
    parent = (item.get("parentReference") or {}).get("path") or ""
    # Graph reports parents as "/drive/root:/<folder>".
    parent_folder = parent.split("root:", 1)[-1].strip("/")
    problem = None
    if parent_folder.lower() != folder_path.strip("/").lower():
        problem = "it landed in a different folder than the upload was opened for"
    elif int(item.get("size") or 0) != int(expected_size):
        problem = f"its size ({item.get('size')} bytes) does not match the {expected_size} bytes announced, so the upload may be incomplete"
    else:
        try:
            validate_upload_metadata(name, int(item.get("size") or 0), content_type)
        except HTTPException as exc:
            problem = str(exc.detail)
        else:
            if not _verify_magic_bytes(name, (content_type or "").lower(), await read_item_head(site_id, item_id)):
                problem = f"the content of {name} does not match its file type"
    if problem:
        await delete_drive_item(site_id, item_id)
        raise HTTPException(status_code=400, detail=f"The uploaded file was rejected and removed: {problem}. Please upload it again.")
    return {"name": name, "path": f"{folder_path}/{name}", "webUrl": item.get("webUrl"), "size": int(item.get("size") or 0), "item_id": item_id}


async def get_download_url(site_id: str, file_path: str) -> str:
    """A short-lived (about 1 h), pre-authenticated direct download link for a
    stored file, for files too big to stream through the API. Callers MUST
    authorize the user first: the link itself is the credential."""
    if not site_id:
        raise HTTPException(status_code=503, detail="SharePoint site ID is not configured")
    encoded_path = "/".join(_encode_path_segment(p) for p in (file_path or "").split("/") if p)
    token = await get_app_graph_token()
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(
            f"{GRAPH_API}/sites/{site_id}/drive/root:/{encoded_path}",
            params={"select": "id,name,@microsoft.graph.downloadUrl"},
            headers={"Authorization": f"Bearer {token}"},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Could not get a download link for {file_path}: {response.text[:200]}")
    url = response.json().get("@microsoft.graph.downloadUrl")
    if not url:
        raise HTTPException(status_code=502, detail=f"SharePoint returned no download link for {file_path}.")
    return url
