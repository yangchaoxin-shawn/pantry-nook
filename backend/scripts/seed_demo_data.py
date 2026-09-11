"""通过当前真实 API 写入一组可人工验收的本地测试数据。

运行前：先备份并清空业务测试数据，再启动本地 API。
  uv run python scripts/migrate_db.py
  uv run python scripts/reset_data.py --yes
  uv run python scripts/seed_demo_data.py [http://127.0.0.1:3000]

本脚本不清库、不使用 SQL 绕过业务规则；重复运行会因同名数据而失败。
"""

from __future__ import annotations

from datetime import date, timedelta
import json
import sys
import urllib.error
import urllib.request


BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000").rstrip("/")

INGREDIENTS = [
    {"name": "大米", "category": "碳水", "stock_text": "2", "stock_value": 2, "stock_unit": "kg", "location": "室温"},
    {"name": "挂面", "category": "碳水", "stock_text": "3", "stock_value": 3, "stock_unit": "把", "location": "室温"},
    {"name": "鸡蛋", "category": "蛋白质", "stock_text": "10", "stock_value": 10, "stock_unit": "个", "location": "冰箱冷藏"},
    {"name": "鸡胸肉", "category": "蛋白质", "stock_text": "500", "stock_value": 500, "stock_unit": "g", "location": "冰箱冷藏"},
    {"name": "嫩豆腐", "category": "蛋白质", "stock_text": "2", "stock_value": 2, "stock_unit": "盒", "location": "冰箱冷藏"},
    {"name": "番茄", "category": "蔬菜", "stock_text": "6", "stock_value": 6, "stock_unit": "个", "location": "室温"},
    {"name": "菠菜", "category": "蔬菜", "stock_text": "2", "stock_value": 2, "stock_unit": "把", "location": "冰箱冷藏"},
    {"name": "西兰花", "category": "蔬菜", "stock_text": "1", "stock_value": 1, "stock_unit": "个", "location": "冰箱冷藏"},
    {"name": "苹果", "category": "水果", "stock_text": "4", "stock_value": 4, "stock_unit": "个", "location": "室温"},
]

DISH_NAMES = ["番茄炒鸡蛋", "清炒菠菜", "香煎鸡胸肉", "白灼西兰花", "番茄豆腐汤"]


def request(method: str, path: str, payload=None) -> tuple[int, dict]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def data(method: str, path: str, payload=None, expected: int = 200):
    status, result = request(method, path, payload)
    if status != expected:
        message = result.get("error", {}).get("message", result)
        raise RuntimeError(f"{method} {path} 预期 {expected}，实际 {status}：{message}")
    return result["data"]


def create_ingredients() -> dict[str, dict]:
    rows = data("POST", "/api/ingredients/batch", {"items": INGREDIENTS}, 201)
    return {row["name"]: row for row in rows}


def create_dishes() -> dict[str, dict]:
    return {name: data("POST", "/api/dishes", {"name": name}, 201) for name in DISH_NAMES}


def create_plan(name: str, dishes: list[dict]) -> dict:
    return data("POST", "/api/meal-plans", {"name": name, "dish_ids": [dish["id"] for dish in dishes]}, 201)


def create_battle(battle_date: date, meal_slot: str, dish_ids: list[int], preparations: list[dict]) -> dict:
    return data("POST", "/api/daily-battles", {
        "battle_date": battle_date.isoformat(),
        "meal_slot": meal_slot,
        "dish_ids": dish_ids,
        "preparations": preparations,
    }, 201)


def confirm_tomato_eggs(battle: dict, egg: dict, tomato: dict) -> None:
    rows = {dish["dish_id"]: dish["id"] for dish in battle["dishes"]}
    payload = {
        "expected_updated_at": battle["updated_at"],
        "consumptions": [
            {"ingredient_id": egg["id"], "daily_battle_dish_id": rows[battle["dishes"][0]["dish_id"]], "quantity_used_text": "2个"},
            {"ingredient_id": tomato["id"], "daily_battle_dish_id": rows[battle["dishes"][0]["dish_id"]], "quantity_used_text": "2个"},
        ],
        "ingredient_totals": [
            {"ingredient_id": egg["id"], "stock_text": "8", "stock_value": 8, "expected_updated_at": egg["updated_at"]},
            {"ingredient_id": tomato["id"], "stock_text": "4", "stock_value": 4, "expected_updated_at": tomato["updated_at"]},
        ],
    }
    data("POST", f"/api/daily-battles/{battle['id']}/confirm", payload)


def main() -> None:
    status, health = request("GET", "/health")
    if status != 200 or health.get("database") != "connected":
        raise RuntimeError("API 未连接数据库，已停止写入")

    ingredients = create_ingredients()
    dishes = create_dishes()
    plans = {
        "快手晚餐": create_plan("快手晚餐", [dishes["番茄炒鸡蛋"], dishes["清炒菠菜"]]),
        "轻食组合": create_plan("轻食组合", [dishes["香煎鸡胸肉"], dishes["白灼西兰花"]]),
        "家常汤菜": create_plan("家常汤菜", [dishes["番茄豆腐汤"], dishes["清炒菠菜"]]),
    }

    today = date.today()
    completed = create_battle(today - timedelta(days=2), "dinner", [dishes["番茄炒鸡蛋"]["id"]], [
        {"dish_id": dishes["番茄炒鸡蛋"]["id"], "ingredient_id": ingredients["鸡蛋"]["id"], "planned_quantity_text": "2个"},
        {"dish_id": dishes["番茄炒鸡蛋"]["id"], "ingredient_id": ingredients["番茄"]["id"], "planned_quantity_text": "2个"},
    ])
    confirm_tomato_eggs(completed, ingredients["鸡蛋"], ingredients["番茄"])

    cancelled = create_battle(today - timedelta(days=1), "lunch", [dishes["番茄豆腐汤"]["id"]], [
        {"dish_id": dishes["番茄豆腐汤"]["id"], "ingredient_id": ingredients["番茄"]["id"], "planned_quantity_text": "2个"},
        {"dish_id": dishes["番茄豆腐汤"]["id"], "ingredient_id": ingredients["嫩豆腐"]["id"], "planned_quantity_text": "1盒"},
    ])
    data("POST", f"/api/daily-battles/{cancelled['id']}/cancel")

    pending = create_battle(today, "dinner", [dishes["香煎鸡胸肉"]["id"], dishes["白灼西兰花"]["id"]], [
        {"dish_id": dishes["香煎鸡胸肉"]["id"], "ingredient_id": ingredients["鸡胸肉"]["id"], "planned_quantity_text": "200g"},
        {"dish_id": dishes["白灼西兰花"]["id"], "ingredient_id": ingredients["西兰花"]["id"], "planned_quantity_text": "1个"},
    ])

    print("已写入本地测试数据：")
    print("- 库存：9 种食材；鸡蛋剩 8 个，番茄剩 4 个。")
    print("- 菜品：5 道；常用搭配：3 个。")
    print(f"- 历史：{(today - timedelta(days=2)).isoformat()} 晚餐已完成；{(today - timedelta(days=1)).isoformat()} 午餐已取消。")
    print(f"- 待完成：{today.isoformat()} 晚餐“香煎鸡胸肉 + 白灼西兰花”，可直接进入核对并确认。")
    print(f"- 记录 ID：已完成 {completed['id']}，已取消 {cancelled['id']}，待完成 {pending['id']}。")
    print(f"- 搭配 ID：" + "，".join(f"{name} {plan['id']}" for name, plan in plans.items()))


if __name__ == "__main__":
    main()
