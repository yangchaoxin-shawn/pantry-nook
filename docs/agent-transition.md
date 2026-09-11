# Claude Code CLI → 当前 Agent 协作适配

核查日期：2026-09-11。范围：本项目配置结构、Git worktree、入口文档与官方机制。
本轮没有运行 Claude CLI、修改其设置或读取用户目录的会话/登录内容。

## 本地核查结果

| 项目 | 查到的事实 | 本轮处理 |
|---|---|---|
| CLAUDE.md | 原为约束、命令、业务和协作的混合入口，有过期内容 | 改为导入 AGENTS.md 的薄入口 |
| CHATGPT_HANDOFF.md | 重复大量规则及旧测试结果 | 改为当前索引；进度集中在 project-status.md |
| .claude/settings.local.json | 顶层只有 permissions，含 19 条 allow；该文件未定义 hooks | 保留原文件；不打印/搬运具体许可内容 |
| .claude/worktrees/ | 存在 Git 登记的 agent-a7d978f01ae24758e，基于 dc2429b | 保留；其中有 4 个未跟踪 JSON 文件，不判断为垃圾 |
| 项目级 rules/commands/agents/skills、.mcp.json | 主工作区未发现相应项目文件；未扫描用户级配置 | 不编造待迁移机制，不假定机器上完全没有 |
| .codex/ 与 AGENTS.md | 本轮开始时主工作区没有 | 仅新增 AGENTS.md；未生成 .codex 配置 |

旧 worktree 仍可能含有用户工作，不删除、不合并；它不包含当前功能基线，后续开发以当前 main 的已确认提交为准。
这次适配是项目上下文和协作规则整理，不是 Claude 登录、权限、插件或会话的工具间迁移。

## 为什么使用两个入口、一套规则

Codex 的项目指令发现机制读取 AGENTS.md；Claude Code 读取 CLAUDE.md，并支持通过 @AGENTS.md 导入共享指令。
因此保留很短的 CLAUDE.md，将长期约定维护在 AGENTS.md，避免两套内容独立漂移。
Windows 使用文件导入，不创建需额外权限的符号链接。
这不改变项目负责人的归属，也与用户要求业务 API 不保留旧兼容名称无关。

官方依据：[Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)、
[Claude Code memory / AGENTS.md 导入](https://code.claude.com/docs/en/memory)。

## 权限与自动化不直接照搬

Claude 的 settings.local.json 属于个人本地设置，其 allow 规则不转换为 Codex 执行许可。
仓库说明只指导工作，不覆盖当前工具的沙箱、审批与用户授权机制。
若以后迁移 hooks、MCP 或自定义命令，先检查实际用途、输入/输出、作用域及副作用，再选择当前客户端支持的机制。
不手写猜测的 Codex 配置字段，不扩大权限来“优化效率”。

官方依据：[Claude Code 设置与作用域](https://code.claude.com/docs/en/settings)。

## 当前落地与后续

已落地：共享短入口、统一 PRD、模块进度表、验证分档、交付约定、历史资料分类。
后续候选：把稳定流程封装为 Skills；配置本地 Actions；建立代码/端口/数据库共同隔离的验收开发环境。
尚未配置上述候选，也没有启用自动任务、子 agent 或新插件。
Codex Local environments 可配置项目常用动作和 worktree 初始化，但应在后续批准后使用客户端支持的方式建立并验证。

官方依据：[Codex 本地环境](https://developers.openai.com/codex/app/local-environments)。
