param(
    # 扩展 ID（留空则交互询问；默认使用 manifest.json key 固定的 ID）
    # 注意：param 块内参数必须用逗号分隔（PowerShell 不接受「默认值后换行」作为分隔）
    [string]$ExtId = '',
    # 目标浏览器：all=自动检测全部已安装的 Chromium 系浏览器
    # 注意：ValidateSet 属性必须与类型标注紧邻（同一行）
    [ValidateSet('all', 'chrome', 'edge', 'brave', 'chromium')][string]$Browser = 'all'
)

# ClashOmega - Native Host Installer / 安装脚本
# Usage: Double-click install.bat (recommended)
#       或: powershell -ExecutionPolicy Bypass -File install.ps1 -ExtId <extension_id>
# 用法: 双击 install.bat（推荐）
# S-006 修复：移除多余的 UAC 自动提权（HKCU 注册表写入无需管理员权限）
# S-014 修复：执行策略检测 + UTF-8 控制台编码兼容

# ── UTF-8 控制台编码（兼容"使用 Unicode UTF-8"区域设置）──
# 部分用户开启了 Windows 区域设置中的"使用 Unicode UTF-8 提供全球语言支持"
# 导致系统代码页变为 65001，PowerShell 可能无法正确显示中文
# 强制设置控制台编码为 UTF-8，确保中英文混合输出正常
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    # 设置 chcp 65001（如果当前不是）
    $currentCP = [Console]::InputEncoding.CodePage
    if ($currentCP -ne 65001) {
        chcp 65001 > $null 2>&1
    }
} catch {
    # 编码设置失败不中断流程，仅影响显示
}


$ErrorActionPreference = 'Stop'
$HostDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$JsonFile = Join-Path $HostDir 'com.clash.omega.json'
$BatFile = Join-Path $HostDir 'clash_rules_manager.bat'

# ── 浏览器 NativeMessagingHosts 注册表映射（单一事实源）──
# v1.4.9 修复：原脚本只写 Chrome 键，却在帮助文本里教 Edge 用户如何安装，
# 导致 Edge/Brave 用户照流程装完后 popup 永远显示「未安装」且无任何报错。
# Chromium 系浏览器的宿主键位各不相同：
#   Chrome    = HKCU\Software\Google\Chrome\NativeMessagingHosts
#   Edge      = HKCU\Software\Microsoft\Edge\NativeMessagingHosts
#   Brave     = HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts
#   Chromium  = HKCU\Software\Chromium\NativeMessagingHosts
$BrowserRegMap = [ordered]@{
    chrome   = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clash.omega'
    edge     = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.clash.omega'
    brave    = 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.clash.omega'
    chromium = 'HKCU:\Software\Chromium\NativeMessagingHosts\com.clash.omega'
}

# 各浏览器的安装检测（用于 -Browser all 的自动发现）
$BrowserProbe = [ordered]@{
    chrome   = @{ Reg = 'HKCU:\Software\Google\Chrome' }
    edge     = @{ Reg = 'HKCU:\Software\Microsoft\Edge' }
    brave    = @{ Reg = 'HKCU:\Software\BraveSoftware\Brave-Browser' }
    chromium = @{ Reg = 'HKCU:\Software\Chromium' }
}


Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  ClashOmega - Native Host Installer' -ForegroundColor Cyan
Write-Host '  ClashOmega - Native Host 安装程序' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

# ── 执行策略检测 ──
# 如果用户直接运行 ps1（非通过 install.bat），执行策略可能阻止脚本
$execPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($execPolicy -eq 'Restricted' -or $execPolicy -eq 'AllSigned') {
    Write-Host '[WARNING] Execution Policy is Restricted/AllSigned' -ForegroundColor Yellow
    Write-Host '[警告] 当前执行策略为 Restricted/AllSigned，可能导致脚本无法运行' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Solutions / 解决方案:' -ForegroundColor Cyan
    Write-Host '  1. Use install.bat (recommended) / 使用 install.bat（推荐）'
    Write-Host '  2. Or run: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned'
    Write-Host '     或运行: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned'
    Write-Host ''
}

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

# v1.4.9：参数解析改用标准 param() 块（原手工解析 $args[0] 无法再加新参数）
$defaultExtId = 'llfbhodadhnfobbbkipelhknkjdflggm'
$ExtIdParam = $PSBoundParameters.ContainsKey('ExtId')
if (-not $ExtId) {
    # 扩展 ID 已通过 manifest.json 的 key 字段固定，无需用户手动查找
    # 直接回车使用默认 ID，或输入其他 ID 覆盖
    Write-Host "Default Extension ID / 默认扩展 ID: $defaultExtId (press Enter to use default / 直接回车使用默认值)" -ForegroundColor Green
    $ExtId = Read-Host 'Extension ID / 扩展 ID'
    if ([string]::IsNullOrWhiteSpace($ExtId)) {
        $ExtId = $defaultExtId
        Write-Host "Using default Extension ID / 使用默认扩展 ID: $ExtId" -ForegroundColor Cyan
    }
}
if ([string]::IsNullOrWhiteSpace($ExtId)) {
    Write-Host '[ERROR] Extension ID cannot be empty / 扩展 ID 不能为空' -ForegroundColor Red
    Read-Host 'Press Enter to exit / 按 Enter 退出'
    exit 1
}

# v1.4.11 修复：扩展 ID 宽松规范化（不再硬失败）
# v1.4.9 曾用「32 位 a-p」正则硬校验后直接 exit 1 —— 这是回归点：
#   用户手工粘贴的 ID 带空格/大写/换行时，旧版能注册（Chrome 侧宽松匹配），
#   新版却直接退出且不注册 → popup 永远显示「Native Host 未安装」。
# 现在：去掉空白字符 + 转小写；格式非标准只告警不终止（仍继续注册）。
$ExtId = ($ExtId -replace '\s', '').ToLowerInvariant()
if ($ExtId -notmatch '^[a-p]{32}$') {
    Write-Host "[WARNING] Extension ID '$ExtId' is not a standard 32-char id / 扩展 ID 不是标准 32 位格式" -ForegroundColor Yellow
    Write-Host '[警告] 扩展 ID 格式非标准（正常为 32 位 a-p 小写字母）——已清理空白并继续注册' -ForegroundColor Yellow
    Write-Host '[警告] 若安装后仍提示未安装，请核对浏览器 chrome://extensions/ 中显示的 ID 是否完全一致' -ForegroundColor Yellow
    Write-Host ''
}

# Generate JSON manifest / 生成清单文件
# v1.4.11 修复：同时写入「默认固定 ID」与「用户输入 ID」两个 origin（去重）
# 避免用户输入的 ID 与实际扩展 ID 不一致时 Chrome 报 forbidden 而扩展显示「未安装」
$origins = @("chrome-extension://$defaultExtId/")
if ($ExtId -and $ExtId -ne $defaultExtId) { $origins += "chrome-extension://$ExtId/" }

$json = @{
    name = 'com.clash.omega'
    description = 'ClashOmega Native Messaging Host'
    path = $BatFile
    type = 'stdio'
    # v1.4.11 修复：同时写入「默认固定 ID」与「用户输入 ID」两个 origin（去重）
    # 避免用户输入的 ID 与实际扩展 ID 不一致时 Chrome 报 forbidden 而扩展显示「未安装」
    allowed_origins = $origins
}

$jsonContent = ConvertTo-Json -InputObject $json -Depth 5
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($JsonFile, $jsonContent, $utf8)

Write-Host ''
Write-Host "[OK] Generated: $JsonFile" -ForegroundColor Gray
Write-Host "[OK] 已生成: $JsonFile" -ForegroundColor Gray

# ── 确定目标浏览器列表 ──
# -Browser all：探测本机实际安装的 Chromium 系浏览器，逐个注册
# 未探测到任何浏览器时，退回 Chrome + Edge 双写（写入未使用的键无害）
$targetBrowsers = @()
if ($Browser -eq 'all') {
    foreach ($name in $BrowserRegMap.Keys) {
        $probe = $BrowserProbe[$name]
        if (Test-Path $probe.Reg) { $targetBrowsers += $name }
    }
    if ($targetBrowsers.Count -eq 0) {
        $targetBrowsers = @('chrome', 'edge')
        Write-Host '[WARN] No Chromium browser detected, falling back to Chrome + Edge' -ForegroundColor Yellow
        Write-Host '[警告] 未检测到 Chromium 系浏览器，回退为 Chrome + Edge 双注册' -ForegroundColor Yellow
    }
} else {
    $targetBrowsers = @($Browser)
}

# ── Register in HKCU / 写入注册表（逐浏览器）──
$registered = @()
$failed = @()
foreach ($browserName in $targetBrowsers) {
    $regPath = $BrowserRegMap[$browserName]
    try {
        New-Item -Path $regPath -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name '(Default)' -Value $JsonFile -Type String
        $registered += $browserName
        Write-Host "[OK] Registered for $browserName" -ForegroundColor Gray
    }
    catch {
        $failed += $browserName
        Write-Host "[ERROR] Registry write failed for $browserName : $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "[错误] 注册表写入失败 ($browserName): $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ''
if ($registered.Count -gt 0) {
    Write-Host '========================================' -ForegroundColor Green
    Write-Host "  [SUCCESS] Native Host registered for: $($registered -join ', ')" -ForegroundColor Green
    Write-Host "  [成功] Native Host 已注册（浏览器）: $($registered -join ', ')" -ForegroundColor Green
    Write-Host '========================================' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Please reload the extension: chrome://extensions/ (edge://extensions/)'
    Write-Host '请重新加载扩展: chrome://extensions/ (edge://extensions/)'
}
if ($failed.Count -gt 0) {
    Write-Host ''
    Write-Host "[WARN] Failed for: $($failed -join ', ')" -ForegroundColor Yellow
    Write-Host "[警告] 以下浏览器注册失败: $($failed -join ', ')" -ForegroundColor Yellow
    Write-Host 'Manual registry path / 手动注册表路径:' -ForegroundColor Yellow
    foreach ($browserName in $failed) {
        Write-Host "  $($BrowserRegMap[$browserName])"
        Write-Host "  Value: $JsonFile"
    }
}

Write-Host ''
# 交互模式才等待 Enter
if (-not $ExtIdParam) {
    Read-Host 'Press Enter to exit / 按 Enter 退出'
}

