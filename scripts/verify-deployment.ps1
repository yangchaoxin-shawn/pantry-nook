param(
  [string]$BaseUrl = 'https://preview.aihuashen.com/pantry-nook',
  [Parameter(Mandatory = $true)]
  [PSCredential]$Credential,
  [switch]$ExpectEmpty
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

Write-Host '[1/5] 验证项目在页面、资源和 API 返回前拦截匿名访问'
foreach ($path in @('/', '/assets/not-present.js', '/api/ingredients?limit=1&offset=0')) {
  $response = Get-Response "$base$path"
  Assert-True ($response.StatusCode -eq 401) "$path 匿名访问应为 401，实际为 $($response.StatusCode)。"
  Assert-True ([string]$response.Headers['WWW-Authenticate'] -match '^Basic') "$path 未返回 Basic Auth challenge。"
}

Write-Host '[2/5] 验证登录后的页面与 SPA 回退'
$homeResponse = Get-Response "$base/" $authHeaders
Assert-True ($homeResponse.StatusCode -eq 200) '登录后的首页未返回 200。'
Assert-True ([string]$homeResponse.Headers['Content-Type'] -match '^text/html') '首页未返回 HTML。'
Assert-True ($homeResponse.Content -match '<div id="root"></div>') '首页正文不是 Pantry Nook 应用入口。'
$spa = Get-Response "$base/inventory" $authHeaders
Assert-True ($spa.StatusCode -eq 200 -and $spa.Content -match '<div id="root"></div>') 'SPA 子路由未正确回退首页。'

Write-Host '[3/5] 从当前首页提取并验证真实哈希 CSS 与 JavaScript'
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

Write-Host '[4/5] 验证六个真实列表 API 的状态、类型与结构'
$listPaths = @('ingredients', 'dishes', 'meal-plans', 'consumptions', 'inventory-adjustments', 'daily-battles')
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

Write-Host '[5/5] 验证不存在的 API 由后端返回 JSON 404'
$missingApi = Get-Response "$base/api/not-present" $authHeaders
Assert-True ($missingApi.StatusCode -eq 404) '不存在的 API 未返回 404。'
Assert-True ([string]$missingApi.Headers['Content-Type'] -match '^application/json') '不存在的 API 没有返回后端 JSON。'
$missingPayload = $missingApi.Content | ConvertFrom-Json
Assert-True ($missingPayload.error.code -eq 'ROUTE_NOT_FOUND') '不存在的 API 未返回 ROUTE_NOT_FOUND。'

Write-Host '公网 HTTP 链路核验通过：Basic Auth、页面、SPA、真实 CSS/JS/字体、MIME 与真实 API 均正常。仍需在服务器核对容器健康、/health、Linux 权限和日志后才能完成 G5。'
