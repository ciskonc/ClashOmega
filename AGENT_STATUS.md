# AGENT_STATUS.md — 协作状态看板

## Agent 注册表

| Agent ID | 负责模块 | 分支 | 状态 |
|----------|----------|------|------|
| clash-dev | A (全栈) | agent-clash-dev-A | 活跃 |
| clash-dev | B (前端+性能) | agent-clash-dev-B | 活跃 |
| clash-dev | C (Native Host) | agent-clash-dev-C-native-host | 活跃 |

## 任务看板

| 任务 ID | 描述 | 状态 | 优先级 | 备注 |
|---------|------|------|--------|------|
| T001 | 初始化 Git 协作环境 | 已完成 | 高 | 创建 agent 分支与 AGENT_STATUS.md |
| T002 | 修复 "找不到接受实际参数" 错误 | 已完成 | 高 | e85fa42: Get-ConfigPath 改用 .NET ReadAllText + addRule 携带 configPath |
| T003 | 修复系统代理状态问题 | 待处理 | 中 | 等待用户指令 |
| T004 | 修复 Join-Path 三参数错误导致 restartClash 失败 | 已完成 | 高 | Get-ConfigPath 中 Join-Path $dir 'profiles' $file 改为嵌套调用 |
| T005 | 修复 Parse-Rules 返回 $null 导致快照 rules 被清空、节点全断 | 已完成 | 高 | Parse-Rules 改用 ArrayList+ToArray()+, 防止空数组被 streaming 展平为 $null；Sync-SnapshotRules 添加参数验证；JS 端用 Array.isArray 严格检查 |
| T006 | 修复 Get-ConfigPath 自动检测选错 profile 文件 | 已完成 | 高 | 优先解析 profiles.yaml 的 current 字段，而非 type:rules |
| T007 | 修复 RULE-SET 类型规则域名匹配不显示 | 已完成 | 高 | 回退到 Clash API /connections 查询实际匹配的规则和代理组 |
| T008 | 修复 Add-Rule 写入双单引号导致 YAML 解析失败、代理崩溃 | 已完成 | 高 | Add-Rule/Sync-SnapshotRules 写入前清理首尾单引号 |
| T009 | 修复 Remove-Rule 删除规则不生效 | 已完成 | 高 | Remove-Rule 传入规则首尾单引号清理 + ArrayList 替代 @() += |
| T010 | 修复 F1 删除按钮 null 崩溃 | 已完成 | 高 | btn.closest('.rule-item') 在 .matched-rule-item 容器中返回 null |
| T011 | 移除设置面板内重复的「同步规则到内核」按钮 | 已完成 | 中 | 保留底部唯一入口，符合「一个键不需要两个地方有」 |

## 讨论区

> 暂无讨论

## 更新日志

| 时间 | Agent | 操作 | Commit Hash | 说明 |
|------|-------|------|-------------|------|
| 2026-06-21 | clash-dev (A) | 初始化 | 073753e | 创建 agent-clash-dev-A 分支与 AGENT_STATUS.md |
| 2026-06-21 | clash-dev (B) | 初始化 | 68b468d | 创建 agent-clash-dev-B 分支，注册模块 B |
| 2026-06-21 | clash-dev (B) | 新增 | f6dd07f | 热重载规则 + 重启 Clash 内核按钮 |
| 2026-06-21 | clash-dev (B) | 修复 | e85fa42 | 修复 Get-ConfigPath 中 Get-Content -Encoding UTF8 错误，addRule 消息携带 configPath |
| 2026-06-21 | clash-dev (B) | 修改 | 5fd7ad1 | 系统代理状态颜色：绿色直连/红色代理/橙色PAC |
| 2026-06-21 | clash-dev (B) | 修改 | 1133be6 | 同步规则按钮改为读 profile → PUT /configs?force=true 热重载 |
| 2026-06-21 | clash-dev (B) | 修复 | 9ceb64a | 删除/添加改为乐观 DOM 更新，解决连点删除只删一个 |
| 2026-06-21 | clash-dev (C) | 初始化 | 4140a18 | 重建 Git 仓库，创建 agent-clash-dev-C-native-host 分支，注册模块 C |
| 2026-06-21 | clash-dev (C) | 修复 | 01cf205 | 修复 Get-ConfigPath 中 Join-Path 三参数错误（Win PS 5.1 只接受两个位置参数），修复 hotReloadConfig 中 newRules 未定义变量 |
| 2026-06-21 | clash-dev (C) | 修复 | e73232e | 修复 Parse-Rules 返回 $null 导致快照 rules 被清空、节点全断。根因：PowerShell streaming 把空数组展平为 $null，ConvertTo-Json 把 $null 序列化为 {} |
| 2026-06-21 | clash-dev (C) | 修复 | 90a7a32 | 修复 Get-ConfigPath 优先使用 current 字段检测激活 profile；修复 RULE-SET 域名匹配不显示（回退到 /connections API） |
| 2026-06-21 | clash-dev (C) | 修复 | 179c168 | 修复 Add-Rule 写入双单引号导致 YAML 解析失败、代理崩溃 |
| 2026-06-21 | clash-dev (C) | 修复 | c417c12 | 修复 Remove-Rule 删除不生效（首尾单引号清理）+ F1 删除按钮 null 崩溃 + 移除设置面板重复按钮 |