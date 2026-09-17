# 饭桌手记实现范围与接口约定

用户已批准取消所有平台实况能力。当前规格统一静态照片；此前实况验证报告只作为历史证据。开发、部署和验收状态统一见 [项目状态](project-status.md)，本文件仅维护实现约定。

## 使用与资源边界

独立手记页面按月份和日期倒序展示；每篇日期、最多 2000 字可选文字、1–9 张照片。支持相册多选、桌面拖入、逐张上传进度与重试、增删替换、点击照片选封面、草稿移除撤销、大图浏览与缩放。不同张数和横竖比例的展示排版保持。

接受 JPEG/PNG/WebP/HEIC/HEIF，支持 JPEG 中的 MPO 静态主图。Apple 相册图片直接作为普通照片；安卓图片即使内嵌动态数据，也只生成静态预览，收到的原文件字节完整保留。无实况配对、缺视频提示、MOV 补传或播放器。独立 MOV/MP4、文档、压缩包、伪装图片拒绝。

每个源文件最多 50 MiB、单图最多 6000 万像素、请求体最多 52 MiB；每篇最多 9 个图片资源。超额先挑选、确认后才上传；前端顺序上传，后端进程解码有超时及存储余量保护。Pillow/pillow-heif 处理静态图片，无 FFmpeg/ExifTool 运行依赖。展示副本做旋转与颜色处理，原件不重新编码。

## 持久化与旧记录

PostgreSQL 保存记录、上传状态、资源归属、校验值和照片顺序；媒体放 `MEDIA_ROOT` 独立目录。临时上传 → 校验/生成预览 → 文件转正 → 数据库 ready → 发布记录短事务。源文件名不参与磁盘路径；处理期间不占用数据库长事务。

新记录只接收图片。旧记录已有的图片仍按原顺序展示，封面可改，照片可替换或移除；历史视频行的状态、归属、详情和文件保持，不将它们转成会被过期清理的无归属资源。历史视频不能经媒体 API 获取，旧 motion 派生入口不再提供。无删列、删行或删卷 migration。

上传与发布各有幂等标识，照片编辑有版本校验与幂等回放；失败全部回滚。同一上传不可并发绑定多篇记录。删除记录为软删除，立即拒绝媒体读取，不物理删除文件。数据库和媒体必须一起备份，普通发布不执行物理清理。

## API（成功为 data envelope）

- `POST /api/journal/uploads`：multipart `file`，`X-Upload-ID` UUID；首次 201，重放 200。真实图片扩展名/解码内容校验。
- `DELETE /api/journal/uploads/{uuid}`：仅取消未绑定上传，已绑定 409。
- `GET/HEAD /api/journal/media/{uuid}/{variant}`：variant=`original|preview|thumbnail`；实际 MIME/字节/Range，未授权或无效资源拒绝，不回 SPA。
- `GET /api/journal/entries?limit=20&offset=0&month=YYYY-MM`：月份可省略，按日期和 ID 倒序，meta 为 total/limit/offset。
- `POST /api/journal/entries`：日期、文字、1–9 个 `upload_ids`、可选 `cover_upload_id`、`client_request_id`；不传封面默认第一张。
- `PATCH /api/journal/entries/{id}`：日期/文字/`expected_updated_at`；编辑照片还须完整传 `upload_ids`、`cover_upload_id`、`client_request_id`。
- `DELETE /api/journal/entries/{id}`：确认后软删除。

UploadedAsset：`{id, kind:'image', original_name, original_size, sha256, width, height, preview_width, preview_height, preview_url, thumbnail_url, original_url}`。三个 URL 均为图片地址。

JournalPhoto：`{id: image.id, image: UploadedAsset}`。Entry 保留 `id, entry_date, caption, created_at, updated_at, cover_upload_id, photos`。所有媒体路径统一拼接配置的 API base，支持 `/pantry-nook/` 子路径。

旧本地实况 API 的 `live_kind/pair_identifier/video_url/motion/live_status` 字段不属于当前契约；前后端按同一候选版本验证，不将旧实验前端指向新后端。

## 验证

参照 [测试说明](../backend/TESTING.md)：静态原件与预览、Apple/Android/MPO 图片、独立与伪装视频拒绝、历史实况转静态读取/编辑但文件保留、照片整理失败恢复、9 张边界、不同尺寸排版和真实 API 契约。真机体验由用户验收，桌面模拟不作替代。
