# Chrome Clash Manager

> v1.1.5 · Chrome 浏览器扩展，用于管理 Clash 代理规则，支持三模式代理切换、域名规则匹配检测、一键添加域名到代理组。

## 功能

| 功能 | 说明 |
|------|------|
| **三模式切换** | 系统代理 → 直连 → Clash 代理，一键切换，图标颜色实时变化 |
| **F1: 规则匹配检测** | 检测当前域名匹配的 Clash 规则，显示匹配的分组和策略（支持 RULE-SET 回退到 `/connections` API 查询） |
| **F2: 快捷添加规则** | 将当前域名添加到代理组（动态获取 Clash 代理组列表） |
| **F3: 智能域名分组** | 检测页面所有域名，自动分组建议（如 `i1.art.com`, `i2.art.com` → `*.art.com`） |
| **系统代理状态** | 实时显示 Windows 系统代理状态（通过 Native Host 读取注册表） |
| **规则管理** | 查看、添加、删除 Clash YAML 配置文件中的规则（增删后自动热重载） |
| **重启 Clash** | 一键将 profile 规则同步到 Clash Verge Rev 快照文件并重启内核（热重载失效时使用） |
| **多语言** | 简体中文 / English / 日本語 |
| **Material Design 3** | Google MD3 设计风格 |

## 安装

### 1. 加载扩展

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/` 目录

### 2. 安装 Native Messaging Host

Native Host 用于读写 Clash 本地 YAML 配置文件（仅 Windows）。

1. 在 `chrome://extensions/` 中找到 Clash Manager 扩展，复制其 **ID**
2. 右键 `native-host/install.ps1` → **使用 PowerShell 运行**
3. 粘贴扩展 ID，回车完成安装
4. 刷新扩展

### 3. 配置 Clash API

1. 点击扩展图标 → 设置（齿轮按钮）
2. 填写 Clash API 地址（默认 `http://127.0.0.1:9090`）和密钥
3. 配置文件路径留空则自动检测（支持 Clash Verge Rev 的 `profiles.yaml`）

## 使用说明

### 添加/删除规则后会自动生效吗？

**会**。增删规则成功后，扩展会自动通过 Clash API `/configs?force=true` 热重载配置（500ms 防抖）。

底部的「重启 Clash」按钮是更彻底的方式：将 profile 规则写入 Clash Verge Rev 快照文件（`clash-verge.yaml`）并重启内核，仅在热重载失效时使用。

### 为什么我的自定义规则不生效？

Clash 内核**自上而下顺序匹配**，第一个匹配的规则生效。如果你的自定义规则位于 `RULE-SET,google,...` 等规则集之后，且域名被包含在规则集中，则永远不会命中自定义规则。

**解决方案**：将自定义规则移到 rules 列表顶部（`RULE-SET` 之前）。

### 为什么域名匹配显示为「漏网之鱼」？

可能原因：
1. 域名确实没有匹配任何规则，落到 `MATCH` 兜底规则
2. 规则类型是 `RULE-SET`，浏览器端无法解析规则集内容，扩展会回退到 Clash API `/connections` 查询实际匹配结果（需该域名有活跃连接）

## 技术栈

- **前端**: Chrome Extension Manifest V3 + Vanilla JS + CSS3 (MD3)
- **后端**: Native Messaging Host (PowerShell)
- **通信**: `chrome.runtime.sendMessage` + `chrome.runtime.sendNativeMessage`
- **API**: Clash REST API (`GET /configs`, `/rules`, `/proxies`, `/connections`)

## 项目结构

```
extension/          # Chrome 扩展
├── manifest.json   # MV3 清单
├── background.js   # Service Worker（消息分发 + 热重载）
├── lib/            # 模块
│   ├── clash-api.js       # Clash REST API 封装
│   ├── native-bridge.js   # Native Host 通信桥接
│   ├── proxy.js           # 代理模式切换
│   └── domain-detector.js # 页面域名检测
├── popup/          # 弹窗 UI
│   ├── popup.html
│   ├── popup.js    # 域名匹配 + 规则增删 UI
│   └── popup.css   # MD3 样式
├── locales/        # 多语言文件（zh_CN / en / ja）
└── icons/          # 模式图标

native-host/        # Native Messaging Host（Windows）
├── install.ps1     # 安装脚本（注册 Native Host）
├── clash_rules_manager.bat   # 启动入口
├── clash_rules_manager.ps1   # 主程序（YAML 读写 + 系统代理查询）
└── com.clash.manager.json    # Native Host 清单模板
```

## 版本历史

### v1.1.6 (2026-06-21)

**Bug 修复**
- 修复 F1「检测域名在哪个代理组」只显示 MATCH 的问题：当订阅规则大部分是 `RuleSet` 类型时，本地匹配无法处理（浏览器端无法解析 RuleSet），只有 `Match` 兜底规则匹配
- `findMatchingRulesFromConnections` 增加 `sniffHost` fallback：mihomo 的 `metadata.host` 可能为空（IP 直连或 DNS 未解析），此时 `sniffHost`（TLS SNI / HTTP Host sniffing 结果）可能有值
- 改进覆盖策略：当本地匹配只有 MATCH 时，`/connections` 的任何匹配（含 MATCH）也覆盖本地结果，因为 `chains` 含实际代理组信息，比本地 MATCH 更有价值

### v1.1.5 (2026-06-21)

**Bug 修复**
- 修复热重载不生效：`hotReloadConfig` 用 `{...config, rules: [...]}` PUT 给 `/configs`，但 mihomo 内核的 `PUT /configs` 对 `rules` 字段的更新会被忽略。改为 `{"payload": yamlContent}` 方式，直接传快照文件完整 YAML 内容，内核真正重新加载规则
- `syncSnapshot` action 返回 `snapshotContent` 字段（快照文件完整内容），供扩展用 `{payload}` 方式热重载

### v1.1.4 (2026-06-21)

**Bug 修复**
- 修复 F1 域名匹配关键词提取错误：多段 TLD 域名（如 `.com.tw`、`.co.uk`）导致 `domainKey` 取到 TLD 部分（`com`）而非域名主体，使得所有 `.com` 连接被误判为匹配当前域名，表现为「当前域名匹配到 google 分组和漏网之鱼」
- `findMatchingRulesFromConnections` 改为严格域名匹配：`host === domain` 精确匹配、`host 是 domain 子域`、`domain 是 host 子域`三种情况，不再使用 `host.includes(keyword)` 包含匹配

### v1.1.3 (2026-06-21)

**Bug 修复**
- 修复删除规则不生效：Clash API 返回驼峰格式 type（`DomainSuffix`）与 YAML 文件大写格式（`DOMAIN-SUFFIX`）不匹配，`Remove-Rule` 归一化比较后正确删除
- 修复添加规则产生重复：`Add-Rule` 检测到同 type+payload 重复规则时用 `$lines[$overrideIdx] = $newLine` 替换原行，而非 `Insert` 插入新行
- 修复热重载不生效：`scheduleHotReload` 缺少 `syncSnapshotRules` 步骤，导致 Clash 内核 `/rules` 和 `/connections` API 仍读取旧快照，新增/删除规则后「检查当前域名在那个组」看不到变化

### v1.1.2 (2026-06-21)

**Bug 修复**
- 修复切换语言后 placeholder 仍显示中文：`refreshAllI18n` 未处理 `placeholder` 和 `title` 属性
- 新增 `data-i18n-placeholder` 和 `data-i18n-title` 属性支持，切换语言时同步更新

**i18n 完善**
- 补充 `settings_secret_placeholder`、`settings_config_path_placeholder`、`settings_close` 三语言 key
- 修复「关闭」按钮缺少 `data-i18n` 属性导致切换语言后仍显示中文
- 修复「(可选)」「自动检测」等 placeholder 切换语言后不更新

### v1.1.1 (2026-06-21)

**Bug 修复**
- 修复增删规则后热重载不生效：`scheduleHotReload` 未传入 `configPath`，导致 Native Host 自动检测失败或读错文件
- 增删规则现在会携带用户设置的 `clashConfigPath` 触发热重载

**UI 改进**
- 「同步规则到内核」按钮改名为「重启 Clash」，更简单易懂
- 同步更新三语言文案（zh_CN / en / ja）

### v1.1.0 (2026-06-21)

**新增功能**
- 域名匹配检测回退到 Clash API `/connections`，支持 RULE-SET 等浏览器端无法解析的规则类型
- 自动检测 Clash Verge Rev 激活 profile（优先解析 `profiles.yaml` 的 `current` 字段）
- 增删规则后自动热重载（500ms 防抖）
- 「同步规则到内核」按钮：写快照 + 重启内核

**Bug 修复**
- 修复 `Join-Path` 三参数调用导致 `restartClash` Step 1 失败（Windows PowerShell 5.1 兼容）
- 修复 `Parse-Rules` 返回 `$null` 导致快照 rules 被清空、所有节点断连
- 修复 `Get-ConfigPath` 选中空规则模板而非激活 profile
- 修复 `Add-Rule` 写入双单引号导致 YAML 解析失败、代理崩溃
- 修复 `Remove-Rule` 未清理首尾单引号导致删除规则不生效
- 修复 F1 删除按钮在 `.matched-rule-item` 容器中 `closest('.rule-item')` 返回 null 崩溃
- 修复 `hotReloadConfig` 中 `rules.filter is not a function`（`{}` 非数组）
- 移除设置面板内重复的「同步规则到内核」按钮

### v1.0.1

- 初始版本：三模式切换、规则增删、域名检测、多语言

## 兼容性

- **浏览器**: Chrome / Edge / 其他 Chromium 内核浏览器（需支持 MV3）
- **代理内核**: Clash / Clash Verge Rev / Mihomo（需开启 RESTful API）
- **操作系统**: Windows（Native Host 依赖 PowerShell）

## 许可证

MIT License
