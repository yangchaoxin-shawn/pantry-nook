# Pantry Nook — 当前开发交接

更新：2026-09-14。主负责人：ChatGPT / Codex。项目由 Claude Code CLI 迁入。

## 从这里继续

1. [AGENTS.md](AGENTS.md)：稳定项目约定与读取顺序。
2. [项目状态](docs/project-status.md)：实现、验证、用户验收、当前授权及下一步。
3. [PRD](docs/PRD.md)：当前 MVP 各模块唯一业务规格。
4. [协作流程](docs/collaboration.md)：范围批准、增量验证、交付方式。
5. 涉及实现时再读对应代码、[API 契约](contracts/openapi.yaml) 和 [测试说明](backend/TESTING.md)。

## 当前阶段

用户已确认 `8ff0ff3` 对应的 UI / UX 反馈与第一轮正式视觉融合通过，当前进入 **本地 MVP 候选版收口**。候选收口只补同版本验证、可重复检查与冻结前小缺口，不增加新业务或改变已确认视觉方向。详见 [候选版记录](docs/local-mvp-candidate-2026-09-14.md)。

5201 / 3019 及其隔离测试数据仍作为用户刚完成的评审现场保留，不重启、不清空。候选自动化使用新的端口和全新测试库；Docker、Nginx、公开分享及生产部署仍需进入发布阶段后单独处理。

历史检查点 3893220、35f1dca 仅用于追溯；当前用户认可的 UI 检查点为 `8ff0ff3`，本地 MVP 候选代码检查点为 `bf17152`。最终状态以 [项目状态](docs/project-status.md) 为准。

## 设计与历史

WorkBuddy WB-V5-2026-09-09 / 设计系统 2.0 保留为视觉输入。
[设计资料](docs/frontend-design-handoff.md) 说明原稿背景；业务范围由当前 PRD 决定。
旧提案、审计和交付文档的分类见 [项目状态](docs/project-status.md)，不再要求每次任务全部重读。
启动使用 [README](README.md)，Git 使用 [约定](docs/git.md)。Docker / Nginx 等待发布阶段再处理。
