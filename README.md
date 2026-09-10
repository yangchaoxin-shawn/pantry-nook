# 食隅记 Pantry Nook

个人厨房管理 Web 应用：家里有什么食材、可以做哪些菜、今天计划吃什么、做完确认后自动调整库存。

> 隅：小家一隅，属于两个人的厨房小角落；食：食材美食；记：记录库存、买菜、做菜。

## 功能概览

围绕四个核心对象：

- **食材库存**：家里现有食材，按碳水/蔬菜/蛋白质/水果/其他分类；可在同一张表里批量速记、自动累加同名库存，并在分类或单位冲突时当场选择统一结果
- **菜品**：保存菜名，做菜时快速选择
- **搭配方案**：保存推荐组合，可整体引用也可拆开重组
- **每餐菜单**：日期、餐次、菜品和备餐食材；做完核对实际用料后“确定”，才生成消耗并调整库存。取消不扣库存，撤销恢复确认前库存。

当前页面为“菜单 / 库存 / 菜品”。待完成与历史同屏，菜品只存名字，常用搭配在菜品页面管理。规格见 [菜单闭环](docs/menu-workflow-proposal.md)，本次验证和文件清单见 [交付报告](docs/menu-workflow-delivery.md)。

详细产品逻辑见 [docs/PRD.md](docs/PRD.md)。

## 技术栈

- **前端**：React 19 + TypeScript + Vite（响应式 Web）
- **后端**：Python 3.13 + FastAPI + asyncpg + PostgreSQL
- **依赖管理**：前端 npm，后端 uv + venv
- **部署**：后端 Docker 运行，前端构建为静态文件由 Nginx 托管

## 本地开发

前置要求：Node.js 20+、Python 3.13+、uv、PostgreSQL 14+（本地原生安装，不用 Docker）。

```powershell
# 1. 初始化数据库（首次）
cd backend
Copy-Item .env.example .env   # 编辑 .env 填入本机 PostgreSQL 密码
uv sync
uv run python scripts/init_db.py

# 已有 v0.3 数据库升级时先备份并迁移（首次初始化已包含迁移）
uv run python scripts/migrate_db.py

# 2. 启动后端
uv run uvicorn app.main:app --port 3000 --reload
# http://localhost:3000

# 3. 启动前端（新终端）
cd frontend
npm install
npm run dev
# http://localhost:5173
```

前端默认使用 Vite 代理访问 `http://localhost:3000`。如需独立 API 地址，可在 `frontend/.env` 设置 `VITE_API_BASE`。

## 验证命令

```powershell
# 后端健康检查
Invoke-RestMethod http://localhost:3000/health

# 后端业务冒烟测试（先启动独立测试库，避免改动已有数据）
cd backend
uv run python scripts/isolated_server.py --port 3010
# 在另一终端运行：
uv run python scripts/smoke_test.py 3010
uv run python scripts/regression_test.py 3010
uv run python scripts/menu_workflow_test.py 3010

# 前端类型检查、lint、生产构建
cd ../frontend
npm run typecheck
npm run lint
npm test
npm run build
```

## 项目结构

```text
backend/
  app/main.py              FastAPI 服务入口与统一错误处理
  app/db.py                asyncpg 连接池与 JSON 序列化
  app/routes/              REST API 路由
  app/validation.py        请求校验工具
  app/db/schema.sql        数据库结构
  scripts/init_db.py       本地数据库初始化
  scripts/reset_data.py    开发数据清空
  scripts/smoke_test.py    业务链路冒烟测试
  pyproject.toml           Python 依赖声明
  uv.lock                  uv 锁定文件
frontend/
  src/App.tsx              React + TypeScript 页面
  src/main.tsx             前端入口
  vite.config.ts            Vite 配置与 FastAPI 代理
  tsconfig*.json           TypeScript 配置
contracts/
  openapi.yaml              FastAPI 自动生成的 API 契约
design/
  pantry-nook-prototype.html WorkBuddy V5 可交互行为参考
  design-system.md          设计系统规范 2.0
  今日三餐.png               今日三餐视觉基准
  共享反馈墙.png             共享反馈墙视觉基准
  handoff-manifest.json     设计包机器可读清单
docs/
  PRD.md                    产品需求文档（一切功能以它为准）
  git.md                    Git 提交规范
  frontend-design-handoff.md ChatGPT 单 Agent 全栈开发交接说明
CHATGPT_HANDOFF.md         ChatGPT 单 Agent 主工作交接入口
CLAUDE.md                   项目基础约束和历史协作规则
docker-compose.yml          生产环境后端 + 数据库编排
nginx.conf.example          生产环境 Nginx 配置示例
DEPLOY.md                   部署说明
```

## 当前状态

- [x] 产品需求文档（docs/PRD.md v0.3）
- [x] 文档先行协作规范
- [x] Python + FastAPI 后端重构
- [x] PostgreSQL 数据模型与核心业务事务
- [x] React + TypeScript 前端迁移
- [x] 后端业务链路冒烟验证
- [x] OpenAPI 契约导出
- [ ] 完整的前端视觉验收与生产部署

## 2026-09-09 实施结果

库存、菜品、搭配、每日菜单和消耗历史已接入真实 API，包含批量入库、报废/撤销报废、实际用料确认和撤销恢复。采用 WorkBuddy V5 的陶土色、亮暗主题、桌面双栏及移动底栏。临期、统计和共享反馈尚未实现，见 [产品确认提案](docs/v5-product-proposal.md)。

完整文件清单、测试和浏览器验证边界见 [本轮交付报告](docs/delivery-2026-09-09.md)。隔离测试方法见 [backend/TESTING.md](backend/TESTING.md)。生产部署尚未执行。

## 协作与提交

WorkBuddy 的设计资料仅作为视觉输入；当前阶段由单一 ChatGPT Agent 负责整个项目的全栈开发和后续视觉打磨，包括 React+TypeScript 前端、Python+FastAPI 后端、数据库、接口契约、测试、联调和部署。之前多 Agent 协作调研方案暂不启用，未来根据新的绘画/视觉方案重新设计协作模式。协作规则见根目录 `CLAUDE.md`，设计资料见 `design/`，交接说明见 [docs/frontend-design-handoff.md](docs/frontend-design-handoff.md)。
提交信息遵循 [Conventional Commits](docs/git.md)。
