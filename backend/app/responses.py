"""HTTP 响应封装。

- ok    -> 200 { data, meta? }
- created -> 201 { data }
"""

from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse

from .db import jsonable


def ok(data: Any, meta: Any = None) -> JSONResponse:
    body = {"data": jsonable(data)}
    if meta is not None:
        body["meta"] = jsonable(meta)
    return JSONResponse(body)


def created(data: Any) -> JSONResponse:
    return JSONResponse({"data": jsonable(data)}, status_code=201)
