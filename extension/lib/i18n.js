// 多语言管理模块
const I18N = (() => {
  let currentLang = 'zh_CN';
  let messages = {};

  // 支持的语言列表
  const SUPPORTED_LANGS = ['zh_CN', 'en', 'ja'];

  // 语言名称映射
  const LANG_NAMES = {
    zh_CN: '简体中文',
    en: 'English',
    ja: '日本語'
  };

  /**
   * 初始化：加载用户设置的语言或浏览器语言
   */
  async function init() {
    // 1. 尝试从 storage 读取用户设置的语言
    // v1.4.9：storage 异常时不让 init() reject，避免中断 popup 初始化链
    let userLang;
    try {
      const config = await chrome.storage.local.get('settings');
      userLang = config.settings?.language;
    } catch (e) {
      console.warn('ClashOmega: failed to read language setting:', e && e.message);
    }

    // 2. 如果用户未设置或设置无效，使用浏览器语言
    if (!userLang || !SUPPORTED_LANGS.includes(userLang)) {
      userLang = detectBrowserLanguage();
    }

    await loadLanguage(userLang);
  }

  /**
   * 检测浏览器语言
   */
  function detectBrowserLanguage() {
    const lang = navigator.language;
    if (lang.startsWith('zh')) return 'zh_CN';
    if (lang.startsWith('ja')) return 'ja';
    return 'en';
  }

  /**
   * 加载指定语言包
   */
  async function loadLanguage(lang) {
    currentLang = lang;
    try {
      const url = `/locales/${lang}.json`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      messages = await response.json();
    } catch (e) {
      console.error(`Failed to load language ${lang}:`, e.message);
      // 如果加载失败，尝试加载英文
      if (lang !== 'en') {
        await loadLanguage('en');
      }
    }
  }

  /**
   * 切换语言
   */
  async function setLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return;
    await loadLanguage(lang);
    // v1.4.9 修复：改走 updateSettings 原子更新
    // 原为「读整对象 → 只改 language → 整对象写回」，会与 popup 的 saveSettings 互相覆盖
    // （用户表现为「刚保存的 secret 又变回旧值」且无任何报错）
    await updateSettings((settings) => {
      settings.language = lang;
    });
  }

  /**
   * 获取翻译文本
   * @param {string} key - 翻译键
   * @param {...string} args - 占位符替换值
   * @returns {string}
   */
  function t(key, ...args) {
    let text = messages[key] !== undefined ? messages[key] : key;
    args.forEach((arg, i) => {
      // v1.4.9 修复：
      // 1) String.replace 的字符串模式只替换首个匹配 → 同一占位符出现两次时第二处残留 {0}
      // 2) 替换串中的美元特殊模式会被展开 → 用户可控文本（域名/规则名）含该符号时文案错乱
      // 改用 split/join 手工替换：无正则、无特殊模式语义、全部出现都替换
      const placeholder = '{' + i + '}';
      text = text.split(placeholder).join(String(arg));
    });
    return text;
  }

  /**
   * 获取当前语言
   */
  function getCurrentLang() {
    return currentLang;
  }

  /**
   * 获取语言名称
   */
  function getLangName(lang) {
    return LANG_NAMES[lang] || lang;
  }

  return { init, t, setLanguage, getCurrentLang, getLangName, SUPPORTED_LANGS };
})();