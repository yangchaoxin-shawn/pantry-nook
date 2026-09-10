"""FastAPI 入口与全局异常处理。
- 响应格式：成功 { data, meta? }；错误 { error: { code, message, details? } }
- /health 健康检查
- 404 路由兜底；业务错误走 AppError；其它异常统一 500
"""

from __future__ import annotations

import os
from json import JSONDecodeError

import asyncpg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .db import close_pool, get_pool
from .api_contract import install_openapi
from .errors import AppError
from .routes import consumptions, daily_battles, dishes, ingredients, inventory_adjustments, meal_plans

app = FastAPI(title="食隅记 Pantry Nook API", version="0.1.0", docs_url=None, redoc_url=None, openapi_url="/openapi.json")

frontend_origin = os.getenv("FRONTEND_ORIGIN", "")
allowed_origins = [origin.strip() for origin in frontend_origin.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载各资源路由，统一前缀 /api
app.include_router(ingredients.router, prefix="/api/ingredients", tags=["ingredients"])
app.include_router(inventory_adjustments.router, prefix="/api/inventory-adjustments", tags=["inventory-adjustments"])
app.include_router(dishes.router, prefix="/api/dishes", tags=["dishes"])
app.include_router(meal_plans.router, prefix="/api/meal-plans", tags=["meal-plans"])
app.include_router(daily_battles.router, prefix="/api/daily-battles", tags=["daily-battles"])
app.include_router(consumptions.router, prefix="/api/consumptions", tags=["consumptions"])


@app.get("/health")
async def health():
    pool = await get_pool()
    await pool.fetchval("SELECT 1")
    return {"status": "ok", "database": "connected"}


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    status = exc.status
    body = {
        "error": {
            "code": exc.code,
            "message": exc.message,
        }
    }
    if status < 500 and exc.details:
        body["error"]["details"] = exc.details
    return JSONResponse(body, status_code=status)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    # 对齐 Node app.js:31 的 404 兜底格式
    if exc.status_code == 404:
        return JSONResponse(
            {"error": {"code": "ROUTE_NOT_FOUND", "message": "接口不存在"}},
            status_code=404,
        )
    return JSONResponse(
        {"error": {"code": "REQUEST_ERROR", "message": str(exc.detail)}},
        status_code=exc.status_code,
    )


@app.exception_handler(JSONDecodeError)
@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: Exception):
    return JSONResponse(
        {"error": {"code": "VALIDATION_ERROR", "message": "请求参数或 JSON 格式不正确"}},
        status_code=400,
    )


@app.exception_handler(asyncpg.exceptions.PostgresError)
async def pg_error_handler(request: Request, exc: asyncpg.exceptions.PostgresError):
    # 未捕获的数据库错误统一 500，避免泄露内部信息（对应 Node 的 err 兜底）
    return JSONResponse(
        {"error": {"code": "INTERNAL_ERROR", "message": "服务器内部错误"}},
        status_code=500,
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    return JSONResponse(
        {"error": {"code": "INTERNAL_ERROR", "message": "服务器内部错误"}},
        status_code=500,
    )


@app.on_event("shutdown")
async def shutdown():
    await close_pool()


install_openapi(app)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "3000")), reload=False)
