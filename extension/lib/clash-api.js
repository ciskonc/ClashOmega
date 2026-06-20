// Clash REST API 封装（只读 GET + 配置重载 PUT）
// 规则修改由 Native Messaging Host 完成

// Clash 常见 API 端口（自动探测）
const CLASH_API_PORTS = [9090, 9097, 9098, 9091, 8080];

/**
 * 获取 Clash API 基础 URL 和认证头
 */
async function getApiConfig() {
  const settings = await getSettings();
  const headers = { 'Content-Type': 'application/json' };
  if (settings.clashSecret) {
    headers['Authorization'] = `Bearer ${settings.clashSecret}`;
  }
  return { baseUrl: settings.clashApiUrl, headers };
}

/**
 * 尝试向指定 URL 发送 GET 请求
 */
async function tryFetch(url, headers) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const response = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 发送 GET 请求到 Clash API（自动端口探测）
 */
async function clashGet(endpoint) {
  const { baseUrl, headers } = await getApiConfig();
  const result = await tryFetch(`${baseUrl}${endpoint}`, headers);
  if (result !== null) return result;

  // 如果用户配置的 URL 不通，尝试自动探测其他端口
  const settings = await getSettings();
  for (const port of CLASH_API_PORTS) {
    const testUrl = `http://127.0.0.1:${port}${endpoint}`;
    if (testUrl === `${baseUrl}${endpoint}`) continue; // 已尝试过
    const r = await tryFetch(testUrl, headers);
    if (r !== null) {
      // 自动保存探测到的端口
      settings.clashApiUrl = `http://127.0.0.1:${port}`;
      await chrome.storage.local.set({ settings });
      console.log(`Clash Manager: auto-detected API at http://127.0.0.1:${port}`);
      return r;
    }
  }
  return null;
}

/**
 * 发送 PUT 请求到 Clash API
 */
async function clashPut(endpoint, body) {
  const { baseUrl, headers } = await getApiConfig();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch (e) {
    console.error(`Clash API PUT ${endpoint} failed:`, e.message);
    return false;
  }
}

/**
 * 尝试向指定 URL 发送 POST 请求
 */
async function tryPost(url, headers) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const response = await fetch(url, { method: 'POST', headers, signal: ctrl.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return null;
  }
}

/**
 * Clash POST 请求（自动端口探测 + 自动保存）
 */
async function clashPost(endpoint) {
  const { baseUrl, headers } = await getApiConfig();
  const url = `${baseUrl}${endpoint}`;
  let result = await tryPost(url, headers);
  if (result === true) return true;
  if (result === false) {
    console.error(`Clash API POST ${endpoint} failed: HTTP error at ${url}`);
  }

  // 如果用户配置的 URL 不通，尝试自动探测其他端口
  const settings = await getSettings();
  for (const port of CLASH_API_PORTS) {
    const testUrl = `http://127.0.0.1:${port}${endpoint}`;
    if (testUrl === url) continue;
    const r = await tryPost(testUrl, headers);
    if (r === true) {
      settings.clashApiUrl = `http://127.0.0.1:${port}`;
      await chrome.storage.local.set({ settings });
      console.log(`Clash Manager: auto-detected API at http://127.0.0.1:${port} (via POST)`);
      return true;
    }
    if (r === false) {
      console.error(`Clash API POST ${endpoint} failed: HTTP error at ${testUrl}`);
    }
  }
  return false;
}

/**
 * 获取 Clash 规则列表
 */
async function getClashRules() {
  return await clashGet('/rules');
}

/**
 * 获取 Clash 配置
 */
async function getClashConfig() {
  return await clashGet('/configs');
}

/**
 * 热重载规则到运行中的 Clash 内核（不重启进程，代理全程在线）
 * 流程：GET /configs → 修改 rules 数组 → PUT /configs?force=true
 * @param {string[]} rules - 规则字符串数组，如 ["DOMAIN-SUFFIX,google.com,Proxy"]
 * @returns {Promise<boolean>} 是否成功
 */
async function hotReloadConfig(rules) {
  try {
    // 防御性检查：确保 rules 是非空数组，防止 .filter 崩溃
    if (!Array.isArray(rules) || rules.length === 0) {
      console.error("Clash Manager: hotReloadConfig skipped — rules is not a non-empty array");
      return false;
    }

    // 1. 获取当前运行配置
    const config = await clashGet("/configs");
    if (!config) {
      console.error("Clash Manager: hotReloadConfig failed — cannot get current config");
      return false;
    }

    // 2. 确保 MATCH（漏网之鱼）始终在规则列表末尾
    const matchRules = rules.filter(r => r.startsWith('MATCH,') || r.startsWith("MATCH,"));
    const nonMatchRules = rules.filter(r => !r.startsWith('MATCH,') && !r.startsWith("MATCH,"));
    const orderedRules = [...nonMatchRules, ...matchRules];

    // 3. PUT 回配置（force=true 热重载，不重启进程）
    const { baseUrl, headers } = await getApiConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const response = await fetch(`${baseUrl}/configs?force=true`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...config, rules: orderedRules }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.error(`Clash Manager: hotReloadConfig PUT failed HTTP ${response.status}`);
      return false;
    }
    console.log(`Clash Manager: hot-reloaded ${orderedRules.length} rules without restart`);
    return true;
  } catch (e) {
    console.error("Clash Manager: hotReloadConfig error:", e.message);
    return false;
  }
}

/**
 * 重载 Clash 配置（重启内核 —— 仅用于「重启 Clash」按钮，Clash Verge Rev 慎用）
 */
async function reloadClashConfig() {
  return await clashPost('/restart');
}

/**
 * 重启 Clash 内核（POST /restart）
 * 内核重启后从快照文件重新加载配置，需先调用 syncSnapshotRules 更新快照
 * @returns {Promise<boolean>} 是否成功
 */
async function restartKernel() {
  return await clashPost('/restart');
}

/**
 * 获取 Clash 代理组列表（用于 F2 快捷添加时选择目标代理组）
 */
async function getClashProxies() {
  const data = await clashGet('/proxies');
  if (!data || !data.proxies) return {};
  return data.proxies;
}

/**
 * 检查 Clash 是否可连接
 */
async function checkClashStatus() {
  try {
    const config = await getClashConfig();
    return config !== null;
  } catch {
    return false;
  }
}