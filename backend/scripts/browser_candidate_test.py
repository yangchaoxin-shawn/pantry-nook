"""候选版本地浏览器关键路径检查。

该脚本会写入测试数据，因此只接受本机地址，并要求前端与后端 ``/health``
返回同一个 ``X-Pantry-Nook-Test-Database`` 隔离库标记。仓库已记录的用户与人工
验收端口始终拒绝连接。

运行示例：
    python scripts/browser_candidate_test.py \
        --base-url http://127.0.0.1:5215 \
        --api-url http://127.0.0.1:3045
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta
import json
import re
import sys
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

from playwright.sync_api import Browser, Page, Route, expect, sync_playwright


TEST_DATABASE = re.compile(r"pantry_nook_test_[0-9a-f]{32}")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
PROTECTED_PORTS = {3000, 3018, 3019, 5173, 5200, 5201}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def normalized_local_root(raw: str, label: str) -> str:
    value = raw.rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in LOCAL_HOSTS
        or parsed.port is None
        or parsed.port < 1024
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError(f"{label} 只接受带明确端口的本机 HTTP 根地址")
    if parsed.port in PROTECTED_PORTS:
        raise ValueError(f"{label} 使用受保护的人工验收端口 {parsed.port}，拒绝执行")
    return value


def origin(value: str) -> tuple[str, str, int]:
    parsed = urlsplit(value)
    return parsed.scheme, parsed.hostname or "", parsed.port or 80


def read_json(method: str, url: str, payload: Any | None = None) -> tuple[Any, Any]:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, method=method, data=body, headers=headers)
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw), response.headers
    except HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise AssertionError(f"{method} {url} 返回 {error.code}: {details}") from error
    except URLError as error:
        raise AssertionError(f"无法连接 {url}: {error.reason}") from error


class SafeTestTarget:
    def __init__(self, base_url: str, api_url: str):
        self.base_url = normalized_local_root(base_url, "--base-url")
        self.api_url = normalized_local_root(api_url, "--api-url")
        self.allowed_origins = {origin(self.base_url), origin(self.api_url)}
        self.marker = self._matching_marker()

    @staticmethod
    def _health_marker(root: str) -> str:
        body, headers = read_json("GET", f"{root}/health")
        marker = headers.get("X-Pantry-Nook-Test-Database", "")
        if not isinstance(body, dict) or body.get("status") != "ok" or body.get("database") != "connected":
            raise AssertionError(f"{root}/health 不是可用的 Pantry Nook 服务")
        if not TEST_DATABASE.fullmatch(marker):
            raise AssertionError(f"{root}/health 缺少合法的隔离测试库标记，拒绝写入")
        return marker

    def _matching_marker(self) -> str:
        api_marker = self._health_marker(self.api_url)
        base_marker = self._health_marker(self.base_url)
        if api_marker != base_marker:
            raise AssertionError("前端代理与后端指向不同的隔离测试库，拒绝写入")
        return api_marker

    def assert_live(self) -> None:
        current = self._matching_marker()
        if current != self.marker:
            raise AssertionError("运行期间隔离测试库标记发生变化，拒绝继续写入")

    def assert_browser_write(self, url: str) -> None:
        parsed = urlsplit(url)
        if parsed.port in PROTECTED_PORTS or origin(url) not in self.allowed_origins:
            raise AssertionError(f"浏览器试图向未授权地址写入：{url}")
        self.assert_live()

    def _api_envelope(self, method: str, path: str, payload: Any | None = None) -> dict[str, Any]:
        if not path.startswith("/api/"):
            raise ValueError("测试 API 路径必须位于 /api/")
        if method not in SAFE_METHODS:
            self.assert_live()
        body, _ = read_json(method, urljoin(f"{self.api_url}/", path.lstrip("/")), payload)
        if not isinstance(body, dict) or "data" not in body:
            raise AssertionError(f"{method} {path} 返回格式不正确")
        return body

    def api(self, method: str, path: str, payload: Any | None = None) -> Any:
        return self._api_envelope(method, path, payload)["data"]

    def list_all(self, path: str) -> list[dict[str, Any]]:
        if "?" in path:
            raise ValueError("分页列表路径不应自带查询参数")
        items: list[dict[str, Any]] = []
        offset = 0
        while True:
            envelope = self._api_envelope("GET", f"{path}?limit=100&offset={offset}")
            page = envelope["data"]
            if not isinstance(page, list):
                raise AssertionError(f"GET {path} 没有返回列表")
            items.extend(page)
            offset += len(page)
            total = envelope.get("meta", {}).get("total")
            if len(page) < 100 or isinstance(total, int) and offset >= total:
                return items


def assert_no_horizontal_overflow(page: Page, label: str) -> None:
    dimensions = page.evaluate(
        """() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth })"""
    )
    if dimensions["scrollWidth"] > dimensions["width"] + 1:
        raise AssertionError(
            f"{label} 存在横向溢出：{dimensions['scrollWidth']} > {dimensions['width']}"
        )


def scenario_inventory(page: Page, target: SafeTestTarget, token: str) -> None:
    ingredient_name = f"候选库存{token}"
    navigation = page.get_by_role("navigation", name="主导航")
    navigation.get_by_role("button", name="库存", exact=True).click()
    expect(page.get_by_role("region", name="库存清单")).to_be_visible()

    page.get_by_role("button", name="单个记录").click()
    dialog = page.get_by_role("dialog")
    expect(dialog.get_by_role("heading", name="记录食材")).to_be_visible()
    dialog.get_by_label("第 1 项食材名称").fill(ingredient_name)
    dialog.get_by_role("spinbutton", name="第 1 项数量", exact=True).fill("2")
    dialog.get_by_label("第 1 项单位").fill("个")
    target.assert_live()
    dialog.get_by_role("button", name="保存食材", exact=True).click()
    expect(dialog).to_be_hidden()

    row = page.locator(".pn-inventory-row", has_text=ingredient_name)
    expect(row).to_be_visible()
    expect(row.get_by_text("待补位置", exact=True)).to_be_visible()
    expect(row.get_by_role("button", name=re.compile(f"^查看{re.escape(ingredient_name)}"))).to_be_visible()

    row.get_by_role("button", name=re.compile(f"^查看{re.escape(ingredient_name)}")).click()
    detail = page.get_by_role("dialog")
    expect(detail.get_by_role("heading", name=f"查看食材 · {ingredient_name}")).to_be_visible()
    detail.get_by_role("button", name="编辑", exact=True).click()
    editor = page.get_by_role("dialog")
    expect(editor.get_by_role("heading", name="编辑食材")).to_be_visible()
    expect(editor.get_by_role("spinbutton", name="数量", exact=True)).to_have_value("2")
    editor.get_by_label("单位", exact=True).fill("盒")
    target.assert_live()
    editor.get_by_role("button", name="保存食材", exact=True).click()
    expect(editor).to_be_hidden()
    expect(row).to_contain_text("2盒")

    matches = [
        item
        for item in target.list_all("/api/ingredients")
        if item["name"] == ingredient_name
    ]
    if len(matches) != 1:
        raise AssertionError("库存新增后未找到唯一记录")
    saved = matches[0]
    if saved["stock_value"] != 2 or saved["stock_unit"] != "盒" or saved["location"] is not None:
        raise AssertionError("仅修改单位后，数量或空位置语义发生变化")
    assert_no_horizontal_overflow(page, "桌面库存页")


def scenario_catalog(page: Page, target: SafeTestTarget, token: str) -> dict[str, Any]:
    dish_name = f"候选菜品{token}"
    plan_name = f"候选搭配{token}"
    navigation = page.get_by_role("navigation", name="主导航")
    navigation.get_by_role("button", name="菜品", exact=True).click()
    expect(page.get_by_role("heading", name=re.compile(r"^喜欢的菜"))).to_be_visible()

    page.get_by_role("button", name="添加菜品").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("菜品名称").fill(dish_name)
    target.assert_live()
    dialog.get_by_role("button", name="保存菜品", exact=True).click()
    expect(dialog).to_be_hidden()
    expect(page.get_by_role("heading", name=dish_name, exact=True)).to_be_visible()

    page.get_by_role("button", name="常用搭配", exact=True).click()
    expect(page.get_by_role("navigation", name="当前位置")).to_contain_text("菜品/常用搭配")
    expect(page.get_by_role("button", name="返回菜品", exact=True)).to_be_visible()
    page.get_by_role("button", name="创建搭配").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("搭配名称（选填）").fill(plan_name)
    dialog.get_by_role("checkbox", name=dish_name, exact=True).check()
    target.assert_live()
    dialog.get_by_role("button", name="保存搭配", exact=True).click()
    expect(dialog).to_be_hidden()
    expect(page.get_by_role("heading", name=plan_name, exact=True)).to_be_visible()

    page.get_by_role("button", name="返回菜品", exact=True).click()
    expect(page.get_by_role("heading", name=dish_name, exact=True)).to_be_visible()
    assert_no_horizontal_overflow(page, "桌面菜品页")

    dishes = [
        item
        for item in target.list_all("/api/dishes")
        if item["name"] == dish_name
    ]
    if len(dishes) != 1:
        raise AssertionError("菜品保存后未找到唯一记录")
    return dishes[0]


def next_free_slot(battles: list[dict[str, Any]]) -> tuple[str, str]:
    used = {(item["battle_date"], item["meal_slot"]) for item in battles}
    first = date(2040, 1, 1)
    for offset in range(36525):
        candidate = (first + timedelta(days=offset)).isoformat()
        for meal in ("dinner", "lunch", "breakfast"):
            if (candidate, meal) not in used:
                return candidate, meal
    raise AssertionError("未找到可用的隔离测试餐次")


def scenario_restock(
    page: Page,
    target: SafeTestTarget,
    token: str,
    dish: dict[str, Any],
) -> None:
    pending_name = f"候选补货{token}"
    battle_date, meal = next_free_slot(target.list_all("/api/daily-battles"))
    battle = target.api(
        "POST",
        "/api/daily-battles",
        {
            "battle_date": battle_date,
            "meal_slot": meal,
            "dish_ids": [dish["id"]],
            "preparations": [
                {
                    "dish_id": dish["id"],
                    "pending_ingredient_name": pending_name,
                    "planned_quantity_text": "2",
                }
            ],
        },
    )

    page.set_viewport_size({"width": 390, "height": 844})
    page.reload(wait_until="networkidle")
    expect(page.get_by_role("heading", name=re.compile(r"^把日子"))).to_be_visible()
    entry = page.locator("article", has_text=dish["name"]).filter(
        has=page.get_by_role("button", name="做完了，核对用料", exact=True)
    )
    expect(entry).to_be_visible()
    entry.get_by_role("button", name="做完了，核对用料", exact=True).click()

    dialog = page.get_by_role("dialog")
    expect(dialog.get_by_role("heading", name="核对这一餐的实际用料")).to_be_visible()
    expect(dialog.get_by_text(pending_name, exact=True)).to_be_visible()
    dialog.get_by_role("button", name="补货并返回这餐", exact=True).click()
    expect(dialog.get_by_role("heading", name="为这餐补货")).to_be_visible()
    expect(dialog.get_by_label("第 1 项食材名称")).to_have_value(pending_name)
    dialog.get_by_role("spinbutton", name="第 1 项数量", exact=True).fill("5")
    dialog.get_by_label("第 1 项单位").fill("个")
    target.assert_live()
    dialog.get_by_role("button", name="保存这批食材", exact=True).click()

    expect(dialog.get_by_text(re.compile(f"已自动关联{re.escape(pending_name)}"))).to_be_visible()
    usage = dialog.get_by_label(f"{dish['name']}的{pending_name}实际用量")
    expect(usage).to_be_visible()
    expect(usage).to_have_value("2")

    latest = target.api("GET", f"/api/daily-battles/{battle['id']}")
    preparations = latest["preparations"]
    if len(preparations) != 1 or preparations[0]["ingredient_id"] is None:
        raise AssertionError("补货后没有安全自动关联到唯一库存")
    ingredients = [
        item
        for item in target.list_all("/api/ingredients")
        if item["name"] == pending_name
    ]
    if len(ingredients) != 1 or preparations[0]["ingredient_id"] != ingredients[0]["id"]:
        raise AssertionError("菜单关联的不是本次补入的唯一同名库存")
    assert_no_horizontal_overflow(page, "手机餐安排核对页")
    dialog.get_by_role("button", name="关闭弹窗").click()


def run_check(name: str, callback: Callable[[], None], results: list[str]) -> None:
    callback()
    results.append(name)
    print(f"[PASS] {name}", flush=True)


def run_browser(browser: Browser, target: SafeTestTarget, timeout_ms: int) -> None:
    token = uuid4().hex[:8]
    context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="zh-CN")
    page = context.new_page()
    page.set_default_timeout(timeout_ms)
    console_errors: list[str] = []
    page_errors: list[str] = []
    failed_local_requests: list[str] = []
    blocked_writes: list[str] = []

    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    def record_failed_request(request: Any) -> None:
        failure = str(request.failure)
        # React 切页和刷新会主动取消上一页的只读请求，这不是服务故障。
        if "ERR_ABORTED" in failure:
            return
        if origin(request.url) in target.allowed_origins:
            failed_local_requests.append(f"{request.method} {request.url}: {failure}")

    page.on("requestfailed", record_failed_request)

    def guard_write(route: Route) -> None:
        if route.request.method in SAFE_METHODS:
            route.continue_()
            return
        try:
            target.assert_browser_write(route.request.url)
        except Exception as error:  # 安全失败时先阻断请求，主流程随后报告。
            blocked_writes.append(str(error))
            route.abort()
            return
        route.continue_()

    context.route("**/*", guard_write)
    results: list[str] = []
    try:
        page.goto(target.base_url, wait_until="networkidle")
        expect(page.get_by_role("main")).to_be_visible()
        run_check("库存新增、待补位置与仅改单位", lambda: scenario_inventory(page, target, token), results)
        dish = scenario_catalog(page, target, token)
        results.append("菜品、常用搭配与返回路径")
        print("[PASS] 菜品、常用搭配与返回路径", flush=True)
        run_check(
            "餐安排核对、补货、安全自动关联并回核对",
            lambda: scenario_restock(page, target, token, dish),
            results,
        )
        if blocked_writes:
            raise AssertionError("；".join(blocked_writes))
        if failed_local_requests:
            raise AssertionError("本地请求失败：" + "；".join(failed_local_requests))
        if page_errors:
            raise AssertionError("页面运行错误：" + "；".join(page_errors))
        if console_errors:
            raise AssertionError("控制台 error：" + "；".join(console_errors))
        print(
            f"[PASS] 浏览器候选版检查 {len(results)}/{len(results)}；"
            f"隔离库 {target.marker}；桌面 1280x800；手机 390x844；控制台与页面 error 为空",
            flush=True,
        )
    finally:
        context.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="独立 Vite 页面根地址")
    parser.add_argument("--api-url", required=True, help="同一隔离数据库的 FastAPI 根地址")
    parser.add_argument("--headed", action="store_true", help="显示浏览器窗口，默认无头运行")
    parser.add_argument("--timeout-ms", type=int, default=15_000, help="单个页面操作等待时间")
    args = parser.parse_args()
    if args.timeout_ms < 1_000 or args.timeout_ms > 60_000:
        parser.error("--timeout-ms 必须在 1000 到 60000 之间")
    return args


def main() -> int:
    args = parse_args()
    try:
        target = SafeTestTarget(args.base_url, args.api_url)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=not args.headed)
            try:
                run_browser(browser, target, args.timeout_ms)
            finally:
                browser.close()
        return 0
    except Exception as error:
        print(f"[FAIL] {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
