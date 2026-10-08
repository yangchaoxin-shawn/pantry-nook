FROM python:3.13-slim

# uv 经清华 pypi 源安装：ghcr.io 直连国内不可达，不使用 COPY --from 镜像方式。
# 版本锁定 0.12.10 与 uv.lock 格式兼容。
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple uv==0.12.10

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_DEFAULT_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple" \
    PATH="/app/.venv/bin:$PATH" \
    MEDIA_ROOT="/data/media"

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app
COPY migrations ./migrations
COPY scripts ./scripts

EXPOSE 3000
CMD ["python", "scripts/start_server.py"]
