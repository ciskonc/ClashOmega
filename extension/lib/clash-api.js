// Clash REST API 封装（只读 GET + 配置重载 PUT）
// 规则修改由 Native Messaging Host 完成
//
// S-005 安全说明：
// Clash API 密钥存储在 chrome.storage.local 中（明文）。
// 这是 Chrome 扩展 MV3 的标准做法，扩展存储本身是隔离的。
// 密钥仅用于本地 127.0.0.1 API 认证，即使泄露也只能控制本地 Clash 内核。
// 如需更高安全性，可考虑通过 Native Messaging Host 中转 API 请求（未来增强）。

// Clash 常见 API 端口（自动探测）
const CLASH_API_PORTS = [9090, 9097, 9098, 9091, 8080];

/**
 * 获取 Clash API 基础 URL 和认证头
 *
 * 会话级缓存策略（避免每次操作都重复尝试错误端口）：
 * - 优先用 chrome.storage.session 中缓存的"实际可用 URL"
 * - 没有缓存才用用户配置的 settings.clashApiUrl
 * - 缓存在用户修改 settings.clashApiUrl 时自动清除（见 saveSettings）
 * - 浏览器关闭后缓存自动失效（chrome.storage.session 特性）
 */
async function getApiConfig() {
  const settings = await getSettings();
  const headers = { 'Content-Type': 'application/json' };
  if (settings.clashSecret) {
    headers['Authorization'] = `Bearer ${settings.clashSecret}`;
  }

  // 优先用会话级缓存的实际可用 URL（避免重复尝试错误端口）
  let baseUrl = settings.clashApiUrl;
  try {
    const session = await chrome.storage.session.get('clashActualApiUrl');
    if (session.clashActualApiUrl) {
      baseUrl = session.clashActualApiUrl;
    }
  } catch {
    // chrome.storage.session 不可用时回退到用户配置
  }

  return { baseUrl, headers };
}

/**
 * 缓存检测到的实际可用 API URL（会话级，浏览器关闭后失效）
 * 当回退探测找到 Clash 时调用，避免后续操作重复尝试错误端口
 * @param {string} actualUrl - 实际可用的 API URL
 */
async function cacheActualApiUrl(actualUrl) {
  try {
    await chrome.storage.session.set({ clashActualApiUrl: actualUrl });
  } catch {
    // chrome.storage.session 不可用时静默失败
  }
}

/**
 * 清除会话级缓存的 API URL（用户修改设置时调用）
 */
async function clearCachedApiUrl() {
  try {
    await chrome.storage.session.remove('clashActualApiUrl');
  } catch {
    // 静默失败
  }
}

/**
 * 尝试向指定 URL 发送 GET 请求
 * 超时 1000ms（localhost HTTP 请求足够，避免端口不通时长时间阻塞）
 */
async function tryFetch(url, headers) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1000);
    const response = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 并行探测多个端口，返回第一个成功的结果
 * 用 Promise.any 竞速：最快响应的端口立即返回，其余请求继续在后台运行直至各自超时（tryFetch 内部 1s abort）
 * 注意：Promise.any 不会取消其余 promises，因此其余请求不会立即 abort，仍会消耗网络资源直到超时
 * @param {string[]} urls - 要探测的 URL 列表
 * @param {object} headers - 请求头
 * @returns {Promise<{url: string, data: object} | null>}
 */
async function tryFetchParallel(urls, headers) {
  const promises = urls.map(url =>
    tryFetch(url, headers).then(data => {
      if (data) return { url, data };
      throw new Error('no data');
    })
  );
  try {
    const result = await Promise.any(promises);
    return result;
  } catch {
    // 所有端口都不通
    return null;
  }
}

/**
 * 发送 GET 请求到 Clash API（自动端口探测，不覆盖用户设置）
 * @param {string} endpoint - API 端点
 * @param {{noFallback?: boolean}} [options] - noFallback=true 时只尝试用户配置的 URL，不走端口回退
 *   注意：noFallback 模式下绕过会话级缓存（clashActualApiUrl），直接用用户配置的 URL 检测，
 *   确保准确反映"用户配置是否正确"而非"Clash 是否可用"。
 */
async function clashGet(endpoint, options) {
  const { baseUrl, headers } = await getApiConfig();
  // noFallback 模式：绕过会话缓存，直接用用户配置的 URL 检测
  // 缓存（clashActualApiUrl）可能包含回退探测到的端口，不能用于判断用户配置是否正确
  const effectiveBaseUrl = (options && options.noFallback)
    ? (await getSettings()).clashApiUrl
    : baseUrl;
  const result = await tryFetch(`${effectiveBaseUrl}${endpoint}`, headers);
  if (result !== null) return result;

  // noFallback 模式：只用用户配置的 URL，不探测其他端口
  // 用于状态检测（getStatus/setMode），确保反映用户真实配置而非自动发现的端口
  if (options && options.noFallback) return null;

  // 用户配置的 URL 不通时，并行探测其他端口获取数据（竞速，最快响应的端口立即返回）
  // 注意：不再将探测结果写回 storage，避免覆盖用户主动设置的 API 地址
  // 从 baseUrl 中提取 host，确保回退探测使用用户配置的 host 而非硬编码 127.0.0.1
  const hostMatch = baseUrl.match(/^https?:\/\/([^:/]+)/);
  const host = hostMatch ? hostMatch[1] : '127.0.0.1';
  const candidateUrls = CLASH_API_PORTS
    .map(port => `http://${host}:${port}${endpoint}`)
    .filter(testUrl => testUrl !== `${baseUrl}${endpoint}`); // 排除已尝试过的
  const found = await tryFetchParallel(candidateUrls, headers);
  if (found) {
    console.log(`ClashOmega: temp-detected API at ${found.url} (not saved to settings)`);
    return found.data;
  }
  return null;
}

/**
 * 尝试向指定 URL 发送 POST 请求
 * @returns {Promise<boolean>} true=成功（HTTP 2xx），false=失败（HTTP 错误或网络异常）
 */
async function tryPost(url, headers) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const response = await fetch(url, { method: 'POST', headers, signal: ctrl.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Clash POST 请求（自动端口探测，不覆盖用户设置）
 * 用户配置的 URL 不通时临时探测其他端口，但探测结果不写回 storage
 * @returns {Promise<boolean>} 是否成功
 */
async function clashPost(endpoint) {
  const { baseUrl, headers } = await getApiConfig();
  const url = `${baseUrl}${endpoint}`;
  if (await tryPost(url, headers)) return true;
  console.warn(`ClashOmega: POST ${endpoint} failed at ${url}`);

  // 用户配置的 URL 不通时，临时探测其他端口（不覆盖用户设置）
  // 从 baseUrl 中提取 host，确保回退探测使用用户配置的 host 而非硬编码 127.0.0.1
  const hostMatch = baseUrl.match(/^https?:\/\/([^:/]+)/);
  const host = hostMatch ? hostMatch[1] : '127.0.0.1';
  for (const port of CLASH_API_PORTS) {
    const testUrl = `http://${host}:${port}${endpoint}`;
    if (testUrl === url) continue;
    if (await tryPost(testUrl, headers)) {
      console.log(`ClashOmega: temp-detected API at http://${host}:${port} (via POST, not saved)`);
      return true;
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
 * @param {{noFallback?: boolean}} [options] - noFallback=true 时只尝试用户配置的 URL
 */
async function getClashConfig(options) {
  return await clashGet('/configs', options);
}

/**
 * 检测 mihomo 内核是否存活且 API 可达
 * 用于「重启 Clash」前预检，避免 mihomo 已死时进入必然失败的流程
 * @returns {Promise<boolean>} true 表示存活
 */
async function isMihomoAlive() {
  try {
    const cfg = await clashGet('/configs');
    return cfg && typeof cfg === 'object' && 'mode' in cfg;
  } catch {
    return false;
  }
}

/**
 * 校验规则列表中引用的代理组是否存在于 proxy-groups
 * 防止写入引用不存在代理组的规则，导致 mihomo 启动时 fatal 退出
 * @param {string[]} rules - 规则字符串数组，如 ["RULE-SET,xxx,GFWList", "MATCH,🐟 漏网之鱼"]
 * @param {string[]} availableGroupNames - 可用的代理组名列表（含 DIRECT/REJECT）
 * @returns {{valid: string[], invalid: string[]}} 校验结果
 */
function validateRulesAgainstGroups(rules, availableGroupNames) {
  if (!Array.isArray(rules) || !Array.isArray(availableGroupNames)) {
    return { valid: [], invalid: [] };
  }
  const valid = [];
  const invalid = [];
  const groupSet = new Set(availableGroupNames);
  // DIRECT / REJECT / PASS 是 Clash 内置出站，永远可用
  groupSet.add('DIRECT');
  groupSet.add('REJECT');
  groupSet.add('PASS');

  for (const rule of rules) {
    if (typeof rule !== 'string' || !rule.trim()) {
      invalid.push(rule);
      continue;
    }
    // 规则格式：TYPE,VALUE,TARGET（部分规则只有 TYPE,VALUE 如 GEOIP）
    // 最后一个逗号后的字段是 TARGET（代理组名）
    const parts = rule.split(',');
    if (parts.length < 2) {
      invalid.push(rule);
      continue;
    }
    const target = parts[parts.length - 1].trim();
    if (groupSet.has(target)) {
      valid.push(rule);
    } else {
      invalid.push(rule);
    }
  }
  return { valid, invalid };
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
 * 切换代理组的当前选中节点（PUT /proxies/{name} {name: selectedNode}）
 * 用于切换到 global 模式时自动把 GLOBAL 组指向有效代理节点
 * @param {string} groupName - 代理组名（如 'GLOBAL'）
 * @param {string} nodeName - 要选中的节点名
 * @returns {Promise<boolean>} 是否切换成功
 */
async function selectProxyNode(groupName, nodeName) {
  const { baseUrl, headers } = await getApiConfig();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const url = `${baseUrl}/proxies/${encodeURIComponent(groupName)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: nodeName }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    return response.ok;
  } catch (e) {
    console.error('ClashOmega: selectProxyNode failed:', e);
    return false;
  }
}

/**
 * 查询 GLOBAL 组的候选节点列表，返回第一个有效代理节点
 * 跳过 DIRECT / REJECT / 代理组 / 伪节点（server 字段为空）
 * 伪节点说明：机场常在订阅开头插入"剩余流量：xxx GB"等显示信息的伪节点，
 * 这类节点 type 是 Vmess/AnyTLS 等真实类型，但 server 字段为空，无法连接
 * @returns {Promise<string|null>} 节点名，无可用节点时返回 null
 */
async function pickFirstRealProxyNode() {
  const proxies = await getClashProxies();
  const globalGroup = proxies['GLOBAL'];
  if (!globalGroup || !Array.isArray(globalGroup.all)) return null;
  for (const name of globalGroup.all) {
    // 跳过内置 DIRECT/REJECT
    if (name === 'DIRECT' || name === 'REJECT') continue;
    const node = proxies[name];
    if (!node) continue;
    // 跳过代理组（Selector/URLTest/Fallback/LoadBalance），只选真实节点
    const groupTypes = ['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay'];
    if (node.type && groupTypes.includes(node.type)) continue;
    // 跳过伪节点：机场用来显示流量信息的 hack 节点，server 字段为空
    if (!node.server) continue;
    return name;
  }
  return null;
}

/**
 * 优先返回 GLOBAL 组候选列表中第一个 Selector 类型代理组（通常是「节点选择」组）
 * 让 GLOBAL 指向代理组而非真实节点，用户在「节点选择」组切换节点时 GLOBAL 自动跟随
 * 若无代理组，fallback 到 pickFirstRealProxyNode 返回第一个真实节点
 * @returns {Promise<string|null>} 节点/组名，无可用时返回 null
 */
async function pickPreferredGlobalNode() {
  const proxies = await getClashProxies();
  const globalGroup = proxies['GLOBAL'];
  if (!globalGroup || !Array.isArray(globalGroup.all)) return null;

  // 优先找 Selector 类型代理组（手动选择型，符合"节点选择"语义）
  // 跳过 URLTest/Fallback/LoadBalance（自动测速组，不应被 GLOBAL 直接指向）
  for (const name of globalGroup.all) {
    if (name === 'DIRECT' || name === 'REJECT') continue;
    const node = proxies[name];
    if (!node) continue;
    if (node.type === 'Selector') return name;
  }

  // Fallback: 无代理组时，返回第一个真实节点
  return await pickFirstRealProxyNode();
}

/**
 * 判断 GLOBAL 组当前选中的节点是否是有效节点
 * 有效定义：真实节点（有 server）/ 代理组（Selector/URLTest 等）
 * 无效定义：未定义 / DIRECT / REJECT / 伪节点（server 为空且非代理组）
 * @param {object} proxies - getClashProxies() 返回的完整 proxies 对象
 * @returns {boolean} true 表示当前是有效节点，false 表示需要重新选
 */
function isGlobalNowValidRealNode(proxies) {
  const globalGroup = proxies['GLOBAL'];
  if (!globalGroup || !globalGroup.now) return false;
  const now = globalGroup.now;
  if (now === 'DIRECT' || now === 'REJECT') return false;
  const node = proxies[now];
  if (!node) return false;
  // 代理组（Selector/URLTest/Fallback/LoadBalance/Relay）：有效
  // mihomo 会递归解析到最终真实节点
  const groupTypes = ['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay'];
  if (node.type && groupTypes.includes(node.type)) return true;
  // 真实节点：必须有 server 字段（跳过伪节点）
  if (!node.server) return false;
  return true;
}

/**
 * 切换 Clash 内核代理模式（PATCH /configs {mode}）
 * 阶段一仅做运行时切换，不持久化到 OpenClash uci 配置；
 * OpenClash 重启后会回到 uci 默认模式，需走阶段三 LuCI switch_rule_mode 才能持久化
 *
 * 关键行为：
 * 1. PATCH /configs {mode} 切换内核 mode
 * 2. 切换到 global 时，若 GLOBAL 组当前指向 DIRECT/REJECT，自动指向第一个有效代理节点
 *    原因：global 模式下所有流量走 GLOBAL 组，若 GLOBAL 指向 DIRECT 则表现同 direct
 * 3. closeAllConnections 关闭所有活跃连接，让新连接按新 mode 匹配
 *
 * @param {'rule'|'global'|'direct'} mode - Clash 内核代理模式
 * @returns {Promise<boolean>} 是否切换成功
 */
async function switchClashMode(mode) {
  const { baseUrl, headers } = await getApiConfig();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const response = await fetch(`${baseUrl}/configs`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mode }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!response.ok) return false;

    // global 模式特殊处理：若 GLOBAL 组当前指向无效节点，自动指向优先节点
    // 无效节点定义：DIRECT/REJECT/未定义/伪节点（server 字段为空且非代理组）
    // 优先节点策略：第一个 Selector 类型代理组（通常是「节点选择」组），
    //   让 GLOBAL 跟随「节点选择」组当前选中节点；无代理组时 fallback 到第一个真实节点
    if (mode === 'global') {
      const proxies = await getClashProxies();
      if (!isGlobalNowValidRealNode(proxies)) {
        const pick = await pickPreferredGlobalNode();
        if (pick) {
          const picked = await selectProxyNode('GLOBAL', pick);
          console.log(`ClashOmega: global mode auto-picked GLOBAL -> ${pick} (success=${picked})`);
        }
      }
    }

    // 切换成功后关闭所有活跃连接，强制新连接按新 mode 匹配
    // 不阻塞主流程：失败也不影响 mode 切换的成功状态（连接关闭是辅助操作）
    closeAllConnections().catch(() => {});
    return true;
  } catch (e) {
    console.error('ClashOmega: switchClashMode failed:', e);
    return false;
  }
}