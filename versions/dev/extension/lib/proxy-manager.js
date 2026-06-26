// chrome.proxy 三模式切换封装
// 三种模式均只控制浏览器自身代理，不触碰系统代理设置
const PROXY_MODES = {
  SYSTEM: 'system',
  DIRECT: 'direct',
  CLASH:  'clash'
};

/**
 * 从 Clash config 中提取代理地址（host + port）
 * 优先 mixed-port → port → socks-port
 * @param {object} config - Clash /configs 返回的配置对象
 * @param {string} host - 代理监听 host（默认 127.0.0.1）
 * @returns {{host: string, port: number}}}
 */
function extractProxyAddress(config, host) {
  const port = config['mixed-port'] || config['port'] || config['socks-port'] || 7890;
  return { host: host || '127.0.0.1', port };
}

/**
 * 设置浏览器代理模式
 * @param {string} mode - 'system' | 'direct' | 'clash'
 * @param {{host: string, port: number} | null} [clashProxy] - Clash 代理地址（clash 模式必须；system/direct 模式不使用，可传 null）
 */
async function setProxyMode(mode, clashProxy) {
  switch (mode) {
    case PROXY_MODES.SYSTEM:
      // 浏览器跟随系统代理设置（PAC / SOCKS / HTTP / 直连），不修改系统设置
      await chrome.proxy.settings.set({
        value: { mode: "system" },
        scope: "regular"
      });
      break;
    case PROXY_MODES.DIRECT:
      // 浏览器无视系统代理，全部直连
      await chrome.proxy.settings.set({
        value: { mode: "direct" },
        scope: "regular"
      });
      break;
    case PROXY_MODES.CLASH:
      // 浏览器固定使用 Clash 作为代理
      if (!clashProxy || !clashProxy.host || !clashProxy.port) {
        throw new Error('Clash proxy host/port is required');
      }
      await chrome.proxy.settings.set({
        value: {
          mode: "fixed_servers",
          rules: {
            singleProxy: {
              scheme: "http",
              host: clashProxy.host,
              port: clashProxy.port
            }
          }
        },
        scope: "regular"
      });
      break;
  }
}

/**
 * 获取当前代理模式
 * @returns {Promise<string>}
 */
async function getCurrentProxyMode() {
  const config = await chrome.storage.local.get('settings');
  return config.settings?.currentMode || PROXY_MODES.SYSTEM;
}

/**
 * 获取设置
 * @returns {Promise<object>}
 */
async function getSettings() {
  const config = await chrome.storage.local.get('settings');
  if (!config.settings) {
    return {
      currentMode: 'system',
      clashApiUrl: 'http://127.0.0.1:9090',
      clashSecret: '',
      clashApiHost: '127.0.0.1',
      clashApiPort: 9090,
      clashConfigPath: '',
      writeToYaml: false,
      disableFallback: false,
      language: 'zh_CN'
    };
  }
  const settings = config.settings;
  let migrated = false;

  // 数据迁移1：旧字段名 clashProxyHost/clashProxyPort → clashApiHost/clashApiPort
  // （v1.3.x 重命名，老用户 storage 中可能还是旧字段名）
  if (settings.clashProxyHost !== undefined && settings.clashApiHost === undefined) {
    settings.clashApiHost = settings.clashProxyHost;
    delete settings.clashProxyHost;
    migrated = true;
  }
  if (settings.clashProxyPort !== undefined && settings.clashApiPort === undefined) {
    // 旧默认值 7890 是代理端口（错误），迁移时修正为 9090（API 端口）
    settings.clashApiPort = 9090;
    delete settings.clashProxyPort;
    migrated = true;
  }

  // 数据迁移2：旧字段名 useScriptRule → writeToYaml（语义相同：true=写YAML）
  if (settings.useScriptRule !== undefined && settings.writeToYaml === undefined) {
    settings.writeToYaml = settings.useScriptRule;
    delete settings.useScriptRule;
    migrated = true;
  }

  // 如果迁移过，持久化新字段名（删除旧字段）
  if (migrated) {
    await chrome.storage.local.set({ settings });
  }
  return settings;
}