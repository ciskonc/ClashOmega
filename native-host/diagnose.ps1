# ClashOmega - Native Host 端到端诊断脚本
# v1.4.11：安装后扩展仍显示「Native Host 未安装」时，用它定位卡在哪一环。
# 用法：右键本文件 → 使用 PowerShell 运行；或 powershell -ExecutionPolicy Bypass -NoProfile -File diagnose.ps1
# 把完整输出发回即可对号入座。

$ErrorActionPreference = 'Continue'
$HostName = 'com.clash.omega'
$failCount = 0
$warnCount = 0

function Write-Step($n, $title) {
    Write-Host ''
    Write-Host ('[' + $n + '] ' + $title) -ForegroundColor Cyan
    Write-Host ('-' * 62) -ForegroundColor DarkGray
}
function Write-OK($msg)   { Write-Host ('  [OK]   ' + $msg) -ForegroundColor Green }
function Write-Warn($msg) { Write-Host ('  [WARN] ' + $msg) -ForegroundColor Yellow; $script:warnCount++ }
function Write-Bad($msg)  { Write-Host ('  [FAIL] ' + $msg) -ForegroundColor Red;    $script:failCount++ }
function Write-Info($msg) { Write-Host ('  [INFO] ' + $msg) -ForegroundColor Gray }

Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ' ClashOmega Native Host 诊断 / Diagnostics' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan

# ──── 1. 注册表键 ────
Write-Step 1 '注册表宿主键（各浏览器的 NativeMessagingHosts）'
$regKeys = @(
    @{ Name = 'Chrome';   Path = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\' + $HostName },
    @{ Name = 'Edge';     Path = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\' + $HostName },
    @{ Name = 'Brave';    Path = 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\' + $HostName },
    @{ Name = 'Chromium'; Path = 'HKCU:\Software\Chromium\NativeMessagingHosts\' + $HostName }
)
$foundJson = $null
foreach ($k in $regKeys) {
    if (Test-Path -LiteralPath $k.Path) {
        $v = (Get-ItemProperty -LiteralPath $k.Path -Name '(Default)' -ErrorAction SilentlyContinue).'(Default)'
        if ($v) {
            Write-OK ($k.Name + ': ' + $v)
            if (-not $foundJson) { $foundJson = $v }
        } else {
            Write-Bad ($k.Name + ': 键存在但 (Default) 为空 → 清单缺失，请重新运行 install.ps1')
        }
    } else {
        Write-Info ($k.Name + ': 未注册（不使用该浏览器可忽略）')
    }
}
if (-not $foundJson) {
    Write-Bad '所有浏览器都未注册宿主 → 请先运行 install.ps1'
}

# ──── 2. 清单文件 ────
Write-Step 2 '宿主清单文件（com.clash.omega.json）'
if ($foundJson) {
    if (-not (Test-Path -LiteralPath $foundJson)) {
        Write-Bad ('清单文件不存在: ' + $foundJson)
        Write-Info '→ 解压后目录被移动/删除，或 install.ps1 未跑成功。重新运行 install.ps1'
    } else {
        Write-OK ('清单存在: ' + $foundJson)
        try {
            $manifest = Get-Content -LiteralPath $foundJson -Raw | ConvertFrom-Json
            Write-Info ('name            = ' + $manifest.name)
            Write-Info ('type            = ' + $manifest.type)
            Write-Info ('path            = ' + $manifest.path)
            Write-Info ('allowed_origins = ' + (@($manifest.allowed_origins) -join ', '))
            if ($manifest.name -ne $HostName) { Write-Bad ('清单 name 不是 ' + $HostName + ' → Chrome 不会加载') }
            if (-not $manifest.path) {
                Write-Bad '清单缺少 path 字段 → Chrome 无法启动宿主'
            } else {
                if (Test-Path -LiteralPath $manifest.path) {
                    Write-OK ('宿主程序存在: ' + $manifest.path)
                } else {
                    Write-Bad ('宿主程序不存在: ' + $manifest.path)
                    Write-Info '→ 目录被移动过，或 install.ps1 是在别的目录运行的。请在当前目录重跑 install.ps1'
                }
            }
            $defaultId = 'llfbhodadhnfobbbkipelhknkjdflggm'
            $hasDefault = $false
            foreach ($o in @($manifest.allowed_origins)) {
                if ($o -eq ('chrome-extension://' + $defaultId + '/')) { $hasDefault = $true }
            }
            if (-not $hasDefault) {
                Write-Warn ('allowed_origins 不含默认扩展 ID (' + $defaultId + ')')
                Write-Info '→ 若浏览器里的扩展 ID 与清单不一致，Chrome 会拒绝通信（forbidden）。请重跑 install.ps1'
            }
        } catch {
            Write-Bad ('清单解析失败: ' + $_.Exception.Message)
            Write-Info '→ 清单损坏，请重跑 install.ps1 重新生成'
        }
    }
}

# ──── 3. 宿主程序手动握手 ────
Write-Step 3 '宿主程序手动握手（模拟 Chrome 的调用方式）'
if ($foundJson -and (Test-Path -LiteralPath $foundJson)) {
    try {
        $manifest = Get-Content -LiteralPath $foundJson -Raw | ConvertFrom-Json
        $hostExe = $manifest.path
        if (-not $hostExe -or -not (Test-Path -LiteralPath $hostExe)) {
            Write-Bad '宿主文件不存在，跳过握手测试'
        } else {
            # 用「文件重定向」模拟 Chrome 的 stdin/stdout 管道：cmd.exe /c "<bat>" < in.bin > out.bin
            # 比匿名管道更接近 Chrome 真实行为（PS 5.1 的 Console.OpenStandardInput 需要继承的文件句柄）
            $workDir = Join-Path $env:TEMP ('clashomega_nm_' + [System.Guid]::NewGuid().ToString('N').Substring(0,8))
            New-Item -ItemType Directory -Path $workDir -Force | Out-Null
            $inFile  = Join-Path $workDir 'in.bin'
            $outFile = Join-Path $workDir 'out.bin'
            $msg = '{"action":"ping"}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
            $lenBytes = [System.BitConverter]::GetBytes([int]$bytes.Length)
            $payload = New-Object byte[] ($lenBytes.Length + $bytes.Length)
            [Array]::Copy($lenBytes, 0, $payload, 0, $lenBytes.Length)
            [Array]::Copy($bytes, 0, $payload, $lenBytes.Length, $bytes.Length)
            [System.IO.File]::WriteAllBytes($inFile, $payload)
            if ($hostExe -match '\.bat$') { Write-Info '宿主是 .bat，按 Chrome 的方式用 cmd.exe /c 启动' }
            # 写到临时 .cmd 文件再执行：cmd /c ""..."" 的引号嵌套极易出错，
            # 用 .cmd 文件让 cmd 自己解析重定向，行为与 Chrome 启动 .bat 一致
            $cmdFile = Join-Path $workDir 'run.cmd'
            $cmdBody = '@echo off' + "`r`n" + '"' + $hostExe + '" < "' + $inFile + '" > "' + $outFile + '"' + "`r`n"
            [System.IO.File]::WriteAllText($cmdFile, $cmdBody, [System.Text.Encoding]::Default)
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = 'cmd.exe'
            $psi.Arguments = '/c ""' + $cmdFile + '""'
            $psi.UseShellExecute = $false
            $psi.RedirectStandardError = $true
            $psi.CreateNoWindow = $true
            $proc = [System.Diagnostics.Process]::Start($psi)
            if (-not $proc.WaitForExit(25000)) {
                Write-Bad '宿主 25 秒未退出（可能卡住或等待输入）'
                try { $proc.Kill() } catch { }
            }
            if (Test-Path -LiteralPath $outFile) {
                $raw = [System.IO.File]::ReadAllBytes($outFile)
                if ($raw.Length -ge 4) {
                    $len = [System.BitConverter]::ToInt32($raw, 0)
                    $take = [Math]::Min($len, $raw.Length - 4)
                    $resp = [System.Text.Encoding]::UTF8.GetString($raw, 4, $take)
                    Write-OK ('宿主握手成功，响应: ' + $resp)
                    Write-Info '→ 若扩展仍显示「未安装」，问题在浏览器侧（扩展 ID 不匹配 / 未重载扩展 / 浏览器策略）'
                } else {
                    Write-Bad ('宿主无输出（' + $raw.Length + ' 字节）')
                }
            } else {
                Write-Bad '宿主没有产生输出文件'
                $errText = ''
                try { $errText = $proc.StandardError.ReadToEnd() } catch { }
                if ($errText) { Write-Info ('stderr: ' + $errText.Trim()) }
            }
            Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Bad ('握手测试异常: ' + $_.Exception.Message)
    }
}

# ──── 4. 环境检查 ────
Write-Step 4 '环境检查'
try {
    $psExe = (Get-Command powershell.exe -ErrorAction Stop).Source
    Write-Info ('powershell.exe: ' + $psExe)
} catch {
    Write-Bad '未找到 powershell.exe → Native Host 无法启动'
}
$execPolicy = Get-ExecutionPolicy -Scope CurrentUser
Write-Info ('当前用户执行策略: ' + $execPolicy)
if ($execPolicy -eq 'Restricted' -or $execPolicy -eq 'AllSigned') {
    Write-Warn '执行策略为 Restricted/AllSigned → 直接运行 .ps1 会被拒绝（install.bat 已用 Bypass 规避）'
}
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($b in @('install.bat','clash_rules_manager.bat','uninstall.bat','clash_rules_manager.ps1')) {
    $bp = Join-Path $scriptDir $b
    if (Test-Path -LiteralPath $bp) {
        $raw = [System.IO.File]::ReadAllBytes($bp)
        $lf = 0; $crlf = 0
        for ($i = 0; $i -lt $raw.Length; $i++) {
            if ($raw[$i] -eq 10) { if ($i -gt 0 -and $raw[$i-1] -eq 13) { $crlf++ } else { $lf++ } }
        }
        if ($b -like '*.ps1') {
            $hasBom = ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF)
            if (-not $hasBom) {
                Write-Bad ($b + ' 缺少 UTF-8 BOM → Windows PowerShell 5.1 会按 ANSI 读取导致中文乱码与语法错误，宿主必然启动失败')
            } else {
                Write-OK ($b + ' UTF-8 BOM 正常')
            }
        } else {
            if ($lf -gt 0) {
                Write-Warn ($b + ' 含 ' + $lf + ' 个 LF-only 换行（应为 CRLF）→ cmd 解析 goto/label 会失败，请重新解压 zip')
            } else {
                Write-OK ($b + ' 行尾正确（CRLF x' + $crlf + '）')
            }
        }
    }
}

# ──── 5. 结论 ────
Write-Step 5 '结论'
if ($failCount -eq 0 -and $warnCount -eq 0) {
    Write-Host '  所有检查通过。若扩展仍显示「Native Host 未安装」，请：' -ForegroundColor Green
    Write-Host '   1) 确认已重载扩展（chrome://extensions/ → 刷新图标）' -ForegroundColor Green
    Write-Host '   2) 确认扩展 ID 与清单 allowed_origins 一致' -ForegroundColor Green
} else {
    Write-Host ('  发现 ' + $failCount + ' 个失败项 / ' + $warnCount + ' 个警告项，请按上面的 [FAIL]/[WARN] 逐条处理') -ForegroundColor Yellow
}
Write-Host ''
Write-Host '诊断结束，请把以上完整输出发回。' -ForegroundColor Cyan
Write-Host ''