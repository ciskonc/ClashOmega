# 更新日志

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
