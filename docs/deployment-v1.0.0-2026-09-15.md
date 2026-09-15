# Pantry Nook v1.0.0 正式发布记录

发布日期：2026-09-15。生产入口：[https://preview.aihuashen.com/pantry-nook/](https://preview.aihuashen.com/pantry-nook/)。

## 版本绑定

| 项目 | 值 |
|---|---|
| 版本 / annotated tag | `1.0.0` / `v1.0.0` |
| 实际部署 commit | `93c70c922524774e990e5932324b2804ea51cb5a` |
| Release ID | `1.0.0-20260915T043656Z-93c70c922524` |
| 后端镜像 ID | `sha256:3b46023d1e0181a5131a8cf56a2b30ac4bdc381413c4fd93a21c7f5b410b704c` |
| 服务器发布记录 | `/data/pantry-nook/DEPLOYED_RELEASE.txt`，`status=verified` |

`v1.0.0` 明确指向上述实际部署 commit。本文属于发布后的证据整理，因此由后续独立 commit 提交，不移动正式标签。

## 制品校验

| 制品 | SHA256 |
|---|---|
| 前端发布包 | `af024e758c497df8ff6ed4bcf01ae61747394e4139759f672828292245f66e8c` |
| 后端源码包 | `e2b0e3e84dc1a594b5fbebeeb15cdb556afd0751a07f3a67cee8747f47298588` |
| 后端镜像包 | `05e4076ead0a531a3b8ed93937c5c32adb941a6bedcca82f11d2407c733e4544` |

服务器逐项核对了 manifest、完整 commit 与三个制品 SHA256。后端加载并运行本地预检过的同一 `linux/amd64` 镜像，没有在服务器重新构建。

## 数据保护与回滚依据

- 生产数据库备份：`/data/pantry-nook-shared/backups/pantry_nook-1.0.0-20260915T043656Z-93c70c922524.dump`
- 数据库备份 SHA256：`7fa7b7d76bcbe299a6411ce6c4711744d8f76dbceaf0f719e53233a6597eceac`
- 后端备份：`/data/pantry-nook.bak.1.0.0-20260915T043656Z-93c70c922524`
- 前端备份：`/usr/local/nginx/html/pantry-nook.bak.1.0.0-20260915T043656Z-93c70c922524`
- Nginx 配置备份：`/usr/local/nginx/cert.d/preview.conf.bak.1.0.0-20260915T043656Z-93c70c922524`
- migration 前后记录位于 `/data/pantry-nook-shared/releases/1.0.0-20260915T043656Z-93c70c922524/`。

数据库备份完成后执行了 `pg_restore --list` 校验。migration 前后均为 11 项且与候选 manifest 一致；六张业务表在本次首版正式发布时均为 0 行。本次发布没有 seed、reset、truncate、drop、`down -v`、删卷或搬运本地 mock/test 数据。

普通代码回滚按服务器发布记录中的准确路径恢复前端、后端和原镜像，保留当前数据库。数据库 dump 仅作为单独授权的灾难恢复输入，不直接覆盖当前生产库。

## 验证结果

- 本地类生产预检：独立空数据库、真实后端、临时 Nginx、项目子路径、Basic Auth、SPA、真实静态资源与 API 全部通过；测试容器和测试卷已清理。
- 公网验证：匿名访问页面、静态资源和 API 均返回 401；登录后首页与 SPA 正常，47 个静态资源正文与本地产物完全一致，CSS、JavaScript、字体 MIME 正确，缺失资源返回 404。
- API 验证：六个列表接口返回约定 JSON 和空列表；不存在的 API 返回后端 `ROUTE_NOT_FOUND`，没有落入 SPA 首页。
- 服务器验证：PostgreSQL 与后端容器健康；实际运行镜像 ID 匹配；Nginx 配置测试、文件读取权限、migration 对比、数据库备份和后端错误日志检查均通过。
- 独立发布复核未发现 P0/P1 阻断，随后创建 `v1.0.0` annotated tag。

应用内浏览器不可靠地把 URL 内嵌的 Basic Auth 凭据传递给前端 `fetch`，因此没有把该方式作为发布通过证据。正式验证使用标准 HTTP Basic Auth 请求并核对真实响应正文；人工访问应打开正常入口并在浏览器认证框中输入账号密码。
