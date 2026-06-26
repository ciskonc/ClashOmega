// ClashOmega — Service Worker (Background)
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
              console.log(`ClashOmega: detected proxy port ${detected.port} from Clash config`);
            }
          } catch (e) {
            // 离线时回退到已保存的端口
            console.log('ClashOmega: cannot detect proxy port, using saved:', settings.clashProxyPort);
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
            console.log('ClashOmega: tab reload failed:', e.message);
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
      // 写入成功后返回，用户需手动重启 Clash 生效
      case 'addRule': {
        const settings = await getSettings();
        const useScript = settings.useScriptRule === true;
        const result = await addClashRule(message.rule, settings.clashConfigPath, useScript);
        return result;
      }

      case 'batchAddRules': {
        const settings = await getSettings();
        const useScript = settings.useScriptRule === true;
        // useScript=true 时逐条写入 Script.js（Native Host 已支持）
        if (useScript) {
          let added = 0;
          for (const rule of message.rules) {
            const r = await addClashRule(rule, settings.clashConfigPath, true);
            if (r && r.success) added++;
          }
          return { success: true, message: `${added} rules added to script` };
        }
        const result = await batchAddClashRules(message.rules, settings.clashConfigPath);
        return result;
      }

      case 'removeRule': {
        const settings = await getSettings();
        // 优先使用消息中的 useScript（来自扩展脚本规则列表的删除按钮），
        // 否则使用设置中的 useScriptRule
        const useScript = message.useScript === true || (message.useScript === undefined && settings.useScriptRule === true);
        const result = await removeClashRule(message.rule, settings.clashConfigPath, useScript);
        return result;
      }

      // ──── Script.js 扩展脚本规则管理 ────
      case 'getScriptPath': {
        return await getScriptPath();
      }

      case 'getScriptRules': {
        return await getScriptRules();
      }

      case 'initScriptFile': {
        return await initScriptFile();
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
        const result = await sendToNativeSafe({ action: 'setConfigPath', path: message.path });
        return result;
      }

      case 'ping': {
        const result = await sendToNativeSafe({ action: 'ping' });
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

        // Step 2: 读取扩展脚本的 customRules，前置到 profile 规则列表
        // 关键：Clash Verge Rev 生成 clash-verge.yaml 时才执行扩展脚本，
        // 但我们直接修改 clash-verge.yaml 不会触发脚本执行，
        // 所以需要手动读取扩展脚本的规则并前置到合并后的规则列表
        let mergedRules = yamlResult.rules;
        console.log('[restartClash] Step 2: Reading script rules...');
        const scriptResult = await getScriptRules();
        if (scriptResult && scriptResult.success && Array.isArray(scriptResult.rules) && scriptResult.rules.length > 0) {
          console.log(`[restartClash] Step 2 OK: ${scriptResult.rules.length} script rules read, prepending to profile rules`);
          mergedRules = [...scriptResult.rules, ...yamlResult.rules];
        } else {
          console.log('[restartClash] Step 2 SKIPPED: no script rules or script not initialized');
        }

        // Step 3: 同步合并后的规则到快照（包含扩展脚本规则）
        if (mergedRules.length > 0) {
          console.log('[restartClash] Step 3: Syncing merged rules to snapshot...');
          const syncResult = await syncSnapshotRules(mergedRules);
          if (!syncResult || !syncResult.success) {
            console.error('[restartClash] FAILED at step 3: snapshot sync failed', syncResult);
            return { success: false, error: syncResult?.error || 'Failed to sync snapshot' };
          }
          console.log(`[restartClash] Step 3 OK: snapshot synced to ${syncResult.snapshotPath}`);
        } else {
          console.log('[restartClash] Step 3 SKIPPED: no rules to sync');
        }

        // Step 4: 优先尝试 PUT /configs {path} 热重载（不中断代理）
        console.log('[restartClash] Step 4: Trying PUT /configs reload (no proxy interruption)...');
        const snapshotPathResult = await getSnapshotPath();
        if (snapshotPathResult && snapshotPathResult.success && snapshotPathResult.snapshotPath) {
          const reloaded = await reloadConfigFromPath(snapshotPathResult.snapshotPath);
          if (reloaded) {
            console.log('[restartClash] Step 4 OK: config reloaded via PUT /configs');
            // Step 4.5: 关闭所有活跃连接，强制新连接重新匹配最新规则
            // 根因：PUT /configs 热重载只更新配置，不断开已建立连接；
            //       Clash 规则匹配只在连接建立时进行，旧连接不会重新匹配新规则。
            //       不关闭连接会导致用户感觉"重启 Clash 不生效"。
            console.log('[restartClash] Step 4.5: Closing all active connections to force rule re-match...');
            const closed = await closeAllConnections();
            if (closed) {
              console.log('[restartClash] Step 4.5 OK: all connections closed');
            } else {
              console.warn('[restartClash] Step 4.5 WARN: failed to close connections (rules will take effect on new connections only)');
            }
            return { success: true, method: 'reload' };
          }
          console.warn('[restartClash] Step 4 FAILED: PUT /configs failed, falling back to POST /restart');
        } else {
          console.warn('[restartClash] Step 4 SKIPPED: cannot get snapshot path, falling back to POST /restart');
        }

        // Step 5: 兜底 POST /restart（会短暂中断代理）
        console.log('[restartClash] Step 5: Calling POST /restart (fallback)...');
        const restarted = await restartKernel();
        if (!restarted) {
          console.error('[restartClash] FAILED at step 5: POST /restart failed (check API URL & secret in settings)');
          return { success: false, error: 'Clash API unreachable — check API URL & secret in settings' };
        }
        console.log('[restartClash] Step 5 OK: kernel restarted successfully');
        return { success: true, method: 'restart' };
      }

      default:
        return { success: false, error: `Unknown action: ${message.action}` };
    }
  } catch (e) {
    console.error(`Handle message error (${message.action}):`, e);
    return { success: false, error: e.message };
  }
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