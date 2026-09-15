param([string]$ProjectDir = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'

function Assert-Version([string]$Name, [string]$Actual, [string]$Expected) {
  if ($Actual -ne $Expected) {
    throw "$Name 版本为 $Actual，预期为 $Expected。"
  }
}

$expected = (Get-Content -LiteralPath (Join-Path $ProjectDir 'VERSION') -Raw).Trim()
if ($expected -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
  throw "VERSION 不是合法的语义化版本：$expected"
}

$package = Get-Content -LiteralPath (Join-Path $ProjectDir 'frontend/package.json') -Raw | ConvertFrom-Json -AsHashtable
$lock = Get-Content -LiteralPath (Join-Path $ProjectDir 'frontend/package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
$pyproject = Get-Content -LiteralPath (Join-Path $ProjectDir 'backend/pyproject.toml') -Raw
$uvLock = Get-Content -LiteralPath (Join-Path $ProjectDir 'backend/uv.lock') -Raw
$backendVersion = Get-Content -LiteralPath (Join-Path $ProjectDir 'backend/app/version.py') -Raw
$openapi = Get-Content -LiteralPath (Join-Path $ProjectDir 'contracts/openapi.yaml') -Raw | ConvertFrom-Json -AsHashtable

Assert-Version 'frontend/package.json' $package['version'] $expected
Assert-Version 'frontend/package-lock.json' $lock['version'] $expected
Assert-Version 'frontend/package-lock.json 根包' $lock['packages']['']['version'] $expected
if ($pyproject -notmatch '(?m)^version\s*=\s*"([^"]+)"') { throw 'backend/pyproject.toml 缺少 version。' }
Assert-Version 'backend/pyproject.toml' $Matches[1] $expected
if ($uvLock -notmatch '(?ms)\[\[package\]\]\s+name\s*=\s*"pantry-nook-backend"\s+version\s*=\s*"([^"]+)"') { throw 'backend/uv.lock 缺少 pantry-nook-backend 版本。' }
Assert-Version 'backend/uv.lock' $Matches[1] $expected
if ($backendVersion -notmatch 'APP_VERSION\s*=\s*"([^"]+)"') { throw 'backend/app/version.py 缺少 APP_VERSION。' }
Assert-Version 'backend/app/version.py' $Matches[1] $expected
Assert-Version 'contracts/openapi.yaml' $openapi['info']['version'] $expected

Write-Output "版本一致：$expected"
