# 食隅记 Pantry Nook

个人厨房管理 Web 应用：库存 → 选菜备餐 → 做完核对实际用量 → 确认扣库存 → 历史与安全撤销。
当前主入口为菜单、库存、菜品；常用搭配在菜品页。

## 先看什么

- [当前状态](docs/project-status.md)：实现进度、已记录验证、用户待验收与后续事项。
- [当前 PRD](docs/PRD.md)：库存、菜品/搭配、菜单的有效业务规格。
- [AGENTS.md](AGENTS.md)：Agent 工作入口；[协作流程](docs/collaboration.md) 定义范围批准、验证分档与交付。
- [Claude → Codex 适配](docs/agent-transition.md)：遗留配置保留方式；CLAUDE.md 只导入共享规则。
- [测试说明](backend/TESTING.md)：隔离验证命令；[Git 约定](docs/git.md)：版本与提交。

当前核心模块已进入阶段验收；最新结果见 [前端重构前审查](docs/phase-gate-audit-2026-09-12.md)，代码职责与整理计划见 [项目结构](docs/project-map.md)。是否通过以状态表为准。

## 技术栈

React 19 + TypeScript + Vite；Python 3.13 + FastAPI + asyncpg；PostgreSQL。
前端 npm、后端 uv，安装按仓库锁文件；具体版本约束以 package.json / pyproject.toml 和 lock 为准。
当前使用本地原生 PostgreSQL；Docker/Nginx 等到发布阶段。

## Windows PowerShell 本地启动

首次配置：准备 Node.js（满足所锁定 Vite 的运行要求）、Python 3.13、uv、PostgreSQL。
仅在 backend/.env 尚不存在时从 backend/.env.example 复制并填写本机数据库信息；不要覆盖已有配置。
首次空库初始化使用 backend/scripts/init_db.py；已有库升级先备份并执行 scripts/migrate_db.py。
启动不需要反复初始化或清空数据库。

后端窗口：

```powershell
cd C:\Users\yangchaoxin\Desktop\pantry-nook\backend
uv sync --locked
uv run uvicorn app.main:app --port 3000 --reload
```

前端窗口：

```powershell
cd C:\Users\yangchaoxin\Desktop\pantry-nook\frontend
npm ci
npm run dev
```

已有依赖且锁文件未变化时可直接运行启动行；安装依赖不应打断正在运行的验收。
页面：http://127.0.0.1:5173/ 。后端健康：http://127.0.0.1:3000/health 。
启动前检查端口是否已有用户服务，不重复启动或结束未知进程。

前端默认 Vite 代理到 localhost:3000；VITE_API_BASE 可指定独立 API。
仅换前端端口不代表 API 或数据库已隔离；完整双环境尚未配置。

## 验证与契约

按 [验证分档](docs/collaboration.md#验证分档) 选相关检查，不默认运行所有测试。
自动化写入必须使用 [独立测试服务](backend/TESTING.md)，不要将 smoke/regression/workflow 指向业务端口。

契约变更时：

```powershell
cd C:\Users\yangchaoxin\Desktop\pantry-nook\backend
uv run python scripts/export_openapi.py
cd ..\frontend
npm run generate:api
```

contracts/openapi.yaml 是 app.openapi() 的可重复导出，当前含人工字段描述；
frontend/src/shared/api/schema.d.ts 由它生成，不手改。归档一致性检查不等于所有真实响应与业务都已验证。

## 目录

| 路径 | 用途 |
|---|---|
| backend/app/ | 路由、校验、事务、连接池、schema |
| backend/migrations/ | 增量数据库迁移 |
| backend/scripts/、backend/tests/ | 运行工具、隔离验证、契约测试 |
| frontend/src/ | React 页面、请求封装和生成类型 |
| contracts/ | 导出 API 契约 |
| docs/ | 当前规格、状态、协作及历史记录 |
| design/ | WorkBuddy V5 原始视觉输入 |
| .claude/ | Claude 个人配置及旧 worktree，保留并忽略 |

设计基准 WB-V5-2026-09-09 / 系统 2.0，页面结构以用户确认的 PRD 为准。
根目录多版旧原型与旧交付文档保留为历史，不自动变成新的功能要求。
[部署文档](DEPLOY.md) 和 Docker/Nginx 文件是后续参考，当前不代表已部署或发布就绪。

## 数据与安全

业务数据当前全为测试数据；只有用户明确要求后才备份并替换/清空。
第一版发布从空数据库执行 migration，不迁移本地演示数据。
数据库配置仅放 backend/.env，不进 Git；当前没有账号权限，不将本地可用等同于可公开访问。
