#requires -Version 5.1
param(
    [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start',
    [int]$BackendPort = 3018,
    [int]$FrontendPort = 5200,
    [string]$SourceRoot = '',
    [switch]$SeedDemo
)

$ErrorActionPreference = 'Stop'
$reviewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reviewDirectory = Join-Path $reviewRoot '.review'
$statePath = Join-Path $reviewDirectory 'environment.json'
$backendDirectory = Join-Path $reviewRoot 'backend'
$frontendDirectory = Join-Path $reviewRoot 'frontend'
$script:state = $null

function Save-State {
    $script:state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Get-OwnedProcess($record) {
    if (-not $record) { return $null }
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    if ($process.StartTime.ToUniversalTime().Ticks -ne ([DateTimeOffset]$record.startedAtUtc).UtcDateTime.Ticks -or
        $process.Path -ne $record.executable) {
        throw "PID $($record.pid) 身份已变化，拒绝操作其他进程。"
    }
    return $process
}

function Stop-OwnedProcess($record) {
    $process = Get-OwnedProcess $record
    if ($process) {
        # 已校验本环境记录的 PID、创建时间与执行文件；连同其子进程结束。
        & taskkill.exe /PID $process.Id /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "停止评审进程 $($process.Id) 失败。" }
    }
}

function Assert-PortFree([int]$port) {
    if ($port -lt 1024 -or $port -gt 65535) { throw "端口必须在 1024 至 65535 之间。" }
    # Get-NetTCPConnection 在部分受限账户不可用，使用只读 netstat 检查监听地址。
    $listeners = @(& netstat.exe -ano -p tcp | Where-Object { $_ -match '^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+\d+\s*$' } |
        Where-Object { ($_ -split '\s+')[2] -match (':' + $port + '$') })
    if ($listeners.Count) { throw "端口 $port 已占用，未结束已有服务；请关闭本评审环境后重试或选择空端口。" }
    $probe = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
    try { $probe.Start() } catch { throw "无法绑定端口 $port，已停止启动。" } finally { $probe.Stop() }
}

function Read-Health([int]$port) {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 3
    $body = $response.Content | ConvertFrom-Json
    $marker = [string]$response.Headers['X-Pantry-Nook-Test-Database']
    if ($body.status -ne 'ok' -or $body.database -ne 'connected' -or
        $marker -notmatch '^pantry_nook_test_[0-9a-f]{32}$' -or $marker -ne $script:state.database) {
        throw "端口 $port 的隔离数据库标记不匹配，拒绝继续。"
    }
    return $marker
}

function Wait-Health([int]$port, $record) {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (-not (Get-OwnedProcess $record)) { throw "评审服务已退出，请查看 .review 日志。" }
        try { return Read-Health $port } catch { Start-Sleep -Milliseconds 500 }
    }
    throw "端口 $port 健康检查失败或测试库标记不符，请查看 .review 日志。"
}

function Start-Hidden([string]$executable, [string[]]$arguments, [string]$directory, [string]$label) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $out = Join-Path $reviewDirectory "$label-$stamp.stdout.log"
    $err = Join-Path $reviewDirectory "$label-$stamp.stderr.log"
    # ArgumentList 是 Windows 命令行；路径仅在受控参数中使用双引号包裹。
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $directory `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    return [pscustomobject]@{
        pid = $process.Id; startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
        executable = [IO.Path]::GetFullPath($executable); stdout = $out; stderr = $err
    }
}

if (Test-Path -LiteralPath $statePath) {
    $script:state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($script:state.workspace -ne $reviewRoot -or $script:state.database -notmatch '^pantry_nook_test_[0-9a-f]{32}$') {
        throw '评审环境记录不属于当前目录或不是测试库，拒绝继续。'
    }
}

if ($Action -eq 'Status') {
    if (-not $script:state) { Write-Output '尚未建立本地 UI 评审环境。'; exit 0 }
    $backendRunning = [bool](Get-OwnedProcess $script:state.backend)
    $frontendRunning = [bool](Get-OwnedProcess $script:state.frontend)
    Write-Output "后端运行：$backendRunning；前端运行：$frontendRunning；数据库：$($script:state.database)"
    if ($backendRunning) { Read-Health $script:state.backendPort | Out-Null }
    if ($frontendRunning) { Read-Health $script:state.frontendPort | Out-Null }
    Write-Output "评审页面：http://127.0.0.1:$($script:state.frontendPort)"
    exit 0
}

if ($Action -eq 'Stop') {
    if (-not $script:state) { Write-Output '没有本环境的进程记录；未操作任何服务。'; exit 0 }
    Stop-OwnedProcess $script:state.frontend
    Stop-OwnedProcess $script:state.backend
    $script:state.frontend = $null
    $script:state.backend = $null
    Save-State
    Write-Output '本评审环境已关闭；代码、测试数据库和用户操作结果已保留。'
    exit 0
}

if ($script:state) {
    if (($PSBoundParameters.ContainsKey('BackendPort') -and $BackendPort -ne $script:state.backendPort) -or
        ($PSBoundParameters.ContainsKey('FrontendPort') -and $FrontendPort -ne $script:state.frontendPort)) {
        throw '已建立的环境使用已记录端口；本命令不会暗中迁移验收端口。'
    }
    $BackendPort = $script:state.backendPort
    $FrontendPort = $script:state.frontendPort
    if (-not $SourceRoot) { $SourceRoot = $script:state.sourceRoot }
    $backendRunning = [bool](Get-OwnedProcess $script:state.backend)
    $frontendRunning = [bool](Get-OwnedProcess $script:state.frontend)
    if ($backendRunning -or $frontendRunning) {
        if ($backendRunning -and $frontendRunning) {
            Read-Health $BackendPort | Out-Null
            Read-Health $FrontendPort | Out-Null
            if ($SeedDemo) { throw '环境正在运行，不重复灌入数据。首次初始化使用 -SeedDemo。' }
            Write-Output "评审环境已在运行：http://127.0.0.1:$FrontendPort；未重启或改写数据。"
            exit 0
        }
        throw '只检测到部分评审进程。请先执行 -Action Stop，再执行启动命令；不会改动其他服务。'
    }
}

if (-not $SourceRoot) {
    $commonGit = (& git.exe -C $reviewRoot rev-parse --path-format=absolute --git-common-dir).Trim()
    if ($LASTEXITCODE -ne 0) { throw '无法定位共享依赖目录，请传入 -SourceRoot。' }
    $SourceRoot = Split-Path -Parent $commonGit
}
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$python = Join-Path $SourceRoot 'backend/.venv/Scripts/python.exe'
$sourceEnv = Join-Path $SourceRoot 'backend/.env'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$vite = Join-Path $frontendDirectory 'node_modules/vite/bin/vite.js'
foreach ($required in @($python, $sourceEnv, $vite)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "缺少依赖文件：$required。请先安装当前锁定依赖。" }
}
if ($BackendPort -eq $FrontendPort) { throw '前后端端口不能相同。' }
Assert-PortFree $BackendPort
Assert-PortFree $FrontendPort
New-Item -ItemType Directory -Path $reviewDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $backendDirectory '.env'))) {
    Copy-Item -LiteralPath $sourceEnv -Destination (Join-Path $backendDirectory '.env')
}

$savedEnvironment = @{}
$environmentKeys = @('DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'PYTHONIOENCODING', 'PANTRY_API_PROXY_TARGET', 'VITE_API_BASE')
foreach ($key in $environmentKeys) { $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
$startedBackend = $null
$startedFrontend = $null
try {
    # 只读取隔离目录的 .env，防止调用者遗留的数据库变量覆盖连接来源。
    foreach ($key in @('DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD')) { [Environment]::SetEnvironmentVariable($key, $null, 'Process') }
    $env:PYTHONIOENCODING = 'utf-8'
    $env:PANTRY_API_PROXY_TARGET = "http://127.0.0.1:$BackendPort"
    # 客户端会去掉末尾斜线，最终用同源 /api；显式值优先于其他 .env 设置。
    $env:VITE_API_BASE = '/'
    if (-not $script:state) {
        Push-Location $backendDirectory
        try {
            # 调用现有独立库准备函数，先持久记录库名，再启动服务，防止重启时重灌。
            $database = (& $python -c "import asyncio,sys; sys.path.insert(0,'scripts'); from isolated_server import prepare; print(asyncio.run(prepare()))").Trim()
            if ($LASTEXITCODE -ne 0 -or $database -notmatch '^pantry_nook_test_[0-9a-f]{32}$') { throw '独立数据库初始化失败，未启动评审服务。' }
        } finally { Pop-Location }
        $script:state = [pscustomobject]@{
            version = 1; workspace = $reviewRoot; sourceRoot = $SourceRoot; database = $database
            backendPort = $BackendPort; frontendPort = $FrontendPort
            backend = $null; frontend = $null; seeded = $false
            createdAtUtc = [DateTime]::UtcNow.ToString('o')
        }
        Save-State
    }
    $backendScript = Join-Path $backendDirectory 'scripts/isolated_server.py'
    $startedBackend = Start-Hidden $python @('-u', ('"' + $backendScript + '"'), '--port', "$BackendPort", '--reuse-test-database', $script:state.database) $backendDirectory 'backend'
    $script:state.backend = $startedBackend
    Save-State
    Wait-Health $BackendPort $startedBackend | Out-Null

    if ($SeedDemo) {
        if ($script:state.seeded) { throw '本评审库已经初始化示例，拒绝重复灌入。' }
        foreach ($resource in @('ingredients', 'dishes', 'meal-plans', 'daily-battles')) {
            $extra = if ($resource -eq 'ingredients') { '&status=all' } else { '' }
            $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/api/${resource}?limit=1$extra" -TimeoutSec 5
            if ($existing.meta.total -ne 0) { throw '测试库不是空库，拒绝初始化示例；原有数据已保留。' }
        }
        Read-Health $BackendPort | Out-Null
        & $python (Join-Path $backendDirectory 'scripts/seed_demo_data.py') "http://127.0.0.1:$BackendPort" > (Join-Path $reviewDirectory 'seed.stdout.log') 2> (Join-Path $reviewDirectory 'seed.stderr.log')
        if ($LASTEXITCODE -ne 0) { throw '示例写入失败，已保留记录与日志，不清库、不自动重试。' }
        $script:state.seeded = $true
        Save-State
    }

    $startedFrontend = Start-Hidden $node @(('"' + $vite + '"'), '--host', '127.0.0.1', '--port', "$FrontendPort", '--strictPort') $frontendDirectory 'frontend'
    $script:state.frontend = $startedFrontend
    Save-State
    Wait-Health $FrontendPort $startedFrontend | Out-Null
    Write-Output "评审页面：http://127.0.0.1:$FrontendPort"
    Write-Output "后端：http://127.0.0.1:$BackendPort；已验证独立数据库：$($script:state.database)"
    Write-Output '重复启动复用同一数据库；日志和进程记录位于 .review/。'
} catch {
    # 仅回收本次启动且身份匹配的服务，保留数据库和日志供核查。
    if ($startedFrontend) { Stop-OwnedProcess $startedFrontend; $script:state.frontend = $null }
    if ($startedBackend) { Stop-OwnedProcess $startedBackend; $script:state.backend = $null }
    if ($script:state) { Save-State }
    throw
} finally {
    foreach ($key in $environmentKeys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process') }
}
