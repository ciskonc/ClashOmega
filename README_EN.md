# ClashOmega

> Chrome extension for managing Clash proxy rules. Inspired by SwitchyOmega / ZeroOmega.

<div align="center">

<img src="extension/icons/logo128_white.png" width="128" height="128" alt="ClashOmega Logo">

[![Version](https://img.shields.io/badge/version-1.4.3-blue?style=flat-square)](https://github.com/ciskonc/ClashOmega)
[![Platform](https://img.shields.io/badge/platform-Chromium%20Browsers-green?style=flat-square)](https://github.com/ciskonc/ClashOmega)
[![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square)](LICENSE)
[![Manifest](https://img.shields.io/badge/Manifest-V3-purple?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[🌐 Website](https://magicalyuyu.github.io/ClashOmega/) · [English](README_EN.md) · [中文](README.md) · [Changelog](CHANGELOG.md)

</div>

---

## UI Preview

<table>
  <tr>
    <td align="center"><img src="docs/ui-overview.png" width="280" alt="UI Overview"><br>Extension Icon & Chrome Toolbar</td>
    <td align="center"><img src="docs/ui-rules.png" width="280" alt="UI Rules"><br>Clash Rules + Extension Script Rules</td>
    <td align="center"><img src="docs/ui-popup.png" width="280" alt="UI Main"><br>Node Settings</td>
  </tr>
</table>

## Features

### Core Features

| Feature | Description |
|---------|-------------|
| Tri-mode Switching | System Proxy → Direct → Clash Proxy, one-click switch with real-time icon color change |
| Domain Match Detection | Detects which Clash rule the current domain matches, shows the matched group and policy (supports RULE-SET fallback to `/connections` API) |
| Quick Rule Add | Add current domain to a proxy group (dynamically fetches Clash proxy group list) |
| Smart Domain Grouping | Detects all domains on the page, auto-groups suggestions (e.g. `i1.art.com`, `i2.art.com` → `*.art.com`) |
| System Proxy Status | Real-time system proxy status (Native Host registry read + browser proxy API fallback, compatible with some Chromium-based browsers) |
| Rule Management | View, add, delete rules in Clash YAML config file (auto hot-reload after changes) |
| Restart Clash | One-click sync profile rules to Clash Verge Rev snapshot file and restart kernel (use when hot-reload fails) |

### UI/UX Features (v1.3.0 New)

| Feature | Description |
|---------|-------------|
| Four-tab Layout | Proxy / Rules / Domain / Settings tabs, supports drag-and-drop sorting and cross-tab module migration |
| Multi-theme System | MD3 Light / MD3 Dark / Auto Follow System |
| Global Font Scale | 70%-130% font size adjustment, real-time preview |
| Rule Pagination & Search | Configurable page size (10/20/30/50/100/3000) + 200ms debounce search |
| Multi-language | 简体中文 / English / 日本語 |

### Installation & Security (v1.3.0 New)

| Feature | Description |
|---------|-------------|
| Auto Install Script | `install.ps1` supports Chrome browser Native Host auto-registration |
| Clash API Auto-discovery | Reads port from Clash Verge Rev config file + port scanning + 401 auth detection |
| Security Hardening | Fixed 13 security vulnerabilities (XSS, path traversal, process injection, missing CSP, etc.) |

## Installation

### Option 1: Auto Install (Recommended)

1. Right-click `native-host/install.ps1` → **Run with PowerShell**
2. The script will auto-register Native Host and generate config files
3. Done

> Prerequisite: PowerShell script execution must be enabled (see below)

### Option 2: Manual Install

#### 1. Load Extension

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `extension/` directory

#### 2. Install Native Messaging Host

Native Host is used to read/write Clash local YAML config files (Windows only).

<details>
<summary>📖 Enable PowerShell Script Execution (click to expand)</summary>

> Native Host relies on PowerShell scripts (`.ps1`). Windows blocks scripts by default, so you must enable execution first, otherwise Native Host won't start.

Option 1 (Recommended): Windows Settings
1. Open "Settings" → "Privacy & security" → "For developers" (Windows 11: "Settings" → "System" → "For developers")
2. Find "PowerShell" → "Change execution policy to allow local PowerShell scripts to run without signing" → Enable

Option 2: PowerShell Command
1. Open PowerShell as Administrator
2. Run: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`
3. Type `Y` to confirm

</details>

1. Find ClashOmega in `chrome://extensions/` and copy its ID
2. Right-click `native-host/install.ps1` → **Run with PowerShell**
3. Paste the extension ID and press Enter
4. Reload the extension

#### 3. Configure Clash API

1. Click the extension icon → Settings (gear button)
2. Fill in Clash API URL (default `http://127.0.0.1:9097`) and secret
3. Leave config path empty for auto-detection (supports Clash Verge Rev `profiles.yaml`)

---

<details>
<summary>📖 Usage Guide (click to expand)</summary>

### Do rule changes take effect automatically?

Yes. After adding/deleting rules, the extension auto hot-reloads config via Clash API `/configs?force=true` (500ms debounce).

The "Restart Clash" button at the bottom is a more thorough approach: writes profile rules to Clash Verge Rev snapshot file (`clash-verge.yaml`) and restarts the kernel. Use it only when hot-reload fails.

### Why don't my custom rules work?

Clash kernel matches rules top-to-bottom — the first matching rule wins. If your custom rule is placed after `RULE-SET,...` and the domain is included in that rule set, your custom rule will never be hit.

Solution: Move custom rules to the top of the rules list (before `RULE-SET`).

### Why does domain match show as fallback rule (MATCH)?

Possible reasons:
1. The domain doesn't match any rule and falls through to the `MATCH` fallback
2. The rule type is `RULE-SET`, which can't be parsed in the browser. The extension falls back to Clash API `/connections` to query the actual match (requires an active connection for that domain)

> Note: The proxy group name for the MATCH fallback rule is determined by your subscription config (e.g. "Final", "漏网之鱼"). The extension only displays the actual match result.

### Why does system proxy status show abnormal? (v1.3.0 Improvement)

Some Chromium-based browsers have abnormal Native Host support, preventing system proxy reading via registry. v1.3.0 adds `chrome.proxy.settings.get()` browser API as fallback, supporting 5 proxy mode detection (direct / auto_detect / pac_script / fixed_servers / system).

</details>

---

<details>
<summary>🔧 Tech Stack & Project Structure (click to expand)</summary>

## Tech Stack

- Frontend: Chrome Extension Manifest V3 + Vanilla JS + CSS3 (MD3)
- Backend: Native Messaging Host (PowerShell)
- Communication: `chrome.runtime.sendMessage` + `chrome.runtime.sendNativeMessage`
- API: Clash REST API (`GET /configs`, `/rules`, `/proxies`, `/connections`)

## Project Structure

```
extension/          # Chrome extension
├── manifest.json   # MV3 manifest (with CSP)
├── background.js   # Service Worker (message routing + hot-reload)
├── lib/            # Modules
│   ├── clash-api.js       # Clash REST API wrapper
│   ├── native-bridge.js   # Native Host bridge (with sendToNativeSafe)
│   ├── proxy-manager.js   # Proxy mode switching
│   └── domain-detector.js # Page domain detection
├── popup/          # Popup UI
│   ├── popup.html   # Four-tab structure
│   ├── popup.js     # Tab system + drag-sort + theme switch + domain match + rule add/delete
│   └── popup.css    # MD3 multi-theme styles
├── locales/        # i18n files (zh_CN / en / ja)
└── icons/          # Mode icons

native-host/        # Native Messaging Host (Windows)
├── install.ps1              # Installer (registers Native Host)
├── clash_rules_manager.bat  # Entry point
├── clash_rules_manager.ps1  # Main program (YAML read/write + system proxy query)
└── com.clash.omega.json     # Native Host manifest template
```

</details>

## Compatibility

- Browser: Chrome / Edge / 360 / QQ / Brave / Opera / Vivaldi and other Chromium-based browsers (MV3 support required)
- Proxy Kernel: This extension is developed and tested on Clash Verge Rev. Other Clash kernels (Clash for Windows / Mihomo etc.) are untested, may work but not guaranteed
- OS: Windows (Native Host depends on PowerShell 5.1+)

---

<details>
<summary>📦 Related: sublink-worker (click to expand)</summary>

### [sublink-worker](https://github.com/ciskonc/sublink-worker)

> One Worker, All Subscriptions — Lightweight subscription converter and manager, deployable on Cloudflare Workers / Vercel / Node.js / Docker.

Forked from [7Sageer/sublink-worker](https://github.com/7Sageer/sublink-worker) with the following key enhancements:

#### New Features

- AnyTLS Protocol Support — Added `anytls://` protocol parser. AnyTLS links are correctly parsed and converted to native AnyTLS nodes in Clash / Sing-Box output (upstream silently drops them)
- GFWList Rule — Added GFWList rule group based on `geosite:category-gfw`, defaults to proxy
- GFWList Auto-merge — When GFWList is selected without Social Media / Google / Youtube / Github, auto-pulls `twitter/google/youtube/github/gitlab` site rules, fixes domains like `x.com` that are GFW-blocked but classified under `geosite:twitter` instead of `category-gfw` in v2fly

#### Rule Default Adjustments (Whitelist Mode)

- Non-China domains and Fallback rule default to DIRECT (upstream: Node Select)
- GFWList defaults to Node Select (proxy)
- Rule priority: specific rules (Google / Telegram / Github...) > GFWList > Non-China (DIRECT) > Fallback (DIRECT)
- Implements whitelist proxy mode: only GFW-blocked domains go through proxy, everything else is direct

#### Multi-Subscription Merge Fix

- Proxy-provider disabled — Subscriptions returning Clash YAML format no longer auto-converted to `proxy-providers`. All nodes from all subscriptions are inlined into final config, preventing runtime fetch failures caused by UA restrictions or token auth
- Proxy-groups isolation — Subscription-sourced `proxy-groups` are no longer merged into output config. Only rule groups selected in web UI will appear

#### Supported Protocols

ShadowSocks, VMess, VLESS, AnyTLS, Hysteria2, Trojan, TUIC

#### Client Support

Sing-Box, Clash (Meta/Mihomo), Xray/V2Ray, Surge

Can be used with this extension: sublink-worker handles subscription conversion and node generation, ClashOmega handles runtime rule management and domain match detection.

</details>

<details>
<summary>🤖 Related: AOS — Agent Operating System (click to expand)</summary>

### [AOS](https://github.com/MagicalYuYu/agent-operating-system)

> Self-decompose → Self-execute → Self-verify → Self-evolve

A pure file-system-driven Agent collaboration framework with zero code dependencies. Through structured directories and rule files, it enables AI Agents to maintain state consistency, knowledge accumulation, and task coordination across multiple sessions. ClashOmega v1.3.0 was developed entirely using the AOS framework.

- **Pure File System**: All state, memory, and knowledge stored in disk files, no runtime memory dependency
- **Multi-session Coordination**: Independent Agent instances in different conversations interact via the file system
- **Skill/Loop/Agent Modularization**: Evolvable tool system with continuous experience and pitfall accumulation
- **Maker/Checker Separation**: The same task is never both executed and verified in the same session

</details>

## Acknowledgements

- [Clash](https://github.com/Dreamacro/clash) — The Clash kernel created by Dreamacro, the core proxy engine controlled by this project
- [mihomo](https://github.com/MetaCubeX/mihomo) — Formerly Clash.Meta, the proxy kernel used by default in Clash Verge Rev, which this project actually depends on at runtime
- [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) — Tauri-based Clash GUI client, the primary runtime environment for development and testing. Its config file format and extension script mechanism provide the foundation for rule management
- [SwitchyOmega](https://github.com/FelisCatus/SwitchyOmega) / [ZeroOmega](https://github.com/zero-peak/ZeroOmega) — The inspiration for this project, honoring their pioneering work in browser proxy management
- [MagicalYu](https://github.com/MagicalYuYu) — Chief guinea pig & AI coding whisperer. Throughout this project's development, he patiently tested every bug repeatedly and wielded unique "whispering" skills to make the AI produce usable code. Without his sacrifice (and countless "this doesn't work, try again"), ClashOmega wouldn't exist today.
- This project is built with [AOS](https://aos.magicalyu.online/) (Agent Operating System) framework

---

## Version History

For complete version history, see [CHANGELOG.md](CHANGELOG.md).

## License

MIT License
