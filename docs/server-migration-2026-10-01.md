# 服务器迁移：182 → 123（AHS 机）

2026-09-30 执行迁移与部署，2026-10-01 用户验收并清理旧机。这是本次迁移的事实记录；当前部署口径见 [DEPLOY-SERVER](../DEPLOY-SERVER.md)，进度见 [项目状态](project-status.md)。

## 迁移结果

| 项 | 值 |
|---|---|
| 新服务器 | `123.56.128.73`（阿里云 ECS，Ubuntu 24.04，4 核 / 14 GiB / 200G NVMe，deploy-ahs-server skill 管辖） |
| 用户入口 | `https://system.aihuashen.com/pantry-nook/`（Basic Auth 口令不变） |
| 部署版本 | v1.3.0，部署提交 `41c75ac4b0eefdd850bb2ec8e12b974e61a13f9b` 不变；镜像原样搬运（`docker save/load`），镜像 ID `e3c2969a850e` 与 182 部署时一致 |
| 停写窗口 | 2026-09-30 18:26（用户确认无录入后 `docker stop pantry-backend`，随后导出） |

## 新机布局

```text
/data/pantry-nook/
  docker-compose.yml          182 线上原件（LF），未改动
  .env                        600；DB_PASSWORD 沿用；FRONTEND_ORIGIN=https://system.aihuashen.com；
                              PANTRY_BACKEND_IMAGE_TAG=1.3.0-20260917T161119Z-41c75ac4b0ee；PANTRY_BACKEND_BIND_PORT=8016
  backend/app/db/schema.sql   v1.3.0 tag 原件（initdb 用；数据以 dump 恢复为准）
  frontend/                   182 /usr/local/nginx/html/pantry-nook/ 原样 tar 搬运
卷：pantry-db-data、pantry-media-data（新机 Docker data-root=/data/docker）
后端：127.0.0.1:8016 → 容器 3000（仅本机，Nginx 反代）
```

- Nginx（apt 1.24 / systemd）：主块 `/etc/nginx/conf.d/system.conf`（443 + 80 跳转 + include snippets）+ 项目片段 `/etc/nginx/snippets/system/pantry-nook.conf`；口令文件 `/etc/nginx/.pantry-nook.htpasswd`（root:www-data 640）。
- API 路径沿用 v1.3.0 前端制品硬编码的 `/pantry-nook/api/`，由 Nginx rewrite 剥为后端 `/api/$1`（与 182 行为一致）；`/pantry-nook/api/health` 暂在鉴权内。**升 1.4.0 时**：后端原生挂 `/api/pantry-nook` 前缀、移除 rewrite、health 按 deploy-ahs-server skill 免鉴权。
- 迁移期间新机补装 `docker-compose-v2`（2.40.3）并新增 4G `/swapfile`（已写入 fstab）；TLS 泛域名证书 2026-11-10 到期，续期是独立待办。

## 数据核验（全部通过）

- `pg_dump -Fc`（custom 格式）在停写后导出；恢复用 `pg_restore --clean --if-exists`，零警告。
- 14 张业务表行数两机逐表一致；`schema_migrations` 15 项。
- 逐表内容指纹（`md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text))`）两机完全一致——注意 `pg_dump` 归档头带时间戳，字节级 SHA256 必然不同，内容指纹才是有效比对。
- 媒体卷 12 个文件一致（4 次上传 × 原件/预览/缩略图，与 `journal_uploads` 行数自洽）。
- 公网匿名矩阵：页面 / API / health 均 401；HTTP 80 → 301 HTTPS；带凭据链路由用户浏览器验收（2026-10-01"进去了，数据都对"）。

## 备份位置（工作区 `.backups/migration-20260930/`，Git 忽略）

| 文件 | SHA256 |
|---|---|
| `pantry_nook_20260930.dump`（库终态） | `744be596…c09fd8e0` |
| `pantry-media-20260930.tar.gz` | `2f6e0568…3b609e` |
| `pantry-backend-1.3.0-image.tar.gz` | `79404b4a…e39eac` |
| `pantry-frontend-1.3.0.tar.gz` | `090b354a…770539` |
| `.pantry-nook.htpasswd` | `7138f1de…ee149a` |
| `DEPLOYED_RELEASE.txt`（182 末次发布记录） | `5e170024…95f10e` |
| `pantry-nook-shared-archive-20261001.tar.gz`（182 历次发布备份与记录归档） | `4d81f9b9…2a319` |

## 旧机（182.92.205.147）清理终态（2026-10-01，两轮）

第一轮：pantry-db / pantry-backend 容器、全部 pantry 镜像（1.0.0—1.3.0 及派生 tag）、`/data/pantry-nook`、`/data/pantry-nook.bak.*` 四个旧发布目录、`/usr/local/nginx/html/pantry-nook`、`.pantry-nook.htpasswd`、`/data/pantry-nook-shared`（先归档）、preview.conf 中的 pantry 块。

第二轮（用户确认本地备份齐全后）：`/usr/local/nginx/html/pantry-nook.bak.*` 四个前端历史备份（Git tag + 构建可复现）、`preview.conf.bak.1.0.0—1.3.0` 与 `preview.conf.bak.pantry-removal-20261001` 五份配置备份、`/tmp` 迁移暂存物、**数据卷 `pantry-db-data` 与 `pantry-media-data`**。

- 终态（2026-10-01 复查）：全盘 `find -iname '*pantry*'` 零命中；容器、镜像、卷零命中；`nginx -t` 通过，同机其他项目正常。
- 旧入口 `preview.aihuashen.com/pantry-nook/` 返回 404。
- 182 的 `preview.conf.bak.0.6.1-*`、`bak-office-*`、`nginx.conf.bak-haishu-*` 属其他项目，未动。

## 过程中的坑（后续避免）

1. **htpasswd 权限**：首次部署设 `600 root:root`，匿名 401 正常但用户登录 500（nginx worker `www-data` 读不了口令文件）。正确姿势 `chown root:www-data + chmod 640`。教训：带凭据路径必须与匿名矩阵一起验证。
2. **182 nginx 不在 PATH**：编译安装，必须用 `/usr/local/nginx/sbin/nginx -t`；`nginx -t` 找不到命令会触发回滚分支。
3. **Docker data-root 差异**：182 卷在 `/var/lib/docker/volumes/`，新机在 `/data/docker/volumes/`；解包媒体卷前先 `docker volume inspect <vol> --format '{{.Mountpoint}}'`。
4. **Git Bash 路径转换**：`curl -w '/pantry-nook/...'` 里的路径会被 MSYS 改写，检查输出时以 `%{http_code}` 数值为准。

## 未做与下一步

- 未做：两台机器间免密互传（无直连凭据，全部经本机中转，属预期）。
- 阶段 2（另轮发布）：v1.4.0 + OCR 侧车首装 + API 前缀切 `/api/pantry-nook/` + health 免鉴权 + `preflight-release.ps1` / `release.sh` 适配新机形态。OCR 资源条件已在新机实测满足（4 核 / 14G，峰值 2.1G 后余 10G+，swap 4G）。
- 旧机清理已彻底完结（2026-10-01 用户确认本地备份齐全后连数据卷一并删除）；线上数据的唯一生产副本在新机，本地 `.backups/migration-20260930/` 为迁移时点快照。
