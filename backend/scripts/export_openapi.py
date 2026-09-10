"""从 FastAPI 导出可重复的契约（JSON 是合法的 YAML 1.2，无额外依赖）。"""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="只校验已归档契约是否与当前后端一致")
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[2] / "contracts" / "openapi.yaml"
    content = json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if target.read_text(encoding="utf-8") != content:
            raise SystemExit("OpenAPI 已变化，请重新导出契约并生成前端类型。")
        print("OpenAPI 契约与后端一致。")
    else:
        target.write_text(content, encoding="utf-8", newline="\n")
        print(f"已导出 {len(app.openapi()['paths'])} 个 API 路径到 contracts/openapi.yaml")


if __name__ == "__main__":
    main()
