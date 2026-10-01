# Pantry Nook 服务器部署执行文档

这是公司服务器部署的执行入口。当前版本、代码基线和已发生的发布只看 [项目状态](docs/project-status.md)，历史发布记录用于追溯。每次发布生成唯一 `RELEASE_ID`，记录制品校验值及准确备份路径，禁止以通配符猜测回滚对象。

> **2026-09-30 服务器迁移**：pantry 已迁至 `123.56.128.73`（deploy-ahs-server skill 管辖）；迁移事实与核验见 [迁移记录](docs/server-migration-2026-10-01.md)。下节口径已更新；**第 2—6 节仍是 182 时期的流程文本**，发布 v1.4.0（阶段 2）时须按新机形态（apt Nginx + snippets、端口 8016、`/data/pantry-nook/` 布局）适配 `preflight-release.ps1`、`release.sh` 并同步重写这些章节。

## 部署与数据口径（2026-09-30 迁移后）

- 服务器 `123.56.128.73`（阿里云 ECS，Ubuntu 24.04，4 核 / 14 GiB / 200G NVMe，root 公钥免密）；用户入口 `https://system.aihuashen.com/pantry-nook/`。
- Nginx 为 apt 安装（systemd 管理）：主块 `/etc/nginx/conf.d/system.conf`，项目片段 `/etc/nginx/snippets/system/pantry-nook.conf`；Basic Auth 口令文件 `/etc/nginx/.pantry-nook.htpasswd`（root:www-data 640）。泛域名证书 `/etc/nginx/cert/cert.pem`，**2026-11-10 到期**。
- Docker FastAPI 位于 `/data/pantry-nook/`（compose + `.env` + `backend/app/db/schema.sql` + `frontend/`），仅绑定 `127.0.0.1:8016`；Docker data-root 为 `/data/docker`。
- PostgreSQL 使用 `pantry-db-data`，照片使用 `pantry-media-data`（均为新机 docker 卷）；历次发布备份归档已随迁移移至本地工作区 `.backups/migration-20260930/`。
- 项目级 Basic Auth 只保留一个生效用户。秘密只记在本机忽略 Git 的位置与服务器配置，不进入发布包；普通发布不重设口令。
- 发布只传代码、构建产物和后端镜像，不上传本地业务库、mock、测试照片或 `.env`。
- 线上已经产生数据（迁移自 182 的真实业务数据，2026-10-01 逐表内容指纹核验一致）：普通发布与回滚不得 seed/reset、清表、删卷、`down -v`，不得以空库验收要求清空线上。首次空库和受批准的业务数据导入是独立流程。
- 照片发布还须遵循 [媒体持久化、备份恢复](docs/photo-journal-operations.md)。数据库 dump 与媒体归档必须来自同一停写窗口，普通回滚只恢复代码，不回灌生产数据。

## 1. 本地准备与独立审查

版本和发布范围按用户实际授权执行，已取得的同一许可不重复询问。本地先固定候选提交，再运行：

```powershell
pwsh ./scripts/preflight-release.ps1
pwsh ./scripts/package-release.ps1
```

预检使用带标记的隔离测试库和媒体卷，验证生产子路径、Basic Auth、真实资源正文/MIME、真实 API、超过 1 MiB 图片上传、GET/HEAD/Range、伪装视频拒绝、重启持久化及清理。发布包复用相同候选产物，不在服务器重建。

打包输出四个文件：前端包、后端代码包、Docker 镜像包和 manifest。核对干净 Git、完整 commit、版本、三个 SHA256、镜像 ID/架构及 migration。独立 agent 检查最终制品与回滚兼容性；主负责人亲自运行门禁。

普通升级使用固定 [release.sh](scripts/server/release.sh)，不再把多段 Bash 粘贴到远程 stdin。脚本说明、恢复边界和离线验证见 [工具说明](scripts/server/README.md)。该脚本已完成离线测试与真实 Linux Docker 隔离升级/自动恢复演练；每次发布仍须核验最新候选与服务器实际状态，历史证据不能代替当次核对。

## 1b. OCR 侧车（v1.4.0 起的独立部署单元）

> **状态（2026-10-01 更新）：可重启，随阶段 2 发布执行。** 原 182 服务器（2 核 / 3.4G）实测承载不了侧车刚性内存峰值（密小票推理 VmHWM 约 2.1G），2026-09-27 经用户决定暂停并完整回退。**2026-09-30 服务器迁移后，新机 `123.56.128.73`（4 核 / 14 GiB / swap 4G）实测满足重启条件**（峰值 2.1G 后仍余 10G+）；v1.4.0 发布时按本节流程在新机重走首装演练，不得跳过资源核验。注意本节 compose 路径按新机布局（`/data/pantry-nook-ocr/`）；共享网络与 backend 的 `OCR_SERVICE_URL` 在演练时现场核对。以下流程保留供执行时使用。

拍小票入库依赖独立 OCR 服务（`ocr/`，PP-OCRv6 CPU 推理）。固定发布入口（`release.sh` + `release_checks.py`）只认 `pantry-db` / `pantry-backend` 两个服务，这是刻意约束，不得放宽；因此侧车**不进入项目 compose**，按"首装组件"单独管理：

- 镜像 `pantry-nook-ocr:<与后端相同的 release 镜像 tag>`，模型烘焙进镜像层，运行期不联网；部署文件 `ocr/deploy/docker-compose.yml`（独立项目 `pantry-nook-ocr`，容器名 `pantry-ocr`，挂共享网络，不发布宿主机端口，无状态、无卷）。本地构建入口：`docker build -t pantry-nook-ocr:local ocr/`（preflight 会自动构建）。
- backend 经 `OCR_SERVICE_URL`（compose 默认 `http://pantry-ocr:9610`）访问；侧车不在线只影响小票接口（503），其余功能不受影响。
- 打包时 `package-release.ps1` 额外导出 `pantry-nook-ocr-image-<RELEASE_ID>.tar.gz` 与部署文件一起作为**独立传输物**（不进 manifest，不计入四制品）；上传后本地/服务器 SHA256 逐文件核对，`docker load` 后核对镜像 ID 与 `linux/amd64` 平台。
- 服务器首装（在 `release.sh --apply` 的维护窗口**之前**完成，窗口内不再动它）：

```bash
mkdir -p /data/pantry-nook-ocr
# 上传 ocr/deploy/docker-compose.yml 至 /data/pantry-nook-ocr/docker-compose.yml
docker load < /tmp/pantry-nook-ocr-image-<RELEASE_ID>.tar.gz
PANTRY_OCR_IMAGE_TAG='<发布镜像 tag>' \
  docker compose -p pantry-nook-ocr -f /data/pantry-nook-ocr/docker-compose.yml up -d
docker inspect pantry-ocr --format '{{.State.Health.Status}}'   # 等 healthy
```

- 验证：宿主机 `docker exec pantry-backend python -c "import urllib.request; print(urllib.request.urlopen('http://pantry-ocr:9610/health').read())"`（走 backend 同款网络路径）；线上验收时以真实小票图走公网链路核对 401/200。
- 回滚：`docker compose -p pantry-nook-ocr -f /data/pantry-nook-ocr/docker-compose.yml down`。无状态、不涉及任何卷，旧后端不感知；`external` 共享网络不会被 down 移除。
- 升级：随某次普通发布一起出（新镜像 tag 同该次 release），先 `docker load` + `up -d` 换容器再走常规发布流程；首装证据（镜像 ID、SHA256、compose SHA256、容器启动时间）记入当次发布记录目录。
- 服务器资源门槛（2026-09-27 实测标定）：推理峰值内存约 2.1G（密小票 1706px，VmHWM）、稳态约 0.76G，部署文件已设 `mem_limit: 3g` + `memswap_limit: 4g` 硬顶，OOM 只影响侧车自身；**要求服务器有 swap 且空余不小于 2G**（首装用 `free -h` 核验），2 核 CPU 实测密小票 22-25 秒/张，300 秒超时余量充足。磁盘需容纳镜像包（约 1 GB）与解包镜像（约 4.2 GB）。摸查不达标时回到方案评估，不强行上线。

## 2. 连接授权、只读摸查与上传

按用户已批准的发布范围和部署 skill 确认本次 SSH/SCP 操作已获授权；缺少授权时再询问。先检查目标目录、现有容器/端口、固定卷、磁盘余量、Nginx 项目块、worker 读取权限、当前发布记录和唯一备份路径。磁盘须足够同时保存新旧制品及数据库/媒体备份。

仅在核对上述结果后上传四个发布文件至 `/tmp/`。另外将本次候选提交中的 `release.sh`、`release_checks.py`、`backup_media.py` 上传到唯一 `/tmp/pantry-nook-ops-<RELEASE_ID>/`；它们是代码工具，不是业务数据。工具上传前本地 `bash -n`，上传后逐文件核对本地与服务器 SHA256、LF 行尾，按普通文件执行。

manifest 自身 SHA256 从本机生成并留在本轮记录中，不能从服务器收到的同一文件自证。服务器 `.env` 继续使用原文件，权限 `600`；不得把本机 `.env` 覆盖上去，不输出 `docker compose config` 中的口令。

## 3. 默认只读检查

下列命令在已授权连接的目标服务器执行，替换两个明确值；不通过管道或重定向把脚本送给 `bash`：

```bash
RELEASE_ID='<本次 release ID>'
MANIFEST_SHA256='<本机 manifest SHA256>'
bash "/tmp/pantry-nook-ops-${RELEASE_ID}/release.sh" \
  --release-id "${RELEASE_ID}" --manifest-sha256 "${MANIFEST_SHA256}" --check
```

无参数只显示帮助；默认 `--check` 不解包、不加载镜像、不停止服务。它拒绝已使用路径、非 v2/未核验的旧发布、镜像或卷不一致、配置漂移和异常服务。

固定入口仅处理当前架构的普通兼容升级。首次安装、修改 Nginx/访问控制、PostgreSQL 版本变化、换卷和破坏性 migration 不在其中；这些变更要先形成具体方案和恢复步骤，不能通过取消断言绕过。

## 4. 连续维护窗口与切换

独立审查已确认 migration 对旧后端兼容后，才加显式应用参数：

```bash
bash "/tmp/pantry-nook-ops-${RELEASE_ID}/release.sh" \
  --release-id "${RELEASE_ID}" --manifest-sha256 "${MANIFEST_SHA256}" \
  --apply --compatible-migrations-reviewed
```

入口先取得本项目发布锁，在旧服务继续运行时完成制品解包、Compose/镜像检查、migration 对照、前端权限和配置备份。准备失败不会停止旧服务。

之后在同一个受保护流程中停止后端，检查上传已排空，创建 PostgreSQL custom dump、媒体归档和逐文件清单；归档正文逐文件回读校验。备份完成后生成现有 v2 格式发布记录，逐目录切换、只启动后端容器、检查健康/实际镜像/媒体卷/migration。数据库容器和两个生产卷保持原样。

Nginx 配置保留，前后 SHA256 和 diff 必须一致；脚本不重载、不覆盖共享配置。需要修改时只允许精确 Pantry Nook 块，独立备份与审查 diff，执行 `nginx -t` 后再重载；不能顺手修改其他项目。

普通错误及 INT/TERM 会尝试恢复已移动的前后端目录和旧后端，再检查旧镜像健康。失败目录与证据保留，恢复失败明确写 `RECOVERY_FAILED`。不能重复使用相同 release ID。SIGKILL、断电和持续基础设施故障不在自动恢复保证内。

成功结束只表示服务器切换通过，记录仍为 `deploying`，`execution-state.txt` 为 `awaiting_public_verification`，此时不能报告全部发布验收完成。

## 5. 线上验收与数据边界

默认生产只读验收：

1. 匿名首页、当前真实资源、API 和媒体路径均被 Basic Auth 拦截，前端内容不会先显示。
2. 登录后首页/SPA 正常；从当前 HTML 提取真实哈希 CSS/JS，检查正文及 MIME，字体非空；不存在的资源必须 404。
3. 七个真实列表接口返回约定 JSON，错误 API 返回后端 JSON 404。普通升级检查现有数据可读与 migration，不强制为空。
4. 宿主机 `/health`、容器健康、实际镜像、固定媒体卷、Linux 目录/资源读取权限、Nginx worker 读取 Auth 文件正常。
5. 浏览器页面和控制台正常，日志没有持续异常；记录检查时间和具体基线。

```powershell
$credential = Get-Credential -UserName <读取本地秘密记录中的用户名>
./scripts/verify-deployment.ps1 -Credential $credential
```

**上传探针是另一种有写入的验收，不能混称为只读。** 只有用户授权临时线上探针且同意清理方式时，才追加 `-JournalSamplePath <明确照片路径>`，验证公网实际上传、媒体 GET/HEAD/Range 与原图 SHA256。API 取消会使未绑定上传不可访问，但不等于当场物理删除全部文件；须按实际清理机制核验，不能承诺“从未上传任何数据”。

用户要求不上传测试数据时不运行探针。将该项记录为“按数据约束本次未执行，完整链路仅在本地类生产验证，待真实上传体验”，不能记为通过。只有明确的首次空库才允许 `-ExpectEmpty`。本机 HTTP 脚本不能替代服务器和真实设备检查。

完成适用验收、写明获准不执行项及剩余边界，并由独立 agent 只读复核后，主负责人再标记：

```bash
RECORD_DIR="/data/pantry-nook-back/releases/${RELEASE_ID}"
python3 /data/pantry-nook/scripts/server-release-record.py set-status \
  --record "${RECORD_DIR}/deployed-release.txt" --status verified
cp -p "${RECORD_DIR}/deployed-release.txt" /data/pantry-nook/DEPLOYED_RELEASE.txt
```

`verified` 表示本次约定的验收完成；完整记录仍须明确哪些只在本地验证、哪些在线上验证、哪些等待用户体验。tag 只能指向实际已发布且经用户确认的提交，后续文档提交不移动旧 tag。

## 6. 回滚与记录

脚本执行中的自动恢复与发布后人工回滚不同。公网验收失败时，先读取准确 `/data/pantry-nook-back/releases/<RELEASE_ID>/deployed-release.txt`，核对旧镜像 ID、前后端/Nginx 备份、当前目录位置、`execution-state.txt` 和 migration 兼容性，再形成该次回滚命令。不要重新执行失败的 `--apply`，也不要调用历史 release 的固定脚本。

普通代码回滚的顺序是：停止当前后端；把当前代码移入新的唯一失败目录；恢复对应前后端备份；按记录核对旧镜像并启动后端；保留数据库和媒体卷；重新完成适用线上验收。Nginx 只有本次确实修改过且确认没有其他项目后续变更时才恢复对应配置，否则保持现状。任何一步失败都先核对实际状态，不靠通配符清理重来。

数据库 dump 和媒体归档只作为联合灾难恢复输入；另获授权后先恢复到新数据库/新媒体卷并校验，再决定切换。禁止直接对当前生产库 `pg_restore --clean`，也不以恢复发布前快照覆盖发布后的真实照片或业务数据。

每次发布记录完整 commit/版本、release ID、三个制品和工具 SHA256、旧镜像、同点 DB/媒体备份及逐文件清单、代码/配置备份路径、实际验收、故障、恢复动作和未覆盖项。当前状态只同步到 [项目状态](docs/project-status.md)；详细证据放本次发布记录，不在 PRD 或本执行文档复制临时进度。
