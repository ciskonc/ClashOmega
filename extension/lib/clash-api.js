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
      console.log(`ClashOmega: auto-detected API at http://127.0.0.1:${port}`);
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
      console.log(`ClashOmega: auto-detected API at http://127.0.0.1:${port} (via POST)`);
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
 * 获取 Clash 当前活跃连接列表
 * 用于查询域名实际匹配的规则和代理组（RULE-SET 等类型无法在浏览器端匹配，需通过内核查询）
 * @returns {Promise<{connections: Array}|null>}
 */
async function getClashConnections() {
  return await clashGet('/connections');
}

/**
 * 关闭 Clash 所有活跃连接
 * 用于「重启 Clash」后强制新连接重新匹配规则。
 * 根因：PUT /configs 热重载只更新配置，不断开已建立连接；
 *       Clash 规则匹配只在连接建立时进行，旧连接不会重新匹配新规则。
 *       因此需要主动关闭所有连接，让后续请求建立新连接并匹配最新规则。
 * @returns {Promise<boolean>} 是否成功
 */
async function closeAllConnections() {
  const { baseUrl, headers } = await getApiConfig();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const response = await fetch(`${baseUrl}/connections`, {
      method: 'DELETE',
      headers,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.error(`ClashOmega: closeAllConnections failed HTTP ${response.status}`);
      return false;
    }
    console.log('ClashOmega: all connections closed');
    return true;
  } catch (e) {
    console.error('ClashOmega: closeAllConnections error:', e.message);
    return false;
  }
}

/**
 * 获取 Clash 配置
 */
async function getClashConfig() {
  return await clashGet('/configs');
}

/**
 * 热重载规则到运行中的 Clash 内核（不重启进程，代理全程在线）
 *
 * 实现说明：
 *   Clash/mihomo 内核的 PUT /configs API 有三种用法：
 *   1. 传入文件路径 {"path": "/path/to/config.yaml"} → mihomo v1.19.25 测试返回
 *      "Body invalid"，不可用
 *   2. 传入 YAML 内容 {"payload": "yaml content"} → 返回 204 成功，内核从
 *      payload 重新加载完整配置（包括 rules），这是可用的方式
 *   3. 传入配置对象 {...config, rules: [...]} → 内核只更新部分运行时配置，
 *      rules 字段的更新会被忽略
 *
 * 因此本函数采用方案 2：由调用方传入 syncSnapshotRules 写好的快照文件内容，
 * 用 {payload: content} 方式让内核重新加载完整配置。
 *
 * @param {string} content - 快照文件的完整 YAML 内容
 * @returns {Promise<boolean>} 是否成功
 */
async function hotReloadConfig(content) {
  try {
    if (!content || typeof content !== 'string' || content.length === 0) {
      console.error("ClashOmega: hotReloadConfig skipped — content is empty or invalid");
      return false;
    }

    const { baseUrl, headers } = await getApiConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    // force=true 强制重新加载
    // payload 是完整 YAML 配置内容，内核会解析并重新加载所有配置（含 rules）
    const response = await fetch(`${baseUrl}/configs?force=true`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ payload: content }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.error(`ClashOmega: hotReloadConfig PUT failed HTTP ${response.status}`);
      return false;
    }
    console.log(`ClashOmega: hot-reloaded config from payload (${content.length} chars)`);
    return true;
  } catch (e) {
    console.error("ClashOmega: hotReloadConfig error:", e.message);
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
 * 通过 PUT /configs {path} 让 mihomo 重新加载指定配置文件
 * 不重启内核，代理不中断，用于「重启 Clash」按钮的优先路径
 * 注意：mihomo 要求路径使用正斜杠（/），Windows 反斜杠（\）会返回 400 Bad Request
 * @param {string} path - 配置文件绝对路径（clash-verge.yaml）
 * @returns {Promise<boolean>} 是否成功
 */
async function reloadConfigFromPath(path) {
  const { baseUrl, headers } = await getApiConfig();
  try {
    // 将 Windows 反斜杠转换为正斜杠，否则 mihomo 返回 400 Bad Request
    const normalizedPath = path.replace(/\\/g, '/');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const response = await fetch(`${baseUrl}/configs?force=true`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ path: normalizedPath }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
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