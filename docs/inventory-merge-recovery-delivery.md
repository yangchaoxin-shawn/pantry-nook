# 合并撤销交付记录

2026-09-12。用户已批准实施，Agent 已验证；用户验收待进行。对应规则见 [PRD](PRD.md) 与 [实施规格](inventory-merge-recovery-proposal.md)。

## 实现结果

- 从全局库存处理记录撤销报废，或从菜单历史撤销确定，都会先读取恢复预览。
- 遇到同名新库存，在弹窗选择统一单位；支持的单位自动换算，不可换算时填写最终数量。空白或非正数不能确认。
- 预览不预占库存。确认时在短事务中检查版本、恢复库存、反转历史并写审计；整餐任一项失败全部回滚，重复撤销不能再次加库存。
- 保留新库存 ID 与分类、位置、备注；旧记录保留历史。历史读取附带合并去向及当时的合并结果。
- 整餐撤销后回到待完成，本餐受影响耗材关联新库存并清空预计量，必须重新补齐后核对。
- 冲突刷新、关闭重开保留当前页面内的人工输入；整页刷新不保留草稿。所有业务写入都走真实 API。

## 数据库与契约

新增 migration 009 与 `inventory_recovery_merges`，保存来源、目标、恢复量和前后库存快照；来源具有唯一约束。无数据清洗、兼容路由、角色或公开访问变更。

新增两条只读路径：

- `GET /api/ingredients/adjustments/{id}/recovery-preview`
- `GET /api/daily-battles/{id}/recovery-preview`

现有两个撤销 POST 接收预览版本与合并选择；历史响应新增 `recovery_merges`。OpenAPI 共 23 条路径，归档与前端类型已同步生成。

用户库升级前备份为 `backend/.backups/20260912-100813-349665.dump`，随后执行 009。该备份恢复到独立数据库演练，9 张原业务表及餐次保持不变，重复迁移无变化。当前 3000 服务只读检查已显示新增接口；未重启用户服务、未替换验收数据。

## 验证结果与边界

| 检查 | 实际结果 |
|---|---|
| 合并真实 API | recovery_merge 48 项通过：重复/并发、过期预览、换算、人工量、整餐回滚、审计和耗材关联 |
| 相关回归 | concurrent 63、fractional 12、regression 40、smoke 18 项通过 |
| 后端静态与契约 | unittest 7、compileall 通过；另验证 501 项合并请求在访问数据库前返回 400 |
| 前端 | 测试 44、typecheck、lint、build 通过，最终 lint 无警告 |
| 390×844 暗色 | 手动合并空白拦截、7.5 数量保留、关闭重开、成功写入历史；模拟另一端补货，旧版本拒绝，刷新后成功 |
| 1440×900 亮色 | 原库存撤销预览排版；整餐合并成功，回到待完成并引导补全预计量 |
| 加载/错误 | 读取预览加载态；409 冲突保留输入并提供刷新；空数量禁止提交 |
| 控制台与 React | 所查 error/warn 为空，未见 React runtime error |
| 迁移 | 空库初始化 009、从备份升级、9 张业务表保持、重复执行均通过 |

测试写入仅发生在标记的独立数据库：3035 `pantry_nook_test_32d79573d10c4dfaa9625f65e0079266`、3036 `pantry_nook_test_4dd068e47b0343e09537e5bbc07aa57f`；浏览器 5184 指向 3036。升级演练库为 `pantry_nook_test_9ec13dbd1be544cbb3f07d832ef668b3`。

回归/冒烟运行在历史附加查询优化前，其后合并、并发与分数测试已验证优化后的查询。最后仅补充 500 项请求数量上限，单独验证拒绝分支。代码共用工作目录，不能称为完整代码环境隔离。

本轮只打磨恢复流程的字段、禁用、引导与现有响应式呈现，没有全面视觉重构、平板检查、所有页面空态/断网回归、WorkBuddy 全稿逐像素比对或部署验收。后端测试框架有现有 Starlette/httpx 弃用提示，不影响测试结果，本轮未升级依赖。

## 文件清单

修改：

- backend/app/api_contract.py
- backend/app/db/schema.sql
- backend/app/migrations.py
- backend/app/routes/consumptions.py
- backend/app/routes/daily_battles.py
- backend/app/routes/ingredients.py
- backend/app/routes/inventory_adjustments.py
- backend/scripts/migration_rehearsal.py
- backend/TESTING.md
- contracts/openapi.yaml
- frontend/src/App.tsx
- frontend/src/MenuWorkflow.tsx
- frontend/src/api-schema.d.ts
- frontend/src/api.ts
- docs/PRD.md
- docs/project-status.md
- docs/inventory-merge-recovery-proposal.md

新增：

- backend/app/recovery.py
- backend/migrations/009_inventory_recovery_merges.sql
- backend/scripts/recovery_merge_test.py
- frontend/src/RecoveryDialog.tsx
- docs/inventory-merge-recovery-delivery.md

删除：无。新增待确认产品取舍：无。未完成：用户实际验收、后置的整体 UI/UX 重构与发布部署。
