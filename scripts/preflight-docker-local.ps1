param(
  [string]$ProjectDir = (Get-Location).Path,
  [string]$EnvFile = ".env.docker.local"
)

$ErrorActionPreference = 'Stop'

Set-Location $ProjectDir
$deadline = (Get-Date).AddMinutes(2)

if (-not (Test-Path $EnvFile)) {
  throw "未找到 $EnvFile，请先创建并填入 DB_PASSWORD / FRONTEND_ORIGIN。"
}

# 避免宿主机配置目录权限问题
$env:DOCKER_CONFIG = Join-Path $env:TEMP 'docker-temp-config'
New-Item -ItemType Directory -Force -Path $env:DOCKER_CONFIG | Out-Null

function Wait-DockerDaemon {
  Write-Host "[0/6] 检查 docker daemon 是否可用（2 分钟内）"
  while ($true) {
    try {
      docker version --format '{{.Server.Version}}' | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "docker daemon 已就绪。"
        return
      }
    } catch {
      # ignore and retry
    }
    if ((Get-Date) -gt $deadline) {
      throw 'docker daemon 在 2 分钟内未就绪。请先在本机启动 Docker Desktop，再重试。'
    }
    Start-Sleep -Seconds 2
  }
}

Wait-DockerDaemon

Write-Host "[1/6] 先清理旧容器并清空命名卷（保证空库）"
docker compose --env-file $EnvFile down -v

Write-Host "[2/6] 启动 PostgreSQL 与 backend"
docker compose --env-file $EnvFile up -d --build

Write-Host "[3/6] 等待服务变为健康"
$deadline = (Get-Date).AddMinutes(5)
while ($true) {
  $state = docker compose --env-file $EnvFile ps 2>$null
  if ($LASTEXITCODE -ne 0) {
    Start-Sleep -Seconds 2
  } else {
    if ($state -match 'pantry-backend' -and $state -match 'healthy' -and $state -match 'pantry-db' -and $state -match 'healthy') {
      Write-Host '服务均已健康。'
      break
    }
  }

  if ((Get-Date) -gt $deadline) {
    throw '等待服务健康超时（5 分钟）。请先检查 docker compose logs。'
  }
  Start-Sleep -Seconds 2
}

Write-Host "[4/6] 校验后端健康"
$health = Invoke-RestMethod -Uri http://127.0.0.1:8014/health
$health | ConvertTo-Json -Compress | Write-Host

Write-Host "[5/6] 输出容器状态"
docker compose --env-file $EnvFile ps

docker compose --env-file $EnvFile logs --tail=60 pantry-backend

docker compose --env-file $EnvFile logs --tail=60 pantry-db

Write-Host "[6/6] 预检完成。"
