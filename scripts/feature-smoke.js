const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { assetVersion } = require('../release.json');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.js');
const index = read('public/index.html');
const mobile = read('public/mobile.html');
const styles = read('public/styles.css');
const mobileStyles = read('public/mobile.css');
const app = read('public/app.js');
const mobileApp = read('public/mobile.js');
const shared = read('public/shared.js');
const officialMap = read('public/official-map.js');
const serviceWorker = read('public/sw.js');
const i18n = read('public/i18n.js');
const secureStorage = read('public/secure-storage.js');
const voiceAlert = read('public/voice-alert.js');
const pushClient = read('public/push-client.js');
const pushWorker = read('public/push-sw.js');
const pushRelayWorker = read('cloudflare/push-relay-worker.mjs');
const deployScript = read('scripts/deploy-linux.sh');
const sharedRuntime = require('../public/shared.js');

assert(/^[A-Za-z0-9._-]{2,80}$/.test(assetVersion), '发布版本号格式无效');
for (const [name, html] of [['desktop', index], ['mobile', mobile], ['obs', read('public/obs.html')]]) {
  const versions = [...html.matchAll(/(?:i18n|styles|mobile|obs|shared|secure-storage|voice-alert|push-client|official-map|app)\.(?:css|js)\?v=([^"']+)/g)]
    .map(match => match[1]);
  assert(versions.length > 0 && versions.every(version => version === assetVersion), `${name} 资源版本未同步`);
}
assert(serviceWorker.includes(`?v=${assetVersion}`), 'Service Worker 资源版本未同步');
assert(serviceWorker.includes("CACHE_NAME = 'quake-mobile-v22'"), 'Service Worker 缓存版本未升级');
assert(serviceWorker.includes(`/push-client.js?v=${assetVersion}`), 'Service Worker 缺少统一推送客户端资源');
assert(!serviceWorker.includes("'/mobile',") && !serviceWorker.includes("'/mobile.html',"), 'Service Worker 仍缓存 HTML 页面');
assert(serviceWorker.includes("event.request.mode === 'navigate'") && serviceWorker.includes("cache: 'no-store'"), 'Service Worker 未强制导航请求使用网络');

assert(index.indexOf('class="map-metrics"') > index.indexOf('class="map-stage"'), '桌面地图浮动指标不在地图层内');
assert(index.includes('id="desktop-map-coords"') && index.includes('id="desktop-map-radius"'), '桌面地图缺少震源坐标或传播半径');
assert(index.includes('id="desktop-detail-coords"') && index.includes('id="desktop-detail-radius"'), '窄地图缺少地震详情指标回退字段');
assert(/\.map-stage > \.map-metrics\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*16px;[\s\S]*?left:\s*50%;[\s\S]*?translateX\(-50%\)/.test(styles), '桌面地图指标未固定在统一顶部安全区');
assert(!/data-map-source="(?:google|yandex)"[^}]*\.map-metrics/.test(styles), '地图指标仍按地图源使用不一致的位置');
assert(app.includes('initMapMetricLayout()') && app.includes("stage.dataset.metricsLayout = compact ? 'detail' : 'overlay'"), '地图指标未根据实际空间回退到地震详情');
assert(styles.includes('body.map-metrics-in-detail .detail-grid .detail-map-fallback') && styles.includes('body.map-metrics-in-detail .map-stage > .map-metrics'), '地图指标与地震详情的响应式切换样式缺失');
assert(officialMap.includes('google.maps.ControlPosition.LEFT_BOTTOM'), 'Google 桌面缩放控件未放入左下安全区');
assert(/\.map-runtime-status\s*\{[\s\S]*?left:\s*50%;[\s\S]*?bottom:\s*44px;[\s\S]*?translateX\(-50%\)/.test(styles), '地图加载提示未放在底部中央');
assert(index.includes('rel="preconnect" href="https://webapi.amap.com"'), '首页缺少地图连接预热');
assert(officialMap.includes("preconnect.rel = 'preconnect'"), '地图提供方未动态预热连接');
assert(!server.includes('await triggerChinaHistoryRefresh'), '首页仍被历史数据刷新阻塞');
assert(styles.includes('flex: 0 0 42px') && styles.includes('html[lang="en"] .brand h1'), '桌面英文品牌标记可能被长标题挤压');
assert(index.includes('<h1>地震数据监控</h1>') && mobile.includes('<b>地震数据监控</b>'), '双端主标题未统一为地震数据监控');
assert(i18n.includes("'地震数据监控': 'Earthquake Data Monitor'"), '英文主标题未统一为 Earthquake Data Monitor');
assert(index.includes('class="data-disclaimer"') && mobile.includes('class="data-disclaimer"'), '双端缺少明显的数据免责声明');
assert(i18n.includes('does not replace official government notices or emergency instructions'), '免责声明缺少英文版本');
assert(![index, mobile, i18n, app, mobileApp, voiceAlert, pushWorker, server].join('\n').includes('预警'), '用户可见源码仍包含禁用的“预警”字样');

for (const [name, js, css] of [['desktop', app, styles], ['mobile', mobileApp, mobileStyles]]) {
  assert(js.includes('const THEME_TRANSITION_MS = 180'), `${name} 主题切换时长不是 180ms`);
  assert(css.includes('html.theme-transitioning'), `${name} 缺少统一主题过渡`);
  assert(/background-color 180ms linear/.test(css), `${name} 主题颜色过渡不是 180ms`);
  assert(js.includes('const MIN_HEALTHY_SOURCE_COUNT = 4'), `${name} 信源健康阈值不是 4`);
  assert(js.includes('connected === 0') && js.includes("'offline'") && js.includes("'warning'") && js.includes("'connected'"), `${name} 信源三色判定不完整`);
  assert(js.includes('getBrowserLocationOnce') && js.includes('if (state.browserLocationPromise) return state.browserLocationPromise'), `${name} 未复用单次定位请求`);
}
assert(app.includes("activeItems = items.filter(item => item.status !== 'closed')"), '桌面端仍把关闭信源计入分母');
assert(mobileApp.includes("activeSources = viewSources.filter(source => (source.status || 'closed') !== 'closed')"), '手机端仍把关闭信源计入分母');
assert(app.includes('liveChannelStatus(') && app.includes('connectedSourceCount()'), '桌面实时通道未使用共用信源判定');
assert(mobileApp.includes('liveChannelStatus(') && mobileApp.includes('MIN_HEALTHY_SOURCE_COUNT'), '手机实时通道未使用共用信源判定');
assert.deepStrictEqual(sharedRuntime.liveChannelStatus(4, 'connected', true, 4), { status: 'connected', tone: 'connected', label: '实时通道已连接' });
assert.deepStrictEqual(sharedRuntime.liveChannelStatus(3, 'connected', true, 4), { status: 'connecting', tone: 'warning', label: '实时通道正在连接' });
assert.deepStrictEqual(sharedRuntime.liveChannelStatus(1, 'connected', true, 4), { status: 'connecting', tone: 'warning', label: '实时通道正在连接' });
assert.deepStrictEqual(sharedRuntime.liveChannelStatus(0, 'connected', true, 4), { status: 'closed', tone: 'offline', label: '实时通道未连接' });
assert.deepStrictEqual(sharedRuntime.liveChannelStatus(7, 'disconnected', true, 4), { status: 'connected', tone: 'connected', label: '实时通道已连接' });
assert.deepStrictEqual(sharedRuntime.liveChannelStatus(7, 'disconnected', false, 4), { status: 'closed', tone: 'offline', label: '实时通道未连接' });
for (const [name, js] of [['desktop', app], ['mobile', mobileApp]]) {
  assert(js.includes('SOURCE_SNAPSHOT_MAX_AGE_MS = 30000') && js.includes('sourceSnapshotAt'), `${name} 信源快照缺少新鲜度限制`);
  assert(js.includes('hasFreshSourceSnapshot()'), `${name} 实时通道未使用新鲜信源快照`);
}
assert(/@media \(max-width:\s*1180px\)[\s\S]*?\.detail-grid\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?grid-template-rows:\s*repeat\(3, minmax\(86px, auto\)\)/.test(styles), '桌面小窗口详情网格仍可能折叠');
assert(i18n.includes("'实时通道正在连接': 'Live channel connecting'") && i18n.includes("'实时通道未连接': 'Live channel not connected'"), '实时通道英文状态缺失');
for (const [name, js, css] of [['desktop', app, styles], ['mobile', mobileApp, mobileStyles]]) {
  assert(js.includes('placeGuideElements(') && js.includes("behavior: 'auto'"), `${name} 引导气泡未使用视口避让定位`);
  assert(js.includes('refreshGuidePlacement') && js.includes("setAttribute('aria-modal', 'true')"), `${name} 引导层未响应窗口变化或缺少模态语义`);
  assert(css.includes('max-height: calc(100dvh -') && css.includes('overscroll-behavior: contain'), `${name} 引导气泡在极小窗口可能溢出`);
}
assert(app.includes("'#desktop-settings-open-compact'") && app.includes("'#desktop-settings-open'"), '桌面引导未选择当前可见的设置按钮');
assert(secureStorage.includes('grid-template-rows:minmax(0,1fr) auto') && secureStorage.includes('max-height:calc(100dvh - 16px)') && secureStorage.includes('position:sticky;bottom:0'), 'Cookie 弹窗在最小窗口缺少滚动与固定操作区');

assert(shared.includes("{ key: 'yandex', label: 'Yandex' }"), 'Yandex 页面标签异常');
assert(!/Yandex\s+(?:\d+|\$\{[^}]+\})\s*\/\s*100/.test([index, mobile, app, mobileApp, shared].join('\n')), '页面仍公开显示 Yandex 计数器');
assert(server.includes("timeZone: 'Europe/Moscow'"), 'Yandex 配额未按莫斯科时区重置');
assert(server.includes("path.join(__dirname, 'data', 'yandex-map-quota.json')"), 'Yandex 配额未保存在服务端');
assert(server.includes('Math.min(100') && server.includes('YANDEX_DAILY_LIMIT'), 'Yandex 每日额度未限制为最多 100');

for (const [name, js] of [['desktop', app], ['mobile', mobileApp]]) {
  assert(js.includes('value.length >= 8 && value.length <= 128'), `${name} 调试密码长度规则缺失`);
  assert(js.includes('uppercase: /[A-Z]/') && js.includes('number: /[0-9]/') && js.includes('special: /[^A-Za-z0-9\\s]/'), `${name} 调试密码复杂度规则缺失`);
}
assert(server.includes('password.length < 8 || password.length > 128'), '服务端调试密码长度规则缺失');
assert(server.includes("missing.push('至少 1 个大写字母')") && server.includes("missing.push('至少 1 个数字')") && server.includes("missing.push('至少 1 个特殊符号（例如 @）')"), '服务端调试密码复杂度规则缺失');
assert(pushWorker.includes("self.addEventListener('pushsubscriptionchange'") && pushWorker.includes("fetch('/push/resubscribe'"), '后台推送订阅不能自动续订');
assert(pushWorker.includes('silent: false') && pushWorker.includes('renotify: true'), '后台地震通知仍为静默模式');
assert(server.includes("app.get('/push/status'") && server.includes('sendPushWithRetry'), '服务端缺少推送状态或失败重试');
assert(server.includes("app.get('/push/test-status'") && server.includes('res.status(202).json({ ok: true, accepted: true, testId })'), '通知测试仍使用长时间同步请求');
assert(pushClient.includes('waitForTestResult(testId)') && pushClient.includes("fetchJson(`/push/test-status?id=${encodeURIComponent(testId)}`"), '统一推送客户端未轮询后台结果');
assert(index.includes('id="desktop-debug-float-test-notification"') && mobile.includes('id="mobile-debug-test-notification"'), '双端缺少本机通知测试入口');
assert(index.includes('id="desktop-debug-float-test-push"'), '桌面端缺少独立后台推送诊断入口');
assert(index.includes('/push-client.js') && mobile.includes('push-client.js'), '双端未加载统一推送客户端');
assert(mobile.includes('id="mobile-notification-toggle"') && mobile.includes('id="mobile-notification-settings-panel"'), '手机端缺少后台推送开关或条件设置');
assert(mobile.includes('id="mobile-notify-country"') && mobile.includes('id="mobile-notify-district"'), '手机端推送地区设置不完整');
for (const [name, js, selectedExpression] of [['desktop', app, 'selectedLatestEvent()'], ['mobile', mobileApp, 'selectedEvent()']]) {
  assert(js.includes('sendPushEventToCurrentDevice(event)') && js.includes('window.QuakePush.sendEvent(event'), `${name} 本机通知未通过 Node 后台推送到当前订阅`);
  assert(js.includes(selectedExpression) && js.includes('服务器已向当前'), `${name} 本机通知未使用当前选中地震`);
  assert(js.includes('debugForceVisible: true') && js.includes('设备推送已发送'), `${name} 测试地震未先显示再发送设备通知`);
  assert(!js.includes('registration.showNotification('), `${name} 仍绕过服务端直接显示本机通知`);
}
assert(app.includes('testDesktopBackgroundPush') && pushClient.includes("fetchJson('/push/test'"), '后台推送诊断链路被意外删除');
assert(server.includes('TTL: 3600') && server.includes("urgency: 'high'"), '后台推送保留时间或优先级不符合要求');
assert(pushClient.includes('navigator.serviceWorker.ready') && pushClient.includes('waitForPushWorkerActivation(registration)'), '浏览器未等待推送 Service Worker 激活');
assert(pushClient.includes('userVisibleOnly: true') && pushClient.includes('applicationServerKey'), '浏览器订阅参数不符合 Push API 要求');
assert(pushClient.includes('for (let attempt = 0; attempt < 2; attempt += 1)') && pushClient.includes('resetProjectWorkerRegistration()'), '失效推送订阅缺少一次性自动修复');
assert(app.includes('bindPushSubscriptionRefresh()') && app.includes('15 * 60 * 1000'), '浏览器未定期修复后台推送订阅');
assert(mobileApp.includes('bindMobilePushSubscriptionRefresh()') && mobileApp.includes('15 * 60 * 1000'), '手机端未定期修复后台推送订阅');
assert(server.includes("host === 'fcm.googleapis.com'") && server.includes("host === 'android.googleapis.com'"), '服务端缺少 Chrome FCM 推送端点支持');
assert(server.includes("host.endsWith('.notify.windows.com')") && server.includes("host.endsWith('.push.services.mozilla.com')") && server.includes("host.endsWith('.push.apple.com')"), '服务端浏览器推送服务兼容不完整');
assert(server.includes('function sanitizePushClientPath(value)') && server.includes("value === '/mobile.html' ? '/mobile.html' : '/'"), '推送通知打开地址缺少同源白名单');
assert(server.includes('clientPath: sanitizePushClientPath(req.body.clientPath)') && server.includes('url: sanitizePushClientPath(record.clientPath)'), '推送订阅未保存或使用安全的双端打开地址');
assert(server.includes("PUSH_TRANSPORT.mode === 'proxy'") && server.includes("PUSH_TRANSPORT.mode === 'relay'"), '后台推送缺少代理或中继传输路径');
assert(server.includes("createHmac('sha256', PUSH_TRANSPORT.relaySecret)"), 'Node 到推送中继的请求未使用 HMAC');
assert(pushRelayWorker.includes("hostname === 'fcm.googleapis.com'") && pushRelayWorker.includes("hostname.endsWith('.notify.windows.com')"), 'Cloudflare 中继缺少 Chrome FCM 或 Edge WNS 支持');
assert(pushRelayWorker.includes('MAX_REQUEST_BYTES') && pushRelayWorker.includes('ALLOWED_HEADER_NAMES') && pushRelayWorker.includes('hmacHex'), 'Cloudflare 中继缺少请求边界或签名校验');
assert(index.includes('id="desktop-debug-floating-panel" role="region" tabindex="-1"'), '桌面调试工具缺少可聚焦语义');
assert(styles.includes('--z-debug-panel: 4200') && styles.includes('z-index: var(--z-debug-panel)'), '桌面调试工具层级未纳入语义层级表');
assert(styles.includes('.debug-panel-handle > span') && styles.includes('grid-template-columns: minmax(0, 1fr)'), '桌面调试工具标题与状态未使用稳定分行布局');
assert(app.includes('positionDebugPanelInViewport(panel, reset)') && !app.includes("!debugEnabled || mobile"), '桌面小窗口仍会隐藏调试工具或不能限制在视口内');
assert(deployScript.includes('Removed stale systemd drop-ins') && deployScript.includes('Service path mismatch:'), '部署脚本不能清理旧 /app 配置或校验进程目录');

console.log(JSON.stringify({ ok: true, assetVersion, checks: 114 }));
