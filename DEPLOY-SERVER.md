# Pantry Nook 服务器部署执行文档（v1）

这是公司服务器部署的唯一执行口径。每次发布都必须使用新的 `RELEASE_ID`，记录包校验值和唯一备份路径，禁止用通配符猜测回滚对象。

## 已确认部署口径

- 形态：服务器本机 Nginx 托管前端，Docker 运行 FastAPI 后端与 PostgreSQL。
- 服务器：`182.92.205.147`；域名：`preview.aihuashen.com`。
- 用户入口：`https://preview.aihuashen.com/pantry-nook/`。
- 前端目录：`/usr/local/nginx/html/pantry-nook/`。
- 后端目录：`/data/pantry-nook/`；宿主机端口：`127.0.0.1:8014`。
- 项目级 Basic Auth 只保留一个生效用户；用户名、当前口令和应急换密值记录在忽略 Git 的 `.local/deployment-secrets.md`，不进入发布包或版本历史。
- 应急值只在人工换密时替换当前口令，不作为第二个并存账号。
- 首次发布使用空数据库执行初始化，不迁移本地测试数据。
- 首次发布后线上数据进入持久生产阶段：普通发布/回滚禁止 seed、reset、truncate、drop、`docker compose down -v` 和 `docker volume rm`。
- 必须携带的初始业务数据按版本化 import/migration 处理；测试 seed 只允许带隔离标记的本地测试库。

## 1. 本地类生产门禁

`.env.docker.local` 只需提供测试数据库密码。预检脚本会在当前进程中临时固定测试容器名、卷、端口和 `FRONTEND_ORIGIN=http://127.0.0.1:18080`，结束后恢复原环境变量，不改写该文件。

```powershell
pwsh ./scripts/preflight-release.ps1
```

脚本必须完整通过：版本一致、测试专用空库、Docker 后端、生产前端构建、临时 Nginx、Basic Auth、SPA、真实哈希 CSS/JavaScript/字体正文与 MIME、六个真实列表 API、CORS 和错误路由。默认结束时会核实测试容器与测试数据库卷已经删除。

## 2. 生成发布包

在仓库根目录执行。脚本只接受与当前 commit 对应的预检证据，复用预检生成的 `frontend/dist` 和后端镜像；后端源代码包排除本机 `.env`、虚拟环境和缓存。

```powershell
pwsh ./scripts/package-release.ps1
```

脚本为每次发布建立独立目录并生成四个文件：前端包、后端源代码包、预检通过的后端 Linux 镜像包和 `release manifest`。Manifest 固定记录完整 commit、版本、预检时间、三个 SHA256、镜像 ID、`uv.lock` 与 Compose 校验值。此时只完成本地准备，尚未连接服务器。

## 3. 取得连接许可并只读摸查

先按部署 skill 向用户展示并确认本次部署文档，再单独取得本次 SSH/SCP 连接许可。许可前不能运行 `ssh`、`scp` 或任何服务器命令。

取得许可后，先只读检查目标目录、现有容器、8014 端口、Nginx 项目块、磁盘空间、Nginx worker 用户和当前备份列表；确认没有路径或资源冲突后才上传：

```powershell
$releaseDir = '<package-release.ps1 输出的 RELEASE_DIR>'
$files = @(Get-ChildItem -LiteralPath $releaseDir -File)
if ($files.Count -ne 4) { throw "发布目录应正好包含 4 个文件，实际为 $($files.Count)。" }
$files | ForEach-Object { scp $_.FullName root@182.92.205.147:/tmp/; if ($LASTEXITCODE -ne 0) { throw "上传失败：$($_.Name)" } }
```

登录服务器后，先运行下面命令并与本机逐一核对：

```bash
RELEASE_ID=填入本机生成的releaseId
sha256sum "/tmp/pantry-nook-frontend-${RELEASE_ID}.tgz"
sha256sum "/tmp/pantry-nook-backend-${RELEASE_ID}.tgz"
sha256sum "/tmp/pantry-nook-backend-image-${RELEASE_ID}.tar.gz"
test -f "/tmp/pantry-nook-release-${RELEASE_ID}.json"
```

## 4. 服务器配置和唯一备份

后端生产配置只保存在服务器，不进入发布包。不要用 `cat` 输出密码；只检查文件权限和必需键：

```bash
test -f /data/pantry-nook/.env
stat -c '%a %U:%G %n' /data/pantry-nook/.env
for key in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD PORT FRONTEND_ORIGIN; do
  grep -q "^${key}=" /data/pantry-nook/.env || { echo "缺少 ${key}" >&2; exit 1; }
done
```

首次部署尚无该文件时，先创建 `/data/pantry-nook/.env` 并设置 `chmod 600`；后续发布必须复用当前文件，不能从本机覆盖。

Basic Auth 文件只含一个生效用户。普通代码发布不得重建或重置已有密码；仅在文件不存在的首次部署创建。Nginx worker 必须实际可读：

```bash
sudo apt-get install -y apache2-utils
AUTH_FILE=/usr/local/nginx/.pantry-nook.htpasswd
NGINX_USER=$(/usr/local/nginx/sbin/nginx -T 2>&1 | sed -n 's/^[[:space:]]*user[[:space:]]\+\([^;[:space:]]\+\).*/\1/p' | head -1)
NGINX_USER=${NGINX_USER:-nobody}
NGINX_GROUP=$(id -gn "${NGINX_USER}")
if [ ! -f "${AUTH_FILE}" ]; then
  sudo htpasswd -c "${AUTH_FILE}" <读取本地秘密记录中的用户名>
fi
test "$(wc -l < "${AUTH_FILE}")" -eq 1
sudo chown root:"${NGINX_GROUP}" "${AUTH_FILE}"
sudo chmod 640 "${AUTH_FILE}"
sudo runuser -u "${NGINX_USER}" -- test -r "${AUTH_FILE}"
```

换密是单独操作，读取本地秘密记录中的用户名并使用交互式 `htpasswd /usr/local/nginx/.pantry-nook.htpasswd <用户名>`，不要把新密码写进命令历史。

新后端启动会自动执行 additive migration，因此必须先在当前运行容器上记录 migration 并生成可读取的 PostgreSQL custom-format 备份。备份放在不会随代码目录切换的 shared 路径中：

```bash
set -euo pipefail
RELEASE_ID=填入本机生成的releaseId
BACKUP_ROOT=/data/pantry-nook-shared/backups
RECORD_DIR="/data/pantry-nook-shared/releases/${RELEASE_ID}"
DB_BACKUP="${BACKUP_ROOT}/pantry_nook-${RELEASE_ID}.dump"
test ! -e "${DB_BACKUP}" && test ! -e "${RECORD_DIR}"
install -d -m 700 "${BACKUP_ROOT}" "${RECORD_DIR}"
cd /data/pantry-nook
docker compose --env-file .env -f docker-compose.yml exec -T pantry-db \
  psql -U postgres -d pantry_nook -Atc "select concat_ws(chr(9), version, checksum, applied_at::text) from schema_migrations order by version" \
  > "${RECORD_DIR}/migrations-before.tsv"
docker compose --env-file .env -f docker-compose.yml exec -T pantry-db \
  pg_dump -U postgres -d pantry_nook -Fc > "${DB_BACKUP}"
docker compose --env-file .env -f docker-compose.yml exec -T pantry-db \
  pg_restore --list < "${DB_BACKUP}" > "${RECORD_DIR}/db-backup-list.txt"
test -s "${DB_BACKUP}" && test -s "${RECORD_DIR}/db-backup-list.txt"
chmod 600 "${DB_BACKUP}" "${RECORD_DIR}/migrations-before.tsv" "${RECORD_DIR}/db-backup-list.txt"
sha256sum "${DB_BACKUP}" | tee "${RECORD_DIR}/db-backup.sha256"
```

数据库备份验证通过后，再备份 Nginx 配置。以下命令必须在同一个 shell 中运行：

```bash
set -euo pipefail
RELEASE_ID=填入本机生成的releaseId
NGINX_CONF=/usr/local/nginx/cert.d/preview.conf
NGINX_BACKUP="${NGINX_CONF}.bak.${RELEASE_ID}"
test ! -e "${NGINX_BACKUP}" || { echo "RELEASE_ID 已使用，请生成新的 RELEASE_ID" >&2; exit 1; }
cp -a "${NGINX_CONF}" "${NGINX_BACKUP}"
test -f "${NGINX_BACKUP}"
printf '%s\n' "${NGINX_BACKUP}"
```

## 5. 解包、替换并启动

以下脚本不会清空目标目录。它先解包到新目录、检查内容、继承服务器 `.env`，再把旧目录移动为带本次 `RELEASE_ID` 的唯一备份。

```bash
set -euo pipefail
RELEASE_ID=填入本机生成的releaseId
MANIFEST="/tmp/pantry-nook-release-${RELEASE_ID}.json"
BACKEND_DIR=/data/pantry-nook
BACKEND_STAGE="/data/pantry-nook.stage.${RELEASE_ID}"
BACKEND_BACKUP="/data/pantry-nook.bak.${RELEASE_ID}"
FRONTEND_DIR=/usr/local/nginx/html/pantry-nook
FRONTEND_STAGE="/usr/local/nginx/html/pantry-nook.stage.${RELEASE_ID}"
FRONTEND_BACKUP="/usr/local/nginx/html/pantry-nook.bak.${RELEASE_ID}"
NGINX_BACKUP="/usr/local/nginx/cert.d/preview.conf.bak.${RELEASE_ID}"
RECORD_DIR="/data/pantry-nook-shared/releases/${RELEASE_ID}"

[ "${BACKEND_DIR}" = "/data/pantry-nook" ] || exit 1
[ "${FRONTEND_DIR}" = "/usr/local/nginx/html/pantry-nook" ] || exit 1
for path in "${BACKEND_STAGE}" "${FRONTEND_STAGE}" "${BACKEND_BACKUP}" "${FRONTEND_BACKUP}"; do
  test ! -e "${path}" || { echo "RELEASE_ID 已使用或目标已存在：${path}" >&2; exit 1; }
done
test -f "/tmp/pantry-nook-backend-${RELEASE_ID}.tgz"
test -f "/tmp/pantry-nook-frontend-${RELEASE_ID}.tgz"
test -f "/tmp/pantry-nook-backend-image-${RELEASE_ID}.tar.gz"
test -f "${MANIFEST}"
test -d "${RECORD_DIR}"

python3 - "${MANIFEST}" "${RELEASE_ID}" <<'PY'
import hashlib, json, pathlib, re, sys
manifest_path, release_id = map(pathlib.Path, [sys.argv[1], sys.argv[2]])
release_id = str(release_id)
data = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
assert data['manifest_version'] == 1 and data['project'] == 'pantry-nook'
assert data['release_id'] == release_id and data['clean'] is True
assert re.fullmatch(r'[0-9a-f]{40}', data['commit'])
assert release_id.startswith(data['version'] + '-')
artifacts = data['artifacts']
assert set(artifacts) == {'frontend', 'backend_source', 'backend_image'}
for item in artifacts.values():
    name = item['file']
    assert pathlib.Path(name).name == name
    path = pathlib.Path('/tmp') / name
    assert path.is_file()
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    assert actual == item['sha256'], f'SHA256 mismatch: {name}'
image = artifacts['backend_image']
assert re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', image['tag'])
assert image['image'] == 'pantry-nook-backend:' + image['tag']
assert re.fullmatch(r'sha256:[0-9a-f]{64}', image['image_id'])
assert image['platform'] in {'linux/amd64', 'linux/arm64'}
print('manifest 与三个制品 SHA256 校验通过')
PY

cp -a "${MANIFEST}" "${RECORD_DIR}/local-manifest.json"
MANIFEST="${RECORD_DIR}/local-manifest.json"

IMAGE_TAG=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8-sig"))["artifacts"]["backend_image"]["tag"])' "${MANIFEST}")
EXPECTED_IMAGE_ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8-sig"))["artifacts"]["backend_image"]["image_id"])' "${MANIFEST}")
EXPECTED_PLATFORM=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8-sig"))["artifacts"]["backend_image"]["platform"])' "${MANIFEST}")
case "$(uname -m)" in x86_64) SERVER_PLATFORM=linux/amd64 ;; aarch64|arm64) SERVER_PLATFORM=linux/arm64 ;; *) echo '不支持的服务器架构' >&2; exit 1 ;; esac
test "${EXPECTED_PLATFORM}" = "${SERVER_PLATFORM}"
tar -xOzf "/tmp/pantry-nook-backend-image-${RELEASE_ID}.tar.gz" | docker image load
ACTUAL_IMAGE_ID=$(docker image inspect "pantry-nook-backend:${IMAGE_TAG}" --format '{{.Id}}')
ACTUAL_PLATFORM=$(docker image inspect "pantry-nook-backend:${IMAGE_TAG}" --format '{{.Os}}/{{.Architecture}}')
test "${ACTUAL_IMAGE_ID}" = "${EXPECTED_IMAGE_ID}"
test "${ACTUAL_PLATFORM}" = "${EXPECTED_PLATFORM}"

mkdir -p "${BACKEND_STAGE}" "${FRONTEND_STAGE}"
tar -xzf "/tmp/pantry-nook-backend-${RELEASE_ID}.tgz" -C "${BACKEND_STAGE}"
tar -xzf "/tmp/pantry-nook-frontend-${RELEASE_ID}.tgz" -C "${FRONTEND_STAGE}"
test -f "${BACKEND_STAGE}/docker-compose.yml"
test -f "${BACKEND_STAGE}/backend/Dockerfile"
test -f "${BACKEND_STAGE}/scripts/server-release-record.py"
test -f "${FRONTEND_STAGE}/index.html"
find "${FRONTEND_STAGE}/assets" -maxdepth 1 -type f | grep -q .

test -f "${BACKEND_DIR}/.env"
cp -a "${BACKEND_DIR}/.env" "${BACKEND_STAGE}/.env"

DB_BACKUP="/data/pantry-nook-shared/backups/pantry_nook-${RELEASE_ID}.dump"
python3 "${BACKEND_STAGE}/scripts/server-release-record.py" prepare \
  --manifest "${MANIFEST}" \
  --record "${RECORD_DIR}/deployed-release.txt" \
  --database-backup "${DB_BACKUP}" \
  --database-backup-sha-file "${RECORD_DIR}/db-backup.sha256" \
  --backend-backup "${BACKEND_BACKUP}" \
  --frontend-backup "${FRONTEND_BACKUP}" \
  --nginx-backup "${NGINX_BACKUP}" \
  --migrations-before "${RECORD_DIR}/migrations-before.tsv" \
  --migrations-after "${RECORD_DIR}/migrations-after.tsv"
python3 "${BACKEND_STAGE}/scripts/server-release-record.py" set-status \
  --record "${RECORD_DIR}/deployed-release.txt" --status deploying
cp -a "${RECORD_DIR}/deployed-release.txt" "${BACKEND_STAGE}/DEPLOYED_RELEASE.txt"

if [ -e "${BACKEND_DIR}" ]; then mv "${BACKEND_DIR}" "${BACKEND_BACKUP}"; fi
mv "${BACKEND_STAGE}" "${BACKEND_DIR}"
if [ -e "${FRONTEND_DIR}" ]; then mv "${FRONTEND_DIR}" "${FRONTEND_BACKUP}"; fi
mv "${FRONTEND_STAGE}" "${FRONTEND_DIR}"

find "${FRONTEND_DIR}" -type d -exec chmod 755 {} \;
find "${FRONTEND_DIR}" -type f -exec chmod 644 {} \;
cd "${BACKEND_DIR}"
PANTRY_BACKEND_IMAGE_TAG="${IMAGE_TAG}" docker compose --env-file .env -f docker-compose.yml up -d --no-build

BACKEND_CID=$(docker compose --env-file .env -f docker-compose.yml ps -q pantry-backend)
test -n "${BACKEND_CID}"
for _ in $(seq 1 90); do
  STATUS=$(docker inspect "${BACKEND_CID}" --format '{{.State.Health.Status}}' 2>/dev/null || true)
  if [ "${STATUS}" = healthy ] && curl -fsS http://127.0.0.1:8014/health >/dev/null; then break; fi
  sleep 2
done
test "$(docker inspect "${BACKEND_CID}" --format '{{.State.Health.Status}}')" = healthy
curl -fsS http://127.0.0.1:8014/health >/dev/null
test "$(docker inspect "${BACKEND_CID}" --format '{{.Image}}')" = "${EXPECTED_IMAGE_ID}"

docker compose --env-file .env -f docker-compose.yml exec -T pantry-db \
  psql -U postgres -d pantry_nook -Atc "select concat_ws(chr(9), version, checksum, applied_at::text) from schema_migrations order by version" \
  > "${RECORD_DIR}/migrations-after.tsv"
python3 - "${MANIFEST}" "${RECORD_DIR}/migrations-before.tsv" "${RECORD_DIR}/migrations-after.tsv" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
expected = {item['file']: item['sha256'] for item in data['inputs']['migrations']}
def read(path):
    rows = {}
    for line in pathlib.Path(path).read_text().splitlines():
        version, checksum, *_ = line.split('\t')
        rows[version] = checksum
    return rows
before, after = read(sys.argv[2]), read(sys.argv[3])
assert set(before).issubset(expected) and all(expected[k] == v for k, v in before.items())
assert after == expected
print('migration 前后版本与候选 manifest 校验通过')
PY
```

上述脚本会在目录切换前生成固定字段的 `status=prepared` 记录，切换前更新为 `status=deploying` 并放入新后端目录。因此即使启动或核验中途失败，也能从 shared 记录按准确 release 回滚。线上全部核验通过后执行：

```bash
set -euo pipefail
RELEASE_ID=填入本次releaseId
RECORD_DIR="/data/pantry-nook-shared/releases/${RELEASE_ID}"
python3 /data/pantry-nook/scripts/server-release-record.py set-status \
  --record "${RECORD_DIR}/deployed-release.txt" --status verified
cp -a "${RECORD_DIR}/deployed-release.txt" /data/pantry-nook/DEPLOYED_RELEASE.txt
grep -q '^status=verified$' /data/pantry-nook/DEPLOYED_RELEASE.txt
```

记录固定包含完整 commit、版本、`RELEASE_ID`、三个包 SHA256、镜像 tag/ID、数据库备份路径及 SHA256、后端/前端/Nginx 备份路径、migration 前后文件及三个阶段时间，且不包含密码或 `.env` 内容。

数据库 dump 只作为灾难恢复输入，普通代码回滚不恢复数据库。需要恢复时另开已授权任务，先恢复到新数据库或新卷并核验，再决定切换；禁止直接对当前生产库执行 `pg_restore --clean`。

## 6. Nginx 项目块

只在 `/usr/local/nginx/cert.d/preview.conf` 中维护下列 Pantry Nook 块；其他项目不修改。

```nginx
location = /pantry-nook {
    return 302 /pantry-nook/;
}

location ^~ /pantry-nook/api/ {
    auth_basic "Private Area";
    auth_basic_user_file /usr/local/nginx/.pantry-nook.htpasswd;
    rewrite ^/pantry-nook/api/(.*)$ /api/$1 break;
    proxy_pass http://127.0.0.1:8014;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /pantry-nook/assets/ {
    auth_basic "Private Area";
    auth_basic_user_file /usr/local/nginx/.pantry-nook.htpasswd;
    alias /usr/local/nginx/html/pantry-nook/assets/;
    try_files $uri $uri/ =404;
}

location ^~ /pantry-nook/ {
    auth_basic "Private Area";
    auth_basic_user_file /usr/local/nginx/.pantry-nook.htpasswd;
    alias /usr/local/nginx/html/pantry-nook/;
    index index.html;
    try_files $uri $uri/ /pantry-nook/index.html;
}
```

保存后只比较本次唯一备份，配置通过才重新加载：

```bash
set -euo pipefail
RELEASE_ID=填入本机生成的releaseId
NGINX_CONF=/usr/local/nginx/cert.d/preview.conf
NGINX_BACKUP="${NGINX_CONF}.bak.${RELEASE_ID}"
test -f "${NGINX_BACKUP}"
diff "${NGINX_BACKUP}" "${NGINX_CONF}" || [ "$?" -eq 1 ]
/usr/local/nginx/sbin/nginx -t
/usr/local/nginx/sbin/nginx -s reload
```

## 7. 发布后验证

全部通过后才能报告成功：

1. 匿名访问首页、当前真实静态资源和真实 API 均为 401，且含 `WWW-Authenticate: Basic`，前端内容不会先出现。
2. 登录后首页和 SPA 子路由返回 Pantry Nook HTML。
3. 从当前首页提取真实哈希 CSS、JavaScript；正文不是 HTML，MIME 正确。
4. CSS 引用的真实字体返回非空正文和 `font/woff2`；不存在的静态资源返回 404。
5. ingredients、dishes、meal-plans、consumptions、inventory-adjustments、daily-battles 返回 JSON 200 和 `data`；首发空库时全部为空。
6. 不存在的 API 返回后端 JSON 404 与 `ROUTE_NOT_FOUND`。
7. 服务器宿主机 `curl http://127.0.0.1:8014/health` 返回 JSON 200；公网不提供健康入口。
8. `docker compose ps` 中后端和数据库健康，日志没有持续异常。
9. `namei -l` 和以 Nginx worker 身份读取 Basic Auth 文件及实际 CSS/JS/字体均成功。
10. 浏览器 Network 无异常 4xx/5xx，控制台无资源 MIME 或业务 API 404。

本机公网 HTTP 核验：

```powershell
$credential = Get-Credential -UserName <读取本地秘密记录中的用户名>
& ./scripts/verify-deployment.ps1 -Credential $credential -ExpectEmpty
```

首次发布或本次明确要求空库时使用 `-ExpectEmpty`；用户已经开始录入数据后的普通升级必须省略该参数。该脚本只证明公网 HTTP 链路；服务器容器、`/health`、Linux 权限和日志仍须人工核对并记录。

## 8. 回滚与记录

从 `/data/pantry-nook-shared/releases/<失败 release id>/deployed-release.txt` 选择要撤销的准确 release；该记录在目录切换前已经建立，不依赖新服务成功。核对固定字段后执行，禁止使用通配符：

```bash
set -euo pipefail
ROLLBACK_ID=$(date +%Y%m%d-%H%M%S)
TARGET_RELEASE_ID=填入DEPLOYED_RELEASE记录中的release
CURRENT_RECORD="/data/pantry-nook-shared/releases/${TARGET_RELEASE_ID}/deployed-release.txt"
BACKEND_DIR=/data/pantry-nook
FRONTEND_DIR=/usr/local/nginx/html/pantry-nook
NGINX_CONF=/usr/local/nginx/cert.d/preview.conf
[[ "${TARGET_RELEASE_ID}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,40}$ ]] || { echo "release 格式错误" >&2; exit 1; }
test -f "${CURRENT_RECORD}"
test "$(awk -F= '$1=="release_id" {print $2}' "${CURRENT_RECORD}")" = "${TARGET_RELEASE_ID}"
grep -Eq '^status=(deploying|verified)$' "${CURRENT_RECORD}"
BACKEND_BACKUP="/data/pantry-nook.bak.${TARGET_RELEASE_ID}"
FRONTEND_BACKUP="/usr/local/nginx/html/pantry-nook.bak.${TARGET_RELEASE_ID}"
NGINX_BACKUP="/usr/local/nginx/cert.d/preview.conf.bak.${TARGET_RELEASE_ID}"
FAILED_BACKEND="/data/pantry-nook.failed.${ROLLBACK_ID}"
FAILED_FRONTEND="/usr/local/nginx/html/pantry-nook.failed.${ROLLBACK_ID}"
FAILED_NGINX="/usr/local/nginx/cert.d/preview.conf.failed.${ROLLBACK_ID}"

test "$(awk -F= '$1=="backend_backup" {print $2}' "${CURRENT_RECORD}")" = "${BACKEND_BACKUP}"
test "$(awk -F= '$1=="frontend_backup" {print $2}' "${CURRENT_RECORD}")" = "${FRONTEND_BACKUP}"
test "$(awk -F= '$1=="nginx_backup" {print $2}' "${CURRENT_RECORD}")" = "${NGINX_BACKUP}"

test -d "${BACKEND_BACKUP}" && test -d "${FRONTEND_BACKUP}" && test -f "${NGINX_BACKUP}"
test ! -e "${FAILED_BACKEND}" && test ! -e "${FAILED_FRONTEND}" && test ! -e "${FAILED_NGINX}"
PREVIOUS_IMAGE_TAG=''
PREVIOUS_IMAGE_ID=''
if grep -q 'image: pantry-nook-backend:' "${BACKEND_BACKUP}/docker-compose.yml"; then
  test -f "${BACKEND_BACKUP}/DEPLOYED_RELEASE.txt"
  PREVIOUS_IMAGE_TAG=$(awk -F= '$1=="backend_image_tag" {print $2}' "${BACKEND_BACKUP}/DEPLOYED_RELEASE.txt")
  PREVIOUS_IMAGE_ID=$(awk -F= '$1=="backend_image_id" {print $2}' "${BACKEND_BACKUP}/DEPLOYED_RELEASE.txt")
  [[ "${PREVIOUS_IMAGE_TAG}" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]
  [[ "${PREVIOUS_IMAGE_ID}" =~ ^sha256:[0-9a-f]{64}$ ]]
  test "$(docker image inspect "pantry-nook-backend:${PREVIOUS_IMAGE_TAG}" --format '{{.Id}}')" = "${PREVIOUS_IMAGE_ID}"
fi
cd "${BACKEND_DIR}"
docker compose --env-file .env -f docker-compose.yml down
mv "${BACKEND_DIR}" "${FAILED_BACKEND}"
mv "${BACKEND_BACKUP}" "${BACKEND_DIR}"
mv "${FRONTEND_DIR}" "${FAILED_FRONTEND}"
mv "${FRONTEND_BACKUP}" "${FRONTEND_DIR}"
cp -a "${NGINX_CONF}" "${FAILED_NGINX}"
cp -a "${NGINX_BACKUP}" "${NGINX_CONF}"

cd "${BACKEND_DIR}"
if grep -q 'image: pantry-nook-backend:' docker-compose.yml; then
  PANTRY_BACKEND_IMAGE_TAG="${PREVIOUS_IMAGE_TAG}" docker compose --env-file .env -f docker-compose.yml up -d --no-build
else
  docker compose --env-file .env -f docker-compose.yml up -d --build
fi
/usr/local/nginx/sbin/nginx -t
/usr/local/nginx/sbin/nginx -s reload
```

回滚后执行全部发布后验证，并记录 `FAILED_BACKEND`、`FAILED_FRONTEND`、`FAILED_NGINX` 以便审计。

- 回滚仍必须保留项目级 Basic Auth，不得通过移除鉴权恢复页面。
- 数据库卷不随普通代码回滚删除；持久生产卷不得在部署流程中删除。只有经证明为 disposable demo/test 的卷，才可在单独数据维护任务中精确处理。
- 每次发布记录 `RELEASE_ID`、Git 状态/提交、三个制品 SHA256、数据库备份及三个代码/配置备份路径、验证结果、故障与未覆盖项。
