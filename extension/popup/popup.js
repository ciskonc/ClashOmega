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

function showToast(message, type = '') {
  const old = document.querySelector('.toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type ? 'toast--' + type : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2500);
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

// ──── F1 域名匹配算法（增强版：支持更多规则类型） ────

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

// ──── F3 智能域名分组 ────

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

function renderDomainRuleCheck(domain, matchedRules) {
  document.getElementById('current-domain').textContent = domain;
  const matchedEl = document.getElementById('f1-matched');
  const notMatchedEl = document.getElementById('f1-not-matched');

  matchedEl.innerHTML = '';
  notMatchedEl.style.display = 'none';

  if (matchedRules.length === 0) {
    notMatchedEl.style.display = 'block';
    return;
  }

  matchedRules.forEach(rule => {
    const div = document.createElement('div');
    div.className = 'matched-rule-item';
    const policyClass = getPolicyClass(rule.proxy);
    const ruleStr = `${rule.type},${rule.payload},${rule.proxy}`;
    const canDelete = isDomainRule(rule.type);
    div.innerHTML = `
      <span class="rule-index">#${rule.index + 1}</span>
      <span class="rule-detail">${rule.type},${rule.payload}</span>
      <span class="rule-policy ${policyClass}">${rule.proxy}</span>
      ${canDelete ? `<button class="rule-delete-btn" data-rule="${ruleStr}" data-i18n-title="rule_delete" title="${I18N.t('rule_delete')}">✕</button>` : ''}
    `;
    matchedEl.appendChild(div);
  });
}

function renderRuleList(rules) {
  const listEl = document.getElementById('rule-list');
  const countEl = document.getElementById('rule-count');
  countEl.textContent = rules.length;

  listEl.innerHTML = '';
  if (rules.length === 0) {
    listEl.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant); font: var(--md-typescale-body-small); padding: var(--md-spacing-2) 0;">' + I18N.t('f1_not_matched') + '</div>';
    return;
  }

  rules.forEach((rule, index) => {
    const ruleStr = `${rule.type},${rule.payload},${rule.proxy}`;
    const div = document.createElement('div');
    div.className = 'rule-item';
    const policyClass = getPolicyClass(rule.proxy);
    div.innerHTML = `
      <span class="rule-text" title="${ruleStr}">${ruleStr}</span>
      <span class="rule-policy ${policyClass}">${rule.proxy}</span>
    `;
    listEl.appendChild(div);
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

// ──── F2: 动态加载代理组下拉框 ────

async function populateProxyGroupSelects() {
  const f2Select = document.getElementById('f2-policy');
  const f3Select = document.getElementById('f3-policy');

  // 先重置为加载中
  const loadingHtml = '<option value="">' + I18N.t('f2_loading') + '</option>';
  f2Select.innerHTML = loadingHtml;
  f3Select.innerHTML = loadingHtml;

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
    [f2Select, f3Select].forEach(sel => {
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

  [f2Select, f3Select].forEach(sel => {
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
      // 模式切换后重新初始化 popup，更新 F1 检测状态
      // （非 clash 模式下 F1 应显示提示，clash 模式下应正常检测）
      await initPopup();
    } else {
      showToast(result?.error || I18N.t('error_clash_unreachable'), 'error');
    }
  });
}

function bindQuickAddRule(domain) {
  document.getElementById('f2-domain').textContent = domain;

  document.getElementById('f2-btn').addEventListener('click', async () => {
    const ruleType = document.getElementById('f2-rule-type').value;
    const policy = document.getElementById('f2-policy').value;
    if (!policy) {
      showToast(I18N.t('f2_select_policy'), 'error');
      return;
    }
    const rule = `${ruleType},${domain},${policy}`;

    const result = await sendToBackground({ action: 'addRule', rule });
    if (result && result.success) {
      showToast(I18N.t('success_rule_added'), 'success');
      // 乐观更新：直接插入 DOM，不重新从内核 API 拉取（内核尚未热重载）
      const listEl = document.getElementById('rule-list');
      // 如果列表显示的是空占位文本，先清掉
      const placeholder = listEl.querySelector('div[style]');
      if (placeholder && !placeholder.classList.contains('rule-item')) {
        listEl.innerHTML = '';
      }
      const div = document.createElement('div');
      div.className = 'rule-item';
      const policyClass = getPolicyClass(policy);
      div.innerHTML = `
        <span class="rule-text" title="${rule}">${rule}</span>
        <span class="rule-policy ${policyClass}">${policy}</span>
        <button class="rule-delete-btn" data-rule="${rule}" data-i18n-title="rule_delete" title="${I18N.t('rule_delete')}">✕</button>
      `;
      listEl.appendChild(div);
      const countEl = document.getElementById('rule-count');
      countEl.textContent = parseInt(countEl.textContent) + 1;
    } else {
      showNativeError(result, 'error_native_host');
    }
  });
}

function bindDomainDetection(tabId) {
  const detectBtn = document.getElementById('f3-detect-btn');
  const summaryEl = document.getElementById('f3-summary');
  const listEl = document.getElementById('f3-domain-list');
  const batchBtn = document.getElementById('f3-batch-btn');

  let currentSuggestions = [];

  detectBtn.addEventListener('click', async () => {
    detectBtn.disabled = true;
    detectBtn.textContent = '...';

    const result = await sendToBackground({ action: 'getPageDomains' });
    detectBtn.disabled = false;
    detectBtn.textContent = I18N.t('f3_detect_btn');

    if (!result.success || result.domains.length === 0) {
      summaryEl.style.display = 'block';
      summaryEl.textContent = `${I18N.t('f3_collected')} 0 ${I18N.t('f3_domains')}`;
      listEl.style.display = 'none';
      return;
    }

    // 智能分组
    const suggestions = smartGroupDomains(result.domains);
    currentSuggestions = suggestions;

    summaryEl.style.display = 'block';
    summaryEl.textContent = `${I18N.t('f3_collected')} ${result.count} ${I18N.t('f3_domains')}, ${I18N.t('f3_grouped')} ${suggestions.length} ${I18N.t('f3_groups')}`;

    listEl.style.display = 'block';
    listEl.innerHTML = '';

    suggestions.forEach((s, idx) => {
      const div = document.createElement('div');
      div.className = 'domain-group-item';

      if (s.count >= 2) {
        // 通配符建议
        div.innerHTML = `
          <label class="md3-checkbox">
            <input type="checkbox" value="${s.suggested}" data-type="${s.type}" data-idx="${idx}">
            <span class="domain-suggested">${s.suggested}</span>
            <span class="domain-count">${s.count} ${I18N.t('f3_domains')}</span>
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
  document.getElementById('f3-select-all').addEventListener('click', () => {
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });

  // 取消
  document.getElementById('f3-deselect-all').addEventListener('click', () => {
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  });

  // 批量添加
  batchBtn.addEventListener('click', async () => {
    const checked = listEl.querySelectorAll('input[type="checkbox"]:checked');
    if (checked.length === 0) {
      showToast(I18N.t('f3_select_all'), 'error');
      return;
    }

    const policy = document.getElementById('f3-policy').value;
    if (!policy) {
      showToast(I18N.t('f2_select_policy'), 'error');
      return;
    }

    const rules = Array.from(checked).map(cb => `${cb.dataset.type},${cb.value},${policy}`);

    batchBtn.disabled = true;
    const result = await sendToBackground({ action: 'batchAddRules', rules });
    batchBtn.disabled = false;

    if (result && result.success) {
      showToast(`${checked.length} ${I18N.t('success_rules_added')}`, 'success');
      const rulesResult = await sendToBackground({ action: 'getClashRules' });
      if (rulesResult.success) {
        renderRuleList(rulesResult.rules);
      }
    } else {
      showNativeError(result, 'error_native_host');
    }
  });
}

function bindF1DeleteEvents() {
  document.getElementById('f1-matched').addEventListener('click', async (e) => {
    const btn = e.target.closest('.rule-delete-btn');
    if (!btn) return;

    const ruleStr = btn.dataset.rule;
    const result = await sendToBackground({ action: 'removeRule', rule: ruleStr });
    if (result && result.success) {
      showToast(I18N.t('success_rule_deleted'), 'success');
      // 乐观更新：直接从 DOM 移除，不重新从内核 API 拉取（内核尚未热重载）
      // F1 匹配结果容器是 .matched-rule-item，规则列表容器是 .rule-item，需兼容两者
      const item = btn.closest('.rule-item') || btn.closest('.matched-rule-item');
      if (item) item.remove();
      const countEl = document.getElementById('rule-count');
      countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
    } else {
      showNativeError(result, 'error_native_host');
    }
  });
}

function bindRuleListDeleteEvents() {
  document.getElementById('rule-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.rule-delete-btn');
    if (!btn) return;

    const ruleStr = btn.dataset.rule;
    // 乐观更新：先移除 DOM，再发请求，消除连点时的视觉延迟
    const ruleItem = btn.closest('.rule-item');
    ruleItem.style.opacity = '0.5';
    btn.disabled = true;

    const result = await sendToBackground({ action: 'removeRule', rule: ruleStr });
    if (result && result.success) {
      showToast(I18N.t('success_rule_deleted'), 'success');
      ruleItem.remove();
      const countEl = document.getElementById('rule-count');
      countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
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
    document.getElementById('current-domain').textContent = I18N.t('f1_not_matched');
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

  // 1b. 代理组下拉框（F2/F3 共用）
  populateProxyGroupSelects();

  // 1c. Clash 规则列表 + F1 域名匹配
  //     非 clash 模式下浏览器不走 Clash 代理，/connections 不会有该域名连接，
  //     F1 无法检测实际代理组，显示提示并跳过检测
  const currentMode = settings?.currentMode || 'system';
  const f1ModeHint = document.getElementById('f1-mode-hint');
  const f1Matched = document.getElementById('f1-matched');
  const f1NotMatched = document.getElementById('f1-not-matched');

  if (currentMode !== 'clash') {
    // 非 clash 模式：显示提示，隐藏匹配结果
    f1ModeHint.style.display = 'block';
    f1Matched.innerHTML = '';
    f1NotMatched.style.display = 'none';
    // 仍加载规则列表供查看，但不做 F1 域名匹配检测
    sendToBackground({ action: 'getClashRules' }).then(clashRules => {
      if (clashRules.success) {
        renderRuleList(clashRules.rules);
      }
    });
  } else {
    // clash 模式：隐藏提示，正常检测
    f1ModeHint.style.display = 'none';
    sendToBackground({ action: 'getClashRules' }).then(clashRules => {
      if (clashRules.success) {
        const matched = findMatchingRules(domain, clashRules.rules);
        renderDomainRuleCheck(domain, matched);
        renderRuleList(clashRules.rules);

        // 始终异步查询 Clash API /connections，获取内核实际匹配的规则
        // 本地匹配无法处理 RULE-SET 等类型，/connections 返回的是内核真实匹配结果
        // 覆盖策略：
        //   1. /connections 返回了非 MATCH 的精确匹配 → 覆盖本地结果
        //   2. 本地只有 MATCH（规则全是 RULE-SET 无法匹配）且 /connections 有匹配 →
        //      用 /connections 结果（含 chains 实际代理组信息，比本地 MATCH 更有价值）
        sendToBackground({ action: 'getDomainConnections' }).then(connResult => {
          if (connResult.success && connResult.connections) {
            const connMatched = findMatchingRulesFromConnections(domain, connResult.connections, clashRules.rules);
            const hasNonMatchRule = connMatched.some(r => normalizeRuleType(r.type) !== 'MATCH');
            const localOnlyMatch = matched.length > 0 && matched.every(r => normalizeRuleType(r.type) === 'MATCH');
            if (hasNonMatchRule || (localOnlyMatch && connMatched.length > 0)) {
              renderDomainRuleCheck(domain, connMatched);
            }
          }
        });
      }
    });
  }

  // 绑定事件（同步，不依赖异步数据）
  // 使用标志避免模式切换重新 initPopup 时重复绑定
  if (!window._popupEventsBound) {
    bindQuickAddRule(domain);
    bindDomainDetection(tab.id);
    window._popupEventsBound = true;
  }
}

// ──── 入口 ────

document.addEventListener('DOMContentLoaded', async () => {
  await I18N.init();
  refreshAllI18n();

  bindModeSwitchEvents();
  bindF1DeleteEvents();
  bindRuleListDeleteEvents();
  bindSettingsEvents();
  renderLanguageSetting();

  // 底部「重启 Clash 内核」按钮
  document.getElementById('restart-clash-btn').addEventListener('click', async () => {
    const btn = document.getElementById('restart-clash-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    const result = await sendToBackground({ action: 'restartClash' });
    btn.disabled = false;
    btn.textContent = I18N.t('settings_restart_kernel');
    if (result && result.success) {
      showToast(I18N.t('restart_clash_success'), 'success');
    } else {
      showToast(I18N.t('restart_clash_failed'), 'error');
    }
  });

  await initPopup();
});