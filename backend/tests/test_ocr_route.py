"""小票 OCR 路由的错误语义与响应结构；用桩替换侧车调用，不连接网络。"""

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app
from app.routes import ocr as ocr_route


def canned_lines():
    return [
        {"text": "农夫山泉", "score": 0.98, "box": [[20, 100], [120, 100], [120, 120], [20, 120]]},
        {"text": "2.00", "score": 0.95, "box": [[420, 100], [500, 100], [500, 120], [420, 120]]},
    ]


class OcrRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_receipt_returns_editable_draft(self):
        with mock.patch.object(ocr_route, "_recognize", return_value=canned_lines()):
            response = self.client.post(
                "/api/ocr/receipts",
                files={"file": ("receipt.jpg", b"fake-image-bytes", "image/jpeg")},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["meta"], {"line_count": 2})
        items = body["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "农夫山泉")
        self.assertEqual(items[0]["price_text"], "2.00")

    def test_missing_file_field_is_validation_error(self):
        response = self.client.post("/api/ocr/receipts", files={"wrong": ("x.jpg", b"x", "image/jpeg")})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")

    def test_empty_upload_is_validation_error(self):
        response = self.client.post(
            "/api/ocr/receipts",
            files={"file": ("receipt.jpg", b"", "image/jpeg")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")

    def test_unavailable_sidecar_translates_to_503(self):
        with mock.patch.object(
            ocr_route, "_recognize",
            side_effect=ocr_route.AppError(503, "OCR_SERVICE_UNAVAILABLE", "识别服务不可用"),
        ):
            response = self.client.post(
                "/api/ocr/receipts",
                files={"file": ("receipt.jpg", b"fake", "image/jpeg")},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "OCR_SERVICE_UNAVAILABLE")

    def test_unreadable_image_translates_to_422(self):
        with mock.patch.object(
            ocr_route, "_recognize",
            side_effect=ocr_route.AppError(422, "OCR_UNREADABLE_IMAGE", "无法识别"),
        ):
            response = self.client.post(
                "/api/ocr/receipts",
                files={"file": ("receipt.jpg", b"fake", "image/jpeg")},
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "OCR_UNREADABLE_IMAGE")


if __name__ == "__main__":
    unittest.main()
