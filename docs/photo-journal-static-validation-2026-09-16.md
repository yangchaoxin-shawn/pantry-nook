# 静态照片调整与验证

用户批准：所有设备取消实况，只上传与展示静态照片；保留相册/拖入、原件画质、照片编辑与封面、最多9张及排版。原有用户记录和文件保留。基线 `46b8509`，工作区 `C:\Users\yangchaoxin\.codex\worktrees\journal-static\pantry-nook`，分支 `codex/journal-static`。

## 最终行为

- JPEG/MPO、PNG、WebP、HEIC/HEIF 直接作为图片上传；Apple 相册图片不提示缺视频，Android 动态图片只生成静态预览，原文件字节保留。
- 独立及伪装 MOV/MP4 拒绝；移除实况入口、配对、动态提取/转码、视频播放与下载。Docker 也去掉 FFmpeg/ExifTool，锁定的图片依赖不变。
- API 去掉实况字段和 motion 媒体 variant，照片集合上限9，OpenAPI和前端生成类型同步。
- 旧实况的图片可编辑、切封面和替换；历史视频完整数据库行及文件保持，媒体API拒绝读取。没有删库、删行、删卷或破坏性migration；用户原评审库完全未写入。
- 更新PRD、编辑规格、实现/运维/测试说明；旧实况浏览器脚本移除，历史报告保留但不作为当前规格。

## 本轮实际核验

| 检查 | 实际结果 |
|---|---|
| 主负责人 Windows 后端手记测试 | 21项通过，设置真实公开样本目录，无跳过；含MPO、JPEG/PNG/WebP/HEIF、伪装文件拒绝、原件字节 |
| 主负责人契约 | 4项契约测试通过，OpenAPI归档一致 |
| 主负责人前端 | API类型重新生成，typecheck、lint、13项手记测试、生产构建通过 |
| 主负责人真实API | 13组通过：静态Apple/Android、视频拒绝、原件回读、幂等/并发、资源访问和全部手记JSON成功操作契约 |
| 主负责人编辑API | 10组通过：封面/顺序/9张、资源归属、版本/幂等、事务故障回滚；构造旧记录后编辑/替换/软删除，旧视频整行、照片原件及视频原件/派生字节不变 |
| 主负责人浏览器 | 9组通过：超额先选、换封面、替换503/取消/重试、丢回包幂等、撤销、1–9张三档布局、暗色、静态Apple/Android照片、无视频控制、拒MOV、拖入、冲突和弹窗；无页面运行异常 |
| 实现agent Linux Docker | 镜像 `pantry-nook-backend:journal-static-test`；只读无网络容器5项媒体测试、4项实际处理子进程检查通过，原件哈希与worker一致，无FFmpeg/ExifTool/FFprobe |
| 独立交叉审查 | 前端agent审后端旧数据/契约保护，后端agent审前端静态流程，未发现阻断；主负责人亲跑上述最终门禁 |

测试命令见 [backend/TESTING.md](../backend/TESTING.md)。公开素材通过 `JOURNAL_REAL_MEDIA_SAMPLES` 指定；真实API/浏览器写入脚本必须显式指定当前独立地址和预期数据库。串行运行上传脚本，避免混入媒体并发忙碌测试。

证据均在Git忽略的 `.review/`：`static-api.json`、`static-edit-api.json`、`journal-editor-browser/evidence.json`及截图、`linux-static-media.log`。未把素材、日志、个人配置或数据库写进Git。

## 用户评审入口与保留环境

- 自动化：5230/3073，测试库 `pantry_nook_test_e95ff4920e9d4e95ab78dd149529554e`，与用户评审分开。
- 人工评审：`http://10.207.141.99:5231/` → 3074，空测试库 `pantry_nook_test_3f23818f53244b2a8e95a9ffdcdf2351` 和独立媒体。已核验健康双标记、列表空状态JSON；开始交付后不运行自动写入。
- 原用户环境 5223/5224/3067、Apple修复环境5226/5227/3070继续保留；无照片迁移或清理。
- 仍共享本机与PostgreSQL测试实例，并非机器隔离。手机和电脑需同一网络，电脑保持运行；换网后核对IP。

## 未覆盖与发布边界

本轮未操作真实iPhone/iPad/安卓；桌面屏宽模拟不替代真机验收。没有服务器、生产数据、版本或tag变化，也不是完整发布前门禁。后续发布仍需用户批准及本地完整类生产预检、鉴权/备份恢复和真实HTTPS链路验证。
