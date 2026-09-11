from decimal import Decimal
import unittest

from app.quantity import normalize_stock, parse_usage_quantity, render_stock
from app.errors import AppError


class QuantityTests(unittest.TestCase):
    def test_accepts_decimal_and_simple_fraction(self):
        self.assertEqual(parse_usage_quantity("0.5"), Decimal("0.5"))
        self.assertEqual(parse_usage_quantity(".5"), Decimal("0.5"))
        self.assertEqual(normalize_stock(parse_usage_quantity("1/3")), Decimal("0.333333"))

    def test_rejects_units_and_natural_language(self):
        for value in ("半个", "1/0", "1/3个", "-1", "1e3"):
            with self.subTest(value=value):
                with self.assertRaises(AppError):
                    parse_usage_quantity(value)

    def test_three_thirds_are_written_as_one(self):
        total = sum((parse_usage_quantity("1/3") for _ in range(3)), Decimal(0))
        self.assertEqual(normalize_stock(total), Decimal("1.000000"))
        self.assertEqual(render_stock(total), "1")


if __name__ == "__main__":
    unittest.main()
