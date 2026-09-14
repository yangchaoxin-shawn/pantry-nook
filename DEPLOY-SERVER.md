# Pantry Nook 服务器部署执行文档（v1）

## 部署前提（本次确认口径）

- 部署形态：前后端分离（Nginx 托管前端 + Docker 跑后端）
- 目标服务器：`182.92.205.147`（按你提供的公司服务器约定）
- 目标域名：`preview.aihuashen.com`
- 访问前缀：固定为 `/pantry-nook/`（用户访问 `https://preview.aihuashen.com/pantry-nook/` 即项目入口）
- 项目名/后端目录：`pantry-nook`
- 前端目录：`/usr/local/nginx/html/pantry-nook/`
- 后端端口：`8014`（映射为 `127.0.0.1:8014:3000`）
- 打包基路径：`/pantry-nook/`（避免静态资源跳到站点根）
- 单项目鉴权：仅该项目入口需要鉴权，非项目路径不受影响
- 鉴权账号：`040509`（主）；口令：`040509`
- 备用口令：`051221` 仅用于你手动改密时临时替换

## 本地预检（第 5 步前）

1. 确认环境变量：

```bash
cat .env.docker.local
# DB_PASSWORD=<强随机密码>
# FRONTEND_ORIGIN=http://localhost:3000
```

2. 运行本地空库启动检查（仅本机）：

```bash
pwsh ./scripts/preflight-docker-local.ps1
```

该脚本会做：

- 清理旧容器与 `pantry-db-data` 卷（保证空库）
- 构建并启动 `pantry-db` + `pantry-backend`
- 等待健康探针
- 访问 `http://127.0.0.1:8014/health`
- 打印容器状态和尾部日志

> 当前环境若 `docker compose` 与 docker 服务本身不可用，需要先在你的机器启动 Docker Desktop 后再复跑该脚本。

## 本地服务器发布包准备（本轮固定参数）

```powershell
# 1) 前端构建：基路径=/pantry-nook/，API 基路径=/pantry-nook 的同源调用
cd frontend
$env:PANTRY_WEB_BASE = '/pantry-nook/'
$env:VITE_API_BASE = '/pantry-nook'
npm run build

# 2) 回到仓库根并复用本地预检配置
cd ..
Get-Content .env.docker.local
```

> 产物在 `frontend/dist/`。

## Nginx 鉴权与反代（仅本项目）

### 1）在服务器生成 `.htpasswd`

```bash
sudo apt-get install -y apache2-utils
sudo htpasswd -bc /usr/local/nginx/.pantry-nook.htpasswd 040509 040509
```

> `051221` 只作为你指定的备用口令。日后改主口令时，按需手工替换到 `.pantry-nook.htpasswd`。

### 2）在 `/usr/local/nginx/cert.d/preview.conf` 中只改本项目块

```nginx
    location = /pantry-nook {
        return 302 /pantry-nook/;
    }

    # API：与前端同路径走 /pantry-nook/api，默认走后端 8014
    location /pantry-nook/api/ {
        auth_basic "Private Area";
        auth_basic_user_file /usr/local/nginx/.pantry-nook.htpasswd;
        # 将 /pantry-nook/api/... 重写到后端 /api/...，兼容前端的同路径路由
        rewrite ^/pantry-nook/api/(.*)$ /$1 break;
        proxy_pass http://127.0.0.1:8014;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # /pantry-nook/ 页面与静态资源（受鉴权）
    location ^~ /pantry-nook/ {
        auth_basic "Private Area";
        auth_basic_user_file /usr/local/nginx/.pantry-nook.htpasswd;
        alias /usr/local/nginx/html/pantry-nook/;
        index index.html index.htm;
        try_files $uri $uri/ /pantry-nook/index.html;
    }
```

### 3）最小生效流程（在服务器执行）

```bash
cp /usr/local/nginx/cert.d/preview.conf /usr/local/nginx/cert.d/preview.conf.bak.$(date +%F_%H%M%S)
# 在服务器上仅精确编辑 /usr/local/nginx/cert.d/preview.conf 的上述块
sed -n '1,260p' /usr/local/nginx/cert.d/preview.conf | sed -n '/location = \/pantry-nook/,/location \/cityos\/admin/p'
diff /usr/local/nginx/cert.d/preview.conf.bak.* /usr/local/nginx/cert.d/preview.conf
/usr/local/nginx/sbin/nginx -t
/usr/local/nginx/sbin/nginx -s reload
```

## 本次关键部署清单

- 后端发布到 `/data/pantry-nook/`
- 前端发布到 `/usr/local/nginx/html/pantry-nook/`
- 后端配置文件 `/data/pantry-nook/.env` 内容示例（示意）：

```bash
DB_HOST=pantry-db
DB_PORT=5432
DB_NAME=pantry_nook
DB_USER=postgres
DB_PASSWORD=<你要设定的生产密码>
PORT=3000
FRONTEND_ORIGIN=https://preview.aihuashen.com
```

- 运行：`cd /data/pantry-nook && docker compose --env-file .env -f docker-compose.yml up -d --build`
- 校验：`docker ps`、`docker compose ps`、`/usr/local/nginx/sbin/nginx -t`、访问与鉴权验证。

## 验证项（最小）

1. 直接访问 `https://preview.aihuashen.com/pantry-nook/` 返回鉴权弹窗（401 场景）
2. 输入 `040509 / 040509` 后返回 200 且页面可正常运行
3. `https://preview.aihuashen.com/pantry-nook/api/health` 与 `curl -u 040509:040509 https://preview.aihuashen.com/pantry-nook/api/health` 可达
4. `curl http://127.0.0.1:8014/health` 在宿主机可达（后端健康）
5. `docker ps` 后端容器 `pantry-backend` 健康态为 `healthy`

## 风险点与回滚

- 鉴权密码由你控制；变更口令只需更新 `/usr/local/nginx/.pantry-nook.htpasswd` 即可
- 鉴权块只在 `/pantry-nook/` 与 `/pantry-nook/api/` 生效，便于回滚：去掉该 location 即可恢复公开入口
- 代码或配置改错可先备份再回退：`preview.conf.bak.*` 与 `/data/pantry-nook` 旧目录
