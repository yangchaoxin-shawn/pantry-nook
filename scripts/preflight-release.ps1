param(
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot),
  [string]$EnvFile = ".env.docker.local",
  [int]$WebPort = 18080,
  [switch]$KeepRunning,
  [switch]$ValidationOnly
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
$disguisedVideoPath = Join-Path $runtimeDir 'disguised-video.jpg'

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

function Get-Response([string]$Uri, [hashtable]$Headers = @{}, [string]$Method = 'Get') {
  Invoke-WebRequest -Uri $Uri -Method $Method -Headers $Headers -SkipHttpErrorCheck -TimeoutSec 20
}

function Invoke-PhotoUpload([string]$Uri, [hashtable]$Headers, [string]$Path, [string]$UploadId) {
  $uploadHeaders = $Headers.Clone()
  $uploadHeaders['X-Upload-ID'] = $UploadId
  Invoke-WebRequest -Uri $Uri -Method Post -Headers $uploadHeaders -Form @{ file = Get-Item -LiteralPath $Path } `
    -SkipHttpErrorCheck -TimeoutSec 180
}

function Assert-MediaResponse([string]$Uri, [hashtable]$Headers, [string]$ExpectedType) {
  $response = Get-Response $Uri $Headers
  Assert-True ($response.StatusCode -eq 200) "$Uri 未返回 200，实际为 $($response.StatusCode)。"
  Assert-True ([string]$response.Headers['Content-Type'] -match $ExpectedType) "$Uri 的图片 MIME 不正确。"
  Assert-True ($response.RawContentLength -gt 0) "$Uri 返回了空图片。"
  $head = Get-Response $Uri $Headers 'Head'
  Assert-True ($head.StatusCode -eq 200) "$Uri 的 HEAD 未返回 200。"
  Assert-True ([string]$head.Headers['Content-Type'] -match $ExpectedType) "$Uri 的 HEAD 图片 MIME 不正确。"
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
Assert-True (-not ($KeepRunning -and $ValidationOnly)) 'KeepRunning 与 ValidationOnly 不能同时使用。'
& (Join-Path $PSScriptRoot 'check-version.ps1') -ProjectDir $ProjectDir
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
if (-not $KeepRunning -and -not $ValidationOnly) {
  Remove-Item -LiteralPath $evidencePath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $evidenceTempPath -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $disguisedVideoPath -Force -ErrorAction SilentlyContinue
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
  Write-Host '[1/8] 启动测试专用空库与 Docker 后端'
  & (Join-Path $PSScriptRoot 'preflight-docker-local.ps1') -ProjectDir $ProjectDir -EnvFile $EnvFile -ComposeProject $composeProject -BackendPort $BackendPort -FrontendOrigin "http://127.0.0.1:$WebPort"

  Write-Host '[2/8] 使用固定生产子路径构建前端'
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

  Write-Host '[3/8] 启动本地 Nginx，复现正式子路径、鉴权、SPA 与 API 代理'
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

  Write-Host '[4/8] 验证匿名拦截与登录后页面'
  Assert-True ($anonymous.StatusCode -eq 401) "匿名访问应为 401，实际为 $($anonymous.StatusCode)。"
  Assert-True ([string]$anonymous.Headers['WWW-Authenticate'] -match '^Basic') '匿名首页没有返回 Basic Auth challenge。'
  $homeResponse = Get-Response "$baseUri/pantry-nook/" $authHeaders
  Assert-True ($homeResponse.StatusCode -eq 200) '登录后的首页未返回 200。'
  Assert-True ([string]$homeResponse.Headers['Content-Type'] -match '^text/html') '首页未返回 HTML。'
  Assert-True ($homeResponse.Content -match '<div id="root"></div>') '首页正文不是 Pantry Nook 应用入口。'
  $spa = Get-Response "$baseUri/pantry-nook/inventory" $authHeaders
  Assert-True ($spa.StatusCode -eq 200 -and $spa.Content -match '<div id="root"></div>') 'SPA 子路由未正确回退首页。'

  Write-Host '[5/8] 验证实际 CSS、JavaScript、字体、手记分包与不存在资源'
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
  $journalAssets = Get-ChildItem (Join-Path $distDir 'assets') -File | Where-Object {
    $_.Name -match '^(JournalPage-.+\.(?:js|css)|table-memories-.+\.(?:png|webp))$'
  }
  Assert-True (@($journalAssets | Where-Object Extension -eq '.js').Count -gt 0) '构建产物缺少手记 JavaScript 分包。'
  Assert-True (@($journalAssets | Where-Object Extension -eq '.css').Count -gt 0) '构建产物缺少手记 CSS 分包。'
  Assert-True (@($journalAssets | Where-Object { $_.Name -match '^table-memories-' }).Count -gt 0) '构建产物缺少手记头图。'
  foreach ($file in $journalAssets) {
    $path = "/pantry-nook/assets/$($file.Name)"
    $anonymousAsset = Get-Response "$baseUri$path"
    Assert-True ($anonymousAsset.StatusCode -eq 401) "$path 匿名访问未被鉴权拦截。"
    $asset = Get-Response "$baseUri$path" $authHeaders
    Assert-True ($asset.StatusCode -eq 200 -and $asset.RawContentLength -gt 0) "$path 未返回有效正文。"
    $contentType = [string]$asset.Headers['Content-Type']
    switch ($file.Extension) {
      '.js' { Assert-True ($contentType -match '^(application|text)/javascript') "$path 的 JavaScript MIME 不正确。" }
      '.css' { Assert-True ($contentType -match '^text/css') "$path 的 CSS MIME 不正确。" }
      '.png' { Assert-True ($contentType -match '^image/png') "$path 的 PNG MIME 不正确。" }
      '.webp' { Assert-True ($contentType -match '^image/webp') "$path 的 WebP MIME 不正确。" }
    }
  }
  $missing = Get-Response "$baseUri/pantry-nook/assets/not-present.js" $authHeaders
  Assert-True ($missing.StatusCode -eq 404) '不存在的静态资源没有返回 404。'

  Write-Host '[6/8] 验证后端健康与七个真实列表接口（含手记）'
  $health = Get-Response "http://127.0.0.1:$BackendPort/health"
  Assert-True ($health.StatusCode -eq 200 -and [string]$health.Headers['Content-Type'] -match '^application/json') '后端 /health 未返回 JSON 200。'
  $listPaths = @('ingredients', 'dishes', 'meal-plans', 'consumptions', 'inventory-adjustments', 'daily-battles', 'journal/entries')
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

  Write-Host '[7/8] 验证图片经 Nginx 上传、鉴权、MIME、Range、拒绝伪装视频与媒体卷重启持久化'
  $photoPath = Join-Path $ProjectDir 'frontend\src\assets\journal\table-memories.png'
  Assert-True (Test-Path $photoPath) '缺少可重复使用的手记预检图片。'
  Assert-True ((Get-Item -LiteralPath $photoPath).Length -gt 1MB) '手记预检图片必须超过 1 MiB，才能覆盖 Nginx 上传限制。'
  $uploadUri = "$baseUri/pantry-nook/api/journal/uploads"
  $anonymousUpload = Invoke-PhotoUpload $uploadUri @{} $photoPath ([guid]::NewGuid().ToString())
  Assert-True ($anonymousUpload.StatusCode -eq 401) "匿名图片上传应为 401，实际为 $($anonymousUpload.StatusCode)。"
  Assert-True ([string]$anonymousUpload.Headers['WWW-Authenticate'] -match '^Basic') '匿名图片上传未返回 Basic Auth challenge。'
  $upload = Invoke-PhotoUpload $uploadUri $authHeaders $photoPath ([guid]::NewGuid().ToString())
  Assert-True ($upload.StatusCode -eq 201) "图片上传未返回 201，实际为 $($upload.StatusCode)。"
  Assert-True ([string]$upload.Headers['Content-Type'] -match '^application/json') '图片上传没有返回 JSON。'
  $uploaded = ($upload.Content | ConvertFrom-Json).data
  Assert-True ([string]$uploaded.id -match '^[0-9a-f-]{36}$') '图片上传结果缺少有效 ID。'
  $mediaUrls = @(
    @{ Name = 'original'; Url = "$baseUri/pantry-nook$($uploaded.original_url)"; Type = '^image/png' },
    @{ Name = 'preview'; Url = "$baseUri/pantry-nook$($uploaded.preview_url)"; Type = '^image/jpeg' },
    @{ Name = 'thumbnail'; Url = "$baseUri/pantry-nook$($uploaded.thumbnail_url)"; Type = '^image/jpeg' }
  )
  foreach ($media in $mediaUrls) {
    foreach ($request in @(
      @{ Method = 'Get'; Headers = @{} },
      @{ Method = 'Head'; Headers = @{} },
      @{ Method = 'Get'; Headers = @{ Range = 'bytes=0-15' } }
    )) {
      $anonymousMedia = Get-Response $media.Url $request.Headers $request.Method
      Assert-True ($anonymousMedia.StatusCode -eq 401) "$($media.Name) 的匿名 $($request.Method) 未被鉴权拦截。"
      Assert-True ([string]$anonymousMedia.Headers['WWW-Authenticate'] -match '^Basic') "$($media.Name) 匿名请求未返回 Basic Auth challenge。"
    }
    Assert-MediaResponse $media.Url $authHeaders $media.Type
  }
  $rangeHeaders = $authHeaders.Clone()
  $rangeHeaders['Range'] = 'bytes=0-31'
  $range = Get-Response ($mediaUrls[0].Url) $rangeHeaders
  Assert-True ($range.StatusCode -eq 206 -and $range.RawContentLength -eq 32) '原图 Range 未返回 32 字节的 206 响应。'
  Assert-True ([string]$range.Headers['Content-Range'] -match '^bytes 0-31/') '原图 Range 缺少正确 Content-Range。'
  $downloadPath = Join-Path $runtimeDir 'downloaded-original.png'
  Invoke-WebRequest -Uri ($mediaUrls[0].Url) -Headers $authHeaders -OutFile $downloadPath -TimeoutSec 180
  Assert-True ((Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $photoPath -Algorithm SHA256).Hash) '经 Nginx 回读的原图与上传原件不一致。'
  Remove-Item -LiteralPath $downloadPath -Force

  [IO.File]::WriteAllBytes($disguisedVideoPath, [byte[]](0,0,0,24,102,116,121,112,113,116,32,32,0,0,0,0,113,116,32,32,0,0,0,0))
  $disguised = Invoke-PhotoUpload $uploadUri $authHeaders $disguisedVideoPath ([guid]::NewGuid().ToString())
  Assert-True ($disguised.StatusCode -ge 400 -and $disguised.StatusCode -lt 500) "伪装视频应被拒绝，实际为 $($disguised.StatusCode)。"
  Assert-True ([string]$disguised.Headers['Content-Type'] -match '^application/json') '伪装视频没有返回后端 JSON 错误。'
  $disguisedPayload = $disguised.Content | ConvertFrom-Json
  Assert-True ($disguisedPayload.error.code -in @('INVALID_MEDIA', 'VALIDATION_ERROR')) '伪装视频没有返回媒体校验错误。'

  Invoke-Docker @('restart', "$composeProject-backend") '重启预检后端失败' | Out-Null
  $restartDeadline = (Get-Date).AddMinutes(2)
  while ($true) {
    $healthStatus = & docker inspect "$composeProject-backend" --format '{{.State.Health.Status}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $healthStatus -eq 'healthy') {
      try {
        $restartedHealth = Get-Response "http://127.0.0.1:$BackendPort/health"
        if ($restartedHealth.StatusCode -eq 200) { break }
      } catch {}
    }
    if ((Get-Date) -gt $restartDeadline) { throw '预检后端重启后未在 2 分钟内恢复健康。' }
    Start-Sleep -Seconds 2
  }
  foreach ($media in $mediaUrls) {
    Assert-MediaResponse $media.Url $authHeaders $media.Type
  }
  $deleted = Get-Response "$baseUri/pantry-nook/api/journal/uploads/$($uploaded.id)" $authHeaders 'Delete'
  Assert-True ($deleted.StatusCode -eq 200) '清理未绑定预检图片失败。'
  foreach ($variant in @('original', 'preview', 'thumbnail')) {
    $removedUrl = "$baseUri/pantry-nook/api/journal/media/$($uploaded.id)/$variant"
    $deletedGet = Get-Response $removedUrl $authHeaders
    $deletedHead = Get-Response $removedUrl $authHeaders 'Head'
    $deletedRangeHeaders = $authHeaders.Clone()
    $deletedRangeHeaders['Range'] = 'bytes=0-15'
    $deletedRange = Get-Response $removedUrl $deletedRangeHeaders
    foreach ($deletedResponse in @($deletedGet, $deletedHead, $deletedRange)) {
      Assert-True ($deletedResponse.StatusCode -eq 404 -and [string]$deletedResponse.Headers['Content-Type'] -match '^application/json') "清理后 $variant 未返回 JSON 404。"
    }
  }

  if (-not $KeepRunning -and -not $ValidationOnly) {
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
      media_sample_sha256 = (Get-FileHash -LiteralPath $photoPath -Algorithm SHA256).Hash.ToLowerInvariant()
      media_nginx_persistence_verified = $true
    }
  }
  Write-Host '[8/8] 发布预检通过：空库、Docker、子路径、鉴权、MIME、SPA、真实 API 与媒体持久化均已验证。'
} finally {
  Remove-Item -LiteralPath $disguisedVideoPath -Force -ErrorAction SilentlyContinue
  if (-not $KeepRunning) {
    & docker inspect $nginxContainer 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Invoke-Docker @('rm', '-f', $nginxContainer) '清理预检 Nginx 容器失败' | Out-Null
    }
    & docker inspect $nginxContainer 2>$null | Out-Null
    Assert-True ($LASTEXITCODE -ne 0) "清理后仍存在容器 $nginxContainer。"
    & (Join-Path $PSScriptRoot 'preflight-docker-local.ps1') -ProjectDir $ProjectDir -EnvFile $EnvFile -ComposeProject $composeProject -BackendPort $BackendPort -FrontendOrigin "http://127.0.0.1:$WebPort" -CleanupOnly
    Write-Host '已核实测试专用 Nginx、后端、数据库容器、数据库卷与媒体卷均不存在。'
  } else {
    Write-Host "保留预检环境：http://127.0.0.1:$WebPort/pantry-nook/（preflight / preflight）"
  }
}

if ($KeepRunning) {
  Write-Host 'KeepRunning 模式不生成可用于正式打包的候选证据。'
} elseif ($ValidationOnly) {
  Write-Host 'ValidationOnly 模式已完成并清理隔离环境，不生成可用于正式打包的候选证据。'
} else {
  Assert-True ($null -ne $evidencePayload) '预检没有生成候选证据内容。'
  $evidencePayload | ConvertTo-Json | Set-Content -LiteralPath $evidenceTempPath -Encoding utf8
  Move-Item -LiteralPath $evidenceTempPath -Destination $evidencePath -Force
  Write-Host "候选证据已在清理核验后写入：$evidencePath"
}
