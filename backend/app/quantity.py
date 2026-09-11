"""库存数量的精确解析与展示。

实际用量允许用户填写十进制或简单分数；数据库统一保留六位小数，
但同一餐内先以 Decimal 汇总，再在写库存时量化，避免 1/3 连加造成的
前端浮点误差。
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
import re

from .errors import AppError, validation_error

SCALE = Decimal("0.000001")
MAX_VALUE = Decimal("999999999.999999")
_DECIMAL = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d+)?$|^\.\d+$")
_FRACTION = re.compile(r"^(0|[1-9]\d*)/([1-9]\d*)$")


def parse_usage_quantity(value: str) -> Decimal:
    """Parse an actual-usage field without accepting units or natural language."""
    text = value.strip()
    fraction = _FRACTION.fullmatch(text)
    if fraction:
        numerator, denominator = (int(part) for part in fraction.groups())
        if numerator > 999999999 or denominator > 1_000_000:
            raise validation_error("实际用量超出可计算范围")
        with localcontext() as context:
            context.prec = 36
            quantity = Decimal(numerator) / Decimal(denominator)
    elif _DECIMAL.fullmatch(text):
        try:
            quantity = Decimal(text)
        except InvalidOperation:  # defensive: the regexp already excludes invalid Decimal text
            raise validation_error("实际用量格式不正确")
    else:
        raise validation_error("实际用量请填写数字或分数，例如 1、0.5、1/2、1/3")

    if quantity < 0 or quantity > MAX_VALUE:
        raise validation_error("实际用量超出可计算范围")
    if quantity > 0 and normalize_stock(quantity) == 0:
        raise validation_error("实际用量过小，最小支持 0.000001")
    return quantity


def parse_planned_quantity(value: str, unit: str | None) -> Decimal:
    """Parse a menu's planned quantity, accepting the inventory unit once at its end."""
    text = value.strip()
    if unit and text.casefold().endswith(unit.casefold()):
        text = text[: -len(unit)].strip()
    try:
        return parse_usage_quantity(text)
    except AppError:
        raise validation_error("预计用量请填写数字或分数，例如 1、0.5、1/2、1/3；单位会自动带上")


def normalize_stock(value: Decimal) -> Decimal:
    """Persist a stock calculation at the shared six-decimal precision."""
    return value.quantize(SCALE, rounding=ROUND_HALF_UP)


def render_stock(value: Decimal) -> str:
    """Render a normalized number without artificial trailing zeroes."""
    normalized = normalize_stock(value)
    return format(normalized, "f").rstrip("0").rstrip(".") or "0"
