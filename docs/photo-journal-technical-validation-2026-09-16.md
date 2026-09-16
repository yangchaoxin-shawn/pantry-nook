# 做饭影集：设计确认与技术验证

日期：2026-09-16。独立技术验证阶段，不是正式功能交付或发布。线上版本仍为 v1.1.0。

## 已确认方向

- 用户认可独立设计稿 02：延续食隅记视觉语言，以照片记录做饭，提供独立展示页、相册多选、拖入和大图浏览。
- 用户已确认外部浏览器能拖入；本次 Codex 内置浏览器未完成该操作，不推断所有内置浏览器均不支持。
- 保留网页实际收到的原文件，另存缩略图和展示图；无法还原系统交给网页之前已经压缩或转换的文件。
- 实况参考朋友圈：静态封面、明确标记、主动播放、默认静音。没有完整动态内容时不能伪造实况标记。
- 先调研并复用组件，再接入正式工程；设计稿不直接成为业务代码或数据模型。

设计稿位于 Codex visualizations 下的 `pantry-photo-journal-v1`，端口 5217；技术探针位于 Git 忽略的 `.review/photo-spike/`，前端 5218、后端 3057。技术探针不是新设计稿。测试照片、派生图、依赖和日志均未入库，未发送至第三方媒体服务，也未连接业务数据库。

## 选型

| 部分 | 已验证候选 | 判断与边界 |
|---|---|---|
| 上传 | Uppy Core 6.0.1 + XHR Upload 6.0.0，MIT | 复用队列、进度和单文件重试，自建外观；不引入完整 Dashboard 或第二套拖放库 |
| 大图 | PhotoSwipe 5.4.4，MIT | 复用切换、缩放、键盘关闭；必须使用展示图实际尺寸 |
| 图片 | Pillow 12.3.0、pillow-heif 1.7.0 | Windows/Linux Python 3.13 验证常见图片及合成 HEIC；原文件旁路保存，浏览副本去 EXIF。底层编解码器另有许可，正式引入时补齐依赖许可清单 |
| 动态 | 原生 video + PhotoSwipe 自定义内容 | 合成 MP4 播放通过；不代表真实实况识别、配对或上传已支持 |
| Apple 播放器 | LivePhotosKit JS | 不作为跨端主方案；它不能取得系统选择器未交出的资产。npm 1.5.6 变更记录止于 2019 年，使用 Apple 专有许可，不能当作活跃 MIT 通用播放器 |

探针独立锁定依赖，未升级正式项目。其 FastAPI 0.141.1 / Uvicorn 0.53.0 不代表与正式锁文件集成已通过。9 张、单文件 20 MB、并发 2 是实验参数，实况大小和时长上限未冻结。

## 实际检查

| 场景 | 证据与边界 |
|---|---|
| 授权 JPG | 5 张上传后下载逐字节及 SHA256 一致；脚本校验实际样本数量 |
| 合成 JPEG / PNG / WebP / HEIC | 原文件回读一致；派生 JPEG 正确 MIME、无 EXIF、最长边不超过 2560 |
| 方向 | JPEG / HEIC 合成方向 6 展示尺寸正确；不代表所有真机 HEIC / HDR 通过 |
| 超大图 | 后端 5000×3000 原图生成 2560×1536 展示图；图库改用展示尺寸并补大图交互检查 |
| 错误恢复 | 无效/超限文件返回 422 / 413，列表不出现半成品；一次真实 503 后单文件重试成功。探针按 SHA 去重，不作为正式记录幂等设计 |
| Linux Docker | 合成格式、方向、原文件及错误恢复通过；独立测试文件目录，无业务数据库 |
| 临时 Nginx | `/pantry-nook/` 上传、原图、展示图、缩略图匿名拒绝（含 GET/HEAD/Range）；登录后图片 MIME/正文正确、Range 206；缺图 JSON 404 |
| 重启 | Linux 后端重启后列表一致；仅验证文件探针，不等于数据库与媒体灾备演练 |
| 前端 | 多选、上传进度、单张重试、重复选择提醒、模拟 DataTransfer 拖入、刷新读取、大图切换/缩放/关闭及窄屏布局通过；模拟事件不等于系统拖放验收 |
| 实况 | 合成 MP4 在自定义图库内容中实播；真实 Apple/Android 实况及系统相册交付未验证 |

主负责人运行后端、Linux/Nginx 和浏览器检查，独立 agent 只读审查。两项审查发现已修正：样本数量证据不能硬写；缩小后的展示图不能套用原图尺寸。懒加载缩略图也补固有尺寸，避免图片未解码时占位高度为零。

本机入口均相对于 `.review/photo-spike/`：`backend/probe_checks.py`、`backend/check_linux.py`、`frontend/check-browser.mjs`。证据为 `backend/evidence-windows.json`、`backend/evidence-linux-auth.json`、`frontend/evidence/browser-results.json`。这些是本轮证据，不是永久 CI 证明；临时 Docker/Nginx 容器与网络已由脚本移除，保留测试证据，未调整原设计服务。

## 正式接入门禁

1. 按已确认设计冻结影集记录、媒体资产、上传状态与 API 契约，再做 migration、后端、前端。文件哈希不能直接作为一条做饭记录的身份。
2. 原件存独立持久目录/卷；数据库记录归属、校验值、派生文件与就绪状态。完整设计临时态、幂等、失败补偿、删除引用和异常清理；生产数据不 seed/reset。
3. 鉴权覆盖上传、列表、全部原件和派生资源。补请求体、处理并发、像素/时长/磁盘保护；当前 20 MB 检查发生在 multipart 解析后，仅证明文件层限额。区分坏文件与磁盘/服务异常，不能统一伪装为 422。
4. 数据库与媒体共同备份并演练恢复；按项目现有依赖基线接入并重新跑类生产门禁，不能使用试验镜像发布。视频鉴权尚未覆盖本轮图片鉴权检查。
5. Apple 核验原始照片与 MOV 的真实配对元数据，不凭同名或时间猜配；Android 验证嵌入视频实际内容与边界，不仅看 XMP 标记。兼容副本与原资产分开保存。
6. Windows、iPhone、iPad、Android 分别验收相册交付、动态播放、长按与滑动/缩放冲突、下载和断网重试。缺少真机证据时保持待验证。

需要补充至少一组同一张 iPhone Live Photo 的原始照片 + MOV，以及一份 Android 原始动态照片。微信转发图片、普通 JPG 或人工拼接的照片/视频不能替代。收到前可继续普通照片链路，实况真机结论保持待验证。

## 官方参考

- [Uppy 上传](https://uppy.io/docs/xhr-upload/)与[核心接口](https://uppy.io/docs/uppy/)。
- [PhotoSwipe 自定义内容](https://photoswipe.com/custom-content/)。
- [pillow-heif 方向处理](https://pillow-heif.readthedocs.io/en/latest/workaround-orientation.html)。
- [Apple LivePhotosKit JS](https://developer.apple.com/documentation/livephotoskitjs)、[1.5.6 许可](https://cdn.jsdelivr.net/npm/livephotoskit@1.5.6/LICENSE.md)、[变更记录](https://cdn.jsdelivr.net/npm/livephotoskit@1.5.6/CHANGELOG.md)。
- [Apple 实况元数据](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/livephotomoviemetadata)、[Android Motion Photo 格式](https://developer.android.com/media/platform/motion-photo-format)。
