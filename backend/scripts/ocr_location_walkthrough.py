"""小票入库的位置习惯走查（全新隔离后端 + Vite + 识别存根）。

前置：为本次走查新建隔离库，端口不要复用用户正在验收的服务。在 backend/（PowerShell）：

    uv run python scripts/ocr_stub_sidecar.py --port 9611
    $env:OCR_SERVICE_URL='http://127.0.0.1:9611'; uv run python scripts/isolated_server.py --port 3049
    # frontend/ 下另开一个终端：
    $env:PANTRY_API_PROXY_TARGET='http://127.0.0.1:3049'; npx vite --port 5218 --strictPort --host 127.0.0.1
    uv run python scripts/ocr_location_walkthrough.py --base http://127.0.0.1:5218 --api http://127.0.0.1:3049

写入前要求前端与后端指向同一个隔离测试库、且库为空；浏览器写请求逐次核对。
覆盖第一轮待分类拦截、第二轮位置按来源预填（习惯/推测）、手动修改后保存，
以及下一次按修改后的习惯预填。不依赖也不占用真实识别侧车。
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from playwright.sync_api import expect, sync_playwright

from ocr_walkthrough_guard import guard_browser_writes, local_root, matching_marker, require_empty_database

parser = argparse.ArgumentParser()
parser.add_argument("--base", required=True, help="本次走查专用的 Vite 地址")
parser.add_argument("--api", required=True, help="本次走查专用的隔离后端地址")
args = parser.parse_args()
BASE = local_root(args.base, "--base")
API = local_root(args.api, "--api")

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"[{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def api(method: str, path: str, payload=None):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(API + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


marker = matching_marker(BASE, API)
require_empty_database(API)
print("隔离测试库：", marker)

api("POST", "/api/ingredients/batch", {"items": [
    {"name": "沙葱", "category": "蔬菜", "stock_text": "0.2", "stock_value": 0.2, "stock_unit": "kg", "location": "冰箱冷冻"},
    {"name": "苹果", "category": "水果", "stock_text": "3", "stock_value": 3, "stock_unit": "个", "location": "室温"},
    {"name": "橙子", "category": "水果", "stock_text": "4", "stock_value": 4, "stock_unit": "个", "location": "室温"},
    {"name": "梨", "category": "水果", "stock_text": "2", "stock_value": 2, "stock_unit": "个", "location": "室温"},
]})
print("习惯数据就绪：沙葱放冷冻；苹果、橙子、梨放室温")

image = Path(tempfile.gettempdir()) / "ocr-location-walkthrough.png"
image.write_bytes(TINY_PNG)

# 第二轮每行期望：(位置, 是否为推测)。
EXPECTED = {
    "沙葱": ("冰箱冷冻", False),        # 同名习惯
    "黄心土豆": ("室温", True),         # 内置关键词
    "莴笋": ("冰箱冷藏", True),         # 蔬菜分类默认
    "速冻饺子": ("冰箱冷冻", True),     # 内置关键词
    "风行酸奶180g": ("冰箱冷藏", True), # 蛋白质分类默认
    "五指毛桃切节": ("室温", True),     # 汤料分类默认
    "芒果": ("室温", False),            # 水果同类多数（习惯）
    "进口神秘礼盒": ("室温", True),     # 手选"其他"后的分类默认
}


def open_receipt(page):
    page.get_by_role("button", name="库存").first.click()
    entry = page.get_by_role("button", name="拍小票入库")
    expect(entry).to_be_enabled(timeout=15000)
    entry.click()
    dialog = page.get_by_role("dialog")
    dialog.locator('input[type="file"]').first.set_input_files(str(image))
    expect(dialog.locator(".ocr-checklist")).to_be_visible(timeout=30000)
    return dialog


def round_two_rows(page) -> dict[str, tuple[str, bool]]:
    rows = page.locator(".batch-ingredient-editor .batch-ingredient-row")
    result = {}
    for i in range(rows.count()):
        row = rows.nth(i)
        name = row.locator("input[placeholder='食材名']").input_value()
        select = row.locator("select")
        result[name] = (select.input_value(), "location-guess" in (select.get_attribute("class") or ""))
    return result


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    guard_browser_writes(page, BASE, API, marker)
    console_errors: list[str] = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.goto(BASE, wait_until="networkidle")

    # —— 第一轮：待分类拦截 ——
    dialog = open_receipt(page)
    check("第一轮不再有待补数量胶囊", dialog.locator(".ocr-chip", has_text="待补数量").count() == 0)
    next_button = dialog.locator(".ocr-receipt-review .actions button").last
    check("有待分类时不能进入下一步", next_button.is_disabled(), next_button.inner_text())
    check("按钮说明待分类数量", "1 项待分类" in next_button.inner_text(), next_button.inner_text())
    gift = dialog.locator(".ocr-draft-row", has_text="进口神秘礼盒")
    gift.locator("select.ocr-draft-category").select_option("其他")
    check("分类选好后可以进入下一步", next_button.is_enabled(), next_button.inner_text())
    next_button.click()
    page.wait_for_timeout(500)

    # —— 第二轮：位置按来源预填 ——
    actual = round_two_rows(page)
    for name, (location, guess) in EXPECTED.items():
        got = actual.get(name)
        check(f"{name} 预填 {location}{'（推测）' if guess else '（习惯）'}", got == (location, guess), f"实际 {got}")
    hint = page.locator(".batch-ingredient-editor").inner_text()
    check("顶部汇总预填来源", "2 项按你的习惯" in hint and "6 项按常见存放推测" in hint, hint[:160])
    page.screenshot(path=str(Path(tempfile.gettempdir()) / "ocr-location-round2.png"))

    # 把莴笋改到室温：视为你定的位置，推测标记消失、汇总同步。
    lettuce = page.locator(".batch-ingredient-editor .batch-ingredient-row").filter(
        has=page.locator("input[value='莴笋']"))
    lettuce.locator("select").select_option("室温")
    page.wait_for_timeout(200)
    check("改过的位置不再标推测", round_two_rows(page)["莴笋"] == ("室温", False))
    check("汇总随修改更新", "5 项按常见存放推测" in page.locator(".batch-ingredient-editor").inner_text())

    rows = page.locator(".batch-ingredient-editor .batch-ingredient-row")
    for i in range(rows.count()):
        row = rows.nth(i)
        unit = row.locator("input[placeholder='单位']")
        if not unit.input_value().strip():
            name = row.locator("input[placeholder='食材名']").input_value()
            unit.fill("kg" if name == "沙葱" else "个")
    page.get_by_role("button", name="保存这批食材").click()
    page.wait_for_timeout(2500)
    check("保存后弹窗关闭", page.locator(".batch-ingredient-editor").count() == 0)

    stored = api("GET", "/api/ingredients?limit=100&offset=0")
    by_name = {item["name"]: item for item in stored["data"]}
    check("莴笋按修改后的位置入库", by_name.get("莴笋", {}).get("location") == "室温", str(by_name.get("莴笋")))
    check("黄心土豆按推测位置入库", by_name.get("黄心土豆", {}).get("location") == "室温")
    check("沙葱合并后仍在冷冻", by_name.get("沙葱", {}).get("location") == "冰箱冷冻")

    # —— 再拍一次：按上次修改的习惯预填 ——
    page.reload(wait_until="networkidle")
    dialog = open_receipt(page)
    next_button = dialog.locator(".ocr-receipt-review .actions button").last
    check("礼盒分类已学会，无需再选", next_button.is_enabled(), next_button.inner_text())
    next_button.click()
    page.wait_for_timeout(500)
    again = round_two_rows(page)
    check("莴笋这次按你的习惯填室温", again.get("莴笋") == ("室温", False), f"实际 {again.get('莴笋')}")
    check("礼盒这次按你的习惯填室温", again.get("进口神秘礼盒") == ("室温", False), f"实际 {again.get('进口神秘礼盒')}")

    check("无控制台 error", not console_errors, "; ".join(console_errors[:3]))
    browser.close()

print()
if failures:
    print(f"FAILED: {len(failures)} 项未通过：{failures}")
    sys.exit(1)
print("PASS: 位置习惯走查全部通过")
