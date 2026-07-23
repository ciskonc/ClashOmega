// Native Messaging 通信封装
// 与 Python Native Host (clash_rules_manager.py) 通信
const NATIVE_HOST_NAME = 'com.clash.omega';

/**
 * 发送消息给 Native Host
 * @param {object} message - 消息对象
 * @returns {Promise<object>} - Native Host 响应
 */
function sendToNative(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// C2 修复（v1.4.7）：队列模式替代并发拒绝
// v1.4.6 的并发拒绝模式（_sendToNativeInFlight）会误伤正常并发请求
// 场景：popup 打开时 detectClient + getScriptRules 并行发起，一个被 native_host_busy 拒绝
//   - getScriptRules 被拒绝 → 走场景 F 显示"重新安装"指引（用户误判为"未安装"）
//   - detectClient 被拒绝 → clientType=unknown，5s 轮询恢复后又变 clash-verge-rev，反复切换
// 改为队列模式：新请求排队等待前一个完成，不丢失请求
// 仍只允许 1 个 Native Host 进程在途，保留进程泄漏防护
let _nativeHostQueue = Promise.resolve();

// C2 修复（v1.4.6）：冷却期机制
// 超时后进入 30s 冷却期，期间拒绝所有新请求，避免卡死的 PowerShell 进程持续累积
let _nativeHostCooldownUntil = 0;
const NATIVE_HOST_COOLDOWN_MS = 30000;  // 30 秒冷却期

/**
 * 安全发送消息给 Native Host
 * Native Host 不可用时返回 { success: false, error } 而非抛出异常
 * 避免在扩展程序页面产生 console.error
 *
 * v1.4.7 修复：队列模式替代并发拒绝
 * - v1.4.6 的 _sendToNativeInFlight 标志会拒绝并发请求，误伤 popup 打开时的正常并行调用
 * - 改为队列模式：新请求排队等待前一个完成，不丢失请求
 * - 仍只允许 1 个 Native Host 进程在途，保留进程泄漏防护
 * - 队列等待期间若进入冷却期，出队后再次检查并拒绝
 *
 * @param {object} message - 消息对象
 * @returns {Promise<object>} - Native Host 响应或错误对象
 */
async function sendToNativeSafe(message) {
  // 冷却期检查（快速拒绝，不排队）
  const now = Date.now();
  if (now < _nativeHostCooldownUntil) {
    return { success: false, error: 'native_host_cooldown' };
  }

  // 队列：等待前一个请求完成
  const previousQueue = _nativeHostQueue;
  let releaseQueue;
  _nativeHostQueue = new Promise(r => { releaseQueue = r; });

  await previousQueue;

  let timeoutId;
  try {
    // 队列等待期间可能进入了冷却期，出队后再次检查
    if (Date.now() < _nativeHostCooldownUntil) {
      return { success: false, error: 'native_host_cooldown' };
    }

    // M3 修复：10 秒超时，防止 Native Host 卡死导致 popup 永久阻塞
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('native_host_timeout')), 10000);
    });
    return await Promise.race([sendToNative(message), timeoutPromise]);
  } catch (e) {
    if (e.message === 'native_host_timeout') {
      console.warn('ClashOmega: Native Host timeout (process may be stuck):', message.action);
      // C2 修复（v1.4.6）：超时后进入 30s 冷却期
      _nativeHostCooldownUntil = Date.now() + NATIVE_HOST_COOLDOWN_MS;
      console.warn('ClashOmega: Native Host cooldown for', NATIVE_HOST_COOLDOWN_MS, 'ms');
    }
    return { success: false, error: e.message };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    releaseQueue();
  }
}

/**
 * 添加单条规则到 Clash YAML 或 Script.js
 * @param {string} rule - 规则字符串，如 "DOMAIN-SUFFIX,bilibili.com,Proxy"
 * @param {string} [configPath] - 可选，配置文件路径（useScript=false 时使用）
 * @param {boolean} [useScript=false] - 是否写入 Script.js 的 EXT_RULES 数组
 */
async function addClashRule(rule, configPath, useScript = false) {
  const msg = { action: 'addRule', rule, useScript };
  if (configPath) msg.configPath = configPath;
  return await sendToNativeSafe(msg);
}

/**
 * 批量添加规则到 Clash YAML
 * @param {string[]} rules - 规则字符串数组
 * @param {string} [configPath] - 可选，配置文件路径
 */
async function batchAddClashRules(rules, configPath) {
  const msg = { action: 'batchAddRules', rules };
  if (configPath) msg.configPath = configPath;
  return await sendToNativeSafe(msg);
}

/**
 * 从 Clash YAML 或 Script.js 删除规则
 * @param {string} rule - 规则字符串
 * @param {string} [configPath] - 可选，配置文件路径（useScript=false 时使用）
 * @param {boolean} [useScript=false] - 是否从 Script.js 的 EXT_RULES 数组删除
 */
async function removeClashRule(rule, configPath, useScript = false) {
  const msg = { action: 'removeRule', rule, useScript };
  if (configPath) msg.configPath = configPath;
  return await sendToNativeSafe(msg);
}

/**
 * 获取 Clash YAML 中的规则列表
 * @param {string} [configPath] - 可选，配置文件路径（由 background.js 传入）
 * @returns {Promise<{success: boolean, rules?: string[], configPath?: string, error?: string}>}
 */
async function getClashYamlRules(configPath) {
  const msg = { action: 'getRules' };
  if (configPath) msg.configPath = configPath;
  return await sendToNativeSafe(msg);
}

/**
 * 设置 Clash 配置文件路径
 * @param {string} path - 配置文件绝对路径
 */
async function setConfigPath(path) {
  return await sendToNativeSafe({ action: 'setConfigPath', path });
}

/**
 * 检查 Native Host 是否已安装
 * @returns {Promise<boolean>}
 */
async function checkNativeHost() {
  try {
    const result = await sendToNative({ action: 'ping' });
    return result?.success === true;
  } catch {
    return false;
  }
}

/**
 * 获取系统代理状态
 * 优先使用 Native Host 读取 Windows 注册表（系统级代理）
 * 若 Native Host 不可用，回退到 chrome.proxy.settings.get() 读取浏览器级代理（兼容部分 Chromium 内核浏览器）
 *
 * ★ v1.4.2 性能优化（方案 I1）：本函数不再在 getStatus 内同步调用，
 * 改由 popup 异步调用独立 action 'getSystemProxyStatus'，避免阻塞主页加载。
 * popup 加载期间"系统代理"栏显示"加载中..."，本函数返回后异步渲染。
 *
 * 返回字段说明：
 * - nativeHostAvailable: boolean - Native Host 是否可用（false 时表示未安装/未注册）
 * - 当 nativeHostAvailable=true 时：返回 Native Host 读取的系统级代理
 * - 当 nativeHostAvailable=false 时：回退到浏览器代理，但 popup 应显示"Null/未安装"
 *
 * @returns {Promise<{success: boolean, nativeHostAvailable?: boolean, proxyEnable?: boolean, proxyServer?: string, autoConfigUrl?: string, browserMode?: string}>}
 */
async function getSystemProxyStatus() {
  // 优先尝试 Native Host
  let nativeHostAvailable = false;
  try {
    const result = await sendToNative({ action: 'getSystemProxy' });
    if (result && result.success) {
      // Native Host 可用且成功返回
      return { ...result, nativeHostAvailable: true };
    }
    // Native Host 可用但返回失败（如注册表读取失败），标记为可用以便后续重试
    nativeHostAvailable = true;
  } catch {
    // Native Host 不可用（未安装/未注册），继续走兜底逻辑
    nativeHostAvailable = false;
  }

  // 兜底方案：使用 chrome.proxy.settings.get() 读取浏览器代理配置
  // 适用于部分 Chromium 内核浏览器，或 Native Host 未注册的场景
  // 注意：此时 nativeHostAvailable=false，popup 应显示"Null/未安装"而非浏览器代理状态
  try {
    const details = await chrome.proxy.settings.get({});
    const value = details?.value;
    if (!value) {
      return { success: false, nativeHostAvailable, error: 'Unable to get proxy settings' };
    }

    const mode = value.mode;
    // mode 取值：direct | auto_detect | pac_script | fixed_servers | system
    if (mode === 'direct') {
      return { success: true, nativeHostAvailable, proxyEnable: false, proxyServer: '', autoConfigUrl: '', browserMode: 'direct' };
    }
    if (mode === 'auto_detect') {
      return { success: true, nativeHostAvailable, proxyEnable: true, proxyServer: '', autoConfigUrl: 'WPAD', browserMode: 'auto_detect' };
    }
    if (mode === 'pac_script' && value.pacScript) {
      return { success: true, nativeHostAvailable, proxyEnable: true, proxyServer: '', autoConfigUrl: value.pacScript.url || 'PAC', browserMode: 'pac_script' };
    }
    if (mode === 'fixed_servers' && value.rules) {
      const single = value.rules.singleProxy;
      if (single) {
        const proxyStr = `${single.scheme || 'http'}://${single.host}:${single.port}`;
        return { success: true, nativeHostAvailable, proxyEnable: true, proxyServer: proxyStr, autoConfigUrl: '', browserMode: 'fixed_servers' };
      }
      // 多代理规则场景，取第一个
      if (value.rules.proxyForHttp) {
        const p = value.rules.proxyForHttp;
        const proxyStr = `${p.scheme || 'http'}://${p.host}:${p.port}`;
        return { success: true, nativeHostAvailable, proxyEnable: true, proxyServer: proxyStr, autoConfigUrl: '', browserMode: 'fixed_servers' };
      }
    }
    if (mode === 'system') {
      // 浏览器跟随系统代理，但无法直接读取系统代理具体值
      // 返回特殊标记，让 popup 显示"跟随系统"
      return { success: true, nativeHostAvailable, proxyEnable: true, proxyServer: '', autoConfigUrl: '', browserMode: 'system' };
    }

    return { success: false, nativeHostAvailable, error: `Unknown proxy mode: ${mode}` };
  } catch (e) {
    return { success: false, nativeHostAvailable, error: `Proxy API error: ${e.message}` };
  }
}

/**
 * 同步规则到 Clash Verge Rev 快照文件（clash-verge.yaml）
 * 将规则写入快照文件，配合 POST /restart 使内核重新加载
 * @param {string[]} rules - 规则字符串数组
 * @returns {Promise<{success: boolean, snapshotPath?: string, error?: string}>}
 */
async function syncSnapshotRules(rules) {
  return await sendToNativeSafe({ action: 'syncSnapshot', rules });
}

/**
 * 获取 Clash Verge Rev 快照文件路径（clash-verge.yaml）
 * 用于调用 mihomo PUT /configs {path} 热重载配置
 * @returns {Promise<{success: boolean, snapshotPath?: string, error?: string}>}
 */
async function getSnapshotPath() {
  return await sendToNativeSafe({ action: 'getSnapshotPath' });
}

// ──── Script.js 扩展脚本规则管理 ────

/**
 * 获取 Script.js 文件路径及状态
 * @returns {Promise<{success: boolean, scriptPath?: string, exists?: boolean, managed?: boolean, error?: string}>}
 */
async function getScriptPath() {
  return await sendToNativeSafe({ action: 'getScriptPath' });
}

/**
 * 获取 Script.js 中 EXT_RULES 数组的规则列表
 * Native Host 不可用时返回 { success: false } 而非抛出异常，避免扩展程序页面显示错误
 * @returns {Promise<{success: boolean, rules?: string[], scriptPath?: string, needInit?: boolean, error?: string}>}
 */
async function getScriptRules() {
  return await sendToNativeSafe({ action: 'getScriptRules' });
}

/**
 * 初始化 Script.js 文件为标准扩展脚本格式（备份原文件）
 * @returns {Promise<{success: boolean, scriptPath?: string, error?: string}>}
 */
async function initScriptFile() {
  return await sendToNativeSafe({ action: 'initScriptFile' });
}