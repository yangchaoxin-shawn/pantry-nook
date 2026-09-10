# 食隅记前端

React 19 + TypeScript + Vite 响应式 Web 前端。

## 本地开发

先启动 FastAPI 后端（默认 `http://localhost:3000`），再执行：

```powershell
npm install
npm run dev
```

访问 `http://localhost:5173`。Vite 会将 `/api` 和 `/health` 代理到本地 FastAPI。

如需连接独立 API 地址，复制 `.env.example` 为 `.env` 并设置：

```env
VITE_API_BASE=https://api.example.com
```

## 质量检查

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run generate:api -- --check
```

生产构建产物位于 `dist/`。

## 当前功能

五个页面使用真实 FastAPI 数据：库存录入/编辑/状态筛选，菜品维护，搭配创建与修改，按日期安排作战并复制模板，实际用料确认、撤销、取消及消耗历史。写入期间防止重复提交；通信中断时提示先核对结果，不自动重试写入。

请求层在 `src/api.ts`；实体和写入类型来自 `src/api-schema.d.ts`，由 `contracts/openapi.yaml` 生成。全部分页读取完成后再展示，避免漏掉第 100 条以后的未确认计划。修改后端契约后执行 `npm run generate:api`。

主题默认跟随系统，可通过右上角切换；主题选择仅保持当前页面会话。业务数据不使用 localStorage。对没有到期日期、餐次或反馈接口的能力不显示演示数据。

浏览器写入验证请连接隔离服务，勿使用已有业务库：

```powershell
$env:VITE_API_BASE='http://127.0.0.1:3010'
npm run dev -- --host 127.0.0.1 --port 5174
```

`npm test` 包含请求分页、原文保留、局部更新和网络错误回归；真实数据库业务测试见 `../backend/TESTING.md`。浏览器验收记录见 `../docs/delivery-2026-09-09.md`。
