# ClashOmega Native Host 直接测试脚本（绕过 Chrome）
# 用途：验证 Native Host 本身是否能正常启动和响应
# 用法：powershell -ExecutionPolicy Bypass -File test-native-host.ps1

$ErrorActionPreference = 'Continue'
$HostDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatFile = Join-Path $HostDir 'clash_rules_manager.bat'

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ClashOmega Native Host Direct Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "HostDir: $HostDir" -ForegroundColor Gray
Write-Host "BatFile: $BatFile" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $BatFile)) {
    Write-Host "[ERROR] clash_rules_manager.bat not found at: $BatFile" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[1/4] Starting Native Host process..." -ForegroundColor Yellow
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $BatFile
$psi.WorkingDirectory = $HostDir
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

try {
    $p = [System.Diagnostics.Process]::Start($psi)
} catch {
    Write-Host "[ERROR] Failed to start process: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Start-Sleep -Milliseconds 300

if ($p.HasExited) {
    Write-Host "[ERROR] Process exited immediately with code: $($p.ExitCode)" -ForegroundColor Red
    $stderr = $p.StandardError.ReadToEnd()
    if ($stderr) {
        Write-Host ""
        Write-Host "=== STDERR ===" -ForegroundColor Yellow
        Write-Host $stderr
    }
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] Process started (PID: $($p.Id))" -ForegroundColor Green
Write-Host ""

function Send-NativeMsg($msg) {
    try {
        $json = ConvertTo-Json $msg -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $len = [System.BitConverter]::GetBytes([int]$bytes.Length)
        $p.StandardInput.BaseStream.Write($len, 0, 4)
        $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $p.StandardInput.BaseStream.Flush()
    } catch {
        return "SEND FAILED: $($_.Exception.Message)"
    }

    $respLen = New-Object byte[] 4
    $read = $p.StandardOutput.BaseStream.Read($respLen, 0, 4)
    if ($read -lt 4) {
        if ($p.HasExited) {
            return "NO RESPONSE (process exited, code: $($p.ExitCode))"
        }
        return "NO RESPONSE (read $read bytes)"
    }
    $rl = [System.BitConverter]::ToInt32($respLen, 0)
    if ($rl -le 0 -or $rl -gt 1048576) {
        return "INVALID RESPONSE LENGTH: $rl"
    }
    $rb = New-Object byte[] $rl
    $totalRead = 0
    while ($totalRead -lt $rl) {
        $r = $p.StandardOutput.BaseStream.Read($rb, $totalRead, $rl - $totalRead)
        if ($r -le 0) { return "STREAM CLOSED (read $totalRead / $rl)" }
        $totalRead += $r
    }
    return [System.Text.Encoding]::UTF8.GetString($rb)
}

Write-Host "=== Test 1: ping ===" -ForegroundColor Cyan
$result1 = Send-NativeMsg @{action="ping"}
Write-Host $result1
Write-Host ""

Write-Host "=== Test 2: detectClient ===" -ForegroundColor Cyan
$result2 = Send-NativeMsg @{action="detectClient"; apiUrl="http://127.0.0.1:9097"}
Write-Host $result2
Write-Host ""

Write-Host "=== Test 3: getScriptRules ===" -ForegroundColor Cyan
$result3 = Send-NativeMsg @{action="getScriptRules"}
Write-Host $result3
Write-Host ""

Start-Sleep -Milliseconds 200
$stderr = $p.StandardError.ReadToEnd()
if ($stderr) {
    Write-Host "=== STDERR ===" -ForegroundColor Yellow
    Write-Host $stderr
    Write-Host ""
}

if (-not $p.HasExited) {
    $p.Kill()
    Write-Host "[Cleanup] Process killed" -ForegroundColor Gray
} else {
    Write-Host "[Info] Process already exited (code: $($p.ExitCode))" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Test Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Read-Host "Press Enter to exit"
