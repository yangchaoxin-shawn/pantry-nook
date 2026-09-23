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


if __name__ == "__main__":
    unittest.main()
