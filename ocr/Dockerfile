# Pantry Nook OCR 侧车镜像：paddlepaddle CPU 推理 + 模型烘焙进镜像层。
# python:3.12 对齐 ocr/pyproject.toml 的 requires-python（paddlepaddle 3.3.1 不支持 3.13）。
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.10 /uv /uvx /bin/

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

# 构建期加载一次引擎：模型在此时下载进镜像层（约几十 MB），运行期不再联网。
# 国内构建走 modelscope 源；模型缓存默认在 /root/.paddlex，随镜像保留。
RUN PADDLE_PDX_MODEL_SOURCE=modelscope .venv/bin/python -c "from app.main import _load_engine; _load_engine()"

EXPOSE 9610
# 容器内必须监听 0.0.0.0：宿主机只经 Docker 网络访问，不发布端口。
CMD [".venv/bin/python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9610"]
