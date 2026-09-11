"""当前库存、菜品与确认事务回归测试；仅允许隔离数据库。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
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


def ingredient(name: str, category="蔬菜", value=3, unit="个"):
    return data("POST", "/api/ingredients/batch", {"items": [{
        "name": name, "category": category, "stock_text": str(value),
        "stock_value": value, "stock_unit": unit,
    }]}, 201)[0]


def require_clean_isolated():
    with urllib.request.urlopen(BASE + "/health", timeout=10) as response:
        marker = response.headers.get("X-Pantry-Nook-Test-Database", "")
    if not re.fullmatch(r"pantry_nook_test_[0-9a-f]{32}", marker):
        raise RuntimeError("拒绝测试：请使用 isolated_server.py 启动独立测试库")
    status, planned = request("GET", "/api/daily-battles?status=planned&limit=1")
    if status != 200 or planned["meta"]["total"]:
        raise RuntimeError("隔离库有待完成菜单，请启动新的隔离库")
    check("隔离库标记和初始状态通过", True)


def main():
    require_clean_isolated()
    stock = ingredient(f"回归菠菜-{STAMP}")
    merged = ingredient(f"回归菠菜-{STAMP}", value=2)
    check("同名同单位自动累加", merged["id"] == stock["id"] and merged["stock_value"] == 5)

    located = data("POST", "/api/ingredients/batch", {"items": [{
        "name": f"位置菠菜-{STAMP}", "category": "蔬菜", "stock_text": "2", "stock_value": 2, "stock_unit": "把", "location": "冰箱冷藏",
    }]}, 201)[0]
    relocated = data("POST", "/api/ingredients/batch", {"items": [{
        "name": located["name"], "category": "蔬菜", "stock_text": "1", "stock_value": 1, "stock_unit": "把", "location": "冰箱冷冻",
    }]}, 201)[0]
    check("批量存放位置写入且同名补货可更新", relocated["id"] == located["id"] and relocated["location"] == "冰箱冷冻")

    status, _ = request("POST", "/api/ingredients/batch", {"items": [{
        "name": stock["name"], "category": "碳水", "stock_text": "1", "stock_value": 1, "stock_unit": "个",
    }]})
    check("同名分类冲突要求选择", status == 409)
    resolved = data("POST", "/api/ingredients/batch", {"items": [{
        "name": stock["name"], "category": "碳水", "stock_text": "1", "stock_value": 1, "stock_unit": "个",
    }], "resolutions": [{"ingredient_id": stock["id"], "category": "碳水"}]}, 201)[0]
    check("按选择统一分类并合并", resolved["category"] == "碳水" and resolved["stock_value"] == 6)

    status, body = request("POST", "/api/ingredients/batch", {"items": [
        {"name": f"valid-{STAMP}", "category": "其他", "stock_text": "1", "stock_value": 1, "stock_unit": "个"},
        {"name": "", "category": "其他", "stock_text": "1", "stock_value": 1, "stock_unit": "个"},
    ]})
    check("批量校验失败返回规范错误", status == 400 and body["error"]["code"] == "VALIDATION_ERROR")
    check("批量失败不写入半批", data("GET", f"/api/ingredients?q=valid-{STAMP}") == [])

    dish = data("POST", "/api/dishes", {"name": f"回归菜-{STAMP}"}, 201)
    plan = data("POST", "/api/meal-plans", {"name": f"回归搭配-{STAMP}", "dish_ids": [dish["id"]]}, 201)
    status, _ = request("DELETE", f"/api/dishes/{dish['id']}")
    check("搭配引用菜品不能删除", status == 409)
    check("菜品可查询引用搭配", data("GET", f"/api/dishes/{dish['id']}/meal-plans")[0]["id"] == plan["id"])

    battle = data("POST", "/api/daily-battles", {
        "battle_date": "2026-09-10", "meal_slot": "dinner", "dish_ids": [dish["id"]],
        "preparations": [{"dish_id": dish["id"], "ingredient_id": stock["id"], "planned_quantity_text": "1"}],
    }, 201)
    status, _ = request("PATCH", f"/api/ingredients/{stock['id']}", {"stock_value": 8, "stock_text": "8", "expected_updated_at": resolved["updated_at"]})
    check("待完成菜单允许直改库存", status == 200)
    status, _ = request("POST", "/api/ingredients/batch", {"items": [{
        "name": f"计划中新增-{STAMP}", "category": "其他", "stock_text": "1", "stock_value": 1, "stock_unit": "个",
    }]})
    check("待完成菜单允许新增库存", status == 201)

    status, _ = request("POST", f"/api/daily-battles/{battle['id']}/confirm", {
        "expected_updated_at": battle["updated_at"], "consumptions": [],
    })
    check("确认必须核对每项耗材", status == 400)
    before = data("GET", f"/api/ingredients/{stock['id']}")
    payload = {
        "expected_updated_at": battle["updated_at"],
        "consumptions": [{"ingredient_id": stock["id"], "daily_battle_dish_id": battle["dishes"][0]["id"], "quantity_used_text": "4", "expected_updated_at": before["updated_at"]}],
    }
    confirmed = data("POST", f"/api/daily-battles/{battle['id']}/confirm", payload)
    check("确认原子写入消耗", confirmed["status"] == "confirmed" and len(confirmed["consumptions"]) == 1)
    check("确认按实际用量调整库存", data("GET", f"/api/ingredients/{stock['id']}")["stock_value"] == 4)
    with ThreadPoolExecutor(max_workers=2) as executor:
        codes = list(executor.map(lambda _: request("POST", f"/api/daily-battles/{battle['id']}/confirm", payload)[0], range(2)))
    check("重复确认不重复扣库存", codes == [409, 409])
    data("POST", f"/api/daily-battles/{battle['id']}/revoke-confirmation", {})
    check("撤销确认精确恢复库存", data("GET", f"/api/ingredients/{stock['id']}")["stock_value"] == 8)
    history = data("GET", f"/api/daily-battles/{battle['id']}/consumptions")
    check("撤销保留反转历史", len(history) == 1 and history[0]["status"] == "reversed")
    data("POST", f"/api/daily-battles/{battle['id']}/cancel")


if __name__ == "__main__":
    main()
    print(f"PASS: {COUNT} assertions")
