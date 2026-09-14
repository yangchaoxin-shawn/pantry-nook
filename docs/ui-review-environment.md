# 第一批 UI 独立评审环境

2026-09-14 反馈整改使用另一工作树及 **5201 / 3019**，入口与重启命令见 [本轮记录](ui-review-feedback.md)。下面的 5200 / 3018 是第一批环境，两份数据互不替换。启动器会读取各自工作树的 `.review/environment.json`，不要混用运行目录。

本环境用于本地 UI 开发和人工评审，代码位于独立 worktree `.worktrees/ui-foundation`，分支 `codex/ui-foundation`。既有 3000、5173、5186 等服务不由本脚本管理。

| 项目 | 配置 |
|---|---|
| 页面 | <http://127.0.0.1:5200> |
| 后端 | <http://127.0.0.1:3018> |
| 数据库 | 首次启动生成的独立 `pantry_nook_test_<UUID>`，以后复用 |
| 运行记录和日志 | 当前 worktree 的 `.review/`，已加入 Git 忽略 |
| 后端依赖 | 主工作区 `backend/.venv/Scripts/python.exe`，业务代码从当前 worktree 加载 |
| 前端依赖 | 当前 worktree 的 `frontend/node_modules`，由现有锁文件安装 |

独立的是业务代码目录、前后端端口与 PostgreSQL 数据库；复用本机 PostgreSQL 实例、Python 运行环境和连接凭据。不是独立虚拟机、容器或生产部署。页面只监听本机地址，手机尺寸由浏览器模拟；不提供外网共享。

## 继续评审

服务仍运行时直接打开上述页面。电脑重启、任务中断或服务已关闭后，执行这一条命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\yangchaoxin\Desktop\pantry-nook\.worktrees\ui-foundation\scripts\start-ui-review.ps1"
```

启动器复用 `.review/environment.json` 记录的数据库和端口，不灌入数据，不覆盖之前的手工操作。再次执行启动命令时，两个服务均健康则直接返回原链接，不重复启动。`ExecutionPolicy Bypass` 只作用于这次 PowerShell 进程，不修改用户策略或配置。

查看与关闭（在该 worktree 根目录执行）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-ui-review.ps1 -Action Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-ui-review.ps1 -Action Stop
```

关闭前会核验已记录的 PID、进程创建时间和执行文件，只结束本环境进程及其子进程。测试数据库、日志和代码保留。若 PID 被其他进程复用，脚本拒绝操作；不要绕过检查结束同号进程。只有部分评审进程仍运行时，先用本脚本 Stop，再 Start。

## 首次建立环境

本轮已完成，不需要再次执行。新工作区的首次准备方式：

```powershell
cd frontend
npm.cmd ci
cd ..
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-ui-review.ps1 -SeedDemo
```

启动器从 Git 公共目录定位主工作区，也可通过 `-SourceRoot` 明确指定。它只在当前 worktree 缺少 `backend/.env` 时复制主工作区连接配置；文件被 Git 忽略，不打印凭据。脚本清除调用进程可能遗留的 DB 环境变量，使用当前 worktree 的配置连接 PostgreSQL；结束后还原原进程环境变量。

脚本调用现有 `isolated_server.py` 的准备函数新建测试库、应用现有 schema/migration，然后将库名写入运行记录，再通过同一启动器复用该库启动服务。没有新增 migration，也不会初始化、迁移或重置主数据库。账号需具备创建数据库权限；已有 PostgreSQL 服务和 Python 依赖需可用。

`-SeedDemo` 仅在新空测试库使用：先检查 `/health` 的测试库标记与记录完全一致，再检查库存、菜品、搭配和菜单都为空，才调用现有 `seed_demo_data.py`，通过真实 API 注入一组验收场景。重复灌入、已有数据、服务标记不匹配时都拒绝写入；失败保留现场，不自动清空或重试。

本轮初始场景为 8 条库存、6 道菜、2 个搭配、5 条菜单，覆盖正常核对、待购买、库存不足、已完成和已取消。初始数量不是长期不变的保证，用户操作后以数据库为准。场景日期取初始化当天；跨天不会自动重写日期。

## 保护与故障处理

- 默认端口为 3018／5200；首次可用 `-BackendPort`、`-FrontendPort` 选空端口，建立后固定使用记录值。端口占用时拒绝启动，Vite 同时使用 `--strictPort`，不会偷偷换端口或结束占用者。
- 后端健康检查必须返回对应的 `X-Pantry-Nook-Test-Database`；前端 `/health` 经代理后也必须返回同一标记。标记不符立即停止本次新启动进程。
- Vite 通过 `PANTRY_API_PROXY_TARGET` 指向记录的后端；普通 `npm run dev` 默认仍代理到 3000。评审脚本显式设置 `VITE_API_BASE=/`，使现有客户端使用同源 `/api`，避免其他环境设置绕过评审代理。
- `.review/environment.json` 记录测试库名、端口、进程身份、是否灌入示例及日志路径，不保存数据库密码。不要删除该目录来“修复启动”，否则会丢失原评审库的关联信息。
- 启动失败先查看 `.review/*stderr.log` 与 `*stdout.log`。本脚本不自动删除数据库、重建数据、执行新增迁移或更新依赖。工作区或依赖路径被搬动时，先核对记录再处理。

## 本轮验证记录

2026-09-13，在此 worktree 执行：

- `npm ci` 按锁文件安装成功；没有升级或修改依赖锁文件。
- PowerShell 脚本语法检查通过；首次创建独立库、标记校验及真实 API seed 成功。
- 经 5200 代理读取健康标记和 8／6／2／5 条资源成功。
- 重复 Start 保持原进程与数据；Stop 后故意占用 5200，确认启动拒绝；释放端口后 Start 复用同一库和数据成功。
- 5186 原服务仍为原 PID，未被关闭。服务后台隐藏运行，测试完成后保留供主 agent 的浏览器验收。
- `tsc -p tsconfig.node.json --noEmit`、`git diff --check` 通过；确认 `.review/environment.json` 与 `backend/.env` 被 Git 忽略。

这里只记录环境和 Vite 配置验证。正式 UI 的 typecheck／lint／build、业务回归与桌面／移动浏览器验收由主 agent 根据本轮改动另外记录，不以本页替代。

2026-09-14 补充：任务中断后曾检测到评审进程均已退出；日志没有应用崩溃证据，退出来源不能确定。原启动命令不带 -SeedDemo 已复用同一库恢复。隐藏后台运行不保证抵御外部进程清理。
