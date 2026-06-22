# ClashOmega - Native Host Installer / 安装脚本
# Usage: Right-click -> Run with PowerShell
# 用法: 右键 -> 使用 PowerShell 运行
# S-006 修复：移除多余的 UAC 自动提权（HKCU 注册表写入无需管理员权限）

$ErrorActionPreference = 'Stop'
$HostDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$JsonFile = Join-Path $HostDir 'com.clash.omega.json'
$BatFile = Join-Path $HostDir 'clash_rules_manager.bat'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  ClashOmega - Native Host Installer' -ForegroundColor Cyan
Write-Host '  ClashOmega - Native Host 安装程序' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $BatFile)) {
    Write-Host '[ERROR] clash_rules_manager.bat not found' -ForegroundColor Red
    Write-Host '[错误] 未找到 clash_rules_manager.bat' -ForegroundColor Red
    Read-Host 'Press Enter to exit / 按 Enter 退出'
    exit 1
}

Write-Host 'How to find your Extension ID / 如何获取扩展 ID:' -ForegroundColor Yellow
Write-Host ''
Write-Host '  === Chrome / Chrome 浏览器 ==='
Write-Host '  1. Open chrome://extensions/ in address bar'
Write-Host '     在地址栏打开 chrome://extensions/'
Write-Host '  2. Enable "Developer mode" (toggle at top-right)'
Write-Host '     打开右上角 "开发者模式" 开关'
Write-Host '  3. Find "ClashOmega" in the list'
Write-Host '     在列表中找到 "ClashOmega"'
Write-Host '  4. Copy the ID string (32 chars, like abcdef...)'
Write-Host '     复制 ID 字符串 (32位字符, 类似 abcdef...)'
Write-Host ''
Write-Host '  === Edge / Edge 浏览器 ==='
Write-Host '  1. Open edge://extensions/ in address bar'
Write-Host '     在地址栏打开 edge://extensions/'
Write-Host '  2. Enable "Developer mode" (toggle at bottom-left)'
Write-Host '     打开左下角 "开发人员模式" 开关'
Write-Host '  3. Find "ClashOmega" in the list'
Write-Host '     在列表中找到 "ClashOmega"'
Write-Host '  4. Copy the ID string'
Write-Host '     复制 ID 字符串'
Write-Host ''

$ExtId = Read-Host 'Extension ID / 扩展 ID'
if ([string]::IsNullOrWhiteSpace($ExtId)) {
    Write-Host '[ERROR] Extension ID cannot be empty / 扩展 ID 不能为空' -ForegroundColor Red
    Read-Host 'Press Enter to exit / 按 Enter 退出'
    exit 1
}

# Generate JSON manifest / 生成清单文件
$json = @{
    name = 'com.clash.omega'
    description = 'ClashOmega Native Messaging Host'
    path = $BatFile
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtId/")
}

$jsonContent = ConvertTo-Json -InputObject $json -Depth 5
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($JsonFile, $jsonContent, $utf8)

Write-Host ''
Write-Host "[OK] Generated: $JsonFile" -ForegroundColor Gray
Write-Host "[OK] 已生成: $JsonFile" -ForegroundColor Gray

# Register in HKCU / 写入注册表
$regPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clash.omega'
try {
    New-Item -Path $regPath -Force | Out-Null
    Set-ItemProperty -Path $regPath -Name '(Default)' -Value $JsonFile -Type String
    Write-Host ''
    Write-Host '========================================' -ForegroundColor Green
    Write-Host '  [SUCCESS] Native Host registered!' -ForegroundColor Green
    Write-Host '  [成功] Native Host 已注册!' -ForegroundColor Green
    Write-Host '========================================' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Please reload the extension: chrome://extensions/'
    Write-Host '请重新加载扩展: chrome://extensions/'
}
catch {
    Write-Host "[ERROR] Registry write failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "[错误] 注册表写入失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    Write-Host 'Manual registry path / 手动注册表路径:' -ForegroundColor Yellow
    Write-Host "  HKCU\Software\Google\Chrome\NativeMessagingHosts\com.clash.omega"
    Write-Host "  Value: $JsonFile"
}

Write-Host ''
Read-Host 'Press Enter to exit / 按 Enter 退出'