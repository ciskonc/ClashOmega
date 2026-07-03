# 更新日志

本文件记录 ClashOmega 各版本变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

---

## v1.4.1 — 2026-07-04

新增 Clash 远程管理模块 + mihomo 崩溃防护。

### Added

- 主页新增「Clash 远程管理」模块：三按钮切换 Clash 内核 mode（规则/全局/直连），通过 `PATCH /configs` 实时生效
- 默认隐藏，需在「设置 → 连接配置」中启用
- LAYOUT_VERSION 升级至 4，新模块自动加入默认布局
- zh_CN / en / ja 三语言新增 9 个翻译键

### Changed

- 「代理模式切换」改名「浏览器代理模式切换」，与 Clash 内核 mode 切换职责分层
- 切换 mode 后自动关闭所有活跃连接（`DELETE /connections`），避免 keep-alive 复用旧连接导致切换看似无效

### Fixed

- **mihomo fatal 退出**：重启 Clash 时规则引用不存在的代理组导致启动失败。新增 `validateRulesAgainstGroups` 在写入快照前丢弃无效规则
- **mihomo 已死时插件死循环失败**：新增 `isMihomoAlive` 预检，已死时返回明确提示让用户去 Clash Verge Rev GUI 重启
- **「全局」按钮切了不生效**：订阅开头插入「剩余流量：xxx GB」伪节点（server 字段为空），mihomo 隐式 GLOBAL 组选中伪节点导致流量走伪节点。新增伪节点过滤 + 优先指向「节点选择」组
- **保存设置后主页不显示模块**：`buildTabLayout` 重建布局后立即重新应用 visibility
- **重启 Clash 后按钮不跳回「规则」**：`initPopup` 加载 settings 后主动刷新模块显隐 + 按钮选中态

---

## v1.4.0 — 2026-07-04

设置页新增控制台面板选择器。

### Added

- 「高级」子标签页新增 4 选 1 控制台面板：metacubexd（默认）/ Yacd Meta / Zashboard / 自定义
- 统一占位符机制：`%host` / `%port` / `%secret` 在运行时被 Clash API 实际值替换
- 自定义为空时回退到 metacubexd，避免打开空白页
- zh_CN / en / ja 三语言完整翻译

---

## v1.3.9 — 2026-07-04

新增控制台按钮 + 路径污染修复。

### Added

- 顶部操作栏新增「控制台」按钮：仅在 Clash 连接成功时显示，点击在新标签页打开 metacubexd 网页面板，自动填入 host/port/secret
- 新增 `install.bat` 双击安装封装，绕过 PowerShell 执行策略

### Fixed

- `com.clash.omega.json` 路径污染：本机绝对路径被错误写入仓库，恢复为 `REPLACED_BY_INSTALL_PS1` 占位符
- `.status-row` 换行问题：新增 `white-space: nowrap`
- popup 宽度 440px → 470px，容纳新增按钮

---

## v1.3.8 — 2026-06-28

设置页新增版本号显示与 GitHub 更新检测。

### Added

- 设置页「关于 ClashOmega」旁显示当前版本号
- GitHub Releases API 异步检测新版本：有新版时版本号变红 + 提示链接，已是最新时变绿
- 24 小时缓存避免触发 GitHub API 限速（60 次/小时/IP）
- 网络失败时静默降级，不影响 popup 主功能

---

## v1.3.7 — 2026-06-27

修复保存设置后状态不刷新 + 固定扩展 ID。

### Fixed

- 保存设置后 UI 不刷新：新增 `refreshPopupStatus()` 显式刷新所有状态指示器
- `initPopup()` 无参数调用崩溃
- 回退探测被会话缓存污染：探测排除项改用 `settings.clashApiUrl`
- 保存设置后重复调用 `getStatus` 导致状态错乱

### Changed

- 通过 `manifest.json` 的 `key` 字段固定扩展 ID 为 `llfbhodadhnfobbbkipelhknkjdflggm`
- `install.ps1` 默认 ExtId 设为固定 ID，用户直接回车即可安装

---

## v1.3.6 — 2026-06-26

端口不匹配状态指示器优化。

### Changed

- 端口不匹配状态从红色改为橙色，区分「配置有误但 Clash 可用」与「Clash 完全不可达」
- 新增「更正 / 忽略」双按钮：更正将 API 地址更新为探测到的实际端口，忽略本次会话不再提示
- 忽略标志存于 `chrome.storage.session`，浏览器关闭后自动失效

---

## v1.3.5 — 2026-06-26

弹窗加载性能优化 + 关键 bug 修复。

### Fixed

- `ReferenceError: statusPromise is not defined`：跨作用域访问导致弹窗初始化崩溃

### Changed

- 弹窗并行渐进式渲染：`settings` 与 `getStatus` 并行发起，先到先渲染，避免串行等待网络请求
- `initPopup` 参数化，避免内部重复 `getTabLayout()` 和 `storage.get()`

---

## v1.3.4 — 2026-06-26

命名语义重构 + 端口探测优化 + 保存反馈改进。

### Changed

- 14 项命名重构：`clashProxyHost` → `clashApiHost`、`useScriptRule` → `writeToYaml` 等，消除语义混淆
- 端口回退探测改用 `Promise.any` 并行竞速 5 个候选端口，最快响应立即返回
- 单端口探测超时 3s → 1s
- 会话级 URL 缓存避免重复探测
- 新增 `disableFallback` 开关：勾选后仅用配置端口，弹窗加载更快
- 保存配置两阶段反馈：半秒内快速检测 + 回退探测找到可用端口后弹「修正」按钮

### Fixed

- `getStatus` 返回 `clashApiUrl` 字段缺失
- `getSettings` 自动检测旧字段名并迁移
- `tabDomains` 每 tab 上限 500 条，防止内存泄漏

### Removed

- 删除 `hotReloadConfig` / `clashPut` / `reloadClashConfig` / `checkClashStatus` 等死代码

---

## v1.3.3 — 2026-06-24

### Added

- 彩色图标：黑/白/黄/红四色，按代理模式自动切换（黑=默认、白=直连、黄=系统代理、红=Clash代理）
- 扩展页面 Logo：chrome://extensions/ 显示黑色 Logo
- `manifest.icons` 字段独立于 `action.default_icon`

---

## v1.3.0 — 2026-06-22

Fork 后首次重大更新：安全加固、UI 重构、Bug 修复。

### Added

- 四标签页布局系统：代理 / 规则 / 域名 / 设置，支持拖拽排序 + 持久化
- 多主题系统：MD3 亮色 / MD3 暗色 / 自动跟随系统
- 设置页子标签页：连接 / 外观 / 布局 / 高级
- 全局字号缩放（70%-130%）
- 规则分页与显示模式（紧凑/标准/舒展，每页 10/20/50/100 条）
- CSP 内容安全策略
- `chrome.proxy.settings.get()` 系统代理检测兜底

### Changed

- 重构单页弹窗为模块化架构（`#modules-pool` + JS 动态分配）
- 13 项安全漏洞修复（XSS / 路径遍历 / 进程注入 / YAML 注入等）
- `install.ps1` 添加 UTF-8 BOM 修复中文乱码

### Fixed

- 搜索框失效：Native Host 失败分支未设置 `window._scriptRulesWithSource`
- `com.clash.omega.json` Native Host 未找到时报错：新增 `sendToNativeSafe` wrapper
- 额外脚本规则域名被挤压：`flex-wrap` + `word-break`
- `en.json` 尾逗号导致英文语言包无法加载

---

## v1.2.2 及更早版本

略。
