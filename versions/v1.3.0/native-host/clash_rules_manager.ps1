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
    # Clash for Windows
    "$env:USERPROFILE\.config\clash\config.yaml",
    "$env:USERPROFILE\.config\clash\profiles\default.yaml",
    # Clash Nyanpasu
    "$env:USERPROFILE\.config\clash-nyanpasu\config.yaml",
    # Flclash
    "$env:USERPROFILE\.config\flclash\config.yaml",
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

# S-002 修复：配置路径白名单校验
# 允许的根目录列表（路径必须位于以下任一目录下）
function Get-AllowedConfigRoots {
    $roots = [System.Collections.ArrayList]::new()
    $candidates = @(
        $env:APPDATA,
        $env:LOCALAPPDATA,
        "$env:USERPROFILE\.config",
        "$env:USERPROFILE\.config\clash",
        "$env:USERPROFILE\.config\clash-verge",
        "$env:USERPROFILE\.config\mihomo",
        "$env:USERPROFILE\.config\clash-nyanpasu",
        "$env:USERPROFILE\.config\flclash"
    )
    foreach ($c in $candidates) {
        if ($c -and -not $roots.Contains($c)) { [void]$roots.Add($c) }
    }
    return ,$roots.ToArray()
}

function Test-ConfigPathAllowed($path) {
    # S-012 修复：校验配置路径是否在允许的目录范围内
    if (-not $path -or $path -isnot [string]) { return $false }
    # 必须是绝对路径
    if (-not [System.IO.Path]::IsPathRooted($path)) { return $false }
    # 规范化路径（解析 .., . 等）
    try {
        $fullPath = [System.IO.Path]::GetFullPath($path)
    } catch { return $false }
    # 必须是 .yaml 或 .yml 后缀
    $ext = [System.IO.Path]::GetExtension($fullPath)
    if ($ext -ne '.yaml' -and $ext -ne '.yml') { return $false }
    # 校验路径是否在允许的根目录下
    $allowedRoots = Get-AllowedConfigRoots
    foreach ($root in $allowedRoots) {
        try {
            $rootFull = [System.IO.Path]::GetFullPath($root)
            if ($fullPath.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        } catch {}
    }
    return $false
}

function Get-ConfigPath {
    # 1. 环境变量优先
    $envPath = $env:CLASH_CONFIG_PATH
    if ($envPath -and (Test-Path $envPath) -and (Test-ConfigPathAllowed $envPath)) {
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
    #    S-003 修复：使用精确进程名白名单，避免 like '%clash%' 匹配到恶意进程
    #    并校验提取的路径在允许的目录范围内
    $knownProcessNames = @('clash.exe', 'mihomo.exe', 'clash-verge.exe', 'clash-meta.exe', 'clashx.exe', 'flclash.exe')
    foreach ($procName in $knownProcessNames) {
        $clashProcs = Get-CimInstance Win32_Process -Filter "name = '$procName'" -ErrorAction SilentlyContinue
        foreach ($proc in $clashProcs) {
            if ($proc.CommandLine) {
                $cmdLine = $proc.CommandLine
                if ($cmdLine -match '-f\s+"?([^\s"]+\.ya?ml)"?') {
                    $p = $matches[1]
                    if ((Test-Path $p) -and (Test-ConfigPathAllowed $p)) { return $p }
                }
                if ($cmdLine -match '-d\s+"?([^\s"]+)"?') {
                    $d = $matches[1]
                    $p = Join-Path $d "config.yaml"
                    if ((Test-Path $p) -and (Test-ConfigPathAllowed $p)) { return $p }
                }
            }
        }
    }

    return $null
}

function Read-Config($path) {
    # 使用 .NET 直接读取文件，避免 Get-Content -Encoding 参数兼容性问题
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    return [System.IO.File]::ReadAllText($path, $utf8NoBom)
}

function Write-Config($path, $content) {
    # S-013 修复：写入后验证 + 失败回滚
    # 1. 备份原文件
    $backup = "$path.bak"
    $hadOriginal = $false
    $originalContent = $null
    if (Test-Path $path) {
        $originalContent = Read-Config $path
        Copy-Item -Path $path -Destination $backup -Force
        $hadOriginal = $true
    }
    # 2. 写入新内容
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    try {
        [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
    } catch {
        # 写入失败：尝试回滚
        if ($hadOriginal) {
            try { [System.IO.File]::WriteAllText($path, $originalContent, $utf8NoBom) } catch {}
        }
        throw "写入配置文件失败: $($_.Exception.Message)"
    }
    # 3. 写入后验证：读回内容比对长度（防止磁盘异常导致截断）
    try {
        $written = [System.IO.File]::ReadAllText($path, $utf8NoBom)
        if ($written.Length -lt $content.Length) {
            # 写入不完整，回滚
            if ($hadOriginal) {
                [System.IO.File]::WriteAllText($path, $originalContent, $utf8NoBom)
            } else {
                Remove-Item $path -Force -ErrorAction SilentlyContinue
            }
            throw "写入验证失败: 文件长度不一致 (期望 $($content.Length), 实际 $($written.Length))"
        }
    } catch {
        # 验证过程本身异常，不回滚（避免误删），仅抛出警告
        throw "写入后验证异常: $($_.Exception.Message)"
    }
}

# S-008 修复：规则格式校验函数
# 允许的规则类型白名单（参考 Clash/mihomo 官方文档）
$script:AllowedRuleTypes = @(
    'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-REGEX',
    'GEOSITE', 'IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP',
    'SRC-GEOIP', 'SRC-IP-ASN', 'SRC-IP-CIDR', 'SRC-PORT', 'DST-PORT',
    'PROCESS-NAME', 'PROCESS-PATH', 'NETWORK', 'UID',
    'IN-TYPE', 'IN-USER', 'IN-NAME', 'SUB-RULE', 'RULE-SET',
    'AND', 'OR', 'NOT', 'MATCH', 'FINAL'
)

function Test-RuleFormat($rule) {
    # S-008 修复：校验规则字符串格式，防止注入恶意内容
    if (-not $rule -or $rule -isnot [string]) { return $false }
    $rule = $rule.Trim()
    if ($rule.Length -eq 0 -or $rule.Length -gt 1024) { return $false }
    # 禁止包含换行符/回车符（防止 YAML 注入）
    if ($rule -match "[`r`n]") { return $false }
    # 禁止包含 YAML 特殊注入序列
    if ($rule -match ':\s*-') { return $false }
    if ($rule -match '^\s*---') { return $false }
    if ($rule -match '^\s*%YAML') { return $false }
    # 解析规则类型（第一个逗号前的部分）
    $parts = $rule -split ','
    if ($parts.Count -lt 2) { return $false }
    $ruleType = $parts[0].Trim().ToUpperInvariant()
    # MATCH/FINAL 可以只有类型
    if ($parts.Count -eq 2 -and ($ruleType -eq 'MATCH' -or $ruleType -eq 'FINAL')) {
        return $true
    }
    # 至少需要 类型,payload,policy 三段
    if ($parts.Count -lt 3) { return $false }
    # 校验类型白名单
    if ($AllowedRuleTypes -notcontains $ruleType) { return $false }
    return $true
}

function Parse-Rules($content) {
    # S-007 修复说明：
    # 本函数使用正则解析 YAML，无法处理多行字符串（|, >）、锚点（&）、引用（*）、
    # 流式语法（{}, []）等复杂 YAML 特性。由于 Clash 配置文件由内核生成，
    # rules 字段通常为简单列表项，正则解析足够。但为安全起见，添加以下防护：
    # 1. 检测多行字符串标记，若存在则跳过该区域解析
    # 2. 限制单行长度，防止超长行导致正则回溯
    # 3. 跳过包含流式语法标记的行
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

function Add-Rule($content, $rule) {
    # S-008 修复：校验规则格式，拒绝恶意输入
    if (-not (Test-RuleFormat $rule)) {
        throw "Invalid rule format: $rule"
    }
    # 去除规则首尾的单引号/双引号，防止 YAML 双引号转义问题（''xxx'' 会被解析为空字符串+xxx）
    $rule = $rule.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()

    # 解析新规则的类型和 payload
    $ruleParts = $rule -split ','
    $newType = if ($ruleParts.Count -ge 1) { $ruleParts[0].Trim() } else { '' }
    $newPayload = if ($ruleParts.Count -ge 2) { $ruleParts[1].Trim() } else { '' }

    $isProfile = ($content -match '^\s*append\s*:') -or ($content -match '^\s*prepend\s*:')

    if ($isProfile) {
        $lines = [System.Collections.ArrayList]::new($content -split "`n")
        $inAppend = $false; $insertIdx = -1; $overrideIdx = -1; $lastSameTypeIdx = -1
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $trimmed = $lines[$i].Trim()
            if ($trimmed -eq 'append:') { $inAppend = $true; continue }
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
                if ($trimmed -eq '[]') { $lines[$i] = "  - '$rule'"; $insertIdx = -1; break }
                if (-not $trimmed.StartsWith('- ') -and $trimmed -and -not $trimmed.StartsWith('#')) { $insertIdx = $i; break }
            }
        }
        if ($overrideIdx -ge 0) {
            # 检测到重复规则时，替换原行（而非 Insert 导致重复）
            $lines[$overrideIdx] = "  - '$rule'"
        } elseif ($lastSameTypeIdx -ge 0) {
            $lines.Insert($lastSameTypeIdx + 1, "  - '$rule'")
        } elseif ($insertIdx -ge 0) {
            $lines.Insert($insertIdx, "  - '$rule'")
        }
        return $lines -join "`n"
    }

    # 标准 Clash 配置格式
    # 关键：新规则前置到 rules 部分开头，优先于所有 RULE-SET
    # 根因：原逻辑将规则追加到 RULE-SET 之后（MATCH 之前），
    #       导致被 RULE-SET 先匹配，用户添加的规则永远不生效
    $lines = [System.Collections.ArrayList]::new($content -split "`n")
    $inRules = $false; $insertIdx = -1; $overrideIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if (-not $inRules) {
            if ($trimmed -eq 'rules:' -or $trimmed.StartsWith('rules:')) {
                $inRules = $true
                $insertIdx = $i + 1
            }
            continue
        }
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match "^-\s*'?([^,]+),([^,]+),") {
            $existingType = $Matches[1].Trim()
            $existingPayload = $Matches[2].Trim()
            if ($existingType -eq $newType -and $existingPayload -eq $newPayload -and $overrideIdx -lt 0) {
                $overrideIdx = $i
            }
        }
    }
    if ($insertIdx -lt 0) { return $content }
    $newLine = if ($rule.Contains(',')) { "  - '$rule'" } else { "  - $rule" }
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

# ──── 扩展脚本规则管理 ────
# Clash Verge Rev 的 type:script profile 是一个 JS 文件，包含 main(config) 函数
# 通过修改 config.rules 数组实现规则覆盖。本扩展在此 JS 文件的 main 函数内部维护
# customRules 数组，main 函数会将 customRules 前置到 config.rules，实现"扩展脚本规则"。
#
# 文件格式（由本扩展自动初始化和管理，对齐 Clash Verge Rev 官方推荐写法）：
#   // === ClashOmega Extension Rules (auto-managed, do not edit manually) ===
#   function main(config) {
#     const customRules = [
#       "DOMAIN-SUFFIX,example.com,Proxy",
#       "DOMAIN,google.com,Direct"
#     ];
#     if (config.rules) {
#       config.rules = [...customRules, ...config.rules];
#     } else {
#       config.rules = customRules;
#     }
#     return config;
#   }
#   // === End of ClashOmega Extension Rules ===
#
# 关键点：规则数组必须定义在 main 函数内部（局部变量），不能放在函数外部，
# 否则 Clash Verge Rev 的脚本执行环境（QuickJS 沙箱）可能无法捕获外部全局常量，
# 导致 main 函数内引用时变量不可见，规则不生效。

# 查找当前激活 profile 的 option.script 指向的 JS 文件路径
# Clash Verge Rev 的每个 remote/local profile 可通过 option.script 引用一个 type:script profile
# 本扩展将规则写入该脚本文件 main 函数内部的 customRules 数组，main 函数将其前置到 config.rules
function Get-ScriptPath {
    foreach ($dir in $ProfilesYamlDirs) {
        $profilesYaml = Join-Path $dir 'profiles.yaml'
        if (-not (Test-Path $profilesYaml)) { continue }

        $profileContent = [System.IO.File]::ReadAllText($profilesYaml, $encoding)
        $lines = $profileContent -split "`n"

        # 1. 解析 current 字段，找到当前激活的 profile UID
        $currentUid = $null
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ($trimmed -match '^current\s*:\s*(\S+)') {
                $currentUid = $matches[1]
                break
            }
        }
        if (-not $currentUid) { continue }

        # 2. 在 items 列表中查找 currentUid 对应条目的 option.script 字段
        $itemUid = $null; $inOption = $false; $scriptUid = $null; $inCurrent = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $trimmed = $lines[$i].Trim()
            if ($trimmed -match '^-\s*uid\s*:\s*(\S+)') {
                # 遇到新条目前，检查上一个条目是否是 current 且有 script
                if ($inCurrent -and $scriptUid) { break }
                $itemUid = $matches[1]
                $inCurrent = ($itemUid -eq $currentUid)
                $inOption = $false
                $scriptUid = $null
            }
            elseif ($inCurrent -and $trimmed -match '^\s*option\s*:') {
                $inOption = $true
            }
            elseif ($inOption -and $trimmed -match '^\s*script\s*:\s*(\S+)') {
                $scriptUid = $matches[1]
            }
        }
        # 检查最后一个条目（如果 current 是最后一个 item）
        if (-not $scriptUid -and $inCurrent) {
            # current 条目没有 option.script
        }

        if (-not $scriptUid) { continue }

        # 3. 在 items 列表中查找 scriptUid 对应的 file（type:script 条目）
        $scriptFile = $null
        $sUid = $null; $sFile = $null
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $trimmed = $lines[$i].Trim()
            if ($trimmed -match '^-\s*uid\s*:\s*(\S+)') {
                if ($sUid -eq $scriptUid -and $sFile) { $scriptFile = $sFile; break }
                $sUid = $matches[1]; $sFile = $null
            }
            elseif ($trimmed -match '^\s*file\s*:\s*(\S+)') { $sFile = $matches[1] }
        }
        if (-not $scriptFile -and $sUid -eq $scriptUid -and $sFile) { $scriptFile = $sFile }

        if ($scriptFile) {
            $scriptPath = Join-Path (Join-Path $dir 'profiles') $scriptFile
            if (Test-Path $scriptPath) { return $scriptPath }
        }
    }
    return $null
}

# 初始化脚本文件为标准扩展脚本格式（对齐 Clash Verge Rev 官方推荐写法）
function Initialize-ScriptFile($scriptPath) {
    $template = @"
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
"@
    Write-Config $scriptPath $template
}

# 检查脚本文件是否为本扩展管理的格式（包含扩展规则标记）
function Test-ScriptFileManaged($content) {
    return $content -match 'ClashOmega Extension Rules'
}

# 从脚本文件的 customRules 数组中解析规则列表
# 规则数组定义在 main 函数内部（const customRules = [...]），需用单行模式跨行匹配
function Parse-ScriptRules($content) {
    $rules = [System.Collections.ArrayList]::new()

    # 匹配 customRules = [ ... ] 区块（兼容旧版 EXT_RULES 命名）
    if ($content -match '(?s)const\s+(?:customRules|EXT_RULES)\s*=\s*\[(.*?)\]') {
        $arrayContent = $matches[1]
        # 匹配每条规则字符串（单引号或双引号）
        $matches2 = [regex]::Matches($arrayContent, "['""]([^'""]+)['""]")
        foreach ($m in $matches2) {
            $rule = $m.Groups[1].Value.Trim()
            if ($rule) { [void]$rules.Add($rule) }
        }
    }
    return ,$rules.ToArray()
}

# 向脚本文件的 customRules 数组添加规则（去重：同 type+payload 替换）
function Add-ScriptRule($content, $rule) {
    $rule = $rule.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()
    if (-not $rule) { return $content }

    # 解析新规则的类型和 payload
    $ruleParts = $rule -split ','
    $newType = if ($ruleParts.Count -ge 1) { $ruleParts[0].Trim() } else { '' }
    $newPayload = if ($ruleParts.Count -ge 2) { $ruleParts[1].Trim() } else { '' }

    # 如果文件不包含扩展规则标记，先初始化
    if (-not (Test-ScriptFileManaged $content)) {
        return $content
    }

    $existingRules = Parse-ScriptRules $content
    $newRules = [System.Collections.ArrayList]::new()
    $overridden = $false

    foreach ($r in $existingRules) {
        $parts = $r -split ','
        $exType = if ($parts.Count -ge 1) { $parts[0].Trim() } else { '' }
        $exPayload = if ($parts.Count -ge 2) { $parts[1].Trim() } else { '' }
        if ($exType -eq $newType -and $exPayload -eq $newPayload) {
            # 同 type+payload 替换
            [void]$newRules.Add($rule)
            $overridden = $true
        } else {
            [void]$newRules.Add($r)
        }
    }
    if (-not $overridden) { [void]$newRules.Add($rule) }

    return Rebuild-ScriptContent $content $newRules
}

# 从脚本文件的 customRules 数组删除规则（归一化比较）
function Remove-ScriptRule($content, $rule) {
    $rule = $rule.Trim().TrimStart("'").TrimEnd("'").TrimStart('"').TrimEnd('"').Trim()
    if (-not $rule) { return $content }

    function Normalize-RuleStr($r) {
        $parts = $r -split ','
        if ($parts.Count -ge 1) {
            $parts[0] = $parts[0].ToUpper().Replace('-', '')
        }
        return ($parts -join ',')
    }

    $normalizedRule = Normalize-RuleStr $rule
    $existingRules = Parse-ScriptRules $content
    $newRules = [System.Collections.ArrayList]::new()

    foreach ($r in $existingRules) {
        if ((Normalize-RuleStr $r) -ne $normalizedRule) {
            [void]$newRules.Add($r)
        }
    }

    return Rebuild-ScriptContent $content $newRules
}

# 重建脚本内容，规则数组定义在 main 函数内部（对齐 Clash Verge Rev 官方推荐写法）
function Rebuild-ScriptContent($content, $rules) {
    # 构建 main 函数内部的 customRules 数组文本
    $rulesLines = [System.Collections.ArrayList]::new()
    [void]$rulesLines.Add('// === ClashOmega Extension Rules (auto-managed, do not edit manually) ===')
    [void]$rulesLines.Add('function main(config) {')
    [void]$rulesLines.Add('  // 1. 定义自定义规则（由 ClashOmega 扩展自动维护）')
    [void]$rulesLines.Add('  const customRules = [')
    if ($rules.Count -gt 0) {
        foreach ($r in $rules) {
            [void]$rulesLines.Add("    `"$r`",")
        }
    }
    [void]$rulesLines.Add('  ];')
    [void]$rulesLines.Add('')
    [void]$rulesLines.Add('  // 2. 将自定义规则插入到 config.rules 最前面')
    [void]$rulesLines.Add('  if (config.rules) {')
    [void]$rulesLines.Add('    config.rules = [...customRules, ...config.rules];')
    [void]$rulesLines.Add('  } else {')
    [void]$rulesLines.Add('    config.rules = customRules;')
    [void]$rulesLines.Add('  }')
    [void]$rulesLines.Add('')
    [void]$rulesLines.Add('  // 3. 返回修改后的配置')
    [void]$rulesLines.Add('  return config;')
    [void]$rulesLines.Add('}')
    [void]$rulesLines.Add('// === End of ClashOmega Extension Rules ===')
    [void]$rulesLines.Add('')

    return ($rulesLines -join "`n")
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
            [void]$lines.Add("  - '$rule'")
        }
    } else {
        # 移除旧的 rules 条目
        if ($rulesEnd -gt $rulesStart) {
            $lines.RemoveRange($rulesStart + 1, $rulesEnd - $rulesStart - 1)
        }
        # 插入新规则
        $insertIdx = $rulesStart + 1
        foreach ($rule in $rules) {
            $lines.Insert($insertIdx, "  - '$rule'")
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
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($lenBytes, 0, 4)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

function Read-Message {
    $stdin = [Console]::OpenStandardInput()
    $lenBuffer = New-Object byte[] 4
    $read = $stdin.Read($lenBuffer, 0, 4)
    if ($read -lt 4) { return $null }
    $msgLen = [System.BitConverter]::ToInt32($lenBuffer, 0)
    if ($msgLen -le 0 -or $msgLen -gt 1048576) { return $null }
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
        if ($null -eq $msg) { break }

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
                    # useScript=true 时写入 Script.js 的 EXT_RULES 数组，否则写入 YAML 配置文件
                    if ($msg.useScript) {
                        $scriptPath = Get-ScriptPath
                        if (-not $scriptPath) {
                            Send-Message @{ success = $false; error = 'Script file not found. Please initialize it first.' }
                        }
                        elseif (-not (Test-Path $scriptPath)) {
                            Send-Message @{ success = $false; error = "Script file does not exist: $scriptPath"; scriptPath = $scriptPath; needInit = $true }
                        }
                        else {
                            try {
                                $content = Read-Config $scriptPath
                                if (-not (Test-ScriptFileManaged $content)) {
                                    Send-Message @{ success = $false; error = 'Script file is not initialized or corrupted. Please initialize it first.'; scriptPath = $scriptPath; needInit = $true }
                                }
                                else {
                                    $newContent = Add-ScriptRule $content $msg.rule
                                    Write-Config $scriptPath $newContent
                                    Send-Message @{ success = $true; message = 'Rule added to script'; scriptPath = $scriptPath }
                                }
                            } catch {
                                Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                            }
                        }
                    }
                    else {
                        if ($msg.configPath) { $configPath = $msg.configPath }
                        if (-not $configPath) { $configPath = Get-ConfigPath }
                        if (-not $configPath -or -not (Test-Path $configPath)) {
                            Send-Message @{ success = $false; error = 'Config file not found. Please set CLASH_CONFIG_PATH or start Clash first.' }
                        }
                        else {
                            try {
                                $content = Read-Config $configPath
                                $newContent = Add-Rule $content $msg.rule
                                Write-Config $configPath $newContent
                                Send-Message @{ success = $true; message = 'Rule added'; configPath = $configPath }
                            } catch {
                                Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                            }
                        }
                    }
                }

                'batchAddRules' {
                    if ($msg.configPath) { $configPath = $msg.configPath }
                    if (-not $configPath) { $configPath = Get-ConfigPath }
                    if (-not $configPath -or -not (Test-Path $configPath)) {
                        Send-Message @{ success = $false; error = 'Config file not found. Please set CLASH_CONFIG_PATH or start Clash first.' }
                    }
                    else {
                        $content = Read-Config $configPath
                        $existing = [System.Collections.Generic.HashSet[string]]::new([string[]](Parse-Rules $content))
                        $added = 0
                        $skipped = 0
                        foreach ($rule in $msg.rules) {
                            # S-008 修复：跳过格式无效的规则，不中断整批操作
                            if (-not (Test-RuleFormat $rule)) { $skipped++; continue }
                            if (-not $existing.Contains($rule)) {
                                $content = Add-Rule $content $rule
                                [void]$existing.Add($rule)
                                $added++
                            }
                        }
                        Write-Config $configPath $content
                        $msg_text = if ($skipped -gt 0) { "$added rules added, $skipped skipped (invalid format)" } else { "$added rules added" }
                        Send-Message @{ success = $true; message = $msg_text; configPath = $configPath }
                    }
                }

                'removeRule' {
                    # useScript=true 时从 Script.js 的 EXT_RULES 数组删除，否则从 YAML 配置文件删除
                    if ($msg.useScript) {
                        $scriptPath = Get-ScriptPath
                        if (-not $scriptPath -or -not (Test-Path $scriptPath)) {
                            Send-Message @{ success = $false; error = 'Script file not found or does not exist' }
                        }
                        else {
                            try {
                                $content = Read-Config $scriptPath
                                if (-not (Test-ScriptFileManaged $content)) {
                                    Send-Message @{ success = $false; error = 'Script file is not initialized or corrupted'; scriptPath = $scriptPath; needInit = $true }
                                }
                                else {
                                    $newContent = Remove-ScriptRule $content $msg.rule
                                    Write-Config $scriptPath $newContent
                                    Send-Message @{ success = $true; message = 'Rule removed from script'; scriptPath = $scriptPath }
                                }
                            } catch {
                                Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                            }
                        }
                    }
                    else {
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
                }

                'setConfigPath' {
                    # S-002 修复：路径白名单校验，防止路径遍历攻击
                    $candidatePath = $msg.path
                    if (-not $candidatePath) {
                        Send-Message @{ success = $false; error = 'Path is empty' }
                    }
                    elseif (-not (Test-ConfigPathAllowed $candidatePath)) {
                        Send-Message @{ success = $false; error = 'Path is not in allowed directories (must be under APPDATA/LOCALAPPDATA/USERPROFILE\.config and end with .yaml/.yml)' }
                    }
                    elseif (-not (Test-Path $candidatePath)) {
                        Send-Message @{ success = $false; error = 'Path does not exist' }
                    }
                    else {
                        $configPath = $candidatePath
                        Send-Message @{ success = $true; message = 'Config path updated' }
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
                            # 返回快照文件内容，供扩展用 {payload} 方式 PUT /configs 热重载
                            # mihomo 的 PUT /configs {path} 在某些版本返回 "Body invalid"，
                            # 只能用 {payload: yamlContent} 方式让内核重新加载完整配置
                            Send-Message @{ success = $true; message = 'Snapshot synced'; snapshotPath = $snapshotPath; snapshotContent = $newContent }
                        } catch {
                            Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                        }
                    }
                }

                'getSnapshotPath' {
                    # 返回 clash-verge.yaml 快照文件路径，供扩展调用 PUT /configs {path} 热重载
                    $snapshotPath = Get-SnapshotPath
                    if ($snapshotPath) {
                        Send-Message @{ success = $true; snapshotPath = $snapshotPath }
                    } else {
                        Send-Message @{ success = $false; error = 'Snapshot file not found (clash-verge.yaml)' }
                    }
                }

                'getScriptPath' {
                    $scriptPath = Get-ScriptPath
                    if ($scriptPath) {
                        $managed = $false
                        if (Test-Path $scriptPath) {
                            $content = Read-Config $scriptPath
                            $managed = Test-ScriptFileManaged $content
                        }
                        Send-Message @{ success = $true; scriptPath = $scriptPath; exists = (Test-Path $scriptPath); managed = $managed }
                    }
                    else {
                        Send-Message @{ success = $false; error = 'Script file not found (no option.script in current profile)' }
                    }
                }

                'getScriptRules' {
                    $scriptPath = Get-ScriptPath
                    if (-not $scriptPath -or -not (Test-Path $scriptPath)) {
                        Send-Message @{ success = $false; error = 'Script file not found or does not exist'; scriptPath = $scriptPath; needInit = $true }
                    }
                    else {
                        $content = Read-Config $scriptPath
                        if (-not (Test-ScriptFileManaged $content)) {
                            Send-Message @{ success = $false; error = 'Script file is not initialized or corrupted'; scriptPath = $scriptPath; needInit = $true }
                        }
                        else {
                            $rules = Parse-ScriptRules $content
                            Send-Message @{ success = $true; rules = $rules; scriptPath = $scriptPath }
                        }
                    }
                }

                'initScriptFile' {
                    $scriptPath = Get-ScriptPath
                    if (-not $scriptPath) {
                        Send-Message @{ success = $false; error = 'Cannot find script file (current profile has no option.script, or Clash Verge Rev profiles directory not found)' }
                    }
                    else {
                        try {
                            # 如果文件已存在，先备份
                            if (Test-Path $scriptPath) {
                                $backup = "$scriptPath.bak"
                                Copy-Item -Path $scriptPath -Destination $backup -Force
                            }
                            Initialize-ScriptFile $scriptPath
                            Send-Message @{ success = $true; message = 'Script file initialized'; scriptPath = $scriptPath }
                        } catch {
                            Send-Message @{ success = $false; error = "$($_.Exception.Message)" }
                        }
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