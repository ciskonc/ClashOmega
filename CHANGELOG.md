# 更新日志

本文件记录 ClashOmega 各版本变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

---

## v1.4.6 — 2026-07-20

对抗审查第三轮修复。v1.4.5 修复完成后再次发起 3 subagent 并行对抗审查（按维度切分：C1/C2/C3 逻辑正确性 / M1-M8+Minor / 版本号+i18n+git 完整性），发现 v1.4.5 修复存在的严重残留问题，本次全部修复。

### Critical

- **C1+C3 防抖锁未统一应用**：v1.4.5 的 C1/C3 修复仅在 `setModuleDisabled` 中检查 `dataset.lockedByDebounce`，未在 `loadScriptRules` 成功路径（L1757）和 `renderScriptRuleFailure`（L1916）中检查。5s 轮询触发 `loadScriptRules`（nativeHostInstalled 跳变 / clientType 变化）时，成功路径直接 `addBtn.disabled=false` 绕过防抖锁，导致并发 addRule 可损坏 Script.js。修复：抽取 `setElementDisabled(el, disabled, force=false)` 辅助函数，所有修改 `.disabled` 的入口统一调用，函数内部检查 `lockedByDebounce`（`force=true` 时跳过检查，用于 finally 块强制恢复）
- **C2 冷却期机制**：v1.4.5 的全局并发限制仅减少进程累积速率（从 360 降到 180），未完全消除泄漏。根因：超时后原 `sendToNative` Promise 永久 pending，PowerShell 进程不退出，新请求仍会启动新进程。修复：新增 `_nativeHostCooldownUntil` 时间戳 + `NATIVE_HOST_COOLDOWN_MS=30000`，超时后进入 30s 冷却期，期间所有新请求返回 `{error:'native_host_cooldown'}`，30 分钟最多累积 6 个新进程（v1.4.5 是 180 个），用户看到连续失败会主动重启 Chrome

### Major

- **M2 渲染时序绕过**：v1.4.5 的 M2 修复在 `renderScriptRuleFailure` 中 `document.querySelectorAll('.rule-delete-btn').forEach(btn => btn.disabled = isBlocking)`，但禁用的是即将被 `renderScriptRules` 重建的旧按钮。`renderScriptRules`（L1781 调用）内部 L1468 `listEl.innerHTML = ''` 清空列表 + L1507 `getRuleDisplaySettings().then(...)` 异步重建，新按钮通过 `createScriptRuleItem` 创建时 `disabled` 默认为 false，M2 禁用被绕过。修复：新增全局 `_scriptRuleBlocking` flag，`renderScriptRuleFailure` 设置 `isBlocking`，`loadScriptRules` 成功路径清除为 false，`createScriptRuleItem` 创建按钮时读取此 flag 设置初始 `disabled`
- **M5 finally 兜底**：v1.4.5 的 M5 修复在 finally 中根据 `btn.disabled` 当前状态决定是否恢复，但 `loadScriptRules` 返回 null（序号过期）或抛错时 `renderScriptRuleFailure` 不会被调用，`btn.disabled` 保持 try 开头设置的 true，finally 中 `!btn.disabled` 为 false 不恢复，按钮永久禁用。修复：finally 失败路径改用 `setElementDisabled(btn, _scriptRuleBlocking, true)` force 设置，根据全局 blocking flag 决定（场景 B/C/D/F 保持禁用，场景 A/E 或异常恢复允许重试）
- **M8 撤销**：v1.4.5 的 M8 修复移除 `bindDomainCheckDeleteEvents` 的 `item.remove()`，基于"loadScriptRules 会重建整个列表"的假设。但实际 `bindDomainCheckDeleteEvents` 处理 `#domain-check-matched` 列表（域名检测匹配结果），`loadScriptRules` 只刷新 `#script-rule-list`，不刷新 `#domain-check-matched`。移除 `item.remove()` 后 domain-check-matched 列表中的删除项不被移除，UI 不一致。修复：恢复 `item.remove()`，保留 `loadScriptRules()` 用于刷新 script-rule-list

### Minor

- **loadScriptRules return null 调用方未检查**：`loadScriptRules` 序号过期返回 null，调用方 `scriptRulesPromise.then(({ clashRules, proxies }) => {...})` 解构 null 抛 `TypeError: Cannot destructure property 'clashRules' of 'null'`，成为未处理 Promise rejection。修复：改为 `.then(result => { if (!result) return; const { clashRules, proxies } = result; ... })`

### Changed

- **`setElementDisabled` 辅助函数**（C1+C3 修复）：新增统一防抖锁检查函数，所有修改 `.disabled` 的入口（`loadScriptRules` 成功路径 / `renderScriptRuleFailure` / `setModuleDisabled` / `bindQuickAddRuleEvents` finally）都调用此函数
- **`_scriptRuleBlocking` 全局 flag**（M2 修复）：新增全局变量，`renderScriptRuleFailure` 设置 + `loadScriptRules` 成功路径清除 + `createScriptRuleItem` 读取
- **`sendToNativeSafe` 冷却期**（C2 修复）：新增 `_nativeHostCooldownUntil` + `NATIVE_HOST_COOLDOWN_MS=30000`，超时后 30s 冷却期
- **`renderScriptRuleFailure` 场景 F 扩展**（C2 配套）：场景 F 匹配条件增加 `native_host_cooldown` 和 `native_host_busy`

### Technical Notes

- **对抗审查方法论**：本次审查使用 3 个 subagent 按维度切分（C1/C2/C3 逻辑正确性 / M1-M8+Minor / 版本号+i18n+git 完整性），每个 subagent 独立输出报告，最后由主 Agent 汇总。相比 v1.4.5 的 4 subagent 对抗审查，本次更聚焦于"修复是否真正消除原风险且不引入新风险"
- **交互循环规则遵守**：本次会话开头用户指出 v1.4.5 修复时未用 `AskUserQuestion` 弹窗确认对抗审查参数，违反交互循环规则。本次已记录到 user_profile.md 纠正记录表，后续所有对抗审查/复杂操作前必须先用弹窗确认参数

---

## v1.4.5 — 2026-07-20

对抗审查第二轮修复（3 Critical + 8 Major + ~15 Minor）。v1.4.4 发布后再次发起 3 subagent 并行对抗审查，发现 v1.4.4 修复引入的新风险（C1/C2/C3）+ 遗留问题（M1-M8）+ 代码质量问题（Minor 批量），本次全部修复。

### Critical

- **C1 addRule finally 覆盖场景禁用状态**：`bindQuickAddRule` finally 无条件恢复 `disabled=false`，覆盖场景 B/C/D/F 的 `disabled=true`。场景 F（Native Host 崩溃超时）下用户可连续点击触发多个 10s 超时累积。修复：finally 中根据 `addResult.success` 决定是否恢复，失败路径由 `loadScriptRules → renderScriptRuleFailure` 重新判定场景
- **C2 Native Host 进程泄漏**（全局并发限制方案）：`sendToNativeSafe` 10s 超时后原 Promise 永久 pending，卡死的 PowerShell/Python 进程不退出，30 分钟可累积 360 个进程。修复：`_sendToNativeInFlight` 全局标志，同时只允许 1 个 sendToNative 在途，超时期间拒绝新请求返回 `{error:'native_host_busy'}`；`clearTimeout` 清理 + 超时 `console.warn` 日志
- **C3 setModuleDisabled 覆盖防抖锁**：5s 轮询 `clientType` 变化时 `setModuleDisabled` 强制设置 `addBtn.disabled=false`，覆盖防抖锁，导致并发 addRule 可损坏 Script.js。修复：`setModuleDisabled` 检查 `dataset.lockedByDebounce === '1'`，跳过防抖锁元素；`bindQuickAddRuleEvents` 进入时设置标志，finally 清除

### Major

- **M1 jumpToSettings 硬编码 tab-3**：用户自定义布局改了 tab 顺序后跳转失效。修复：动态查找 `_currentTabLayout` 中包含 `settings` 模块的 tab，找不到才回退 `tab-3`
- **M2 rule-delete-btn 未禁用**：`renderScriptRuleFailure` 仅禁用 addRule 控件，用户仍可点击删除按钮触发 removeRule（场景 B/C/D/F 下必然失败）。修复：`isBlocking=true` 时禁用所有 `.rule-delete-btn`；`loadScriptRules` 成功路径恢复
- **M3 addRule 成功不刷新**：原实现手动 append div，可能与并发操作冲突导致列表状态不一致。修复：成功路径调用 `loadScriptRules()` 全量刷新
- **M4 bindQuickAddRule 重复绑定**：每次 `initPopup` 都 `addEventListener`，导致重复绑定（用户每切换 tab 回规则页一次，点击 addBtn 会触发 N 次重复 addRule 请求）。修复：拆分为 `bindQuickAddRule(domain)` 仅更新 input.value + `bindQuickAddRuleEvents()` 事件绑定由 DOMContentLoaded 调用一次，防御性检查 `dataset.bound`
- **M5 addRule 失败不刷新 UI**：原实现失败仅 showToast，不刷新 UI，场景判定状态可能过期。修复：失败路径调用 `loadScriptRules()` 让 `renderScriptRuleFailure` 处理场景判定
- **M6 5s 轮询无法检测 Native Host 升级**：原实现仅 `clientType` 变化时刷新，无法检测 Native Host 升级（clientType 不变）。修复：5s 轮询增加 `nativeHostInstalled` 跳变检测，从 false→true 时触发 `loadScriptRules`
- **M7 场景 D 文案错误**：场景 D（非 CVR 兼容性兜底）复用 `#script-rule-not-found`，文案"未找到扩展脚本文件"误导用户。修复：popup.html 新增 `#script-rule-unsupported-action` 专用元素，文案"当前客户端不支持文件操作（非 Clash Verge Rev 兼容性兜底）"，i18n 三语言同步
- **M8 removeRule 双重刷新**：`bindDomainCheckDeleteEvents` 同时执行 `item.remove()` + `loadScriptRules()`，双重刷新可能导致列表闪烁。修复：移除局部 DOM 删除，统一由 `loadScriptRules` 刷新；增加防抖锁

### Minor

- **switchTab loadScriptRules 缺少 .catch**：`_pendingScriptRulesRefresh` 触发的 `loadScriptRules()` 未捕获异常，可能阻塞 tab 切换。修复：添加 `.catch(e => console.warn(...))`
- **loadScriptRules 序号过期返回值**：原返回 `{clashRules, proxies}` 对象可能让调用方误以为刷新成功。修复：改为 `return null` 明确表示"已丢弃"
- **loadScriptRules 变量遮蔽**：`needInitEl` / `notFoundEl` 在外层和 else 分支重复声明（var 提升）。修复：外层声明一次，else 分支直接复用
- **loadScriptRules 重复调用 renderScriptRuleFailure**：失败分支 L1730 已调用，L1767 再次调用，重复执行。修复：移除第二次调用
- **showNativeError toLowerCase 不一致**：`err.includes('native messaging host')` 大小写敏感，Chromium 不同版本可能抛出大小写变体。修复：统一 `String(result.error).toLowerCase()`，与 `renderScriptRuleFailure` 保持一致
- **bindScriptInitButton 缺少 try/finally**：`btn.disabled=true` 后 await，若 `sendToBackground` 抛错则 disabled 永不恢复。修复：try/finally + 防抖锁
- **bindDomainDetection detectBtn 缺少 try/finally**：同上问题。修复：try/finally + 防抖锁 + result null 检查
- **batchAddRules batchBtn 缺少 try/finally**：同上问题。修复：try/finally + 防抖锁
- **bindRuleListDeleteEvents 缺少 try/finally**：同上问题。修复：try/finally + 防抖锁
- **sendToNativeSafe clearTimeout 清理**：`setTimeout` 在 sendToNative 先完成时不清理，短期资源泄漏。修复：finally 中 `clearTimeout(timeoutId)`
- **sendToNativeSafe 超时日志**：超时时无日志，难以排查 Native Host 卡死问题。修复：`console.warn('ClashOmega: Native Host timeout (process may be stuck):', message.action)`

### Added

- **popup.html 新增 `#script-rule-unsupported-action`**（M7 修复）：场景 D 专用 UI 元素，原复用 `#script-rule-not-found` 文案误导用户
- **i18n 新增 1 个键**：`script_rules_unsupported_action`（zh_CN / en / ja 三语言）
- **`bindQuickAddRuleEvents` 函数**（M4 修复）：事件绑定独立函数，由 DOMContentLoaded 调用一次，替代原 `bindQuickAddRule` 内的 `addEventListener`

### Changed

- **`bindQuickAddRule` 拆分**（M4 修复）：原函数拆分为 `bindQuickAddRule(domain)` 仅更新 input.value + `bindQuickAddRuleEvents()` 事件绑定
- **`sendToNativeSafe` 重写**（C2 修复）：增加 `_sendToNativeInFlight` 全局并发限制 + `clearTimeout` 清理 + 超时 `console.warn` 日志
- **`setModuleDisabled` 增加 `lockedByDebounce` 检查**（C3 修复）：跳过防抖锁元素，避免 5s 轮询覆盖防抖锁状态
- **`renderScriptRuleFailure` 禁用 `.rule-delete-btn`**（M2 修复）：`isBlocking=true` 时禁用所有删除按钮，`loadScriptRules` 成功路径恢复
- **`loadScriptRules` 成功路径恢复 `.rule-delete-btn`**（M2 配套）：原失败场景禁用的删除按钮在成功时恢复
- **`jumpToSettings` 动态查找 settings tab**（M1 修复）：从 `_currentTabLayout` 查找包含 `settings` 模块的 tab
- **`bindDomainCheckDeleteEvents` 移除 `item.remove()`**（M8 修复）：统一由 `loadScriptRules` 刷新
- **5s 轮询增加 Native Host 可用性检测**（M6 修复）：维护 `_lastNativeHostInstalled`，从 false→true 跳变时触发 `loadScriptRules`
- **多处 btn.disabled 恢复移到 finally**（Minor 修复）：`bindScriptInitButton` / `bindDomainDetection` / `batchAddRules` / `bindRuleListDeleteEvents` / `bindDomainCheckDeleteEvents` 统一 try/finally 模式
- **spec.md 升级为 v4**：同步对抗审查第二轮修复（C1/C2/C3 + M1-M8 + Minor 批量）

### Technical Notes

- **对抗审查流程**：v1.4.4 发布后再次发起 3 subagent 并行对抗审查（技术正确性 / 用户真实场景 / 对抗性设计），发现 3 Critical + 8 Major + ~15 Minor 问题。本次修复全部 Critical + Major + Minor
- **关键审查发现**：v1.4.4 引入的"addRule 防抖锁 + 10s 超时"机制本身存在缺陷——finally 无条件恢复 disabled 覆盖场景禁用状态（C1），超时机制引入进程泄漏（C2），5s 轮询覆盖防抖锁（C3）。这是"修复引入新风险"的典型案例
- **交互循环规则纠正**：本次对抗审查发起前先用 AskUserQuestion 弹窗确认审查范围/维度/执行顺序，修正了上次会话中"已有计划即跳过弹窗"的违规行为。教训已记录到 `user_profile.md` 纠正记录表
- **C2 缓解方案选择**：用户在"超时后强制 kill Native Host 进程" vs "全局并发限制"之间选择后者。全局并发限制更简单且不依赖进程管理 API，代价是超时期间所有 Native Host 请求被拒绝（返回 `native_host_busy`），由 `renderScriptRuleFailure` 场景 F 处理

---

## v1.4.4 — 2026-07-20

Native Host 版本不匹配前置门控 + 对抗审查修复（3 Critical + 6 Major）。

### Added

- **前置版本门控**：`loadScriptRules` 失败分支细分 6 种场景，分别显示不同 UI（场景 A needInit / B 版本过旧 / C 未安装 / D 非 CVR 兼容性兜底 / E 未知 / F 进程崩溃超时）。场景 B/C/D/F 禁用 addRule 控件（`#quick-add-btn` + `#quick-add-domain` + `#quick-add-rule-type` + `#quick-add-policy`），从源头阻止用户在版本不匹配场景下操作
- **popup.html 新增失败场景 UI 元素**：`#script-rule-need-reinstall`（Native Host 版本过旧提示 + 查看安装指引按钮）+ `#script-rule-native-host-missing`（Native Host 未安装提示 + 查看安装指引按钮）
- **addRule 防抖锁机制**（C1 修复）：`bindQuickAddRule` 事件处理器开头检查 `btn.disabled`，设置 `disabled=true` + 文本变 `...`，finally 恢复。防止用户快速点击触发多个 PowerShell 进程并发读写 .js 文件导致损坏
- **loadScriptRules 竞态保护**（M4 修复）：引入序号机制 `_loadScriptRulesSeq`，await 后检查序号是否过期，过期则丢弃响应。防止 6 处调用点（initPopup / 5s 轮询 / addRule / removeRule / batchAdd / initScriptFile）的响应交错覆盖新数据
- **sendToNativeSafe 10s 超时**（M3 修复）：`native-bridge.js` `sendToNativeSafe` 增加 `Promise.race` + 10s 超时，超时返回 `{success:false, error:'native_host_timeout'}`。防止 Native Host 卡死导致 popup 永久阻塞
- **UI 自动刷新**（M5 修复）：`jumpToSettings` 设置 `_pendingScriptRulesRefresh = true`；`switchTab` 切换到包含 `#module-script-rules` 的 tab 时触发 `loadScriptRules()`。用户重新安装 Native Host 后切回规则页无需手动关闭 popup
- **i18n 新增 4 个键**：`script_rules_need_reinstall` / `script_rules_native_host_missing` / `script_rules_view_install_guide` / `error_rule_add_failed`（zh_CN / en / ja 三语言）

### Fixed

- **addRule 按钮未在版本不匹配场景下禁用**（M1 修复）：v2 spec 声明"版本过旧则禁用 addRule 按钮"，但 v2 实施时遗漏。本次在 `renderScriptRuleFailure` 中场景 B/C/D/F 设置 `isBlocking=true`，禁用 addRule 控件；`loadScriptRules` 成功路径恢复
- **场景 C 错误字符串匹配过严**（M2 修复）：v2 spec 写 `err.includes('native messaging host not installed')`，但 Chromium 实际抛出 `"Specified native messaging host not found."`，第一个 includes 永不匹配。改为 `err.includes('native messaging host') || err.includes('native host not installed')`，与 `showNativeError` L122 保持一致
- **Task 6 遗漏 AGENTS.md 版本号同步**（C2 修复）：v1.4.3 发布时漏更新 `AGENTS.md` L15 当前版本字段，本次一并补齐
- **Task 6 遗漏 04_MEMORY/INDEX.md 版本号同步**（C3 修复）：自 v1.4.1 起漏更新 `04_MEMORY/INDEX.md` L32 的项目描述版本号，本次一并补齐
- **proj_clash_omega.md 版本号同步遗漏**（M6 修复）：v1.4.3 发布时漏更新 `proj_clash_omega.md` L16 当前版本字段（停留在 v1.4.2），本次更新为 v1.4.4 并在变更注释中说明"v1.4.3 状态同步遗漏，本次一并补齐"

### Changed

- **addRule 失败 toast 增强**：失败时显示 `I18N.t('error_rule_add_failed') + ': ' + (result.hint || result.error)`，不再静默；errorMsg 为空时回退到 `showNativeError`
- **`renderScriptRuleFailure` 提取为公共函数**：`loadScriptRules` 两处失败分支（首次 + 二次渲染）统一调用，消除原 spec 提到的"两处逻辑不一致"问题
- **spec.md 升级为 v3**：同步对抗审查修复（场景 C 描述 + addRule 禁用要求 + 崩溃场景 F + 删除 'action not found' 字符串引用 + 标注场景 D 为兼容性兜底）

### Technical Notes

- **对抗审查流程**：v2 spec 实施完成后再次发起 4 个 subagent 并行对抗审查（技术正确性 / 用户真实场景 / 对抗性设计 / Tasks 任务分解），发现 3 Critical + 6 Major + 11 Minor 问题。本次修复所有 Critical + Major，11 个 Minor 问题记录在 spec.md 末尾待后续迭代
- **关键审查发现**：v2 spec 自身声明"版本过旧则禁用 addRule 按钮"，但代码只显示了升级指引未禁用按钮——这是 spec 设计与实现的脱节，由用户真实场景审查 subagent 发现
- **未修复的 Minor 问题**（11 个）：jumpToSettings 硬编码 tab-3 / 场景 D 是 dead code / addRule 成功路径未调 loadScriptRules 刷新 / 场景 B 计数与列表不一致 / addRule 失败时不刷新规则列表 / needInit 与 error 优先级 / Task 5 自检范围未含 .html 等

---

## v1.4.3 — 2026-07-19

Native Host Script.js 三个 action 缺失修复 + showNativeError 误判修复。

### Fixed

- **showNativeError 误判"Config file not found"为"Native Host 未安装"**（方案 2A）：`popup.js` L118 `showNativeError` 的错误匹配条件过宽（`err.includes('not found')`），把 Native Host 返回的"Config file not found. Please set CLASH_CONFIG_PATH or start Clash first."误判为"Native Host 未安装"，导致设置页显示"已安装"但删除规则提示"未安装"的矛盾。收紧匹配条件为 `err.includes('native messaging host') || err.includes('native host not installed')`，只匹配 Native Messaging 专有错误。通用"not found"错误现在直接显示原始错误文案
- **Native Host Script.js 三个 action 缺失**（方案 1A-1）：Native Host `clash_rules_manager.ps1` 的 switch 分支缺少 `getScriptPath` / `getScriptRules` / `initScriptFile` 三个 action 处理器，全部落到 default 分支返回 `Unknown action`。导致扩展"额外脚本规则"模块永远显示"未找到扩展脚本文件"，初始化按钮永远不显示。新增 6 个函数 + 3 个 switch case：
  - **Get-ScriptPath**：读 profiles.yaml current + option.script 拼路径，返回 `{scriptPath, exists, managed, scriptUid, currentUid}`
  - **Get-ScriptRules**：解析 .js 文件中 customRules 数组（兼容旧 EXT_RULES），返回 `{rules, scriptPath, needInit, arrayFormat, managed}`
  - **Init-ScriptFile**：备份原文件后写入标准 ClashOmega 模板（customRules 空数组 + main 函数）
  - **Add-ScriptRule / Remove-ScriptRule / BatchAdd-ScriptRules**：操作 customRules 数组，支持去重和批量添加
  - `addRule` / `removeRule` / `batchAddRules` switch case：根据 `msg.useScript` 分支，true 走 .js 文件，false/未设置走 YAML（保持原有行为）

### Changed

- **CVR 扩展脚本机制设计修正**：v1.2.x 扩展侧代码写死操作全局 `Script.js` 的设计本身就是错的。CVR 实际机制是"每个订阅有自己的 .js 文件"（通过 profiles.yaml 的 current + option.script 字段绑定）。方案 1A-1 让 Native Host 读 profiles.yaml current + option.script 拼路径，操作当前激活订阅绑定的 .js 文件。用户实际看到的 4 条规则（ip9.com.cn / cangku.moe / ts.tan0.me / sub.tan0.me）在 `s8XWAjDjLilq.js`（当前激活订阅 RHIBxScuGfpf 的扩展脚本），不在 `Script.js`

### Technical Notes

- **关键 bug 修复**：Remove-ScriptRule 原用倒序扫描 + 状态机，倒序时 `]` 行不匹配 array start 正则（`^const\s+customRules\s*=\s*\[`），导致 `$inArray` 永远为 false，规则匹配失败。修复为顺序扫描 + 收集索引 + 倒序删除（与 Add-ScriptRule / Get-ScriptRules 一致）
- **扩展侧契约对齐**：`native-bridge.js` L207-L225 三个函数 + `background.js` L417-L441 三个 case 已存在（v1.2.x 遗留），本次只改 Native Host，扩展侧无需改动
- **兼容性**：旧版 `EXT_RULES = []` 格式可读取，但写入统一用 customRules 格式；非 CVR 客户端已有 `isFileOperationSupported` 检查
- **已知限制**：多订阅切换后扩展内缓存的规则列表不会自动刷新，需用户重新打开 popup

---

## v1.4.2 — 2026-07-16

主页加载性能优化（4-5 秒 → 2-3 秒）。

### Changed

- **getStatus 内部分组并行**（方案 A）：Clash API 探测与 Native Host 串行组（ping + getSystemProxy）并行执行。`detectClashClient` 仍串行（混合 Native Host + Clash API，且需等 Clash API 缓存建立后命中缓存避免重复请求）。Native Host 内部保持串行（PowerShell 单进程不支持并发，避免 native messaging 队列错位）
- **queryConnections 重试策略优化**（方案 B）：重试间隔 1500ms → 800ms，最多重试 2 次（总时长 1.6s）。原 1500ms 单次重试改为 800ms 多次重试，提高 Clash 内核建立连接后的命中率
- **DOMContentLoaded 初始化并行化**（方案 C）：`initTheme` 先执行（避免主题闪烁）→ `I18N.init` + `getZoomScale` + `getTabLayout` 三者并行。原 4 次 await 串行改为 2 次（initTheme + Promise.all）
- **loadSettingsForm 改非阻塞**（方案 D）：`statusPromise.then(loadSettingsForm)` 非阻塞，`initPopup` 不再 `await statusPromise`。主页域名检测提前启动，不再等 getStatus 返回（getStatus 是最慢步骤）
- **系统代理状态异步加载**（方案 I1）：`getSystemProxyStatus` 从 `getStatus` 内同步调用改为独立 action 异步调用。主页加载时立即显示"加载中..."，500-1000ms 后异步更新为真实 Windows 系统代理状态。撤销方案 G（曾尝试改用 `chrome.proxy.settings.get()` 读浏览器代理，但破坏"系统代理"栏显示 Windows 系统状态的 UI 语义）。`background.js` getStatus 串行组仅保留 `checkNativeHost`，新增独立 action `getSystemProxyStatus` 供 popup 异步调用。`popup.js` 新增 `loadSystemProxyStatus()` 函数，DOMContentLoaded 与 5 秒轮询时调用，`renderSystemProxyStatus` 新增 null 分支显示"加载中..."
- **加载状态视觉一致性**（方案 I1 视觉修复）：`renderClashStatus` 新增 null 分支显示橙色"加载中..."，与系统代理加载状态视觉一致；`renderSystemProxyStatus` null 分支颜色从 `status-dot--off`（红色 #F44336）改为 `status-dot--warn`（橙色 #FF9800），加载中属过渡状态而非错误状态；HTML 初始 `clash-status-dot` class 从 `status-dot--off` 改为 `status-dot--warn`，避免 popup 打开瞬间红色闪烁；`loadSystemProxyStatus` 引入 `_lastSysProxy` 全局变量，5 秒轮询时保留上次状态不显示"加载中..."，避免每 5 秒状态点闪烁
- **客户端类型检测异步化**（方案 J1）：`detectClashClient` 从 `getStatus` 内同步调用改为独立 action `detectClient` 异步调用。原实现 getStatus 串行调用 detectClashClient（含 1 次 Native Host + clashGet），导致 Clash 状态点比系统代理栏晚 500-1000ms 出现。优化后 getStatus 立即返回 `clientType=null`（未知），popup 收到 null 时不触发 UI 降级，`loadClientType()` 异步调用独立 action，返回后通过 `updateClientTypeUI` 应用 UI 降级。客户端类型变化的会话级 API URL 缓存清理逻辑保留在 detectClient action 内。`loadClientType` 引入 `_lastClientType` 全局变量，5 秒轮询时客户端类型未变则不重新渲染 UI 降级，避免重复触发规则重载

### Added

- zh_CN / en / ja 三语言新增 `system_proxy_loading` 翻译键（"加载中..." / "Loading..." / "読み込み中..."）
- zh_CN / en / ja 三语言新增 `clash_status_loading` 翻译键（"加载中..." / "Loading..." / "読み込み中..."）

### Performance

- 主页内容可见时间：4-5 秒 → 2-3 秒（预估）
- 系统代理状态渲染：原阻塞主页 500-1000ms → 主页秒开，"系统代理"栏异步加载
- 瓶颈分析：getStatus 串行调用（Clash API + 3 个 Native Host）+ queryConnections 1.5s 硬延迟 + DOMContentLoaded 串行 await + loadSettingsForm 阻塞 initPopup + getSystemProxyStatus 阻塞主页加载

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
