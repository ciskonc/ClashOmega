// Clash Manager — Service Worker (Background)
// 导入所有模块
importScripts(
  'lib/proxy-manager.js',
  'lib/clash-api.js',
  'lib/native-bridge.js',
  'lib/domain-detector.js'
);

// ──── 初始化 ────

// 启动域名检测器
initDomainDetector();

// 初始化默认设置
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({
      settings: {
        currentMode: 'system',
        clashApiUrl: 'http://127.0.0.1:9090',
        clashSecret: '',
        clashProxyHost: '127.0.0.1',
        clashProxyPort: 7890,
        language: 'zh_CN'
      }
    });
  }
});

// ──── 消息路由 ────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // 保持异步响应通道
});

async function handleMessage(message) {
  try {
    switch (message.action) {
      // ──── 状态查询 ────
      case 'getStatus': {
        const settings = await getSettings();
        const config = await getClashConfig();
        const clashRunning = config !== null;
        // 串行调用 Native Host（避免并发导致 native messaging 队列问题）
        const nativeHostInstalled = await checkNativeHost();
        const sysProxy = await getSystemProxyStatus();
        const proxyPort = clashRunning
          ? extractProxyPort(config, settings.clashProxyHost).port
          : settings.clashProxyPort;
        return {
          mode: settings.currentMode,
          clashRunning,
          config,
          proxyPort,
          sysProxy: sysProxy.success ? sysProxy : null,
          nativeHostInstalled,
          clashProxyHost: settings.clashProxyHost,
          clashProxyPort: settings.clashProxyPort
        };
      }

      // ──── 模式切换 ────
      case 'setMode': {
        const settings = await getSettings();
        const oldMode = settings.currentMode;
        let clashProxy = {
          host: settings.clashProxyHost,
          port: settings.clashProxyPort
        };

        // Clash 模式：优先从 API 获取实际代理端口（mixed-port / port）
        if (message.mode === 'clash') {
          try {
            const config = await getClashConfig();
            if (config) {
              const detected = extractProxyPort(config, settings.clashProxyHost);
              clashProxy = detected;
              // 同步更新保存的端口，下次离线时也能用
              settings.clashProxyPort = detected.port;
              console.log(`Clash Manager: detected proxy port ${detected.port} from Clash config`);
            }
          } catch (e) {
            // 离线时回退到已保存的端口
            console.log('Clash Manager: cannot detect proxy port, using saved:', settings.clashProxyPort);
          }
        }

        await setProxyMode(message.mode, clashProxy);
        settings.currentMode = message.mode;
        await chrome.storage.local.set({ settings });
        await setActionIcon(message.mode);

        // 模式发生实际变化时刷新当前标签页（同模式切换无需刷新）
        if (oldMode && oldMode !== message.mode) {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id) {
              chrome.tabs.reload(tab.id);
            }
          } catch (e) {
            console.log('Clash Manager: tab reload failed:', e.message);
          }
        }

        return { success: true, proxyPort: clashProxy.port };
      }

      // ──── Clash 规则读取（REST API） ────
      case 'getClashRules': {
        const data = await getClashRules();
        return { success: data !== null, rules: data?.rules || [] };
      }

      // ──── Clash 代理组列表 ────
      case 'getProxies': {
        const proxies = await getClashProxies();
        return { success: true, proxies };
      }

      // ──── Clash 状态 ────
      case 'getClashConfig': {
        const config = await getClashConfig();
        return { success: config !== null, config };
      }

      // ──── 规则管理（Native Host 写入 + Clash API 热重载）────
      // 写入成功后立即返回，热重载异步执行，避免串行等待导致弹窗卡顿
      case 'addRule': {
        const settings = await getSettings();
        const result = await addClashRule(message.rule, settings.clashConfigPath);
        if (result && result.success) {
          // 异步热重载，不阻塞响应（传入 configPath 避免自动检测失败）
          scheduleHotReload(settings.clashConfigPath);
        }
        return result;
      }

      case 'batchAddRules': {
        const settings = await getSettings();
        const result = await batchAddClashRules(message.rules, settings.clashConfigPath);
        if (result && result.success) {
          scheduleHotReload(settings.clashConfigPath);
        }
        return result;
      }

      case 'removeRule': {
        const settings = await getSettings();
        const result = await removeClashRule(message.rule, settings.clashConfigPath);
        if (result && result.success) {
          scheduleHotReload(settings.clashConfigPath);
        }
        return result;
      }

      // ──── 域名检测 ────
      case 'getPageDomains': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const domains = getTabDomains(tab.id);
        const count = getTabDomainCount(tab.id);
        return { success: true, domains, count };
      }

      // ──── 域名连接查询（通过 Clash API /connections 查询域名实际匹配的规则）────
      case 'getDomainConnections': {
        const connections = await getClashConnections();
        if (!connections || !connections.connections) {
          return { success: false, error: 'Cannot get connections from Clash API' };
        }
        return { success: true, connections: connections.connections };
      }

      // ──── 设置管理 ────
      case 'getSettings': {
        return await getSettings();
      }

      case 'saveSettings': {
        await chrome.storage.local.set({ settings: message.settings });
        return { success: true };
      }

      // ──── Clash 服务管理 ────
      case 'setConfigPath': {
        const result = await sendToNative({ action: 'setConfigPath', path: message.path });
        return result;
      }

      case 'ping': {
        const result = await sendToNative({ action: 'ping' });
        return result;
      }

      case 'restartClash': {
        const settings = await getSettings();
        console.log('[restartClash] Step 1: Reading rules from profile file...');
        const yamlResult = await getClashYamlRules(settings.clashConfigPath);
        // 使用 Array.isArray 严格检查，防止 rules 为 {} 等非数组 truthy 值通过检查
        if (!yamlResult || !yamlResult.success || !Array.isArray(yamlResult.rules)) {
          console.error('[restartClash] FAILED at step 1: cannot read profile rules', yamlResult);
          return { success: false, error: 'Cannot read rules from profile file (invalid)' };
        }
        console.log(`[restartClash] Step 1 OK: ${yamlResult.rules.length} rules read`);

        // 仅当有规则时才同步到快照，避免空规则清空快照文件
        if (yamlResult.rules.length > 0) {
          console.log('[restartClash] Step 2: Syncing rules to snapshot...');
          const syncResult = await syncSnapshotRules(yamlResult.rules);
          if (!syncResult || !syncResult.success) {
            console.error('[restartClash] FAILED at step 2: snapshot sync failed', syncResult);
            return { success: false, error: syncResult?.error || 'Failed to sync snapshot' };
          }
          console.log(`[restartClash] Step 2 OK: snapshot synced to ${syncResult.snapshotPath}`);
        } else {
          console.log('[restartClash] Step 2 SKIPPED: no rules to sync (profile append is empty)');
        }

        console.log('[restartClash] Step 3: Calling POST /restart...');
        const restarted = await restartKernel();
        if (!restarted) {
          console.error('[restartClash] FAILED at step 3: POST /restart failed (check API URL & secret in settings)');
          return { success: false, error: 'Clash API unreachable — check API URL & secret in settings' };
        }
        console.log('[restartClash] Step 3 OK: kernel restarted successfully');
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown action: ${message.action}` };
    }
  } catch (e) {
    console.error(`Handle message error (${message.action}):`, e);
    return { success: false, error: e.message };
  }
}

// ──── 异步热重载（防抖：500ms 内多次调用只执行最后一次）────

let hotReloadTimer = null;
let pendingHotReloadPath = null;  // 缓存最近一次增删操作的 configPath

function scheduleHotReload(configPath) {
  // 缓存 configPath，避免定时器触发时丢失路径导致 Native Host 自动检测失败
  if (configPath) pendingHotReloadPath = configPath;
  if (hotReloadTimer) clearTimeout(hotReloadTimer);
  hotReloadTimer = setTimeout(async () => {
    hotReloadTimer = null;
    const pathToUse = pendingHotReloadPath;
    pendingHotReloadPath = null;
    try {
      // 从 profile 文件读取规则（Native Host），而非内核 API
      // 内核 GET /rules 返回的是旧快照的规则，profile 文件才是最新数据
      // 必须传入 configPath，否则 Native Host 自动检测可能失败或选错文件
      const yamlResult = await getClashYamlRules(pathToUse);
      // 使用 Array.isArray 严格检查，防止 rules 为 {} 等非数组 truthy 值导致后续调用崩溃
      if (yamlResult && yamlResult.success && Array.isArray(yamlResult.rules) && yamlResult.rules.length > 0) {
        // 步骤 1：同步规则到快照文件（clash-verge.yaml）
        // 必须先写快照，否则 Clash 内核 /rules 和 /connections API 仍读取旧快照，
        // 导致"检查当前域名在那个组"看不到新规则
        const syncResult = await syncSnapshotRules(yamlResult.rules);
        if (syncResult && syncResult.success) {
          console.log(`Clash Manager: snapshot synced to ${syncResult.snapshotPath}`);
          // 步骤 2：PUT /configs?force=true with {payload: content}
          // 用快照文件内容作为 payload，让内核重新加载完整配置（含最新 rules）
          // mihomo 的 {path} 方式返回 "Body invalid"，只能用 {payload} 方式
          const ok = await hotReloadConfig(syncResult.snapshotContent);
          console.log(`Clash Manager: async hot-reload ${ok ? 'succeeded' : 'failed'} (payload from ${syncResult.snapshotPath})`);
        } else {
          console.warn('Clash Manager: snapshot sync failed, hot-reload aborted', syncResult);
        }
      } else {
        console.warn('Clash Manager: async hot-reload skipped (no valid rules from profile)', yamlResult);
      }
    } catch (e) {
      console.error('Clash Manager: async hot-reload error:', e.message);
    }
  }, 500);
}

// ──── 初始化 ────
async function init() {
  const settings = await getSettings();
  await setProxyMode(settings.currentMode, {
    host: settings.clashProxyHost,
    port: settings.clashProxyPort
  });
  await setActionIcon(settings.currentMode);
}

// 根据模式切换扩展图标颜色
async function setActionIcon(mode) {
  const base = 'icons/';
  const sizes = { 16: 'icon16', 48: 'icon48', 128: 'icon128' };
  const path = {};
  for (const [size, prefix] of Object.entries(sizes)) {
    path[size] = `${base}${prefix}_${mode}.png`;
  }
  try {
    await chrome.action.setIcon({ path });
  } catch (e) {
    console.warn('setActionIcon failed:', e.message);
  }
}

init();