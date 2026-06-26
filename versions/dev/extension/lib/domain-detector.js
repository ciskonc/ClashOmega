// 域名检测器 — 通过 webRequest 持续收集每个 tab 的请求域名

// tabId → Map<hostname, { hostname, firstUrl, type }>
// firstUrl: 首次发现该域名时的完整请求 URL（用于调试/溯源，非时间戳）
const tabDomains = new Map();
// 每个 tab 的域名数量上限，防止长时间浏览导致内存无限制增长
const MAX_DOMAINS_PER_TAB = 500;

/**
 * 启动域名监听（在 Service Worker 中调用一次即可）
 */
function initDomainDetector() {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      // 忽略非 tab 请求（如扩展自身请求）
      if (details.tabId < 0) return;

      try {
        const url = new URL(details.url);
        const hostname = url.hostname;

        // 忽略空 hostname 和 IP 地址
        if (!hostname || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return;

        if (!tabDomains.has(details.tabId)) {
          tabDomains.set(details.tabId, new Map());
        }

        const tabMap = tabDomains.get(details.tabId);
        if (!tabMap.has(hostname)) {
          // 域名数量达到上限时跳过（防止长时间浏览导致内存泄漏）
          if (tabMap.size >= MAX_DOMAINS_PER_TAB) return;
          tabMap.set(hostname, {
            hostname,
            firstUrl: details.url,
            type: details.type // main_frame, sub_frame, script, image, xmlhttprequest, stylesheet 等
          });
        }
      } catch (e) {
        // 忽略无效 URL
      }
    },
    { urls: ["<all_urls>"] }
  );

  // tab 关闭时清理数据，避免内存泄漏
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabDomains.delete(tabId);
  });
}

/**
 * 获取指定 tab 收集的域名列表
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