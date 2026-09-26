param(
  [string]$BaseUrl = 'https://preview.aihuashen.com/pantry-nook',
  [Parameter(Mandatory = $true)]
  [PSCredential]$Credential,
  [switch]$ExpectEmpty,
  [string]$JournalSamplePath
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$baseUriObject = [Uri]("$base/")
$origin = $baseUriObject.GetLeftPart([UriPartial]::Authority)
$plainPassword = $Credential.GetNetworkCredential().Password
$basic = [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes("$($Credential.UserName):$plainPassword")
)
$authHeaders = @{ Authorization = "Basic $basic" }

function Get-Response([string]$Uri, [hashtable]$Headers = @{}) {
  Invoke-WebRequest -Uri $Uri -Headers $Headers -SkipHttpErrorCheck -TimeoutSec 20
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Invoke-PhotoUpload([string]$Uri, [hashtable]$Headers, [string]$Path, [string]$UploadId) {
  $uploadHeaders = $Headers.Clone()
  $uploadHeaders['X-Upload-ID'] = $UploadId
  Invoke-WebRequest -Uri $Uri -Method Post -Headers $uploadHeaders -Form @{ file = Get-Item -LiteralPath $Path } `
    -SkipHttpErrorCheck -TimeoutSec 180
}

function Remove-JournalUpload([string]$Uri, [hashtable]$Headers) {
  $deadline = (Get-Date).AddMinutes(3)
  while ($true) {
    try {
      $response = Invoke-WebRequest -Uri $Uri -Method Delete -Headers $Headers -SkipHttpErrorCheck -TimeoutSec 20
    } catch {
      if ((Get-Date) -ge $deadline) { throw }
      Start-Sleep -Seconds 2
      continue
    }
    if ($response.StatusCode -in @(200, 404)) { return $response.StatusCode }
    if ($response.StatusCode -ne 409) { throw "清理上传返回了意外状态 $($response.StatusCode)。" }
    if ((Get-Date) -ge $deadline) { throw '等待上传处理结束并清理超时。' }
    Start-Sleep -Seconds 2
  }
}

function Assert-MediaResponse([string]$Uri, [hashtable]$Headers, [string]$ExpectedType) {
  $response = Get-Response $Uri $Headers
  Assert-True ($response.StatusCode -eq 200 -and $response.RawContentLength -gt 0) "$Uri 未返回有效图片。"
  Assert-True ([string]$response.Headers['Content-Type'] -match $ExpectedType) "$Uri 的图片 MIME 不正确。"
  $head = Invoke-WebRequest -Uri $Uri -Method Head -Headers $Headers -SkipHttpErrorCheck -TimeoutSec 20
  Assert-True ($head.StatusCode -eq 200) "$Uri 的 HEAD 未返回 200。"
  Assert-True ([string]$head.Headers['Content-Type'] -match $ExpectedType) "$Uri 的 HEAD 图片 MIME 不正确。"
}

Write-Host '[1/6] 验证项目在页面、资源和 API 返回前拦截匿名访问'
foreach ($path in @('/', '/assets/not-present.js', '/api/ingredients?limit=1&offset=0', '/api/journal/entries?limit=1&offset=0', '/api/journal/media/00000000-0000-0000-0000-000000000000/original')) {
  $response = Get-Response "$base$path"
  Assert-True ($response.StatusCode -eq 401) "$path 匿名访问应为 401，实际为 $($response.StatusCode)。"
  Assert-True ([string]$response.Headers['WWW-Authenticate'] -match '^Basic') "$path 未返回 Basic Auth challenge。"
}

Write-Host '[2/6] 验证登录后的页面与 SPA 回退'
$homeResponse = Get-Response "$base/" $authHeaders
Assert-True ($homeResponse.StatusCode -eq 200) '登录后的首页未返回 200。'
Assert-True ([string]$homeResponse.Headers['Content-Type'] -match '^text/html') '首页未返回 HTML。'
Assert-True ($homeResponse.Content -match '<div id="root"></div>') '首页正文不是 Pantry Nook 应用入口。'
$spa = Get-Response "$base/inventory" $authHeaders
Assert-True ($spa.StatusCode -eq 200 -and $spa.Content -match '<div id="root"></div>') 'SPA 子路由未正确回退首页。'

Write-Host '[3/6] 从当前首页提取并验证真实哈希 CSS 与 JavaScript'
$assetMatches = [regex]::Matches($homeResponse.Content, '/pantry-nook/assets/[^"'']+\.(?:css|js)')
Assert-True ($assetMatches.Count -ge 2) '首页没有同时引用 CSS 与 JavaScript 产物。'
$cssResponses = @()
foreach ($match in $assetMatches) {
  $assetPath = $match.Value
  $assetUri = [Uri]::new([Uri]$origin, $assetPath).AbsoluteUri
  $anonymousAsset = Get-Response $assetUri
  Assert-True ($anonymousAsset.StatusCode -eq 401) "$assetPath 匿名访问未被鉴权拦截。"
  Assert-True ([string]$anonymousAsset.Headers['WWW-Authenticate'] -match '^Basic') "$assetPath 未返回 Basic Auth challenge。"
  $asset = Get-Response $assetUri $authHeaders
  Assert-True ($asset.StatusCode -eq 200) "$assetPath 未返回 200。"
  $contentType = [string]$asset.Headers['Content-Type']
  if ($assetPath.EndsWith('.css')) {
    Assert-True ($contentType -match '^text/css') "$assetPath 的 Content-Type 不是 text/css，而是 $contentType。"
    $cssResponses += @{ Uri = [Uri]$assetUri; Content = [string]$asset.Content }
  } else {
    Assert-True ($contentType -match '^(application|text)/javascript') "$assetPath 的 Content-Type 不是 JavaScript，而是 $contentType。"
  }
  Assert-True ($asset.Content.TrimStart() -notmatch '^<!doctype html') "$assetPath 错误返回了首页 HTML。"
}
$fontUrls = @()
foreach ($cssResponse in $cssResponses) {
  foreach ($fontMatch in [regex]::Matches($cssResponse.Content, 'url\((?:["'']?)([^)"'']+\.woff2)(?:["'']?)\)')) {
    $fontUrls += [Uri]::new($cssResponse.Uri, $fontMatch.Groups[1].Value).AbsoluteUri
  }
}
Assert-True ($fontUrls.Count -gt 0) '当前 CSS 没有引用可核验的 WOFF2 字体。'
foreach ($fontUrl in ($fontUrls | Select-Object -Unique)) {
  $anonymousFont = Get-Response $fontUrl
  Assert-True ($anonymousFont.StatusCode -eq 401) "$fontUrl 匿名访问未被鉴权拦截。"
  $font = Get-Response $fontUrl $authHeaders
  Assert-True ($font.StatusCode -eq 200) "$fontUrl 未返回 200。"
  Assert-True ([string]$font.Headers['Content-Type'] -match '^font/woff2') "$fontUrl 未以 font/woff2 返回。"
  Assert-True ($font.RawContentLength -gt 0) "$fontUrl 返回空正文。"
}
$missingAsset = Get-Response "$base/assets/not-present.js" $authHeaders
Assert-True ($missingAsset.StatusCode -eq 404) '不存在的静态资源没有返回 404。'

Write-Host '[4/6] 验证七个真实列表 API 的状态、类型与结构（含手记）'
$listPaths = @('ingredients', 'dishes', 'meal-plans', 'consumptions', 'inventory-adjustments', 'daily-battles', 'journal/entries')
foreach ($path in $listPaths) {
  $uri = "$base/api/${path}?limit=100&offset=0"
  $response = Get-Response $uri $authHeaders
  Assert-True ($response.StatusCode -eq 200) "$uri 未返回 200，实际为 $($response.StatusCode)。"
  $contentType = [string]$response.Headers['Content-Type']
  Assert-True ($contentType -match '^application/json') "$uri 未返回 JSON，实际 Content-Type 为 $contentType。"
  $payload = $response.Content | ConvertFrom-Json
  Assert-True ($null -ne $payload.PSObject.Properties['data']) "$uri 的响应缺少 data 字段。"
  if ($ExpectEmpty) {
    Assert-True (@($payload.data).Count -eq 0) "$uri 预期为空库，但返回了数据。"
  }
}

Write-Host '[5/6] 按需验证公网图片上传、读取、Range 与清理'
if ($JournalSamplePath) {
  $sample = (Resolve-Path -LiteralPath $JournalSamplePath).Path
  Assert-True ((Get-Item -LiteralPath $sample).Length -gt 1MB) '公网验证样本必须超过 1 MiB，以覆盖 Nginx 上传限制。'
  $originalType = switch ([IO.Path]::GetExtension($sample).ToLowerInvariant()) {
    '.png' { '^image/png' }
    '.jpg' { '^image/jpeg' }
    '.jpeg' { '^image/jpeg' }
    '.webp' { '^image/webp' }
    '.heic' { '^image/heic' }
    '.heif' { '^image/heic' }
    default { throw '公网验证样本必须是受支持的 JPG、PNG、WebP 或 HEIC 图片。' }
  }
  $uploaded = $null
  $anonymousUploadId = [guid]::NewGuid().ToString()
  $uploadId = [guid]::NewGuid().ToString()
  $mediaUrls = @()
  try {
    $anonymousUpload = Invoke-PhotoUpload "$base/api/journal/uploads" @{} $sample $anonymousUploadId
    Assert-True ($anonymousUpload.StatusCode -eq 401) '匿名图片上传未被 Basic Auth 拦截。'
    $upload = Invoke-PhotoUpload "$base/api/journal/uploads" $authHeaders $sample $uploadId
    Assert-True ($upload.StatusCode -eq 201 -and [string]$upload.Headers['Content-Type'] -match '^application/json') '公网图片上传未返回 JSON 201。'
    $uploaded = ($upload.Content | ConvertFrom-Json).data
    $mediaUrls = @(
      @{ Name = 'original'; Url = "$base$($uploaded.original_url)"; Type = $originalType },
      @{ Name = 'preview'; Url = "$base$($uploaded.preview_url)"; Type = '^image/jpeg' },
      @{ Name = 'thumbnail'; Url = "$base$($uploaded.thumbnail_url)"; Type = '^image/jpeg' }
    )
    foreach ($media in $mediaUrls) {
      foreach ($method in @('Get', 'Head')) {
        $anonymousMedia = Invoke-WebRequest -Uri $media.Url -Method $method -SkipHttpErrorCheck -TimeoutSec 20
        Assert-True ($anonymousMedia.StatusCode -eq 401) "$($media.Name) 匿名 $method 未被鉴权拦截。"
      }
      $anonymousRange = Invoke-WebRequest -Uri $media.Url -Headers @{ Range = 'bytes=0-15' } -SkipHttpErrorCheck -TimeoutSec 20
      Assert-True ($anonymousRange.StatusCode -eq 401) "$($media.Name) 匿名 Range 未被鉴权拦截。"
      Assert-MediaResponse $media.Url $authHeaders $media.Type
    }
    $rangeHeaders = $authHeaders.Clone()
    $rangeHeaders['Range'] = 'bytes=0-31'
    $range = Get-Response ($mediaUrls[0].Url) $rangeHeaders
    Assert-True ($range.StatusCode -eq 206 -and $range.RawContentLength -eq 32) '公网原图 Range 未返回 32 字节的 206 响应。'
    Assert-True ([string]$range.Headers['Content-Range'] -match '^bytes 0-31/') '公网原图 Range 缺少正确 Content-Range。'
    $download = Join-Path ([IO.Path]::GetTempPath()) ("pantry-journal-" + [guid]::NewGuid().ToString() + '.bin')
    try {
      Invoke-WebRequest -Uri ($mediaUrls[0].Url) -Headers $authHeaders -OutFile $download -TimeoutSec 180
      Assert-True ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $sample -Algorithm SHA256).Hash) '公网回读原图与上传原件不一致。'
    } finally {
      Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
    }
  } finally {
    foreach ($cleanupId in @($anonymousUploadId, $uploadId)) {
      $cleanupStatus = Remove-JournalUpload "$base/api/journal/uploads/$cleanupId" $authHeaders
      foreach ($variant in @('original', 'preview', 'thumbnail')) {
        $removedUrl = "$base/api/journal/media/$cleanupId/$variant"
        $deletedGet = Get-Response $removedUrl $authHeaders
        $deletedHead = Invoke-WebRequest -Uri $removedUrl -Method Head -Headers $authHeaders -SkipHttpErrorCheck -TimeoutSec 20
        $deletedRangeHeaders = $authHeaders.Clone()
        $deletedRangeHeaders['Range'] = 'bytes=0-15'
        $deletedRange = Get-Response $removedUrl $deletedRangeHeaders
        foreach ($deletedResponse in @($deletedGet, $deletedHead, $deletedRange)) {
          Assert-True ($deletedResponse.StatusCode -eq 404 -and [string]$deletedResponse.Headers['Content-Type'] -match '^application/json') "公网验证图片 $cleanupId/$variant 清理后仍可读取（DELETE 状态 $cleanupStatus）。"
        }
      }
    }
  }
} else {
  Write-Host '未提供 JournalSamplePath，本次只核验手记列表与匿名媒体拦截。'
}

Write-Host '[6/6] 验证不存在的 API 由后端返回 JSON 404'
$missingApi = Get-Response "$base/api/not-present" $authHeaders
Assert-True ($missingApi.StatusCode -eq 404) '不存在的 API 未返回 404。'
Assert-True ([string]$missingApi.Headers['Content-Type'] -match '^application/json') '不存在的 API 没有返回后端 JSON。'
$missingPayload = $missingApi.Content | ConvertFrom-Json
Assert-True ($missingPayload.error.code -eq 'ROUTE_NOT_FOUND') '不存在的 API 未返回 ROUTE_NOT_FOUND。'

Write-Host '公网 HTTP 链路核验通过：Basic Auth、页面、SPA、真实 CSS/JS/字体、MIME、七个真实 API 与已选择的媒体链路均正常。仍需在服务器核对容器健康、/health、Linux 权限、媒体卷和日志后才能完成 G5。'
