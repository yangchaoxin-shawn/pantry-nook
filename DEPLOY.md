# 食隅记 Pantry Nook 部署说明

## 当前部署约定

- **本地开发**：原生 PostgreSQL + Node.js + React/Vite，纯命令启动，不使用 Docker。
- **生产后端**：使用 Docker 运行 Node.js API。
- **生产前端**：构建为静态文件，由服务器本机安装的 Nginx 托管，不使用 Nginx 容器。
- **数据库**：生产环境可以使用服务器 PostgreSQL，也可以使用受保护的 PostgreSQL 容器；不要把数据库端口暴露到公网。

## 一、本地开发

### 1. 初始化数据库

确认 PostgreSQL 服务已经运行，然后初始化数据库（自动创建 `pantry_nook` 并导入表结构）：

```powershell
cd backend
Copy-Item .env.example .env
# 编辑 .env，填写本机 PostgreSQL 密码
node scripts/init-db.js
```

> init-db.js 对已存在的表使用 CREATE IF NOT EXISTS，不会删除已有数据。

### 2. 启动后端

```powershell
cd backend
Copy-Item .env.example .env
# 编辑 .env，填写 PostgreSQL 密码
npm install
npm run dev
```

后端地址：`http://localhost:3000`

验证：

```powershell
Invoke-RestMethod http://localhost:3000/health
```

预期：

```json
{"status":"ok","database":"connected"}
```

### 3. 启动前端

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

前端地址：`http://localhost:5173`

> 当前前端是早期临时页面，后端需求确认后会重新设计，因此暂时不要把它作为最终界面验收版本。

## 二、上传项目到服务器

建议上传整个项目，但不要上传本地 `.env`、`node_modules` 和 `dist`：

```bash
scp -r backend docs docker-compose.yml nginx.conf.example README.md user@your-server:/opt/pantry-nook/
```

也可以使用 Git 仓库拉取项目。

## 三、生产启动后端

### 方案 A：使用项目中的 Docker Compose

当前 `docker-compose.yml` 只负责后端和 PostgreSQL 容器，不包含前端和 Nginx。

在项目根目录创建 `.env`：

```env
DB_PASSWORD=生产环境强密码
FRONTEND_ORIGIN=https://你的域名
```

启动：

```bash
cd /opt/pantry-nook
docker compose up -d --build
```

检查：

```bash
curl http://127.0.0.1:3000/health
```

首次启动 PostgreSQL 容器时会自动执行 `backend/src/db/schema.sql`。如果数据库卷已经存在，修改 schema 文件不会自动重跑，需要使用正式迁移流程。

### 方案 B：使用服务器本机 PostgreSQL

如果服务器已经安装 PostgreSQL，可以只构建并启动后端容器，并把后端环境变量改为服务器数据库地址。此时需要根据服务器网络配置调整 `DB_HOST`，并确保：

- PostgreSQL 只监听内网或本机地址。
- 防火墙不开放 5432 公网访问。
- 数据库用户只授予应用需要的权限。
- 先在目标数据库执行正式迁移脚本。

## 四、构建前端静态文件

前端构建时需要把 API 地址写入构建产物。推荐让前端和后端使用同一个域名，通过 Nginx 的 `/api/` 代理后端，这样前端只需要使用相对路径配置：

```env
VITE_API_BASE=
```

然后构建：

```bash
cd /opt/pantry-nook/frontend
npm install
npm run build
```

产物位于：

```text
frontend/dist/
```

复制到 Nginx 静态目录：

```bash
sudo mkdir -p /var/www/pantry-nook
sudo cp -r dist/* /var/www/pantry-nook/
```

## 五、配置服务器本机 Nginx

复制配置：

```bash
sudo cp /opt/pantry-nook/nginx.conf.example /etc/nginx/sites-available/pantry-nook
sudo nano /etc/nginx/sites-available/pantry-nook
```

把 `yourdomain.com` 改为真实域名，把证书路径改为实际路径，然后启用：

```bash
sudo ln -s /etc/nginx/sites-available/pantry-nook /etc/nginx/sites-enabled/pantry-nook
sudo nginx -t
sudo systemctl reload nginx
```

Nginx 配置做两件事：

1. `/` 托管 `/var/www/pantry-nook` 下的前端静态文件。
2. `/api/` 代理到 `http://127.0.0.1:3000`。

## 六、配置 HTTPS

可以使用 Certbot：

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

HTTPS 正常后，再在手机浏览器打开域名，并使用“添加到主屏幕”。

## 七、正式上线前检查

- [ ] 后端 `.env` 没有提交到仓库。
- [ ] 已更换开发环境数据库密码。
- [ ] 已启用 HTTPS。
- [ ] 已增加单用户登录或其他可靠访问控制。
- [ ] PostgreSQL 5432 没有暴露到公网。
- [ ] 已配置数据库定期备份。
- [ ] 已实际验证一次备份恢复。
- [ ] 已验证 Nginx 的 SPA fallback。
- [ ] 已验证 `/api/health` 或 `/health` 的代理路径。
- [ ] 已验证手机、iPad 和 Windows 浏览器访问。
