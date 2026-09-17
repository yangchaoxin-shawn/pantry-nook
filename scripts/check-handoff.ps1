<#
.SYNOPSIS
只读核对新会话的代码基线；不切换分支、不修复工作区，也不连接远端。
.EXAMPLE
pwsh ./scripts/check-handoff.ps1 -ExpectedRef <开发提交> -DeployedRef v1.2.0
.EXAMPLE
pwsh ./scripts/check-handoff.ps1 -ExpectedRef <开发提交> -AllowDescendant -Json
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$ExpectedRef,
  [string]$ProjectDir = (Get-Location).Path,
  [string]$DeployedRef,
  [switch]$AllowDescendant,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$result = [ordered]@{
  schemaVersion = 1
  success = $false
  requestedPath = $ProjectDir
  root = $null
  branch = $null
  head = $null
  expectedRef = $ExpectedRef
  expectedCommit = $null
  relation = 'unknown'
  allowDescendant = [bool]$AllowDescendant
  dirty = $null
  changedEntries = $null
  deployedRef = $DeployedRef
  deployedCommit = $null
  deployedIsAncestor = $null
  failures = @()
}
$exitCode = 2

function Invoke-GitRead([string[]]$GitArgs) {
  $lines = @(& git --no-optional-locks -C $ProjectDir @GitArgs 2>&1)
  return @{ Code = $LASTEXITCODE; Text = ($lines | ForEach-Object { "$_" }) -join "`n" }
}

function Resolve-Commit([string]$Ref) {
  $resolved = Invoke-GitRead @('rev-parse', '--verify', '--end-of-options', "$Ref^{commit}")
  if ($resolved.Code -ne 0) { throw "无法在本地解析提交引用：$Ref" }
  return $resolved.Text.Trim()
}

function Test-Ancestor([string]$Ancestor, [string]$Descendant) {
  $check = Invoke-GitRead @('merge-base', '--is-ancestor', $Ancestor, $Descendant)
  if ($check.Code -gt 1) { throw 'Git 无法判断提交的祖先关系。' }
  return $check.Code -eq 0
}

try {
  $rootCheck = Invoke-GitRead @('rev-parse', '--show-toplevel')
  if ($rootCheck.Code -ne 0) { throw '指定位置不是可读取的 Git 工作区。' }
  $result.root = $rootCheck.Text.Trim()
  $result.head = Resolve-Commit 'HEAD'
  $result.expectedCommit = Resolve-Commit $ExpectedRef
  $branchCheck = Invoke-GitRead @('symbolic-ref', '--quiet', '--short', 'HEAD')
  if ($branchCheck.Code -gt 1) { throw '无法读取当前分支。' }
  $result.branch = if ($branchCheck.Code -eq 0) { $branchCheck.Text.Trim() } else { '(detached)' }
  $status = Invoke-GitRead @('status', '--porcelain=v1', '--untracked-files=all')
  if ($status.Code -ne 0) { throw '无法读取工作区状态。' }
  $result.dirty = -not [string]::IsNullOrWhiteSpace($status.Text)
  $result.changedEntries = if ($result.dirty) { @($status.Text -split "`n").Count } else { 0 }

  if ($result.head -eq $result.expectedCommit) {
    $result.relation = 'equal'
  } elseif (Test-Ancestor $result.expectedCommit $result.head) {
    $result.relation = 'ahead'
  } elseif (Test-Ancestor $result.head $result.expectedCommit) {
    $result.relation = 'behind'
  } else {
    $common = Invoke-GitRead @('merge-base', $result.head, $result.expectedCommit)
    if ($common.Code -gt 1) { throw '无法读取两个提交的共同祖先。' }
    $result.relation = if ($common.Code -eq 0) { 'diverged' } else { 'unrelated' }
  }

  if ($result.relation -ne 'equal' -and -not ($AllowDescendant -and $result.relation -eq 'ahead')) {
    $result.failures += "开发基线不匹配：$($result.relation)；默认要求 HEAD 精确等于预期提交。"
  }
  if ($result.dirty) {
    $result.failures += '工作区存在未提交或未跟踪文件；先辨明所属任务，脚本不会清理它们。'
  }
  if ($DeployedRef) {
    $result.deployedCommit = Resolve-Commit $DeployedRef
    $result.deployedIsAncestor = Test-Ancestor $result.deployedCommit $result.head
    if (-not $result.deployedIsAncestor) { $result.failures += '当前 HEAD 未包含指定的部署提交。' }
  }
  $result.success = $result.failures.Count -eq 0
  $exitCode = if ($result.success) { 0 } else { 1 }
} catch {
  $result.failures += $_.Exception.Message
}

if ($Json) {
  [pscustomobject]$result | ConvertTo-Json -Depth 3
} else {
  Write-Output "工作区：$($result.root)"
  Write-Output "分支：$($result.branch)"
  Write-Output "HEAD：$($result.head)"
  Write-Output "预期：$ExpectedRef → $($result.expectedCommit)"
  Write-Output "关系：$($result.relation)；允许后续提交：$([bool]$AllowDescendant)"
  Write-Output "未提交变化：$($result.changedEntries) 项"
  if ($DeployedRef) {
    Write-Output "部署：$DeployedRef → $($result.deployedCommit)；为当前祖先：$($result.deployedIsAncestor)"
  }
  if ($result.success) { Write-Output '核验通过。' }
  else { $result.failures | ForEach-Object { Write-Output "未通过：$_" } }
}
exit $exitCode
