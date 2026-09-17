# 不依赖 Pester；全部写入仅发生在本次创建的临时 Git 仓库中。
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$checkScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'check-handoff.ps1'
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = Join-Path $tempBase ("pantry-handoff-test-" + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $testRoot 'repo'
$passed = 0

function Invoke-TestGit([string[]]$GitArgs) {
  $output = @(& git -C $repo -c user.name=HandoffTest -c user.email=handoff-test@example.invalid @GitArgs 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "测试仓库操作失败：$($output -join ' ')" }
  return ($output -join "`n").Trim()
}

function Assert-Check {
  param(
    [string]$Name,
    [int]$Exit,
    [string]$Relation,
    [string[]]$CheckArgs,
    [bool]$Dirty = $false,
    [string]$Location = $repo
  )
  $before = Invoke-TestGit @('status', '--porcelain=v1', '--untracked-files=all')
  $refsBefore = Invoke-TestGit @('show-ref', '--head')
  $output = & pwsh -NoProfile -NonInteractive -File $checkScript -ProjectDir $Location -Json @CheckArgs
  $actualExit = $LASTEXITCODE
  $actual = ($output -join "`n") | ConvertFrom-Json
  if ($actualExit -ne $Exit -or $actual.relation -ne $Relation -or $actual.success -ne ($Exit -eq 0)) {
    throw "$Name 结果不符：exit=$actualExit，relation=$($actual.relation)，success=$($actual.success)"
  }
  if ($null -ne $actual.dirty -and $actual.dirty -ne $Dirty) { throw "$Name 脏树判断不符。" }
  if ((Invoke-TestGit @('status', '--porcelain=v1', '--untracked-files=all')) -ne $before -or
      (Invoke-TestGit @('show-ref', '--head')) -ne $refsBefore) { throw "$Name 修改了工作区或 Git 引用。" }
  $script:passed++
  Write-Output "通过：$Name"
}

try {
  New-Item -ItemType Directory -Path $repo | Out-Null
  Invoke-TestGit @('init', '--initial-branch=main') | Out-Null
  Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'baseline'
  Invoke-TestGit @('add', 'tracked.txt') | Out-Null
  Invoke-TestGit @('commit', '-m', 'base') | Out-Null
  $base = Invoke-TestGit @('rev-parse', 'HEAD')
  Invoke-TestGit @('tag', '-a', 'v-test', '-m', 'deployed') | Out-Null
  Invoke-TestGit @('commit', '--allow-empty', '-m', 'expected') | Out-Null
  $expected = Invoke-TestGit @('rev-parse', 'HEAD')
  Invoke-TestGit @('commit', '--allow-empty', '-m', 'ahead') | Out-Null
  $ahead = Invoke-TestGit @('rev-parse', 'HEAD')
  Invoke-TestGit @('switch', '--detach', $base) | Out-Null
  Invoke-TestGit @('commit', '--allow-empty', '-m', 'diverged') | Out-Null
  $diverged = Invoke-TestGit @('rev-parse', 'HEAD')
  Invoke-TestGit @('switch', '--orphan', 'unrelated') | Out-Null
  Invoke-TestGit @('commit', '--allow-empty', '-m', 'unrelated') | Out-Null
  $unrelated = Invoke-TestGit @('rev-parse', 'HEAD')

  Invoke-TestGit @('switch', '--detach', $expected) | Out-Null
  Assert-Check '正确基线及 annotated 部署 tag' 0 'equal' @('-ExpectedRef', $expected, '-DeployedRef', 'v-test')
  Assert-Check '无效开发 ref' 2 'unknown' @('-ExpectedRef', 'missing-ref')
  Assert-Check '无效部署 ref' 2 'equal' @('-ExpectedRef', $expected, '-DeployedRef', 'missing-ref')
  Assert-Check '部署提交不属于当前历史' 1 'equal' @('-ExpectedRef', $expected, '-DeployedRef', $diverged)
  New-Item -ItemType Directory -Path (Join-Path $repo 'nested') | Out-Null
  Assert-Check '从子目录正确定位 Git root' 0 'equal' @('-ExpectedRef', $expected) -Location (Join-Path $repo 'nested')
  Assert-Check '非 Git 目录' 2 'unknown' @('-ExpectedRef', $expected) -Location $testRoot

  Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'changed'
  Assert-Check '未暂存修改' 1 'equal' @('-ExpectedRef', $expected) -Dirty $true
  Invoke-TestGit @('add', 'tracked.txt') | Out-Null
  Assert-Check '已暂存修改' 1 'equal' @('-ExpectedRef', $expected) -Dirty $true
  Invoke-TestGit @('restore', '--staged', 'tracked.txt') | Out-Null
  Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'baseline'
  $untracked = Join-Path $repo 'untracked.txt'
  Set-Content -LiteralPath $untracked -Value 'test'
  Assert-Check '未跟踪文件' 1 'equal' @('-ExpectedRef', $expected) -Dirty $true
  Remove-Item -LiteralPath $untracked

  Invoke-TestGit @('switch', '--detach', $base) | Out-Null
  Assert-Check '落后于开发基线' 1 'behind' @('-ExpectedRef', $expected, '-AllowDescendant')
  Invoke-TestGit @('switch', '--detach', $ahead) | Out-Null
  Assert-Check '默认拒绝后续提交' 1 'ahead' @('-ExpectedRef', $expected)
  Assert-Check '显式允许后续提交' 0 'ahead' @('-ExpectedRef', $expected, '-AllowDescendant', '-DeployedRef', 'v-test')
  Invoke-TestGit @('switch', '--detach', $diverged) | Out-Null
  Assert-Check '允许后续提交仍拒绝分叉' 1 'diverged' @('-ExpectedRef', $expected, '-AllowDescendant')
  Invoke-TestGit @('switch', '--detach', $unrelated) | Out-Null
  Assert-Check '拒绝无共同祖先' 1 'unrelated' @('-ExpectedRef', $expected, '-AllowDescendant')
  Write-Output "合计：$passed 项通过；未连接远端，现有项目和用户工作区未参与测试写入。"
} finally {
  # 仅删除本脚本随机创建且仍在系统临时目录内的确切目录。
  if (Test-Path -LiteralPath $testRoot) {
    $resolved = (Resolve-Path -LiteralPath $testRoot).Path
    $allowedParent = [IO.Path]::TrimEndingDirectorySeparator($tempBase)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $allowedParent -or
        [IO.Path]::GetFileName($resolved) -notmatch '^pantry-handoff-test-[0-9a-f]{32}$' -or
        $resolved -ne [IO.Path]::GetFullPath($testRoot) -or
        ((Get-Item -LiteralPath $testRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "拒绝清理未经验证的临时目录：$resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
