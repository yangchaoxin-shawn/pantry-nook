# Pantry Nook v1.2.0 正式发布记录

发布日期：2026-09-17。

## 发布身份

- 版本与标签：`1.2.0` / `v1.2.0`。
- 部署 commit：`c4d04772ad3420677e19db934dac450864615b47`。
- Release ID：`1.2.0-20260917T050206Z-c4d04772ad34`。
- 用户入口：[https://preview.aihuashen.com/pantry-nook/](https://preview.aihuashen.com/pantry-nook/)。
- 服务器发布记录：`/data/pantry-nook-shared/releases/1.2.0-20260917T050206Z-c4d04772ad34/deployed-release.txt`，状态为 `verified`。

## 本次变化

- 上线“饭桌手记”：支持静态照片原件保留、相册与拖入、多选、最多 9 张、封面切换、照片增删替换、撤销和 1—9 张编排。
- 保留 iOS/iPadOS 的 HEIC/MPO 图片兼容；按用户决定取消实况视频上传、配对、转码和播放。
- 统一库存头部与手记视觉，同时保留菜品页原有展示。
- 新增 `013_photo_journal.sql` 与 `014_journal_photo_edit.sql`，以及固定生产媒体卷 `pantry-media-data`。

本次只发布代码、前端构建和后端镜像；没有上传本地数据库、库存、菜品、手记图片、测试种子或测试媒体。生产已有业务数据原样保留。

## 制品与本地门禁

- 本地类生产门禁在独立空数据库和媒体卷中通过：Docker 后端、生产前端、临时 Nginx、Basic Auth、七个 API、超过 1 MiB 图片、GET/HEAD/Range、伪装视频拒绝、重启持久化和清理均已验证。
- 前端包 SHA256：`1473e931191d36b6ada4e35031435837d157c83904b96da888301bd6ccc82746`。
- 后端源码包 SHA256：`af16868ddde8a79ef923a92b11094ffda48eda98b285a57aba0139393682b3c6`。
- 后端镜像包 SHA256：`fb3651fd941a09ddc67bc70c6fef40fb9219c303a158eaf931e4c09cb5582bdd`。
- 服务器实际镜像 ID：`sha256:0760755e5a73c8dd6106516345b0c958043144bbe04c0e69f46637957a0025d1`，平台为 `linux/amd64`；服务器未重新构建。

## 数据保护与迁移

- 迁移前数据库备份：`/data/pantry-nook-shared/backups/pantry_nook-1.2.0-20260917T050206Z-c4d04772ad34.dump`。
- 数据库备份 SHA256：`3bbc4e45d98ca767e0488728c82775bdba1a41cba5804d042fc4fbb192b5d151`；`pg_restore --list` 已验证可读取。
- 同一停写时点的媒体备份：`/data/pantry-nook-shared/backups/pantry-media-1.2.0-20260917T050206Z-c4d04772ad34.tar.gz`，SHA256 为 `21cf2cbce77b86c9dc1605dc99fa6bc53062f33ead416b6dc057b1bafbc6ddcd`。
- 发布前媒体卷为空，逐文件清单为 0 行；清单空文件 SHA256 为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- migration 从 12 条增加到 14 条，新增 013/014，全部校验值与发布 Manifest 一致。
- 发布前后旧业务表逐表计数一致：库存 26、菜品 18、餐安排 0、消耗 3、库存处理 1、每日餐安排 1；上线后 `journal_entries` 与 `journal_uploads` 均为 0。
- 未执行 seed、reset、truncate、drop、`down -v`、删除卷或从本地迁入业务数据。

## 线上核验

- 匿名首页、静态资源、API 和媒体路径均在返回项目内容前由 Basic Auth 拦截。
- 登录后首页、SPA、真实哈希 CSS/JavaScript、45 份字体、手记懒加载资源和图片 MIME 均正确；七个列表 API 返回 JSON 200，不存在 API 返回 `ROUTE_NOT_FOUND`。
- 按“不上传数据”的要求，生产环境未上传测试照片；无文件的上传请求返回 JSON `VALIDATION_ERROR`，随后 `journal_uploads` 仍为 0。完整图片上传链路由同一制品的本地类生产门禁覆盖。
- 后端和 PostgreSQL 容器健康，宿主机 `/health` 正常；后端挂载命名卷 `pantry-media-data` 至 `/data/media`，卷内文件、软链接和 staging 均为 0。
- Nginx 只修改 Pantry Nook 项目块：API 上传上限 52 MiB，连接超时 15 秒，读写超时 180 秒；非 Pantry Nook 配置与备份字节级一致。
- 真实浏览器只读打开首页与“手记”页：页面正常，主包与手记分包均为 200，六个实际读取 API 均为 200；控制台错误、API 404、MIME 错误和请求失败均为 0。
- 独立 Agent 对镜像、备份、数据库、媒体卷、Nginx、鉴权、静态资源和无测试数据边界完成第二次只读审查。

## 精确回滚输入

- 后端备份：`/data/pantry-nook.bak.1.2.0-20260917T050206Z-c4d04772ad34`。
- 前端备份：`/usr/local/nginx/html/pantry-nook.bak.1.2.0-20260917T050206Z-c4d04772ad34`。
- Nginx 备份：`/usr/local/nginx/cert.d/preview.conf.bak.1.2.0-20260917T050206Z-c4d04772ad34`。
- 数据库与媒体备份、逐文件清单和服务器发布记录使用本页前述精确路径。

普通代码回滚保留生产数据库和 `pantry-media-data`。数据库与媒体备份只作为联合灾难恢复输入；恢复必须另开已授权流程，先恢复到新数据库和新媒体卷核验，不能覆盖当前生产状态。
