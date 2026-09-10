"""业务错误类型与响应封装。
错误格式：{ error: { code, message, details? } }
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def not_found(resource: str = "资源") -> AppError:
    return AppError(404, "NOT_FOUND", f"{resource}不存在")


def conflict(message: str) -> AppError:
    return AppError(409, "CONFLICT", message)


def validation_error(message: str, details: Any = None) -> AppError:
    return AppError(400, "VALIDATION_ERROR", message, details)
