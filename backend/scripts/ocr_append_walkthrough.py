"""多拍累加场景走查：两张真实小票（同一张长票的上下段）累加成一个草稿。

前置：隔离后端 3047、Vite 5217、侧车 9610 全部运行。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:5217"
RECEIPTS = [
    r"C:/Users/yangchaoxin/Downloads/真实购物发票的图片/微信图片_20260923234801_719_250.jpg",
    r"C:/Users/yangchaoxin/Downloads/真实购物发票的图片/微信图片_20260923234802_720_250.jpg",
]

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
    page.get_by_role("button", name="库存").first.click()
    entry = page.get_by_role("button", name="拍小票入库")
    expect(entry).to_be_enabled(timeout=15000)
    entry.click()
    dialog = page.get_by_role("dialog")
    file_input = dialog.locator('input[type="file"]')

    counts = []
    for index, receipt in enumerate(RECEIPTS):
        before = dialog.locator(".ocr-draft-row").count()
        file_input.set_input_files(receipt)
        # 识别期间草稿区保持可见，等行数增长（首张从 0 开始）来判断完成。
        for _ in range(90):
            page.wait_for_timeout(2000)
            current = dialog.locator(".ocr-draft-row").count()
            if current > before and not dialog.locator("p[role='status']").count():
                break
        page.wait_for_timeout(500)
        counts.append(dialog.locator(".ocr-draft-row").count())
        print(f"    第 {index + 1} 张识别后草稿行数：{counts[-1]}")
        if index == 0 and len(RECEIPTS) > 1:
            more = dialog.get_by_role("button", name="再拍一张累加")
            check("有再拍累加按钮", more.count() > 0)
            more.click()
            check("累加时保留已识别行", dialog.locator(".ocr-draft-row").count() == counts[0],
                  f"累加态行数 {dialog.locator('.ocr-draft-row').count()}")

    check("行数累加", counts[-1] > counts[0], f"两张后 {counts[-1]} 行 ≤ 第一张 {counts[0]}")
    dup_labels = dialog.locator(".ocr-draft-name small.ocr-duplicate").count()
    check("出现疑似重复徽标", dup_labels > 0, f"徽标 {dup_labels} 个")
    check("核对引导条存在", dialog.locator(".ocr-checklist").count() == 1)

    # 待办过滤：点疑似重复胶囊后只看重复行
    dialog.locator(".ocr-chip", has_text="疑似重复").click()
    page.wait_for_timeout(200)
    dup_rows = dialog.locator(".ocr-draft-row").count()
    dup_labels = dialog.locator(".ocr-draft-name small.ocr-duplicate").count()
    check("过滤后只显示疑似重复行", dup_rows == dup_labels and dup_rows > 0, f"行 {dup_rows} / 标记 {dup_labels}")
    dialog.locator(".ocr-chip", has_text="全部").click()
    page.wait_for_timeout(200)

    # 名称内联编辑：改第一行名称
    first_name = dialog.locator(".ocr-draft-name").first
    original = first_name.inner_text().split("\n")[0].strip()
    first_name.click()
    name_input = dialog.locator(".ocr-draft-name-input")
    check("名称进入内联编辑", name_input.count() == 1)
    name_input.fill(original + "X")
    name_input.press("Enter")
    page.wait_for_timeout(200)
    edited = dialog.locator(".ocr-draft-name").first.inner_text().split("\n")[0].strip()
    check("名称修改生效", edited == original + "X", edited)
    # 改回去
    dialog.locator(".ocr-draft-name").first.click()
    name_input = dialog.locator(".ocr-draft-name-input")
    name_input.fill(original)
    name_input.press("Enter")

    # 删除全部疑似重复行（后端规则：同一批不能重复填写同名食材）
    dialog.locator(".ocr-chip", has_text="疑似重复").click()
    page.wait_for_timeout(200)
    for _ in range(20):
        rows_left = dialog.locator(".ocr-draft-row").count()
        if rows_left == 0:
            break
        dialog.locator(".ocr-draft-row").first.get_by_role("button", name="删除").click()
        page.wait_for_timeout(150)
    save_btn = dialog.locator(".actions button").filter(has_text="保存")
    check("重复清零后保存按钮可用", save_btn.is_enabled())
    dialog.locator(".ocr-chip", has_text="全部").click()
    save_btn.click()
    page.wait_for_timeout(500)
    batch = page.locator(".batch-ingredient-editor")
    check("进入批量录入", batch.count() > 0)
    for i in range(batch.locator(".batch-ingredient-row").count()):
        row = batch.locator(".batch-ingredient-row").nth(i)
        if row.locator("input[placeholder='数量']").input_value().strip() == "":
            row.locator("input[placeholder='数量']").fill("1")
        if row.locator("input[placeholder='单位']").input_value().strip() == "":
            row.locator("input[placeholder='单位']").fill("个")
    batch.get_by_role("button", name="保存这批食材").click()
    page.wait_for_timeout(3000)
    check("保存后弹窗关闭", page.locator(".batch-ingredient-editor").count() == 0)
    check("出现已记录提示", "已记录" in page.inner_text("body"))

    check("无控制台 error", not console_errors, "; ".join(console_errors[:3]))
    check("无页面运行错误", not page_errors, "; ".join(page_errors[:3]))
    page.screenshot(path=str(Path(__file__).resolve().parents[2] / ".review" / "ocr-smoke" / "append-final.png"))
    browser.close()

print()
if failures:
    print(f"FAILED: {len(failures)} 项未通过：{failures}")
    sys.exit(1)
print("PASS: 多拍累加走查全部通过")
