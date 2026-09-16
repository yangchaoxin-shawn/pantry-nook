"""媒体文件边界与上传请求体限制。"""
import asyncio
import json
import os
from pathlib import Path
import shutil
import signal
import sys

from starlette.responses import JSONResponse
from .errors import AppError

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_REQUEST_BYTES = 52 * 1024 * 1024
PROCESS_LOCK = 726140913


def media_root() -> Path:
    value = os.getenv('MEDIA_ROOT')
    if not value:
        raise AppError(503, 'MEDIA_UNAVAILABLE', '图片存储尚未配置')
    root = Path(value).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def check_space(root: Path) -> None:
    reserve = max(0, int(os.getenv('MEDIA_MIN_FREE_BYTES', str(512 * 1024 * 1024))))
    if shutil.disk_usage(root).free < reserve + MAX_REQUEST_BYTES * 3:
        raise AppError(507, 'MEDIA_STORAGE_FULL', '图片存储空间不足，请稍后再试')


def safe_path(relative: str) -> Path:
    root = media_root()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise AppError(404, 'NOT_FOUND', '图片不存在')
    return path


async def process_media(directory: Path) -> dict:
    # 独立进程使原生解码卡死也能终止；子进程工具本身还有更短超时。
    proc = await asyncio.create_subprocess_exec(
        sys.executable, '-m', 'app.journal_worker', str(directory),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        start_new_session=(os.name != 'nt'))
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=100)
    except (TimeoutError, asyncio.CancelledError):
        if os.name == 'nt':
            killer = await asyncio.create_subprocess_exec('taskkill', '/PID', str(proc.pid), '/T', '/F',
                                                          stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await killer.wait()
        else:
            os.killpg(proc.pid, signal.SIGKILL)
        await proc.communicate()
        raise AppError(422, 'MEDIA_PROCESSING_TIMEOUT', '照片处理超时，请重试或减少图片大小')
    try:
        payload = json.loads(stdout)
    except (ValueError, UnicodeError):
        raise AppError(422, 'INVALID_MEDIA', '文件无法处理，请检查原片')
    if proc.returncode:
        raise AppError(503 if proc.returncode == 2 else 422, 'INVALID_MEDIA', payload.get('error', '文件无法处理'))
    return payload['data']


class JournalBodyLimit:
    """在 multipart 解析写临时文件之前检查整个请求体，包括 chunked 请求。"""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('method') != 'POST' or scope.get('path') != '/api/journal/uploads':
            return await self.app(scope, receive, send)
        response = JSONResponse({'error': {'code': 'UPLOAD_TOO_LARGE', 'message': '上传请求不得超过 52 MiB'}}, status_code=413)
        headers = dict(scope.get('headers', []))
        try:
            if int(headers.get(b'content-length', b'0')) > MAX_REQUEST_BYTES:
                return await response(scope, receive, send)
        except ValueError:
            return await JSONResponse({'error': {'code': 'VALIDATION_ERROR', 'message': '请求长度无效'}}, status_code=400)(scope, receive, send)
        size = 0
        exceeded = False
        rejection_sent = False

        async def limited_receive():
            nonlocal size, exceeded
            message = await receive()
            size += len(message.get('body', b''))
            if size > MAX_REQUEST_BYTES:
                exceeded = True
                # Multipart 会将此异常转为 400，统一在 send 边界替换为 413。
                from starlette.exceptions import HTTPException
                raise HTTPException(413, '上传请求过大')
            return message

        async def limited_send(message):
            nonlocal rejection_sent
            if exceeded:
                if not rejection_sent:
                    rejection_sent = True
                    await response(scope, receive, send)
                return
            await send(message)

        await self.app(scope, limited_receive, limited_send)
