# 更新日志

---

## v1.3.9 (2026-07-04)

**顶部操作栏新增「控制台」按钮，一键打开 metacubexd 网页面板。**

---

### 一、新功能

- **顶部操作栏新增「控制台」按钮**：位于「重启 Clash」左侧
  - 仅在 Clash 连接成功后显示（`clashRunning=true` 时 `display:''`，否则 `display:none'`），避免无意义的跳转
  - 点击后在新标签页打开 metacubexd 网页面板：`https://metacubex.github.io/metacubexd/#/setup?http=true&hostname={host}&port={port}&secret={secret}`
  - 自动从 `settings.clashApiUrl` 解析 hostname/port，从 `settings.clashSecret` 取 secret
  - URL 解析失败时回退到默认值 `127.0.0.1:9090`，保证不抛异常
  - URL 字段全部 `encodeURIComponent` 编码，防止 secret 中特殊字符破坏 URL

### 二、Bug 修复

- **`native-host/com.clash.omega.json` 路径污染修复**：发现本机绝对路径被错误写入仓库（应为 `REPLACED_BY_INSTALL_PS1` 占位符），已恢复。install.ps1 在安装时仍会自动替换为实际路径
- **顶部状态行换行问题**：`.status-row` 增加 `white-space: nowrap`，防止 Clash 状态文本过长时折行
- **popup 宽度调整**：440px → 470px，容纳新增的「控制台」按钮，避免按钮挤压

### 三、文件变更清单

| 文件 | 变更 |
|------|------|
| `extension/popup/popup.html` | 顶部操作栏新增 `#web-dashboard-btn` 按钮（默认隐藏） |
| `extension/popup/popup.css` | `--popup-width` 440→470；`.status-row` 增加 `nowrap` |
| `extension/popup/popup.js` | 新增 `openWebDashboard()` 函数；`renderClashStatus()` 中根据 `running` 切换按钮显隐；DOMContentLoaded 绑定点击事件 |
| `extension/locales/zh_CN.json` | 新增 `web_dashboard`: "控制台" |
| `extension/locales/en.json` | 新增 `web_dashboard`: "Console" |
| `extension/locales/ja.json` | 新增 `web_dashboard`: "コンソール" |
| `native-host/com.clash.omega.json` | 恢复 `REPLACED_BY_INSTALL_PS1` 占位符（修复路径污染） |
| `native-host/install.bat` | 新增 BAT 安装封装（双击运行，绕过 PowerShell 执行策略） |
| `extension/manifest.json` | 版本号 1.3.8 → 1.3.9 |
| `README.md` / `README_EN.md` | 版本徽章 1.3.8 → 1.3.9 |
| `docs/index.html` | hero_badge 版本号 1.3.8 → 1.3.9（中/英） |
| `.gitignore` | 新增排除 `icons_preview/` 和 `tools/`（本地开发资源） |

### 四、关键决策

- **默认隐藏而非禁用**：未连接 Clash 时直接 `display:none` 而非 `disabled`，因为按钮在没有 Clash 时毫无意义，禁用反而让用户疑惑"为什么点不了"
- **新标签页打开而非 iframe**：metacubexd 是 PWA 应用且使用 hash 路由，嵌套 iframe 会触发 X-Frame-Options 拦截；新标签页是唯一可行方案
- **secret 走 URL 参数**：metacubexd 的 `#/setup` hash 接受 `secret` 查询参数，自动填入登录框并连接，无需用户手动复制
- **不读取 session 缓存的 fallbackApiUrl**：控制台只用用户配置的 URL（`settings.clashApiUrl`），因为 fallback 端口可能未在 metacubexd 中开放 CORS，且用户期望"我配置什么 URL，控制台就连什么 URL"

---

## v1.3.8 (2026-06-28)

**设置页新增版本号显示与 GitHub 更新检测。**

---

### 一、新功能

- **设置页"关于 ClashOmega"旁显示当前版本号**：从 `chrome.runtime.getManifest().version` 读取，无需网络请求即可立即显示
- **GitHub 更新检测**：异步请求 `https://api.github.com/repos/ciskonc/ClashOmega/releases/latest`，与当前版本比较
  - 有新版本：版本号变红色，显示「有新版本可用 vX.X.X」提示链接（点击跳转 releases/latest）
  - 已是最新：版本号变绿色，鼠标悬停提示「已是最新版本」
  - 网络失败/限速：静默降级为仅显示当前版本号，不影响主流程
- **语义化版本比较**：剥离 `v` 前缀，按 `major.minor.patch` 数字比较
- **24 小时缓存**：`chrome.storage.local._versionCheckCache`，避免每次打开 popup 都请求 GitHub API（未授权限速 60 次/小时/IP）
- **非阻塞调用**：`checkVersionUpdate()` 在 DOMContentLoaded 末尾调用，不 `await`，版本检测失败不影响 popup 主功能渲染

### 二、文件变更清单

| 文件 | 变更 |
|------|------|
| `extension/popup/popup.html` | `.settings-about` 扩展为两行结构：上行「关于链接 + 版本号」，下行「更新提示」（默认隐藏） |
| `extension/popup/popup.css` | 新增 `.settings-about-row` / `.version-info`（三态色：loading/latest/error）/ `.update-hint`（MD3 primary-container 背景 + hover 反色）样式，玻璃拟态主题适配 |
| `extension/popup/popup.js` | 新增 `checkVersionUpdate()` + `compareSemver()` 函数；DOMContentLoaded 末尾非阻塞调用 |
| `extension/locales/zh_CN.json` | 新增 `version_loading` / `version_update_available` / `version_latest` |
| `extension/locales/en.json` | 同上 |
| `extension/locales/ja.json` | 同上 |

### 三、关键决策

- **选择 GitHub Releases API 而非 tags API**：Releases API 返回最新发布版本（过滤预发布），tags API 返回最新标签（可能含开发标签）
- **24 小时缓存而非不缓存**：GitHub 未授权 API 限速 60 次/小时/IP，缓存避免频繁打开 popup 触发限速
- **降级策略**：网络失败时若有旧缓存（已过期）仍尝试比较，无旧缓存则仅显示当前版本号
- **CSP 检查**：manifest.json CSP 不限制 `connect-src`，`host_permissions: *://*/*` 已覆盖 GitHub API，无需修改 CSP

---

## v1.3.7 (2026-06-27)

**修复保存设置后状态指示器不刷新 + 固定扩展 ID。**

---

### 一、Bug 修复

- **保存设置后 UI 不刷新**：新增 `refreshPopupStatus()` 函数，保存设置后显式刷新模式切换按钮、Clash 状态点、系统代理状态、clash 按钮 disabled 状态、设置页 Clash API 状态指示器
- **`initPopup()` 无参数调用崩溃**：支持无参数调用，内部默认获取 layout 和 settings
- **回退探测被会话缓存污染**：`getStatus` 和 `setMode` 的回退探测排除项从 `getApiConfig().baseUrl`（可能被缓存污染）改为 `settings.clashApiUrl`（用户配置端口），避免可用端口被错误排除
- **保存设置后重复调用 getStatus 导致状态错乱**：用 `latestStatus` 变量贯穿整个保存流程，回退分支复用 `statusResult`，不再重复调用 getStatus（回退探测写入缓存后再次调用会失败）

### 二、扩展 ID 固定

- 通过 `manifest.json` 的 `key` 字段固定扩展 ID 为 `llfbhodadhnfobbbkipelhknkjdflggm`
- `native-host/com.clash.omega.json` 的 `allowed_origins` 写死固定 ID
- `install.ps1` 默认 ExtId 设为固定 ID，用户直接回车即可安装，无需手动查找扩展 ID

---

## v1.3.6 (2026-06-26)

**端口不匹配状态指示器优化：橙色警告 + 更正/忽略双按钮。**

---

### 一、视觉优化

- 端口不匹配状态从**红色**改为**橙色**（`--warn` 样式），区分「配置有误但 Clash 可用」与「Clash 完全不可达」两种情况
- 新增 `.native-host-status--warn` CSS 类（橙色 15% 背景 + 50% 边框 + 橙色状态点）

### 二、双按钮交互

| 按钮 | 行为 |
|------|------|
| **更正为 XXX 端口** | 将 API 地址更新为回退探测到的实际端口，清除忽略标志，重新检测状态 |
| **忽略** | 本次会话内不再提示端口不匹配警告，状态指示器变为绿色「已连接」 |

### 三、忽略逻辑（`chrome.storage.session` 持久化）

| 事件 | 行为 |
|------|------|
| 点击「忽略」 | `session.set({ clashApiMismatchIgnored: true })`，状态变绿色 |
| 后续打开弹窗 | 检测到忽略标志 → 显示绿色，不显示橙色警告 |
| 点击「更正」 | 更正配置 + 清除忽略标志 + 重新检测 |
| **保存设置** | 清除忽略标志（`session.remove`），下次重新检测端口匹配 |
| 浏览器关闭 | session 自动清除，下次启动重新检测 |

### 四、i18n 更新

- 「修正」→「更正」（zh）/ Correct（en）/ 訂正（ja）
- 新增 `settings_ignore_mismatch`：忽略 / Ignore / 無視

### 五、文件变更清单

| 文件 | 变更类型 |
|------|----------|
| `extension/popup/popup.css` | 新增 `--warn` 橙色样式 + `.clash-api-ignore-btn` 忽略按钮样式 + `.clash-api-actions` 按钮容器 |
| `extension/popup/popup.js` | `renderClashApiStatus` 重写：橙色状态 + 双按钮 + 忽略逻辑 + 保存时清除忽略标志 |
| `extension/locales/zh_CN.json` | 更正/忽略 i18n key |
| `extension/locales/en.json` | Correct/Ignore i18n key |
| `extension/locales/ja.json` | 訂正/無視 i18n key |

---

## v1.3.5 (2026-06-26)

**弹窗加载性能优化 + 关键 bug 修复。**

---

### 一、Bug 修复

- **修复 `ReferenceError: statusPromise is not defined`**：`DOMContentLoaded` 中引用了 `initPopup()` 内部定义的 `statusPromise` 变量，跨作用域访问导致弹窗初始化崩溃（保存配置后弹窗消失）。修复方式：将 `statusPromise` 提升到 `DOMContentLoaded` 作用域，通过参数传递给 `initPopup`

### 二、弹窗并行渐进式渲染

**优化前**（串行等待 7 步）：
```
theme → i18n → zoom → layout → getStatus(网络) → [initPopup内部] tabs.query → getTabLayout(重复!) → storage.get → renderModeSwitch
```

**优化后**（并行竞速 + 先到先渲染）：
```
theme → i18n → zoom → layout → ┬─ settingsPromise(.then → renderModeSwitch)     ← 本地存储，几乎瞬时
                               └─ statusPromise(.then → renderClashStatus + renderSystemProxyStatus)  ← 网络，稍慢
                               ↓
                               await statusPromise → loadSettingsForm
                               → initPopup(layout, settingsPromise)  ← 不再重复 getTabLayout/storage.get
```

| 改动点 | 说明 |
|--------|------|
| `settings` 与 `getStatus` 并行发起 | `chrome.storage.local.get('settings')`（本地，毫秒级）和 `sendToBackground({action:'getStatus'})`（网络，百毫秒~秒级）同时启动 |
| 各自 `.then()` 独立渲染 | `settings` 先到 → 模式按钮立即高亮；`getStatus` 随后到 → Clash 状态点 + 系统代理状态点亮起 |
| `initPopup` 参数化 | `layout` 和 `settingsPromise` 由外部传入，避免内部重复 `getTabLayout()` 和 `chrome.storage.local.get('settings')` |
| 移除 `initPopup` 内重复状态渲染 | Clash 状态和系统代理状态已在 `DOMContentLoaded` 的 `.then()` 中处理，`initPopup` 内不再重复 |
| 代码注释 | 5 个关键位置补充详细中文注释（思路、为何并行、渐进式渲染效果说明） |

### 三、文件变更清单

| 文件 | 变更类型 |
|------|----------|
| `extension/popup/popup.js` | 修复 `statusPromise` 作用域 bug + 并行渐进式渲染重构 + 详细注释 |

---

## v1.3.4 (2026-06-26)

**本次版本聚焦代码质量与用户体验：命名语义重构、端口探测优化、保存反馈改进。**

---

### 一、命名语义重构（14 项）

消除 `clashProxyHost`/`clashProxyPort` 与 API 控制地址的语义混淆，统一命名规范。

| 编号 | 变更 | 说明 |
|------|------|------|
| R-001 | `clashProxyHost` → `clashApiHost` | 存储 Clash API 监听 host，非代理 host |
| R-002 | `clashProxyPort` → `clashApiPort` | 存储 Clash API 端口，非代理端口（7890） |
| R-003 | `extractProxyPort` → `extractProxyAddress` | 返回 `{host, port}` 更准确描述功能 |
| R-004 | `useScriptRule` → `writeToYaml` | 语义反转修复：true=写YAML，false=写JS（原 `useScriptRule` 名暗示"使用脚本"但 true 实际写YAML） |
| R-005 | `settings-proxy-host` → `settings-api-host` | HTML 元素 ID 同步重命名 |
| R-006 | `settings-proxy-port` → `settings-api-port` | HTML 元素 ID 同步重命名 |
| R-007 | `settings-use-script-rule` → `settings-write-to-yaml` | checkbox ID 同步重命名 |
| R-008 | `settings_proxy_host` → `settings_api_host` | i18n key 同步重命名 |
| R-009 | `settings_proxy_port` → 删除 | 不再需要独立的代理端口设置项 |
| R-010 | `settings_use_script_rule` → `settings_write_to_yaml` | i18n key 同步重命名 |
| R-011 | `firstSeen` → `firstUrl` | 存储完整 URL 非时间戳，原名误导 |
| R-012 | `clashProxy` 参数初始化为 `null` | 不再用 clashApiPort 作为代理端口初值 |
| R-013 | `extractProxyPort` 调用 → `extractProxyAddress` | 3 处调用点更新 |
| R-014 | `settings2` → `settings` | 修复未定义变量 bug（popup.js 2046 行） |

### 二、端口回退探测优化

- **并行竞速探测**：`tryFetchParallel` 使用 `Promise.any` 同时探测 5 个候选端口（9090/9097/9098/9091/8080），最快响应立即返回，不再逐个串行等待 3s 超时
- **超时缩短**：单端口探测超时从 3s 缩短到 1s（localhost 足够）
- **会话级 URL 缓存**：`chrome.storage.session` 缓存回退探测到的实际可用 URL，避免后续操作重复尝试错误端口；浏览器关闭后自动失效
- **`noFallback` 模式**：`getStatus` 状态检测时传 `noFallback: true`，仅查询用户配置 URL，不触发回退探测；`clashConfiguredUrlReachable` 准确反映用户配置 URL 是否可达
- **`disableFallback` 开关**：用户可在设置中勾选"关闭端口错误自动探测"，勾选后仅用配置端口，弹窗加载更快
- **回退 host 从配置读取**：4 处回退探测从硬编码 `127.0.0.1` 改为 `settings.clashApiHost`

### 三、保存配置两阶段反馈

保存配置后即时反馈 Clash 连接状态：

1. **阶段1（半秒内）**：快速检测用户配置 URL → 弹 toast "已连接" 或 "连接失败"
2. **阶段2（回退探测）**：未勾选 `disableFallback` 时自动探测其他端口，找到后弹 "已通过 xxx 端口替代" + "修正为 xxx 端口" 按钮
3. **修正按钮**：点击后自动将 API 地址更新为检测到的实际端口，无需手动修改

### 四、性能优化

- **避免重复 `getStatus`**：弹窗初始化时 `statusPromise` 被 await 后再传给 `loadSettingsForm(status)`，从 2 次调用减为 1 次
- **`disableFallback` 跳过回退**：勾选后 `getStatus` 不执行回退探测，弹窗加载更快
- **模式切换按钮禁用态**：`btn.disabled` 检查，防止重复点击

### 五、死代码清理

| 删除项 | 位置 | 原因 |
|--------|------|------|
| `hotReloadConfig` | `clash-api.js` | 无调用方 |
| `clashPut` | `clash-api.js` | 无调用方 |
| `reloadClashConfig` | `clash-api.js` | 无调用方 |
| `checkClashStatus` | `clash-api.js` | 无调用方 |

### 六、Bug 修复

- **`getStatus` 返回 `clashApiUrl`**：修复 `renderClashApiStatus` 中 `result.clashApiUrl` 永远为 undefined 的问题
- **`clashPost` 注释修正**："自动保存" → "不覆盖用户设置"
- **`tryFetchParallel` 注释修正**："自动 abort" → "继续在后台运行至超时"
- **`tryPost` 返回类型统一**：catch 返回 `false` 替代 `null`，`clashPost` 简化判断为 `if (await tryPost(...))`
- **`getSettings` 默认值补充**：新增 `disableFallback: false`
- **数据迁移**：`getSettings` 中自动检测旧字段名（`clashProxyHost`/`clashProxyPort`/`useScriptRule`）并迁移，统一 `migrated` 标志位
- **`tabDomains` 上限**：每 tab 域名收集上限 500 条，防止长时间浏览内存泄漏

### 七、UI 文本修正

- "代理地址" → "Clash 外部控制地址"（设置页连接配置标签）
- "域名写入订阅文件Yaml" → "写入 YAML 配置文件"
- 新增 `clash-api-status` 状态指示器（显示 Clash API 连接状态 + 修正按钮）

### 八、文件变更清单

| 文件 | 变更类型 |
|------|----------|
| `extension/background.js` | 重构：noFallback 模式、并行回退探测、会话缓存、命名修正、默认值更新 |
| `extension/lib/clash-api.js` | 重构：会话缓存 `getApiConfig`、并行探测 `tryFetchParallel`、超时 1s、死代码清理、注释修正 |
| `extension/lib/proxy-manager.js` | 重构：`extractProxyAddress` 重命名、`getSettings` 数据迁移、默认值补充 |
| `extension/lib/domain-detector.js` | 改进：`firstSeen` → `firstUrl`、`MAX_DOMAINS_PER_TAB = 500` 上限 |
| `extension/popup/popup.html` | 改进：元素 ID 重命名、clash-api-status 状态指示器、disableFallback checkbox |
| `extension/popup/popup.css` | 新增：disabled 按钮样式、clash-api-fix-btn 修正按钮样式 |
| `extension/popup/popup.js` | 重构：命名修正、两阶段保存反馈、修正按钮、disableFallback 逻辑、性能优化 |
| `extension/locales/zh_CN.json` | i18n key 重命名 + 新增 10+ key |
| `extension/locales/en.json` | i18n key 重命名 + 新增 10+ key |
| `extension/locales/ja.json` | i18n key 重命名 + 新增 10+ key |

---

## v1.3.3 (2026-06-24)

- **彩色图标**：新增黑/白/黄/红四色图标，按代理模式自动切换（黑=默认、白=直连、黄=系统代理、红=Clash代理）
- **扩展页面 Logo**：chrome://extensions/ 页面显示繁化版黑色 Logo（与右上角切换图标区分）
- **manifest.icons**：新增 `icons` 字段，独立于 `action.default_icon`

---

## v1.3.0 (2026-06-22)

**本次版本为 Fork 后首次重大更新，涵盖三大领域：安全加固、UI 重构、Bug 修复。**

---

### 一、新增功能

#### 1.1 四标签页布局系统

重构原单页弹窗为四个标签页：

| 标签页 | 模块 |
|--------|------|
| 代理 | 代理模式切换 + 系统代理状态 + 域名匹配检测 |
| 规则 | 内置 Clash 规则 + 额外脚本规则 |
| 域名 | 域名分组检测 + 快捷添加规则 |
| 设置 | 连接配置 + 外观 + 布局编辑 + 高级 |

- **模块化架构**：`#modules-pool` 隐藏池 + JS 动态分配到各标签页
- **拖拽排序**：HTML5 Drag and Drop API 实现标签页排序 + 模块跨标签页移动
- **布局持久化**：`chrome.storage.local` 存储用户自定义布局
- **布局版本机制**：`LAYOUT_VERSION` 实现旧版布局自动重置

#### 1.2 多主题系统

新增 2 套主题 + 自动跟随系统模式：

- **MD3 亮色**（Material Design 3 浅色）
- **MD3 暗色**（Material Design 3 深色）
- **自动跟随系统**（`prefers-color-scheme` 媒体查询）

实现方式：`data-theme` 属性切换 CSS 变量，不影响功能逻辑。

#### 1.3 设置页子标签页系统

将设置页拆分为 4 个子标签页：

| 子标签页 | 内容 |
|----------|------|
| 连接 | API 地址 / 密钥 / 代理主机端口 / 配置文件路径 / 扩展脚本规则开关 |
| 外观 | 主题选择 / 语言选择 / 字号缩放 |
| 布局 | 标签页编辑器（拖拽排序 + 模块迁移） |
| 高级 | 规则显示模式 / 每页规则数 |

- 每个子标签页有独立保存按钮（保存全部设置，保存后保持当前子标签页）
- 设置模块锁定（🔒 图标），不允许拖拽迁移到其他标签页

#### 1.4 全局字号缩放

新增 `--zoom-scale` + `--base-font-size` + `calc()` 实现全局字号缩放（70%-130%，步长 5%），实时预览。

#### 1.5 规则分页与显示模式

- 规则显示模式：紧凑 / 标准 / 舒展
- 每页规则数可配置（10/20/50/100）
- 搜索防抖（200ms debounce）

---

### 二、安全漏洞修复（13 项）

| 编号 | 严重程度 | 问题 | 修复方式 |
|------|----------|------|----------|
| S-001 | 高危 | `innerHTML` XSS 注入（popup.js 多处） | 所有 `innerHTML` 替换为 DOM API + `escapeHtml` / `el()` 辅助函数 |
| S-002 | 高危 | Native Host 路径遍历（`setConfigPath`） | 新增 `Test-ConfigPathAllowed` 函数，校验路径在 `APPDATA` / `LOCALAPPDATA` / `USERPROFILE\.config` 范围内 |
| S-003 | 高危 | PowerShell 进程注入风险（`Get-CimInstance`） | 改用精确进程名白名单（`clash.exe` / `mihomo.exe` 等），校验提取路径在允许范围内 |
| S-004 | 中危 | `host_permissions` 过宽 | 保留 `*://*/*`（`domain-detector.js` webRequest 功能必需），通过 CSP 缓解 |
| S-005 | 中危 | API 密钥明文存储 | `chrome.storage.local` 是 Chrome 扩展标准存储，添加安全说明注释，风险降级 |
| S-006 | 中危 | `install.ps1` 多余 UAC 提权 | 移除 UAC 自动提权代码（HKCU 注册表写入无需管理员权限） |
| S-007 | 中危 | YAML 正则解析不可靠 | 添加防护注释说明限制，由于零依赖原则不引入 YAML 模块，风险降级 |
| S-008 | 中危 | 规则字符串未校验 | 新增 `Test-RuleFormat` 函数，校验规则类型白名单、长度、换行符、YAML 注入序列 |
| S-009 | 低危 | 版本号不一致 | manifest 版本升级到 1.3.0 |
| S-010 | 低危 | 旧 JSON 残留（`com.clash.manager.json`） | 删除旧文件 |
| S-011 | 低危 | CSP 缺失 | 新增 `content_security_policy.extension_pages` |
| S-012 | 低危 | 错误信息泄露行号 | 移除 `$_.InvocationInfo.ScriptLineNumber` |
| S-013 | 低危 | 无写入后验证回滚 | 写入后读回验证长度，失败时从备份回滚 |

---

### 三、Bug 修复

#### 3.1 搜索框失效（严重）

- **现象**：额外脚本规则搜索框输入任意内容，下方列表无变化
- **修复**：在 Native Host 失败分支也设置 `window._scriptRulesWithSource = merged`，确保搜索回调正常触发

#### 3.2 系统代理检测在部分 Chromium 内核浏览器中失效（严重）

- **现象**：部分 Chromium 内核浏览器中插件虽可通过 Clash 代理模式检测，但始终显示无法读取系统代理
- **修复**：`getSystemProxyStatus` 添加 `chrome.proxy.settings.get()` 作为兜底方案，支持 5 种代理模式：
  - `direct` → 直连
  - `auto_detect` → WPAD 自动检测
  - `pac_script` → PAC 脚本
  - `fixed_servers` → 固定代理服务器
  - `system` → 跟随系统
- **状态点颜色修正**：代理开启时从 `--off`（红色）改为 `--warn`（黄色），更准确反映状态

#### 3.3 扩展程序页面报错（严重）

- **现象**：扩展程序页面显示 `Handle message error (getScriptRules): Error: Specified native messaging host not found.`
- **修复**：创建 `sendToNativeSafe` wrapper 函数，catch 异常返回 `{ success: false, error }` 而非抛出；所有 Native Host 调用改为使用安全版本

#### 3.4 额外脚本规则域名被挤压（中等）

- **现象**：额外脚本规则列表中域名被两侧元素挤压，无法完整显示
- **修复**：
  - `.rule-item` 添加 `flex-wrap: wrap` 允许换行
  - `#script-rule-list .rule-item .rule-payload` 设置 `flex: 1 1 100%` 独占一行
  - 添加 `word-break: break-all` + `overflow-wrap: break-word` 确保长域名换行

#### 3.5 域名检测当前域名布局（轻微）

- **现象**：当前域名与标签文字挤在同一行，长域名被截断
- **修复**：`#current-domain` 从内联 `span` 改为 `block` `div`，独占一行完整显示

#### 3.6 install.ps1 编码问题（严重）

- **现象**：`install.ps1` 无法运行，中文乱码破坏语法
- **修复**：添加 UTF-8 BOM（`EF BB BF`）

#### 3.7 en.json 尾逗号（严重）

- **现象**：英文语言包完全无法加载
- **修复**：移除 `en.json` 第 158 行多余尾逗号

---

### 四、UI/UX 改进

#### 4.1 主题对比度优化

- 优化主题背景与文字对比度，确保可读性

#### 4.2 设置模块锁定

- 设置模块在布局编辑器中显示 🔒 图标
- 不设置 `draggable` 属性，无法被拖拽迁移到其他标签页
- 添加 `.locked` 样式（`opacity: 0.7` + `cursor: not-allowed`）

#### 4.3 子标签页样式

- 新增 `.settings-sub-tab-bar` / `.settings-sub-tab` / `.settings-sub-tab-content` 样式
- 主题适配（亮色 + 暗色）
- active 状态使用 primary 色下边框

---

### 五、国际化（i18n）

三语言文件（`zh_CN.json` / `en.json` / `ja.json`）新增 30+ key：

**标签页系统：**
- `tab_proxy` / `tab_rules` / `tab_domain` / `tab_settings`

**代理模式：**
- `mode_system` / `mode_direct` / `mode_clash`

**主题系统：**
- `theme_light` / `theme_dark` / `theme_glass` / `theme_auto`
- `theme_glass_variant_light` / `theme_glass_variant_dark` / `theme_glass_variant_auto`

**设置子标签页：**
- `settings_sub_tab_connection` / `settings_sub_tab_appearance` / `settings_sub_tab_layout` / `settings_sub_tab_advanced`

**系统代理状态：**
- `system_proxy_follow_system` / `system_proxy_direct` / `system_proxy_proxy` / `system_proxy_pac` / `system_proxy_unknown`

**布局编辑器：**
- `settings_module_drag_hint` / `settings_module_locked`
- `layout_reset` / `layout_reset_confirm`

**其他：**
- `zoom_scale` / `rule_display_mode` / `rule_page_size`
- `search_rules_placeholder` / `search_no_result`

---

### 六、文件变更清单

#### 修改文件

| 文件 | 变更类型 |
|------|----------|
| `extension/manifest.json` | 版本升级 1.2.5 → 1.3.0；新增 CSP；新增 `proxy` 权限 |
| `extension/background.js` | `setConfigPath` / `ping` 改用 `sendToNativeSafe` |
| `extension/lib/native-bridge.js` | 新增 `sendToNativeSafe` wrapper；`getSystemProxyStatus` 添加 `chrome.proxy.settings.get()` 兜底；所有 Native Host 调用改为安全版本 |
| `extension/lib/clash-api.js` | 添加 S-005 安全说明注释 |
| `extension/lib/proxy-manager.js` | 代理模式切换封装 |
| `extension/lib/domain-detector.js` | 域名检测逻辑 |
| `extension/popup/popup.html` | 四标签页重构；设置页子标签页结构；域名检测当前域名布局修改 |
| `extension/popup/popup.css` | 多主题系统；子标签页样式；主题对比度优化；锁定模块样式；域名显示修复（flex-wrap）；规则分页样式 |
| `extension/popup/popup.js` | XSS 修复（S-001）；标签页系统；拖拽排序；主题切换；缩放；子标签页切换逻辑；保存按钮绑定；设置模块锁定；搜索框失效修复；系统代理状态渲染更新（支持 `browserMode`） |
| `extension/locales/zh_CN.json` | 新增 30+ i18n key |
| `extension/locales/en.json` | 新增 30+ i18n key；修复尾逗号 |
| `extension/locales/ja.json` | 新增 30+ i18n key |
| `native-host/install.ps1` | 添加 UTF-8 BOM；移除 UAC 提权（S-006） |
| `native-host/clash_rules_manager.ps1` | 6 个安全漏洞修复（S-002/S-003/S-007/S-008/S-012/S-013） |

#### 删除文件
- `native-host/com.clash.manager.json` — 旧 JSON 残留（S-010）

---

## v1.2.2 及更早版本

略。
