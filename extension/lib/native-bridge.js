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

/**
 * 安全发送消息给 Native Host
 * Native Host 不可用时返回 { success: false, error } 而非抛出异常
 * 避免在扩展程序页面产生 console.error
 * @param {object} message - 消息对象
 * @returns {Promise<object>} - Native Host 响应或错误对象
 */
async function sendToNativeSafe(message) {
  try {
    return await sendToNative(message);
  } catch (e) {
    return { success: false, error: e.message };
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