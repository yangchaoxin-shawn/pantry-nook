# Pantry Nook 当前状态

更新：2026-09-11。本轮：双人共享场景的库存与菜单核对改动；下文区分本轮验证与历史证据。
业务规格只维护在 [PRD](PRD.md)，协作方式见 [流程](collaboration.md)。

## 当前授权与阶段

用户已开始反馈库存/核对场景问题；尚未给出各模块的最终验收结论。
本轮批准并实施：菜单保存不占库存；点击“核对用料”后建立短时可用库存锁定，确认时再扣真实库存。锁定期间允许补货，但不允许报废、减库存或换单位破坏其他菜单的锁定量。
未新增角色、公开访问或部署；未重置用户数据。测试使用独立端口 3017 / 数据库，浏览器前端 localhost:5174。
代码在原工作目录更新，会被原热重载服务读取；本轮隔离了测试端口和数据，未建立独立代码 worktree，不能称为完整双环境。

## 模块状态

| 模块 | 业务规则 | 实现情况 | Agent 验证证据 | 用户验收 | 下一步 |
|---|---|---|---|---|---|
| 库存录入与冲突 | 已确认 | 单个/批量、同名冲突处理已实现 | 本轮 regression + concurrent API；浏览器补录成功 | 待验收 | 单行批量、分类与单位冲突 |
| 报废与撤销 | 已确认 | 全量/部分、全局记录、撤销已实现 | 本轮 smoke + concurrent 验证待餐报废/撤销 | 待验收 | 全量消失后从全局找回 |
| 菜品与搭配 | 已确认 | CRUD、引用保护、复制已实现 | 菜品搭配审计及前次 API/browser 记录 | 待验收 | 复用、改名、引用删除 |
| 菜单备餐 | 已确认 | 每餐菜品/耗材、草稿、编辑已实现 | 菜单审计及前次 workflow 记录 | 待验收 | 耗材与预计量的保存/确认边界 |
| 确认、历史与撤销 | 已确认 | 核对锁定、确认事务、版本保护、同屏历史已实现 | review_reservation、workflow、concurrent API；浏览器异常路径 | 待验收 | 实际量调整、扣除、恢复和冲突 |
| 响应式与亮暗 | 已有实现 | 现有界面可供验收，整体重构后置 | 历史报告曾记录多尺寸；不是本轮复测 | 待验收 | 结合本次实际任务发现可用性问题 |
| 迁移与契约 | 已有实现 | migration、OpenAPI 导出、前端生成类型 | 前次迁移/契约检查；本轮未重跑 | 不等同产品验收 | 改动时定向验证 |

历史来源：[库存审计](inventory-v1-data-api-audit.md)、[菜单审计](menu-v1-audit-2026-09-10.md)、
[菜品搭配审计](dishes-plans-v1-audit-2026-09-10.md)、[旧菜单交付](menu-workflow-delivery.md)。
这些记录对应过去代码与数据，不引用其中断言计数证明当前 HEAD 全量通过。

## 已建立的检查点

- 3893220：本地核心功能代码基线。
- 35f1dca：更新验收数据脚本与测试说明。
- 2026-09-11 上轮会话：seed 脚本在独立端口 3016 验证，再备份本地库并通过 3000 API 写入；浏览器读取成功，所查 error 日志为空。
- 8c685f0：上一轮统一规格与 Claude/Codex 协作入口；以下文档静态检查属于该轮。
- 本轮文档静态检查通过：10 份当前文档、60 个本地链接与锚点、CLAUDE 导入路径、AGENTS 长度、编码及代码块；git diff --check 通过。未启动 Claude CLI 验证自动加载。

## 本轮验证：2026-09-11 双人库存与核对

- 后端：regression 31、menu_workflow 34、concurrent_inventory 55、smoke 18 项断言通过；人工不可换算合并的版本检查追加 7 项定向断言通过。契约 unittest 4 项通过；compileall 与 OpenAPI 归档一致检查通过。
- 前端：30 项测试通过，typecheck / lint / build 通过；不新增依赖。
- 真实浏览器：390px 暗色、1440px 亮色核对窗口无横向溢出；初值 200g/1个 分别显示 200/1。打开时/列表刷新加载态、无待完成餐空态、断线错误与恢复均已走查。
- 双窗口闭环：第二窗口入库 100g，第一窗口库存 500g → 600g、输入 150 不变；确认后真实 API 库存 450g；第二窗口自动显示已确认并禁用提交。
- 断线保留 125，禁用确认；恢复后输入仍为 125。单位 g → kg 后禁用，按新单位改为 0.125 后确认成功，API 余量为 0.475kg。
- 正常流程两窗口 error 控制台日志为空；故意关闭隔离后端时显示预期连接失败提示，恢复后所查 error 日志仍为空。未观察到 React runtime error。
- 005_review_reservations 迁移新增核对锁定表；OpenAPI、生成类型与本地开发数据库已同步。
- 本轮未做全站视觉回归、全部尺寸主题交叉组合、公开链接或跨真实设备网络验收，未改 WorkBuddy 视觉基准。
- 相关库存确认后有后续更新时保守拒绝自动撤销，详细业务边界见 PRD。当前为 agent 验证通过、待用户验收。

## 用户验收数据

上次初始化配置为 9 种库存、5 道菜、3 个搭配、1 条待完成/1 条已完成/1 条已取消菜单。
这只是 35f1dca 脚本的初始场景，不是持续不变的数据库状态。
当前数据均为测试数据，用户开始操作后会变化；不要为了对齐本表自动重新 seed/reset。
旧库备份位置为 backend/.backups/20260911-093125-965101.dump（本地忽略文件，不随 Git 分发）。

## 待办与边界

| 项目 | 状态 | 处理原则 |
|---|---|---|
| 用户本轮验收 | 已开始反馈，模块待验收 | 反馈按场景记录，再批准具体修复 |
| 浏览器关键场景自动化 | 待补；当前无已归档的完整流程套件 | 后续单独安排，不把人工走查当作脚本 |
| 真实响应与 OpenAPI 全面匹配验证 | 待补 | 当前归档一致性检查不能替代它 |
| 前端按模块拆分与全面 UI 重构 | 后置 | 功能验收后逐批实施 |
| Worktree + 独立端口/数据库双环境 | 未完整搭建 | 后端 isolated_server 可用；Vite 当前仍代理 3000 |
| Codex Actions / Skills / 定时任务 | 未配置 | 根据实际重复工作单独批准 |
| 旧 Claude worktree | 保留 | 存在未跟踪文件，不自动删除或合并 |
| Git 远程仓库 | 未配置 | 后续选择目的地再推送 |
| 日期相关新能力、临期、统计、共享反馈 | MVP 外 | 不从原型自动扩展 |
| Docker / Nginx / 发布 | 暂缓 | 本地验收后用空生产库另行设计验证 |

后续新增问题在此记录模块、预期、修复提交、验证结果与用户验收；不要把尚未出现的缺陷写成已确认故障。

## 文档导航与有效性

| 资料 | 用途 |
|---|---|
| [PRD](PRD.md) | 唯一当前业务规格，按模块组织 |
| [AGENTS.md](../AGENTS.md)、[协作流程](collaboration.md)、[Git](git.md) | 当前工作规则 |
| [README](../README.md)、[测试说明](../backend/TESTING.md) | 当前运行与验证入口 |
| [Agent 迁移说明](agent-transition.md) | Claude 遗留机制核查与适配依据 |
| [设计交付](frontend-design-handoff.md)、design/ | 视觉参考，业务以 PRD 为准 |
| [旧菜单提案](menu-workflow-proposal.md)、三个模块 audit 文件 | 历史决策/审计，含过期描述，不能替代当前规格 |
| [菜单交付](menu-workflow-delivery.md)、[旧交付](delivery-2026-09-09.md) | 历史验证快照 |
| [旧实施范围](implementation-scope-2026-09-09.md)、[旧数据清理预览](menu-demo-data-cleanup-preview-2026-09-10.md) | 历史范围/方案，不授权现在执行 |
| [V5 扩展提案](v5-product-proposal.md) | 待批准扩展，不是 MVP 待补必做项 |
| [基础设施审计](release-v1-infrastructure-audit-2026-09-10.md)、[部署说明](../DEPLOY.md) | 发布阶段参考，当前不执行 |
| 根目录 design-prototype*.html | 旧原型，保留历史；不作为当前业务规格 |

## 本轮文件范围

- 修改（前端）：frontend/src/App.tsx、MenuWorkflow.tsx、api.ts、api-schema.d.ts。
- 修改（后端）：backend/app/routes/ingredients.py、daily_battles.py、quantity.py、migrations.py、api_contract.py；backend/scripts/regression_test.py、smoke_test.py、menu_workflow_test.py、fractional_quantity_test.py、concurrent_inventory_test.py、seed_demo_data.py。
- 修改（契约与文档）：contracts/openapi.yaml、docs/PRD.md、docs/project-status.md、backend/TESTING.md。
- 新增：backend/app/review_locks.py、backend/migrations/005_review_reservations.sql、backend/scripts/review_reservation_test.py。
- 删除：无。已新增表结构/migration；依赖和用户测试数据不变。
