# 小票 OCR 侧车服务

Pantry Nook 的"拍小票入库"由两部分组成：backend 的 `/api/ocr/receipts`（转发与草稿解析）和本目录的独立 OCR 服务。侧车用 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 的 **PP-OCRv6_medium** 检测+识别模型，本地自部署、无需任何 API 密钥，图片不出本机。

> paddleocr 3.7.0 的 pip 自部署目前只内置 medium 一档模型；官方后续若放出 tiny/small 轮子，可在此升级。

## 运行

```bash
# 在 ocr/ 目录；首次启动会下载模型（几十 MB），之后走本地缓存
uv sync
PADDLE_PDX_MODEL_SOURCE=modelscope uv run uvicorn app.main:app --host 127.0.0.1 --port 9610
```

`PADDLE_PDX_MODEL_SOURCE=modelscope` 指定从国内镜像下载模型（默认 huggingface，国内可能连不上）；也可以用 `aistudio`。模型缓存在 `%USERPROFILE%\.paddlex`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OCR_MAX_IMAGE_BYTES` | 15728640 (15MB) | 单张图片大小上限 |
| `OCR_MAX_SIDE_PIXELS` | 2200 | 推理前把长边缩到该值，控制 CPU 耗时 |
| `PADDLE_PDX_MODEL_SOURCE` | huggingface | 模型下载源，国内建议 `modelscope` |

backend 侧相关变量：`OCR_SERVICE_URL`（默认 `http://127.0.0.1:9610`）、`OCR_TIMEOUT_SECONDS`（默认 300；密集中文整张小票在 Windows CPU 实测约 160 秒，超时会报 503）、`OCR_MAX_IMAGE_BYTES`。

## 接口

- `GET /health`：`{"status":"ok","engine":"PP-OCRv6","loaded":bool}`
- `POST /ocr`：multipart 字段 `file` 传图片，返回 `{"lines":[{"text","score","box"}]}`；图片无法解码返回 422，过大返回 413。

字段解析（品名/数量/单位）不在本服务做，统一在 backend 的 `app/receipt_parse.py`，便于测试和调整。

## 已知问题与兜底

- **Windows CPU 下侧车进程偶发进入坏状态**：进程存活，但每张图都失败，日志出现 `Unknown C++ exception from OpenCV code`（paddlepaddle/paddlex 内部触发，实测重启进程即恢复，根因未定位）。处理：重启本服务；backend 会把这类失败翻译成 502 `OCR_SERVICE_ERROR` 并提示重启侧车。
- backend 侧兜底见 `app/routes/ocr.py`：侧车不可达或超时 503、图片无法解码 422（透传侧车）、其余异常 502；均不写库存。
