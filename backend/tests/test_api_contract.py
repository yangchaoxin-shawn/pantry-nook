"""请求错误回归与契约归档同步测试，不连接或修改数据库。"""

import json
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from app.main import app


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_invalid_json_returns_documented_error(self):
        for body in ("{", "", "null", "[]"):
            with self.subTest(body=body):
                response = self.client.post("/api/dishes", content=body,
                                            headers={"Content-Type": "application/json"})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")
                self.assertIsInstance(response.json()["error"]["message"], str)

    def test_non_integer_path_returns_documented_error(self):
        response = self.client.get("/api/ingredients/not-an-id")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")

    def test_unknown_route_has_common_error_envelope(self):
        response = self.client.get("/api/not-a-resource")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "ROUTE_NOT_FOUND")

    def test_live_contract_matches_archive_and_resolves_all_references(self):
        response = self.client.get("/openapi.json")
        self.assertEqual(response.status_code, 200)
        schema = response.json()
        archived = Path(__file__).resolve().parents[2] / "contracts" / "openapi.yaml"
        self.assertEqual(schema, json.loads(archived.read_text(encoding="utf-8")))

        def walk(value):
            if isinstance(value, dict):
                if "$ref" in value:
                    target = schema
                    for part in value["$ref"].removeprefix("#/").split("/"):
                        target = target[part]
                    self.assertTrue(target)
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)

        walk(schema)


if __name__ == "__main__":
    unittest.main()
