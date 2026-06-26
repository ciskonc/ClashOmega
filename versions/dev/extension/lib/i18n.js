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
    const config = await chrome.storage.local.get('settings');
    let userLang = config.settings?.language;

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
    // 保存到 storage
    const config = await chrome.storage.local.get('settings');
    if (!config.settings) config.settings = {};
    config.settings.language = lang;
    await chrome.storage.local.set({ settings: config.settings });
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
      text = text.replace(`{${i}}`, arg);
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