// Clash Manager — Popup JS
// 与 background.js 通过 chrome.runtime.sendMessage 通信

// ──── 工具函数 ────

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || {});
    });
  });
}

function showToast(message, type = '', options = {}) {
  const old = document.querySelector('.toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type ? 'toast--' + type : ''}`;

  if (options.action) {
    // 带按钮的提示：允许交互
    toast.classList.add('toast--actionable');
    const textSpan = document.createElement('span');
    textSpan.className = 'toast-text';
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    const btn = document.createElement('button');
    btn.className = 'toast-action-btn';
    btn.textContent = options.action.label;
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = '...';
      try {
        await options.action.callback();
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
        toast.remove();
      }
    });
    toast.appendChild(btn);
  } else {
    toast.textContent = message;
  }

  document.body.appendChild(toast);

  // 带按钮的提示显示更久，给用户时间点击
  const duration = options.duration || (options.action ? 8000 : 2500);
  setTimeout(() => toast.remove(), duration);
}

/**
 * 触发重启 Clash（复用底部按钮的逻辑，供 toast 按钮调用）
 * @returns {Promise<{success: boolean}>}
 */
async function triggerRestartClash() {
  const btn = document.getElementById('restart-clash-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';
  const result = await sendToBackground({ action: 'restartClash' });
  btn.disabled = false;
  btn.textContent = originalText;
  if (result && result.success) {
    showToast(I18N.t('restart_clash_success'), 'success');
    // 重启成功后自动刷新 popup UI，无需用户重新打开
    // 刷新范围：域名匹配检测、Clash 规则列表、额外脚本规则
    // 延迟 300ms 等 toast 先渲染，避免视觉抖动
    setTimeout(() => { initPopup(); }, 300);
  } else {
    showToast(I18N.t('restart_clash_failed'), 'error');
  }
  return result;
}

/**
 * 显示 Native Host 错误，优先展示具体错误信息
 * @param {object} result - Native Host 返回结果
 * @param {string} fallbackKey - 兜底 i18n key
 */
function showNativeError(result, fallbackKey) {
  if (result && result.error) {
    const err = result.error;
    // Native Host 未安装 → 提示运行 install.ps1
    if (err.includes('not found') || err.includes('native messaging host')) {
      showToast(I18N.t('error_native_not_installed'), 'error');
      console.error('Native Host error:', err, '| Extension ID:', chrome.runtime.id);
      return;
    }
    showToast(err, 'error');
    return;
  }
  if (result && result.message) {
    showToast(result.message, 'error');
    return;
  }
  showToast(I18N.t(fallbackKey || 'error_native_host'), 'error');
}

// ──── 域名匹配检测算法（增强版：支持更多规则类型） ────

function findMatchingRules(domain, rules) {
  const matched = [];
  const domainLower = domain.toLowerCase();

  rules.forEach((rule, index) => {
    let isMatch = false;
    const payload = (rule.payload || '').toLowerCase();
    const type = normalizeRuleType(rule.type);

    switch (type) {
      case 'DOMAIN':
        isMatch = domainLower === payload;
        break;
      case 'DOMAINSUFFIX':
        isMatch = domainLower === payload || domainLower.endsWith('.' + payload);
        break;
      case 'DOMAINKEYWORD':
        isMatch = domainLower.includes(payload);
        break;
      case 'GEOSITE':
        // GEOSITE 无法精确匹配单个域名，粗略用关键词匹配
        isMatch = domainLower.includes(payload);
        break;
      case 'RULESET':
        // RULE-SET 无法在浏览器端解析，始终不匹配
        isMatch = false;
        break;
      case 'MATCH':
        // MATCH 是兜底规则，匹配所有
        isMatch = true;
        break;
      default:
        // 未知类型：尝试关键词匹配
        if (payload) {
          isMatch = domainLower.includes(payload);
        }
        break;
    }
    if (isMatch) {
      matched.push({ index, type: rule.type, payload: rule.payload, proxy: rule.proxy });
    }
  });
  return matched;
}

/**
 * 通过 Clash API /connections 查询域名实际匹配的规则
 * 用于 RULE-SET 等浏览器端无法匹配的规则类型
 * @param {string} domain - 当前 tab 的主域名
 * @param {Array} connections - Clash API /connections 返回的连接列表
 * @param {Array} rules - Clash API /rules 返回的规则列表（用于查找规则索引）
 * @returns {Array} 匹配的规则列表，格式与 findMatchingRules 返回值一致
 */
function findMatchingRulesFromConnections(domain, connections, rules) {
  const matched = [];
  const domainLower = domain.toLowerCase();
  const seen = new Set(); // 去重：同一 rulePayload 只记录一次

  for (const conn of connections) {
    // mihomo 的 metadata.host 可能为空（IP 直连或 DNS 未解析），
    // 此时 sniffHost（TLS SNI / HTTP Host header sniffing 结果）可能有值
    const rawHost = (conn.metadata && (conn.metadata.host || conn.metadata.sniffHost)) || '';
    const host = rawHost.toLowerCase();
    if (!host) continue;

    // ──── 严格域名匹配：不使用关键词包含，避免 com/net 等通用 TLD 造成误匹配 ────
    // 匹配条件（任一满足即可）：
    //   1. host 与 domain 完全相同 → 精确匹配
    //   2. host 是 domain 的子域（host 以 .domain 结尾）→ 子域匹配
    //   3. domain 是 host 的子域（domain 以 .host 结尾）→ 反向子域匹配
    //
    // 示例 (domain = www.whatismyip.com.tw):
    //   host = www.whatismyip.com.tw → ✓ 完全相同
    //   host = cdn.www.whatismyip.com.tw → ✓ 是 domain 的子域
    //   host = whatismyip.com.tw → ✓ domain 是 host 的子域
    //   host = www.google.com → ✗ 不匹配
    //   host = api.something.com → ✗ 不匹配（旧关键词逻辑会错误地将 'com' 当成匹配）
    const exactMatch = host === domainLower;
    const hostIsSubdomain = domainLower.length > host.length && domainLower.endsWith('.' + host);
    const domainIsSubdomain = host.length > domainLower.length && host.endsWith('.' + domainLower);

    if (!exactMatch && !hostIsSubdomain && !domainIsSubdomain) {
      continue;
    }

    const ruleType = conn.rule || '';
    const rulePayload = conn.rulePayload || '';
    // chains 结构: [代理节点, 中间代理组, ..., 规则匹配的代理组]
    // 最后一个元素是规则匹配的代理组（如"🔍 谷歌服务"）
    const proxy = (conn.chains && conn.chains.length > 0) ? conn.chains[conn.chains.length - 1] : '';

    // 按 rulePayload 去重（同一规则只记录一次）
    const dedupKey = ruleType + '|' + rulePayload;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // 在 rules 列表中查找对应规则的索引
    let ruleIndex = -1;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const rType = normalizeRuleType(r.type);
      const cType = normalizeRuleType(ruleType);
      if (rType === cType && (r.payload || '').toLowerCase() === rulePayload.toLowerCase()) {
        ruleIndex = i;
        break;
      }
    }

    matched.push({
      index: ruleIndex >= 0 ? ruleIndex : 0,
      type: ruleType,
      payload: rulePayload,
      proxy: proxy
    });
  }

  return matched;
}

// ──── 批量检测：智能域名分组 ────

/**
 * 将域名列表按二级域名分组，推荐使用 *.suffix 形式
 * 例如: i1.art.com, i2.art.com → 建议 *.art.com (DOMAIN-SUFFIX)
 * 仅当同一后缀下有 2 个及以上域名时才建议通配符
 */
function smartGroupDomains(domains) {
  const groups = new Map();

  domains.forEach(d => {
    const parts = d.hostname.split('.');
    let suffix, isWildcard;

    if (parts.length >= 3) {
      // 三级及以上域名 → 提取二级域名后缀
      suffix = parts.slice(-2).join('.');
      isWildcard = true;
    } else {
      // 二级域名 → 直接使用
      suffix = d.hostname;
      isWildcard = false;
    }

    if (!groups.has(suffix)) {
      groups.set(suffix, { suffix, domains: [], isWildcard });
    }
    groups.get(suffix).domains.push(d);
  });

  // 转换为建议列表
  const suggestions = [];
  groups.forEach(group => {
    const g = group;
    if (g.domains.length >= 2 && g.isWildcard) {
      // 2+ 个共享后缀 → 建议通配符
      suggestions.push({
        suggested: '*.' + g.suffix,
        type: 'DOMAIN-SUFFIX',
        hostnames: g.domains.map(d => d.hostname),
        count: g.domains.length
      });
    } else {
      // 单个域名 → 逐个建议
      g.domains.forEach(d => {
        suggestions.push({
          suggested: d.hostname,
          type: 'DOMAIN-SUFFIX',
          hostnames: [d.hostname],
          count: 1
        });
      });
    }
  });

  return suggestions;
}

// ──── 渲染函数 ────

function refreshAllI18n() {
  // 1. 处理 data-i18n（文本内容）
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (el.tagName === 'OPTION') {
      el.textContent = I18N.t(key);
    } else if (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'H3' || el.tagName === 'LABEL') {
      if (!el.hasAttribute('data-i18n-preserve')) {
        el.textContent = I18N.t(key);
      }
    }
  });
  // 2. 处理 data-i18n-placeholder（输入框占位文本）
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = I18N.t(key);
  });
  // 3. 处理 data-i18n-title（悬停提示）
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = I18N.t(key);
  });
}

function renderModeSwitch(currentMode) {
  const buttons = document.querySelectorAll('#mode-switch button');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
  });
}

function renderClashStatus(running, config, proxyPort) {
  const dot = document.getElementById('clash-status-dot');
  const text = document.getElementById('clash-status-text');

  if (running && config) {
    dot.className = 'status-dot status-dot--on';
    text.textContent = `${I18N.t('clash_connected')} | ${I18N.t('clash_proxy_port')} ${proxyPort}`;
    text.style.cursor = 'default';
    text.title = '';
    text.onclick = null;
  } else {
    dot.className = 'status-dot status-dot--off';
    text.textContent = I18N.t('clash_not_running') + ' — ' + I18N.t('settings_title');
    text.style.cursor = 'pointer';
    text.title = I18N.t('settings_title');
    text.onclick = () => openSettings();
  }
}

function renderSystemProxyStatus(sysProxy) {
  const dot = document.getElementById('system-proxy-dot');
  const text = document.getElementById('system-proxy-text');

  if (!sysProxy || !sysProxy.success) {
    dot.className = 'status-dot status-dot--off';
    text.textContent = I18N.t('system_proxy_unknown');
    return;
  }

  // PAC 自动配置
  if (sysProxy.autoConfigUrl) {
    dot.className = 'status-dot status-dot--warn';
    text.textContent = `${I18N.t('system_proxy_pac')} (${sysProxy.autoConfigUrl})`;
    return;
  }

  // 手动代理 → 红色
  if (sysProxy.proxyEnable && sysProxy.proxyServer) {
    dot.className = 'status-dot status-dot--off';
    text.textContent = `${I18N.t('system_proxy_proxy')} (${sysProxy.proxyServer})`;
    return;
  }

  // 直连 → 绿色
  dot.className = 'status-dot status-dot--on';
  text.textContent = I18N.t('system_proxy_direct');
}

function getPolicyClass(proxy) {
  const lower = (proxy || '').toLowerCase();
  if (lower === 'proxy') return 'rule-policy--proxy';
  if (lower === 'direct') return 'rule-policy--direct';
  if (lower === 'reject' || lower === 'drop') return 'rule-policy--reject';
  return 'rule-policy--group';
}

/**
 * 递归解析代理组链路，得到最终显示的策略
 *
 * 解析规则：
 *   - DIRECT/REJECT/DROP → 直接返回
 *   - 链路中遇到"自动选择"（URLTest 类型）→ 返回「自动选择」
 *   - 链路中遇到具体节点 → 返回节点名称
 *   - 最多递归 5 层，防止循环引用
 *
 * @param {string} proxyName - 规则的 proxy 字段（代理组名或 DIRECT/REJECT）
 * @param {object} proxies - /proxies API 返回的代理组字典
 * @returns {{name: string, class: string}} 最终显示的策略名和 CSS 类
 */
function resolveFinalProxy(proxyName, proxies) {
  const lower = (proxyName || '').toLowerCase();
  if (lower === 'direct') return { name: 'DIRECT', class: 'rule-policy--direct' };
  if (lower === 'reject' || lower === 'drop') return { name: 'REJECT', class: 'rule-policy--reject' };

  if (!proxies || !proxyName) {
    return { name: proxyName || 'DIRECT', class: getPolicyClass(proxyName) };
  }

  // 递归解析代理组链路
  let current = proxyName;
  const visited = new Set();
  for (let i = 0; i < 5; i++) {
    if (visited.has(current)) break;
    visited.add(current);

    const lowerCurrent = current.toLowerCase();
    if (lowerCurrent === 'direct') return { name: 'DIRECT', class: 'rule-policy--direct' };
    if (lowerCurrent === 'reject' || lowerCurrent === 'drop') return { name: 'REJECT', class: 'rule-policy--reject' };

    // 链路中遇到"自动选择"类型组 → 优先显示「自动选择」
    if (current.includes('自动选择') || /auto/i.test(current)) {
      return { name: '自动选择', class: 'rule-policy--proxy' };
    }

    const proxy = proxies[current];
    if (!proxy || !proxy.now) break;
    current = proxy.now;
  }

  // 最终 current 是节点名称或 DIRECT/REJECT
  const lowerFinal = current.toLowerCase();
  if (lowerFinal === 'direct') return { name: 'DIRECT', class: 'rule-policy--direct' };
  if (lowerFinal === 'reject' || lowerFinal === 'drop') return { name: 'REJECT', class: 'rule-policy--reject' };
  if (current.includes('自动选择') || /auto/i.test(current)) return { name: '自动选择', class: 'rule-policy--proxy' };

  return { name: current, class: 'rule-policy--group' };
}

/**
 * 归一化规则类型：去除连字符并转大写
 * DOMAIN-SUFFIX → DOMAINSUFFIX, DomainSuffix → DOMAINSUFFIX
 * 兼容 Clash API 不同版本返回的类型格式差异
 */
function normalizeRuleType(type) {
  return (type || '').toUpperCase().replace(/-/g, '');
}

function isDomainRule(type) {
  const t = normalizeRuleType(type);
  return t === 'DOMAIN' || t === 'DOMAINSUFFIX' || t === 'DOMAINKEYWORD';
}

function renderDomainRuleCheck(domain, matchedRules, proxies) {
  document.getElementById('current-domain').textContent = domain;
  const matchedEl = document.getElementById('domain-check-matched');
  const notMatchedEl = document.getElementById('domain-check-not-matched');

  matchedEl.innerHTML = '';
  notMatchedEl.style.display = 'none';

  if (matchedRules.length === 0) {
    notMatchedEl.style.display = 'block';
    return;
  }

  // 方案 B：只显示第一条命中的规则（Clash first-match-wins，第一条即实际生效的规则）
  // 如果只匹配 MATCH 兜底规则，也显示 MATCH（这是实际生效的规则）
  const rule = matchedRules[0];
  const div = document.createElement('div');
  div.className = 'matched-rule-item';
  // 解析最终策略：递归代理组链路，优先显示「自动选择」，否则显示节点名或 DIRECT/REJECT
  const finalProxy = resolveFinalProxy(rule.proxy, proxies);
  const ruleStr = `${rule.type},${rule.payload},${rule.proxy}`;
  const canDelete = isDomainRule(rule.type);
  // 判断规则来源：在 window._scriptRulesWithSource 中查找（由 loadScriptRules 设置）
  // JS 来源 → data-script="1"（删除时调用 useScript=true）
  // YAML 来源 → data-script="0"（删除时调用 useScript=false）
  let scriptFlag = '0';
  if (canDelete && window._scriptRulesWithSource) {
    const found = window._scriptRulesWithSource.find(
      item => item.rule.toLowerCase() === ruleStr.toLowerCase()
    );
    if (found) {
      scriptFlag = found.source === 'JS' ? '1' : '0';
    }
  }
  div.innerHTML = `
    <span class="rule-index">#${rule.index + 1}</span>
    <span class="rule-type-tag">${rule.type}</span>
    <span class="rule-payload">${rule.payload || '—'}</span>
    <span class="rule-group-name" title="${rule.proxy}">${rule.proxy}</span>
    <span class="rule-policy ${finalProxy.class}" title="${finalProxy.name}">${finalProxy.name}</span>
    ${canDelete ? `<button class="rule-delete-btn" data-rule="${ruleStr}" data-script="${scriptFlag}" data-i18n-title="rule_delete" title="${I18N.t('rule_delete')}">✕</button>` : ''}
  `;
  matchedEl.appendChild(div);
}

function renderRuleList(rules, proxies) {
  const listEl = document.getElementById('rule-list');
  const countEl = document.getElementById('rule-count');
  // 过滤掉 DOMAIN 类规则（DOMAIN/DOMAINSUFFIX/DOMAINKEYWORD）
  // 这些规则属于用户可删除的「额外脚本规则」，不显示在「内置 Clash 规则」列表
  const builtinRules = rules.filter(r => !isDomainRule(r.type));
  countEl.textContent = builtinRules.length;

  listEl.innerHTML = '';
  if (builtinRules.length === 0) {
    listEl.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant); font: var(--md-typescale-body-small); padding: var(--md-spacing-2) 0;">' + I18N.t('domain_check_not_matched') + '</div>';
    return;
  }

  builtinRules.forEach((rule, index) => {
    const ruleStr = `${rule.type},${rule.payload},${rule.proxy}`;
    const div = document.createElement('div');
    div.className = 'rule-item';
    // 解析最终策略：递归代理组链路，优先显示「自动选择」，否则显示节点名或 DIRECT/REJECT
    const finalProxy = resolveFinalProxy(rule.proxy, proxies);
    div.innerHTML = `
      <span class="rule-type-tag">${rule.type}</span>
      <span class="rule-payload" title="${ruleStr}">${rule.payload || '—'}</span>
      <span class="rule-group-name" title="${rule.proxy}">${rule.proxy}</span>
      <span class="rule-policy ${finalProxy.class}" title="${finalProxy.name}">${finalProxy.name}</span>
    `;
    listEl.appendChild(div);
  });
}

// ──── 额外脚本规则渲染 ────

/**
 * 渲染「额外脚本规则」列表（支持混合来源）
 * @param {Array<{rule: string, source: string}>|null} rulesWithSource - 规则数组，每项含 rule（"TYPE,PAYLOAD,PROXY"）和 source（'JS'/'YAML'）；null 表示文件未找到/未初始化
 * @param {object} proxies - /proxies API 返回的代理组字典，用于解析最终策略
 */
function renderScriptRules(rulesWithSource, proxies) {
  const listEl = document.getElementById('script-rule-list');
  const countEl = document.getElementById('script-rule-count');
  const emptyEl = document.getElementById('script-rule-empty');
  const needInitEl = document.getElementById('script-rule-need-init');
  const notFoundEl = document.getElementById('script-rule-not-found');

  // 隐藏所有状态
  emptyEl.style.display = 'none';
  needInitEl.style.display = 'none';
  notFoundEl.style.display = 'none';
  listEl.innerHTML = '';

  if (!rulesWithSource) {
    // rulesWithSource 为 null 表示文件未找到或未初始化，由调用方处理状态显示
    return;
  }

  countEl.textContent = rulesWithSource.length;

  if (rulesWithSource.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  rulesWithSource.forEach(({ rule: ruleStr, source }) => {
    const parts = ruleStr.split(',');
    const type = parts[0] || '';
    const payload = parts[1] || '';
    const proxy = parts[2] || '';
    const div = document.createElement('div');
    div.className = 'rule-item';
    // 解析最终策略：递归代理组链路，优先显示「自动选择」，否则显示节点名或 DIRECT/REJECT
    const finalProxy = resolveFinalProxy(proxy, proxies);
    const fullRule = `${type},${payload},${proxy}`;
    // 来源标识 HTML：JS 蓝色小标签 / YA 橙色小标签（YAML 缩写为 YA 节省空间）
    const sourceTagHtml = source === 'JS'
      ? `<span class="rule-source-tag rule-source--js" title="${I18N.t('rule_source_js')}">JS</span>`
      : `<span class="rule-source-tag rule-source--yaml" title="${I18N.t('rule_source_yaml')}">YA</span>`;
    // 删除按钮的 data-script 属性：JS 来源 → "1"（删除时调用 useScript=true），YAML 来源 → "0"
    const scriptFlag = source === 'JS' ? '1' : '0';
    div.innerHTML = `
      ${sourceTagHtml}
      <span class="rule-type-tag">${type}</span>
      <span class="rule-payload" title="${fullRule}">${payload || '—'}</span>
      <span class="rule-group-name" title="${proxy}">${proxy}</span>
      <span class="rule-policy ${finalProxy.class}" title="${finalProxy.name}">${finalProxy.name}</span>
      <button class="rule-delete-btn" data-rule="${fullRule}" data-script="${scriptFlag}" data-i18n-title="rule_delete" title="${I18N.t('rule_delete')}">✕</button>
    `;
    listEl.appendChild(div);
  });
}

// 加载额外脚本规则（合并 JS + YAML 两个来源）
// 数据源：
//   - JS 来源：Script.js 的 EXT_RULES（用户在 useScriptRule=true 时添加的规则）
//   - YAML 来源：Clash API /rules 中 DOMAIN 类规则，减去 JS 来源（去重）
//   - 合并显示，每条带来源标识（JS/YAML）
// 去重原因：Script.js 的规则通过 main(config) 前置到 config.rules，
//           会同时出现在 /rules 中，需按 "TYPE,PAYLOAD,PROXY" 字符串去重
async function loadScriptRules() {
  // 并行获取所有所需数据
  const [scriptResult, proxiesResult, clashRulesResult] = await Promise.all([
    sendToBackground({ action: 'getScriptRules' }),
    sendToBackground({ action: 'getProxies' }),
    sendToBackground({ action: 'getClashRules' })
  ]);
  const proxies = proxiesResult.success ? proxiesResult.proxies : null;
  const clashRules = clashRulesResult.success ? clashRulesResult.rules : null;
  const needInitEl = document.getElementById('script-rule-need-init');
  const notFoundEl = document.getElementById('script-rule-not-found');

  // ──── JS 来源：Script.js 的 EXT_RULES ────
  let jsRules = [];
  let jsFileOk = true;
  if (!scriptResult.success) {
    jsFileOk = false;
    if (scriptResult.needInit) {
      needInitEl.style.display = 'block';
    } else {
      notFoundEl.style.display = 'block';
    }
    document.getElementById('script-rule-count').textContent = '0';
  } else {
    jsRules = scriptResult.rules || [];
  }

  // ──── YAML 来源：Clash API /rules 中 DOMAIN 类规则 ────
  // 去重：排除已在 Script.js 中的规则（按 "TYPE,PAYLOAD,PROXY" 字符串小写匹配）
  let yamlRules = [];
  if (clashRulesResult.success) {
    const jsRuleSet = new Set(jsRules.map(r => r.toLowerCase()));
    yamlRules = clashRulesResult.rules
      .filter(r => isDomainRule(r.type))
      .map(r => `${r.type},${r.payload},${r.proxy}`)
      .filter(ruleStr => !jsRuleSet.has(ruleStr.toLowerCase()));
  }

  // ──── 合并显示 ────
  // 如果 Script.js 文件未找到/未初始化，只显示 YAML 来源（若有）
  if (!jsFileOk) {
    const merged = yamlRules.map(rule => ({ rule, source: 'YAML' }));
    renderScriptRules(merged, proxies);
    // 重新隐藏 needInit/notFound（renderScriptRules 会隐藏所有状态），再恢复显示
    if (scriptResult.needInit) {
      needInitEl.style.display = 'block';
    } else if (!scriptResult.success) {
      notFoundEl.style.display = 'block';
    }
    return { clashRules, proxies };
  }

  // 合并：JS 来源 + YAML 来源
  const merged = [
    ...jsRules.map(rule => ({ rule, source: 'JS' })),
    ...yamlRules.map(rule => ({ rule, source: 'YAML' }))
  ];
  // 保存到全局变量，供 renderDomainRuleCheck 判断规则来源（JS/YAML）使用
  // 用于 F1 域名匹配检测中的删除按钮 data-script 属性
  window._scriptRulesWithSource = merged;
  renderScriptRules(merged, proxies);
  return { clashRules, proxies };
}

// 绑定扩展脚本规则初始化按钮
function bindScriptInitButton() {
  document.getElementById('script-init-btn').addEventListener('click', async () => {
    const btn = document.getElementById('script-init-btn');
    btn.disabled = true;
    const result = await sendToBackground({ action: 'initScriptFile' });
    btn.disabled = false;
    if (result.success) {
      showToast(I18N.t('script_rules_init_success'), 'success');
      await loadScriptRules();
    } else {
      showToast(I18N.t('script_rules_init_failed') + ': ' + (result.error || ''), 'error');
    }
  });
}

function renderLanguageSetting() {
  const select = document.getElementById('language-select');
  select.innerHTML = '';
  I18N.SUPPORTED_LANGS.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = I18N.getLangName(lang);
    if (lang === I18N.getCurrentLang()) opt.selected = true;
    select.appendChild(opt);
  });
}

// ──── 动态加载代理组下拉框（快捷添加/批量检测共用） ────

async function populateProxyGroupSelects() {
  const quickAddSelect = document.getElementById('quick-add-policy');
  const batchDetectSelect = document.getElementById('batch-detect-policy');

  // 先重置为加载中
  const loadingHtml = '<option value="">' + I18N.t('quick_add_loading') + '</option>';
  quickAddSelect.innerHTML = loadingHtml;
  batchDetectSelect.innerHTML = loadingHtml;

  const result = await sendToBackground({ action: 'getProxies' });
  const proxies = result.proxies || {};

  // 筛选出代理组（type === 'Selector' 或 'URLTest' 等，且有 all 字段）
  const groupNames = [];
  Object.entries(proxies).forEach(([name, info]) => {
    if (info.all && info.all.length > 0) {
      groupNames.push(name);
    }
  });

  if (groupNames.length === 0) {
    // 没有代理组时回退到硬编码选项
    const fallback = ['Proxy', 'DIRECT', 'REJECT'];
    [quickAddSelect, batchDetectSelect].forEach(sel => {
      sel.innerHTML = '';
      fallback.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
    });
    return;
  }

  // 添加 DIRECT 和 REJECT 作为固定选项
  const allOptions = [...groupNames, 'DIRECT', 'REJECT'];

  [quickAddSelect, batchDetectSelect].forEach(sel => {
    sel.innerHTML = '';
    allOptions.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  });
}

// ──── 绑定事件 ────

function bindModeSwitchEvents() {
  document.getElementById('mode-switch').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const mode = btn.dataset.mode;
    const result = await sendToBackground({ action: 'setMode', mode });
    if (result.success) {
      renderModeSwitch(mode);
      // 模式切换后重新初始化 popup，更新域名匹配检测状态
      // （非 clash 模式下域名匹配检测应显示提示，clash 模式下应正常检测）
      await initPopup();
    } else {
      showToast(result?.error || I18N.t('error_clash_unreachable'), 'error');
    }
  });
}

function bindQuickAddRule(domain) {
  // 默认填入当前域名，用户可清空后输入任意域名
  document.getElementById('quick-add-domain').value = domain;

  document.getElementById('quick-add-btn').addEventListener('click', async () => {
    // 从 input 读取域名（用户可能已修改为自定义域名）
    const inputDomain = document.getElementById('quick-add-domain').value.trim();
    if (!inputDomain) {
      showToast(I18N.t('quick_add_select_policy'), 'error');
      return;
    }
    const ruleType = document.getElementById('quick-add-rule-type').value;
    const policy = document.getElementById('quick-add-policy').value;
    if (!policy) {
      showToast(I18N.t('quick_add_select_policy'), 'error');
      return;
    }
    const rule = `${ruleType},${inputDomain},${policy}`;

    const result = await sendToBackground({ action: 'addRule', rule });
    if (result && result.success) {
      // 提示用户需重启 Clash 生效，toast 内带「重启 Clash」按钮可直接点击
      showToast(I18N.t('success_rule_added') + ' — ' + I18N.t('rule_restart_hint'), 'success', {
        action: {
          label: I18N.t('restart_clash'),
          callback: triggerRestartClash
        }
      });
      // 乐观更新：始终插入「额外脚本规则」列表
      // useScriptRule 开关仅决定写入位置和来源标识（JS/YAML），UI 显示统一
      const settings = await sendToBackground({ action: 'getSettings' });
      const useScript = settings.useScriptRule === true;
      const listEl = document.getElementById('script-rule-list');
      const countEl = document.getElementById('script-rule-count');
      // 如果列表显示的是空占位文本，先清掉
      const placeholder = listEl.querySelector('div[style]');
      if (placeholder && !placeholder.classList.contains('rule-item')) {
        listEl.innerHTML = '';
      }
      // 隐藏空状态提示
      document.getElementById('script-rule-empty').style.display = 'none';
      // 来源标识 HTML（YAML 缩写为 YA 节省空间）
      const sourceTagHtml = useScript
        ? `<span class="rule-source-tag rule-source--js" title="${I18N.t('rule_source_js')}">JS</span>`
        : `<span class="rule-source-tag rule-source--yaml" title="${I18N.t('rule_source_yaml')}">YA</span>`;
      const div = document.createElement('div');
      div.className = 'rule-item';
      const policyClass = getPolicyClass(policy);
      div.innerHTML = `
        ${sourceTagHtml}
        <span class="rule-type-tag">${ruleType}</span>
        <span class="rule-payload" title="${rule}">${inputDomain}</span>
        <span class="rule-group-name" title="${policy}">${policy}</span>
        <span class="rule-policy ${policyClass}">${policy}</span>
        <button class="rule-delete-btn" data-rule="${rule}" data-script="${useScript ? '1' : '0'}" data-i18n-title="rule_delete" title="${I18N.t('rule_delete')}">✕</button>
      `;
      listEl.appendChild(div);
      countEl.textContent = parseInt(countEl.textContent) + 1;
    } else {
      showNativeError(result, 'error_native_host');
    }
  });
}

function bindDomainDetection(tabId) {
  const detectBtn = document.getElementById('batch-detect-btn');
  const summaryEl = document.getElementById('batch-detect-summary');
  const listEl = document.getElementById('batch-detect-domain-list');
  const batchBtn = document.getElementById('batch-detect-batch-btn');
  const actionsEl = document.getElementById('batch-detect-actions');

  let currentSuggestions = [];

  detectBtn.addEventListener('click', async () => {
    detectBtn.disabled = true;
    detectBtn.textContent = '...';

    const result = await sendToBackground({ action: 'getPageDomains' });
    detectBtn.disabled = false;
    detectBtn.textContent = I18N.t('batch_detect_btn');

    if (!result.success || result.domains.length === 0) {
      summaryEl.style.display = 'block';
      summaryEl.textContent = `${I18N.t('batch_detect_collected')} 0 ${I18N.t('batch_detect_domains')}`;
      listEl.style.display = 'none';
      actionsEl.style.display = 'none';
      return;
    }

    // 智能分组
    const suggestions = smartGroupDomains(result.domains);
    currentSuggestions = suggestions;

    summaryEl.style.display = 'block';
    summaryEl.textContent = `${I18N.t('batch_detect_collected')} ${result.count} ${I18N.t('batch_detect_domains')}, ${I18N.t('batch_detect_grouped')} ${suggestions.length} ${I18N.t('batch_detect_groups')}`;

    listEl.style.display = 'block';
    listEl.innerHTML = '';
    // 检测到域名后显示操作栏（全选/取消/代理组/批量添加）
    actionsEl.style.display = 'flex';

    suggestions.forEach((s, idx) => {
      const div = document.createElement('div');
      div.className = 'domain-group-item';

      if (s.count >= 2) {
        // 通配符建议
        div.innerHTML = `
          <label class="md3-checkbox">
            <input type="checkbox" value="${s.suggested}" data-type="${s.type}" data-idx="${idx}">
            <span class="domain-suggested">${s.suggested}</span>
            <span class="domain-count">${s.count} ${I18N.t('batch_detect_domains')}</span>
          </label>
          <div class="domain-sub-list">${s.hostnames.map(h => `<span class="domain-sub">${h}</span>`).join('')}</div>
        `;
      } else {
        // 单个域名
        div.innerHTML = `
          <label class="md3-checkbox">
            <input type="checkbox" value="${s.suggested}" data-type="${s.type}" data-idx="${idx}">
            <span class="domain-suggested">${s.suggested}</span>
            <span class="domain-type-tag">${s.type}</span>
          </label>
        `;
      }
      listEl.appendChild(div);
    });
  });

  // 全选
  document.getElementById('batch-detect-select-all').addEventListener('click', () => {
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });

  // 取消：清空选中状态，隐藏操作栏和列表，恢复初始状态
  document.getElementById('batch-detect-deselect-all').addEventListener('click', () => {
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    // 隐藏操作栏、列表、摘要，恢复到点击检测按钮前的状态
    actionsEl.style.display = 'none';
    listEl.style.display = 'none';
    summaryEl.style.display = 'none';
    listEl.innerHTML = '';
  });

  // 批量添加
  batchBtn.addEventListener('click', async () => {
    const checked = listEl.querySelectorAll('input[type="checkbox"]:checked');
    if (checked.length === 0) {
      showToast(I18N.t('batch_detect_select_all'), 'error');
      return;
    }

    const policy = document.getElementById('batch-detect-policy').value;
    if (!policy) {
      showToast(I18N.t('quick_add_select_policy'), 'error');
      return;
    }

    const rules = Array.from(checked).map(cb => `${cb.dataset.type},${cb.value},${policy}`);

    batchBtn.disabled = true;
    const result = await sendToBackground({ action: 'batchAddRules', rules });
    batchBtn.disabled = false;

    if (result && result.success) {
      showToast(`${checked.length} ${I18N.t('success_rules_added')}`, 'success');
      // 刷新「额外脚本规则」列表（用户添加的可删除规则统一显示在此列表）
      // 不再刷新「内置 Clash 规则」列表，因为批量添加的 DOMAIN 类规则不属于内置规则
      await loadScriptRules();
    } else {
      showNativeError(result, 'error_native_host');
    }
  });
}

function bindDomainCheckDeleteEvents() {
  document.getElementById('domain-check-matched').addEventListener('click', async (e) => {
    const btn = e.target.closest('.rule-delete-btn');
    if (!btn) return;

    const ruleStr = btn.dataset.rule;
    const isScript = btn.dataset.script === '1';
    // 根据规则来源决定删除方式：
    // JS 来源 → useScript=true（从 Script.js 删除）
    // YAML 来源 → useScript=false（从 YAML 配置文件删除）
    // 必须显式传 useScript，否则 background.js 会回退到 settings.useScriptRule 导致误删
    let result;
    if (isScript) {
      result = await sendToBackground({ action: 'removeRule', rule: ruleStr, useScript: true });
    } else {
      result = await sendToBackground({ action: 'removeRule', rule: ruleStr, useScript: false });
    }
    if (result && result.success) {
      // 提示用户需重启 Clash 生效，toast 内带「重启 Clash」按钮可直接点击
      showToast(I18N.t('success_rule_deleted') + ' — ' + I18N.t('rule_restart_hint'), 'success', {
        action: {
          label: I18N.t('restart_clash'),
          callback: triggerRestartClash
        }
      });
      // 乐观更新：直接从 DOM 移除，不重新从内核 API 拉取（内核尚未热重载）
      // 域名匹配检测结果容器是 .matched-rule-item
      const item = btn.closest('.matched-rule-item');
      if (item) item.remove();
      // 域名匹配检测中可删除的规则属于「额外脚本规则」，删除后刷新该列表保持 UI 一致
      // 同时更新 script-rule-count
      await loadScriptRules();
    } else {
      showNativeError(result, 'error_native_host');
    }
  });
}

function bindRuleListDeleteEvents() {
  // 使用事件委托，同时处理 rule-list 和 script-rule-list 的删除按钮
  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.rule-delete-btn');
    if (!btn) return;

    const ruleStr = btn.dataset.rule;
    const isScript = btn.dataset.script === '1';
    // 乐观更新：先移除 DOM，再发请求，消除连点时的视觉延迟
    const ruleItem = btn.closest('.rule-item');
    if (!ruleItem) return;
    ruleItem.style.opacity = '0.5';
    btn.disabled = true;

    // 根据规则来源决定删除方式：
    // JS 来源 → useScript=true（从 Script.js 删除）
    // YAML 来源 → useScript=false（从 YAML 配置文件删除）
    // 必须显式传 useScript，否则 background.js 会回退到 settings.useScriptRule 导致误删
    let result;
    if (isScript) {
      result = await sendToBackground({ action: 'removeRule', rule: ruleStr, useScript: true });
    } else {
      result = await sendToBackground({ action: 'removeRule', rule: ruleStr, useScript: false });
    }

    if (result && result.success) {
      // 提示用户需重启 Clash 生效，toast 内带「重启 Clash」按钮可直接点击
      showToast(I18N.t('success_rule_deleted') + ' — ' + I18N.t('rule_restart_hint'), 'success', {
        action: {
          label: I18N.t('restart_clash'),
          callback: triggerRestartClash
        }
      });
      ruleItem.remove();
      const countEl = isScript
        ? document.getElementById('script-rule-count')
        : document.getElementById('rule-count');
      countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
      // 如果扩展脚本规则列表清空，显示空状态
      if (isScript && parseInt(countEl.textContent) === 0) {
        document.getElementById('script-rule-empty').style.display = 'block';
      }
    } else {
      // 失败时恢复
      ruleItem.style.opacity = '1';
      btn.disabled = false;
      showNativeError(result, 'error_native_host');
    }
  });
}

function bindSettingsEvents() {
  const panel = document.getElementById('settings-panel');

  // 打开设置
  document.getElementById('settings-btn').addEventListener('click', () => openSettings());

  // 关闭设置
  document.getElementById('settings-close').addEventListener('click', () => {
    panel.classList.remove('open');
  });

  // 代理地址+端口 → 自动拼接 API URL
  function autoGenerateApiUrl() {
    const host = document.getElementById('settings-proxy-host').value.trim();
    const port = document.getElementById('settings-proxy-port').value.trim();
    if (host && port) {
      document.getElementById('settings-api-url').value = `http://${host}:${port}`;
    }
  }

  document.getElementById('settings-proxy-host').addEventListener('input', autoGenerateApiUrl);
  document.getElementById('settings-proxy-port').addEventListener('input', autoGenerateApiUrl);

  // 保存设置
  document.getElementById('settings-save').addEventListener('click', async () => {
    const currentSettings = await sendToBackground({ action: 'getSettings' });
    const configPath = document.getElementById('settings-config-path').value.trim();
    const settings = {
      currentMode: currentSettings.currentMode || 'system',
      clashApiUrl: document.getElementById('settings-api-url').value.trim(),
      clashSecret: document.getElementById('settings-secret').value.trim(),
      clashProxyHost: document.getElementById('settings-proxy-host').value.trim(),
      clashProxyPort: parseInt(document.getElementById('settings-proxy-port').value) || 7890,
      clashConfigPath: configPath,
      useScriptRule: document.getElementById('settings-use-script-rule').checked,
      language: document.getElementById('language-select').value
    };
    await sendToBackground({ action: 'saveSettings', settings });
    // 如果用户手动设置了配置文件路径，同步到 Native Host
    if (configPath) {
      const pathResult = await sendToBackground({ action: 'setConfigPath', path: configPath });
      if (pathResult && pathResult.success) {
        showToast(I18N.t('settings_save') + ' — ' + I18N.t('settings_config_path') + ': ' + configPath, 'success');
      } else {
        showToast(I18N.t('settings_save') + ' — ' + (pathResult?.error || I18N.t('settings_detect_fail')), 'warn');
      }
    } else {
      showToast(I18N.t('settings_save'), 'success');
    }
    panel.classList.remove('open');
    await initPopup();
  });

  // 自动检测配置文件路径
  document.getElementById('settings-detect-config').addEventListener('click', async () => {
    const btn = document.getElementById('settings-detect-config');
    btn.disabled = true;
    btn.textContent = '...';
    const result = await sendToBackground({ action: 'ping' });
    btn.disabled = false;
    btn.textContent = I18N.t('settings_detect');
    if (result && result.configPath && result.configPath !== '(not found)') {
      document.getElementById('settings-config-path').value = result.configPath;
      showToast(result.configPath, 'success');
    } else {
      showToast(I18N.t('settings_detect_fail'), 'error');
    }
  });

  // 语言切换
  document.getElementById('language-select').addEventListener('change', async (e) => {
    await I18N.setLanguage(e.target.value);
    refreshAllI18n();
    await initPopup();
  });
}

async function openSettings() {
  const panel = document.getElementById('settings-panel');
  const settings = await sendToBackground({ action: 'getSettings' });
  document.getElementById('settings-api-url').value = settings.clashApiUrl || 'http://127.0.0.1:9090';
  document.getElementById('settings-secret').value = settings.clashSecret || '';
  document.getElementById('settings-proxy-host').value = settings.clashProxyHost || '127.0.0.1';
  document.getElementById('settings-proxy-port').value = settings.clashProxyPort || 7890;
  document.getElementById('settings-config-path').value = settings.clashConfigPath || '';
  document.getElementById('settings-use-script-rule').checked = settings.useScriptRule === true;
  panel.classList.add('open');
}

// ──── 初始化（渐进式渲染：模式切换立即渲染，其余数据异步填充） ────

async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    document.getElementById('current-domain').textContent = 'N/A';
    return;
  }

  let domain;
  try {
    domain = new URL(tab.url).hostname;
  } catch {
    document.getElementById('current-domain').textContent = I18N.t('domain_check_not_matched');
    return;
  }

  // ──── 第 0 步：立即渲染模式切换（从 chrome.storage.local 直接读取，无消息传递开销） ────
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && settings.currentMode) {
    renderModeSwitch(settings.currentMode);
  }

  // ──── 第 1 步：并行发起所有异步请求，不等待彼此 ────
  //         各请求完成后独立渲染，谁先返回谁先显示

  // 1a. Clash 状态 + 系统代理状态
  sendToBackground({ action: 'getStatus' }).then(status => {
    renderClashStatus(status.clashRunning, status.config, status.proxyPort);
    renderSystemProxyStatus(status.sysProxy);
  });

  // 1b. 代理组下拉框（快捷添加/批量检测共用）
  populateProxyGroupSelects();

  // 1c. 额外脚本规则（合并 JS + YAML 两个来源）
  //     不 await：让后续渲染并行进行
  //     返回 { clashRules, proxies } 供域名匹配检测复用，避免重复请求
  //     window._scriptRulesWithSource 在 loadScriptRules 内部设置，
  //     供 renderDomainRuleCheck 判断规则来源（JS/YAML）使用
  const scriptRulesPromise = loadScriptRules();

  // 1d. Clash 规则列表 + 域名匹配检测
  //     非 clash 模式下浏览器不走 Clash 代理，/connections 不会有该域名连接，
  //     域名匹配检测无法进行，显示提示并跳过检测
  const currentMode = settings?.currentMode || 'system';
  const domainCheckModeHint = document.getElementById('domain-check-mode-hint');
  const domainCheckMatched = document.getElementById('domain-check-matched');
  const domainCheckNotMatched = document.getElementById('domain-check-not-matched');

  if (currentMode !== 'clash') {
    // 非 clash 模式：显示提示，隐藏匹配结果
    domainCheckModeHint.style.display = 'block';
    domainCheckMatched.innerHTML = '';
    domainCheckNotMatched.style.display = 'none';
    // 复用 loadScriptRules 返回的 clashRules 和 proxies，避免重复请求
    scriptRulesPromise.then(({ clashRules, proxies }) => {
      if (clashRules) {
        renderRuleList(clashRules, proxies);
      }
    });
  } else {
    // clash 模式：隐藏提示，正常检测
    domainCheckModeHint.style.display = 'none';
    // 复用 loadScriptRules 返回的 clashRules 和 proxies
    scriptRulesPromise.then(({ clashRules, proxies }) => {
      if (!clashRules) return;

      const matched = findMatchingRules(domain, clashRules);
      renderRuleList(clashRules, proxies);

      // 判断本地匹配结果是否"不精确"：
      //   - 本地无任何匹配 → 不精确
      //   - 本地匹配全是 MATCH（兜底规则）→ 不精确（RULE-SET 等类型本地无法匹配）
      // 不精确时先显示"检测中..."占位，等待 /connections 返回内核真实匹配后再渲染
      const localImprecise = matched.length === 0 || matched.every(r => normalizeRuleType(r.type) === 'MATCH');

      if (localImprecise) {
        // 显示检测中占位，避免用户误以为 MATCH 就是最终结果
        document.getElementById('current-domain').textContent = domain;
        const matchedEl = document.getElementById('domain-check-matched');
        const notMatchedEl = document.getElementById('domain-check-not-matched');
        notMatchedEl.style.display = 'none';
        matchedEl.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant); font: var(--md-typescale-body-small); padding: var(--md-spacing-1) 0;">' + I18N.t('domain_check_detecting') + '</div>';
      } else {
        // 本地有精确匹配（DOMAIN/DOMAINSUFFIX 等），先渲染
        // window._scriptRulesWithSource 已在 loadScriptRules 中设置完成
        renderDomainRuleCheck(domain, matched, proxies);
      }

      // 始终异步查询 Clash API /connections，获取内核实际匹配的规则
      // 本地匹配无法处理 RULE-SET 等类型，/connections 返回的是内核真实匹配结果
      // 覆盖策略（放宽：/connections 有任何匹配就覆盖，因为内核结果更权威）：
      //   1. /connections 返回了匹配（无论是否 MATCH）→ 覆盖本地结果
      //   2. /connections 无匹配 → 保留本地结果（可能连接尚未建立）
      //   3. 本地不精确且 /connections 无匹配 → 1.5 秒后重试一次（等待连接建立）
      const queryConnections = (retryCount = 0) => {
        sendToBackground({ action: 'getDomainConnections' }).then(connResult => {
          if (connResult.success && connResult.connections) {
            const connMatched = findMatchingRulesFromConnections(domain, connResult.connections, clashRules);
            if (connMatched.length > 0) {
              // /connections 有匹配，覆盖本地结果
              renderDomainRuleCheck(domain, connMatched, proxies);
            } else if (localImprecise && retryCount === 0) {
              // 本地不精确且 /connections 无匹配，1.5 秒后重试一次
              setTimeout(() => queryConnections(1), 1500);
            } else if (retryCount > 0) {
              // 重试后仍无匹配，显示本地结果（可能是 MATCH）
              renderDomainRuleCheck(domain, matched, proxies);
            }
          } else if (localImprecise && retryCount === 0) {
            // /connections 请求失败，1.5 秒后重试一次
            setTimeout(() => queryConnections(1), 1500);
          } else if (retryCount > 0) {
            renderDomainRuleCheck(domain, matched, proxies);
          }
        });
      };
      queryConnections();
    });
  }

  // 绑定事件（同步，不依赖异步数据）
  // 使用标志避免模式切换重新 initPopup 时重复绑定
  if (!window._popupEventsBound) {
    bindQuickAddRule(domain);
    bindDomainDetection(tab.id);
    bindScriptInitButton();
    window._popupEventsBound = true;
  }
}

// ──── 入口 ────

document.addEventListener('DOMContentLoaded', async () => {
  await I18N.init();
  refreshAllI18n();

  bindModeSwitchEvents();
  bindDomainCheckDeleteEvents();
  bindRuleListDeleteEvents();
  bindSettingsEvents();
  renderLanguageSetting();

  // 底部「重启 Clash 内核」按钮（复用 triggerRestartClash，与 toast 按钮逻辑统一）
  document.getElementById('restart-clash-btn').addEventListener('click', triggerRestartClash);

  await initPopup();
});