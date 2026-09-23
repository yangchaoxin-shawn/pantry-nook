"""购物小票 OCR 行文本到入库草稿的启发式解析。

OCR 引擎只返回行文本与坐标，不知道哪行是商品、哪行是合计；
这里先把零散文本按纵坐标聚成物理行、按横坐标拆出数字列，
再用关键词过滤小票头尾，尽力给出（名称、数量、单位）草稿。

小票版式千差万别，识别必然有误：解析拿不准时宁可保留整行名称
让用户删改，也不悄悄丢弃商品；每条结果都带回原文与最低置信度。
金额只作参考展示，不写入任何业务字段。
"""

from __future__ import annotations

import re
from statistics import median

# 金额/数量的数字形态：整数或最多三位小数（散装重量常见 0.852）。
_DECIMAL = re.compile(r"^\d{1,6}(?:\.\d{1,3})?$")
# 乘数前缀：×2、x2、*2（同品多件）。
_MULTIPLIER = re.compile(r"^[×xX*]\s*(\d+(?:\.\d+)?)$")
# 数字加可选单位后缀：2件、1.5斤、0.852kg。
_QTY_WITH_UNIT = re.compile(
    r"^(\d{1,6}(?:\.\d{1,3})?)\s*(kg|g|ml|L|斤|件|瓶|袋|盒|包|罐|桶|支|条|块|颗|枚|把|卷|份|只|个)?$",
    re.IGNORECASE,
)
# 行首序号：1. 、12、等小票打印的行号。
_LEADING_INDEX = re.compile(r"^\d{1,3}[.、)）]\s*")
# 名称内部的乘数后缀：酸奶×2。
_TRAILING_MULTIPLIER = re.compile(r"[×xX*]\s*(\d+(?:\.\d+)?)$")
# 无空格粘连行尾部的金额：农夫山泉550ml2.00 -> 名称 + 2.00。
_TRAILING_PRICE = re.compile(r"(\d{1,6}\.\d{1,2})$")
# 日期或时间行。
_DATETIME = re.compile(r"\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}:\d{2}(:\d{2})?$")

# 表头列名：同一行出现两个以上视为表头。
_HEADER_WORDS = ("品名", "商品名", "数量", "单价", "金额", "小计")
# 以这些词开头（去除行号后）的行整行丢弃：合计、支付、会员等小票头尾。
_NOISE_PREFIX = (
    "合计", "总计", "实收", "应收", "折后", "优惠", "折扣", "抹零", "找零", "现金",
    "微信", "支付宝", "银行卡", "刷卡", "支付", "收款", "会员", "积分", "储值", "余额",
    "收银", "机号", "流水", "单号", "订单", "电话", "地址", "营业", "欢迎", "谢谢",
    "光临", "发票", "抬头", "税号", "收据", "客服", "投诉", "退货", "换货", "钱箱",
    "班次", "变更", "操作员", "收货", "退货",
)
# 行内任意位置出现即丢弃的强信号词。
_NOISE_ANYWHERE = ("合计", "实收", "找零", "谢谢光临", "欢迎再来")

# 会被后端识别并参与换算的计量单位；其余作为自由单位原样保留。
KNOWN_UNITS = ("kg", "g", "ml", "L", "斤")


def _y_center(box) -> float:
    ys = [float(p[1]) for p in box]
    return (min(ys) + max(ys)) / 2


def _x_start(box) -> float:
    return min(float(p[0]) for p in box)


def _line_height(box) -> float:
    ys = [float(p[1]) for p in box]
    return max(ys) - min(ys)


def _group_rows(lines: list[dict]) -> list[list[dict]]:
    """按纵坐标把 OCR 零散文本聚成物理行；行内按横坐标排序。"""
    segments = []
    for line in lines:
        text = (line.get("text") or "").strip()
        box = line.get("box") or []
        if text and len(box) >= 2:
            segments.append({"text": text, "score": float(line.get("score") or 0.0), "box": box})
    if not segments:
        return []
    segments.sort(key=lambda s: _y_center(s["box"]))
    tolerance = max(median(_line_height(s["box"]) for s in segments) * 0.7, 1.0)
    rows: list[list[dict]] = []
    current_y = 0.0
    for segment in segments:
        center = _y_center(segment["box"])
        if rows and abs(center - current_y) <= tolerance:
            rows[-1].append(segment)
            current_y = (current_y + center) / 2
        else:
            rows.append([segment])
            current_y = center
    for row in rows:
        row.sort(key=lambda s: _x_start(s["box"]))
    return rows


def _row_text(row: list[dict]) -> str:
    return "".join(s["text"] for s in row).strip()


def _noise_reason(text: str) -> str | None:
    """判断整行是否为小票头尾噪声；返回丢弃原因或 None。"""
    stripped = _LEADING_INDEX.sub("", text).strip()
    if _DATETIME.search(stripped):
        return "datetime"
    if any(stripped.startswith(word) or text.startswith(word) for word in _NOISE_PREFIX):
        return "noise"
    if any(word in text for word in _NOISE_ANYWHERE):
        return "noise"
    if sum(1 for word in _HEADER_WORDS if word in text) >= 2:
        return "header"
    # 纯数字/符号行（无中英文文字）没有名称价值。
    if not re.search(r"[一-鿿A-Za-z]", stripped):
        return "numeric-only"
    return None


def _classify_token(token: str, state: dict) -> bool:
    """把一行里的一个数字段归类到数量、单价或金额；返回是否已消费。"""
    multiplier = _MULTIPLIER.match(token)
    if multiplier:
        state["quantity"] = state["quantity"] or multiplier.group(1)
        return True
    with_unit = _QTY_WITH_UNIT.match(token)
    if with_unit and with_unit.group(2):
        if state["quantity"] is None:
            state["quantity"] = with_unit.group(1)
            state["unit"] = with_unit.group(2)
        return True
    if _DECIMAL.match(token):
        state["numerics"].append(token)
        return True
    return False


def _extract_from_numerics(state: dict) -> None:
    """从纯数字序列中挑出数量与金额。

    小票常见的三种形态：
    - 名称 数量 金额          -> 2 个数字且不相等：首位数量，末位金额
    - 名称 数量 单价 金额     -> 3 个数字：首位数量，末位金额
    - 名称 单价 金额（件数=1）-> 2 个数字且相等：视为单价+金额，无数量
    """
    numerics = state["numerics"]
    if not numerics:
        return
    state["price"] = numerics[-1]
    if len(numerics) >= 2 and numerics[0] != numerics[-1]:
        state["quantity"] = state["quantity"] or numerics[0]


def _parse_row(row: list[dict]) -> dict | None:
    texts = [s["text"].strip() for s in row if s["text"].strip()]
    if not texts:
        return None
    raw = _row_text(row)
    score = min(s["score"] for s in row)
    state: dict = {"quantity": None, "unit": None, "price": None, "numerics": []}

    name_parts = [texts[0]]
    for token in texts[1:]:
        if _classify_token(token, state):
            continue
        # OCR 常把相邻数字列粘成一段（如 "1 7.90"）；按空格拆开再归类。
        remainder = [part for part in token.split() if not _classify_token(part, state)]
        if remainder:
            # 无法归类的文字残片并回名称，避免丢字。
            name_parts.append(" ".join(remainder))
    name = "".join(name_parts)

    # 单段行没有数字列可拆：从粘连文本尾部抠金额，尾部空格分隔的小数列为数量。
    if len(texts) == 1:
        trailing = _TRAILING_PRICE.search(name)
        if trailing:
            state["price"] = trailing.group(1)
            name = name[: trailing.start()]
        parts = name.split()
        while len(parts) > 1 and _DECIMAL.fullmatch(parts[-1]):
            state["numerics"].insert(0, parts.pop())
        name = " ".join(parts)
    name = name.strip(" \t　.。:：、;；|｜")
    # 先从数字列提取数量，名称尾部的 ×N 乘数只在缺数量时补充。
    _extract_from_numerics(state)
    multiplier = _TRAILING_MULTIPLIER.search(name)
    if multiplier:
        if state["quantity"] is None:
            state["quantity"] = multiplier.group(1)
        name = name[: multiplier.start()]

    name = _LEADING_INDEX.sub("", name).strip(" \t　.。:：、;；|｜")
    if not name:
        return None
    quantity = state["quantity"]
    if quantity is not None:
        try:
            if float(quantity) > 999999:
                quantity = None
        except ValueError:
            quantity = None
    return {
        "name": name,
        "quantity_text": quantity,
        "unit": state["unit"],
        "price_text": state["price"],
        "raw_text": raw,
        "score": round(score, 4),
    }


def parse_receipt_lines(lines: list[dict]) -> dict:
    """把 OCR 行列表解析为入库草稿。

    返回 {"items": [...], "ignored": [...]}；items 每项含
    name / quantity_text / unit / price_text / raw_text / score，
    ignored 每项含 text 与丢弃原因，供核对页透明展示。
    """
    items: list[dict] = []
    ignored: list[dict] = []
    for row in _group_rows(lines):
        text = _row_text(row)
        reason = _noise_reason(text)
        if reason:
            ignored.append({"text": text, "reason": reason})
            continue
        item = _parse_row(row)
        if item is None:
            ignored.append({"text": text, "reason": "no-name"})
        else:
            items.append(item)
    return {"items": items, "ignored": ignored}
