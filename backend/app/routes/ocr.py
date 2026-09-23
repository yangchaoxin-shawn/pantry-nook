"""购物小票 OCR：接收图片，转交侧车识别，返回可编辑入库草稿。

识别服务是独立部署的 ocr/ 侧车（PP-OCRv6），本路由只做转发、
限额和草稿解析；不保存图片，也不产生任何库存写入。
"""

from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Request

from ..errors import AppError, validation_error
from ..receipt_parse import parse_receipt_lines
from ..responses import ok

router = APIRouter()

DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024


def _sidecar_url() -> str:
    return os.getenv("OCR_SERVICE_URL", "http://127.0.0.1:9610").rstrip("/")


def _timeout_seconds() -> float:
    return float(os.getenv("OCR_TIMEOUT_SECONDS", "90"))


def _max_image_bytes() -> int:
    return int(os.getenv("OCR_MAX_IMAGE_BYTES", str(DEFAULT_MAX_IMAGE_BYTES)))


async def _recognize(image: bytes, content_type: str | None) -> list[dict]:
    """调用 OCR 侧车；把网络与协议故障翻译成统一错误。"""
    try:
        async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
            response = await client.post(
                _sidecar_url() + "/ocr",
                files={"file": ("receipt", image, content_type or "application/octet-stream")},
            )
    except httpx.HTTPError:
        raise AppError(503, "OCR_SERVICE_UNAVAILABLE", "识别服务不可用，请确认 OCR 侧车服务已启动")
    if response.status_code == 422:
        raise AppError(422, "OCR_UNREADABLE_IMAGE", "无法从该图片识别出文字，请重拍或换一张清晰的小票")
    if response.status_code != 200:
        raise AppError(502, "OCR_SERVICE_ERROR", "识别服务返回异常，请稍后重试")
    payload = response.json()
    lines = payload.get("lines") if isinstance(payload, dict) else None
    if not isinstance(lines, list):
        raise AppError(502, "OCR_SERVICE_ERROR", "识别服务返回格式异常，请稍后重试")
    return lines


@router.post("/receipts")
async def analyze_receipt(request: Request):
    form = await request.form()
    upload = form.get("file")
    if upload is None or isinstance(upload, str):
        raise validation_error("请以 multipart 字段 file 上传小票图片")
    image = await upload.read()
    if not image:
        raise validation_error("小票图片内容为空")
    if len(image) > _max_image_bytes():
        raise AppError(413, "OCR_IMAGE_TOO_LARGE", "小票图片过大，请压缩后重试")
    lines = await _recognize(image, getattr(upload, "content_type", None))
    result = parse_receipt_lines(lines)
    return ok(result, {"line_count": len(lines)})
