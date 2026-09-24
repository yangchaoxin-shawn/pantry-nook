"""购物小票 OCR 行文本到入库草稿的启发式解析。

OCR 引擎只返回行文本与坐标，不知道哪行是商品、哪行是合计；
这里先把零散文本按纵坐标聚成物理行、按横坐标拆出数字列，
再用关键词过滤小票头尾，尽力给出（名称、数量、单位）草稿。

两类常见版式都支持：
- 同行式："农夫山泉 2 2.00"，名称与数字在同一物理行；
- 分行式：超市称重票常见"名称行 / 条码行 / 数字行"三行一组，
  数字行常被 OCR 粘连成 0.030136.004.08 这类无空格块，用
  "数量×单价≈金额"的乘积校验唯一拆分后归属到上一个名称行。

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
_LEADING_INDEX = re.compile(r"^\d{1,3}[.、:：)）]\s*")
# 糊图上条码与行号、冒号粘连在名称行首：20010400100025: 虫草花…。
_LEADING_BARCODE = re.compile(r"^\d{10,}[::]\s*")
# 名称内部的乘数后缀：酸奶×2。
_TRAILING_MULTIPLIER = re.compile(r"[×xX*]\s*(\d+(?:\.\d+)?)$")
# 无空格粘连行尾部的金额：农夫山泉550ml2.00 -> 名称 + 2.00。
_TRAILING_PRICE = re.compile(r"(\d{1,6}\.\d{1,2})$")
# 日期或时间行。
_DATETIME = re.compile(r"\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}:\d{2}(:\d{2})?$")
# 全数字（含小数点）文本：粘连数字块或条码行。
_DIGIT_BLOCK = re.compile(r"^[\d.]+$")
# 商品条码：超市票常见 11-13 位纯数字（EAN-13 校验位含 690-699 前缀，
# 这里只按长度识别，不猜测具体编码）。
_BARCODE = re.compile(r"\d{11,13}")
# 名称尾部的计价单位段：/KG、/盒/盒（重复打印）。不剥不带斜杠的尾字，
# 避免"蒜头"被剥成"蒜"。
_UNIT_TAIL = re.compile(r"/(KG|kg|盒|袋|瓶|罐|杯|份|桶|支|条|块|颗|枚|把|卷|只|个|听)(?:/\1)?$")
# 优惠标记前缀：[惠]、[特价]、（惠）。
_BRACKET_PREFIX = re.compile(r"^[\[（【][^\]）】]{1,6}[\]）】]\s*")
# 表头列名：同一行出现两个以上视为表头。
_HEADER_WORDS = ("品名", "商品名", "数量", "单价", "金额", "小计")
# 以这些词开头（去除行号后）的行整行丢弃：合计、支付、会员等小票头尾。
_NOISE_PREFIX = (
    "合计", "总计", "实收", "应收", "折后", "优惠", "折扣", "抹零", "找零", "现金",
    "微信", "支付宝", "银行卡", "刷卡", "支付", "收款", "会员", "积分", "储值", "余额",
    "收银", "机号", "流水", "单号", "订单", "电话", "地址", "营业", "欢迎", "谢谢",
    "光临", "发票", "抬头", "税号", "收据", "客服", "投诉", "退货", "换货", "钱箱",
    "班次", "变更", "操作员", "收货", "门店", "服务热线", "热线", "原价", "促销",
    "NO.",
)
# 行内任意位置出现即丢弃的强信号词。
_NOISE_ANYWHERE = ("合计", "实收", "找零", "谢谢光临", "欢迎再来", "优惠", "原价", "活动:", "活动：")

# 会被后端识别并参与换算的计量单位；其余作为自由单位原样保留。
KNOWN_UNITS = ("kg", "g", "ml", "L", "斤")
# 名称尾缀单位到库存单位的归一：/KG 打印为大写，库存单位用 kg。
_UNIT_NORMALIZE = {"KG": "kg"}


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


def _amount_matches(quantity: str, price: str, amount: str) -> bool:
    """校验数量×单价是否与金额一致，允许打印舍入误差。"""
    try:
        q, p, a = float(quantity), float(price), float(amount)
    except ValueError:
        return False
    if q <= 0 or p <= 0 or a <= 0:
        return False
    return abs(q * p - a) <= max(0.02, a * 0.03)


def split_digit_block(text: str) -> tuple[str | None, str, str] | None:
    """拆分 OCR 粘连的数字块，返回（数量, 单价, 金额）。

    支持 "0.030136.004.08"（数量+单价+金额）与 "15.505.50"（1 件，
    单价=金额）两种粘连；先剥可能的条码前缀再试。拆不出返回 None。
    """
    t = text.strip()
    if not (_DIGIT_BLOCK.match(t) and "." in t):
        return None
    if _BARCODE.fullmatch(t):
        return None
    # 数量 + 单价 + 金额：从长到短枚举数量段（称重三位小数优先），
    # 乘积校验唯一确定边界。
    for qty_end in range(min(len(t), 8) - 1, 0, -1):
        head = t[:qty_end]
        if not re.fullmatch(r"\d{1,3}(?:\.\d{1,3})?", head):
            continue
        tail = t[qty_end:]
        parts = re.fullmatch(r"(\d{1,6}\.\d{2})(\d{1,6}\.\d{2})", tail)
        if parts and _amount_matches(head, parts.group(1), parts.group(2)):
            return head, parts.group(1), parts.group(2)
    # 单价 = 金额（件数 1，数量列被粘连吞掉）。
    equal = re.fullmatch(r"(\d{1,6}\.\d{2})\1", t)
    if equal:
        return None, equal.group(1), equal.group(1)
    # 条码与数字块粘连：剥掉条码前缀后重试。
    barcode = _BARCODE.match(t)
    if barcode and barcode.end() < len(t):
        stripped = split_digit_block(t[barcode.end():])
        if stripped:
            return stripped
    return None


def _clean_name(name: str) -> tuple[str, str | None]:
    """清理名称里的优惠标记、粘连条码与计价单位尾缀，返回（名称, 单位）。"""
    name = _BRACKET_PREFIX.sub("", name)
    barcode_tail = _BARCODE.search(name)
    if barcode_tail and barcode_tail.end() >= len(name) - 1:
        name = name[: barcode_tail.start()]
    unit = None
    unit_tail = _UNIT_TAIL.search(name)
    if unit_tail:
        unit = _UNIT_NORMALIZE.get(unit_tail.group(1), unit_tail.group(1).lower())
        name = name[: unit_tail.start()]
    return name.strip(" \t　.。:：、;；|｜"), unit


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

    # 糊图上条码与行号、冒号粘连在名称行首：20010400100025: 虫草花…。
    texts[0] = _LEADING_BARCODE.sub("", texts[0], count=1)
    if not texts[0] and len(texts) == 1:
        return None

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

    name = _LEADING_INDEX.sub("", name)
    name, unit = _clean_name(name)
    if not name:
        return None
    if unit and state["unit"] is None:
        state["unit"] = unit
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

    分行式小票（名称行 / 条码行 / 数字行）靠 pending 状态把数字行
    归属到上一个没有数量的名称行；条码行与噪声行不消耗 pending。

    长票分段拍摄时的跨张缝合：末尾悬空的纯名称行标记 open_ended；
    开头没有名称可归属、但能拆出数量金额的数字行不再直接丢弃，
    附带 quantity_text / amount_text 交给前端与上一张缝合。
    """
    items: list[dict] = []
    ignored: list[dict] = []
    pending: dict | None = None

    def flush() -> None:
        nonlocal pending
        if pending is not None:
            items.append(pending)
            pending = None

    for row in _group_rows(lines):
        text = _row_text(row)
        # 含小数点的独立数字行先尝试归属上一个名称行；拆不出再按噪声处理。
        # 该分支必须在噪声判断之前：纯数字行会被噪声检查判成 numeric-only。
        if _DIGIT_BLOCK.match(text) and "." in text:
            split = split_digit_block(text)
            if split and pending is not None:
                quantity, _unit_price, amount = split
                pending["quantity_text"] = quantity or pending["quantity_text"]
                pending["price_text"] = amount
                items.append(pending)
                pending = None
                continue
            if split and pending is None:
                # 孤儿数量金额：名称在上一张图里，交给前端缝合。
                _quantity, _unit_price, amount = split
                ignored.append({
                    "text": text,
                    "reason": "numeric-only",
                    "quantity_text": split[0],
                    "amount_text": amount,
                })
                continue
        reason = _noise_reason(text)
        if reason:
            # 原价/优惠行常夹在名称行与数字行之间，不能清掉 pending。
            ignored.append({"text": text, "reason": reason})
            continue
        if _DIGIT_BLOCK.match(text):
            # 条码等无小数点的数字行：丢弃但不消耗 pending。
            ignored.append({"text": text, "reason": "numeric-only"})
            continue
        item = _parse_row(row)
        if item is None:
            ignored.append({"text": text, "reason": "no-name"})
            continue
        if item["quantity_text"] is None and item["price_text"] is None:
            # 纯名称行：等后面的数字行来补数量；连续两个名称行则冲掉前者。
            flush()
            pending = item
        else:
            flush()
            items.append(item)
    flush()
    # 末尾仍未等到数字行的名称行：数量可能拍在下一张图的开头。
    if items:
        last = items[-1]
        if last["quantity_text"] is None and last["price_text"] is None:
            last["open_ended"] = True
    return {"items": items, "ignored": ignored}
