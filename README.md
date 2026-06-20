# Chrome Clash Manager

Chrome 浏览器扩展，用于管理 Clash 代理规则，支持三模式代理切换、域名规则匹配检测、一键添加域名到代理组。

## 功能

| 功能 | 说明 |
|------|------|
| **三模式切换** | 系统代理 → 直连 → Clash 代理，一键切换，图标颜色实时变化 |
| **F1: 规则匹配检测** | 检测当前域名匹配的 Clash 规则，显示匹配的分组和策略 |
| **F2: 快捷添加规则** | 将当前域名添加到代理组（动态获取 Clash 代理组列表） |
| **F3: 智能域名分组** | 检测页面所有域名，自动分组建议（如 `i1.art.com`, `i2.art.com` → `*.art.com`） |
| **系统代理状态** | 实时显示 Windows 系统代理状态（通过 Native Host 读取注册表） |
| **规则管理** | 查看、添加、删除 Clash YAML 配置文件中的规则 |
| **多语言** | 简体中文 / English / 日本語 |
| **Material Design 3** | Google MD3 设计风格 |

## 安装

### 1. 加载扩展

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/` 目录

### 2. 安装 Native Messaging Host

Native Host 用于读写 Clash 本地 YAML 配置文件。

1. 在 `chrome://extensions/` 中找到 Clash Manager 扩展，复制其 **ID**
2. 右键 `native-host/install.ps1` → **使用 PowerShell 运行**
3. 粘贴扩展 ID，回车完成安装
4. 刷新扩展

## 技术栈

- **前端**: Chrome Extension Manifest V3 + Vanilla JS + CSS3 (MD3)
- **后端**: Native Messaging Host (PowerShell)
- **通信**: `chrome.runtime.sendMessage` + `chrome.runtime.sendNativeMessage`
- **API**: Clash REST API (`GET /configs`, `/rules`, `/proxies`)

## 项目结构

```
extension/          # Chrome 扩展
├── manifest.json   # MV3 清单
├── background.js   # Service Worker
├── lib/            # 模块（proxy, clash-api, native-bridge, domain-detector）
├── popup/          # 弹窗 UI
├── locales/        # 多语言文件
└── icons/          # 模式图标

native-host/        # Native Messaging Host
├── install.ps1     # 安装脚本
├── clash_rules_manager.bat   # 启动入口
└── clash_rules_manager.ps1   # 主程序（YAML 读写 + 系统代理查询）
```