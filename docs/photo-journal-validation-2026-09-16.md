# 饭桌手记本地实现与核验

2026-09-16，分支 `codex/photo-journal`。本轮是用户批准设计后的正式实现，不是线上发布；版本保持现有基线，未打 tag、合并或部署。用户体验验收尚未完成。

## 结果

- 正式前后端及 PostgreSQL 接通，包含上传状态、发布幂等、照片归属、日期/文字编辑、软删除和媒体读取。
- 照片原文件逐字节保存。预览与缩略图另生成；Apple 按真实标识配对，Pixel/三星提取原片内的视频，另外生成浏览器兼容副本。静态 JPG 不冒充实况。
- 独立 agent 实现前后端并只读审查；主任务整合并运行正式 API、浏览器、契约及回归。审查发现的“正常多选触发忙冲突”和“清理事务回滚暴露已删文件”均已修复。

## 已实际运行

| 验证 | 结果与证据 |
|---|---|
| 后端 | 23 项 unittest 通过，含无 Content-Length 超限、处理失败重试、文件转正后提交失败、过期 processing 恢复、清理第二项失败 |
| 前端 | 13 文件、116 测试通过；typecheck、lint、生产构建通过 |
| 契约 | 归档 OpenAPI 一致；原有 34/34 成功操作＋手记 6 个 JSON 操作实际响应验证；媒体使用实际字节验证 |
| 手记 API | Windows 与 Linux 各 13 组检查：原件 SHA、重复上传/发布、错配/缺片、并发归属、编辑冲突、月份分页、删除后 GET/HEAD/Range；`.review/journal-api-evidence.json`、`journal-linux-api-evidence.json` |
| 浏览器 | 一次选择 7 源文件（MOV 在 HEIC 前＋5 张照片）→6 张照片发布，无 429；真实动态播放、声音开关、切图停止、长按松手；编辑删除、全页拖入、单张 503 后重试、服务已提交但回包丢失后不重复发布 |
| 布局 | Chromium 1440×1000、834×1112、390×844，亮暗主题；无横向溢出、无页面运行异常；`.review/journal-browser/` |
| Docker/Nginx | `/pantry-nook/` 代理上传大于 1 MiB 的真实 HEIC/MOV；5 类资源匿名 GET/HEAD/Range 都 401，登录 200/200/206 且实际字节、MIME 正确；删除后条件请求也 404 |
| 正式构建浏览器 | 主任务经临时 Nginx 打开生产构建，实际加载子路径列表与照片、播放实况；匿名媒体 401、登录 Range 206，页面无加载错误或运行异常 |
| 容器重启 | 同一测试数据库、媒体卷、列表与 5 份媒体 SHA 均不变；`.review/docker-journal-test/evidence-proxy-restart.json` |
| migration | 空库快照、无登记旧快照、带历史旧库三种 12→13 升级及重复执行通过，旧业务记录不变；`.review/journal-migration-evidence.json` |
| 备份恢复 | 停止独立源服务后备份数据库＋6 个媒体文件，恢复到另一新库/目录；列表和原件 SHA 一致，删除媒体 GET/HEAD/Range 共 9 检查仍 404；`.review/journal-backup-restore-test/891e35a99cbb46bbac7cc2550d3f6485/evidence.json` |

网络故障只在浏览器测试中定向模拟一次上传 503、一次已提交响应丢失；其他接口与媒体处理均为真实后端。公开样本来源与许可边界沿用[样本记录](live-photo-transfer-and-samples-2026-09-16.md)，不把素材或用户照片加入 Git/生产 seed。

完整类生产预检必须绑定干净 Git commit。实现期间一次试跑的实际链路已通过，但被末尾未提交工作区检查拦截，**该次不计最终门禁通过**；最终提交后的结果以 `.review/release-preflight/evidence.json` 及其 commit 为准。该证据不构成部署授权。

## 待用户验收与边界

- iOS、iPadOS、安卓原生相册选择器、实际触摸/双指体验仍待真机验收。网页不能强制系统把苹果 Live Photo 的照片与 MOV 一起交付；可通过未修改原件双文件上传保留实况。
- 当前发布后可改日期和文字；不支持重新编排已发布照片、任意独立视频、ZIP、公开分享或餐安排关联。
- 软删除阻止后续 API 访问，但不会立即物理删除磁盘与备份。清理工具默认 dry-run，未登记孤立文件当前只人工核查，不自动删除。
- 后续发布必须同时持久化数据库与媒体卷，使用本轮[媒体运行门禁](photo-journal-operations.md)，不得搬运本地测试数据。
