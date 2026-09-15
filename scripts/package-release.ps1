param(
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-DirectoryTreeHash([string]$Path) {
  $entries = Get-ChildItem -LiteralPath $Path -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($Path.Length).TrimStart('\').Replace('\', '/')
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$relative|$($_.Length)|$hash"
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($entries -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([Convert]::ToHexString($sha.ComputeHash($bytes))).ToLowerInvariant() } finally { $sha.Dispose() }
}

$project = (Resolve-Path -LiteralPath $ProjectDir).Path
$evidencePath = Join-Path $project '.review\release-preflight\evidence.json'
$packageRoot = Join-Path $project '.review\release-package'
$distDir = Join-Path $project 'frontend\dist'

& (Join-Path $PSScriptRoot 'check-version.ps1') -ProjectDir $project
$status = (& git -C $project status --porcelain)
Assert-True ($LASTEXITCODE -eq 0) '无法读取 Git 工作区状态。'
Assert-True (-not $status) '发布候选必须先提交并保持工作区干净。'
Assert-True (Test-Path -LiteralPath $evidencePath) '缺少当前候选的本地类生产预检证据，请先运行 scripts/preflight-release.ps1。'
Assert-True (Test-Path -LiteralPath (Join-Path $distDir 'index.html')) '缺少预检生成的 frontend/dist。'

$version = (Get-Content -LiteralPath (Join-Path $project 'VERSION') -Raw).Trim()
$commit = (& git -C $project rev-parse HEAD).Trim()
Assert-True ($LASTEXITCODE -eq 0 -and $commit -match '^[0-9a-f]{40}$') '无法读取完整 Git commit。'
$shortSha = (& git -C $project rev-parse --short=12 HEAD).Trim()
Assert-True ($LASTEXITCODE -eq 0 -and $shortSha -match '^[0-9a-f]{12}$') '无法读取短 Git commit。'
$evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
Assert-True ($evidence.result -eq 'passed') '本地类生产预检结果不是 passed。'
Assert-True ($evidence.commit -eq $commit) '本地类生产预检证据不属于当前 commit，请重新运行预检。'
Assert-True ($evidence.version -eq $version) '本地类生产预检证据的版本与当前 VERSION 不一致。'
Assert-True ($evidence.frontend_tree_sha256 -eq (Get-DirectoryTreeHash $distDir)) 'frontend/dist 已在预检后变化，请重新运行预检。'
Assert-True ($evidence.nginx_config_sha256 -eq (Get-FileHash -LiteralPath (Join-Path $project 'scripts\release-preflight\nginx.conf') -Algorithm SHA256).Hash.ToLowerInvariant()) '预检 Nginx 配置已变化，请重新运行预检。'
Assert-True ($evidence.docker_compose_sha256 -eq (Get-FileHash -LiteralPath (Join-Path $project 'docker-compose.yml') -Algorithm SHA256).Hash.ToLowerInvariant()) 'Docker Compose 已在预检后变化，请重新运行预检。'
Assert-True ($evidence.uv_lock_sha256 -eq (Get-FileHash -LiteralPath (Join-Path $project 'backend\uv.lock') -Algorithm SHA256).Hash.ToLowerInvariant()) 'uv.lock 已在预检后变化，请重新运行预检。'

$localImage = 'pantry-nook-backend:local'
$localImageId = (& docker image inspect $localImage --format '{{.Id}}').Trim()
Assert-True ($LASTEXITCODE -eq 0 -and $localImageId -eq $evidence.backend_image_id) '本地后端镜像与预检证据不一致，请重新运行预检。'

$utcStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$releaseId = "$version-$utcStamp-$shortSha"
$imageTag = $releaseId.Replace('+', '-build.')
Assert-True ($imageTag -match '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') "Docker image tag 非法或过长：$imageTag"
$releaseDir = Join-Path $packageRoot $releaseId
Assert-True (-not (Test-Path -LiteralPath $releaseDir)) "Release 目录已存在：$releaseDir"
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$frontendName = "pantry-nook-frontend-$releaseId.tgz"
$backendName = "pantry-nook-backend-$releaseId.tgz"
$imageName = "pantry-nook-backend-image-$releaseId.tar.gz"
$manifestName = "pantry-nook-release-$releaseId.json"
$frontendPath = Join-Path $releaseDir $frontendName
$backendPath = Join-Path $releaseDir $backendName
$imagePath = Join-Path $releaseDir $imageName
$manifestPath = Join-Path $releaseDir $manifestName
$rawImageName = "pantry-nook-backend-image-$releaseId.tar"
$rawImagePath = Join-Path $releaseDir $rawImageName

$releaseImage = "pantry-nook-backend:$imageTag"
try {
  & tar -czf $frontendPath -C $distDir .
  Assert-True ($LASTEXITCODE -eq 0) '前端发布包生成失败。'
  & tar -czf $backendPath `
    --exclude='backend/.env*' --exclude=backend/.venv --exclude=backend/.uv-cache `
    --exclude=backend/.pytest_cache --exclude=backend/.backups `
    --exclude='*/__pycache__' --exclude='*.pyc' `
    -C $project docker-compose.yml backend scripts/server-release-record.py
  Assert-True ($LASTEXITCODE -eq 0) '后端源代码发布包生成失败。'

  & docker image tag $localImage $releaseImage
  Assert-True ($LASTEXITCODE -eq 0) '后端候选镜像标记失败。'
  & docker image save --output $rawImagePath $releaseImage
  Assert-True ($LASTEXITCODE -eq 0) '后端候选镜像导出失败。'
  & tar -czf $imagePath -C $releaseDir $rawImageName
  Assert-True ($LASTEXITCODE -eq 0) '后端候选镜像压缩失败。'
  Remove-Item -LiteralPath $rawImagePath -Force

  $backendEntries = @(& tar -tzf $backendPath)
  Assert-True ($LASTEXITCODE -eq 0) '无法检查后端发布包内容。'
  $secretEntries = @($backendEntries | Where-Object { $_ -match '(^|/)\.env($|\.)' })
  Assert-True ($secretEntries.Count -eq 0) "后端发布包包含环境文件：$($secretEntries -join ', ')"

  $frontendHash = (Get-FileHash -LiteralPath $frontendPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $backendHash = (Get-FileHash -LiteralPath $backendPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $imageHash = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $uvLockHash = (Get-FileHash -LiteralPath (Join-Path $project 'backend\uv.lock') -Algorithm SHA256).Hash.ToLowerInvariant()
  $composeHash = (Get-FileHash -LiteralPath (Join-Path $project 'docker-compose.yml') -Algorithm SHA256).Hash.ToLowerInvariant()
  $releaseImageId = (& docker image inspect $releaseImage --format '{{.Id}}').Trim()
  Assert-True ($LASTEXITCODE -eq 0 -and $releaseImageId -match '^sha256:[0-9a-f]{64}$') '无法读取发布镜像 ID。'
  $releaseImagePlatform = (& docker image inspect $releaseImage --format '{{.Os}}/{{.Architecture}}').Trim()
  Assert-True ($LASTEXITCODE -eq 0 -and $releaseImagePlatform -match '^linux/(amd64|arm64)$') '发布镜像不是受支持的 Linux 平台。'
  $migrations = @(Get-ChildItem -LiteralPath (Join-Path $project 'backend\migrations') -File -Filter '*.sql' | Sort-Object Name | ForEach-Object {
    $content = (Get-Content -LiteralPath $_.FullName -Raw).Replace("`r`n", "`n").Replace("`r", "`n")
    $bytes = [Text.Encoding]::UTF8.GetBytes($content)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $checksum = ([Convert]::ToHexString($sha.ComputeHash($bytes))).ToLowerInvariant() } finally { $sha.Dispose() }
    [ordered]@{ file = $_.Name; sha256 = $checksum }
  })

  [ordered]@{
    manifest_version = 1
    project = 'pantry-nook'
    version = $version
    commit = $commit
    clean = $true
    release_id = $releaseId
    created_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    local_preflight = [ordered]@{
      result = $evidence.result
      completed_at_utc = $evidence.completed_at_utc
    }
    artifacts = [ordered]@{
      frontend = [ordered]@{ file = $frontendName; sha256 = $frontendHash }
      backend_source = [ordered]@{ file = $backendName; sha256 = $backendHash }
      backend_image = [ordered]@{ file = $imageName; sha256 = $imageHash; image = $releaseImage; tag = $imageTag; image_id = $releaseImageId; platform = $releaseImagePlatform }
    }
    inputs = [ordered]@{
      uv_lock_sha256 = $uvLockHash
      docker_compose_sha256 = $composeHash
      migrations = $migrations
    }
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

  $releaseFiles = @(Get-ChildItem -LiteralPath $releaseDir -File)
  Assert-True ($releaseFiles.Count -eq 4) "发布目录应正好包含 4 个文件，实际为 $($releaseFiles.Count)。"
} catch {
  & docker image rm $releaseImage 2>$null | Out-Null
  Remove-Item -LiteralPath $releaseDir -Recurse -Force -ErrorAction SilentlyContinue
  throw
} finally {
  Remove-Item -LiteralPath $rawImagePath -Force -ErrorAction SilentlyContinue
}

Write-Output "RELEASE_ID=$releaseId"
Write-Output "RELEASE_DIR=$releaseDir"
Write-Output "FRONTEND_SHA256=$frontendHash"
Write-Output "BACKEND_SHA256=$backendHash"
Write-Output "IMAGE_SHA256=$imageHash"
Write-Output "IMAGE_ID=$releaseImageId"
Write-Output "IMAGE_TAG=$imageTag"
Write-Output "MANIFEST=$manifestPath"
