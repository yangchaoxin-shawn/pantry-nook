# 桌面工作区与开发交接

更新：2026-09-23。当前进度统一见 [项目状态](project-status.md)，业务规格见 [PRD](PRD.md)。

## 接手入口

固定目录：`C:/Users/yangchaoxin/Desktop/pantry-nook`。Claude Desktop 的 Code 会话选择这个本地目录；单人接续开发优先直接在目录工作。若启用 worktree，阶段交付须核对桌面改动后安全接回，并在桌面运行最终基线检查。以后交给 Codex 时也遵守这一点。

先读根目录 `CLAUDE.md`（导入 `AGENTS.md`）、本页及状态页；然后按任务读取 PRD、项目结构、Git 约定和 backend/TESTING.md。无需重读所有历史报告。

2026-09-23 代码接回基线为 `54be232725101cfe66ed4ee258d16996913162e9`，包含已发布 `41c75ac4b0eefdd850bb2ec8e12b974e61a13f9b`。本次文档提交后，由交付消息给出新的准确 SHA；不可用 `-ExpectedRef HEAD` 自证。

```powershell
pwsh ./scripts/check-handoff.ps1 -ExpectedRef <交付消息中的准确SHA> -DeployedRef 41c75ac4b0eefdd850bb2ec8e12b974e61a13f9b
```

旧桌面分支及其他 worktree 保留，不作为默认开发入口；不删除其个人配置或未跟踪文件。依赖、环境文件与服务状态不随 Git 提交自动同步；首次启动核对 README 和测试说明，确认指向独立测试库。当前没有配置远程仓库。

## 下一项：OCR

用户希望由 Claude 完整接手开发 OCR，但尚未确认识别购物小票、截图还是包装文字，以及提取字段、识别服务和成本。先结合现有录入流程与用户确定最小范围。

可供讨论的方案是“图片识别 → 可编辑草稿 → 人工核对 → 确认入库”，仅为建议，未作为已确认需求写入 PRD。若采用，复用现有同名冲突、单位校验和整批事务规则。开发工具所用外接 API 与产品 OCR 服务是两项独立配置，不默认共享密钥或服务商。

## 工具和外接 API

官方资料核查于 2026-09-23：Claude Desktop on 3P 支持配置推理供应商/兼容网关，包含 Code，可在已配置凭据时跳过 Anthropic 登录。具体客户端版本、供应商协议和工具调用能力仍需现场验证；本轮未配置凭据或验证请求。

- [Claude Desktop 第三方模式](https://claude.com/docs/third-party/claude-desktop/overview)
- [Desktop 功能与 worktree](https://code.claude.com/docs/en/desktop)
- [连接网关](https://code.claude.com/docs/en/llm-gateway-connect)

桌面版使用自己的第三方推理配置，不直接沿用 CLI 的 `ANTHROPIC_BASE_URL` 或 `settings.json` 网关配置。官方本机入口为 Help → Troubleshooting → Enable Developer Mode，重启后 Developer → Configure Third-Party Inference。启用网关后仅支持本机会话，不提供该模式下的 SSH、云端会话或 Remote Control；按实际客户端版本核对。

API 密钥放客户端支持的本机秘密配置，不写进 Git、交接页或对话。先验证读取项目、编辑测试文件和运行命令等基本能力，再投入 OCR 开发；测试写入只使用隔离数据。

## 再次切换开发工具

交出方留下桌面准确提交、工作区未提交事项、实际验证、当前评审入口、下一步和未决问题。接收方核对这些事实再工作；聊天历史和工具私有记忆不作为唯一交接来源。同一工作区保持一个主要写入会话。

版本、tag、部署和数据操作继续遵循原授权范围。Git 自动提交授权按 docs/git.md 执行；不因切换工具扩大权限。
