param(
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot),
  [string]$EnvFile = ".env.docker.local",
  [int]$WebPort = 18080,
  [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'
$composeProject = 'pantry-nook-release-preflight'
$backendPort = 18014
$nginxContainer = "$composeProject-nginx"
$runtimeDir = Join-Path $ProjectDir '.review\release-preflight'
$distDir = Join-Path $ProjectDir 'frontend\dist'
$nginxConfig = Join-Path $ProjectDir 'scripts\release-preflight\nginx.conf'
$envPath = Join-Path $ProjectDir $EnvFile
$evidencePath = Join-Path $runtimeDir 'evidence.json'
$evidenceTempPath = Join-Path $runtimeDir 'evidence.json.tmp'

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

function Set-ProcessVariable([string]$Name, [AllowNull()][string]$Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Get-Response([string]$Uri, [hashtable]$Headers = @{}) {
  Invoke-WebRequest -Uri $Uri -Headers $Headers -SkipHttpErrorCheck -TimeoutSec 20
}

function Assert-JsonList([string]$Uri, [hashtable]$Headers) {
  $response = Get-Response $Uri $Headers
  Assert-True ($response.StatusCode -eq 200) "$Uri 未返回 200，实际为 $($response.StatusCode)。"
  $contentType = [string]$response.Headers['Content-Type']
  Assert-True ($contentType -match '^application/json') "$Uri 未返回 JSON，实际 Content-Type 为 $contentType。"
  $payload = $response.Content | ConvertFrom-Json
  Assert-True ($null -ne $payload.PSObject.Properties['data']) "$Uri 的响应缺少 data 字段。"
  return $payload
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

Set-Location $ProjectDir
Assert-True (Test-Path $envPath) "未找到 $envPath。"
Assert-True (Test-Path $nginxConfig) "未找到 $nginxConfig。"
& (Join-Path $PSScriptRoot 'check-version.ps1') -ProjectDir $ProjectDir
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Remove-Item -LiteralPath $evidencePath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $evidenceTempPath -Force -ErrorAction SilentlyContinue
$evidencePayload = $null

$passwordBytes = [Text.Encoding]::UTF8.GetBytes('preflight')
$sha1 = [Security.Cryptography.SHA1]::Create()
try {
  $passwordHash = [Convert]::ToBase64String($sha1.ComputeHash($passwordBytes))
} finally {
  $sha1.Dispose()
}
$htpasswdPath = Join-Path $runtimeDir 'pantry-nook.htpasswd'
Set-Content -LiteralPath $htpasswdPath -Value "preflight:{SHA}$passwordHash" -NoNewline

try {
  Write-Host '[1/7] 启动测试专用空库与 Docker 后端'
  & (Join-Path $PSScriptRoot 'preflight-docker-local.ps1') -ProjectDir $ProjectDir -EnvFile $EnvFile -ComposeProject $composeProject -BackendPort $BackendPort -FrontendOrigin "http://127.0.0.1:$WebPort"

  Write-Host '[2/7] 使用固定生产子路径构建前端'
  $previousWebBase = [Environment]::GetEnvironmentVariable('PANTRY_WEB_BASE', 'Process')
  $previousApiBase = [Environment]::GetEnvironmentVariable('VITE_API_BASE', 'Process')
  Set-ProcessVariable 'PANTRY_WEB_BASE' '/pantry-nook/'
  Set-ProcessVariable 'VITE_API_BASE' '/pantry-nook'
  Push-Location (Join-Path $ProjectDir 'frontend')
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw '前端生产构建失败。' }
  } finally {
    Pop-Location
    Set-ProcessVariable 'PANTRY_WEB_BASE' $previousWebBase
    Set-ProcessVariable 'VITE_API_BASE' $previousApiBase
  }

  $indexPath = Join-Path $distDir 'index.html'
  Assert-True (Test-Path $indexPath) '构建产物缺少 index.html。'
  $indexHtml = Get-Content -Raw $indexPath
  Assert-True ($indexHtml -match '/pantry-nook/assets/') 'index.html 未使用 /pantry-nook/assets/ 子路径。'
  Assert-True ($indexHtml -notmatch '(?:src|href)="/assets/') 'index.html 仍含站点根 /assets/ 路径。'
  Assert-True ($indexHtml -match '/pantry-nook/favicon\.svg') 'favicon 未使用 /pantry-nook/ 子路径。'
  $builtJavascript = Get-ChildItem (Join-Path $distDir 'assets') -Filter '*.js' | ForEach-Object { Get-Content -Raw $_.FullName }
  Assert-True (($builtJavascript -join "`n") -match '/pantry-nook') '构建后的 JavaScript 未固化 /pantry-nook API 基路径。'

  Write-Host '[3/7] 启动本地 Nginx，复现正式子路径、鉴权、SPA 与 API 代理'
  & docker inspect $nginxContainer 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Invoke-Docker @('rm', '-f', $nginxContainer) '删除旧的预检 Nginx 容器失败' | Out-Null
  }
  Invoke-Docker @(
    'run', '-d', '--name', $nginxContainer,
    '--add-host', 'host.docker.internal:host-gateway',
    '-p', "127.0.0.1:${WebPort}:80",
    '-v', "${distDir}:/usr/share/nginx/html/pantry-nook:ro",
    '-v', "${nginxConfig}:/etc/nginx/conf.d/default.conf:ro",
    '-v', "${htpasswdPath}:/etc/nginx/pantry-nook.htpasswd:ro",
    'nginx:1.27-alpine'
  ) '本地 Nginx 启动失败' | Out-Null

  $baseUri = "http://127.0.0.1:$WebPort"
  $authValue = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('preflight:preflight'))
  $authHeaders = @{ Authorization = "Basic $authValue" }
  $deadline = (Get-Date).AddSeconds(45)
  $anonymous = $null
  do {
    Start-Sleep -Milliseconds 500
    try {
      $anonymous = Get-Response "$baseUri/pantry-nook/"
    } catch {
      if ((Get-Date) -ge $deadline) { throw '本地 Nginx 在 45 秒内未就绪。' }
    }
  } while ($null -eq $anonymous)

  Write-Host '[4/7] 验证匿名拦截与登录后页面'
  Assert-True ($anonymous.StatusCode -eq 401) "匿名访问应为 401，实际为 $($anonymous.StatusCode)。"
  Assert-True ([string]$anonymous.Headers['WWW-Authenticate'] -match '^Basic') '匿名首页没有返回 Basic Auth challenge。'
  $homeResponse = Get-Response "$baseUri/pantry-nook/" $authHeaders
  Assert-True ($homeResponse.StatusCode -eq 200) '登录后的首页未返回 200。'
  Assert-True ([string]$homeResponse.Headers['Content-Type'] -match '^text/html') '首页未返回 HTML。'
  Assert-True ($homeResponse.Content -match '<div id="root"></div>') '首页正文不是 Pantry Nook 应用入口。'
  $spa = Get-Response "$baseUri/pantry-nook/inventory" $authHeaders
  Assert-True ($spa.StatusCode -eq 200 -and $spa.Content -match '<div id="root"></div>') 'SPA 子路由未正确回退首页。'

  Write-Host '[5/7] 验证实际 CSS、JavaScript、字体与不存在资源'
  $assetMatches = [regex]::Matches($homeResponse.Content, '/pantry-nook/assets/[^"'']+\.(?:css|js)')
  Assert-True ($assetMatches.Count -ge 2) '首页没有同时引用 CSS 与 JavaScript 产物。'
  foreach ($match in $assetMatches) {
    $assetPath = $match.Value
    $anonymousAsset = Get-Response "$baseUri$assetPath"
    Assert-True ($anonymousAsset.StatusCode -eq 401) "$assetPath 匿名访问未被鉴权拦截。"
    Assert-True ([string]$anonymousAsset.Headers['WWW-Authenticate'] -match '^Basic') "$assetPath 未返回 Basic Auth challenge。"
    $asset = Get-Response "$baseUri$assetPath" $authHeaders
    Assert-True ($asset.StatusCode -eq 200) "$assetPath 未返回 200。"
    $contentType = [string]$asset.Headers['Content-Type']
    if ($assetPath.EndsWith('.css')) {
      Assert-True ($contentType -match '^text/css') "$assetPath 的 Content-Type 不是 text/css，而是 $contentType。"
    } else {
      Assert-True ($contentType -match '^(application|text)/javascript') "$assetPath 的 Content-Type 不是 JavaScript，而是 $contentType。"
    }
    Assert-True ($asset.Content.TrimStart() -notmatch '^<!doctype html') "$assetPath 错误返回了首页 HTML。"
  }
  $fontFile = Get-ChildItem (Join-Path $distDir 'assets') -Filter '*.woff2' | Select-Object -First 1
  Assert-True ($null -ne $fontFile) '构建产物缺少字体文件。'
  $font = Get-Response "$baseUri/pantry-nook/assets/$($fontFile.Name)" $authHeaders
  Assert-True ($font.StatusCode -eq 200 -and [string]$font.Headers['Content-Type'] -match '^font/woff2') '字体未以 font/woff2 返回。'
  $missing = Get-Response "$baseUri/pantry-nook/assets/not-present.js" $authHeaders
  Assert-True ($missing.StatusCode -eq 404) '不存在的静态资源没有返回 404。'

  Write-Host '[6/7] 验证后端健康与六个真实列表接口'
  $health = Get-Response "http://127.0.0.1:$BackendPort/health"
  Assert-True ($health.StatusCode -eq 200 -and [string]$health.Headers['Content-Type'] -match '^application/json') '后端 /health 未返回 JSON 200。'
  $listPaths = @('ingredients', 'dishes', 'meal-plans', 'consumptions', 'inventory-adjustments', 'daily-battles')
  foreach ($path in $listPaths) {
    $uri = "$baseUri/pantry-nook/api/${path}?limit=100&offset=0"
    $anonymousApi = Get-Response $uri
    Assert-True ($anonymousApi.StatusCode -eq 401) "$uri 匿名访问未被鉴权拦截。"
    Assert-True ([string]$anonymousApi.Headers['WWW-Authenticate'] -match '^Basic') "$uri 未返回 Basic Auth challenge。"
    $payload = Assert-JsonList $uri $authHeaders
    Assert-True (@($payload.data).Count -eq 0) "$uri 预期为空库，但返回了数据。"
  }
  $soupItem = @{
    name = '预检石橄榄'
    category = '汤料'
    stock_text = '500'
    stock_value = 500
    stock_unit = 'g'
    location = '冰箱冷藏'
  }
  $soupBody = @{ items = @($soupItem); resolutions = @() } | ConvertTo-Json -Depth 4 -Compress
  $soupCreated = Invoke-WebRequest -Uri "$baseUri/pantry-nook/api/ingredients/batch" -Method Post -Headers $authHeaders `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($soupBody)) -SkipHttpErrorCheck -TimeoutSec 20
  Assert-True ($soupCreated.StatusCode -eq 201) "汤料写入未返回 201，实际为 $($soupCreated.StatusCode)。"
  $soupCreatedPayload = $soupCreated.Content | ConvertFrom-Json
  Assert-True (@($soupCreatedPayload.data).Count -eq 1 -and $soupCreatedPayload.data[0].category -eq '汤料') '汤料写入结果不正确。'
  $soupFiltered = Assert-JsonList "$baseUri/pantry-nook/api/ingredients?category=%E6%B1%A4%E6%96%99&limit=100&offset=0" $authHeaders
  Assert-True (@($soupFiltered.data).Count -eq 1 -and $soupFiltered.data[0].name -eq '预检石橄榄') '汤料筛选没有返回刚写入的食材。'
  $unknownBody = @{ items = @(@{ name = '预检未知食材'; category = '未知分类'; stock_text = '1'; stock_value = 1; stock_unit = '份' }); resolutions = @() } | ConvertTo-Json -Depth 4 -Compress
  $unknownCategory = Invoke-WebRequest -Uri "$baseUri/pantry-nook/api/ingredients/batch" -Method Post -Headers $authHeaders `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($unknownBody)) -SkipHttpErrorCheck -TimeoutSec 20
  Assert-True ($unknownCategory.StatusCode -eq 400) "未知分类未被拒绝，实际状态为 $($unknownCategory.StatusCode)。"
  $unknownPayload = $unknownCategory.Content | ConvertFrom-Json
  Assert-True ($unknownPayload.error.code -eq 'VALIDATION_ERROR') '未知分类没有返回 VALIDATION_ERROR。'
  $corsHeaders = $authHeaders.Clone()
  $corsHeaders['Origin'] = "http://127.0.0.1:$WebPort"
  $corsResponse = Get-Response "$baseUri/pantry-nook/api/ingredients?limit=1&offset=0" $corsHeaders
  Assert-True ([string]$corsResponse.Headers['Access-Control-Allow-Origin'] -eq "http://127.0.0.1:$WebPort") '后端未允许本地类生产页面来源，FRONTEND_ORIGIN 可能错误。'
  $missingApi = Get-Response "$baseUri/pantry-nook/api/not-present" $authHeaders
  Assert-True ($missingApi.StatusCode -eq 404) '不存在的 API 未返回 404。'
  Assert-True ([string]$missingApi.Headers['Content-Type'] -match '^application/json') '不存在的 API 没有返回后端 JSON。'
  $missingPayload = $missingApi.Content | ConvertFrom-Json
  Assert-True ($missingPayload.error.code -eq 'ROUTE_NOT_FOUND') '不存在的 API 未返回 ROUTE_NOT_FOUND。'

  $gitStatus = (& git -C $ProjectDir status --porcelain)
  Assert-True ($LASTEXITCODE -eq 0) '无法读取 Git 工作区状态。'
  Assert-True (-not $gitStatus) '预检结束时工作区不干净，不能生成候选证据。'
  $fullCommit = (& git -C $ProjectDir rev-parse HEAD).Trim()
  Assert-True ($LASTEXITCODE -eq 0 -and $fullCommit -match '^[0-9a-f]{40}$') '无法读取准确 Git commit。'
  $version = (Get-Content -LiteralPath (Join-Path $ProjectDir 'VERSION') -Raw).Trim()
  $imageId = (& docker image inspect 'pantry-nook-backend:local' --format '{{.Id}}').Trim()
  Assert-True ($LASTEXITCODE -eq 0 -and $imageId -match '^sha256:[0-9a-f]{64}$') '无法读取本地预检后端镜像 ID。'
  $containerImageId = (& docker inspect "$composeProject-backend" --format '{{.Image}}').Trim()
  Assert-True ($LASTEXITCODE -eq 0 -and $containerImageId -eq $imageId) '预检后端容器与候选镜像 ID 不一致。'
  $evidencePayload = [ordered]@{
    result = 'passed'
    commit = $fullCommit
    version = $version
    completed_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    backend_image = 'pantry-nook-backend:local'
    backend_image_id = $imageId
    frontend_tree_sha256 = Get-DirectoryTreeHash $distDir
    nginx_config_sha256 = (Get-FileHash -LiteralPath $nginxConfig -Algorithm SHA256).Hash.ToLowerInvariant()
    docker_compose_sha256 = (Get-FileHash -LiteralPath (Join-Path $ProjectDir 'docker-compose.yml') -Algorithm SHA256).Hash.ToLowerInvariant()
    uv_lock_sha256 = (Get-FileHash -LiteralPath (Join-Path $ProjectDir 'backend\uv.lock') -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  Write-Host '[7/7] 发布预检通过：空库、Docker、子路径、鉴权、MIME、SPA 与真实 API 均已验证。'
} finally {
  if (-not $KeepRunning) {
    & docker inspect $nginxContainer 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Invoke-Docker @('rm', '-f', $nginxContainer) '清理预检 Nginx 容器失败' | Out-Null
    }
    & docker inspect $nginxContainer 2>$null | Out-Null
    Assert-True ($LASTEXITCODE -ne 0) "清理后仍存在容器 $nginxContainer。"
    & (Join-Path $PSScriptRoot 'preflight-docker-local.ps1') -ProjectDir $ProjectDir -EnvFile $EnvFile -ComposeProject $composeProject -BackendPort $BackendPort -FrontendOrigin "http://127.0.0.1:$WebPort" -CleanupOnly
    Write-Host '已核实测试专用 Nginx、后端、数据库容器与数据库卷均不存在。'
  } else {
    Write-Host "保留预检环境：http://127.0.0.1:$WebPort/pantry-nook/（preflight / preflight）"
  }
}

if ($KeepRunning) {
  Write-Host 'KeepRunning 模式不生成可用于正式打包的候选证据。'
} else {
  Assert-True ($null -ne $evidencePayload) '预检没有生成候选证据内容。'
  $evidencePayload | ConvertTo-Json | Set-Content -LiteralPath $evidenceTempPath -Encoding utf8
  Move-Item -LiteralPath $evidenceTempPath -Destination $evidencePath -Force
  Write-Host "候选证据已在清理核验后写入：$evidencePath"
}
