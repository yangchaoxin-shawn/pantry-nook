"""当前“贴耗材→保存→核对→确认→撤销”闭环测试；仅允许隔离库。"""
from __future__ import annotations

import copy
import json
import re
import sys
import urllib.error
import urllib.request
from uuid import uuid4

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3010
BASE = f"http://127.0.0.1:{PORT}"
STAMP = uuid4().hex[:10]
COUNT = 0


def request(method: str, path: str, payload=None):
    raw = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    req = urllib.request.Request(BASE + path, data=raw, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def check(label: str, value: bool):
    global COUNT
    if not value:
        raise AssertionError(label)
    COUNT += 1
    print(f"[OK] {label}")


def data(method: str, path: str, payload=None, expected=200):
    status, result = request(method, path, payload)
    check(f"{method} {path} -> {expected}", status == expected)
    return result["data"]


def ingredient(name: str, category: str, value: float, unit: str):
    return data("POST", "/api/ingredients/batch", {"items": [{
        "name": name, "category": category, "stock_text": str(value), "stock_value": value, "stock_unit": unit,
    }]}, 201)[0]


def main():
    with urllib.request.urlopen(BASE + "/health", timeout=10) as response:
        marker = response.headers.get("X-Pantry-Nook-Test-Database", "")
    if not re.fullmatch(r"pantry_nook_test_[0-9a-f]{32}", marker):
        raise RuntimeError("拒绝测试：请使用 isolated_server.py 启动独立测试库")
    check("隔离库标记通过", True)
    egg = ingredient(f"菜单鸡蛋-{STAMP}", "蛋白质", 6, "个")
    spinach = ingredient(f"菜单菠菜-{STAMP}", "蔬菜", 1, "把")
    tomato = ingredient(f"菜单番茄-{STAMP}", "蔬菜", 3, "个")
    one = data("POST", "/api/dishes", {"name": f"番茄炒蛋-{STAMP}"}, 201)
    two = data("POST", "/api/dishes", {"name": f"清炒菠菜-{STAMP}"}, 201)
    base = {"battle_date": "2026-09-10", "meal_slot": "dinner", "dish_ids": [one["id"], two["id"]]}
    status, _ = request("POST", "/api/daily-battles", {**base, "preparations": []})
    check("每道菜保存前必须贴耗材", status == 400)
    status, _ = request("POST", "/api/daily-battles", {**base, "preparations": [{"dish_id": one["id"], "ingredient_id": egg["id"], "planned_quantity_text": "2"}]})
    check("不能遗漏另一道菜耗材", status == 400)

    blank = data("POST", "/api/daily-battles", {**base, "preparations": [
        {"dish_id": one["id"], "ingredient_id": egg["id"], "planned_quantity_text": ""},
        {"dish_id": two["id"], "ingredient_id": spinach["id"], "planned_quantity_text": "1"},
    ]}, 201)
    check("草稿允许稍后补预计用量", blank["status"] == "planned")
    status, _ = request("POST", f"/api/daily-battles/{blank['id']}/confirm", {"consumptions": []})
    check("预计用量为空时不能确认", status == 400)
    data("POST", f"/api/daily-battles/{blank['id']}/cancel")

    preparations = [
        {"dish_id": one["id"], "ingredient_id": egg["id"], "planned_quantity_text": "2"},
        {"dish_id": one["id"], "ingredient_id": tomato["id"], "planned_quantity_text": "2"},
        {"dish_id": two["id"], "ingredient_id": spinach["id"], "planned_quantity_text": "1"},
    ]
    battle = data("POST", "/api/daily-battles", {**base, "preparations": preparations}, 201)
    check("菜单保存餐次与耗材", battle["meal_slot"] == "dinner" and len(battle["preparations"]) == 3)
    status, _ = request("PATCH", f"/api/daily-battles/{battle['id']}", {"dish_ids": [one["id"], two["id"]]})
    check("更新菜单必须提交耗材", status == 400)
    stale = copy.deepcopy(battle)
    battle = data("PATCH", f"/api/daily-battles/{battle['id']}", {"dish_ids": [one["id"], two["id"]], "preparations": preparations, "meal_slot": "lunch", "expected_updated_at": battle["updated_at"]})
    check("更新菜单保留耗材并更新餐次", battle["meal_slot"] == "lunch" and len(battle["preparations"]) == 3)
    status, _ = request("PATCH", f"/api/daily-battles/{battle['id']}", {"dish_ids": [one["id"], two["id"]], "preparations": preparations, "expected_updated_at": stale["updated_at"]})
    check("过期版本不能覆盖菜单", status == 409)

    rows = {item["dish_id"]: item["id"] for item in battle["dishes"]}
    payload = {
        "expected_updated_at": battle["updated_at"],
        "consumptions": [
            {"ingredient_id": egg["id"], "daily_battle_dish_id": rows[one["id"]], "quantity_used_text": "2", "expected_updated_at": egg["updated_at"]},
            {"ingredient_id": tomato["id"], "daily_battle_dish_id": rows[one["id"]], "quantity_used_text": "2", "expected_updated_at": tomato["updated_at"]},
            {"ingredient_id": spinach["id"], "daily_battle_dish_id": rows[two["id"]], "quantity_used_text": "1", "expected_updated_at": spinach["updated_at"]},
        ],
    }
    invalid = copy.deepcopy(payload)
    invalid["consumptions"][0]["expected_updated_at"] = "2000-01-01T00:00:00Z"
    data("POST", f"/api/daily-battles/{battle['id']}/review-reservation")
    status, _ = request("POST", f"/api/daily-battles/{battle['id']}/confirm", invalid)
    check("库存版本冲突时确认整体回滚", status == 409)
    check("失败不扣库存", data("GET", f"/api/ingredients/{egg['id']}")["stock_value"] == 6)
    confirmed = data("POST", f"/api/daily-battles/{battle['id']}/confirm", payload)
    check("确认保留按菜实际用量", confirmed["status"] == "confirmed" and len(confirmed["consumptions"]) == 3)
    check("确认按核对总量更新库存", data("GET", f"/api/ingredients/{egg['id']}")["stock_value"] == 4)
    status, _ = request("GET", f"/api/ingredients/{spinach['id']}")
    check("为零库存移出当前库存", status == 404)
    history = data("GET", f"/api/daily-battles/{battle['id']}/consumptions")
    check("消耗历史按菜单可读取", len(history) == 3 and all(row["status"] == "active" for row in history))
    cancelled = data("POST", f"/api/daily-battles/{battle['id']}/revoke-confirmation", {"target_status": "cancelled"})
    check("撤销确认可归入历史", cancelled["status"] == "cancelled")
    check("撤销恢复已耗尽食材", data("GET", f"/api/ingredients/{spinach['id']}")["stock_value"] == 1)
    history = data("GET", f"/api/daily-battles/{battle['id']}/consumptions")
    check("撤销保留反转历史", all(row["status"] == "reversed" for row in history))


if __name__ == "__main__":
    main()
    print(f"PASS: {COUNT} assertions")
