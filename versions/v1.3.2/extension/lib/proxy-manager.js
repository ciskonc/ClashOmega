// chrome.proxy 三模式切换封装
// 三种模式均只控制浏览器自身代理，不触碰系统代理设置
const PROXY_MODES = {
  SYSTEM: 'system',
  DIRECT: 'direct',
  CLASH:  'clash'
};

/**
 * 从 Clash config 中提取代理端口
 * 优先 mixed-port → port → socks-port
 * @param {object} config - Clash /configs 返回的配置对象
 * @returns {{host: string, port: number}}}
 */
function extractProxyPort(config, host) {
  const port = config['mixed-port'] || config['port'] || config['socks-port'] || 7890;
  return { host: host || '127.0.0.1', port };
}

/**
 * 设置浏览器代理模式
 * @param {string} mode - 'system' | 'direct' | 'clash'
 * @param {{host: string, port: number}} clashProxy - Clash 代理地址（可选，Clash 模式必须）
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
  return config.settings || {
    currentMode: 'system',
    clashApiUrl: 'http://127.0.0.1:9090',
    clashSecret: '',
    clashProxyHost: '127.0.0.1',
    clashProxyPort: 7890,
    clashConfigPath: '',
    useScriptRule: true,
    language: 'zh_CN'
  };
}