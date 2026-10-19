"""Adds signed record references (core/record_ref.py) to JSON API responses
when the caller sends `X-Record-Refs: 1` — the portal frontend always does;
scripts, tests and integrations get the plain response unchanged."""
import json

from app.core.record_ref import add_refs

HEADER = b"x-record-refs"


class RecordRefMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/") or \
                dict(scope.get("headers") or []).get(HEADER) != b"1":
            return await self.app(scope, receive, send)

        start = None
        chunks: list[bytes] = []
        passthrough = False

        async def wrapped_send(message):
            nonlocal start, passthrough
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers") or [])
                ctype = headers.get(b"content-type", b"")
                if not ctype.startswith(b"application/json"):
                    passthrough = True
                    return await send(message)
                start = message
                return None
            if passthrough or message["type"] != "http.response.body":
                return await send(message)
            chunks.append(message.get("body", b""))
            if message.get("more_body"):
                return None
            body = b"".join(chunks)
            try:
                body = json.dumps(add_refs(json.loads(body)), ensure_ascii=False, separators=(",", ":")).encode()
            except ValueError:
                pass
            headers = [(k, v) for k, v in start.get("headers", []) if k.lower() != b"content-length"]
            headers.append((b"content-length", str(len(body)).encode()))
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, wrapped_send)
