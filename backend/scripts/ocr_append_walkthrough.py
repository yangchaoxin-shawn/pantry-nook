"""多拍累加场景走查：同一张长票的分段照片累加成一个草稿，再完成两轮入库。

需要真实的 PP-OCRv6 识别侧车，并为本次走查新建隔离库；启动方式与
scripts/ocr_browser_walkthrough.py 相同，不要复用用户正在验收的服务与识别侧车：

    uv run python scripts/ocr_append_walkthrough.py --base http://127.0.0.1:5219 --api http://127.0.0.1:3051 --receipts 上段.jpg 下段.jpg

写入前要求前端与后端指向同一个空的隔离测试库；浏览器写请求逐次核对。
覆盖累加、跨张缝合、拍照重复自动合并、同名组的"保留这条"一键去重、
名称内联编辑、待分类清零后进入第二轮、合并保存。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from playwright.sync_api import expect, sync_playwright

from ocr_walkthrough_guard import guard_browser_writes, local_root, matching_marker, require_empty_database

parser = argparse.ArgumentParser()
parser.add_argument("--base", required=True, help="本次走查专用的 Vite 地址")
parser.add_argument("--api", required=True, help="本次走查专用的隔离后端地址")
parser.add_argument("--receipts", nargs=2, required=True, metavar=("上段", "下段"), help="同一张长票的两段照片")
args = parser.parse_args()
BASE = local_root(args.base, "--base")
API = local_root(args.api, "--api")
RECEIPTS = [str(Path(path)) for path in args.receipts]

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"[{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def next_button(dialog):
    return dialog.locator(".ocr-receipt-review .actions button").last


def wait_recognized(dialog, page, before: int, timeout_s: int = 180) -> None:
    """识别期间草稿区可能已出现，要等行数增长且按钮上的"正在识别"消失。"""
    for _ in range(timeout_s // 2):
        page.wait_for_timeout(2000)
        if not dialog.locator(".ocr-receipt-review").count():
            continue
        if dialog.locator(".ocr-draft-row").count() > before and "正在识别" not in next_button(dialog).inner_text():
            return
    raise AssertionError("识别超时")


marker = matching_marker(BASE, API)
require_empty_database(API)
print("隔离测试库：", marker)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    guard_browser_writes(page, BASE, API, marker)
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
        wait_recognized(dialog, page, before)
        counts.append(dialog.locator(".ocr-draft-row").count())
        print(f"    第 {index + 1} 张识别后草稿行数：{counts[-1]}")
        if index == 0:
            more = dialog.get_by_role("button", name="再拍一张累加")
            check("有再拍累加按钮", more.count() > 0)
            more.click()
            check("累加时保留已识别行", dialog.locator(".ocr-draft-row").count() == counts[0])

    check("识别后有草稿行", counts[-1] > 0, f"两张后 {counts[-1]} 行")
    check("第一轮不再有待补数量胶囊", dialog.locator(".ocr-chip", has_text="待补数量").count() == 0)

    # 拍照重复：名称数量金额完全一致的行已自动合并（折叠提示）；数量或金额
    # 不同的同名行聚合成组，组内"保留这条"一键去重——都不需要逐行手删。
    removed = dialog.locator(".ocr-removed")
    if removed.count():
        check("自动合并提示可展开", "已自动去除" in removed.first.inner_text())

    def duplicate_badges() -> int:
        return dialog.locator(".ocr-draft-name small.ocr-duplicate").count()

    if duplicate_badges():
        check("有疑似重复时不能进入下一步", next_button(dialog).is_disabled(), next_button(dialog).inner_text())
        group_heads = dialog.locator(".ocr-draft-group-head")
        check("同名行聚合成组并有组头提示", group_heads.count() > 0, f"{group_heads.count()} 组")
        for _ in range(10):
            keep = dialog.get_by_role("button", name="保留这条")
            if not keep.count():
                break
            keep.first.click()
            page.wait_for_timeout(200)
        check("组内保留一条后徽标清零", duplicate_badges() == 0, f"剩 {duplicate_badges()} 个")
    else:
        check("无遗留疑似重复（已自动合并或本无重叠）", duplicate_badges() == 0)

    # 名称内联编辑：改第一行名称再改回
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
    dialog.locator(".ocr-draft-name").first.click()
    name_input = dialog.locator(".ocr-draft-name-input")
    name_input.fill(original)
    name_input.press("Enter")
    page.wait_for_timeout(200)

    # 给识别错字等无法自动分类的行选分类。
    selects = dialog.locator("select.ocr-draft-category")
    for i in range(selects.count()):
        if not selects.nth(i).input_value():
            selects.nth(i).select_option("其他")
    check("重复与待分类清零后可以进入下一步", next_button(dialog).is_enabled(), next_button(dialog).inner_text())
    draft_count = dialog.locator(".ocr-draft-row").count()
    next_button(dialog).click()
    page.wait_for_timeout(500)

    batch = page.locator(".batch-ingredient-editor")
    check("进入第二轮批量录入", batch.count() > 0)
    rows = batch.locator(".batch-ingredient-row")
    check("第二轮行数与草稿一致", rows.count() == draft_count, f"{rows.count()} / {draft_count}")
    for i in range(rows.count()):
        row = rows.nth(i)
        quantity = row.locator(".pn-quantity-controls input")
        unit = row.locator("input[placeholder='单位']")
        if not quantity.input_value().strip():
            quantity.fill("1")
        if not unit.input_value().strip():
            unit.fill("个")
    batch.get_by_role("button", name="保存这批食材").click()
    page.wait_for_timeout(3000)
    check("保存后弹窗关闭", page.locator(".batch-ingredient-editor").count() == 0)
    check("出现已记录提示", "已记录" in page.inner_text("body"))

    check("无控制台 error", not console_errors, "; ".join(console_errors[:3]))
    check("无页面运行错误", not page_errors, "; ".join(page_errors[:3]))
    browser.close()

print()
if failures:
    print(f"FAILED: {len(failures)} 项未通过：{failures}")
    sys.exit(1)
print("PASS: 多拍累加走查全部通过")
