"""验证开发数据脚本不能误指向正式环境。"""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from scripts import reset_data, seed_demo_data


class ResetDataGuardTests(unittest.TestCase):
    def test_rejects_production_even_with_test_database_name(self) -> None:
        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "PANTRY_ALLOW_TEST_DATA": "true",
            "DB_NAME": "pantry_nook_test_0123456789abcdef0123456789abcdef",
        }, clear=False):
            with self.assertRaisesRegex(RuntimeError, "development/test/demo"):
                reset_data.assert_test_data_target()

    def test_rejects_unmarked_database(self) -> None:
        with patch.dict(os.environ, {
            "APP_ENV": "test",
            "PANTRY_ALLOW_TEST_DATA": "true",
            "DB_NAME": "pantry_nook",
        }, clear=False):
            with self.assertRaisesRegex(RuntimeError, "隔离测试标记"):
                reset_data.assert_test_data_target()

    def test_accepts_explicit_isolated_test_database(self) -> None:
        with patch.dict(os.environ, {
            "APP_ENV": "test",
            "PANTRY_ALLOW_TEST_DATA": "true",
            "DB_NAME": "pantry_nook_test_0123456789abcdef0123456789abcdef",
        }, clear=False):
            reset_data.assert_test_data_target()


class SeedDataGuardTests(unittest.TestCase):
    def test_rejects_when_test_data_flag_is_disabled(self) -> None:
        with patch.dict(os.environ, {
            "APP_ENV": "test",
            "PANTRY_ALLOW_TEST_DATA": "false",
        }, clear=False):
            with self.assertRaisesRegex(RuntimeError, "未显式启用"):
                seed_demo_data.assert_test_data_target()

    def test_rejects_remote_target_before_request(self) -> None:
        with patch.dict(os.environ, {
            "APP_ENV": "demo",
            "PANTRY_ALLOW_TEST_DATA": "true",
        }, clear=False), patch.object(seed_demo_data, "BASE", "https://preview.example.com"):
            with self.assertRaisesRegex(RuntimeError, "只允许连接本机"):
                seed_demo_data.assert_test_data_target()


if __name__ == "__main__":
    unittest.main()
