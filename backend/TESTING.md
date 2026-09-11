# 后端隔离测试

先按 [协作流程的验证分档](../docs/collaboration.md#验证分档) 选择本次检查。
自动化写入测试不使用用户验收库，不为测试清空该库；用户明确授权替换人工验收数据时才走下方独立流程。

## 启动真实 PostgreSQL 测试服务

在 `backend/` 执行：

```powershell
uv run python scripts/isolated_server.py --port 3010
```

该脚本读取 `.env` 中的 PostgreSQL 连接信息，在同一实例创建新的 `pantry_nook_test_<UUID>` 数据库，导入当前 schema，然后只在 `127.0.0.1:3010` 启动 FastAPI。它不会改写 `.env`，不会初始化或重置业务库。数据库账号需具有创建数据库权限。

每次启动默认生成新测试库。停止后保留测试库供核查；如需继续同一轮测试，用输出的测试库名称：

```powershell
uv run python scripts/isolated_server.py --port 3010 --reuse-test-database pantry_nook_test_<实际UUID>
```

只有此测试启动器会为 `/health` 增加 `X-Pantry-Nook-Test-Database` 响应头；普通应用没有测试专用 API 或数据字段。写入测试必须检测到此标记，否则拒绝执行。可将专门的前端验证服务代理到 3010，通过真实 API 验证浏览器写入流程。

## 检查入口（按需选择，不是每轮全跑）

后端语法或契约改动时，在 backend/：

```powershell
uv run python -m compileall app scripts -q
uv run python scripts/export_openapi.py --check
uv run python -m unittest discover -s tests -v
```

真实业务脚本在上述独立服务启动后按影响选择，串行运行：

```powershell
uv run python scripts/regression_test.py 3010
uv run python scripts/smoke_test.py 3010
uv run python scripts/menu_workflow_test.py 3010
uv run python scripts/concurrent_inventory_test.py 3010
```

concurrent_inventory_test.py 覆盖备餐期间录入/报废/撤销、过期编辑与确认、两人同时确认、不同餐争用库存、不足回滚、多菜同耗材撤销及单位历史。仅允许带测试标记的服务，保留测试历史。

如本机 uv 缓存受限，可使用 `uv --cache-dir .uv-cache run --no-sync ...` 与已有 `.venv`。

回归和冒烟测试依次执行。测试仅通过业务接口取消自己创建的未确认计划，保留测试历史，不删除数据。存在其他 planned 记录时拒绝开始，以免影响浏览器验证或其他测试。需要空数据态时启动一个新的隔离数据库，不调用 reset。

前端在 frontend/，按改动选择类型、lint、相关逻辑测试；集成候选/发布时做生产构建：

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

前端契约变更还需在 backend/ 导出 OpenAPI，然后在 frontend/ 执行 npm run generate:api，检查生成差异。
当前契约测试检查归档与 OpenAPI 一致、引用可解析及部分错误结构，不覆盖所有真实响应 schema。
浏览器操作使用独立验收环境；普通文档改动不需要运行上述前后端检查。
涉及浏览器时记录实际尺寸/主题、成功与错误路径、控制台及 React runtime 情况；未测明确写未测。

## 本地人工验收数据（单独授权，非自动回归准备步骤）

仅在用户明确要求替换整组数据后执行。下列命令依次手动执行；任何一步失败立即停止，尤其备份失败不得继续清空：

```powershell
uv run python scripts/migrate_db.py
uv run python scripts/reset_data.py --yes
uv run python scripts/seed_demo_data.py
```

这组数据通过真实 API 创建，包含 9 种库存、5 道菜、3 个搭配，以及一条已完成、一条已取消和一条待确认菜单。待确认菜单已贴好耗材，可直接走“核对用料 → 确认”来检查库存扣除。脚本不自行清库；重复运行会失败，避免悄悄混入重复数据。

## 当前覆盖范围

- `smoke_test.py`：库存报废与安全撤销、搭配引用保护、菜单确认/撤销的最短真实链路。
- `regression_test.py`：同名入库合并与分类冲突选择、批量原子性、搭配引用、待完成菜单的库存保护、确认事务、重复确认和撤销历史。
- `menu_workflow_test.py`：每道菜先贴库存耗材或待购买食材、草稿允许稍后补预计量、待购买项补货后关联库存、菜单版本校验、实际用量核对、库存版本冲突整体回滚、确认和撤销恢复。
- `tests/test_api_contract.py`：统一错误结构与已归档 OpenAPI 契约。

迁移演练在需要验证旧数据库升级时单独运行：

```powershell
uv run python scripts/migration_rehearsal.py .backups/<升级前备份>.dump
```

## 实现边界

已有数量逻辑使用 `Decimal` 与 `NUMERIC(15,6)` 对齐，不再将浮点数和数据库十进制数混算；库存录入超精度、超范围或非有限数字返回 400。核对用料还支持 `1/2`、`1/3` 等简单分数，由后端在事务内汇总后扣减。

计划创建、确认、撤销、库存写入在数据库事务开始时取得同一个 PostgreSQL 事务咨询锁，防止“检查无计划后并发创建计划”的窗口，并统一库存相关锁的取得顺序。此实现面向当前个人应用，串行化这些短事务；以后扩大并发使用规模时应重新评估锁粒度。

撤销按消耗逆序恢复并更新内存中的食材状态，存在后续有效消耗时返回 409。撤销后重新编排菜品会保留既有行与历史快照；删除被历史消耗引用的菜品返回 409，避免破坏引用或产生 500。

公开共享、临期提醒、统计和反馈均未在本轮实现。
