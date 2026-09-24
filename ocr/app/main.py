"""Pantry Nook 小票 OCR 侧车服务。

只做一件事：接收图片，用 PP-OCRv6 返回行级文本、置信度与坐标。
不解析业务字段、不落盘、不连数据库；进程内只加载一份模型。
首次启动会下载模型（约几十 MB），之后走本地缓存。
"""

from __future__ import annotations

import io
import os
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

import pillow_heif

# iPhone 原图常为 HEIC；注册解码器后与 JPEG/PNG 一致处理。
pillow_heif.register_heif_opener()

MAX_IMAGE_BYTES = int(os.getenv("OCR_MAX_IMAGE_BYTES", str(15 * 1024 * 1024)))
# 手机原图普遍 3000px 以上；缩边控制 CPU 推理耗时，小票文字仍可辨认。
MAX_SIDE_PIXELS = int(os.getenv("OCR_MAX_SIDE_PIXELS", "2200"))

_engine = None


def _load_engine():
    from paddleocr import PaddleOCR

    # 小票是正对拍摄的打印文字，关闭文档矫正与方向分类，省去额外模型与耗时。
    return PaddleOCR(
        ocr_version="PP-OCRv6",
        lang="ch",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _engine
    _engine = _load_engine()
    yield


app = FastAPI(title="Pantry Nook OCR", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "engine": "PP-OCRv6", "loaded": _engine is not None}


def _to_array(image: bytes) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(image)) as picture:
            picture = ImageOps.exif_transpose(picture).convert("RGB")
            side = max(picture.size)
            if side > MAX_SIDE_PIXELS:
                scale = MAX_SIDE_PIXELS / side
                picture = picture.resize((max(1, round(picture.width * scale)), max(1, round(picture.height * scale))))
            return np.asarray(picture)
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(status_code=422, detail="图片无法解码") from error


@app.post("/ocr")
async def recognize(file: UploadFile = File(...)):
    image = await file.read()
    if not image:
        raise HTTPException(status_code=422, detail="图片内容为空")
    if len(image) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="图片过大")
    assert _engine is not None  # lifespan 启动后必不为 None
    try:
        results = _engine.predict(_to_array(image))
    except HTTPException:
        raise
    except Exception as error:  # 推理层异常统一按不可识别处理
        raise HTTPException(status_code=422, detail=f"识别失败：{error}") from error

    lines = []
    for result in results:
        texts = result.get("rec_texts", [])
        scores = result.get("rec_scores", [])
        polys = result.get("rec_polys")
        if polys is None:
            boxes = result.get("rec_boxes")
            polys = [[[x, y], [x, y], [x, y], [x, y]] for x, y in (boxes or [])]
        for text, score, poly in zip(texts, scores, polys):
            points = [list(map(int, point)) for point in np.asarray(poly).reshape(-1, 2).tolist()]
            lines.append({"text": str(text), "score": float(score), "box": points})
    return {"lines": lines}
