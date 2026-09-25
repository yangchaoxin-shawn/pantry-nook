"""小票识别的识别服务存根：返回一张固定小票的 OCR 行，不做真实识别。

用于位置习惯走查（scripts/ocr_location_walkthrough.py），让隔离后端的
OCR_SERVICE_URL 指向它，既不依赖也不占用真实的 PP-OCRv6 侧车。
覆盖：同名习惯（沙葱）、内置关键词（黄心土豆、速冻饺子）、同类多数（芒果）、
分类默认（莴笋、酸奶、五指毛桃）以及无法自动分类的行（进口神秘礼盒）。

    uv run python scripts/ocr_stub_sidecar.py --port 9611
"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

ITEMS = [
    ("沙葱", "0.398", "11.06"),
    ("黄心土豆", "0.358", "1.56"),
    ("莴笋", "0.424", "2.12"),
    ("速冻饺子", "1", "29.90"),
    ("风行酸奶180g", "1", "2.98"),
    ("五指毛桃切节", "0.030", "4.08"),
    ("芒果", "1", "12.80"),
    ("进口神秘礼盒", "1", "99.00"),
]


def box(x: int, y: int, w: int = 100, h: int = 20) -> list[list[int]]:
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]


LINES = []
for index, (name, qty, amount) in enumerate(ITEMS):
    y = 100 + index * 40
    LINES += [
        {"text": name, "score": 0.99, "box": box(20, y, 160)},
        {"text": qty, "score": 0.99, "box": box(300, y)},
        {"text": amount, "score": 0.99, "box": box(420, y)},
    ]


class Handler(BaseHTTPRequestHandler):
    def _send(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        self._send({"status": "ok", "engine": "stub", "loaded": True})

    def do_POST(self) -> None:
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self._send({"lines": LINES})

    def log_message(self, *_args) -> None:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="小票识别存根服务")
    parser.add_argument("--port", type=int, default=9611)
    port = parser.parse_args().port
    print(f"识别存根服务：http://127.0.0.1:{port}", flush=True)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
