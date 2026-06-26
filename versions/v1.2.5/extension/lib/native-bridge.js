// Native Messaging 通信封装
// 与 Python Native Host (clash_rules_manager.py) 通信
const NATIVE_HOST_NAME = 'com.clash.manager';

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
 * 添加单条规则到 Clash YAML 或 Script.js
 * @param {string} rule - 规则字符串，如 "DOMAIN-SUFFIX,bilibili.com,Proxy"
 * @param {string} [configPath] - 可选，配置文件路径（useScript=false 时使用）
 * @param {boolean} [useScript=false] - 是否写入 Script.js 的 EXT_RULES 数组
 */
async function addClashRule(rule, configPath, useScript = false) {
  const msg = { action: 'addRule', rule, useScript };
  if (configPath) msg.configPath = configPath;
  return await sendToNative(msg);
}

/**
 * 批量添加规则到 Clash YAML
 * @param {string[]} rules - 规则字符串数组
 * @param {string} [configPath] - 可选，配置文件路径
 */
async function batchAddClashRules(rules, configPath) {
  const msg = { action: 'batchAddRules', rules };
  if (configPath) msg.configPath = configPath;
  return await sendToNative(msg);
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
  return await sendToNative(msg);
}

/**
 * 获取 Clash YAML 中的规则列表
 * @param {string} [configPath] - 可选，配置文件路径（由 background.js 传入）
 * @returns {Promise<{success: boolean, rules?: string[], configPath?: string, error?: string}>}
 */
async function getClashYamlRules(configPath) {
  const msg = { action: 'getRules' };
  if (configPath) msg.configPath = configPath;
  return await sendToNative(msg);
}

/**
 * 设置 Clash 配置文件路径
 * @param {string} path - 配置文件绝对路径
 */
async function setConfigPath(path) {
  return await sendToNative({ action: 'setConfigPath', path });
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
 * 获取 Windows 系统代理状态（注册表）
 * @returns {Promise<{success: boolean, proxyEnable?: boolean, proxyServer?: string, autoConfigUrl?: string}>}
 */
async function getSystemProxyStatus() {
  try {
    return await sendToNative({ action: 'getSystemProxy' });
  } catch {
    return { success: false, error: 'Native Host unreachable' };
  }
}

/**
 * 同步规则到 Clash Verge Rev 快照文件（clash-verge.yaml）
 * 将规则写入快照文件，配合 POST /restart 使内核重新加载
 * @param {string[]} rules - 规则字符串数组
 * @returns {Promise<{success: boolean, snapshotPath?: string, error?: string}>}
 */
async function syncSnapshotRules(rules) {
  return await sendToNative({ action: 'syncSnapshot', rules });
}

/**
 * 获取 Clash Verge Rev 快照文件路径（clash-verge.yaml）
 * 用于调用 mihomo PUT /configs {path} 热重载配置
 * @returns {Promise<{success: boolean, snapshotPath?: string, error?: string}>}
 */
async function getSnapshotPath() {
  return await sendToNative({ action: 'getSnapshotPath' });
}

// ──── Script.js 扩展脚本规则管理 ────

/**
 * 获取 Script.js 文件路径及状态
 * @returns {Promise<{success: boolean, scriptPath?: string, exists?: boolean, managed?: boolean, error?: string}>}
 */
async function getScriptPath() {
  return await sendToNative({ action: 'getScriptPath' });
}

/**
 * 获取 Script.js 中 EXT_RULES 数组的规则列表
 * @returns {Promise<{success: boolean, rules?: string[], scriptPath?: string, needInit?: boolean, error?: string}>}
 */
async function getScriptRules() {
  return await sendToNative({ action: 'getScriptRules' });
}

/**
 * 初始化 Script.js 文件为标准扩展脚本格式（备份原文件）
 * @returns {Promise<{success: boolean, scriptPath?: string, error?: string}>}
 */
async function initScriptFile() {
  return await sendToNative({ action: 'initScriptFile' });
}