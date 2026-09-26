param(
  [string]$ProjectDir = (Get-Location).Path,
  [string]$EnvFile = ".env.docker.local",
  [string]$ComposeProject = "pantry-nook-release-preflight",
  [int]$BackendPort = 18014,
  [string]$FrontendOrigin = "http://127.0.0.1:18080",
  [switch]$CleanupOnly
)

$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Invoke-Docker([string[]]$Arguments, [string]$FailureMessage) {
  $output = & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage（docker 退出码 $LASTEXITCODE）。"
  }
  return $output
}

function Restore-ProcessEnvironment([hashtable]$Snapshot) {
  foreach ($name in $Snapshot.Keys) {
    $value = $Snapshot[$name]
    if ($null -eq $value) {
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    } else {
      [Environment]::SetEnvironmentVariable($name, [string]$value, 'Process')
    }
  }
}

Set-Location $ProjectDir
$envPath = Join-Path $ProjectDir $EnvFile
$dbContainer = "$ComposeProject-db"
$backendContainer = "$ComposeProject-backend"
$dbVolume = "$ComposeProject-db-data"
$mediaVolume = "$ComposeProject-media-data"
$safeProjectPattern = '^pantry-nook-release-preflight(?:-[a-z0-9-]+)?$'

# 这些硬约束必须在任何 down -v 之前执行，防止参数误传后碰到评审或生产资源。
Assert-True ($ComposeProject -match $safeProjectPattern) 'ComposeProject 必须使用 pantry-nook-release-preflight 测试前缀。'
Assert-True ($dbContainer -ne 'pantry-db' -and $backendContainer -ne 'pantry-backend') '预检容器名不能等于生产默认名。'
Assert-True ($dbVolume -ne 'pantry-db-data' -and $dbVolume -match 'release-preflight') '预检数据库卷名不安全。'
Assert-True ($mediaVolume -ne 'pantry-media-data' -and $mediaVolume -match 'release-preflight') '预检媒体卷名不安全。'
Assert-True ($BackendPort -ge 18000 -and $BackendPort -le 18999) '预检后端端口必须在 18000-18999。'
Assert-True ($FrontendOrigin -match '^http://127\.0\.0\.1:18\d{3}$') '预检 FRONTEND_ORIGIN 必须是 127.0.0.1 的 18000-18999 端口。'
Assert-True (Test-Path $envPath) "未找到 $envPath，请先创建并填入 DB_PASSWORD。"

$managedVariables = @(
  'COMPOSE_PROJECT_NAME',
  'PANTRY_DB_CONTAINER_NAME',
  'PANTRY_BACKEND_CONTAINER_NAME',
  'PANTRY_DB_VOLUME_NAME',
  'PANTRY_MEDIA_VOLUME_NAME',
  'PANTRY_BACKEND_BIND_PORT',
  'PANTRY_BACKEND_IMAGE_TAG',
  'FRONTEND_ORIGIN',
  'APP_ENV',
  'PANTRY_ALLOW_TEST_DATA',
  'DOCKER_CONFIG'
)
$previousEnvironment = @{}
foreach ($name in $managedVariables) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
  $env:COMPOSE_PROJECT_NAME = $ComposeProject
  $env:PANTRY_DB_CONTAINER_NAME = $dbContainer
  $env:PANTRY_BACKEND_CONTAINER_NAME = $backendContainer
  $env:PANTRY_DB_VOLUME_NAME = $dbVolume
  $env:PANTRY_MEDIA_VOLUME_NAME = $mediaVolume
  $env:PANTRY_BACKEND_BIND_PORT = $BackendPort.ToString()
  $env:PANTRY_BACKEND_IMAGE_TAG = 'local'
  $env:FRONTEND_ORIGIN = $FrontendOrigin
  $env:APP_ENV = 'test'
  $env:PANTRY_ALLOW_TEST_DATA = 'false'
  $env:DOCKER_CONFIG = Join-Path $env:TEMP 'docker-temp-config'
  New-Item -ItemType Directory -Force -Path $env:DOCKER_CONFIG | Out-Null

  $composePrefix = @('compose', '-p', $ComposeProject, '--env-file', $envPath)

  function Wait-DockerDaemon {
    Write-Host '[0/6] 检查 docker daemon 是否可用（2 分钟内）'
    $daemonDeadline = (Get-Date).AddMinutes(2)
    while ($true) {
      & docker version --format '{{.Server.Version}}' 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host 'docker daemon 已就绪。'
        return
      }
      if ((Get-Date) -gt $daemonDeadline) {
        throw 'docker daemon 在 2 分钟内未就绪。请先在本机启动 Docker Desktop，再重试。'
      }
      Start-Sleep -Seconds 2
    }
  }

  function Remove-TestStack {
    Invoke-Docker ($composePrefix + @('down', '-v', '--remove-orphans')) '清理测试专用 Compose 环境失败' | Out-Host

    & docker inspect $dbContainer 2>$null | Out-Null
    Assert-True ($LASTEXITCODE -ne 0) "清理后仍存在容器 $dbContainer。"
    & docker inspect $backendContainer 2>$null | Out-Null
    Assert-True ($LASTEXITCODE -ne 0) "清理后仍存在容器 $backendContainer。"
    & docker volume inspect $dbVolume 2>$null | Out-Null
    Assert-True ($LASTEXITCODE -ne 0) "清理后仍存在数据库卷 $dbVolume。"
    & docker volume inspect $mediaVolume 2>$null | Out-Null
    Assert-True ($LASTEXITCODE -ne 0) "清理后仍存在媒体卷 $mediaVolume。"
  }

  Wait-DockerDaemon

  if ($CleanupOnly) {
    Write-Host '[清理] 删除测试专用容器、数据库卷与媒体卷'
    Remove-TestStack
    Write-Host '已核实测试专用容器、数据库卷与媒体卷均不存在。'
    return
  }

  Write-Host '[1/6] 清理测试专用容器与测试卷（保证空库，不接触评审数据）'
  Remove-TestStack

  Write-Host '[2/6] 启动 PostgreSQL 与 backend'
  Invoke-Docker ($composePrefix + @('up', '-d', '--build')) '启动测试专用 PostgreSQL 与 backend 失败' | Out-Host
  Invoke-Docker @('inspect', $dbContainer) "未找到预期数据库容器 $dbContainer" | Out-Null
  Invoke-Docker @('inspect', $backendContainer) "未找到预期后端容器 $backendContainer" | Out-Null
  $expectedImageId = (& docker image inspect 'pantry-nook-backend:local' --format '{{.Id}}').Trim()
  Assert-True ($LASTEXITCODE -eq 0 -and $expectedImageId -match '^sha256:[0-9a-f]{64}$') '无法读取预检后端镜像 ID。'
  $containerImageId = (& docker inspect $backendContainer --format '{{.Image}}').Trim()
  Assert-True ($LASTEXITCODE -eq 0 -and $containerImageId -eq $expectedImageId) '预检容器没有运行本次构建的 pantry-nook-backend:local 镜像。'

  Write-Host '[3/6] 等待服务变为健康'
  $healthDeadline = (Get-Date).AddMinutes(5)
  while ($true) {
    $dbHealth = & docker inspect --format '{{.State.Health.Status}}' $dbContainer 2>$null
    $dbInspectExit = $LASTEXITCODE
    $backendHealth = & docker inspect --format '{{.State.Health.Status}}' $backendContainer 2>$null
    $backendInspectExit = $LASTEXITCODE
    if ($dbInspectExit -eq 0 -and $backendInspectExit -eq 0 -and $dbHealth -eq 'healthy' -and $backendHealth -eq 'healthy') {
      Write-Host '服务均已健康。'
      break
    }
    if ((Get-Date) -gt $healthDeadline) {
      throw '等待服务健康超时（5 分钟）。请检查测试专用 Compose 日志。'
    }
    Start-Sleep -Seconds 2
  }

  Write-Host '[4/6] 校验后端健康'
  $hostHealthDeadline = (Get-Date).AddSeconds(30)
  $health = $null
  while ($null -eq $health) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/health" -TimeoutSec 5
    } catch {
      if ((Get-Date) -gt $hostHealthDeadline) {
        throw "后端已标记 healthy，但 30 秒内无法稳定访问 http://127.0.0.1:$BackendPort/health。"
      }
      Start-Sleep -Seconds 1
    }
  }
  $health | ConvertTo-Json -Compress | Write-Host

  Write-Host '[5/6] 输出容器状态与日志'
  Invoke-Docker ($composePrefix + @('ps')) '读取测试专用容器状态失败' | Out-Host
  Invoke-Docker ($composePrefix + @('logs', '--tail=60', 'pantry-backend')) '读取测试后端日志失败' | Out-Host
  Invoke-Docker ($composePrefix + @('logs', '--tail=60', 'pantry-db')) '读取测试数据库日志失败' | Out-Host

  Write-Host '[6/6] Docker 空库预检完成。'
} finally {
  Restore-ProcessEnvironment $previousEnvironment
}
