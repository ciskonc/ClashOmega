# ClashOmega

> Chrome extension for managing Clash proxy rules. Inspired by SwitchyOmega / ZeroOmega.

**English** | [中文](README.md)

## UI Preview

<table>
  <tr>
    <td align="center"><img src="docs/ui-overview.png" width="280" alt="UI Overview"><br>Extension Icon & Chrome Toolbar</td>
    <td align="center"><img src="docs/ui-rules.png" width="280" alt="UI Rules"><br>Clash Rules + Extension Script Rules</td>
    <td align="center"><img src="docs/ui-popup.png" width="280" alt="UI Main"><br>Node Settings</td>
  </tr>
</table>

## Features

| Feature | Description |
|---------|-------------|
| **Tri-mode Switching** | System Proxy → Direct → Clash Proxy, one-click switch with real-time icon color change |
| **Domain Match Detection** | Detects which Clash rule the current domain matches, shows the matched group and policy (supports RULE-SET fallback to `/connections` API) |
| **Quick Rule Add** | Add current domain to a proxy group (dynamically fetches Clash proxy group list) |
| **Smart Domain Grouping** | Detects all domains on the page, auto-groups suggestions (e.g. `i1.art.com`, `i2.art.com` → `*.art.com`) |
| **System Proxy Status** | Real-time Windows system proxy status (read from registry via Native Host) |
| **Rule Management** | View, add, delete rules in Clash YAML config file (auto hot-reload after changes) |
| **Restart Clash** | One-click sync profile rules to Clash Verge Rev snapshot file and restart kernel (use when hot-reload fails) |
| **Multi-language** | 简体中文 / English / 日本語 |
| **Material Design 3** | Google MD3 design style |

## Installation

### 1. Load Extension

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `extension/` directory

### 2. Install Native Messaging Host

Native Host is used to read/write Clash local YAML config files (Windows only).

> **Prerequisite: Enable PowerShell Script Execution**
>
> Native Host relies on PowerShell scripts (`.ps1`). Windows blocks scripts by default, so you must enable execution first, otherwise Native Host won't start.
>
> **Option 1 (Recommended): Windows Settings**
> 1. Open "Settings" → "Privacy & security" → "For developers" (Windows 11: "Settings" → "System" → "For developers")
> 2. Find "PowerShell" → "Change execution policy to allow local PowerShell scripts to run without signing" → Enable
>
> **Option 2: PowerShell Command**
> 1. Open PowerShell as Administrator
> 2. Run: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`
> 3. Type `Y` to confirm

1. Find ClashOmega in `chrome://extensions/` and copy its **ID**
2. Right-click `native-host/install.ps1` → **Run with PowerShell**
3. Paste the extension ID and press Enter
4. Reload the extension

### 3. Configure Clash API

1. Click the extension icon → Settings (gear button)
2. Fill in Clash API URL (default `http://127.0.0.1:9090`) and secret
3. Leave config path empty for auto-detection (supports Clash Verge Rev `profiles.yaml`)

## Usage

### Do rule changes take effect automatically?

**Yes**. After adding/deleting rules, the extension auto hot-reloads config via Clash API `/configs?force=true` (500ms debounce).

The "Restart Clash" button at the bottom is a more thorough approach: writes profile rules to Clash Verge Rev snapshot file (`clash-verge.yaml`) and restarts the kernel. Use it only when hot-reload fails.

### Why don't my custom rules work?

Clash kernel matches rules **top-to-bottom** — the first matching rule wins. If your custom rule is placed after `RULE-SET,...` and the domain is included in that rule set, your custom rule will never be hit.

**Solution**: Move custom rules to the top of the rules list (before `RULE-SET`).

### Why does domain match show as fallback rule (MATCH)?

Possible reasons:
1. The domain doesn't match any rule and falls through to the `MATCH` fallback
2. The rule type is `RULE-SET`, which can't be parsed in the browser. The extension falls back to Clash API `/connections` to query the actual match (requires an active connection for that domain)

> Note: The proxy group name for the MATCH fallback rule is determined by your subscription config (e.g. "Final", "漏网之鱼"). The extension only displays the actual match result.

## Tech Stack

- **Frontend**: Chrome Extension Manifest V3 + Vanilla JS + CSS3 (MD3)
- **Backend**: Native Messaging Host (PowerShell)
- **Communication**: `chrome.runtime.sendMessage` + `chrome.runtime.sendNativeMessage`
- **API**: Clash REST API (`GET /configs`, `/rules`, `/proxies`, `/connections`)

## Project Structure

```
extension/          # Chrome extension
├── manifest.json   # MV3 manifest
├── background.js   # Service Worker (message routing + hot-reload)
├── lib/            # Modules
│   ├── clash-api.js       # Clash REST API wrapper
│   ├── native-bridge.js   # Native Host bridge
│   ├── proxy.js           # Proxy mode switching
│   └── domain-detector.js # Page domain detection
├── popup/          # Popup UI
│   ├── popup.html
│   ├── popup.js    # Domain match + rule add/delete UI
│   └── popup.css   # MD3 styles
├── locales/        # i18n files (zh_CN / en / ja)
└── icons/          # Mode icons

native-host/        # Native Messaging Host (Windows)
├── install.ps1     # Installer (registers Native Host)
├── clash_rules_manager.bat   # Entry point
├── clash_rules_manager.ps1   # Main program (YAML read/write + system proxy query)
└── com.clash.manager.json    # Native Host manifest template
```

## Version History

### v1.2.2 (2026-06-21)

**Revert**
- Reverted v1.2.1's `Script.js` approach: no longer writes to default global `Script.js`, no longer modifies `profiles.yaml`'s `option.script` field
- Restored v1.2.0's logic: `Get-ScriptPath` resolves the script file pointed to by current profile's `option.script` (e.g. `s8XWAjDjLilq.js`), writes rules to that file
- Removed `Set-ProfileScript` function and its call in `initScriptFile`
- Each subscription's extension script is maintained independently; rules don't cross subscriptions when switching

**Notes**
- Clash Verge Rev's each remote/local profile references an independent type:script script via `option.script`
- This extension writes rules to the active profile's extension script file, prepends `EXT_RULES` to `config.rules` via `main(config)` function
- After adding rules, restart Clash Verge Rev to re-execute the script

### v1.2.1 (2026-06-21)

**Bug Fix**
- Fixed extension script rules not taking effect: `Get-ScriptPath` was resolving current profile's `option.script` (e.g. `s8XWAjDjLilq.js`), but users wanted to write to default global `Script.js`
- `Get-ScriptPath` now directly returns `Script.js` path (Clash Verge Rev's preset UID=Script type:script profile)
- Added `Set-ProfileScript` function: modifies profiles.yaml to change current profile's `option.script` field to `Script`, making Clash Verge Rev execute `Script.js`
- `initScriptFile` action now auto-calls `Set-ProfileScript` after init, no manual UI switching needed

**Notes**
- Clash Verge Rev has no real "global extension script" concept; `Script.js` is just a preset empty script template
- Each remote/local profile references the script to execute via `option.script` field
- This extension modifies `option.script` to `Script`, making `Script.js` the current profile's extension script

### v1.2.0 (2026-06-21)

**Major Feature Update**

1. **Removed hot-reload, replaced with restart prompt**
   - Hot-reload mechanism (PUT /configs {payload}) was unstable in testing, removed
   - After adding/deleting rules, prompts user "Rules modified, please restart Clash to take effect"
   - Kept the bottom "Restart Clash" button for one-click rule sync and kernel restart

2. **Added "Extension Script Rules" feature**
   - Added "Extension Script Rules" section above "Built-in Clash Rules", displaying rules from EXT_RULES array in Clash Verge Rev's Script.js
   - Rules written to Clash Verge Rev's type:script profile (Script.js), prepends EXT_RULES to config.rules via main(config) function
   - Added "Write domains to extension script rules" checkbox in settings; when checked, F2/F3 added rules go directly to Script.js instead of YAML config
   - Extension script rules list supports single deletion (click ✕ button)
   - When file is uninitialized or corrupted, shows "Initialize" button; clicking auto-backs up original and writes standard template
   - Script.js standard format includes `// === ClashOmega Extension Rules ===` marker for detecting management by this extension

3. **UI Adjustments**
   - Renamed "All Clash Rules" to "Built-in Clash Rules"
   - Direct mode (direct) white icon gets black outline to avoid blending with Chrome's light toolbar

**Native Host New Actions**
- `getScriptPath`: Get Script.js file path and status (exists/managed)
- `getScriptRules`: Get EXT_RULES array rule list
- `initScriptFile`: Initialize Script.js to standard extension script format (backs up original)
- `addRule`/`removeRule`: Added `useScript` parameter; true operates on Script.js, false on YAML config

### v1.1.7 (2026-06-21)

**Improvement**
- F1 "Check which proxy group current domain is in" now shows prompt in non-Clash proxy modes (system proxy/direct): "Cannot detect domain proxy group in current mode, please switch to 'Clash Proxy' mode"
- Reason: In non-Clash proxy modes, browser doesn't go through Clash, `/connections` won't have active connections for that domain, F1 can't detect actual proxy group
- Auto re-initializes popup after mode switch, updates F1 detection status (uses flag to avoid duplicate event binding)
- Rule list still viewable in non-Clash mode, just no domain match detection

### v1.1.6 (2026-06-21)

**Bug Fix**
- Fixed F1 "Detect domain's proxy group" only showing MATCH: when subscription rules are mostly `RuleSet` type, local matching can't process them (browser can't parse RuleSet), only `Match` fallback matches
- `findMatchingRulesFromConnections` added `sniffHost` fallback: mihomo's `metadata.host` may be empty (IP direct or DNS unresolved), but `sniffHost` (TLS SNI / HTTP Host sniffing result) may have value
- Improved override strategy: when local match is only MATCH, any `/connections` match (including MATCH) also overrides local result, because `chains` contains actual proxy group info, more valuable than local MATCH

### v1.1.5 (2026-06-21)

**Bug Fix**
- Fixed hot-reload not working: `hotReloadConfig` used `{...config, rules: [...]}` PUT to `/configs`, but mihomo kernel's `PUT /configs` ignores `rules` field updates. Changed to `{"payload": yamlContent}` method, passing complete snapshot YAML content directly, kernel actually reloads rules
- `syncSnapshot` action returns `snapshotContent` field (complete snapshot file content) for extension to hot-reload via `{payload}` method

### v1.1.4 (2026-06-21)

**Bug Fix**
- Fixed F1 domain match keyword extraction error: multi-segment TLD domains (e.g. `.com.tw`, `.co.uk`) caused `domainKey` to get TLD part (`com`) instead of domain主体, making all `.com` connections misjudged as matching current domain,表现为 "current domain matches wrong proxy group"
- `findMatchingRulesFromConnections` changed to strict domain matching: `host === domain` exact match, `host is subdomain of domain`, `domain is subdomain of host` three cases, no longer uses `host.includes(keyword)` contains matching

### v1.1.3 (2026-06-21)

**Bug Fix**
- Fixed rule deletion not working: Clash API returns camelCase type (`DomainSuffix`) vs YAML file uppercase format (`DOMAIN-SUFFIX`) mismatch, `Remove-Rule` normalizes comparison then correctly deletes
- Fixed duplicate rule addition: `Add-Rule` detects same type+payload duplicate rule, uses `$lines[$overrideIdx] = $newLine` to replace original line instead of `Insert` new line
- Fixed hot-reload not working: `scheduleHotReload` missing `syncSnapshotRules` step, causing Clash kernel `/rules` and `/connections` API to still read old snapshot, "Check domain's group" shows no change after add/delete rules

### v1.1.2 (2026-06-21)

**Bug Fix**
- Fixed placeholder still showing Chinese after language switch: `refreshAllI18n` didn't handle `placeholder` and `title` attributes
- Added `data-i18n-placeholder` and `data-i18n-title` attribute support, syncs update on language switch

**i18n Improvements**
- Added `settings_secret_placeholder`, `settings_config_path_placeholder`, `settings_close` three-language keys
- Fixed "Close" button missing `data-i18n` attribute causing Chinese to persist after language switch
- Fixed "(Optional)" "Auto-detect" etc. placeholders not updating after language switch

### v1.1.1 (2026-06-21)

**Bug Fix**
- Fixed hot-reload not working after add/delete rules: `scheduleHotReload` didn't pass `configPath`, causing Native Host auto-detection to fail or read wrong file
- Add/delete rules now carry user's `clashConfigPath` to trigger hot-reload

**UI Improvement**
- Renamed "Sync Rules to Kernel" button to "Restart Clash", simpler to understand
- Synced three-language text (zh_CN / en / ja)

### v1.1.0 (2026-06-21)

**New Features**
- Domain match detection fallback to Clash API `/connections`, supports RULE-SET and other rule types that can't be parsed in browser
- Auto-detect Clash Verge Rev active profile (prioritizes parsing `profiles.yaml`'s `current` field)
- Auto hot-reload after add/delete rules (500ms debounce)
- "Sync Rules to Kernel" button: write snapshot + restart kernel

**Bug Fixes**
- Fixed `Join-Path` three-argument call causing `restartClash` Step 1 failure (Windows PowerShell 5.1 compatibility)
- Fixed `Parse-Rules` returning `$null` causing snapshot rules to be cleared, all nodes disconnected
- Fixed `Get-ConfigPath` selecting empty rule template instead of active profile
- Fixed `Add-Rule` writing double single quotes causing YAML parse failure, proxy crash
- Fixed `Remove-Rule` not trimming single quotes causing rule deletion to not work
- Fixed F1 delete button crashing in `.matched-rule-item` container when `closest('.rule-item')` returns null
- Fixed `hotReloadConfig` `rules.filter is not a function` (`{}` not array)
- Removed duplicate "Sync Rules to Kernel" button in settings panel

### v1.0.1

- Initial version: tri-mode switching, rule add/delete, domain detection, multi-language

## Compatibility

- **Browser**: Chrome / Edge / other Chromium-based browsers (MV3 support required)
- **Proxy Kernel**: This extension is developed and tested on **Clash Verge Rev**. Other Clash kernels (Clash for Windows / Mihomo etc.) are untested, may work but not guaranteed
- **OS**: Windows (Native Host depends on PowerShell)

## Related Recommendation

### [sublink-worker](https://github.com/ciskonc/sublink-worker)

> One Worker, All Subscriptions — Lightweight subscription converter and manager, deployable on Cloudflare Workers / Vercel / Node.js / Docker.

**Forked from** [7Sageer/sublink-worker](https://github.com/7Sageer/sublink-worker) with the following key enhancements:

#### New Features

- **AnyTLS Protocol Support** — Added `anytls://` protocol parser. AnyTLS links are correctly parsed and converted to native AnyTLS nodes in Clash / Sing-Box output (upstream silently drops them)
- **GFWList Rule** — Added GFWList rule group based on `geosite:category-gfw`, defaults to proxy
- **GFWList Auto-merge** — When GFWList is selected without Social Media / Google / Youtube / Github, auto-pulls `twitter/google/youtube/github/gitlab` site rules, fixes domains like `x.com` that are GFW-blocked but classified under `geosite:twitter` instead of `category-gfw` in v2fly

#### Rule Default Adjustments (Whitelist Mode)

- **Non-China domains** and **Fallback rule** default to **DIRECT** (upstream: Node Select)
- **GFWList** defaults to **Node Select** (proxy)
- Rule priority: specific rules (Google / Telegram / Github...) > GFWList > Non-China (DIRECT) > Fallback (DIRECT)
- Implements **whitelist proxy mode**: only GFW-blocked domains go through proxy, everything else is direct

#### Multi-Subscription Merge Fix

- **Proxy-provider disabled** — Subscriptions returning Clash YAML format no longer auto-converted to `proxy-providers`. All nodes from all subscriptions are inlined into final config, preventing runtime fetch failures caused by UA restrictions or token auth
- **Proxy-groups isolation** — Subscription-sourced `proxy-groups` are no longer merged into output config. Only rule groups selected in web UI will appear

#### Supported Protocols

ShadowSocks, VMess, VLESS, **AnyTLS**, Hysteria2, Trojan, TUIC

#### Client Support

Sing-Box, Clash (Meta/Mihomo), Xray/V2Ray, Surge

Can be used with this extension: sublink-worker handles subscription conversion and node generation, ClashOmega handles runtime rule management and domain match detection.

## Acknowledgements

- **[MagicalYu](https://github.com/MagicalYuYu)** — Chief guinea pig & AI coding whisperer. Throughout this project's development, he patiently tested every bug repeatedly and wielded unique "whispering" skills to make the AI produce usable code. Without his sacrifice (and countless "this doesn't work, try again"), ClashOmega wouldn't exist today. 🧪✨

## License

MIT License
