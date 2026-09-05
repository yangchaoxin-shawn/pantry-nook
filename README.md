# 食隅记 Pantry Nook

个人厨房管理 Web 应用：家里有什么食材、可以做哪些菜、今天计划吃什么、做完确认后自动调整库存。

> 隅：小家一隅，属于两个人的厨房小角落；食：食材美食；记：记录库存、买菜、做菜。

## 功能概览

围绕四个核心对象：

- **食材库存**：家里现有食材，按碳水/蔬菜/蛋白质/水果/其他分类
- **菜品**：保存菜名，做菜时快速选择
- **搭配方案**：保存推荐组合（如"杂粮饭+香煎鸡腿肉+西兰花+胡萝卜"），可整体引用也可拆开重组
- **今日作战**：今天的做菜计划；确认做完后才生成消耗记录并调整库存，取消或撤销不影响库存

详细产品逻辑见 [docs/PRD.md](docs/PRD.md)。

## 技术栈

- **前端**：React 19 + Vite（响应式 Web，支持手机/平板/桌面）
- **后端**：Node.js + Express 5 + PostgreSQL
- **部署**：后端 Docker 运行，前端静态文件由服务器 Nginx 托管

## 本地开发

前置要求：Node.js 20+、PostgreSQL 14+（本地原生安装，不用 Docker）。

```powershell
# 1. 初始化数据库（首次）
cd backend
Copy-Item .env.example .env   # 编辑 .env 填入本机 PostgreSQL 密码
npm install
node scripts/init-db.js

# 2. 启动后端
npm run dev                   # http://localhost:3000

# 3. 启动前端（新终端）
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

## 项目结构

```text
backend/                  Node.js + Express 后端
  src/app.js              服务入口
  src/db.js               PostgreSQL 连接与类型解析
  src/db/schema.sql       数据库结构
  src/routes/             API 路由
  src/lib/                校验、错误、响应工具
  scripts/init-db.js      本地数据库初始化
frontend/                 React + Vite 前端
docs/
  PRD.md                  产品需求文档（一切功能以它为准）
  git.md                  Git 提交规范
CLAUDE.md                 AI 协作规范
docker-compose.yml        生产环境后端 + 数据库编排
nginx.conf.example        生产环境 Nginx 配置示例
DEPLOY.md                 部署说明
```

## 当前状态

- [x] 产品需求文档（docs/PRD.md v0.3）
- [x] 项目结构规范（frontend/backend + docs + CLAUDE.md）
- [x] Git 规范（Conventional Commits，见 docs/git.md）
- [ ] 按 PRD 重做后端数据模型（食材/菜品/搭配方案/今日作战/消耗）
- [ ] 前端页面设计与实现
- [ ] 生产部署

## 协作与提交

本项目与 Claude Code 协作开发，协作规则见根目录 `CLAUDE.md`。
提交信息遵循 [Conventional Commits](docs/git.md)。
