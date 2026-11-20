// 域名检测器 — 通过 webRequest 持续收集每个 tab 的请求域名

// tabId → Map<hostname, { hostname, firstUrl, type }>
// firstUrl: 首次发现该域名时的完整请求 URL（用于调试/溯源，非时间戳）
const tabDomains = new Map();
// 每个 tab 的域名数量上限，防止长时间浏览导致内存无限制增长
const MAX_DOMAINS_PER_TAB = 500;
// 达到上限被截断的 tab 集合（供 UI 提示「列表已截断」）
const truncatedTabs = new Set();

// ──── v1.4.9：chrome.storage.session 会话级持久层 ────
// 背景：MV3 SW 空闲 30 秒即被 Chrome 终止，纯内存 Map 在 SW 重启后全部丢失，
// 「从页面提取域名」功能在用户停留页面超过 30 秒后静默失效。
// storage.session 语义与原内存态一致：SW 重启不清空、浏览器关闭自动清空。
// storage.session 为 Chrome 102+ API，不可用时静默降级为纯内存模式。
const SESSION_KEY_PREFIX = 'tabDomains:';

function sessionAvailable() {
  try { return !!(chrome.storage && chrome.storage.session); } catch (e) { return false; }
}

/**
 * SW 冷启动时从 session 恢复内存 Map（幂等：内存已有数据时直接返回）
 * background.js 的 getPageDomains 处理器会先 await 本函数再读内存，保证时序
 */
async function restoreTabDomainsFromSession() {
  if (!sessionAvailable() || tabDomains.size > 0) return;
  try {
    const all = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(all || {})) {
      if (!key.startsWith(SESSION_KEY_PREFIX) || !Array.isArray(value)) continue;
      const tabId = parseInt(key.slice(SESSION_KEY_PREFIX.length), 10);
      if (!Number.isFinite(tabId)) continue;
      const map = new Map();
      for (const item of value) {
        if (item && item.hostname) map.set(item.hostname, item);
      }
      if (map.size > 0) { tabDomains.set(tabId, map); if (value.length >= MAX_DOMAINS_PER_TAB) truncatedTabs.add(tabId); }
    }
  } catch (e) {
    // storage.session 不可用或读取失败：保持纯内存模式
  }
}

/** 将单个 tab 的数据写入 session（新增域名时调用，fire-and-forget） */
async function persistTabDomains(tabId) {
  if (!sessionAvailable()) return;
  try {
    const map = tabDomains.get(tabId);
    if (!map) return;
    await chrome.storage.session.set({ [SESSION_KEY_PREFIX + tabId]: Array.from(map.values()) });
  } catch (e) {
    // 配额/不可用：静默降级为纯内存
  }
}

/** tab 关闭时删除 session 中对应 key */
async function removeTabDomainsFromSession(tabId) {
  if (!sessionAvailable()) return;
  try { await chrome.storage.session.remove(SESSION_KEY_PREFIX + tabId); } catch (e) { /* 静默 */ }
}

/**
 * 启动域名监听（在 Service Worker 中调用一次即可）
 */
function initDomainDetector() {
  // 恢复上次 SW 生命周期内的采集数据（异步，不阻塞监听器注册）
  restoreTabDomainsFromSession();

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      // 忽略非 tab 请求（如扩展自身请求）
      if (details.tabId < 0) return;

      try {
        const url = new URL(details.url);
        const hostname = url.hostname;

        // 忽略空 hostname、IPv4 与 IPv6 字面量主机（v1.4.9：原实现只过滤 IPv4，
        // IPv6 主机会作为「域名」混入规则建议列表产生噪音）
        if (!hostname || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) return;

        if (!tabDomains.has(details.tabId)) {
          tabDomains.set(details.tabId, new Map());
        }

        const tabMap = tabDomains.get(details.tabId);
        if (!tabMap.has(hostname)) {
          // 域名数量达到上限时跳过（防止长时间浏览导致内存泄漏）
          // v1.4.9：记录截断标志，供 UI 提示「已截断」而非静默丢弃
          if (tabMap.size >= MAX_DOMAINS_PER_TAB) { truncatedTabs.add(details.tabId); return; }
          tabMap.set(hostname, {
            hostname,
            firstUrl: details.url,
            type: details.type // main_frame, sub_frame, script, image, xmlhttprequest, stylesheet 等
          });
          // v1.4.9：新域名立即持久化到 session（fire-and-forget，不阻塞回调）
          // 写入频率 = 新域名频率（非请求数），单条 <1KB，10MB 配额足够
          persistTabDomains(details.tabId);
        }
      } catch (e) {
        // 忽略无效 URL
      }
    },
    { urls: ["<all_urls>"] }
  );

  // tab 关闭时清理数据，避免内存泄漏（内存 + session 双清）
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabDomains.delete(tabId);
    truncatedTabs.delete(tabId);
    removeTabDomainsFromSession(tabId);
  });
}

/**
 * 获取指定 tab 收集的域名列表（同步读内存；SW 冷启动后由 getPageDomains 先 await restore）
 * @param {number} tabId
 * @returns {{ hostname: string, type: string }[]}
 */
function getTabDomains(tabId) {
  const map = tabDomains.get(tabId);
  if (!map) return [];

  return Array.from(map.values()).sort((a, b) => {
    // main_frame 排在前面
    if (a.type === 'main_frame') return -1;
    if (b.type === 'main_frame') return 1;
    return a.hostname.localeCompare(b.hostname);
  });
}

/**
 * 获取指定 tab 收集的域名数量
 * @param {number} tabId
 * @returns {number}
 */
function getTabDomainCount(tabId) {
  const map = tabDomains.get(tabId);
  return map ? map.size : 0;
}

/**
 * 获取指定 tab 是否发生过截断（v1.4.9 新增，供 UI 提示）
 * @param {number} tabId
 * @returns {boolean}
 */
function getTabDomainTruncated(tabId) {
  return truncatedTabs.has(tabId);
}
