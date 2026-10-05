"""小票 OCR 行解析的单测；不连接数据库或侧车服务。"""

import unittest

from app.receipt_parse import parse_receipt_lines


def line(text: str, x: float, y: float, score: float = 0.98, w: float = 100, h: float = 20):
    return {"text": text, "score": score,
            "box": [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]}


class ReceiptParseTests(unittest.TestCase):
    def test_empty_input_returns_empty_draft(self):
        self.assertEqual(parse_receipt_lines([]), {"items": [], "ignored": []})

    def test_columns_merge_into_one_item(self):
        lines = [line("农夫山泉", 20, 100), line("1", 300, 100), line("2.00", 420, 100)]
        result = parse_receipt_lines(lines)
        self.assertEqual(len(result["items"]), 1)
        item = result["items"][0]
        self.assertEqual(item["name"], "农夫山泉")
        self.assertEqual(item["quantity_text"], "1")
        self.assertIsNone(item["unit"])
        self.assertEqual(item["price_text"], "2.00")
        self.assertEqual(item["raw_text"], "农夫山泉12.00")

    def test_same_row_requires_close_y(self):
        lines = [line("农夫山泉", 20, 100), line("2.00", 420, 100),
                 line("可乐", 20, 140), line("3.00", 420, 140)]
        result = parse_receipt_lines(lines)
        self.assertEqual([item["name"] for item in result["items"]], ["农夫山泉", "可乐"])


class SplitShotTests(unittest.TestCase):
    """长票分段拍摄：名称在上一张末尾、数量金额在下一张开头的缝合信号。"""

    def test_trailing_name_only_marks_open_ended(self):
        result = parse_receipt_lines([line("葡萄", 20, 100)])
        self.assertEqual(len(result["items"]), 1)
        self.assertTrue(result["items"][0].get("open_ended"))

    def test_orphan_amount_row_survives_with_quantities(self):
        result = parse_receipt_lines([line("0.8525.965.08", 20, 100)])
        self.assertEqual(result["items"], [])
        orphan = result["ignored"][0]
        self.assertEqual(orphan["reason"], "numeric-only")
        self.assertEqual(orphan["quantity_text"], "0.852")
        self.assertEqual(orphan["amount_text"], "5.08")

    def test_barcode_row_stays_plain(self):
        result = parse_receipt_lines([line("2002167000303", 20, 100)])
        orphan = result["ignored"][0]
        self.assertNotIn("quantity_text", orphan)

    def test_resolved_row_is_not_open_ended(self):
        result = parse_receipt_lines([line("苹果", 20, 100), line("1.5283.585.46", 20, 130)])
        self.assertFalse(result["items"][0].get("open_ended", False))

    def test_merged_single_segment_line(self):
        result = parse_receipt_lines([line("农夫山泉550ml 2.00", 20, 100)])
        item = result["items"][0]
        self.assertEqual(item["name"], "农夫山泉550ml")
        self.assertIsNone(item["quantity_text"])
        self.assertEqual(item["price_text"], "2.00")

    def test_trailing_multiplier_extracted_from_name(self):
        result = parse_receipt_lines([line("抽纸×2 7.90", 20, 100)])
        item = result["items"][0]
        self.assertEqual(item["name"], "抽纸")
        self.assertEqual(item["quantity_text"], "2")
        self.assertEqual(item["price_text"], "7.90")

    def test_quantity_with_unit_segment(self):
        lines = [line("牛肉", 20, 100), line("0.852kg", 300, 100), line("45.30", 420, 100)]
        item = parse_receipt_lines(lines)["items"][0]
        self.assertEqual(item["name"], "牛肉")
        self.assertEqual(item["quantity_text"], "0.852")
        self.assertEqual(item["unit"], "kg")
        self.assertEqual(item["price_text"], "45.30")

    def test_equal_numbers_mean_price_and_amount_without_quantity(self):
        lines = [line("可乐", 20, 100), line("3.50", 300, 100), line("3.50", 420, 100)]
        item = parse_receipt_lines(lines)["items"][0]
        self.assertEqual(item["name"], "可乐")
        self.assertIsNone(item["quantity_text"])
        self.assertEqual(item["price_text"], "3.50")

    def test_three_numeric_columns_take_first_as_quantity(self):
        lines = [line("苹果", 20, 100), line("1.528", 260, 100),
                 line("5.96", 360, 100), line("9.11", 460, 100)]
        item = parse_receipt_lines(lines)["items"][0]
        self.assertEqual(item["quantity_text"], "1.528")
        self.assertEqual(item["price_text"], "9.11")

    def test_leading_index_and_punctuation_stripped(self):
        result = parse_receipt_lines([line("1. 蓝月亮洗衣液 19.90", 20, 100)])
        self.assertEqual(result["items"][0]["name"], "蓝月亮洗衣液")

    def test_noise_lines_are_ignored_with_reason(self):
        lines = [
            line("2026-09-23 12:30", 20, 10),
            line("品名 数量 单价 金额", 20, 40),
            line("合计", 20, 500),
            line("微信支付 56.00", 20, 530),
            line("56.00", 20, 560),
        ]
        result = parse_receipt_lines(lines)
        self.assertEqual(result["items"], [])
        reasons = {entry["reason"] for entry in result["ignored"]}
        self.assertEqual(reasons, {"datetime", "header", "noise", "numeric-only"})

    def test_merged_qty_and_price_segment_splits_on_space(self):
        # 真实小票：数量与单价被 OCR 粘成一段 "1 7.90"。
        lines = [line("抽纸x2", 20, 100), line("1 7.90", 300, 100), line("7.90", 420, 100)]
        item = parse_receipt_lines(lines)["items"][0]
        self.assertEqual(item["name"], "抽纸")
        self.assertEqual(item["quantity_text"], "1")
        self.assertEqual(item["price_text"], "7.90")

    def test_single_segment_with_trailing_amount_columns(self):
        # 真实小票：整行只有一段 "可乐 3.50 3.50"，尾部金额重复代表无数量。
        result = parse_receipt_lines([line("可乐 3.50 3.50", 20, 100)])
        item = result["items"][0]
        self.assertEqual(item["name"], "可乐")
        self.assertIsNone(item["quantity_text"])
        self.assertEqual(item["price_text"], "3.50")

    def test_merged_decimal_columns_stay_editable_in_name(self):
        # 数量与单价粘连成 "1.528.96" 时无法可靠拆分，整段保留在名称里由用户修正。
        lines = [line("土豆", 20, 100), line("1.528.96", 300, 100), line("9.11", 420, 100)]
        item = parse_receipt_lines(lines)["items"][0]
        self.assertEqual(item["name"], "土豆1.528.96")
        self.assertIsNone(item["quantity_text"])
        self.assertEqual(item["price_text"], "9.11")

    def test_score_reports_lowest_segment_confidence(self):
        result = parse_receipt_lines([line("鸡蛋", 20, 100, score=0.9),
                                      line("3.50", 300, 100, score=0.6)])
        self.assertEqual(result["items"][0]["score"], 0.6)

    def test_single_segment_with_trailing_integer_keeps_name_whole(self):
        # 尾部无小数点的整数不当作金额或数量，宁可整行保留由用户删改。
        result = parse_receipt_lines([line("代码库存 1234567", 20, 100, w=300)])
        item = result["items"][0]
        self.assertEqual(item["name"], "代码库存 1234567")
        self.assertIsNone(item["quantity_text"])
        self.assertIsNone(item["price_text"])


class SplitDigitBlockTests(unittest.TestCase):
    def test_three_part_glued_block(self):
        from app.receipt_parse import split_digit_block
        self.assertEqual(split_digit_block("0.030136.004.08"), ("0.030", "136.00", "4.08"))

    def test_unit_quantity_glued_block(self):
        from app.receipt_parse import split_digit_block
        self.assertEqual(split_digit_block("15.005.00"), ("1", "5.00", "5.00"))
        self.assertEqual(split_digit_block("11.901.90"), ("1", "1.90", "1.90"))

    def test_barcode_prefixed_glued_block(self):
        from app.receipt_parse import split_digit_block
        self.assertEqual(split_digit_block("20005870006820.06811.980.81"), ("0.068", "11.98", "0.81"))
        self.assertEqual(split_digit_block("690720131636412.982.98"), ("1", "2.98", "2.98"))

    def test_bare_barcode_is_not_split(self):
        from app.receipt_parse import split_digit_block
        self.assertIsNone(split_digit_block("2002167000303"))
        self.assertIsNone(split_digit_block("6907201316364"))


class WeightedReceiptTests(unittest.TestCase):
    """超市称重小票（名称行 / 条码行 / 数字行 三行一组）。"""

    def receipt(self, *rows):
        return parse_receipt_lines([line(text, 20, 100 + index * 30) for index, text in enumerate(rows)])

    def test_name_barcode_amount_rows_merge(self):
        result = self.receipt(
            "1.五指毛桃切节/KG", "2002167000303", "0.030136.004.08",
            "2.精选石橄榄100g/盒/盒", "2002798010009", "15.505.50",
        )
        self.assertEqual([(i["name"], i["quantity_text"], i["unit"], i["price_text"]) for i in result["items"]], [
            ("五指毛桃切节", "0.030", "kg", "4.08"),
            ("精选石橄榄100g", "1", "盒", "5.50"),
        ])

    def test_discount_and_promo_rows_are_noise(self):
        result = self.receipt(
            "[惠]黄心土豆/KG", "2002619003586", "0.3584.381.56",
            "原价：4.98优惠:0.22", "促销活动：-0.21", "活动：-1.19",
        )
        self.assertEqual(len(result["items"]), 1)
        item = result["items"][0]
        self.assertEqual(item["name"], "黄心土豆")
        self.assertEqual(item["quantity_text"], "0.358")
        self.assertEqual(item["price_text"], "1.56")

    def test_receipt_header_noise(self):
        result = self.receipt(
            "NO.2609060010011014909", "门店：1001新鲜年代超市",
            "服务热线：19902233088", "收银员：180008机号：101",
            "时间:2026-09-06 21:51:44",
        )
        self.assertEqual(result["items"], [])

    def test_name_with_glued_barcode_keeps_name_only(self):
        result = self.receipt("沙葱/KG03634003988", "0.39827.8011.06")
        self.assertEqual(result["items"][0]["name"], "沙葱")
        self.assertEqual(result["items"][0]["quantity_text"], "0.398")
        self.assertEqual(result["items"][0]["price_text"], "11.06")

    def test_leading_barcode_stripped_from_name(self):
        result = self.receipt("20010400100025: 虫草花100g盒/盒", "11.901.90")
        item = result["items"][0]
        self.assertEqual(item["name"], "虫草花100g盒")
        self.assertEqual(item["quantity_text"], "1")
        self.assertEqual(item["price_text"], "1.90")


class GluedReceiptTests(unittest.TestCase):
    """真实密集小票的三种粘连：优惠/原价残段、条码+数量+金额粘在名称尾、条码+数量+单价独立成行。"""

    def receipt(self, *rows):
        return parse_receipt_lines([line(text, 20, 100 + index * 30) for index, text in enumerate(rows)])

    def test_product_row_with_discount_fragment_survives(self):
        # 优惠残段剥掉后商品行保留，条码+数量+金额从名称尾部剥出。
        result = self.receipt("[惠]黄心土豆/KG261900035860.3584.38优惠:0.221.56")
        self.assertEqual(result["ignored"], [])
        item = result["items"][0]
        self.assertEqual(item["name"], "黄心土豆")
        self.assertEqual(item["unit"], "kg")
        self.assertEqual(item["quantity_text"], "0.358")
        self.assertEqual(item["price_text"], "4.38")

    def test_name_row_with_original_price_pairs_with_glued_barcode_qty(self):
        # 名称行带原价尾巴：剥掉后等下面的条码+数量+单价粘连行来缝合。
        result = self.receipt(
            "6.[惠]去皮红洋葱/KG原价：4.98",
            "20006050030840.3084.38",
            "原价:4.90",
        )
        self.assertEqual(len(result["items"]), 1)
        item = result["items"][0]
        self.assertEqual(item["name"], "去皮红洋葱")
        self.assertEqual(item["unit"], "kg")
        self.assertEqual(item["quantity_text"], "0.308")
        self.assertEqual(item["price_text"], "4.38")
        self.assertEqual([entry["text"] for entry in result["ignored"]], ["原价:4.90"])

    def test_glued_digit_row_with_discount_fragment_attaches(self):
        # 粘连数字行还拖着优惠残段（真实小票常见）：剥掉残段后照样归属上一行。
        result = self.receipt(
            "6.[惠]去皮红洋葱/KG原价：4.98",
            "20006050030840.3084.38优惠:0.171.34",
        )
        self.assertEqual(len(result["items"]), 1)
        item = result["items"][0]
        self.assertEqual(item["name"], "去皮红洋葱")
        self.assertEqual(item["quantity_text"], "0.308")
        self.assertEqual(item["price_text"], "4.38")
        self.assertEqual(result["ignored"], [])

    def test_discount_only_rows_stay_dropped(self):
        result = self.receipt("优惠明细", "促销活动:-0.21", "原价:4.90")
        self.assertEqual(result["items"], [])
        self.assertEqual(len(result["ignored"]), 3)

    def test_pure_barcode_tail_keeps_name_and_drops_digits(self):
        # 条码后没有带小数点的数量：条码整段按噪声剥掉，不虚构数量。
        for text, name in (("虫草花盒20010400100025", "虫草花盒"), ("牛奶6902538001234", "牛奶")):
            result = self.receipt(text)
            self.assertEqual(len(result["items"]), 1, text)
            self.assertEqual(result["items"][0]["name"], name)
            self.assertIsNone(result["items"][0]["quantity_text"], text)

    def test_discount_prefix_row_does_not_steal_pending_quantity(self):
        # "活动优惠:2.00" 剥掉残段后只剩词头：必须按噪声丢弃，
        # 不能冒充商品把下一行的数量金额抢走。
        result = self.receipt("[惠]沙葱/KG", "活动优惠:2.00", "0.030136.004.08")
        self.assertEqual([item["name"] for item in result["items"]], ["沙葱"])
        self.assertEqual(result["items"][0]["quantity_text"], "0.030")
        self.assertEqual(result["items"][0]["price_text"], "4.08")
        self.assertEqual([e["text"] for e in result["ignored"]], ["活动优惠:2.00"])

    def test_promo_word_rows_without_digits_stay_noise(self):
        for text in ("活动优惠:2.00", "满减优惠:5.00", "本单优惠3.50", "券优惠:2.00",
                     "店庆活动优惠:3.00", "周年活动优惠:5.00", "限时促销活动:3.00", "双十一活动:9.90"):
            result = self.receipt(text)
            self.assertEqual(result["items"], [], text)

    def test_product_with_discount_fragment_but_no_other_numbers_falls_to_ignored(self):
        # 刻意取舍：两字商品+优惠残段、行内再无数字/计价单位时，宁进跳过列表
        # 也不冒写出假商品的风险；放宽守卫前须三思并更新本断言。
        result = self.receipt("蒜头优惠:0.22")
        self.assertEqual(result["items"], [])
        self.assertEqual([e["text"] for e in result["ignored"]], ["蒜头优惠:0.22"])

    def test_original_price_without_colon_still_stripped(self):
        result = self.receipt("去皮红洋葱/KG原价4.98", "20006050030840.3084.38")
        self.assertEqual(len(result["items"]), 1)
        item = result["items"][0]
        self.assertEqual(item["name"], "去皮红洋葱")
        self.assertEqual(item["quantity_text"], "0.308")

    def test_ambiguous_two_number_block_without_barcode_unchanged(self):
        # 无条码的 "1.0012.50" 歧义块拆不开：整块保留在跳过行，不猜。
        result = parse_receipt_lines([line("1.0012.50", 20, 100)])
        self.assertEqual(result["items"], [])
        self.assertNotIn("quantity_text", result["ignored"][0])


class RotatedReceiptTests(unittest.TestCase):
    """旋转 90° 拍摄的竖排小票：列聚类 + 行序配对装配（2026-10-03 真实票沉淀）。"""

    @staticmethod
    def vline(text, col, y, chars=1, score=0.98):
        # 竖排框：图 x 窄（行坐标带），图 y 长（文字沿 y 展开）。
        w, h = 20, 16 * chars
        return {"text": text, "score": score,
                "box": [[col, y], [col + w, y], [col + w, y + h], [col, y + h]]}

    def test_vertical_receipt_assembles_rows(self):
        lines = [
            # 票面第一行的行坐标（图 x）最大：变换后行序与票面一致。
            self.vline("农夫山泉", 500, 20, chars=4),
            self.vline("0.278", 490, 200, chars=5),
            self.vline("3.98", 500, 400, chars=4),
            self.vline("1.10", 510, 600, chars=4),
            self.vline("可乐", 270, 250, chars=2),
            self.vline("1", 265, 200, chars=1),
            self.vline("3.00", 275, 400, chars=4),
            self.vline("3.00", 280, 600, chars=4),
        ]
        result = parse_receipt_lines(lines)
        self.assertEqual([i["name"] for i in result["items"]], ["农夫山泉", "可乐"])
        first, second = result["items"]
        self.assertEqual(first["quantity_text"], "0.278")
        self.assertEqual(first["price_text"], "1.10")
        self.assertEqual(second["quantity_text"], "1")
        self.assertEqual(second["price_text"], "3.00")

    def test_horizontal_receipt_with_one_tall_box_untouched(self):
        # 水平票混入一个竖长装饰框不触发竖排装配。
        lines = [line("农夫山泉", 20, 100), line("0.278", 300, 100),
                 line("1.10", 420, 100), RotatedReceiptTests.vline("装", 600, 320, chars=12)]
        result = parse_receipt_lines(lines)
        first = result["items"][0]
        self.assertEqual(first["name"], "农夫山泉")
        self.assertEqual(first["quantity_text"], "0.278")
        self.assertEqual(first["price_text"], "1.10")

    def test_real_vertical_receipt_fixture(self):
        import json
        from pathlib import Path
        fixture = Path(__file__).parent / "fixtures" / "receipt_rotated_vertical.json"
        data = json.loads(fixture.read_text(encoding="utf-8"))
        result = parse_receipt_lines(data["lines"])
        self.assertEqual(len(result["items"]), 8)
        by_name = {item["name"]: item for item in result["items"]}
        self.assertEqual(by_name["黄心菜"]["quantity_text"], "0.278")
        self.assertEqual(by_name["黄心菜"]["price_text"], "1.10")
        self.assertEqual(by_name["莲藕"]["quantity_text"], "0.212")
        self.assertEqual(by_name["黄心土豆"]["price_text"], "0.49")
        self.assertEqual(by_name["海底捞浓香牛油火锅底/包"]["quantity_text"], "1")
        self.assertEqual(by_name["海底捞浓香牛油火锅底/包"]["price_text"], "8.90")
        # OCR 漏掉数量"1"的行仍保留为草稿行，交给核对页补数量。
        self.assertIsNone(by_name["粤盐加碘低钠盐250g/包"]["quantity_text"])
        # 合计等噪声不进商品行。
        joined = " ".join(item["name"] for item in result["items"])
        self.assertNotIn("24.67", joined)



if __name__ == "__main__":
    unittest.main()
