# 饭桌手记实现范围与接口约定

2026-09-16，用户已批准按设计进入下一阶段。独立分支 `codex/photo-journal`；不部署、不改线上数据、不更改版本号。本轮获批照片整理在 `codex/journal-photo-edit` 继续实现，详细交互见[照片整理约定](photo-journal-editor.md)，结果另记状态。

## 本轮范围

独立「手记」页面按月份倒序展示做饭记录；每篇日期、一段可选文字、1–9 张照片。上传支持相册选择、桌面拖入、多文件队列、进度与单张重试，初次默认第一张为封面，可点击缩略图切换。可编辑照片集合/封面/日期/文字、删除记录（明确确认），点击照片浏览、缩放；真实实况显示标记、默认静音、按钮或长按播放。原文件单独保留并可下载，展示副本不是原文件。

支持 JPEG/PNG/WebP/HEIC、Apple 照片+MOV 配对、已验证标准及 ExifTool 支持的 Android 内嵌视频。实况仅凭真实配对元数据/可解码的视频判断。苹果只传图片时明确显示「缺少动态片段」，允许保存静图；单独视频或错配视频不可冒充实况。普通任意视频发布、餐安排关联、公开分享、ZIP 导入不进入本轮。

初始服务端上限：每个源文件 50 MiB、单图 6000 万像素、实况视频 15 秒/长边 4096；每次只处理一个资源，前端顺序上传（并发 1），上传接口请求体上限 52 MiB。每篇最多 18 个源文件（配对后最多 9 张照片）。可配置存储余量保护，错误要向用户说明；不凭客户端校验兜底。

## 持久化与流程

PostgreSQL 保存记录、上传状态、资源归属、校验值、配对元数据和照片顺序；媒体放 `MEDIA_ROOT` 独立目录。临时上传 → 校验/派生 → 文件就绪 → 数据库 ready → 发布记录短事务；处理期间不占用数据库长事务。失败保留可重试语义；未就绪资源不可发布。源文件名不参与磁盘路径，只使用服务器生成的 UUID。

超额选择先挑选再上传；文件扩展名和解码内容必须一致，文档、伪装文件、普通独立视频不可加入。编辑取消不动原记录；增删替换与封面在同一短事务保存，失败全部回滚。

上传以客户端随机 UUID 保证重试幂等，同键不同文件必须冲突；发布以 client_request_id 防止重复记录。删除记录后全部关联媒体不可访问；不立即物理删原件，配套清理工具默认只预览、只处理明确无引用且过期的资源。备份须同时包含数据库和媒体目录。GET/HEAD/Range 均经应用资源状态检查及已有 Nginx 项目鉴权，不能建立公开静态旁路。

## API 冻结（成功仍是 data envelope）

- `POST /api/journal/uploads`：multipart `file`；必填头 `X-Upload-ID` UUID。返回 UploadedAsset，首次 201、幂等重放 200。处理忙可返回 409/429，失败可单文件重试。
- `DELETE /api/journal/uploads/{uuid}`：仅取消未绑定的上传；已绑定返回 409。
- `GET /api/journal/media/{uuid}/{variant}`：GET/HEAD；variant=`original|preview|thumbnail|motion`。返回实际文件/MIME/Range；不存在或已删除返回真实 404，不能返回 SPA。
- `GET /api/journal/entries?limit=20&offset=0&month=YYYY-MM`：month 可省略；返回 Entry[]，meta `{total,limit,offset}`，按 entry_date、id 倒序。
- `POST /api/journal/entries`：`{entry_date: YYYY-MM-DD, caption: string, upload_ids: UUID[], cover_upload_id?: UUID, client_request_id: UUID}`；caption 最多 2000 字；首次201，重复请求返回原条目而不再发布。
- `PATCH /api/journal/entries/{id}`：`{entry_date,caption,expected_updated_at}`；照片编辑还必须完整发送 `upload_ids,cover_upload_id,client_request_id`，版本过期409；同一编辑结果未被后续修改时支持幂等重试。
- `DELETE /api/journal/entries/{id}`：删除前确认，软删除并阻止其资源继续被读取。

UploadedAsset：`{id: UUID, kind: image|video, live_kind: still|apple_photo|apple_video|motion_photo, pair_identifier: string|null, original_name: string, original_size: number, sha256: string, width: number, height: number, preview_width: number, preview_height: number, preview_url: string|null, thumbnail_url: string|null, original_url: string, video_url: string|null}`。

Entry：`{id: number, entry_date: string, caption: string, created_at: string, updated_at: string, cover_upload_id: UUID, photos: JournalPhoto[]}`。

JournalPhoto：`{id: UUID（image.id）, image: UploadedAsset, motion: UploadedAsset|null, live_status: still|live|missing_video, video_url: string|null}`。安卓内嵌实况的 motion=null，video_url 指向 image 的兼容视频；苹果配对指向视频资源的兼容视频。前端必须按实际 preview 宽高展示，所有媒体 URL 统一拼接已配置 API base，适配 `/pantry-nook/`。

## 验收

增量 migration 和空库、原件回读、真样本 Apple 标识配对/错配/缺视频、Android 视频实际存在、残留标志负例、损坏/超限、幂等与重复发布、删除后 GET/HEAD/Range 拒绝、并发发布冲突、图片与视频鉴权、重启及数据库+媒体备份恢复；真实 API 浏览器多选/拖入/重试/编辑/删除/分页、亮暗主题和三档屏宽。用户设备原生选择器仍需真机验收，自动化不能代替。
