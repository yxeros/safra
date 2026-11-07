from __future__ import annotations

import json
import os
import shutil
import threading
import webbrowser
from uuid import uuid4
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Safra"
DATA_FILE = DATA_DIR / "records.json"
HOST = "127.0.0.1"
PORT = int(os.environ.get("SAFRA_PORT", "8765"))


class SafraHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def _send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if urlparse(self.path).path == "/api/data":
            try:
                raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
                if not isinstance(raw, dict):
                    self._send_json(500, {"error": "local data file is not an object"})
                    return
                saved_at = int(raw.pop("_savedAt", DATA_FILE.stat().st_mtime * 1000))
                self._send_json(200, {"data": raw, "savedAt": saved_at})
            except FileNotFoundError:
                self._send_json(404, {"error": "no local data yet"})
            except (OSError, json.JSONDecodeError) as exc:
                self._send_json(500, {"error": f"could not read local data: {exc}"})
            return
        super().do_GET()

    def do_PUT(self):
        if urlparse(self.path).path != "/api/data":
            self._send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 10_000_000:
                self._send_json(413, {"error": "invalid payload size"})
                return
            request = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(request, dict):
                self._send_json(400, {"error": "invalid request"})
                return
            data = request.get("data")
            if not isinstance(data, dict) or not isinstance(data.get("records"), list) or not isinstance(data.get("stufas"), list) or not isinstance(data.get("people"), dict):
                self._send_json(400, {"error": "invalid Safra data"})
                return
            saved_at = int(request.get("savedAt") or datetime.now(timezone.utc).timestamp() * 1000)
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            payload = dict(data)
            payload["_savedAt"] = saved_at
            temp_file = DATA_FILE.with_name(f"{DATA_FILE.name}.{uuid4().hex}.tmp")
            temp_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            if DATA_FILE.is_file():
                backup_dir = DATA_DIR / "backups"
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_file = backup_dir / f"records-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}-{uuid4().hex[:8]}.json"
                shutil.copy2(DATA_FILE, backup_file)
                backups = sorted(backup_dir.glob("records-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
                for old_backup in backups[10:]:
                    old_backup.unlink()
            os.replace(temp_file, DATA_FILE)
            self._send_json(200, {"ok": True, "savedAt": saved_at})
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            if "temp_file" in locals():
                temp_file.unlink(missing_ok=True)
            self._send_json(500, {"error": f"could not save local data: {exc}"})

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), SafraHandler)
    print(f"Safra aberto em http://localhost:{PORT}")
    print(f"Dados guardados fora da pasta do app: {DATA_FILE}")
    if os.environ.get("SAFRA_OPEN_BROWSER", "1") != "0":
        threading.Timer(0.7, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor do Safra encerrado.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
