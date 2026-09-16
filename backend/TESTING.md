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
uv run python scripts/success_response_contract_test.py 3010
```

concurrent_inventory_test.py 覆盖备餐期间录入/报废/撤销、过期编辑与确认、两人同时确认、不同餐争用库存、不足回滚、多菜同耗材撤销及单位历史。仅允许带测试标记的服务，保留测试历史。

`success_response_contract_test.py` 必须单独在全新空白隔离库运行。它先核对隔离库响应头、空库状态和运行中 OpenAPI，再通过真实业务链路调用归档中的全部 34 个成功 operation，并使用 Python 标准库按 `contracts/openapi.yaml` 逐个校验实际 JSON 响应；不安装额外校验包。脚本结束时把撤销后的菜单转为已取消，不给隔离库留下待完成菜单。

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
`tests/test_api_contract.py` 检查归档与 OpenAPI 一致、引用可解析及部分错误结构；原业务真实成功响应由上面的独立数据库脚本覆盖，手记 JSON 响应由下方 `journal-api-test.py` 覆盖，媒体另核验实际二进制响应。
浏览器操作使用独立验收环境；普通文档改动不需要运行上述前后端检查。
涉及浏览器时记录实际尺寸/主题、成功与错误路径、控制台及 React runtime 情况；未测明确写未测。

### 候选版本地浏览器关键路径

`browser_candidate_test.py` 使用后端开发依赖中锁定的 Python Playwright 1.61.0，不新增前端依赖，也不升级既有后端依赖。脚本会先检查前端与后端 `/health` 是否返回同一个 `X-Pantry-Nook-Test-Database`，并在每次浏览器写请求前重新检查；地址不是本机、标记缺失或变化、前后端标记不一致时立即阻断。脚本还固定拒绝文档中已有的 3000、3018、3019、5173、5200、5201 用户或人工验收端口。

为它单独启动全新的隔离后端和 Vite，例如后端 3045、前端 5215。Vite 必须把 `/api` 和 `/health` 代理到这次独立后端，不复用正在验收的服务。先同步锁定的开发依赖；如果当前运行机还没有 Playwright Chromium，再安装对应浏览器，然后执行：

```powershell
uv sync --frozen --group dev
uv run playwright install chromium
uv run python scripts/browser_candidate_test.py --base-url http://127.0.0.1:5215 --api-url http://127.0.0.1:3045
```

脚本每次生成唯一食材、菜品、搭配与待购名称，不依赖演示 ID；覆盖桌面库存新增后待补位置、只改单位，菜品到常用搭配及返回，以及手机餐安排核对、补货、安全自动关联并回核对。它同时检查关键页面横向溢出、本地请求失败、控制台 error 和页面运行错误。运行完成后关闭这次自建的 Vite 与隔离后端；测试库保留供核查，不自动删除。

## 本地人工验收数据（单独授权，非自动回归准备步骤）

仅在用户明确要求替换整组数据后执行。下列命令依次手动执行；任何一步失败立即停止，尤其备份失败不得继续清空：

```powershell
uv run python scripts/migrate_db.py
$env:APP_ENV='test'
$env:PANTRY_ALLOW_TEST_DATA='true'
# DB_NAME 必须为 isolated_server 创建的 pantry_nook_test_<UUID>
uv run python scripts/reset_data.py --yes
uv run python scripts/seed_demo_data.py http://127.0.0.1:3010
```

这组数据通过真实 API 创建，包含 8 种库存、6 道菜、2 个搭配、两条历史和三条待完成菜单。三条待完成菜单分别覆盖正常确认、待购买食材和预计量超过库存；日期与餐次互不重复。脚本只接受本机地址、显式测试开关和 `/health` 返回的隔离测试库标记；不自行清库，重复运行会失败。

## 当前覆盖范围

- `smoke_test.py`：库存报废与安全撤销、搭配引用保护、菜单确认/撤销的最短真实链路。
- `regression_test.py`：同名入库合并与分类冲突选择、批量原子性、搭配内容/名称唯一及并发保存、搭配引用、待完成菜单的库存保护、确认事务、重复确认和撤销历史。
- `menu_workflow_test.py`：每道菜先贴库存耗材或待购买食材、草稿允许稍后补预计量、待购买项补货后关联库存、菜单版本校验、实际用量核对、库存版本冲突整体回滚、确认和撤销恢复。
- `tests/test_api_contract.py`：统一错误结构与已归档 OpenAPI 契约。
- `success_response_contract_test.py`：在全新隔离库串行覆盖 34/34 个成功 operation，按归档 OpenAPI 校验每个实际 JSON 响应，并在操作数变化时要求同步扩展场景。
- `../scripts/journal-api-test.py --base <独立后端URL> --database <本轮测试库名> --samples <公开样本目录>`：显式地址和数据库＋媒体双标记必须匹配；13组静态手记真实API及成功契约，含Apple/Pixel/三星原件回读与MOV/伪装视频拒绝；不清库。
- `scripts/journal_edit_api_test.py --base <独立后端URL> --database <本轮测试库名> --samples <公开样本目录>`：显式地址/预期测试库及媒体双标记；真实照片编辑、封面/顺序/9张上限、归属、幂等/并发、原子失败回滚和旧实况行/磁盘保留。只在双标记隔离库构造历史元信息与视频测试资源；故障触发器在 finally 移除。必须与其他写入脚本串行。
- `../scripts/journal-migration-test.py`：新建独立测试库验证快照上限、带历史升级及重复执行，包含 013 历史手记升级 014 的首图封面回填，保留证据与测试库。
- `scripts/journal_backup_restore_test.py`：限定本机 55460 的 `pantry-journal-test-db`，专属 3063/3064；实际停写备份数据库＋媒体并恢复到新测试库，结束只停止自己服务，不清理数据库/备份。
- `../scripts/journal-editor-browser-test.mjs`：从项目根运行；显式设置 `JOURNAL_TEST_BASE`、`JOURNAL_TEST_DATABASE`，并设置 `PLAYWRIGHT_MODULE`、`JOURNAL_SAMPLES`、`JOURNAL_FOOD_SAMPLES`。验证超额先选、封面、替换失败恢复、取消/撤销、幂等重试、1–9张三档布局、静态Apple/Android上传、拒视频、图库无实况及拖入。证据 `.review/journal-editor-browser/`；不要与同库上传脚本并行。
- 旧实况浏览器脚本随功能移除；历史报告只对应历史提交，不作为当前门禁。真机相册选择器需用户验证。
- `boundary_audit_test.py`：改名冲突、分页越界、合并溢出/超精度、同名重新入库后的两类撤销、菜单缺失版本、搭配引用与删除并发。使用独立服务执行 `python scripts/boundary_audit_test.py <端口>`。
- `edit_conflict_test.py`：在全新独立库验证含零数量整批拒绝、人工合并必须正数、库存/菜品/搭配编辑缺失版本、过期版本、最新快照、核对后重试和并发仅保存一次。`python scripts/edit_conflict_test.py <端口>`；先运行此脚本，再在同库运行 regression，不能倒序。
- `recovery_merge_test.py`：48 项检查，覆盖报废与整餐合并撤销、单位换算、人工数量、过期预览、双人重复撤销、部分失败整体回滚、历史审计、耗材重新关联及清空预计量。`python scripts/recovery_merge_test.py <独立端口>`，固定使用 2036-01-02 晚餐。

多个脚本使用固定的菜单日期，即使之前菜单已取消，也会与另一脚本发生日期/餐次冲突。出现此情况应为该脚本新建独立测试库，或使用未运行过该日期场景的独立库；不要删除测试记录绕过唯一规则。2026-09-12 审查：regression/smoke/fractional 使用 3032，menu_workflow/concurrent 使用 3033。

迁移演练在需要验证旧数据库升级时单独运行：

```powershell
uv run python scripts/migration_rehearsal.py .backups/<升级前备份>.dump
```

验证 008 对历史重复搭配的合并时增加 `--expect-plan-deduplication`；该模式同时检查菜单引用转移、无关业务数据保持及迁移重复执行。

## 实现边界

已有数量逻辑使用 `Decimal` 与 `NUMERIC(15,6)` 对齐，不再将浮点数和数据库十进制数混算；库存录入超精度、超范围或非有限数字返回 400。核对用料还支持 `1/2`、`1/3` 等简单分数，由后端在事务内汇总后扣减。

计划创建、确认、撤销、库存写入在数据库事务开始时取得同一个 PostgreSQL 事务咨询锁，防止“检查无计划后并发创建计划”的窗口，并统一库存相关锁的取得顺序。此实现面向当前个人应用，串行化这些短事务；以后扩大并发使用规模时应重新评估锁粒度。

撤销按食材汇总同一餐的消耗，校验最后快照和版本后恢复到最早快照；存在后续库存变更时返回 409。同名新库存通过预览和用户选择合并恢复，审计保留各条消耗的来源；整餐原子提交。撤销后重新编排菜品保留既有行与历史快照；删除被历史消耗引用的菜品返回 409。

公开共享、临期提醒、统计和反馈均未在本轮实现。

- `waste_additive_test.py <独立端口>`：42 项检查，覆盖部分报废后补货、11.7 kg 结果、相同 ID 审计、重复恢复、预览期间补货、并发、换单位及人工量。

## 前端重构前补充审查

`uv run python scripts/phase_gate_audit.py <独立端口>` 在新独立库运行，或在未使用 2038-01-02 至 2038-01-07 晚餐的独立库运行。它保留测试历史，并留下一个用于浏览器核对单位变化的待完成菜单；不能直接在同库重复运行。

该脚本记录 7 个场景的期望与实际：库存字段一致、全零用量、取消恢复、预计量格式、菜品引用保护、逐菜恢复归属和预计量单位快照。当前这些场景应全部通过；单位换算后的实际前端展示仍需结合浏览器验证。详见 [阶段审查](../docs/phase-gate-audit-2026-09-12.md)。
