# 食隅记 Pantry Nook

个人厨房管理 Web 应用：食材库存 + 菜品/搭配方案 + 今日作战（计划/确认）+ 消耗记录。
用户一人使用，后续可能两人共用。产品形态为响应式 Web（手机/平板/桌面浏览器）。

## 项目结构

```text
backend/    Python + FastAPI + asyncpg + PostgreSQL，REST API，端口 3000
frontend/   React 19 + TypeScript + Vite，开发端口 5173
docs/       PRD.md（产品需求）、git.md（Git 规范）、seed-data.md（初始数据）、frontend-design-handoff.md（前端设计交接）
contracts/  openapi.yaml（FastAPI 自动生成，前后端契约单一事实源）
design/     WorkBuddy 设计交付物、视觉基准和交接 manifest
```

功能以 `docs/PRD.md` 为准，技术实现不得反向改变产品逻辑。

2026-09-09 用户已批准并执行每餐菜单闭环：详见 `docs/menu-workflow-proposal.md` 和 `docs/menu-workflow-delivery.md`。主界面为菜单、库存、菜品；餐次与本次备餐关联已落库。旧文档中“新增业务能力均未批准”的笼统描述已过期；临期、统计、共享仍未批准。迁移通过 `backend/app/migrations.py`，已有数据库先备份再增量升级，禁止用重置代替迁移。

## 协作模式（必须遵守）

本项目采用"**文档先行**"的协作流程：

1. **先写文档**：PRD（产品需求）、架构设计、接口设计（API 契约）必须先定稿
2. **全栈由 ChatGPT 负责**：ChatGPT 在当前工作区实现 React+TypeScript 前端、Python+FastAPI 后端、数据库、接口契约、联调和测试
3. **视觉由 WorkBuddy 提供**：WorkBuddy 负责视觉设计、交互原型和设计迭代，交付物归档到 `design/`
4. **ChatGPT 负责最终工程对齐**：ChatGPT 根据 PRD、设计交付和 API 契约完成全栈实现，并自行进行前后端联调和浏览器验收

**原则**：
- 接口契约（请求/响应 JSON 格式、字段名、状态码）是前后端对齐的准则，任何一端不得擅自改动
- 设计系统规范文档（颜色、排版、组件、间距）产出后，前端实现必须遵循
- WorkBuddy 的设计通过 `design/` 归档后，再交给 ChatGPT；不依赖聊天记录传递项目事实
- 当前 WorkBuddy V5 设计包版本为 `WB-V5-2026-09-09`，视觉资料以 `design/` 中的文件为准；后续调整必须升版本
- 当前阶段不启用多 Agent 分工、交接编排或多人协作流程；WorkBuddy 设计仅作为视觉输入，ChatGPT 直接负责整个项目的 coding 和打磨
- `CHATGPT_HANDOFF.md` 是 ChatGPT 每次进入本工作区时的主交接入口；ChatGPT 可以使用自己的 subagent，但仍对最终全栈结果负责
- ChatGPT 可以修改整个工作区，包括 `frontend/`、`backend/`、`contracts/`、`design/`、测试、文档和部署配置
- 修改产品语义、清空或删除已有数据、引入无登录公开写入模型、替换视觉事实源前，必须先向用户说明并确认
- 未来如果用户通过新的绘画/视觉方案重新设计协作模式，再更新本文件和交接文档
- 后端业务规则不得通过前端反向修改（PRD 优先）
- 文档变更需同步更新到 `docs/` 目录，避免文档与代码脱节

## 常用命令

```powershell
# 后端（先确保 PostgreSQL 服务运行，用 uv + venv）
cd backend
uv run uvicorn app.main:app --port 3000 --reload   # http://localhost:3000

# 前端
cd frontend; npm run dev         # http://localhost:5173

# 初始化/重置本地数据库（危险：会重建所有表）
cd backend; uv run python scripts/init_db.py

# 清空开发数据（危险：TRUNCATE 全部表）
cd backend; uv run python scripts/reset_data.py --yes

# 健康检查
Invoke-RestMethod http://localhost:3000/health

# 重新导出 OpenAPI 契约（FastAPI 自动生成）
cd backend; uv run python -c "import yaml; from app.main import app; yaml.safe_dump(app.openapi(), open('../contracts/openapi.yaml','w',encoding='utf-8'), allow_unicode=True, sort_keys=False)"
```

本地 PostgreSQL 18 服务名 `postgresql-x64-18`，psql 路径 `C:\Program Files\PostgreSQL\18\bin\`。
数据库名 `pantry_nook`。密码只存在于 `backend/.env`，绝不写进命令行参数或代码。

## 核心业务规则（必须遵守）

1. **今日作战未确认时，任何接口不得修改库存数量**。
2. **确认操作 = 写消耗记录 + 调整库存，必须在一个数据库事务内**，失败全部回滚。
3. 搭配方案是模板；创建今日作战时**复制**菜品到作战记录，不共享数据。
4. 数量保留用户原文（如"一份""一顿"），不擅自换算单位；可计算数量是可选字段。
5. 所有 SQL 一律参数化（`$1` 占位符），禁止字符串拼接用户输入。
6. 撤销确认时按原消耗反向恢复库存；无法精确恢复的提示用户手动确认。

## 代码约定

- 后端：Python 3.13 + FastAPI + asyncpg；路由在 `backend/app/routes/`，校验工具在 `app/validation.py`，依赖用 uv 管理（pyproject.toml + uv.lock）
- 数据库连接池在 `app/db.py`；`app/main.py` 挂载全部路由并统一错误处理
- 响应格式：成功 `{ data, meta? }`；错误 `{ error: { code, message } }`
- 日期一律 `YYYY-MM-DD` 字符串（`jsonable()` 序列化 DATE；SQL 参数绑定用 `datetime.date` 对象）
- 所有 SQL 一律参数化（asyncpg 用 `$1` 占位符），禁止字符串拼接用户输入；`ANY($1::bigint[])` 需传 list 本体，其余占位符用 `*list` 展开
- 注释和用户可见文案用中文；代码标识符用英文
- 接口契约 = `contracts/openapi.yaml`（FastAPI 自动生成），前端用 openapi-typescript 消费
- 前端构建产物环境变量 `VITE_API_BASE`，本地开发留空走 Vite 代理

## Git 规范

Conventional Commits 1.0.0，scope 固定：`backend` / `frontend` / `db` / `docs` / `deploy`。
示例：`feat(backend): 添加今日作战确认接口`。详见 `docs/git.md`。

破坏性变更在 type 后加 `!`：`feat(backend)!: ...`

当前阶段允许直接提交 main；大功能开 `feat/xxx` 分支。

## 敏感信息

- `.env` 不进 Git（已配 .gitignore）
- 生产部署流程见 `DEPLOY.md`，生产数据库密码必须与开发环境不同
