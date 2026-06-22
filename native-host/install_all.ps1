# ClashOmega - All-in-One Installer / 一键安装脚本
# Supports: Chrome / Edge / 豆包 / 360 / QQ / Brave / Opera / Vivaldi / 搜狗 等所有 Chromium 内核浏览器
# Usage: Right-click -> Run with PowerShell
# 用法: 右键 -> 使用 PowerShell 运行

# ──── 全局配置 ────
$ErrorActionPreference = 'Continue'
$HostDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionDir = Join-Path $HostDir '..\extension'
$JsonFile = Join-Path $HostDir 'com.clash.omega.json'
$BatFile = Join-Path $HostDir 'clash_rules_manager.bat'
$NativeHostName = 'com.clash.omega'
$encoding = [System.Text.UTF8Encoding]::new($false)

# ──── 浏览器配置表（进程名 / 注册表路径 / 用户数据目录 / 显示名 / 启动参数）────
# 注册表 NativeMessagingHosts 路径规则：HKCU:\Software\<Vendor>\<Browser>\NativeMessagingHosts\<host-name>
# BrowserArgs: 启动浏览器时需要的额外参数（如豆包需要 --saman-browser-entry 才能启动浏览器功能）
$BrowserProfiles = @(
    # 国际主流
    @{ Name='Chrome';       Exe='chrome.exe';        RegPath='HKCU:\Software\Google\Chrome\NativeMessagingHosts';        UserData='%LOCALAPPDATA%\Google\Chrome\User Data';        Vendor='Google' },
    @{ Name='Edge';         Exe='msedge.exe';        RegPath='HKCU:\Software\Microsoft\Edge\NativeMessagingHosts';       UserData='%LOCALAPPDATA%\Microsoft\Edge\User Data';        Vendor='Microsoft' },
    @{ Name='Brave';        Exe='brave.exe';         RegPath='HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'; UserData='%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data'; Vendor='BraveSoftware' },
    @{ Name='Opera';        Exe='opera.exe';         RegPath='HKCU:\Software\Opera\Opera\NativeMessagingHosts';          UserData='%APPDATA%\Opera Software\Opera Stable';          Vendor='Opera' },
    @{ Name='Vivaldi';      Exe='vivaldi.exe';       RegPath='HKCU:\Software\Vivaldi\NativeMessagingHosts';              UserData='%LOCALAPPDATA%\Vivaldi\User Data';               Vendor='Vivaldi' },
    # 国产浏览器
    # 豆包浏览器：需要 --saman-browser-entry 参数才能启动浏览器功能（否则只打开豆包主界面）
    # 豆包的 Doubao.exe 是启动器，app\Doubao.exe 是主程序；启动器负责处理命令行参数
    @{ Name='Doubao';       Exe='Doubao.exe';        RegPath='HKCU:\Software\Doubao\NativeMessagingHosts';              UserData='%LOCALAPPDATA%\Doubao\User Data';                Vendor='Doubao';       BrowserArgs='--saman-browser-entry' },
    @{ Name='360Chrome';    Exe='360Chrome.exe';     RegPath='HKCU:\Software\360Chrome\Chrome\NativeMessagingHosts';     UserData='%LOCALAPPDATA%\360Chrome\Chrome\User Data';       Vendor='360Chrome' },
    @{ Name='QQBrowser';    Exe='QQBrowser.exe';     RegPath='HKCU:\Software\Tencent\QQBrowser\NativeMessagingHosts';    UserData='%LOCALAPPDATA%\Tencent\QQBrowser\User Data';      Vendor='Tencent' },
    @{ Name='SogouExplorer';Exe='SogouExplorer.exe'; RegPath='HKCU:\Software\SogouExplorer\NativeMessagingHosts';        UserData='%APPDATA%\SogouExplorer';                         Vendor='Sogou' }
)

# ──── 工具函数：展开环境变量路径 ────
function Expand-EnvPath($path) {
    return [System.Environment]::ExpandEnvironmentVariables($path)
}

# ──── 工具函数：控制台输出（带颜色）────
function Write-Step($msg, $color='Cyan') {
    Write-Host "[*] $msg" -ForegroundColor $color
}
function Write-OK($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}
function Write-Warn($msg) {
    Write-Host "[!] $msg" -ForegroundColor Yellow
}
function Write-Err($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
}
function Write-Info($msg) {
    Write-Host "    $msg" -ForegroundColor Gray
}

# ──── 步骤 1：检测 PowerShell 执行策略 ────
function Test-ExecutionPolicy {
    Write-Step '检查 PowerShell 执行策略...'
    $policy = Get-ExecutionPolicy -Scope CurrentUser
    Write-Info "当前策略 (CurrentUser): $policy"

    # RemoteSigned / Unrestricted / Bypass 都允许本地脚本运行
    if ($policy -in @('RemoteSigned', 'Unrestricted', 'Bypass')) {
        Write-OK '执行策略已允许本地脚本运行'
        return $true
    }

    # Restricted / AllSigned 需要修改
    Write-Warn "当前策略 ($policy) 会阻止本地脚本运行"
    $choice = Read-Host "是否自动设置为 RemoteSigned (CurrentUser 范围)? [Y/n]"
    if ($choice -eq '' -or $choice -match '^[Yy]') {
        try {
            Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
            Write-OK '已设置 ExecutionPolicy = RemoteSigned (CurrentUser)'
            return $true
        } catch {
            Write-Err "设置失败: $($_.Exception.Message)"
            Write-Warn '请手动执行: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser'
            return $false
        }
    } else {
        Write-Warn '用户取消，脚本可能无法运行'
        return $false
    }
}

# ──── 步骤 2：检测运行中的浏览器进程 ────
function Get-RunningBrowsers {
    Write-Step '检测运行中的浏览器进程...'
    $running = @()

    # 获取所有进程，匹配浏览器配置表
    $procs = Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name -Unique
    foreach ($profile in $BrowserProfiles) {
        $procName = [System.IO.Path]::GetFileNameWithoutExtension($profile.Exe)
        if ($procs -contains $procName) {
            $running += $profile
            Write-Info "检测到运行中: $($profile.Name) ($($profile.Exe))"
        }
    }

    if ($running.Count -eq 0) {
        Write-Info '未检测到运行中的浏览器进程'
    }
    # 使用 ,@() 一元数组构造符，确保单元素时仍返回数组而非哈希表
    return ,@($running)
}

# ──── 步骤 3：检测已安装浏览器（通过注册表 Uninstall 项 + 进程名探测）────
function Get-InstalledBrowsers {
    Write-Step '检测已安装的 Chromium 内核浏览器...'
    $installed = @()

    # 注册表卸载项路径
    $uninstallKeys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )

    # 关键字匹配（DisplayName 包含这些关键词的视为 Chromium 内核浏览器）
    $keywords = @('Chrome', 'Chromium', 'Edge', 'Brave', 'Opera', 'Vivaldi',
                  '豆包', 'Doubao', '360', 'QQ', '搜狗', 'Sogou')

    $foundApps = @()
    foreach ($key in $uninstallKeys) {
        try {
            $items = Get-ItemProperty $key -ErrorAction SilentlyContinue |
                     Where-Object { $_.DisplayName -ne $null }
            foreach ($item in $items) {
                $name = $item.DisplayName
                foreach ($kw in $keywords) {
                    if ($name -match $kw) {
                        $foundApps += [PSCustomObject]@{
                            Name = $name
                            Location = $item.InstallLocation
                            UninstallString = $item.UninstallString
                        }
                        break
                    }
                }
            }
        } catch {}
    }

    # 匹配浏览器配置表
    foreach ($profile in $BrowserProfiles) {
        $matched = $false
        # 方式 A：通过进程名在卸载项的 InstallLocation 中查找对应 exe
        foreach ($app in $foundApps) {
            if ($app.Location -and (Test-Path $app.Location)) {
                $exePath = Join-Path $app.Location $profile.Exe
                if (Test-Path $exePath) {
                    $profile.ExePath = $exePath
                    $installed += $profile
                    Write-Info "已安装: $($profile.Name) -> $exePath"
                    $matched = $true
                    break
                }
            }
        }
        if ($matched) { continue }

        # 方式 B：通过 PATH 环境变量查找
        $cmd = Get-Command $profile.Exe -ErrorAction SilentlyContinue
        if ($cmd) {
            $profile.ExePath = $cmd.Source
            $installed += $profile
            Write-Info "已安装 (PATH): $($profile.Name) -> $($cmd.Source)"
            continue
        }

        # 方式 C：常见安装路径探测
        $commonPaths = @(
            "$env:ProgramFiles\$($profile.Vendor)\$($profile.Exe)",
            "${env:ProgramFiles(x86)}\$($profile.Vendor)\$($profile.Exe)",
            "$env:LOCALAPPDATA\$($profile.Vendor)\$($profile.Exe)",
            "$env:APPDATA\$($profile.Vendor)\$($profile.Exe)"
        )
        foreach ($p in $commonPaths) {
            if (Test-Path $p) {
                $profile.ExePath = $p
                $installed += $profile
                Write-Info "已安装 (常见路径): $($profile.Name) -> $p"
                break
            }
        }
    }

    # 使用 ,@() 一元数组构造符，确保单元素时仍返回数组而非哈希表
    return ,@($installed)
}

# ──── 步骤 4：用户确认浏览器选择 ────
function Select-Browser($running, $installed) {
    Write-Host ''
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host '  请选择要安装 ClashOmega 的浏览器' -ForegroundColor Cyan
    Write-Host '========================================' -ForegroundColor Cyan

    # 合并去重（按 Name）—— 使用 @() 强制数组，避免单元素哈希表合并冲突
    $allBrowsers = @()
    $seenNames = @()
    foreach ($b in (@($running) + @($installed))) {
        if ($seenNames -notcontains $b.Name) {
            $allBrowsers += $b
            $seenNames += $b.Name
        }
    }

    if ($allBrowsers.Count -eq 0) {
        Write-Err '未检测到任何 Chromium 内核浏览器'
        Write-Warn '请先安装 Chrome / Edge / 豆包 / 360 / QQ / Brave 等浏览器后重试'
        return $null
    }

    # 列出所有检测到的浏览器
    Write-Host ''
    Write-Host '检测到的浏览器:' -ForegroundColor Yellow
    # 使用 @() 强制数组，避免单元素时 .Count 失效
    $runningArr = @($running)
    $installedArr = @($installed)
    for ($i = 0; $i -lt $allBrowsers.Count; $i++) {
        $b = $allBrowsers[$i]
        $status = @()
        if ($runningArr | Where-Object { $_.Name -eq $b.Name }) { $status += '运行中' }
        if ($installedArr | Where-Object { $_.Name -eq $b.Name }) { $status += '已安装' }
        $statusStr = $status -join ', '
        Write-Host "  [$($i+1)] $($b.Name)  ($statusStr)" -ForegroundColor White
    }

    # 如果有运行中的浏览器，将其作为推荐选项
    if ($runningArr.Count -gt 0) {
        Write-Host ''
        Write-Host "推荐: 检测到 $($runningArr.Count) 个运行中的浏览器，推荐选择正在使用的浏览器" -ForegroundColor Yellow
    }

    Write-Host ''
    $choice = Read-Host "输入序号选择浏览器 (1-$($allBrowsers.Count))，或输入 M 手动输入浏览器名称"

    if ($choice -match '^M$') {
        # 手动输入模式
        Write-Host ''
        Write-Host '手动输入模式:' -ForegroundColor Yellow
        Write-Host '  请输入浏览器进程名（不含 .exe 后缀），例如: Doubao' -ForegroundColor Gray
        Write-Host '  常见进程名: chrome / msedge / brave / opera / vivaldi / Doubao / 360Chrome / QQBrowser' -ForegroundColor Gray
        $manualName = Read-Host '进程名'
        if (-not $manualName) {
            Write-Err '输入为空'
            return $null
        }
        # 构造自定义浏览器配置
        $customProfile = @{
            Name = $manualName
            Exe = "$manualName.exe"
            RegPath = "HKCU:\Software\$manualName\NativeMessagingHosts"
            UserData = "%LOCALAPPDATA%\$manualName\User Data"
            Vendor = $manualName
            Custom = $true
        }
        Write-Info "自定义浏览器: $($customProfile.Name)"
        Write-Warn '注意: 自定义浏览器的 NativeMessagingHosts 注册表路径可能需要手动调整'
        Write-Warn '       如果扩展无法调用 Native Host，请检查注册表路径是否正确'
        return $customProfile
    }

    $idx = 0
    if (-not [int]::TryParse($choice, [ref]$idx) -or $idx -lt 1 -or $idx -gt $allBrowsers.Count) {
        Write-Err "无效的选择: $choice"
        return $null
    }
    $selected = $allBrowsers[$idx - 1]
    Write-OK "已选择: $($selected.Name)"
    return $selected
}

# ──── 步骤 5：获取扩展 ID（仅从已安装扩展中查找，不弹手动输入）────
function Get-ExistingExtensionId($browser) {
    # 方式 A：从浏览器用户数据目录的 Extensions 文件夹查找
    # 扩展 ID 是 32 个字符的 a-p 字母串
    $userDataPath = Expand-EnvPath $browser.UserData
    $extensionsDir = Join-Path $userDataPath 'Default\Extensions'

    if (Test-Path $extensionsDir) {
        $subDirs = Get-ChildItem $extensionsDir -Directory -ErrorAction SilentlyContinue
        foreach ($dir in $subDirs) {
            $extId = $dir.Name
            # 扩展 ID 格式：32 个字符，仅 a-p 字母
            if ($extId -match '^[a-p]{32}$') {
                # 检查 manifest.json 中是否包含 ClashOmega
                $versionDir = Get-ChildItem $dir.FullName -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($versionDir) {
                    $manifestPath = Join-Path $versionDir.FullName 'manifest.json'
                    if (Test-Path $manifestPath) {
                        try {
                            $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
                            if ($manifest.name -eq 'ClashOmega') {
                                return $extId
                            }
                        } catch {}
                    }
                }
            }
        }
    }

    # 方式 B：从 Secure Preferences 文件查找
    $prefsPath = Join-Path $userDataPath 'Default\Secure Preferences'
    if (Test-Path $prefsPath) {
        try {
            $prefs = Get-Content $prefsPath -Raw | ConvertFrom-Json
            $extSettings = $prefs.extensions.settings
            if ($extSettings) {
                # 使用 foreach 循环（而非 ForEach-Object 管道），确保 return 能退出函数
                foreach ($prop in $extSettings.PSObject.Properties) {
                    $id = $prop.Name
                    $settings = $prop.Value
                    if ($settings.manifest -and $settings.manifest.name -eq 'ClashOmega') {
                        return $id
                    }
                }
            }
        } catch {
            # Secure Preferences 解析失败（可能被 Chrome 加密），静默跳过
        }
    }

    return $null
}

# ──── 辅助函数：定位浏览器可执行文件路径（多来源探测）────
function Get-BrowserExePath($browser) {
    # 来源 1：已检测到的路径（由 Get-InstalledBrowsers 设置）
    if ($browser.ExePath -and (Test-Path $browser.ExePath)) {
        return $browser.ExePath
    }

    # 来源 2：对于有 BrowserArgs 的浏览器（如豆包），优先使用注册表 InstallDir 的路径（启动器）
    # 原因：豆包的 Doubao.exe 有两个位置——根目录（启动器）和 app 目录（主程序）
    # 快捷方式用的是根目录启动器，启动器负责处理 --saman-browser-entry 等命令行参数
    # 直接启动 app 目录的主程序可能不处理这些参数，导致浏览器功能无法启动
    if ($browser.BrowserArgs) {
        $regKeys = @(
            "HKCU:\SOFTWARE\$($browser.Vendor)",
            "HKLM:\SOFTWARE\$($browser.Vendor)"
        )
        foreach ($k in $regKeys) {
            if (Test-Path $k) {
                try {
                    $props = Get-ItemProperty $k -ErrorAction SilentlyContinue
                    if ($props.InstallDir) {
                        $exePath = Join-Path $props.InstallDir $browser.Exe
                        if (Test-Path $exePath) {
                            return $exePath
                        }
                    }
                } catch {}
            }
        }
    }

    # 来源 3：从 PATH 环境变量查找
    $cmd = Get-Command $browser.Exe -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    # 来源 4：从运行中进程的可执行文件路径获取
    $procName = [System.IO.Path]::GetFileNameWithoutExtension($browser.Exe)
    $proc = Get-Process -Name $procName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc -and $proc.Path) {
        return $proc.Path
    }

    # 来源 5：从注册表 InstallDir 获取（国产浏览器常见，如豆包）
    $regKeys = @(
        "HKCU:\SOFTWARE\$($browser.Vendor)",
        "HKLM:\SOFTWARE\$($browser.Vendor)"
    )
    foreach ($k in $regKeys) {
        if (Test-Path $k) {
            try {
                $props = Get-ItemProperty $k -ErrorAction SilentlyContinue
                if ($props.InstallDir) {
                    $exePath = Join-Path $props.InstallDir $browser.Exe
                    if (Test-Path $exePath) {
                        return $exePath
                    }
                }
            } catch {}
        }
    }
    return $null
}

# ──── 步骤 5（核心）：加载扩展并获取 ID（自动加载 + 手动确认）────
# 设计说明：
#   - --load-extension 加载的未打包扩展不会写入 Secure Preferences，也不会出现在 Extensions 目录
#   - Chrome 标准算法计算的 ID 在某些浏览器（如豆包）上与实际 ID 不匹配
#   - CDP（--remote-debugging-port）会导致豆包等浏览器启动异常
#   因此采用半自动方式：自动加载扩展 + 手动确认 ID
function Install-ExtensionAndGetId($browser) {
    Write-Step '加载 ClashOmega 扩展并获取 ID...'

    # 5.1 先尝试从已安装的扩展中获取 ID（适用于已通过"加载已解压的扩展程序"安装的情况）
    $extId = Get-ExistingExtensionId $browser
    if ($extId) {
        Write-OK "扩展已安装，ID: $extId"
        return $extId
    }

    # 5.2 扩展未安装，需要自动加载
    Write-Info '扩展尚未安装，准备自动加载...'

    # 5.3 定位浏览器可执行文件
    $exePath = Get-BrowserExePath $browser
    if (-not $exePath) {
        Write-Warn "未找到 $($browser.Exe) 可执行文件，无法自动加载"
        Write-Host '请手动加载扩展后输入 ID' -ForegroundColor Gray
        return (Get-ManualExtensionId)
    }

    # 5.4 规范化扩展目录路径
    $extensionAbsPath = (Resolve-Path $ExtensionDir -ErrorAction SilentlyContinue).Path
    if (-not $extensionAbsPath) {
        Write-Err "扩展目录不存在: $ExtensionDir"
        return $null
    }

    Write-Info "浏览器: $exePath"
    Write-Info "扩展目录: $extensionAbsPath"

    # 5.5 检测浏览器是否运行
    $procName = [System.IO.Path]::GetFileNameWithoutExtension($browser.Exe)
    $runningProcs = Get-Process -Name $procName -ErrorAction SilentlyContinue

    if ($runningProcs) {
        # 浏览器正在运行，需要关闭后才能用 --load-extension
        Write-Warn "检测到 $($browser.Name) 正在运行"
        Write-Host '  --load-extension 参数仅在浏览器启动时生效' -ForegroundColor Gray
        Write-Host '  需要关闭浏览器后重新启动以自动加载扩展' -ForegroundColor Gray
        Write-Host ''
        Write-Host '  关闭后浏览器会自动重新打开' -ForegroundColor Gray
        Write-Host '  如启用了"继续浏览上次会话"，标签页会自动恢复' -ForegroundColor Gray
        Write-Host ''
        $confirm = Read-Host '是否自动关闭浏览器并重新启动? [Y/n]'
        if ($confirm -ne '' -and $confirm -notmatch '^[Yy]') {
            Write-Warn '用户取消自动关闭，请手动加载扩展后输入 ID'
            return (Get-ManualExtensionId)
        }

        # 三级关闭策略：优雅关闭 → taskkill /T（温和）→ taskkill /T /F（强制）
        # 避免强制关闭导致浏览器进入崩溃恢复模式，从而使 --load-extension 参数失效

        # 第一级：CloseMainWindow 发送 WM_CLOSE，等待 20 秒
        Write-Info "正在关闭 $($browser.Name)（优雅关闭）..."
        foreach ($p in $runningProcs) {
            try { $p.CloseMainWindow() | Out-Null } catch {}
        }

        $waitSec = 20
        $waited = 0
        while ($waited -lt $waitSec) {
            Start-Sleep -Milliseconds 500
            $waited += 0.5
            $still = Get-Process -Name $procName -ErrorAction SilentlyContinue
            if (-not $still) { break }
        }

        # 第二级：taskkill /T（不带 /F，让进程自己清理并退出），等待 5 秒
        $still = Get-Process -Name $procName -ErrorAction SilentlyContinue
        if ($still) {
            Write-Warn "优雅关闭超时，使用 taskkill /T 递归关闭（温和）..."
            & taskkill /T /IM $browser.Exe 2>&1 | Out-Null
            Start-Sleep -Seconds 5
        }

        # 第三级：taskkill /T /F（强制关闭），等待 5 秒
        $still = Get-Process -Name $procName -ErrorAction SilentlyContinue
        if ($still) {
            Write-Warn "温和关闭未生效，使用 taskkill /T /F 强制关闭..."
            & taskkill /T /F /IM $browser.Exe 2>&1 | Out-Null
            Start-Sleep -Seconds 5
        }

        # 额外等待 3 秒确保所有文件句柄释放（避免文件锁导致 --load-extension 失效）
        Start-Sleep -Seconds 3

        # 验证浏览器确实已关闭
        $still = Get-Process -Name $procName -ErrorAction SilentlyContinue
        if ($still) {
            Write-Warn "$($browser.Name) 仍在运行，--load-extension 可能无法生效"
            Write-Host '  请手动关闭浏览器后按 Enter 继续...' -ForegroundColor Yellow
            Read-Host
        }

        Write-OK "浏览器已关闭"
    }

    # 5.6 使用 --load-extension 启动浏览器
    # 对于有 BrowserArgs 的浏览器（如豆包），需要添加专用参数才能启动浏览器功能
    Write-Info "启动浏览器并加载扩展..."
    $loadArg = "--load-extension=$extensionAbsPath"
    $startArgs = @($loadArg)
    if ($browser.BrowserArgs) {
        # BrowserArgs 放在 --load-extension 前面（豆包的 --saman-browser-entry 必须在其他参数前）
        $startArgs = @($browser.BrowserArgs) + $startArgs
        Write-Info "浏览器专用参数: $($browser.BrowserArgs)"
    }
    Write-Info "浏览器: $exePath"
    Write-Info "启动参数: $($startArgs -join ' ')"
    try {
        Start-Process -FilePath $exePath -ArgumentList $startArgs
    } catch {
        Write-Err "启动浏览器失败: $($_.Exception.Message)"
        return (Get-ManualExtensionId)
    }

    # 5.7 等待浏览器启动，然后提示用户从扩展管理页复制 ID 并手动输入
    Write-Info "等待浏览器启动..."
    Start-Sleep -Seconds 5  # 等待浏览器进程初始化（增加到 5 秒，确保完全启动）

    Write-Host ''
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host '  请从浏览器扩展管理页获取扩展 ID' -ForegroundColor Cyan
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '操作步骤:' -ForegroundColor Yellow
    Write-Host '  1. 在浏览器中打开扩展管理页（地址栏输入）:' -ForegroundColor Gray
    Write-Host '     Chrome/Edge: chrome://extensions/ 或 edge://extensions/' -ForegroundColor Gray
    Write-Host '     豆包/360/QQ/搜狗: chrome://extensions/' -ForegroundColor Gray
    Write-Host '  2. 确认「开发者模式」已开启' -ForegroundColor Gray
    Write-Host '  3. 找到 ClashOmega 扩展（应已自动加载并启用）' -ForegroundColor Gray
    Write-Host '  4. 复制扩展 ID（32 位 a-p 字母字符串）' -ForegroundColor Gray
    Write-Host '     例如: gjcbgmammjaaipeachmklagchcmimkpb' -ForegroundColor Gray
    Write-Host ''
    return (Get-ManualExtensionId)
}

# ──── 辅助函数：提示用户手动输入扩展 ID（含格式验证和重试）────
function Get-ManualExtensionId {
    $extId = Read-Host '请输入扩展 ID（直接回车跳过 Native Host 注册，稍后可重新运行本脚本）'

    if (-not $extId) {
        Write-Warn '扩展 ID 未提供，跳过 Native Host 注册'
        return $null
    }

    # 去除前后空白和可能的 chrome-extension:// 前缀
    $extId = $extId.Trim()
    if ($extId -match '^chrome-extension://([a-p]{32})/') {
        $extId = $matches[1]
    }

    # 格式验证：32 位 a-p 字母
    if ($extId.Length -ne 32 -or $extId -notmatch '^[a-p]{32}$') {
        Write-Warn "扩展 ID 格式错误: $extId"
        Write-Info '扩展 ID 应为 32 位 a-p 字母字符串（例如: gjcbgmammjaaipeachmklagchcmimkpb）'
        $retry = Read-Host '是否重新输入? [Y/n]'
        if ($retry -eq '' -or $retry -match '^[Yy]') {
            return (Get-ManualExtensionId)
        }
        return $null
    }

    Write-OK "已获取扩展 ID: $extId"
    return $extId
}

# ──── 步骤 6：生成 Native Host JSON 清单 ────
function New-NativeHostJson($extId) {
    Write-Step '生成 Native Host JSON 清单...'

    # 路径使用双反斜杠（JSON 字符串要求）
    $batPath = $BatFile -replace '\\', '\\'

    $json = @{
        name = $NativeHostName
        description = 'ClashOmega Native Messaging Host'
        path = $BatFile
        type = 'stdio'
        allowed_origins = @("chrome-extension://$extId/")
    }

    $jsonContent = ConvertTo-Json -InputObject $json -Depth 5
    [System.IO.File]::WriteAllText($JsonFile, $jsonContent, $encoding)

    Write-OK "已生成: $JsonFile"
    Write-Info "扩展 ID: $extId"
    Write-Info "Host 路径: $BatFile"
    return $true
}

# ──── 步骤 7：注册 Native Host 到注册表 ────
function Register-NativeHost($browser) {
    Write-Step "注册 Native Host 到注册表: $($browser.RegPath)"

    $regPath = $browser.RegPath + "\$NativeHostName"

    try {
        if (-not (Test-Path $regPath)) {
            New-Item -Path $regPath -Force | Out-Null
        }
        Set-ItemProperty -Path $regPath -Name '(Default)' -Value $JsonFile -Type String
        Write-OK "已注册: $regPath"
        Write-Info "默认值: $JsonFile"
        return $true
    } catch {
        Write-Err "注册表写入失败: $($_.Exception.Message)"
        Write-Warn '可能原因:'
        Write-Info '1. 浏览器使用非标准注册表路径（国产浏览器常见）'
        Write-Info '2. 权限不足（HKCU 通常无需管理员，但企业策略可能限制）'
        Write-Host ''
        Write-Host '手动注册方法:' -ForegroundColor Yellow
        Write-Host "  路径: $regPath" -ForegroundColor Gray
        Write-Host "  值:   $JsonFile" -ForegroundColor Gray
        return $false
    }
}

# ──── 步骤 7：Clash API 自动发现 ────
function Find-ClashApi {
    Write-Step '检测 Clash API...'

    # 先从 Clash Verge Rev 配置文件读取实际 external-controller 端口
    $configPorts = @()
    $vergeConfigPaths = @(
        "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml",
        "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml",
        "$env:APPDATA\clash-verge-rev\clash-verge.yaml",
        "$env:LOCALAPPDATA\clash-verge-rev\clash-verge.yaml"
    )
    foreach ($p in $vergeConfigPaths) {
        if (Test-Path $p) {
            try {
                $yamlContent = Get-Content $p -Raw -ErrorAction Stop
                # 匹配 external-controller: 127.0.0.1:9097 或 external-controller: '127.0.0.1:9097'
                if ($yamlContent -match 'external-controller\s*:\s*[''"]?(?:[\d.]+:)?(\d+)') {
                    $configPort = $matches[1]
                    $configPorts += $configPort
                    Write-Host "  从配置文件读取到 API 端口: $configPort ($p)" -ForegroundColor Gray
                }
            } catch {
                # 读取失败，忽略
            }
            break
        }
    }

    # 合并端口列表：配置文件中的端口优先，然后是常见端口
    $defaultPorts = @(9090, 9097, 9098, 9091, 8080, 7890)
    $ports = @($configPorts) + @($defaultPorts | Where-Object { $_ -notin $configPorts }) | Select-Object -Unique

    $found = $null

    foreach ($port in $ports) {
        $url = "http://127.0.0.1:$port"
        try {
            $response = Invoke-WebRequest -Uri "$url/configs" -Method GET -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $found = @{ Url = $url; Port = $port }
                Write-OK "检测到 Clash API: $url"
                break
            }
        } catch {
            # 401 表示端口正确，但需要认证（secret）
            if ($_.Exception.Response.StatusCode -eq 401) {
                $found = @{ Url = $url; Port = $port; NeedsAuth = $true }
                Write-OK "检测到 Clash API: $url (需要认证)"
                break
            }
            # 其他错误（连接拒绝等），继续尝试下一个端口
        }
    }

    if (-not $found) {
        Write-Warn '未检测到运行中的 Clash API'
        Write-Host ''
        Write-Host '请确保 Clash Verge Rev 或其他 Clash 内核已启动' -ForegroundColor Yellow
        Write-Host '启动后，扩展会自动探测 API 端口' -ForegroundColor Gray
        Write-Host ''
        return $null
    }

    # 检测 Clash Verge Rev 配置文件路径
    foreach ($p in $vergeConfigPaths) {
        if (Test-Path $p) {
            Write-OK "检测到 Clash Verge Rev 配置: $p"
            $found.ConfigPath = $p
            break
        }
    }

    return $found
}

# ──── 主流程 ────
function Main {
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host '  ClashOmega - All-in-One Installer' -ForegroundColor Cyan
    Write-Host '  ClashOmega - 一键安装脚本' -ForegroundColor Cyan
    Write-Host '  支持所有 Chromium 内核浏览器' -ForegroundColor Cyan
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host ''

    # 检查关键文件
    if (-not (Test-Path $BatFile)) {
        Write-Err "未找到: $BatFile"
        Write-Host '请确保 install_all.ps1 与 clash_rules_manager.bat 在同一目录' -ForegroundColor Yellow
        Read-Host '按 Enter 退出'
        exit 1
    }
    if (-not (Test-Path $ExtensionDir)) {
        Write-Err "未找到扩展目录: $ExtensionDir"
        Write-Host '请确保 extension/ 目录存在' -ForegroundColor Yellow
        Read-Host '按 Enter 退出'
        exit 1
    }

    # 步骤 1：PowerShell 执行策略
    Write-Host ''
    Write-Host '==== [步骤 1/6] PowerShell 执行策略 ====' -ForegroundColor Cyan
    if (-not (Test-ExecutionPolicy)) {
        Write-Warn '执行策略问题，后续脚本可能无法运行'
    }

    # 步骤 2：检测运行中浏览器
    Write-Host ''
    Write-Host '==== [步骤 2/6] 检测运行中浏览器 ====' -ForegroundColor Cyan
    $running = Get-RunningBrowsers

    # 步骤 3：检测已安装浏览器
    Write-Host ''
    Write-Host '==== [步骤 3/6] 检测已安装浏览器 ====' -ForegroundColor Cyan
    $installed = Get-InstalledBrowsers

    # 步骤 4：用户选择浏览器
    Write-Host ''
    Write-Host '==== [步骤 4/6] 选择目标浏览器 ====' -ForegroundColor Cyan
    $browser = Select-Browser $running $installed
    if (-not $browser) {
        Write-Err '未选择浏览器，安装终止'
        Read-Host '按 Enter 退出'
        exit 1
    }

    # 步骤 5：加载扩展并获取 ID（自动加载 + 手动确认）
    Write-Host ''
    Write-Host '==== [步骤 5/6] 加载扩展并获取 ID ====' -ForegroundColor Cyan
    $extId = Install-ExtensionAndGetId $browser

    if (-not $extId) {
        # 用户跳过了 ID 输入，终止安装
        Write-Host ''
        Write-Host '安装部分完成:' -ForegroundColor Yellow
        Write-Host '  ✓ 浏览器已启动（如未启动请手动打开）' -ForegroundColor Green
        Write-Host '  ✗ Native Host 未注册（需要扩展 ID）' -ForegroundColor Red
        Write-Host ''
        Write-Host '请:' -ForegroundColor Yellow
        Write-Host '  1. 在浏览器扩展管理页（chrome://extensions/）加载 ClashOmega 扩展' -ForegroundColor Gray
        Write-Host '  2. 复制扩展 ID（32 位 a-p 字母字符串）' -ForegroundColor Gray
        Write-Host '  3. 重新运行本脚本（已安装扩展会自动识别 ID）' -ForegroundColor Gray
        Read-Host '按 Enter 退出'
        exit 0
    }

    # 步骤 6：生成 Native Host JSON
    Write-Host ''
    Write-Host '==== [步骤 6/6] 生成 Native Host 清单并注册 ====' -ForegroundColor Cyan
    New-NativeHostJson $extId | Out-Null

    # 注册 Native Host
    Register-NativeHost $browser | Out-Null

    # Clash API 检测（可选，非阻塞）
    Write-Host ''
    Write-Step '检测 Clash API（可选）...'
    $clashApi = Find-ClashApi

    # 完成
    Write-Host ''
    Write-Host '========================================' -ForegroundColor Green
    Write-Host '  安装完成!' -ForegroundColor Green
    Write-Host '  Installation Complete!' -ForegroundColor Green
    Write-Host '========================================' -ForegroundColor Green
    Write-Host ''
    Write-Host '后续步骤:' -ForegroundColor Yellow
    Write-Host '  1. 在浏览器扩展管理页刷新 ClashOmega 扩展' -ForegroundColor Gray
    Write-Host '  2. 点击扩展图标，确认 Native Host 已连接（设置页可查看状态）' -ForegroundColor Gray
    if ($clashApi) {
        Write-Host "  3. Clash API 已检测: $($clashApi.Url)" -ForegroundColor Gray
    } else {
        Write-Host '  3. 启动 Clash Verge Rev，扩展会自动检测 API' -ForegroundColor Gray
    }
    Write-Host ''
    Write-Host '如遇问题:' -ForegroundColor Yellow
    Write-Host '  - 扩展无法调用 Native Host: 检查注册表路径是否匹配浏览器' -ForegroundColor Gray
    Write-Host '  - 规则不生效: 确认 Clash API 地址和密钥配置正确' -ForegroundColor Gray
    Write-Host '  - 重新运行本脚本可修复常见问题' -ForegroundColor Gray
    Write-Host ''
    Read-Host '按 Enter 退出'
}

# ──── 入口 ────
try {
    Main
} catch {
    Write-Err "致命错误: $($_.Exception.Message)"
    Write-Host ''
    Read-Host '按 Enter 退出'
    exit 1
}
