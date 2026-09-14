"""在全新隔离数据库中校验全部成功响应是否符合归档 OpenAPI。

运行：
    uv run python scripts/isolated_server.py --port 3047
    uv run python scripts/success_response_contract_test.py 3047

脚本只使用 Python 标准库，并在任何写入前检查隔离服务响应头和空库状态。
每个成功请求都按 ``contracts/openapi.yaml`` 中对应的响应 schema 校验，
最后要求归档中的全部成功 operation 均已实际调用。
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import json
import math
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
from uuid import uuid4


PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3047
BASE = f"http://127.0.0.1:{PORT}"
ARCHIVE = Path(__file__).resolve().parents[2] / "contracts" / "openapi.yaml"
CONTRACT = json.loads(ARCHIVE.read_text(encoding="utf-8"))
TEST_DATABASE_PATTERN = re.compile(r"pantry_nook_test_[0-9a-f]{32}")
HTTP_METHODS = {"get", "post", "patch", "delete", "put"}
MISSING = object()
SUPPORTED_SCHEMA_KEYWORDS = {
    "$ref",
    "additionalProperties",
    "allOf",
    "anyOf",
    "const",
    "default",
    "deprecated",
    "description",
    "enum",
    "examples",
    "exclusiveMaximum",
    "exclusiveMinimum",
    "format",
    "items",
    "maxItems",
    "maxLength",
    "maxProperties",
    "maximum",
    "minItems",
    "minLength",
    "minProperties",
    "minimum",
    "multipleOf",
    "oneOf",
    "pattern",
    "properties",
    "readOnly",
    "required",
    "title",
    "type",
    "uniqueItems",
    "writeOnly",
}


class ContractMismatch(AssertionError):
    """实际成功响应不符合归档契约。"""


def fail(location: str, message: str) -> None:
    raise ContractMismatch(f"{location}: {message}")


def resolve_reference(reference: str) -> dict:
    if not reference.startswith("#/"):
        fail("$ref", f"不支持外部引用 {reference!r}")
    target = CONTRACT
    for raw_part in reference[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        try:
            target = target[part]
        except (KeyError, TypeError) as exc:
            raise ContractMismatch(f"$ref: 无法解析 {reference!r}") from exc
    if not isinstance(target, dict):
        fail("$ref", f"引用目标不是 schema：{reference!r}")
    return target


def as_decimal(value: object, location: str) -> Decimal:
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ContractMismatch(f"{location}: {value!r} 不是有效数字") from exc
    if not result.is_finite():
        fail(location, "数字必须是有限值")
    return result


def validate_format(value: str, format_name: str, location: str) -> None:
    try:
        if format_name == "date":
            date.fromisoformat(value)
        elif format_name == "date-time":
            if "T" not in value:
                raise ValueError
            datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractMismatch(
            f"{location}: {value!r} 不符合 {format_name} 格式"
        ) from exc


def validate(instance: object, schema: object, location: str = "$") -> None:
    """校验本项目成功响应会使用到的 OpenAPI 3.1 schema 关键字。"""
    if schema is True or schema == {}:
        return
    if schema is False:
        fail(location, "schema 不允许该值")
    if not isinstance(schema, dict):
        fail(location, f"无效 schema：{schema!r}")

    if "$ref" in schema:
        validate(instance, resolve_reference(schema["$ref"]), location)
        siblings = {key: value for key, value in schema.items() if key != "$ref"}
        if siblings:
            validate(instance, siblings, location)
        return

    if "allOf" in schema:
        for index, child in enumerate(schema["allOf"]):
            validate(instance, child, f"{location}.allOf[{index}]")

    if "anyOf" in schema:
        errors = []
        for child in schema["anyOf"]:
            try:
                validate(instance, child, location)
                break
            except ContractMismatch as exc:
                errors.append(str(exc))
        else:
            fail(location, "不符合 anyOf 任一分支；" + "；".join(errors))

    if "oneOf" in schema:
        matches = 0
        for child in schema["oneOf"]:
            try:
                validate(instance, child, location)
                matches += 1
            except ContractMismatch:
                pass
        if matches != 1:
            fail(location, f"应只符合 oneOf 一个分支，实际符合 {matches} 个")

    if "const" in schema and instance != schema["const"]:
        fail(location, f"应等于 {schema['const']!r}，实际为 {instance!r}")
    if "enum" in schema and instance not in schema["enum"]:
        fail(location, f"应属于 {schema['enum']!r}，实际为 {instance!r}")

    expected_type = schema.get("type")
    if isinstance(expected_type, list):
        errors = []
        for type_name in expected_type:
            try:
                validate(instance, {**schema, "type": type_name}, location)
                return
            except ContractMismatch as exc:
                errors.append(str(exc))
        fail(location, "不符合任一允许类型；" + "；".join(errors))

    if expected_type == "null":
        if instance is not None:
            fail(location, f"应为 null，实际为 {type(instance).__name__}")
        return

    if expected_type == "object" or "properties" in schema or "required" in schema:
        if not isinstance(instance, dict):
            fail(location, f"应为 object，实际为 {type(instance).__name__}")
        for field in schema.get("required", []):
            if field not in instance:
                fail(location, f"缺少必填字段 {field!r}")
        properties = schema.get("properties", {})
        for field, value in instance.items():
            if field in properties:
                validate(value, properties[field], f"{location}.{field}")
            elif schema.get("additionalProperties") is False:
                fail(location, f"包含未声明字段 {field!r}")
            elif isinstance(schema.get("additionalProperties"), dict):
                validate(value, schema["additionalProperties"], f"{location}.{field}")
        size = len(instance)
        if "minProperties" in schema and size < schema["minProperties"]:
            fail(location, f"字段数 {size} 小于 {schema['minProperties']}")
        if "maxProperties" in schema and size > schema["maxProperties"]:
            fail(location, f"字段数 {size} 大于 {schema['maxProperties']}")
        return

    if expected_type == "array":
        if not isinstance(instance, list):
            fail(location, f"应为 array，实际为 {type(instance).__name__}")
        size = len(instance)
        if "minItems" in schema and size < schema["minItems"]:
            fail(location, f"数组长度 {size} 小于 {schema['minItems']}")
        if "maxItems" in schema and size > schema["maxItems"]:
            fail(location, f"数组长度 {size} 大于 {schema['maxItems']}")
        if schema.get("uniqueItems"):
            serialized = [
                json.dumps(item, sort_keys=True, ensure_ascii=False) for item in instance
            ]
            if len(serialized) != len(set(serialized)):
                fail(location, "数组元素应唯一")
        for index, value in enumerate(instance):
            validate(value, schema.get("items", {}), f"{location}[{index}]")
        return

    if expected_type == "string":
        if not isinstance(instance, str):
            fail(location, f"应为 string，实际为 {type(instance).__name__}")
        if "minLength" in schema and len(instance) < schema["minLength"]:
            fail(location, f"字符串长度小于 {schema['minLength']}")
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            fail(location, f"字符串长度大于 {schema['maxLength']}")
        if "pattern" in schema and re.search(schema["pattern"], instance) is None:
            fail(location, f"字符串不符合 pattern {schema['pattern']!r}")
        if schema.get("format"):
            validate_format(instance, schema["format"], location)
        return

    if expected_type == "boolean":
        if not isinstance(instance, bool):
            fail(location, f"应为 boolean，实际为 {type(instance).__name__}")
        return

    if expected_type == "integer":
        if isinstance(instance, bool) or not isinstance(instance, int):
            fail(location, f"应为 integer，实际为 {type(instance).__name__}")

    if expected_type == "number":
        if isinstance(instance, bool) or not isinstance(instance, (int, float)):
            fail(location, f"应为 number，实际为 {type(instance).__name__}")
        if isinstance(instance, float) and not math.isfinite(instance):
            fail(location, "数字必须是有限值")

    if expected_type in {"integer", "number"}:
        number = as_decimal(instance, location)
        if "minimum" in schema and number < as_decimal(schema["minimum"], location):
            fail(location, f"数字小于 minimum {schema['minimum']}")
        if "maximum" in schema and number > as_decimal(schema["maximum"], location):
            fail(location, f"数字大于 maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema:
            minimum = as_decimal(schema["exclusiveMinimum"], location)
            if number <= minimum:
                fail(location, f"数字应大于 {schema['exclusiveMinimum']}")
        if "exclusiveMaximum" in schema:
            maximum = as_decimal(schema["exclusiveMaximum"], location)
            if number >= maximum:
                fail(location, f"数字应小于 {schema['exclusiveMaximum']}")
        if "multipleOf" in schema:
            multiple = as_decimal(schema["multipleOf"], location)
            if multiple == 0 or number % multiple != 0:
                fail(location, f"数字不是 {schema['multipleOf']} 的整数倍")


def audit_supported_schema(
    schema: object,
    location: str,
    visited_references: set[str] | None = None,
) -> None:
    """新契约若加入尚未实现的校验关键字，立即失败，避免静默漏验。"""
    if schema is True or schema is False or schema == {}:
        return
    if not isinstance(schema, dict):
        fail(location, f"无效 schema：{schema!r}")
    unknown = set(schema) - SUPPORTED_SCHEMA_KEYWORDS
    if unknown:
        fail(location, f"校验器尚不支持关键字 {sorted(unknown)}")

    visited_references = visited_references or set()
    reference = schema.get("$ref")
    if reference and reference not in visited_references:
        audit_supported_schema(
            resolve_reference(reference),
            reference,
            visited_references | {reference},
        )
    for keyword in ("allOf", "anyOf", "oneOf"):
        for index, child in enumerate(schema.get(keyword, [])):
            audit_supported_schema(
                child,
                f"{location}.{keyword}[{index}]",
                visited_references,
            )
    for field, child in schema.get("properties", {}).items():
        audit_supported_schema(
            child,
            f"{location}.properties.{field}",
            visited_references,
        )
    if "items" in schema:
        audit_supported_schema(
            schema["items"],
            f"{location}.items",
            visited_references,
        )
    if isinstance(schema.get("additionalProperties"), dict):
        audit_supported_schema(
            schema["additionalProperties"],
            f"{location}.additionalProperties",
            visited_references,
        )


def request_json(method: str, path: str, payload=MISSING):
    raw = None
    headers = {}
    if payload is not MISSING:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        BASE + path, data=raw, headers=headers, method=method.upper()
    )
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read().decode("utf-8")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError as exc:
            raise AssertionError(
                f"{method.upper()} {path} 返回非 JSON：{body[:200]!r}"
            ) from exc
        normalized_headers = {key.lower(): value for key, value in response.headers.items()}
        return response.status, normalized_headers, parsed


def success_operations() -> dict[tuple[str, str], int]:
    result = {}
    for path, path_item in CONTRACT["paths"].items():
        for method, operation in path_item.items():
            if method not in HTTP_METHODS:
                continue
            codes = [
                int(code)
                for code in operation["responses"]
                if str(code).startswith("2")
            ]
            if len(codes) != 1:
                raise AssertionError(
                    f"{method.upper()} {path} 应恰好声明一个成功状态，实际为 {codes}"
                )
            response_schema = operation["responses"][str(codes[0])]["content"][
                "application/json"
            ]["schema"]
            audit_supported_schema(
                response_schema,
                f"{method.upper()} {path} response",
            )
            result[(method.upper(), path)] = codes[0]
    return result


EXPECTED_OPERATIONS = success_operations()
CALLED_OPERATIONS: set[tuple[str, str]] = set()


def contract_call(
    method: str,
    path: str,
    template: str,
    payload=MISSING,
):
    key = (method.upper(), template)
    if key not in EXPECTED_OPERATIONS:
        raise AssertionError(f"归档契约中没有操作 {key[0]} {key[1]}")
    expected_status = EXPECTED_OPERATIONS[key]
    status, headers, body = request_json(method, path, payload)
    if status != expected_status:
        raise AssertionError(
            f"{key[0]} {path} 应返回 {expected_status}，实际为 {status}：{body}"
        )
    content_type = headers.get("content-type", "")
    if not content_type.lower().startswith("application/json"):
        raise AssertionError(f"{key[0]} {path} 返回了非 JSON Content-Type：{content_type}")
    response_schema = CONTRACT["paths"][template][method.lower()]["responses"][
        str(status)
    ]["content"]["application/json"]["schema"]
    try:
        validate(body, response_schema)
    except ContractMismatch as exc:
        raise ContractMismatch(f"{key[0]} {path} -> {status}：{exc}") from exc
    CALLED_OPERATIONS.add(key)
    print(f"[OK] {key[0]:6} {template} -> {status}")
    return headers, body


def assert_empty_isolated_database() -> str:
    health_headers, _ = contract_call("GET", "/health", "/health")
    database = health_headers.get("x-pantry-nook-test-database", "")
    if TEST_DATABASE_PATTERN.fullmatch(database) is None:
        raise RuntimeError(
            "拒绝写入：请使用 scripts/isolated_server.py 启动全新隔离测试库服务"
        )

    status, _, live_contract = request_json("GET", "/openapi.json")
    if status != 200 or live_contract != CONTRACT:
        raise AssertionError("运行中 OpenAPI 与 contracts/openapi.yaml 不一致")

    checks = [
        ("/api/ingredients?limit=1", "data"),
        ("/api/inventory-adjustments?limit=1", "data"),
        ("/api/dishes?limit=1", "data"),
        ("/api/meal-plans?limit=1", "data"),
        ("/api/daily-battles?limit=1", "data"),
        ("/api/consumptions?limit=1", "data"),
    ]
    for path, field in checks:
        status, _, body = request_json("GET", path)
        if status != 200 or body.get(field) != [] or body.get("meta", {}).get("total") != 0:
            raise RuntimeError(
                f"拒绝写入：隔离库 {database} 不是空库，请重新启动全新隔离库"
            )
    return database


def data(body: dict):
    if "data" not in body:
        raise AssertionError(f"成功响应缺少 data：{body}")
    return body["data"]


def main() -> None:
    if len(EXPECTED_OPERATIONS) != 34:
        raise AssertionError(
            f"归档成功 operation 数量已变化：预期 34，实际 {len(EXPECTED_OPERATIONS)}；"
            "请同步扩展本脚本场景"
        )
    database = assert_empty_isolated_database()
    stamp = uuid4().hex[:10]

    # 库存：创建、读取、编辑、处理、预览恢复、撤销和两类记录列表。
    _, body = contract_call(
        "POST",
        "/api/ingredients/batch",
        "/api/ingredients/batch",
        {
            "items": [
                {
                    "name": f"契约土豆-{stamp}",
                    "category": "碳水",
                    "stock_text": "10",
                    "stock_value": 10,
                    "stock_unit": "kg",
                    "location": "冰箱冷藏",
                    "note": "成功响应契约测试",
                }
            ]
        },
    )
    ingredient = data(body)[0]
    ingredient_id = ingredient["id"]

    _, body = contract_call(
        "GET",
        f"/api/ingredients/{ingredient_id}",
        "/api/ingredients/{ingredient_id}",
    )
    ingredient = data(body)
    _, body = contract_call(
        "PATCH",
        f"/api/ingredients/{ingredient_id}",
        "/api/ingredients/{ingredient_id}",
        {
            "location": "冰箱冷冻",
            "note": "已核验响应字段",
            "expected_updated_at": ingredient["updated_at"],
        },
    )
    ingredient = data(body)
    _, body = contract_call(
        "POST",
        f"/api/ingredients/{ingredient_id}/waste",
        "/api/ingredients/{ingredient_id}/waste",
        {
            "stock_text": "1",
            "stock_value": 1,
            "stock_unit": ingredient["stock_unit"],
            "reason": "damaged",
            "note": "契约测试处理记录",
            "expected_updated_at": ingredient["updated_at"],
        },
    )
    adjustment_id = data(body)["adjustment"]["id"]
    contract_call(
        "GET",
        f"/api/ingredients/{ingredient_id}/adjustments",
        "/api/ingredients/{ingredient_id}/adjustments",
    )
    contract_call(
        "GET",
        f"/api/ingredients/adjustments/{adjustment_id}/recovery-preview",
        "/api/ingredients/adjustments/{adjustment_id}/recovery-preview",
    )
    contract_call(
        "POST",
        f"/api/ingredients/adjustments/{adjustment_id}/revoke",
        "/api/ingredients/adjustments/{adjustment_id}/revoke",
        {},
    )
    contract_call(
        "GET",
        "/api/inventory-adjustments?status=reversed&limit=10",
        "/api/inventory-adjustments",
    )
    contract_call(
        "GET",
        f"/api/ingredients?q={stamp}&limit=10",
        "/api/ingredients",
    )

    # 菜品与搭配：为删除操作使用独立对象，避免引用保护影响成功路径。
    _, body = contract_call(
        "POST", "/api/dishes", "/api/dishes", {"name": f"土豆烧肉-{stamp}"}
    )
    dish = data(body)
    dish_id = dish["id"]
    _, body = contract_call(
        "GET", f"/api/dishes/{dish_id}", "/api/dishes/{dish_id}"
    )
    dish = data(body)
    _, body = contract_call(
        "PATCH",
        f"/api/dishes/{dish_id}",
        "/api/dishes/{dish_id}",
        {
            "name": f"家常土豆烧肉-{stamp}",
            "expected_updated_at": dish["updated_at"],
        },
    )
    dish = data(body)

    _, body = contract_call(
        "POST", "/api/dishes", "/api/dishes", {"name": f"待删除菜-{stamp}"}
    )
    deleted_dish_id = data(body)["id"]
    contract_call(
        "DELETE",
        f"/api/dishes/{deleted_dish_id}",
        "/api/dishes/{dish_id}",
    )
    contract_call("GET", f"/api/dishes?q={stamp}&limit=10", "/api/dishes")

    _, body = contract_call(
        "POST",
        "/api/meal-plans",
        "/api/meal-plans",
        {"name": f"契约搭配-{stamp}", "dish_ids": [dish_id]},
    )
    plan = data(body)
    plan_id = plan["id"]
    _, body = contract_call(
        "GET", f"/api/meal-plans/{plan_id}", "/api/meal-plans/{plan_id}"
    )
    plan = data(body)
    contract_call(
        "PATCH",
        f"/api/meal-plans/{plan_id}",
        "/api/meal-plans/{plan_id}",
        {
            "name": f"更新契约搭配-{stamp}",
            "expected_updated_at": plan["updated_at"],
        },
    )
    contract_call(
        "GET",
        f"/api/dishes/{dish_id}/meal-plans",
        "/api/dishes/{dish_id}/meal-plans",
    )

    _, body = contract_call(
        "POST", "/api/dishes", "/api/dishes", {"name": f"临时搭配菜-{stamp}"}
    )
    temporary_dish_id = data(body)["id"]
    _, body = contract_call(
        "POST",
        "/api/meal-plans",
        "/api/meal-plans",
        {"name": f"待删除搭配-{stamp}", "dish_ids": [temporary_dish_id]},
    )
    temporary_plan_id = data(body)["id"]
    contract_call(
        "DELETE",
        f"/api/meal-plans/{temporary_plan_id}",
        "/api/meal-plans/{plan_id}",
    )
    contract_call("GET", "/api/meal-plans?limit=10", "/api/meal-plans")

    # 菜单：同一对象依次编辑、取消、恢复、确认、预览和撤销。
    preparation = {
        "dish_id": dish_id,
        "ingredient_id": ingredient_id,
        "planned_quantity_text": "2",
    }
    _, body = contract_call(
        "POST",
        "/api/daily-battles",
        "/api/daily-battles",
        {
            "battle_date": "2042-04-01",
            "meal_slot": "dinner",
            "dish_ids": [dish_id],
            "preparations": [preparation],
        },
    )
    battle = data(body)
    battle_id = battle["id"]
    _, body = contract_call(
        "GET",
        f"/api/daily-battles/{battle_id}",
        "/api/daily-battles/{battle_id}",
    )
    battle = data(body)
    _, body = contract_call(
        "PATCH",
        f"/api/daily-battles/{battle_id}",
        "/api/daily-battles/{battle_id}",
        {
            "dish_ids": [dish_id],
            "preparations": [preparation],
            "expected_updated_at": battle["updated_at"],
        },
    )
    battle = data(body)
    _, body = contract_call(
        "POST",
        f"/api/daily-battles/{battle_id}/cancel",
        "/api/daily-battles/{battle_id}/cancel",
    )
    cancelled = data(body)
    _, body = contract_call(
        "POST",
        f"/api/daily-battles/{battle_id}/resume",
        "/api/daily-battles/{battle_id}/resume",
        {"expected_updated_at": cancelled["updated_at"]},
    )
    battle = data(body)

    _, body = contract_call(
        "GET",
        f"/api/ingredients/{ingredient_id}",
        "/api/ingredients/{ingredient_id}",
    )
    ingredient = data(body)
    _, body = contract_call(
        "POST",
        f"/api/daily-battles/{battle_id}/confirm",
        "/api/daily-battles/{battle_id}/confirm",
        {
            "consumptions": [
                {
                    "ingredient_id": ingredient_id,
                    "daily_battle_dish_id": battle["dishes"][0]["id"],
                    "quantity_used_text": "2",
                    "expected_updated_at": ingredient["updated_at"],
                    "note": "成功响应契约测试",
                }
            ],
            "expected_updated_at": battle["updated_at"],
        },
    )
    confirmed = data(body)
    consumption_id = confirmed["consumptions"][0]["id"]
    contract_call(
        "GET",
        f"/api/daily-battles/{battle_id}/consumptions",
        "/api/daily-battles/{battle_id}/consumptions",
    )
    contract_call(
        "GET",
        f"/api/consumptions?daily_battle_id={battle_id}&limit=10",
        "/api/consumptions",
    )
    contract_call(
        "GET",
        f"/api/consumptions/{consumption_id}",
        "/api/consumptions/{consumption_id}",
    )
    contract_call(
        "GET",
        f"/api/daily-battles/{battle_id}/recovery-preview",
        "/api/daily-battles/{battle_id}/recovery-preview",
    )
    contract_call(
        "POST",
        f"/api/daily-battles/{battle_id}/revoke-confirmation",
        "/api/daily-battles/{battle_id}/revoke-confirmation",
        {},
    )

    # 另建一份无历史菜单，验证物理删除成功响应。
    _, body = contract_call(
        "POST",
        "/api/daily-battles",
        "/api/daily-battles",
        {
            "battle_date": "2042-04-02",
            "meal_slot": "dinner",
            "dish_ids": [dish_id],
            "preparations": [preparation],
        },
    )
    temporary_battle_id = data(body)["id"]
    contract_call(
        "DELETE",
        f"/api/daily-battles/{temporary_battle_id}",
        "/api/daily-battles/{battle_id}",
    )
    contract_call("GET", "/api/daily-battles?limit=10", "/api/daily-battles")

    # 不给隔离库留下待完成菜单，便于后续只读核查。
    contract_call(
        "POST",
        f"/api/daily-battles/{battle_id}/cancel",
        "/api/daily-battles/{battle_id}/cancel",
    )

    missing = sorted(EXPECTED_OPERATIONS.keys() - CALLED_OPERATIONS)
    if missing:
        lines = ", ".join(f"{method} {path}" for method, path in missing)
        raise AssertionError(f"仍有成功 operation 未实际校验：{lines}")
    print(
        f"\nPASS: {len(CALLED_OPERATIONS)}/{len(EXPECTED_OPERATIONS)} 个成功 operation "
        f"均符合归档 OpenAPI；隔离数据库 {database}"
    )


if __name__ == "__main__":
    main()
