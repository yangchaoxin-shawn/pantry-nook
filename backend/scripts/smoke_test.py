"""完整业务链路冒烟测试：验证 Python 后端核心业务规则。

用时间戳唯一化名称，避免与既有数据冲突。覆盖：
1. 食材 CRUD + 未确认作战禁改库存
2. 菜品、搭配方案
3. 今日作战创建（按 dish_ids）
4. 确认作战 -> 库存扣减 + 消耗记录
5. 撤销确认 -> 库存恢复
6. 校验错误消息格式
运行：uv run python scripts/smoke_test.py [port]
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3111
BASE = f"http://127.0.0.1:{PORT}"
STAMP = str(int(time.time()))[-7:]  # 唯一后缀


def req(method: str, path: str, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"raw": body}


def check(label, cond, detail=""):
    mark = "OK " if cond else "FAIL"
    print(f"[{mark}] {label}" + (f"  -- {detail}" if detail else ""))
    return cond


results: list[bool] = []

# 仅在专门的隔离服务运行写入测试，端口本身不能证明数据库安全。
with urllib.request.urlopen(BASE + "/health", timeout=10) as health_response:
    test_database = health_response.headers.get("X-Pantry-Nook-Test-Database", "")
if not re.fullmatch(r"pantry_nook_test_[0-9a-f]{32}", test_database):
    print("[BLOCKED] 请先使用 scripts/isolated_server.py 启动独立测试库服务。")
    raise SystemExit(2)

# 冒烟测试需要独占的干净数据库。若已有 planned 作战，先停止，避免污染现有开发数据。
s, planned = req("GET", "/api/daily-battles?status=planned&limit=1")
if s != 200:
    print(f"[FAIL] 无法读取现有今日作战  -- status={s}")
    raise SystemExit(1)
if planned.get("meta", {}).get("total", 0) > 0:
    print("[BLOCKED] 数据库已有 planned 今日作战；请改用隔离测试数据库运行冒烟测试。")
    raise SystemExit(2)

# --- 1. 基础 CRUD ---
ing_name = f"土豆{STAMP}"
s, ingredient = req("POST", "/api/ingredients/batch", {"items": [{
    "name": ing_name, "category": "碳水", "stock_text": "3",
    "stock_value": 3, "stock_unit": "个",
}]})
ingredient_data = ingredient.get("data", [None])[0] if s == 201 else None
results.append(check("创建食材 201", s == 201 and ingredient_data and ingredient_data.get("name") == ing_name, f"status={s}"))
ingredient_id = ingredient_data["id"] if ingredient_data else None

# --- 1.1 变质/损坏处理与安全撤销 ---
if ingredient_id and ingredient_data:
    s, wasted = req("POST", f"/api/ingredients/{ingredient_id}/waste", {
        "stock_text": "1", "stock_value": 1, "stock_unit": "个",
        "reason": "damaged", "expected_updated_at": ingredient_data["updated_at"],
    })
    results.append(check("处理损坏库存 201", s == 201 and wasted.get("data", {}).get("inventory", {}).get("stock_value") == 2, f"status={s}"))
    adjustment_id = wasted.get("data", {}).get("adjustment", {}).get("id")
    s, revoked_waste = req("POST", f"/api/ingredients/adjustments/{adjustment_id}/revoke") if adjustment_id else (0, {})
    results.append(check("撤销库存处理并恢复库存", s == 200 and revoked_waste.get("data", {}).get("inventory", {}).get("stock_value") == 3, f"status={s}"))
    latest_after_revoke = revoked_waste.get("data", {}).get("inventory", {})
    s, fully_wasted = req("POST", f"/api/ingredients/{ingredient_id}/waste", {
        "stock_text": "3", "stock_value": 3, "stock_unit": "个",
        "reason": "spoiled", "expected_updated_at": latest_after_revoke.get("updated_at"),
    })
    results.append(check("全部报废库存 201", s == 201 and fully_wasted.get("data", {}).get("inventory", {}).get("stock_value") == 0, f"status={s}"))
    full_adjustment_id = fully_wasted.get("data", {}).get("adjustment", {}).get("id")
    s, _ = req("GET", f"/api/ingredients/{ingredient_id}")
    results.append(check("全部报废后不在当前库存", s == 404, f"status={s}"))
    s, ledger = req("GET", "/api/inventory-adjustments?status=active&limit=100")
    ledger_items = ledger.get("data", []) if s == 200 else []
    full_record = next((row for row in ledger_items if row.get("id") == full_adjustment_id), None)
    results.append(check("全局库存处理记录可找到已报废食材", s == 200 and full_record is not None and full_record.get("ingredient_name") == ing_name, f"status={s}"))
    s, restored_full_waste = req("POST", f"/api/ingredients/adjustments/{full_adjustment_id}/revoke") if full_adjustment_id else (0, {})
    results.append(check("从全局记录撤销全部报废并恢复库存", s == 200 and restored_full_waste.get("data", {}).get("inventory", {}).get("stock_value") == 3, f"status={s}"))

dish_name = f"酸辣土豆丝{STAMP}"
s, dish = req("POST", "/api/dishes", {"name": dish_name})
results.append(check("创建菜品 201", s == 201, f"status={s}"))
dish_id = dish["data"]["id"] if s == 201 else None

s, plan = req("POST", "/api/meal-plans", {"name": f"快手家常{STAMP}", "dish_ids": [dish_id]})
results.append(check("创建搭配方案 201", s == 201, f"status={s}"))
plan_id = plan["data"]["id"] if s == 201 else None
s, _ = req("DELETE", f"/api/dishes/{dish_id}") if dish_id else (0, {})
results.append(check("被搭配引用的菜品不能直接删除 409", s == 409, f"status={s}"))

# --- 2. 今日作战（按 dish_ids） ---
s, _ = req("POST", "/api/daily-battles", {"battle_date": "2026-09-08", "dish_ids": [dish_id], "preparations": []})
results.append(check("未贴耗材的菜单不能保存 400", s == 400, f"status={s}"))
s, battle = req("POST", "/api/daily-battles", {"battle_date": "2026-09-08", "dish_ids": [dish_id], "preparations": [{
    "dish_id": dish_id, "ingredient_id": ingredient_id, "planned_quantity_text": "半个",
}]})
results.append(check("创建今日作战 201", s == 201, f"status={s}"))
battle_id = battle["data"]["id"] if s == 201 else None

# --- 3. 未确认作战存在时，不能直接改库存 ---
if battle_id and ingredient_id:
    s, _ = req("PATCH", f"/api/ingredients/{ingredient_id}", {"stock_value": 10})
    results.append(check("未确认作战时改库存被拒 409", s == 409, f"status={s}"))

# --- 4. 确认作战 -> 数量扣减 ---
if battle_id and ingredient_id:
    s, latest_ingredient = req("GET", f"/api/ingredients/{ingredient_id}")
    s, resp = req("POST", f"/api/daily-battles/{battle_id}/confirm", {
        "consumptions": [{
            "ingredient_id": ingredient_id,
            "daily_battle_dish_id": battle["data"]["dishes"][0]["id"],
            "quantity_used_text": "半个",
        }],
        "ingredient_totals": [{
            "ingredient_id": ingredient_id,
            "stock_text": "2.5个",
            "stock_value": 2.5,
            "expected_updated_at": latest_ingredient["data"]["updated_at"],
        }],
        "expected_updated_at": battle["data"]["updated_at"],
    })
    results.append(check("确认作战 200", s == 200, f"status={s}"))
    s, ing = req("GET", f"/api/ingredients/{ingredient_id}")
    after_confirm = ing["data"]["stock_value"]
    results.append(check("确认后库存扣减为 2.5", after_confirm == 2.5, f"remaining={after_confirm}"))

# --- 5. 撤销确认 -> 库存恢复 ---
if battle_id:
    s, _ = req("POST", f"/api/daily-battles/{battle_id}/revoke-confirmation", {})
    results.append(check("撤销确认 200", s == 200, f"status={s}"))
    s, ing = req("GET", f"/api/ingredients/{ingredient_id}")
    after_revoke = ing["data"]["stock_value"]
    results.append(check("撤销后库存恢复为 3", after_revoke == 3, f"remaining={after_revoke}"))

# --- 6. 校验错误消息格式 ---
s, err = req("GET", "/api/ingredients/999999")
results.append(check("不存在食材 404 + NOT_FOUND", s == 404 and err["error"]["code"] == "NOT_FOUND", f"status={s}"))

print(f"\n=== 结果: {sum(results)}/{len(results)} 通过 ===")
# 保留历史核查证据，只通过业务接口取消本测试撤销后留下的计划。
if battle_id:
    s, current = req("GET", f"/api/daily-battles/{battle_id}")
    if s == 200 and current["data"]["status"] == "planned":
        req("POST", f"/api/daily-battles/{battle_id}/cancel")
sys.exit(0 if all(results) else 1)
