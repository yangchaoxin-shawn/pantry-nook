# Pantry Nook v1.3.0 正式发布记录

发布日期：2026-09-18。

## 发布身份

- 版本与标签：`1.3.0` / `v1.3.0`。
- 部署 commit：`41c75ac4b0eefdd850bb2ec8e12b974e61a13f9b`。
- Release ID：`1.3.0-20260917T161119Z-41c75ac4b0ee`。
- 用户入口：[https://preview.aihuashen.com/pantry-nook/](https://preview.aihuashen.com/pantry-nook/)。
- 服务器发布记录：`/data/pantry-nook-shared/releases/1.3.0-20260917T161119Z-41c75ac4b0ee/deployed-release.txt`，状态为 `verified`。

## 本次变化

- 新增不属于正餐的日常库存消耗入口，可记录实际用掉数量，并在同一事务内扣减库存、写入记录。
- 支持幂等重试、库存版本冲突提示、部分或全部用掉、耗尽状态和安全撤销。
- “消耗与处理记录”拆成“日常用掉”和“变质 / 损坏”两个分类，不设混合总览；两类独立读取、独立失败重试，刷新后保留当前分类。
- 新增 `015_casual_inventory_usage.sql`；旧 `spoiled`、`damaged`、`other` 记录继续兼容。

本次只发布代码、前端构建和后端镜像；没有上传本地数据库、库存、菜品、手记图片、测试种子或测试媒体。生产已有业务数据原样保留。

## 制品与发布门禁

- 前端包 SHA256：`08a7d874110293fd49573bc89869631d63d393f50849d4c7409f71e8d58e3a09`。
- 后端源码包 SHA256：`14363dbca6e9e3055a51d8f27020d3151f4f83a206e04cafb3e4912c7247ac50`。
- 后端镜像包 SHA256：`b833e742a2f9f0bd46308b50919116b19c099c5309bf6489e1ad05f8944b797c`。
- Manifest SHA256：`c6fdd7d71b33b6b537dc053a980411f4272fddeeb9bbc3ee105ef237a3edf538`。
- 服务器实际镜像 ID：`sha256:e3c2969a850eefd48b8288e0c54847cdfe420793be1e81dfea5751f3eef49bbd`，平台为 `linux/amd64`；服务器未重新构建。
- 本地类生产门禁通过：独立空数据库、生产构建、临时 Nginx、Basic Auth、真实资源和 API、完整照片上传/Range/重启持久化与清理链路均已验证。
- 首次使用固定发布脚本前，在独立 Linux Docker-in-Docker 环境完成真实演练：候选启动后的预设故障触发 `recovered_previous`，旧 v1.2 后端在 migration 015 后仍健康且实际写入成功；随后同代码制品成功升级，数据与媒体均保留。

## 数据保护与迁移

- 迁移前数据库备份：`/data/pantry-nook-shared/backups/pantry_nook-1.3.0-20260917T161119Z-41c75ac4b0ee.dump`，SHA256 为 `64e1352ffcb8a38d8fb26bc5680749fec1c828eb3169f9dae68ba1b4bc5eb010`；`pg_restore --list` 已验证可读取。
- 同一停写窗口的媒体备份：`/data/pantry-nook-shared/backups/pantry-media-1.3.0-20260917T161119Z-41c75ac4b0ee.tar.gz`，SHA256 为 `7336ea153ad6503e8be71c27109d839769a1d41755d6cd07141040b88806ff88`，归档可读取。
- 发布前媒体卷为空，逐文件清单为 0 行；清单空文件 SHA256 为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- migration 从 14 条增加到 15 条，新增 migration 015；迁移文件和校验值与发布 Manifest 一致。
- 发布前后业务计数保持：库存 26、菜品 18、餐安排 0、消耗 3、库存处理 1、每日餐安排 1；手记与上传均为 0。
- 未执行 seed、reset、truncate、drop、`down -v`、删除卷或从本地迁入业务数据。

## 线上核验

- 匿名首页、静态资源、API 和媒体路径均在返回项目内容前由 Basic Auth 拦截。
- 登录后首页、SPA、真实哈希 CSS/JavaScript、字体正文与 MIME 均正确；七个列表 API 返回 JSON 200，不存在 API 返回后端 JSON 404。
- 新分类接口返回 `used=0`、`waste=1`，唯一处理记录为 `spoiled`，分类过滤无串数据。
- 真实 Chromium 只读打开“消耗与处理记录”：日常用掉空状态正确，切换变质/损坏显示 1 条记录，刷新保留当前分类；控制台 0 error、0 warning，0 HTTP 错误和 0 非预期请求失败。
- 后端和 PostgreSQL 容器健康，宿主机 `/health` 数据库已连接；固定卷为 `pantry-db-data` 和 `pantry-media-data`，migration 共 15 项。
- 线上前端 63 个文件的树哈希与本地预检一致；Nginx 与发布前备份字节一致且语法通过，worker 可读取鉴权文件和前端文件；部署后日志无 Traceback、ERROR 或 HTTP 5xx。
- 独立 Agent 对公网、镜像、迁移、业务计数、同点备份、固定卷、Nginx、权限、前端文件和浏览器行为完成第二次只读复核。

按用户“不上传测试数据”的要求，本次未运行公网照片上传探针。完整照片上传链路只由同一制品的本地类生产门禁覆盖，线上真实上传体验留待用户实际使用反馈，不能记为线上已通过。

## 精确回滚输入与边界

- 后端备份：`/data/pantry-nook.bak.1.3.0-20260917T161119Z-41c75ac4b0ee`。
- 前端备份：`/usr/local/nginx/html/pantry-nook.bak.1.3.0-20260917T161119Z-41c75ac4b0ee`。
- Nginx 备份：`/usr/local/nginx/cert.d/preview.conf.bak.1.3.0-20260917T161119Z-41c75ac4b0ee`；本次没有修改 Nginx。
- 数据库与媒体备份、逐文件清单和服务器发布记录使用本页前述精确路径。

migration 015 对 v1.2 后端兼容；普通代码回滚保留生产数据库和固定卷。但若 v1.3 已产生 `used` 记录，旧 v1.2 前端对该理由的展示会降级，因此回滚后须明确此 UI 语义边界。数据库与媒体备份仅作为联合灾难恢复输入，恢复必须另开已授权流程，不能覆盖当前生产状态。
