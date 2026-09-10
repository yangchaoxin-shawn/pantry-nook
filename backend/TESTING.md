# 后端隔离测试

业务数据库可能已有食材和计划。不要为测试清空该数据库，也不要把原型演示数据写入其中。

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

## 执行验证

```powershell
uv run python -m compileall app scripts -q
uv run python scripts/regression_test.py 3010
uv run python scripts/smoke_test.py 3010
uv run python scripts/menu_workflow_test.py 3010
uv run python -m unittest discover -s tests -v
```

如本机 uv 缓存受限，可使用 `uv --cache-dir .uv-cache run --no-sync ...` 与已有 `.venv`。

回归和冒烟测试依次执行。测试仅通过业务接口取消自己创建的未确认计划，保留测试历史，不删除数据。存在其他 planned 记录时拒绝开始，以免影响浏览器验证或其他测试。需要空数据态时启动一个新的隔离数据库，不调用 reset。

## 当前覆盖范围

- `smoke_test.py`：库存报废与安全撤销、搭配引用保护、菜单确认/撤销的最短真实链路。
- `regression_test.py`：同名入库合并与分类冲突选择、批量原子性、搭配引用、待完成菜单的库存保护、确认事务、重复确认和撤销历史。
- `menu_workflow_test.py`：每道菜先贴耗材、草稿允许稍后补预计量、菜单版本校验、实际用量核对、库存版本冲突整体回滚、确认和撤销恢复。
- `tests/test_api_contract.py`：统一错误结构与已归档 OpenAPI 契约。

迁移演练在需要验证旧数据库升级时单独运行：

```powershell
uv run python scripts/migration_rehearsal.py .backups/<升级前备份>.dump
```

## 实现边界

本轮未增加业务字段或 schema migration。数量使用 `Decimal` 与既有 `NUMERIC(12,3)` 对齐，不再将浮点数和数据库十进制数混算；超精度、超范围或非有限数字返回 400。

计划创建、确认、撤销、库存写入在数据库事务开始时取得同一个 PostgreSQL 事务咨询锁，防止“检查无计划后并发创建计划”的窗口，并统一库存相关锁的取得顺序。此实现面向当前个人应用，串行化这些短事务；以后扩大并发使用规模时应重新评估锁粒度。

撤销按消耗逆序恢复并更新内存中的食材状态，存在后续有效消耗时返回 409。撤销后重新编排菜品会保留既有行与历史快照；删除被历史消耗引用的菜品返回 409，避免破坏引用或产生 500。

公开共享、临期提醒、统计和反馈均未在本轮实现。
