#!/usr/bin/env python3
"""SharePoint side of the PremnathRail DB backup (Microsoft Graph, app-only, stdlib only).

  upload.py check                    token + site + folders reachable (run once after setup)
  upload.py upload <file>...         upload to Daily (+Weekly on Sunday, +Monthly on the 1st), verify size, prune
  upload.py list [Daily|Weekly|Monthly]
  upload.py download <tier> <name> <dest_dir>
  upload.py alert "<message>"        post to the Teams webhook (ALERT_WEBHOOK_URL), if set
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
GRAPH = "https://graph.microsoft.com/v1.0"
CHUNK = 320 * 1024 * 32  # 10 MiB; Graph requires multiples of 320 KiB
PREFIXES = ("premnathrail_db_", "premnathrail_globals_")


def load_env():
    path = os.path.join(BASE, ".env")
    if not os.path.exists(path):
        sys.exit(f"Missing {path} - copy .env.example to .env and fill it in.")
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


def env(name, default=None):
    value = os.environ.get(name, "") or default
    if value is None:
        sys.exit(f"{name} is empty in {BASE}/.env")
    return value


def request(method, url, body=None, headers=None, raw=False, retries=4):
    """HTTP call with retry on 429/5xx. Returns parsed JSON (or bytes when raw=True)."""
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    hdrs = dict(headers or {})
    if body is not None and not isinstance(body, bytes):
        hdrs["Content-Type"] = "application/json"
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                payload = resp.read()
                if raw:
                    return payload
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:500]
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(int(e.headers.get("Retry-After") or 2 ** (attempt + 2)))
                continue
            raise RuntimeError(f"{method} {url.split('?')[0]} -> HTTP {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 2))
                continue
            raise RuntimeError(f"{method} {url.split('?')[0]} -> network error: {e.reason}") from None


class Graph:
    def __init__(self):
        form = urllib.parse.urlencode({
            "client_id": env("AZURE_CLIENT_ID"),
            "client_secret": env("AZURE_CLIENT_SECRET"),
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        }).encode()
        try:
            tok = request("POST", f"https://login.microsoftonline.com/{env('AZURE_TENANT_ID')}/oauth2/v2.0/token",
                          form, {"Content-Type": "application/x-www-form-urlencoded"})
        except RuntimeError as e:
            sys.exit(f"Azure login failed (check AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET, "
                     f"and whether the client secret has expired): {e}")
        self.auth = {"Authorization": f"Bearer {tok['access_token']}"}
        drive_id = env("SHAREPOINT_DRIVE_ID", "")
        self.drive = f"{GRAPH}/drives/{drive_id}" if drive_id else f"{GRAPH}/sites/{env('SHAREPOINT_SITE_ID')}/drive"
        self.root = env("SHAREPOINT_BACKUP_FOLDER", "Database Backups").strip("/")

    def call(self, method, path, body=None, **kw):
        url = path if path.startswith("http") else self.drive + path
        return request(method, url, body, self.auth, **kw)

    @staticmethod
    def enc(path):
        return urllib.parse.quote(path)

    def ensure_folder(self, path):
        parent = ""
        for part in path.split("/"):
            current = f"{parent}/{part}" if parent else part
            try:
                self.call("GET", f"/root:/{self.enc(current)}")
            except RuntimeError as e:
                if "HTTP 404" not in str(e):
                    raise
                target = f"/root:/{self.enc(parent)}:/children" if parent else "/root/children"
                self.call("POST", target, {"name": part, "folder": {},
                                           "@microsoft.graph.conflictBehavior": "fail"})
            parent = current

    def upload(self, local, folder):
        name = os.path.basename(local)
        size = os.path.getsize(local)
        session = self.call("POST", f"/root:/{self.enc(folder + '/' + name)}:/createUploadSession",
                            {"item": {"@microsoft.graph.conflictBehavior": "replace"}})
        upload_url, item, offset = session["uploadUrl"], None, 0
        with open(local, "rb") as f:
            while offset < size:
                chunk = f.read(CHUNK)
                end = offset + len(chunk) - 1
                # The pre-authenticated upload URL must NOT get the Authorization header
                item = request("PUT", upload_url, chunk, {
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {offset}-{end}/{size}",
                })
                offset = end + 1
        if not item or item.get("size") != size:
            raise RuntimeError(f"Uploaded size mismatch for {name}: local {size}, SharePoint {item and item.get('size')}")
        print(f"  uploaded {folder}/{name} ({size / 1048576:.1f} MiB, verified)")

    def children(self, folder):
        items, url = [], f"/root:/{self.enc(folder)}:/children?$select=id,name,size,lastModifiedDateTime&$top=200"
        while url:
            page = self.call("GET", url)
            items += page.get("value", [])
            url = page.get("@odata.nextLink")
        return items

    def prune(self, folder, keep):
        items = self.children(folder)
        for prefix in PREFIXES:
            mine = sorted((i for i in items if i["name"].startswith(prefix)), key=lambda i: i["name"], reverse=True)
            for old in mine[keep:]:
                self.call("DELETE", f"/items/{old['id']}", raw=True)
                print(f"  pruned {folder}/{old['name']}")


def tiers_for(today):
    tiers = [("Daily", int(env("KEEP_DAILY", "30")))]
    if today.weekday() == 6:
        tiers.append(("Weekly", int(env("KEEP_WEEKLY", "12"))))
    if today.day == 1:
        tiers.append(("Monthly", int(env("KEEP_MONTHLY", "12"))))
    return tiers


def alert(message):
    url = os.environ.get("ALERT_WEBHOOK_URL", "")
    if not url:
        print("ALERT_WEBHOOK_URL not set; alert only in log:", message)
        return
    card = {"type": "message", "attachments": [{
        "contentType": "application/vnd.microsoft.card.adaptive",
        "content": {"type": "AdaptiveCard", "version": "1.4",
                    "body": [{"type": "TextBlock", "text": message, "wrap": True, "color": "Attention"}]},
    }]}
    request("POST", url, card, retries=2)


def main():
    load_env()
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    if cmd == "alert":
        alert(" ".join(args))
        return
    g = Graph()
    if cmd == "check":
        drive = g.call("GET", "?$select=name,webUrl,quota")
        print(f"Login OK. Library: {drive.get('name')} ({drive.get('webUrl')})")
        for tier in ("Daily", "Weekly", "Monthly"):
            g.ensure_folder(f"{g.root}/{tier}")
        print(f"Folders ready under '{g.root}'. Free space: {drive.get('quota', {}).get('remaining', 0) / 1073741824:.1f} GiB")
    elif cmd == "upload" and args:
        for tier, keep in tiers_for(datetime.date.today()):
            folder = f"{g.root}/{tier}"
            g.ensure_folder(folder)
            for path in args:
                g.upload(path, folder)
            g.prune(folder, keep)
    elif cmd == "list":
        for tier in args or ("Daily", "Weekly", "Monthly"):
            print(f"== {tier}")
            for i in sorted(g.children(f"{g.root}/{tier}"), key=lambda i: i["name"]):
                print(f"  {i['name']}  {i['size'] / 1048576:.1f} MiB  {i['lastModifiedDateTime']}")
    elif cmd == "download" and len(args) == 3:
        tier, name, dest = args
        item = g.call("GET", f"/root:/{g.enc(f'{g.root}/{tier}/{name}')}")
        # Pre-authenticated link; fetched without the Graph token
        data = request("GET", item["@microsoft.graph.downloadUrl"], raw=True)
        out = os.path.join(dest, name)
        with open(out, "wb") as f:
            f.write(data)
        print(f"Saved {out} ({len(data) / 1048576:.1f} MiB)")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        sys.exit(f"ERROR: {e}")
