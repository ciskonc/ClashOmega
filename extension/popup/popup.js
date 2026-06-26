// ClashOmega — Popup JS
// 与 background.js 通过 chrome.runtime.sendMessage 通信

// ──── 工具函数 ────

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || {});
    });
  });
}

/**
 * HTML 转义：防止 XSS 注入
 * 用于将用户输入（域名、规则等）安全地插入到 HTML 属性中
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 安全创建带文本内容的元素
 * @param {string} tag - 标签名
 * @param {object} [props] - 属性对象（className, title, dataset 等）
 * @param {string} [text] - 文本内容
 * @returns {HTMLElement}
 */
function el(tag, props, text) {
  const node = document.createElement(tag);
  if (props) {
    if (props.className) node.className = props.className;
    if (props.title) node.title = props.title;
    if (props.dataset) {
      for (const [k, v] of Object.entries(props.dataset)) {
        node.dataset[k] = v;
      }
    }
    if (props.style) node.style.cssText = props.style;
  }
  if (text != null) node.textContent = text;
  return node;
}

function showToast(message, type = '', options = {}) {
  const old = document.querySelector('.toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type ? 'toast--' + type : ''}`;

  if (options.action) {
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

  const duration = options.duration || (options.action ? 8000 : 2500);
  setTimeout(() => toast.remove(), duration);
}

/**
 * 触发重启 Clash
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
    setTimeout(() => { initPopup(); }, 300);
  } else {
    showToast(I18N.t('restart_clash_failed'), 'error');
  }
  return result;
}

/**
 * 显示 Native Host 错误
 */
function showNativeError(result, fallbackKey) {
  if (result && result.error) {
    const err = result.error;
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

// ──── 主题系统 ────

/**
 * 初始化主题：从 storage 读取并应用
 * 同时根据系统主题设置玻璃拟态变体
 */
async function initTheme() {
  const { settings } = await chrome.storage.local.get('settings');
  let theme = settings?.theme || 'auto';
  // 玻璃拟态主题暂未启用，回退到 auto
  if (theme === 'glass') {
    theme = 'auto';
    settings.theme = 'auto';
    await chrome.storage.local.set({ settings });
  }
  applyTheme(theme);
}

/**
 * 应用主题到 document.documentElement
 * @param {string} theme - 'auto' | 'md3-light' | 'md3-dark' | 'glass'
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  // 玻璃拟态主题：根据系统主题设置变体
  if (theme === 'glass') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-glass-variant', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.removeAttribute('data-glass-variant');
  }
}

/**
 * 渲染主题选择器当前值
 */
async function renderThemeSetting() {
  const select = document.getElementById('theme-select');
  if (!select) return;
  const { settings } = await chrome.storage.local.get('settings');
  const theme = settings?.theme || 'auto';
  select.value = theme;
}

/**
 * 监听系统主题变化，实时切换玻璃拟态变体
 */
function bindSystemThemeListener() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'glass') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-glass-variant', prefersDark ? 'dark' : 'light');
    }
  });
}

// ──── 模块化标签页布局系统 ────

/**
 * 所有可用模块定义
 * key: 模块 ID（对应 data-module 属性）
 * nameKey: i18n key 用于显示模块名称
 */
const AVAILABLE_MODULES = [
  { id: 'proxy-mode',   nameKey: 'module_proxy_mode' },
  { id: 'domain-check', nameKey: 'module_domain_check' },
  { id: 'quick-add',    nameKey: 'module_quick_add' },
  { id: 'batch-detect', nameKey: 'module_batch_detect' },
  { id: 'script-rules', nameKey: 'module_script_rules' },
  { id: 'rule-list',    nameKey: 'module_rule_list' },
  { id: 'settings',     nameKey: 'module_settings' }
];

/**
 * 标签页布局版本号
 * 当默认布局结构发生重大变更时递增，旧版保存的布局将自动重置为新默认布局
 */
const LAYOUT_VERSION = 3;

/**
 * 获取默认标签页布局
 * 标签页 1：代理模式 + 域名检测（高频操作置首）
 * 标签页 2：规则管理（快捷添加 + 批量检测 + 脚本规则 + 内置规则）
 * 标签页 3：设置
 */
function getDefaultTabLayout() {
  return {
    layoutVersion: LAYOUT_VERSION,
    tabs: [
      { id: 'tab-1', name: '', nameKey: 'default_tab_1', modules: ['proxy-mode', 'domain-check'] },
      { id: 'tab-2', name: '', nameKey: 'default_tab_2', modules: ['quick-add', 'batch-detect', 'script-rules', 'rule-list'] },
      { id: 'tab-3', name: '', nameKey: 'default_tab_3', modules: ['settings'] }
    ],
    activeTabId: 'tab-1'
  };
}

/**
 * 获取标签页布局（用户自定义或默认）
 * 兼容旧版 tabOrder 设置
 */
async function getTabLayout() {
  const { settings } = await chrome.storage.local.get('settings');
  const layout = settings?.tabLayout;
  // 版本检查：如果保存的布局版本与当前版本不匹配，重置为新默认布局
  if (layout && Array.isArray(layout.tabs) && layout.tabs.length > 0) {
    if (layout.layoutVersion !== LAYOUT_VERSION) {
      const defaultLayout = getDefaultTabLayout();
      await saveTabLayout(defaultLayout);
      return defaultLayout;
    }
    // 校验：所有模块 ID 必须有效，所有标签页的模块必须存在于 AVAILABLE_MODULES
    const validModuleIds = AVAILABLE_MODULES.map(m => m.id);
    const validatedTabs = layout.tabs.map(tab => ({
      ...tab,
      modules: (tab.modules || []).filter(mId => validModuleIds.includes(mId))
    }));
    // 确保所有模块都被分配（防止模块丢失）
    const assignedModules = new Set(validatedTabs.flatMap(t => t.modules));
    validModuleIds.forEach(mId => {
      if (!assignedModules.has(mId)) {
        // 将未分配的模块放入第一个标签页
        if (validatedTabs.length > 0) {
          validatedTabs[0].modules.push(mId);
        }
      }
    });
    return {
      layoutVersion: LAYOUT_VERSION,
      tabs: validatedTabs,
      activeTabId: layout.activeTabId || (validatedTabs.length > 0 ? validatedTabs[0].id : '')
    };
  }
  // 兼容旧版 tabOrder：将旧顺序映射为新布局
  const oldOrder = settings?.tabOrder;
  if (Array.isArray(oldOrder) && oldOrder.length === 4) {
    const mapping = {
      'domain':  ['domain-check'],
      'mode':    ['proxy-mode'],
      'rules':   ['quick-add', 'batch-detect', 'script-rules', 'rule-list'],
      'settings':['settings']
    };
    const nameKeys = {
      'domain': 'default_tab_1',
      'mode': 'tab_mode',
      'rules': 'default_tab_2',
      'settings': 'tab_settings'
    };
    return {
      layoutVersion: LAYOUT_VERSION,
      tabs: oldOrder.map((tabId, idx) => ({
        id: `tab-${idx + 1}`,
        name: '',
        nameKey: nameKeys[tabId] || `default_tab_${idx + 1}`,
        modules: mapping[tabId] || []
      })),
      activeTabId: 'tab-1'
    };
  }
  return getDefaultTabLayout();
}

/**
 * 保存标签页布局到 storage
 */
async function saveTabLayout(layout) {
  const { settings } = await chrome.storage.local.get('settings');
  settings.tabLayout = layout;
  // 清除旧版 tabOrder
  delete settings.tabOrder;
  await chrome.storage.local.set({ settings });
}

/**
 * 获取标签页显示名称（优先用户自定义名称，其次 i18n 默认名称）
 */
function getTabDisplayName(tab) {
  if (tab.name && tab.name.trim()) {
    return tab.name.trim();
  }
  if (tab.nameKey) {
    return I18N.t(tab.nameKey);
  }
  return 'Tab';
}

/**
 * 构建标签页布局：从 #modules-pool 读取模块，动态生成标签栏和内容
 * 注意：二次调用时需先将所有模块归还到 #modules-pool，再重新分配
 */
function buildTabLayout(layout) {
  const tabBar = document.getElementById('tab-bar');
  const wrapper = document.getElementById('tab-content-wrapper');
  const pool = document.getElementById('modules-pool');
  if (!tabBar || !wrapper || !pool) return;

  // 先将所有模块归还到 pool（防止二次调用时丢失模块）
  const allModules = wrapper.querySelectorAll('.module');
  allModules.forEach(moduleEl => {
    pool.appendChild(moduleEl);
  });

  // 清空现有标签栏和内容
  tabBar.innerHTML = '';
  wrapper.innerHTML = '';

  // 为每个标签页创建按钮和面板
  layout.tabs.forEach((tab, index) => {
    // 标签按钮
    const tabBtn = el('button', {
      className: 'tab-btn' + (index === 0 ? ' active' : ''),
      dataset: { tab: tab.id }
    }, getTabDisplayName(tab));
    tabBar.appendChild(tabBtn);

    // 标签面板
    const panel = el('div', {
      className: 'tab-panel' + (index === 0 ? ' active' : ''),
      dataset: { tabPanel: tab.id }
    });
    panel.id = `panel-${tab.id}`;

    // 将模块从 pool 移动到面板
    tab.modules.forEach(moduleId => {
      const moduleEl = pool.querySelector(`[data-module="${moduleId}"]`);
      if (moduleEl) {
        panel.appendChild(moduleEl);
      }
    });

    wrapper.appendChild(panel);
  });
}

/**
 * 切换到指定标签页
 * @param {string} tabId - 标签页 ID
 */
function switchTab(tabId) {
  // 更新标签按钮状态
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  // 更新标签面板状态
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.tabPanel === tabId);
  });
}

/**
 * 绑定标签栏点击事件
 */
function bindTabEvents() {
  document.getElementById('tab-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });
}

/**
 * 切换到包含指定模块的标签页
 */
function switchToModuleTab(moduleId, layout) {
  if (!layout) return;
  const tab = layout.tabs.find(t => t.modules.includes(moduleId));
  if (tab) {
    switchTab(tab.id);
  }
}

// ──── 标签页布局编辑器（设置页） ────

/**
 * 拖拽状态（模块级，跨卡片共享）
 * type: 'tab'（标签页排序） | 'module'（模块移动）
 */
let _layoutDragState = {
  type: null,
  srcEl: null,
  srcTabId: null,
  moduleId: null
};

/**
 * 渲染标签页布局编辑器
 * 每个标签页卡片包含：拖拽手柄 + 名称输入 + 删除按钮 + 可拖拽模块列表
 * 模块项支持拖拽移动到其他标签页（替代下拉框方式）
 */
function renderTabLayoutEditor(layout) {
  const editor = document.getElementById('tab-layout-editor');
  if (!editor) return;
  editor.innerHTML = '';

  layout.tabs.forEach((tab) => {
    const tabCard = el('div', { className: 'tab-layout-tab-card', dataset: { tabId: tab.id } });

    // 标签页头部：拖拽手柄 + 名称输入 + 删除按钮
    const header = el('div', { className: 'tab-layout-tab-header' });
    header.appendChild(el('span', { className: 'tab-layout-drag-handle', title: I18N.t('settings_tab_drag_hint') }, '⠿'));

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'md3-text-field tab-layout-name-input';
    nameInput.value = tab.name || '';
    nameInput.placeholder = I18N.t(tab.nameKey || 'default_tab_1') + ` (${I18N.t('settings_tab_name_placeholder')})`;
    nameInput.dataset.tabId = tab.id;
    header.appendChild(nameInput);

    const deleteBtn = el('button', {
      className: 'md3-button md3-button--text tab-layout-delete-btn',
      title: I18N.t('settings_tab_delete'),
      dataset: { tabId: tab.id }
    }, '✕');
    if (layout.tabs.length <= 1) {
      deleteBtn.disabled = true;
    }
    header.appendChild(deleteBtn);

    tabCard.appendChild(header);

    // 模块列表（作为模块拖拽的放置区域）
    const moduleList = el('div', { className: 'tab-layout-module-list', dataset: { tabId: tab.id } });
    tab.modules.forEach(moduleId => {
      const moduleInfo = AVAILABLE_MODULES.find(m => m.id === moduleId);
      if (!moduleInfo) return;

      const moduleItem = el('div', {
        className: 'tab-layout-module-item',
        dataset: { moduleId, fromTab: tab.id }
      });
      // 设置模块锁定：不允许拖拽迁移到其他标签页
      if (moduleId === 'settings') {
        moduleItem.classList.add('locked');
        moduleItem.appendChild(el('span', { className: 'tab-layout-module-lock', title: I18N.t('settings_module_locked') }, '🔒'));
      } else {
        moduleItem.setAttribute('draggable', 'true');
        // 模块拖拽手柄
        moduleItem.appendChild(el('span', { className: 'tab-layout-module-drag-handle', title: I18N.t('settings_module_drag_hint') }, '⠿'));
      }
      moduleItem.appendChild(el('span', { className: 'tab-layout-module-name' }, I18N.t(moduleInfo.nameKey)));

      moduleList.appendChild(moduleItem);
    });

    if (tab.modules.length === 0) {
      moduleList.appendChild(el('div', { className: 'tab-layout-empty-hint' }, I18N.t('settings_tab_empty')));
    }

    tabCard.appendChild(moduleList);
    editor.appendChild(tabCard);
  });

  // 绑定所有拖拽事件
  bindLayoutDragEvents(editor);
}

/**
 * 绑定布局编辑器的拖拽事件
 * 1. 标签页卡片排序：拖拽头部手柄在标签页之间排序
 * 2. 模块移动：拖拽模块项到其他标签页的模块列表
 */
function bindLayoutDragEvents(editor) {
  // ── 标签页手柄 mousedown → 启用卡片 draggable ──
  editor.querySelectorAll('.tab-layout-tab-card').forEach(tabCard => {
    const dragHandle = tabCard.querySelector('.tab-layout-drag-handle');
    if (dragHandle) {
      dragHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        tabCard.setAttribute('draggable', 'true');
      });
      dragHandle.addEventListener('mouseup', () => {
        tabCard.removeAttribute('draggable');
      });
    }
  });

  // ── 标签页卡片拖拽事件（排序） ──
  editor.querySelectorAll('.tab-layout-tab-card').forEach(tabCard => {
    tabCard.addEventListener('dragstart', (e) => {
      if (!tabCard.getAttribute('draggable')) {
        e.preventDefault();
        return;
      }
      _layoutDragState.type = 'tab';
      _layoutDragState.srcEl = tabCard;
      tabCard.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'tab:' + tabCard.dataset.tabId);
    });

    tabCard.addEventListener('dragend', () => {
      tabCard.classList.remove('dragging');
      tabCard.removeAttribute('draggable');
      editor.querySelectorAll('.tab-layout-tab-card').forEach(c => c.classList.remove('drag-over'));
      editor.querySelectorAll('.tab-layout-module-list').forEach(l => l.classList.remove('module-drop-target'));
      _layoutDragState.type = null;
      _layoutDragState.srcEl = null;
    });

    tabCard.addEventListener('dragover', (e) => {
      if (_layoutDragState.type === 'tab' && _layoutDragState.srcEl && _layoutDragState.srcEl !== tabCard) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tabCard.classList.add('drag-over');
      }
    });

    tabCard.addEventListener('dragleave', (e) => {
      if (!tabCard.contains(e.relatedTarget)) {
        tabCard.classList.remove('drag-over');
      }
    });

    tabCard.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      tabCard.classList.remove('drag-over');
      if (_layoutDragState.type === 'tab' && _layoutDragState.srcEl && _layoutDragState.srcEl !== tabCard) {
        const rect = tabCard.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
          editor.insertBefore(_layoutDragState.srcEl, tabCard);
        } else {
          editor.insertBefore(_layoutDragState.srcEl, tabCard.nextSibling);
        }
      }
    });
  });

  // ── 模块项拖拽事件（移动到其他标签页） ──
  editor.querySelectorAll('.tab-layout-module-item').forEach(moduleItem => {
    moduleItem.addEventListener('dragstart', (e) => {
      _layoutDragState.type = 'module';
      _layoutDragState.srcEl = moduleItem;
      _layoutDragState.srcTabId = moduleItem.dataset.fromTab;
      _layoutDragState.moduleId = moduleItem.dataset.moduleId;
      moduleItem.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'module:' + moduleItem.dataset.moduleId);
      e.stopPropagation(); // 防止触发标签页拖拽
    });

    moduleItem.addEventListener('dragend', () => {
      moduleItem.classList.remove('dragging');
      editor.querySelectorAll('.tab-layout-module-list').forEach(l => l.classList.remove('module-drop-target'));
      _layoutDragState.type = null;
      _layoutDragState.srcEl = null;
      _layoutDragState.srcTabId = null;
      _layoutDragState.moduleId = null;
    });
  });

  // ── 模块列表作为放置区域（接收模块拖拽） ──
  editor.querySelectorAll('.tab-layout-module-list').forEach(moduleList => {
    moduleList.addEventListener('dragover', (e) => {
      if (_layoutDragState.type === 'module') {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        moduleList.classList.add('module-drop-target');
      }
    });

    moduleList.addEventListener('dragleave', (e) => {
      if (!moduleList.contains(e.relatedTarget)) {
        moduleList.classList.remove('module-drop-target');
      }
    });

    moduleList.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      moduleList.classList.remove('module-drop-target');
      if (_layoutDragState.type !== 'module' || !_layoutDragState.srcEl) return;

      const targetTabId = moduleList.dataset.tabId;
      const sourceTabId = _layoutDragState.srcTabId;

      // 移除目标列表的空提示
      const emptyHint = moduleList.querySelector('.tab-layout-empty-hint');
      if (emptyHint) emptyHint.remove();

      // 计算插入位置（基于鼠标 Y 坐标）
      const items = Array.from(moduleList.querySelectorAll('.tab-layout-module-item'));
      let insertBefore = null;
      for (const item of items) {
        if (item === _layoutDragState.srcEl) continue;
        const rect = item.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          insertBefore = item;
          break;
        }
      }

      // 更新 fromTab 数据属性
      _layoutDragState.srcEl.dataset.fromTab = targetTabId;

      if (insertBefore) {
        moduleList.insertBefore(_layoutDragState.srcEl, insertBefore);
      } else {
        moduleList.appendChild(_layoutDragState.srcEl);
      }

      // 如果源标签页变空了，添加空提示
      if (sourceTabId !== targetTabId) {
        const sourceList = editor.querySelector(`.tab-layout-module-list[data-tab-id="${sourceTabId}"]`);
        if (sourceList && sourceList.querySelectorAll('.tab-layout-module-item').length === 0) {
          sourceList.appendChild(el('div', { className: 'tab-layout-empty-hint' }, I18N.t('settings_tab_empty')));
        }
      }
    });
  });
}

/**
 * 从编辑器 DOM 读取当前布局（包含标签页顺序和模块分配）
 */
function readTabLayoutFromEditor() {
  const editor = document.getElementById('tab-layout-editor');
  if (!editor) return null;

  const tabs = [];
  const tabCards = editor.querySelectorAll('.tab-layout-tab-card');

  tabCards.forEach((card, index) => {
    const tabId = card.dataset.tabId;
    const nameInput = card.querySelector('.tab-layout-name-input');
    const name = nameInput ? nameInput.value.trim() : '';

    // 读取模块列表（按 DOM 顺序）
    const modules = [];
    card.querySelectorAll('.tab-layout-module-item').forEach(item => {
      modules.push(item.dataset.moduleId);
    });

    // 保留原有 nameKey
    const existingTab = window._currentTabLayout?.tabs.find(t => t.id === tabId);
    tabs.push({
      id: tabId,
      name: name,
      nameKey: existingTab?.nameKey || `default_tab_${index + 1}`,
      modules
    });
  });

  return {
    layoutVersion: LAYOUT_VERSION,
    tabs,
    activeTabId: window._currentTabLayout?.activeTabId || (tabs.length > 0 ? tabs[0].id : '')
  };
}

/**
 * 绑定标签页布局编辑器事件（添加/删除/重命名）
 * 拖拽事件已在 bindLayoutDragEvents 中绑定
 */
function bindTabLayoutEditorEvents(layout) {
  const editor = document.getElementById('tab-layout-editor');
  const addBtn = document.getElementById('tab-add-btn');
  const resetBtn = document.getElementById('tab-layout-reset');
  if (!editor) return;

  window._currentTabLayout = JSON.parse(JSON.stringify(layout));

  // 标签页名称变化（实时更新内存布局）
  editor.addEventListener('input', (e) => {
    if (e.target.classList.contains('tab-layout-name-input')) {
      const tabId = e.target.dataset.tabId;
      const tab = window._currentTabLayout.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.name = e.target.value;
      }
    }
  });

  // 删除标签页
  editor.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-layout-delete-btn')) {
      const tabId = e.target.dataset.tabId;
      if (window._currentTabLayout.tabs.length <= 1) {
        showToast(I18N.t('settings_tab_delete_last'), 'warn');
        return;
      }
      const tabIdx = window._currentTabLayout.tabs.findIndex(t => t.id === tabId);
      if (tabIdx < 0) return;
      const tab = window._currentTabLayout.tabs[tabIdx];

      // 将该标签页的模块移到第一个其他标签页
      const otherTab = window._currentTabLayout.tabs.find(t => t.id !== tabId);
      if (otherTab && tab.modules.length > 0) {
        otherTab.modules.push(...tab.modules);
      }

      window._currentTabLayout.tabs.splice(tabIdx, 1);

      if (window._currentTabLayout.activeTabId === tabId) {
        window._currentTabLayout.activeTabId = window._currentTabLayout.tabs[0].id;
      }

      renderTabLayoutEditor(window._currentTabLayout);
    }
  });

  // 添加标签页
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const newTabId = `tab-${Date.now()}`;
      window._currentTabLayout.tabs.push({
        id: newTabId,
        name: '',
        nameKey: 'settings_tab_new',
        modules: []
      });
      renderTabLayoutEditor(window._currentTabLayout);
    });
  }

  // 恢复默认布局
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      window._currentTabLayout = getDefaultTabLayout();
      renderTabLayoutEditor(window._currentTabLayout);
    });
  }
}

// ──── 面板缩放比例系统 ────

/**
 * 应用缩放比例到 :root
 * @param {number} scale - 缩放百分比（80-150）
 */
function applyZoom(scale) {
  const zoomScale = Math.max(80, Math.min(150, scale)) / 100;
  document.documentElement.style.setProperty('--zoom-scale', zoomScale);
  const zoomValueEl = document.getElementById('zoom-value');
  if (zoomValueEl) {
    zoomValueEl.textContent = `${scale}%`;
  }
  const zoomSliderEl = document.getElementById('zoom-slider');
  if (zoomSliderEl && parseInt(zoomSliderEl.value) !== scale) {
    zoomSliderEl.value = scale;
  }
}

/**
 * 获取缩放比例设置
 */
async function getZoomScale() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings?.zoomScale || 100;
}

/**
 * 保存缩放比例
 */
async function saveZoomScale(scale) {
  const { settings } = await chrome.storage.local.get('settings');
  settings.zoomScale = scale;
  await chrome.storage.local.set({ settings });
}

// ──── 域名匹配检测算法 ────

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
        isMatch = domainLower.includes(payload);
        break;
      case 'RULESET':
        isMatch = false;
        break;
      case 'MATCH':
        isMatch = true;
        break;
      default:
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

function findMatchingRulesFromConnections(domain, connections, rules) {
  const matched = [];
  const domainLower = domain.toLowerCase();
  const seen = new Set();

  for (const conn of connections) {
    const rawHost = (conn.metadata && (conn.metadata.host || conn.metadata.sniffHost)) || '';
    const host = rawHost.toLowerCase();
    if (!host) continue;

    const exactMatch = host === domainLower;
    const hostIsSubdomain = domainLower.length > host.length && domainLower.endsWith('.' + host);
    const domainIsSubdomain = host.length > domainLower.length && host.endsWith('.' + domainLower);

    if (!exactMatch && !hostIsSubdomain && !domainIsSubdomain) {
      continue;
    }

    const ruleType = conn.rule || '';
    const rulePayload = conn.rulePayload || '';
    const proxy = (conn.chains && conn.chains.length > 0) ? conn.chains[conn.chains.length - 1] : '';

    const dedupKey = ruleType + '|' + rulePayload;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

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

function smartGroupDomains(domains) {
  const groups = new Map();

  domains.forEach(d => {
    const parts = d.hostname.split('.');
    let suffix, isWildcard;

    if (parts.length >= 3) {
      suffix = parts.slice(-2).join('.');
      isWildcard = true;
    } else {
      suffix = d.hostname;
      isWildcard = false;
    }

    if (!groups.has(suffix)) {
      groups.set(suffix, { suffix, domains: [], isWildcard });
    }
    groups.get(suffix).domains.push(d);
  });

  const suggestions = [];
  groups.forEach(group => {
    const g = group;
    if (g.domains.length >= 2 && g.isWildcard) {
      suggestions.push({
        suggested: '*.' + g.suffix,
        type: 'DOMAIN-SUFFIX',
        hostnames: g.domains.map(d => d.hostname),
        count: g.domains.length
      });
    } else {
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
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = I18N.t(key);
  });
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

function renderClashStatus(running, config, proxyPort, layout) {
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
    text.onclick = () => switchToModuleTab('settings', layout);
  }
}

function renderSystemProxyStatus(sysProxy) {
  const dot = document.getElementById('system-proxy-dot');
  const text = document.getElementById('system-proxy-text');

  // Native Host 未安装/不可用时，显示 Null（用户需求：未导入 native-host 应显示为 Null）
  if (sysProxy && sysProxy.nativeHostAvailable === false) {
    dot.className = 'status-dot status-dot--off';
    text.textContent = I18N.t('system_proxy_null');
    text.title = I18N.t('native_host_not_installed_hint');
    return;
  }

  if (!sysProxy || !sysProxy.success) {
    dot.className = 'status-dot status-dot--off';
    text.textContent = I18N.t('system_proxy_unknown');
    return;
  }

  // 清除可能存在的 title 提示
  text.title = '';

  // 浏览器代理模式（通过 chrome.proxy.settings.get() 获取）
  if (sysProxy.browserMode) {
    switch (sysProxy.browserMode) {
      case 'system':
        dot.className = 'status-dot status-dot--warn';
        text.textContent = I18N.t('system_proxy_follow_system');
        return;
      case 'direct':
        dot.className = 'status-dot status-dot--on';
        text.textContent = I18N.t('system_proxy_direct');
        return;
      case 'fixed_servers':
        dot.className = 'status-dot status-dot--warn';
        text.textContent = sysProxy.proxyServer
          ? `${I18N.t('system_proxy_proxy')} (${sysProxy.proxyServer})`
          : I18N.t('system_proxy_proxy');
        return;
      case 'pac_script':
      case 'auto_detect':
        dot.className = 'status-dot status-dot--warn';
        text.textContent = `${I18N.t('system_proxy_pac')} (${sysProxy.autoConfigUrl || 'WPAD'})`;
        return;
    }
  }

  // Native Host 返回的系统级代理状态
  if (sysProxy.autoConfigUrl) {
    dot.className = 'status-dot status-dot--warn';
    text.textContent = `${I18N.t('system_proxy_pac')} (${sysProxy.autoConfigUrl})`;
    return;
  }

  if (sysProxy.proxyEnable && sysProxy.proxyServer) {
    dot.className = 'status-dot status-dot--warn';
    text.textContent = `${I18N.t('system_proxy_proxy')} (${sysProxy.proxyServer})`;
    return;
  }

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

function resolveFinalProxy(proxyName, proxies) {
  const lower = (proxyName || '').toLowerCase();
  if (lower === 'direct') return { name: 'DIRECT', class: 'rule-policy--direct' };
  if (lower === 'reject' || lower === 'drop') return { name: 'REJECT', class: 'rule-policy--reject' };

  if (!proxies || !proxyName) {
    return { name: proxyName || 'DIRECT', class: getPolicyClass(proxyName) };
  }

  let current = proxyName;
  const visited = new Set();
  for (let i = 0; i < 5; i++) {
    if (visited.has(current)) break;
    visited.add(current);

    const lowerCurrent = current.toLowerCase();
    if (lowerCurrent === 'direct') return { name: 'DIRECT', class: 'rule-policy--direct' };
    if (lowerCurrent === 'reject' || lowerCurrent === 'drop') return { name: 'REJECT', class: 'rule-policy--reject' };

    if (current.includes('自动选择') || /auto/i.test(current)) {
      return { name: '自动选择', class: 'rule-policy--proxy' };
    }

    const proxy = proxies[current];
    if (!proxy || !proxy.now) break;
    current = proxy.now;
  }

  const lowerFinal = current.toLowerCase();
  if (lowerFinal === 'direct') return { name: 'DIRECT', class: 'rule-policy--direct' };
  if (lowerFinal === 'reject' || lowerFinal === 'drop') return { name: 'REJECT', class: 'rule-policy--reject' };
  if (current.includes('自动选择') || /auto/i.test(current)) return { name: '自动选择', class: 'rule-policy--proxy' };

  return { name: current, class: 'rule-policy--group' };
}

function normalizeRuleType(type) {
  return (type || '').toUpperCase().replace(/-/g, '');
}

function isDomainRule(type) {
  const t = normalizeRuleType(type);
  return t === 'DOMAIN' || t === 'DOMAINSUFFIX' || t === 'DOMAINKEYWORD';
}

/**
 * 渲染域名匹配检测结果（S-001 修复：使用 DOM API 替代 innerHTML）
 */
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

  const rule = matchedRules[0];
  const div = document.createElement('div');
  div.className = 'matched-rule-item';

  const finalProxy = resolveFinalProxy(rule.proxy, proxies);
  const ruleStr = `${rule.type},${rule.payload},${rule.proxy}`;
  const canDelete = isDomainRule(rule.type);

  let scriptFlag = '0';
  if (canDelete && window._scriptRulesWithSource) {
    const found = window._scriptRulesWithSource.find(
      item => item.rule.toLowerCase() === ruleStr.toLowerCase()
    );
    if (found) {
      scriptFlag = found.source === 'JS' ? '1' : '0';
    }
  }

  // 使用 DOM API 安全创建子元素（防止 XSS）
  div.appendChild(el('span', { className: 'rule-index' }, `#${rule.index + 1}`));
  div.appendChild(el('span', { className: 'rule-type-tag' }, rule.type));
  div.appendChild(el('span', { className: 'rule-payload' }, rule.payload || '—'));
  div.appendChild(el('span', { className: 'rule-group-name', title: rule.proxy }, rule.proxy));
  div.appendChild(el('span', { className: `rule-policy ${finalProxy.class}`, title: finalProxy.name }, finalProxy.name));

  if (canDelete) {
    const btn = el('button', {
      className: 'rule-delete-btn',
      title: I18N.t('rule_delete'),
      dataset: { rule: ruleStr, script: scriptFlag }
    }, '✕');
    btn.setAttribute('data-i18n-title', 'rule_delete');
    div.appendChild(btn);
  }

  matchedEl.appendChild(div);
}

/**
 * 渲染规则列表（S-001 修复：使用 DOM API 替代 innerHTML）
 * 支持搜索过滤：根据 #builtin-rule-search 的值过滤显示
 */
function renderRuleList(rules, proxies) {
  const listEl = document.getElementById('rule-list');
  const countEl = document.getElementById('rule-count');
  const builtinRules = rules.filter(r => !isDomainRule(r.type));

  // 保存完整规则列表供搜索使用
  window._builtinRules = builtinRules;
  window._builtinRulesProxies = proxies;

  // 获取搜索词
  const searchInput = document.getElementById('builtin-rule-search');
  const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

  // 根据搜索词过滤
  const filteredRules = searchTerm
    ? builtinRules.filter(r => `${r.type},${r.payload},${r.proxy}`.toLowerCase().includes(searchTerm))
    : builtinRules;

  // 显示计数（搜索时显示匹配数/总数）
  if (searchTerm) {
    countEl.textContent = `${filteredRules.length}/${builtinRules.length}`;
  } else {
    countEl.textContent = builtinRules.length;
  }

  listEl.innerHTML = '';
  if (builtinRules.length === 0) {
    const empty = el('div', { style: 'color: var(--md-sys-color-on-surface-variant); font: var(--md-typescale-body-small); padding: var(--md-spacing-2) 0;' }, I18N.t('domain_check_not_matched'));
    listEl.appendChild(empty);
    return;
  }

  // 搜索无结果
  if (filteredRules.length === 0) {
    const noResult = el('div', { style: 'color: var(--md-sys-color-on-surface-variant); font: var(--md-typescale-body-small); padding: var(--md-spacing-2) 0;' }, I18N.t('search_no_result'));
    listEl.appendChild(noResult);
    return;
  }

  filteredRules.forEach((rule) => {
    const ruleStr = `${rule.type},${rule.payload},${rule.proxy}`;
    const div = document.createElement('div');
    div.className = 'rule-item';
    const finalProxy = resolveFinalProxy(rule.proxy, proxies);

    div.appendChild(el('span', { className: 'rule-type-tag' }, rule.type));
    div.appendChild(el('span', { className: 'rule-payload', title: ruleStr }, rule.payload || '—'));
    div.appendChild(el('span', { className: 'rule-group-name', title: rule.proxy }, rule.proxy));
    div.appendChild(el('span', { className: `rule-policy ${finalProxy.class}`, title: finalProxy.name }, finalProxy.name));

    listEl.appendChild(div);
  });
}

/**
 * 额外脚本规则：分页状态
 */
let scriptRulePaginationState = {
  currentPage: 1,
  pageSize: 20,
  totalRules: 0,
  allRules: [],
  proxies: null,
  searchTerm: ''
};

/**
 * 获取规则展示模式设置
 */
async function getRuleDisplaySettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return {
    mode: settings?.ruleDisplayMode || 'auto',
    threshold: settings?.rulePageSize || 20
  };
}

/**
 * 判断是否应该使用分页模式
 * auto 模式：规则数达到阈值时使用分页
 */
function shouldUsePagination(ruleCount, mode, threshold) {
  if (mode === 'paginate') return ruleCount > threshold;
  if (mode === 'collapse') return false;
  if (mode === 'expand') return false;
  // auto：达到阈值时分页展示
  return ruleCount >= threshold;
}

/**
 * 判断是否应该使用折叠模式
 * 仅在用户明确选择「折叠展示」时启用；auto 模式不使用折叠，达到阈值直接分页
 */
function shouldUseCollapse(ruleCount, mode, threshold) {
  if (mode === 'collapse') return ruleCount > 0;
  return false;
}

/**
 * 根据搜索词过滤规则
 * @param {Array} rulesWithSource - 规则数组 [{ rule: 'TYPE,payload,proxy', source: 'JS'|'YAML' }]
 * @param {string} searchTerm - 搜索词（匹配类型、payload、代理组）
 * @returns {Array} 过滤后的规则数组
 */
function filterRulesBySearchTerm(rulesWithSource, searchTerm) {
  if (!searchTerm || !searchTerm.trim()) return rulesWithSource;
  const term = searchTerm.trim().toLowerCase();
  return rulesWithSource.filter(({ rule }) => {
    return rule.toLowerCase().includes(term);
  });
}

/**
 * 渲染额外脚本规则列表（支持折叠/分页/搜索展示，适配上千条规则场景）
 */
function renderScriptRules(rulesWithSource, proxies) {
  const listEl = document.getElementById('script-rule-list');
  const countEl = document.getElementById('script-rule-count');
  const emptyEl = document.getElementById('script-rule-empty');
  const needInitEl = document.getElementById('script-rule-need-init');
  const notFoundEl = document.getElementById('script-rule-not-found');
  const toggleBtn = document.getElementById('script-toggle-btn');
  const paginationEl = document.getElementById('script-rule-pagination');
  const sectionEl = document.getElementById('module-script-rules');

  emptyEl.style.display = 'none';
  needInitEl.style.display = 'none';
  notFoundEl.style.display = 'none';
  listEl.innerHTML = '';

  if (!rulesWithSource) {
    return;
  }

  // 保存完整规则到状态
  scriptRulePaginationState.allRules = rulesWithSource;
  scriptRulePaginationState.proxies = proxies;

  // 根据搜索词过滤
  const filteredRules = filterRulesBySearchTerm(rulesWithSource, scriptRulePaginationState.searchTerm);
  scriptRulePaginationState.totalRules = filteredRules.length;

  // 显示总数（搜索时显示匹配数/总数）
  if (scriptRulePaginationState.searchTerm && scriptRulePaginationState.searchTerm.trim()) {
    countEl.textContent = `${filteredRules.length}/${rulesWithSource.length}`;
  } else {
    countEl.textContent = rulesWithSource.length;
  }

  if (rulesWithSource.length === 0) {
    emptyEl.style.display = 'block';
    toggleBtn.style.display = 'none';
    paginationEl.style.display = 'none';
    sectionEl.classList.remove('script-rules-collapsed');
    return;
  }

  // 搜索无结果
  if (filteredRules.length === 0) {
    listEl.appendChild(el('div', { style: 'color: var(--md-sys-color-on-surface-variant); font: var(--md-typescale-body-small); padding: var(--md-spacing-2) 0;' }, I18N.t('search_no_result')));
    toggleBtn.style.display = 'none';
    paginationEl.style.display = 'none';
    sectionEl.classList.remove('script-rules-collapsed');
    return;
  }

  // 异步获取展示模式设置并渲染
  getRuleDisplaySettings().then(({ mode, threshold }) => {
    scriptRulePaginationState.pageSize = threshold;
    const usePagination = shouldUsePagination(filteredRules.length, mode, threshold);
    const useCollapse = shouldUseCollapse(filteredRules.length, mode, threshold);

    // 控制按钮显示
    if (useCollapse) {
      toggleBtn.style.display = 'inline-flex';
      toggleBtn.textContent = I18N.t('script_rules_expand');
      sectionEl.classList.add('script-rules-collapsed');
      paginationEl.style.display = 'none';
    } else if (usePagination) {
      toggleBtn.style.display = 'none';
      paginationEl.style.display = 'flex';
      sectionEl.classList.remove('script-rules-collapsed');
    } else {
      toggleBtn.style.display = 'none';
      paginationEl.style.display = 'none';
      sectionEl.classList.remove('script-rules-collapsed');
    }

    if (usePagination) {
      scriptRulePaginationState.currentPage = 1;
      renderScriptRulesPage(1);
    } else {
      renderScriptRulesAll(filteredRules, proxies);
    }
  });
}

/**
 * 渲染所有规则（不分页）
 */
function renderScriptRulesAll(rulesWithSource, proxies) {
  const listEl = document.getElementById('script-rule-list');
  listEl.innerHTML = '';
  rulesWithSource.forEach(({ rule: ruleStr, source }) => {
    listEl.appendChild(createScriptRuleItem(ruleStr, source, proxies));
  });
}

/**
 * 渲染指定页的规则（基于搜索过滤后的规则）
 */
function renderScriptRulesPage(page) {
  const state = scriptRulePaginationState;
  // 获取过滤后的规则
  const filteredRules = filterRulesBySearchTerm(state.allRules, state.searchTerm);
  const totalPages = Math.max(1, Math.ceil(filteredRules.length / state.pageSize));
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  state.currentPage = page;

  const start = (page - 1) * state.pageSize;
  const end = Math.min(start + state.pageSize, filteredRules.length);
  const pageRules = filteredRules.slice(start, end);

  const listEl = document.getElementById('script-rule-list');
  listEl.innerHTML = '';
  pageRules.forEach(({ rule: ruleStr, source }) => {
    listEl.appendChild(createScriptRuleItem(ruleStr, source, state.proxies));
  });

  const infoEl = document.getElementById('script-page-info');
  const prevBtn = document.getElementById('script-page-prev');
  const nextBtn = document.getElementById('script-page-next');
  if (infoEl) infoEl.textContent = `${page} / ${totalPages}`;
  if (prevBtn) prevBtn.disabled = (page <= 1);
  if (nextBtn) nextBtn.disabled = (page >= totalPages);
}

/**
 * 创建单个规则项 DOM 元素
 * 两行布局（带边框分组）：
 *   第一行：来源标签 + 规则类型 + 代理组名 + 最终代理
 *   第二行：域名(payload) + 删除按钮
 */
function createScriptRuleItem(ruleStr, source, proxies) {
  const parts = ruleStr.split(',');
  const type = parts[0] || '';
  const payload = parts[1] || '';
  const proxy = parts[2] || '';
  const div = document.createElement('div');
  div.className = 'rule-item rule-item--card';
  const finalProxy = resolveFinalProxy(proxy, proxies);
  const fullRule = `${type},${payload},${proxy}`;

  // 第一行：来源 + 类型 + 代理组名 + 最终代理
  const row1 = el('div', { className: 'rule-item-row rule-item-meta' });
  row1.appendChild(el('span', {
    className: source === 'JS' ? 'rule-source-tag rule-source--js' : 'rule-source-tag rule-source--yaml',
    title: source === 'JS' ? I18N.t('rule_source_js') : I18N.t('rule_source_yaml')
  }, source === 'JS' ? 'JS' : 'YA'));
  row1.appendChild(el('span', { className: 'rule-type-tag' }, type));
  row1.appendChild(el('span', { className: 'rule-group-name', title: proxy }, proxy));
  row1.appendChild(el('span', { className: `rule-policy ${finalProxy.class}`, title: finalProxy.name }, finalProxy.name));
  div.appendChild(row1);

  // 第二行：域名 + 删除按钮
  const row2 = el('div', { className: 'rule-item-row rule-item-payload' });
  row2.appendChild(el('span', { className: 'rule-payload', title: fullRule }, payload || '—'));

  const scriptFlag = source === 'JS' ? '1' : '0';
  const btn = el('button', {
    className: 'rule-delete-btn',
    title: I18N.t('rule_delete'),
    dataset: { rule: fullRule, script: scriptFlag }
  }, '✕');
  btn.setAttribute('data-i18n-title', 'rule_delete');
  row2.appendChild(btn);
  div.appendChild(row2);

  return div;
}

/**
 * 绑定额外脚本规则的折叠/分页/搜索事件
 */
function bindScriptRulesControls() {
  const toggleBtn = document.getElementById('script-toggle-btn');
  const prevBtn = document.getElementById('script-page-prev');
  const nextBtn = document.getElementById('script-page-next');
  const sectionEl = document.getElementById('module-script-rules');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isCollapsed = sectionEl.classList.contains('script-rules-collapsed');
      if (isCollapsed) {
        sectionEl.classList.remove('script-rules-collapsed');
        toggleBtn.textContent = I18N.t('script_rules_collapse');
      } else {
        sectionEl.classList.add('script-rules-collapsed');
        toggleBtn.textContent = I18N.t('script_rules_expand');
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      renderScriptRulesPage(scriptRulePaginationState.currentPage - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      renderScriptRulesPage(scriptRulePaginationState.currentPage + 1);
    });
  }

  // 脚本规则搜索框
  const scriptSearchInput = document.getElementById('script-rule-search');
  if (scriptSearchInput) {
    let searchTimer = null;
    scriptSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        scriptRulePaginationState.searchTerm = e.target.value;
        if (window._scriptRulesWithSource) {
          renderScriptRules(window._scriptRulesWithSource, scriptRulePaginationState.proxies);
        }
      }, 200);
    });
  }

  // 内置规则搜索框
  const builtinSearchInput = document.getElementById('builtin-rule-search');
  if (builtinSearchInput) {
    let searchTimer = null;
    builtinSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (window._builtinRules && window._builtinRulesProxies) {
          renderRuleList(window._builtinRules, window._builtinRulesProxies);
        }
      }, 200);
    });
  }
}

/**
 * 绑定设置页分组快捷跳转事件
 */
function bindSettingsSubTabEvents() {
  const subTabBar = document.getElementById('settings-sub-tab-bar');
  if (!subTabBar) return;
  subTabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-sub-tab');
    if (!btn) return;
    const targetSubTab = btn.dataset.subTab;
    // 切换子标签页按钮 active 状态
    subTabBar.querySelectorAll('.settings-sub-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // 切换子标签页内容面板 active 状态
    const settingsCard = document.getElementById('module-settings');
    settingsCard.querySelectorAll('.settings-sub-tab-content').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.subTabContent === targetSubTab);
    });
  });
}

async function loadScriptRules() {
  const [scriptResult, proxiesResult, clashRulesResult] = await Promise.all([
    sendToBackground({ action: 'getScriptRules' }),
    sendToBackground({ action: 'getProxies' }),
    sendToBackground({ action: 'getClashRules' })
  ]);
  const proxies = proxiesResult.success ? proxiesResult.proxies : null;
  const clashRules = clashRulesResult.success ? clashRulesResult.rules : null;
  const needInitEl = document.getElementById('script-rule-need-init');
  const notFoundEl = document.getElementById('script-rule-not-found');

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

  let yamlRules = [];
  if (clashRulesResult.success) {
    const jsRuleSet = new Set(jsRules.map(r => r.toLowerCase()));
    yamlRules = clashRulesResult.rules
      .filter(r => isDomainRule(r.type))
      .map(r => `${r.type},${r.payload},${r.proxy}`)
      .filter(ruleStr => !jsRuleSet.has(ruleStr.toLowerCase()));
  }

  if (!jsFileOk) {
    const merged = yamlRules.map(rule => ({ rule, source: 'YAML' }));
    // 即使 Native Host 失败，也赋值 window._scriptRulesWithSource，确保搜索框可用
    window._scriptRulesWithSource = merged;
    renderScriptRules(merged, proxies);
    if (scriptResult.needInit) {
      needInitEl.style.display = 'block';
    } else if (!scriptResult.success) {
      notFoundEl.style.display = 'block';
    }
    return { clashRules, proxies };
  }

  const merged = [
    ...jsRules.map(rule => ({ rule, source: 'JS' })),
    ...yamlRules.map(rule => ({ rule, source: 'YAML' }))
  ];
  window._scriptRulesWithSource = merged;
  renderScriptRules(merged, proxies);
  return { clashRules, proxies };
}

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

// ──── 动态加载代理组下拉框 ────

async function populateProxyGroupSelects() {
  const quickAddSelect = document.getElementById('quick-add-policy');
  const batchDetectSelect = document.getElementById('batch-detect-policy');

  [quickAddSelect, batchDetectSelect].forEach(sel => {
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = I18N.t('quick_add_loading');
    sel.appendChild(opt);
  });

  const result = await sendToBackground({ action: 'getProxies' });
  const proxies = result.proxies || {};

  const groupNames = [];
  Object.entries(proxies).forEach(([name, info]) => {
    if (info.all && info.all.length > 0) {
      groupNames.push(name);
    }
  });

  if (groupNames.length === 0) {
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
    if (!btn || btn.disabled) return;
    const mode = btn.dataset.mode;
    const result = await sendToBackground({ action: 'setMode', mode });
    if (result.success) {
      renderModeSwitch(mode);
      await initPopup();
    } else {
      const errKey = result?.error === 'clash_not_running'
        ? 'error_clash_not_running'
        : 'error_clash_unreachable';
      showToast(I18N.t(errKey), 'error');
    }
  });
}

/**
 * 绑定快捷添加规则事件（S-001 修复：使用 DOM API 替代 innerHTML）
 */
function bindQuickAddRule(domain) {
  document.getElementById('quick-add-domain').value = domain;

  document.getElementById('quick-add-btn').addEventListener('click', async () => {
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
      showToast(I18N.t('success_rule_added') + ' — ' + I18N.t('rule_restart_hint'), 'success', {
        action: {
          label: I18N.t('restart_clash'),
          callback: triggerRestartClash
        }
      });
      const settings = await sendToBackground({ action: 'getSettings' });
      // writeToYaml=true 表示"写入 YAML"，来源标签显示 YA；false 表示"写入 Script.js"，显示 JS
      const writeToYaml = settings.writeToYaml === true;
      const listEl = document.getElementById('script-rule-list');
      const countEl = document.getElementById('script-rule-count');
      const placeholder = listEl.querySelector('div[style]');
      if (placeholder && !placeholder.classList.contains('rule-item')) {
        listEl.innerHTML = '';
      }
      document.getElementById('script-rule-empty').style.display = 'none';

      const div = document.createElement('div');
      div.className = 'rule-item rule-item--card';
      const policyClass = getPolicyClass(policy);

      // 第一行：来源 + 类型 + 代理组名 + 最终代理
      const row1 = el('div', { className: 'rule-item-row rule-item-meta' });
      row1.appendChild(el('span', {
        className: writeToYaml ? 'rule-source-tag rule-source--yaml' : 'rule-source-tag rule-source--js',
        title: writeToYaml ? I18N.t('rule_source_yaml') : I18N.t('rule_source_js')
      }, writeToYaml ? 'YA' : 'JS'));
      row1.appendChild(el('span', { className: 'rule-type-tag' }, ruleType));
      row1.appendChild(el('span', { className: 'rule-group-name', title: policy }, policy));
      row1.appendChild(el('span', { className: `rule-policy ${policyClass}` }, policy));
      div.appendChild(row1);

      // 第二行：域名 + 删除按钮
      const row2 = el('div', { className: 'rule-item-row rule-item-payload' });
      row2.appendChild(el('span', { className: 'rule-payload', title: rule }, inputDomain));

      const btn = el('button', {
        className: 'rule-delete-btn',
        title: I18N.t('rule_delete'),
        dataset: { rule: rule, script: writeToYaml ? '0' : '1' }
      }, '✕');
      btn.setAttribute('data-i18n-title', 'rule_delete');
      row2.appendChild(btn);
      div.appendChild(row2);

      listEl.appendChild(div);
      countEl.textContent = parseInt(countEl.textContent) + 1;
    } else {
      showNativeError(result, 'error_native_host');
    }
  });
}

/**
 * 绑定域名检测事件（S-001 修复：使用 DOM API 替代 innerHTML）
 */
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

    const suggestions = smartGroupDomains(result.domains);
    currentSuggestions = suggestions;

    summaryEl.style.display = 'block';
    summaryEl.textContent = `${I18N.t('batch_detect_collected')} ${result.count} ${I18N.t('batch_detect_domains')}, ${I18N.t('batch_detect_grouped')} ${suggestions.length} ${I18N.t('batch_detect_groups')}`;

    listEl.style.display = 'block';
    listEl.innerHTML = '';
    actionsEl.style.display = 'flex';

    suggestions.forEach((s, idx) => {
      const div = document.createElement('div');
      div.className = 'domain-group-item';

      const label = document.createElement('label');
      label.className = 'md3-checkbox';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = s.suggested;
      input.dataset.type = s.type;
      input.dataset.idx = idx;
      label.appendChild(input);

      label.appendChild(el('span', { className: 'domain-suggested' }, s.suggested));

      if (s.count >= 2) {
        label.appendChild(el('span', { className: 'domain-count' }, `${s.count} ${I18N.t('batch_detect_domains')}`));
      } else {
        label.appendChild(el('span', { className: 'domain-type-tag' }, s.type));
      }

      div.appendChild(label);

      if (s.count >= 2) {
        const subList = document.createElement('div');
        subList.className = 'domain-sub-list';
        s.hostnames.forEach(h => {
          subList.appendChild(el('span', { className: 'domain-sub' }, h));
        });
        div.appendChild(subList);
      }

      listEl.appendChild(div);
    });
  });

  document.getElementById('batch-detect-select-all').addEventListener('click', () => {
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });

  document.getElementById('batch-detect-deselect-all').addEventListener('click', () => {
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    actionsEl.style.display = 'none';
    listEl.style.display = 'none';
    summaryEl.style.display = 'none';
    listEl.innerHTML = '';
  });

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
    let result;
    if (isScript) {
      result = await sendToBackground({ action: 'removeRule', rule: ruleStr, useScript: true });
    } else {
      result = await sendToBackground({ action: 'removeRule', rule: ruleStr, useScript: false });
    }
    if (result && result.success) {
      showToast(I18N.t('success_rule_deleted') + ' — ' + I18N.t('rule_restart_hint'), 'success', {
        action: {
          label: I18N.t('restart_clash'),
          callback: triggerRestartClash
        }
      });
      const item = btn.closest('.matched-rule-item');
      if (item) item.remove();
      await loadScriptRules();
    } else {
      showNativeError(result, 'error_native_host');
    }
  });
}

function bindRuleListDeleteEvents() {
  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.rule-delete-btn');
    if (!btn) return;

    const ruleStr = btn.dataset.rule;
    const isScript = btn.dataset.script === '1';
    const ruleItem = btn.closest('.rule-item');
    if (!ruleItem) return;
    ruleItem.style.opacity = '0.5';
    btn.disabled = true;

    let result;
    if (isScript) {
      result = await sendToBackground({ action: 'removeRule', rule: ruleStr, useScript: true });
    } else {
      result = await sendToBackground({ action: 'removeRule', rule: ruleStr, useScript: false });
    }

    if (result && result.success) {
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
      if (isScript && parseInt(countEl.textContent) === 0) {
        document.getElementById('script-rule-empty').style.display = 'block';
      }
    } else {
      ruleItem.style.opacity = '1';
      btn.disabled = false;
      showNativeError(result, 'error_native_host');
    }
  });
}

/**
 * 绑定设置事件（模块化架构，支持标签页布局编辑器和缩放比例）
 */
function bindSettingsEvents() {
  // 代理地址+端口 → 自动拼接 API URL
  function autoGenerateApiUrl() {
    const host = document.getElementById('settings-api-host').value.trim();
    const port = document.getElementById('settings-api-port').value.trim();
    if (host && port) {
      document.getElementById('settings-api-url').value = `http://${host}:${port}`;
    }
  }

  document.getElementById('settings-api-host').addEventListener('input', autoGenerateApiUrl);
  document.getElementById('settings-api-port').addEventListener('input', autoGenerateApiUrl);

  // 缩放滑块实时预览
  const zoomSlider = document.getElementById('zoom-slider');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', (e) => {
      const scale = parseInt(e.target.value);
      applyZoom(scale);
    });
  }

  // 保存设置（每个子标签页的保存按钮都保存全部设置，保存后保持当前子标签页）
  document.querySelectorAll('.settings-sub-tab-save').forEach(saveBtn => {
    saveBtn.addEventListener('click', async () => {
      // 记录当前 active 子标签页，保存后恢复
      const activeSubTab = document.querySelector('.settings-sub-tab.active');
      const activeSubTabId = activeSubTab?.dataset.subTab || 'connection';

      const currentSettings = await sendToBackground({ action: 'getSettings' });
      const configPath = document.getElementById('settings-config-path').value.trim();
      const theme = document.getElementById('theme-select').value;
      const tabLayout = readTabLayoutFromEditor() || getDefaultTabLayout();
      const zoomScale = parseInt(document.getElementById('zoom-slider').value) || 100;
      const ruleDisplayMode = document.getElementById('rule-display-mode').value;
      const rulePageSize = parseInt(document.getElementById('rule-page-size').value) || 20;
      const settings = {
        currentMode: currentSettings.currentMode || 'system',
        clashApiUrl: document.getElementById('settings-api-url').value.trim(),
        clashSecret: document.getElementById('settings-secret').value.trim(),
        clashApiHost: document.getElementById('settings-api-host').value.trim(),
        clashApiPort: parseInt(document.getElementById('settings-api-port').value) || 9090,
        clashConfigPath: configPath,
        writeToYaml: document.getElementById('settings-write-to-yaml').checked,
        disableFallback: document.getElementById('settings-disable-fallback').checked,
        language: document.getElementById('language-select').value,
        theme: theme,
        tabLayout: tabLayout,
        zoomScale: zoomScale,
        ruleDisplayMode: ruleDisplayMode,
        rulePageSize: rulePageSize
      };
      await sendToBackground({ action: 'saveSettings', settings });
      // 应用主题
      applyTheme(theme);
      // 应用缩放
      applyZoom(zoomScale);
      // 重建标签页布局
      buildTabLayout(tabLayout);
      // 切换到设置所在的标签页（保存后保持在设置页）
      const settingsTab = tabLayout.tabs.find(t => t.modules.includes('settings'));
      if (settingsTab) {
        switchTab(settingsTab.id);
      }
      // 恢复子标签页 active 状态
      const subTabBar = document.getElementById('settings-sub-tab-bar');
      if (subTabBar) {
        subTabBar.querySelectorAll('.settings-sub-tab').forEach(b => {
          b.classList.toggle('active', b.dataset.subTab === activeSubTabId);
        });
        document.querySelectorAll('.settings-sub-tab-content').forEach(panel => {
          panel.classList.toggle('active', panel.dataset.subTabContent === activeSubTabId);
        });
      }
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

      // 保存后检测 Clash API 连接状态
      // 阶段1：快速检测用户配置的 URL（半秒内反馈）
      const quick = await sendToBackground({ action: 'checkClashConfiguredUrl' });
      if (quick && quick.reachable) {
        // 用户配置的 URL 通，立即弹"已连接"
        showToast(I18N.t('settings_clash_connected'), 'success', { duration: 3000 });
      } else if (settings.disableFallback === true) {
        // 勾选了"关闭端口错误自动探测"：不尝试其他端口，直接提示无法连接
        showToast(I18N.t('settings_clash_unreachable'), 'warn', { duration: 4000 });
      } else {
        // 未勾选：用户配置的 URL 不通，立即弹"连接失败，开始尝试其他端口"
        showToast(I18N.t('settings_clash_connecting_fallback'), 'warn', { duration: 3000 });
        // 阶段2：回退探测其他端口
        const statusResult = await sendToBackground({ action: 'getStatus' });
        if (statusResult && statusResult.clashReachableViaFallback) {
          // 回退找到 Clash，弹"已通过 xxx 端口替代" + 附带"修正"按钮
          const fallbackPort = statusResult.fallbackApiUrl?.match(/:(\d+)/)?.[1] || '?';
          const configuredPort = statusResult.clashApiPort || (settings?.clashApiUrl?.match(/:(\d+)/)?.[1]) || '?';
          const msg = I18N.t('settings_clash_port_mismatch')
            .replace('{configured}', configuredPort)
            .replace('{actual}', fallbackPort);
          showToast(msg, 'warn', {
            duration: 8000,
            action: {
              label: I18N.t('settings_fix_port').replace('{port}', fallbackPort),
              callback: async () => {
                // 通过 getSettings 读取当前设置（保证数据迁移已执行）
                const settings = await sendToBackground({ action: 'getSettings' });
                settings.clashApiUrl = statusResult.fallbackApiUrl;
                await sendToBackground({ action: 'saveSettings', settings });
                // 同步更新输入框
                const apiInput = document.getElementById('settings-api-url');
                if (apiInput) apiInput.value = statusResult.fallbackApiUrl;
                showToast(I18N.t('settings_fixed_port').replace('{port}', fallbackPort), 'success', { duration: 3000 });
                // 重新检测状态指示器
                renderClashApiStatus();
              }
            }
          });
        } else {
          showToast(I18N.t('settings_clash_unreachable'), 'warn', { duration: 4000 });
        }
      }

      await initPopup();
    });
  });

  // 自动检测配置文件路径
  document.getElementById('settings-detect-config').addEventListener('click', async () => {
    const btn = document.getElementById('settings-detect-config');
    btn.disabled = true;
    btn.textContent = '...';
    const result = await sendToBackground({ action: 'ping' });
    btn.disabled = false;
    btn.textContent = I18N.t('settings_detect');
    if (result && result.success && result.configPath && result.configPath !== '(not found)') {
      document.getElementById('settings-config-path').value = result.configPath;
      showToast(result.configPath, 'success');
    } else if (result && !result.success) {
      // Native Host 不可用：明确提示未安装，而非笼统的"未找到配置文件"
      const err = result.error || '';
      if (err.includes('not found') || err.includes('native messaging host') || err.includes('Specified native messaging')) {
        showToast(I18N.t('native_host_not_installed'), 'error', { duration: 5000 });
      } else {
        showToast(I18N.t('settings_detect_fail'), 'error');
      }
    } else {
      showToast(I18N.t('settings_detect_fail'), 'error');
    }
  });

  // 语言切换
  document.getElementById('language-select').addEventListener('change', async (e) => {
    await I18N.setLanguage(e.target.value);
    refreshAllI18n();
    // 重新渲染标签页布局编辑器（模块名称需要更新）
    const layout = await getTabLayout();
    renderTabLayoutEditor(layout);
    bindTabLayoutEditorEvents(layout);
    await initPopup();
  });

  // 主题切换（实时预览）
  document.getElementById('theme-select').addEventListener('change', async (e) => {
    const theme = e.target.value;
    applyTheme(theme);
    const { settings } = await chrome.storage.local.get('settings');
    settings.theme = theme;
    await chrome.storage.local.set({ settings });
    showToast(I18N.t('settings_save'), 'success');
  });

  // 规则展示模式切换（实时预览）
  document.getElementById('rule-display-mode').addEventListener('change', async (e) => {
    const mode = e.target.value;
    const { settings } = await chrome.storage.local.get('settings');
    settings.ruleDisplayMode = mode;
    await chrome.storage.local.set({ settings });
    if (window._scriptRulesWithSource) {
      renderScriptRules(window._scriptRulesWithSource, scriptRulePaginationState.proxies);
    }
  });

  // 分页阈值变更（实时预览）
  document.getElementById('rule-page-size').addEventListener('change', async (e) => {
    const threshold = Math.max(10, Math.min(500, parseInt(e.target.value) || 50));
    e.target.value = threshold;
    const { settings } = await chrome.storage.local.get('settings');
    settings.rulePageSize = threshold;
    await chrome.storage.local.set({ settings });
    if (window._scriptRulesWithSource) {
      renderScriptRules(window._scriptRulesWithSource, scriptRulePaginationState.proxies);
    }
  });
}

/**
 * 加载设置到表单
 */
async function loadSettingsForm(cachedStatus) {
  const settings = await sendToBackground({ action: 'getSettings' });
  document.getElementById('settings-api-url').value = settings.clashApiUrl || 'http://127.0.0.1:9090';
  document.getElementById('settings-secret').value = settings.clashSecret || '';
  document.getElementById('settings-api-host').value = settings.clashApiHost || '127.0.0.1';
  document.getElementById('settings-api-port').value = settings.clashApiPort || 9090;
  document.getElementById('settings-config-path').value = settings.clashConfigPath || '';
  document.getElementById('settings-write-to-yaml').checked = settings.writeToYaml === true;
  document.getElementById('settings-disable-fallback').checked = settings.disableFallback === true;

  // 用户需求：配置路径为空时自动检测并填充到文本框
  // 用户主动填入后 clashConfigPath 非空，不再自动覆盖
  if (!settings.clashConfigPath) {
    autoDetectConfigPath();
  }
  // 主题选择器
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.value = settings.theme || 'auto';
  }
  // 规则展示模式
  const ruleDisplaySelect = document.getElementById('rule-display-mode');
  if (ruleDisplaySelect) {
    ruleDisplaySelect.value = settings.ruleDisplayMode || 'auto';
  }
  // 分页阈值（下拉选择，兼容旧版保存的非标准值）
  const rulePageSizeInput = document.getElementById('rule-page-size');
  if (rulePageSizeInput) {
    const savedPageSize = settings.rulePageSize || 20;
    const option = rulePageSizeInput.querySelector(`option[value="${savedPageSize}"]`);
    rulePageSizeInput.value = option ? String(savedPageSize) : '20';
  }
  // 缩放比例
  const zoomScale = settings.zoomScale || 100;
  applyZoom(zoomScale);

  // 用户需求：每次打开设置时检测 Native Host 和 Clash API 是否工作正常
  renderNativeHostStatus();
  // 传入 cachedStatus 复用 initPopup 的 getStatus 结果，避免重复请求
  renderClashApiStatus(cachedStatus);
}

/**
 * 自动检测配置文件路径并填充到文本框
 * 仅在用户未手动填写过路径时调用（clashConfigPath 为空）
 * 检测成功后自动填充文本框，但不自动保存到 storage（需用户点"保存设置"）
 */
async function autoDetectConfigPath() {
  const configPathInput = document.getElementById('settings-config-path');
  if (!configPathInput) return;
  // 如果用户已手动输入内容，不覆盖
  if (configPathInput.value.trim()) return;

  const result = await sendToBackground({ action: 'ping' });
  if (result && result.success && result.configPath && result.configPath !== '(not found)') {
    configPathInput.value = result.configPath;
  }
}

/**
 * 检测并渲染 Native Host 状态（设置页连接配置子标签页顶部）
 * 每次打开设置页时自动调用，检测 Native Host 是否安装并正常工作
 */
async function renderNativeHostStatus() {
  const statusEl = document.getElementById('native-host-status');
  if (!statusEl) return;

  // 显示检测中状态
  statusEl.className = 'native-host-status native-host-status--checking';
  statusEl.innerHTML = '';
  statusEl.appendChild(el('span', { className: 'native-host-status-dot' }));
  statusEl.appendChild(el('span', { className: 'native-host-status-text' }, I18N.t('native_host_checking')));

  // 调用 background 检测 Native Host
  const result = await sendToBackground({ action: 'ping' });

  statusEl.innerHTML = '';
  if (result && result.success) {
    // Native Host 可用
    statusEl.className = 'native-host-status native-host-status--ok';
    statusEl.appendChild(el('span', { className: 'native-host-status-dot' }));
    const textEl = el('span', { className: 'native-host-status-text' }, I18N.t('native_host_installed'));
    if (result.configPath && result.configPath !== '(not found)') {
      textEl.title = result.configPath;
    }
    statusEl.appendChild(textEl);
  } else {
    // Native Host 不可用（未安装/未注册）
    statusEl.className = 'native-host-status native-host-status--error';
    statusEl.appendChild(el('span', { className: 'native-host-status-dot' }));
    statusEl.appendChild(el('span', { className: 'native-host-status-text' }, I18N.t('native_host_not_installed')));
    // 添加安装引导链接
    const hintEl = el('div', { className: 'native-host-status-hint' });
    hintEl.appendChild(el('span', {}, I18N.t('native_host_install_hint')));
    const linkEl = el('a', { className: 'native-host-install-link', title: I18N.t('native_host_install_link_title') }, I18N.t('native_host_install_link'));
    linkEl.href = '#';
    linkEl.addEventListener('click', (e) => {
      e.preventDefault();
      showToast(I18N.t('native_host_install_toast'), 'warn', { duration: 6000 });
    });
    hintEl.appendChild(linkEl);
    statusEl.appendChild(hintEl);
  }
}

/**
 * 检测并渲染 Clash API 连接状态（设置页连接配置子标签页，Native Host 下方）
 * 与 Native Host 检测完全独立，每次打开设置页时自动调用
 */
async function renderClashApiStatus(cachedStatus) {
  const statusEl = document.getElementById('clash-api-status');
  if (!statusEl) return;

  // 显示检测中状态
  statusEl.className = 'native-host-status native-host-status--checking';
  statusEl.innerHTML = '';
  statusEl.appendChild(el('span', { className: 'native-host-status-dot' }));
  statusEl.appendChild(el('span', { className: 'native-host-status-text' }, I18N.t('clash_api_checking')));

  // 如果传入了缓存的状态结果则复用，避免重复调用 getStatus（弹窗打开时 initPopup 已调用过一次）
  const result = cachedStatus || await sendToBackground({ action: 'getStatus' });

  statusEl.innerHTML = '';
  // 用 clashConfiguredUrlReachable 判断用户配置的 URL 是否通（不走回退）
  // 这样设置页状态指示器准确反映"用户配置是否正确"，而非"Clash 是否可用"
  if (result && result.clashConfiguredUrlReachable) {
    statusEl.className = 'native-host-status native-host-status--ok';
    statusEl.appendChild(el('span', { className: 'native-host-status-dot' }));
    const textEl = el('span', { className: 'native-host-status-text' }, I18N.t('settings_clash_connected'));
    if (result.config) {
      const port = result.proxyPort;
      textEl.title = `${result.clashApiHost}:${port}`;
    }
    statusEl.appendChild(textEl);
  } else if (result && result.clashReachableViaFallback) {
    // 用户配置的 URL 不通，但回退探测找到了 Clash
    statusEl.className = 'native-host-status native-host-status--error';
    statusEl.appendChild(el('span', { className: 'native-host-status-dot' }));
    const fallbackPort = result.fallbackApiUrl?.match(/:(\d+)/)?.[1] || '?';
    const configuredPort = result.clashApiPort || (result.clashApiUrl?.match(/:(\d+)/)?.[1]) || '?';
    const msg = I18N.t('settings_clash_port_mismatch')
      .replace('{configured}', configuredPort)
      .replace('{actual}', fallbackPort);
    statusEl.appendChild(el('span', { className: 'native-host-status-text' }, msg));

    // 动态创建"修正为 XXX 端口"按钮（避免被 innerHTML 清空）
    if (result.fallbackApiUrl) {
      const fixBtn = el('button', {
        type: 'button',
        className: 'clash-api-fix-btn'
      }, I18N.t('settings_fix_port').replace('{port}', fallbackPort));
      fixBtn.onclick = async () => {
        fixBtn.disabled = true;
        const originalText = fixBtn.textContent;
        fixBtn.textContent = '...';
        try {
          // 通过 getSettings 读取当前设置（保证数据迁移已执行）
          const settings = await sendToBackground({ action: 'getSettings' });
          settings.clashApiUrl = result.fallbackApiUrl;
          await sendToBackground({ action: 'saveSettings', settings });
          showToast(I18N.t('settings_fixed_port').replace('{port}', fallbackPort), 'success', { duration: 3000 });
          // 重新检测状态
          await renderClashApiStatus();
          // 同步更新输入框的值
          const apiInput = document.getElementById('settings-api-url');
          if (apiInput) apiInput.value = result.fallbackApiUrl;
        } catch (e) {
          showToast(I18N.t('settings_save_fail'), 'error');
        } finally {
          fixBtn.disabled = false;
          fixBtn.textContent = originalText;
        }
      };
      statusEl.appendChild(fixBtn);
    }
  } else {
    statusEl.className = 'native-host-status native-host-status--error';
    statusEl.appendChild(el('span', { className: 'native-host-status-dot' }));
    statusEl.appendChild(el('span', { className: 'native-host-status-text' }, I18N.t('settings_clash_unreachable')));
  }
}

// ──── 初始化（渐进式渲染） ────

/**
 * 初始化弹窗 UI（域名检测、规则列表、事件绑定）
 *
 * 优化说明：layout 和 settingsPromise 由外部 DOMContentLoaded 并行发起后传入，
 * 避免本函数内部重复 getTabLayout() 和 chrome.storage.local.get('settings')。
 * Clash/系统代理状态渲染已在 DOMContentLoaded 中通过 .then() 处理，此处不重复。
 *
 * @param {object} layout - 已获取的标签页布局（避免重复请求）
 * @param {Promise} settingsPromise - 已发起的 settings 读取 Promise（外部并行发起）
 */
async function initPopup(layout, settingsPromise) {
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

  window._currentTabLayout = layout;

  // settings 通过外部并行发起，这里 await 复用（用于域名检测模式判断）
  // 此时 settings 大概率已到达（本地读取比网络快），await 几乎无等待
  const { settings } = await settingsPromise;

  // 注意：Clash 状态和系统代理状态的渲染已在 DOMContentLoaded 中通过 .then() 处理，
  // 这里不再重复，避免双重渲染

  populateProxyGroupSelects();

  const scriptRulesPromise = loadScriptRules();

  const currentMode = settings?.currentMode || 'system';
  const domainCheckModeHint = document.getElementById('domain-check-mode-hint');
  const domainCheckMatched = document.getElementById('domain-check-matched');
  const domainCheckNotMatched = document.getElementById('domain-check-not-matched');

  if (currentMode !== 'clash') {
    domainCheckModeHint.style.display = 'block';
    domainCheckMatched.innerHTML = '';
    domainCheckNotMatched.style.display = 'none';
    scriptRulesPromise.then(({ clashRules, proxies }) => {
      if (clashRules) {
        renderRuleList(clashRules, proxies);
      }
    });
  } else {
    domainCheckModeHint.style.display = 'none';
    scriptRulesPromise.then(({ clashRules, proxies }) => {
      if (!clashRules) return;

      const matched = findMatchingRules(domain, clashRules);
      renderRuleList(clashRules, proxies);

      const localImprecise = matched.length === 0 || matched.every(r => normalizeRuleType(r.type) === 'MATCH');

      if (localImprecise) {
        document.getElementById('current-domain').textContent = domain;
        const matchedEl = document.getElementById('domain-check-matched');
        const notMatchedEl = document.getElementById('domain-check-not-matched');
        notMatchedEl.style.display = 'none';
        matchedEl.innerHTML = '';
        const detecting = el('div', { style: 'color: var(--md-sys-color-on-surface-variant); font: var(--md-typescale-body-small); padding: var(--md-spacing-1) 0;' }, I18N.t('domain_check_detecting'));
        matchedEl.appendChild(detecting);
      } else {
        renderDomainRuleCheck(domain, matched, proxies);
      }

      const queryConnections = (retryCount = 0) => {
        sendToBackground({ action: 'getDomainConnections' }).then(connResult => {
          if (connResult.success && connResult.connections) {
            const connMatched = findMatchingRulesFromConnections(domain, connResult.connections, clashRules);
            if (connMatched.length > 0) {
              renderDomainRuleCheck(domain, connMatched, proxies);
            } else if (localImprecise && retryCount === 0) {
              setTimeout(() => queryConnections(1), 1500);
            } else if (retryCount > 0) {
              renderDomainRuleCheck(domain, matched, proxies);
            }
          } else if (localImprecise && retryCount === 0) {
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
  if (!window._popupEventsBound) {
    bindQuickAddRule(domain);
    bindDomainDetection(tab.id);
    bindScriptInitButton();
    window._popupEventsBound = true;
  }
}

// ──── 入口 ────

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化主题（在 i18n 之前，避免闪烁）
  await initTheme();

  // 监听系统主题变化（玻璃拟态变体切换）
  bindSystemThemeListener();

  await I18N.init();
  refreshAllI18n();

  // 应用缩放比例
  const zoomScale = await getZoomScale();
  applyZoom(zoomScale);

  // 获取标签页布局并构建 UI
  const layout = await getTabLayout();
  window._currentTabLayout = layout;
  buildTabLayout(layout);

  // 绑定标签页切换
  bindTabEvents();

  // 绑定各功能事件
  bindModeSwitchEvents();
  bindDomainCheckDeleteEvents();
  bindRuleListDeleteEvents();
  bindSettingsEvents();
  bindScriptRulesControls();
  bindSettingsSubTabEvents();
  renderLanguageSetting();
  renderThemeSetting();

  // ★ 性能优化：并行渐进式渲染（先到先渲染）
  //
  // 思路：弹窗打开时「模式切换按钮高亮」和「Clash/系统代理状态」是最先映入眼帘的内容，
  //       前者依赖 settings（chrome.storage.local 本地读取，毫秒级），
  //       后者依赖 getStatus（需要通过 Service Worker 调 Clash API 探测，百毫秒~秒级）。
  //       两者无数据依赖，若串行等待则用户看到的是「空白 → 全部渲染完成」；
  //       改为并行发起 + 各自 .then() 独立渲染后，用户看到的是渐进式出现：
  //         ① settings 先到 → 模式按钮立即高亮（几乎瞬时）
  //         ② getStatus 随后到 → Clash 状态点 + 系统代理状态点亮起
  //       即使 getStatus 慢到 1s，用户也能立即看到当前模式，而非空白。
  //
  //       后续 loadSettingsForm 和 initPopup 复用同一个 Promise，不重复请求。
  const settingsPromise = chrome.storage.local.get('settings');  // 本地，快
  const statusPromise = sendToBackground({ action: 'getStatus' }); // 网络，慢

  // settings 先到 → 立即渲染模式切换按钮（系统代理/直连/clash代理 高亮）
  settingsPromise.then(({ settings }) => {
    if (settings && settings.currentMode) {
      renderModeSwitch(settings.currentMode);
    }
  });

  // status 先到 → 立即渲染 Clash 连接状态 + 系统代理状态
  statusPromise.then(status => {
    renderClashStatus(status.clashRunning, status.config, status.proxyPort, layout);
    renderSystemProxyStatus(status.sysProxy);

    const clashBtn = document.querySelector('#mode-switch button[data-mode="clash"]');
    if (clashBtn) {
      clashBtn.disabled = !status.clashRunning;
    }

    if (!status.clashRunning && !window._clashStatusNotified) {
      window._clashStatusNotified = true;
      showToast(I18N.t('error_clash_not_running'), 'warn', { duration: 4000 });
    }
  });

  // 以下是必须 await 的串行步骤（有数据依赖）：
  // loadSettingsForm 需要完整 status 数据（Clash API URL、端口、配置路径等），await 即可
  // 注意：上面的 .then() 已在 status 到达时立即渲染了状态指示器，这里 await 只为填充表单
  const status = await statusPromise;
  loadSettingsForm(status);

  // 初始化标签页布局编辑器
  renderTabLayoutEditor(layout);
  bindTabLayoutEditorEvents(layout);

  // 底部「重启 Clash 内核」按钮
  document.getElementById('restart-clash-btn').addEventListener('click', triggerRestartClash);

  // initPopup 复用已发起的 settingsPromise（避免重复 chrome.storage.local.get）
  // layout 也通过参数传入，避免 initPopup 内部重复 getTabLayout()
  await initPopup(layout, settingsPromise);
});
