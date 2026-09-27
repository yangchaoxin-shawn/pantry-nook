# 桌面工作区与开发交接

更新：2026-09-27。当前进度统一见 [项目状态](project-status.md)，业务规格见 [PRD](PRD.md)。

## 接手入口

固定目录：`C:/Users/yangchaoxin/Desktop/pantry-nook`，检出唯一开发主线 `main`。Claude Desktop 的 Code 会话选择这个目录并开启 worktree：app 从 `main` 切出 `claude/<名字>` 分支，开工先运行 `scripts/prepare-worktree.ps1`，交付时在桌面把 `main` 快进到会话分支并运行交接检查，流程见 [Git 约定](git.md#分支与基线)。以后交给 Codex 时同样以 `main` 为准。

先读根目录 `CLAUDE.md`（导入 `AGENTS.md`）、本页及状态页；然后按任务读取 PRD、项目结构、Git 约定和 backend/TESTING.md。无需重读所有历史报告。

2026-09-23 代码接回基线为 `54be232725101cfe66ed4ee258d16996913162e9`，包含已发布 `41c75ac4b0eefdd850bb2ec8e12b974e61a13f9b`。**2026-09-27 代码交付锚点为 `39b55b5`（拍小票入库 + OCR 部署件 + 1.4.0 版本号；线上仍为 `v1.3.0`，1.4.0 未发布、无 tag）**，其后的文档提交以交付消息给出的最终 SHA 为准；核对用 `-AllowDescendant` 放行文档提交，不可用 `-ExpectedRef HEAD` 自证。

```powershell
pwsh ./scripts/check-handoff.ps1 -ExpectedRef 39b55b5 -AllowDescendant -DeployedRef 41c75ac4b0eefdd850bb2ec8e12b974e61a13f9b
```

本机只有 Windows PowerShell 5.1、没有 `pwsh` 时，用 `powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/check-handoff.ps1`，参数相同；`-ExecutionPolicy Bypass` 只作用于这一次进程，不改系统设置。

旧桌面分支及其他 worktree 保留，不作为默认开发入口；不删除其个人配置或未跟踪文件。依赖、环境文件与服务状态不随 Git 提交自动同步；首次启动核对 README 和测试说明，确认指向独立测试库。当前没有配置远程仓库。

## 拍小票入库（OCR）：用户已验收（2026-09-26）；服务器部署暂停（2026-09-27）

2026-09-23 起 Claude 开发"拍小票入库"，按用户试用反馈分多次接回桌面；规格见 [PRD](PRD.md#拍小票入库ocr)，准确提交以交付消息为准。**用户已于 2026-09-26 确认模块可用；v1.4.0 服务器部署经首装演练评估后由用户决定暂停（现有服务器内存承载不了 OCR 峰值，已完整回退、线上保持 v1.3.0），暂停原因与重启条件见 [服务器执行文档](../DEPLOY-SERVER.md) 1b 节。**

- 场景已经用户确认：购物小票照片 → 本地识别 → 第一轮确认识别结果（删行、名称、分类）→ 第二轮核对数量说法与存放位置 → 既有批量入库。识别用 PP-OCRv6（paddleocr 3.7.0 自部署，无密钥、图片不出本机）；pip 发行版当前只内置 medium 档模型。
- 已实现：长票可分段多拍、一次多选，累加成一个草稿，自动缝合跨张切开的商品、自动合并拍照重复（名称数量金额完全一致）并把数量不同的同名行聚合成组供一键保留；分类与存放位置按食材习惯库自动预填，用户改过的结果随食材入库，持续覆盖内置词表与默认位置；第二轮可勾选多行统一设置位置。界面不展示金额。
- 结构：`ocr/` 独立侧车（启动命令见 `ocr/README.md`，默认 127.0.0.1:9610，Windows CPU 需 `PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT=false`）+ backend `/api/ocr/receipts` 转发与行解析、`/api/ocr/ingredient-habits` 食材习惯库 + 库存页入口与两轮核对。
- 已验证（最终模块状态 `f7562f6`，2026-09-26）：后端单测 90、前端测试 187（typecheck/lint/build 均过）、成功响应契约 37/37；位置习惯走查（识别存根、新建隔离库）30 项通过，含第二轮 1280/390/320px 宽度下的行布局检查；真实小票识别与两段多拍走查此前通过。CPU 识别单张约 15–160 秒（密集中文整张实测约 160 秒，backend 超时默认 300 秒）；Linux 容器实测密小票 22–25 秒（见 DEPLOY-SERVER 1b）。
- 评审入口：用户在 `http://127.0.0.1:5217` 试用（专用评审 worktree `.claude/worktrees/ocr-receipts`，后端 3047 隔离测试库、侧车 9610）；2026-09-26 经用户同意切到最新交付提交，3047 复用原隔离测试库，数据保留。这是临时本机服务，复用前先确认进程、代码与数据库标记。用户已验收（2026-09-26）。
- 未做（超出本轮批准范围或已暂停）：生产部署侧车（部署件已就绪，暂停原因与重启条件见 DEPLOY-SERVER 1b）、条码→名称学习库（用户已明确留作下一轮）、OCR 历史与图片持久化、菜谱/包装识别。

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
