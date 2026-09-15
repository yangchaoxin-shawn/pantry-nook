# Pantry Nook — 当前开发交接

更新：2026-09-15。主负责人：ChatGPT / Codex。项目由 Claude Code CLI 迁入。

## 从这里继续

1. [AGENTS.md](AGENTS.md)：稳定项目约定与读取顺序。
2. [项目状态](docs/project-status.md)：实现、验证、用户验收、当前授权及下一步。
3. [PRD](docs/PRD.md)：当前 MVP 各模块唯一业务规格。
4. [协作流程](docs/collaboration.md)：范围批准、增量验证、交付方式。
5. 涉及实现时再读对应代码、[API 契约](contracts/openapi.yaml) 和 [测试说明](backend/TESTING.md)。

## 当前阶段

用户已确认两轮 UI / UX 反馈，发布前门禁与公司服务器首次部署均已完成。线上使用 `/pantry-nook/` 子路径、项目级 Basic Auth、服务器本机 Nginx、Docker 后端与 PostgreSQL；首发为空库，此后线上数据按持久生产保护。首发后的静态资源 MIME、目录权限和 API 重写问题已修复，详见 [首次发布记录](docs/deployment-2026-09-15.md)。

后续开发使用 mock/test 数据；自动化与演示写入只允许新的端口和带标记隔离测试库。正式环境禁止 seed/reset/删卷。首个 MVP 版本号已批准为 `1.0.0`，`v1.0.0` tag 要等准确 commit 的制品重新部署并通过线上核验。每次发布先运行 `scripts/preflight-release.ps1`，再按 [部署执行文档](DEPLOY-SERVER.md) 和 deploy-company-server skill 执行；发布后运行真实链路核验并更新状态。

历史检查点 3893220、35f1dca 仅用于追溯；当前用户认可的 UI 检查点为 `8ff0ff3`，本地 MVP 候选代码检查点为 `bf17152`。最终状态以 [项目状态](docs/project-status.md) 为准。

## 设计与历史

WorkBuddy WB-V5-2026-09-09 / 设计系统 2.0 保留为视觉输入。
[设计资料](docs/frontend-design-handoff.md) 说明原稿背景；业务范围由当前 PRD 决定。
旧提案、审计和交付文档的分类见 [项目状态](docs/project-status.md)，不再要求每次任务全部重读。
启动使用 [README](README.md)，Git 使用 [约定](docs/git.md)，部署以 [DEPLOY-SERVER.md](DEPLOY-SERVER.md) 为唯一执行口径。
