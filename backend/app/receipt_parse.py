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
# 名称尾部的条码+数字粘连：黄心土豆/KG261900035860.3584.38 ->
# 条码(11-13位) + 数量（必须带小数点：纯整数位是条码本身，不能当数量）+ 可选金额。
# 先试带金额的拆分，再退回只有数量。
_TAIL_BARCODE_NUMBERS = re.compile(r"(\d{11,13})(\d{1,3}\.\d{1,3})(\d{1,6}\.\d{2})$")
_TAIL_BARCODE_QTY = re.compile(r"(\d{11,13})(\d{1,3}\.\d{1,3})$")
# 名称行内嵌的优惠/促销残段：优惠:0.221.56、促销活动:-0.21。
# 数字必须紧跟，避免误吞"优惠装"这类名称。
_DISCOUNT_FRAGMENT = re.compile(r"(?:优惠|促销|活动)[:：]?\s*-?\d[\d.]*")
# 名称行内嵌的原价残段：原价：4.98、原价4.98（OCR 常漏冒号）。
# 剥离要求数字紧跟，避免误吞含"原价"字样的名称。
_ORIGINAL_PRICE = re.compile(r"原价[:：]?\s*\d+(?:\.\d{1,2})?")
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


def _is_vertical_layout(lines: list[dict]) -> bool:
    """旋转 90° 拍摄的票：多数文本框呈竖长条（高大于宽）。"""
    flags = []
    for line in lines:
        box = line.get("box") or []
        if len(box) >= 2:
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            flags.append(max(ys) - min(ys) > max(xs) - min(xs))
    return bool(flags) and sum(flags) * 2 > len(flags)


def _vertical_rows(lines: list[dict]) -> list[list[dict]] | None:
    """竖排票装配：列聚类 → 品名定行 → 数字列按行序配对，合成水平行。

    横躺的票面文字沿图 y 排布、列沿图 x 排布；拍摄倾斜会让"行坐标"
    （原 x）在品名列与数字列之间漂移上百像素，无法按 y 带直接聚行。
    但列坐标（原 y）稳定：同列文本框的 y 带聚在一起，列内顺序即票面
    行序（倾斜是保序变形）。因此先按列坐标聚类出品名/数字列，品名列
    定行锚，数字列与行锚做只前进的单调配对（容忍 OCR 漏项），最后把
    配对结果合成"名称 数量 单价 金额"的行段，交回既有 _parse_row。
    返回 None 表示不是竖排布局。
    """
    if not _is_vertical_layout(lines):
        return None
    span = max(float(p[0]) for line in lines for p in (line.get("box") or []))
    kept: list[dict] = []
    for line in lines:
        box = line.get("box") or []
        if len(box) < 2 or not (line.get("text") or "").strip():
            continue
        reason = _noise_reason(_row_text([line]))
        # 纯数字框是数量/单价/金额列的成员，竖排装配依赖它们，不能当噪声丢。
        if reason is not None and reason != "numeric-only":
            continue
        if reason == "numeric-only" and not _DIGIT_BLOCK.match(line["text"].strip()):
            continue
        kept.append({**line, "box": [[float(p[1]), span - float(p[0])] for p in box]})
    if not kept:
        return None

    def center(seg: dict, axis: int) -> float:
        values = [float(p[axis]) for p in seg["box"]]
        return (min(values) + max(values)) / 2

    def spread(seg: dict, axis: int) -> float:
        values = [float(p[axis]) for p in seg["box"]]
        return max(values) - min(values)

    # 两轮列聚类：品名竖条长度即它在列坐标方向的范围（可达数百像素），
    # 与数字框同用一套阈值会把品名列和数字列并在一起。中文框（品名）
    # 先按宽松阈值聚成品名列；纯数字框按紧阈值聚出数量/单价/金额列
    # （数字列中心间隙 ≥ 数百像素，数字框本身只有几十像素宽）。
    chinese = [s for s in kept if re.search(r"[一-鿿]", s["text"])]
    digits = [s for s in kept if _DIGIT_BLOCK.match(s["text"].strip())]
    name_sources = sorted(chinese, key=lambda s: center(s, 0))
    name_columns: list[list[dict]] = []
    for seg in name_sources:
        if name_columns and center(seg, 0) - center(name_columns[-1][-1], 0) <= max(
            spread(name_columns[-1][-1], 0), spread(seg, 0), 1.0
        ) * 0.6:
            name_columns[-1].append(seg)
        else:
            name_columns.append([seg])
    digit_width = median([spread(s, 0) for s in digits]) if digits else 80.0

    def split_digit_columns(segs: list[dict]) -> list[list[dict]]:
        """按列坐标递归最大间隙切分；链式贪心会被跨列桥接值（如合计）
        糊住，而"段内散布超阈值就按最大间隙再切"对列结构更稳。"""
        if len(segs) <= 1:
            return [segs]
        ordered = sorted(segs, key=lambda s: center(s, 0))
        best_i, best_gap = 1, 0.0
        for i in range(1, len(ordered)):
            gap = center(ordered[i], 0) - center(ordered[i - 1], 0)
            if gap > best_gap:
                best_i, best_gap = i, gap
        threshold = max(digit_width * 0.5, 60.0)
        if best_gap <= threshold:
            return [ordered]
        return split_digit_columns(ordered[:best_i]) + split_digit_columns(ordered[best_i:])

    numeric_columns = split_digit_columns(digits)

    name_rows: list[dict] = []
    for column in name_columns:
        for seg in sorted(column, key=lambda s: center(s, 1)):
            stripped = seg["text"].strip()
            if len(stripped) < 2 and not any(ch.isdigit() for ch in stripped):
                continue
            if any(w in stripped for w in _HEADER_WORDS):
                continue
            if name_rows and center(seg, 1) - name_rows[-1]["center"] <= spread(seg, 1) * 0.35:
                name_rows[-1]["parts"].append(seg)
                name_rows[-1]["center"] = (name_rows[-1]["center"] + center(seg, 1)) / 2
            else:
                name_rows.append({"parts": [seg], "center": center(seg, 1)})
    numeric_columns = [sorted(c, key=lambda s: center(s, 1)) for c in numeric_columns]
    if not name_rows:
        return None

    rows: list[list[dict]] = [list(name_row["parts"]) for name_row in name_rows]
    if numeric_columns:
        widths = [spread(s, 1) for row in name_rows for s in row["parts"]]
        tolerance = (median(widths) if widths else 80.0) * 2.5
        for column in numeric_columns:
            cursor = 0
            for seg in column:
                best_index: int | None = None
                best_gap = 0.0
                for index in range(cursor, len(name_rows)):
                    gap = abs(center(seg, 1) - name_rows[index]["center"])
                    if best_index is None or gap < best_gap:
                        best_index, best_gap = index, gap
                if best_index is None or best_gap > tolerance:
                    continue
                rows[best_index].append(seg)
                cursor = best_index + 1
    return rows


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
        rest = t[barcode.end():]
        stripped = split_digit_block(rest)
        if stripped:
            return stripped
        # 省略金额列的称重行只剩“数量+单价”：数量从长到短取最长边界。
        # 只在条码后触发（EAN-13 称重票数量固定三位小数，长数量优先即
        # 三位小数优先）；无条码的 “1.0012.50” 类歧义块不在回退范围内。
        for qty_end in range(min(len(rest), 8) - 1, 0, -1):
            head = rest[:qty_end]
            if not re.fullmatch(r"\d{1,3}(?:\.\d{1,3})?", head):
                continue
            if re.fullmatch(r"\d{1,6}\.\d{2}", rest[qty_end:]):
                return head, rest[qty_end:], rest[qty_end:]
    return None


def _cut_trailing_barcode_numbers(name: str) -> tuple[str, str | None, str | None]:
    """剥掉名称尾部的条码+数量（+金额）粘连，返回（名称, 数量, 金额）。"""
    with_price = _TAIL_BARCODE_NUMBERS.search(name)
    if with_price:
        return name[: with_price.start()], with_price.group(2), with_price.group(3)
    qty_only = _TAIL_BARCODE_QTY.search(name)
    if qty_only:
        return name[: qty_only.start()], qty_only.group(2), None
    return name, None, None


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
    raw = _row_text(row)
    # 优惠/原价残段在参与拆分前先剥掉，避免污染名称或被当成金额；
    # 剥完整行为空的（纯优惠行）按无名称丢弃。
    texts = [_DISCOUNT_FRAGMENT.sub("", _ORIGINAL_PRICE.sub("", s["text"])).strip() for s in row if s["text"].strip()]
    texts = [t for t in texts if t]
    if not texts:
        return None
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
    # 条码+数量+金额整段粘在名称尾部时剥出数字列。
    name, tail_qty, tail_price = _cut_trailing_barcode_numbers(name)
    if tail_qty and state["quantity"] is None:
        state["quantity"] = tail_qty
    if tail_price and state["price"] is None:
        state["price"] = tail_price

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
    rows = _vertical_rows(lines)
    if rows is None:
        rows = _group_rows(lines)

    def flush() -> None:
        nonlocal pending
        if pending is not None:
            items.append(pending)
            pending = None

    for row in rows:
        text = _row_text(row)
        # 优惠/原价残段先剥掉再判噪声：纯残段行照旧丢弃，商品行带着
        # 这些尾巴时不再被整行误杀。剥完既无数字也无计价单位斜杠
        # （店庆活动、满减、本单、双十一……）说明这行本来就是优惠行，
        # 按原文判噪声，避免剥出一个假商品名。
        cleaned = _ORIGINAL_PRICE.sub("", _DISCOUNT_FRAGMENT.sub("", text))
        if cleaned != text and not re.search(r"[/\d]", cleaned):
            cleaned = text
        # 含小数点的独立数字行先尝试归属上一个名称行；拆不出再按噪声处理。
        # 该分支必须在噪声判断之前：纯数字行会被噪声检查判成 numeric-only。
        # 数字块判断用剥残段后的文本：条码+数量+金额+优惠整串粘连也能拆。
        if _DIGIT_BLOCK.match(cleaned) and "." in cleaned:
            split = split_digit_block(cleaned)
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
        reason = _noise_reason(cleaned)
        if reason:
            # 原价/优惠行常夹在名称行与数字行之间，不能清掉 pending。
            ignored.append({"text": text, "reason": reason})
            continue
        if _DIGIT_BLOCK.match(cleaned):
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
