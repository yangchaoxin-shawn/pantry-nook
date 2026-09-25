# Pantry Nook — Claude Code 入口

@AGENTS.md

本项目由用户在 Claude Code 与 Codex 之间切换开发负责人。共享项目约定通过上面的导入读取，不在此维护第二份规则。

- 当前阶段见 [项目状态](docs/project-status.md)；业务见 [PRD](docs/PRD.md)。
- .claude/settings.local.json 是 Claude 本机权限配置，不作为 Codex 权限配置迁移。
- .claude/worktrees/ 中仍有旧 worktree 和未跟踪文件；不能作为当前开发起点，也不能未经授权清理。
- 固定工作目录为 `C:/Users/yangchaoxin/Desktop/pantry-nook`；先读 [本次交接](docs/desktop-handoff.md)，再按状态页读取相关规格。
- 不改用户目录的登录、会话或工具配置；API 密钥不写入项目文档或 Git。Claude 在用户目录下的本项目记忆已获用户同意（2026-09-26）按记忆机制维护：发现过时即更新，不动其他工具的记忆。
- 工具机制核查及官方依据见 [Agent 迁移说明](docs/agent-transition.md)。
