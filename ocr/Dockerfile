# Pantry Nook OCR 侧车镜像：paddlepaddle CPU 推理 + 模型烘焙进镜像层。
# python:3.12 对齐 ocr/pyproject.toml 的 requires-python（paddlepaddle 3.3.1 不支持 3.13）。
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.10 /uv /uvx /bin/

# slim 镜像没有 OpenCV 运行时需要的系统库（libGL.so.1 等），容器内 import cv2 必需。
# 国内构建直连 deb.debian.org 很慢，构建期换清华 Debian 源（只影响本镜像的 apt 层）。
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
# 锁文件带哈希校验，换国内 PyPI 镜像不改变完整性；UV_DEFAULT_INDEX 只作用于本层。
RUN UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple uv sync --frozen --no-dev

COPY app ./app

# 构建期加载一次引擎：模型在此时下载进镜像层（约几十 MB），运行期不再联网。
# 国内构建走 modelscope 源；模型缓存默认在 /root/.paddlex，随镜像保留。
RUN PADDLE_PDX_MODEL_SOURCE=modelscope .venv/bin/python -c "from app.main import _load_engine; _load_engine()"

EXPOSE 9610
# 容器内必须监听 0.0.0.0：宿主机只经 Docker 网络访问，不发布端口。
CMD [".venv/bin/python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9610"]
