# Git 与版本约定

更新：2026-09-15。主分支为 `main`；当前没有远程仓库，push、merge、远程发布仍需另行确定。

## 版本号

采用 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)：

| 变化 | 版本 | Pantry Nook 示例 |
|---|---|---|
| 修复兼容缺陷 | PATCH | `1.0.0 → 1.0.1`，修复显示或交互错误 |
| 向后兼容的新能力 | MINOR | `1.0.1 → 1.1.0`，增加统计或临期提醒 |
| 不兼容的业务/API/数据变化 | MAJOR | `1.x → 2.0.0`，删除旧 API 或改变核心规则 |
| 待验收候选 | 预发布 | `1.1.0-rc.1`；不代替正式版本 |

根目录 `VERSION` 是项目版本基线，以下位置必须一致：前端 package 与 lock、后端 pyproject、`backend/app/version.py`、归档 OpenAPI。运行：

```powershell
pwsh ./scripts/check-version.ps1
```

版本号、正式 tag 和 MAJOR/MINOR/PATCH 判断由用户确认。用户已确认首个 MVP 为 `1.0.0`、“汤料”兼容功能为 `1.1.0`，并于 2026-09-17 确认饭桌手记候选版为 `1.2.0`。`1.0.0` 与 `1.1.0` 已按发布门禁部署、核验和建立正式 tag；`1.2.0` 尚未部署或打 tag。

## Tag 与发布

- 正式 tag 使用不可变的 annotated tag：`v<版本>`，例如 `v1.0.0`。
- 只有准确 commit 的同一制品完成部署和线上验证后才创建 tag；历史部署无法证明对应 commit 时不补造 tag。
- tag 记录产品版本；每次服务器操作另有唯一 `RELEASE_ID=<version>-<UTC timestamp>-<short sha>`。同一版本的重新部署可以有多个 release id，但不能移动 tag。
- 数据库 migration 版本独立递增，不用产品版本号替代 migration 顺序。
- 不自动 push、merge、tag 或部署。`v1.0.0` 与 `v1.1.0` 均绑定各自正式部署 commit 并完成线上核验；后续版本仍须逐次取得用户批准并遵循相同门禁。

## 提交

采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/)，中文说明具体行为：

```text
fix(frontend): 批量录入忽略未填写的空白行
feat(menu): 补货后自动关联同名食材
chore(release): 准备 1.0.0
docs: 统一协作和部署入口
```

常用类型：`feat`、`fix`、`refactor`、`test`、`docs`、`chore`、`ci`。不兼容变化在类型后加 `!`，并在正文写 `BREAKING CHANGE:`。常用 scope：`backend`、`frontend`、`db`、`menu`、`deploy`、`release`。

同一行为的代码、API、必要测试和文档放在一个可审查提交中。只 stage 本轮范围，不提交 `.env`、测试数据、数据库备份、构建产物、日志和个人配置。

## 自动提交门禁

用户已授权 Codex 在以下条件全部满足时建立本地提交，无需逐次确认：

1. 改动属于已经批准的范围，没有新增业务取舍、部署、线上写入或数据清理。
2. `git diff` 已复核，未混入用户改动、secret、测试数据、生成垃圾或个人配置。
3. 按 [协作流程](collaboration.md) 完成适用验证；失败和未覆盖项不会被提交成功掩盖。
4. 跨前后端、数据库、共享配置、部署或数据保护的改动已由独立 agent 只读审查，主负责人处理结论并完成最终门禁。
5. 提交可以独立回退，消息准确描述最终行为。

自动提交授权不包含 push、merge、tag、部署、清空数据或修改生产 secret。

## 分支与基线

小范围已批准改动可提交 `main`；较大功能默认使用 `codex/<任务名>`，沿用用户明确指定的分支。`main` 是本地稳定候选，不代表已经部署或全部用户验收通过。

用户正在验收时，不在同一运行目录触发热更新；隔离开发必须同时隔离代码、端口和数据库。`.claude/worktrees/` 是历史工作区，不能未经检查清理、强制重置或合并。

提交前核对 `git status`、适用检查和当前候选；没有新改动或新风险时不重复无意义的全量测试。

## 排除与保护

`.env`、数据库备份、用户上传、依赖、构建产物、日志及个人 Claude/Codex 配置不进 Git。`.claude/settings.local.json`、`CLAUDE.local.md`、`.claude/worktrees/` 由仓库 `.gitignore` 排除，不把个人权限配置改写成项目规则。
