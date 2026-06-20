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
 * 添加单条规则到 Clash YAML
 * @param {string} rule - 规则字符串，如 "DOMAIN-SUFFIX,bilibili.com,Proxy"
 * @param {string} [configPath] - 可选，配置文件路径
 */
async function addClashRule(rule, configPath) {
  const msg = { action: 'addRule', rule };
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
 * 从 Clash YAML 删除规则
 * @param {string} rule - 规则字符串
 * @param {string} [configPath] - 可选，配置文件路径
 */
async function removeClashRule(rule, configPath) {
  const msg = { action: 'removeRule', rule };
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