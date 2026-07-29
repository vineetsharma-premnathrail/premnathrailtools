import re
from urllib.parse import quote
from fastapi import HTTPException, UploadFile
import httpx
from app.core.config import settings
from app.auth.microsoft import get_app_graph_token

GRAPH_API = "https://graph.microsoft.com/v1.0"
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2 GB practical limit
SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024  # Graph simple upload limit
CHUNK_SIZE = 10 * 1024 * 1024  # 10 MB per chunk
ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".rtf", ".odt", ".png", ".jpg", ".jpeg", ".gif",
    ".bmp", ".mp4", ".mov", ".mkv", ".avi", ".wmv", ".webm",
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


def build_sharepoint_folder_path(user_name: str, project_name: str, service_request_number: str) -> str:
    root_folder = sanitize_folder_name(settings.SHAREPOINT_FOLDER or "ERP-media")
    user_folder = sanitize_folder_name(user_name or "unknown")
    project_folder = sanitize_folder_name(project_name or "project")
    service_folder = sanitize_folder_name(service_request_number or "service-request")
    return f"{root_folder}/{user_folder}/{project_folder}/{service_folder}"
