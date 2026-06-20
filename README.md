# Chrome Clash Manager

> v1.1.0 · Chrome 浏览器扩展，用于管理 Clash 代理规则，支持三模式代理切换、域名规则匹配检测、一键添加域名到代理组。

## 功能

| 功能 | 说明 |
|------|------|
| **三模式切换** | 系统代理 → 直连 → Clash 代理，一键切换，图标颜色实时变化 |
| **F1: 规则匹配检测** | 检测当前域名匹配的 Clash 规则，显示匹配的分组和策略（支持 RULE-SET 回退到 `/connections` API 查询） |
| **F2: 快捷添加规则** | 将当前域名添加到代理组（动态获取 Clash 代理组列表） |
| **F3: 智能域名分组** | 检测页面所有域名，自动分组建议（如 `i1.art.com`, `i2.art.com` → `*.art.com`） |
| **系统代理状态** | 实时显示 Windows 系统代理状态（通过 Native Host 读取注册表） |
| **规则管理** | 查看、添加、删除 Clash YAML 配置文件中的规则（增删后自动热重载） |
| **同步规则到内核** | 一键将 profile 规则同步到 Clash Verge Rev 快照文件并重启内核 |
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

底部的「同步规则到内核」按钮是更彻底的方式：将 profile 规则写入 Clash Verge Rev 快照文件（`clash-verge.yaml`）并重启内核，仅在热重载失效时使用。

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
