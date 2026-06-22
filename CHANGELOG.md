# 更新日志

> 本文档记录 Fork 自上游 [ciskonc/ClashOmega](https://github.com/ciskonc/ClashOmega) 后的所有变更

---

## v1.3.0 (2026-06-22)

**本次版本为 Fork 后首次重大更新，涵盖三大领域：自动化安装、安全加固、UI 重构。**

---

### 一、新增功能

#### 1.1 自动化安装脚本 `install_all.ps1`（全新文件）

新增多浏览器一键安装脚本，支持 9 种 Chromium 内核浏览器的自动检测与安装：

- **支持浏览器**：Chrome / Edge / Brave / Opera / Vivaldi / 豆包 / 360 极速 / QQ / 搜狗
- **自动检测**：扫描运行中进程 + 注册表已安装浏览器，合并去重后供用户选择
- **扩展 ID 获取**：半自动模式（自动关闭浏览器 → `--load-extension` 重启 → 提示用户从扩展管理页复制 ID 输入），支持 `chrome-extension://` 前缀剥离与格式校验
- **Native Host 自动注册**：生成 JSON 清单 + 写入 HKCU 注册表（无需管理员权限）
- **Clash API 自动发现**：
  - 从 Clash Verge Rev 配置文件（`clash-verge.yaml`）读取 `external-controller` 实际端口
  - 端口扫描列表 `[9090, 9097, 9098, 9091, 8080, 7890]`
  - 401 认证检测（端口正确但需要 secret 时不再跳过）
- **豆包浏览器特殊适配**：`--saman-browser-entry` 参数启动浏览器功能（非主界面）
- **非标准路径支持**：豆包安装在 `C:\Software\Doubao` 等自定义路径时自动发现

#### 1.2 四标签页布局系统

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
- **模块级共享拖拽状态**：`_layoutDragState` 解决跨卡片拖拽问题

#### 1.3 多主题系统

新增 4 套主题 + 自动跟随系统模式：

- **MD3 亮色**（Material Design 3 浅色）
- **MD3 暗色**（Material Design 3 深色）
- **玻璃拟态 亮色**（Glassmorphism Light）
- **玻璃拟态 暗色**（Glassmorphism Dark）
- **自动跟随系统**（`prefers-color-scheme` 媒体查询）

实现方式：`data-theme` + `data-glass-variant` 属性切换 CSS 变量，不影响功能逻辑。

#### 1.4 设置页子标签页系统

将设置页拆分为 4 个子标签页：

| 子标签页 | 内容 |
|----------|------|
| 连接 | API 地址 / 密钥 / 代理主机端口 / 配置文件路径 / 扩展脚本规则开关 |
| 外观 | 主题选择 / 语言选择 / 字号缩放 |
| 布局 | 标签页编辑器（拖拽排序 + 模块迁移） |
| 高级 | 规则显示模式 / 每页规则数 |

- 每个子标签页有独立保存按钮（保存全部设置，保存后保持当前子标签页）
- 设置模块锁定（🔒 图标），不允许拖拽迁移到其他标签页

#### 1.5 全局字号缩放

新增 `--zoom-scale` + `--base-font-size` + `calc()` 实现全局字号缩放（70%-130%，步长 5%），实时预览。

#### 1.6 规则分页与显示模式

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
- **根因**：`loadScriptRules` 在 Native Host 失败分支未设置 `window._scriptRulesWithSource`，导致搜索回调 `if (window._scriptRulesWithSource)` 条件为 false，静默跳过
- **修复**：在 Native Host 失败分支也设置 `window._scriptRulesWithSource = merged`

#### 3.2 系统代理检测在豆包浏览器中失效（严重）

- **现象**：豆包浏览器中插件虽可通过 Clash 代理模式检测，但始终显示无法读取系统代理
- **根因**：系统代理检测完全依赖 Native Host 读取 Windows 注册表，无浏览器 API 兜底；豆包浏览器对 Native Host 的支持存在异常
- **修复**：`getSystemProxyStatus` 添加 `chrome.proxy.settings.get()` 作为兜底方案，支持 5 种代理模式：
  - `direct` → 直连
  - `auto_detect` → WPAD 自动检测
  - `pac_script` → PAC 脚本
  - `fixed_servers` → 固定代理服务器
  - `system` → 跟随系统
- **状态点颜色修正**：代理开启时从 `--off`（红色）改为 `--warn`（黄色），更准确反映状态

#### 3.3 扩展程序页面报错（严重）

- **现象**：扩展程序页面显示 `Handle message error (getScriptRules): Error: Specified native messaging host not found.`
- **根因**：`getScriptRules` 等函数在 Native Host 不可用时抛出异常，被 `background.js` 的 catch 块 `console.error` 捕获并输出到扩展程序页面
- **修复**：创建 `sendToNativeSafe` wrapper 函数，catch 异常返回 `{ success: false, error }` 而非抛出；所有 Native Host 调用改为使用安全版本：
  - `addClashRule` / `batchAddClashRules` / `removeClashRule`
  - `getClashYamlRules` / `setConfigPath`
  - `syncSnapshotRules` / `getSnapshotPath`
  - `getScriptRules` / `initScriptFile`
  - `background.js` 中的 `setConfigPath` / `ping`

#### 3.4 额外脚本规则域名被挤压（中等）

- **现象**：额外脚本规则列表中域名被两侧元素挤压，无法完整显示
- **根因**：`.rule-item` 使用 `flex` 布局但未设置 `flex-wrap`，且 payload 被截断
- **修复**：
  - `.rule-item` 添加 `flex-wrap: wrap` 允许换行
  - `#script-rule-list .rule-item .rule-payload` 设置 `flex: 1 1 100%` 独占一行
  - 添加 `word-break: break-all` + `overflow-wrap: break-word` 确保长域名换行
  - 域名检测中匹配到的规则 payload 同样修复

#### 3.5 域名检测当前域名布局（轻微）

- **现象**：当前域名与标签文字挤在同一行，长域名被截断
- **修复**：`#current-domain` 从内联 `span` 改为 `block` `div`，独占一行完整显示

#### 3.6 install.ps1 编码问题（严重）

- **现象**：`install.ps1` 无法运行，第 95 行 `Read-Host` 中文乱码（繁体），单引号 `'` 被编码破坏，解析器识别不到闭合单引号
- **根因**：文件无 UTF-8 BOM，PowerShell 5.x 在中文系统下按 GBK 读取 UTF-8 文件，导致中文乱码破坏语法
- **修复**：添加 UTF-8 BOM（`EF BB BF`）

#### 3.7 install_all.ps1 无法检测 Clash API（中等）

- **现象**：`install_all.ps1` 运行到最后无法读取到 Clash API
- **根因**：端口列表不包含用户实际使用的端口；401 认证场景被跳过
- **修复**：
  - 从 Clash Verge Rev 配置文件读取 `external-controller` 实际端口
  - 401 时认为端口正确（需要 secret 但端口无误）
  - 扩展端口列表（新增 7890）

#### 3.8 en.json 尾逗号（严重）

- **现象**：英文语言包完全无法加载
- **根因**：`en.json` 第 158 行 `"settings_module_locked": "...",` 末尾有多余逗号，导致 `JSON.parse()` 抛出 SyntaxError
- **修复**：移除尾逗号

---

### 四、UI/UX 改进

#### 4.1 玻璃拟态背景优化

- 进一步降低玻璃拟态主题背景亮度，避免前景内容对比度不足
- 亮色变体：`#b8bbc0 → #888c94`（原 `#d4d6db → #a4a8b0`）
- 暗色变体：`#3a3d42 → #1c1e22`（原 `#45484d → #25272b`）
- auto 暗色变体同步更新

#### 4.2 设置模块锁定

- 设置模块在布局编辑器中显示 🔒 图标
- 不设置 `draggable` 属性，无法被拖拽迁移到其他标签页
- 添加 `.locked` 样式（`opacity: 0.7` + `cursor: not-allowed`）

#### 4.3 子标签页样式

- 新增 `.settings-sub-tab-bar` / `.settings-sub-tab` / `.settings-sub-tab-content` 样式
- 玻璃拟态主题适配（亮色 + 暗色变体）
- active 状态使用 primary 色下边框

---

### 五、国际化（i18n）

三语言文件（`zh_CN.json` / `en.json` / `ja.json`）新增 key：

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

#### 新增文件
- `native-host/install_all.ps1` — 多浏览器自动化安装脚本

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
| `extension/popup/popup.css` | 多主题系统；子标签页样式；玻璃拟态背景优化；锁定模块样式；域名显示修复（flex-wrap）；规则分页样式 |
| `extension/popup/popup.js` | XSS 修复（S-001）；标签页系统；拖拽排序；主题切换；缩放；子标签页切换逻辑；保存按钮绑定；设置模块锁定；搜索框失效修复；系统代理状态渲染更新（支持 `browserMode`） |
| `extension/locales/zh_CN.json` | 新增 30+ i18n key |
| `extension/locales/en.json` | 新增 30+ i18n key；修复尾逗号 |
| `extension/locales/ja.json` | 新增 30+ i18n key |
| `native-host/install.ps1` | 添加 UTF-8 BOM；移除 UAC 提权（S-006） |
| `native-host/clash_rules_manager.ps1` | 6 个安全漏洞修复（S-002/S-003/S-007/S-008/S-012/S-013） |

#### 删除文件
- `native-host/com.clash.manager.json` — 旧 JSON 残留（S-010）

---

### 七、技术细节

#### 7.1 `sendToNativeSafe` Wrapper

```javascript
async function sendToNativeSafe(message) {
  try {
    return await sendToNative(message);
  } catch (e) {
    return { success: false, error: e.message };
  }
}
```

**设计理由**：Native Host 不可用时 `chrome.runtime.sendNativeMessage` 会抛出异常，若不 catch 会被 `background.js` 的 `console.error` 捕获并输出到扩展程序页面，造成用户困扰。此 wrapper 将异常转换为统一的 `{ success: false, error }` 返回值，调用方可通过 `result.success` 判断是否成功。

#### 7.2 `chrome.proxy.settings.get()` 兜底

```javascript
const details = await chrome.proxy.settings.get({});
const value = details?.value;
const mode = value.mode; // direct | auto_detect | pac_script | fixed_servers | system
```

**设计理由**：豆包等 Chromium 内核浏览器对 Native Host 的支持存在异常，导致无法通过注册表读取系统代理。`chrome.proxy.settings.get()` 是浏览器级 API，直接读取浏览器的代理配置，不依赖 Native Host。返回结果中新增 `browserMode` 字段，供 popup.js 渲染层识别。

#### 7.3 布局版本机制

```javascript
const LAYOUT_VERSION = 1;
// 加载布局时检查版本，不匹配则重置为默认布局
if (savedLayout.version !== LAYOUT_VERSION) {
  savedLayout = getDefaultTabLayout();
}
```

**设计理由**：布局结构可能随版本迭代发生变化（如新增标签页、模块重命名），版本机制确保旧版布局自动重置，避免渲染异常。

---

### 八、已知限制

1. **Clash API 端口检测**：`install_all.ps1` 从 Clash Verge Rev 配置文件读取端口，若用户使用其他 Clash 客户端（如 Clash for Windows），仍需手动输入端口
2. **扩展 ID 获取**：未上架 Chrome Store，安装脚本需半自动方式获取 ID（自动加载扩展 + 手动复制 ID）
3. **Native Host 依赖 PowerShell**：仅支持 Windows，且需开启脚本执行权限
4. **死代码**：`clash-api.js` 中 `hotReloadConfig` / `reloadClashConfig` / `checkClashStatus` 三个函数已定义但从未调用（保留供未来使用）
5. **manifest.json 缺少顶层 `icons` 字段**：仅 `action.default_icon` 有图标，不影响功能

---

### 九、致谢

本次更新基于 AOS（Agent Operating System）框架协作完成，感谢原作者 [@ciskonc](https://github.com/ciskonc) 的开源贡献。

---

## v1.2.2 及更早版本

请参考上游仓库 [ciskonc/ClashOmega](https://github.com/ciskonc/ClashOmega) 的版本历史。
