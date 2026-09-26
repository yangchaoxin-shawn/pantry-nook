"""JSON 请求体解析的错误语义：坏编码或坏格式按 400 参数错误返回，而不是 500。

起因：客户端发送非 UTF-8 编码的请求体时，request.json() 抛 UnicodeDecodeError，
被兜底成 500 INTERNAL_ERROR；正确语义是 400 参数错误。read_json_object 统一收口。
"""

import asyncio
import unittest

from fastapi.testclient import TestClient
from starlette.requests import Request

from app.errors import AppError
from app.main import app
from app.validation import read_json_object


def make_request(raw: bytes) -> Request:
    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}

    return Request({"type": "http", "method": "POST", "headers": []}, receive)


class ReadJsonObjectTests(unittest.TestCase):
    def assert_rejected(self, raw: bytes) -> None:
        with self.assertRaises(AppError) as ctx:
            asyncio.run(read_json_object(make_request(raw)))
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(ctx.exception.code, "VALIDATION_ERROR")

    def test_invalid_encoding_is_400(self):
        self.assert_rejected(b"\xb9\xfe")

    def test_malformed_json_is_400(self):
        self.assert_rejected(b'{"items": [1, 2')

    def test_non_object_json_is_400(self):
        self.assert_rejected(b"[1, 2]")

    def test_empty_body_is_400_by_default(self):
        self.assert_rejected(b"")

    def test_empty_body_allowed_when_optional(self):
        self.assertEqual(asyncio.run(read_json_object(make_request(b""), allow_empty=True)), {})

    def test_valid_object_passes_through(self):
        self.assertEqual(asyncio.run(read_json_object(make_request(b'{"items": [1]}'))), {"items": [1]})


class BatchRouteJsonTests(unittest.TestCase):
    """路由层同样返回 400；这些用例在进入数据库前就被拦下，不需要连接池。"""

    def setUp(self):
        self.client = TestClient(app)

    def assert_bad_body_is_validation_error(self, payload: bytes):
        response = self.client.post(
            "/api/ingredients/batch",
            content=payload,
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 400)
        error = response.json()["error"]
        self.assertEqual(error["code"], "VALIDATION_ERROR")
        self.assertNotIn("There was an error", error["message"])

    def test_batch_rejects_invalid_encoding_with_400(self):
        self.assert_bad_body_is_validation_error(b"\xb9\xfe")

    def test_batch_rejects_non_object_json_with_400(self):
        self.assert_bad_body_is_validation_error(b"[1, 2]")

    def test_journal_pydantic_body_rejects_invalid_encoding_with_400(self):
        """手记等 Pydantic 声明式端点也统一中文 400（FastAPI 把坏编码包成英文 400）。"""
        response = self.client.post(
            "/api/journal/entries",
            content=b"\xb9\xfe",
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(response.json()["error"]["message"], "请求体不是有效的 JSON 文本")


if __name__ == "__main__":
    unittest.main()
