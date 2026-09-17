"""日常用掉库存的真实 API 定向测试；只写带标记的隔离数据库。"""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import regression_test as t


def use_payload(item, amount, request_id=None):
    return {
        "stock_text": str(amount), "stock_value": amount, "stock_unit": item["stock_unit"],
        "client_request_id": request_id or str(uuid4()), "expected_updated_at": item["updated_at"],
    }


def recovery_choices(preview):
    return {
        "expected_updated_at": preview["expected_updated_at"],
        "merge_resolutions": [{
            "source_ingredient_id": item["source_ingredient_id"],
            "target_ingredient_id": item["target_ingredient_id"],
            "source_updated_at": item["source_updated_at"],
            "target_updated_at": item["target_updated_at"],
            "stock_unit": item["target_unit"],
        } for item in preview["items"] if item["target_ingredient_id"] is not None],
    }


def main():
    t.require_clean_isolated()

    grape = t.ingredient(f"日常葡萄-{t.STAMP}", category="水果", value=1, unit="kg")
    request_id = str(uuid4())
    used = t.data("POST", f"/api/ingredients/{grape['id']}/use", use_payload(grape, 0.3, request_id), 201)
    t.check("部分用掉立即扣减并记录正确类型", used["inventory"]["stock_value"] == 0.7 and used["adjustment"]["reason"] == "used")
    replay = t.data("POST", f"/api/ingredients/{grape['id']}/use", use_payload(grape, 0.3, request_id), 201)
    records = t.data("GET", "/api/inventory-adjustments?reason=used&limit=100")
    t.check("相同操作标识重试不重复扣减", replay["inventory"]["stock_value"] == 0.7 and len([row for row in records if row["client_request_id"] == request_id]) == 1)
    mismatched = use_payload(grape, 0.2, request_id)
    status, body = t.request("POST", f"/api/ingredients/{grape['id']}/use", mismatched)
    t.check("相同操作标识不能改成另一笔数量", status == 409 and body["error"]["code"] == "CONFLICT")

    status, body = t.request("POST", f"/api/ingredients/{grape['id']}/use", use_payload(grape, 0.1))
    t.check("过期版本返回最新库存且不写入", status == 409 and body["error"]["code"] == "RECORD_CHANGED" and body["error"]["details"]["current"]["stock_value"] == 0.7)
    fresh = t.data("GET", f"/api/ingredients/{grape['id']}")
    for amount in (0, -1, 0.700001):
        status, _ = t.request("POST", f"/api/ingredients/{grape['id']}/use", use_payload(fresh, amount))
        t.check(f"非法用掉数量 {amount} 被拒绝", status in (400, 409))

    damaged = t.ingredient(f"损坏番茄-{t.STAMP}", category="蔬菜", value=2)
    damaged_record = t.data("POST", f"/api/ingredients/{damaged['id']}/waste", {
        "stock_text": "1", "stock_value": 1, "stock_unit": damaged["stock_unit"],
        "reason": "damaged", "note": None, "expected_updated_at": damaged["updated_at"],
    }, 201)["adjustment"]
    used_status, used_page = t.request("GET", "/api/inventory-adjustments?kind=used&limit=1")
    waste_status, waste_page = t.request("GET", "/api/inventory-adjustments?kind=waste&limit=1")
    used_records = used_page["data"]
    waste_records = waste_page["data"]
    t.check("日常用掉与变质损坏在分页前由服务端分开查询", used_status == waste_status == 200 and used_page["meta"]["total"] == 1 and waste_page["meta"]["total"] == 1 and all(row["reason"] == "used" for row in used_records) and any(row["client_request_id"] == request_id for row in used_records) and all(row["reason"] != "used" for row in waste_records) and any(row["id"] == damaged_record["id"] for row in waste_records))

    restocked = t.ingredient(grape["name"], category="水果", value=0.2, unit="kg")
    preview_path = f"/api/ingredients/adjustments/{used['adjustment']['id']}"
    preview = t.data("GET", preview_path + "/recovery-preview")
    restored = t.data("POST", preview_path + "/revoke", recovery_choices(preview))
    t.check("部分用掉后补货再撤销只加回本次数量", restored["inventory"]["id"] == grape["id"] and restored["inventory"]["stock_value"] == 1.2)

    orange = t.ingredient(f"日常橙子-{t.STAMP}", category="水果", value=3)
    emptied = t.data("POST", f"/api/ingredients/{orange['id']}/use", use_payload(orange, 3), 201)
    t.check("全部用完退出当前库存但记录仍可达", t.request("GET", f"/api/ingredients/{orange['id']}")[0] == 404 and emptied["adjustment"]["ingredient_status_after"] == "consumed")
    replacement = t.ingredient(orange["name"], category="水果", value=4)
    merge_path = f"/api/ingredients/adjustments/{emptied['adjustment']['id']}"
    merge_preview = t.data("GET", merge_path + "/recovery-preview")
    merged = t.data("POST", merge_path + "/revoke", recovery_choices(merge_preview))
    t.check("吃完后重新入库再撤销会安全合并", merged["inventory"]["id"] == replacement["id"] and merged["inventory"]["stock_value"] == 7 and len(merged["adjustment"]["recovery_merges"]) == 1)
    t.check("同一记录不能重复撤销", t.request("POST", merge_path + "/revoke", {})[0] == 409)

    shared = t.ingredient(f"并发牛奶-{t.STAMP}", category="其他", value=2, unit="L")
    payloads = [use_payload(shared, 0.5), use_payload(shared, 0.5)]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda payload: t.request("POST", f"/api/ingredients/{shared['id']}/use", payload), payloads))
    t.check("同一库存版本并发只扣一次", sorted(status for status, _ in results) == [201, 409] and t.data("GET", f"/api/ingredients/{shared['id']}")["stock_value"] == 1.5)

    menu_item = t.ingredient(f"待餐草莓-{t.STAMP}", category="水果", value=2)
    dish = t.data("POST", "/api/dishes", {"name": f"水果碗-{t.STAMP}"}, 201)
    battle = t.data("POST", "/api/daily-battles", {
        "battle_date": "2041-03-01", "meal_slot": "dinner", "dish_ids": [dish["id"]],
        "preparations": [{"dish_id": dish["id"], "ingredient_id": menu_item["id"], "planned_quantity_text": "2"}],
    }, 201)
    t.data("POST", f"/api/ingredients/{menu_item['id']}/use", use_payload(menu_item, 1.5), 201)
    latest_menu_item = t.data("GET", f"/api/ingredients/{menu_item['id']}")
    confirm = {"expected_updated_at": battle["updated_at"], "consumptions": [{
        "ingredient_id": menu_item["id"], "daily_battle_dish_id": battle["dishes"][0]["id"],
        "quantity_used_text": "2", "expected_updated_at": latest_menu_item["updated_at"],
    }]}
    status, body = t.request("POST", f"/api/daily-battles/{battle['id']}/confirm", confirm)
    t.check("日常用掉后餐安排仍保留并由最新库存不足拦截", status == 409 and "库存只有" in body["error"]["message"] and t.data("GET", f"/api/daily-battles/{battle['id']}")["status"] == "planned")
    t.data("POST", f"/api/daily-battles/{battle['id']}/cancel")


if __name__ == "__main__":
    main()
    print(f"PASS: {t.COUNT} assertions")
