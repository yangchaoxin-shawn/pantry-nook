# 饭桌手记照片整理验证

2026-09-16。用户批准设计 04 后，在 `codex/journal-photo-edit` 基于 `b036458` 实现。设计已验收；本轮正式代码完成 Agent 技术核验，待用户体验。仅本地，无版本调整、tag、合并或部署。

## 当前结果

| 检查 | 本轮实际结果 |
|---|---|
| 后端单测与归档契约 | 根任务运行 27 项通过 |
| 前端逻辑 | 根任务运行 14 文件、126 项通过；包含同文件重选、撤销与封面、重复实况及失败重试 |
| 类型、lint、生产构建 | 通过；lint 无警告，未升级依赖 |
| 增量 migration | 4 个独立库通过：快照空库、旧快照无历史、有历史、013 含照片升级 014；重复迁移安全，业务指纹不变、历史封面正确回填 |
| 真实接口 | Windows 新编辑 10 组；Linux Docker 编辑 10 组和首轮实况/契约 13 组均通过；Linux 两组由根任务亲跑 |
| 浏览器 | 根任务运行 9 组通过；上传/编辑使用真实 API，显式故障注入仅上传 503、提交成功后断开回包、其他设备修改引发 409 |
| 布局 | 1—9 张分别核验 1440×1000、834×1112、390×844；暗色及整理面板；所有照片渲染，无横向溢出；检查截图 |
| 独立审查 | 专属只读 agent 审查通过，无未解决 P1/P2；结论不代替根任务门禁 |

真实 API 覆盖完整照片集合事务、合法封面、归属冲突、9/10 张、真实 Apple 配对、Pixel/三星内嵌实况、原件字节、重复编辑与并发。使用测试库临时触发器在照片归属已变更后抛错，确认照片/版本/编辑记录全部回滚。已移除媒体 GET/HEAD/Range 均拒绝，实体原件仍保留；Linux 专项另核对 16 份原件 SHA256。

浏览器覆盖超额确认前零上传/默认不选、文档与伪装 JPG 拒绝、点击封面不跳位、× 不误选封面、撤销不抢新封面、替换失败与取消保护、同文件重新选、编辑回包丢失重试、已有 7 张再加 5 张选 2 张、零照片禁存、拖入、版本冲突保留草稿、Apple 整组移除/撤销及真实播放。共享 Dialog 的 input.cancel 冒泡缺陷已修复，手记和菜品的 Escape 行为均实际复验。

## 环境与证据

- 新工作区：`C:\Users\yangchaoxin\.codex\worktrees\journal-photo-edit\pantry-nook`。
- 自动浏览器使用 5223/3067 与 `pantry_nook_test_010720b31d0f4544b4b2f566a388f256`；完成后保留该库，3067 重新启动为全新人工体验库，不 reset/删除测试历史。
- 人工入口：5223，后端 3067；4 篇明确标为测试的手记（3、9、1 张授权 JPG，以及公开实况样本），实际新库标记和条目记录在 `.review/review-data.json`。
- Linux 专项：`pantry-journal-edit-test-backend`，18018，专用媒体卷 `pantry-journal-edit-test-media` 与独立 UUID 测试库。旧 18016/18017、5220/3060、5222 不修改。
- 证据均在忽略目录：`.review/journal-editor-browser/evidence.json`、截图、`journal-edit-api-evidence.json`、`journal-edit-linux-api-evidence.json`、`journal-edit-root-linux.json`、`journal-api-current-linux.json`、`journal-migration-evidence.json`。
- 完整子路径/鉴权 Docker 预检以提交后的 `.review/release-preflight/evidence.json` 为准；该文件绑定准确 Git commit、镜像与构建树校验值，历史预检不能替代它。

## 真实边界

- Windows Chromium 浏览器与 Linux 解码已验证；没有把模拟宽度当作 iOS、iPadOS、安卓原生相册和触摸手势验收。
- 浏览器不能直接解码 HEIC 时，上传前超额候选显示文件名占位；确认上传并由后端整理后有预览。此设计保留“确认前零上传”，未额外引入客户端解码依赖。
- 系统只保留收到的原件；已被微信转为普通 JPG 的实况无法恢复。
- 本轮不触及生产数据。发布仍需后续批准以及生产备份、同制品部署和实际链路核验。
