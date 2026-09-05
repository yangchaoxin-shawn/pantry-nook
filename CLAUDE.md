# 食隅记 Pantry Nook

个人厨房管理 Web 应用：食材库存 + 菜品/搭配方案 + 今日作战（计划/确认）+ 消耗记录。
用户一人使用，后续可能两人共用。产品形态为响应式 Web（手机/平板/桌面浏览器）。

## 项目结构

```text
backend/    Node.js + Express 5 + PostgreSQL，REST API，端口 3000
frontend/   React 19 + Vite，开发端口 5173
docs/       PRD.md（产品需求）、git.md（Git 规范）、seed-data.md（初始数据）
```

功能以 `docs/PRD.md` 为准，技术实现不得反向改变产品逻辑。

## 常用命令

```powershell
# 后端（先确保 PostgreSQL 服务运行）
cd backend; npm run dev          # http://localhost:3000

# 前端
cd frontend; npm run dev         # http://localhost:5173

# 初始化/重置本地数据库（危险：会重建所有表）
cd backend; node scripts/init-db.js

# 健康检查
Invoke-RestMethod http://localhost:3000/health
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

- 后端：CommonJS、Express 5、pg 连接池；路由在 `backend/src/routes/`，校验工具在 `src/lib/validation.js`
- 响应格式：成功 `{ data, meta? }`；错误 `{ error: { code, message } }`
- 日期一律 `YYYY-MM-DD` 字符串（db.js 已配置 DATE 类型解析）
- 注释和用户可见文案用中文；代码标识符用英文
- 前端构建产物环境变量 `VITE_API_BASE`，本地开发留空走 Vite 代理

## Git 规范

Conventional Commits 1.0.0，scope 固定：`backend` / `frontend` / `db` / `docs` / `deploy`。
示例：`feat(backend): 添加今日作战确认接口`。详见 `docs/git.md`。

破坏性变更在 type 后加 `!`：`feat(backend)!: ...`

当前阶段允许直接提交 main；大功能开 `feat/xxx` 分支。

## 敏感信息

- `.env` 不进 Git（已配 .gitignore）
- 生产部署流程见 `DEPLOY.md`，生产数据库密码必须与开发环境不同
