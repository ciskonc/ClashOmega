# Clash Rules Manager - Native Messaging Host (PowerShell)
# 被 Chrome 按需调用，读写 Clash 配置文件中的 rules 字段。
# 协议: stdin/stdout 二进制消息 (4字节小端序长度 + UTF-8 JSON)
# 依赖: 仅 Windows 内置 PowerShell，零额外安装

param()

# 不使用全局 Stop，防止非关键错误导致进程崩溃
$ErrorActionPreference = 'Continue'
$encoding = [System.Text.UTF8Encoding]::new($false)

# ──── 默认 Clash 配置路径 / Default config search paths ────
$DefaultConfigPaths = @(
    # Clash Verge Rev (Electron 数据目录，最常见)
    "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml",
    "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev\config.yaml",
    # Clash Verge Rev 旧路径
    "$env:APPDATA\clash-verge-rev\clash-verge.yaml",
    "$env:APPDATA\clash-verge-rev\config.yaml",
    # Clash Verge Rev LOCALAPPDATA 变体
    "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml",
    "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev\config.yaml",
    "$env:LOCALAPPDATA\clash-verge-rev\clash-verge.yaml",
    "$env:LOCALAPPDATA\clash-verge-rev\config.yaml",
    # Clash Verge
    "$env:USERPROFILE\.config\clash-verge\config.yaml",
    # Mihomo / Clash.Meta
    "$env:USERPROFILE\.config\mihomo\config.yaml",
    # FlClash (Flutter 应用，Windows 数据目录在 APPDATA/LOCALAPPDATA 下，包名 com.follow.clash)
    "$env:APPDATA\com.follow.clash\config.yaml",
    "$env:LOCALAPPDATA\com.follow.clash\config.yaml",
    # FlClash Unix 风格路径（Linux/macOS 兼容）
    "$env:USERPROFILE\.config\flclash\config.yaml",
    # Clash for Windows
    "$env:USERPROFILE\.config\clash\config.yaml",
    "$env:USERPROFILE\.config\clash\profiles\default.yaml",
    # Clash Nyanpasu
    "$env:USERPROFILE\.config\clash-nyanpasu\config.yaml",
    # 通用 AppData 路径
    "$env:LOCALAPPDATA\clash\config.yaml",
    "$env:APPDATA\clash\config.yaml",
    "$env:APPDATA\mihomo\config.yaml"
)

# 需要递归搜索 *.yaml 的目录
$ProfileSearchDirs = @(
    "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev\profiles",
    "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev\profiles",
    "$env:APPDATA\clash-verge-rev\profiles",
    "$env:LOCALAPPDATA\clash-verge-rev\profiles",
    "$env:USERPROFILE\.config\clash\profiles",
    "$env:USERPROFILE\.config\clash-verge\profiles",
    "$env:USERPROFILE\.config\mihomo\profiles",
    # FlClash profiles 目录（Flutter 应用，profiles 子目录）
    "$env:APPDATA\com.follow.clash\profiles",
    "$env:LOCALAPPDATA\com.follow.clash\profiles",
    "$env:APPDATA\clash\profiles",
    "$env:LOCALAPPDATA\clash\profiles"
)

# 可能包含 profiles.yaml 的 Clash GUI 配置目录（用于解析 type:rules 的 profile）
$ProfilesYamlDirs = @(
    "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev",
    "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev",
    "$env:APPDATA\clash-verge-rev",
    "$env:LOCALAPPDATA\clash-verge-rev",
    "$env:USERPROFILE\.config\clash-verge",
    "$env:USERPROFILE\.config\clash",
    "$env:USERPROFILE\.config\mihomo"
)

function Get-ConfigPath {
    # 1. 环境变量优先
    $envPath = $env:CLASH_CONFIG_PATH
    if ($envPath -and (Test-Path $envPath)) {
        return $envPath
    }

    # 2. 从 profiles.yaml 解析当前激活的 profile 文件
    #    Clash Verge Rev 架构说明：
    #    - profiles.yaml 的 current 字段指向当前激活的 profile UID
    #    - items 列表中每个条目有 uid/type/file 字段
    #    - current 指向的 profile 文件包含完整的 Clash 配置（proxies, rules, proxy-groups 等）
    #    - type:rules 条目只是规则覆盖模板（append/prepend/delete），不是完整配置
    $foundProfilePath = $null
    $profileDir = $null

    foreach ($dir in $ProfilesYamlDirs) {
        $profilesYaml = Join-Path $dir 'profiles.yaml'
        if (Test-Path $profilesYaml) {
            $profileContent = [System.IO.File]::ReadAllText($profilesYaml, $encoding)
            $lines = $profileContent -split "`n"

            # 2a. 优先：解析 current 字段，找到当前激活的 profile
            $currentUid = $null
            foreach ($line in $lines) {
                $trimmed = $line.Trim()
                if ($trimmed -match '^current\s*:\s*(\S+)') {
                    $currentUid = $matches[1]
                    break
                }
            }

            if ($currentUid) {
                # 在 items 列表中查找 uid 匹配 currentUid 的条目
                $itemUid = $null; $itemFile = $null; $itemType = $null
                foreach ($line in $lines) {
                    $trimmed = $line.Trim()
                    if ($trimmed -match '^-\s*uid\s*:\s*(\S+)') {
                        # 遇到新条目，检查上一个条目是否匹配
                        if ($itemUid -eq $currentUid -and $itemFile) {
                            $foundProfilePath = Join-Path (Join-Path $dir 'profiles') $itemFile
                            if (Test-Path $foundProfilePath) { return $foundProfilePath }
                        }
                        $itemUid = $matches[1]; $itemFile = $null; $itemType = $null
                    }
                    elseif ($trimmed -match '^\s*type\s*:\s*(\S+)') { $itemType = $matches[1] }
                    elseif ($trimmed -match '^\s*file\s*:\s*(\S+)') { $itemFile = $matches[1] }
                }
                # 检查最后一个条目
                if ($itemUid -eq $currentUid -and $itemFile) {
                    $foundProfilePath = Join-Path (Join-Path $dir 'profiles') $itemFile
                    if (Test-Path $foundProfilePath) { return $foundProfilePath }
                }
            }

            # 2b. 次选：如果 current 字段未找到，查找 type:rules 的 profile 文件
            $currentType = $null; $currentFile = $null
            foreach ($line in $lines) {
                $trimmed = $line.Trim()
                if ($trimmed -match '^-\s*uid\s*:') { $currentType = $null; $currentFile = $null }
                elseif ($trimmed -match '^\s*type\s*:\s*(\S+)') { $currentType = $matches[1] }
                elseif ($trimmed -match '^\s*file\s*:\s*(\S+)') { $currentFile = $matches[1] }
                if ($currentType -eq 'rules' -and $currentFile) {
                    # Join-Path 在 Windows PowerShell 5.1 中只接受两个位置参数，必须嵌套调用
                    $foundProfilePath = Join-Path (Join-Path $dir 'profiles') $currentFile
                    $profileDir = $dir
                    if (Test-Path $foundProfilePath) { return $foundProfilePath }
                    $currentType = $null; $currentFile = $null
                }
            }

            # 2c. 兜底：取任意一个非 remote 的 profile 文件
            if (-not $foundProfilePath) {
                $currentType = $null; $currentFile = $null
                foreach ($line in $lines) {
                    $trimmed = $line.Trim()
                    if ($trimmed -match '^-\s*uid\s*:') { $currentType = $null; $currentFile = $null }
                    elseif ($trimmed -match '^\s*type\s*:\s*(\S+)') { $currentType = $matches[1] }
                    elseif ($trimmed -match '^\s*file\s*:\s*(\S+)') { $currentFile = $matches[1] }
                    if ($currentType -ne 'remote' -and $currentType -ne 'script' -and $currentFile) {
                        # Join-Path 在 Windows PowerShell 5.1 中只接受两个位置参数，必须嵌套调用
                        $foundProfilePath = Join-Path (Join-Path $dir 'profiles') $currentFile
                        $profileDir = $dir
                        if (Test-Path $foundProfilePath) { break }
                        $currentType = $null; $currentFile = $null
                    }
                }
            }
        }
    }

    # 如果从 profiles.yaml 中找到了 profile 文件（但可能不是 type:rules，作为次选）
    if ($foundProfilePath -and (Test-Path $foundProfilePath)) {
        return $foundProfilePath
    }

    # 3. 在 profile 目录中递归搜索（优先于快照文件）
    #    用户在 profiles 目录下手动创建的规则文件通常在这里
    foreach ($dir in $ProfileSearchDirs) {
        if (Test-Path $dir) {
            $found = Get-ChildItem -Path $dir -Filter "*.yaml" -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) { return $found.FullName }
        }
    }

    # 4. 检查固定路径列表（最后兜底）
    #    注意：clash-verge.yaml 是 Clash Verge Rev 的快照文件，重启后会丢失修改。
    foreach ($p in $DefaultConfigPaths) {
        if (Test-Path $p) {
            return $p
        }
    }

    # 5. 尝试从运行中的 Clash 进程获取配置文件路径
    $clashProcs = Get-CimInstance Win32_Process -Filter "name like '%clash%' or name like '%mihomo%'" -ErrorAction SilentlyContinue
    foreach ($proc in $clashProcs) {
        if ($proc.CommandLine) {
            $cmdLine = $proc.CommandLine
            # v1.4.9 修复：分两种形态匹配（原字符类排除空格 → 含空格的带引号路径只截到第一个空格）
            if ($cmdLine -match '-f\s+"([^"]+\.ya?ml)"') {
                # 带引号路径（可含空格）
                $p = $matches[1]
                if (Test-Path $p) { return $p }
            }
            if ($cmdLine -match '-f\s+([^\s"]+\.ya?ml)') {
                # 无引号路径（不含空格）
                $p = $matches[1]
                if (Test-Path $p) { return $p }
            }
            if ($cmdLine -match '-d\s+"([^"]+)"') {
                $d = $matches[1]
                $p = Join-Path $d "config.yaml"
                if (Test-Path $p) { return $p }
            }
            if ($cmdLine -match '-d\s+([^\s"]+)') {
                $d = $matches[1]
                $p = Join-Path $d "config.yaml"
                if (Test-Path $p) { return $p }
            }
        }
    }

    return $null
}

function Detect-Client {
    param($ApiUrl)

    # 0a. 基于 API 端口的精确检测（最高优先级）
    #     当用户配置的 API URL 传入时，检查哪个进程监听了该端口。
    #     解决"多客户端同时运行"问题：CVR 和 FLClash 都在运行时，
    #     进程检测会按固定优先级返回（FLClash 优先于 CVR），但用户配置的
    #     API 端口才反映当前实际使用的客户端。
    #     例如：用户配 9097 端口 → 找到 verge-mihomo 进程 → 判定为 CVR
    if ($ApiUrl) {
        # 从 URL 中提取端口（如 http://127.0.0.1:9097 -> 9097）
        $portMatch = [regex]::Match($ApiUrl, ':(\d+)(?:/|$)')
        if ($portMatch.Success) {
            $apiPort = $portMatch.Groups[1].Value
            # 用 Get-NetTCPConnection 找到监听该端口的进程
            $conn = Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($conn) {
                $portProc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
                if ($portProc) {
                    $portProcName = $portProc.ProcessName
                    # verge-mihomo / clash-verge -> Clash Verge Rev
                    if ($portProcName -match '(?i)verge') {
                        $cvrDirs = @(
                            "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev",
                            "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev",
                            "$env:APPDATA\clash-verge-rev",
                            "$env:LOCALAPPDATA\clash-verge-rev"
                        )
                        foreach ($dir in $cvrDirs) {
                            $profilesYaml = Join-Path $dir 'profiles.yaml'
                            if (Test-Path $profilesYaml) {
                                $snapshot = Join-Path $dir 'clash-verge.yaml'
                                return @{
                                    success = $true
                                    clientType = 'clash-verge-rev'
                                    dataDir = $dir
                                    hasProfilesYaml = $true
                                    hasSnapshot = (Test-Path $snapshot)
                                    configPath = Get-ConfigPath
                                }
                            }
                        }
                        return @{
                            success = $true
                            clientType = 'clash-verge-rev'
                            dataDir = $null
                            hasProfilesYaml = $false
                            hasSnapshot = $false
                            configPath = Get-ConfigPath
                        }
                    }
                    # FlClash / FlClashCore -> FLClash
                    if ($portProcName -match '(?i)flclash') {
                        $flclashDirs = @(
                            "$env:APPDATA\com.follow.clash",
                            "$env:LOCALAPPDATA\com.follow.clash",
                            "$env:USERPROFILE\.config\flclash"
                        )
                        foreach ($dir in $flclashDirs) {
                            if (Test-Path $dir) {
                                $configPath = Join-Path $dir 'config.yaml'
                                if (-not (Test-Path $configPath)) { $configPath = Get-ConfigPath }
                                return @{
                                    success = $true
                                    clientType = 'flclash'
                                    dataDir = $dir
                                    hasProfilesYaml = $false
                                    hasSnapshot = $false
                                    configPath = $configPath
                                }
                            }
                        }
                        return @{
                            success = $true
                            clientType = 'flclash'
                            dataDir = $null
                            hasProfilesYaml = $false
                            hasSnapshot = $false
                            configPath = Get-ConfigPath
                        }
                    }
                }
            }
        }
    }

    # 0b. 回退到进程检测：检查哪个 Clash GUI 客户端正在运行
    #    解决"文件残留导致误判"问题：用户从 CVR 切到 FLClash 后，CVR 的 profiles.yaml
    #    还在磁盘上，但 CVR 进程已退出、FLClash 进程在运行。只检查文件会误判为 CVR，
    #    导致 getScriptRules 读取 CVR 残留旧规则、UI 不降级。
    $procs = Get-Process -ErrorAction SilentlyContinue

    # FLClash 进程（Flutter 应用，进程名 flclash / FlClash）
    $flclashProc = $procs | Where-Object { $_.ProcessName -match '(?i)flclash' } | Select-Object -First 1
    if ($flclashProc) {
        $flclashDirs = @(
            "$env:APPDATA\com.follow.clash",
            "$env:LOCALAPPDATA\com.follow.clash",
            "$env:USERPROFILE\.config\flclash"
        )
        foreach ($dir in $flclashDirs) {
            if (Test-Path $dir) {
                $configPath = Join-Path $dir 'config.yaml'
                if (-not (Test-Path $configPath)) { $configPath = Get-ConfigPath }
                return @{
                    success = $true
                    clientType = 'flclash'
                    dataDir = $dir
                    hasProfilesYaml = $false
                    hasSnapshot = $false
                    configPath = $configPath
                }
            }
        }
        return @{
            success = $true
            clientType = 'flclash'
            dataDir = $null
            hasProfilesYaml = $false
            hasSnapshot = $false
            configPath = Get-ConfigPath
        }
    }

    # Clash Verge Rev 进程（Electron 应用，进程名 clash-verge / Clash Verge）
    $cvrProc = $procs | Where-Object { $_.ProcessName -match '(?i)clash[._-]verge' } | Select-Object -First 1
    if ($cvrProc) {
        $cvrDirs = @(
            "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev",
            "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev",
            "$env:APPDATA\clash-verge-rev",
            "$env:LOCALAPPDATA\clash-verge-rev"
        )
        foreach ($dir in $cvrDirs) {
            $profilesYaml = Join-Path $dir 'profiles.yaml'
            if (Test-Path $profilesYaml) {
                $snapshot = Join-Path $dir 'clash-verge.yaml'
                $configPath = Get-ConfigPath
                return @{
                    success = $true
                    clientType = 'clash-verge-rev'
                    dataDir = $dir
                    hasProfilesYaml = $true
                    hasSnapshot = (Test-Path $snapshot)
                    configPath = $configPath
                }
            }
        }
        return @{
            success = $true
            clientType = 'clash-verge-rev'
            dataDir = $null
            hasProfilesYaml = $false
            hasSnapshot = $false
            configPath = Get-ConfigPath
        }
    }

    # Clash Nyanpasu 进程
    $nyanpasuProc = $procs | Where-Object { $_.ProcessName -match '(?i)nyanpasu' } | Select-Object -First 1
    if ($nyanpasuProc) {
        $nyanpasuPath = "$env:USERPROFILE\.config\clash-nyanpasu\config.yaml"
        return @{
            success = $true
            clientType = 'clash-nyanpasu'
            dataDir = "$env:USERPROFILE\.config\clash-nyanpasu"
            hasProfilesYaml = $false
            hasSnapshot = $false
            configPath = $nyanpasuPath
        }
    }

    # Clash for Windows 进程
    $cfwProc = $procs | Where-Object { $_.ProcessName -match '(?i)clash[._-]for[._-]windows|^cfw$' } | Select-Object -First 1
    if ($cfwProc) {
        $cfwPath = "$env:USERPROFILE\.config\clash\config.yaml"
        return @{
            success = $true
            clientType = 'clash-for-windows'
            dataDir = "$env:USERPROFILE\.config\clash"
            hasProfilesYaml = $false
            hasSnapshot = $false
            configPath = $cfwPath
        }
    }

    # 1. 回退到文件检测（无 GUI 进程在运行时的兜底）
    #    原有逻辑保留，用于无进程信息时通过文件存在性判断

    # 1a. Clash Verge Rev：检测 profiles.yaml
    foreach ($dir in $ProfilesYamlDirs) {
        $profilesYaml = Join-Path $dir 'profiles.yaml'
        if (Test-Path $profilesYaml) {
            $snapshot = Join-Path $dir 'clash-verge.yaml'
            return @{
                success = $true
                clientType = 'clash-verge-rev'
                dataDir = $dir
                hasProfilesYaml = $true
                hasSnapshot = (Test-Path $snapshot)
                configPath = Get-ConfigPath
            }
        }
    }

    # 1b. FlClash：检测 com.follow.clash 目录
    $flclashFileDirs = @(
        "$env:APPDATA\com.follow.clash",
        "$env:LOCALAPPDATA\com.follow.clash",
        "$env:USERPROFILE\.config\flclash"
    )
    foreach ($dir in $flclashFileDirs) {
        if (Test-Path $dir) {
            $configPath = Join-Path $dir 'config.yaml'
            if (-not (Test-Path $configPath)) { $configPath = Get-ConfigPath }
            return @{
                success = $true
                clientType = 'flclash'
                dataDir = $dir
                hasProfilesYaml = $false
                hasSnapshot = $false
                configPath = $configPath
            }
        }
    }

    # 1c. Clash Nyanpasu
    $nyanpasuDir = "$env:USERPROFILE\.config\clash-nyanpasu"
    if (Test-Path $nyanpasuDir) {
        return @{
            success = $true
            clientType = 'clash-nyanpasu'
            dataDir = $nyanpasuDir
            hasProfilesYaml = $false
            hasSnapshot = $false
            configPath = Get-ConfigPath
        }
    }

    # 1d. Clash for Windows
    $cfwDir = "$env:USERPROFILE\.config\clash"
    if (Test-Path $cfwDir) {
        return @{
            success = $true
            clientType = 'clash-for-windows'
            dataDir = $cfwDir
            hasProfilesYaml = $false
            hasSnapshot = $false
            configPath = Get-ConfigPath
        }
    }

    # 2. 无法识别客户端类型，返回 unknown
    return @{
        success = $true
        clientType = 'unknown'
        dataDir = $null
        hasProfilesYaml = $false
        hasSnapshot = $false
        configPath = Get-ConfigPath
    }
}

function Read-Config($path) {
    # 使用 .NET 直接读取文件，避免 Get-Content -Encoding 参数兼容性问题
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    return [System.IO.File]::ReadAllText($path, $utf8NoBom)
}

function Write-Config($path, $content) {
    $backup = "$path.bak"
    if (Test-Path $path) {
        Copy-Item -Path $path -Destination $backup -Force
    }
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    # v1.4.9 修复：原子写盘 —— 原实现原地 WriteAllText，进程被杀/断电/磁盘满时会留下半截文件
    # 现改为写同目录临时文件 → File.Replace 原子替换（Replace 同时保留备份，失败时原文件不受影响）
    $tmpPath = "$path.tmp"
    [System.IO.File]::WriteAllText($tmpPath, $content, $utf8NoBom)
    try {
        if ([System.IO.File]::Exists($path)) {
            [System.IO.File]::Replace($tmpPath, $path, $null)
        } else {
            [System.IO.File]::Move($tmpPath, $path)
        }
    } catch {
        # Replace 失败（跨平台/文件占用等边缘场景）回退为直接写，保持旧行为
        try { [System.IO.File]::Delete($tmpPath) } catch { }
        [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
    }
}

function Parse-Rules($content) {
    # 使用 ArrayList 确保始终返回真正的数组，避免 PowerShell streaming 把空数组展平为 $null
    $rules = [System.Collections.ArrayList]::new()

    $lines = $content -split "`n"

    # 自动检测 Clash Verge profile 格式
    $isProfile = ($content -match '^\s*append\s*:') -or ($content -match '^\s*prepend\s*:')

    if ($isProfile) {
        $inAppend = $false
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ($trimmed -eq 'append:') { $inAppend = $true; continue }
            if ($inAppend -and $trimmed.StartsWith('- ') -and -not $trimmed.EndsWith('[]')) {
                $rule = $trimmed.Substring(2).Trim().Trim("'").Trim('"')
                if ($rule) { [void]$rules.Add($rule) }
            }
            if ($inAppend -and -not $trimmed.StartsWith('- ') -and $trimmed -and -not $trimmed.StartsWith('#')) {
                $inAppend = $false
            }
        }
        return ,$rules.ToArray()
    }

    # 标准 Clash 配置格式
    $inRules = $false
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if (-not $inRules) {
            if ($trimmed -eq 'rules:' -or $trimmed.StartsWith('rules:')) { $inRules = $true }
            continue
        }
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if (-not $trimmed.StartsWith('- ') -and -not $trimmed.StartsWith("- '") -and -not $trimmed.StartsWith('- "')) {
            if (-not $line.StartsWith(' ') -and -not $line.StartsWith("`t") -and $trimmed.Contains(':')) { break }
            continue
        }
        $rule = ''
        if ($trimmed.StartsWith('- ')) { $rule = $trimmed.Substring(2).Trim() }
        elseif ($trimmed.StartsWith("- '") -and $trimmed.EndsWith("'")) { $rule = $trimmed.Substring(3, $trimmed.Length - 4).Trim() }
        elseif ($trimmed.StartsWith('- "') -and $trimmed.EndsWith('"')) { $rule = $trimmed.Substring(3, $trimmed.Length - 4).Trim() }
        if ($rule) { [void]$rules.Add($rule) }
    }
    return ,$rules.ToArray()
}

# ──── v1.4.9 安全工具：规则值转义 ────
# 规则文本来自扩展输入（用户粘贴），未经转义直接写入 YAML / .js 会破坏文件结构。
# YAML 单引号标量内，单引号必须双写；控制字符与换行必须剥离。
function ConvertTo-YamlScalar($value) {
    if ($null -eq $value) { return "''" }
    $v = [string]$value
    $v = $v -replace "[\x00-\x08\x0B\x0C\x0E-\x1F]", ''
    $v = $v -replace "\r?\n", ' '
    $v = $v.Replace("'", "''")
    return "'$v'"
}

# 写 .js 脚本文件时规则值放在双引号字符串中 → 需转义反斜杠/双引号/换行
function ConvertTo-JsScalar($value) {
    if ($null -eq $value) { return '""' }
    $v = [string]$value
    $v = $v.Replace('\', '\\')
    $v = $v.Replace('"', '\"')
    $v = $v -replace "\r?\n", '\n'
    $v = $v -replace "[\x00-\x08\x0B\x0C\x0E-\x1F]", ''
    return '"' + $v + '"'
}

function Add-Rule($content, $rule) {
    # 去除规则首尾的单引号/双引号，防止 YAML 双引号转义问题（''xxx'' 会被解析为空字符串+xxx）
    $rule = $rule.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()

    # 解析新规则的类型和 payload
    $ruleParts = $rule -split ','
    $newType = if ($ruleParts.Count -ge 1) { $ruleParts[0].Trim() } else { '' }
    $newPayload = if ($ruleParts.Count -ge 2) { $ruleParts[1].Trim() } else { '' }

    $isProfile = ($content -match '^\s*append\s*:') -or ($content -match '^\s*prepend\s*:')

    if ($isProfile) {
        $lines = [System.Collections.ArrayList]::new($content -split "`n")
        $inAppend = $false; $insertIdx = -1; $overrideIdx = -1; $lastSameTypeIdx = -1; $modified = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $trimmed = $lines[$i].Trim()
            if ($trimmed -eq 'append:') { $inAppend = $true; continue }
            # v1.4.9 修复：行内空数组 append: [] / prepend: []
            # 原逻辑只认 'append:'，遇到 'append: []' 时 inAppend 永不进入 → 规则静默不写入且假报成功
            if ($trimmed -match '^(append|prepend)\s*:\s*\[\s*\]$') {
                $lines[$i] = ($trimmed -replace ':\s*\[\s*\]$', ':')
                $inAppend = $true
                $insertIdx = $i + 1
                $modified = $true
                continue
            }
            if ($inAppend) {
                # 检查是否与同类型+同payload规则冲突
                if ($trimmed -match "^-\s*'?([^,]+),([^,]+),") {
                    $existingType = $Matches[1].Trim()
                    $existingPayload = $Matches[2].Trim()
                    if ($existingType -eq $newType) {
                        $lastSameTypeIdx = $i
                        if ($existingPayload -eq $newPayload -and $overrideIdx -lt 0) {
                            $overrideIdx = $i
                        }
                    }
                }
                if ($trimmed.StartsWith('- ') -and -not $trimmed.EndsWith('[]')) { $insertIdx = $i + 1; continue }
                # v1.4.9：空数组条目（裸 '[]' 与缩进 '- []'）→ 就地替换为新规则
                if ($trimmed -eq '[]' -or $trimmed -match '^- \[\s*\]$') {
                    $lines[$i] = ('  - ' + (ConvertTo-YamlScalar $rule))
                    $modified = $true
                    break
                }
                if (-not $trimmed.StartsWith('- ') -and $trimmed -and -not $trimmed.StartsWith('#')) { $insertIdx = $i; break }
            }
        }
        # v1.4.9：所有写入路径统一走 ConvertTo-YamlScalar 转义
        $safeRuleLine = '  - ' + (ConvertTo-YamlScalar $rule)
        if ($overrideIdx -ge 0) {
            # 检测到重复规则时，替换原行（而非 Insert 导致重复）
            $lines[$overrideIdx] = $safeRuleLine
            $modified = $true
        } elseif ($lastSameTypeIdx -ge 0) {
            $lines.Insert($lastSameTypeIdx + 1, $safeRuleLine)
            $modified = $true
        } elseif ($insertIdx -ge 0) {
            $lines.Insert($insertIdx, $safeRuleLine)
            $modified = $true
        }
        # v1.4.9 修复：完全未找到插入点且内容未被修改时返回 null，
        # 由调用方如实报错（原实现原样返回内容却仍回复 "Rule added"，属假成功）
        if (-not $modified) { return $null }
        return $lines -join "`n"
    }

    # 标准 Clash 配置格式
    $lines = [System.Collections.ArrayList]::new($content -split "`n")
    $inRules = $false; $insertIdx = -1; $overrideIdx = -1; $lastSameTypeIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if (-not $inRules) {
            # v1.4.9 修复：识别行内 flow 数组（rules: []）
            # 原逻辑把 'rules: []' 当作区块起点 → 新规则以 block 条目插到 flow 数组后 → 产出非法 YAML
            if ($trimmed -match '^rules\s*:\s*\[\s*\]$') {
                $lines[$i] = 'rules:'
                $inRules = $true
                $insertIdx = $i + 1
                continue
            }
            # 非空 flow 数组（rules: [A, B]）元素本身含逗号，无法安全拆分 →
            # 明确不支持并返回 null（避免产出语义错误的规则），由调用方报错
            if ($trimmed -match '^rules\s*:\s*\[.+\]\s*$') {
                return $null
            }
            if ($trimmed -eq 'rules:' -or $trimmed.StartsWith('rules:')) { $inRules = $true }
            continue
        }
        if (-not $trimmed -or $trimmed.StartsWith('#')) { $insertIdx = $i + 1; continue }
        # 检查是否与同类型规则冲突
        if ($trimmed -match "^-\s*'?([^,]+),([^,]+),") {
            $existingType = $Matches[1].Trim()
            $existingPayload = $Matches[2].Trim()
            if ($existingType -eq $newType) {
                $lastSameTypeIdx = $i
                if ($existingPayload -eq $newPayload -and $overrideIdx -lt 0) {
                    $overrideIdx = $i
                }
            }
        }
        if ($trimmed.StartsWith('- ') -or $trimmed.StartsWith("- '") -or $trimmed.StartsWith('- "')) { $insertIdx = $i + 1; continue }
        if (-not $lines[$i].StartsWith(' ') -and -not $lines[$i].StartsWith("`t") -and $trimmed.Contains(':')) { $insertIdx = $i; break }
    }
    if ($overrideIdx -ge 0) { $insertIdx = $overrideIdx }
    elseif ($lastSameTypeIdx -ge 0) { $insertIdx = $lastSameTypeIdx + 1 }
    if ($insertIdx -lt 0) { return $content }
    # 确保新规则插入到 MATCH（漏网之鱼）之前，避免被兜底规则拦截
    # v1.4.9 修复：MATCH 正则加 (?i)，兼容小写 match 配置
    for ($j = 0; $j -lt $lines.Count; $j++) {
        if ($lines[$j] -match "(?i)^\s*-\s*'?MATCH,") {
            if ($insertIdx -gt $j) { $insertIdx = $j }
            break
        }
    }
    # v1.4.9：统一转义，含逗号的规则也用单引号标量包裹（去掉裸写分支，避免 * / # / [ 开头被 YAML 误解析）
    $newLine = '  - ' + (ConvertTo-YamlScalar $rule)
    # 检测到重复规则时，替换原行（而非 Insert 导致重复）
    if ($overrideIdx -ge 0) {
        $lines[$overrideIdx] = $newLine
    } else {
        $lines.Insert($insertIdx, $newLine)
    }
    return $lines -join "`n"
}

function Remove-Rule($content, $rule) {
    # 去除传入规则首尾的单引号/双引号，防止匹配失败
    $rule = $rule.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()

    # 归一化规则字符串：将 type 部分去除连字符并转大写，用于跨格式比较
    # 解决 Clash API 返回驼峰格式（DomainSuffix）与 YAML 文件大写格式（DOMAIN-SUFFIX）不匹配问题
    # 例如: DomainSuffix,google.com,Proxy → DOMAINSUFFIX,google.com,Proxy
    #       DOMAIN-SUFFIX,google.com,Proxy → DOMAINSUFFIX,google.com,Proxy
    #       两者归一化后相等，可正确匹配删除
    function Normalize-RuleStr($r) {
        $parts = $r -split ','
        if ($parts.Count -ge 1) {
            $parts[0] = $parts[0].ToUpper().Replace('-', '')
        }
        return ($parts -join ',')
    }

    $normalizedRule = Normalize-RuleStr $rule

    $lines = $content -split "`n"
    $result = [System.Collections.ArrayList]::new()
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        $ruleContent = ''
        if ($trimmed.StartsWith('- ')) { $ruleContent = $trimmed.Substring(2).Trim().Trim("'").Trim('"') }
        elseif ($trimmed.StartsWith("- '") -and $trimmed.EndsWith("'")) { $ruleContent = $trimmed.Substring(3, $trimmed.Length - 4).Trim() }
        elseif ($trimmed.StartsWith('- "') -and $trimmed.EndsWith('"')) { $ruleContent = $trimmed.Substring(3, $trimmed.Length - 4).Trim() }
        # 归一化比较：不区分 type 的大小写和连字符差异
        if ($ruleContent -and (Normalize-RuleStr $ruleContent) -eq $normalizedRule) { continue }
        [void]$result.Add($line)
    }
    return $result -join "`n"
}

# 查找 Clash Verge Rev 快照文件路径（clash-verge.yaml）
function Get-SnapshotPath {
    $dirs = @(
        "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev",
        "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev",
        "$env:APPDATA\clash-verge-rev",
        "$env:LOCALAPPDATA\clash-verge-rev"
    )
    foreach ($dir in $dirs) {
        $p = Join-Path $dir 'clash-verge.yaml'
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ──── Script.js 扩展脚本规则管理 ────
# v1.4.2 方案 1A-1：操作当前激活订阅绑定的 .js 文件
# CVR 扩展脚本机制：每个订阅通过 profiles.yaml 的 option.script 字段绑定一个 .js 文件
# 路径推断流程：profiles.yaml → current 字段 → items 列表中匹配 uid → 该 item 的 option.script → 拼接 profiles/<script_uid>.js

function Get-ScriptPath {
    # 1. 在 CVR 数据目录下查找 profiles.yaml
    $dirs = @(
        "$env:APPDATA\io.github.clash-verge-rev.clash-verge-rev",
        "$env:LOCALAPPDATA\io.github.clash-verge-rev.clash-verge-rev",
        "$env:APPDATA\clash-verge-rev",
        "$env:LOCALAPPDATA\clash-verge-rev"
    )
    $profilesYamlPath = $null
    $profileDir = $null
    foreach ($dir in $dirs) {
        $candidate = Join-Path $dir 'profiles.yaml'
        if (Test-Path $candidate) {
            $profilesYamlPath = $candidate
            $profileDir = $dir
            break
        }
    }
    if (-not $profilesYamlPath) {
        return @{ success = $false; error = 'profiles.yaml not found (Clash Verge Rev not installed or no profile created)' }
    }

    # 2. 解析 profiles.yaml，提取 current 字段和 items 列表
    #    YAML 结构（关键字段）：
    #    current: RHIBxScuGfpf
    #    items:
    #    - uid: RHIBxScuGfpf
    #      type: remote
    #      file: RHIBxScuGfpf.yaml
    #      option:
    #        script: s8XWAjDjLilq   ← 订阅绑定的扩展脚本 uid
    #      ...
    $content = [System.IO.File]::ReadAllText($profilesYamlPath, $encoding)
    $lines = $content -split "`n"

    # 2a. 提取 current 字段
    $currentUid = $null
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^current\s*:\s*(\S+)') {
            $currentUid = $matches[1]
            break
        }
    }
    if (-not $currentUid) {
        return @{ success = $false; error = 'profiles.yaml missing current field' }
    }

    # 2b. 在 items 列表中查找 uid 匹配 current 的条目，提取其 option.script
    #     option 是嵌套字段，需要在 item 块内继续扫描
    $scriptUid = $null
    $inTargetItem = $false
    $inOption = $false
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        # 检测新 item 开始（- uid: ...）
        if ($trimmed -match '^-\s*uid\s*:\s*(\S+)') {
            $itemUid = $matches[1]
            $inTargetItem = ($itemUid -eq $currentUid)
            $inOption = $false
            continue
        }
        if (-not $inTargetItem) { continue }

        # 检测进入 option 块
        if ($trimmed -match '^option\s*:\s*$') {
            $inOption = $true
            continue
        }
        # 检测离开 option 块（遇到同级或顶级 key）
        if ($inOption -and $line -match '^\S' -and -not $trimmed.StartsWith('option')) {
            $inOption = $false
        }
        # 在 option 块内查找 script: 字段
        if ($inOption -and $trimmed -match '^script\s*:\s*(\S+)') {
            $scriptUid = $matches[1]
            break
        }
    }

    if (-not $scriptUid) {
        # 订阅未绑定扩展脚本
        return @{ success = $false; error = "Current profile ($currentUid) has no bound script (option.script not set)"; needInit = $true }
    }

    # 3. 拼接脚本文件路径
    $scriptPath = Join-Path (Join-Path $profileDir 'profiles') "$scriptUid.js"
    $exists = Test-Path $scriptPath

    # 4. 检查文件是否由 ClashOmega 管理（含标记）
    $managed = $false
    if ($exists) {
        $scriptContent = [System.IO.File]::ReadAllText($scriptPath, $encoding)
        if ($scriptContent -match 'ClashOmega Extension Rules' -or $scriptContent -match 'Clash Manager Extension Rules') {
            $managed = $true
        }
    }

    return @{
        success = $true
        scriptPath = $scriptPath
        exists = $exists
        managed = $managed
        scriptUid = $scriptUid
        currentUid = $currentUid
    }
}

function Get-ScriptRules {
    # 1. 获取脚本路径
    $pathResult = Get-ScriptPath
    if (-not $pathResult.success) {
        # 透传 needInit 标记，让 popup 显示"初始化"按钮
        return $pathResult
    }
    $scriptPath = $pathResult.scriptPath
    if (-not (Test-Path $scriptPath)) {
        return @{
            success = $false
            error = "Script file not found: $scriptPath"
            needInit = $true
            scriptPath = $scriptPath
        }
    }

    # 2. 读取文件内容
    $content = [System.IO.File]::ReadAllText($scriptPath, $encoding)

    # 3. 解析规则数组（兼容两种格式）
    #    新格式（ClashOmega v1.4.x）：const customRules = [ "DOMAIN,xxx", ... ];
    #    旧格式（ClashOmega v1.2.x）：const EXT_RULES = [ "DOMAIN,xxx", ... ];
    $rules = [System.Collections.ArrayList]::new()
    $inArray = $false
    $arrayFormat = $null  # 'customRules' | 'EXT_RULES'

    foreach ($line in $content -split "`n") {
        $trimmed = $line.Trim()
        if (-not $inArray) {
            if ($trimmed -match '^const\s+customRules\s*=\s*\[') {
                $inArray = $true
                $arrayFormat = 'customRules'
            } elseif ($trimmed -match '^const\s+EXT_RULES\s*=\s*\[') {
                $inArray = $true
                $arrayFormat = 'EXT_RULES'
            }
            continue
        }
        # 在数组内，检测结束
        if ($trimmed.StartsWith(']')) {
            $inArray = $false
            break
        }
        # 提取规则字符串（支持 "DOMAIN,xxx,Proxy" 或 'DOMAIN,xxx,Proxy'）
        if ($trimmed -match "^\s*['""]([^'""]+)['""]") {
            $rule = $matches[1].Trim()
            if ($rule) { [void]$rules.Add($rule) }
        }
    }

    return @{
        success = $true
        rules = $rules.ToArray()
        scriptPath = $scriptPath
        needInit = $false
        arrayFormat = $arrayFormat
        managed = $pathResult.managed
    }
}

function Init-ScriptFile {
    # 1. 获取脚本路径（即使订阅未绑定脚本，也需要返回路径用于提示用户）
    $pathResult = Get-ScriptPath
    if (-not $pathResult.success) {
        # 订阅未绑定 script，无法初始化（需用户在 CVR 中设置 option.script）
        return $pathResult
    }
    $scriptPath = $pathResult.scriptPath

    # 2. 备份原文件（若存在）
    if (Test-Path $scriptPath) {
        $bakPath = "$scriptPath.bak.$([int](Get-Date -UFormat %s))"
        try {
            Copy-Item -Path $scriptPath -Destination $bakPath -Force
        } catch {
            # 备份失败不阻塞，仅记录
            [Console]::Error.WriteLine("Init-ScriptFile: backup failed: $($_.Exception.Message)")
        }
    }

    # 3. 写入标准 ClashOmega 扩展脚本模板
    #    使用 customRules 数组格式（与 v1.4.x 用户的实际文件对齐）
    $template = @'
// === ClashOmega Extension Rules (auto-managed, do not edit manually) ===
function main(config) {
  // 1. 定义自定义规则（由 ClashOmega 扩展自动维护）
  const customRules = [
  ];

  // 2. 将自定义规则插入到 config.rules 最前面
  if (config.rules) {
    config.rules = [...customRules, ...config.rules];
  } else {
    config.rules = customRules;
  }

  // 3. 返回修改后的配置
  return config;
}
// === End of ClashOmega Extension Rules ===
'@

    try {
        $parentDir = Split-Path -Parent $scriptPath
        if (-not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
        }
        [System.IO.File]::WriteAllText($scriptPath, $template, $encoding)
        return @{
            success = $true
            message = 'Script file initialized'
            scriptPath = $scriptPath
        }
    } catch {
        return @{ success = $false; error = "Init failed: $($_.Exception.Message)" }
    }
}

# ──── Script.js 规则增删（useScript=true 时调用） ────
# 这些函数操作当前激活订阅绑定的 .js 文件中的 customRules 数组
# 与 Get-ScriptRules 配对，只读写 customRules（兼容旧 EXT_RULES 但写入统一用 customRules）

function Add-ScriptRule($rule) {
    # 1. 获取脚本路径
    $pathResult = Get-ScriptPath
    if (-not $pathResult.success) {
        return $pathResult  # 透传 needInit 等标记
    }
    $scriptPath = $pathResult.scriptPath
    if (-not (Test-Path $scriptPath)) {
        return @{ success = $false; error = "Script file not found: $scriptPath"; needInit = $true }
    }

    # 2. 清理规则字符串（去除首尾引号）
    $rule = $rule.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()
    if (-not $rule) {
        return @{ success = $false; error = 'Empty rule' }
    }

    # 3. 读取文件内容
    $content = [System.IO.File]::ReadAllText($scriptPath, $encoding)
    $lines = [System.Collections.ArrayList]::new($content -split "`n")

    # 4. 找到 customRules 数组（或旧 EXT_RULES 数组）的起始与结束
    $arrayStart = -1
    $arrayEnd = -1
    $arrayFormat = $null
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if ($arrayStart -lt 0) {
            if ($trimmed -match '^const\s+customRules\s*=\s*\[') {
                $arrayStart = $i
                $arrayFormat = 'customRules'
            } elseif ($trimmed -match '^const\s+EXT_RULES\s*=\s*\[') {
                $arrayStart = $i
                $arrayFormat = 'EXT_RULES'
            }
            continue
        }
        # 数组内，找结束（以 ] 开头的行）
        if ($trimmed.StartsWith(']')) {
            $arrayEnd = $i
            break
        }
    }

    if ($arrayStart -lt 0 -or $arrayEnd -lt 0) {
        return @{ success = $false; error = 'customRules array not found in script file (need init?)'; needInit = $true }
    }

    # 5. 检查是否已存在相同规则（避免重复）
    for ($i = $arrayStart + 1; $i -lt $arrayEnd; $i++) {
        $trimmed = $lines[$i].Trim()
        if ($trimmed -match "^\s*['""]([^'""]+)['""]") {
            if ($matches[1].Trim() -eq $rule) {
                return @{ success = $true; message = 'Rule already exists (skipped)'; scriptPath = $scriptPath }
            }
        }
    }

    # 6. 插入新规则到数组末尾（] 之前）
    #    使用 4 空格缩进 + 双引号包裹（与现有格式对齐）
    # v1.4.9 修复：规则值必须转义后再写入 —— 原实现直接拼接双引号字符串，
    # 含双引号/反斜杠/换行的规则会提前终止 JS 字符串 → 整个 script.js 语法错误作废
    $newLine = '    ' + (ConvertTo-JsScalar $rule) + ','
    $lines.Insert($arrayEnd, $newLine)

    # 7. 写回文件
    $newContent = $lines -join "`n"
    [System.IO.File]::WriteAllText($scriptPath, $newContent, $encoding)

    return @{ success = $true; message = 'Rule added to script'; scriptPath = $scriptPath; arrayFormat = $arrayFormat }
}

function Remove-ScriptRule($rule) {
    # 1. 获取脚本路径
    $pathResult = Get-ScriptPath
    if (-not $pathResult.success) {
        return $pathResult
    }
    $scriptPath = $pathResult.scriptPath
    if (-not (Test-Path $scriptPath)) {
        return @{ success = $false; error = "Script file not found: $scriptPath"; needInit = $true }
    }

    # 2. 清理规则字符串
    $rule = $rule.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()
    if (-not $rule) {
        return @{ success = $false; error = 'Empty rule' }
    }

    # 3. 读取文件内容
    $content = [System.IO.File]::ReadAllText($scriptPath, $encoding)
    $lines = [System.Collections.ArrayList]::new($content -split "`n")

    # 4. 在 customRules / EXT_RULES 数组内查找匹配规则并删除
    #    顺序扫描（与 Add-ScriptRule / Get-ScriptRules 一致），先收集索引再统一删除
    $inArray = $false
    $removeIndices = [System.Collections.ArrayList]::new()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if (-not $inArray) {
            if ($trimmed -match '^const\s+customRules\s*=\s*\[' -or $trimmed -match '^const\s+EXT_RULES\s*=\s*\[') {
                $inArray = $true
            }
            continue
        }
        # 数组内
        if ($trimmed.StartsWith(']')) {
            $inArray = $false
            continue
        }
        if ($trimmed -match "^\s*['""]([^'""]+)['""]") {
            if ($matches[1].Trim() -eq $rule) {
                [void]$removeIndices.Add($i)
            }
        }
    }

    $removed = $removeIndices.Count -gt 0
    if (-not $removed) {
        return @{ success = $true; message = 'Rule not found in script (no change)'; scriptPath = $scriptPath }
    }

    # 倒序删除（避免索引偏移）
    for ($j = $removeIndices.Count - 1; $j -ge 0; $j--) {
        $lines.RemoveAt($removeIndices[$j])
    }

    # 5. 写回文件
    $newContent = $lines -join "`n"
    [System.IO.File]::WriteAllText($scriptPath, $newContent, $encoding)

    return @{ success = $true; message = 'Rule removed from script'; scriptPath = $scriptPath }
}

function BatchAdd-ScriptRules($rules) {
    # 1. 获取脚本路径
    $pathResult = Get-ScriptPath
    if (-not $pathResult.success) {
        return $pathResult
    }
    $scriptPath = $pathResult.scriptPath
    if (-not (Test-Path $scriptPath)) {
        return @{ success = $false; error = "Script file not found: $scriptPath"; needInit = $true }
    }

    # 2. 清理规则列表
    $cleanRules = [System.Collections.ArrayList]::new()
    foreach ($r in $rules) {
        $clean = $r.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()
        if ($clean) { [void]$cleanRules.Add($clean) }
    }
    if ($cleanRules.Count -eq 0) {
        return @{ success = $false; error = 'No valid rules to add' }
    }

    # 3. 读取文件内容
    $content = [System.IO.File]::ReadAllText($scriptPath, $encoding)
    $lines = [System.Collections.ArrayList]::new($content -split "`n")

    # 4. 找到 customRules / EXT_RULES 数组
    $arrayStart = -1
    $arrayEnd = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if ($arrayStart -lt 0) {
            if ($trimmed -match '^const\s+customRules\s*=\s*\[' -or $trimmed -match '^const\s+EXT_RULES\s*=\s*\[') {
                $arrayStart = $i
            }
            continue
        }
        if ($trimmed.StartsWith(']')) {
            $arrayEnd = $i
            break
        }
    }

    if ($arrayStart -lt 0 -or $arrayEnd -lt 0) {
        return @{ success = $false; error = 'customRules array not found in script file (need init?)'; needInit = $true }
    }

    # 5. 收集已有规则
    # v1.4.9 修复：默认比较器区分大小写 → mihomo 域名匹配不区分大小写，
    # DOMAIN,Google.COM,P 与 DOMAIN,google.com,P 会被当成不同规则重复插入
    $existing = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    for ($i = $arrayStart + 1; $i -lt $arrayEnd; $i++) {
        $trimmed = $lines[$i].Trim()
        if ($trimmed -match "^\s*['""]([^'""]+)['""]") {
            [void]$existing.Add($matches[1].Trim())
        }
    }

    # 6. 插入新规则（去重）
    $added = 0
    $insertIdx = $arrayEnd
    foreach ($rule in $cleanRules) {
        if (-not $existing.Contains($rule)) {
            # v1.4.9 修复：规则值必须转义后再写入（双引号/反斜杠/换行会破坏 script.js 语法）
            $newLine = '    ' + (ConvertTo-JsScalar $rule) + ','
            $lines.Insert($insertIdx, $newLine)
            $insertIdx++
            $added++
            [void]$existing.Add($rule)
        }
    }

    if ($added -eq 0) {
        return @{ success = $true; message = 'All rules already exist (skipped)'; scriptPath = $scriptPath }
    }

    # 7. 写回文件
    $newContent = $lines -join "`n"
    [System.IO.File]::WriteAllText($scriptPath, $newContent, $encoding)

    return @{ success = $true; message = "$added rules added to script"; scriptPath = $scriptPath; added = $added }
}

# 将规则列表写入快照文件的 rules: 区块
function Sync-SnapshotRules($snapshotPath, $rules) {
    # 参数验证：拒绝空或非数组 rules，防止清空快照文件
    if ($null -eq $rules -or -not ($rules -is [array]) -or $rules.Count -eq 0) {
        throw "Sync-SnapshotRules: rules 参数为空或非数组，拒绝写入快照（防止清空规则）"
    }

    # 去除每条规则首尾的单引号/双引号，防止 YAML 双引号转义问题
    $cleanRules = [System.Collections.ArrayList]::new()
    foreach ($r in $rules) {
        $clean = $r.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()
        if ($clean) { [void]$cleanRules.Add($clean) }
    }
    if ($cleanRules.Count -eq 0) {
        throw "Sync-SnapshotRules: 清理后规则列表为空，拒绝写入快照"
    }
    $rules = $cleanRules.ToArray()

    $content = Read-Config $snapshotPath
    $lines = [System.Collections.ArrayList]::new($content -split "`n")
    $inRules = $false
    $rulesStart = -1
    $rulesEnd = -1

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if (-not $inRules) {
            # v1.4.9 修复：识别行内 flow 数组（rules: [] / rules: [A, B]）
            # 原逻辑把 'rules: []' 当作区块起点 → 旧条目移除后新 block 条目插到 flow 数组后 → 快照损坏
            if ($trimmed -match '^rules\s*:\s*\[\s*\]$') {
                $lines[$i] = 'rules:'
                $inRules = $true
                $rulesStart = $i
                $rulesEnd = $i + 1
                continue
            }
            if ($trimmed -match '^rules\s*:\s*\[(.+)\]\s*$') {
                $flowItems = $Matches[1] -split ','
                $rebuilt = @('rules:')
                foreach ($it in $flowItems) {
                    $t = $it.Trim()
                    if ($t) { $rebuilt += ('  - ' + $t) }
                }
                $lines[$i] = $rebuilt[0]
                for ($k = 1; $k -lt $rebuilt.Count; $k++) { $lines.Insert($i + $k, $rebuilt[$k]) }
                $inRules = $true
                $rulesStart = $i
                $rulesEnd = $i + $rebuilt.Count
                continue
            }
            if ($trimmed -eq 'rules:' -or $trimmed.StartsWith('rules:')) {
                $inRules = $true
                $rulesStart = $i
            }
            continue
        }
        # 在 rules 区块内，寻找下一个顶级 key（不以空格或 - 开头）
        if ($trimmed -and -not $trimmed.StartsWith('#') -and -not $trimmed.StartsWith('- ') -and -not $trimmed.StartsWith("- '") -and -not $trimmed.StartsWith('- "') -and -not $lines[$i].StartsWith(' ') -and -not $lines[$i].StartsWith("`t")) {
            if ($trimmed.Contains(':')) {
                $rulesEnd = $i
                break
            }
        }
        $rulesEnd = $i + 1
    }

    if ($rulesStart -lt 0) {
        # 没有 rules: 区块，在末尾追加
        [void]$lines.Add('rules:')
        foreach ($rule in $rules) {
            # v1.4.9：统一走 ConvertTo-YamlScalar 转义
            [void]$lines.Add('  - ' + (ConvertTo-YamlScalar $rule))
        }
    } else {
        # 移除旧的 rules 条目
        if ($rulesEnd -gt $rulesStart) {
            $lines.RemoveRange($rulesStart + 1, $rulesEnd - $rulesStart - 1)
        }
        # 插入新规则
        $insertIdx = $rulesStart + 1
        foreach ($rule in $rules) {
            # v1.4.9：统一走 ConvertTo-YamlScalar 转义
            $lines.Insert($insertIdx, '  - ' + (ConvertTo-YamlScalar $rule))
            $insertIdx++
        }
    }

    return $lines -join "`n"
}

# ──── Native Messaging 协议 ────

function Send-Message($msg) {
    $json = ConvertTo-Json -InputObject $msg -Compress -Depth 10
    $bytes = $encoding.GetBytes($json)
    $lenBytes = [System.BitConverter]::GetBytes([int]$bytes.Length)
    if ($null -eq $script:stdoutStream) {
        $script:stdoutStream = [Console]::OpenStandardOutput()
    }
    $stdout = $script:stdoutStream
    $stdout.Write($lenBytes, 0, 4)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

function Read-Message {
    if ($null -eq $script:stdinStream) {
        $script:stdinStream = [Console]::OpenStandardInput()
    }
    $stdin = $script:stdinStream
    # v1.4.9 修复：长度前缀 4 字节必须循环读满
    # 原实现单次 Read 不保证读满，高负载下管道分片返回 1-3 字节 → 整条消息丢失（扩展表现为超时）
    $lenBuffer = New-Object byte[] 4
    $lenRead = 0
    while ($lenRead -lt 4) {
        $r = $stdin.Read($lenBuffer, $lenRead, 4 - $lenRead)
        if ($r -le 0) { return $null }
        $lenRead += $r
    }
    $msgLen = [System.BitConverter]::ToInt32($lenBuffer, 0)
    # v1.4.9 修复：超限消息读掉消息体后由调用方回复明确错误，不再静默退出进程
    # （原实现 return null → 主循环退出 → 扩展按 10s 超时处理并进 30s 冷却，报因完全失真）
    if ($msgLen -le 0) { return $null }
    $script:lastMessageOversized = $false
    if ($msgLen -gt 1048576) {
        $script:lastMessageOversized = $true
        # 读掉并丢弃消息体，保持与扩展的长度前缀协议同步
        $discard = New-Object byte[] $msgLen
        $discRead = 0
        while ($discRead -lt $msgLen) {
            $r = $stdin.Read($discard, $discRead, $msgLen - $discRead)
            if ($r -le 0) { return $null }
            $discRead += $r
        }
        return $null
    }
    $msgBuffer = New-Object byte[] $msgLen
    $totalRead = 0
    while ($totalRead -lt $msgLen) {
        $r = $stdin.Read($msgBuffer, $totalRead, $msgLen - $totalRead)
        if ($r -le 0) { return $null }
        $totalRead += $r
    }
    $json = $encoding.GetString($msgBuffer)
    return ConvertFrom-Json $json
}

# ──── 主循环 ────

function Main {
    # 初始化时安全获取配置路径，不因查找失败而崩溃
    try {
        $configPath = Get-ConfigPath
    } catch {
        $configPath = $null
    }

    while ($true) {
        try {
            $msg = Read-Message
        } catch {
            # 读取失败（stdin 关闭等），安全退出
            break
        }
        if ($null -eq $msg) {
            # v1.4.9 修复：超大消息（>1MB）不再静默退出进程
            # 原实现 break → 进程退出 → 扩展按 10s 超时处理并进 30s 冷却，报因完全失真。
            # 现在读掉消息体后回复明确的 too large 错误并继续服务下一条消息。
            if ($script:lastMessageOversized) {
                $script:lastMessageOversized = $false
                try {
                    Send-Message @{ success = $false; error = 'Message too large (limit 1MB). Reduce batch size.' }
                    continue
                } catch {
                    # 回复也失败（管道断开），退出
                    break
                }
            }
            break
        }

        $action = $msg.action
        if (-not $action) { $action = '' }

        try {
            switch ($action) {
                'ping' {
                    Send-Message @{
                        success = $true
                        configPath = if ($configPath) { $configPath } else { '(not found)' }
                    }
                }

                'detectClient' {
                    $result = Detect-Client -ApiUrl $msg.apiUrl
                    Send-Message $result
                }

                # v1.4.9 修复：补齐 getSnapshotPath action
                # 原实现中扩展 background.js 的「重启 Clash」Step 4 会调用此 action 走
                # PUT /configs 无中断热重载，但 host 的 switch 未暴露该 action（只实现了
                # Get-SnapshotPath 函数），请求落入 default 分支返回 Unknown action，
                # 导致热重载路径自上线起从未生效，每次都降级为中断式 POST /restart。
                'getSnapshotPath' {
                    $snap = Get-SnapshotPath
                    if ($snap) {
                        Send-Message @{ success = $true; snapshotPath = $snap }
                    } else {
                        Send-Message @{ success = $false; error = 'Snapshot file not found (clash-verge.yaml)' }
                    }
                }

                'getRules' {
                    if ($msg.configPath) { $configPath = $msg.configPath }
                    if (-not $configPath) { $configPath = Get-ConfigPath }
                    if (-not $configPath -or -not (Test-Path $configPath)) {
                        Send-Message @{
                            success = $false
                            error = 'Config file not found. Please set CLASH_CONFIG_PATH or start Clash first.'
                        }
                    }
                    else {
                        $content = Read-Config $configPath
                        $rules = Parse-Rules $content
                        Send-Message @{
                            success = $true
                            rules = $rules
                            configPath = $configPath
                        }
                    }
                }

                'addRule' {
                    # useScript=true → 写入当前订阅绑定的 .js 文件（customRules 数组）
                    # useScript=false 或未设置 → 写入 YAML 配置文件（默认行为）
                    if ($msg.useScript -eq $true) {
                        try {
                            $result = Add-ScriptRule $msg.rule
                            Send-Message $result
                        } catch {
                            Send-Message @{ success = $false; error = "$($_.Exception.Message) | Stack: $($_.InvocationInfo.ScriptLineNumber)" }
                        }
                        break
                    }
                    if ($msg.configPath) { $configPath = $msg.configPath }
                    if (-not $configPath) { $configPath = Get-ConfigPath }
                    if (-not $configPath -or -not (Test-Path $configPath)) {
                        Send-Message @{ success = $false; error = 'Config file not found. Please set CLASH_CONFIG_PATH or start Clash first.' }
                    }
                    else {
                        try {
                            $content = Read-Config $configPath
                            $newContent = Add-Rule $content $msg.rule
                            # v1.4.9 修复：Add-Rule 返回 null 表示无法安全定位插入点
                            # （如 rules: [非空 flow] 这类无法安全改写的格式）
                            # 原实现会原样写回并回复 "Rule added" → 假成功，规则从未落盘
                            if ($null -eq $newContent) {
                                Send-Message @{ success = $false; error = 'Cannot safely locate rules section in config file (unsupported inline array format). Rule was NOT written.'; configPath = $configPath }
                            } else {
                                Write-Config $configPath $newContent
                                Send-Message @{ success = $true; message = 'Rule added'; configPath = $configPath }
                            }
                        } catch {
                            Send-Message @{ success = $false; error = "$($_.Exception.Message) | Stack: $($_.InvocationInfo.ScriptLineNumber)" }
                        }
                    }
                }

                'batchAddRules' {
                    # useScript=true → 批量写入 .js 文件
                    # useScript=false 或未设置 → 批量写入 YAML
                    if ($msg.useScript -eq $true) {
                        try {
                            $result = BatchAdd-ScriptRules $msg.rules
                            Send-Message $result
                        } catch {
                            Send-Message @{ success = $false; error = "$($_.Exception.Message) | Stack: $($_.InvocationInfo.ScriptLineNumber)" }
                        }
                        break
                    }
                    if ($msg.configPath) { $configPath = $msg.configPath }
                    if (-not $configPath) { $configPath = Get-ConfigPath }
                    if (-not $configPath -or -not (Test-Path $configPath)) {
                        Send-Message @{ success = $false; error = 'Config file not found. Please set CLASH_CONFIG_PATH or start Clash first.' }
                    }
                    else {
                        $content = Read-Config $configPath
                        $existing = [System.Collections.Generic.HashSet[string]]::new([string[]](Parse-Rules $content), [System.StringComparer]::OrdinalIgnoreCase)
                        $added = 0
                        $failed = @()
                        foreach ($rule in $msg.rules) {
                            if (-not $existing.Contains($rule)) {
                                $newContent = Add-Rule $content $rule
                                # v1.4.9 修复：Add-Rule 返回 null → 无法安全写入
                                # 原实现会把 null 赋给 $content 继续循环，最终写坏整个配置文件
                                if ($null -eq $newContent) {
                                    $failed += $rule
                                    continue
                                }
                                $content = $newContent
                                [void]$existing.Add($rule)
                                $added++
                            }
                        }
                        if ($failed.Count -gt 0) {
                            Write-Config $configPath $content
                            Send-Message @{ success = $false; error = "$($failed.Count) rule(s) could not be written (unsupported config format). Written: $added."; configPath = $configPath }
                            break
                        }
                        Write-Config $configPath $content
                        Send-Message @{ success = $true; message = "$added rules added"; configPath = $configPath }
                    }
                }

                'removeRule' {
                    # useScript=true → 从 .js 文件删除
                    # useScript=false 或未设置 → 从 YAML 删除
                    if ($msg.useScript -eq $true) {
                        try {
                            $result = Remove-ScriptRule $msg.rule
                            Send-Message $result
                        } catch {
                            Send-Message @{ success = $false; error = "$($_.Exception.Message) | Stack: $($_.InvocationInfo.ScriptLineNumber)" }
                        }
                        break
                    }
                    if ($msg.configPath) { $configPath = $msg.configPath }
                    if (-not $configPath) { $configPath = Get-ConfigPath }
                    if (-not $configPath -or -not (Test-Path $configPath)) {
                        Send-Message @{ success = $false; error = 'Config file not found. Please set CLASH_CONFIG_PATH or start Clash first.' }
                    }
                    else {
                        $content = Read-Config $configPath
                        $newContent = Remove-Rule $content $msg.rule
                        Write-Config $configPath $newContent
                        Send-Message @{ success = $true; message = 'Rule removed'; configPath = $configPath }
                    }
                }

                'setConfigPath' {
                    if (Test-Path $msg.path) {
                        $configPath = $msg.path
                        Send-Message @{ success = $true; message = 'Config path updated' }
                    }
                    else {
                        Send-Message @{ success = $false; error = 'Path does not exist' }
                    }
                }

                'getSystemProxy' {
                    $regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
                    try {
                        $proxyEnable = (Get-ItemProperty -Path $regPath -Name ProxyEnable -ErrorAction SilentlyContinue).ProxyEnable
                        $proxyServer = (Get-ItemProperty -Path $regPath -Name ProxyServer -ErrorAction SilentlyContinue).ProxyServer
                        $autoConfigUrl = (Get-ItemProperty -Path $regPath -Name AutoConfigURL -ErrorAction SilentlyContinue).AutoConfigURL
                        Send-Message @{
                            success = $true
                            proxyEnable = if ($proxyEnable) { $true } else { $false }
                            proxyServer = if ($proxyServer) { $proxyServer } else { '' }
                            autoConfigUrl = if ($autoConfigUrl) { $autoConfigUrl } else { '' }
                        }
                    }
                    catch {
                        Send-Message @{ success = $false; error = $_.Exception.Message }
                    }
                }

                'syncSnapshot' {
                    $snapshotPath = Get-SnapshotPath
                    if (-not $snapshotPath) {
                        Send-Message @{ success = $false; error = 'Snapshot file not found (clash-verge.yaml)' }
                    }
                    else {
                        try {
                            $newContent = Sync-SnapshotRules $snapshotPath $msg.rules
                            Write-Config $snapshotPath $newContent
                            Send-Message @{ success = $true; message = 'Snapshot synced'; snapshotPath = $snapshotPath }
                        } catch {
                            Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                        }
                    }
                }

                'getScriptPath' {
                    try {
                        $result = Get-ScriptPath
                        Send-Message $result
                    } catch {
                        Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                    }
                }

                'getScriptRules' {
                    try {
                        $result = Get-ScriptRules
                        Send-Message $result
                    } catch {
                        Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                    }
                }

                'initScriptFile' {
                    try {
                        $result = Init-ScriptFile
                        Send-Message $result
                    } catch {
                        Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                    }
                }

                default {
                    Send-Message @{ success = $false; error = "Unknown action: $action" }
                }
            }
        }
        catch {
            # 单条消息处理失败不影响后续消息
            Send-Message @{ success = $false; error = $_.Exception.Message }
        }
    }
}

# ──── 入口：防止脚本自身崩溃 ────
try {
    Main
} catch {
    # 致命错误写入 stderr（不影响 Native Messaging 协议）
    try { [Console]::Error.WriteLine("Native Host fatal: $($_.Exception.Message)") } catch {}
    exit 1
}
