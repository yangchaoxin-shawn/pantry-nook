"""拍小票入库的浏览器端到端走查（隔离后端 3047 + Vite 5217 + 侧车 9610）。"""

from __future__ import annotations

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:5217"
RECEIPT = Path(__file__).resolve().parents[2] / ".review" / "ocr-smoke" / "receipt.png"

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    mark = "PASS" if condition else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    console_errors: list[str] = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page_errors: list[str] = []
    page.on("pageerror", lambda err: page_errors.append(str(err)))

    page.goto(BASE, wait_until="networkidle")
    # 库存页是默认导航之一；直接点侧边栏"库存"。
    page.get_by_role("button", name="库存").first.click()
    # 入口按钮在库存数据加载完成前是禁用的。
    entry = page.get_by_role("button", name="拍小票入库")
    expect(entry).to_be_enabled(timeout=15000)
    check("库存页有拍小票入口", entry.count() > 0)
    entry.click()
    page.wait_for_timeout(400)

    # 2. 上传弹窗出现
    dialog = page.get_by_role("dialog")
    check("弹窗标题为拍小票入库", "拍小票入库" in dialog.inner_text())

    # 3. 上传小票图片（hidden input 直接 set）
    file_input = dialog.locator('input[type="file"]')
    check("存在文件选择控件", file_input.count() == 1)
    file_input.set_input_files(str(RECEIPT))
    print("…已上传，等待 CPU 识别（可能 20-40 秒）")
    page.wait_for_timeout(60000)

    review = dialog.locator(".ocr-receipt-review")
    draft_rows = dialog.locator(".ocr-draft-row")
    try:
        expect(review).to_be_visible(timeout=60000)
    except AssertionError:
        pass
    row_count = draft_rows.count()
    check("识别出草稿行", row_count >= 3, f"实际 {row_count} 行；弹窗内容：{dialog.inner_text()[:300]}")
    if row_count:
        names = [draft_rows.nth(i).locator(".ocr-draft-name").inner_text() for i in range(row_count)]
        print("    识别行：", " / ".join(names))
        check("包含农夫山泉", any("农夫山泉" in name for name in names))

        # 4. 删除一行后继续
        draft_rows.first.get_by_role("button", name="删除").click()
        page.wait_for_timeout(200)
        check("删除草稿行生效", dialog.locator(".ocr-draft-row").count() == row_count - 1)
        dialog.get_by_role("button", name="继续核对并保存").click()
        page.wait_for_timeout(400)

        # 5. 预填批量录入弹窗
        batch = page.locator(".batch-ingredient-editor")
        check("进入批量录入", batch.count() > 0)
        prefilled = batch.locator(".batch-ingredient-row input[placeholder='食材名']")
        values = [prefilled.nth(i).input_value() for i in range(prefilled.count())]
        print("    预填名称：", values)
        check("预填行数与草稿一致", len(values) == row_count - 1)

        # 6. 补全数量与单位后保存（空数量行需要填）
        qty_inputs = batch.locator(".batch-ingredient-row")
        for i in range(qty_inputs.count()):
            row = qty_inputs.nth(i)
            name_value = row.locator("input[placeholder='食材名']").input_value()
            qty = row.locator("input[placeholder='数量']")
            unit = row.locator("input[placeholder='单位']")
            if qty.input_value().strip() == "":
                qty.fill("1")
            if unit.input_value().strip() == "":
                unit.fill("个")
            print(f"    行{i+1}: {name_value} {qty.input_value()}{unit.input_value()}")
        batch.get_by_role("button", name="保存这批食材").click()
        page.wait_for_timeout(3000)

        # 7. 校验保存结果：弹窗关闭、成功提示或列表出现新食材
        check("保存后弹窗关闭", page.locator(".batch-ingredient-editor").count() == 0)
        body = page.inner_text("body")
        check("出现已记录提示", "已记录" in body, body[:200])
    else:
        # 识别为空时也要看到明确错误文案
        check("空结果有明确提示", "没有识别出商品" in dialog.inner_text())

    check("无控制台 error", not console_errors, "; ".join(console_errors[:3]))
    check("无页面运行错误", not page_errors, "; ".join(page_errors[:3]))
    page.screenshot(path=str(Path(__file__).resolve().parents[2] / ".review" / "ocr-smoke" / "browser-final.png"), full_page=False)
    browser.close()

print()
if failures:
    print(f"FAILED: {len(failures)} 项未通过：{failures}")
    sys.exit(1)
print("PASS: 浏览器走查全部通过")
