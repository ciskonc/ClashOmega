# ClashOmega - Native Host Uninstaller / 卸载脚本
# Usage: Double-click uninstall.bat (recommended)
#       或: powershell -ExecutionPolicy Bypass -File uninstall.ps1
# 用法: 双击 uninstall.bat（推荐）
# S-015 新增：卸载 Native Host 注册表项 + 清理 JSON 清单文件
# 兼容：执行策略检测 + UTF-8 控制台编码（含 Unicode UTF-8 区域设置）

# ── UTF-8 控制台编码（兼容"使用 Unicode UTF-8"区域设置）──
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $currentCP = [Console]::InputEncoding.CodePage
    if ($currentCP -ne 65001) {
        chcp 65001 > $null 2>&1
    }
} catch {}

$ErrorActionPreference = 'Continue'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  ClashOmega - Native Host Uninstaller' -ForegroundColor Cyan
Write-Host '  ClashOmega - Native Host 卸载程序' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

# ── 执行策略检测 ──
$execPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($execPolicy -eq 'Restricted' -or $execPolicy -eq 'AllSigned') {
    Write-Host '[WARNING] Execution Policy is Restricted/AllSigned' -ForegroundColor Yellow
    Write-Host '[警告] 当前执行策略为 Restricted/AllSigned，可能导致脚本无法运行' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Solutions / 解决方案:' -ForegroundColor Cyan
    Write-Host '  1. Use uninstall.bat (recommended) / 使用 uninstall.bat（推荐）'
    Write-Host '  2. Or run: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned'
    Write-Host '     或运行: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned'
    Write-Host ''
}

# ── 删除注册表项 ──
$regPaths = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clash.omega',
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clash.manager'
)

$removedCount = 0
foreach ($regPath in $regPaths) {
    $name = Split-Path $regPath -Leaf
    if (Test-Path $regPath) {
        try {
            Remove-Item -Path $regPath -Force -Recurse
            Write-Host "[OK] Registry removed: $name" -ForegroundColor Green
            Write-Host "[OK] 已删除注册表: $name" -ForegroundColor Green
            $removedCount++
        } catch {
            Write-Host "[ERROR] Failed to remove registry: $name - $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "[错误] 删除注册表失败: $name - $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "[SKIP] Registry not found: $name (already removed)" -ForegroundColor Gray
        Write-Host "[跳过] 注册表不存在: $name（已删除或未安装）" -ForegroundColor Gray
    }
}

# ── 删除 JSON 清单文件 ──
$HostDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsonFiles = @(
    (Join-Path $HostDir 'com.clash.omega.json'),
    (Join-Path $HostDir 'com.clash.manager.json')
)

foreach ($jsonFile in $jsonFiles) {
    $name = Split-Path $jsonFile -Leaf
    if (Test-Path $jsonFile) {
        try {
            Remove-Item -Path $jsonFile -Force
            Write-Host "[OK] File removed: $name" -ForegroundColor Green
            Write-Host "[OK] 已删除文件: $name" -ForegroundColor Green
        } catch {
            Write-Host "[ERROR] Failed to remove file: $name - $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "[错误] 删除文件失败: $name - $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "[SKIP] File not found: $name" -ForegroundColor Gray
        Write-Host "[跳过] 文件不存在: $name" -ForegroundColor Gray
    }
}

Write-Host ''
if ($removedCount -gt 0 -or (Test-Path $regPaths[0]) -eq $false) {
    Write-Host '========================================' -ForegroundColor Green
    Write-Host '  [SUCCESS] Native Host uninstalled!' -ForegroundColor Green
    Write-Host '  [成功] Native Host 已卸载!' -ForegroundColor Green
    Write-Host '========================================' -ForegroundColor Green
} else {
    Write-Host '========================================' -ForegroundColor Yellow
    Write-Host '  [INFO] Native Host was not installed.' -ForegroundColor Yellow
    Write-Host '  [信息] Native Host 未安装，无需卸载。' -ForegroundColor Yellow
    Write-Host '========================================' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Please reload the extension: chrome://extensions/' -ForegroundColor Cyan
Write-Host '请重新加载扩展: chrome://extensions/' -ForegroundColor Cyan
Write-Host ''
Read-Host 'Press Enter to exit / 按 Enter 退出'
