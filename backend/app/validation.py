"""请求校验工具。

错误文案与校验规则集中维护，确保 API 行为稳定。
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import Request

from .errors import validation_error as _validation_error


def ensure_object_body(value: Any) -> dict:
    """请求体必须是对象（对应 requestBody）。"""
    if value is None or not isinstance(value, dict) or isinstance(value, list):
        raise _validation_error("请求体必须是对象")
    return value


async def read_json_object(request: Request, allow_empty: bool = False) -> dict:
    """读取 JSON 对象请求体；坏编码或坏格式按 400 参数错误返回，而不是 500。"""
    raw = await request.body()
    if not raw:
        if allow_empty:
            return {}
        raise _validation_error("请求体不能为空")
    try:
        body = json.loads(raw)
    except ValueError:
        # json.JSONDecodeError 与无效编码（UnicodeDecodeError）都归为参数错误。
        raise _validation_error("请求体不是有效的 JSON 文本")
    return ensure_object_body(body)


def parse_id(value: Any, field_name: str = "id") -> int:
    """id 必须为正整数（对应 parseId）。"""
    try:
        id_int = int(value)
    except (TypeError, ValueError, OverflowError):
        raise _validation_error(f"{field_name} 必须是正整数")
    if isinstance(value, bool) or (isinstance(value, (float, Decimal)) and value != id_int) or id_int <= 0:
        raise _validation_error(f"{field_name} 必须是正整数")
    # 与 Node Number.isSafeInteger 语义一致
    if id_int > 9007199254740991:
        raise _validation_error(f"{field_name} 必须是正整数")
    return id_int


def required_text(value: Any, field_name: str, max_length: int = 255) -> str:
    """必填文本（对应 requiredText）。"""
    if not isinstance(value, str) or value.strip() == "":
        raise _validation_error(f"{field_name} 为必填项")
    text = value.strip()
    if len(text) > max_length:
        raise _validation_error(f"{field_name} 不能超过 {max_length} 个字符")
    return text


def optional_text(value: Any, field_name: str, max_length: int = 255):
    """可空文本（对应 optionalText），'' 与 null 归一为 None。"""
    if value is None:
        return None
    if isinstance(value, str) and value == "":
        return None
    if not isinstance(value, str) or value is None:
        raise _validation_error(f"{field_name} 必须是文本")
    text = value.strip()
    if len(text) > max_length:
        raise _validation_error(f"{field_name} 不能超过 {max_length} 个字符")
    return text or None


def optional_number(value: Any, field_name: str, min_value: float = 0, exclusive_min: bool = False):
    """可空十进制数量，与 NUMERIC(15,6) 精度一致，不允许静默舍入。"""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, bool):
            raise ValueError
        number = Decimal(str(value))
        if not number.is_finite():
            raise ValueError
    except (InvalidOperation, TypeError, ValueError):
        raise _validation_error(f"{field_name} 必须是有限数字")
    invalid_range = number <= min_value if exclusive_min else number < min_value
    if invalid_range:
        operator = "大于" if exclusive_min else "大于或等于"
        raise _validation_error(f"{field_name} 必须是{operator} {min_value:g} 的数字")
    if number > Decimal("999999999.999999") or number != number.quantize(Decimal("0.000001")):
        raise _validation_error(f"{field_name} 最多 9 位整数和 6 位小数")
    return number


def optional_date(value: Any, field_name: str):
    """可选日期，必须 YYYY-MM-DD 且真实存在（对应 optionalDate）。

    返回 datetime.date 对象以便 asyncpg 正确绑定 DATE 列；
    响应端经 jsonable() 序列化为 'YYYY-MM-DD' 字符串，与 Node 版输出一致。
    """
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not _date_regex(value):
        raise _validation_error(f"{field_name} 必须使用 YYYY-MM-DD 格式")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise _validation_error(f"{field_name} 不是有效日期")


def _date_regex(value: str) -> bool:
    if len(value) != 10:
        return False
    parts = value.split("-")
    if len(parts) != 3:
        return False
    y, m, d = parts
    return len(y) == 4 and len(m) == 2 and len(d) == 2 and y.isdigit() and m.isdigit() and d.isdigit()


def enum_value(value: Any, field_name: str, allowed: list[str], optional: bool = False):
    """枚举校验（对应 enumValue）。"""
    if optional and (value is None or value == ""):
        return None if value is None else None
    if value not in allowed:
        raise _validation_error(f"{field_name} 只能是：{'、'.join(allowed)}")
    return value


def pagination(query: dict):
    """分页校验 limit/offset（对应 pagination）。"""
    try:
        limit = int(query.get("limit", 50))
    except (TypeError, ValueError):
        limit = -1
    try:
        offset = int(query.get("offset", 0))
    except (TypeError, ValueError):
        offset = -1
    if limit < 1 or limit > 100:
        raise _validation_error("limit 必须是 1 到 100 之间的整数")
    if offset < 0:
        raise _validation_error("offset 必须是大于或等于 0 的整数")
    return {"limit": limit, "offset": offset}


def dishes_array(value: Any) -> list[str]:
    """菜品名称数组校验（对应 dishesArray）。"""
    if not isinstance(value, list):
        raise _validation_error("dishes 必须是菜品名称数组")
    dishes = [required_text(item, f"dishes[{i}]", 255) for i, item in enumerate(value)]
    if len(dishes) == 0:
        raise _validation_error("至少需要填写一个菜品")
    if len(dishes) > 50:
        raise _validation_error("一条做菜记录最多包含 50 个菜品")
    return dishes


def like_pattern(text: str) -> str:
    """把用户搜索词转成安全的 LIKE 模式：转义 %、_ 与转义符本身。"""
    backslash = chr(92)
    return "%" + text.replace(backslash, backslash + backslash).replace("%", backslash + "%").replace("_", backslash + "_") + "%"
