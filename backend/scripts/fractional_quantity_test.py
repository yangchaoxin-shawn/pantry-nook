"""分数实际用量的隔离 API 回归；只写 isolated_server.py 创建的数据库。"""
from __future__ import annotations

import re
import urllib.request

import regression_test as t


def main() -> None:
    with urllib.request.urlopen(t.BASE + "/health", timeout=10) as response:
        marker = response.headers.get("X-Pantry-Nook-Test-Database", "")
    if not re.fullmatch(r"pantry_nook_test_[0-9a-f]{32}", marker):
        raise RuntimeError("拒绝测试：请使用 isolated_server.py 启动独立测试库")

    ingredient = t.ingredient(f"分数西兰花-{t.STAMP}", value=1, unit="个")
    dishes = [t.data("POST", "/api/dishes", {"name": f"分数菜{index}-{t.STAMP}"}, 201) for index in range(3)]
    battle = t.data("POST", "/api/daily-battles", {
        "battle_date": "2026-09-11", "meal_slot": "dinner", "dish_ids": [dish["id"] for dish in dishes],
        "preparations": [{"dish_id": dish["id"], "ingredient_id": ingredient["id"], "planned_quantity_text": "1/3"} for dish in dishes],
    }, 201)
    rows = {dish["dish_id"]: dish["id"] for dish in battle["dishes"]}
    bad = {
        "expected_updated_at": battle["updated_at"],
        "consumptions": [{"ingredient_id": ingredient["id"], "daily_battle_dish_id": rows[dishes[0]["id"]],
                          "quantity_used_text": "1/3个", "expected_updated_at": ingredient["updated_at"]}],
    }
    t.check("带单位的分数输入被拒", t.request("POST", f"/api/daily-battles/{battle['id']}/confirm", bad)[0] == 400)
    result = t.data("POST", f"/api/daily-battles/{battle['id']}/confirm", {
        "expected_updated_at": battle["updated_at"],
        "consumptions": [{"ingredient_id": ingredient["id"], "daily_battle_dish_id": rows[dish["id"]],
                          "quantity_used_text": "1/3", "expected_updated_at": ingredient["updated_at"]} for dish in dishes],
    })
    t.check("三份三分之一汇总后耗尽一整份库存", result["consumptions"][-1]["remaining_after_value"] == 0)
    t.data("POST", f"/api/daily-battles/{battle['id']}/revoke-confirmation", {})
    restored = t.data("GET", f"/api/ingredients/{ingredient['id']}")
    t.check("撤销分数确认精确恢复库存", restored["stock_value"] == 1)
    t.data("POST", f"/api/daily-battles/{battle['id']}/cancel")


if __name__ == "__main__":
    main()
    print(f"PASS: {t.COUNT} assertions")
