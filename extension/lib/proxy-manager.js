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

// 默认设置（单一事实源）
// v1.4.9：抽成常量，供 getSettings() 浅合并与各处回显共用，
// 消除"默认值在 background.js / proxy-manager.js / popup.js 三处重复硬编码"的漂移
const DEFAULT_SETTINGS = {
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

/**
 * 获取设置
 * v1.4.9 修复：settings 存在但缺字段时不再直接返回原对象，
 * 而是与 DEFAULT_SETTINGS 浅合并，保证 clashApiUrl 始终为合法字符串
 * （原逻辑下缺 clashApiUrl 会让 clash-api.js 的 baseUrl.match() 抛 TypeError，
 *   导致 getStatus / detectClashClient 整链 reject，popup 状态区永不更新）
 * @returns {Promise<object>}
 */
async function getSettings() {
  const config = await chrome.storage.local.get('settings');
  if (!config.settings) {
    return { ...DEFAULT_SETTINGS };
  }
  const settings = { ...DEFAULT_SETTINGS, ...config.settings };
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

/**
 * 原子更新设置（读-改-写串行化）
 * v1.4.9 修复：此前 saveSettings（popup 整对象写）与 setLanguage（i18n 只改 language 后整对象写）
 * 存在 lost update —— 后写方覆盖先写方，用户表现为"刚保存的 secret 又变回旧值"且无任何报错
 * 本函数用模块级 Promise 链串行化所有 settings 写入，并保证以最新值为基准做合并
 * @param {(s: object) => void} mutator - 修改 settings 对象的回调
 * @returns {Promise<object>} 更新后的完整 settings
 */
let _settingsWriteChain = Promise.resolve();
async function updateSettings(mutator) {
  const task = _settingsWriteChain.then(async () => {
    const config = await chrome.storage.local.get('settings');
    const settings = { ...DEFAULT_SETTINGS, ...(config.settings || {}) };
    await mutator(settings);
    await chrome.storage.local.set({ settings });
    return settings;
  });
  // 无论成功失败都要让链条继续，避免一次失败卡死后续所有写入
  _settingsWriteChain = task.then(() => undefined, () => undefined);
  return await task;
}