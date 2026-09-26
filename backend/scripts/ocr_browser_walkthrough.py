"""拍小票入库的浏览器端到端走查：真实识别 → 第一轮确认 → 第二轮保存。

需要真实的 PP-OCRv6 识别侧车（见 ocr/README.md），并为本次走查新建隔离库，
不要复用用户正在验收的服务与识别侧车。在 backend/（PowerShell）：

    # ocr/ 下：$env:PADDLE_PDX_MODEL_SOURCE='modelscope'; $env:PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT='false'; uv run uvicorn app.main:app --port 9612
    $env:OCR_SERVICE_URL='http://127.0.0.1:9612'; uv run python scripts/isolated_server.py --port 3051
    # frontend/ 下：$env:PANTRY_API_PROXY_TARGET='http://127.0.0.1:3051'; npx vite --port 5219 --strictPort --host 127.0.0.1
    uv run python scripts/ocr_browser_walkthrough.py --base http://127.0.0.1:5219 --api http://127.0.0.1:3051 [--receipt 小票图片]

不指定 --receipt 时生成一张合成小票样张（需要 Windows 中文字体）。
写入前要求前端与后端指向同一个空的隔离测试库；浏览器写请求逐次核对。
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from playwright.sync_api import expect, sync_playwright

from ocr_walkthrough_guard import guard_browser_writes, local_root, matching_marker, require_empty_database

parser = argparse.ArgumentParser()
parser.add_argument("--base", required=True, help="本次走查专用的 Vite 地址")
parser.add_argument("--api", required=True, help="本次走查专用的隔离后端地址")
parser.add_argument("--receipt", help="小票图片；不指定时生成合成样张")
args = parser.parse_args()
BASE = local_root(args.base, "--base")
API = local_root(args.api, "--api")

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"[{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def synthetic_receipt() -> Path:
    """同行式小票样张：表头、5 个商品（含粘连金额行）和合计、支付、寒暄行。"""
    from PIL import Image, ImageDraw, ImageFont

    def font(size: int):
        for path in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simsun.ttc"):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
        raise SystemExit("缺少中文字体，无法生成合成小票；请用 --receipt 指定真实小票图片")

    image = Image.new("RGB", (640, 900), (252, 250, 244))
    draw = ImageDraw.Draw(image)
    y = 30
    draw.text((170, y), "惠民生活超市", font=font(34), fill=(20, 20, 20)); y += 55
    draw.text((150, y), "2026-09-23 12:30  收银员01", font=font(23), fill=(20, 20, 20)); y += 50
    draw.text((30, y), "品名  数量  单价  金额", font=font(23), fill=(20, 20, 20)); y += 45
    for name, qty, price, amount in [
        ("农夫山泉550ml", "1", "2.00", "2.00"),
        ("蒙牛纯牛奶250ml", "2", "3.20", "6.40"),
        ("土豆", "1.528", "5.96", "9.11"),
        ("抽纸x2", "1", "7.90", "7.90"),
        ("可乐  3.50  3.50", "", "", ""),
    ]:
        draw.text((30, y), name, font=font(26), fill=(20, 20, 20))
        if qty:
            draw.text((400, y), qty, font=font(26), fill=(20, 20, 20))
            draw.text((455, y), price, font=font(26), fill=(20, 20, 20))
            draw.text((540, y), amount, font=font(26), fill=(20, 20, 20))
        y += 52
    y += 20
    draw.text((30, y), "合计: 25.41", font=font(26), fill=(20, 20, 20)); y += 50
    draw.text((30, y), "微信支付 25.41  找零 0.00", font=font(23), fill=(20, 20, 20)); y += 45
    draw.text((120, y), "谢谢光临欢迎再来", font=font(23), fill=(20, 20, 20))
    path = Path(tempfile.gettempdir()) / "ocr-browser-walkthrough-receipt.png"
    image.save(path)
    return path


def wait_recognized(dialog, page, timeout_s: int = 180) -> None:
    """识别期间草稿区可能已出现，要等按钮上的"正在识别"消失。"""
    expect(dialog.locator(".ocr-receipt-review")).to_be_visible(timeout=timeout_s * 1000)
    for _ in range(timeout_s // 2):
        if "正在识别" not in dialog.locator(".ocr-receipt-review .actions button").last.inner_text():
            return
        page.wait_for_timeout(2000)
    raise AssertionError("识别超时")


receipt = Path(args.receipt) if args.receipt else synthetic_receipt()
marker = matching_marker(BASE, API)
require_empty_database(API)
print("隔离测试库：", marker, "| 小票：", receipt)

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
    check("弹窗标题为拍小票入库", "拍小票入库" in dialog.inner_text())
    file_input = dialog.locator('input[type="file"]')
    check("存在文件选择控件", file_input.count() == 1)
    file_input.set_input_files(str(receipt))
    print("…已上传，等待 CPU 识别（简单样张约 15–40 秒，密集小票可达约 160 秒）")
    wait_recognized(dialog, page)

    draft_rows = dialog.locator(".ocr-draft-row")
    row_count = draft_rows.count()
    check("识别出草稿行", row_count >= 3, f"实际 {row_count} 行")
    names = [draft_rows.nth(i).locator(".ocr-draft-name").inner_text().split("\n")[0] for i in range(row_count)]
    print("    识别行：", " / ".join(names))
    if not args.receipt:
        check("包含农夫山泉", any("农夫山泉" in name for name in names))

    # 第一轮：删一行，给待分类的行选分类，然后进入第二轮。
    draft_rows.first.get_by_role("button", name="删除").click()
    page.wait_for_timeout(200)
    check("删除草稿行生效", dialog.locator(".ocr-draft-row").count() == row_count - 1)
    next_button = dialog.locator(".ocr-receipt-review .actions button").last
    pending = dialog.locator("select.ocr-draft-category").evaluate_all("els => els.filter(e => !e.value).length")
    if pending:
        check("有待分类时不能进入下一步", next_button.is_disabled(), next_button.inner_text())
        selects = dialog.locator("select.ocr-draft-category")
        for i in range(selects.count()):
            if not selects.nth(i).input_value():
                selects.nth(i).select_option("其他")
    check("确认完可以进入下一步", next_button.is_enabled(), next_button.inner_text())
    next_button.click()
    page.wait_for_timeout(400)

    # 第二轮：补全数量与单位后保存。
    batch = page.locator(".batch-ingredient-editor")
    check("进入第二轮批量录入", batch.count() > 0)
    rows = batch.locator(".batch-ingredient-row")
    check("预填行数与草稿一致", rows.count() == row_count - 1, f"实际 {rows.count()} 行")
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
print("PASS: 浏览器走查全部通过")
