# Pantry Nook — 当前开发交接

更新：2026-09-11。主负责人：ChatGPT / Codex。项目由 Claude Code CLI 迁入。

## 从这里继续

1. [AGENTS.md](AGENTS.md)：稳定项目约定与读取顺序。
2. [项目状态](docs/project-status.md)：实现、验证、用户验收、当前授权及下一步。
3. [PRD](docs/PRD.md)：当前 MVP 各模块唯一业务规格。
4. [协作流程](docs/collaboration.md)：范围批准、增量验证、交付方式。
5. 涉及实现时再读对应代码、[API 契约](contracts/openapi.yaml) 和 [测试说明](backend/TESTING.md)。

## 当前阶段

用户已开始反馈双人使用时的库存与核对问题；各模块仍待用户验收。
本轮批准并实施：备餐/核对不锁库存，最终确认做并发校验；核对窗口更新库存并保留输入，修复带单位初值。详见状态表。
后续每轮只推进已经批准的具体范围，不从旧的全面开发授权推导本轮可无限扩展。

代码基线为 3893220，测试数据脚本为 35f1dca。这些是已建立的历史检查点，不把它们写成未来一直有效的 HEAD。
数据脚本已用于本地测试库；数据会随用户测试变化，见状态表中的验收数据说明。

## 设计与历史

WorkBuddy WB-V5-2026-09-09 / 设计系统 2.0 保留为视觉输入。
[设计资料](docs/frontend-design-handoff.md) 说明原稿背景；业务范围由当前 PRD 决定。
旧提案、审计和交付文档的分类见 [项目状态](docs/project-status.md)，不再要求每次任务全部重读。
启动使用 [README](README.md)，Git 使用 [约定](docs/git.md)。Docker / Nginx 等待发布阶段再处理。
