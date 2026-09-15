# Pantry Nook 当前状态

更新：2026-09-15。当前产品版本为 `1.0.0`，代码位于 `codex/ui-review-feedback`。公司预览入口为 [https://preview.aihuashen.com/pantry-nook/](https://preview.aihuashen.com/pantry-nook/)，使用服务器本机 Nginx、Docker FastAPI/PostgreSQL 与项目级 Basic Auth。

## 当前阶段

MVP 功能、两轮 UI / UX 反馈、正式视觉接入、本地类生产门禁和首次公司服务器部署均已完成。用户已于 2026-09-14 确认当前 UI / UX 范围无问题。

首次线上部署没有把准确 Git commit、制品校验值和服务器备份路径记录在同一份证据中，因此当前还不能把某个 commit 追认为正式 `v1.0.0`。下一步应从当前稳定候选重新构建并部署，线上核验通过后在实际部署的 commit 上创建 annotated tag `v1.0.0`。

## 产品状态

| 模块 | 当前实现 | 状态 |
|---|---|---|
| 库存 | 录入、批量录入、位置补充、±1 数量调整、只改单位、同名冲突、报废与安全撤销 | 已实现，UI 范围已验收 |
| 菜品与搭配 | 菜品簿、编辑删除、常用搭配、引用保护、稳定 ID 小人和插画 | 已实现，UI 范围已验收 |
| 餐安排 | 日期时间线、库存大类筛选、待购买、补货后安全自动关联、核对实际量 | 已实现，UI 范围已验收 |
| 确认与历史 | 最终事务扣减、版本冲突、失败回滚、撤销恢复、处理数量记录 | 已实现，Agent 门禁通过 |
| 响应式与主题 | 桌面、平板、手机、亮暗主题 | 已实现，当前 UI 范围已验收 |
| 持久化与契约 | PostgreSQL、11 个 migration、FastAPI、OpenAPI 归档和前端生成类型 | 已实现 |
| 部署 | `/pantry-nook/` 子路径、Basic Auth、Nginx 静态资源、Docker 后端和数据库 | 已上线；等待准确版本重发后打 tag |

## 当前候选证据

- `VERSION`、前端 package/lock、后端 pyproject/uv lock/runtime 与 OpenAPI 均为 `1.0.0`。
- PowerShell 发布脚本可解析；后端 compile、OpenAPI 和 12 项 unittest 通过。
- 前端 110/110、typecheck、lint、production build 通过。
- 完整 Docker 类生产预检通过：独立空白测试库、真实后端、`/pantry-nook/`、Basic Auth、SPA、CSS/JS/字体正文与 MIME、六个真实 API、CORS 和错误路由；测试容器与测试卷已清理。
- 上述证据证明本地候选可进入部署，不代表当前线上已经运行该 commit。

## 数据与发布边界

- 本地开发、自动化和人工评审只使用 mock/test 数据，并写入带标记的隔离测试库。
- 首次生产部署从空库初始化；线上产生数据后按持久生产保护，普通发布与回滚禁止 seed、reset、truncate、drop、`down -v` 和删卷。
- disposable Demo 必须使用明确标记的专用库/卷；必须携带的业务数据使用版本化 import/migration、备份和校验。
- 产品版本由用户确认；满足 [Git 自动提交门禁](git.md#自动提交门禁)后 Codex 可建立本地 commit。push、merge、tag 和部署仍遵循各自门禁。

## 下一步

1. 锁定结构整理后的准确 commit，确认工作区干净和 `1.0.0` 一致。
2. 从该 commit 生成制品并记录 SHA256、`RELEASE_ID` 和数据库备份。
3. 按 [部署执行文档](../DEPLOY-SERVER.md) 重新部署；普通升级不检查空库，也不触碰生产数据卷。
4. 完成匿名/登录、真实资源/MIME、真实 API、容器、日志、Linux 权限和浏览器核验。
5. 在实际部署且核验通过的 commit 上创建 annotated tag `v1.0.0`。

## 有效文档

- [AGENTS.md](../AGENTS.md)：稳定协作规则和业务红线。
- [PRD](PRD.md)：当前业务规格。
- [协作流程](collaboration.md)：开发、审查和发布门禁。
- [Git 与版本](git.md)：SemVer、tag、自动提交规则。
- [项目结构](project-map.md)：目录职责和历史资料位置。
- [部署入口](../DEPLOY.md)与[服务器执行文档](../DEPLOY-SERVER.md)：本地预检和公司服务器操作。
- [首次部署记录](deployment-2026-09-15.md)：已发生故障、修复与证据边界。

更早的详细阶段状态已完整保存在 [历史状态快照](history/project-status-through-2026-09-15.md)。历史报告只用于追溯，不替代当前代码、测试或线上证据。
