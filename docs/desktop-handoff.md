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

## 本轮交付：拍小票入库（OCR，待用户验收）

2026-09-23 Claude 完成"拍小票入库"开发并接回桌面；规格见 [PRD](PRD.md#拍小票入库ocr)，准确提交以交付消息为准。

- 场景已经用户确认：购物小票照片 → 本地识别 → 可编辑草稿 → 人工核对 → 既有批量入库。识别用 PP-OCRv6（paddleocr 3.7.0 自部署，无密钥、图片不出本机）；pip 发行版当前只内置 medium 档模型。
- 结构：`ocr/` 独立侧车（启动命令见 `ocr/README.md`，默认 127.0.0.1:9610，Windows CPU 需 `PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT=false`）+ backend `/api/ocr/receipts` 转发与行解析 + 库存页入口与草稿核对。
- 已验证（agent 层面，非用户验收）：后端单测 58、前端 typecheck/lint/测试 133、成功契约 36/36（含 OCR）、OpenAPI 归档一致、真实合成小票识别与浏览器端到端走查（`backend/scripts/ocr_browser_walkthrough.py`）。CPU 识别单张约 15–40 秒。
- 未做（超出本轮批准范围）：生产部署侧车、OCR 历史与图片持久化、多张小票合并、菜谱/包装识别；首次真实小票样张验收由用户提供照片后进行。

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
