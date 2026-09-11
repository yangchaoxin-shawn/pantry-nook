"""已有手动校验路由的 OpenAPI 描述；只补充文档，不改变业务执行。

路径由 FastAPI 发现，请求与响应字段在此集中描述；导出脚本和前端类型
均消费 app.openapi()，避免另外维护一份接口 YAML。
"""

from copy import deepcopy

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi


def ref(name: str) -> dict:
    return {"$ref": f"#/components/schemas/{name}"}


def nullable(schema: dict) -> dict:
    return {"anyOf": [schema, {"type": "null"}]}


def obj(properties: dict, required=None, **extra) -> dict:
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required, **extra}


def array(schema: dict, **extra) -> dict:
    return {"type": "array", "items": schema, **extra}


def require_known_field(properties: dict) -> dict:
    # 排除所有已知字段均缺席的对象；未知字段仍可随有效字段一同传入。
    # 不将某一个 PATCH 字段标成必填，前端可逐项构造局部修改。
    return {"not": {"properties": {name: False for name in properties}}}


ID = {"type": "integer", "minimum": 1, "maximum": 9007199254740991}
TEXT = {"type": "string", "maxLength": 255}
REQUIRED_TEXT = {**TEXT, "minLength": 1, "description": "去除首尾空白后不能为空。"}
DATE = {"type": "string", "format": "date"}
TIME = {"type": "string", "format": "date-time"}
NUMBER = {"type": "number", "minimum": 0, "maximum": 999999999.999999, "multipleOf": 0.000001}
CATEGORY = {"type": "string", "enum": ["碳水", "蔬菜", "蛋白质", "水果", "其他"]}
LOCATION = {"type": "string", "enum": ["冰箱冷藏", "冰箱冷冻", "室温", "其他"]}
INGREDIENT_STATUS = {"type": "string", "enum": ["active", "consumed", "discarded"]}
BATTLE_STATUS = {"type": "string", "enum": ["planned", "confirmed", "cancelled"]}
MEAL_SLOT = {"type": "string", "enum": ['breakfast', 'lunch', 'dinner']}
CONSUMPTION_STATUS = {"type": "string", "enum": ["active", "reversed"]}
ADJUSTMENT_STATUS = {"type": "string", "enum": ["active", "reversed"]}
TIMESTAMPS = {"created_at": TIME, "updated_at": TIME}
DISH_IDS = array(ID, minItems=1, maxItems=50, uniqueItems=True)


def build_schemas() -> dict:
    inventory_input = {
        "name": REQUIRED_TEXT, "category": CATEGORY, "stock_text": REQUIRED_TEXT,
        "stock_value": NUMBER, "stock_unit": {"type": "string", "maxLength": 50},
        "location": nullable(LOCATION), "note": nullable({"type": "string", "maxLength": 5000}),
    }
    ingredient = {"id": ID, **inventory_input, "note": nullable({"type": "string"}), **TIMESTAMPS}
    dish = {"id": ID, "name": TEXT, "deleted_at": nullable(TIME), **TIMESTAMPS}
    plan = {"id": ID, "name": nullable(TEXT), **TIMESTAMPS}
    battle = {
        "id": ID, "battle_date": DATE, "meal_plan_id": nullable(ID), "meal_slot": nullable(MEAL_SLOT),
        "status": BATTLE_STATUS, "confirmed_at": nullable(TIME),
        "cancelled_at": nullable(TIME), **TIMESTAMPS,
    }
    consumption = {
        "id": ID, "daily_battle_id": ID, "daily_battle_dish_id": nullable(ID),
        "ingredient_id": ID, "quantity_used_text": TEXT,
        "quantity_value": nullable(NUMBER), "quantity_unit": nullable(TEXT),
        "note": nullable({"type": "string"}),
        "remaining_before_text": nullable(TEXT), "remaining_before_value": nullable(NUMBER),
        "remaining_after_text": nullable(TEXT), "remaining_after_value": nullable(NUMBER),
        "ingredient_status_before": INGREDIENT_STATUS, "ingredient_ended_at_before": nullable(TIME),
        "ingredient_status_after": INGREDIENT_STATUS, "ingredient_ended_at_after": nullable(TIME),
        "status": CONSUMPTION_STATUS, "reversed_at": nullable(TIME), **TIMESTAMPS,
    }
    battle_consumption_extra = {
        "ingredient_name": TEXT, "category": CATEGORY, "daily_battle_dish_name": nullable(TEXT),
    }
    ingredient_consumption_extra = {
        "battle_date": DATE, "battle_status": BATTLE_STATUS,
        "daily_battle_dish_name": nullable(TEXT),
    }
    actual_usage = {
        "ingredient_id": ID, "daily_battle_dish_id": nullable(ID),
        "quantity_used_text": {**REQUIRED_TEXT, "description": "填写不带单位的实际用量；支持 1、0.5、1/2、1/3 等简单分数。"},
        "expected_updated_at": TIME, "note": nullable({"type": "string", "maxLength": 5000}),
    }
    schemas = {
        "Ingredient": obj(ingredient), "Dish": obj(dish),
        "MealPlanRecord": obj(plan),
        "MealPlanDish": obj({"id": ID, "name": TEXT, "position": {"type": "integer", "minimum": 0}}),
        "MealPlan": obj({**plan, "dishes": array(ref("MealPlanDish"))}),
        "DishMealPlan": obj({**plan, "position": {"type": "integer", "minimum": 0}}),
        "DailyBattleRecord": obj(battle),
        "DailyBattleDish": obj({"id": ID, "dish_id": ID, "name": TEXT,
                                "position": {"type": "integer", "minimum": 0}}),
        "PreparationInput": obj({'dish_id': ID, 'ingredient_id': ID, 'planned_quantity_text': nullable(TEXT)}, ['dish_id', 'ingredient_id']),
        "Preparation": obj({'id': ID, 'daily_battle_dish_id': ID, 'dish_id': ID, 'ingredient_id': ID,
                            'ingredient_name': TEXT, 'ingredient_status': INGREDIENT_STATUS,
                            'planned_quantity_text': nullable(TEXT), 'position': {'type': 'integer'}, **TIMESTAMPS}),
        "DailyBattle": obj({**battle, "dishes": array(ref("DailyBattleDish")), 'preparations': array(ref('Preparation'))}),
        "ConfirmedBattle": obj({**battle, "dishes": array(ref("DailyBattleDish")),
                                'preparations': array(ref('Preparation')), "consumptions": array(ref("BattleConsumption"))}),
        "BattleConsumption": obj({**consumption, **battle_consumption_extra}),
        "IngredientConsumption": obj({**consumption, **ingredient_consumption_extra}),
        "Consumption": obj({**consumption, **ingredient_consumption_extra, **battle_consumption_extra}),
        "IngredientCreate": obj(inventory_input, ["name", "category", "stock_text", "stock_value", "stock_unit"]),
        "InventoryResolution": obj({
            "ingredient_id": ID,
            "category": CATEGORY,
            "stock_unit": {"type": "string", "maxLength": 50},
            "final_stock_text": REQUIRED_TEXT,
            "final_stock_value": NUMBER, "expected_updated_at": {"type": "string", "format": "date-time"},
        }, ["ingredient_id"],
        description="同名在库食材发生分类或单位冲突时的用户选择。单位不可换算时，final_stock_text、final_stock_value 与 expected_updated_at 必填；版本过期拒绝覆盖。"),
        "IngredientBatchCreate": obj({
            "items": array(ref("IngredientCreate"), minItems=1, maxItems=30),
            "resolutions": array(ref("InventoryResolution"), maxItems=30),
        }, ["items"], description="批量记录当前库存。空白行不发送；任意一项校验失败时整批不写入；待完成菜单不限制入库。"),
        "IngredientUpdate": obj({**inventory_input, "expected_updated_at": {"type": "string", "format": "date-time"}}, [], minProperties=1, **require_known_field(inventory_input),
                                description="至少提供一个可修改字段。修改任意 stock_* 字段必须提供 expected_updated_at；版本过期返回 409，不覆盖他人的变更。"),
        "IngredientFinish": obj({"stock_text": nullable(TEXT),
                                 "note": nullable({"type": "string", "maxLength": 5000})}, []),
        "InventoryWaste": obj({"stock_text": REQUIRED_TEXT, "stock_value": {**NUMBER, "exclusiveMinimum": 0},
                                 "stock_unit": {"type": "string", "maxLength": 50},
                                 "reason": {"type": "string", "enum": ["spoiled", "damaged", "other"]},
                                 "note": nullable(TEXT), "expected_updated_at": TIME},
                                ["stock_text", "stock_value", "stock_unit", "reason", "expected_updated_at"]),
        "InventoryAdjustment": obj({"id": ID, "ingredient_id": ID,
                                     "reason": {"type": "string", "enum": ["spoiled", "damaged", "other"]},
                                     "note": nullable(TEXT), "stock_before_text": TEXT, "stock_before_value": NUMBER,
                                     "stock_before_unit": TEXT, "stock_after_text": TEXT, "stock_after_value": NUMBER,
                                     "stock_after_unit": TEXT, "status": {"type": "string", "enum": ["active", "reversed"]},
                                     "reversed_at": nullable(TIME), **TIMESTAMPS}),
        "DishInput": obj({"name": REQUIRED_TEXT}),
        "MealPlanCreate": obj({"name": nullable(TEXT), "dish_ids": DISH_IDS}, ["dish_ids"]),
        "MealPlanUpdate": obj({"name": nullable(TEXT), "dish_ids": DISH_IDS}, [], minProperties=1,
                              **require_known_field({"name": nullable(TEXT), "dish_ids": DISH_IDS})),
        "DailyBattleCreate": obj({"battle_date": DATE, "meal_plan_id": nullable(ID), "dish_ids": DISH_IDS,
                                  'meal_slot': nullable(MEAL_SLOT), 'preparations': array(ref('PreparationInput'), minItems=1, maxItems=500)},
                                 ["battle_date", "preparations"], oneOf=[
                                     {"required": ["meal_plan_id"], "properties": {"meal_plan_id": ID, "dish_ids": False},
                                      "not": {"required": ["dish_ids"]}},
                                     {"required": ["dish_ids"], "properties": {"dish_ids": DISH_IDS, "meal_plan_id": {"type": "null"}}},
                                 ], description="meal_plan_id 与 dish_ids 必须二选一；从方案创建时复制菜品。保存前每道菜必须贴至少一项耗材；预计用量可在草稿阶段补全，确认库存前必须完整。"),
        "DailyBattleUpdate": obj({"dish_ids": DISH_IDS, 'battle_date': DATE, 'meal_slot': nullable(MEAL_SLOT),
                                   'preparations': array(ref('PreparationInput'), minItems=1, maxItems=500), 'expected_updated_at': TIME}, ['dish_ids', 'preparations']),
        "ActualUsage": obj(actual_usage, ["ingredient_id", "quantity_used_text", "expected_updated_at"]),
        "BattleConfirm": obj({"consumptions": array(ref('ActualUsage'), maxItems=500), 'expected_updated_at': TIME}, ["consumptions", "expected_updated_at"],
                             description="后端在同一事务内按实际用量计算库存、写入消耗并校验菜单与库存版本；客户端不得提交剩余库存。"),
        "BattleRevoke": obj({"target_status": {"type": "string", "enum": ["planned", "cancelled"], "default": "planned"}}, []),
        "PaginationMeta": obj({"total": {"type": "integer", "minimum": 0},
                               "limit": {"type": "integer", "minimum": 1, "maximum": 100},
                               "offset": {"type": "integer", "minimum": 0}}),
        "Error": obj({"error": obj({"code": {"type": "string"}, "message": {"type": "string"},
                                    "details": {}}, ["code", "message"])}),
        "Health": obj({"status": {"type": "string", "enum": ["ok"]},
                       "database": {"type": "string", "enum": ["connected"]}}),
    }
    for name in ["Ingredient", "Dish", "MealPlan", "MealPlanRecord", "DailyBattle", "DailyBattleRecord",
                 "ConfirmedBattle", "Consumption"]:
        schemas[f"{name}Response"] = obj({"data": ref(name)})
    schemas["IngredientBatchResponse"] = obj({"data": array(ref("Ingredient"))})
    adjustment_record = {"id": ID, "ingredient_id": ID,
                         "reason": {"type": "string", "enum": ["spoiled", "damaged", "other"]},
                         "note": nullable(TEXT), "stock_before_text": TEXT, "stock_before_value": NUMBER,
                         "stock_before_unit": TEXT, "stock_after_text": TEXT, "stock_after_value": NUMBER,
                         "stock_after_unit": TEXT, "status": ADJUSTMENT_STATUS,
                         "reversed_at": nullable(TIME), "ingredient_name": TEXT, "category": CATEGORY, **TIMESTAMPS}
    schemas["InventoryAdjustmentRecord"] = obj(adjustment_record)
    schemas["InventoryAdjustmentList"] = obj({"data": array(ref("InventoryAdjustmentRecord"))})
    schemas["InventoryAdjustmentPage"] = obj({"data": array(ref("InventoryAdjustmentRecord")), "meta": ref("PaginationMeta")})
    schemas["InventoryWasteResponse"] = obj({"data": obj({"inventory": ref("Ingredient"), "adjustment": ref("InventoryAdjustment")})})
    for name in ["Ingredient", "Dish", "MealPlan", "DailyBattle", "Consumption"]:
        schemas[f"{name}List"] = obj({"data": array(ref(name)), "meta": ref("PaginationMeta")})
    for name in ["DishMealPlan", "BattleConsumption", "IngredientConsumption"]:
        schemas[f"{name}List"] = obj({"data": array(ref(name))})
    return schemas


def query(name: str, schema: dict, description: str = "") -> dict:
    return {"name": name, "in": "query", "required": False, "schema": schema, "description": description}


PAGINATION = [query("limit", {"type": "integer", "minimum": 1, "maximum": 100, "default": 50}),
              query("offset", {"type": "integer", "minimum": 0, "default": 0})]
SEARCH = query("q", {"type": "string", "minLength": 1, "maxLength": 100})
DATE_RANGE = [query("from", DATE), query("to", DATE)]


def install_openapi(app: FastAPI) -> None:
    """集中挂接契约描述，保留原路由的手动校验和 JSONResponse 行为。"""
    # path, method, success schema, body schema, body required, success code
    operations = [
        ("/health", "get", "Health", None, False, 200),
        ("/api/ingredients", "get", "IngredientList", None, False, 200),
        ("/api/ingredients/batch", "post", "IngredientBatchResponse", "IngredientBatchCreate", True, 201),
        ("/api/inventory-adjustments", "get", "InventoryAdjustmentPage", None, False, 200),
        ("/api/ingredients/{ingredient_id}", "get", "IngredientResponse", None, False, 200),
        ("/api/ingredients/{ingredient_id}", "patch", "IngredientResponse", "IngredientUpdate", True, 200),
        ("/api/ingredients/{ingredient_id}/waste", "post", "InventoryWasteResponse", "InventoryWaste", True, 201),
        ("/api/ingredients/{ingredient_id}/adjustments", "get", "InventoryAdjustmentList", None, False, 200),
        ("/api/ingredients/adjustments/{adjustment_id}/revoke", "post", "InventoryWasteResponse", None, False, 200),
        ("/api/dishes", "get", "DishList", None, False, 200),
        ("/api/dishes", "post", "DishResponse", "DishInput", True, 201),
        ("/api/dishes/{dish_id}", "get", "DishResponse", None, False, 200),
        ("/api/dishes/{dish_id}", "patch", "DishResponse", "DishInput", True, 200),
        ("/api/dishes/{dish_id}", "delete", "DishResponse", None, False, 200),
        ("/api/dishes/{dish_id}/meal-plans", "get", "DishMealPlanList", None, False, 200),
        ("/api/meal-plans", "get", "MealPlanList", None, False, 200),
        ("/api/meal-plans", "post", "MealPlanResponse", "MealPlanCreate", True, 201),
        ("/api/meal-plans/{plan_id}", "get", "MealPlanResponse", None, False, 200),
        ("/api/meal-plans/{plan_id}", "patch", "MealPlanResponse", "MealPlanUpdate", True, 200),
        ("/api/meal-plans/{plan_id}", "delete", "MealPlanRecordResponse", None, False, 200),
        ("/api/daily-battles", "get", "DailyBattleList", None, False, 200),
        ("/api/daily-battles", "post", "DailyBattleResponse", "DailyBattleCreate", True, 201),
        ("/api/daily-battles/{battle_id}", "get", "DailyBattleResponse", None, False, 200),
        ("/api/daily-battles/{battle_id}", "patch", "DailyBattleResponse", "DailyBattleUpdate", True, 200),
        ("/api/daily-battles/{battle_id}", "delete", "DailyBattleRecordResponse", None, False, 200),
        ("/api/daily-battles/{battle_id}/consumptions", "get", "BattleConsumptionList", None, False, 200),
        ("/api/daily-battles/{battle_id}/cancel", "post", "DailyBattleResponse", None, False, 200),
        ("/api/daily-battles/{battle_id}/confirm", "post", "ConfirmedBattleResponse", "BattleConfirm", True, 200),
        ("/api/daily-battles/{battle_id}/revoke-confirmation", "post", "DailyBattleResponse", "BattleRevoke", False, 200),
        ("/api/consumptions", "get", "ConsumptionList", None, False, 200),
        ("/api/consumptions/{consumption_id}", "get", "ConsumptionResponse", None, False, 200),
    ]
    list_queries = {
        "/api/ingredients": [*PAGINATION, SEARCH, query("category", CATEGORY), query("location", LOCATION)],
        "/api/inventory-adjustments": [*PAGINATION, query("status", ADJUSTMENT_STATUS), query("reason", {"type": "string", "enum": ["spoiled", "damaged", "other"]})],
        "/api/dishes": [*PAGINATION, SEARCH],
        "/api/meal-plans": PAGINATION,
        "/api/daily-battles": [*PAGINATION, *DATE_RANGE, query("status", BATTLE_STATUS), query('meal_slot', MEAL_SLOT)],
        "/api/consumptions": [*PAGINATION, *DATE_RANGE, SEARCH, query("status", CONSUMPTION_STATUS),
                              query("daily_battle_id", ID), query("ingredient_id", ID)],
    }

    def openapi() -> dict:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        generated_schemas = schema.get("components", {}).get("schemas", {})
        schema["components"] = {"schemas": {**generated_schemas, **build_schemas()}}
        registered = {(path, method) for path, methods in schema["paths"].items()
                      for method in methods if method in {"get", "post", "patch", "delete", "put"}}
        described = {(path, method) for path, method, *_ in operations}
        if registered != described:
            raise RuntimeError(f"OpenAPI 路由描述需同步：{registered ^ described}")
        for path, method, response, body, required, status in operations:
            if path not in schema["paths"] or method not in schema["paths"][path]:
                continue
            operation = schema["paths"][path][method]
            for parameter in operation.get("parameters", []):
                if parameter["in"] == "path":
                    parameter["schema"] = deepcopy(ID)
            if method == "get" and path in list_queries:
                operation.setdefault("parameters", []).extend(deepcopy(list_queries[path]))
            operation["responses"] = {
                str(status): {"description": "创建成功" if status == 201 else "请求成功",
                              "content": {"application/json": {"schema": ref(response)}}},
            }
            errors = {500: "服务器内部错误"}
            if path != "/health":
                errors.update({400: "请求参数或 JSON 格式不正确", 404: "资源不存在"})
                if method != "get":
                    errors[409] = "当前业务状态不允许该操作"
            for code, description in sorted(errors.items()):
                operation["responses"][str(code)] = {
                    "description": description, "content": {"application/json": {"schema": ref("Error")}},
                }
            if body:
                operation["requestBody"] = {"required": required,
                                            "content": {"application/json": {"schema": ref(body)}}}
        app.openapi_schema = schema
        return schema

    app.openapi = openapi
