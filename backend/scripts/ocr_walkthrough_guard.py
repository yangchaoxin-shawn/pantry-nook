"""小票入库浏览器走查共用的写库保护，规则与 browser_candidate_test.py 一致。

浏览器保存经 Vite 代理写库，只核对后端地址不够：前端代理漏配时会写到
默认的 3000 端口。因此要求前端与后端 /health 返回同一个合法的隔离测试库
标记，拒绝文档中的用户/人工验收端口，并在每次浏览器写请求前重新核对。
"""

from __future__ import annotations

import json
import re
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

TEST_DATABASE = re.compile(r"pantry_nook_test_[0-9a-f]{32}")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
PROTECTED_PORTS = {3000, 3018, 3019, 5173, 5200, 5201}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def local_root(raw: str, label: str) -> str:
    value = raw.rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in LOCAL_HOSTS or parsed.port is None or parsed.path:
        raise SystemExit(f"拒绝执行：{label} 必须是本机 http 根地址，例如 http://127.0.0.1:5218")
    if parsed.port in PROTECTED_PORTS:
        raise SystemExit(f"拒绝执行：{label} 使用了受保护的用户/人工验收端口 {parsed.port}")
    return value


def _health_marker(root: str) -> str:
    with urlopen(Request(f"{root}/health"), timeout=10) as response:
        body = json.loads(response.read().decode("utf-8"))
        marker = response.headers.get("X-Pantry-Nook-Test-Database", "")
    if not isinstance(body, dict) or body.get("status") != "ok":
        raise SystemExit(f"拒绝执行：{root}/health 不是可用的 Pantry Nook 服务")
    if not TEST_DATABASE.fullmatch(marker):
        raise SystemExit(f"拒绝执行：{root}/health 缺少合法的隔离测试库标记")
    return marker


def matching_marker(base: str, api: str) -> str:
    """前端代理与后端必须指向同一个隔离测试库。"""
    base_marker = _health_marker(base)
    api_marker = _health_marker(api)
    if base_marker != api_marker:
        raise SystemExit("拒绝执行：前端代理与后端指向不同的隔离测试库")
    return api_marker


def require_empty_database(api: str) -> None:
    """走查的期望依赖初始数据；习惯库为空说明这是全新隔离库（含已消耗/报废的历史）。"""
    with urlopen(Request(f"{api}/api/ocr/ingredient-habits"), timeout=10) as response:
        habits = json.loads(response.read().decode("utf-8")).get("data", [])
    if habits:
        raise SystemExit(f"拒绝执行：隔离库已有 {len(habits)} 条食材记录，请为本次走查新建一个隔离库")


def guard_browser_writes(page, base: str, api: str, marker: str) -> None:
    """浏览器写请求只允许发往前端地址，且每次写入前重新核对隔离库标记。"""
    allowed = urlsplit(base).netloc

    def handle(route):
        request = route.request
        if request.method not in SAFE_METHODS:
            try:
                target = urlsplit(request.url)
                if target.netloc != allowed or target.port in PROTECTED_PORTS:
                    raise AssertionError(f"浏览器试图向未授权地址写入：{request.url}")
                if matching_marker(base, api) != marker:
                    raise AssertionError("运行期间隔离测试库标记发生变化，拒绝继续写入")
            except BaseException:
                # 复核失败（含 matching_marker 抛出的 SystemExit）也先中止请求，避免请求挂起。
                route.abort()
                raise
        route.continue_()

    page.route("**/*", handle)
