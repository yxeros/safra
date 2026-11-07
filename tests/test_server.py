import importlib.util
import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("safra_server", ROOT / "server.py")
server_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server_module)


class LocalDataApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_data_dir = server_module.DATA_DIR
        self.original_data_file = server_module.DATA_FILE
        server_module.DATA_DIR = Path(self.temp_dir.name) / "Safra"
        server_module.DATA_FILE = server_module.DATA_DIR / "records.json"
        self.server = server_module.ThreadingHTTPServer(("127.0.0.1", 0), server_module.SafraHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        server_module.DATA_DIR = self.original_data_dir
        server_module.DATA_FILE = self.original_data_file
        self.temp_dir.cleanup()

    def request(self, method, path, payload=None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=3)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        result = response.status, response.read(), {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return result

    def test_local_api_round_trips_unicode_data_to_separate_json_file(self):
        status, body, headers = self.request("GET", "/api/data")
        self.assertEqual(status, 404)
        self.assertEqual(headers["cache-control"], "no-store")

        data = {
            "records": [{"id": "t1", "destination": "Zé", "stufasDone": 0.8}],
            "stufas": [{"id": "s1", "name": "Estufada 01"}],
            "people": {"workers": ["Eros", "Pablo"], "employers": ["Zé"]},
        }
        status, body, _ = self.request("PUT", "/api/data", {"data": data, "savedAt": 123456})
        self.assertEqual(status, 200, body.decode("utf-8"))
        self.assertEqual(json.loads(body)["savedAt"], 123456)
        self.assertTrue(server_module.DATA_FILE.is_file())

        status, body, headers = self.request("GET", "/api/data")
        self.assertEqual(status, 200)
        self.assertEqual(headers["cache-control"], "no-store")
        saved = json.loads(body)
        self.assertEqual(saved, {"data": data, "savedAt": 123456})
        self.assertEqual(json.loads(server_module.DATA_FILE.read_text(encoding="utf-8"))["_savedAt"], 123456)

        updated = {**data, "records": [{"id": "t2", "destination": "Nelson", "stufasDone": 0.2}]}
        status, body, _ = self.request("PUT", "/api/data", {"data": updated, "savedAt": 123457})
        self.assertEqual(status, 200, body.decode("utf-8"))
        backups = list((server_module.DATA_DIR / "backups").glob("records-*.json"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text(encoding="utf-8"))["records"], data["records"])
        status, body, _ = self.request("GET", "/api/data")
        self.assertEqual(json.loads(body), {"data": updated, "savedAt": 123457})

    def test_invalid_data_is_rejected_without_creating_a_saved_file(self):
        status, body, _ = self.request("PUT", "/api/data", {"data": {"records": []}})
        self.assertEqual(status, 400, body.decode("utf-8"))
        self.assertFalse(server_module.DATA_FILE.exists())

        status, body, _ = self.request("PUT", "/api/data", [])
        self.assertEqual(status, 400, body.decode("utf-8"))
        self.assertFalse(server_module.DATA_FILE.exists())

    def test_static_app_assets_are_served_from_the_same_origin(self):
        status, body, headers = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Organizador de colheita", body)
        self.assertIn("text/html", headers["content-type"])

        status, body, _ = self.request("GET", "/domain.js")
        self.assertEqual(status, 200)
        self.assertIn(b"exchangeLedger", body)


if __name__ == "__main__":
    unittest.main()
