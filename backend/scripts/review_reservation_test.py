"""核对锁定真实接口测试；只允许在 isolated_server.py 启动的测试库运行。"""
from __future__ import annotations

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
    status, body = request(method, path, payload)
    check(f"{method} {path} -> {expected}", status == expected)
    return body["data"]


def main():
    with urllib.request.urlopen(BASE + "/health", timeout=10) as response:
        marker = response.headers.get("X-Pantry-Nook-Test-Database", "")
    check("隔离测试库标记", bool(re.fullmatch(r"pantry_nook_test_[0-9a-f]{32}", marker)))

    ingredient = data("POST", "/api/ingredients/batch", {"items": [{
        "name": f"锁定鸡蛋-{STAMP}", "category": "蛋白质", "stock_text": "5", "stock_value": 5, "stock_unit": "个",
    }]}, 201)[0]
    dishes = [data("POST", "/api/dishes", {"name": f"锁定菜{i}-{STAMP}"}, 201) for i in (1, 2)]

    def battle(dish):
        return data("POST", "/api/daily-battles", {
            "battle_date": "2026-09-11", "meal_slot": "dinner", "dish_ids": [dish["id"]],
            "preparations": [{"dish_id": dish["id"], "ingredient_id": ingredient["id"], "planned_quantity_text": "3"}],
        }, 201)

    first, second = battle(dishes[0]), battle(dishes[1])
    data("POST", f"/api/daily-battles/{first['id']}/review-reservation")
    listed = data("GET", "/api/ingredients")
    reserved = next(item for item in listed if item["id"] == ingredient["id"])
    check("核对锁定不扣真实库存", reserved["stock_value"] == 5 and reserved["reserved_value"] == 3 and reserved["available_value"] == 2)
    check("第二份菜单不能锁定同一份不足库存", request("POST", f"/api/daily-battles/{second['id']}/review-reservation")[0] == 409)

    latest = data("GET", f"/api/ingredients/{ingredient['id']}")
    check("锁定期间不能把库存减少到锁定量以下", request("PATCH", f"/api/ingredients/{ingredient['id']}", {
        "stock_text": "2", "stock_value": 2, "expected_updated_at": latest["updated_at"],
    })[0] == 409)

    data("DELETE", f"/api/daily-battles/{first['id']}/review-reservation")
    data("POST", f"/api/daily-battles/{second['id']}/review-reservation")
    current_battle = data("GET", f"/api/daily-battles/{second['id']}")
    current_ingredient = data("GET", f"/api/ingredients/{ingredient['id']}")
    data("POST", f"/api/daily-battles/{second['id']}/confirm", {
        "expected_updated_at": current_battle["updated_at"],
        "consumptions": [{
            "ingredient_id": ingredient["id"], "daily_battle_dish_id": current_battle["dishes"][0]["id"],
            "quantity_used_text": "2", "expected_updated_at": current_ingredient["updated_at"],
        }],
    })
    after = data("GET", f"/api/ingredients/{ingredient['id']}")
    check("确认后才扣实际库存并释放锁定", after["stock_value"] == 3)
    data("POST", f"/api/daily-battles/{first['id']}/cancel")
    print(f"PASS: {COUNT} assertions")


if __name__ == "__main__":
    main()
