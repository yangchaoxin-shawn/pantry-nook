#requires -Version 5.1
<#
.SYNOPSIS
会话 worktree 开工准备：对齐 main、复制本机连接配置、按锁文件安装依赖。可重复执行。

.DESCRIPTION
在会话 worktree 根目录运行，或用 -Worktree 指定目录：
1. 分支落后 main、没有自己的提交且没有未提交改动时，快进到 main；有自己的提交时只提示，不自动改动。
2. 缺少 backend/.env 时从主工作区复制；已有则不动，不显示内容。
3. 前端依赖与锁文件不一致时执行 npm ci；后端执行 uv sync --frozen，不升级依赖。
有服务正从这个目录运行（例如用户的评审环境）时，不快进、不装依赖，避免在运行中改动代码或依赖。
识别侧车（ocr/）全机共用一个，不在这里安装；主工作区只做检查。

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-worktree.ps1
#>
[CmdletBinding()]
param(
    [string]$Worktree = (Get-Location).Path,
    [switch]$SkipDependencies
)

# 原生命令（git、npm、uv）写到 stderr 的提示在 Windows PowerShell 5.1 下可能被当成错误；
# 这里不用 Stop，改为逐条检查退出码。
$ErrorActionPreference = 'Continue'

function Get-GitText([string[]]$Arguments) {
    $output = & git.exe -C $script:root @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') 执行失败。" }
    return (@($output) -join "`n").Trim()
}

function Get-BusyProcess {
    # 只认运行时进程；会话自身的 claude.exe、bash 等启动器命令行里也带目录，不能算作服务。
    # 局限：借用主工作区解释器、以相对路径参数启动的进程可能漏判；快进或装依赖前如不确定，另用 netstat 复核端口。
    $runtime = @('node.exe', 'python.exe', 'pythonw.exe', 'uv.exe', 'esbuild.exe')
    $inside = @(($script:root + '\'), ($script:root.Replace('\', '/') + '/'))
    return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $exe = [string]$_.ExecutablePath
        $line = [string]$_.CommandLine
        $exeInside = $exe.StartsWith($inside[0], [StringComparison]::OrdinalIgnoreCase)
        $lineInside = $false
        foreach ($prefix in $inside) {
            if ($line.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $lineInside = $true }
        }
        $exeInside -or (($runtime -contains ([string]$_.Name).ToLowerInvariant()) -and $lineInside)
    })
}

$top = & git.exe -C $Worktree rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or -not $top) { throw "不是 Git 工作区：$Worktree" }
$script:root = [IO.Path]::GetFullPath((@($top) -join '').Trim()).TrimEnd('\')
$commonGit = Get-GitText @('rev-parse', '--path-format=absolute', '--git-common-dir')
$mainRoot = [IO.Path]::GetFullPath((Split-Path -Parent $commonGit)).TrimEnd('\')
$isMainRoot = [string]::Equals($script:root, $mainRoot, [StringComparison]::OrdinalIgnoreCase)
$branch = Get-GitText @('rev-parse', '--abbrev-ref', 'HEAD')
& git.exe -C $script:root rev-parse --verify --quiet refs/heads/main
if ($LASTEXITCODE -ne 0) { throw 'main 分支不存在：本仓库以 main 为唯一开发主线，请先核对仓库状态。' }
$mainHead = Get-GitText @('rev-parse', '--short', 'main')
$busy = @()
if (-not $isMainRoot) { $busy = @(Get-BusyProcess) }

Write-Host "工作区：$script:root"
Write-Host "分支：$branch；main：$mainHead"
if ($busy.Count) {
    Write-Warning "有 $($busy.Count) 个服务进程正从这个目录运行（PID $(($busy | ForEach-Object { $_.ProcessId }) -join ', ')），本次不快进、不装依赖。"
}

# 1. 分支对齐
if ($isMainRoot) {
    Write-Host '这是主工作区：只做检查，不对齐分支、不装依赖。'
} elseif ($branch -eq 'HEAD') {
    Write-Host '当前是游离 HEAD，跳过分支对齐。'
} else {
    $counts = (Get-GitText @('rev-list', '--left-right', '--count', 'main...HEAD')) -split '\s+'
    $behind = [int]$counts[0]
    $ahead = [int]$counts[1]
    $dirty = Get-GitText @('status', '--porcelain', '--untracked-files=no')
    if ($behind -eq 0) {
        Write-Host "分支已基于最新 main（自己的提交 $ahead 个）。"
    } elseif ($ahead -gt 0) {
        Write-Warning "分支有 $ahead 个自己的提交，main 已前进 $behind 个：交付前需要把分支接到最新 main 上（git rebase main），本脚本不自动处理。"
    } elseif ($dirty) {
        Write-Warning "分支落后 main $behind 个提交，但有未提交的改动，没有快进；处理改动后重跑。"
    } elseif ($busy.Count) {
        Write-Warning "分支落后 main $behind 个提交；有服务正在运行，没有快进。"
    } else {
        & git.exe -C $script:root merge --ff-only --quiet main
        if ($LASTEXITCODE -ne 0) { throw '快进到 main 失败。' }
        Write-Host "已快进到 main（$mainHead），追上 $behind 个提交。"
    }
}

# 2. 本机连接配置
$envTarget = Join-Path $script:root 'backend\.env'
$envSource = Join-Path $mainRoot 'backend\.env'
if (Test-Path -LiteralPath $envTarget) {
    Write-Host 'backend/.env 已存在，不改动。'
} elseif ($isMainRoot -or -not (Test-Path -LiteralPath $envSource)) {
    Write-Warning '主工作区没有 backend/.env，请先按 README 配置数据库连接。'
} else {
    Copy-Item -LiteralPath $envSource -Destination $envTarget -ErrorAction Stop
    Write-Host '已从主工作区复制 backend/.env（被 Git 忽略，不显示内容）。'
}

# 3. 依赖
if ($isMainRoot -or $busy.Count) {
    # 前面已说明原因。
} elseif ($SkipDependencies) {
    Write-Host '按参数跳过依赖安装。'
} else {
    $frontend = Join-Path $script:root 'frontend'
    $lockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $frontend 'package-lock.json') -ErrorAction Stop).Hash
    $stamp = Join-Path $frontend 'node_modules\.prepare-worktree-lock'
    $installed = if (Test-Path -LiteralPath $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() } else { '' }
    if ($installed -eq $lockHash) {
        Write-Host '前端依赖与锁文件一致，跳过。'
    } else {
        $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
        if (-not $npm) { throw '找不到 npm.cmd：请先安装 Node.js 并确认在 PATH 中。' }
        Push-Location $frontend
        try {
            & $npm ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败。' }
        } finally { Pop-Location }
        Set-Content -LiteralPath $stamp -Value $lockHash -Encoding ASCII -ErrorAction Stop
        Write-Host '前端依赖已按锁文件安装。'
    }
    $uv = (Get-Command uv.exe -ErrorAction SilentlyContinue).Source
    if (-not $uv) { throw '找不到 uv.exe：请先安装 uv 并确认在 PATH 中。' }
    Push-Location (Join-Path $script:root 'backend')
    try {
        & $uv sync --frozen --quiet
        if ($LASTEXITCODE -ne 0) { throw 'uv sync 失败。' }
    } finally { Pop-Location }
    Write-Host '后端依赖已按锁文件同步。'
}

Write-Host '准备完成。'
