// ClashOmega — Service Worker (Background)
// 导入所有模块
importScripts(
  'lib/proxy-manager.js',
  'lib/clash-api.js',
  'lib/native-bridge.js',
  'lib/domain-detector.js'
);

// ──── 初始化 ────

// 启动域名检测器
initDomainDetector();

// 初始化默认设置
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({
      settings: {
        currentMode: 'system',
        clashApiUrl: 'http://127.0.0.1:9090',
        clashSecret: '',
        clashApiHost: '127.0.0.1',
        clashApiPort: 9090,
        clashConfigPath: '',
        writeToYaml: false,
        disableFallback: false,
        // 控制台面板类型：metacubexd | yacd | zashboard | custom
        dashboardType: 'metacubexd',
        // 自定义控制台 URL 模板（仅当 dashboardType='custom' 时使用）
        // 必须含占位符 %host / %port / %secret，运行时会被实际值替换
        dashboardCustomUrl: '',
        // Clash 远程管理：启用后主页显示 Clash 内核模式切换按钮（规则/全局/直连）
        clashRemoteEnabled: false,
        // Clash 内核代理模式（运行时切换，不持久化到 OpenClash uci 配置）
        // 仅当 clashRemoteEnabled=true 时有意义；可选值：'rule' | 'global' | 'direct'
        clashRemoteMode: 'rule',
        language: 'zh_CN'
      }
    });
  }
});

// ──── 消息路由 ────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // 保持异步响应通道
});

async function handleMessage(message) {
  try {
    switch (message.action) {
      // ──── 状态查询 ────
      case 'getStatus': {
        const settings = await getSettings();

        // ★ 性能优化：Clash API 探测与 Native Host 串行组并行执行
        // 原串行流程：getClashConfig → fallback 探测 → checkNativeHost → getSystemProxyStatus → detectClashClient
        // 优化后：组1（Clash API）与 组2（Native Host 串行）并行，detectClashClient 仍需串行（混合 Native Host + Clash API）
        // Native Host 必须串行（PowerShell 单进程不支持并发，避免 native messaging 队列错位）

        // 组1：Clash API 探测（用户配置 URL + 回退探测）
        const clashApiPromise = (async () => {
          // 状态检测只用用户配置的 URL，不走端口回退
          // clashConfiguredUrlReachable 准确反映用户配置的 URL 是否可达
          const config = await getClashConfig({ noFallback: true });
          const clashConfiguredUrlReachable = config !== null;

          // 如果用户配置的 URL 不通，并行回退检测（竞速，最快响应的端口立即返回）
          // 用户可在设置中关闭"端口错误自动探测"以禁用回退
          let fallbackConfig = null;
          let fallbackApiUrl = null;
          if (!clashConfiguredUrlReachable && settings.disableFallback !== true) {
            // ★ 修复：只用 getApiConfig 获取 headers，排除项用 settings.clashApiUrl
            // 原因：getApiConfig 的 baseUrl 可能是 session 缓存的 clashActualApiUrl（上次回退探测到的端口），
            //       如果用缓存作为排除项，会把这个可用端口排除在候选之外，导致回退探测失败
            //       （第一次保存设置时探测到 9097 并写入缓存，第二次调用 getStatus 时 9097 被排除 → 探测失败）
            const { headers } = await getApiConfig();
            const apiHost = settings.clashApiHost || '127.0.0.1';
            // 只排除用户配置的 URL（已通过 noFallback=true 检测过，确定不通）
            // 从 settings.clashApiUrl 提取端口，只比较端口号避免 URL 格式差异
            const userPort = settings.clashApiUrl?.match(/:(\d+)(?:\/|$)/)?.[1];
            const candidateUrls = CLASH_API_PORTS
              .filter(port => String(port) !== userPort)
              .map(port => `http://${apiHost}:${port}`);
            const found = await tryFetchParallel(
              candidateUrls.map(url => `${url}/configs`),
              headers
            );
            if (found) {
              fallbackConfig = found.data;
              // 从 found.url 提取基础 URL（去掉 /configs 后缀）
              fallbackApiUrl = found.url.replace(/\/configs$/, '');
              // 缓存到 session，后续业务操作（clashGet/rules 等）直接用这个 URL，不重复尝试错误端口
              // 注意：缓存只用于业务操作，不用于回退探测的排除项（见上面的注释）
              await cacheActualApiUrl(fallbackApiUrl);
            }
          }
          return { config, fallbackConfig, fallbackApiUrl, clashConfiguredUrlReachable };
        })();

        // 组2：Native Host 调用（仅 checkNativeHost，sysProxy 已改为异步加载不阻塞主页）
        // ★ 方案 I1（v1.4.2 性能优化）：原 getSystemProxyStatus 调 Native Host 读注册表 500-1000ms，
        // 阻塞主页加载。改为独立 action 'getSystemProxyStatus'，popup 异步调用并显示"加载中..."
        const nativeHostPromise = (async () => {
          const nativeHostInstalled = await checkNativeHost();
          return { nativeHostInstalled };
        })();

        // 等两组并行完成
        const [clashApiResult, nativeHostResult] = await Promise.all([clashApiPromise, nativeHostPromise]);
        const { config, fallbackConfig, fallbackApiUrl, clashConfiguredUrlReachable } = clashApiResult;
        const { nativeHostInstalled } = nativeHostResult;

        // clashRunning 反映 Clash 实际是否可用（包括回退）
        // 主页用此字段判断是否显示"已连接"，回退找到时也应显示已连接
        const clashRunning = clashConfiguredUrlReachable || fallbackConfig !== null;
        // 主页 renderClashStatus 需要 config 显示端口，回退时用 fallbackConfig
        const effectiveConfig = config || fallbackConfig;

        const proxyPort = clashRunning
          ? extractProxyAddress(effectiveConfig, settings.clashApiHost).port
          : settings.clashApiPort;

        // ★ 方案 J1（v1.4.2 性能优化）：detectClashClient 异步化
        // 原实现：getStatus 内 await detectClashClient（含 1 次 Native Host 调用 500-1000ms）→ Clash 状态点晚出
        // 优化后：getStatus 立即返回 clientType=null（未知），popup 异步调 'detectClient' action 获取
        // popup 收到 null 时不触发 UI 降级（保留默认可用状态），detectClient 返回后再应用 UI 降级
        // 客户端类型变化的缓存清理逻辑保留在 detectClient action 内（比对 settings._lastClientType）

        return {
          mode: settings.currentMode,
          clashRunning,
          config: effectiveConfig,
          proxyPort,
          // sysProxy 已改为异步加载（方案 I1），popup 通过独立 action 'getSystemProxyStatus' 获取
          nativeHostInstalled,
          clashApiHost: settings.clashApiHost,
          clashApiPort: settings.clashApiPort,
          clashApiUrl: settings.clashApiUrl,
          // 用户配置的 URL 是否可达（设置页状态指示器用此字段判断"已连接/未连接"）
          clashConfiguredUrlReachable,
          // 回退检测结果：当用户配置的 URL 不通但回退找到 Clash 时填充
          clashReachableViaFallback: fallbackConfig !== null,
          fallbackApiUrl: fallbackApiUrl,
          // ★ 方案 J1：clientType=null 表示异步加载中，popup 不触发 UI 降级
          // 真实 clientType 由独立 action 'detectClient' 异步返回
          clientType: null,
          clientDetails: null,
          // fileOperationSupported=null 表示未知，popup 收到 null 时不应用 UI 降级
          fileOperationSupported: null
        };
      }

      // ──── 客户端类型检测（异步查询，避免阻塞 getStatus） ────
      // ★ 方案 J1（v1.4.2 性能优化）：原 detectClashClient 在 getStatus 内同步调用，
      // 内部 sendToNativeSafe({ action: 'detectClient' }) 启动 PowerShell 500-1000ms 阻塞 Clash 状态点渲染。
      // 改为独立 action 后，Clash 状态点与系统代理同时出，UI 降级（模块禁用）异步应用。
      // 客户端类型变化时清除会话级 API URL 缓存，避免上一个客户端的缓存污染新客户端。
      case 'detectClient': {
        const settings = await getSettings();
        let clientType = CLIENT_TYPES.UNKNOWN;
        let clientDetails = null;
        try {
          const clientInfo = await detectClashClient(settings.clashApiUrl);
          clientType = clientInfo.clientType;
          clientDetails = clientInfo.details;
          // 客户端类型变化时清除会话级 API URL 缓存
          // 场景：从 Clash Verge Rev（端口 9097）切到 FLClash（端口 9090），缓存还指向 9097
          const lastClientType = settings._lastClientType;
          if (lastClientType && lastClientType !== clientType) {
            console.log(`ClashOmega: client type changed ${lastClientType} → ${clientType}, clearing session cache`);
            await clearCachedApiUrl();
          }
          if (lastClientType !== clientType) {
            settings._lastClientType = clientType;
            await chrome.storage.local.set({ settings });
          }
        } catch (e) {
          console.warn('ClashOmega: detectClashClient failed:', e.message);
        }
        return {
          clientType,
          clientDetails,
          fileOperationSupported: isFileOperationSupported(clientType)
        };
      }

      // ──── 系统代理状态（异步查询，避免阻塞 getStatus） ────
      // ★ 方案 I1（v1.4.2 性能优化）：原 getSystemProxyStatus 在 getStatus 内同步调用，
      // 调 Native Host 读注册表 500-1000ms 阻塞主页加载。改为独立 action 后，
      // popup 主页加载不依赖此函数，加载期间显示"加载中..."，本 action 返回后异步渲染。
      // 优先走 Native Host 读 Windows 系统代理（保留原 UI 语义），Native Host 不可用时回退 chrome.proxy。
      case 'getSystemProxyStatus': {
        return await getSystemProxyStatus();
      }

      // ──── 快速检测用户配置的 URL（不走回退，用于保存后即时反馈） ────
      case 'checkClashConfiguredUrl': {
        const config = await getClashConfig({ noFallback: true });
        return {
          reachable: config !== null,
          config: config
        };
      }

      // ──── 模式切换 ────
      case 'setMode': {
        const settings = await getSettings();
        const oldMode = settings.currentMode;
        // clashProxy 仅在 clash 模式下有意义；system/direct 模式不需要代理地址，保持 null
        // 旧代码用 clashApiPort（API 端口 9090）初始化代理端口，语义错误：API 端口 ≠ 代理端口（7890）
        let clashProxy = null;

        // Clash 模式：必须先检测 Clash 是否在线，防止代理指向无监听端口导致 CPU 飙高
        if (message.mode === 'clash') {
          // 优先用用户配置的 URL 检测
          let config = await getClashConfig({ noFallback: true });
          let usedFallback = false;
          // 用户配置的 URL 不通时，并行回退探测（竞速，最快响应的端口立即返回）
          // 用户可在设置中关闭"端口错误自动探测"以禁用回退
          if (!config && settings.disableFallback !== true) {
            // ★ 修复：只用 getApiConfig 获取 headers，排除项用 settings.clashApiUrl
            // 原因：getApiConfig 的 baseUrl 可能是 session 缓存的 clashActualApiUrl（上次回退探测到的端口），
            //       如果用缓存作为排除项，会把这个可用端口排除在候选之外，导致回退探测失败
            //       （保存设置时探测到 9097 并写入缓存，setMode 时 9097 被排除 → 探测失败 → "clash 未运行"）
            const { headers } = await getApiConfig();
            const apiHost = settings.clashApiHost || '127.0.0.1';
            // 只排除用户配置的 URL（已通过 noFallback=true 检测过，确定不通）
            // 从 settings.clashApiUrl 提取端口，只比较端口号避免 URL 格式差异
            const userPort = settings.clashApiUrl?.match(/:(\d+)(?:\/|$)/)?.[1];
            const candidateUrls = CLASH_API_PORTS
              .filter(port => String(port) !== userPort)
              .map(port => `http://${apiHost}:${port}`);
            const found = await tryFetchParallel(
              candidateUrls.map(url => `${url}/configs`),
              headers
            );
            if (found) {
              config = found.data;
              usedFallback = true;
              // 缓存到 session，后续业务操作（clashGet/rules 等）直接用这个 URL
              // 注意：缓存只用于业务操作，不用于回退探测的排除项
              await cacheActualApiUrl(found.url.replace(/\/configs$/, ''));
            }
          }
          if (!config) {
            // Clash 完全不可用（用户配置 URL 不通且回退也找不到），拒绝切换
            console.warn('ClashOmega: refusing switch to clash mode — Clash not running');
            return { success: false, error: 'clash_not_running' };
          }
          const detected = extractProxyAddress(config, settings.clashApiHost);
          clashProxy = detected;
          // 注意：不把代理端口写回 settings.clashApiPort
          // clashApiPort 是用户配置的 API 端口（9090），代理端口（7890）只存在于局部变量 clashProxy 中
          console.log(`ClashOmega: detected proxy port ${detected.port} from Clash config${usedFallback ? ' (via fallback)' : ''}`);
        }

        await setProxyMode(message.mode, clashProxy);
        settings.currentMode = message.mode;
        await chrome.storage.local.set({ settings });
        await setActionIcon(message.mode);

        // 模式发生实际变化时刷新当前标签页（同模式切换无需刷新）
        if (oldMode && oldMode !== message.mode) {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id) {
              chrome.tabs.reload(tab.id);
            }
          } catch (e) {
            console.log('ClashOmega: tab reload failed:', e.message);
          }
        }

        return { success: true, proxyPort: clashProxy ? clashProxy.port : null };
      }

      // ──── Clash 规则读取（REST API） ────
      case 'getClashRules': {
        const data = await getClashRules();
        return { success: data !== null, rules: data?.rules || [] };
      }

      // ──── Clash 代理组列表 ────
      case 'getProxies': {
        const proxies = await getClashProxies();
        return { success: true, proxies };
      }

      // ──── Clash 状态 ────
      case 'getClashConfig': {
        const config = await getClashConfig();
        return { success: config !== null, config };
      }

      // ──── 客户端类型检测（独立查询，供 popup 单独调用）────
      case 'getClientType': {
        try {
          const settings = await getSettings();
          const clientInfo = await detectClashClient(settings.clashApiUrl);
          return {
            success: true,
            clientType: clientInfo.clientType,
            nativeHostAvailable: clientInfo.nativeHostAvailable,
            apiReachable: clientInfo.apiReachable,
            details: clientInfo.details,
            fileOperationSupported: isFileOperationSupported(clientInfo.clientType)
          };
        } catch (e) {
          return { success: false, error: e.message, clientType: CLIENT_TYPES.UNKNOWN };
        }
      }

      // ──── Clash 内核模式切换（PATCH /configs {mode}）────
      // 阶段一仅运行时切换，不持久化到 OpenClash uci；走 Clash API 直接生效
      // 注意：不能调用 restartClash，因为 PUT /configs reload 会从配置文件重新加载 mode，重置本次切换
      case 'switchClashMode': {
        const validModes = ['rule', 'global', 'direct'];
        if (!validModes.includes(message.mode)) {
          return { success: false, error: 'invalid mode: ' + message.mode };
        }
        const ok = await switchClashMode(message.mode);
        if (ok) {
          // 持久化到 chrome.storage.local（仅记录用户选择，不写入 OpenClash uci）
          const settings = await getSettings();
          const oldMode = settings.clashRemoteMode || 'rule';
          settings.clashRemoteMode = message.mode;
          await chrome.storage.local.set({ settings });
          // 刷新当前标签页：让浏览器放弃与 Clash 的 keep-alive 连接
          // 原因：Clash 切换 mode 后对新连接立即生效，但浏览器复用 keep-alive 连接会走旧路径
          // 刷新标签页强制浏览器建立新连接，按新 mode 走
          if (oldMode !== message.mode) {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab && tab.id) {
                chrome.tabs.reload(tab.id);
              }
            } catch (e) {
              console.log('ClashOmega: tab reload after switchClashMode failed:', e.message);
            }
          }
        }
        return { success: ok };
      }

      // ──── 获取 Clash 内核当前模式（GET /configs 返回 mode 字段）────
      case 'getClashMode': {
        const config = await getClashConfig();
        if (!config) return { success: false, error: 'Clash API unavailable' };
        return { success: true, mode: config.mode || 'rule' };
      }

      // ──── 规则管理（Native Host 写入 + Clash API 热重载）────
      // 写入成功后返回，用户需手动重启 Clash 生效
      // 注意：文件级规则写入仅支持 Clash Verge Rev，非 CVR 客户端返回明确错误
      case 'addRule': {
        const settings = await getSettings();
        // 客户端类型检查：非 CVR 不支持文件级规则写入
        if (!isFileOperationSupported(settings._lastClientType || CLIENT_TYPES.UNKNOWN)) {
          return {
            success: false,
            error: 'file_op_not_supported',
            hint: '当前 Clash 客户端不支持文件级规则写入，仅 Clash Verge Rev 支持 Script.js / YAML 规则管理'
          };
        }
        // writeToYaml=true 表示"写入 YAML 配置文件"，writeToYaml=false（默认）表示"写入 Script.js 扩展脚本"
        // Native Host 接口的 useScript 参数语义与字段相反：useScript=true 表示写入 Script.js
        const useScript = settings.writeToYaml !== true;
        const result = await addClashRule(message.rule, settings.clashConfigPath, useScript);
        return result;
      }

      case 'batchAddRules': {
        const settings = await getSettings();
        if (!isFileOperationSupported(settings._lastClientType || CLIENT_TYPES.UNKNOWN)) {
          return {
            success: false,
            error: 'file_op_not_supported',
            hint: '当前 Clash 客户端不支持文件级规则写入，仅 Clash Verge Rev 支持'
          };
        }
        const useScript = settings.writeToYaml !== true;
        // useScript=true 时逐条写入 Script.js（Native Host 已支持）
        if (useScript) {
          let added = 0;
          for (const rule of message.rules) {
            const r = await addClashRule(rule, settings.clashConfigPath, true);
            if (r && r.success) added++;
          }
          return { success: true, message: `${added} rules added to script` };
        }
        const result = await batchAddClashRules(message.rules, settings.clashConfigPath);
        return result;
      }

      case 'removeRule': {
        const settings = await getSettings();
        if (!isFileOperationSupported(settings._lastClientType || CLIENT_TYPES.UNKNOWN)) {
          return {
            success: false,
            error: 'file_op_not_supported',
            hint: '当前 Clash 客户端不支持文件级规则删除，仅 Clash Verge Rev 支持'
          };
        }
        // 优先使用消息中的 useScript（来自扩展脚本规则列表的删除按钮），
        // 否则根据 settings.writeToYaml 决定：writeToYaml=true → useScript=false（从 YAML 删除），false → useScript=true（从 Script.js 删除）
        const useScript = message.useScript === true || (message.useScript === undefined && settings.writeToYaml !== true);
        const result = await removeClashRule(message.rule, settings.clashConfigPath, useScript);
        return result;
      }

      // ──── Script.js 扩展脚本规则管理 ────
      // 注意：Script.js 文件操作仅支持 Clash Verge Rev，非 CVR 客户端返回空结果
      case 'getScriptPath': {
        const settings = await getSettings();
        if (!isFileOperationSupported(settings._lastClientType || CLIENT_TYPES.UNKNOWN)) {
          return { success: false, error: 'file_op_not_supported' };
        }
        return await getScriptPath();
      }

      case 'getScriptRules': {
        const settings = await getSettings();
        if (!isFileOperationSupported(settings._lastClientType || CLIENT_TYPES.UNKNOWN)) {
          // 非 CVR：返回空规则列表（不报错），UI 侧由 updateClientTypeUI 显示"不支持"提示
          return { success: true, rules: [] };
        }
        return await getScriptRules();
      }

      case 'initScriptFile': {
        const settings = await getSettings();
        if (!isFileOperationSupported(settings._lastClientType || CLIENT_TYPES.UNKNOWN)) {
          return { success: false, error: 'file_op_not_supported' };
        }
        return await initScriptFile();
      }

      // ──── 域名检测 ────
      case 'getPageDomains': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const domains = getTabDomains(tab.id);
        const count = getTabDomainCount(tab.id);
        return { success: true, domains, count };
      }

      // ──── 域名连接查询（通过 Clash API /connections 查询域名实际匹配的规则）────
      case 'getDomainConnections': {
        const connections = await getClashConnections();
        if (!connections || !connections.connections) {
          return { success: false, error: 'Cannot get connections from Clash API' };
        }
        return { success: true, connections: connections.connections };
      }

      // ──── 设置管理 ────
      case 'getSettings': {
        return await getSettings();
      }

      case 'saveSettings': {
        // 清除客户端类型缓存，强制 getStatus 重新检测客户端类型
        // 原因：用户保存设置可能是因为切换了 Clash 客户端（CVR→FLClash），
        //       需要重新走 detectClashClient 流程，避免上次缓存的 _lastClientType 污染判断
        //       （_lastClientType 用于"客户端类型变化时清缓存"的判断，保存后必须重置）
        if (message.settings) {
          delete message.settings._lastClientType;
        }
        await chrome.storage.local.set({ settings: message.settings });
        // 用户修改设置时清除会话级缓存的 API URL，强制重新检测
        await clearCachedApiUrl();
        return { success: true };
      }

      // ──── Clash 服务管理 ────
      case 'setConfigPath': {
        const result = await sendToNativeSafe({ action: 'setConfigPath', path: message.path });
        return result;
      }

      case 'ping': {
        const result = await sendToNativeSafe({ action: 'ping' });
        return result;
      }

      case 'restartClash': {
        const settings = await getSettings();

        // Step 0: 检测 mihomo 内核是否存活
        // 根因：mihomo 已死时，PUT /configs 和 POST /restart 都必然失败（端口不监听），
        //       ClashOmega 无法通过 HTTP API 救活，必须让用户去 Clash Verge Rev GUI 重启
        console.log('[restartClash] Step 0: Checking mihomo kernel health...');
        const alive = await isMihomoAlive();
        if (!alive) {
          console.error('[restartClash] FAILED at step 0: mihomo kernel not reachable (crashed or not started)');
          return {
            success: false,
            error: 'mihomo-crashed',
            hint: '请打开 Clash 客户端 GUI，点击"重启内核"或"重载配置"按钮恢复 mihomo，然后再用插件重启。'
          };
        }
        console.log('[restartClash] Step 0 OK: mihomo alive');

        // 客户端类型检测：非 Clash Verge Rev 客户端不支持文件操作（Script.js / 快照同步）
        // 走精简路径：直接 POST /restart + 关闭连接，跳过 Step 1-4 的文件操作
        let clientType = settings._lastClientType || CLIENT_TYPES.UNKNOWN;
        if (!clientType || clientType === CLIENT_TYPES.UNKNOWN) {
          try {
            const clientInfo = await detectClashClient(settings.clashApiUrl);
            clientType = clientInfo.clientType;
          } catch {
            clientType = CLIENT_TYPES.UNKNOWN;
          }
        }
        if (!isFileOperationSupported(clientType)) {
          console.log(`[restartClash] Client type: ${clientType} (file ops not supported), using API-only restart path`);
          // 非 CVR 路径：直接 POST /restart + 关闭连接
          const restarted = await restartKernel();
          if (!restarted) {
            console.error('[restartClash] FAILED: POST /restart failed (non-CVR path)');
            return { success: false, error: 'Clash API unreachable — check API URL & secret in settings' };
          }
          console.log('[restartClash] OK: kernel restarted (non-CVR path)');
          // 关闭活跃连接，强制新连接按新配置匹配
          await closeAllConnections().catch(() => {});
          settings.clashRemoteMode = 'rule';
          await chrome.storage.local.set({ settings });
          return { success: true, method: 'restart-non-cvr', clientType };
        }

        console.log('[restartClash] Client type: clash-verge-rev, using full file-ops restart path');

        console.log('[restartClash] Step 1: Reading rules from profile file...');
        const yamlResult = await getClashYamlRules(settings.clashConfigPath);
        // 使用 Array.isArray 严格检查，防止 rules 为 {} 等非数组 truthy 值通过检查
        if (!yamlResult || !yamlResult.success || !Array.isArray(yamlResult.rules)) {
          console.error('[restartClash] FAILED at step 1: cannot read profile rules', yamlResult);
          return { success: false, error: 'Cannot read rules from profile file (invalid)' };
        }
        console.log(`[restartClash] Step 1 OK: ${yamlResult.rules.length} rules read`);

        // Step 2: 读取扩展脚本的 customRules，前置到 profile 规则列表
        // 关键：Clash Verge Rev 生成 clash-verge.yaml 时才执行扩展脚本，
        // 但我们直接修改 clash-verge.yaml 不会触发脚本执行，
        // 所以需要手动读取扩展脚本的规则并前置到合并后的规则列表
        let mergedRules = yamlResult.rules;
        console.log('[restartClash] Step 2: Reading script rules...');
        const scriptResult = await getScriptRules();
        if (scriptResult && scriptResult.success && Array.isArray(scriptResult.rules) && scriptResult.rules.length > 0) {
          console.log(`[restartClash] Step 2 OK: ${scriptResult.rules.length} script rules read, prepending to profile rules`);
          mergedRules = [...scriptResult.rules, ...yamlResult.rules];
        } else {
          console.log('[restartClash] Step 2 SKIPPED: no script rules or script not initialized');
        }

        // Step 2.5: 校验规则引用的代理组都存在
        // 根因：规则引用不存在的代理组（如 GFWList 组被删除），mihomo 启动时 fatal 退出
        //       需要在写入快照前丢弃无效规则，保证写入的快照可被 mihomo 正常加载
        console.log('[restartClash] Step 2.5: Validating rules against current proxy-groups...');
        const proxies = await getClashProxies();
        const availableGroupNames = Object.keys(proxies);
        const { valid: validRules, invalid: invalidRules } = validateRulesAgainstGroups(mergedRules, availableGroupNames);
        if (invalidRules.length > 0) {
          console.warn(`[restartClash] Step 2.5 WARN: ${invalidRules.length} invalid rule(s) reference non-existent proxy-group, will be dropped:`, invalidRules);
          mergedRules = validRules;
        } else {
          console.log(`[restartClash] Step 2.5 OK: all ${mergedRules.length} rules reference existing proxy-groups`);
        }

        // Step 3: 同步合并后的规则到快照（包含扩展脚本规则）
        if (mergedRules.length > 0) {
          console.log('[restartClash] Step 3: Syncing merged rules to snapshot...');
          const syncResult = await syncSnapshotRules(mergedRules);
          if (!syncResult || !syncResult.success) {
            console.error('[restartClash] FAILED at step 3: snapshot sync failed', syncResult);
            return { success: false, error: syncResult?.error || 'Failed to sync snapshot' };
          }
          console.log(`[restartClash] Step 3 OK: snapshot synced to ${syncResult.snapshotPath}`);
        } else {
          console.log('[restartClash] Step 3 SKIPPED: no rules to sync');
        }

        // Step 4: 优先尝试 PUT /configs {path} 热重载（不中断代理）
        console.log('[restartClash] Step 4: Trying PUT /configs reload (no proxy interruption)...');
        const snapshotPathResult = await getSnapshotPath();
        if (snapshotPathResult && snapshotPathResult.success && snapshotPathResult.snapshotPath) {
          const reloaded = await reloadConfigFromPath(snapshotPathResult.snapshotPath);
          if (reloaded) {
            console.log('[restartClash] Step 4 OK: config reloaded via PUT /configs');
            // Step 4.5: 关闭所有活跃连接，强制新连接重新匹配最新规则
            // 根因：PUT /configs 热重载只更新配置，不断开已建立连接；
            //       Clash 规则匹配只在连接建立时进行，旧连接不会重新匹配新规则。
            //       不关闭连接会导致用户感觉"重启 Clash 不生效"。
            console.log('[restartClash] Step 4.5: Closing all active connections to force rule re-match...');
            const closed = await closeAllConnections();
            if (closed) {
              console.log('[restartClash] Step 4.5 OK: all connections closed');
            } else {
              console.warn('[restartClash] Step 4.5 WARN: failed to close connections (rules will take effect on new connections only)');
            }
            // 重启后 Clash 内核 mode 会从配置文件重新加载，回到默认值（rule）
            // 同步重置扩展 storage 中的 clashRemoteMode，让 popup UI 按钮回到「规则」
            settings.clashRemoteMode = 'rule';
            await chrome.storage.local.set({ settings });
            return { success: true, method: 'reload' };
          }
          console.warn('[restartClash] Step 4 FAILED: PUT /configs failed, falling back to POST /restart');
        } else {
          console.warn('[restartClash] Step 4 SKIPPED: cannot get snapshot path, falling back to POST /restart');
        }

        // Step 5: 兜底 POST /restart（会短暂中断代理）
        console.log('[restartClash] Step 5: Calling POST /restart (fallback)...');
        const restarted = await restartKernel();
        if (!restarted) {
          console.error('[restartClash] FAILED at step 5: POST /restart failed (check API URL & secret in settings)');
          return { success: false, error: 'Clash API unreachable — check API URL & secret in settings' };
        }
        console.log('[restartClash] Step 5 OK: kernel restarted successfully');
        // 重启后 Clash 内核 mode 会从配置文件重新加载，回到默认值（rule）
        // 同步重置扩展 storage 中的 clashRemoteMode，让 popup UI 按钮回到「规则」
        settings.clashRemoteMode = 'rule';
        await chrome.storage.local.set({ settings });
        return { success: true, method: 'restart' };
      }

      default:
        return { success: false, error: `Unknown action: ${message.action}` };
    }
  } catch (e) {
    console.error(`Handle message error (${message.action}):`, e);
    return { success: false, error: e.message };
  }
}

// ──── 初始化 ────
async function init() {
  const settings = await getSettings();
  let mode = settings.currentMode;
  // clashProxy 仅在 clash 模式下有意义；system/direct 模式不需要代理地址，保持 null
  // 旧代码用 clashApiPort（API 端口 9090）初始化代理端口，语义错误：API 端口 ≠ 代理端口（7890）
  let clashProxy = null;

  // 如果当前是 clash 模式，启动时必须重新检测 Clash 是否在线
  // 防止 Service Worker 重启后用旧端口（可能已失效）导致代理指向死端口 → CPU 飙高
  if (mode === 'clash') {
    // 优先用用户配置的 URL 检测
    let config = await getClashConfig({ noFallback: true });
    let usedFallback = false;
    // 用户配置的 URL 不通时，并行回退探测（与 getStatus/setMode 保持一致）
    // 用户可在设置中关闭"端口错误自动探测"以禁用回退
    if (!config && settings.disableFallback !== true) {
      const { baseUrl, headers } = await getApiConfig();
      const apiHost = settings.clashApiHost || '127.0.0.1';
      const candidateUrls = CLASH_API_PORTS
        .map(port => `http://${apiHost}:${port}`)
        .filter(testUrl => testUrl !== baseUrl);
      const found = await tryFetchParallel(
        candidateUrls.map(url => `${url}/configs`),
        headers
      );
      if (found) {
        config = found.data;
        usedFallback = true;
        // 缓存到 session，后续操作直接用这个 URL
        await cacheActualApiUrl(found.url.replace(/\/configs$/, ''));
      }
    }
    if (config) {
      // Clash 在线：从 API 读取实际代理端口（仅用于本次启动的代理设置，不持久化到 settings）
      const detected = extractProxyAddress(config, settings.clashApiHost);
      clashProxy = detected;
      console.log(`ClashOmega: init detected proxy port ${detected.port} from Clash config${usedFallback ? ' (via fallback)' : ''}`);
    } else {
      // Clash 完全离线（用户配置 URL 不通且回退也找不到）：回退到 system 模式
      console.warn('ClashOmega: Clash not running on init, falling back to system mode');
      mode = 'system';
      settings.currentMode = 'system';
      await chrome.storage.local.set({ settings });
    }
  }

  await setProxyMode(mode, clashProxy);
  await setActionIcon(mode);
}

// 根据模式切换扩展图标颜色
async function setActionIcon(mode) {
  const base = 'icons/';
  const sizes = { 16: 'icon16', 48: 'icon48', 128: 'icon128' };
  const path = {};
  for (const [size, prefix] of Object.entries(sizes)) {
    path[size] = `${base}${prefix}_${mode}.png`;
  }
  try {
    await chrome.action.setIcon({ path });
  } catch (e) {
    console.warn('setActionIcon failed:', e.message);
  }
}

init();