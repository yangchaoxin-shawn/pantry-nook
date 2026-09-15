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

在仓库根目录执行。必须复用刚通过预检生成的 `frontend/dist`，后端包排除本机 `.env`、虚拟环境和缓存。

```powershell
$version = (Get-Content VERSION -Raw).Trim()
$shortSha = (git rev-parse --short=12 HEAD).Trim()
if (git status --porcelain) { throw '发布候选必须先提交并保持工作区干净。' }
$utcStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$releaseId = "$version-$utcStamp-$shortSha"
$packageDir = Join-Path $PWD '.review/release-package'
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

tar -czf "$packageDir/pantry-nook-frontend-$releaseId.tgz" -C frontend/dist .
tar -czf "$packageDir/pantry-nook-backend-$releaseId.tgz" `
  --exclude='backend/.env*' --exclude=backend/.venv --exclude=backend/.uv-cache `
  --exclude=backend/.pytest_cache --exclude=backend/.backups `
  --exclude='*/__pycache__' --exclude='*.pyc' `
  docker-compose.yml backend

Get-FileHash "$packageDir/pantry-nook-frontend-$releaseId.tgz" -Algorithm SHA256
Get-FileHash "$packageDir/pantry-nook-backend-$releaseId.tgz" -Algorithm SHA256
```

记录 `releaseId` 和两个 SHA256。此时只完成本地准备，尚未连接服务器。

## 3. 取得连接许可并只读摸查

先按部署 skill 向用户展示并确认本次部署文档，再单独取得本次 SSH/SCP 连接许可。许可前不能运行 `ssh`、`scp` 或任何服务器命令。

取得许可后，先只读检查目标目录、现有容器、8014 端口、Nginx 项目块、磁盘空间、Nginx worker 用户和当前备份列表；确认没有路径或资源冲突后才上传：

```powershell
scp "$packageDir/pantry-nook-frontend-$releaseId.tgz" root@182.92.205.147:/tmp/
scp "$packageDir/pantry-nook-backend-$releaseId.tgz" root@182.92.205.147:/tmp/
```

登录服务器后，先运行下面命令并与本机逐一核对：

```bash
RELEASE_ID=填入本机生成的releaseId
sha256sum "/tmp/pantry-nook-frontend-${RELEASE_ID}.tgz"
sha256sum "/tmp/pantry-nook-backend-${RELEASE_ID}.tgz"
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

备份 Nginx 配置时保存本次唯一文件名。以下命令必须在同一个 shell 中运行：

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
BACKEND_DIR=/data/pantry-nook
BACKEND_STAGE="/data/pantry-nook.stage.${RELEASE_ID}"
BACKEND_BACKUP="/data/pantry-nook.bak.${RELEASE_ID}"
FRONTEND_DIR=/usr/local/nginx/html/pantry-nook
FRONTEND_STAGE="/usr/local/nginx/html/pantry-nook.stage.${RELEASE_ID}"
FRONTEND_BACKUP="/usr/local/nginx/html/pantry-nook.bak.${RELEASE_ID}"
NGINX_BACKUP="/usr/local/nginx/cert.d/preview.conf.bak.${RELEASE_ID}"

[ "${BACKEND_DIR}" = "/data/pantry-nook" ] || exit 1
[ "${FRONTEND_DIR}" = "/usr/local/nginx/html/pantry-nook" ] || exit 1
for path in "${BACKEND_STAGE}" "${FRONTEND_STAGE}" "${BACKEND_BACKUP}" "${FRONTEND_BACKUP}"; do
  test ! -e "${path}" || { echo "RELEASE_ID 已使用或目标已存在：${path}" >&2; exit 1; }
done
test -f "/tmp/pantry-nook-backend-${RELEASE_ID}.tgz"
test -f "/tmp/pantry-nook-frontend-${RELEASE_ID}.tgz"

mkdir -p "${BACKEND_STAGE}" "${FRONTEND_STAGE}"
tar -xzf "/tmp/pantry-nook-backend-${RELEASE_ID}.tgz" -C "${BACKEND_STAGE}"
tar -xzf "/tmp/pantry-nook-frontend-${RELEASE_ID}.tgz" -C "${FRONTEND_STAGE}"
test -f "${BACKEND_STAGE}/docker-compose.yml"
test -f "${BACKEND_STAGE}/backend/Dockerfile"
test -f "${FRONTEND_STAGE}/index.html"
find "${FRONTEND_STAGE}/assets" -maxdepth 1 -type f | grep -q .

test -f "${BACKEND_DIR}/.env"
cp -a "${BACKEND_DIR}/.env" "${BACKEND_STAGE}/.env"

if [ -e "${BACKEND_DIR}" ]; then mv "${BACKEND_DIR}" "${BACKEND_BACKUP}"; fi
mv "${BACKEND_STAGE}" "${BACKEND_DIR}"
if [ -e "${FRONTEND_DIR}" ]; then mv "${FRONTEND_DIR}" "${FRONTEND_BACKUP}"; fi
mv "${FRONTEND_STAGE}" "${FRONTEND_DIR}"

find "${FRONTEND_DIR}" -type d -exec chmod 755 {} \;
find "${FRONTEND_DIR}" -type f -exec chmod 644 {} \;
cd "${BACKEND_DIR}"
docker compose --env-file .env -f docker-compose.yml up -d --build

printf 'release=%s\nbackend_backup=%s\nfrontend_backup=%s\nnginx_backup=%s\n' \
  "${RELEASE_ID}" "${BACKEND_BACKUP}" "${FRONTEND_BACKUP}" "${NGINX_BACKUP}" \
  | tee "${BACKEND_DIR}/DEPLOYED_RELEASE.txt"
```

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

先读取 `/data/pantry-nook/DEPLOYED_RELEASE.txt`，人工核对三个路径正好对应要撤销的 `RELEASE_ID`。确认后在同一个 shell 中填入精确路径执行，禁止使用通配符：

```bash
set -euo pipefail
ROLLBACK_ID=$(date +%Y%m%d-%H%M%S)
TARGET_RELEASE_ID=填入DEPLOYED_RELEASE记录中的release
BACKEND_DIR=/data/pantry-nook
FRONTEND_DIR=/usr/local/nginx/html/pantry-nook
NGINX_CONF=/usr/local/nginx/cert.d/preview.conf
[[ "${TARGET_RELEASE_ID}" =~ ^[0-9]{8}-[0-9]{6}$ ]] || { echo "release 格式错误" >&2; exit 1; }
BACKEND_BACKUP="/data/pantry-nook.bak.${TARGET_RELEASE_ID}"
FRONTEND_BACKUP="/usr/local/nginx/html/pantry-nook.bak.${TARGET_RELEASE_ID}"
NGINX_BACKUP="/usr/local/nginx/cert.d/preview.conf.bak.${TARGET_RELEASE_ID}"
FAILED_BACKEND="/data/pantry-nook.failed.${ROLLBACK_ID}"
FAILED_FRONTEND="/usr/local/nginx/html/pantry-nook.failed.${ROLLBACK_ID}"
FAILED_NGINX="/usr/local/nginx/cert.d/preview.conf.failed.${ROLLBACK_ID}"

test -d "${BACKEND_BACKUP}" && test -d "${FRONTEND_BACKUP}" && test -f "${NGINX_BACKUP}"
test ! -e "${FAILED_BACKEND}" && test ! -e "${FAILED_FRONTEND}" && test ! -e "${FAILED_NGINX}"
cd "${BACKEND_DIR}"
docker compose --env-file .env -f docker-compose.yml down
mv "${BACKEND_DIR}" "${FAILED_BACKEND}"
mv "${BACKEND_BACKUP}" "${BACKEND_DIR}"
mv "${FRONTEND_DIR}" "${FAILED_FRONTEND}"
mv "${FRONTEND_BACKUP}" "${FRONTEND_DIR}"
cp -a "${NGINX_CONF}" "${FAILED_NGINX}"
cp -a "${NGINX_BACKUP}" "${NGINX_CONF}"

cd "${BACKEND_DIR}"
docker compose --env-file .env -f docker-compose.yml up -d --build
/usr/local/nginx/sbin/nginx -t
/usr/local/nginx/sbin/nginx -s reload
```

回滚后执行全部发布后验证，并记录 `FAILED_BACKEND`、`FAILED_FRONTEND`、`FAILED_NGINX` 以便审计。

- 回滚仍必须保留项目级 Basic Auth，不得通过移除鉴权恢复页面。
- 数据库卷不随普通代码回滚删除；持久生产卷不得在部署流程中删除。只有经证明为 disposable demo/test 的卷，才可在单独数据维护任务中精确处理。
- 每次发布记录 `RELEASE_ID`、Git 状态/提交、包 SHA256、三个备份路径、验证结果、故障与未覆盖项。
