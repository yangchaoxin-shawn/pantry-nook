# 项目结构与整理清单

2026-09-12。当前为前端重构前的阶段审查；缺陷清单和验证证据见 [阶段审查](phase-gate-audit-2026-09-12.md)。

## 当前唯一有效入口

| 需要知道什么 | 文件 |
|---|---|
| 最新状态和下一步 | [project-status.md](project-status.md) |
| 已确认的产品规则 | [PRD.md](PRD.md) |
| 授权、测试分档和交付 | [collaboration.md](collaboration.md)、[AGENTS.md](../AGENTS.md) |
| 本地启动 | [根 README](../README.md) |
| 后端独立测试和迁移 | [backend/TESTING.md](../backend/TESTING.md) |
| API 归档 | [contracts/openapi.yaml](../contracts/openapi.yaml)，由后端导出 |
| 前端设计输入 | [frontend-design-handoff.md](frontend-design-handoff.md)，实际业务以 PRD 为准 |
| Git 提交与保护范围 | [git.md](git.md) |

## 当前代码职责

```text
backend/app/
  main.py                应用入口、跨域、异常处理
  routes/                各模块 API，当前也含多数 SQL/事务逻辑
  menu_workflow.py        备餐关系和版本校验
  recovery.py             报废/整餐恢复与恢复审计
  quantity.py             Decimal、分数与精度
  validation.py           请求值校验
  api_contract.py         人工补充 OpenAPI 字段
  db.py / db/schema.sql   连接池、锁与当前表结构快照
backend/migrations/       不可改写的历史增量迁移
backend/scripts/          服务、迁移、真实 API 测试和人工数据脚本
backend/tests/            契约、数量单元测试
frontend/src/
  App.tsx                 当前页面、弹窗、库存/菜品/搭配表单
  MenuWorkflow.tsx         菜单编辑、核对、时间线
  RecoveryDialog.tsx       撤销预览和合并
  api.ts / api-schema.d.ts 请求层与生成类型
  *logic.ts / *.test.ts    已抽取的计算和测试
  App.css 等              当前样式
```

## 建议的整理批次（未执行文件搬迁）

1. **先固定业务**：修阶段审查的问题。事务和历史代码保留单独可审查提交。
2. **拆前端职责**：`features/inventory`、`features/menu`、`features/catalog` 承载页面与流程；`shared/ui` 放通用弹窗/按钮，`shared/api` 放请求与生成类型；计算规则独立。移动文件时先不改视觉和行为。
3. **整理后端**：保留现有 `routes` 入口，逐步抽取 service 和请求模型；不为了目录整齐增加无实际用途的多层抽象，不改现有 API 命名。
4. **归档历史资料**：旧交付/审计、根目录 `design-prototype*.html` 等可归档，并同步所有链接。先确认依赖引用再移动；原型不是业务规格。
5. **清理确认无引用的脚手架资源**：`frontend/src/assets/react.svg`、`vite.svg` 当前源码搜索未发现引用，列为候选；本轮未删除。
6. **隔离运维资料**：Docker/Nginx、DEPLOY 仍是后置部署资料，不作为本地启动路径；部署阶段统一审查，暂不启用。

## 保护与维护

- `.claude/settings.local.json`、`.claude/worktrees/`、个人配置、备份和历史会话保留，不属于整理删除对象。
- migration 历史不改内容；schema 快照与迁移入口一起验证，不能用重新建库代替升级。
- `project-status.md` 后续可缩成短状态表，把重复旧结果放到对应历史报告；本轮仅更新最上方状态，避免为目录整理重写历史证据。
- 不升级依赖、不换技术栈、不引入全套新状态库或 ORM 作为整理前提。
- 每批整理都回答：行为是否改变、影响哪些模块、需要哪些测试。纯搬迁用类型/导入检查和对应流程验证，不重复所有业务回归。
