# 项目结构与整理清单

更新：2026-09-17。运行代码按模块拆分；本页维护职责和入口，当前进度见 [项目状态](project-status.md)。历史缺陷与冻结证据见 [阶段审查](phase-gate-audit-2026-09-12.md)。

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
| 产品版本与更新记录 | [VERSION](../VERSION)、[CHANGELOG.md](../CHANGELOG.md) |
| 公司服务器部署 | [DEPLOY.md](../DEPLOY.md)、[DEPLOY-SERVER.md](../DEPLOY-SERVER.md) |
| 当前正式发布证据 | 从 [项目状态](project-status.md) 进入对应版本记录 |

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
  journal_models.py       手记输入与响应契约
  journal_media.py         原件存储边界、请求体限制、处理进程
  journal_worker.py        静态图片解码、旋转与预览生成
  db.py / db/schema.sql   连接池、锁与当前表结构快照
backend/migrations/       不可改写的历史增量迁移
backend/scripts/          服务、迁移、真实 API 测试和人工数据脚本
backend/tests/            契约、数量单元测试
frontend/src/
  app/                    应用数据加载、导航、动作编排、弹窗调度和跨模块类型
  features/inventory/     库存页面、录入/编辑、报废记录、单位与冲突计算
  features/menu/          菜单时间线、编辑、核对用料、消耗历史与相关测试
  features/catalog/       菜品和常用搭配页面及编辑器
  features/recovery/      报废与整餐撤销预览、合并恢复
  features/journal/       饭桌手记、上传队列、静态图库浏览
  shared/api/             API 请求层、请求测试和 OpenAPI 生成类型
  shared/ui/              无业务含义的通用弹窗、字段、空状态和图标
  App.css 等              现有共享样式；新模块继承已确认语言，按实际需要抽取
scripts/                  交接/版本检查、本地类生产预检、UI 评审环境和线上核验
contracts/                后端导出的 OpenAPI 与前端类型输入
design/                   当前设计系统、视觉资产和历史原型
docs/history/             不再作为当前入口的完整历史快照
```

## 整理状态与后续批次

1. **业务冻结已完成**：阶段审查问题已修复，事务和历史代码保留独立提交。
2. **前端职责拆分已完成**：业务页面、表单、计算、恢复、共享 UI 和 API 已按上述目录归位；`App.tsx` 从约 1490 行降至 400 行。本批不改变业务、接口和视觉。
3. **整理后端**：保留现有 `routes` 入口，逐步抽取 service 和请求模型；不为了目录整齐增加无实际用途的多层抽象，不改现有 API 命名。
4. **历史原型已归档**：根目录 5 个 `design-prototype*.html` 已移动到 `design/legacy-prototypes/`；原型不是业务规格或正式应用入口。
5. **待设计阶段处理**：`frontend/src/assets/react.svg`、`vite.svg` 当前源码搜索未发现引用；与旧样式一起在新 UI 落地后清理，避免结构提交混入视觉资源删除。
6. **运维资料已分层**：根目录 `DEPLOY.md` 是部署入口，`DEPLOY-SERVER.md` 是 Pantry Nook 项目参数；通用安全流程由用户级 `deploy-company-server` Skill 管理。

## 保护与维护

- `.claude/settings.local.json`、`.claude/worktrees/`、个人配置、备份和历史会话保留，不属于整理删除对象。
- migration 历史不改内容；schema 快照与迁移入口一起验证，不能用重新建库代替升级。
- `project-status.md` 保持短状态表；完整旧内容保存在 `docs/history/project-status-through-2026-09-15.md`，避免每轮读取过期细节。
- 不升级依赖、不换技术栈、不引入全套新状态库或 ORM 作为整理前提。
- 每批整理都回答：行为是否改变、影响哪些模块、需要哪些测试。纯搬迁用类型/导入检查和对应流程验证，不重复所有业务回归。
